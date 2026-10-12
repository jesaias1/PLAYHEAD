/**
 * SIGNAL CITY layer and map picker — wiring and safety contracts.
 *
 *   1. The layer is built for city maps of catalog songs, on top of the
 *      existing city, and never for themed maps or untrusted sources.
 *   2. Every static piece is outside the RouteExclusionCorridor, on every
 *      city song, NORMAL and SURF.
 *   3. The train stays outside the corridor across its WHOLE animation, not
 *      only where it rests.
 *   4. Deterministic per song; songs differ from one another.
 *   5. Map picker keys resolve to the right environment for any course, and
 *      map identity is unaffected.
 *
 * These verify wiring and stability. They do not establish visual quality.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';

import { PresetLevelCache } from '../src/audio/PresetLevelCache';
import { SignalPackCatalog } from '../src/audio/SignalPackCatalog';
import { TrackGenerator } from '../src/generation/TrackGenerator';
import { computeMapIdentity } from '../src/online/MapIdentity';
import { OFFICIAL_MAP_REGISTRY } from '../src/online/OfficialMapRegistry';
import { World } from '../src/world/World';
import {
  CITY_MAP_KEY,
  ENVIRONMENT_MAPS,
  resolveEnvironmentTheme,
  themedTrackIds
} from '../src/world/themes/EnvironmentThemeRegistry';

const PRESET_DIR = path.resolve(__dirname, '../public/music/presets');
const BENCHMARK = 'track_13_waveform_descent';

function loadFresh(trackId: string) {
  const raw = fs.readFileSync(path.join(PRESET_DIR, `${trackId}.json`), 'utf8');
  return PresetLevelCache.buildLevelData(JSON.parse(raw) as Record<string, unknown>);
}

function staticInside(world: World): { instances: number; inside: number } {
  const layer = world.signalCity!;
  layer.group.updateWorldMatrix(true, true);
  let instances = 0;
  let inside = 0;
  const matrix = new THREE.Matrix4();
  const box = new THREE.Box3();
  layer.group.traverse((object) => {
    const mesh = object as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh || mesh.name === 'SignalCityTrain') return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      box.copy(mesh.geometry.boundingBox!).applyMatrix4(matrix);
      if (box.max.y < -50000) continue;
      instances++;
      if (world.corridor!.evaluateVolume(box)) inside++;
    }
  });
  return { instances, inside };
}

/** Samples the train through several full shuttles and counts intrusions. */
function trainInside(world: World): { samples: number; inside: number } {
  const layer = world.signalCity!;
  const unit = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
  const box = new THREE.Box3();
  let samples = 0;
  let inside = 0;
  for (let time = 0; time < 400; time += 0.5) {
    for (const matrix of layer.trainMatrices(time)) {
      samples++;
      if (world.corridor!.evaluateVolume(box.copy(unit).applyMatrix4(matrix))) inside++;
    }
  }
  return { samples, inside };
}

describe('Signal City — where the layer is built', () => {
  it('is built on top of the city for a catalog song', () => {
    const level = loadFresh(BENCHMARK);
    const world = new World(new THREE.Scene());
    world.loadTrack(level.analysis, level.track, undefined, BENCHMARK);
    expect(world.environmentTheme).toBeNull();
    expect(world.signalCity).not.toBeNull();
    // The original city is still all there.
    expect(world.skyline).not.toBeNull();
    expect(world.megastructure).not.toBeNull();
    expect(world.sky.mesh.visible).toBe(true);

    const stats = world.signalCity!.stats;
    expect(stats.hasBroadcastTower).toBe(true);
    expect(stats.hasSplitTowers).toBe(true);
    expect(stats.hasTerminal).toBe(true);
    expect(stats.hasTrain).toBe(true);
    expect(stats.housing).toBeGreaterThan(10);
    expect(stats.drawBatches).toBeLessThanOrEqual(3);
    expect(world.signalCity!.spans.map((s) => s.role)).toEqual([
      'OPENING', 'BUILD', 'BUILD', 'BUILD', 'PEAK', 'BREAKDOWN', 'FINALE'
    ]);
    world.dispose();
    expect(world.signalCity).toBeNull();
  }, 60000);

  it('is not built for themed maps or untrusted sources', () => {
    const level = loadFresh(BENCHMARK);
    const world = new World(new THREE.Scene());
    world.loadTrack(level.analysis, level.track, undefined, null);
    expect(world.signalCity).toBeNull();
    expect(world.skyline).not.toBeNull();
    world.loadTrack(level.analysis, level.track, undefined, BENCHMARK, 'ORBITAL_STATION');
    expect(world.signalCity).toBeNull();
    expect(world.environmentTheme?.id).toBe('ORBITAL_STATION');
    world.dispose();
  }, 60000);
});

describe('Signal City — corridor safety on every city song', () => {
  const cityIds = SignalPackCatalog.getTracks().map((t) => t.id).filter((id) => !themedTrackIds().includes(id));

  it('keeps every static piece and the whole train sweep clear (NORMAL)', () => {
    expect(cityIds.length).toBeGreaterThan(8);
    const rows: string[] = [];
    let trains = 0;
    for (const id of cityIds) {
      const level = loadFresh(id);
      const world = new World(new THREE.Scene());
      world.loadTrack(level.analysis, level.track, undefined, id);
      const layer = world.signalCity!;
      expect(layer, id).not.toBeNull();
      const fixed = staticInside(world);
      expect(fixed.inside, id).toBe(0);
      expect(world.worldSafetyReport?.finalUnsafe, id).toBe(0);
      expect(world.worldSafetyReport!.violations.filter((v) => v.source === 'SignalCityLayer'), id).toEqual([]);
      const moving = trainInside(world);
      expect(moving.inside, id).toBe(0);
      if (layer.stats.hasTrain) trains++;
      rows.push(`${id}: pieces=${fixed.instances} housing=${layer.stats.housing} train=${layer.stats.hasTrain} tower=${layer.stats.hasBroadcastTower} terminal=${layer.stats.hasTerminal}`);
      world.dispose();
    }
    console.log('[SIGNAL CITY]\n  ' + rows.join('\n  '));
    expect(trains).toBeGreaterThan(cityIds.length / 2);
  }, 240000);

  it('keeps every static piece and the whole train sweep clear (SURF)', () => {
    for (const id of [BENCHMARK, 'track_8_wave_surfing', 'track_7_drop_zone_surfer']) {
      const level = loadFresh(id);
      const surf = TrackGenerator.generate(level.analysis, 'SURF');
      const world = new World(new THREE.Scene());
      world.loadTrack(level.analysis, surf, undefined, null, id);
      expect(world.signalCity, id).not.toBeNull();
      expect(staticInside(world).inside, id).toBe(0);
      expect(trainInside(world).inside, id).toBe(0);
      expect(world.worldSafetyReport?.finalUnsafe, id).toBe(0);
      world.dispose();
    }
  }, 180000);
});

describe('Signal City — identity', () => {
  it('is deterministic per song, and songs differ', () => {
    const signature = (id: string): string => {
      const level = loadFresh(id);
      const world = new World(new THREE.Scene());
      world.loadTrack(level.analysis, level.track, undefined, id);
      const layer = world.signalCity!;
      const mesh = layer.group.children[0] as THREE.InstancedMesh;
      const out = JSON.stringify([layer.stats, mesh.count, Array.from(mesh.instanceMatrix.array.slice(0, 48)), layer.uniforms.uWarmth.value]);
      world.dispose();
      return out;
    };
    expect(signature(BENCHMARK)).toBe(signature(BENCHMARK));
    expect(signature(BENCHMARK)).not.toBe(signature('track_8_wave_surfing'));
  }, 120000);

  it('never changes competitive map identity', () => {
    const level = loadFresh(BENCHMARK);
    const registered = OFFICIAL_MAP_REGISTRY.find((e) => e.trackId === BENCHMARK)!;
    const world = new World(new THREE.Scene());
    for (const map of ENVIRONMENT_MAPS) {
      world.loadTrack(level.analysis, level.track, undefined, BENCHMARK, map.key);
      expect(computeMapIdentity(BENCHMARK, level.track, level.analysis).mapFingerprint, map.key).toBe(registered.mapFingerprint);
    }
    world.dispose();
  }, 120000);
});

describe('Map picker', () => {
  it('offers the city and every theme, each with a shipped thumbnail', () => {
    expect(ENVIRONMENT_MAPS.map((m) => m.key)).toEqual([CITY_MAP_KEY, 'MIDNIGHT_MOUNTAINS', 'ORBITAL_STATION', 'MIDNIGHT_HARBOUR']);
    for (const map of ENVIRONMENT_MAPS) {
      expect(map.thumbnail.startsWith('/assets/')).toBe(true);
      expect(fs.existsSync(path.resolve(__dirname, '../public' + map.thumbnail)), map.thumbnail).toBe(true);
    }
  });

  it('resolves a picked map for any course, overriding the song default', () => {
    expect(resolveEnvironmentTheme(CITY_MAP_KEY)).toBeNull();
    expect(resolveEnvironmentTheme('MIDNIGHT_MOUNTAINS')?.id).toBe('MIDNIGHT_MOUNTAINS');
    expect(resolveEnvironmentTheme('ORBITAL_STATION')?.id).toBe('ORBITAL_STATION');

    const level = loadFresh('track_5_gravity_line');
    const world = new World(new THREE.Scene());
    // The song's own map by default...
    world.loadTrack(level.analysis, level.track, undefined, 'track_5_gravity_line');
    expect(world.environmentTheme?.id).toBe('MIDNIGHT_MOUNTAINS');
    // ...the city when picked (with the Signal City layer)...
    world.loadTrack(level.analysis, level.track, undefined, 'track_5_gravity_line', CITY_MAP_KEY);
    expect(world.environmentTheme).toBeNull();
    expect(world.signalCity).not.toBeNull();
    expect(world.worldSafetyReport?.finalUnsafe).toBe(0);
    // ...or another theme.
    world.loadTrack(level.analysis, level.track, undefined, 'track_5_gravity_line', 'ORBITAL_STATION');
    expect(world.environmentTheme?.id).toBe('ORBITAL_STATION');
    expect(world.worldSafetyReport?.finalUnsafe).toBe(0);
    world.dispose();
  }, 120000);
});
