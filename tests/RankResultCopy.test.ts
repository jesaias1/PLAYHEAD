import { describe, expect, it } from 'vitest';
import { RunResults } from '../src/player/PlayerStats';
import { getUnrankedReason } from '../src/ui/RankResultCopy';

const base: RunResults = {
  completionTime: 120,
  targetTime: 60,
  syncDelta: 60,
  maxSpeed: 1000,
  averageSpeed: 600,
  strafeEfficiency: 20,
  fallsCount: 4,
  restartsCount: 0,
  rank: 'UNRANKED',
  score: 100
};

describe('unranked result explanation', () => {
  it('shows the actual Bronze time miss instead of a generic rejection', () => {
    expect(getUnrankedReason({
      ...base,
      rankFailureReason: 'BRONZE_TIME_MISSED',
      bronzeTimeOverage: 8.75
    }, true)).toBe('// BRONZE TARGET MISSED // +8.8s');
  });

  it('distinguishes invalid timing and unfinished routes', () => {
    expect(getUnrankedReason({ ...base, rankFailureReason: 'INVALID_RUN' }, false))
      .toContain('TIMING DATA ERROR');
    expect(getUnrankedReason({ ...base, rankFailureReason: 'UNFINISHED' }, false))
      .toContain('FINISH NOT REGISTERED');
  });
});
