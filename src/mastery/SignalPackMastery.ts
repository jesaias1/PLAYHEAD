import { RANK_TIME_MULTIPLIERS, RunRank, RunResultRank } from '../player/PlayerStats';

/**
 * SIGNAL PACK MASTERY — pure, deterministic progression math shared by the
 * results screen, the Signal Pack cards and the pack summary.
 *
 * No DOM, no storage, no clock. Everything is derived from authoritative inputs
 * (the canonical catalog, stored rank records and the track target time), so the
 * UI can never invent a threshold or an objective.
 *
 * Timing stays in SECONDS at this layer, matching PlayerStats / RunResults.
 * Formatting to MM:SS.mmm stays in the presentation layer.
 */

export const RANK_ORDER: Readonly<Record<RunResultRank, number>> = {
  UNRANKED: 0,
  BRONZE: 1,
  SILVER: 2,
  GOLD: 3,
  DIAMOND: 4
};

export function rankValue(rank: RunResultRank | undefined | null): number {
  if (!rank) return 0;
  return RANK_ORDER[rank] ?? 0;
}

/** The next rank above the given one, or null when already DIAMOND. */
export function nextRankAbove(rank: RunResultRank | undefined | null): RunRank | null {
  switch (rank) {
    case 'DIAMOND':
      return null;
    case 'GOLD':
      return 'DIAMOND';
    case 'SILVER':
      return 'GOLD';
    case 'BRONZE':
      return 'SILVER';
    default:
      return 'BRONZE';
  }
}

/**
 * Completion time (seconds) required to reach `rank` on a track whose target
 * duration is `targetTime`. Uses the AUTHORITATIVE multipliers from PlayerStats
 * so a card can never display a threshold the rank evaluator would disagree with.
 */
export function rankThresholdTime(targetTime: number, rank: RunRank): number | null {
  if (!Number.isFinite(targetTime) || targetTime <= 0) return null;
  return targetTime * RANK_TIME_MULTIPLIERS[rank];
}

export interface NextRankTarget {
  /** The rank the player is chasing. */
  rank: RunRank;
  /** Completion time (seconds) needed to reach it. */
  timeSeconds: number;
  /** currentTime - timeSeconds. Positive = seconds still to shave. */
  deltaSeconds: number;
  /**
   * True when the time is ALREADY fast enough and the remaining gap is purely a
   * mistake gate (GOLD allows 1, DIAMOND allows 0). The honest target is a clean
   * run, not more speed.
   */
  cleanRunRequired: boolean;
}

/**
 * The single most useful rank target for a run: the next rank above `currentRank`,
 * with the honest time delta or the clean-run gate.
 */
export function nextRankTarget(
  targetTime: number,
  currentRank: RunResultRank | undefined | null,
  currentTime: number,
  mistakes?: number
): NextRankTarget | null {
  const rank = nextRankAbove(currentRank);
  if (!rank) return null;
  const timeSeconds = rankThresholdTime(targetTime, rank);
  if (timeSeconds === null) return null;

  const current = Number.isFinite(currentTime) ? currentTime : Number.POSITIVE_INFINITY;
  const timeMet = current <= timeSeconds;
  // A rank can also be gated by mistakes: GOLD tolerates at most 1, DIAMOND none.
  const mistakeGate = rank === 'DIAMOND' ? 0 : rank === 'GOLD' ? 1 : rank === 'SILVER' ? 3 : Number.POSITIVE_INFINITY;
  // Cards have a best rank and time, but no mistake count for that PB. A time
  // already inside the next band still requires a qualifying attempt.
  const cleanRunRequired = timeMet && (mistakes === undefined || mistakes > mistakeGate);

  return {
    rank,
    timeSeconds,
    deltaSeconds: Math.max(0, current - timeSeconds),
    cleanRunRequired
  };
}

/** Restrained single-line copy for a next-rank target. */
export function describeNextRankTarget(target: NextRankTarget): string {
  if (target.cleanRunRequired) {
    const limit = target.rank === 'DIAMOND' ? 0 : target.rank === 'GOLD' ? 1 : 3;
    return `QUALIFY ${target.rank} // ${limit} FALLS / RESTARTS MAX`;
  }
  if (!Number.isFinite(target.deltaSeconds)) return `FIRST ${target.rank} TARGET`;
  const delta = target.deltaSeconds.toFixed(2);
  if (target.rank === 'DIAMOND') return `DIAMOND WITHIN ${delta}s`;
  return `${delta}s TO ${target.rank}`;
}

// ---------------------------------------------------------------------------
// Signal Pack summary + deterministic next objective
// ---------------------------------------------------------------------------

export type PackObjectiveKind = 'NEXT_UNCLEARED' | 'NEAR_DIAMOND' | 'MASTERED';

export interface PackObjective {
  kind: PackObjectiveKind;
  /** Null once every official signal is mastered. */
  trackId: string | null;
  title: string | null;
  /** Restrained copy for the Signal Pack panel. */
  label: string;
}

/**
 * The single deterministic next objective over the CANONICAL catalog order:
 * the first uncleared signal, else the first not-yet-Diamond signal, else
 * mastered. No lock, no recommendation engine, no player-state heuristics.
 */
export function nextPackObjective(
  tracks: readonly { id: string; title: string }[],
  ranks: Readonly<Record<string, RunRank | undefined>>
): PackObjective {
  const uncleared = tracks.find((t) => rankValue(ranks[t.id]) === 0);
  if (uncleared) {
    return {
      kind: 'NEXT_UNCLEARED',
      trackId: uncleared.id,
      title: uncleared.title,
      label: `NEXT SIGNAL // ${uncleared.title}`
    };
  }
  const notDiamond = tracks.find((t) => rankValue(ranks[t.id]) < 4);
  if (notDiamond) {
    return {
      kind: 'NEAR_DIAMOND',
      trackId: notDiamond.id,
      title: notDiamond.title,
      label: `DIAMOND TARGET // ${notDiamond.title}`
    };
  }
  return { kind: 'MASTERED', trackId: null, title: null, label: 'SIGNAL MASTERED // ALL DIAMOND' };
}

export type JourneyBand = 'EARLY' | 'MID' | 'LATE' | 'FINAL';

/** Continue in authored order, then revisit unfinished mastery after the final signal. */
export function nextSignalAfter(
  tracks: readonly { id: string; title: string }[],
  currentId: string,
  ranks: Readonly<Record<string, RunRank | undefined>>
): { id: string; title: string } | null {
  const index = tracks.findIndex((track) => track.id === currentId);
  if (index < 0) return null;
  if (index + 1 < tracks.length) return tracks[index + 1];
  return tracks.find((track) => track.id !== currentId && rankValue(ranks[track.id]) < 4)
    ?? tracks.find((track) => track.id !== currentId) ?? null;
}

/** Null means a first PB or no improvement; never manufacture a gain. */
export function pbImprovement(prior: number | null, time: number): number | null {
  return prior !== null && Number.isFinite(prior) && Number.isFinite(time) && time < prior
    ? prior - time : null;
}

/**
 * Honest gap (microseconds) from the player's time to a target ABOVE them on the
 * board. Invalid times or a target below the player do not supply a target.
 */
export function competitionGapUs(youTimeUs: number, aboveTimeUs: number): number | null {
  if (!Number.isFinite(youTimeUs) || !Number.isFinite(aboveTimeUs) ||
      aboveTimeUs <= 0 || youTimeUs < aboveTimeUs) return null;
  return youTimeUs - aboveTimeUs;
}

/**
 * Position-derived journey band for the canonical 14-track order. Labels only —
 * never used to lock or reorder anything.
 */
export function journeyBand(index: number, total: number): JourneyBand {
  if (total <= 0) return 'EARLY';
  const f = index / total;
  if (f < 0.25) return 'EARLY';
  if (f < 0.6) return 'MID';
  if (f < 0.9) return 'LATE';
  return 'FINAL';
}
