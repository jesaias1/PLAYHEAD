-- =============================================================================
-- ONLINE RACE — AUTHORITATIVE STATE MACHINE
-- =============================================================================
--
-- ROOT CAUSES this migration fixes:
--   1. Lobby READY never auto-launched the race. The only start path was a
--      HOST-ONLY `startSession` RPC behind a manual START SESSION button, so
--      both players could be READY and still sit in the lobby — and the losing
--      client still had to click EXEC SONG.
--   2. There was no "both clients actually loaded" phase, so a countdown could
--      start before a slower client was inside the level, and the two clients
--      entered at different wall-clock moments.
--   3. There was no SECOND in-game READY, so nobody confirmed they were spawned,
--      visible and ready.
--
-- DESIGN: ONE authoritative room state, advanced by a DATABASE TRIGGER, so it is
-- impossible for the two clients to disagree and no client can self-declare the
-- race started. States:
--
--   LOBBY     -> both connected players have pressed lobby READY
--   LOADING   -> locked; BOTH clients auto-load the selected track (no EXEC SONG)
--   IN_GAME   -> both clients report CLIENT_LOADED (spawned, remote visible)
--   COUNTDOWN -> both press in-game READY; start_at_ms is the shared GO instant
--   RUNNING   -> the race timeline is live (derived from start_at_ms)
--   FINISHED / EXPIRED
--
-- A disconnect before RUNNING reverts the room to LOBBY so the remaining player
-- is never frozen; the UI reports the abort.
--
-- Apply with:  supabase db push
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Player load / in-game-ready flags
-- -----------------------------------------------------------------------------
alter table public.race_room_players
  add column if not exists loaded boolean not null default false;
alter table public.race_room_players
  add column if not exists in_game_ready boolean not null default false;

-- -----------------------------------------------------------------------------
-- 2. Room states
--    The original CHECK only allowed LOBBY/COUNTDOWN/RUNNING/FINISHED/EXPIRED.
--    LOADING and IN_GAME are new authoritative states.
-- -----------------------------------------------------------------------------
alter table public.race_rooms drop constraint if exists race_state_valid;
alter table public.race_rooms
  add constraint race_state_valid
  check (state in ('LOBBY','LOADING','IN_GAME','COUNTDOWN','RUNNING','FINISHED','EXPIRED'));

-- The countdown lead is a server constant so every client derives GO from the
-- SAME timestamp. 3800 ms matches COUNTDOWN_LEAD_MS on the client.
create or replace function public.race_countdown_lead_ms()
returns bigint language sql immutable as $$ select 3800::bigint $$;

-- AUTHORITATIVE CLOCK. Clients correct their local Date.now() against this so
-- the shared countdown, session remaining, run timer, song position and results
-- all derive from ONE timeline, immune to local clock drift or late delivery.
create or replace function public.race_server_now()
returns bigint language sql stable as $$ select (extract(epoch from now()) * 1000)::bigint $$;
grant execute on function public.race_server_now() to authenticated;

-- -----------------------------------------------------------------------------
-- 3. The ONE state-advance function (SECURITY DEFINER, server-authoritative)
-- -----------------------------------------------------------------------------
create or replace function public.race_room_players_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room      uuid := coalesce(new.room_id, old.room_id);
  v_state     text;
  v_connected int;
  v_ready     int;
  v_loaded    int;
  v_ingame    int;
begin
  select state into v_state from public.race_rooms where id = v_room for update;
  if v_state is null then return null; end if;
  if v_state in ('FINISHED','EXPIRED','RUNNING') then return null; end if;

  select
    count(*) filter (where connected),
    count(*) filter (where connected and ready),
    count(*) filter (where connected and loaded),
    count(*) filter (where connected and in_game_ready)
  into v_connected, v_ready, v_loaded, v_ingame
  from public.race_room_players
  where room_id = v_room;

  -- Not enough players (left / disconnected): abort the pre-race setup cleanly
  -- rather than freezing the remaining client in a broken race state.
  if v_connected < 2 then
    -- The machine itself is the only writer authorised to move the room here.
    perform set_config('playhead.authorized_race_write', '1', true);
    if v_state <> 'LOBBY' then
      update public.race_rooms
      set state = 'LOBBY', start_at_ms = null, started_at = null
      where id = v_room;
    end if;
    -- STALE READY FLAGS: clear load/ready state for the room so an aborted or
    -- reloaded client cannot carry a stale READY into the next attempt. Guarded
    -- on the columns so the re-entrant trigger call is a true no-op.
    update public.race_room_players
    set loaded = false, in_game_ready = false
    where room_id = v_room and (loaded or in_game_ready);
    perform set_config('playhead.authorized_race_write', '0', true);
    return null;
  end if;

  -- READINESS PREDICATE: ALL connected session players must be ready/loaded,
  -- not merely a count of two. A disconnected opponent is handled above.
  if v_state = 'LOBBY' and v_ready >= 2 and v_ready = v_connected then
    perform set_config('playhead.authorized_race_write', '1', true);
    update public.race_rooms set state = 'LOADING' where id = v_room;
    perform set_config('playhead.authorized_race_write', '0', true);
  elsif v_state = 'LOADING' and v_loaded >= 2 and v_loaded = v_connected then
    perform set_config('playhead.authorized_race_write', '1', true);
    update public.race_rooms set state = 'IN_GAME' where id = v_room;
    perform set_config('playhead.authorized_race_write', '0', true);
  elsif v_state = 'IN_GAME' and v_ingame >= 2 and v_ingame = v_connected then
    -- GATE: a player re-pressing READY after already loading must not restart the
    -- countdown; COUNTDOWN is only entered from IN_GAME. start_at_ms is forged
    -- HERE, server-side, so no client can choose the shared GO instant.
    perform set_config('playhead.authorized_race_write', '1', true);
    update public.race_rooms
    set state = 'COUNTDOWN',
        start_at_ms = public.race_server_now() + public.race_countdown_lead_ms(),
        started_at  = now() + (public.race_countdown_lead_ms() || ' milliseconds')::interval
    where id = v_room;
    perform set_config('playhead.authorized_race_write', '0', true);
  end if;

  return null;
end;
$$;

drop trigger if exists race_room_players_sync on public.race_room_players;
create trigger race_room_players_sync
  after insert or update or delete on public.race_room_players
  for each row execute function public.race_room_players_sync();

-- -----------------------------------------------------------------------------
-- 3b. Client writes to race_rooms are locked down.
--
-- RLS already limits race_rooms UPDATE to the host, but that still let a host
-- choose the phase or forge start_at_ms. This guard makes state and start_at_ms
-- SERVER-AUTHORITATIVE: only the SECURITY DEFINER machine (which sets the
-- transaction-local flag) may write them. The one client-permitted transition
-- is a host closing the room to FINISHED after the race.
-- -----------------------------------------------------------------------------
create or replace function public.race_rooms_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('playhead.authorized_race_write', true) = '1' then
    return new;
  end if;

  if new.start_at_ms is distinct from old.start_at_ms then
    raise exception 'start_at_ms is server-authoritative';
  end if;

  if new.state is distinct from old.state then
    if not (auth.uid() = old.host_user_id and new.state = 'FINISHED') then
      raise exception 'race state is server-authoritative';
    end if;
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
  before update on public.race_rooms
  for each row execute function public.race_rooms_guard();

-- -----------------------------------------------------------------------------
-- 4. Client-reported phase transitions (each player may only move THEMSELVES)
--    RLS already restricts every write to auth.uid() = user_id, so a client can
--    never mark the opponent loaded/ready.
-- -----------------------------------------------------------------------------
create or replace function public.race_report_loaded(p_room_id uuid, p_loaded boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_state text;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  -- MEMBERSHIP: only a player actually in the room may report.
  if not exists (
    select 1 from public.race_room_players where room_id = p_room_id and user_id = v_user
  ) then
    raise exception 'not a member of this room';
  end if;
  select state into v_state from public.race_rooms where id = p_room_id;
  if v_state is null then raise exception 'room not found'; end if;
  -- PHASE: loading may only be reported before the race goes live.
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
returns void
language plpgsql security definer set search_path = public
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
    raise exception 'too late to change in-game ready';
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
begin
  update public.race_rooms
  set state = 'RUNNING'
  where id = p_room_id
    and state = 'COUNTDOWN'
    and start_at_ms is not null
    and (extract(epoch from now()) * 1000)::bigint >= start_at_ms;
end;
$$;
grant execute on function public.race_mark_running(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Realtime: publish the new columns (replica identity already FULL)
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