/**
 * GHOST RACE SOURCE — recorded run -> timeline-driven ghost samples.
 *
 * This module is PURE (no THREE, no DOM) so every rule it enforces is directly
 * unit-testable:
 *
 *   - a ghost is only accepted when its recorded canonical map identity matches
 *     the map the player is about to run
 *   - playback is sampled from the RECORDED transforms, interpolated. Movement
 *     inputs are never re-simulated, so a ghost can never drift from what was
 *     actually recorded and can never influence local physics
 *   - checkpoint splits and the finish delta are computed from recorded event
 *     times and raw integer microseconds
 *
 * Ghosts have NO collision, NO triggers, NO gameplay effect, NO audio effect and
 * NO network authority. Nothing in this file is read by the movement, collision,
 * timing or scoring paths.
 */

import {
  PovReplay,
  PovReplayIdentity,
  PovSample,
  samplePovReplay,
  validatePovReplay
} from './pov/PovReplayFormat';

export type GhostRaceKind = 'PB' | 'WORLD';

/** A validated, ready-to-race recorded run. */
export interface GhostRaceRun {
  kind: GhostRaceKind;
  /** Restrained HUD label, e.g. `PB GHOST` or `WORLD #1 // SIGNAL-4F21`. */
  label: string;
  /** Authoritative completion time of the RECORDED run, in integer microseconds. */
  finishTimeUs: number;
  /** Recorded checkpoint index -> time in milliseconds from the recorded run start. */
  checkpointTimesMs: Map<number, number>;
  replay: PovReplay;
}

export interface GhostRaceSplit {
  checkpointIndex: number;
  /** Signed seconds. Negative = the player is AHEAD of the ghost. */
  deltaSeconds: number;
  isAhead: boolean;
  label: string;
}

export interface GhostFinishComparison {
  label: string;
  /** The ghost's recorded completion time, in integer microseconds. */
  ghostTimeUs: number;
  /** Signed microseconds. Negative = the player BEAT the ghost. */
  deltaUs: number;
}

export type GhostRaceBuildResult =
  | { ok: true; run: GhostRaceRun }
  | { ok: false; reason: string; detail: string };

/**
 * Builds a validated ghost run.
 *
 * `expectedIdentity` MUST be the canonical identity of the map the player is
 * about to run. Any difference (track id, map version, map fingerprint, movement
 * version) refuses the ghost rather than silently running an old recording on a
 * different level.
 */
export function buildGhostRaceRun(input: {
  kind: GhostRaceKind;
  label: string;
  replay: PovReplay;
  expectedIdentity: PovReplayIdentity;
  /** Leaderboard time in integer microseconds, when the run came from a board. */
  expectedFinishTimeUs?: number;
  /** Raw payload bytes, when available, so the integrity hash can be rechecked. */
  payload?: string;
  /** Server-recorded hash for accepted leaderboard runs. */
  expectedHash?: string;
}): GhostRaceBuildResult {
  const validation = validatePovReplay(input.replay, {
    identity: input.expectedIdentity,
    finishTimeUs: input.expectedFinishTimeUs,
    payload: input.payload,
    expectedHash: input.expectedHash
  });

  if (!validation.ok) {
    return { ok: false, reason: validation.reason, detail: validation.detail };
  }

  return {
    ok: true,
    run: {
      kind: input.kind,
      label: input.label,
      finishTimeUs: input.replay.finishTimeUs,
      checkpointTimesMs: collectCheckpointTimes(input.replay),
      replay: input.replay
    }
  };
}

/** Recorded checkpoint event times, keyed by checkpoint index. */
export function collectCheckpointTimes(replay: PovReplay): Map<number, number> {
  const out = new Map<number, number>();
  for (const event of replay.events) {
    if (event.type !== 'CHECKPOINT') continue;
    const index = event.d === undefined ? 0 : Math.floor(event.d);
    if (index < 0) continue;
    // First recorded time for an index wins: a replay may cross a checkpoint
    // more than once only if the run was restarted, and the earliest crossing is
    // the one that belongs to the completed attempt.
    if (!out.has(index)) out.set(index, event.t);
  }
  return out;
}

/**
 * Samples the ghost at an absolute time on the AUTHORITATIVE RUN TIMELINE.
 *
 * `runElapsedMs` is the local player's run time, not a wall clock. At run start
 * both are zero, so the ghost and the player share one timeline.
 */
export function sampleGhost(run: GhostRaceRun, runElapsedMs: number): PovSample {
  return samplePovReplay(run.replay, runElapsedMs);
}

/** The ghost's recorded time at a checkpoint, in milliseconds, or null. */
export function ghostCheckpointTimeMs(run: GhostRaceRun, checkpointIndex: number): number | null {
  const t = run.checkpointTimesMs.get(checkpointIndex);
  return t === undefined ? null : t;
}

/**
 * Split against the ghost at a checkpoint the PLAYER just reached.
 *
 * Returns null when the ghost never recorded that checkpoint, so no delta is
 * fabricated from guessed route progress.
 */
export function ghostSplitAt(
  run: GhostRaceRun,
  checkpointIndex: number,
  playerElapsedSeconds: number
): GhostRaceSplit | null {
  const ghostMs = ghostCheckpointTimeMs(run, checkpointIndex);
  if (ghostMs === null) return null;

  const deltaSeconds = playerElapsedSeconds - ghostMs / 1000;
  return {
    checkpointIndex,
    deltaSeconds,
    isAhead: deltaSeconds < 0,
    label: run.label
  };
}

/**
 * Finish comparison against the ghost, in raw integer microseconds.
 * Formatting happens after the calculation, never before.
 */
export function ghostFinishDelta(
  run: GhostRaceRun,
  playerFinishUs: number
): GhostFinishComparison {
  return {
    label: run.label,
    ghostTimeUs: run.finishTimeUs,
    deltaUs: playerFinishUs - run.finishTimeUs
  };
}

/** True when the player's run beat the ghost outright. */
export function ghostBeatenBy(comparison: GhostFinishComparison): boolean {
  return comparison.deltaUs < 0;
}

/** Human label for a leaderboard ghost, e.g. `WORLD #1 // SIGNAL-4F21`. */
export function worldGhostLabel(rankPosition: number, displayName: string): string {
  return `WORLD #${rankPosition} // ${displayName}`;
}

/** Human label for a personal-best ghost. */
export function pbGhostLabel(): string {
  return 'PB GHOST';
}

// ---------------------------------------------------------------------------
// Readability safeguards (pure)
// ---------------------------------------------------------------------------

/** Below this distance the ghost is hidden entirely — it is inside the camera. */
export const GHOST_NEAR_HIDE_M = 1.6;
/** At/after this distance the ghost reads at full authored opacity. */
export const GHOST_NEAR_FULL_M = 3.4;

/**
 * Proximity fade for the ghost body.
 *
 * The ghost must never obscure a platform edge or an obstacle opening, so as it
 * approaches the camera it fades rather than staying fully drawn. Returns a
 * multiplier in [0, 1]; 0 means "hide". Presentation only — it changes nothing
 * about the recorded trajectory or timing.
 */
export function ghostProximityScale(distanceM: number): number {
  if (!Number.isFinite(distanceM)) return 1;
  if (distanceM <= GHOST_NEAR_HIDE_M) return 0;
  if (distanceM >= GHOST_NEAR_FULL_M) return 1;
  return (distanceM - GHOST_NEAR_HIDE_M) / (GHOST_NEAR_FULL_M - GHOST_NEAR_HIDE_M);
}
