-- =============================================================================
-- ARMORY SIGNAL DROPS — server-authoritative acquisition + atomic opening
-- =============================================================================
--
-- WHY
--
-- Previously a Signal Drop was a CLIENT-ONLY ledger: the client decided a rank
-- key was newly awarded, held the unopened drops in localStorage, rolled the
-- random cosmetic locally and pushed the winning id through the generic
-- progression merge (`reward_owned_skin_ids`). The server could not tell a
-- legitimate first-Diamond reward from a hand-crafted client flag, and a local
-- flag or a direct ownership write could mint a premium ARTIFACT id.
--
-- This migration makes awards and openings server-authoritative:
--
--   * A Signal Drop is created ONLY by `accept_leaderboard_run` (service role,
--     reached exclusively through the submit-run Edge Function) when a UNIQUE
--     official Signal Pack track (`track_%`) is finished at DIAMOND for the
--     FIRST time, in a clean (zero-restart) run, for a REGISTERED account.
--   * The unopened drop lives in `signal_drops` (unique per account+track, so a
--     repeated DIAMOND can never pay twice). Opening it is an atomic,
--     serialized, idempotent RPC that picks the winner SERVER-SIDE.
--   * Rare/ARTIFACT skins are weighted to be LESS likely early, no unowned item
--     is ever duplicated while the eligible pool has items, and BLACKSTAR
--     (WR-exclusive) is not in the pool at all.
--
-- LIMITATION (stated honestly): the confirming run's time is still client
-- sourced (the browser reports it), so this is cheat RESISTANCE, not proof. The
-- anti-duplication authority is the unique (account, track) award ledger, not
-- timing verification. A bare client rank key cannot mint: minting requires an
-- ACCEPTED canonical-registry run row.
--
-- Apply with:  supabase db push
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. Catalog mirror (bounded; drift-tested against the client catalog)
--    rarity: STANDARD | RARE | RELIC | ARTIFACT | OVERCLOCKED(legacy)
-- -----------------------------------------------------------------------------
create or replace function public.signal_drop_catalog()
returns jsonb language sql immutable as $$
  select $q$[
    {"id":"ASTRAL","rarity":"RARE"},
    {"id":"VOID_SIGNAL","rarity":"RARE"},
    {"id":"REDSHIFT","rarity":"RELIC"},
    {"id":"PRISM_STATIC","rarity":"RELIC"},
    {"id":"AMBER_SIGNAL","rarity":"STANDARD"},
    {"id":"WHITE_NOISE","rarity":"STANDARD"},
    {"id":"SIGNALISM_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"GOD_RUN_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"PRISM_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"CYBER_ARTIFACT","rarity":"OVERCLOCKED"},
    {"id":"RADIO_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"UNDERWORLD_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"SYNTH_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"DNA_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"MIRRORS_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"PINK_SMOKE_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"BLUE_SMOKE_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"WHITE_SMOKE_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"BLUE_MARBLE_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"ACID_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"RAINBOW_VORTEX_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"BLUE_GEM","rarity":"RARE"},
    {"id":"DROP_GLOVE_CREME","rarity":"STANDARD"},
    {"id":"DROP_GLOVE_PEARL","rarity":"RARE"},
    {"id":"DROP_GLOVE_PEARL_ICE","rarity":"RELIC"},
    {"id":"DROP_GLOVE_SILVERSKIN","rarity":"RARE"},
    {"id":"DROP_GLOVE_CYBER","rarity":"RARE"},
    {"id":"DROP_GLOVE_CYBER_FULL","rarity":"RELIC"},
    {"id":"DROP_GLOVE_CRYSTAL","rarity":"RELIC"},
    {"id":"DROP_GLOVE_SYNTH","rarity":"RELIC"},
    {"id":"DROP_GLOVE_AUREATE","rarity":"RELIC"},
    {"id":"DROP_GLOVE_SYNTH_FULL","rarity":"ARTIFACT"},
    {"id":"DROP_GLOVE_AUREATE_FULL","rarity":"OVERCLOCKED"}
  ]$q$::jsonb;
$$;
grant execute on function public.signal_drop_catalog() to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Drop tables
-- -----------------------------------------------------------------------------
create table if not exists public.signal_drops (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  track_id         text not null,
  track_key        text not null,                   -- unique per account: anti re-award ledger
  rarity           text not null default 'STANDARD',
  status           text not null default 'unopened',-- unopened | opened | spent
  awarded_at       timestamptz not null default now(),
  opened_at        timestamptz,
  awarded_cosmetic text,
  unique (user_id, track_key)
);
create index if not exists signal_drops_user_status_idx on public.signal_drops (user_id, status);

create table if not exists public.signal_drop_open_events (
  id           uuid primary key default gen_random_uuid(),
  drop_id      uuid not null unique references public.signal_drops(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  cosmetic_id  text not null,
  kind         text not null,                       -- KNIFE | GLOVE
  rarity       text not null,
  opened_at    timestamptz not null default now()
);
create index if not exists signal_drop_open_events_user_idx on public.signal_drop_open_events (user_id);

-- -----------------------------------------------------------------------------
-- 2b. Awarded-Diamond ledger + any-drop history.
--
--     `awarded_diamond_drop_tracks` is the SERVER-side anti re-award key: a
--     unique DIAMOND drop may be minted at most once per (account, track),
--     INDEPENDENT of the drop's status. This is what keeps a historical first
--     DIAMOND (migrated as a legacy drop) from paying a SECOND Diamond even
--     after the legacy drop is opened/spent. Keyed on the base track id, so a
--     `legacy:<rank>` migration row occupies the track's slot for free.
-- -----------------------------------------------------------------------------
create table if not exists public.awarded_diamond_drop_tracks (
  user_id   uuid not null references auth.users(id) on delete cascade,
  track_id  text not null,
  awarded_at timestamptz not null default now(),
  primary key (user_id, track_id)
);
alter table public.awarded_diamond_drop_tracks enable row level security;
drop policy if exists awarded_diamond_read_self on public.awarded_diamond_drop_tracks;
create policy awarded_diamond_read_self on public.awarded_diamond_drop_tracks
  for select using (auth.uid() = user_id);
-- NO client INSERT/UPDATE policy: server-authored only.

-- -----------------------------------------------------------------------------
-- 2c. History helper: is there ANY server record of a signal drop for this
--     account (unopened, opened or spent)? Used by the ownership guard to keep
--     a disputed cosmetic owned after an authoritative event, and to reconcile
--     the client without ever removing legitimate ownership.
-- -----------------------------------------------------------------------------
create or replace function public.has_signal_drop_history(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.signal_drops d where d.user_id = p_user_id)
$$;
-- Internal predicate (arbitrary user id): owner-only, never a client callable.
revoke all on function public.has_signal_drop_history(uuid) from public, anon, authenticated;

alter table public.signal_drops enable row level security;
alter table public.signal_drop_open_events enable row level security;

drop policy if exists signal_drops_read_self on public.signal_drops;
create policy signal_drops_read_self on public.signal_drops
  for select using (auth.uid() = user_id);
drop policy if exists signal_drop_open_events_read_self on public.signal_drop_open_events;
create policy signal_drop_open_events_read_self on public.signal_drop_open_events
  for select using (auth.uid() = user_id);
-- NO client INSERT/UPDATE/DELETE policy: rows are written only by the SECURITY
-- DEFINER RPCs below or by the service-role Edge Function.

-- -----------------------------------------------------------------------------
-- 3. Eligible pool: KNIVES first, GLOVES only once every knife is owned.
--    Weighting makes rare/ARTIFACT less likely early.
-- -----------------------------------------------------------------------------
create or replace function public.signal_drop_pool(p_user_id uuid)
returns table (cosmetic_id text, category text, rarity text, weight numeric)
language sql stable security definer set search_path = public as $$
  -- ALIAS NOTE: jsonb_to_recordset exposes the record columns as `id`/`rarity`
  -- (NOT e.k/e.v — the earlier `e.k`/`e.v` was an invalid reference).
  with unowned as (
    select e.id as cosmetic_id, e.rarity as rarity
    from jsonb_to_recordset(public.signal_drop_catalog()) as e(id text, rarity text)
    where not exists (
      select 1 from public.cosmetic_ownership o
      where o.user_id = p_user_id and o.cosmetic_id = e.id
    )
  ),
  knives as (
    select u.cosmetic_id, u.rarity from unowned u
    where u.cosmetic_id not like 'DROP_GLOVE_%'
  ),
  chosen as (
    select k.cosmetic_id, 'KNIFE'::text as category, k.rarity from knives k
    union all
    select u.cosmetic_id, 'GLOVE'::text as category, u.rarity
    from unowned u
    where u.cosmetic_id like 'DROP_GLOVE_%'
      and not exists (select 1 from knives)
  )
  select
    c.cosmetic_id,
    c.category,
    c.rarity,
    (case c.category
       when 'KNIFE' then case c.rarity
         when 'ARTIFACT' then 12 when 'OVERCLOCKED' then 4 when 'RELIC' then 26
         when 'RARE' then 50 else 100 end
       else case c.rarity
         when 'ARTIFACT' then 14 when 'OVERCLOCKED' then 5 when 'RELIC' then 30
         when 'RARE' then 55 else 110 end
     end)::numeric as weight
  from chosen c;
$$;
-- LOCKDOWN: takes an arbitrary user id and exposes that account's UNOWNED pool.
-- It is called ONLY from the SECURITY DEFINER awarding/open functions (same owner),
-- so no client role may execute it.
revoke all on function public.signal_drop_pool(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3b. Is one catalog cosmetic a LEGITIMATE server-owned entry for this account?
--     Used by the cosmetic-ownership guard to tell a real Signal Drop / WR /
--     progression award from a hand-crafted client insert. An id counts as
--     legitimate when the account already owned it BEFORE this deploy, when a
--     recorded open-event proves it, or when a WR award exists for it.
-- -----------------------------------------------------------------------------
create or replace function public.signal_drop_owned_cosmetic(p_user_id uuid, p_cosmetic_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_cosmetic_id is not null
     and p_cosmetic_id <> ''
     and (
       exists (
         select 1 from public.signal_drop_open_events e
         where e.user_id = p_user_id and e.cosmetic_id = p_cosmetic_id
       )
       or exists (
         select 1 from public.player_world_records w
         where w.user_id = p_user_id and w.cosmetic_id = p_cosmetic_id
       )
       or public.has_historical_reserved_ownership(p_user_id, p_cosmetic_id)
     )
$$;
-- Internal predicate (arbitrary user id): owner-only, never a client callable.
revoke all on function public.signal_drop_owned_cosmetic(uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Mint path — SERVICE ROLE ONLY (called by accept_leaderboard_run)
--    Awards at most one drop per (account, unique official track).
-- -----------------------------------------------------------------------------
create or replace function public.award_signal_drop(
  p_user_id uuid,
  p_track_id text,
  p_rank text,
  p_reset_count integer
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := coalesce(p_user_id, auth.uid());
  v_id uuid;
  v_ledger uuid;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_track_id is null or p_track_id not like 'track\_%' then return null; end if;
  if upper(coalesce(p_rank, '')) <> 'DIAMOND' then return null; end if;
  -- A clean run: DIAMOND requires zero resets on the client. The server has this
  -- field, so it enforces at least that part of the rank contract itself.
  if coalesce(p_reset_count, 0) <> 0 then return null; end if;
  if not exists (select 1 from public.accounts a where a.user_id = v_user) then return null; end if;

  -- Reserve the (account, track) DIAMOND award FIRST. If a historical first
  -- DIAMOND already occupied it (legacy migration / earlier award), this returns
  -- NULL and NO new drop is minted — the ledger is the anti-re-award authority.
  insert into public.awarded_diamond_drop_tracks (user_id, track_id)
  values (v_user, p_track_id)
  on conflict (user_id, track_id) do nothing
  returning user_id into v_ledger;
  if v_ledger is null then
    return null;   -- this track's unique DIAMOND drop already exists
  end if;

  -- COLLECTION COMPLETE: the first-Diamond ACHIEVEMENT is already recorded in
  -- awarded_diamond_drop_tracks above, but an unopenable drop would be a lie.
  -- When BOTH eligible pools are exhausted, mint NO useless unopened drop.
  if not exists (select 1 from public.signal_drop_pool(v_user)) then
    return null;
  end if;

  perform set_config('playhead.authorized_drop_write', '1', true);
  insert into public.signal_drops (user_id, track_id, track_key, rarity, status)
  values (v_user, p_track_id, p_track_id, 'STANDARD', 'unopened')
  on conflict (user_id, track_key) do nothing
  returning id into v_id;
  perform set_config('playhead.authorized_drop_write', '0', true);

  return v_id;   -- null when this account already earned this track's DIAMOND drop
exception when others then
  perform set_config('playhead.authorized_drop_write', '0', true);
  raise;
end;
$$;
-- Not granted to clients: only the definer (accept_leaderboard_run) may call it.
revoke all on function public.award_signal_drop(uuid, text, text, integer) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Atomic, serialized, idempotent OPEN
-- -----------------------------------------------------------------------------
create or replace function public.open_signal_drop(p_drop_id uuid)
returns table (
  drop_id uuid, track_id text, cosmetic_id text, kind text, rarity text,
  already_opened boolean, collection_complete boolean
)
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_drop public.signal_drops;
  v_ex public.signal_drop_open_events;
  v_choice text;
  v_kind text;
  v_rarity text;
  v_remaining integer;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_drop_id is null then raise exception 'drop id required'; end if;

  -- SERIALIZE this account's openings: a retry / second device cannot open the
  -- same unopened drop twice, and cannot double-spend a concurrent request.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 881));

  select * into v_drop from public.signal_drops d
    where d.id = p_drop_id and d.user_id = v_user for update;
  if v_drop.id is null then raise exception 'drop not found or not owned by this account'; end if;

  select * into v_ex from public.signal_drop_open_events e where e.drop_id = v_drop.id;
  if v_ex.id is not null then
    -- Idempotent replay: return the ALREADY DETERMINED result. Never reroll.
    select count(*) into v_remaining from public.signal_drop_pool(v_user);
    return query select v_drop.id, v_drop.track_id, v_ex.cosmetic_id, v_ex.kind, v_ex.rarity, true,
      (v_remaining = 0);
    return;
  end if;

  if v_drop.status = 'spent' then
    return query select v_drop.id, v_drop.track_id, null::text, null::text, null::text, true, true;
    return;
  end if;

  select count(*) into v_remaining from public.signal_drop_pool(v_user);
  if v_remaining = 0 then
    -- BOTH eligible pools genuinely exhausted: mark spent, award nothing.
    -- (The first-Diamond marker already lives in awarded_diamond_drop_tracks.)
    update public.signal_drops d set status = 'spent' where d.id = v_drop.id;
    return query select v_drop.id, v_drop.track_id, null::text, null::text, null::text, false, true;
    return;
  end if;

  -- Weighted choice over the UNOWNED, class-aware pool. `-ln(1-random())/weight`
  -- is an exact weighted sample; it needs no temporary table and no client RNG.
  select p.cosmetic_id, p.category, p.rarity
    into v_choice, v_kind, v_rarity
  from public.signal_drop_pool(v_user) p
  order by -ln(1 - random()) / p.weight
  limit 1;

  -- Persist BEFORE any reveal can render: a skip / close / reload cannot reroll.
  perform set_config('playhead.authorized_drop_write', '1', true);
  insert into public.signal_drop_open_events (drop_id, user_id, cosmetic_id, kind, rarity)
  values (v_drop.id, v_user, v_choice, v_kind, v_rarity);
  update public.signal_drops d
    set status = 'opened', opened_at = now(), awarded_cosmetic = v_choice
    where d.id = v_drop.id;
  perform set_config('playhead.authorized_drop_write', '0', true);

  -- The win is now RECORDED. Granting ownership keeps the authorized flag on
  -- through the actual INSERT so the reserved/drop guard admits only this
  -- server-decided winner, and drops it again immediately afterwards.
  perform set_config('playhead.authorized_cosmetic_write', '1', true);
  insert into public.cosmetic_ownership (user_id, cosmetic_id, unlock_source)
  values (v_user, v_choice, 'SIGNAL_DROP')
  on conflict do nothing;
  perform set_config('playhead.authorized_cosmetic_write', '0', true);

  -- Mirror into the legacy ownership ledger so the existing hydrate path shows it.
  perform set_config('playhead.authorized_progress_write', '1', true);
  insert into public.player_progress (user_id) values (v_user) on conflict (user_id) do nothing;
  update public.player_progress
    set reward_owned_skin_ids = (
          select coalesce(array_agg(distinct c), '{}')
          from unnest(coalesce(reward_owned_skin_ids, '{}') || array[v_choice]) as c
          where c is not null and c <> ''
        ),
        updated_at = now()
    where user_id = v_user;
  perform set_config('playhead.authorized_progress_write', '0', true);

  select count(*) into v_remaining from public.signal_drop_pool(v_user);
  return query select v_drop.id, v_drop.track_id, v_choice, v_kind, v_rarity, false, (v_remaining = 0);
exception when others then
  -- ALWAYS drop the privileged flags before re-raising, so a failed open can
  -- never leak a widened write context into a later statement in this session.
  perform set_config('playhead.authorized_drop_write', '0', true);
  perform set_config('playhead.authorized_cosmetic_write', '0', true);
  perform set_config('playhead.authorized_progress_write', '0', true);
  raise;
end;
$$;grant execute on function public.open_signal_drop(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Client-safe reads
-- -----------------------------------------------------------------------------
create or replace function public.my_signal_drops()
returns table (id uuid, track_id text, rarity text, status text, awarded_at timestamptz)
language sql security definer set search_path = public as $$
  -- Qualified: OUT column names (id/track_id/...) would otherwise be ambiguous.
  select d.id, d.track_id, d.rarity, d.status, d.awarded_at
  from public.signal_drops d
  where d.user_id = auth.uid() and d.status = 'unopened'
  order by d.awarded_at;
$$;
grant execute on function public.my_signal_drops() to authenticated;

create or replace function public.my_signal_drop_owned()
returns text[] language sql security definer set search_path = public as $$
  select coalesce(array_agg(distinct e.cosmetic_id), '{}')
  from public.signal_drop_open_events e where e.user_id = auth.uid();
$$;
grant execute on function public.my_signal_drop_owned() to authenticated;

create or replace function public.my_signal_drop_spent()
returns text[] language sql security definer set search_path = public as $$
  select coalesce(array_agg(distinct d.track_id), '{}')
  from public.signal_drops d
  where d.user_id = auth.uid() and d.status in ('opened', 'spent');
$$;
grant execute on function public.my_signal_drop_spent() to authenticated;
-- Authoritative DROP-ID ledger for THIS account, so a client can REPLACE its
-- pending set (a drop opened on another device disappears) instead of only
-- unioning. `opened` includes spent drops, so a replayed id can never re-award.
create or replace function public.my_signal_drop_ledger()
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'unopened', coalesce((
      select jsonb_agg(d.id order by d.awarded_at)
      from public.signal_drops d
      where d.user_id = auth.uid() and d.status = 'unopened'
    ), '[]'::jsonb),
    'opened', coalesce((
      select jsonb_agg(x.id)
      from (
        select distinct d.id from public.signal_drops d
        where d.user_id = auth.uid() and d.status in ('opened', 'spent')
      ) x
    ), '[]'::jsonb),
    'tracks', coalesce((
      select jsonb_agg(t.track_id order by t.track_id)
      from public.awarded_diamond_drop_tracks t
      where t.user_id = auth.uid()
    ), '[]'::jsonb)
  );
$$;
grant execute on function public.my_signal_drop_ledger() to authenticated;

-- -----------------------------------------------------------------------------
-- 6b. LEGITIMATE-OWNERSHIP SNAPSHOT (Signal Drop widening of the reserved set).
--     Captures every cosmetic an account legitimately owns BEFORE this deploy,
--     so the widened ownership guard can always accept a pre-existing entry.
--     Idempotent: re-running only adds rows.
-- -----------------------------------------------------------------------------
insert into public.pre_migration_cosmetic_snapshot (user_id, cosmetic_id)
select distinct o.user_id, o.cosmetic_id
from public.cosmetic_ownership o
where o.cosmetic_id is not null and o.cosmetic_id <> ''
on conflict do nothing;

insert into public.pre_migration_cosmetic_snapshot (user_id, cosmetic_id)
select distinct pp.user_id, c
from public.player_progress pp, unnest(coalesce(pp.reward_owned_skin_ids, '{}')) as c
where c is not null and c <> ''
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 7. Conservative, KEYED migration of PRE-EXISTING legitimate unopened drops.
--
--    ROOT-CAUSE NOTE: the earlier version read `player_progress.pending_drop_ranks`,
--    a column that has NEVER existed. Unopened drops were always DERIVED:
--    `progression_pending_ranks(awarded_rank_keys, spent_drop_keys)` is the
--    multiset (awarded - spent). This derives the remaining UNIQUE award KEYS
--    (not distinct ranks — two GOLD awards on different tracks must stay TWO
--    drops), and mints exactly one legacy drop per key.
--
--    - A DIAMOND award records its base track in `awarded_diamond_drop_tracks`
--      (even when already SPENT), so a later server DIAMOND for that track can
--      never mint a SECOND Diamond drop even though the legacy drop was opened.
--    - A LOWER-rank award (BRONZE/SILVER/GOLD) also mints a legacy provenance
--      drop so no legitimately-earned, unopened pre-deploy reward is lost.
--    - `spent_drop_keys` becomes ORIGINAL spent UNION newly migrated keys, so an
--      already-spent key can never be resurrected into a fresh award.
-- -----------------------------------------------------------------------------
do $mig$
declare
  v_pp public.player_progress;
begin
  -- ---------------------------------------------------------------------------
  -- 7a. HISTORICAL DIAMOND LEDGER (independent of spend state).
  --
  --     Record the (account, base-track) slot for EVERY historical :DIAMOND
  --     award key — INCLUDING ones already spent. A spent first-Diamond must
  --     still occupy the track's unique-DIAMOND slot so a later server DIAMOND
  --     for that track can never mint a SECOND Diamond drop. Keyed on the base
  --     track id, which is what `awarded_diamond_drop_tracks` guards.
  -- ---------------------------------------------------------------------------
  insert into public.awarded_diamond_drop_tracks (user_id, track_id)
  select distinct pp.user_id, split_part(k, ':', 1)
  from public.player_progress pp
  cross join lateral unnest(coalesce(pp.awarded_rank_keys, '{}')) as k
  where upper(split_part(k, ':', 2)) = 'DIAMOND'
    and split_part(k, ':', 1) <> ''
  on conflict (user_id, track_id) do nothing;

  -- ---------------------------------------------------------------------------
  -- 7b. KEYED legacy drop migration.
  --
  --     DERIVED unopened drops = awarded_rank_keys MINUS spent_drop_keys, as a
  --     MULTISET. The migration mints exactly ONE legacy drop per DISTINCT
  --     original award KEY that was not already spent, so two GOLD awards on two
  --     different tracks produce TWO drops (the old rank-only `legacy:<rank>`
  --     key collapsed them). `track_key` is `legacy:` || original_key, so the
  --     per-account unique constraint makes a re-run idempotent.
  --
  --     `track_id` is the original key's BASE TRACK when the key is an official
  --     `track_%` award (so it occupies the same slot the server uses), and a
  --     conservative `legacy:` string otherwise. No rank-only ids are minted.
  --
  --     spent_drop_keys is written as ORIGINAL spent UNION newly migrated keys —
  --     it is never rewritten from scratch, so an already-spent key can never be
  --     resurrected into a fresh award.
  -- ---------------------------------------------------------------------------
  for v_pp in select * from public.player_progress loop
    insert into public.signal_drops (user_id, track_id, track_key, rarity, status)
    select distinct
      v_pp.user_id,
      case when u.k like 'track\_%' then split_part(u.k, ':', 1) else 'legacy:' || u.k end,
      'legacy:' || u.k,
      'STANDARD',
      'unopened'
    from (
      select distinct k
      from unnest(coalesce(v_pp.awarded_rank_keys, '{}')) as k
      where k <> ''
        and not (k = any (coalesce(v_pp.spent_drop_keys, '{}')))
    ) as u
    on conflict (user_id, track_key) do nothing;

    update public.player_progress pp
    set spent_drop_keys = (
          select coalesce(array_agg(distinct s), '{}')
          from unnest(
            coalesce(pp.spent_drop_keys, '{}') || coalesce((
              select array_agg(distinct k)
              from unnest(coalesce(pp.awarded_rank_keys, '{}')) as k
              where k <> ''
                and not (k = any (coalesce(pp.spent_drop_keys, '{}')))
            ), '{}')
          ) as s
          where s is not null and s <> ''
        ),
        updated_at = now()
    where pp.user_id = v_pp.user_id;
  end loop;
end
$mig$;
--
--    ROOT-CAUSE NOTE: every eligible Signal Drop cosmetic is also an ordinary
--    progression cosmetic, so the EXISTING `cosmetic_ownership` INSERT policy and
--    `sync_progression_impl` / `grant_progression_events_impl` could mint the very
--    same ids a Signal Drop is supposed to award. The old `is_reserved_cosmetic`
--    guarded only BLACKSTAR. The guard below closes that hole for ALL eligible
--    Signal Drop cosmetics WITHOUT breaking ordinary saves: it snapshots what the
--    account legitimately owns, and admits a new id only when the SERVER recorded
--    it (Signal Drop win, WORLD_RECORD, or historical pre-migration ownership).
-- -----------------------------------------------------------------------------
create or replace function public.signal_drop_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('playhead.authorized_drop_write', true) = '1' then return new; end if;
  if auth.uid() is null then return new; end if;   -- service role
  raise exception 'signal drops are server-authored';
end;
$$;
drop trigger if exists signal_drops_guard on public.signal_drops;
create trigger signal_drops_guard before insert on public.signal_drops
  for each row execute function public.signal_drop_guard();
drop trigger if exists signal_drop_open_events_guard on public.signal_drop_open_events;
create trigger signal_drop_open_events_guard before insert on public.signal_drop_open_events
  for each row execute function public.signal_drop_guard();

-- True when the id is a Signal Drop cosmetic this account may legitimately own.
-- (Historical snapshot is folded into signal_drop_owned_cosmetic.)
create or replace function public.is_signal_drop_cosmetic(p_cosmetic_id text)
returns boolean language sql immutable as $$
  select exists (
    select 1
    from jsonb_to_recordset(public.signal_drop_catalog()) as e(id text, rarity text)
    where upper(e.id) = upper(coalesce(p_cosmetic_id, ''))
  )
$$;
-- Internal: keep it off the client surface.
revoke all on function public.is_signal_drop_cosmetic(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- WIDENED cosmetic_ownership guard: preserves the reserved-reward rules and adds
-- the Signal Drop rule. Runs INSTEAD of the authority-pass version (this
-- migration is later), so its idempotent replay/ownership checks are preserved.
-- -----------------------------------------------------------------------------
create or replace function public.cosmetic_ownership_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('playhead.authorized_cosmetic_write', true) = '1' then return new; end if;
  if auth.uid() is null then return new; end if;   -- service-role context

  -- 1. WORLD_RECORD provenance stays server-authoritative (unchanged).
  if upper(coalesce(new.unlock_source, '')) = 'WORLD_RECORD' then
    raise exception 'WORLD_RECORD provenance is server-authoritative';
  end if;

  -- 2. Reserved prestige rewards (BLACKSTAR / WR:*) keep their historical rules.
  if public.is_reserved_cosmetic(new.cosmetic_id) then
    if public.has_historical_reserved_ownership(new.user_id, new.cosmetic_id) then
      return new;
    end if;
    if exists (
      select 1 from public.player_world_records w
      where w.user_id = new.user_id and w.cosmetic_id = new.cosmetic_id
    ) then
      return new;
    end if;
    if public.has_signal_drop_history(new.user_id)
       and public.signal_drop_owned_cosmetic(new.user_id, new.cosmetic_id) then
      return new;
    end if;
    raise exception 'cosmetic "%" is a reserved reward and cannot be granted directly', new.cosmetic_id;
  end if;

  -- 3. Signal Drop cosmetics: idempotent re-insert of an entry the account can
  --    already legitimately own is harmless; a FRESH client-claimed one is not.
  if public.is_signal_drop_cosmetic(new.cosmetic_id) then
    -- The account ALREADY owns it (idempotent replay of a legitimate grant).
    if exists (
      select 1 from public.cosmetic_ownership o
      where o.user_id = new.user_id and o.cosmetic_id = new.cosmetic_id
    ) then
      return new;
    end if;
    -- Pre-migration ownership, a recorded drop win, or a WR award proves it.
    if public.signal_drop_owned_cosmetic(new.user_id, new.cosmetic_id) then
      return new;
    end if;
    raise exception 'cosmetic "%" is a Signal Drop reward and cannot be granted directly', new.cosmetic_id;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- WIDENED player_progress guard: same reserved logic, plus the Signal Drop rule
-- for a NEWLY ADDED id. Pre-existing membership (old array) is always preserved,
-- so ordinary equipment saves and startup adoption keep working.
-- -----------------------------------------------------------------------------
create or replace function public.player_progress_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_new_id  text;
  v_old_ids text[] := case when tg_op = 'UPDATE' then coalesce(old.reward_owned_skin_ids, '{}') else '{}'::text[] end;
  v_has_drop_history boolean;
begin
  if current_setting('playhead.authorized_progress_write', true) = '1' then return new; end if;
  if auth.uid() is null then return new; end if;

  v_has_drop_history := public.has_signal_drop_history(new.user_id);

  -- NEW ids vs the previous array. Pre-existing legitimate ownership stays valid.
  for v_new_id in
    select c from unnest(coalesce(new.reward_owned_skin_ids, '{}')) as c
    where c is not null and c <> ''
      and not exists (select 1 from unnest(v_old_ids) as o where o = c)
  loop
    if public.is_reserved_cosmetic(v_new_id) then
      if not public.has_historical_reserved_ownership(new.user_id, v_new_id)
         and not exists (
           select 1 from public.player_world_records w
           where w.user_id = new.user_id and w.cosmetic_id = v_new_id
         )
         and not (v_has_drop_history and public.signal_drop_owned_cosmetic(new.user_id, v_new_id)) then
        raise exception 'reserved reward "%" cannot be written directly', v_new_id;
      end if;
    elsif public.is_signal_drop_cosmetic(v_new_id) then
      if not public.signal_drop_owned_cosmetic(new.user_id, v_new_id) then
        raise exception 'Signal Drop reward "%" cannot be written directly', v_new_id;
      end if;
    end if;
  end loop;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- WIDENED event-drain filter: a client `own_cosmetic` event may not introduce a
-- fresh Signal Drop cosmetic either. (Body is the authority-pass impl with the
-- Signal Drop branch added; kept here so the deployed definition is final.)
-- -----------------------------------------------------------------------------
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
  v_has_drop_history boolean;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  insert into public.player_progress (user_id) values (v_user)
  on conflict (user_id) do nothing;
  select * into v_row from public.player_progress where user_id = v_user for update;

  v_awarded := coalesce(v_row.awarded_rank_keys, '{}');
  v_owned := coalesce(v_row.reward_owned_skin_ids, '{}');
  v_has_drop_history := public.has_signal_drop_history(v_user);

  for v_event in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    v_kind := v_event->>'kind';
    v_key := v_event->>'key';
    if v_kind = 'award_rank_key' and v_key is not null then
      if not (v_key = any (v_awarded)) then
        v_awarded := array_append(v_awarded, v_key);
      end if;
    elsif v_kind = 'own_cosmetic' and v_key is not null then
      -- RESERVED-INPUT FILTER (unchanged).
      if public.is_reserved_cosmetic(v_key)
         and not public.has_historical_reserved_ownership(v_user, v_key)
         and not exists (
           select 1 from public.player_world_records w
           where w.user_id = v_user and w.cosmetic_id = v_key
         ) then
        continue;
      end if;
      -- SIGNAL DROP FILTER: a fresh Signal Drop cosmetic is server-awarded only.
      if public.is_signal_drop_cosmetic(v_key)
         and not public.signal_drop_owned_cosmetic(v_user, v_key) then
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
revoke all on function public.grant_progression_events_impl(jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- WIDENED sync merge filter: the SECURITY DEFINER `sync_progression` wrapper
-- (which does NOT itself set the flags) delegates here, and `_impl` does the
-- write with no reserved/drop input filter of its own. This version adds the
-- Signal Drop filter alongside the reserved filter while preserving every other
-- behavior (awarded keys union, equipped cosmetic, first migration, gloves).
-- -----------------------------------------------------------------------------
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
  v_has_drop_history boolean;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  insert into public.player_progress (user_id) values (v_user)
  on conflict (user_id) do nothing;

  select * into v_row from public.player_progress where user_id = v_user for update;
  v_has_drop_history := public.has_signal_drop_history(v_user);

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
    end loop;
  end if;

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
          and (
            not public.is_signal_drop_cosmetic(c)
            or public.signal_drop_owned_cosmetic(v_user, c)
          )
      ), '{}')
    ) as c
    where c is not null and c <> ''
  );

  insert into public.cosmetic_ownership (user_id, cosmetic_id, unlock_source)
  select v_user, c, 'PROGRESSION' from unnest(v_owned) as c
  on conflict (user_id, cosmetic_id) do nothing;

  -- RUNTIME SYNC must NEVER mint client-reported legacy drops. The legitimate
  -- pre-deploy unopened drops are converted ONCE, server-side, by section 7 of
  -- this migration (KEYED over `awarded_rank_keys` minus `spent_drop_keys`). A
  -- client-supplied `p_pending_drop_ranks` is therefore IGNORED: a local flag can
  -- never create a new award key, a `legacy:<rank>` row, or a drop.
  v_spent := coalesce(v_row.spent_drop_keys, '{}');

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
revoke all on function public.sync_progression_impl(text, text[], text[], text[], text[], boolean, text) from public, anon, authenticated;
-- 9. accept_leaderboard_run — same contract, now also mints the first-Diamond
--    Signal Drop for THIS account and THIS unique track (idempotent).
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
  v_drop_id   uuid := null;
begin
  if p_user_id is null then raise exception 'accept_leaderboard_run requires a user id'; end if;
  if p_time_us is null or p_time_us <= 0 then raise exception 'invalid time'; end if;

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
    insert into public.player_world_records (user_id, award_id, track_id, run_id, cosmetic_id)
    values (p_user_id, v_award_id, p_track_id, v_run_id, 'BLACKSTAR')
    on conflict (user_id, award_id) do nothing;
  end if;

  -- FIRST-DIAMOND SIGNAL DROP: server-side, one per (account, unique track).
  -- Never granted for lower ranks / repeated DIAMOND (unique key) / custom audio
  -- (custom tracks are not 'track_%') / unregistered accounts.
  v_drop_id := public.award_signal_drop(p_user_id, p_track_id, p_rank, coalesce(p_reset_count, 0));
  -- The ACHIEVEMENT marker is recorded independently of the drop, so a first
  -- DIAMOND still counts (and still blocks a later award) during collection
  -- complete / for a track whose drop was already consumed.
  if upper(coalesce(p_rank, '')) = 'DIAMOND'
     and p_track_id like 'track\_%'
     and v_registered
     and coalesce(p_reset_count, 0) = 0 then
    insert into public.awarded_diamond_drop_tracks (user_id, track_id)
    values (p_user_id, p_track_id)
    on conflict (user_id, track_id) do nothing;
  end if;

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
    'is_personal_best', v_is_pb,
    'signal_drop_id', v_drop_id
  );
end;
$$;
revoke all on function public.accept_leaderboard_run(uuid, text, text, integer, text, bigint, text, text, text, text, integer, text, text, integer, integer) from public, anon, authenticated;
