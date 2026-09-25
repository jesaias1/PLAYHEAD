/**
 * SIGNAL DROP GLOVES V1 — unified knife + glove Signal Decoder.
 *
 * CORE PRODUCT RULE: a decoded Signal can reveal a KARAMBIT or a GLOVE, but a
 * MASTERY glove must never enter the random pool. The two glove families must
 * never blur:
 *
 *   MASTERY   earned from canonical official progress. Never random.
 *   DROP      rolled by the decoder. Never achievement-based.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';

import {
  KarambitSkinSystem,
  KARAMBIT_SKINS,
  SIGNAL_DROP_STORAGE_KEY
} from '../src/viewmodel/KarambitSkinSystem';
import { DROP_GLOVES, getDropGlove, isDropGloveId } from '../src/viewmodel/DropGloveCatalog';
import {
  SIGNAL_DROP_CATEGORY_WEIGHTS,
  rollDropCategory,
  resolveDropCategory,
  totalCategoryWeight,
  cosmeticKindLabel
} from '../src/viewmodel/CosmeticDrop';
import { MASTERY_GLOVES } from '../src/mastery/MasteryLadder';
import { MasteryGloveSystem } from '../src/mastery/MasteryGloveSystem';
import {
  DROP_GLOVE_TREATMENTS,
  resolveGloveTreatment
} from '../src/viewmodel/GloveTreatments';
import {
  hasAnyOwnGloveTexture,
  resolveAnyGloveTexturePath,
  GloveTextureCache,
  GloveTextureSwitcher,
  configureGloveTexture,
  installGloveMaskPatch
} from '../src/viewmodel/GloveTextures';
import { ViewmodelAssetLoader } from '../src/viewmodel/ViewmodelAssetLoader';
import { describeGloveSource } from '../src/online/PlayerProfileService';
import { SignalPackCatalog } from '../src/audio/SignalPackCatalog';

const repoRoot = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const PUBLIC = path.join(repoRoot, 'public');

function createLocalStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, String(v))
  } as Storage;
}

let skinSystem: KarambitSkinSystem;

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: createLocalStorageMock(),
    configurable: true,
    writable: true
  });
  (KarambitSkinSystem as unknown as { instance: unknown }).instance = null;
  skinSystem = KarambitSkinSystem.getInstance();
  MasteryGloveSystem.getInstance().resetForTests();
});

afterEach(() => {
  (KarambitSkinSystem as unknown as { instance: unknown }).instance = null;
  MasteryGloveSystem.getInstance().resetForTests();
});

// ---------------------------------------------------------------------------
// 1. Catalog and id hygiene
// ---------------------------------------------------------------------------

describe('Signal Drop glove catalog', () => {
  it('uses a separate DROP_GLOVE_* id namespace', () => {
    expect(DROP_GLOVES.length).toBeGreaterThan(0);
    for (const glove of DROP_GLOVES) {
      expect(isDropGloveId(glove.id), glove.id).toBe(true);
      expect(glove.id.startsWith('DROP_GLOVE_'), glove.id).toBe(true);
    }
  });

  it('never collides with a mastery glove id or name', () => {
    const masteryIds = new Set<string>(MASTERY_GLOVES.map((g) => g.id));
    const masteryNames = new Set(MASTERY_GLOVES.map((g) => g.name.toUpperCase()));
    for (const glove of DROP_GLOVES) {
      expect(masteryIds.has(glove.id), glove.id).toBe(false);
      expect(masteryNames.has(glove.name.toUpperCase()), glove.name).toBe(false);
    }
  });

  it('assigns a sensible, non-flat rarity spread', () => {
    const counts = new Map<string, number>();
    for (const glove of DROP_GLOVES) {
      counts.set(glove.rarity, (counts.get(glove.rarity) ?? 0) + 1);
    }
    // Not every glove is top rarity.
    expect(counts.get('OVERCLOCKED') ?? 0).toBeLessThanOrEqual(1);
    expect(counts.get('ARTIFACT') ?? 0).toBeLessThanOrEqual(2);
    // And there are genuinely common entries.
    expect((counts.get('STANDARD') ?? 0) + (counts.get('RARE') ?? 0)).toBeGreaterThanOrEqual(3);
  });

  it('every drop glove ships a real, appropriately sized still texture', () => {
    for (const glove of DROP_GLOVES) {
      expect(glove.texturePath).toMatch(/\.webp$/);
      const abs = path.join(PUBLIC, glove.texturePath.replace(/^\//, ''));
      expect(fs.existsSync(abs), glove.texturePath).toBe(true);
      const size = fs.statSync(abs).size;
      expect(size, glove.texturePath).toBeLessThan(200 * 1024);
    }
  });

  it('no glove texture is a video or an animated format', () => {
    for (const glove of DROP_GLOVES) {
      expect(glove.texturePath).not.toMatch(/\.(mp4|webm|mov|gif|m3u8)$/i);
    }
    // And the pipeline rejects video paths outright.
    const src = read('src/viewmodel/GloveTextures.ts');
    expect(src).not.toMatch(/\.mp4|\.webm|VideoTexture/);
  });

  it('the shared glove mask is shipped for base-colour composition', () => {
    const mask = path.join(PUBLIC, 'assets/viewmodel/gloves/glove_mask.webp');
    expect(fs.existsSync(mask)).toBe(true);
    expect(fs.statSync(mask).size).toBeLessThan(50 * 1024);
  });
});

// ---------------------------------------------------------------------------
// 2. Category weighting lives in ONE place
// ---------------------------------------------------------------------------

describe('Drop category weighting', () => {
  it('is 65 / 35 and declared in exactly one named location', () => {
    expect(SIGNAL_DROP_CATEGORY_WEIGHTS.KNIFE).toBe(65);
    expect(SIGNAL_DROP_CATEGORY_WEIGHTS.GLOVE).toBe(35);
    expect(totalCategoryWeight()).toBe(100);

    // No magic numbers scattered in the award path.
    const src = read('src/viewmodel/KarambitSkinSystem.ts');
    expect(src).toMatch(/rollDropCategory/);
    expect(src).not.toMatch(/0\.65|65 \/|Math\.random\(\) < 0\./);
  });

  it('rolls the configured split', () => {
    expect(rollDropCategory(0)).toBe('KNIFE');
    expect(rollDropCategory(0.649)).toBe('KNIFE');
    expect(rollDropCategory(0.65)).toBe('GLOVE');
    expect(rollDropCategory(0.999)).toBe('GLOVE');
    // Degenerate inputs are clamped, never NaN.
    expect(rollDropCategory(Number.NaN)).toBe('KNIFE');
    expect(rollDropCategory(-5)).toBe('KNIFE');
    expect(rollDropCategory(5)).toBe('GLOVE');
  });

  it('honours custom weights without code changes', () => {
    const glovesOnly = { KNIFE: 0, GLOVE: 10 };
    expect(rollDropCategory(0, glovesOnly)).toBe('GLOVE');
    expect(rollDropCategory(0.99, glovesOnly)).toBe('GLOVE');
  });

  it('falls through to the other category when the rolled one is exhausted', () => {
    expect(resolveDropCategory('GLOVE', { KNIFE: 3, GLOVE: 0 })).toBe('KNIFE');
    expect(resolveDropCategory('KNIFE', { KNIFE: 0, GLOVE: 4 })).toBe('GLOVE');
    expect(resolveDropCategory('KNIFE', { KNIFE: 2, GLOVE: 4 })).toBe('KNIFE');
    // Both exhausted: no category.
    expect(resolveDropCategory('KNIFE', { KNIFE: 0, GLOVE: 0 })).toBeNull();
  });

  it('labels the slot type explicitly', () => {
    expect(cosmeticKindLabel('KNIFE')).toBe('KARAMBIT');
    expect(cosmeticKindLabel('GLOVE')).toBe('GLOVE');
  });
});

// ---------------------------------------------------------------------------
// 3. Awarding
// ---------------------------------------------------------------------------

describe('Signal Decoder awards', () => {
  it('can award a KNIFE', () => {
    // Exhaust gloves so the award must be a knife.
    skinSystem.applyCloudProgression({ rewardOwnedSkinIds: DROP_GLOVES.map((g) => g.id) });
    skinSystem.grantDevPendingSignals(20, 'GOLD');

    const drop = skinSystem.openSignalDrop();
    expect(drop).not.toBeNull();
    expect(drop!.kind).toBe('KNIFE');
    expect(drop!.skin).toBeDefined();
    expect(drop!.item.kind).toBe('KNIFE');
    expect(drop!.item.id).toBe(drop!.skin!.id);
    expect(skinSystem.isSkinRewardOwned(drop!.item.id)).toBe(true);
  });

  it('can award a GLOVE', () => {
    // Exhaust knives so the award must be a glove.
    const knifeIds = KARAMBIT_SKINS.filter((s) => s.dropEligible).map((s) => s.id);
    skinSystem.applyCloudProgression({ rewardOwnedSkinIds: knifeIds });
    skinSystem.grantDevPendingSignals(20, 'GOLD');

    const drop = skinSystem.openSignalDrop();
    expect(drop).not.toBeNull();
    expect(drop!.kind).toBe('GLOVE');
    expect(drop!.skin).toBeUndefined();
    expect(isDropGloveId(drop!.item.id)).toBe(true);
    expect(skinSystem.isDropGloveOwned(drop!.item.id)).toBe(true);
    // A glove award never writes the knife ledger.
    expect(skinSystem.getRewardOwnedSkinIds()).not.toContain(drop!.item.id);
  });

  it('awarding a glove does NOT grant mastery ownership', () => {
    const knifeIds = KARAMBIT_SKINS.filter((s) => s.dropEligible).map((s) => s.id);
    skinSystem.applyCloudProgression({ rewardOwnedSkinIds: knifeIds });
    skinSystem.grantDevPendingSignals(40, 'DIAMOND');
    for (let i = 0; i < 10; i++) skinSystem.openSignalDrop();

    // No mastery glove may become satisfiable through random drops.
    for (const glove of MASTERY_GLOVES) {
      if (glove.id === 'STANDARD_ISSUE') continue;
      expect(MasteryGloveSystem.getInstance().isSatisfied(glove.id), glove.id).toBe(false);
    }
    expect(MasteryGloveSystem.getInstance().getEquippedGloveId()).toBe('STANDARD_ISSUE');
  });

  it('mastery glove ids never appear in the random pool', () => {
    const knifeIds = KARAMBIT_SKINS.filter((s) => s.dropEligible).map((s) => s.id);
    skinSystem.applyCloudProgression({ rewardOwnedSkinIds: knifeIds });
    skinSystem.grantDevPendingSignals(80, 'DIAMOND');

    const masteryIds = new Set<string>(MASTERY_GLOVES.map((g) => g.id));
    for (let i = 0; i < 40; i++) {
      const drop = skinSystem.openSignalDrop();
      if (!drop || drop.isCollectionComplete) break;
      expect(masteryIds.has(drop.item.id), drop.item.id).toBe(false);
    }
  });

  it('rarity weighting still applies to glove awards', () => {
    const knifeIds = KARAMBIT_SKINS.filter((s) => s.dropEligible).map((s) => s.id);
    skinSystem.applyCloudProgression({ rewardOwnedSkinIds: knifeIds });
    skinSystem.grantDevPendingSignals(400, 'DIAMOND');

    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const drop = skinSystem.openSignalDrop();
      if (!drop || drop.isCollectionComplete) break;
      seen.add(drop.item.id);
    }
    // Enough distinct gloves appear that the rarity band is not degenerate.
    expect(seen.size).toBeGreaterThan(3);
  });
});

// ---------------------------------------------------------------------------
// 4. Duplicate protection across BOTH families
// ---------------------------------------------------------------------------

describe('Unified duplicate protection', () => {
  it('never repeats an id while unowned items remain in that category', () => {
    for (const track of SignalPackCatalog.getTracks()) {
      skinSystem.recordTrackCompletion(track.id, 'DIAMOND', track.id);
    }
    const seen = new Set<string>();
    let guard = 0;
    while (
      !(skinSystem.isCollectionComplete() && skinSystem.isGloveCollectionComplete()) &&
      guard++ < 500
    ) {
      const drop = skinSystem.openSignalDrop();
      if (!drop || drop.isCollectionComplete) break;
      expect(seen.has(drop.item.id), `duplicate ${drop.item.id}`).toBe(false);
      seen.add(drop.item.id);
    }
  });

  it('a full glove pool falls through to knives instead of blocking', () => {
    skinSystem.applyCloudProgression({ rewardOwnedSkinIds: DROP_GLOVES.map((g) => g.id) });
    expect(skinSystem.isGloveCollectionComplete()).toBe(true);
    skinSystem.grantDevPendingSignals(20, 'GOLD');

    for (let i = 0; i < 5; i++) {
      const drop = skinSystem.openSignalDrop();
      if (!drop || drop.isCollectionComplete) break;
      expect(drop.kind).toBe('KNIFE');
    }
  });

  it('a full knife pool falls through to gloves instead of blocking', () => {
    const knifeIds = KARAMBIT_SKINS.filter((s) => s.dropEligible).map((s) => s.id);
    skinSystem.applyCloudProgression({ rewardOwnedSkinIds: knifeIds });
    expect(skinSystem.isCollectionComplete()).toBe(true);
    skinSystem.grantDevPendingSignals(20, 'GOLD');

    for (let i = 0; i < 5; i++) {
      const drop = skinSystem.openSignalDrop();
      if (!drop || drop.isCollectionComplete) break;
      expect(drop.kind).toBe('GLOVE');
    }
  });

  it('reports collection complete only when BOTH pools are exhausted', () => {
    const knifeIds = KARAMBIT_SKINS.filter((s) => s.dropEligible).map((s) => s.id);
    skinSystem.applyCloudProgression({ rewardOwnedSkinIds: knifeIds });
    expect(skinSystem.isCollectionComplete()).toBe(true);
    expect(skinSystem.isGloveCollectionComplete()).toBe(false);

    skinSystem.grantDevPendingSignals(60, 'DIAMOND');
    const drop = skinSystem.openSignalDrop();
    expect(drop).not.toBeNull();
    expect(drop!.isCollectionComplete).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// 5. Ownership persistence + backwards compatibility
// ---------------------------------------------------------------------------

describe('Ownership persistence', () => {
  it('drop glove ownership survives a reload', () => {
    const knifeIds = KARAMBIT_SKINS.filter((s) => s.dropEligible).map((s) => s.id);
    skinSystem.applyCloudProgression({ rewardOwnedSkinIds: knifeIds });
    skinSystem.grantDevPendingSignals(5, 'GOLD');
    const drop = skinSystem.openSignalDrop()!;
    expect(drop.kind).toBe('GLOVE');

    (KarambitSkinSystem as unknown as { instance: unknown }).instance = null;
    const reloaded = KarambitSkinSystem.getInstance();
    expect(reloaded.isDropGloveOwned(drop.item.id)).toBe(true);
    expect(reloaded.getOwnedDropGloveIds()).toContain(drop.item.id);
  });

  it('existing knife ownership remains valid and unaffected', () => {
    skinSystem.grantDevPendingSignals(10, 'BRONZE');
    const first = skinSystem.openSignalDrop()!;
    const knifeId = first.kind === 'KNIFE' ? first.item.id : 'ASTRAL';
    skinSystem.applyCloudProgression({ rewardOwnedSkinIds: [knifeId] });

    (KarambitSkinSystem as unknown as { instance: unknown }).instance = null;
    const reloaded = KarambitSkinSystem.getInstance();
    expect(reloaded.isSkinRewardOwned(knifeId)).toBe(true);
    // And the glove ledger did not absorb it.
    expect(reloaded.getOwnedDropGloveIds()).not.toContain(knifeId);
  });

  it('legacy progression without glove fields still loads', () => {
    const legacy = {
      version: 2,
      awardedRankKeys: ['track_1_signal_drift:BRONZE'],
      pendingDropRanks: ['BRONZE'],
      rewardOwnedSkinIds: ['ASTRAL'],
      rewardBags: {},
      rewardBagCursors: {},
      rngState: 123456
    };
    localStorage.setItem(SIGNAL_DROP_STORAGE_KEY, JSON.stringify(legacy));
    (KarambitSkinSystem as unknown as { instance: unknown }).instance = null;
    const loaded = KarambitSkinSystem.getInstance();

    expect(loaded.getPendingDropCount()).toBe(1);
    expect(loaded.isSkinRewardOwned('ASTRAL')).toBe(true);
    expect(loaded.getOwnedDropGloveIds()).toEqual([]);
    expect(loaded.isGloveCollectionComplete()).toBe(false);
  });

  it('a forged glove id in storage is rejected by validation', () => {
    const forged = {
      version: 2,
      awardedRankKeys: [],
      pendingDropRanks: [],
      rewardOwnedSkinIds: [],
      rewardOwnedGloveIds: ['DROP_GLOVE_FAKE', 'ASTRAL', 'DROP_GLOVE_PEARL'],
      rewardBags: {},
      rewardBagCursors: {},
      rngState: 123456
    };
    localStorage.setItem(SIGNAL_DROP_STORAGE_KEY, JSON.stringify(forged));
    (KarambitSkinSystem as unknown as { instance: unknown }).instance = null;
    const loaded = KarambitSkinSystem.getInstance();

    expect(loaded.isDropGloveOwned('DROP_GLOVE_PEARL')).toBe(true);
    expect(loaded.isDropGloveOwned('DROP_GLOVE_FAKE')).toBe(false);
    // A knife id can never appear in the glove ledger.
    expect(loaded.getOwnedDropGloveIds()).not.toContain('ASTRAL');
  });

  it('cloud reconciliation splits the shared cosmetic ledger by namespace', () => {
    skinSystem.applyCloudProgression({ rewardOwnedSkinIds: ['ASTRAL', 'DROP_GLOVE_PEARL'] });
    expect(skinSystem.isSkinRewardOwned('ASTRAL')).toBe(true);
    expect(skinSystem.isDropGloveOwned('DROP_GLOVE_PEARL')).toBe(true);
    expect(skinSystem.getRewardOwnedSkinIds()).not.toContain('DROP_GLOVE_PEARL');

    // Idempotent: re-applying duplicates nothing.
    const before = skinSystem.getOwnedDropGloveIds().length;
    skinSystem.applyCloudProgression({ rewardOwnedSkinIds: ['ASTRAL', 'DROP_GLOVE_PEARL'] });
    expect(skinSystem.getOwnedDropGloveIds().length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 6. Equipped glove supports both namespaces
// ---------------------------------------------------------------------------

describe('Equipped glove namespace safety', () => {
  it('equips a drop glove only when it is owned', () => {
    const system = MasteryGloveSystem.getInstance();
    expect(system.equipAnyGlove('DROP_GLOVE_PEARL')).toBe(false);
    expect(system.getEquippedGloveId()).toBe('STANDARD_ISSUE');

    skinSystem.applyCloudProgression({ rewardOwnedSkinIds: ['DROP_GLOVE_PEARL'] });
    expect(system.equipAnyGlove('DROP_GLOVE_PEARL')).toBe(true);
    expect(system.getEquippedGloveId()).toBe('DROP_GLOVE_PEARL');
  });

  it('a mastery glove still requires its achievement', () => {
    const system = MasteryGloveSystem.getInstance();
    expect(system.equipAnyGlove('GOLDLINE')).toBe(false);
    expect(system.getEquippedGloveId()).toBe('STANDARD_ISSUE');
  });

  it('an invalid id falls back safely', () => {
    const system = MasteryGloveSystem.getInstance();
    expect(system.equipAnyGlove('TOTALLY_MADE_UP')).toBe(false);
    expect(system.equipAnyGlove('DROP_GLOVE_NOPE')).toBe(false);
    expect(system.getEquippedGloveId()).toBe('STANDARD_ISSUE');
  });

  it('a drop glove that is no longer owned falls back', () => {
    const system = MasteryGloveSystem.getInstance();
    skinSystem.applyCloudProgression({ rewardOwnedSkinIds: ['DROP_GLOVE_PEARL'] });
    system.equipAnyGlove('DROP_GLOVE_PEARL');
    expect(system.getEquippedGloveId()).toBe('DROP_GLOVE_PEARL');

    // Simulate a fresh device where the drop ledger is empty.
    localStorage.clear();
    (KarambitSkinSystem as unknown as { instance: unknown }).instance = null;
    skinSystem = KarambitSkinSystem.getInstance();
    expect(system.getEquippedGloveId()).toBe('STANDARD_ISSUE');
  });

  it('reports the correct source for each namespace', () => {
    expect(MasteryGloveSystem.gloveSource('GOLDLINE')).toBe('MASTERY');
    expect(MasteryGloveSystem.gloveSource('DROP_GLOVE_PEARL')).toBe('DROP');
    expect(MasteryGloveSystem.gloveSource('NOPE')).toBe('UNKNOWN');
  });
});

// ---------------------------------------------------------------------------
// 7. Profile honesty
// ---------------------------------------------------------------------------

describe('Profile glove description', () => {
  it('describes a mastery glove by its achievement', () => {
    const text = describeGloveSource('GOLDLINE', 'GOLD+ ON ALL OFFICIAL SIGNALS');
    expect(text).toBe('GOLD+ ON ALL OFFICIAL SIGNALS');
  });

  it('NEVER describes a Signal Drop glove as an achievement', () => {
    const text = describeGloveSource('DROP_GLOVE_PEARL', 'GOLD+ ON ALL OFFICIAL SIGNALS');
    expect(text).toBe('SIGNAL DROP // RARE');
    expect(text).not.toMatch(/GOLD|ACHIEVE|MASTERY|DIAMOND/);
  });

  it('the profile service labels the source explicitly', () => {
    const src = read('src/online/PlayerProfileService.ts');
    expect(src).toMatch(/gloveSource/);
    expect(src).toMatch(/describeGloveSource/);
  });
});

// ---------------------------------------------------------------------------
// 8. Decoder + Armory presentation
// ---------------------------------------------------------------------------

describe('Decoder and Armory presentation', () => {
  it('the decoder states the slot type explicitly', () => {
    const modal = read('src/ui/SignalDecodeModal.ts');
    expect(modal).toMatch(/cosmeticKindLabel\(reward\.kind\)/);
    // And never assumes a knife.
    expect(modal).not.toMatch(/reward\.skin\.(name|codename|rarity)/);
  });

  it('the Armory separates the two glove families with labelled headings', () => {
    const screen = read('src/ui/ImportScreen.ts');
    expect(screen).toMatch(/SIGNAL DROPS \/\/ RANDOM REWARDS/);
    expect(screen).toMatch(/MASTERY \/\/ EARNED ACHIEVEMENTS/);
    expect(screen).toMatch(/SOURCE \/\/ SIGNAL DROP/);
    expect(screen).toMatch(/SOURCE \/\/ MASTERY/);
    expect(screen).toMatch(/drop-gloves-grid/);
    expect(screen).toMatch(/mastery-gloves-grid/);
  });

  it('does not add a seventh navigation tab', () => {
    const screen = read('src/ui/ImportScreen.ts');
    const tabs = screen.match(/id="tab-btn-[a-z]+"/g) ?? [];
    expect(tabs.length).toBeLessThanOrEqual(6);
  });

  it('the reveal panel reports the kind for every reward source', () => {
    for (const file of ['src/ui/ArmoryModal.ts', 'src/ui/ImportScreen.ts', 'src/ui/ResultsScreen.ts']) {
      const src = read(file);
      expect(src, file).toMatch(/cosmeticKindLabel/);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Reward sources are unchanged
// ---------------------------------------------------------------------------

describe('Reward sources', () => {
  it('official rank thresholds and custom audio still drive drops', () => {
    const src = read('src/viewmodel/KarambitSkinSystem.ts');
    // Official thresholds award exactly one drop per newly reached rank.
    expect(src).toMatch(/RANK_THRESHOLDS/);
    expect(src).toMatch(/pendingDropRanks\.push\(threshold\)/);
    // Custom audio still cannot award a rank key.
    expect(src).toMatch(/isOfficial/);
    // And no new farming path was added.
    expect(src).not.toMatch(/dailyReward|loginReward|farmCount|xpGain/i);
  });

  it('the drop count per rank is unchanged', () => {
    const track = SignalPackCatalog.getTracks()[0];
    skinSystem.recordTrackCompletion(track.id, 'DIAMOND', track.id);
    expect(skinSystem.getPendingDropCount()).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 10. Visual pipeline: skin separation, no new geometry, lazy loading
// ---------------------------------------------------------------------------

describe('Glove visual pipeline', () => {
  it('resolves a texture path for every drop glove', () => {
    for (const glove of DROP_GLOVES) {
      expect(resolveAnyGloveTexturePath(glove.id)).toBe(glove.texturePath);
      expect(hasAnyOwnGloveTexture(glove.id)).toBe(true);
    }
  });

  it('every drop glove has a material treatment', () => {
    for (const glove of DROP_GLOVES) {
      expect(DROP_GLOVE_TREATMENTS[glove.id], glove.id).toBeTruthy();
      expect(resolveGloveTreatment(glove.id)).toEqual(DROP_GLOVE_TREATMENTS[glove.id]);
    }
    // Mastery and unknown ids still resolve.
    expect(resolveGloveTreatment('GOLDLINE').metalness).toBeGreaterThan(0.5);
    expect(resolveGloveTreatment('NOPE').metalness).toBeLessThan(0.25);
  });

  it('exposed skin is never made metallic or repainted', () => {
    // The composition keeps the canonical atlas as the material map and blends
    // the cosmetic only where the shared mask says "glove".
    const src = read('src/viewmodel/GloveTextures.ts');
    expect(src).toMatch(/uGloveColorOn/);
    expect(src).toMatch(/mix\(diffuseColor\.rgb, gloveCosmetic\.rgb, gloveMaskFactor\)/);
    expect(src).toMatch(/mix\(metalnessFactor, uGloveMetal, gloveMaskFactor\)/);
    expect(src).toMatch(/mix\(roughnessFactor, uGloveRough, gloveMaskFactor\)/);
    // And the correct UV varying for three r174.
    expect(src).toMatch(/vMapUv/);
  });

  it('the mask patch is inert without a mask', () => {
    // With no mask every scoped mix is a no-op, so the shipped look is unchanged.
    const src = read('src/viewmodel/GloveTextures.ts');
    expect(src).toMatch(/uGloveMaskOn\.value = mask \? 1 : 0/);
    const mat = new THREE.MeshStandardMaterial();
    const uniforms = installGloveMaskPatch(mat);
    expect(uniforms.uGloveMaskOn.value).toBe(0);
    expect(uniforms.uGloveMask.value).toBeNull();
    expect(uniforms.uGloveColorOn.value).toBe(0);
  });

  it('switching gloves adds no geometry, material or draw call', () => {
    const rig = ViewmodelAssetLoader.buildFallbackRig(new THREE.Color(0x00f0ff));
    let meshesBefore = 0;
    rig.rootGroup.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshesBefore++;
    });
    const materialsBefore = [...rig.armMaterials];

    for (const glove of DROP_GLOVES) rig.applyGlove(glove.id, 1);

    let meshesAfter = 0;
    rig.rootGroup.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshesAfter++;
    });
    expect(meshesAfter).toBe(meshesBefore);
    expect(rig.armMaterials).toEqual(materialsBefore);
    expect(rig.getActiveGloveId()).toBe(DROP_GLOVES[DROP_GLOVES.length - 1].id);
    rig.dispose();
  });

  it('the knife socket is untouched by any glove switch', () => {
    const rig = ViewmodelAssetLoader.buildFallbackRig(new THREE.Color(0x00f0ff));
    rig.knifeGroup.position.set(0.0093, 0.1107, 0.0033);
    const before = rig.knifeGroup.position.clone();
    for (const glove of DROP_GLOVES) rig.applyGlove(glove.id, 1);
    expect(rig.knifeGroup.position.x).toBe(before.x);
    expect(rig.knifeGroup.position.y).toBe(before.y);
    expect(rig.knifeGroup.position.z).toBe(before.z);
    rig.dispose();
  });

  it('lazy loading and caching still work for drop gloves', async () => {
    const pending: Array<{ resolve: () => void }> = [];
    const loader = {
      load(_url: string, onLoad: (t: THREE.Texture) => void) {
        pending.push({ resolve: () => onLoad(configureGloveTexture(new THREE.Texture())) });
      }
    };
    const cache = new GloveTextureCache(configureGloveTexture, loader);
    const switcher = new GloveTextureSwitcher(cache);
    const base = new THREE.Texture();

    expect(pending).toHaveLength(0); // nothing preloaded
    const first = switcher.apply('DROP_GLOVE_PEARL', base, () => undefined);
    expect(pending).toHaveLength(1);
    pending[0].resolve();
    await first;
    expect(cache.loadCount).toBe(1);

    await switcher.apply('DROP_GLOVE_PEARL', base, () => undefined);
    expect(cache.loadCount).toBe(1); // cache hit, no second fetch
  });

  it('the armory does not preload every glove texture', () => {
    const src = read('src/ui/ImportScreen.ts');
    // The armory renders text cards only.
    expect(src).not.toMatch(/TextureLoader|GLTFLoader|applyGlove/);
  });

  it('no glove video assets exist anywhere in the shipped glove folder', () => {
    const dir = path.join(PUBLIC, 'assets/viewmodel/gloves');
    const walk = (d: string): string[] => {
      const out: string[] = [];
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else out.push(full);
      }
      return out;
    };
    for (const file of walk(dir)) {
      expect(file, file).not.toMatch(/\.(mp4|webm|mov|gif)$/i);
    }
  });
});

// ---------------------------------------------------------------------------
// 11. DEV grants cannot mint production mastery
// ---------------------------------------------------------------------------

describe('DEV grants', () => {
  it('DEV drops never affect mastery eligibility', () => {
    const system = MasteryGloveSystem.getInstance();
    const before = system.evaluate().unlockedIds;

    skinSystem.grantDevPendingSignals(999, 'DIAMOND');
    for (let i = 0; i < 60; i++) skinSystem.openSignalDrop();

    expect(system.evaluate().unlockedIds).toEqual(before);
    expect(system.getEquippedGloveId()).toBe('STANDARD_ISSUE');
  });

  it('DEV preview of a drop glove writes no ownership', () => {
    const system = MasteryGloveSystem.getInstance();
    system.setDevPreview('DROP_GLOVE_AUREATE_FULL');
    expect(system.getEffectiveGloveId()).toBe('DROP_GLOVE_AUREATE_FULL');
    expect(skinSystem.isDropGloveOwned('DROP_GLOVE_AUREATE_FULL')).toBe(false);
    system.setDevPreview(null);
  });

  it('the drop catalog cannot reach mastery state', () => {
    const src = read('src/viewmodel/DropGloveCatalog.ts');
    expect(src).not.toMatch(/MasteryGloveSystem|MASTERY_GLOVES|trackRecords|localStorage/);
  });
});
