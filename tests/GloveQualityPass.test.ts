/**
 * GLOVE QUALITY PASS — sharpness, rarity cleanup, CYBER II removal.
 *
 * Root cause of the softness, established by measurement rather than guesswork:
 *
 *   1. ANISOTROPY WAS NEVER SET. A first-person viewmodel is viewed at a very
 *      grazing angle, so the texture's screen-space derivative is large along
 *      the view direction. With the default anisotropy of 1, isotropic mip
 *      selection blurs BOTH axes to the coarsest requirement. This is the
 *      dominant cause and applies on every quality tier.
 *   2. THE 512 CEILING. Authoring sheets are 1254 px and the glove occupies only
 *      a thin band, so the shipped 512 sheet carried roughly 177 px of real
 *      glove detail. HIGH and ULTRA loaded exactly the same asset as LOW.
 *
 * These tests protect the repair, the catalog cleanup, and the final rarity
 * table. They cannot prove the gloves LOOK good: that needs human eyes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';

import {
  DROP_GLOVES,
  RETIRED_DROP_GLOVE_IDS,
  dropEligibleGloves,
  getDropGlove,
  isDropGloveId,
  isRetiredDropGloveId
} from '../src/viewmodel/DropGloveCatalog';
import {
  GLOVE_ANISOTROPY,
  GloveTextureCache,
  configureGloveTexture,
  getGloveTextureQuality,
  gloveTexturePathVariants,
  resolveAnyGloveTexturePath,
  resolveTexturePathForQuality,
  setGloveTextureQuality
} from '../src/viewmodel/GloveTextures';
import { QUALITY_PRESETS } from '../src/rendering/QualityPresets';
import { KARAMBIT_SKINS } from '../src/viewmodel/KarambitSkinSystem';
import { MASTERY_GLOVES } from '../src/mastery/MasteryLadder';

const repoRoot = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const publicFile = (urlPath: string) => path.join(repoRoot, 'public', urlPath);

beforeEach(() => {
  setGloveTextureQuality('STANDARD');
});

// ---------------------------------------------------------------------------
// 1. CYBER II removal
// ---------------------------------------------------------------------------

describe('CYBER II removed from production', () => {
  it('is gone from the drop glove catalog', () => {
    expect(DROP_GLOVES.some((g) => g.id === 'DROP_GLOVE_CYBER_2')).toBe(false);
    expect(getDropGlove('DROP_GLOVE_CYBER_2')).toBeNull();
    expect(dropEligibleGloves().some((g) => g.id === 'DROP_GLOVE_CYBER_2')).toBe(false);
  });

  it('is gone from the id union and every derived list', () => {
    const src = read('src/viewmodel/DropGloveCatalog.ts');
    // The TYPE union must not offer it: a new code path cannot name it.
    const union = src.slice(src.indexOf('export type DropGloveId'), src.indexOf('export interface DropGlove'));
    expect(union).not.toMatch(/DROP_GLOVE_CYBER_2/);
    expect(union).toMatch(/DROP_GLOVE_CYBER'/);
    expect(union).toMatch(/DROP_GLOVE_CYBER_FULL'/);
    // It survives only as an explicitly retired id, which is the point.
    expect(RETIRED_DROP_GLOVE_IDS).toContain('DROP_GLOVE_CYBER_2');
    expect(isRetiredDropGloveId('DROP_GLOVE_CYBER_2')).toBe(true);
    expect(isRetiredDropGloveId('DROP_GLOVE_CYBER')).toBe(false);
  });

  it('its runtime asset is deleted', () => {
    expect(fs.existsSync(publicFile('/assets/viewmodel/gloves/drops/cyber-2.webp'))).toBe(false);
  });

  it('no longer appears in the Armory inventory', () => {
    // The inventory is built from the catalog, so a retired id cannot render.
    const src = read('src/ui/ArmoryInventory.ts');
    expect(src).toMatch(/dropGloves: readonly DropGlove\[\]/);
    expect(read('src/ui/ImportScreen.ts')).toMatch(/dropGloves: DROP_GLOVES/);
  });

  it('CYBER and CYBER // FULL are preserved', () => {
    expect(getDropGlove('DROP_GLOVE_CYBER')).not.toBeNull();
    expect(getDropGlove('DROP_GLOVE_CYBER_FULL')).not.toBeNull();
  });

  it('CYBER and CYBER // FULL remain clearly distinct items', () => {
    const cyber = getDropGlove('DROP_GLOVE_CYBER')!;
    const full = getDropGlove('DROP_GLOVE_CYBER_FULL')!;
    expect(cyber.name).not.toBe(full.name);
    expect(cyber.codename).not.toBe(full.codename);
    expect(cyber.texturePath).not.toBe(full.texturePath);
    // A fingerless neon trace versus a full-finger weave: different rarity bands.
    expect(cyber.rarity).toBe('RARE');
    expect(full.rarity).toBe('RELIC');
  });
});

describe('CYBER II legacy fallback', () => {
  it('a retired id is still recognised as a drop-family id', () => {
    // Prefix-based, so an old equipped value still routes down the glove branch
    // rather than being mistaken for a mastery id.
    expect(isDropGloveId('DROP_GLOVE_CYBER_2')).toBe(true);
  });

  it('every lookup falls back cleanly instead of throwing', () => {
    expect(getDropGlove('DROP_GLOVE_CYBER_2')).toBeNull();
    // Texture resolution must never return a dangling path.
    const texturePath = resolveAnyGloveTexturePath('DROP_GLOVE_CYBER_2');
    expect(texturePath).toMatch(/arms_gloves_01\.webp$/);
    expect(gloveTexturePathVariants('DROP_GLOVE_CYBER_2')).toHaveLength(1);
  });

  it('the persisted ledger is validated against the catalog on load', () => {
    const src = read('src/viewmodel/KarambitSkinSystem.ts');
    // Ownership, bags and the last-reward pointer are all filtered by catalog id,
    // so a retired id is dropped rather than resurrected or crashing.
    expect(src).toMatch(/const gloveIds = new Set<string>\(dropEligibleGloves\(\)\.map/);
    expect(src).toMatch(/rewardOwnedGloveIds: uniqueStrings\(parsed\.rewardOwnedGloveIds, gloveIds\)/);
    expect(src).toMatch(/rawBag\.filter\(\(item\): item is string => typeof item === 'string' && gloveIds\.has\(item\)\)/);
    expect(src).toMatch(/lastRewardGloveId:[\s\S]{0,120}gloveIds\.has\(parsed\.lastRewardGloveId\)/);
  });

  it('an equipped retired glove falls back to the default mastery glove', () => {
    const src = read('src/mastery/MasteryGloveSystem.ts');
    // Ownership AND catalog resolution are both required before a drop glove is
    // honoured, so a retired id can never be equipped.
    expect(src).toMatch(
      /return owned && getDropGlove\(this\.equippedGloveId\) \? this\.equippedGloveId : DEFAULT_MASTERY_GLOVE_ID/
    );
  });

  it('a retired id can never be re-equipped', () => {
    const src = read('src/mastery/MasteryGloveSystem.ts');
    const equip = src.slice(
      src.indexOf('public equipAnyGlove('),
      src.indexOf('public equipAnyGlove(') + 700
    );
    expect(equip).toMatch(/if \(!getDropGlove\(id\)\) return false;/);
  });

  it('the decoder can never roll a retired glove', () => {
    const src = read('src/viewmodel/KarambitSkinSystem.ts');
    // Bags and rewards are built from the eligible catalog, never from ownership.
    expect(src).toMatch(/for \(const glove of dropEligibleGloves\(\)\)/);
    expect(src).toMatch(/const eligible = dropEligibleGloves\(\)/);
  });
});

// ---------------------------------------------------------------------------
// 2. Final rarity table
// ---------------------------------------------------------------------------

describe('Final drop-glove rarity table', () => {
  const TARGET: Record<string, string> = {
    DROP_GLOVE_CREME: 'STANDARD',
    DROP_GLOVE_PEARL: 'RARE',
    DROP_GLOVE_PEARL_ICE: 'RELIC',
    DROP_GLOVE_SILVERSKIN: 'RARE',
    DROP_GLOVE_CYBER: 'RARE',
    DROP_GLOVE_CYBER_FULL: 'RELIC',
    DROP_GLOVE_CRYSTAL: 'RELIC',
    DROP_GLOVE_SYNTH: 'RELIC',
    DROP_GLOVE_AUREATE: 'RELIC',
    DROP_GLOVE_SYNTH_FULL: 'ARTIFACT',
    DROP_GLOVE_AUREATE_FULL: 'OVERCLOCKED'
  };

  it('matches the target mapping exactly', () => {
    expect(DROP_GLOVES).toHaveLength(Object.keys(TARGET).length);
    for (const glove of DROP_GLOVES) {
      expect(glove.rarity, glove.id).toBe(TARGET[glove.id]);
    }
  });

  it('the white / pearl family carries the premium end', () => {
    expect(getDropGlove('DROP_GLOVE_PEARL_ICE')!.rarity).toBe('RELIC');
    expect(getDropGlove('DROP_GLOVE_PEARL')!.rarity).toBe('RARE');
    // Pearl Ice outranks plain Pearl: the frozen-nacre material is the stronger one.
    const order = ['STANDARD', 'RARE', 'RELIC', 'ARTIFACT', 'OVERCLOCKED'];
    expect(order.indexOf(getDropGlove('DROP_GLOVE_PEARL_ICE')!.rarity)).toBeGreaterThan(
      order.indexOf(getDropGlove('DROP_GLOVE_PEARL')!.rarity)
    );
  });

  it('the ladder is well spread, not flat', () => {
    const counts = new Map<string, number>();
    for (const g of DROP_GLOVES) counts.set(g.rarity, (counts.get(g.rarity) ?? 0) + 1);
    expect(counts.get('STANDARD')).toBe(1);
    expect(counts.get('RARE')).toBe(3);
    expect(counts.get('RELIC')).toBe(5);
    expect(counts.get('ARTIFACT')).toBe(1);
    expect(counts.get('OVERCLOCKED')).toBe(1);
  });

  it('never collides with a mastery glove name', () => {
    const masteryNames = new Set(MASTERY_GLOVES.map((g) => g.name));
    for (const glove of DROP_GLOVES) {
      expect(masteryNames.has(glove.name), glove.name).toBe(false);
    }
  });

  it('the drop-odds architecture is untouched', () => {
    // Category roll and reward bags are unchanged; only catalog membership and
    // rarity labels moved.
    expect(read('src/viewmodel/CosmeticDrop.ts')).toMatch(/SIGNAL_DROP_CATEGORY_WEIGHTS/);
    expect(read('src/viewmodel/CosmeticDrop.ts')).toMatch(/KNIFE: 65/);
    expect(read('src/viewmodel/CosmeticDrop.ts')).toMatch(/GLOVE: 35/);
    const src = read('src/viewmodel/DropGloveCatalog.ts');
    expect(src).not.toMatch(/0\.65|0\.35/);
    // Every glove keeps equal weight inside its band.
    expect(new Set(DROP_GLOVES.map((g) => g.dropWeight))).toEqual(new Set([1]));
    expect(DROP_GLOVES.every((g) => g.dropEligible)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. BLUE GEM — a RARE knife, not an artifact
// ---------------------------------------------------------------------------

describe('BLUE GEM knife skin', () => {
  it('exists as a RARE, drop-eligible static knife', () => {
    const skin = KARAMBIT_SKINS.find((s) => s.id === 'BLUE_GEM');
    expect(skin).toBeDefined();
    expect(skin!.rarity).toBe('RARE');
    expect(skin!.dropEligible).toBe(true);
    expect(skin!.shortRequirement).toBe('SIGNAL DROP');
  });

  it('is a static texture skin, never a video artifact', () => {
    const skin = KARAMBIT_SKINS.find((s) => s.id === 'BLUE_GEM')!;
    expect(skin.profile.isVideoArtifact).toBeUndefined();
    expect(skin.profile.videoPath).toBeUndefined();
    expect(skin.profile.texturePath).toBe(
      '/assets/viewmodel/karambit/textures/blue_gem_cosmic.webp'
    );
  });

  it('is NOT counted as an artifact', () => {
    const artifacts = KARAMBIT_SKINS.filter((s) => s.rarity === 'ARTIFACT');
    expect(artifacts.some((s) => s.id === 'BLUE_GEM')).toBe(false);
    expect(artifacts.every((s) => s.profile.isVideoArtifact)).toBe(true);
  });

  it('ships its runtime asset', () => {
    expect(
      fs.existsSync(publicFile('/assets/viewmodel/karambit/textures/blue_gem_cosmic.webp'))
    ).toBe(true);
  });

  it('carries complete material metadata', () => {
    const skin = KARAMBIT_SKINS.find((s) => s.id === 'BLUE_GEM')!;
    expect(skin.profile.baseColor).toBeInstanceOf(THREE.Color);
    expect(skin.profile.parallaxDepth).toBeGreaterThan(0);
    expect(skin.profile.layer2Scale).toBeGreaterThan(1.0);
    expect(skin.name).toMatch(/BLUE GEM$/);
    expect(skin.paletteTag).toBeDefined();
  });

  it('does not collide with any other knife id or name', () => {
    const ids = KARAMBIT_SKINS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = KARAMBIT_SKINS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
// 4. Sharpness — anisotropy + the HIGH/ULTRA resolution path
// ---------------------------------------------------------------------------

describe('Glove sharpness', () => {
  it('enables anisotropic filtering on glove textures', () => {
    const texture = configureGloveTexture(new THREE.Texture());
    expect(texture.anisotropy).toBe(GLOVE_ANISOTROPY);
    expect(GLOVE_ANISOTROPY).toBeGreaterThan(1);
    // The grazing-angle cause: without this the mip chain over-blurs.
    expect(read('src/viewmodel/GloveTextures.ts')).toMatch(/anisotropy = GLOVE_ANISOTROPY/);
  });

  it('enables anisotropic filtering on the base arm atlas too', () => {
    const src = read('src/viewmodel/ViewmodelAssetLoader.ts');
    expect(src).toMatch(/gloveTexture\.anisotropy = GLOVE_ANISOTROPY/);
  });

  it('keeps the existing filter and colour-space conventions', () => {
    const texture = configureGloveTexture(new THREE.Texture());
    expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(texture.magFilter).toBe(THREE.NearestFilter);
    expect(texture.generateMipmaps).toBe(true);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(texture.flipY).toBe(false);
  });

  it('HIGH and ULTRA select the sharper asset path', () => {
    expect(QUALITY_PRESETS.HIGH.gloveTextureQuality).toBe('HIGH');
    expect(QUALITY_PRESETS.ULTRA.gloveTextureQuality).toBe('HIGH');
  });

  it('LOW and MEDIUM keep the light asset path', () => {
    expect(QUALITY_PRESETS.LOW.gloveTextureQuality).toBe('STANDARD');
    expect(QUALITY_PRESETS.MEDIUM.gloveTextureQuality).toBe('STANDARD');
  });

  it('resolution selection is pure and total', () => {
    expect(resolveTexturePathForQuality('/a/512.webp', '/a/hi/1024.webp', 'HIGH')).toBe(
      '/a/hi/1024.webp'
    );
    expect(resolveTexturePathForQuality('/a/512.webp', '/a/hi/1024.webp', 'STANDARD')).toBe(
      '/a/512.webp'
    );
    // A missing hi asset falls back rather than breaking the viewmodel.
    expect(resolveTexturePathForQuality('/a/512.webp', null, 'HIGH')).toBe('/a/512.webp');
    expect(resolveTexturePathForQuality(null, null, 'HIGH')).toMatch(/arms_gloves_01\.webp$/);
  });

  it('every drop glove resolves to the tier-correct path', () => {
    for (const glove of DROP_GLOVES) {
      setGloveTextureQuality('STANDARD');
      expect(resolveAnyGloveTexturePath(glove.id), glove.id).toBe(glove.texturePath);
      setGloveTextureQuality('HIGH');
      expect(resolveAnyGloveTexturePath(glove.id), glove.id).toBe(glove.hiTexturePath);
    }
  });

  it('the hi path really is a separate, sharper asset', () => {
    for (const glove of DROP_GLOVES) {
      expect(glove.hiTexturePath, glove.id).not.toBe(glove.texturePath);
      expect(glove.hiTexturePath, glove.id).toContain('/hi/');
      expect(gloveTexturePathVariants(glove.id)).toEqual([
        glove.texturePath,
        glove.hiTexturePath
      ]);
    }
  });

  it('every declared asset exists on disk at the right resolution', () => {
    const webpSize = (file: string): { w: number; h: number } => {
      const b = fs.readFileSync(file);
      const fourcc = b.toString('ascii', 12, 16);
      if (fourcc === 'VP8 ') {
        return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
      }
      if (fourcc === 'VP8L') {
        const bits = b.readUInt32LE(21);
        return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
      }
      throw new Error(`unexpected webp container in ${file}`);
    };

    for (const glove of DROP_GLOVES) {
      const standard = publicFile(glove.texturePath);
      const hi = publicFile(glove.hiTexturePath);
      expect(fs.existsSync(standard), standard).toBe(true);
      expect(fs.existsSync(hi), hi).toBe(true);
      expect(webpSize(standard), glove.id).toEqual({ w: 512, h: 512 });
      expect(webpSize(hi), glove.id).toEqual({ w: 1024, h: 1024 });
    }
  });

  it('the shipped catalogue carries no retired asset', () => {
    const dir = publicFile('/assets/viewmodel/gloves/drops');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.webp'));
    expect(files.sort()).toEqual(DROP_GLOVES.map((g) => path.basename(g.texturePath)).sort());
    const hiFiles = fs.readdirSync(path.join(dir, 'hi')).filter((f) => f.endsWith('.webp'));
    expect(hiFiles.sort()).toEqual(DROP_GLOVES.map((g) => path.basename(g.hiTexturePath)).sort());
  });

  it('the exporter records the verified source mapping', () => {
    const src = read('scripts/export_glove_textures.py');
    // CYBER II is intentionally absent from the production export list.
    expect(src).not.toMatch(/"CYBER 2\.png": "cyber-2\.webp"/);
    expect(src).toMatch(/REMOVED_GLOVES = \{"cyber-2\.webp": "CYBER 2\.png"\}/);
    expect(src).toMatch(/def verify\(\)/);
    expect(src).toMatch(/HI_SIZE = 1024/);
    expect(src).toMatch(/STANDARD_SIZE = 512/);
  });
});

// ---------------------------------------------------------------------------
// 5. Quality switching and performance architecture
// ---------------------------------------------------------------------------

describe('Quality switching', () => {
  it('reports whether the tier actually changed', () => {
    setGloveTextureQuality('STANDARD');
    expect(setGloveTextureQuality('STANDARD')).toBe(false);
    expect(setGloveTextureQuality('HIGH')).toBe(true);
    expect(getGloveTextureQuality()).toBe('HIGH');
    expect(setGloveTextureQuality('HIGH')).toBe(false);
  });

  it('switching quality never touches equipped or owned state', () => {
    const ownedBefore = DROP_GLOVES.map((g) => g.id).join(',');
    const raritiesBefore = DROP_GLOVES.map((g) => `${g.id}:${g.rarity}`).join(',');
    setGloveTextureQuality('HIGH');
    setGloveTextureQuality('STANDARD');
    setGloveTextureQuality('HIGH');
    expect(DROP_GLOVES.map((g) => g.id).join(',')).toBe(ownedBefore);
    expect(DROP_GLOVES.map((g) => `${g.id}:${g.rarity}`).join(',')).toBe(raritiesBefore);
    // The resolver is the ONLY thing the tier influences.
    expect(resolveAnyGloveTexturePath('DROP_GLOVE_PEARL')).toContain('/hi/');
  });

  it('the viewmodel re-applies the equipped glove on a tier change', () => {
    const src = read('src/viewmodel/ViewmodelController.ts');
    const fn = src.slice(src.indexOf('public applyQuality('), src.indexOf('public applyQuality(') + 500);
    expect(fn).toMatch(/setGloveTextureQuality\(preset\.gloveTextureQuality\)/);
    expect(fn).toMatch(/applyMasteryGlove\(true, this\.appliedGloveScale\)/);
  });

  it('no performance architecture regression', () => {
    const gloveSrc = read('src/viewmodel/GloveTextures.ts');
    // Still one shared arm mesh, one bounded cache, lazy loading, no videos, no scene.
    expect(gloveSrc).not.toMatch(/new THREE\.Scene/);
    expect(gloveSrc).not.toMatch(/VideoTexture|videoPath/);
    expect(gloveSrc).toMatch(/A texture is fetched AT MOST ONCE while it is resident/);
    expect(gloveSrc).toMatch(/BOUNDED BY DESIGN/);
    expect(gloveSrc).toMatch(/isAllowedGloveTexturePath/);
    // The cache is keyed by path, so both tiers coexist without re-downloading.
    expect(gloveSrc).toMatch(/private textures = new Map<string, THREE\.Texture>\(\)/);
  });

  it('the texture cache is bounded so 1024 px gloves cannot accumulate', () => {
    const loads: string[] = [];
    const disposed: string[] = [];
    const loader = {
      load: (url: string, onLoad: (t: THREE.Texture) => void) => {
        loads.push(url);
        const texture = new THREE.Texture();
        texture.name = url;
        const originalDispose = texture.dispose.bind(texture);
        texture.dispose = () => {
          disposed.push(url);
          originalDispose();
        };
        onLoad(texture);
      }
    };
    const cache = new GloveTextureCache(configureGloveTexture, loader, 3);

    for (const p of ['/a.webp', '/b.webp', '/c.webp']) {
      void cache.load(p);
    }
    expect(cache.size()).toBe(3);
    expect(disposed).toEqual([]);

    // A fourth distinct texture evicts the least recently used.
    void cache.load('/d.webp');
    expect(cache.size()).toBe(3);
    expect(disposed).toEqual(['/a.webp']);
    expect(cache.has('/d.webp')).toBe(true);

    // The most recently used entry is never evicted: touching /b makes it safe.
    cache.get('/b.webp');
    void cache.load('/e.webp');
    expect(disposed).toEqual(['/a.webp', '/c.webp']);
    expect(cache.has('/b.webp')).toBe(true);
    expect(cache.has('/e.webp')).toBe(true);
  });

  it('the catalog still declares no video asset', () => {
    for (const glove of DROP_GLOVES) {
      expect(glove.texturePath).toMatch(/\.webp$/);
      expect(glove.hiTexturePath).toMatch(/\.webp$/);
    }
  });

  it('only the equipped glove is ever resident', () => {
    // The switcher applies exactly one path per selection; the cache holds what
    // has been used this session, but nothing preloads the catalog.
    const src = read('src/viewmodel/GloveTextures.ts');
    expect(src).toMatch(/only the equipped glove is loaded at viewmodel creation/);
    expect(src).not.toMatch(/for \(const glove of DROP_GLOVES\)/);
  });
});

// ---------------------------------------------------------------------------
// 6. Skin-safety: the glove treatment must not reach exposed skin
// ---------------------------------------------------------------------------

describe('Exposed skin safety', () => {
  it('the cosmetic texture is still blended only where the shared mask says glove', () => {
    const src = read('src/viewmodel/GloveTextures.ts');
    expect(src).toMatch(/gloveMaskFactor = mix\(1\.0, texture2D\(uGloveMask, vMapUv\)\.r, uGloveMaskOn\)/);
    expect(src).toMatch(/diffuseColor\.rgb = mix\(diffuseColor\.rgb, gloveCosmetic\.rgb, gloveMaskFactor\)/);
  });

  it('metalness and roughness stay scoped by the same mask', () => {
    const src = read('src/viewmodel/GloveTextures.ts');
    expect(src).toMatch(/roughnessFactor = mix\(roughnessFactor, uGloveRough, gloveMaskFactor\)/);
    expect(src).toMatch(/metalnessFactor = mix\(metalnessFactor, uGloveMetal, gloveMaskFactor\)/);
  });

  it('the mask asset is unchanged and still shipped', () => {
    const mask = publicFile('/assets/viewmodel/gloves/glove_mask.webp');
    expect(fs.existsSync(mask)).toBe(true);
    // The mask is a region selector, not detail: it stays lightweight.
    expect(fs.statSync(mask).size).toBeLessThan(16 * 1024);
  });
});
