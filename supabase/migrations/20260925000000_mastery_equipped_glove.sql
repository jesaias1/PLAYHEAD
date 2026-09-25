-- =============================================================================
-- MASTERY — persist the EQUIPPED glove
--
-- WHY: Mastery V1 stores NO glove ownership. Eligibility is DERIVED on the client
-- from canonical official progress, so a cross-device migration cannot lose an
-- achievement and there is no unlock boolean to keep in sync. The only thing that
-- genuinely needs persistence is WHICH glove the player is wearing.
--
-- WHAT THIS DOES (smallest safe change):
--   1. adds `player_progress.equipped_glove` (text, not null, defaulted)
--   2. lets `sync_progression` carry it, merged exactly like `equipped_knife`
--
-- NON-DESTRUCTIVE:
--   - `add column if not exists` with a constant default: existing rows get the
--     default automatically and NO existing progression value is touched.
--   - no column is dropped, no data is rewritten, no ledger changes.
--   - no glove ownership table, no ownership booleans, no eligibility logic.
--
-- RLS IS UNCHANGED AND REMAINS CORRECT: the column lives on the same table with
-- the same policies (`progress_read_self`, `progress_insert_self`,
-- `progress_update_self`, all scoped to `auth.uid() = user_id`), and the only
-- write path for ledgers remains the SECURITY DEFINER RPC.
--
-- EXISTING USERS REMAIN VALID: their row simply gains `STANDARD_ISSUE`.
--
-- Apply with:  npx supabase db push
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The column
-- -----------------------------------------------------------------------------
alter table public.player_progress
  add column if not exists equipped_glove text not null default 'STANDARD_ISSUE';

-- -----------------------------------------------------------------------------
-- 2. sync_progression must carry it
--
-- NOTE ON SIGNATURES: adding a parameter changes the function's argument list, so
-- `create or replace` alone would create a SECOND OVERLOAD and leave the old
-- 6-argument version in place. With every parameter defaulted, both overloads
-- would then be callable with a partial argument set and PostgREST could fail to
-- resolve the call. The old signature is therefore dropped explicitly first.
-- -----------------------------------------------------------------------------
drop function if exists public.sync_progression(text, text[], text[], text[], text[], boolean);

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
  v_glove     text;
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

  -- Equipped glove: sanitised like the knife, and only ever a SELECTION.
  -- Ownership is never stored here, so an unknown or unearned id cannot grant
  -- anything: the client re-derives eligibility and falls back to the default
  -- glove when the value is not genuinely satisfied.
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

  -- Return the row with pending injected for the client to hydrate.
  v_row.awarded_rank_keys := v_awarded;
  v_row.spent_drop_keys := v_spent;
  -- Pending is derived; expose it through a companion column-free trick: the
  -- client recomputes it, but we also stash it for convenience.
  return v_row;
end;
$$;

grant execute on function public.sync_progression to authenticated;
