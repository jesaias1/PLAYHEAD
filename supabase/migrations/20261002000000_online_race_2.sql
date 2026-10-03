-- =============================================================================
-- ONLINE RACE 2.0 — FIRST-TO-FINISH MULTIPLAYER (2..8 SIMULTANEOUS RACERS)
-- =============================================================================
--
-- Replaces the two-player BEST-TIME session with a real race:
--
--   LOBBY READY -> LOADING -> IN_GAME -> COUNTDOWN -> RUNNING -> FINISHED
--
-- New authoritative facts:
--   * capacity      (2/3/4/6/8, default 4) with an ATOMIC capacity-checked join
--   * race_id       (race instance; rematch bumps it so stale messages are dead)
--   * color_index   (stable per-race accent, 0..7)
--   * finish_us     (server-derived elapsed; immutable once set)
--   * dnf           (disconnect / leave while racing)
--   * progress      (checkpoint index, for placement + HUD)
--
-- BACKWARD SAFE:
--   * every column is added IF NOT EXISTS with a default; existing rooms and
--     accounts keep working and simply read as capacity 4 / race_id 'race-...'
--   * the retired best-time columns (attempt_count/finish_count/session_best_us/
--     current_run_us) are left in place, just unused
--   * no account, PB, leaderboard, replay or cosmetic row is destroyed
--
-- Apply with:  supabase db push
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ROOM COLUMNS — capacity + race instance
-- -----------------------------------------------------------------------------
alter table public.race_rooms add column if not exists phase_changed_at timestamptz not null default now();
alter table public.race_rooms
  add column if not exists capacity integer not null default 4;

alter table public.race_rooms
  add column if not exists race_id text not null
    default ('race-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));

alter table public.race_rooms drop constraint if exists race_capacity_valid;
alter table public.race_rooms
  add constraint race_capacity_valid check (capacity in (2,3,4,6,8));

-- ROOM CODE: deliberately NO validating CHECK is added here. Legacy rooms may
-- already contain ambiguous glyphs (I/L/0/O/1), and a CHECK over existing rows
-- would reject them. The unambiguous alphabet is enforced by the create API
-- (RaceRoomService.generateInviteCode) instead. The existing UNIQUE(invite_code)
-- constraint on the table is left exactly as-is.

alter table public.race_rooms drop constraint if exists race_state_valid;
alter table public.race_rooms
  add constraint race_state_valid
  check (state in ('LOBBY','LOADING','IN_GAME','COUNTDOWN','RUNNING','FINISHED','EXPIRED'));

create index if not exists race_rooms_code_v2_idx on public.race_rooms (invite_code);
create index if not exists race_rooms_state_idx on public.race_rooms (state);

-- -----------------------------------------------------------------------------
-- 2. PLAYER COLUMNS — race instance, colour, authoritative finish, DNF, progress
-- -----------------------------------------------------------------------------
alter table public.race_room_players
  add column if not exists color_index integer not null default 0;
alter table public.race_room_players
  add column if not exists finish_us bigint;
alter table public.race_room_players
  add column if not exists finished boolean not null default false;
alter table public.race_room_players
  add column if not exists dnf boolean not null default false;
alter table public.race_room_players
  add column if not exists progress integer not null default 0;
alter table public.race_room_players
  add column if not exists checkpoint_total integer not null default 0;

-- -----------------------------------------------------------------------------
-- 3. SHARED CLOCK + CONSTANTS
-- -----------------------------------------------------------------------------
create or replace function public.race_countdown_lead_ms()
returns bigint language sql immutable as $$ select 3800::bigint $$;

create or replace function public.race_server_now()
returns bigint language sql stable as $$ select (extract(epoch from now()) * 1000)::bigint $$;
grant execute on function public.race_server_now() to authenticated;

-- -----------------------------------------------------------------------------
-- 4. COLOUR ASSIGNMENT — deterministic, low-collision per room
-- -----------------------------------------------------------------------------
create or replace function public.race_compute_color_index(p_room_id uuid)
returns integer language plpgsql stable security definer set search_path = public as $$
declare
  v_candidate int;
begin
  for v_candidate in 0..7 loop
    if not exists (
      select 1 from public.race_room_players p
      where p.room_id = p_room_id and p.color_index = v_candidate
    ) then
      return v_candidate;
    end if;
  end loop;
  return (select count(*)::int % 8 from public.race_room_players where room_id = p_room_id);
end;
$$;
grant execute on function public.race_compute_color_index(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. ATOMIC JOIN — row lock + capacity + phase check
-- -----------------------------------------------------------------------------
-- Two clients racing for the final slot can never both win: the room row is
-- locked FOR UPDATE, the connected count is re-read inside the lock, and the
-- insert happens before the lock releases. A locked / full room is rejected.
create or replace function public.race_join_room(
  p_room_id uuid,
  p_display_name text,
  p_loadout jsonb default '{}'::jsonb
)
returns public.race_room_players
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_room public.race_rooms;
  v_connected int;
  v_existing boolean;
  v_row public.race_room_players;
  v_name text;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  -- The row lock makes the capacity check and the insert ONE atomic decision.
  select * into v_room from public.race_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'room not found'; end if;
  if v_room.expires_at < now() then raise exception 'room expired'; end if;

  select exists (
    select 1 from public.race_room_players where room_id = p_room_id and user_id = v_user
  ) into v_existing;

  if v_room.state <> 'LOBBY' then raise exception 'race already in progress'; end if;
  if not v_existing or not exists (select 1 from public.race_room_players where room_id=p_room_id and user_id=v_user and connected) then
    -- JOIN ONLY BEFORE LOCK. No silent mid-race entry.
    if v_room.state <> 'LOBBY' then
      raise exception 'race already in progress';
    end if;
    select count(*) into v_connected
    from public.race_room_players
    where room_id = p_room_id and connected;
    if v_connected >= v_room.capacity then
      raise exception 'room is full';
    end if;
  end if;

  v_name := (select nullif(btrim(display_name), '') from public.profiles where user_id = v_user);
  if v_name is null then v_name := 'PLAYER'; end if;
  v_name := left(v_name, 24);

  perform set_config('playhead.authorized_race_write', '1', true);

  if v_existing then
    update public.race_room_players
    set connected = true, ready=false, loaded=false, in_game_ready=false, dnf=false, last_seen_at = now()
    where room_id = p_room_id and user_id = v_user
    returning * into v_row;
  else
    insert into public.race_room_players (
      room_id, user_id, display_name, loadout, ready, connected, color_index, last_seen_at
    ) values (
      p_room_id, v_user, v_name, public.race_player_loadout(v_user), false, true,
      public.race_compute_color_index(p_room_id), now()
    )
    returning * into v_row;
  end if;

  perform set_config('playhead.authorized_race_write', '0', true);
  perform public.race_room_advance(p_room_id);
  return v_row;
end;
$$;
grant execute on function public.race_join_room(uuid, text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. DIRECT-WRITE GUARDS
-- -----------------------------------------------------------------------------
create or replace function public.race_rooms_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if current_setting('playhead.authorized_race_write', true) = '1' then
    if new.state is distinct from old.state then new.phase_changed_at := clock_timestamp(); end if;
    return new;
  end if;
  if auth.uid() is null then return new; end if;   -- service-role context

  if tg_op='INSERT' then
    if new.state <> 'LOBBY' or new.start_at_ms is not null or new.started_at is not null or new.finished_at is not null then raise exception 'new room must start in LOBBY'; end if;
    new.race_id := 'race-' || replace(gen_random_uuid()::text,'-','');
    return new;
  end if;
  if new.start_at_ms is distinct from old.start_at_ms then
    raise exception 'start_at_ms is server-authoritative';
  end if;
  if new.race_id is distinct from old.race_id then
    raise exception 'race_id is server-authoritative';
  end if;
  -- Clock + lifecycle fields are also server-owned for direct writers.
  if new.started_at is distinct from old.started_at
     or new.finished_at is distinct from old.finished_at then
    raise exception 'race clock is server-authoritative';
  end if;
  -- SETUP LOCK: track/title/identity/capacity may only change from LOBBY.
  if new.track_id is distinct from old.track_id
     or new.track_title is distinct from old.track_title
     or new.map_version is distinct from old.map_version
     or new.map_fingerprint is distinct from old.map_fingerprint
     or new.capacity is distinct from old.capacity then
    if old.state <> 'LOBBY' then
      raise exception 'race setup is locked after the lobby';
    end if;
  end if;
  -- STATE IS SERVER-AUTHORITATIVE, FULL STOP. A host may NOT flip a room to
  -- FINISHED/LOBBY directly: every phase change goes through race_room_advance
  -- / rematch / abandon with the authorized-write flag set.
  if new.state is distinct from old.state then
    raise exception 'race state is server-authoritative';
  end if;
  if new.host_user_id is distinct from old.host_user_id
     or new.invite_code is distinct from old.invite_code then
    raise exception 'room identity is immutable';
  end if;

  return new;
end;
$$;

drop trigger if exists race_rooms_guard on public.race_rooms;
create trigger race_rooms_guard
  before insert or update on public.race_rooms
  for each row execute function public.race_rooms_guard();

create or replace function public.race_players_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('playhead.authorized_race_write', true) = '1' then return new; end if;
  if auth.uid() is null then return new; end if;
  -- new.finish_us/new.finished/new.dnf/new.progress/new.color_index/new.loaded/
  -- new.in_game_ready/new.connected and membership are exclusively RPC-owned.
  raise exception 'race player authority fields are server-owned';
end;
$$;

drop trigger if exists race_players_guard on public.race_room_players;
create trigger race_players_guard
  before insert or update on public.race_room_players
  for each row execute function public.race_players_guard();

-- -----------------------------------------------------------------------------
-- 7. THE STATE MACHINE — one authoritative advance function
-- -----------------------------------------------------------------------------
create or replace function public.race_room_advance(p_room_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_state     text;
  v_start     bigint;
  v_connected int;
  v_ready     int;
  v_loaded    int;
  v_ingame    int;
  v_finishers int;
  v_remaining int;
begin
  select state, start_at_ms into v_state, v_start
  from public.race_rooms where id = p_room_id for update;
  if v_state is null then return; end if;
  if v_state in ('FINISHED', 'EXPIRED') then return; end if;
  if exists(select 1 from public.race_rooms where id=p_room_id and expires_at<now()) then
    perform set_config('playhead.authorized_race_write','1',true);
    update public.race_rooms set state='EXPIRED' where id=p_room_id;
    perform set_config('playhead.authorized_race_write','0',true); return;
  end if;
  if v_state='LOADING' and exists(select 1 from public.race_rooms where id=p_room_id and phase_changed_at<now()-interval '180 seconds') then
    perform set_config('playhead.authorized_race_write','1',true);
    perform public.race_cancel_staging(p_room_id,v_state);
    perform set_config('playhead.authorized_race_write','0',true); return;
  end if;

  select
    count(*) filter (where connected),
    count(*) filter (where connected and ready),
    count(*) filter (where connected and loaded),
    count(*) filter (where connected and in_game_ready),
    count(*) filter (where connected and (finished or finish_us is not null or dnf))
  into v_connected, v_ready, v_loaded, v_ingame, v_finishers
  from public.race_room_players
  where room_id = p_room_id;

  -- RUNNING COMPLETION: the race is over only once EVERY connected racer has
  -- finished or DNF'd. Finishers stay FINISHED (never DNF); the room keeps
  -- RUNNING while anyone is still on track.
  if v_state = 'RUNNING' then
    if v_finishers >= v_connected then
      perform set_config('playhead.authorized_race_write', '1', true);
      update public.race_rooms
      set state = 'FINISHED', finished_at = now()
      where id = p_room_id;
      perform set_config('playhead.authorized_race_write', '0', true);
    end if;
    return;
  end if;

  -- Not enough players (left / disconnected): abort the pre-race setup cleanly
  -- rather than freezing the survivors in a dead phase.
  if v_connected < 2 then
    perform set_config('playhead.authorized_race_write', '1', true);
    if v_state <> 'LOBBY' then
      update public.race_rooms
      set state = 'LOBBY', start_at_ms = null, started_at = null
      where id = p_room_id;
    end if;
    update public.race_room_players
    set ready = false, loaded = false, in_game_ready = false, dnf = false
    where room_id = p_room_id and (ready or loaded or in_game_ready or dnf);
    perform set_config('playhead.authorized_race_write', '0', true);
    return;
  end if;

  -- COUNTDOWN CANCELLATION: a racer leaving / un-readying while IN_GAME or
  -- COUNTDOWN cancels the pending GO and returns to IN_GAME so the survivors can
  -- ready again. There is never a second concurrent countdown.
  if v_state = 'COUNTDOWN'
     and (v_ingame < v_connected or v_loaded < v_connected) then
    perform set_config('playhead.authorized_race_write', '1', true);
    if v_state = 'COUNTDOWN' then
      update public.race_rooms
      set state = 'IN_GAME', start_at_ms = null, started_at = null
      where id = p_room_id;
    end if;
    update public.race_room_players
    set in_game_ready = false
    where room_id = p_room_id and in_game_ready;
    perform set_config('playhead.authorized_race_write', '0', true);
    return;
  end if;

  -- READINESS PREDICATE: ALL connected racers must be ready / loaded, never
  -- merely a count of two. Never requires the room to be FULL.
  if v_state = 'LOBBY' and v_ready >= 2 and v_ready = v_connected then
    perform set_config('playhead.authorized_race_write', '1', true);
    update public.race_rooms set state = 'LOADING' where id = p_room_id;
    perform set_config('playhead.authorized_race_write', '0', true);

  elsif v_state = 'LOADING' and v_loaded >= 2 and v_loaded = v_connected then
    perform set_config('playhead.authorized_race_write', '1', true);
    update public.race_rooms set state = 'IN_GAME' where id = p_room_id;
    perform set_config('playhead.authorized_race_write', '0', true);

  elsif v_state = 'IN_GAME' and v_ingame >= 2 and v_ingame = v_connected then
    -- ONE authoritative GO. start_at_ms is forged HERE, server-side, so no
    -- client can choose the shared instant. Idempotent: the transition leaves
    -- IN_GAME, so a duplicate call is a no-op via the state checks above.
    perform set_config('playhead.authorized_race_write', '1', true);
    update public.race_rooms
    set state = 'COUNTDOWN',
        start_at_ms = public.race_server_now() + public.race_countdown_lead_ms(),
        started_at  = now() + (public.race_countdown_lead_ms() || ' milliseconds')::interval
    where id = p_room_id;
    perform set_config('playhead.authorized_race_write', '0', true);
  end if;
  v_remaining := v_connected - v_finishers;
  if v_remaining < 0 then v_remaining := 0; end if;
end;
$$;
grant execute on function public.race_room_advance(uuid) to authenticated;

create or replace function public.race_room_players_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('playhead.authorized_race_write', true) = '1' then return null; end if;
  perform public.race_room_advance(coalesce(new.room_id, old.room_id));
  return null;
end;
$$;

drop trigger if exists race_room_players_sync on public.race_room_players;
create trigger race_room_players_sync
  after insert or update or delete on public.race_room_players
  for each row execute function public.race_room_players_sync();

-- -----------------------------------------------------------------------------
-- 8. CLIENT-REPORTED TRANSITIONS (each player may only move THEMSELVES)
-- -----------------------------------------------------------------------------
create or replace function public.race_report_loaded(p_room_id uuid, p_loaded boolean)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_state text;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if not exists (
    select 1 from public.race_room_players where room_id = p_room_id and user_id = v_user
  ) then
    raise exception 'not a member of this room';
  end if;
  select state into v_state from public.race_rooms where id = p_room_id;
  if v_state is null then raise exception 'room not found'; end if;
  if v_state in ('COUNTDOWN','RUNNING','FINISHED','EXPIRED') then
    raise exception 'too late to report loaded';
  end if;
  update public.race_room_players
  set loaded = coalesce(p_loaded, true), last_seen_at = now()
  where room_id = p_room_id and user_id = v_user;
end;
$$;
grant execute on function public.race_report_loaded(uuid, boolean) to authenticated;

create or replace function public.race_set_in_game_ready(p_room_id uuid, p_ready boolean)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_state text;
  v_loaded boolean;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if not exists (
    select 1 from public.race_room_players where room_id = p_room_id and user_id = v_user
  ) then
    raise exception 'not a member of this room';
  end if;
  select state into v_state from public.race_rooms where id = p_room_id;
  if v_state is null then raise exception 'room not found'; end if;
  if v_state in ('COUNTDOWN','RUNNING','FINISHED','EXPIRED') then
    raise exception 'too late to change in-game ready';
  end if;
  select loaded into v_loaded from public.race_room_players
  where room_id = p_room_id and user_id = v_user;
  if coalesce(p_ready, false) and not coalesce(v_loaded, false) then
    raise exception 'cannot mark in-game ready before reporting loaded';
  end if;
  update public.race_room_players
  set in_game_ready = coalesce(p_ready, false), last_seen_at = now()
  where room_id = p_room_id and user_id = v_user;
end;
$$;
grant execute on function public.race_set_in_game_ready(uuid, boolean) to authenticated;

-- A client that actually reaches GO marks the race live. Idempotent; only flips
-- COUNTDOWN -> RUNNING once the authoritative start instant has passed.
create or replace function public.race_mark_running(p_room_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if not exists (
    select 1 from public.race_room_players where room_id = p_room_id and user_id = v_user
  ) then
    raise exception 'not a member of this room';
  end if;
  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_rooms
  set state = 'RUNNING'
  where id = p_room_id
    and state = 'COUNTDOWN'
    and start_at_ms is not null
    and (extract(epoch from now()) * 1000)::bigint >= start_at_ms;
  perform set_config('playhead.authorized_race_write', '0', true);
end;
$$;
grant execute on function public.race_mark_running(uuid) to authenticated;

-- FINISH: the SERVER derives the elapsed from the shared start epoch. The
-- client value is a fallback only, so a client can never declare its own time
-- or winner. IDEMPOTENT: a repeated report against the same frozen time is a
-- no-op, so a duplicate packet cannot reorder results or duplicate a finish.
create or replace function public.race_report_finish(p_room_id uuid, p_progress integer default null)
returns public.race_room_players
language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_row   public.race_room_players;
  v_state text;
  v_start bigint;
  v_epoch_us bigint;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select state, start_at_ms into v_state, v_start
  from public.race_rooms where id = p_room_id;
  if v_state is null then raise exception 'room not found'; end if;
  if v_state <> 'RUNNING' or v_start is null then
    raise exception 'no authoritative running timeline to report against';
  end if;

  v_epoch_us := ((extract(epoch from now()) * 1000)::bigint - v_start) * 1000;
  if v_epoch_us <= 0 then raise exception 'race timeline has not started'; end if;

  select * into v_row from public.race_room_players
  where room_id = p_room_id and user_id = v_user
  for update;
  if v_row.user_id is null then raise exception 'not a member of this room'; end if;

  -- IMMUTABLE + IDEMPOTENT: once a finish time is frozen it never changes, and
  -- a repeated packet is dropped entirely.
  if v_row.finish_us is not null then
    return v_row;
  end if;

  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players
  set finish_us = v_epoch_us,
      finished = true,
      connected = true,
      progress = greatest(progress, coalesce(p_progress, progress)),
      last_seen_at = now()
  where room_id = p_room_id and user_id = v_user
  returning * into v_row;
  perform set_config('playhead.authorized_race_write', '0', true);

  return v_row;
end;
$$;
grant execute on function public.race_report_finish(uuid, integer) to authenticated;

-- DNF: an explicit abandon while RUNNING. Freezes a DNF flag; the race goes on.
create or replace function public.race_report_dnf(p_room_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_state text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select state into v_state from public.race_rooms where id = p_room_id;
  if v_state is null then raise exception 'room not found'; end if;
  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players
  set dnf = true, connected = false, last_seen_at = now()
  where room_id = p_room_id and user_id = auth.uid()
    and v_state in ('RUNNING','FINISHED');
  perform set_config('playhead.authorized_race_write', '0', true);
end;
$$;
grant execute on function public.race_report_dnf(uuid) to authenticated;

-- Checkpoint progress: presentation/placement only. Never a scoring input.
create or replace function public.race_report_progress(p_room_id uuid, p_checkpoint integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update public.race_room_players
  set progress = greatest(progress, coalesce(p_checkpoint, 0)), last_seen_at = now()
  where room_id = p_room_id and user_id = auth.uid();
end;
$$;
grant execute on function public.race_report_progress(uuid, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. PRESENCE, HOST MIGRATION, DNF-ON-LEAVE
-- -----------------------------------------------------------------------------
create or replace function public.race_heartbeat(p_room_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.race_room_players
  set connected = true, last_seen_at = now()
  where room_id = p_room_id and user_id = auth.uid();
end;
$$;
grant execute on function public.race_heartbeat(uuid) to authenticated;

create or replace function public.race_mark_disconnected(p_room_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_state text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select state into v_state from public.race_rooms where id = p_room_id;
  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players
  set connected = false,
      ready = false, loaded = false, in_game_ready = false,
      dnf = (dnf or v_state = 'RUNNING'),
      last_seen_at = now()
  where room_id = p_room_id and user_id = auth.uid();
  perform set_config('playhead.authorized_race_write', '0', true);
  perform public.race_room_advance(p_room_id);
end;
$$;
grant execute on function public.race_mark_disconnected(uuid) to authenticated;

-- HOST MIGRATION: if the host is gone before the race locks, the longest-
-- standing connected member becomes host instead of destroying the room.
create or replace function public.race_maybe_migrate_host(p_room_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.race_rooms;
  v_host_ok boolean;
  v_new_host uuid;
begin
  select * into v_room from public.race_rooms where id = p_room_id for update;
  if v_room.id is null then return; end if;
  -- Never migrate once the race is live or finished: the setup is locked.
  if v_room.state in ('RUNNING','EXPIRED') then return; end if;

  select exists (
    select 1 from public.race_room_players
    where room_id = p_room_id and user_id = v_room.host_user_id and connected
  ) into v_host_ok;
  if v_host_ok then return; end if;

  select user_id into v_new_host from public.race_room_players
  where room_id = p_room_id and connected
  order by joined_at asc, user_id asc
  limit 1;
  if v_new_host is null then return; end if;

  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_rooms set host_user_id = v_new_host where id = p_room_id;
  perform set_config('playhead.authorized_race_write', '0', true);
end;
$$;
grant execute on function public.race_maybe_migrate_host(uuid) to authenticated;

create or replace function public.race_expire_stale_players(p_room_id uuid, p_grace_seconds integer default 20)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_room  public.race_rooms;
  v_grace integer;
  v_expired integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (
    select 1 from public.race_room_players where room_id = p_room_id and user_id = auth.uid()
  ) then
    raise exception 'not a member of this room';
  end if;
  v_grace := least(60, greatest(20, coalesce(p_grace_seconds, 20)));

  select * into v_room from public.race_rooms where id = p_room_id;

  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players
  set connected = false,
      ready = false, loaded = false, in_game_ready = false,
      dnf = (dnf or v_room.state = 'RUNNING')
  where room_id = p_room_id
    and connected
    and last_seen_at < now() - ((v_grace || ' seconds')::interval);
  get diagnostics v_expired = row_count;
  perform set_config('playhead.authorized_race_write', '0', true);

  perform public.race_maybe_migrate_host(p_room_id);
  perform public.race_room_advance(p_room_id);
  return v_expired;
end;
$$;
grant execute on function public.race_expire_stale_players(uuid, integer) to authenticated;

-- ABANDON: leave the race cleanly. While RUNNING this is a DNF and everybody
-- else keeps racing; before GO it removes the player and re-evaluates the room.
create or replace function public.race_abandon_session(p_room_id uuid, p_reason text default 'ABORTED')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_state text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select state into v_state from public.race_rooms where id = p_room_id;

  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players
  set connected = false, ready = false, loaded = false, in_game_ready = false,
      dnf = (dnf or v_state = 'RUNNING'),
      last_seen_at = now()
  where room_id = p_room_id and user_id = auth.uid();

  -- Before the race is live, return the room to LOBBY so the survivors are never
  -- stranded in a dead countdown. While RUNNING the room keeps going.
  if v_state in ('LOADING','IN_GAME','COUNTDOWN') then
    update public.race_rooms
    set state = 'LOBBY', start_at_ms = null, started_at = null
    where id = p_room_id;
  end if;
  perform set_config('playhead.authorized_race_write', '0', true);

  perform public.race_maybe_migrate_host(p_room_id);
  perform public.race_room_advance(p_room_id);
  if p_reason is null or p_reason = '' then
    null;
  end if;
end;
$$;
grant execute on function public.race_abandon_session(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 10. REMATCH — atomic: all remaining members, >=2, reuse the room
-- -----------------------------------------------------------------------------
create or replace function public.race_request_rematch(p_room_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user      uuid := auth.uid();
  v_state     text;
  v_connected int;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if not exists (
    select 1 from public.race_room_players where room_id = p_room_id and user_id = v_user
  ) then
    raise exception 'not a member of this room';
  end if;

  select state into v_state from public.race_rooms where id = p_room_id for update;
  if v_state is null then raise exception 'room not found'; end if;
  if v_state <> 'FINISHED' then
    raise exception 'race is not finished';
  end if;

  select count(*) into v_connected
  from public.race_room_players where room_id = p_room_id and connected;
  if v_connected < 2 then
    raise exception 'not enough players to rematch';
  end if;

  -- ALL connected members must be accounted for: the caller is one of them, and
  -- the reset below clears every remaining member. A player who left after the
  -- race is simply removed (see below), so >=2 remain.
  perform set_config('playhead.authorized_race_write', '1', true);

  -- Drop members who left / DNF'd: the rematch starts without them.
  delete from public.race_room_players
  where room_id = p_room_id and (not connected or dnf);

  update public.race_room_players
  set ready = false,
      loaded = false,
      in_game_ready = false,
      finish_us = null,
      finished = false,
      dnf = false,
      progress = 0,
      last_seen_at = now()
  where room_id = p_room_id;

  update public.race_rooms
  set state = 'LOBBY',
      start_at_ms = null,
      started_at = null,
      finished_at = null,
      -- NEW RACE INSTANCE: every stale packet/result from the previous race is
      -- now rejected by the client's raceId check.
      race_id = 'race-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
  where id = p_room_id;

  perform set_config('playhead.authorized_race_write', '0', true);
end;
$$;
grant execute on function public.race_request_rematch(uuid) to authenticated;

create or replace function public.expire_stale_race_rooms()
returns integer language sql security definer set search_path = public as $$
  with expired as (
    update public.race_rooms
    set state = 'EXPIRED'
    where state in ('LOBBY','LOADING','IN_GAME','COUNTDOWN','RUNNING','FINISHED')
      and expires_at < now()
    returning 1
  )
  select coalesce(count(*), 0)::integer from expired;
$$;
grant execute on function public.expire_stale_race_rooms() to authenticated;

-- -----------------------------------------------------------------------------
-- 11. REALTIME
-- -----------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.race_room_players;
  exception when duplicate_object then null; when undefined_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.race_rooms;
  exception when duplicate_object then null; when undefined_object then null;
  end;
end $$;

-- =============================================================================
-- 12. ONLINE RACE 2.0 — RACE-INSTANCE-LOCKED v2 RPCs
-- =============================================================================
-- EVERY mutating race RPC now carries p_race_id and verifies it against the
-- locked room before it touches anything. A v2 function locks the ROOM first,
-- then the PLAYER, so it can never deadlock against another v2 function.
--
-- These are DISTINCT names from the retired v1 RPCs so PostgREST can never
-- resolve an ambiguous overload to an unprotected definition. The retired v1
-- overloads are REVOKED below so no authenticated client can bypass v2.
-- =============================================================================

-- -- LOBBY READY (atomic, race-instance locked) --------------------------------
create or replace function public.race_set_ready_v2(
  p_room_id uuid, p_race_id text, p_ready boolean
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_room  public.race_rooms;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_room from public.race_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'room not found'; end if;
  if v_room.race_id is distinct from p_race_id then raise exception 'stale race instance'; end if;
  if v_room.state <> 'LOBBY' then raise exception 'ready window is closed'; end if;
  if not exists (
    select 1 from public.race_room_players
    where room_id = p_room_id and user_id = v_user
  ) then raise exception 'not a member of this room'; end if;

  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players
  set ready = coalesce(p_ready, false), last_seen_at = now()
  where room_id = p_room_id and user_id = v_user;
  perform set_config('playhead.authorized_race_write', '0', true);
  perform public.race_room_advance(p_room_id);
end;
$$;
grant execute on function public.race_set_ready_v2(uuid, text, boolean) to authenticated;

-- -- CLIENT_LOADED ------------------------------------------------------------
create or replace function public.race_report_loaded_v2(
  p_room_id uuid, p_race_id text, p_loaded boolean
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_room  public.race_rooms;
  v_row   public.race_room_players;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_room from public.race_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'room not found'; end if;
  if v_room.race_id is distinct from p_race_id then raise exception 'stale race instance'; end if;
  if v_room.state in ('COUNTDOWN','RUNNING','FINISHED','EXPIRED') then
    raise exception 'too late to report loaded';
  end if;
  select * into v_row from public.race_room_players
  where room_id = p_room_id and user_id = v_user for update;
  if v_row.user_id is null then raise exception 'not a member of this room'; end if;
  if v_row.dnf then raise exception 'a DNF racer cannot report loaded'; end if;

  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players
  set loaded = coalesce(p_loaded, true), last_seen_at = now()
  where room_id = p_room_id and user_id = v_user;
  perform set_config('playhead.authorized_race_write', '0', true);
  perform public.race_room_advance(p_room_id);
end;
$$;
grant execute on function public.race_report_loaded_v2(uuid, text, boolean) to authenticated;

-- -- IN-GAME READY ------------------------------------------------------------
create or replace function public.race_set_in_game_ready_v2(
  p_room_id uuid, p_race_id text, p_ready boolean
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_room  public.race_rooms;
  v_row   public.race_room_players;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_room from public.race_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'room not found'; end if;
  if v_room.race_id is distinct from p_race_id then raise exception 'stale race instance'; end if;
  if v_room.state in ('COUNTDOWN','RUNNING','FINISHED','EXPIRED') then
    raise exception 'too late to change in-game ready';
  end if;
  select * into v_row from public.race_room_players
  where room_id = p_room_id and user_id = v_user for update;
  if v_row.user_id is null then raise exception 'not a member of this room'; end if;
  if coalesce(p_ready, false) and not coalesce(v_row.loaded, false) then
    raise exception 'cannot mark in-game ready before reporting loaded';
  end if;
  if v_row.dnf then raise exception 'a DNF racer cannot ready up'; end if;

  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players
  set in_game_ready = coalesce(p_ready, false), last_seen_at = now()
  where room_id = p_room_id and user_id = v_user;
  perform set_config('playhead.authorized_race_write', '0', true);
  perform public.race_room_advance(p_room_id);
end;
$$;
grant execute on function public.race_set_in_game_ready_v2(uuid, text, boolean) to authenticated;

-- -- MARK RUNNING (COUNTDOWN -> RUNNING after the authoritative instant) -------
create or replace function public.race_mark_running_v2(p_room_id uuid, p_race_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_room public.race_rooms;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_room from public.race_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'room not found'; end if;
  if v_room.race_id is distinct from p_race_id then raise exception 'stale race instance'; end if;
  if not exists (
    select 1 from public.race_room_players
    where room_id = p_room_id and user_id = v_user and connected and not dnf
  ) then raise exception 'not an active member of this room'; end if;

  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_rooms
  set state = 'RUNNING'
  where id = p_room_id
    and state = 'COUNTDOWN'
    and start_at_ms is not null
    and (extract(epoch from now()) * 1000)::bigint >= start_at_ms;
  perform set_config('playhead.authorized_race_write', '0', true);
end;
$$;
grant execute on function public.race_mark_running_v2(uuid, text) to authenticated;

-- -- FINISH (server-derived elapsed, immutable, rejects DNF/disconnected) -----
create or replace function public.race_report_finish_v2(
  p_room_id uuid, p_race_id text, p_progress integer default null
)
returns public.race_room_players
language plpgsql security definer set search_path = public as $$
declare
  v_user      uuid := auth.uid();
  v_room      public.race_rooms;
  v_row       public.race_room_players;
  v_epoch_us  bigint;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  -- ROOM FIRST, then PLAYER: consistent lock order across every v2 function.
  select * into v_room from public.race_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'room not found'; end if;
  if v_room.race_id is distinct from p_race_id then raise exception 'stale race instance'; end if;
  if v_room.state <> 'RUNNING' or v_room.start_at_ms is null then
    raise exception 'no authoritative running timeline to report against';
  end if;

  v_epoch_us := ((extract(epoch from now()) * 1000)::bigint - v_room.start_at_ms) * 1000;
  if v_epoch_us <= 0 then raise exception 'race timeline has not started'; end if;

  select * into v_row from public.race_room_players
  where room_id = p_room_id and user_id = v_user for update;
  if v_row.user_id is null then raise exception 'not a member of this room'; end if;
  if v_row.dnf or not v_row.connected then
    raise exception 'a disconnected or DNF racer cannot finish';
  end if;
  -- IMMUTABLE + IDEMPOTENT: once frozen, a finish time never changes and a
  -- duplicate packet is dropped entirely.
  if v_row.finish_us is not null then return v_row; end if;

  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players
  set finish_us = v_epoch_us,
      finished = true,
      connected = true,
      progress = greatest(progress, coalesce(p_progress, progress)),
      last_seen_at = now()
  where room_id = p_room_id and user_id = v_user
  returning * into v_row;
  perform set_config('playhead.authorized_race_write', '0', true);

  perform public.race_room_advance(p_room_id);
  return v_row;
end;
$$;
grant execute on function public.race_report_finish_v2(uuid, text, integer) to authenticated;

-- -- PROGRESS (checkpoint placement only; never a scoring input) --------------
create or replace function public.race_report_progress_v2(
  p_room_id uuid, p_race_id text, p_checkpoint integer, p_total integer default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_room public.race_rooms;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_room from public.race_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'room not found'; end if;
  if v_room.race_id is distinct from p_race_id then raise exception 'stale race instance'; end if;
  if v_room.state <> 'RUNNING' then raise exception 'progress is RUNNING-only'; end if;
  if not exists (
    select 1 from public.race_room_players
    where room_id = p_room_id and user_id = v_user and connected and not dnf
  ) then raise exception 'not an active member of this room'; end if;

  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players
  set progress = greatest(progress, coalesce(p_checkpoint, 0)),
      checkpoint_total = greatest(checkpoint_total, coalesce(p_total, 0)),
      last_seen_at = now()
  where room_id = p_room_id and user_id = v_user and finish_us is null;
  perform set_config('playhead.authorized_race_write', '0', true);
end;
$$;
grant execute on function public.race_report_progress_v2(uuid, text, integer, integer) to authenticated;

-- -- DNF ---------------------------------------------------------------------
create or replace function public.race_report_dnf_v2(p_room_id uuid, p_race_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_room public.race_rooms;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_room from public.race_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'room not found'; end if;
  if v_room.race_id is distinct from p_race_id then raise exception 'stale race instance'; end if;

  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players
  set dnf = true, connected = false, last_seen_at = now()
  where room_id = p_room_id and user_id = v_user
    and v_room.state in ('RUNNING','FINISHED')
    and finish_us is null;
  perform set_config('playhead.authorized_race_write', '0', true);
  perform public.race_room_advance(p_room_id);
end;
$$;
grant execute on function public.race_report_dnf_v2(uuid, text) to authenticated;

-- -- HEARTBEAT (never revives a disconnected / DNF racer mid-race) ------------
create or replace function public.race_heartbeat_v2(p_room_id uuid, p_race_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.race_rooms;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_room from public.race_rooms where id = p_room_id for update;
  if v_room.race_id is null then raise exception 'room not found'; end if;
  if v_room.race_id is distinct from p_race_id then raise exception 'stale race instance'; end if;

  perform set_config('playhead.authorized_race_write', '1', true);
  -- Mid-race a heartbeat only refreshes last_seen_at for a LIVE racer; it may
  -- never flip connected back on, nor clear DNF.
  if v_room.state in ('RUNNING','FINISHED') then
    update public.race_room_players
    set last_seen_at = now()
    where room_id = p_room_id and user_id = auth.uid() and connected and not dnf;
  else
    update public.race_room_players
    set last_seen_at = now()
    where room_id = p_room_id and user_id = auth.uid() and not dnf;
  end if;
  perform set_config('playhead.authorized_race_write', '0', true);
  perform public.race_room_advance(p_room_id);
end;
$$;
grant execute on function public.race_heartbeat_v2(uuid, text) to authenticated;

-- -- MARK DISCONNECTED -------------------------------------------------------
create or replace function public.race_cancel_staging(p_room_id uuid, p_state text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_state='LOADING' then
    update public.race_rooms set state='LOBBY', start_at_ms=null, started_at=null where id=p_room_id;
    update public.race_room_players set ready=false,loaded=false,in_game_ready=false where room_id=p_room_id;
  elsif p_state in ('IN_GAME','COUNTDOWN') then
    update public.race_rooms set state='IN_GAME',start_at_ms=null,started_at=null where id=p_room_id;
    update public.race_room_players set in_game_ready=false where room_id=p_room_id;
  end if;
end;
$$;
create or replace function public.race_mark_disconnected_v2(p_room_id uuid, p_race_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_room public.race_rooms;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_room from public.race_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'room not found'; end if;
  if v_room.race_id is distinct from p_race_id then raise exception 'stale race instance'; end if;

  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players
  set connected = false,
      ready = false, loaded = false, in_game_ready = false,
      dnf = (dnf or (v_room.state = 'RUNNING' and finish_us is null)),
      last_seen_at = now()
  where room_id = p_room_id and user_id = v_user;
  perform public.race_cancel_staging(p_room_id, v_room.state);
  perform set_config('playhead.authorized_race_write', '0', true);
  perform public.race_maybe_migrate_host(p_room_id);
  perform public.race_room_advance(p_room_id);
end;
$$;
grant execute on function public.race_mark_disconnected_v2(uuid, text) to authenticated;

-- -- EXPIRE STALE PLAYERS (honest LOADING abort / RUNNING DNF) ----------------
create or replace function public.race_expire_stale_players_v2(
  p_room_id uuid, p_race_id text, p_grace_seconds integer default 20
)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_room  public.race_rooms;
  v_grace integer;
  v_expired integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_room from public.race_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'room not found'; end if;
  if v_room.race_id is distinct from p_race_id then raise exception 'stale race instance'; end if;
  if not exists (
    select 1 from public.race_room_players where room_id = p_room_id and user_id = auth.uid()
  ) then raise exception 'not a member of this room'; end if;
  v_grace := least(60, greatest(20, coalesce(p_grace_seconds, 20)));

  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players
  set connected = false,
      ready = false, loaded = false, in_game_ready = false,
      dnf = (dnf or (v_room.state = 'RUNNING' and finish_us is null)),
      last_seen_at = now()
  where room_id = p_room_id
    and connected
    and last_seen_at < now() - ((v_grace || ' seconds')::interval);
  get diagnostics v_expired = row_count;
  if v_expired > 0 then perform public.race_cancel_staging(p_room_id, v_room.state); end if;
  perform set_config('playhead.authorized_race_write', '0', true);

  perform public.race_maybe_migrate_host(p_room_id);
  perform public.race_room_advance(p_room_id);
  return v_expired;
end;
$$;
grant execute on function public.race_expire_stale_players_v2(uuid, text, integer) to authenticated;

-- -- ABANDON SESSION ---------------------------------------------------------
create or replace function public.race_abandon_session_v2(
  p_room_id uuid, p_race_id text, p_reason text default 'ABORTED'
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_room public.race_rooms;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_room from public.race_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'room not found'; end if;
  if v_room.race_id is distinct from p_race_id then raise exception 'stale race instance'; end if;

  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players
  set connected = false, ready = false, loaded = false, in_game_ready = false,
      dnf = (dnf or (v_room.state = 'RUNNING' and finish_us is null)),
      last_seen_at = now()
  where room_id = p_room_id and user_id = v_user and finish_us is null;

  -- Before the race is live, return the room to LOBBY so the survivors are never
  -- stranded in a dead countdown. While RUNNING the room keeps going.
  if v_room.state in ('LOADING','IN_GAME','COUNTDOWN') then
    update public.race_rooms
    set state = 'LOBBY', start_at_ms = null, started_at = null
    where id = p_room_id;
  end if;
  perform set_config('playhead.authorized_race_write', '0', true);

  perform public.race_maybe_migrate_host(p_room_id);
  perform public.race_room_advance(p_room_id);
end;
$$;
grant execute on function public.race_abandon_session_v2(uuid, text, text) to authenticated;

-- -- REMATCH (reset remaining >=2, bump race_id BEFORE stale writes land) ------
create or replace function public.race_request_rematch_v2(p_room_id uuid, p_race_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user      uuid := auth.uid();
  v_room      public.race_rooms;
  v_connected int;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_room from public.race_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'room not found'; end if;
  if v_room.race_id is distinct from p_race_id then raise exception 'stale race instance'; end if;
  if v_room.state <> 'FINISHED' then raise exception 'race is not finished'; end if;
  if not exists (
    select 1 from public.race_room_players where room_id = p_room_id and user_id = v_user
  ) then raise exception 'not a member of this room'; end if;

  select count(*) into v_connected
  from public.race_room_players where room_id = p_room_id and connected;
  if v_connected < 2 then raise exception 'not enough players to rematch'; end if;

  perform set_config('playhead.authorized_race_write', '1', true);
  delete from public.race_room_players
  where room_id = p_room_id and (not connected or dnf);

  update public.race_room_players
  set ready = false,
      loaded = false,
      in_game_ready = false,
      finish_us = null,
      finished = false,
      dnf = false,
      progress = 0,
      checkpoint_total = 0,
      last_seen_at = now()
  where room_id = p_room_id;

  -- NEW RACE INSTANCE FIRST: every stale packet/write aimed at the old race_id
  -- is rejected the moment this commits.
  update public.race_rooms
  set state = 'LOBBY',
      start_at_ms = null,
      started_at = null,
      finished_at = null,
      race_id = 'race-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
  where id = p_room_id;

  perform set_config('playhead.authorized_race_write', '0', true);
end;
$$;
grant execute on function public.race_request_rematch_v2(uuid, text) to authenticated;

-- Retired RPCs cannot bypass the race-instance checks.
revoke execute on function public.race_report_finish(uuid, bigint) from public, anon, authenticated;
revoke execute on function public.race_report_attempt_start(uuid, integer) from public, anon, authenticated;
do $$
declare f record;
begin
  for f in select oid, proname from pg_proc where pronamespace='public'::regnamespace and proname like 'race_%' loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.oid::regprocedure);
    if f.proname like '%_v2' or f.proname in ('race_join_room','race_server_now') then
      execute format('grant execute on function %s to authenticated',f.oid::regprocedure);
    end if;
  end loop;
end;
$$;
revoke execute on function public.expire_stale_race_rooms() from public, anon, authenticated;
