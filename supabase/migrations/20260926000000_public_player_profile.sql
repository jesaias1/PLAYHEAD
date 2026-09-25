-- =============================================================================
-- PLAYER IDENTITY — narrow public profile projection
--
-- WHY THIS EXISTS
--
-- A public profile needs exactly three things that are NOT already public:
--   - the equipped knife
--   - the equipped glove
--   - the display name (already public via profiles_read_all)
--
-- Those live in `public.player_progress`, whose RLS is owner-scoped
-- (`progress_read_self`). This migration does NOT relax that. It adds ONE narrow
-- SECURITY DEFINER read that projects only intentionally public identity fields,
-- so ledgers, drop history, offline queues, auth metadata and private storage
-- paths are never reachable.
--
-- WHAT IS DELIBERATELY NOT RETURNED
--   awarded_rank_keys, spent_drop_keys, reward_owned_skin_ids, pending drops,
--   progression_version, migration timestamps, email, auth provider, session or
--   IP data, replay storage paths, any raw UUID other than the requested key.
--
-- WHAT IS ALREADY PUBLIC AND THEREFORE REUSED
--   - profiles.display_name          (profiles_read_all)
--   - leaderboard_runs.*             (leaderboard_read_all) — accepted public
--                                    runs, which is the honest source for another
--                                    player's PUBLIC mastery and PBs.
--   No second source of truth is introduced.
--
-- SAFETY
--   - additive: creates one function, touches no table, no column and no policy
--   - read-only: a `select`-only SQL function, so it cannot mutate anything
--   - bounded: `limit 64` so it can never be used to dump the table
--   - RLS is unchanged and still correct; ownership of another player's
--     progression remains impossible for any client
--
-- Apply with:  npx supabase db push
-- =============================================================================

create or replace function public.public_profiles(p_user_ids uuid[])
returns table (
  user_id        uuid,
  display_name   text,
  equipped_knife text,
  equipped_glove text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    coalesce(nullif(p.display_name, ''), 'PLAYER'),
    coalesce(nullif(pp.equipped_knife, ''), 'SIGNAL_CYAN'),
    coalesce(nullif(pp.equipped_glove, ''), 'STANDARD_ISSUE')
  from public.profiles p
  left join public.player_progress pp on pp.user_id = p.id
  where p.id = any (coalesce(p_user_ids, '{}'::uuid[]))
  limit 64;
$$;

grant execute on function public.public_profiles(uuid[]) to authenticated;
