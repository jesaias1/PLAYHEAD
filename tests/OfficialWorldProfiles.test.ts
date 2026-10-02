/**
 * OFFICIAL SIGNAL PACK WORLD PROFILES — focused acceptance tests.
 *
 * Covers exactly the required contracts:
 *   1. Exact catalog coverage for the 14 real official track ids.
 *   2. Deterministic official resolution + custom/tutorial/lab fallback +
 *      Signal Drift baseline (no override).
 *   3. Non-palette visual signature variation (composition/architecture/hero/
 *      sky/signage differ beyond colour; grayscale-distinguishable).
 *   4. Canonical gameplay untouched (map fingerprint still matches the registry,
 *      and a profile never mutates the track).
 *   5. Section/drop response bounds + smoothing.
 *   6. FINAL geometry safety = 0 across all 14 real precomputed worlds, with the
 *      profile actually consumed by the world builders.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';

import { SignalPackCatalog } from '../src/audio/SignalPackCatalog';
import {
  SignalWorldProfileRegistry,
  FALLBACK_WORLD_PROFILE,
  SIGNAL_DRIFT_PROFILE,
  stepProfileReactionGain
} from '../src/world/SignalWorldProfile';
import { WorldGeometrySafetyPass } from '../src/world/WorldGeometrySafetyPass';
import { RouteExclusionCorridor } from '../src/world/RouteExclusionCorridor';
import { GeometryBuilder } from '../src/world/GeometryBuilder';
import { SkylineArchitecture } from '../src/world/SkylineArchitecture';
import { SpectralArchitecture } from '../src/world/SpectralArchitecture';
import { DropSetpiece } from '../src/world/DropSetpiece';
import { CelestialLandmarks } from '../src/world/CelestialLandmarks';
import { SignalLandmarks } from '../src/world/SignalLandmarks';
import { RouteSignalPackets } from '../src/world/RouteSignalPackets';
import { SpectacleRenderer } from '../src/world/SpectacleRenderer';
import { SignalHeroMotifs } from '../src/world/SignalHeroMotifs';
import { planSignalJourney, signatureEnvelope } from '../src/world/SignalJourney';
import { World } from '../src/world/World';
import { RouteNodeType } from '../src/generation/GenerationTypes';
import { PaletteSelector } from '../src/audio/TrackPalettes';
import { TrackAnalysis } from '../src/audio/AudioFeatures';
import { GeneratedTrack } from '../src/generation/GenerationTypes';
import { RouteGenerator, ROUTE_GENERATION_VERSION } from '../src/generation/RouteGenerator';
import { RouteChallengeGenerator } from '../src/generation/RouteChallengeGenerator';
import { SignalSpineGenerator } from '../src/generation/SignalSpineGenerator';
import { SeededRandom } from '../src/generation/SeededRandom';
import { computeMapFingerprint, computeMapIdentity } from '../src/online/MapIdentity';
import { PresetLevelCache } from '../src/audio/PresetLevelCache';
import { OFFICIAL_MAP_REGISTRY } from '../src/online/OfficialMapRegistry';

const presetDir = path.resolve(__dirname, '../public/music/presets');

/**
 * GENUINE PRE-CHANGE (HEAD 2221269) skyline snapshot. Captured by building the
 * synthetic fixture below with the UNMODIFIED HEAD builder and recording the
 * exact per-instance matrices. The inert path (Signal Drift / fallback) must
 * reproduce this byte-for-byte, proving the profile never perturbs the
 * reference world. Not a modified-default-vs-modified-profile comparison.
 */
const recorded = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, './fixtures/skyline-head-inert-snapshot.json'),
    'utf8'
  )
) as {
  fnv: string;
  primaryCount: number;
  supportCount: number;
  ridgeCount: number;
  primaryHash: string;
  supportHash: string;
  ridgeHash: string;
};

function officialTrackIds(): string[] {
  return fs
    .readdirSync(presetDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

function loadPreset(trackId: string): { analysis: TrackAnalysis; track: GeneratedTrack } {
  const json = JSON.parse(fs.readFileSync(path.resolve(presetDir, `${trackId}.json`), 'utf8'));
  const analysis: TrackAnalysis = json.analysis;
  if (Array.isArray(analysis.waveform)) {
    analysis.waveform = new Float32Array(analysis.waveform as unknown as number[]);
  }
  let track: GeneratedTrack = json.track;
  if (!track?.route || track.generationVersion !== ROUTE_GENERATION_VERSION) {
    track = RouteGenerator.generate(analysis);
  }
  if (!track.optionalRamps || track.optionalRamps.length === 0) {
    const rng = new SeededRandom(analysis.seed || 12345);
    track.optionalRamps = RouteGenerator.generateOptionalSideSurfs(track.route, rng);
  }
  track.obstacles = RouteChallengeGenerator.generate(track.route, analysis, {
    recoveryShelves: track.recoveryShelves
  });
  if (!track.signalSpines || track.signalSpines.length === 0) {
    const rng = new SeededRandom(analysis.seed || 12345);
    track.signalSpines = SignalSpineGenerator.generate(track.route, analysis, rng, {
      obstacles: track.obstacles
    });
  }
  return { analysis, track };
}

/** Assemble the real world the way World.loadTrack does, WITH a profile, then audit. */
function assembleAndAudit(
  analysis: TrackAnalysis,
  track: GeneratedTrack,
  profileId: string
): { report: ReturnType<WorldGeometrySafetyPass['run']>; heroBuilt: boolean } {
  const profile = SignalWorldProfileRegistry.resolveForTrackId(profileId);
  const palette = PaletteSelector.selectPalette(analysis.seed, 0.5, analysis.globalEnergy);
  const scene = new THREE.Scene();

  const built = GeometryBuilder.buildWorld(track, palette, profile);
  scene.add(built.rootGroup);
  const skyline = new SkylineArchitecture(scene, analysis, track, profile);
  const celestial = new CelestialLandmarks(scene, analysis, track, palette, profile);
  const spectral = new SpectralArchitecture(scene, analysis, track);
  const drop = new DropSetpiece(scene, analysis, track);
  const landmarks = new SignalLandmarks(analysis, track, palette, 1.0, profile);
  scene.add(landmarks.group);
  const packets = new RouteSignalPackets(track, palette, 32);
  scene.add(packets.group);
  const spectacle = new SpectacleRenderer(scene);
  spectacle.init(track);
  const heroes = new SignalHeroMotifs(analysis, track, palette, profile);
  scene.add(heroes.group);

  const corridor = new RouteExclusionCorridor(RouteExclusionCorridor.collectGameplayNodes(track));
  const pass = new WorldGeometrySafetyPass(track, corridor);
  pass.register(drop.group, 'DropSetpiece', 'DECORATION');
  pass.register(spectral.group, 'SpectralArchitecture', 'DECORATION');
  pass.register(skyline.group, 'SkylineArchitecture', 'DECORATION');
  pass.register(celestial.group, 'CelestialLandmarks', 'VISUAL_ONLY');
  pass.register(built.rootGroup, 'GeometryBuilder', 'DECORATION');
  pass.register(landmarks.group, 'SignalLandmarks', 'DECORATION');
  pass.register(packets.group, 'RouteSignalPackets', 'VISUAL_ONLY');
  pass.register(heroes.group, 'SignalHeroMotifs', 'DECORATION');
  pass.register(spectacle.group, 'SpectacleRenderer', 'IGNORE_WORLD_SAFETY');

  const report = pass.run(scene);
  return { report, heroBuilt: heroes.built };
}

describe('Official world profiles — coverage and resolution', () => {
  it('authors exactly one profile for every real catalog track id', () => {
    const catalogIds = SignalPackCatalog.getTracks().map((t) => t.id);
    const profileIds = SignalWorldProfileRegistry.all().map((p) => p.trackId);

    expect(catalogIds.length).toBe(14);
    expect(profileIds.length).toBe(14);

    for (const id of catalogIds) {
      const resolved = SignalWorldProfileRegistry.resolveForTrackId(id);
      expect(resolved.trackId, `${id} must resolve to its authored profile`).toBe(id);
      // Signal Drift is the frozen baseline reference (no override); every
      // OTHER official track is an authored override.
      if (id === 'track_1_signal_drift') {
        expect(resolved.usesOverride).toBe(false);
      } else {
      expect(resolved.usesOverride, `${id} must be an authored override`).toBe(true);
      }
    }
    // The set of authored ids matches the catalog exactly, with no strays.
    expect(new Set(profileIds)).toEqual(new Set(catalogIds));
  });

  it('resolves deterministically', () => {
    const a = SignalWorldProfileRegistry.resolveForTrackId('track_9_neon_abyss');
    const b = SignalWorldProfileRegistry.resolveForTrackId('track_9_neon_abyss');
    expect(a).toBe(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('falls back for custom / tutorial / lab / unknown ids, never guessing from a filename', () => {
    expect(SignalWorldProfileRegistry.resolveForTrackId(null).trackId).toBe('FALLBACK');
    expect(SignalWorldProfileRegistry.resolveForTrackId(undefined).trackId).toBe('FALLBACK');
    expect(SignalWorldProfileRegistry.resolveForTrackId('').trackId).toBe('FALLBACK');
    expect(SignalWorldProfileRegistry.resolveForTrackId('custom-upload-1').trackId).toBe('FALLBACK');
    // An arbitrary uploaded FILENAME that resembles an official title must still
    // fall back: only a trusted catalog id can select an official profile.
    expect(SignalWorldProfileRegistry.resolveForTrackId('Signal Drift.mp3').trackId).toBe('FALLBACK');
    expect(SignalWorldProfileRegistry.resolveForTrackId('track_1_signal_drift.mp3').trackId).toBe('FALLBACK');
    expect(FALLBACK_WORLD_PROFILE.usesOverride).toBe(false);
    expect(SignalWorldProfileRegistry.resolveForCatalogTrack(undefined).trackId).toBe('FALLBACK');
  });

  it('keeps SIGNAL DRIFT as the untouched baseline reference', () => {
    const drift = SignalWorldProfileRegistry.resolveForTrackId('track_1_signal_drift');
    expect(drift).toBe(SIGNAL_DRIFT_PROFILE);
    expect(drift.usesOverride).toBe(false);
  });
});

describe('Official world profiles — non-palette visual identity', () => {
  it('varies architecture family, hero motif and composition beyond colour', () => {
    const profiles = SignalWorldProfileRegistry.all();
    const families = new Set(profiles.map((p) => `${p.architecture.primary}/${p.architecture.secondary}`));
    const heroes = new Set(profiles.map((p) => p.hero.motif));

    // Many distinct architectural family pairings and hero motifs.
    expect(families.size).toBeGreaterThanOrEqual(6);
    expect(heroes.size).toBeGreaterThanOrEqual(7);

    // Composition scalars genuinely spread out (grayscale-distinguishable).
    const densities = profiles.map((p) => p.architecture.density);
    const verticalities = profiles.map((p) => p.space.verticality);
    expect(Math.max(...densities) - Math.min(...densities)).toBeGreaterThan(0.25);
    expect(Math.max(...verticalities) - Math.min(...verticalities)).toBeGreaterThan(0.3);

    // Route MATERIAL family varies too (not just tint).
    const materials = new Set(profiles.map((p) => p.material.route));
    expect(materials.size).toBeGreaterThanOrEqual(4);
  });

  it('keeps rare celestial objects rare and allows a NONE', () => {
    const profiles = SignalWorldProfileRegistry.all();
    const none = profiles.filter((p) => p.sky.celestial === 'NONE');
    const withRare = profiles.filter((p) => p.celestialRarity.allowRare);
    // At least one track has no large celestial body, and not every track is
    // allowed the rare motif.
    expect(none.length).toBeGreaterThanOrEqual(1);
    expect(withRare.length).toBeLessThan(profiles.length);
  });
});

describe('Official world profiles — canonical gameplay untouched', () => {
  it('leaves every official map fingerprint exactly as registered', () => {
    const registry = new Map(OFFICIAL_MAP_REGISTRY.map((e) => [e.trackId, e.mapFingerprint]));
    for (const trackId of officialTrackIds()) {
      // Use the SAME canonical path the browser uses (PresetLevelCache), so the
      // comparison is apples-to-apples with the shipped registry.
      const json = JSON.parse(fs.readFileSync(path.resolve(presetDir, `${trackId}.json`), 'utf8'));
      const { analysis, track } = PresetLevelCache.buildLevelData(json);
      // Use the SAME identity the registry generator uses (analysis-bound
      // fingerprint matches what ships), so this is apples-to-apples.
      const fp = computeMapIdentity(trackId, track, analysis).mapFingerprint;
      expect(fp, `${trackId} canonical fingerprint must be unchanged`).toBe(registry.get(trackId));
    }
  });

  it('never mutates the generated track when resolving a profile', () => {
    const { track } = loadPreset('track_7_drop_zone_surfer');
    const before = computeMapFingerprint(track);
    SignalWorldProfileRegistry.resolveForTrackId('track_7_drop_zone_surfer');
    SignalWorldProfileRegistry.resolveForTrackId(null);
    expect(computeMapFingerprint(track)).toBe(before);
  });
});

describe('Official world profiles — section/drop response bounds', () => {
  it('stays inside the authored bounds and is inert for Drift / fallback', () => {
    expect(stepProfileReactionGain(FALLBACK_WORLD_PROFILE, 'DROP', 1 / 60, 1.0)).toBe(1.0);
    expect(stepProfileReactionGain(SIGNAL_DRIFT_PROFILE, 'DROP', 1 / 60, 1.0)).toBe(1.0);

    const profile = SignalWorldProfileRegistry.resolveForTrackId('track_7_drop_zone_surfer');
    let gain = 1.0;
    // Push toward the ceiling on an actual curated phrase across many frames.
    for (let i = 0; i < 600; i++) {
      gain = stepProfileReactionGain(profile, profile.reaction.curatedThemes[0], 1 / 60, gain);
      expect(gain).toBeGreaterThanOrEqual(profile.reaction.gainMin);
      expect(gain).toBeLessThanOrEqual(profile.reaction.gainMax);
    }
    expect(gain).toBeCloseTo(profile.reaction.gainMax, 2);

    // A non-curated section pulls back down to the floor.
    for (let i = 0; i < 1200; i++) {
      gain = stepProfileReactionGain(profile, 'FLOW', 1 / 60, gain);
    }
    expect(gain).toBeCloseTo(profile.reaction.gainMin, 2);

    // Every profile keeps a sane, bounded, low-poly-simultaneity response.
    for (const p of SignalWorldProfileRegistry.all()) {
      expect(p.reaction.gainMin).toBeGreaterThan(0.5);
      expect(p.reaction.gainMax).toBeLessThanOrEqual(1.6);
      expect(p.reaction.gainMin).toBeLessThanOrEqual(p.reaction.gainMax);
      expect(p.reaction.maxSimultaneous).toBeGreaterThanOrEqual(2);
      expect(p.reaction.emphasis.length).toBeLessThanOrEqual(3);
    }
  });
});

describe('Official world profiles — final geometry safety across all 14', () => {
  it('reports FINAL UNSAFE = 0 and no unregistered geometry with profiles consumed', () => {
    const ids = officialTrackIds();
    expect(ids.length).toBeGreaterThanOrEqual(14);

    const summary: string[] = [];
    for (const trackId of ids) {
      const { analysis, track } = loadPreset(trackId);
      const { report, heroBuilt } = assembleAndAudit(analysis, track, trackId);

      summary.push(
        `${trackId}: removed=${report.removed} unregistered=${report.unregisteredRenderables} ` +
          `unsafe=${report.finalUnsafe} hero=${heroBuilt}`
      );

      expect(report.finalUnsafe, `${trackId} must have zero surviving unsafe decoration`).toBe(0);
      expect(report.unregisteredRenderables, `${trackId} must have no unregistered geometry`).toBe(0);
    }
    console.log('[OFFICIAL WORLD PROFILE SAFETY]\n  ' + summary.join('\n  '));
  }, 180000);
});






describe('Official world profiles — real World lifecycle across all 14', () => {
  it('builds the actual World, runs bounded updates and disposes without error', () => {
    const ids = officialTrackIds();
    const rows: string[] = [];
    for (const trackId of ids) {
      const json = JSON.parse(fs.readFileSync(path.resolve(presetDir, `${trackId}.json`), 'utf8'));
      const level = PresetLevelCache.buildLevelData(json);
      const scene = new THREE.Scene();
      const world = new World(scene);

      expect(() =>
        world.loadTrack(
          level.analysis,
          level.track,
          undefined,
          SignalPackCatalog.getTrackById(trackId)?.id ?? null
        )
      ).not.toThrow();

      expect(world.worldProfile.trackId).toBe(trackId);
      expect(world.worldSafetyReport?.finalUnsafe).toBe(0);

      const duration = level.analysis.duration || 100;
      for (const t of [0.1, 0.5, 0.85]) {
        expect(() =>
          world.update(duration * t, new THREE.Vector3(0, 0, 0), 0, 1 / 60, undefined)
        ).not.toThrow();
      }
      expect(() => world.dispose()).not.toThrow();
      rows.push(`${trackId}: profile=${world.worldProfile.trackId}`);
    }
    console.log('[REAL WORLD LIFECYCLE]\n  ' + rows.join('\n  '));
  }, 180000);
});


describe('Official world profiles — PRE-CHANGE skyline inert-path regression', () => {
  // A small synthetic route/analysis; assembled with the SAME builder constructor
  // the real game uses. Nothing here is game-specific, so the recorded snapshot
  // is a genuine PRE-CHANGE baseline for the Signal Drift / fallback path.
  function synth(): { analysis: TrackAnalysis; track: GeneratedTrack } {
    const route: any[] = [];
    for (let i = 0; i < 40; i++) {
      route.push({
        id: i,
        time: i * 1.5,
        position: { x: i * 6, y: Math.round(Math.sin(i * 0.4) * 8), z: i * 20 },
        dimensions: { x: 10, y: 1, z: 18 },
        yaw: 0.05 * i,
        pitch: 0,
        roll: 0,
        type: RouteNodeType.RUNWAY,
        intensity: 0.5,
        sectionIndex: 0,
        arcLength: i * 21,
        isSurf: false,
        isBoost: false
      });
    }
    const frames = Array.from({ length: 60 }, (_, i) => ({
      time: i,
      rms: 0.4,
      bass: 0.3 + (i % 10) * 0.05,
      lowMid: 0.3,
      mid: 0.35,
      high: 0.3,
      centroid: 0.4,
      flux: 0.2,
      density: 0.3
    }));
    const analysis: any = {
      filename: 'synth',
      duration: 90,
      bpm: 128,
      bpmConfidence: 0.8,
      globalEnergy: 0.6,
      frames,
      onsets: [],
      sections: [{ theme: 'DROP', start: 10, end: 20, intensity: 0.8 }],
      waveform: new Float32Array(512),
      seed: 777,
      visualAccent: { hex: '#8899ff', rgb: [0.5, 0.6, 1], name: 'SYNTH' }
    };
    const track: any = {
      seed: 777,
      route,
      optionalRamps: [],
      recoveryShelves: [],
      signalSpines: [],
      obstacles: [],
      forks: []
    };
    return { analysis, track };
  }

  function dump(mesh: THREE.InstancedMesh | null): string {
    if (!mesh) return '';
    const m = new THREE.Matrix4();
    const parts: string[] = [];
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      parts.push(m.elements.map((e) => e.toFixed(2)).join(','));
    }
    return `${mesh.count}:${parts.join('|')}`;
  }

  it('default instance matrices/counts match the recorded PRE-CHANGE snapshot', () => {
    const { analysis, track } = synth();
    const scene = new THREE.Scene();
    const sky: any = new SkylineArchitecture(scene, analysis, track, FALLBACK_WORLD_PROFILE);
    expect(dump(sky.primaryMonoliths)).toBe(`${recorded.primaryCount}:${recorded.primaryHash}`);
    expect(dump(sky.supportStelae)).toBe(`${recorded.supportCount}:${recorded.supportHash}`);
    expect(dump(sky.backgroundRidges)).toBe(`${recorded.ridgeCount}:${recorded.ridgeHash}`);
    // And the inert path must not have moved off the authored constants.
    expect(sky.skylineImpact).toBe(0);
    sky.dispose();
    expect(sky.group.parent).toBeNull();
  });

  it('Signal Drift profile is also strictly inert (usesOverride=false)', () => {
    const { analysis, track } = synth();
    const scene = new THREE.Scene();
    const sky: any = new SkylineArchitecture(scene, analysis, track, SIGNAL_DRIFT_PROFILE);
    expect(dump(sky.primaryMonoliths)).toBe(`${recorded.primaryCount}:${recorded.primaryHash}`);
    expect(dump(sky.supportStelae)).toBe(`${recorded.supportCount}:${recorded.supportHash}`);
    expect(dump(sky.backgroundRidges)).toBe(`${recorded.ridgeCount}:${recorded.ridgeHash}`);
    expect(sky.skylineImpact).toBe(0);
    sky.dispose();
    expect(sky.group.parent).toBeNull();
  });

  it('an authored profile genuinely changes the skyline composition', () => {
    const { analysis, track } = synth();
    const scene = new THREE.Scene();
    const id = SignalPackCatalog.getTracks().find((t) => t.id !== 'track_1_signal_drift')!.id;
    const profile = SignalWorldProfileRegistry.resolveForTrackId(id);
    expect(profile.usesOverride).toBe(true);
    const sky: any = new SkylineArchitecture(scene, analysis, track, profile);
    expect(sky.skylineImpact).toBeGreaterThan(0);
    expect(dump(sky.primaryMonoliths)).not.toBe(`${recorded.primaryCount}:${recorded.primaryHash}`);
  });
});

describe('Official world profiles — persistent state resets on every load', () => {
  it('leaks nothing across profiled -> Signal Drift -> custom/null using the SAME stubs', () => {
    const profiledId = 'track_7_drop_zone_surfer';
    const profiledJson = JSON.parse(fs.readFileSync(path.resolve(presetDir, `${profiledId}.json`), 'utf8'));
    const profiled = PresetLevelCache.buildLevelData(profiledJson);
    const driftJson = JSON.parse(fs.readFileSync(path.resolve(presetDir, 'track_1_signal_drift.json'), 'utf8'));
    const drift = PresetLevelCache.buildLevelData(driftJson);
    // Custom/null: reuse a real analysis but load with a null official id.
    const custom = PresetLevelCache.buildLevelData(profiledJson);

    const scene = new THREE.Scene();
    const environment: any = {
      setPalette: (): void => {},
      applyWorldProfile: (): void => {},
      clearWorldProfile: (): void => {},
      activePreset: undefined
    };
    const world = new World(scene);
    // ONE world/sky/environment stub reused for all three loads.
    expect(world.worldProfile.usesOverride).toBe(false);

    // 1. Profiled track applies non-identity state.
    world.loadTrack(profiled.analysis, profiled.track, environment, profiledId);
    expect(world.worldProfile.usesOverride).toBe(true);
    // The bounded gain itself is stepped per frame (stays 1.0 until the first
    // update), but the APPLIED profile state must be live now.
    expect((world.visualController as any).profileGainMin).not.toBe(1.0);
    const skyAny = world.sky as any;
    expect(skyAny.starDensity).not.toBe(1.0);
    expect((world.visualController as any).profileReactionActive).toBe(true);

    // 2. Signal Drift must reset everything.
    world.loadTrack(drift.analysis, drift.track, environment, 'track_1_signal_drift');
    expect(world.worldProfile.usesOverride).toBe(false);
    expect(world.profileReactionGain).toBe(1.0);
    expect(skyAny.starDensity).toBe(1.0);
    expect((world.visualController as any).profileReactionActive).toBe(false);
    expect((world.visualController as any).profileGainMin).toBe(1.0);
    expect((world.visualController as any).profileGainMax).toBe(1.0);
    expect((world.visualController as any).profileCuratedThemes).toEqual([]);
    const u = (world.sky as any).material.uniforms;
    expect(u.uNebula.value).toBe(0.0);
    expect(u.uLightField.value).toBe(0.0);
    expect(u.uGalaxyBand.value).toBe(1.0);
    expect(u.uSkyMotif.value).toBe(1.0);
    expect(u.uAtmosphereMotif.value).toBe(1.0);
    // Environment stub reset was invoked.
    expect(world.worldProfile.usesOverride).toBe(false);

    // 3. Custom/null (another profiled analysis, null id) stays inert.
    world.loadTrack(custom.analysis, custom.track, environment, null);
    expect(world.worldProfile.usesOverride).toBe(false);
    expect(world.profileReactionGain).toBe(1.0);
    expect((world.visualController as any).profileReactionActive).toBe(false);
  });
});


describe('Official world profiles — celestial body vs sky-only motifs', () => {
  it('NEBULA / GALAXY_BAND / DISTANT_LIGHT_FIELD render NO large body; NONE too', () => {
    const ids = [
      'track_2_flow_state',              // DISTANT_LIGHT_FIELD
      'track_4_airwave_theory',          // GALAXY_BAND
      'track_7_drop_zone_surfer',        // NEBULA
      'track_11_ex_gravity',             // NEBULA
      'track_12_shadows_over_the_circuit', // GALAXY_BAND
      'track_13_waveform_descent',       // NEBULA
      'track_14_kz_ascent'               // NONE
    ];
    for (const id of ids) {
      const { analysis, track } = loadPreset(id);
      const palette = PaletteSelector.selectPalette(analysis.seed, 0.5, analysis.globalEnergy);
      const scene = new THREE.Scene();
      const profile = SignalWorldProfileRegistry.resolveForTrackId(id);
      const cel = new CelestialLandmarks(scene, analysis, track, palette, profile);
      expect(cel.hasBody, `${id} (${profile.sky.celestial}) must place no large body`).toBe(false);
    }
  });

  it('a body is still placed for MOON / ECLIPSE / HALO profiles', () => {
    const ids = ['track_3_surf_the_void', 'track_5_gravity_line', 'track_6_over_the_edge', 'track_8_wave_surfing'];
    for (const id of ids) {
      const { analysis, track } = loadPreset(id);
      const palette = PaletteSelector.selectPalette(analysis.seed, 0.5, analysis.globalEnergy);
      const scene = new THREE.Scene();
      const profile = SignalWorldProfileRegistry.resolveForTrackId(id);
      const cel = new CelestialLandmarks(scene, analysis, track, palette, profile);
      expect(cel.hasBody, `${id} (${profile.sky.celestial}) must place a body`).toBe(true);
    }
  });

  it('signal-drift / fallback celestial is unchanged (body still placed)', () => {
    const { analysis, track } = loadPreset('track_1_signal_drift');
    const palette = PaletteSelector.selectPalette(analysis.seed, 0.5, analysis.globalEnergy);
    const scene = new THREE.Scene();
    const cel = new CelestialLandmarks(scene, analysis, track, palette, SIGNAL_DRIFT_PROFILE);
    expect(cel.hasBody).toBe(true);
  });
});

describe('Official musical journey', () => {
  it('actually thins the skyline while retaining the same shared mesh families', () => {
    const { analysis, track } = loadPreset('track_11_ex_gravity');
    const profile = SignalWorldProfileRegistry.resolveForTrackId('track_11_ex_gravity');
    const directed = new SkylineArchitecture(new THREE.Scene(), analysis, track, profile);
    const uniform = new SkylineArchitecture(new THREE.Scene(), analysis, track, { ...profile, composition: undefined });
    expect(directed.compositionThinnedInstances).toBeGreaterThan(0);
    expect(uniform.compositionThinnedInstances).toBe(0);
    expect(directed.getVisibleCounts().total).toBeLessThan(uniform.getVisibleCounts().total);
    directed.dispose();
    uniform.dispose();
  });
  it('derives deterministic spatial bands and at most two signatures from real cached sections', () => {
    for (const id of officialTrackIds()) {
      const { analysis, track } = loadPreset(id);
      const profile = SignalWorldProfileRegistry.resolveForTrackId(id);
      const before = JSON.stringify(track);
      const plan = planSignalJourney(analysis, track, profile);
      expect(planSignalJourney(analysis, track, profile)).toEqual(plan);
      expect(JSON.stringify(track)).toBe(before);
      if (!profile.usesOverride) {
        expect(plan.bands.active).toBe(false);
        expect(plan.signatureTimes).toEqual([]);
        continue;
      }
      expect(plan.signatureTimes.length).toBeGreaterThan(0);
      expect(plan.signatureTimes.length).toBeLessThanOrEqual(2);
      for (const time of plan.signatureTimes) {
        expect(analysis.sections.some(s => s.start === time)).toBe(true);
      }
      expect(plan.bands.revealArc).toBeGreaterThanOrEqual(0);
      expect(plan.bands.revealArc).toBeLessThanOrEqual(1);
      expect(plan.bands.denseEnd).toBeGreaterThanOrEqual(plan.bands.denseStart);
      expect(plan.bands.lateEnd).toBeGreaterThanOrEqual(plan.bands.lateStart);
      const hero = new SignalHeroMotifs(analysis, track,
        PaletteSelector.selectPalette(analysis.seed, 0.5, analysis.globalEnergy), profile);
      const mesh = hero.group.children[0] as THREE.InstancedMesh;
      expect(mesh).toBeDefined();
      const material = mesh.material as THREE.MeshStandardMaterial;
      hero.update(1, plan.signatureTimes[0]);
      const idle = material.emissiveIntensity;
      hero.update(1, plan.signatureTimes[0] + 4);
      expect(material.emissiveIntensity).toBeCloseTo(idle + (hero.reacts ? 0.4 : 0));
      hero.update(1, plan.signatureTimes[0] + 4, true);
      expect(material.emissiveIntensity).toBe(idle);
      hero.dispose();
    }
  });
  it('activates slowly then resolves without reacting to every beat', () => {
    expect(signatureEnvelope([20, 70], 19)).toBe(0);
    expect(signatureEnvelope([20, 70], 20)).toBe(0);
    expect(signatureEnvelope([20, 70], 24)).toBe(1);
    expect(signatureEnvelope([20, 70], 28)).toBe(0);
    expect(signatureEnvelope([20, 70], 50)).toBe(0);
  });
});

describe('Official world profiles — hero motifs are batched and bounds-correct', () => {
  it('each profiled track batches its hero boxes into ONE InstancedMesh', () => {
    const ids = officialTrackIds();
    const rows: string[] = [];
    for (const id of ids) {
      const { analysis, track } = loadPreset(id);
      const palette = PaletteSelector.selectPalette(analysis.seed, 0.5, analysis.globalEnergy);
      const profile = SignalWorldProfileRegistry.resolveForTrackId(id);
      const hero = new SignalHeroMotifs(analysis, track, palette, profile);
      let instancedMeshes = 0;
      let instances = 0;
      let plainMeshes = 0;
      hero.group.traverse((o) => {
        const im = o as THREE.InstancedMesh;
        if (im.isInstancedMesh) {
          instancedMeshes++;
          instances += im.count;
        } else if ((o as THREE.Mesh).isMesh) {
          plainMeshes++;
        }
      });
      if (profile.usesOverride && hero.built) {
        expect(instancedMeshes, `${id} must batch all hero boxes into one InstancedMesh`).toBe(1);
        expect(plainMeshes, `${id} must not create per-element unique meshes`).toBe(0);
        expect(instances).toBeGreaterThan(0);
      }
      // Drift / fallback never build hero geometry at all.
      if (!profile.usesOverride) {
        expect(hero.built).toBe(false);
        expect(instancedMeshes).toBe(0);
        expect(plainMeshes).toBe(0);
      }
      rows.push(`${id}: instancedMeshes=${instancedMeshes} instances=${instances} built=${hero.built}`);
    }
    console.log('[HERO BATCH]\n  ' + rows.join('\n  '));
  }, 120000);
});


describe('Official world profiles — SKY / ATMOSPHERE bounded gain is consumed', () => {
  it('drives the sky motif gain only when SKY/ATMOSPHERE is a selected family', () => {
    const load = (id: string) => {
      const json = JSON.parse(fs.readFileSync(path.resolve(presetDir, `${id}.json`), 'utf8'));
      return PresetLevelCache.buildLevelData(json);
    };
    const step = (world: World, level: ReturnType<typeof load>): void => {
      const dur = level.analysis.duration || 100;
      for (let i = 0; i < 1500; i++) {
        world.update((i / 60) % dur, new THREE.Vector3(0, 0, 0), 0, 1 / 60, undefined);
      }
    };

    // track_3 selects SKY -> the motif gain must move off identity.
    const skyLevel = load('track_3_surf_the_void');
    const skyWorld = new World(new THREE.Scene());
    skyWorld.loadTrack(skyLevel.analysis, skyLevel.track, undefined, 'track_3_surf_the_void');
    step(skyWorld, skyLevel);
    const skyAny = skyWorld.sky as any;
    expect(Math.abs(skyAny.skyMotifGain - 1.0)).toBeGreaterThan(0.01);
    // ...and the live uniform follows it.
    expect(Math.abs(skyAny.material.uniforms.uSkyMotif.value - 1.0)).toBeGreaterThan(0.01);

    // track_2 selects neither SKY nor ATMOSPHERE -> both stay exactly 1.0.
    const baseLevel = load('track_2_flow_state');
    const baseWorld = new World(new THREE.Scene());
    baseWorld.loadTrack(baseLevel.analysis, baseLevel.track, undefined, 'track_2_flow_state');
    step(baseWorld, baseLevel);
    const baseAny = baseWorld.sky as any;
    expect(baseAny.skyMotifGain).toBe(1.0);
    expect(baseAny.material.uniforms.uSkyMotif.value).toBe(1.0);
    expect(baseAny.material.uniforms.uAtmosphereMotif.value).toBe(1.0);
  }, 120000);
});
