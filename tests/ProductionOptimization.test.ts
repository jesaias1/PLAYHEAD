/**
 * PRODUCTION OPTIMIZATION V1 — payload, cosmetic lifecycle and quality guard.
 *
 * Locks in the optimization contract:
 *
 *   1. Canonical presets are shipped MINIFIED and still parse to a complete,
 *      canonical level (no truncation, no regeneration fallback).
 *   2. Every referenced cosmetic asset exists; every animated skin has both a
 *      standard and a low-tier encode; no orphan assets ship.
 *   3. Cosmetic resources are bounded: at most one static texture resident and
 *      at most one live video, and only the EQUIPPED skin may decode.
 *   4. The preset cache never re-fetches a track it already has.
 *   5. Quality tiers stay presentation-only and never reach movement, route,
 *      collision or map-identity modules.
 *   6. Startup does not download the whole Signal Pack or the whole Armory.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { PresetLevelCache } from '../src/audio/PresetLevelCache';
import { QUALITY_PRESETS, resolvePreset } from '../src/rendering/QualityPresets';
import { ROUTE_GENERATION_VERSION } from '../src/generation/RouteGenerator';
import { OFFICIAL_MAP_REGISTRY } from '../src/online/OfficialMapRegistry';
import { KarambitSkinSystem, KARAMBIT_SKINS } from '../src/viewmodel/KarambitSkinSystem';
import { PLAYHEAD_MOVEMENT_V1 } from '../src/player/MovementConfig';

const repoRoot = path.resolve(__dirname, '..');
const PRESETS_DIR = path.join(repoRoot, 'public', 'music', 'presets');
const KARAMBIT_DIR = path.join(repoRoot, 'public', 'assets', 'viewmodel', 'karambit');
const VIEWMODEL_DIR = path.join(repoRoot, 'public', 'assets', 'viewmodel');

const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(repoRoot, 'public', rel.replace(/^\//, '')));

// ---------------------------------------------------------------------------
// 1. Canonical preset payload
// ---------------------------------------------------------------------------

describe('Canonical presets — shipped minified', () => {
  const files = fs.readdirSync(PRESETS_DIR).filter((f) => f.endsWith('.json'));

  it('ships exactly one preset per official registry entry', () => {
    expect(files.length).toBe(OFFICIAL_MAP_REGISTRY.length);
    for (const entry of OFFICIAL_MAP_REGISTRY) {
      expect(files).toContain(`${entry.trackId}.json`);
    }
  });

  it('is minified: no pretty-print whitespace anywhere', () => {
    for (const f of files) {
      const raw = fs.readFileSync(path.join(PRESETS_DIR, f), 'utf8');
      // A minified JSON document has exactly one line and no indentation runs.
      expect(raw.includes('\n'), `${f} contains newlines`).toBe(false);
      expect(/\n\s\s+/.test(raw), `${f} is indented`).toBe(false);
      expect(raw.startsWith('{')).toBe(true);
      expect(raw.endsWith('}')).toBe(true);
    }
  });

  it('parses to a COMPLETE canonical level: no runtime regeneration fallback', () => {
    for (const entry of OFFICIAL_MAP_REGISTRY) {
      const json = JSON.parse(
        fs.readFileSync(path.join(PRESETS_DIR, `${entry.trackId}.json`), 'utf8')
      ) as Record<string, unknown>;

      expect(json.trackId, entry.trackId).toBe(entry.trackId);

      const analysis = json.analysis as { frames?: unknown[]; seed?: number };
      expect(Array.isArray(analysis?.frames), `${entry.trackId} frames`).toBe(true);
      expect(analysis.frames!.length, `${entry.trackId} frame count`).toBeGreaterThan(100);

      const track = json.track as {
        generationVersion?: string;
        route?: unknown[];
        obstacles?: unknown[];
        signalSpines?: unknown[];
      };
      // This is the exact condition that would trigger a runtime regeneration
      // (and therefore an official FFT fallback). It must never be true.
      expect(track.generationVersion, `${entry.trackId} generationVersion`).toBe(
        ROUTE_GENERATION_VERSION
      );
      expect(track.route!.length, `${entry.trackId} route`).toBeGreaterThan(0);
      expect(track.obstacles!.length, `${entry.trackId} obstacles`).toBeGreaterThan(0);
      expect(track.signalSpines!.length, `${entry.trackId} spines`).toBeGreaterThan(0);
    }
  });

  it('keeps the registry fingerprints untouched (no value was reformatted away)', () => {
    // Snapshot of the shipped canonical identity. Minification is formatting
    // only, so these strings must be byte-identical to the pre-optimization set.
    expect(OFFICIAL_MAP_REGISTRY.map((e) => `${e.trackId}|${e.mapFingerprint}|${e.analysisFingerprint}`)).toEqual([
      'track_1_signal_drift|mfp_v1_2AC7467E29419C32_40eb|anfp_v1_0FECC3F530E85242',
      'track_2_flow_state|mfp_v1_B1EEF8A8434DD30E_b8eb|anfp_v1_2111C10AC5F43134',
      'track_3_surf_the_void|mfp_v1_5E0500352418B06D_7a0e|anfp_v1_00060E570B0513A3',
      'track_4_airwave_theory|mfp_v1_A62A03D1A5DE1F81_766c|anfp_v1_99AA2FE5F6B0A7E2',
      'track_5_gravity_line|mfp_v1_1CB4B484B698E2E2_6515|anfp_v1_FB088A54EDA2FA29',
      'track_6_over_the_edge|mfp_v1_B6AC926A38515910_6f75|anfp_v1_F2BD7F721D1A7BBA',
      'track_7_drop_zone_surfer|mfp_v1_02C4103B70DC8E14_8fa6|anfp_v1_E990D0B35C179694',
      'track_8_wave_surfing|mfp_v1_48CC984100DD6740_739a|anfp_v1_49ECF2186778D318',
      'track_9_neon_abyss|mfp_v1_0D8A10180466F0B4_4540|anfp_v1_20747FA912E066A6',
      'track_10_neon_slipstream|mfp_v1_F84D156F59CB8DB4_42c8|anfp_v1_5AC224E5DB296EA7',
      'track_11_ex_gravity|mfp_v1_4CB7847FD5BDF154_6569|anfp_v1_E1987AC6947525FC',
      'track_12_shadows_over_the_circuit|mfp_v1_16C61C7F26179A9C_3ce5|anfp_v1_67DD4774BF859EDA',
      'track_13_waveform_descent|mfp_v1_F9C6BB2864A7C47E_8834|anfp_v1_E0CA9EF8EAB73ACB',
      'track_14_kz_ascent|mfp_v1_C95B69E61B60700F_7859|anfp_v1_0C066A2929007804'
    ]);
    for (const entry of OFFICIAL_MAP_REGISTRY) {
      expect(entry.movementVersion).toBe('phmv1_2865D271');
      expect(entry.mapVersion).toBe(5);
      expect(entry.analysisVersion).toBe(1);
    }
  });

  it('the generator emits minified JSON (the source fix, not a one-off edit)', () => {
    const src = read('src/audio/PresetGenerator.ts');
    expect(src).toMatch(/return JSON\.stringify\(data\);/);
    expect(src).not.toMatch(/JSON\.stringify\(data, null, 2\)/);
  });
});

// ---------------------------------------------------------------------------
// 2. Preset loading behaviour
// ---------------------------------------------------------------------------

describe('Canonical presets — lazy loading + cache', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    PresetLevelCache.clear();
  });

  it('never bulk-preloads the Signal Pack at startup', () => {
    // The only preset-loading entry point is PresetLevelCache.loadPreset, and it
    // is called per selected track. A boot-time loop over the catalog would show
    // up as a loop over loadPreset() or a glob import of the presets directory.
    const src = read('src/audio/PresetLevelCache.ts');
    expect(src).not.toMatch(/Promise\.all|forEach.*loadPreset|import\.meta\.glob/);
    const game = read('src/core/Game.ts');
    expect(game).not.toMatch(/import\.meta\.glob.*presets/);
    expect(game).not.toMatch(/for \(const .* of .*\)\s*\{?\s*await PresetLevelCache\.loadPreset/);
  });

  it('fetches a track once and serves every later request from memory', async () => {
    let fetches = 0;
    const payload = {
      trackId: 'track_5_gravity_line',
      analysis: { frames: [], waveform: [] },
      track: { generationVersion: ROUTE_GENERATION_VERSION, route: [] }
    };
    globalThis.fetch = vi.fn(async () => {
      fetches++;
      return { ok: true, json: async () => JSON.parse(JSON.stringify(payload)) } as unknown as Response;
    }) as unknown as typeof fetch;

    const a = await PresetLevelCache.loadPreset('track_5_gravity_line');
    const b = await PresetLevelCache.loadPreset('track_5_gravity_line');
    const c = await PresetLevelCache.loadPreset('track_5_gravity_line');

    expect(fetches).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);

    const info = PresetLevelCache.getCacheInfo();
    expect(info.loads).toBe(1);
    expect(info.hits).toBe(2);
    expect(info.cached).toBe(1);
  });

  it('counts a failed fetch without caching anything', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false } as unknown as Response)) as unknown as typeof fetch;
    expect(await PresetLevelCache.loadPreset('track_does_not_exist')).toBeNull();
    const info = PresetLevelCache.getCacheInfo();
    expect(info.cached).toBe(0);
    expect(info.misses).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Cosmetic asset inventory
// ---------------------------------------------------------------------------

describe('Cosmetic assets — inventory integrity', () => {
  it('every referenced texture and video exists on disk', () => {
    for (const skin of KARAMBIT_SKINS) {
      const t = skin.profile.texturePath;
      const v = skin.profile.videoPath;
      if (t) expect(exists(t), `${skin.id} texture ${t}`).toBe(true);
      if (v) expect(exists(v), `${skin.id} video ${v}`).toBe(true);
    }
  });

  it('every animated skin ships BOTH a standard and a low-tier encode', () => {
    const animated = KARAMBIT_SKINS.filter((s) => s.profile.videoPath);
    expect(animated.length).toBeGreaterThan(0);
    for (const skin of animated) {
      const base = skin.profile.videoPath!;
      const low = base.replace(/\.mp4$/, '.low.mp4');
      expect(exists(base), `${skin.id} standard encode`).toBe(true);
      expect(exists(low), `${skin.id} low encode`).toBe(true);

      const baseSize = fs.statSync(path.join(repoRoot, 'public', base.replace(/^\//, ''))).size;
      const lowSize = fs.statSync(path.join(repoRoot, 'public', low.replace(/^\//, ''))).size;
      expect(lowSize, `${skin.id} low encode should be smaller`).toBeLessThan(baseSize);
    }
  });

  it('no animated skin ships a 1080p-class encode', () => {
    // Enforced via the documented encode target: the shipped videos are the
    // 960/640 long-side productions, so no file may remain in the 1080p band.
    for (const skin of KARAMBIT_SKINS) {
      const v = skin.profile.videoPath;
      if (!v) continue;
      const size = fs.statSync(path.join(repoRoot, 'public', v.replace(/^\//, ''))).size;
      expect(size, `${skin.id} video is oversized for a viewmodel texture`).toBeLessThan(10 * 1024 * 1024);
    }
  });

  it('ships no orphan assets under the viewmodel directory', () => {
    const referenced = new Set<string>();
    const skinSrc = read('src/viewmodel/KarambitSkinSystem.ts');
    const loaderSrc = read('src/viewmodel/ViewmodelAssetLoader.ts');
    for (const src of [skinSrc, loaderSrc]) {
      for (const m of src.matchAll(/['"](\/assets\/[^'"]+)['"]/g)) referenced.add(m[1]);
    }
    expect(referenced.size).toBeGreaterThan(0);

    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else out.push(full);
      }
      return out;
    };

    const orphans: string[] = [];
    for (const file of walk(VIEWMODEL_DIR)) {
      const url = '/' + path.relative(path.join(repoRoot, 'public'), file).split(path.sep).join('/');
      // The low-tier encodes are referenced by convention, not by literal path.
      const isLowVariant = url.endsWith('.low.mp4');
      if (!referenced.has(url) && !isLowVariant) orphans.push(url);
    }
    expect(orphans).toEqual([]);
  });

  it('uses GPU-friendly, appropriately sized static cosmetic textures', () => {
    const textures = KARAMBIT_SKINS.map((s) => s.profile.texturePath).filter(
      (t): t is string => !!t
    );
    expect(textures.length).toBeGreaterThan(0);
    for (const t of textures) {
      const abs = path.join(repoRoot, 'public', t.replace(/^\//, ''));
      // Production runtime assets are WebP; a 1254px PNG master must not ship.
      expect(t.endsWith('.webp'), `${t} should be a webp runtime asset`).toBe(true);
      expect(fs.statSync(abs).size, `${t} is larger than a viewmodel texture should be`).toBeLessThan(
        700 * 1024
      );
    }
  });

  it('the glove texture is a webp runtime asset', () => {
    const loader = read('src/viewmodel/ViewmodelAssetLoader.ts');
    expect(loader).toMatch(/arms_gloves_01\.webp/);
    expect(loader).not.toMatch(/arms_gloves_01\.png/);
    expect(exists('/assets/viewmodel/textures/arms_gloves_01.webp')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Cosmetic resource lifecycle
// ---------------------------------------------------------------------------

describe('Cosmetic resources — bounded lifecycle', () => {
  it('startup loads at most one static texture, not the whole Armory', () => {
    const src = read('src/viewmodel/KarambitSkinSystem.ts');
    // The eager "for every skin, load its texture" loop must be gone.
    expect(src).not.toMatch(/for \(const skin of KARAMBIT_SKINS\) \{\s*\n\s*if \(skin\.profile\.texturePath\)/);
    expect(src).toMatch(/retainStaticTextureFor\(this\.equippedSkinId\)/);
  });

  it('releases the previous cosmetic texture when switching skins', () => {
    const src = read('src/viewmodel/KarambitSkinSystem.ts');
    expect(src).toMatch(/private retainStaticTextureFor\(skinId: string\)/);
    expect(src).toMatch(/texture\.dispose\(\);/);
    expect(src).toMatch(/this\.skinTextures\.delete\(id\);/);
    // Equipping must reconcile, and so must a cloud equip.
    expect(src).toMatch(/this\.releaseActiveVideoTexture\(\);\s*\n\s*this\.equippedSkinId = target\.id;\s*\n[\s\S]{0,200}retainStaticTextureFor\(target\.id\)/);
  });

  it('only ONE animated skin may decode at a time', () => {
    const src = read('src/viewmodel/KarambitSkinSystem.ts');
    // A single active video slot, guarded on the equipped skin id.
    expect(src).toMatch(/private activeVideo: \{ skinId: string/);
    expect(src).toMatch(/skin\.id !== this\.equippedSkinId/);
    expect(src).toMatch(/getActiveVideoCount\(\): number \{\s*\n\s*return this\.activeVideo \? 1 : 0;/);
  });

  it('releases the video element and texture on switch', () => {
    const src = read('src/viewmodel/KarambitSkinSystem.ts');
    expect(src).toMatch(/element\.pause\(\)/);
    expect(src).toMatch(/element\.removeAttribute\('src'\)/);
    expect(src).toMatch(/texture\.dispose\(\)/);
  });

  it('the manager reports zero live videos and zero resident textures in a cold session', () => {
    const skins = KarambitSkinSystem.getInstance();
    // Node has no DOM: nothing may be created or leaked.
    expect(skins.getActiveVideoCount()).toBe(0);
    expect(skins.getResidentTextureCount()).toBe(0);
    expect(skins.getVideoDiagnostics()).toBeNull();
  });

  it('selects the low encode only when the tier asks for it', () => {
    const skins = KarambitSkinSystem.getInstance();
    const original = skins.getVideoQuality();

    skins.setVideoQuality('LOW');
    expect(skins.getVideoQuality()).toBe('LOW');
    const lowUrl = (skins as unknown as { videoUrlFor: (s: unknown) => string }).videoUrlFor({
      profile: { videoPath: '/assets/viewmodel/karambit/videos/mirrors.mp4' }
    });
    expect(lowUrl).toBe('/assets/viewmodel/karambit/videos/mirrors.low.mp4');

    skins.setVideoQuality('STANDARD');
    const stdUrl = (skins as unknown as { videoUrlFor: (s: unknown) => string }).videoUrlFor({
      profile: { videoPath: '/assets/viewmodel/karambit/videos/mirrors.mp4' }
    });
    expect(stdUrl).toBe('/assets/viewmodel/karambit/videos/mirrors.mp4');

    skins.setVideoQuality(original);
  });
});

// ---------------------------------------------------------------------------
// 5. Quality tiers stay presentation-only
// ---------------------------------------------------------------------------

describe('Quality tiers — presentation only', () => {
  it('maps weaker tiers to the smaller animated-cosmetic encode', () => {
    expect(QUALITY_PRESETS.LOW.cosmeticVideoScale).toBe('LOW');
    expect(QUALITY_PRESETS.MEDIUM.cosmeticVideoScale).toBe('LOW');
    expect(QUALITY_PRESETS.HIGH.cosmeticVideoScale).toBe('STANDARD');
    expect(QUALITY_PRESETS.ULTRA.cosmeticVideoScale).toBe('STANDARD');
  });

  it('resolvePreset never returns a preset that scales gameplay', () => {
    for (const tier of ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'] as const) {
      const p = resolvePreset(tier);
      // Every field is a rendering/presentation knob.
      expect(typeof p.renderScale).toBe('number');
      expect(typeof p.cosmeticVideoScale).toBe('string');
      expect(p.cosmeticVideoScale).toBe(tier === 'LOW' || tier === 'MEDIUM' ? 'LOW' : 'STANDARD');
    }
  });

  it('no optimization system references movement or gameplay identity', () => {
    // PresetLevelCache is deliberately excluded: it IS the canonical resolution
    // path and must keep importing RouteGenerator for the stale-package
    // fallback. Everything added by this optimization pass must not.
    const guarded = [
      'src/rendering/QualityPresets.ts',
      'src/rendering/EffectIntensity.ts',
      'src/viewmodel/KarambitSkinSystem.ts',
      'src/world/Environment.ts'
    ];
    for (const file of guarded) {
      const src = read(file);
      expect(src, file).not.toMatch(/from '\.\.\/player\/MovementConfig'/);
      expect(src, file).not.toMatch(/from '\.\.\/player\/PlayerController'/);
      expect(src, file).not.toMatch(/from '\.\.\/generation\//);
      expect(src, file).not.toMatch(/PLAYHEAD_MOVEMENT_V1/);
    }
  });

  it('the canonical preset loader still resolves identity through one pure path', () => {
    // Optimization must not have introduced a second resolution path.
    const src = read('src/audio/PresetLevelCache.ts');
    expect(src).toMatch(/buildLevelData\(json\)/);
    expect(src).toMatch(/ROUTE_GENERATION_VERSION/);
  });

  it('leaves every frozen movement constant untouched', () => {
    expect(PLAYHEAD_MOVEMENT_V1.gravity).toBe(24.0);
    expect(PLAYHEAD_MOVEMENT_V1.jumpVelocity).toBe(8.8);
    expect(PLAYHEAD_MOVEMENT_V1.maxGroundWishSpeed).toBe(14.0);
    expect(PLAYHEAD_MOVEMENT_V1.maxAirWishSpeed).toBe(3.0);
    expect(PLAYHEAD_MOVEMENT_V1.friction).toBe(4.5);
    expect(PLAYHEAD_MOVEMENT_V1.coyoteTime).toBe(0.12);
  });

  it('the frozen knife calibration is untouched', () => {
    // The socket constants live in the viewmodel controller / asset loader and
    // are calibration-frozen. No optimization may recenter or retune them.
    const loader = read('src/viewmodel/ViewmodelAssetLoader.ts');
    expect(loader).toMatch(/knifeGroup\.position\.set\(0\.0093, 0\.1107, 0\.0033\)/);

    const controller = read('src/viewmodel/ViewmodelController.ts');
    expect(controller).toMatch(/new THREE\.Vector3\(0\.0093, 0\.1107, 0\.0033\)/);

    const calibrator = read('src/viewmodel/ViewmodelCalibrator.ts');
    expect(calibrator).toMatch(/position: \[0\.0093, 0\.1107, 0\.0033\]/);
    expect(calibrator).toMatch(/rotationRad: \[3\.034, 0\.3737, 0\.2205\]/);
    expect(calibrator).toMatch(/scale: 1\.011/);
  });
});

// ---------------------------------------------------------------------------
// 6. Diagnostics wiring
// ---------------------------------------------------------------------------

describe('Optimization diagnostics', () => {
  it('exposes preset cache, cosmetic and video state to the DEV overlay', () => {
    const overlay = read('src/ui/DevOverlay.ts');
    expect(overlay).toMatch(/ASSETS: equipped/);
    expect(overlay).toMatch(/LIVE VIDEO/);
    expect(overlay).toMatch(/PRESETS cached/);
    expect(overlay).toMatch(/COSMETIC VID/);
  });

  it('carries no external build-time dependency for the asset work', () => {
    // The optimization must not add runtime dependencies to the shipped bundle.
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const deps = Object.keys(pkg.dependencies);
    expect(deps.sort()).toEqual(['@supabase/supabase-js', 'three']);
  });
});
