/**
 * MASTERY GLOVE TEXTURE PIPELINE V1.
 *
 * ONE shared arm mesh + ONE optional base-color texture per mastery glove + the
 * existing GloveTreatments material parameters.
 *
 * The authored arms atlas is ~74% EXPOSED SKIN (measured), with the glove in a
 * dark, desaturated band across the middle of the sheet. So this pipeline must
 * never repaint skin, and it supports ONE optional shared glove mask to scope
 * metalness/roughness to glove pixels only.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';

import {
  BASE_GLOVE_TEXTURE_PATH,
  GLOVE_MASK_TEXTURE_PATH,
  GLOVE_TEXTURES,
  GloveTextureCache,
  GloveTextureSwitcher,
  configureGloveTexture,
  configureMaskTexture,
  disposeGloveTextureCaches,
  gloveMaskCache,
  gloveTextureCache,
  hasOwnGloveTexture,
  installGloveMaskPatch,
  isAllowedGloveTexturePath,
  resolveGloveTexturePath,
  setGloveMask
} from '../src/viewmodel/GloveTextures';
import { GLOVE_TREATMENTS, applyGloveTreatment, maxGloveEmissiveIntensity } from '../src/viewmodel/GloveTreatments';
import { ViewmodelAssetLoader } from '../src/viewmodel/ViewmodelAssetLoader';
import { MASTERY_GLOVES, MasteryGloveId } from '../src/mastery/MasteryLadder';
import { MasteryGloveSystem } from '../src/mastery/MasteryGloveSystem';

const repoRoot = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const ALL_GLOVES = MASTERY_GLOVES.map((g) => g.id);

/** A loader whose resolution the test controls. */
function deferredLoader() {
  const pending: Array<{ url: string; resolve: () => void; fail: () => void }> = [];
  const loader = {
    load(
      url: string,
      onLoad: (t: THREE.Texture) => void,
      _onProgress: undefined,
      onError: () => void
    ) {
      pending.push({
        url,
        resolve: () => onLoad(configureGloveTexture(new THREE.Texture())),
        fail: () => onError()
      });
    }
  };
  return { loader, pending };
}

// ---------------------------------------------------------------------------
// 1. Path resolution and fallback
// ---------------------------------------------------------------------------

describe('Glove texture paths', () => {
  it('resolves an expected runtime path per glove', () => {
    expect(resolveGloveTexturePath('FIRST_CONTACT')).toBe('/assets/viewmodel/gloves/first_contact.webp');
    expect(resolveGloveTexturePath('SIGNAL_RUNNER')).toBe('/assets/viewmodel/gloves/signal_runner.webp');
    expect(resolveGloveTexturePath('VELOCITY')).toBe('/assets/viewmodel/gloves/velocity.webp');
    expect(resolveGloveTexturePath('GOLDLINE')).toBe('/assets/viewmodel/gloves/goldline.webp');
    expect(resolveGloveTexturePath('DIAMOND_HAND')).toBe('/assets/viewmodel/gloves/diamond_hand.webp');
    expect(resolveGloveTexturePath('SIGNAL_MASTER')).toBe('/assets/viewmodel/gloves/signal_master.webp');
  });

  it('STANDARD ISSUE uses the canonical authored atlas', () => {
    expect(GLOVE_TEXTURES.STANDARD_ISSUE).toBeNull();
    expect(resolveGloveTexturePath('STANDARD_ISSUE')).toBe(BASE_GLOVE_TEXTURE_PATH);
    expect(hasOwnGloveTexture('STANDARD_ISSUE')).toBe(false);
  });

  it('every non-standard glove declares its own texture', () => {
    for (const glove of MASTERY_GLOVES) {
      if (glove.id === 'STANDARD_ISSUE') continue;
      expect(hasOwnGloveTexture(glove.id), glove.id).toBe(true);
      expect(resolveGloveTexturePath(glove.id)).toMatch(/^\/assets\/viewmodel\/gloves\/.+\.webp$/);
    }
  });

  it('an unknown glove resolves to the safe base, never undefined', () => {
    expect(resolveGloveTexturePath('NOT_A_GLOVE')).toBe(BASE_GLOVE_TEXTURE_PATH);
    expect(hasOwnGloveTexture('NOT_A_GLOVE')).toBe(false);
  });

  it('the mask path lives in the same runtime directory', () => {
    expect(GLOVE_MASK_TEXTURE_PATH).toBe('/assets/viewmodel/gloves/glove_mask.webp');
  });

  it('a video can never be a mastery glove texture', () => {
    for (const bad of ['/a/goldline.mp4', '/a/goldline.webm', '/a/goldline.mov', '/a/goldline.m3u8']) {
      expect(isAllowedGloveTexturePath(bad), bad).toBe(false);
    }
    for (const good of ['/a/goldline.webp', '/a/goldline.png', '/a/goldline.jpg']) {
      expect(isAllowedGloveTexturePath(good), good).toBe(true);
    }
    // And no declared glove texture is a video.
    for (const glove of MASTERY_GLOVES) {
      const p = resolveGloveTexturePath(glove.id);
      expect(isAllowedGloveTexturePath(p), glove.id).toBe(true);
    }
  });

  it('no glove texture is shipped as a video asset', () => {
    const src = read('src/viewmodel/GloveTextures.ts');
    expect(src).not.toMatch(/\.mp4|\.webm|VideoTexture/);
  });
});

// ---------------------------------------------------------------------------
// 2. Cache + lazy loading
// ---------------------------------------------------------------------------

describe('Glove texture cache', () => {
  it('loads a texture once and serves later requests from memory', async () => {
    const { loader, pending } = deferredLoader();
    const cache = new GloveTextureCache(configureGloveTexture, loader);

    const first = cache.load('/a.webp');
    const second = cache.load('/a.webp');
    expect(pending).toHaveLength(1); // concurrent requests share one fetch
    expect(cache.loadCount).toBe(1);

    pending[0].resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(a).not.toBeNull();
    expect(b).toBe(a);

    // A later request is a pure cache hit.
    const third = await cache.load('/a.webp');
    expect(third).toBe(a);
    expect(cache.loadCount).toBe(1);
    expect(cache.size()).toBe(1);
  });

  it('is lazy: nothing is fetched until requested', () => {
    const { loader, pending } = deferredLoader();
    const cache = new GloveTextureCache(configureGloveTexture, loader);
    expect(pending).toHaveLength(0);
    expect(cache.loadCount).toBe(0);
    expect(cache.size()).toBe(0);
  });

  it('a missing texture resolves to null instead of throwing', async () => {
    const { loader, pending } = deferredLoader();
    const cache = new GloveTextureCache(configureGloveTexture, loader);
    const promise = cache.load('/missing.webp');
    pending[0].fail();
    await expect(promise).resolves.toBeNull();
    expect(cache.size()).toBe(0);
  });

  it('rejects a non-still path without touching the network', async () => {
    const { loader, pending } = deferredLoader();
    const cache = new GloveTextureCache(configureGloveTexture, loader);
    await expect(cache.load('/video.mp4')).resolves.toBeNull();
    expect(pending).toHaveLength(0);
    expect(cache.loadCount).toBe(0);
  });

  it('clear() disposes everything it holds', () => {
    const cache = new GloveTextureCache(configureGloveTexture, deferredLoader().loader);
    let disposed = 0;
    const texture = new THREE.Texture();
    texture.dispose = () => {
      disposed++;
    };
    (cache as unknown as { textures: Map<string, THREE.Texture> }).textures.set('/x.webp', texture);
    cache.clear();
    expect(disposed).toBe(1);
    expect(cache.size()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Async safety: a stale load must never win
// ---------------------------------------------------------------------------

describe('Glove texture switching', () => {
  it('applies the base texture immediately for a glove with its own texture', async () => {
    const { loader } = deferredLoader();
    const switcher = new GloveTextureSwitcher(new GloveTextureCache(configureGloveTexture, loader));
    const base = new THREE.Texture();
    const applied: Array<{ texture: THREE.Texture | null; hasOwn: boolean }> = [];

    void switcher.apply('GOLDLINE', base, (texture, hasOwn) => applied.push({ texture, hasOwn }));
    // The viewmodel is never blank: the base is applied before the load resolves.
    expect(applied).toHaveLength(1);
    expect(applied[0].texture).toBe(base);
    expect(applied[0].hasOwn).toBe(true);
  });

  it('a SLOW load for an earlier glove cannot overwrite a later selection', async () => {
    const { loader, pending } = deferredLoader();
    const switcher = new GloveTextureSwitcher(new GloveTextureCache(configureGloveTexture, loader));
    const base = new THREE.Texture();
    // Records only the ASYNC applications (the ones that follow a completed load),
    // so the immediate safe fallback does not muddy the assertion.
    const asyncApplies: string[] = [];
    let phase = 'immediate';

    const record = (label: string) => (texture: THREE.Texture | null) => {
      if (phase === 'async') asyncApplies.push(texture && texture !== base ? label : `${label}:fallback`);
    };

    // Player selects GOLDLINE, then immediately SIGNAL MASTER.
    void switcher.apply('GOLDLINE', base, record('goldline'));
    void switcher.apply('SIGNAL_MASTER', base, record('signal_master'));

    expect(pending.map((p) => p.url)).toEqual([
      '/assets/viewmodel/gloves/goldline.webp',
      '/assets/viewmodel/gloves/signal_master.webp'
    ]);

    // SIGNAL MASTER resolves first, then the stale GOLDLINE load finishes.
    phase = 'async';
    pending[1].resolve();
    await Promise.resolve();
    await Promise.resolve();
    const afterSignalMaster = asyncApplies.length;
    expect(afterSignalMaster).toBe(1);

    pending[0].resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The stale GOLDLINE resolution produced NO further application.
    expect(asyncApplies.length).toBe(afterSignalMaster);
    expect(asyncApplies[0]).toBe('signal_master');
  });

  it('a stale load that FAILS also produces no further application', async () => {
    const { loader, pending } = deferredLoader();
    const switcher = new GloveTextureSwitcher(new GloveTextureCache(configureGloveTexture, loader));
    const base = new THREE.Texture();
    let applies = 0;

    void switcher.apply('VELOCITY', base, () => applies++);
    void switcher.apply('DIAMOND_HAND', base, () => applies++);
    const before = applies;

    pending[0].fail();
    await Promise.resolve();
    await Promise.resolve();
    expect(applies).toBe(before);
  });

  it('a missing optional texture falls back to the base and still applies the treatment', async () => {
    const { loader, pending } = deferredLoader();
    const switcher = new GloveTextureSwitcher(new GloveTextureCache(configureGloveTexture, loader));
    const base = new THREE.Texture();
    const applied: Array<THREE.Texture | null> = [];

    const done = switcher.apply('GOLDLINE', base, (t) => applied.push(t));
    pending[0].fail();
    await done;

    // Applied twice: the safe base first, then the base again after the failure.
    expect(applied[0]).toBe(base);
    expect(applied[applied.length - 1]).toBe(base);
  });

  it('a glove with no own texture never triggers a fetch', async () => {
    const { loader, pending } = deferredLoader();
    const switcher = new GloveTextureSwitcher(new GloveTextureCache(configureGloveTexture, loader));
    const base = new THREE.Texture();
    await switcher.apply('STANDARD_ISSUE', base, () => undefined);
    expect(pending).toHaveLength(0);
  });

  it('a cache hit applies immediately with no second fetch', async () => {
    const { loader, pending } = deferredLoader();
    const cache = new GloveTextureCache(configureGloveTexture, loader);
    const switcher = new GloveTextureSwitcher(cache);
    const base = new THREE.Texture();

    const first = switcher.apply('GOLDLINE', base, () => undefined);
    pending[0].resolve();
    await first;
    expect(cache.loadCount).toBe(1);

    let appliedWithOwnTexture = false;
    await switcher.apply('GOLDLINE', base, (t, hasOwn) => {
      appliedWithOwnTexture = hasOwn && t !== base;
    });
    expect(appliedWithOwnTexture).toBe(true);
    expect(cache.loadCount).toBe(1); // no second fetch
  });
});

// ---------------------------------------------------------------------------
// 4. Texture configuration (UV / flipY / colour space)
// ---------------------------------------------------------------------------

describe('Glove texture configuration', () => {
  it('matches the authored arms convention: flipY false, sRGB, sharp texels', () => {
    const t = configureGloveTexture(new THREE.Texture());
    expect(t.flipY).toBe(false);
    expect(t.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(t.magFilter).toBe(THREE.NearestFilter);
    expect(t.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(t.generateMipmaps).toBe(true);
    expect(t.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(t.wrapT).toBe(THREE.ClampToEdgeWrapping);
  });

  it('the mask is LINEAR data with smooth filtering', () => {
    const t = configureMaskTexture(new THREE.Texture());
    expect(t.flipY).toBe(false);
    expect(t.colorSpace).toBe(THREE.NoColorSpace);
    expect(t.minFilter).toBe(THREE.LinearFilter);
    expect(t.magFilter).toBe(THREE.LinearFilter);
    expect(t.generateMipmaps).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Skin safety: the mask architecture
// ---------------------------------------------------------------------------

describe('Shared glove mask', () => {
  it('the patch is a NO-OP with no mask, so the shipped look is unchanged', () => {
    const mat = new THREE.MeshStandardMaterial();
    setGloveMask(mat, null, 0.55, 0.34);
    const uniforms = installGloveMaskPatch(mat);
    expect(uniforms.uGloveMaskOn.value).toBe(0);
    expect(uniforms.uGloveMask.value).toBeNull();
  });

  it('installs exactly ONE shared mask sampler, not one per glove', () => {
    const mat = new THREE.MeshStandardMaterial();
    const shader = {
      uniforms: {} as Record<string, unknown>,
      fragmentShader:
        '#include <common>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n'
    };
    installGloveMaskPatch(mat);
    mat.onBeforeCompile(shader as never, undefined as never);

    const declarations = (shader.fragmentShader.match(/uniform sampler2D uGloveMask;/g) ?? []).length;
    expect(declarations).toBe(1);
    // Both maps are scoped by the SAME mask.
    expect(shader.fragmentShader).toMatch(/roughnessFactor = mix\(roughnessFactor, uGloveRough, gloveMaskFactor\)/);
    expect(shader.fragmentShader).toMatch(/metalnessFactor = mix\(metalnessFactor, uGloveMetal, gloveMaskFactor\)/);
  });

  it('the mask is scoped so exposed skin keeps its authored roughness and metalness', () => {
    const mat = new THREE.MeshStandardMaterial();
    setGloveMask(mat, new THREE.Texture(), 0.72, 0.14);
    const uniforms = installGloveMaskPatch(mat);
    expect(uniforms.uGloveMaskOn.value).toBe(1);
    expect(uniforms.uGloveMetal.value).toBeCloseTo(0.72, 6);
    expect(uniforms.uGloveRough.value).toBeCloseTo(0.14, 6);
  });

  it('installing the patch twice reuses the same uniforms (no recompile churn)', () => {
    const mat = new THREE.MeshStandardMaterial();
    const a = installGloveMaskPatch(mat);
    const b = installGloveMaskPatch(mat);
    expect(b).toBe(a);
  });

  it('a glove with its own texture leaves the material colour NEUTRAL', () => {
    const mat = new THREE.MeshStandardMaterial();
    applyGloveTreatment([mat], GLOVE_TREATMENTS.GOLDLINE, 0, 1, true);
    // Skin is never repainted: the authored texture carries the colour.
    expect(mat.color.getHex()).toBe(0xffffff);
    // ...but the treatment still applies its material identity.
    expect(mat.metalness).toBeCloseTo(GLOVE_TREATMENTS.GOLDLINE.metalness, 6);
    expect(mat.roughness).toBeCloseTo(GLOVE_TREATMENTS.GOLDLINE.roughness, 6);
  });

  it('the canonical base path keeps the authored tint behaviour', () => {
    const mat = new THREE.MeshStandardMaterial();
    applyGloveTreatment([mat], GLOVE_TREATMENTS.GOLDLINE, 0, 1, false);
    expect(mat.color.getHex()).toBe(GLOVE_TREATMENTS.GOLDLINE.tint);
  });

  it('the tool documents the real measured skin coverage', () => {
    const tool = read('scripts/export_glove_template.py');
    // The mask heuristic and the documented hazard both reference real content.
    expect(tool).toMatch(/GLOVE_MAX_LUMINANCE/);
    expect(tool).toMatch(/GLOVE_MAX_SATURATION/);
    expect(tool).toMatch(/flipY\s+FALSE/);
    // It only ever WRITES into art-source; it documents (but never writes) the
    // shipped runtime path.
    expect(tool).toMatch(/OUT_DIR = os\.path\.join\(REPO, "art-source", "glove"\)/);
    const writes = tool.match(/\.save\([^)]*\)/g) ?? [];
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) {
      expect(write, write).not.toMatch(/public/);
    }
    // And the runtime path only appears as documentation.
    expect(tool).toMatch(/public\/assets\/viewmodel\/gloves\/<glove>\.webp/);
  });
});

// ---------------------------------------------------------------------------
// 6. Rig integrity: geometry, knife, draw calls
// ---------------------------------------------------------------------------

describe('Rig integrity under glove switching', () => {
  it('switching gloves keeps the SAME arm geometry and material objects', () => {
    const rig = ViewmodelAssetLoader.buildFallbackRig(new THREE.Color(0x00f0ff));
    const geometryBefore = rig.armsScene.children.map((c) => (c as THREE.Mesh).geometry ?? null);
    const materialsBefore = [...rig.armMaterials];
    const rootBefore = rig.rootGroup;
    const knifeBefore = rig.knifeGroup;

    rig.applyGlove('GOLDLINE', 1);
    rig.applyGlove('SIGNAL_MASTER', 1);
    rig.applyGlove('STANDARD_ISSUE', 1);

    expect(rig.rootGroup).toBe(rootBefore);
    expect(rig.knifeGroup).toBe(knifeBefore);
    expect(rig.armMaterials).toEqual(materialsBefore);
    expect(rig.armsScene.children.map((c) => (c as THREE.Mesh).geometry ?? null)).toEqual(
      geometryBefore
    );
    rig.dispose();
  });

  it('the frozen knife socket transform is never touched by a glove change', () => {
    const rig = ViewmodelAssetLoader.buildFallbackRig(new THREE.Color(0x00f0ff));
    rig.knifeGroup.position.set(0.0093, 0.1107, 0.0033);
    rig.knifeGroup.rotation.set(3.034, 0.3737, 0.2205);
    rig.knifeGroup.scale.set(1.011, 1.011, 1.011);
    const before = {
      p: rig.knifeGroup.position.clone(),
      r: rig.knifeGroup.rotation.clone(),
      s: rig.knifeGroup.scale.clone()
    };

    for (const glove of ALL_GLOVES) rig.applyGlove(glove, 1);

    expect(rig.knifeGroup.position.x).toBe(before.p.x);
    expect(rig.knifeGroup.position.y).toBe(before.p.y);
    expect(rig.knifeGroup.position.z).toBe(before.p.z);
    expect(rig.knifeGroup.rotation.x).toBe(before.r.x);
    expect(rig.knifeGroup.rotation.y).toBe(before.r.y);
    expect(rig.knifeGroup.rotation.z).toBe(before.r.z);
    expect(rig.knifeGroup.scale.x).toBe(before.s.x);
    rig.dispose();
  });

  it('a glove change adds no mesh, so the draw-call architecture is unchanged', () => {
    const rig = ViewmodelAssetLoader.buildFallbackRig(new THREE.Color(0x00f0ff));
    let meshesBefore = 0;
    rig.rootGroup.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshesBefore++;
    });

    for (const glove of ALL_GLOVES) rig.applyGlove(glove, 1);

    let meshesAfter = 0;
    rig.rootGroup.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshesAfter++;
    });
    expect(meshesAfter).toBe(meshesBefore);
    rig.dispose();
  });

  it('the treatment is still applied AFTER a texture swap', () => {
    const rig = ViewmodelAssetLoader.buildFallbackRig(new THREE.Color(0x00f0ff));
    for (const glove of ALL_GLOVES) {
      rig.applyGlove(glove, 1);
      const treatment = GLOVE_TREATMENTS[glove];
      const mat = rig.armMaterials[0];
      expect(mat.metalness, glove).toBeCloseTo(treatment.metalness, 6);
      expect(mat.roughness, glove).toBeCloseTo(treatment.roughness, 6);
      expect(rig.getActiveGloveId(), glove).toBe(glove);
    }
    rig.dispose();
  });

  it('an unknown glove never crashes the viewmodel', () => {
    const rig = ViewmodelAssetLoader.buildFallbackRig(new THREE.Color(0x00f0ff));
    expect(() => rig.applyGlove('TOTALLY_MADE_UP', 1)).not.toThrow();
    expect(rig.armMaterials[0].metalness).toBeCloseTo(
      GLOVE_TREATMENTS.STANDARD_ISSUE.metalness,
      6
    );
    rig.dispose();
  });

  it('glove emissive can still never reach the bloom threshold', () => {
    expect(maxGloveEmissiveIntensity(1.3)).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// 7. DEV preview must not touch progression
// ---------------------------------------------------------------------------

describe('DEV preview and progression', () => {
  beforeEach(() => {
    MasteryGloveSystem.getInstance().resetForTests();
  });

  it('previewing every glove leaves mastery progression untouched', () => {
    const system = MasteryGloveSystem.getInstance();
    const before = system.evaluate();

    for (const glove of ALL_GLOVES) {
      system.setDevPreview(glove);
      expect(system.getDevPreviewGloveId()).toBe(glove);
    }
    system.setDevPreview(null);

    const after = system.evaluate();
    expect(after.unlockedIds).toEqual(before.unlockedIds);
    expect(after.summary).toEqual(before.summary);
    // Nothing was equipped either.
    expect(system.getEquippedGloveId()).toBe('STANDARD_ISSUE');
  });

  it('previewing an unearned glove does not make it satisfiable', () => {
    const system = MasteryGloveSystem.getInstance();
    system.setDevPreview('SIGNAL_MASTER');
    expect(system.getEffectiveGloveId()).toBe('SIGNAL_MASTER');
    expect(system.isSatisfied('SIGNAL_MASTER')).toBe(false);
    system.setDevPreview(null);
  });

  it('the pipeline never writes mastery state', () => {
    const src = read('src/viewmodel/GloveTextures.ts');
    expect(src).not.toMatch(/localStorage|equipGlove|recordGhostReplay|MasteryGloveSystem/);
  });
});

// ---------------------------------------------------------------------------
// 8. Caches are session-scoped and releasable
// ---------------------------------------------------------------------------

describe('Glove texture caches', () => {
  it('the shared caches start empty and can be released', () => {
    disposeGloveTextureCaches();
    expect(gloveTextureCache.size()).toBe(0);
    expect(gloveMaskCache.size()).toBe(0);
  });

  it('the viewmodel disposes the shared caches with the rig', () => {
    const controller = read('src/viewmodel/ViewmodelController.ts');
    expect(controller).toMatch(/disposeGloveTextureCaches\(\)/);
  });

  it('only the equipped glove is loaded at rig creation, not every glove', () => {
    const loader = read('src/viewmodel/ViewmodelAssetLoader.ts');
    // The base atlas is the boot texture; per-glove textures are resolved lazily.
    expect(loader).toMatch(/applyGlove/);
    expect(loader).toMatch(/GloveTextureSwitcher/);
    // No loop over all gloves at load time.
    expect(loader).not.toMatch(/for \(const glove of MASTERY_GLOVES\)/);
    expect(loader).not.toMatch(/MASTERY_GLOVES\.forEach/);
  });

  it('no glove texture is preloaded at boot', () => {
    const src = read('src/viewmodel/ViewmodelAssetLoader.ts');
    const bootSection = src.slice(0, src.indexOf('const applyGlove'));
    for (const glove of MASTERY_GLOVES) {
      if (glove.id === 'STANDARD_ISSUE') continue;
      expect(bootSection, glove.id).not.toContain(glove.id);
    }
  });
});
