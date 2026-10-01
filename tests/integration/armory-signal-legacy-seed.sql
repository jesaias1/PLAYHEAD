-- =============================================================================
-- ARMORY SIGNAL DROPS — PRE-MIGRATION LEGACY SEED (run BEFORE the migration)
-- =============================================================================
-- Run order for the combined dry-run:
--   1. this seed            (creates pre-deploy player_progress state)
--   2. supabase/migrations/20261001000000_armory_signal_drops.sql
--   3. tests/integration/armory-signal-db-acceptance.sql  (BEGIN/ROLLBACK)
--
-- The acceptance file only asserts the conversion when this sentinel exists, so
-- the acceptance file is also valid standalone. Everything here is disposable:
-- wrap the whole dry-run in ONE outer BEGIN/ROLLBACK if you want zero residue.
-- =============================================================================

insert into auth.users (id) values ('aaaaaaaa-0000-4000-8000-0000000000aa')
on conflict do nothing;
insert into public.accounts (user_id, username, username_norm)
values ('aaaaaaaa-0000-4000-8000-0000000000aa', 'it_legacy_seed', 'it_legacy_seed')
on conflict do nothing;

-- Two DISTINCT unspent GOLD award keys (must become TWO drops, not one
-- collapsed 'legacy:GOLD' row), one SPENT GOLD, an unspent DIAMOND, a SPENT
-- DIAMOND and a lower-rank BRONZE.
insert into public.player_progress (
  user_id, awarded_rank_keys, spent_drop_keys, reward_owned_skin_ids
) values (
  'aaaaaaaa-0000-4000-8000-0000000000aa',
  array['track_01_legacy:GOLD','track_02_legacy:GOLD','track_03_legacy:GOLD',
        'track_05_legacy:DIAMOND','track_06_legacy:DIAMOND','track_07_legacy:BRONZE'],
  array['track_03_legacy:GOLD','track_05_legacy:DIAMOND'],
  '{}'
)
on conflict (user_id) do nothing;
