/**
 * LeaderboardManager: Local records, Personal Bests, and Future-Ready
 * Leaderboard Submission Queue for official PLAYHEAD tracks.
 */

import { RunRank, RunResultRank, RunResults } from '../player/PlayerStats';
import { ROUTE_GENERATION_VERSION } from '../generation/RouteGenerator';
import { BUILD_LABEL } from '../core/BuildInfo';
import { seedToHex } from '../utils/hash';

export interface LeaderboardSubmissionCandidate {
  version: 1;
  submissionId: string;
  trackId: string;
  trackTitle: string;
  routeVersion: number;
  seed: number;
  completionTime: number;
  targetTime: number;
  rank: RunResultRank;
  score: number;
  fallsCount: number;
  maxSpeed: number;
  averageSpeed: number;
  strafeEfficiency: number;
  timestamp: number;
  status: 'QUEUED_LOCAL';
  clientBuild: string;
  isValid: boolean;
}

export interface OfficialRecordEntry {
  trackId: string;
  seed: number;
  bestRank: RunRank;
  pbTime: number;
  pbScore: number;
  pbDate: number;
  localFirstTime: number;
  localFirstScore: number;
  localFirstDate: number;
  /**
   * Storage reference for the FASTEST recorded replay on this track.
   *
   * This is deliberately separate from `pbTime`. A legacy PB may have no replay
   * at all, and a slower run may still be the best replay available. Keeping the
   * fastest replay here (rather than only accepting a replay that exactly equals
   * the PB) is what stops legacy-PB players from being permanently unable to race
   * a ghost.
   *
   * Additive bookkeeping only — it never influences which run becomes the PB,
   * any rank threshold, or any leaderboard ordering.
   */
  ghostReplayPath?: string;
  ghostReplayHash?: string;
  ghostReplayFinishUs?: number;
  /** Canonical map fingerprint the ghost replay was recorded on. */
  ghostReplayMapFingerprint?: string;
}

/** What a track's ghost situation actually is. */
export type GhostAvailabilityState =
  | 'NO_PB'
  | 'PB_NO_REPLAY'
  | 'PB_GHOST'
  | 'BEST_RECORDED_GHOST';

/** Correct, non-conflated ghost labels. */
export type GhostRaceLabel = 'PB GHOST' | 'BEST RECORDED GHOST';

export interface GhostAvailabilityInfo {
  state: GhostAvailabilityState;
  /** The stored personal best, in integer microseconds. */
  pbTimeUs: number | null;
  /** The replay we can actually race, in integer microseconds. */
  ghostTimeUs: number | null;
  /** HUD label for the ghost, or null when none can be raced. */
  label: GhostRaceLabel | null;
  /** Restrained SIGNAL PACK action text. */
  actionText: string;
  /** True only when a ghost can actually be raced. */
  available: boolean;
}

/**
 * Classifies a track's ghost situation from the PB and the best raceable replay.
 *
 * PURE: the caller resolves which replay is actually usable (identity-validated,
 * in-session or cloud) and this decides what to call it. The three cases are
 * deliberately never conflated:
 *
 *   PB GHOST              replay corresponds EXACTLY to the current PB
 *   BEST RECORDED GHOST   fastest available replay, but NOT equal to the PB
 *   PB_NO_REPLAY          a PB exists with no replay yet
 *   NO_PB                 no personal best at all
 */
export function classifyGhostAvailability(input: {
  pbTimeUs: number | null;
  /** Fastest replay that can actually be raced, already identity-validated. */
  ghostTimeUs: number | null;
}): GhostAvailabilityInfo {
  const pb = input.pbTimeUs;
  const ghost = input.ghostTimeUs;

  if (pb === null) {
    return {
      state: 'NO_PB',
      pbTimeUs: null,
      ghostTimeUs: ghost,
      label: null,
      actionText: 'PB GHOST // NO PERSONAL BEST',
      available: false
    };
  }

  if (ghost === null) {
    return {
      state: 'PB_NO_REPLAY',
      pbTimeUs: pb,
      ghostTimeUs: null,
      label: null,
      actionText: 'PB GHOST // NO REPLAY',
      available: false
    };
  }

  // The replay is the PB only when the recorded time matches it exactly.
  if (ghost === pb) {
    return {
      state: 'PB_GHOST',
      pbTimeUs: pb,
      ghostTimeUs: ghost,
      label: 'PB GHOST',
      actionText: '> RACE PB GHOST',
      available: true
    };
  }

  return {
    state: 'BEST_RECORDED_GHOST',
    pbTimeUs: pb,
    ghostTimeUs: ghost,
    label: 'BEST RECORDED GHOST',
    actionText: '> RACE BEST GHOST',
    available: true
  };
}

const STORAGE_OFFICIAL_RECORDS = 'playhead_official_records_v1';
const STORAGE_SUBMISSION_QUEUE = 'playhead_leaderboard_queue_v1';

export class LeaderboardManager {
  private static instance: LeaderboardManager;

  private records: Record<string, OfficialRecordEntry> = {};
  private queue: LeaderboardSubmissionCandidate[] = [];

  private constructor() {
    this.loadState();
  }

  public static getInstance(): LeaderboardManager {
    if (!LeaderboardManager.instance) {
      LeaderboardManager.instance = new LeaderboardManager();
    }
    return LeaderboardManager.instance;
  }

  private loadState(): void {
    try {
      if (typeof localStorage === 'undefined') return;

      const rawRecords = localStorage.getItem(STORAGE_OFFICIAL_RECORDS);
      if (rawRecords) {
        this.records = JSON.parse(rawRecords);
      }

      const rawQueue = localStorage.getItem(STORAGE_SUBMISSION_QUEUE);
      if (rawQueue) {
        this.queue = JSON.parse(rawQueue);
      }
    } catch (e) {
      console.warn('[LeaderboardManager] Failed to load local state:', e);
    }
  }

  private saveState(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(STORAGE_OFFICIAL_RECORDS, JSON.stringify(this.records));
      localStorage.setItem(STORAGE_SUBMISSION_QUEUE, JSON.stringify(this.queue));
    } catch (e) {
      console.warn('[LeaderboardManager] Failed to save state:', e);
    }
  }

  private rankToValue(rank?: RunRank): number {
    switch (rank) {
      case 'DIAMOND': return 4;
      case 'GOLD': return 3;
      case 'SILVER': return 2;
      case 'BRONZE': return 1;
      default: return 0;
    }
  }

  public getRecord(trackId: string): OfficialRecordEntry | null {
    return this.records[trackId] ?? null;
  }

  public getRecordSummary(trackId: string): {
    bestRank: RunRank | null;
    pbTime: number | null;
    localFirstTime: number | null;
  } {
    const rec = this.records[trackId];
    if (!rec) {
      return { bestRank: null, pbTime: null, localFirstTime: null };
    }
    return {
      bestRank: rec.bestRank || null,
      pbTime: Number.isFinite(rec.pbTime) ? rec.pbTime : null,
      localFirstTime: Number.isFinite(rec.localFirstTime) ? rec.localFirstTime : null
    };
  }

  public recordOfficialRun(
    trackId: string,
    seed: number,
    results: RunResults,
    isValidRun: boolean
  ): { isNewPB: boolean; isNewLocalFirst: boolean } {
    if (!isValidRun || results.rank === 'UNRANKED') {
      return { isNewPB: false, isNewLocalFirst: false };
    }

    const existing = this.records[trackId];
    let isNewPB = false;
    let isNewLocalFirst = false;

    const completionTime = results.completionTime;
    const score = Math.round(results.score);
    const now = Date.now();

    if (!existing) {
      isNewPB = true;
      isNewLocalFirst = true;
      this.records[trackId] = {
        trackId,
        seed,
        bestRank: results.rank,
        pbTime: completionTime,
        pbScore: score,
        pbDate: now,
        localFirstTime: completionTime,
        localFirstScore: score,
        localFirstDate: now
      };
    } else {
      // Check rank progression
      if (this.rankToValue(results.rank) > this.rankToValue(existing.bestRank)) {
        existing.bestRank = results.rank;
      }

      // Check Personal Best time/score
      if (!Number.isFinite(existing.pbTime) || completionTime < existing.pbTime) {
        existing.pbTime = completionTime;
        existing.pbScore = score;
        existing.pbDate = now;
        isNewPB = true;
      }

      // Check Local #1 (lowest completion time locally recorded)
      if (!Number.isFinite(existing.localFirstTime) || completionTime < existing.localFirstTime) {
        existing.localFirstTime = completionTime;
        existing.localFirstScore = score;
        existing.localFirstDate = now;
        isNewLocalFirst = true;
      }
    }

    this.saveState();
    return { isNewPB, isNewLocalFirst };
  }

  /**
   * Records a replay reference for this track, keeping the FASTEST one.
   *
   * A slower completion is still recorded when nothing faster has a replay, so a
   * legacy PB without a replay does not lock the player out of ghost racing. The
   * PB itself is never touched here — a slower run can never overwrite a faster
   * PB time.
   *
   * Returns true when the stored ghost reference changed.
   */
  public recordGhostReplay(
    trackId: string,
    finishTimeUs: number,
    path: string,
    hash: string,
    mapFingerprint: string
  ): boolean {
    const rec = this.records[trackId];
    if (!rec) return false;
    if (!Number.isFinite(finishTimeUs) || finishTimeUs <= 0) return false;

    // Fastest wins. Equal times keep the existing reference (no churn).
    if (rec.ghostReplayFinishUs !== undefined && rec.ghostReplayFinishUs <= finishTimeUs) {
      return false;
    }

    rec.ghostReplayPath = path;
    rec.ghostReplayHash = hash;
    rec.ghostReplayFinishUs = finishTimeUs;
    rec.ghostReplayMapFingerprint = mapFingerprint;
    this.saveState();
    return true;
  }

  /** Storage reference for the fastest recorded replay, when one exists. */
  public getGhostReplayRef(trackId: string): {
    path: string;
    hash: string;
    finishTimeUs: number;
    mapFingerprint: string | null;
  } | null {
    const rec = this.records[trackId];
    if (!rec?.ghostReplayPath || !rec.ghostReplayHash || rec.ghostReplayFinishUs === undefined) {
      return null;
    }
    return {
      path: rec.ghostReplayPath,
      hash: rec.ghostReplayHash,
      finishTimeUs: rec.ghostReplayFinishUs,
      mapFingerprint: rec.ghostReplayMapFingerprint ?? null
    };
  }

  /** The stored personal best time in integer microseconds, or null. */
  public getPbTimeUs(trackId: string): number | null {
    const rec = this.records[trackId];
    if (!rec || !Number.isFinite(rec.pbTime)) return null;
    return Math.round(rec.pbTime * 1_000_000);
  }

  /**
   * Resolves and classifies this track's ghost situation.
   *
   * A replay is only considered when its recorded map fingerprint matches the
   * CURRENT canonical map. An old-map replay is never used for a current race,
   * a current PB ghost, or a current map comparison.
   *
   * @param hasLocalReplay reports in-session replay availability for a time.
   */
  public resolveGhostAvailability(
    trackId: string,
    currentMapFingerprint: string | null,
    hasLocalReplay: (finishTimeUs: number) => boolean
  ): GhostAvailabilityInfo {
    const pbTimeUs = this.getPbTimeUs(trackId);
    const ref = this.getGhostReplayRef(trackId);

    // A local in-session replay for the PB time is the strongest case: it is
    // exactly the PB and needs no network.
    if (pbTimeUs !== null && hasLocalReplay(pbTimeUs)) {
      return classifyGhostAvailability({ pbTimeUs, ghostTimeUs: pbTimeUs });
    }

    // Otherwise use the stored fastest replay, but ONLY when it belongs to the
    // current canonical map.
    if (ref && currentMapFingerprint && ref.mapFingerprint === currentMapFingerprint) {
      return classifyGhostAvailability({ pbTimeUs, ghostTimeUs: ref.finishTimeUs });
    }

    // A legacy PB whose replay predates recording, or whose replay is from an
    // older map: honest NO_REPLAY rather than a fabricated ghost.
    return classifyGhostAvailability({ pbTimeUs, ghostTimeUs: null });
  }

  public canSubmitToLeaderboard(run: {
    isOfficial: boolean;
    isValid: boolean;
    rank?: RunResultRank;
  }): boolean {
    return run.isOfficial && run.isValid && !!run.rank && run.rank !== 'UNRANKED';
  }

  public prepareSubmissionCandidate(
    trackId: string,
    trackTitle: string,
    seed: number,
    results: RunResults,
    isValid: boolean
  ): LeaderboardSubmissionCandidate {
    const submissionId = `sub_${Date.now()}_${seedToHex(seed)}_${Math.random().toString(36).substring(2, 8)}`;
    return {
      version: 1,
      submissionId,
      trackId,
      trackTitle,
      routeVersion: ROUTE_GENERATION_VERSION,
      seed,
      completionTime: results.completionTime,
      targetTime: results.targetTime,
      rank: results.rank,
      score: Math.round(results.score),
      fallsCount: results.fallsCount,
      maxSpeed: Math.round(results.maxSpeed),
      averageSpeed: Math.round(results.averageSpeed),
      strafeEfficiency: results.strafeEfficiency,
      timestamp: Date.now(),
      status: 'QUEUED_LOCAL',
      clientBuild: BUILD_LABEL,
      isValid
    };
  }

  public createCandidate(
    trackId: string,
    trackTitle: string,
    seed: number,
    results: RunResults,
    isValid: boolean
  ): LeaderboardSubmissionCandidate {
    return this.prepareSubmissionCandidate(trackId, trackTitle, seed, results, isValid);
  }

  public queueSubmission(candidate: LeaderboardSubmissionCandidate): boolean {
    if (!candidate.isValid || candidate.rank === 'UNRANKED') {
      return false;
    }

    // Deduplicate identical submissions within 1s
    const isDup = this.queue.some(
      q => q.trackId === candidate.trackId && Math.abs(q.timestamp - candidate.timestamp) < 1000
    );
    if (!isDup) {
      this.queue.push(candidate);
      this.saveState();
    }
    return true;
  }

  public queueCandidate(candidate: LeaderboardSubmissionCandidate): boolean {
    return this.queueSubmission(candidate);
  }

  public isCandidateQueued(submissionId: string): boolean {
    return this.queue.some(q => q.submissionId === submissionId);
  }

  public getQueuedSubmissions(): LeaderboardSubmissionCandidate[] {
    return [...this.queue];
  }

  public getQueuedCandidates(): LeaderboardSubmissionCandidate[] {
    return this.getQueuedSubmissions();
  }

  public clearQueue(): void {
    this.queue = [];
    this.saveState();
  }
}
