import { describe, expect, it } from 'vitest';
import { evaluateRunRank, PlayerStats } from '../src/player/PlayerStats';

function completedRun(options: {
  completionTime: number;
  targetTime?: number;
  falls?: number;
  restarts?: number;
  efficientFrames?: number;
}) {
  const stats = new PlayerStats();
  for (let i = 0; i < (options.falls ?? 0); i++) stats.recordFall();
  for (let i = 0; i < (options.restarts ?? 0); i++) stats.recordRestart();
  const efficientFrames = options.efficientFrames ?? 75;
  for (let i = 0; i < 100; i++) stats.recordAirborne(i < efficientFrames);
  return stats.computeResults(options.completionTime, options.targetTime ?? 60);
}

describe('rank balance performance bands', () => {
  it('keeps a completed run with several ordinary falls capable of Bronze', () => {
    expect(completedRun({ completionTime: 93, falls: 5 }).rank).toBe('BRONZE');
  });

  it('awards Silver for a moderately paced, reasonably consistent run', () => {
    expect(completedRun({ completionTime: 77, falls: 1, restarts: 1 }).rank).toBe('SILVER');
  });

  it('awards Gold for a strong run with at most one meaningful mistake', () => {
    expect(completedRun({ completionTime: 67, falls: 1 }).rank).toBe('GOLD');
  });

  it('ranks the reported fast one-fall Signal Drift-style run as Gold', () => {
    expect(completedRun({
      completionTime: 81.8,
      targetTime: 116.099,
      falls: 1,
      efficientFrames: 31
    }).rank).toBe('GOLD');
  });

  it('does not award Diamond to a very fast run with repeated deaths', () => {
    expect(completedRun({ completionTime: 54, falls: 4, efficientFrames: 90 }).rank).toBe('BRONZE');
  });

  it('awards Diamond only to a clean high-performance run', () => {
    expect(completedRun({ completionTime: 60.5, efficientFrames: 82 }).rank).toBe('DIAMOND');
    expect(completedRun({ completionTime: 60.5, restarts: 1, efficientFrames: 82 }).rank).not.toBe('DIAMOND');
  });

  it('does not use low strafe efficiency as a hidden qualification gate', () => {
    expect(completedRun({ completionTime: 66, efficientFrames: 0 }).rank).toBe('GOLD');
  });

  it('retains Unranked for clearly poor or unfinished performance', () => {
    expect(completedRun({ completionTime: 116, falls: 9, restarts: 3 }).rank).toBe('UNRANKED');
    expect(evaluateRunRank({
      completionTime: 20,
      targetTime: 60,
      fallsCount: 0,
      restartsCount: 0,
      strafeEfficiency: 90,
      finished: false
    })).toBe('UNRANKED');
  });

  it('scales time bands with level duration instead of using one narrow global delta', () => {
    expect(completedRun({ completionTime: 78, targetTime: 60, falls: 1 }).rank)
      .toBe(completedRun({ completionTime: 156, targetTime: 120, falls: 1 }).rank);
  });
});
