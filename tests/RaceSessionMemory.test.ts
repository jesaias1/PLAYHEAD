import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RACE_SESSION_MAX_AGE_MS,
  clearRaceSession,
  readRaceSession,
  saveRaceSession
} from '../src/online/RaceSessionMemory';

describe('race session memory', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k)
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('remembers a room code and forgets it on clear', () => {
    saveRaceSession('K7M2QX', 1000);
    expect(readRaceSession(2000)).toBe('K7M2QX');
    clearRaceSession();
    expect(readRaceSession(2000)).toBeNull();
  });

  it('ignores a code older than the room lifetime, and removes it', () => {
    saveRaceSession('K7M2QX', 1000);
    expect(readRaceSession(1000 + RACE_SESSION_MAX_AGE_MS + 1)).toBeNull();
    expect(store.size).toBe(0);
  });

  it('rejects malformed codes and malformed storage', () => {
    saveRaceSession('bad code!', 1000);
    expect(store.size).toBe(0);
    store.set('m0vem1nt.race.lastRoom.v1', '{not json');
    expect(readRaceSession()).toBeNull();
    store.set('m0vem1nt.race.lastRoom.v1', JSON.stringify({ code: 'ok1234', savedAt: 'x' }));
    expect(readRaceSession()).toBeNull();
  });

  it('survives blocked storage', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } });
    expect(() => saveRaceSession('K7M2QX')).not.toThrow();
    expect(readRaceSession()).toBeNull();
    expect(() => clearRaceSession()).not.toThrow();
  });
});
