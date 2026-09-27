/**
 * ARMORY SIGNAL DROPS — retroactive migration, banking, collection progress.
 *
 * The Signal Drop economy shipped INTO a game that already had official track
 * records. These tests protect the three things that makes safe:
 *
 *   1. RETROACTIVE MIGRATION. A player who earned ranks before the economy
 *      existed gets the entitlements they already qualified for, exactly once.
 *   2. BANKING. A drop that has nothing left to spend on is never discarded and
 *      never replaced with filler.
 *   3. UNIFIED COMPLETION. The decoder covers knives AND gloves, so a finished
 *      knife set must not block an unowned glove.
 *
 * They also pin the eligibility rule so it cannot drift: only OFFICIAL Signal
 * Pack ids can produce a drop, and each rank threshold awards at most once per
 * track.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  KarambitSkinSystem,
  KARAMBIT_SKINS,
  SIGNAL_DROP_STORAGE_KEY,
  UNKNOWN_ARTIFACT_LABEL
} from '../src/viewmodel/KarambitSkinSystem';
import { DROP_GLOVES, dropEligibleGloves } from '../src/viewmodel/DropGloveCatalog';
import { SignalPackCatalog } from '../src/audio/SignalPackCatalog';
import { buildArmoryItems, filterArmoryItems } from '../src/ui/ArmoryInventory';
import { masteryGloveSystem } from '../src/mastery/MasteryGloveSystem';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const memoryStore = new Map<string, string>();

function installStorage(): void {
  memoryStore.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => memoryStore.get(k) ?? null,
      setItem: (k: string, v: string) => memoryStore.set(k, v),
      removeItem: (k: string) => memoryStore.delete(k),
      clear: () => memoryStore.clear()
    },
    writable: true,
    configurable: true
  });
}

/** Fresh singleton, so each test starts from a clean persisted state. */
function freshSystem(): KarambitSkinSystem {
  (KarambitSkinSystem as unknown as { instance: unknown }).instance = null;
  return KarambitSkinSystem.getInstance();
}

function officialIds(): string[] {
  return SignalPackCatalog.getTracks().map((t) => t.id);
}

/** Seeds a raw v2 ledger, exactly as a pre-upgrade build would have written it. */
function seedV2Save(overrides: Record<string, unknown> = {}): void {
  const v2 = {
    version: 2,
    awardedRankKeys: [],
    pendingDropRanks: [],
    rewardOwnedSkinIds: [],
    rewardBags: { BRONZE: [], SILVER: [], GOLD: [], DIAMOND: [] },
    rewardBagCursors: { BRONZE: 0, SILVER: 0, GOLD: 0, DIAMOND: 0 },
    rngState: 0x504c4159,
    ...overrides
  };
  memoryStore.set(SIGNAL_DROP_STORAGE_KEY, JSON.stringify(v2));
}

beforeEach(() => installStorage());
afterEach(() => installStorage());

// ---------------------------------------------------------------------------
// 1. Eligibility rule
// ---------------------------------------------------------------------------

describe('Signal Drop eligibility', () => {
  it('an official track awards one drop per rank threshold, once each', () => {
    const system = freshSystem();
    const levelId = officialIds()[0];

    // Straight to Diamond in one run reaches every threshold.
    const first = system.recordTrackCompletion(levelId, 'DIAMOND', levelId);
    expect(first.dropsAwarded).toBe(4);
    expect(first.pendingDrops).toBe(4);

    // Replaying the same Diamond awards nothing.
    const again = system.recordTrackCompletion(levelId, 'DIAMOND', levelId);
    expect(again.dropsAwarded).toBe(0);
    expect(system.getPendingDropCount()).toBe(4);
  });

  it('Gold awards nothing extra, and Gold -> Diamond awards only the Diamond', () => {
    const system = freshSystem();
    const levelId = officialIds()[1];

    system.recordTrackCompletion(levelId, 'GOLD', levelId);
    expect(system.getPendingDropCount()).toBe(3); // bronze + silver + gold

    const upgrade = system.recordTrackCompletion(levelId, 'DIAMOND', levelId);
    expect(upgrade.dropsAwarded).toBe(1);
    expect(upgrade.awardedDropRanks).toEqual(['DIAMOND']);
  });

  it('a non-official run never awards a drop', () => {
    const system = freshSystem();
    // Custom Audio / Movement Lab never pass an official level id.
    const reward = system.recordTrackCompletion('custom-audio-run', 'DIAMOND', null);
    expect(reward.dropsAwarded).toBe(0);
    expect(system.getPendingDropCount()).toBe(0);
  });

  it('an unrecognised level id never awards a drop', () => {
    const system = freshSystem();
    const reward = system.recordTrackCompletion('NOT_A_REAL_TRACK', 'DIAMOND', 'NOT_A_REAL_TRACK');
    expect(reward.dropsAwarded).toBe(0);
  });

  it('each official track is independent', () => {
    const system = freshSystem();
    const [a, b] = officialIds();
    system.recordTrackCompletion(a, 'DIAMOND', a);
    system.recordTrackCompletion(b, 'DIAMOND', b);
    expect(system.getPendingDropCount()).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// 2. Retroactive migration (the §7 gap)
// ---------------------------------------------------------------------------

describe('Retroactive Diamond migration', () => {
  it('back-fills entitlements from ranks stored before the economy existed', () => {
    // A pre-economy save: records exist, the drop ledger is empty.
    memoryStore.set(
      'playhead.karambit.trackRecords',
      JSON.stringify({ [officialIds()[0]]: 'DIAMOND', [officialIds()[1]]: 'GOLD' })
    );
    const system = freshSystem();

    // 4 thresholds for the Diamond track + 3 for the Gold track.
    expect(system.getPendingDropCount()).toBe(7);
    expect(system.getAwardedRankKeys()).toContain(`${officialIds()[0]}:DIAMOND`);
    expect(system.getAwardedRankKeys()).toContain(`${officialIds()[1]}:GOLD`);
    // The Gold track must NOT have claimed its Diamond entitlement.
    expect(system.getAwardedRankKeys()).not.toContain(`${officialIds()[1]}:DIAMOND`);
  });

  it('is idempotent: a second boot creates nothing new', () => {
    memoryStore.set(
      'playhead.karambit.trackRecords',
      JSON.stringify({ [officialIds()[0]]: 'DIAMOND' })
    );
    freshSystem();
    const afterFirst = memoryStore.get(SIGNAL_DROP_STORAGE_KEY)!;
    const pendingFirst = JSON.parse(afterFirst).pendingDropRanks.length;

    // Reload from the SAME storage.
    (KarambitSkinSystem as unknown as { instance: unknown }).instance = null;
    const second = KarambitSkinSystem.getInstance();

    expect(second.getPendingDropCount()).toBe(pendingFirst);
    expect(second.migrateEarnedDrops()).toBe(0);
  });

  it('does not duplicate entitlements already claimed by the ladder', () => {
    memoryStore.set(
      'playhead.karambit.trackRecords',
      JSON.stringify({ [officialIds()[0]]: 'DIAMOND' })
    );
    // The ladder already awarded everything for this track.
    const levelId = officialIds()[0];
    seedV2Save({
      awardedRankKeys: ['BRONZE', 'SILVER', 'GOLD', 'DIAMOND'].map((r) => `${levelId}:${r}`)
    });
    const system = freshSystem();
    expect(system.getPendingDropCount()).toBe(0);
  });

  it('never rewards a legacy non-official key', () => {
    memoryStore.set(
      'playhead.karambit.trackRecords',
      JSON.stringify({ 'some-custom-audio-file': 'DIAMOND' })
    );
    const system = freshSystem();
    expect(system.getPendingDropCount()).toBe(0);
  });

  it('preserves every unrelated field of a v2 save', () => {
    seedV2Save({
      rewardOwnedSkinIds: ['ASTRAL'],
      rewardOwnedGloveIds: ['DROP_GLOVE_PEARL'],
      pendingDropRanks: ['GOLD'],
      rngState: 12345
    });
    const system = freshSystem();
    expect(system.getRewardOwnedSkinIds()).toContain('ASTRAL');
    expect(system.isDropGloveOwned('DROP_GLOVE_PEARL')).toBe(true);
    expect(system.getPendingDropCount()).toBe(1);
    expect(system.getEquippedSkinId()).toBe('SIGNAL_CYAN');
  });

  it('a v2 ledger is migrated forward, never discarded', () => {
    seedV2Save({ rewardOwnedSkinIds: ['ASTRAL'], pendingDropRanks: ['SILVER'] });
    const system = freshSystem();
    // If the version gate had dropped it, both of these would be empty.
    expect(system.getRewardOwnedSkinIds()).toContain('ASTRAL');
    expect(system.getPendingDropCount()).toBe(1);
  });

  it('an unreadable ledger fails gracefully without touching records', () => {
    memoryStore.set(SIGNAL_DROP_STORAGE_KEY, '{ not json');
    memoryStore.set(
      'playhead.karambit.trackRecords',
      JSON.stringify({ [officialIds()[0]]: 'DIAMOND' })
    );
    const system = freshSystem();
    // The ledger resets, then the migration re-derives from the records.
    expect(system.getPendingDropCount()).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 3. Banking (the §6 gap)
// ---------------------------------------------------------------------------

describe('Pool exhaustion banks drops', () => {
  function completeEverything(system: KarambitSkinSystem): void {
    // Glove ids travel through the same generic ledger, namespace-split by the
    // `DROP_GLOVE_` prefix — there is no separate cloud field for them.
    system.applyCloudProgression({
      rewardOwnedSkinIds: [
        ...KARAMBIT_SKINS.filter((s) => s.dropEligible).map((s) => s.id),
        ...dropEligibleGloves().map((g) => g.id)
      ]
    });
  }

  it('reports completion only when BOTH families are owned', () => {
    const system = freshSystem();
    expect(system.getCollectionProgress().complete).toBe(false);

    system.applyCloudProgression({
      rewardOwnedSkinIds: KARAMBIT_SKINS.filter((s) => s.dropEligible).map((s) => s.id)
    });
    // Knives alone are not a completed archive.
    expect(system.isCollectionComplete()).toBe(false);

    completeEverything(system);
    expect(system.isCollectionComplete()).toBe(true);
    expect(system.getCollectionProgress().owned).toBe(system.getCollectionProgress().total);
  });

  it('an unspendable drop is banked, not thrown away or faked', () => {
    const system = freshSystem();
    completeEverything(system);
    system.grantDevPendingSignals(3, 'DIAMOND');
    expect(system.getPendingDropCount()).toBe(3);
    expect(system.getBankedDropCount()).toBe(0);

    const drop = system.openSignalDrop();
    expect(drop).not.toBeNull();
    expect(drop!.isCollectionComplete).toBe(true);

    // The pending drop was consumed into the bank rather than vanishing.
    expect(system.getPendingDropCount()).toBe(2);
    expect(system.getBankedDropCount()).toBe(1);
  });

  it('banked drops persist across a reload', () => {
    const system = freshSystem();
    completeEverything(system);
    system.grantDevPendingSignals(1, 'GOLD');
    system.openSignalDrop();
    expect(system.getBankedDropCount()).toBe(1);

    (KarambitSkinSystem as unknown as { instance: unknown }).instance = null;
    const reloaded = KarambitSkinSystem.getInstance();
    expect(reloaded.getBankedDropCount()).toBe(1);
  });

  it('the total unopened count includes banked drops', () => {
    const system = freshSystem();
    completeEverything(system);
    system.grantDevPendingSignals(2, 'GOLD');
    system.openSignalDrop();
    expect(system.getTotalUnownedDropCount()).toBe(2); // 1 pending + 1 banked
  });

  it('a non-exhausted pool still awards normally', () => {
    const system = freshSystem();
    system.grantDevPendingSignals(1, 'GOLD');
    const drop = system.openSignalDrop();
    expect(drop).not.toBeNull();
    expect(drop!.isCollectionComplete).toBeFalsy();
    expect(system.getBankedDropCount()).toBe(0);
    expect(system.getPendingDropCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Duplicate protection
// ---------------------------------------------------------------------------

describe('Duplicate protection', () => {
  it('never awards an owned cosmetic while unowned ones remain', () => {
    const system = freshSystem();
    system.grantDevPendingSignals(20, 'DIAMOND');
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const drop = system.openSignalDrop();
      if (!drop || drop.isCollectionComplete) break;
      expect(seen.has(drop.item.id)).toBe(false);
      seen.add(drop.item.id);
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  it('an already-owned cosmetic is excluded from the pool', () => {
    const system = freshSystem();
    // Own everything except one glove.
    const allGloves = dropEligibleGloves().map((g) => g.id);
    const spare = allGloves[0];
    system.applyCloudProgression({
      rewardOwnedSkinIds: [
        ...KARAMBIT_SKINS.filter((s) => s.dropEligible).map((s) => s.id),
        ...allGloves.filter((g) => g !== spare)
      ]
    });
    system.grantDevPendingSignals(5, 'GOLD');

    const drop = system.openSignalDrop();
    expect(drop).not.toBeNull();
    expect(drop!.isCollectionComplete).toBeFalsy();
    expect(drop!.item.id).toBe(spare);
  });
});

// ---------------------------------------------------------------------------
// 5. Locked artifact presentation (§20)
// ---------------------------------------------------------------------------

describe('Locked artifact presentation', () => {
  function armoryKnives(system: KarambitSkinSystem) {
    const items = buildArmoryItems({
      skins: system.getSkins(),
      skinOwned: (id) => system.isSkinUnlocked(id),
      skinProgress: (id) => system.getSkinProgress(id).label,
      equippedKnifeId: system.getEquippedSkinId(),
      dropGloves: DROP_GLOVES,
      dropOwned: (id) => system.isDropGloveOwned(id),
      masteryGloves: masteryGloveSystem.evaluate().gloves,
      equippedGloveId: masteryGloveSystem.getEquippedGloveId()
    });
    return filterArmoryItems(items, {
      slot: 'karambit',
      gloveFamily: 'all',
      ownership: 'all',
      sort: 'rarity'
    });
  }

  it('a locked artifact withholds its name', () => {
    const system = freshSystem();
    const items = armoryKnives(system);
    const lockedArtifacts = items.filter((i) => !i.owned && i.isLive);
    expect(lockedArtifacts.length).toBeGreaterThan(0);
    for (const item of lockedArtifacts) {
      expect(item.displayName).toBe(UNKNOWN_ARTIFACT_LABEL);
      expect(item.nameHidden).toBe(true);
      // The real identity is still carried internally for ids and logic.
      expect(item.name).not.toBe(UNKNOWN_ARTIFACT_LABEL);
    }
  });

  it('a locked static skin still shows its real name', () => {
    const system = freshSystem();
    const items = armoryKnives(system);
    const lockedStatic = items.filter((i) => !i.owned && !i.isLive);
    expect(lockedStatic.length).toBeGreaterThan(0);
    for (const item of lockedStatic) {
      expect(item.displayName).toBe(item.name);
      expect(item.nameHidden).toBe(false);
    }
  });

  it('the real name is permanent once discovered', () => {
    const system = freshSystem();
    const artifact = KARAMBIT_SKINS.find((s) => s.lockedNameBehavior === 'UNKNOWN')!;
    system.applyCloudProgression({ rewardOwnedSkinIds: [artifact.id] });
    const item = armoryKnives(system).find((i) => i.id === artifact.id)!;
    expect(item.owned).toBe(true);
    expect(item.displayName).toBe(artifact.name);
    expect(item.nameHidden).toBe(false);
  });

  it('the behaviour is data-driven, not a hardcoded id list', () => {
    const unknown = KARAMBIT_SKINS.filter((s) => s.lockedNameBehavior === 'UNKNOWN');
    expect(unknown.length).toBeGreaterThan(0);
    // Every name-withholding skin is an exceptional VIDEO reward. Keyed on the
    // asset type, not the rarity label: the apex skin carries OVERCLOCKED.
    expect(unknown.every((s) => !!s.profile.isVideoArtifact)).toBe(true);
    // And the converse: every video artifact withholds its name.
    const videoArtifacts = KARAMBIT_SKINS.filter((s) => !!s.profile.isVideoArtifact);
    expect(videoArtifacts.every((s) => s.lockedNameBehavior === 'UNKNOWN')).toBe(true);
    // And the label is a single named constant.
    expect(UNKNOWN_ARTIFACT_LABEL).toBe('UNKNOWN ARTIFACT');
  });
});

// ---------------------------------------------------------------------------
// 7. Artifact video lifecycle (§13) — behavioural, with a stubbed DOM
//
// The viewmodel only creates the video when the equipped skin is applied, so the
// menu cannot exercise it. A minimal `document` stub lets the REAL creation path
// run in Node and proves the element contract and the one-video invariant.
// ---------------------------------------------------------------------------

describe('Artifact video lifecycle', () => {
  interface FakeVideo {
    src: string;
    muted: boolean;
    defaultMuted: boolean;
    loop: boolean;
    playsInline: boolean;
    preload: string;
    crossOrigin: string;
    controls: boolean;
    disablePictureInPicture: boolean;
    paused: boolean;
    playCalls: number;
    pauseCalls: number;
    loadCalls: number;
    removedSrc: boolean;
    play(): Promise<void>;
    pause(): void;
    load(): void;
    removeAttribute(name: string): void;
  }

  let created: FakeVideo[] = [];
  let originalDocument: unknown;

  function makeFakeVideo(): FakeVideo {
    const v: FakeVideo = {
      src: '',
      muted: false,
      defaultMuted: false,
      loop: false,
      playsInline: false,
      preload: '',
      crossOrigin: '',
      controls: true,
      disablePictureInPicture: false,
      paused: true,
      playCalls: 0,
      pauseCalls: 0,
      loadCalls: 0,
      removedSrc: false,
      play() {
        v.playCalls++;
        v.paused = false;
        return Promise.resolve();
      },
      pause() {
        v.pauseCalls++;
        v.paused = true;
      },
      load() {
        v.loadCalls++;
      },
      removeAttribute(name: string) {
        if (name === 'src') {
          v.src = '';
          v.removedSrc = true;
        }
      }
    };
    created.push(v);
    return v;
  }

  beforeEach(() => {
    created = [];
    originalDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement: (tag: string) => (tag === 'video' ? makeFakeVideo() : {}),
      // THREE's ImageLoader uses createElementNS and attaches listeners.
      createElementNS: () => ({
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        setAttribute: () => undefined,
        removeAttribute: () => undefined,
        style: {},
        src: '',
        crossOrigin: '',
        width: 0,
        height: 0
      })
    };
  });

  afterEach(() => {
    (globalThis as { document?: unknown }).document = originalDocument;
  });

  it('creates a muted, looping, inline video with no audio and no controls', () => {
    const system = freshSystem();
    system.applyCloudProgression({ rewardOwnedSkinIds: ['SIGNALISM_ARTIFACT'] });
    system.equipSkin('SIGNALISM_ARTIFACT');

    const texture = system.getSkinTexture('SIGNALISM_ARTIFACT');
    expect(texture).not.toBeNull();
    expect(created).toHaveLength(1);

    const v = created[0];
    expect(v.muted).toBe(true);
    expect(v.defaultMuted).toBe(true);
    expect(v.loop).toBe(true);
    expect(v.playsInline).toBe(true);
    expect(v.controls).toBe(false);
    expect(v.disablePictureInPicture).toBe(true);
    expect(v.src).toContain('signalism');
    // Playback was attempted (the browser may still defer it to a gesture).
    expect(v.playCalls).toBe(1);
  });

  it('never decodes more than ONE video at a time', () => {
    const system = freshSystem();
    system.applyCloudProgression({
      rewardOwnedSkinIds: ['SIGNALISM_ARTIFACT', 'GOD_RUN_ARTIFACT']
    });

    system.equipSkin('SIGNALISM_ARTIFACT');
    system.getSkinTexture('SIGNALISM_ARTIFACT');
    expect(system.getActiveVideoCount()).toBe(1);

    // Re-requesting the same equipped skin reuses the texture.
    system.getSkinTexture('SIGNALISM_ARTIFACT');
    expect(created).toHaveLength(1);
    expect(system.getActiveVideoCount()).toBe(1);

    // Switching artifacts releases the first and creates exactly one more.
    system.equipSkin('GOD_RUN_ARTIFACT');
    system.getSkinTexture('GOD_RUN_ARTIFACT');
    expect(created).toHaveLength(2);
    expect(system.getActiveVideoCount()).toBe(1);
    expect(created[0].pauseCalls).toBeGreaterThan(0);
    expect(created[0].removedSrc).toBe(true);
    expect(created[1].src).toContain('god-run');
  });

  it('releases the video when swapping back to a static skin', () => {
    const system = freshSystem();
    system.applyCloudProgression({
      rewardOwnedSkinIds: ['SIGNALISM_ARTIFACT', 'ASTRAL']
    });

    system.equipSkin('SIGNALISM_ARTIFACT');
    system.getSkinTexture('SIGNALISM_ARTIFACT');
    expect(system.getActiveVideoCount()).toBe(1);

    system.equipSkin('ASTRAL');
    // Equipping a static skin must release the decoder immediately.
    expect(system.getActiveVideoCount()).toBe(0);
    expect(created[0].paused).toBe(true);
    expect(created[0].removedSrc).toBe(true);
    expect(created).toHaveLength(1);
  });

  it('a missing video asset never throws', () => {
    const system = freshSystem();
    system.applyCloudProgression({ rewardOwnedSkinIds: ['SIGNALISM_ARTIFACT'] });
    system.equipSkin('SIGNALISM_ARTIFACT');
    expect(() => system.getSkinTexture('SIGNALISM_ARTIFACT')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 8. Frozen viewmodel contracts (§3, §22)
// ---------------------------------------------------------------------------

describe('Viewmodel contracts unchanged', () => {
  function readFile(rel: string): string {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.join(path.resolve(__dirname, '..'), rel), 'utf8');
  }

  it('the knife calibration is byte-identical to the approved values', () => {
    const src = readFile('src/viewmodel/ViewmodelAssetLoader.ts');
    expect(src).toContain('knifeGroup.position.set(0.0093, 0.1107, 0.0033)');
    expect(src).toContain('knifeGroup.rotation.set(3.034, 0.3737, 0.2205)');
    expect(src).toContain('knifeGroup.scale.set(1.011, 1.011, 1.011)');
  });

  it('cosmetic actions animate an action group ABOVE the knife socket', () => {
    const src = readFile('src/viewmodel/ViewmodelController.ts');
    // The hierarchy the frozen calibration requires.
    expect(src).toMatch(/rootGroup/);
    expect(src).toMatch(/swayGroup/);
    expect(src).toMatch(/actionGroup/);
    // The F pulse and Mouse1 jab write the action group, never the socket.
    expect(src).toMatch(/this\.actionGroup\.position\.set\(0\.002 \* p/);
    expect(src).toMatch(/this\.actionGroup\.rotation\.set\(-0\.14 \* p/);
    expect(src).toMatch(/this\.actionGroup\.position\.set\(-0\.006 \* p/);
    // The ACTION block specifically must not touch the socket. (The DEV
    // calibration loader elsewhere is the only writer, and it is not cosmetic.)
    const actionBlock = src.slice(
      src.indexOf('// 10. Action Motion on actionGroup'),
      src.indexOf('// 10. Action Motion on actionGroup') + 2400
    );
    expect(actionBlock).not.toMatch(/knifeSocket/);
    // Only the word `knifeGroup` in a comment may appear: no write to it.
    expect(actionBlock).not.toMatch(/knifeGroup\.(position|rotation|scale)\.set/);
  });

  it('F and Mouse1 are bound to presentation-only triggers', () => {
    const src = readFile('src/core/Game.ts');
    expect(src).toMatch(/e\.code === 'KeyF'/);
    expect(src).toMatch(/triggerSignalPulse\(\)/);
    expect(src).toMatch(/e\.button === 0/);
    expect(src).toMatch(/triggerMicroJab\(\)/);
  });

  it('the adaptive accent is driven by the map palette, not by whole-hand tinting', () => {
    const src = readFile('src/viewmodel/ViewmodelController.ts');
    expect(src).toMatch(/ADAPTIVE VIEWMODEL ACCENT/);
    expect(src).toMatch(/palette\.primary \|\| palette\.secondary \|\| palette\.highlight/);
  });
});

describe('Collection progress', () => {
  it('counts both families and reports a stable total', () => {
    const system = freshSystem();
    const knives = KARAMBIT_SKINS.filter((s) => s.dropEligible).length;
    const gloves = dropEligibleGloves().length;
    const progress = system.getCollectionProgress();
    expect(progress.total).toBe(knives + gloves);
    expect(progress.owned).toBeGreaterThanOrEqual(0);
    expect(progress.owned).toBeLessThanOrEqual(progress.total);
  });

  it('the standard issue knife is not part of the recoverable archive', () => {
    const system = freshSystem();
    // SIGNAL_CYAN is issued by default and must not consume a drop.
    const cyan = KARAMBIT_SKINS.find((s) => s.id === 'SIGNAL_CYAN')!;
    expect(cyan.dropEligible).toBe(false);
    expect(system.getSkins().some((s) => s.id === 'SIGNAL_CYAN')).toBe(true);
  });
});
