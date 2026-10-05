import { describe, expect, it } from 'vitest';
import { evaluateRunRank, type RunRank } from '../src/player/PlayerStats';
import { SignalPackCatalog } from '../src/audio/SignalPackCatalog';
import { GameState, StateMachine } from '../src/core/StateMachine';
import { describeNextRankTarget, nextRankTarget, nextSignalAfter, pbImprovement } from '../src/mastery/SignalPackMastery';

describe('actionable mastery goals', () => {
  it('can load and play from a run report without an import-screen transition', () => {
    const states: GameState[] = [];
    const machine = new StateMachine(GameState.FINISHED);
    machine.onTransition(state => states.push(state));
    for (const state of [GameState.ANALYSING, GameState.READY, GameState.COUNTDOWN, GameState.PLAYING]) {
      expect(machine.transitionTo(state)).toBe(true);
    }
    expect(machine.getState()).toBe(GameState.PLAYING);
    expect(states).not.toContain(GameState.IMPORT);
  });
  it.each([
    ['BRONZE', 'SILVER', 4, 3], ['SILVER', 'GOLD', 2, 1], ['GOLD', 'DIAMOND', 1, 0]
  ] as const)('shows qualification, not a false speed gap, after %s', (current, next, mistakes, allowed) => {
    const target = nextRankTarget(100, current, 100, mistakes)!;
    expect(target.rank).toBe(next);
    expect(target.cleanRunRequired).toBe(true);
    expect(describeNextRankTarget(target)).toContain(`${allowed} FALLS / RESTARTS MAX`);
    expect(evaluateRunRank({ completionTime: target.timeSeconds, targetTime: 100, fallsCount: allowed, restartsCount: 0, strafeEfficiency: 0 })).toBe(next);
  });
  it('does not invent PB mistake data on a track card', () => {
    expect(nextRankTarget(100, 'GOLD', 90)!.cleanRunRequired).toBe(true);
  });
  it('uses the actual next band time and honest required improvement', () => {
    expect(nextRankTarget(100, 'GOLD', 106, 0)).toMatchObject({ timeSeconds: 104, deltaSeconds: 2, cleanRunRequired: false });
    expect(nextRankTarget(0, 'GOLD', 106)).toBeNull();
    expect(nextRankTarget(100, 'DIAMOND', 100)).toBeNull();
  });
  it('advances the first finish to the authored second signal even without a rank', () => {
    const tracks = SignalPackCatalog.getTracks();
    expect(nextSignalAfter(tracks, tracks[0].id, {})).toEqual(tracks[1]);
  });
  it('returns to unfinished mastery after the final signal without recommending itself', () => {
    const tracks = SignalPackCatalog.getTracks();
    const ranks = Object.fromEntries(tracks.map(track => [track.id, 'DIAMOND'])) as Record<string, RunRank>;
    ranks[tracks[3].id] = 'GOLD';
    expect(nextSignalAfter(tracks, tracks.at(-1)!.id, ranks)).toEqual(tracks[3]);
    expect(nextSignalAfter(tracks, 'custom-audio', ranks)).toBeNull();
  });
  it('distinguishes an actual PB from a first local replay after cloud sync', () => {
    expect(pbImprovement(44.809, 44.112)).toBeCloseTo(.697);
    expect(pbImprovement(40, 44)).toBeNull();
    expect(pbImprovement(44, 44)).toBeNull();
    expect(pbImprovement(null, 44)).toBeNull();
  });
});
