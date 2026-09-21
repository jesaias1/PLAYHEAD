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

    const awardedSkinIds = new Set<string>();

    for (let i = 0; i < dropEligibleSkins.length; i++) {
      const drop = skinSystem.openSignalDrop();
      expect(drop).toBeDefined();
      expect(drop!.skin).toBeDefined();
      expect(awardedSkinIds.has(drop!.skin.id)).toBe(false); // Must never be duplicate!
      awardedSkinIds.add(drop!.skin.id);
    }

    // Now all drop eligible skins should be owned
    expect(awardedSkinIds.size).toBe(dropEligibleSkins.length);
    expect(skinSystem.isCollectionComplete()).toBe(true);

    // Any subsequent openSignalDrop must report isCollectionComplete and not award duplicate
    const extraDrop = skinSystem.openSignalDrop();
    expect(extraDrop).toBeDefined();
    expect(extraDrop!.isCollectionComplete).toBe(true);
  });
});
