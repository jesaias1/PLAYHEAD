import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KarambitSkinSystem, KARAMBIT_SKINS } from '../src/viewmodel/KarambitSkinSystem';

function createLocalStorageMock(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, String(value)); }
  };
}

describe('BLACKSTAR reserved as WORLD RECORD reward', () => {
  beforeEach(() => {
    (KarambitSkinSystem as any).instance?.dispose?.();
    Object.defineProperty(globalThis, 'localStorage', {
      value: createLocalStorageMock(),
      configurable: true,
      writable: true
    });
    (KarambitSkinSystem as any).instance = null;
  });
  afterEach(() => {
    (KarambitSkinSystem as any).instance?.dispose?.();
    (KarambitSkinSystem as any).instance = null;
    vi.restoreAllMocks();
  });

  it('is no longer in the random Signal Drop pool', () => {
    const blackstar = KARAMBIT_SKINS.find((s) => s.id === 'BLACKSTAR')!;
    expect(blackstar).toBeDefined();
    expect(blackstar.dropEligible).toBe(false);
  });

  it('can still be earned by the 14-diamond unlock and equipped', () => {
    const system = KarambitSkinSystem.getInstance();
    // A historical/prestige unlock is preserved even though the skin is not
    // drop-eligible: ownership is a ledger union, not a pool membership test.
    system.applyCloudProgression({ rewardOwnedSkinIds: ['BLACKSTAR'] });
    expect(system.isSkinUnlocked('BLACKSTAR')).toBe(true);
    expect(system.equipSkin('BLACKSTAR')).toBe(true);
    expect(system.getEquippedSkinId()).toBe('BLACKSTAR');
  });

  it('never awards BLACKSTAR through a random decode, even after many rolls', () => {
    const system = KarambitSkinSystem.getInstance();
    system.grantDevPendingSignals(400, 'DIAMOND');
    const sawBlackstar = [];
    let guard = 0;
    while (system.getPendingDropCount() > 0 && guard++ < 600) {
      const drop = system.openSignalDrop();
      if (!drop || drop.isCollectionComplete) break;
      if (drop.item.id === 'BLACKSTAR') sawBlackstar.push(drop.item.id);
    }
    expect(sawBlackstar).toHaveLength(0);
  });
});
