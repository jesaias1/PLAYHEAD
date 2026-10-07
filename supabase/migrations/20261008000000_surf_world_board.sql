-- =============================================================================
-- SEPARATE SURF WORLD LEADERBOARD
-- =============================================================================
-- Apply with:  supabase db push
--
-- SURF boards are stored in the existing public.leaderboard_runs table under a
-- NAMESPACED track_id ("surf:<official>:v<version>:<fingerprint>"). This keeps
-- one board table, one RLS policy and one write RPC while guaranteeing that a
-- SURF record can never be mixed with, or ranked against, a NORMAL record:
--
--   * The track_id namespace makes the two boards disjoint by construction.
--   * The SURF generator version is part of the id, so any geometry change
--     automatically opens a fresh board instead of mixing old/new courses.
--
-- REWARD ISOLATION (this migration):
--   * NORMAL rewards (BLACKSTAR world-record prestige, first-Diamond Signal
--     Drops, the DIAMOND achievement marker) are NEVER granted for a namespaced
--     SURF board. A SURF world record is reported as a badge only.
--   * NORMAL progression is untouched: a bare official id still takes the exact
--     same path as before.
--
-- No new table is required. `leaderboard_runs.track_id` has no foreign key to
-- an official-track table, so a namespaced id inserts cleanly.
-- =============================================================================

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
  -- SURF boards are namespaced; they never earn NORMAL rewards.
  v_is_surf   boolean := (p_track_id like 'surf:%');
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

  -- WORLD RECORD decision is computed for the BADGE on both boards, but the
  -- BLACKSTAR prestige AWARD is granted ONLY on a NORMAL board.
  if p_rank <> 'UNRANKED'
     and v_registered
     and (v_prev_best is null or p_time_us < v_prev_best) then
    v_is_wr := true;
    if not v_is_surf then
      v_award_id := 'wr:' || p_track_id || ':' || p_map_fingerprint;
      insert into public.player_world_records (user_id, award_id, track_id, run_id, cosmetic_id)
      values (p_user_id, v_award_id, p_track_id, v_run_id, 'BLACKSTAR')
      on conflict (user_id, award_id) do nothing;
    end if;
  end if;

  -- FIRST-DIAMOND SIGNAL DROP: never for a SURF board (namespaced id does not
  -- match 'track\_%', so award_signal_drop also guards this defensively).
  if not v_is_surf then
    v_drop_id := public.award_signal_drop(p_user_id, p_track_id, p_rank, coalesce(p_reset_count, 0));
    if upper(coalesce(p_rank, '')) = 'DIAMOND'
       and p_track_id like 'track\_%'
       and v_registered
       and coalesce(p_reset_count, 0) = 0 then
      insert into public.awarded_diamond_drop_tracks (user_id, track_id)
      values (p_user_id, p_track_id)
      on conflict (user_id, track_id) do nothing;
    end if;
  end if;

  -- PB / progress: the namespaced surf board keeps its own (track_id,
  -- map_version, map_fingerprint) row, so SURF PBs never overwrite NORMAL ones.
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
