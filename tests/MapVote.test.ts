import { describe, expect, it } from 'vitest';
import { drawRaceMap, hashString } from '../src/online/MapVote';

describe('race map vote', () => {
  const votes = new Map([['alice', 'ORBITAL_STATION'], ['bob', 'MIDNIGHT_HARBOUR']]);

  it('is the same on every client, whatever order the racers are listed in', () => {
    const a = drawRaceMap('race-123', votes, ['alice', 'bob'], 'CITY');
    const b = drawRaceMap('race-123', new Map([...votes].reverse()), ['bob', 'alice'], 'CITY');
    expect(a).toEqual(b);
  });

  it('draws one of the two voted maps, and both come up across races', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const draw = drawRaceMap(`race-${i}`, votes, ['alice', 'bob'], 'CITY');
      expect(['ORBITAL_STATION', 'MIDNIGHT_HARBOUR']).toContain(draw.key);
      expect(draw.drawn).toBe(true);
      seen.add(draw.key);
    }
    expect(seen.size).toBe(2);
  });

  it('is not a draw when everyone votes for the same map', () => {
    const same = new Map([['alice', 'CITY'], ['bob', 'CITY']]);
    expect(drawRaceMap('race-1', same, ['alice', 'bob'], 'ORBITAL_STATION')).toEqual({ key: 'CITY', options: ['CITY'], drawn: false });
  });

  it('counts a racer who has not voted as the fallback, and survives an empty room', () => {
    const one = new Map([['alice', 'ORBITAL_STATION']]);
    const draw = drawRaceMap('race-9', one, ['alice', 'bob'], 'CITY');
    expect(draw.options.sort()).toEqual(['CITY', 'ORBITAL_STATION']);
    expect(drawRaceMap('race-9', new Map(), [], 'CITY').key).toBe('CITY');
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});
