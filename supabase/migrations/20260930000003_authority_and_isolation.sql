-- =============================================================================
-- AUTHORITY + ACCOUNT ISOLATION + ATOMIC WORLD RECORDS
-- =============================================================================
-- Apply with:  supabase db push
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. PRE-MIGRATION OWNERSHIP SNAPSHOT (historical BLACKSTAR exception)
-- -----------------------------------------------------------------------------
create table if not exists public.pre_migration_cosmetic_snapshot (
  user_id      uuid not null references auth.users(id) on delete cascade,
  cosmetic_id  text not null,
  snapshot_at  timestamptz not null default now(),
  primary key (user_id, cosmetic_id)
);

alter table public.pre_migration_cosmetic_snapshot enable row level security;
-- No policies: server-only. Read by the reserved-reward guards below.

insert into public.pre_migration_cosmetic_snapshot (user_id, cosmetic_id)
select user_id, cosmetic_id from public.cosmetic_ownership
on conflict do nothing;

insert into public.pre_migration_cosmetic_snapshot (user_id, cosmetic_id)
select pp.user_id, c
from public.player_progress pp, unnest(coalesce(pp.reward_owned_skin_ids, '{}')) as c
where c <> ''
on conflict do nothing;

-- The reserved set. New grants for these ids may ONLY come from the server.
create or replace function public.is_reserved_cosmetic(p_cosmetic_id text)
returns boolean language sql immutable as $$
  select upper(coalesce(p_cosmetic_id, '')) in ('BLACKSTAR')
      or coalesce(p_cosmetic_id, '') like 'WR:%'
$$;
grant execute on function public.is_reserved_cosmetic(text) to anon, authenticated;

create or replace function public.has_historical_reserved_ownership(p_user_id uuid, p_cosmetic_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.pre_migration_cosmetic_snapshot
    where user_id = p_user_id and cosmetic_id = p_cosmetic_id
  )
$$;
grant execute on function public.has_historical_reserved_ownership(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. RESERVED REWARD GUARDS
--    A browser cannot INSERT a reserved cosmetic or a WORLD_RECORD provenance,
--    and cannot ADD a reserved id to player_progress.reward_owned_skin_ids.
--    Legitimate HISTORICAL ownership (snapshot) is always preserved.
-- -----------------------------------------------------------------------------
create or replace function public.cosmetic_ownership_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('playhead.authorized_cosmetic_write', true) = '1' then return new; end if;
  if auth.uid() is null then return new; end if;   -- service-role context
  if upper(coalesce(new.unlock_source, '')) = 'WORLD_RECORD' then
    raise exception 'WORLD_RECORD provenance is server-authoritative';
  end if;
  if public.is_reserved_cosmetic(new.cosmetic_id) then
    -- Legitimate HISTORICAL ownership (pre-migration snapshot) is always kept.
    if public.has_historical_reserved_ownership(new.user_id, new.cosmetic_id) then
      return new;
    end if;
    -- RE-INSERT of an award row this account ALREADY owns is an idempotent
    -- replay of a legitimate server grant (the WR ledger proves it), never a
    -- fresh client-owned flag.
    if exists (
      select 1 from public.player_world_records w
      where w.user_id = new.user_id and w.cosmetic_id = new.cosmetic_id
    ) then
      return new;
    end if;
    raise exception 'cosmetic "%" is a reserved reward and cannot be granted directly', new.cosmetic_id;
  end if;
  return new;
end;
$$;

drop trigger if exists cosmetic_ownership_guard on public.cosmetic_ownership;
create trigger cosmetic_ownership_guard
  before insert on public.cosmetic_ownership
  for each row execute function public.cosmetic_ownership_guard();

create or replace function public.player_progress_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_new_reserved text;
begin
  if current_setting('playhead.authorized_progress_write', true) = '1' then return new; end if;
  if auth.uid() is null then return new; end if;

  -- Only the DIFFERENCE matters: pre-existing legitimate ownership stays valid.
  for v_new_reserved in
    select c from unnest(coalesce(new.reward_owned_skin_ids, '{}')) as c
    where public.is_reserved_cosmetic(c)
      and not exists (
        select 1 from unnest(
          case when tg_op = 'UPDATE' then coalesce(old.reward_owned_skin_ids, '{}') else '{}'::text[] end
        ) as o where o = c
      )
  loop
    if not public.has_historical_reserved_ownership(new.user_id, v_new_reserved) then
      raise exception 'reserved reward "%" cannot be written directly', v_new_reserved;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists player_progress_guard on public.player_progress;
create trigger player_progress_guard
  before insert or update on public.player_progress
  for each row execute function public.player_progress_guard();

-- -----------------------------------------------------------------------------
-- 3. PROFILE DISPLAY NAME AUTHORITY
--    Registered accounts own their username: profiles.display_name is no longer
--    freely editable by the authenticated user. Guest (anonymous) renaming is
--    unaffected. The service role and account-auth still write it.
-- -----------------------------------------------------------------------------
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;                 -- service role
  if new.display_name is not distinct from old.display_name then return new; end if;
  if exists (select 1 from public.accounts a where a.user_id = old.id) then
    raise exception 'registered usernames are server-authoritative';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard();

-- -----------------------------------------------------------------------------
-- 4. SERVER-AUTHORITATIVE LEADERBOARD ACCEPT + ATOMIC WORLD RECORD + PB
--    SERVICE-ROLE ONLY. Never granted to anon/authenticated. The whole operation
--    is serialized on a per-board advisory lock, so two near-simultaneous runs
--    cannot both be declared a world record.
-- -----------------------------------------------------------------------------
create or replace function public.accept_leaderboard_run(
  p_user_id          uuid,
  p_display_name     text,
  p_track_id         text,
  p_map_version      integer,
  p_map_fingerprint  text,
  p_time_us          bigint,
  p_rank             text,
  p_movement_version text,
  p_generator_version text,
  p_build_version    text,
  p_replay_version   integer,
  p_replay_hash      text,
  p_replay_path      text,
  p_checkpoint_count integer,
  p_reset_count      integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canonical text := p_track_id || ':' || p_map_version::text || ':' || p_map_fingerprint;
  v_run_id    uuid;
  v_prev_best bigint;
  v_is_wr     boolean := false;
  v_award_id  text := null;
  v_is_pb     boolean := false;
  v_prog      public.track_progress;
  v_registered boolean;
begin
  if p_user_id is null then raise exception 'accept_leaderboard_run requires a user id'; end if;
  if p_time_us is null or p_time_us <= 0 then raise exception 'invalid time'; end if;

  -- SERIALIZE every insertion on this board. A concurrent run cannot interleave
  -- its "is this the fastest?" read with our insert.
  perform pg_advisory_xact_lock(hashtextextended(v_canonical, 0));

  insert into public.leaderboard_runs (
    user_id, display_name, track_id, map_version, map_fingerprint, time_us, rank,
    movement_version, generator_version, build_version,
    replay_version, replay_hash, replay_path, checkpoint_count, reset_count,
    verification_state
  ) values (
    p_user_id, coalesce(p_display_name, 'PLAYER'), p_track_id, p_map_version, p_map_fingerprint, p_time_us, p_rank,
    p_movement_version, p_generator_version, coalesce(p_build_version, 'DEV'),
    p_replay_version, p_replay_hash, p_replay_path, coalesce(p_checkpoint_count, 0), coalesce(p_reset_count, 0),
    'accepted'
  )
  returning id into v_run_id;

  -- STRICT NEW BEST over ALREADY-ACCEPTED, RANKED rows on the same board.
  select min(time_us) into v_prev_best
  from public.leaderboard_runs
  where track_id = p_track_id
    and map_version = p_map_version
    and map_fingerprint = p_map_fingerprint
    and verification_state = 'accepted'
    and rank <> 'UNRANKED'
    and id <> v_run_id;

  select exists(select 1 from public.accounts a where a.user_id = p_user_id) into v_registered;

  if p_rank <> 'UNRANKED'
     and v_registered
     and (v_prev_best is null or p_time_us < v_prev_best) then
    v_is_wr := true;
    v_award_id := 'wr:' || p_track_id || ':' || p_map_fingerprint;
    -- ONE award row per (account, board). The prestige COSMETIC is granted at
    -- most once per account at claim time (ownership PK), not once per board.
    insert into public.player_world_records (user_id, award_id, track_id, run_id, cosmetic_id)
    values (p_user_id, v_award_id, p_track_id, v_run_id, 'BLACKSTAR')
    on conflict (user_id, award_id) do nothing;
  end if;

  -- ATOMIC PB: the database decides; lower time wins. Called in service context
  -- with an explicit user id, so it works for the Edge Function (no auth.uid()).
  perform set_config('playhead.authorized_progress_write', '1', true);
  insert into public.track_progress (
    user_id, track_id, map_version, map_fingerprint, best_time_us, best_rank, updated_at
  ) values (
    p_user_id, p_track_id, p_map_version, p_map_fingerprint, p_time_us, p_rank, now()
  )
  on conflict (user_id, track_id, map_version, map_fingerprint) do update
    set best_time_us = least(public.track_progress.best_time_us, excluded.best_time_us),
        best_rank = case
          when public.track_progress.best_time_us is null
            or excluded.best_time_us < public.track_progress.best_time_us
            then excluded.best_rank
          else public.track_progress.best_rank
        end,
        updated_at = now()
  returning * into v_prog;
  perform set_config('playhead.authorized_progress_write', '0', true);

  v_is_pb := v_prog.best_time_us is not null and v_prog.best_time_us = p_time_us;

  return jsonb_build_object(
    'run_id', v_run_id,
    'is_world_record', v_is_wr,
    'world_record_award_id', v_award_id,
    'is_personal_best', v_is_pb
  );
end;
$$;

-- LOCKDOWN: only the service role (which bypasses grants via its role) may call.
revoke all on function public.accept_leaderboard_run(uuid, text, text, integer, text, bigint, text, text, text, text, integer, text, text, integer, integer) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. CLAIM must pass the reserved-reward guards (it legitimately grants BLACKSTAR)
-- -----------------------------------------------------------------------------
create or replace function public.claim_world_record_award(p_award_id text)
returns table (cosmetic_id text, granted boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_user     uuid := auth.uid();
  v_row      public.player_world_records;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_award_id is null or p_award_id = '' then raise exception 'award id required'; end if;

  select * into v_row
  from public.player_world_records
  where user_id = v_user and award_id = p_award_id
  for update;

  if v_row.award_id is null then
    raise exception 'no world record award for this account';
  end if;

  if v_row.claimed then
    return query select v_row.cosmetic_id, false;
    return;
  end if;

  -- This is the ONLY authenticated path allowed to grant a reserved reward.
  perform set_config('playhead.authorized_cosmetic_write', '1', true);
  perform set_config('playhead.authorized_progress_write', '1', true);

  insert into public.cosmetic_ownership (user_id, cosmetic_id, unlock_source)
  values (v_user, v_row.cosmetic_id, 'WORLD_RECORD')
  on conflict (user_id, cosmetic_id) do nothing;

  insert into public.player_progress (user_id) values (v_user)
  on conflict (user_id) do nothing;

  update public.player_progress
  set reward_owned_skin_ids = (
        select coalesce(array_agg(distinct c), '{}')
        from unnest(coalesce(reward_owned_skin_ids, '{}') || array[v_row.cosmetic_id]) as c
        where c is not null and c <> ''
      ),
      updated_at = now()
  where user_id = v_user;

  update public.player_world_records
  set claimed = true
  where user_id = v_user and award_id = p_award_id;

  perform set_config('playhead.authorized_cosmetic_write', '0', true);
  perform set_config('playhead.authorized_progress_write', '0', true);

  return query select v_row.cosmetic_id, true;
exception when others then
  -- ALWAYS drop the privileged flags before re-raising: the transaction-local
  -- config is discarded on rollback, but resetting here keeps the invariant
  -- explicit and safe even if this body is ever reused inside a savepoint.
  perform set_config('playhead.authorized_cosmetic_write', '0', true);
  perform set_config('playhead.authorized_progress_write', '0', true);
  raise;
end;
$$;
grant execute on function public.claim_world_record_award(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Legitimate ledger RPCs run with the authorized flags so the guards above
--    never block the server's own merge/sync paths.
-- -----------------------------------------------------------------------------
create or replace function public.sync_progression(
  p_equipped_knife        text default null,
  p_awarded_rank_keys     text[] default '{}',
  p_pending_drop_ranks    text[] default '{}',
  p_reward_owned_skin_ids text[] default '{}',
  p_custom_claims         text[] default '{}',
  p_first_migration       boolean default false,
  p_equipped_glove        text default null
)
returns public.player_progress
language plpgsql security definer set search_path = public as $$
begin
  -- SECURITY: this is a CLIENT-DRIVEN save, NOT a privileged award. It must NOT
  -- set the authorized flags: doing so would let arbitrary client input bypass
  -- the reserved-reward guards entirely. The guards decide what may change; the
  -- _impl functions own their own reserved-input filtering.
  return public.sync_progression_impl(
    p_equipped_knife, p_awarded_rank_keys, p_pending_drop_ranks,
    p_reward_owned_skin_ids, p_custom_claims, p_first_migration, p_equipped_glove
  );
end;
$$;
grant execute on function public.sync_progression(text, text[], text[], text[], text[], boolean, text) to authenticated;
grant execute on function public.accept_leaderboard_run(uuid, text, text, integer, text, bigint, text, text, text, text, integer, text, text, integer, integer) to service_role;
-- =============================================================================
-- 7. RACE STATE MACHINE — corrected guard + full stage enforcement
-- =============================================================================
-- Replaces the earlier `race_mark_running` (it wrote race_rooms WITHOUT setting
-- the authorized flag, so `race_rooms_guard` rejected it and RUNNING never
-- landed). Replaces the whole client-write guard set with one that binds
-- connected players, locks the setup after LOBBY, and never rejects the machine
-- (every server write sets the same transaction-local flag).
-- =============================================================================

-- The database trigger must be able to update player rows (close a left player).

-- ---- readiness stage enforcement on DIRECT player writes --------------------
create or replace function public.race_players_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_state text;
begin
  if current_setting('playhead.authorized_race_write', true) = '1' then return new; end if;
  if auth.uid() is null then return new; end if;   -- service-role context

  select state into v_state from public.race_rooms where id = new.room_id;

  -- A player that has not CONNECTED cannot be loaded/ready (INSERT or UPDATE).
  if not coalesce(new.connected, false)
     and (coalesce(new.loaded, false) or coalesce(new.in_game_ready, false)) then
    raise exception 'a disconnected player cannot be loaded or ready';
  end if;

  -- Premature readiness: on UPDATE only, LOADED/READY may only be flipped once
  -- the room is actually loading / in-game. (OLD is unavailable on INSERT.)
  if tg_op = 'UPDATE' and v_state in ('LOBBY', 'FINISHED', 'EXPIRED') then
    if coalesce(new.loaded, false) and not coalesce(old.loaded, false) then
      raise exception 'cannot mark loaded before the room is loading';
    end if;
    if coalesce(new.in_game_ready, false) and not coalesce(old.in_game_ready, false) then
      raise exception 'cannot mark in-game ready before loading';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists race_players_guard on public.race_room_players;
create trigger race_players_guard
  before insert or update on public.race_room_players
  for each row execute function public.race_players_guard();

-- ---- room write guard: lock the SETUP once the race has started -------------
create or replace function public.race_rooms_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('playhead.authorized_race_write', true) = '1' then
    return new;
  end if;
  if auth.uid() is null then return new; end if;   -- service-role context

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

  -- SETUP LOCK: track / map identity may not change once the race has started.
  if old.state not in ('LOBBY', 'FINISHED', 'EXPIRED') then
    if new.track_id is distinct from old.track_id
       or new.map_version is distinct from old.map_version
       or new.map_fingerprint is distinct from old.map_fingerprint
       or new.session_seconds is distinct from old.session_seconds then
      raise exception 'race setup is locked after the lobby';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists race_rooms_guard on public.race_rooms;
create trigger race_rooms_guard
  before update on public.race_rooms
  for each row execute function public.race_rooms_guard();

-- ---- the single state-advance machine (one flag-wrapped transition) ---------
create or replace function public.race_room_players_sync()
returns trigger language plpgsql security definer set search_path = public as $$
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
  if v_state in ('FINISHED', 'EXPIRED', 'RUNNING') then return null; end if;

  select
    count(*) filter (where connected),
    count(*) filter (where connected and ready),
    count(*) filter (where connected and loaded),
    count(*) filter (where connected and in_game_ready)
  into v_connected, v_ready, v_loaded, v_ingame
  from public.race_room_players
  where room_id = v_room;

  if v_connected < 2 then
    perform set_config('playhead.authorized_race_write', '1', true);
    if v_state <> 'LOBBY' then
      update public.race_rooms
      set state = 'LOBBY', start_at_ms = null, started_at = null
      where id = v_room;
    end if;
    -- Abort STALE ready flags so a reloaded client cannot carry READY forward.
    update public.race_room_players
    set ready = false, loaded = false, in_game_ready = false
    where room_id = v_room and (ready or loaded or in_game_ready);
    perform set_config('playhead.authorized_race_write', '0', true);
    return null;
  end if;

  -- ALL connected players must satisfy each stage, not merely a count of two.
  if v_state = 'LOBBY' and v_ready >= 2 and v_ready = v_connected then
    perform set_config('playhead.authorized_race_write', '1', true);
    update public.race_rooms set state = 'LOADING' where id = v_room;
    perform set_config('playhead.authorized_race_write', '0', true);
  elsif v_state = 'LOADING' and v_loaded >= 2 and v_loaded = v_connected then
    perform set_config('playhead.authorized_race_write', '1', true);
    update public.race_rooms set state = 'IN_GAME' where id = v_room;
    perform set_config('playhead.authorized_race_write', '0', true);
  elsif v_state = 'IN_GAME' and v_ingame >= 2 and v_ingame = v_connected then
    -- COUNTDOWN only from IN_GAME, with BOTH loaded AND in-game-ready.
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

-- ---- phase-gated report RPCs ------------------------------------------------
create or replace function public.race_report_loaded(p_room_id uuid, p_loaded boolean)
returns void language plpgsql security definer set search_path = public as $$
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
  -- A client may only report LOADED once the race server has begun loading.
  if v_state in ('LOBBY', 'COUNTDOWN', 'RUNNING', 'FINISHED', 'EXPIRED') then
    raise exception 'too late to report loaded';
  end if;
  update public.race_room_players
  set loaded = coalesce(p_loaded, true), last_seen_at = now()
  where room_id = p_room_id and user_id = v_user;
end;
$$;
grant execute on function public.race_report_loaded(uuid, boolean) to authenticated;

create or replace function public.race_set_in_game_ready(p_room_id uuid, p_ready boolean)
returns void language plpgsql security definer set search_path = public as $$
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
  -- In-game ready is NOT permitted in LOBBY: it requires the IN_GAME stage.
  if v_state in ('LOBBY', 'COUNTDOWN', 'RUNNING', 'FINISHED', 'EXPIRED') then
    raise exception 'too late to change in-game ready';
  end if;
  select loaded into v_loaded from public.race_room_players
  where room_id = p_room_id and user_id = v_user;
  if coalesce(p_ready, false) and not coalesce(v_loaded, false) then
    raise exception 'cannot ready before reporting loaded';
  end if;
  update public.race_room_players
  set in_game_ready = coalesce(p_ready, false), last_seen_at = now()
  where room_id = p_room_id and user_id = v_user;
end;
$$;
grant execute on function public.race_set_in_game_ready(uuid, boolean) to authenticated;

-- ---- mark RUNNING (must set the authorized flag; the old version did not) ---
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

create or replace function public.race_report_attempt_start(p_room_id uuid, p_attempt_count integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  update public.race_room_players
  set attempt_count = greatest(coalesce(p_attempt_count, 0), attempt_count),
      current_run_us = 0,
      connected = true,
      last_seen_at = now()
  where room_id = p_room_id and user_id = v_user;
end;
$$;
grant execute on function public.race_report_attempt_start(uuid, integer) to authenticated;

-- ---- FINISH: authoritative, epoch-derived session time ---------------------
-- In a synchronized race the server derives the run time from the shared
-- start_at_ms epoch; the client value is only a fallback outside that timeline.
create or replace function public.race_report_finish(p_room_id uuid, p_time_us bigint)
returns public.race_room_players
language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_row   public.race_room_players;
  v_state text;
  v_start bigint;
  v_epoch_us bigint;
  v_time  bigint := p_time_us;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_time_us is null or p_time_us <= 0 then raise exception 'invalid time'; end if;

  select state, start_at_ms into v_state, v_start
  from public.race_rooms where id = p_room_id;

  if v_state = 'RUNNING' and v_start is not null then
    v_epoch_us := ((extract(epoch from now()) * 1000)::bigint - v_start) * 1000;
    if v_epoch_us > 0 then v_time := v_epoch_us; end if;
  end if;

  update public.race_room_players
  set finish_count = finish_count + 1,
      session_best_us = least(coalesce(session_best_us, v_time), v_time),
      current_run_us = 0,
      connected = true,
      last_seen_at = now()
  where room_id = p_room_id and user_id = v_user
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.race_report_finish(uuid, bigint) to authenticated;

-- ---- presence: cheap heartbeat ---------------------------------------------
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
begin
  update public.race_room_players
  set connected = false, ready = false, loaded = false, in_game_ready = false, last_seen_at = now()
  where room_id = p_room_id and user_id = auth.uid();
end;
$$;
grant execute on function public.race_mark_disconnected(uuid) to authenticated;

-- ---- expire stale players (invoked by the lobby poll) ----------------------
-- A closed tab stops heartbeating; the surviving client's poll expires the
-- vanished player and the state machine reverts the room to LOBBY. Grace is
-- legitimate: 20 s, so a brief network hiccup is never a disqualification.
create or replace function public.race_expire_stale_players(p_room_id uuid, p_grace_seconds integer default 20)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_expired integer;
begin
  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players
  set connected = false,
      ready = false, loaded = false, in_game_ready = false
  where room_id = p_room_id
    and connected
    and last_seen_at < now() - ((coalesce(p_grace_seconds, 20) || ' seconds')::interval);
  get diagnostics v_expired = row_count;
  perform set_config('playhead.authorized_race_write', '0', true);
  return v_expired;
end;
$$;
grant execute on function public.race_expire_stale_players(uuid, integer) to authenticated;

-- ---- housekeeping: also expire stale players, not just rooms ---------------
create or replace function public.expire_stale_race_rooms()
returns integer language sql security definer set search_path = public as $$
  with expired as (
    update public.race_rooms
    set state = 'EXPIRED'
    where state in ('LOBBY','LOADING','IN_GAME','COUNTDOWN','RUNNING')
      and expires_at < now()
    returning 1
  )
  select coalesce(count(*), 0)::integer from expired;
$$;
grant execute on function public.expire_stale_race_rooms() to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Legitimate ledger RPCs keep working: they run inside the authorized
--    context so the reserved-reward guard blocks CLIENTS, not the server.
-- -----------------------------------------------------------------------------
-- The untouched merge implementation (7-argument form from the mastery pass).
create or replace function public.sync_progression_impl(
  p_equipped_knife        text default null,
  p_awarded_rank_keys     text[] default '{}',
  p_pending_drop_ranks    text[] default '{}',
  p_reward_owned_skin_ids text[] default '{}',
  p_custom_claims         text[] default '{}',
  p_first_migration       boolean default false,
  p_equipped_glove        text default null
)
returns public.player_progress
language plpgsql security definer set search_path = public as $$
declare
  v_user      uuid := auth.uid();
  v_row       public.player_progress;
  v_awarded   text[];
  v_spent     text[];
  v_owned     text[];
  v_claim     text;
  v_pending   text[];
  v_glove     text;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  insert into public.player_progress (user_id) values (v_user)
  on conflict (user_id) do nothing;

  select * into v_row from public.player_progress where user_id = v_user for update;

  v_awarded := (
    select coalesce(array_agg(distinct k), '{}')
    from unnest(coalesce(v_row.awarded_rank_keys, '{}') || coalesce(p_awarded_rank_keys, '{}')) as k
    where k is not null and k <> ''
  );

  if p_custom_claims is not null then
    foreach v_claim in array p_custom_claims loop
      if v_claim is null or v_claim = '' then continue; end if;
      insert into public.custom_signal_claims (user_id, audio_fingerprint)
      values (v_user, v_claim)
      on conflict (user_id, audio_fingerprint) do nothing;
      v_awarded := array_append(v_awarded, 'custom:' || v_claim);
    end loop;
    v_awarded := (
      select coalesce(array_agg(distinct k), '{}') from unnest(v_awarded) as k
    );
  end if;

  -- RESERVED-INPUT FILTER: retain legitimate existing ownership verbatim, but
  -- ignore any NEW reserved id the client sends unless the server already proved
  -- it (WR claim ledger) or it is a historical pre-migration snapshot.
  v_owned := (
    select coalesce(array_agg(distinct c), '{}')
    from unnest(
      coalesce(v_row.reward_owned_skin_ids, '{}') ||
      coalesce((
        select array_agg(c)
        from unnest(coalesce(p_reward_owned_skin_ids, '{}')) as c
        where c is not null and c <> ''
          and (
            not public.is_reserved_cosmetic(c)
            or public.has_historical_reserved_ownership(v_user, c)
            or exists (
              select 1 from public.player_world_records w
              where w.user_id = v_user and w.cosmetic_id = c
            )
          )
      ), '{}')
    ) as c
    where c is not null and c <> ''
  );

  insert into public.cosmetic_ownership (user_id, cosmetic_id, unlock_source)
  select v_user, c, 'PROGRESSION' from unnest(v_owned) as c
  on conflict (user_id, cosmetic_id) do nothing;

  if coalesce(p_first_migration, false) then
    v_spent := coalesce(v_row.spent_drop_keys, '{}');
    declare
      v_target text[] := coalesce(p_pending_drop_ranks, '{}');
      v_avail  text[];
      v_rank   text;
      v_key    text;
    begin
      v_avail := public.progression_pending_ranks(v_awarded, v_spent);
      foreach v_rank in array v_target loop
        if not (upper(v_rank) = any (v_avail)) then
          v_key := 'legacy:' || upper(v_rank);
          v_awarded := array_append(v_awarded, v_key);
          v_avail := array_append(v_avail, upper(v_rank));
        end if;
      end loop;
    end;
  else
    v_spent := coalesce(v_row.spent_drop_keys, '{}');
  end if;

  v_pending := public.progression_pending_ranks(v_awarded, v_spent);

  v_glove := case
    when p_equipped_glove is null then null
    when length(p_equipped_glove) = 0 then null
    when length(p_equipped_glove) > 64 then null
    else p_equipped_glove
  end;

  update public.player_progress
  set equipped_knife        = coalesce(nullif(p_equipped_knife, ''), v_row.equipped_knife),
      equipped_glove        = coalesce(v_glove, v_row.equipped_glove),
      awarded_rank_keys     = v_awarded,
      spent_drop_keys       = v_spent,
      reward_owned_skin_ids = v_owned,
      progression_version   = coalesce(v_row.progression_version, 1),
      migration_completed_at = case
        when coalesce(p_first_migration, false) then coalesce(v_row.migration_completed_at, now())
        else v_row.migration_completed_at
      end,
      updated_at            = now()
  where user_id = v_user
  returning * into v_row;

  v_row.awarded_rank_keys := v_awarded;
  v_row.spent_drop_keys := v_spent;
  return v_row;
end;
$$;
-- LOCKDOWN: _impl bodies are internal. Only the SECURITY DEFINER wrapper (owned
-- by the function owner, not by these roles) may call them; a client calling
-- them directly would be unable to satisfy the guards' reserved-input checks.
revoke all on function public.sync_progression_impl(text, text[], text[], text[], text[], boolean, text) from public, anon, authenticated;

create or replace function public.grant_progression_events(p_events jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- SECURITY: client-driven event drain. Never sets the authorized flags; the
  -- reserved-reward guards and the _impl input filter stay in force.
  perform public.grant_progression_events_impl(p_events);
end;
$$;
grant execute on function public.grant_progression_events(jsonb) to authenticated;

create or replace function public.grant_progression_events_impl(p_events jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user   uuid := auth.uid();
  v_event  jsonb;
  v_kind   text;
  v_key    text;
  v_row    public.player_progress;
  v_awarded text[];
  v_owned  text[];
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  insert into public.player_progress (user_id) values (v_user)
  on conflict (user_id) do nothing;
  select * into v_row from public.player_progress where user_id = v_user for update;

  v_awarded := coalesce(v_row.awarded_rank_keys, '{}');
  v_owned := coalesce(v_row.reward_owned_skin_ids, '{}');

  for v_event in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    v_kind := v_event->>'kind';
    v_key := v_event->>'key';
    if v_kind = 'award_rank_key' and v_key is not null then
      if not (v_key = any (v_awarded)) then
        v_awarded := array_append(v_awarded, v_key);
      end if;
    elsif v_kind = 'own_cosmetic' and v_key is not null then
      -- RESERVED-INPUT FILTER: ignore a NEW reserved id unless the server has
      -- already proved it (WR claim ledger) or it is historical pre-migration
      -- ownership. Legitimate existing ownership is untouched below.
      if public.is_reserved_cosmetic(v_key)
         and not public.has_historical_reserved_ownership(v_user, v_key)
         and not exists (
           select 1 from public.player_world_records w
           where w.user_id = v_user and w.cosmetic_id = v_key
         ) then
        continue;
      end if;
      v_owned := array_append(v_owned, v_key);
      insert into public.cosmetic_ownership (user_id, cosmetic_id, unlock_source)
      values (v_user, v_key, 'PROGRESSION')
      on conflict (user_id, cosmetic_id) do nothing;
    elsif v_kind = 'custom_claim' and v_key is not null then
      insert into public.custom_signal_claims (user_id, audio_fingerprint)
      values (v_user, v_key)
      on conflict (user_id, audio_fingerprint) do nothing;
    end if;
  end loop;

  v_owned := (
    select coalesce(array_agg(distinct c), '{}') from unnest(v_owned) as c where c <> ''
  );

  update public.player_progress
  set awarded_rank_keys = v_awarded,
      reward_owned_skin_ids = v_owned,
      updated_at = now()
  where user_id = v_user;
end;
$$;
-- LOCKDOWN: internal merge body; not callable by clients.
revoke all on function public.grant_progression_events_impl(jsonb) from public, anon, authenticated;

-- ---- abandon: leave the pre-race lifecycle cleanly (never freeze the race) --
create or replace function public.race_abandon_session(p_room_id uuid, p_reason text default 'ABORTED')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  perform set_config('playhead.authorized_race_write', '1', true);

  update public.race_room_players
  set connected = false, ready = false, loaded = false, in_game_ready = false, last_seen_at = now()
  where room_id = p_room_id and user_id = v_user;

  -- Before the race is live, the room reverts to LOBBY so the survivor is never
  -- stranded in a dead countdown. This is exactly what race_room_players_sync
  -- does for a disconnect, invoked here so a deliberate leave is immediate.
  update public.race_rooms
  set state = 'LOBBY', start_at_ms = null, started_at = null
  where id = p_room_id and state in ('LOADING','IN_GAME','COUNTDOWN');

  perform set_config('playhead.authorized_race_write', '0', true);

  if p_reason is null or p_reason = '' then
    null;
  end if;
end;
$$;
grant execute on function public.race_abandon_session(uuid, text) to authenticated;

-- =============================================================================
-- 9. RACE SURGICAL OVERRIDES (final authoritative shapes)
--    These CREATE OR REPLACE the race functions/triggers defined earlier in this
--    same file (and in migration 00) so the deployed definitions are the hardened
--    ones below. Order matters: this section runs last on purpose.
-- =============================================================================

-- ---- loadout metadata: locked at join, survives the whole race --------------
alter table public.race_room_players
  add column if not exists loadout jsonb not null default '{}'::jsonb;

-- The authoritative loadout is the player's CURRENT cosmetic systems, captured
-- once when the row joins (or while the room is still LOBBY). It is opaque
-- metadata for the opponent; it is never a rendering or collision input.
create or replace function public.race_player_loadout(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'knifeId', coalesce(
      nullif((select equipped_knife from public.player_progress where user_id = p_user_id), ''),
      'STANDARD_ISSUE'
    ),
    'gloveId', coalesce(
      nullif((select equipped_glove from public.player_progress where user_id = p_user_id), ''),
      'STANDARD_ISSUE'
    )
  )
$$;

-- ---- readiness stage enforcement on DIRECT player writes (FULL rewrite) -----
-- Closes the hole where a client flipped in_game_ready = true in LOBBY/LOADING:
--   * not-loaded players may never be in_game_ready
--   * in_game_ready may ONLY be raised while the room is IN_GAME
--   * the captured loadout is immutable once the room has left LOBBY
create or replace function public.race_players_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_state text;
begin
  if current_setting('playhead.authorized_race_write', true) = '1' then return new; end if;
  if auth.uid() is null then return new; end if;   -- service-role context

  select state into v_state from public.race_rooms where id = new.room_id;

  if not coalesce(new.connected, false)
     and (coalesce(new.loaded, false) or coalesce(new.in_game_ready, false)) then
    raise exception 'a disconnected player cannot be loaded or ready';
  end if;

  if tg_op = 'UPDATE' then
    -- In-game ready may only be raised while the room is IN_GAME and the player
    -- is already loaded. Lowering it stays permitted everywhere.
    if coalesce(new.in_game_ready, false)
       and not coalesce(old.in_game_ready, false) then
      if v_state <> 'IN_GAME' then
        raise exception 'cannot mark in-game ready before the in-game stage';
      end if;
      if not coalesce(new.loaded, false) then
        raise exception 'cannot mark in-game ready before reporting loaded';
      end if;
    end if;
    -- LOADED may only be raised once the room has left the lobby.
    if coalesce(new.loaded, false) and not coalesce(old.loaded, false) then
      if v_state in ('LOBBY', 'FINISHED', 'EXPIRED') then
        raise exception 'cannot mark loaded before the room is loading';
      end if;
    end if;
    -- LOADOUT LOCK: captured once; immutable once the room has left LOBBY.
    if v_state is not null and v_state <> 'LOBBY'
       and new.loadout is distinct from old.loadout then
      raise exception 'race loadout is locked once the room leaves the lobby';
    end if;
  end if;

  return new;
end;
$$;

-- ---- the single state-advance machine (FULL rewrite) ------------------------
-- COUNTDOWN now requires BOTH loaded AND in-game-ready, and it re-arms even if a
-- COUNTDOWN broadcast was missed: a later row touch from IN_GAME re-derives it.
create or replace function public.race_room_players_sync()
returns trigger language plpgsql security definer set search_path = public as $$
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
  if v_state in ('FINISHED', 'EXPIRED', 'RUNNING') then return null; end if;

  select
    count(*) filter (where connected),
    count(*) filter (where connected and ready),
    count(*) filter (where connected and loaded),
    count(*) filter (where connected and in_game_ready)
  into v_connected, v_ready, v_loaded, v_ingame
  from public.race_room_players
  where room_id = v_room;

  if v_connected < 2 then
    perform set_config('playhead.authorized_race_write', '1', true);
    if v_state <> 'LOBBY' then
      update public.race_rooms
      set state = 'LOBBY', start_at_ms = null, started_at = null
      where id = v_room;
    end if;
    update public.race_room_players
    set ready = false, loaded = false, in_game_ready = false
    where room_id = v_room and (ready or loaded or in_game_ready);
    perform set_config('playhead.authorized_race_write', '0', true);
    return null;
  end if;

  if v_state = 'LOBBY' and v_ready >= 2 and v_ready = v_connected then
    perform set_config('playhead.authorized_race_write', '1', true);
    update public.race_rooms set state = 'LOADING' where id = v_room;
    perform set_config('playhead.authorized_race_write', '0', true);
  elsif v_state = 'LOADING' and v_loaded >= 2 and v_loaded = v_connected then
    perform set_config('playhead.authorized_race_write', '1', true);
    update public.race_rooms set state = 'IN_GAME' where id = v_room;
    perform set_config('playhead.authorized_race_write', '0', true);
  elsif v_state = 'IN_GAME' and v_ingame >= 2 and v_ingame = v_connected
        and v_loaded = v_connected then
    -- MISSING-COUNTDOWN SAFETY: if a later touch arrives while still IN_GAME and
    -- both players are loaded AND in-game-ready, re-derive the shared GO.
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

-- ---- phase-gated report RPCs (hardened) ------------------------------------
create or replace function public.race_report_loaded(p_room_id uuid, p_loaded boolean)
returns void language plpgsql security definer set search_path = public as $$
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
  if v_state in ('LOBBY', 'COUNTDOWN', 'RUNNING', 'FINISHED', 'EXPIRED') then
    raise exception 'too late to report loaded';
  end if;
  update public.race_room_players
  set loaded = coalesce(p_loaded, true), last_seen_at = now()
  where room_id = p_room_id and user_id = v_user;
end;
$$;

create or replace function public.race_set_in_game_ready(p_room_id uuid, p_ready boolean)
returns void language plpgsql security definer set search_path = public as $$
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
  -- READY (true) is permitted ONLY in IN_GAME. Lowering the flag is allowed from
  -- any live pre-race stage so a client can always cancel.
  if coalesce(p_ready, false) and v_state <> 'IN_GAME' then
    raise exception 'in-game ready is only accepted during the in-game stage';
  end if;
  if v_state in ('COUNTDOWN', 'RUNNING', 'FINISHED', 'EXPIRED') then
    raise exception 'too late to change in-game ready';
  end if;
  select loaded into v_loaded from public.race_room_players
  where room_id = p_room_id and user_id = v_user;
  if coalesce(p_ready, false) and not coalesce(v_loaded, false) then
    raise exception 'cannot ready before reporting loaded';
  end if;
  update public.race_room_players
  set in_game_ready = coalesce(p_ready, false), last_seen_at = now()
  where room_id = p_room_id and user_id = v_user;
end;
$$;

create or replace function public.race_abandon_session(p_room_id uuid, p_reason text default 'ABORTED')
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

  update public.race_room_players
  set connected = false, ready = false, loaded = false, in_game_ready = false, last_seen_at = now()
  where room_id = p_room_id and user_id = v_user;

  update public.race_rooms
  set state = 'LOBBY', start_at_ms = null, started_at = null
  where id = p_room_id and state in ('LOADING','IN_GAME','COUNTDOWN');

  perform set_config('playhead.authorized_race_write', '0', true);

  if p_reason is null or p_reason = '' then
    null;
  end if;
end;
$$;

-- ---- stale-player expiry: member-only, clamped grace ------------------------
create or replace function public.race_expire_stale_players(p_room_id uuid, p_grace_seconds integer default 20)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_grace integer;
  v_expired integer;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if not exists (
    select 1 from public.race_room_players where room_id = p_room_id and user_id = v_user
  ) then
    raise exception 'not a member of this room';
  end if;
  -- A client controls only WHEN it sweeps, never HOW generous the grace is: the
  -- window is clamped to [20, 60] s so a heartbeat hiccup is never fatal.
  v_grace := least(60, greatest(20, coalesce(p_grace_seconds, 20)));

  perform set_config('playhead.authorized_race_write', '1', true);
  update public.race_room_players
  set connected = false,
      ready = false, loaded = false, in_game_ready = false
  where room_id = p_room_id
    and connected
    and last_seen_at < now() - ((v_grace || ' seconds')::interval);
  get diagnostics v_expired = row_count;
  perform set_config('playhead.authorized_race_write', '0', true);
  return v_expired;
end;
$$;
grant execute on function public.race_expire_stale_players(uuid, integer) to authenticated;

-- ---- attempt-start phase guard ---------------------------------------------
create or replace function public.race_report_attempt_start(p_room_id uuid, p_attempt_count integer)
returns void language plpgsql security definer set search_path = public as $$
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
  if v_state <> 'RUNNING' then
    raise exception 'attempts may only start while the race is running';
  end if;
  update public.race_room_players
  set attempt_count = greatest(coalesce(p_attempt_count, 0), attempt_count),
      current_run_us = 0,
      connected = true,
      last_seen_at = now()
  where room_id = p_room_id and user_id = v_user;
end;
$$;

-- ---- FINISH: server-derived epoch ONLY; idempotent per session-finish -------
create or replace function public.race_report_finish(p_room_id uuid, p_time_us bigint)
returns public.race_room_players
language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_row   public.race_room_players;
  v_state text;
  v_start bigint;
  v_epoch_us bigint;
  v_time  bigint;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_time_us is null or p_time_us <= 0 then raise exception 'invalid time'; end if;

  if not exists (
    select 1 from public.race_room_players where room_id = p_room_id and user_id = v_user
  ) then
    raise exception 'not a member of this room';
  end if;

  select state, start_at_ms into v_state, v_start
  from public.race_rooms where id = p_room_id;
  if v_state is null then raise exception 'room not found'; end if;
  if v_state <> 'RUNNING' or v_start is null then
    raise exception 'no authoritative running timeline to report against';
  end if;

  v_epoch_us := ((extract(epoch from now()) * 1000)::bigint - v_start) * 1000;
  if v_epoch_us <= 0 then
    raise exception 'race timeline has not started';
  end if;
  v_time := v_epoch_us;  -- server-derived ONLY; client p_time_us is ignored.

  select * into v_row from public.race_room_players
  where room_id = p_room_id and user_id = v_user
  for update;
  if v_row.user_id is null then
    raise exception 'not a member of this room';
  end if;

  -- IDEMPOTENT: a repeated report against the SAME frozen run time must not
  -- increment finish_count again. A NEW, faster attempt still counts.
  if v_row.session_best_us is not null and v_row.session_best_us = v_time then
    return v_row;
  end if;

  update public.race_room_players
  set finish_count = finish_count + 1,
      session_best_us = least(coalesce(session_best_us, v_time), v_time),
      current_run_us = 0,
      connected = true,
      last_seen_at = now()
  where room_id = p_room_id and user_id = v_user
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.race_report_finish(uuid, bigint) to authenticated;
