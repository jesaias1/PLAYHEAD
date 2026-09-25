import { describe, it, expect, beforeEach } from 'vitest';
import { KarambitSkinSystem } from '../src/viewmodel/KarambitSkinSystem';

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

describe('Signal Decoder & Dev Signal System', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createLocalStorageMock(),
      configurable: true,
      writable: true
    });
    // Reset instance
    (KarambitSkinSystem as any).instance = undefined;
  });

  it('allows dev testing via grantDevPendingSignals and clearDevPendingSignals', () => {
    const skinSystem = KarambitSkinSystem.getInstance();

    expect(skinSystem.getPendingDropCount()).toBe(0);

    skinSystem.grantDevPendingSignals(999, 'DIAMOND');
    expect(skinSystem.getPendingDropCount()).toBe(999);

    skinSystem.clearDevPendingSignals();
    expect(skinSystem.getPendingDropCount()).toBe(0);
  });

  it('guarantees absolute duplicate protection (cannot award owned skin while unowned exist)', () => {
    const skinSystem = KarambitSkinSystem.getInstance();
    const dropEligibleSkins = skinSystem.getSkins().filter(s => s.dropEligible);

    expect(dropEligibleSkins.length).toBeGreaterThan(0);

    // Grant enough signals to decode all skins
    skinSystem.grantDevPendingSignals(100, 'DIAMOND');

    const awardedIds = new Set<string>();

    // Decode until the KNIFE pool is exhausted (gloves may be awarded too, so
    // the loop is bounded rather than counted).
    let guard = 0;
    while (
      !(skinSystem.isCollectionComplete() && skinSystem.isGloveCollectionComplete()) &&
      guard++ < 500
    ) {
      const drop = skinSystem.openSignalDrop();
      expect(drop).toBeDefined();
      if (!drop || drop.isCollectionComplete) break;
      // A decode can now yield a KNIFE or a GLOVE. Duplicate protection applies
      // WITHIN the resolved category: no repeat while unowned items remain.
      const id = drop.item.id;
      expect(awardedIds.has(id), `duplicate award ${id}`).toBe(false);
      awardedIds.add(id);
      if (drop.kind === 'KNIFE') expect(drop.skin).toBeDefined();
      if (drop.kind === 'GLOVE') expect(drop.skin).toBeUndefined();
    }

    // Every drop eligible KNIFE should now be owned.
    const ownedKnives = dropEligibleSkins.filter(s => skinSystem.isSkinRewardOwned(s.id));
    expect(ownedKnives.length).toBe(dropEligibleSkins.length);
    expect(skinSystem.isCollectionComplete()).toBe(true);

    // Any subsequent openSignalDrop must report isCollectionComplete and not award duplicate
    const extraDrop = skinSystem.openSignalDrop();
    expect(extraDrop).toBeDefined();
    expect(extraDrop!.isCollectionComplete).toBe(true);
  });
});
