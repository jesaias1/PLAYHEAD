-- =============================================================================
-- WORLD RECORD PRESTIGE REWARD — server-authoritative, claimed exactly once
-- =============================================================================
--
-- DESIGN
--
-- ROOT-CAUSE NOTE: previously nothing in the codebase awarded a world-record
-- reward; a prestige knife could only appear via a random Signal Drop, which is
-- why a WR-looking unlock was indistinguishable from a lucky roll. This makes
-- the WORLD RECORD a deliberate, auditable reward.
--
-- The CLIENT NEVER decides it holds a world record:
--   * Only the `submit-run` Edge Function (service role) inserts into
--     `player_world_records`. The table has NO client INSERT/UPDATE policy.
--   * The row is created ONLY when the submitted run's time is strictly better
--     than every other ACCEPTED run on the same canonical map, and only for a
--     valid RANKED run (UNRANKED / overtime runs never qualify).
--   * The client may only CLAIM a row the server already created, and the claim
--     is idempotent: the prestige cosmetic is granted exactly once per account.
--   * Once claimed, the cosmetic lives in `cosmetic_ownership` and the
--     `reward_owned_skin_ids` ledger, so it stays permanently unlocked even if
--     another player later beats the record.
--
-- LIMITATION (stated honestly): WR detection uses only the submitted
-- microsecond time. A browser client can still forge a self-consistent time, so
-- this is cheat RESISTANCE, not proof. Stronger verification is a later pass.
--
-- Apply with:  supabase db push
-- =============================================================================

create extension if not exists "pgcrypto";

create table if not exists public.player_world_records (
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- Stable award key, e.g. 'wr:track_14_kz_ascent:mfp_v1_...'. One per track+map.
  award_id    text not null,
  track_id    text not null,
  run_id      uuid,
  -- The prestige cosmetic the account earns. The client never supplies this.
  cosmetic_id text not null,
  claimed     boolean not null default false,
  awarded_at  timestamptz not null default now(),
  primary key (user_id, award_id)
);

alter table public.player_world_records enable row level security;

drop policy if exists world_records_read_self on public.player_world_records;
create policy world_records_read_self on public.player_world_records
  for select using (auth.uid() = user_id);

-- NO insert/update/delete policy: rows are written only by the service role in
-- the submit-run Edge Function. A browser cannot mint a world-record award.

-- -----------------------------------------------------------------------------
-- Unclaimed awards for the caller (so the client can react after a submission).
-- -----------------------------------------------------------------------------
create or replace function public.my_world_record_awards()
returns table (award_id text, track_id text, cosmetic_id text, run_id uuid)
language sql security definer set search_path = public as $$
  select award_id, track_id, cosmetic_id, run_id
  from public.player_world_records
  where user_id = auth.uid() and claimed = false;
$$;
grant execute on function public.my_world_record_awards to authenticated;

-- -----------------------------------------------------------------------------
-- Claim exactly once. Refuses any award the server did not create for the caller.
-- -----------------------------------------------------------------------------
create or replace function public.claim_world_record_award(p_award_id text)
returns table (cosmetic_id text, granted boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_user     uuid := auth.uid();
  v_row      public.player_world_records;
  v_owned    text[];
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_award_id is null or p_award_id = '' then raise exception 'award id required'; end if;

  select * into v_row
  from public.player_world_records
  where user_id = v_user and award_id = p_award_id
  for update;

  -- No server-created award: the client cannot grant itself a prestige unlock.
  if v_row.award_id is null then
    raise exception 'no world record award for this account';
  end if;

  if v_row.claimed then
    return query select v_row.cosmetic_id, false;
    return;
  end if;

  -- Ownership is a set union: never lose, never duplicate.
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

  return query select v_row.cosmetic_id, true;
end;
$$;
grant execute on function public.claim_world_record_award(text) to authenticated;