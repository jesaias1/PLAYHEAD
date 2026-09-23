-- =============================================================================
-- REALTIME PUBLICATION FIX — the lobby tables were never published.
--
-- ROOT CAUSE OF "READY DOES NOT WORK":
-- `20260922000000_online_v1.sql` enabled RLS and created the policies, but it
-- never added `race_room_players` / `race_rooms` to the `supabase_realtime`
-- publication. Without that, `postgres_changes` subscriptions deliver NOTHING on
-- a default Supabase project.
--
-- The lobby UI depended on those events: the ONLY path that re-read the room's
-- players after the initial join was the `postgres_changes` handler. So a READY
-- update by one client was never observed by either client — the writer never
-- re-read its own row, and the other client was never notified.
--
-- This migration publishes both tables. `replica identity full` makes UPDATE
-- payloads carry the complete row (the `race_rooms` handler reads `payload.new`).
--
-- Apply with:  supabase db push
-- =============================================================================

do $$
begin
  -- Add to the realtime publication, tolerating "already a member".
  begin
    alter publication supabase_realtime add table public.race_room_players;
  exception
    when duplicate_object then null;
    when undefined_object then null;   -- publication missing on some projects
  end;

  begin
    alter publication supabase_realtime add table public.race_rooms;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;

-- UPDATE payloads must include every column, not just the changed ones.
alter table public.race_room_players replica identity full;
alter table public.race_rooms replica identity full;
