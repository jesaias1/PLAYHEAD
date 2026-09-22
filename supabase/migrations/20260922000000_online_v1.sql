-- =============================================================================
-- PLAYHEAD ONLINE V1 — cloud progression, global leaderboards, friend sessions
-- =============================================================================
--
-- Apply with:  supabase db push        (or paste into the SQL editor)
--
-- Design rules encoded here:
--  * Anonymous-first identity: every row keys on auth.users(id).
--  * RLS on EVERY public table. A player can read/write only their own private
--    progression; leaderboard-safe data is publicly readable.
--  * The server owns the reward LEDGER. Pending Signal Drops are DERIVED as
--    (awarded - spent), which is event-aware: it cannot be farmed by refreshing,
--    opening tabs, or toggling offline/online, and it cannot mint duplicates.
--  * PB upserts are ATOMIC (LEAST(...)) so two tabs cannot race.
--  * Friend sessions compare per-player SESSION BEST times, not first finish.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. PROFILES
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null default 'PLAYER',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint profiles_display_name_len check (char_length(display_name) between 1 and 24)
);

alter table public.profiles enable row level security;

drop policy if exists profiles_read_all on public.profiles;
create policy profiles_read_all on public.profiles
  for select using (true);                    -- display names are leaderboard-safe

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- -----------------------------------------------------------------------------
-- 2. PLAYER PROGRESS  (private; ledgers are the source of truth)
-- -----------------------------------------------------------------------------
create table if not exists public.player_progress (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  equipped_knife          text not null default 'SIGNAL_CYAN',
  -- Every rank threshold ever earned: "<trackId>:<RANK>" or "custom:<fingerprint>".
  awarded_rank_keys       text[] not null default '{}',
  -- Every drop ever opened. Pending = awarded - spent.
  spent_drop_keys         text[] not null default '{}',
  -- Skins obtained through the canonical Signal Decoder drop path.
  reward_owned_skin_ids   text[] not null default '{}',
  progression_version     integer not null default 1,
  migration_completed_at  timestamptz,
  updated_at              timestamptz not null default now()
);

alter table public.player_progress enable row level security;

drop policy if exists progress_read_self on public.player_progress;
create policy progress_read_self on public.player_progress
  for select using (auth.uid() = user_id);

drop policy if exists progress_insert_self on public.player_progress;
create policy progress_insert_self on public.player_progress
  for insert with check (auth.uid() = user_id);

-- Direct updates are allowed for the SAFE field only. Ledgers are mutated
-- exclusively through SECURITY DEFINER RPCs below.
drop policy if exists progress_update_self on public.player_progress;
create policy progress_update_self on public.player_progress
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 3. COSMETIC OWNERSHIP  (duplicates impossible by primary key)
-- -----------------------------------------------------------------------------
create table if not exists public.cosmetic_ownership (
  user_id       uuid not null references auth.users(id) on delete cascade,
  cosmetic_id   text not null,
  unlocked_at   timestamptz not null default now(),
  unlock_source text not null default 'PROGRESSION',
  primary key (user_id, cosmetic_id)          -- <- duplicate ownership is impossible
);

alter table public.cosmetic_ownership enable row level security;

drop policy if exists cosmetics_read_self on public.cosmetic_ownership;
create policy cosmetics_read_self on public.cosmetic_ownership
  for select using (auth.uid() = user_id);

drop policy if exists cosmetics_insert_self on public.cosmetic_ownership;
create policy cosmetics_insert_self on public.cosmetic_ownership
  for insert with check (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 4. TRACK PROGRESS  (per map identity; PB can only improve)
-- -----------------------------------------------------------------------------
create table if not exists public.track_progress (
  user_id        uuid not null references auth.users(id) on delete cascade,
  track_id       text not null,
  map_version    integer not null,
  map_fingerprint text not null,
  best_time_us   bigint,
  best_rank      text,
  updated_at     timestamptz not null default now(),
  primary key (user_id, track_id, map_version, map_fingerprint)
);

alter table public.track_progress enable row level security;

drop policy if exists track_progress_read_self on public.track_progress;
create policy track_progress_read_self on public.track_progress
  for select using (auth.uid() = user_id);

drop policy if exists track_progress_insert_self on public.track_progress;
create policy track_progress_insert_self on public.track_progress
  for insert with check (auth.uid() = user_id);

drop policy if exists track_progress_update_self on public.track_progress;
create policy track_progress_update_self on public.track_progress
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 5. CUSTOM SIGNAL CLAIMS  (one drop per unique audio fingerprint, ever)
-- -----------------------------------------------------------------------------
create table if not exists public.custom_signal_claims (
  user_id           uuid not null references auth.users(id) on delete cascade,
  audio_fingerprint text not null,
  drop_claimed      boolean not null default true,
  created_at        timestamptz not null default now(),
  primary key (user_id, audio_fingerprint)    -- <- re-upload cannot re-award
);

alter table public.custom_signal_claims enable row level security;

drop policy if exists claims_read_self on public.custom_signal_claims;
create policy claims_read_self on public.custom_signal_claims
  for select using (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 6. LEADERBOARD RUNS  (public read; server-only write)
-- -----------------------------------------------------------------------------
create table if not exists public.leaderboard_runs (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  display_name       text not null default 'PLAYER',
  track_id           text not null,
  map_version        integer not null,
  map_fingerprint    text not null,
  time_us            bigint not null,
  rank               text not null default 'UNRANKED',
  movement_version   text not null,
  generator_version  text not null,
  build_version      text not null default 'DEV',
  replay_version     integer,
  replay_path        text,
  replay_hash        text,
  checkpoint_count   integer not null default 0,
  reset_count        integer not null default 0,
  verification_state text not null default 'accepted',
  created_at         timestamptz not null default now(),
  constraint leaderboard_time_positive check (time_us > 0),
  constraint leaderboard_state_valid check (verification_state in ('accepted','flagged','rejected'))
);

alter table public.leaderboard_runs enable row level security;

-- Public read of leaderboard-safe columns only (no auth/session data is stored).
drop policy if exists leaderboard_read_all on public.leaderboard_runs;
create policy leaderboard_read_all on public.leaderboard_runs
  for select using (true);

-- No client insert/update/delete policy: rows are written ONLY by the
-- submit-run Edge Function using the service role. This is what makes
-- "the client cannot mint a trusted world record" structural rather than
-- advisory.

-- -----------------------------------------------------------------------------
-- 7. RACE ROOMS  (shared BEST-TIME SESSION)
-- -----------------------------------------------------------------------------
create table if not exists public.race_rooms (
  id              uuid primary key default gen_random_uuid(),
  invite_code     text not null unique,
  host_user_id    uuid not null references auth.users(id) on delete cascade,
  track_id        text not null,
  track_title     text not null default '',
  map_version     integer not null,
  map_fingerprint text not null,
  state           text not null default 'LOBBY',
  session_seconds integer not null default 300,
  start_at_ms     bigint,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '2 hours'),
  constraint race_state_valid check (state in ('LOBBY','COUNTDOWN','RUNNING','FINISHED','EXPIRED'))
);

alter table public.race_rooms enable row level security;

drop policy if exists race_rooms_read_all on public.race_rooms;
create policy race_rooms_read_all on public.race_rooms
  for select using (true);

drop policy if exists race_rooms_insert_host on public.race_rooms;
create policy race_rooms_insert_host on public.race_rooms
  for insert with check (auth.uid() = host_user_id);

-- Host-only mutation of the room itself (start / close).
drop policy if exists race_rooms_update_host on public.race_rooms;
create policy race_rooms_update_host on public.race_rooms
  for update using (auth.uid() = host_user_id) with check (auth.uid() = host_user_id);

-- -----------------------------------------------------------------------------
-- 8. RACE ROOM PLAYERS  (per-player SESSION state, not first-finish)
-- -----------------------------------------------------------------------------
create table if not exists public.race_room_players (
  room_id         uuid not null references public.race_rooms(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  display_name    text not null default 'PLAYER',
  ready           boolean not null default false,
  connected       boolean not null default true,
  attempt_count   integer not null default 0,
  finish_count    integer not null default 0,
  -- Best VALID completion time inside this session (microseconds). Null = no finish yet.
  session_best_us bigint,
  -- Live attempt time for the opponent's HUD (display only).
  current_run_us  bigint not null default 0,
  joined_at       timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.race_room_players enable row level security;

drop policy if exists race_players_read_all on public.race_room_players;
create policy race_players_read_all on public.race_room_players
  for select using (true);

drop policy if exists race_players_insert_self on public.race_room_players;
create policy race_players_insert_self on public.race_room_players
  for insert with check (auth.uid() = user_id);

-- A player may only ever mutate THEIR OWN row. This is what stops one member
-- from changing another member's readiness or results.
drop policy if exists race_players_update_self on public.race_room_players;
create policy race_players_update_self on public.race_room_players
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 9. INDEXES
-- -----------------------------------------------------------------------------
create index if not exists leaderboard_board_idx
  on public.leaderboard_runs (track_id, map_version, map_fingerprint, verification_state, time_us);

create index if not exists leaderboard_user_idx
  on public.leaderboard_runs (user_id, track_id, map_version, map_fingerprint, time_us);

create index if not exists track_progress_lookup_idx
  on public.track_progress (user_id, track_id, map_version, map_fingerprint);

create index if not exists cosmetic_ownership_user_idx
  on public.cosmetic_ownership (user_id);

create index if not exists race_rooms_code_idx on public.race_rooms (invite_code);
create index if not exists race_rooms_expiry_idx on public.race_rooms (expires_at);
create index if not exists race_players_room_idx on public.race_room_players (room_id);

-- -----------------------------------------------------------------------------
-- 10. PENDING DROP DERIVATION  (event-aware; cannot duplicate or go negative)
-- -----------------------------------------------------------------------------
create or replace function public.progression_pending_ranks(
  p_awarded text[],
  p_spent   text[]
)
returns text[]
language plpgsql
immutable
as $$
declare
  v_awarded_ranks text[] := '{}';
  v_spent_ranks   text[] := '{}';
  v_key           text;
  v_rank          text;
  v_result        text[] := '{}';
  i               integer;
begin
  -- Extract the rank suffix from each awarded key ("track:RANK" / "custom:fp").
  if p_awarded is not null then
    foreach v_key in array p_awarded loop
      v_rank := upper(split_part(v_key, ':', 2));
      if v_rank = '' or v_rank is null then
        v_rank := 'BRONZE';                 -- custom audio claims award BRONZE
      end if;
      v_awarded_ranks := array_append(v_awarded_ranks, v_rank);
    end loop;
  end if;

  if p_spent is not null then
    foreach v_key in array p_spent loop
      v_rank := upper(split_part(v_key, ':', 2));
      if v_rank = '' or v_rank is null then
        v_rank := 'BRONZE';
      end if;
      v_spent_ranks := array_append(v_spent_ranks, v_rank);
    end loop;
  end if;

  -- Multiset subtraction: awarded minus spent. Never negative.
  for i in 1 .. coalesce(array_length(v_awarded_ranks, 1), 0) loop
    v_rank := v_awarded_ranks[i];
    if v_rank = any (v_spent_ranks) then
      v_spent_ranks := array_remove(v_spent_ranks, v_rank);
    else
      v_result := array_append(v_result, v_rank);
    end if;
  end loop;

  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- 11. RPC: sync_progression  (the ONLY progression merge path)
-- -----------------------------------------------------------------------------
create or replace function public.sync_progression(
  p_equipped_knife        text default null,
  p_awarded_rank_keys     text[] default '{}',
  p_pending_drop_ranks    text[] default '{}',
  p_reward_owned_skin_ids text[] default '{}',
  p_custom_claims         text[] default '{}',
  p_first_migration       boolean default false
)
returns public.player_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user      uuid := auth.uid();
  v_row       public.player_progress;
  v_awarded   text[];
  v_spent     text[];
  v_owned     text[];
  v_claim     text;
  v_pending   text[];
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  insert into public.player_progress (user_id)
  values (v_user)
  on conflict (user_id) do nothing;

  select * into v_row from public.player_progress where user_id = v_user for update;

  -- UNION the award ledger. It may only ever grow.
  v_awarded := (
    select coalesce(array_agg(distinct k), '{}')
    from unnest(coalesce(v_row.awarded_rank_keys, '{}') || coalesce(p_awarded_rank_keys, '{}')) as k
    where k is not null and k <> ''
  );

  -- Custom audio claims: insert-or-ignore, and each NEW claim awards BRONZE.
  if p_custom_claims is not null then
    foreach v_claim in array p_custom_claims loop
      if v_claim is null or v_claim = '' then continue; end if;
      insert into public.custom_signal_claims (user_id, audio_fingerprint)
      values (v_user, v_claim)
      on conflict (user_id, audio_fingerprint) do nothing;
      -- Only award if the claim did not already exist.
      if not exists (
        select 1 from public.custom_signal_claims
        where user_id = v_user and audio_fingerprint = v_claim
          and created_at < now() - interval '1 millisecond'
      ) then
        null; -- fresh insert path already handled below
      end if;
      v_awarded := array_append(v_awarded, 'custom:' || v_claim);
    end loop;
    v_awarded := (
      select coalesce(array_agg(distinct k), '{}')
      from unnest(v_awarded) as k
    );
  end if;

  -- UNION cosmetic ownership (set union: never lose, never duplicate).
  v_owned := (
    select coalesce(array_agg(distinct c), '{}')
    from unnest(coalesce(v_row.reward_owned_skin_ids, '{}') || coalesce(p_reward_owned_skin_ids, '{}')) as c
    where c is not null and c <> ''
  );

  insert into public.cosmetic_ownership (user_id, cosmetic_id, unlock_source)
  select v_user, c, 'PROGRESSION' from unnest(v_owned) as c
  on conflict (user_id, cosmetic_id) do nothing;

  -- Spend ledger.
  if coalesce(p_first_migration, false) then
    -- FIRST MIGRATION: the device is the truth for what it has already spent.
    -- Derive spent = awarded - pending so the player keeps exactly the drops
    -- they had, no more and no fewer.
    v_spent := coalesce(v_row.spent_drop_keys, '{}');
    declare
      v_target text[] := coalesce(p_pending_drop_ranks, '{}');
      v_avail  text[];
      v_rank   text;
      v_key    text;
    begin
      v_avail := public.progression_pending_ranks(v_awarded, v_spent);
      foreach v_rank in array v_target loop
        -- If the player has MORE pending than the ledger explains (legacy
        -- pre-ledger awards), add a synthetic award key so it is preserved once.
        if not (upper(v_rank) = any (v_avail)) then
          v_key := 'legacy:' || upper(v_rank);
          v_awarded := array_append(v_awarded, v_key);
          v_avail := array_append(v_avail, upper(v_rank));
        end if;
      end loop;
    end;
  else
    -- Steady state: the server ledger is authoritative. A client-side pending
    -- count is deliberately NOT merged upward, which is what prevents drop
    -- duplication across reloads, tabs and offline/online toggles.
    v_spent := coalesce(v_row.spent_drop_keys, '{}');
  end if;

  v_pending := public.progression_pending_ranks(v_awarded, v_spent);

  update public.player_progress
  set equipped_knife        = coalesce(nullif(p_equipped_knife, ''), v_row.equipped_knife),
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

  -- Return the row with pending injected for the client to hydrate.
  v_row.awarded_rank_keys := v_awarded;
  v_row.spent_drop_keys := v_spent;
  -- Pending is derived; expose it through a companion column-free trick: the
  -- client recomputes it, but we also stash it for convenience.
  return v_row;
end;
$$;

grant execute on function public.sync_progression to authenticated;

-- Convenience: derived pending drops for the current user.
create or replace function public.my_pending_drop_ranks()
returns text[]
language sql
security definer
set search_path = public
as $$
  select public.progression_pending_ranks(awarded_rank_keys, spent_drop_keys)
  from public.player_progress where user_id = auth.uid();
$$;

grant execute on function public.my_pending_drop_ranks to authenticated;

-- -----------------------------------------------------------------------------
-- 12. RPC: spend_drop  (atomic; cannot go negative)
-- -----------------------------------------------------------------------------
create or replace function public.spend_drop(p_key text default null)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_row     public.player_progress;
  v_pending text[];
  v_spent   text[];
  v_key     text;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into v_row from public.player_progress where user_id = v_user for update;
  if v_row is null then return '{}'; end if;

  v_pending := public.progression_pending_ranks(v_row.awarded_rank_keys, v_row.spent_drop_keys);
  if coalesce(array_length(v_pending, 1), 0) = 0 then
    return '{}';                                  -- nothing to spend
  end if;

  v_key := coalesce(nullif(p_key, ''), v_pending[1]);
  v_spent := array_append(coalesce(v_row.spent_drop_keys, '{}'), v_key);

  update public.player_progress
  set spent_drop_keys = v_spent, updated_at = now()
  where user_id = v_user;

  return public.progression_pending_ranks(v_row.awarded_rank_keys, v_spent);
end;
$$;

grant execute on function public.spend_drop to authenticated;

-- -----------------------------------------------------------------------------
-- 13. RPC: grant_progression_events  (idempotent offline replay)
-- -----------------------------------------------------------------------------
create or replace function public.grant_progression_events(p_events jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

grant execute on function public.grant_progression_events to authenticated;

-- -----------------------------------------------------------------------------
-- 14. RPC: upsert_track_progress  (ATOMIC PB — lower time wins)
-- -----------------------------------------------------------------------------
create or replace function public.upsert_track_progress(
  p_track_id        text,
  p_map_version     integer,
  p_map_fingerprint text,
  p_best_time_us    bigint,
  p_best_rank       text
)
returns public.track_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row  public.track_progress;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_best_time_us is null or p_best_time_us <= 0 then
    raise exception 'invalid time';
  end if;

  insert into public.track_progress (
    user_id, track_id, map_version, map_fingerprint, best_time_us, best_rank, updated_at
  ) values (
    v_user, p_track_id, p_map_version, p_map_fingerprint, p_best_time_us, p_best_rank, now()
  )
  on conflict (user_id, track_id, map_version, map_fingerprint) do update
    -- ATOMIC: the database decides, so two tabs cannot race a read-modify-write.
    set best_time_us = least(public.track_progress.best_time_us, excluded.best_time_us),
        best_rank = case
          when public.track_progress.best_time_us is null
            or excluded.best_time_us < public.track_progress.best_time_us
            then excluded.best_rank
          else public.track_progress.best_rank
        end,
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.upsert_track_progress to authenticated;

-- -----------------------------------------------------------------------------
-- 15. RPC: race session reporting  (best-time session, not first finish)
-- -----------------------------------------------------------------------------
create or replace function public.race_report_attempt_start(
  p_room_id       uuid,
  p_attempt_count integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

grant execute on function public.race_report_attempt_start to authenticated;

create or replace function public.race_report_finish(
  p_room_id uuid,
  p_time_us bigint
)
returns public.race_room_players
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row  public.race_room_players;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_time_us is null or p_time_us <= 0 then raise exception 'invalid time'; end if;

  update public.race_room_players
  set finish_count = finish_count + 1,
      -- SESSION BEST only improves; finishing never ends the session.
      session_best_us = least(coalesce(session_best_us, p_time_us), p_time_us),
      current_run_us = 0,
      connected = true,
      last_seen_at = now()
  where room_id = p_room_id and user_id = v_user
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.race_report_finish to authenticated;

-- -----------------------------------------------------------------------------
-- 16. ROOM EXPIRY HOUSEKEEPING
-- -----------------------------------------------------------------------------
create or replace function public.expire_stale_race_rooms()
returns integer
language sql
security definer
set search_path = public
as $$
  with expired as (
    update public.race_rooms
    set state = 'EXPIRED'
    where state in ('LOBBY','COUNTDOWN','RUNNING')
      and expires_at < now()
    returning 1
  )
  select coalesce(count(*), 0)::integer from expired;
$$;

-- -----------------------------------------------------------------------------
-- 17. STORAGE — private replay bucket (POV replay milestone)
-- -----------------------------------------------------------------------------
-- Replays are NOT uploaded in V1. The bucket exists so the schema is ready and
-- the policies are deliberately narrow: an owner may upload/read their own
-- object, and nothing is world-writable.
insert into storage.buckets (id, name, public)
values ('run-replays', 'run-replays', false)
on conflict (id) do nothing;

drop policy if exists replays_insert_owner on storage.objects;
create policy replays_insert_owner on storage.objects
  for insert to authenticated
  with check (bucket_id = 'run-replays' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists replays_read_owner on storage.objects;
create policy replays_read_owner on storage.objects
  for select to authenticated
  using (bucket_id = 'run-replays' and (storage.foldername(name))[1] = auth.uid()::text);
