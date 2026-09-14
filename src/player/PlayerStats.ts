/**
 * Player run statistics tracking and rank computation
 */

export type RunRank = 'BRONZE' | 'SILVER' | 'GOLD' | 'DIAMOND';

export interface RunResults {
  completionTime: number;       // Seconds
  targetTime: number;           // Track target duration
  syncDelta: number;            // Difference in seconds
  maxSpeed: number;             // u/s
  averageSpeed: number;         // u/s
  strafeEfficiency: number;     // 0..100%
  fallsCount: number;
  restartsCount: number;
  rank: RunRank;
  score: number;
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

    // Rank evaluation
    let rank: RunRank = 'BRONZE';
    if (this.fallsCount === 0 && Math.abs(syncDelta) < 3.0 && strafeEfficiency > 65) {
      rank = 'DIAMOND';
    } else if (this.fallsCount <= 1 && Math.abs(syncDelta) < 6.0) {
      rank = 'GOLD';
    } else if (this.fallsCount <= 3 && Math.abs(syncDelta) < 15.0) {
      rank = 'SILVER';
    } else {
      rank = 'BRONZE';
    }

    return {
      completionTime,
      targetTime,
      syncDelta,
      maxSpeed: Math.round(this.maxSpeed),
      averageSpeed: Math.round(avgSpeed),
      strafeEfficiency,
      fallsCount: this.fallsCount,
      restartsCount: this.restartsCount,
      rank,
      score
    };
  }
}
