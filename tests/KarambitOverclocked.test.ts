import { describe, it, expect, beforeEach } from 'vitest';
import {
  KarambitSkinSystem,
  KARAMBIT_SKINS,
  SIGNAL_DROP_RARITY_WEIGHTS
} from '../src/viewmodel/KarambitSkinSystem';
import { DROP_GLOVES } from '../src/viewmodel/DropGloveCatalog';

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

describe('Karambit Overclocked Apex Tier & Signal Drops', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createLocalStorageMock(),
      configurable: true,
      writable: true
    });
    (KarambitSkinSystem as any).instance = undefined;
  });

  it('maintains a strictly small pool containing only CYBER as OVERCLOCKED', () => {
    const overclockedSkins = KARAMBIT_SKINS.filter(s => s.rarity === 'OVERCLOCKED');
    expect(overclockedSkins).toHaveLength(1);
    expect(overclockedSkins[0].id).toBe('CYBER_ARTIFACT');
    expect(overclockedSkins[0].name).toContain('CYBER');
    expect(overclockedSkins[0].dropEligible).toBe(true);
  });

  it('configures non-zero, monotonic drop weights for OVERCLOCKED across ranks', () => {
    const wBronze = SIGNAL_DROP_RARITY_WEIGHTS.BRONZE.OVERCLOCKED;
    const wSilver = SIGNAL_DROP_RARITY_WEIGHTS.SILVER.OVERCLOCKED;
    const wGold = SIGNAL_DROP_RARITY_WEIGHTS.GOLD.OVERCLOCKED;
    const wDiamond = SIGNAL_DROP_RARITY_WEIGHTS.DIAMOND.OVERCLOCKED;

    expect(wBronze).toBeGreaterThan(0);
    expect(wSilver).toBeGreaterThan(wBronze);
    expect(wGold).toBeGreaterThan(wSilver);
    expect(wDiamond).toBeGreaterThan(wGold);
  });

  it('grants signal drops via grantSignalDrop()', () => {
    const system = KarambitSkinSystem.getInstance();
    expect(system.getPendingDropCount()).toBe(0);

    system.grantSignalDrop('BRONZE');
    expect(system.getPendingDropCount()).toBe(1);

    system.grantSignalDrop('DIAMOND');
    expect(system.getPendingDropCount()).toBe(2);
  });

  it('guarantees awarding OVERCLOCKED when it is the sole remaining unowned skin', () => {
    const system = KarambitSkinSystem.getInstance();
    const dropEligible = KARAMBIT_SKINS.filter(s => s.dropEligible);

    // Pre-own all drop-eligible skins EXCEPT the OVERCLOCKED one (CYBER_ARTIFACT)
    const otherEligibleIds = dropEligible
      .filter(s => s.id !== 'CYBER_ARTIFACT')
      .map(s => s.id);

    // Access progression through localStorage setup to simulate owning all other drop skins
    const initialProgression = {
      version: 2,
      equippedSkinId: 'SIGNAL_CYAN',
      unlockedSkinIds: ['SIGNAL_CYAN'],
      completedTracks: {},
      pendingDropRanks: ['BRONZE'],
      rewardOwnedSkinIds: otherEligibleIds,
      // Exhaust the GLOVE pool too, so the category roll falls through to KNIFE
      // (duplicate protection must never let a full glove pool block knives).
      rewardOwnedGloveIds: DROP_GLOVES.map(g => g.id),
      rewardRngState: 123456,
      rewardBag: []
    };
    localStorage.setItem('playhead.armory.signalDrops', JSON.stringify(initialProgression));

    // Reload instance with pre-owned state
    (KarambitSkinSystem as any).instance = undefined;
    const loadedSystem = KarambitSkinSystem.getInstance();

    expect(loadedSystem.getPendingDropCount()).toBe(1);
    expect(loadedSystem.isCollectionComplete()).toBe(false);

    // Open drop: even with BRONZE rank, since CYBER_ARTIFACT is the only unowned skin, it must be awarded!
    const result = loadedSystem.openSignalDrop();
    expect(result).toBeDefined();
    expect(result?.skin.id).toBe('CYBER_ARTIFACT');
    expect(result?.skin.rarity).toBe('OVERCLOCKED');
    expect(loadedSystem.isSkinUnlocked('CYBER_ARTIFACT')).toBe(true);
    expect(loadedSystem.isCollectionComplete()).toBe(true);

    // Further drops detect archive complete
    loadedSystem.grantSignalDrop('DIAMOND');
    const extraResult = loadedSystem.openSignalDrop();
    expect(extraResult?.isCollectionComplete).toBe(true);
  });
});
