/**
 * Player run statistics tracking and rank computation
 */

export type RunRank = 'BRONZE' | 'SILVER' | 'GOLD' | 'DIAMOND';
export type RunResultRank = 'UNRANKED' | RunRank;

export interface RunResults {
  completionTime: number;       // Seconds
  targetTime: number;           // Track target duration
  syncDelta: number;            // Difference in seconds
  maxSpeed: number;             // u/s
  averageSpeed: number;         // u/s
  strafeEfficiency: number;     // 0..100%
  fallsCount: number;
  restartsCount: number;
  rank: RunResultRank;
  rankFailureReason?: RankFailureReason;
  bronzeTimeOverage?: number;
  score: number;
}

export type RankFailureReason = 'NONE' | 'UNFINISHED' | 'INVALID_RUN' | 'BRONZE_TIME_MISSED';

export interface RankDecision {
  rank: RunResultRank;
  failureReason: RankFailureReason;
  bronzeTimeOverage: number;
}

export interface RankEvaluation {
  completionTime: number;
  targetTime: number;
  fallsCount: number;
  restartsCount: number;
  strafeEfficiency: number;
  finished?: boolean;
}

export const RANK_TIME_MULTIPLIERS = {
  DIAMOND: 1.04,
  GOLD: 1.18,
  SILVER: 1.40,
  BRONZE: 1.85
} as const;

/** Duration-scaled performance bands with time as the primary qualifier. */
export function evaluateRunRankDetailed(run: RankEvaluation): RankDecision {
  const finished = run.finished ?? true;
  if (!finished) {
    return { rank: 'UNRANKED', failureReason: 'UNFINISHED', bronzeTimeOverage: 0 };
  }
  if (
    !Number.isFinite(run.completionTime) ||
    !Number.isFinite(run.targetTime) ||
    run.completionTime < 0 ||
    run.targetTime <= 0
  ) {
    return { rank: 'UNRANKED', failureReason: 'INVALID_RUN', bronzeTimeOverage: 0 };
  }

  const paceRatio = run.completionTime / run.targetTime;
  const totalMistakes = Math.max(0, run.fallsCount) + Math.max(0, run.restartsCount);

  if (
    paceRatio <= RANK_TIME_MULTIPLIERS.DIAMOND &&
    totalMistakes === 0
  ) {
    return { rank: 'DIAMOND', failureReason: 'NONE', bronzeTimeOverage: 0 };
  }
  if (paceRatio <= RANK_TIME_MULTIPLIERS.GOLD && totalMistakes <= 1) {
    return { rank: 'GOLD', failureReason: 'NONE', bronzeTimeOverage: 0 };
  }
  if (paceRatio <= RANK_TIME_MULTIPLIERS.SILVER && totalMistakes <= 3) {
    return { rank: 'SILVER', failureReason: 'NONE', bronzeTimeOverage: 0 };
  }
  if (paceRatio <= RANK_TIME_MULTIPLIERS.BRONZE) {
    return { rank: 'BRONZE', failureReason: 'NONE', bronzeTimeOverage: 0 };
  }
  const bronzeTarget = run.targetTime * RANK_TIME_MULTIPLIERS.BRONZE;
  return {
    rank: 'UNRANKED',
    failureReason: 'BRONZE_TIME_MISSED',
    bronzeTimeOverage: Math.max(0, run.completionTime - bronzeTarget)
  };
}

export function evaluateRunRank(run: RankEvaluation): RunResultRank {
  return evaluateRunRankDetailed(run).rank;
}

export class PlayerStats {
  public maxSpeed = 0;
  public totalSpeedSamples = 0;
  public speedSum = 0;

  public fallsCount = 0;
  public restartsCount = 0;

  public airborneFrames = 0;
  public efficientStrafeFrames = 0;

  public reset(): void {
    this.maxSpeed = 0;
    this.totalSpeedSamples = 0;
    this.speedSum = 0;
    this.fallsCount = 0;
    this.restartsCount = 0;
    this.airborneFrames = 0;
    this.efficientStrafeFrames = 0;
  }

  public recordSpeed(speed: number): void {
    if (speed > this.maxSpeed) {
      this.maxSpeed = speed;
    }
    this.speedSum += speed;
    this.totalSpeedSamples++;
  }

  public recordAirborne(isStrafingEfficiently: boolean): void {
    this.airborneFrames++;
    if (isStrafingEfficiently) {
      this.efficientStrafeFrames++;
    }
  }

  public recordFall(): void {
    this.fallsCount++;
  }

  public recordRestart(): void {
    this.restartsCount++;
  }

  public getStrafeEfficiency(): number {
    return this.airborneFrames >= 10
      ? Math.round((this.efficientStrafeFrames / this.airborneFrames) * 100)
      : -1;
  }

  public computeResults(completionTime: number, targetTime: number): RunResults {
    const avgSpeed = this.totalSpeedSamples > 0 ? this.speedSum / this.totalSpeedSamples : 0;
    const strafeEfficiency = this.airborneFrames >= 10
      ? Math.round((this.efficientStrafeFrames / this.airborneFrames) * 100)
      : -1;

    const syncDelta = completionTime - targetTime;

    // Base score calculation
    // Perfect sync (within 2s) = 5000 pts
    // Speed bonus
    // Penalty per fall: -1000 pts
    const syncPenalty = Math.abs(syncDelta) * 50;
    const speedScore = avgSpeed * 5;
    const fallPenalty = this.fallsCount * 1200;
    const efficiencyBonus = strafeEfficiency * 20;

    const score = Math.max(100, Math.round(5000 + speedScore + efficiencyBonus - syncPenalty - fallPenalty));

    const rankDecision = evaluateRunRankDetailed({
      completionTime,
      targetTime,
      fallsCount: this.fallsCount,
      restartsCount: this.restartsCount,
      strafeEfficiency
    });

    return {
      completionTime,
      targetTime,
      syncDelta,
      maxSpeed: Math.round(this.maxSpeed),
      averageSpeed: Math.round(avgSpeed),
      strafeEfficiency,
      fallsCount: this.fallsCount,
      restartsCount: this.restartsCount,
      rank: rankDecision.rank,
      rankFailureReason: rankDecision.failureReason,
      bronzeTimeOverage: rankDecision.bronzeTimeOverage,
      score
    };
  }
}
