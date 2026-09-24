/**
 * ONLINE LEADERBOARD + PB GHOST INTEGRATION.
 *
 * Covers the two integration defects found in human testing:
 *
 *   1. The results screen claimed "ONLINE SUBMISSION COMING LATER" while real
 *      submission existed but was never wired up. Feedback must now track the
 *      REAL `SubmitOutcome` and never claim a submission the server has not
 *      confirmed.
 *   2. A legacy PB with no replay (SIGNAL DRIFT) could never race a ghost, and a
 *      slower completion's replay was discarded entirely. Ghost availability is
 *      now three distinct, non-conflated states, and the fastest RECORDED replay
 *      is kept independently of the PB.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { LeaderboardService } from '../src/online/LeaderboardService';
import type { RunSubmission } from '../src/online/LeaderboardService';
import { OnlineClient } from '../src/online/supabaseClient';
import { AuthService } from '../src/online/AuthService';
import { OFFICIAL_MAP_REGISTRY } from '../src/online/OfficialMapRegistry';
import { SignalPackCatalog } from '../src/audio/SignalPackCatalog';
import {
  LeaderboardManager,
  classifyGhostAvailability
} from '../src/leaderboard/LeaderboardManager';
import {
  SUBMISSION_FEEDBACK_TEXT,
  SubmissionState,
  isRetryableSubmission,
  isSubmittedToWorld
} from '../src/leaderboard/SubmissionFeedback';
import type { RunResults } from '../src/player/PlayerStats';

const repoRoot = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const ALL_STATES: SubmissionState[] = [
  'SUBMITTING',
  'WORLD_ENTRY_SUBMITTED',
  'WORLD_PB_UPDATED',
  'WORLD_ENTRY_QUEUED_OFFLINE',
  'WORLD_SUBMISSION_FAILED',
  'RUN_INELIGIBLE_NON_CANONICAL',
  'RUN_INELIGIBLE_UNRANKED',
  'RUN_INELIGIBLE_OVERTIME',
  'NOT_OFFICIAL'
];

function runResults(completionTime: number): RunResults {
  return {
    completionTime,
    targetTime: 60,
    syncDelta: 0,
    maxSpeed: 20,
    averageSpeed: 14,
    strafeEfficiency: 80,
    fallsCount: 0,
    restartsCount: 0,
    rank: 'GOLD',
    score: 1000
  };
}

// ---------------------------------------------------------------------------
// 1. Stale copy is gone and feedback tracks the real outcome
// ---------------------------------------------------------------------------

describe('World submission feedback', () => {
  it('removes every "coming later" style string from production UI', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) {
          const src = fs.readFileSync(full, 'utf8');
          if (/COMING LATER|COMING SOON|SUBMISSION DISABLED|LEADERBOARD ENTRY SAVED/i.test(src)) {
            offenders.push(path.relative(repoRoot, full));
          }
        }
      }
    };
    walk(path.join(repoRoot, 'src'));
    expect(offenders).toEqual([]);
  });

  it('maps every state to explicit, non-committal copy', () => {
    for (const state of ALL_STATES) {
      const text = SUBMISSION_FEEDBACK_TEXT[state];
      expect(text, state).toBeTruthy();
      expect(text, state).not.toMatch(/coming|later|soon|disabled/i);
    }
    expect(SUBMISSION_FEEDBACK_TEXT.WORLD_ENTRY_SUBMITTED).toMatch(/SUBMITTED/);
    expect(SUBMISSION_FEEDBACK_TEXT.WORLD_PB_UPDATED).toMatch(/WORLD PB/);
    expect(SUBMISSION_FEEDBACK_TEXT.WORLD_ENTRY_QUEUED_OFFLINE).toMatch(/QUEUED/);
    expect(SUBMISSION_FEEDBACK_TEXT.WORLD_ENTRY_QUEUED_OFFLINE).toMatch(/OFFLINE/);
    expect(SUBMISSION_FEEDBACK_TEXT.WORLD_SUBMISSION_FAILED).toMatch(/FAILED/);
    expect(SUBMISSION_FEEDBACK_TEXT.RUN_INELIGIBLE_NON_CANONICAL).toMatch(/NON-CANONICAL/);
  });

  it('never claims a submission before the server confirms it', () => {
    // SUBMITTING is its own state and is NOT a success state.
    expect(isSubmittedToWorld('SUBMITTING')).toBe(false);
    expect(isSubmittedToWorld('WORLD_ENTRY_SUBMITTED')).toBe(true);
    expect(isSubmittedToWorld('WORLD_PB_UPDATED')).toBe(true);
    // Queued and failed are retryable, not successes.
    expect(isRetryableSubmission('WORLD_ENTRY_QUEUED_OFFLINE')).toBe(true);
    expect(isRetryableSubmission('WORLD_SUBMISSION_FAILED')).toBe(true);
    expect(isSubmittedToWorld('WORLD_ENTRY_QUEUED_OFFLINE')).toBe(false);
  });

  it('the game actually wires the existing submitRun into the finish path', () => {
    const game = read('src/core/Game.ts');
    expect(game).toMatch(/leaderboardService\.submitRun\(submission\)/);
    expect(game).toMatch(/private async submitOfficialRun\(/);
    // Outcomes drive the reported state, not a hardcoded message.
    expect(game).toMatch(/outcome\.isPersonalBest \? 'WORLD_PB_UPDATED' : 'WORLD_ENTRY_SUBMITTED'/);
    expect(game).toMatch(/outcome\.reason === 'OFFLINE' \|\| outcome\.reason === 'NOT_AUTHENTICATED'/);
    expect(game).toMatch(/queueCandidate\(candidate\)/);
    expect(game).toMatch(/RUN_INELIGIBLE_NON_CANONICAL/);
  });
});

// ---------------------------------------------------------------------------
// 2. Real submission against the existing service
// ---------------------------------------------------------------------------

describe('World submission — real service behaviour', () => {
  function service(invoke: () => Promise<{ data: unknown; error: unknown }>): LeaderboardService {
    const client = { functions: { invoke } };
    const onlineClient = OnlineClient.__createWithClientForTests(client as never);
    const auth = new AuthService(onlineClient);
    (auth as unknown as { currentProfile: { id: string; displayName: string } }).currentProfile = {
      id: 'user-1',
      displayName: 'PLAYER-A7F2'
    };
    return new LeaderboardService(onlineClient, auth);
  }

  const entry = OFFICIAL_MAP_REGISTRY[0];
  const identity = {
    trackId: entry.trackId,
    mapVersion: entry.mapVersion,
    mapFingerprint: entry.mapFingerprint,
    movementVersion: entry.movementVersion,
    generatorVersion: entry.generatorVersion,
    analysisVersion: entry.analysisVersion,
    analysisFingerprint: entry.analysisFingerprint
  };
  const base: RunSubmission = {
    identity,
    timeUs: 60_000_000,
    rank: 'GOLD',
    checkpointCount: 4,
    resetCount: 1,
    devMode: false
  };

  it('submits a valid canonical run and reports acceptance', async () => {
    const svc = service(async () => ({
      data: { accepted: true, verification_state: 'accepted', run_id: 'run-9', is_personal_best: true },
      error: null
    }));
    const outcome = await svc.submitRun(base);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.runId).toBe('run-9');
      expect(outcome.isPersonalBest).toBe(true);
    }
  });

  it('carries replay metadata to the server when present', async () => {
    let body: Record<string, unknown> | null = null;
    const svc = service(async (_fn: unknown, options: unknown) => {
      body = (options as { body: Record<string, unknown> }).body;
      return { data: { accepted: true, run_id: 'r', is_personal_best: false }, error: null };
    });
    await svc.submitRun({ ...base, replayVersion: 1, replayHash: 'rph_v1_abc', replayPath: 'u/t/f.json' });
    expect(body).not.toBeNull();
    expect(body!.replay_version).toBe(1);
    expect(body!.replay_hash).toBe('rph_v1_abc');
    expect(body!.replay_path).toBe('u/t/f.json');
    expect(body!.time_us).toBe(60_000_000);
  });

  it('reports a server rejection with the real reason', async () => {
    const svc = service(async () => ({
      data: { accepted: false, verification_state: 'rejected', reason: 'time below plausible floor' },
      error: null
    }));
    const outcome = await svc.submitRun(base);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('REJECTED');
      expect(outcome.detail).toContain('plausible');
    }
  });

  it('reports an Edge Function error instead of claiming success', async () => {
    const svc = service(async () => ({ data: null, error: { message: 'network down' } }));
    const outcome = await svc.submitRun(base);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('ERROR');
  });

  it('refuses an offline run before contacting the server', async () => {
    const onlineClient = OnlineClient.__createWithClientForTests(null);
    const auth = new AuthService(onlineClient);
    const svc = new LeaderboardService(onlineClient, auth);
    const outcome = await svc.submitRun(base);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('OFFLINE');
  });

  it('refuses a run whose map identity is not the canonical one', async () => {
    const svc = service(async () => ({
      data: { accepted: true, run_id: 'should-not-happen', is_personal_best: false },
      error: null
    }));
    const outcome = await svc.submitRun({
      ...base,
      identity: { ...identity, mapFingerprint: 'mfp_v1_0000000000000000_dead' }
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('IDENTITY_MISMATCH');
  });

  it('refuses a DEV run', async () => {
    const svc = service(async () => ({
      data: { accepted: true, run_id: 'x', is_personal_best: false },
      error: null
    }));
    const outcome = await svc.submitRun({ ...base, devMode: true });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('DEV_RUN');
  });
});

// ---------------------------------------------------------------------------
// 3. Ghost availability — the three non-conflated states
// ---------------------------------------------------------------------------

describe('Ghost availability — pure classification', () => {
  it('reports NO_PB when there is no personal best', () => {
    const info = classifyGhostAvailability({ pbTimeUs: null, ghostTimeUs: null });
    expect(info.state).toBe('NO_PB');
    expect(info.available).toBe(false);
    expect(info.label).toBeNull();
    expect(info.actionText).toMatch(/NO PERSONAL BEST/);
  });

  it('reports PB_NO_REPLAY and never fabricates a ghost', () => {
    const info = classifyGhostAvailability({ pbTimeUs: 50_000_000, ghostTimeUs: null });
    expect(info.state).toBe('PB_NO_REPLAY');
    expect(info.available).toBe(false);
    expect(info.label).toBeNull();
    expect(info.pbTimeUs).toBe(50_000_000);
    expect(info.actionText).toBe('PB GHOST // NO REPLAY');
  });

  it('reports PB_GHOST only when the replay matches the PB exactly', () => {
    const info = classifyGhostAvailability({ pbTimeUs: 50_000_000, ghostTimeUs: 50_000_000 });
    expect(info.state).toBe('PB_GHOST');
    expect(info.available).toBe(true);
    expect(info.label).toBe('PB GHOST');
    expect(info.actionText).toBe('> RACE PB GHOST');
  });

  it('reports BEST_RECORDED_GHOST when the replay is slower than the PB', () => {
    const info = classifyGhostAvailability({ pbTimeUs: 50_000_000, ghostTimeUs: 55_000_000 });
    expect(info.state).toBe('BEST_RECORDED_GHOST');
    expect(info.available).toBe(true);
    expect(info.label).toBe('BEST RECORDED GHOST');
    expect(info.pbTimeUs).toBe(50_000_000);
    expect(info.ghostTimeUs).toBe(55_000_000);
    // The labels must never be conflated.
    expect(info.label).not.toBe('PB GHOST');
  });
});

// ---------------------------------------------------------------------------
// 4. Ghost bookkeeping through the real manager
// ---------------------------------------------------------------------------

describe('Ghost availability — leaderboard bookkeeping', () => {
  const manager = LeaderboardManager.getInstance();

  it('a legacy PB with no replay reports NO_REPLAY', () => {
    const trackId = 'track_1_signal_drift';
    manager.recordOfficialRun(trackId, 1, runResults(50.0), true);

    const info = manager.resolveGhostAvailability(trackId, 'mfp_v1_current', () => false);
    expect(info.state).toBe('PB_NO_REPLAY');
    expect(info.available).toBe(false);
    expect(info.pbTimeUs).toBe(50_000_000);
  });

  it('a local in-session replay for the PB time enables PB GHOST', () => {
    const trackId = 'track_2_flow_state';
    manager.recordOfficialRun(trackId, 2, runResults(48.0), true);

    const info = manager.resolveGhostAvailability(
      trackId,
      'mfp_v1_current',
      (finishUs) => finishUs === 48_000_000
    );
    expect(info.state).toBe('PB_GHOST');
    expect(info.available).toBe(true);
    expect(info.label).toBe('PB GHOST');
  });

  it('a slower completion creates BEST RECORDED GHOST without touching the PB', () => {
    const trackId = 'track_3_surf_the_void';
    manager.recordOfficialRun(trackId, 3, runResults(50.0), true);

    // A slower run (55 s) uploads a replay.
    const changed = manager.recordGhostReplay(trackId, 55_000_000, 'u/t/55.json', 'rph_v1_55', 'mfp_v1_current');
    expect(changed).toBe(true);

    const info = manager.resolveGhostAvailability(trackId, 'mfp_v1_current', () => false);
    expect(info.state).toBe('BEST_RECORDED_GHOST');
    expect(info.label).toBe('BEST RECORDED GHOST');
    expect(info.ghostTimeUs).toBe(55_000_000);
    // THE PB IS UNTOUCHED.
    expect(info.pbTimeUs).toBe(50_000_000);
    expect(manager.getPbTimeUs(trackId)).toBe(50_000_000);
  });

  it('a slower replay never replaces a faster recorded ghost', () => {
    const trackId = 'track_4_airwave_theory';
    manager.recordOfficialRun(trackId, 4, runResults(45.0), true);
    expect(manager.recordGhostReplay(trackId, 46_000_000, 'p/46', 'h46', 'mfp_v1_current')).toBe(true);
    // Slower: rejected, no churn.
    expect(manager.recordGhostReplay(trackId, 47_000_000, 'p/47', 'h47', 'mfp_v1_current')).toBe(false);
    expect(manager.getGhostReplayRef(trackId)!.finishTimeUs).toBe(46_000_000);
    // Faster: replaces.
    expect(manager.recordGhostReplay(trackId, 44_000_000, 'p/44', 'h44', 'mfp_v1_current')).toBe(true);
    expect(manager.getGhostReplayRef(trackId)!.finishTimeUs).toBe(44_000_000);
  });

  it('a future faster completion promotes its replay to PB GHOST', () => {
    const trackId = 'track_6_over_the_edge';
    manager.recordOfficialRun(trackId, 6, runResults(50.0), true);
    manager.recordGhostReplay(trackId, 55_000_000, 'p/55', 'h55', 'mfp_v1_current');
    expect(manager.resolveGhostAvailability(trackId, 'mfp_v1_current', () => false).state).toBe(
      'BEST_RECORDED_GHOST'
    );

    // New PB at 49 s, with a replay.
    manager.recordOfficialRun(trackId, 6, runResults(49.0), true);
    manager.recordGhostReplay(trackId, 49_000_000, 'p/49', 'h49', 'mfp_v1_current');

    const info = manager.resolveGhostAvailability(trackId, 'mfp_v1_current', () => false);
    expect(info.state).toBe('PB_GHOST');
    expect(info.label).toBe('PB GHOST');
    expect(info.pbTimeUs).toBe(49_000_000);
    expect(info.ghostTimeUs).toBe(49_000_000);
  });

  it('an old-map ghost replay is never used for a current race', () => {
    const trackId = 'track_7_drop_zone_surfer';
    manager.recordOfficialRun(trackId, 7, runResults(52.0), true);
    manager.recordGhostReplay(trackId, 52_000_000, 'p/old', 'h_old', 'mfp_v1_OLD_MAP');

    // Current map fingerprint differs -> honest NO_REPLAY, not a stale ghost.
    const info = manager.resolveGhostAvailability(trackId, 'mfp_v1_CURRENT', () => false);
    expect(info.state).toBe('PB_NO_REPLAY');
    expect(info.available).toBe(false);

    // The stored reference is preserved as historical data.
    expect(manager.getGhostReplayRef(trackId)!.mapFingerprint).toBe('mfp_v1_OLD_MAP');
  });

  it('a current-map ghost replay is accepted', () => {
    const trackId = 'track_8_wave_surfing';
    manager.recordOfficialRun(trackId, 8, runResults(51.0), true);
    manager.recordGhostReplay(trackId, 51_000_000, 'p/cur', 'h_cur', 'mfp_v1_CURRENT');

    const info = manager.resolveGhostAvailability(trackId, 'mfp_v1_CURRENT', () => false);
    expect(info.state).toBe('PB_GHOST');
    expect(info.available).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Generic across all 14 official tracks (no Signal-Drift special casing)
// ---------------------------------------------------------------------------

describe('Ghost availability — all 14 official tracks', () => {
  const manager = LeaderboardManager.getInstance();
  const tracks = SignalPackCatalog.getTracks();

  it('every official track follows the same three-state rules', () => {
    expect(tracks.length).toBe(14);

    tracks.forEach((track, index) => {
      const fingerprint = OFFICIAL_MAP_REGISTRY.find((e) => e.trackId === track.id)!.mapFingerprint;
      // Deliberately faster than anything an earlier test may have stored, so
      // this sweep is independent of test ordering.
      const pbSeconds = 10 + index;

      // 1. PB with no usable replay (any earlier ghost is on a different
      //    fingerprint, so it is correctly ignored).
      manager.recordOfficialRun(track.id, track.id.length, runResults(pbSeconds), true);
      const noReplay = manager.resolveGhostAvailability(track.id, fingerprint, () => false);
      expect(noReplay.state, `${track.id} no-replay`).toBe('PB_NO_REPLAY');
      expect(noReplay.available, `${track.id} no-replay available`).toBe(false);

      // 2. Slower run records a replay -> BEST RECORDED GHOST, PB preserved.
      manager.recordGhostReplay(
        track.id,
        (pbSeconds + 5) * 1_000_000,
        `${track.id}/slow.json`,
        `rph_v1_${track.id}_slow`,
        fingerprint
      );
      const slower = manager.resolveGhostAvailability(track.id, fingerprint, () => false);
      expect(slower.state, `${track.id} best-recorded`).toBe('BEST_RECORDED_GHOST');
      expect(slower.label, `${track.id} label`).toBe('BEST RECORDED GHOST');
      expect(slower.pbTimeUs, `${track.id} pb preserved`).toBe(Math.round(pbSeconds * 1_000_000));

      // 3. Faster run with a replay -> promoted to PB GHOST.
      manager.recordOfficialRun(track.id, track.id.length, runResults(pbSeconds - 2), true);
      manager.recordGhostReplay(
        track.id,
        (pbSeconds - 2) * 1_000_000,
        `${track.id}/fast.json`,
        `rph_v1_${track.id}_fast`,
        fingerprint
      );
      const promoted = manager.resolveGhostAvailability(track.id, fingerprint, () => false);
      expect(promoted.state, `${track.id} promoted`).toBe('PB_GHOST');
      expect(promoted.label, `${track.id} promoted label`).toBe('PB GHOST');
      expect(promoted.pbTimeUs, `${track.id} new pb`).toBe(
        Math.round((pbSeconds - 2) * 1_000_000)
      );
    });
  });

  it('SIGNAL DRIFT uses the generic path (no hardcoded track id anywhere)', () => {
    const files = [
      'src/core/Game.ts',
      'src/ui/ImportScreen.ts',
      'src/ui/ResultsScreen.ts',
      'src/leaderboard/LeaderboardManager.ts',
      'src/leaderboard/SubmissionFeedback.ts'
    ];
    for (const file of files) {
      const src = read(file);
      expect(src, file).not.toMatch(/track_1[0-4]_|track_[1-9]_|kz_ascent|signal_drift/i);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Independence of PB, replay and submission
// ---------------------------------------------------------------------------

describe('Submission and ghost bookkeeping are independent', () => {
  it('the finish path records the ghost replay before submitting', () => {
    const game = read('src/core/Game.ts');
    const submitFn = game.slice(
      game.indexOf('private async submitOfficialRun('),
      game.indexOf('private async submitOfficialRun(') + 3200
    );
    const ghostIdx = submitFn.indexOf('recordGhostReplay(');
    const submitIdx = submitFn.indexOf('leaderboardService.submitRun(');
    expect(ghostIdx).toBeGreaterThan(-1);
    expect(submitIdx).toBeGreaterThan(-1);
    // Ghost bookkeeping happens FIRST: a rejected submission must never cost the
    // player their ghost.
    expect(ghostIdx).toBeLessThan(submitIdx);
  });

  it('a slower run can store a replay without any PB write', () => {
    const manager = LeaderboardManager.getInstance();
    const trackId = 'track_9_neon_abyss';
    manager.recordOfficialRun(trackId, 9, runResults(40.0), true);
    const before = manager.getRecordSummary(trackId).pbTime;
    expect(before).not.toBeNull();

    // recordGhostReplay must not touch pbTime, whatever the PB currently is.
    manager.recordGhostReplay(trackId, 99_000_000, 'p/slow', 'h_slow', 'mfp_v1_CURRENT');
    expect(manager.getRecordSummary(trackId).pbTime).toBe(before);
  });

  it('the offline queue path is reachable and honest', () => {
    const manager = LeaderboardManager.getInstance();
    const candidate = manager.prepareSubmissionCandidate(
      'track_10_neon_slipstream',
      'NEON SLIPSTREAM',
      10,
      runResults(58.0),
      true
    );
    expect(candidate.isValid).toBe(true);
    expect(manager.queueCandidate(candidate)).toBe(true);
    expect(manager.getQueuedSubmissions().some((q) => q.submissionId === candidate.submissionId)).toBe(
      true
    );
  });
});
