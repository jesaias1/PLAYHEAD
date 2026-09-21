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

    const completionTime = Math.round(results.completionTime * 1000) / 1000;
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
      completionTime: Math.round(results.completionTime * 1000) / 1000,
      targetTime: Math.round(results.targetTime * 1000) / 1000,
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
