/**
 * MIDNIGHT HARBOUR environment theme and the route VARIETY GUARD.
 *
 *   1. Harbour: assignment, corridor safety (NORMAL + SURF), unchanged map
 *      identity, clean switching.
 *   2. Water: one plane, below every gameplay surface with the corridor's own
 *      clearance, never moved vertically, and never a collider.
 *   3. Variety guard: no official route has a long stretch of nothing but
 *      plain runways and step-ups after the onboarding runway.
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
import { resolveEnvironmentTheme } from '../src/world/themes/EnvironmentThemeRegistry';
import { MidnightHarbourInstance } from '../src/world/themes/harbour/MidnightHarbourTheme';

const PRESET_DIR = path.resolve(__dirname, '../public/music/presets');
const HARBOUR = 'track_14_kz_ascent';

function loadFresh(trackId: string) {
  const raw = fs.readFileSync(path.join(PRESET_DIR, `${trackId}.json`), 'utf8');
  return PresetLevelCache.buildLevelData(JSON.parse(raw) as Record<string, unknown>);
}

function expectHarbourSafe(world: World): void {
  const theme = world.environmentTheme as MidnightHarbourInstance;
  theme.group.updateWorldMatrix(true, true);
  const matrix = new THREE.Matrix4();
  const box = new THREE.Box3();
  let instances = 0;
  let inside = 0;
  theme.group.traverse((object) => {
    const mesh = object as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      box.copy(mesh.geometry.boundingBox!).applyMatrix4(matrix);
      if (box.max.y < -50000) continue;
      instances++;
      if (world.corridor!.evaluateVolume(box)) inside++;
    }
  });
  expect(instances).toBeGreaterThan(80);
  expect(inside).toBe(0);
  expect(world.worldSafetyReport?.finalUnsafe).toBe(0);
  expect(world.worldSafetyReport!.violations.filter((v) => v.source.startsWith('EnvironmentTheme'))).toEqual([]);

  // WATER: below every gameplay surface, with room to spare, wherever it is.
  const water = theme.water!;
  expect(water).not.toBeNull();
  const track = world.track!;
  const surfaces = [
    ...track.route,
    ...(track.optionalRamps ?? []),
    ...(track.recoveryShelves ?? []),
    ...(track.signalSpines ?? [])
  ];
  const lowest = Math.min(...surfaces.map((n) => n.position.y));
  expect(theme.stats.waterY).toBeLessThan(lowest - 60);
  expect(water.position.y).toBe(theme.stats.waterY);
  // Following the player changes X/Z only.
  for (const node of [track.route[0], track.route[track.route.length - 1]]) {
    world.update(1, new THREE.Vector3(node.position.x, node.position.y + 2, node.position.z), 0, 1 / 60, undefined);
    expect(water.position.y).toBe(theme.stats.waterY);
    const slab = new THREE.Box3(
      new THREE.Vector3(water.position.x - 2100, water.position.y - 1, water.position.z - 2100),
      new THREE.Vector3(water.position.x + 2100, water.position.y, water.position.z + 2100)
    );
    expect(world.corridor!.evaluateVolume(slab)).toBeNull();
  }
}

describe('Midnight Harbour', () => {
  it('is assigned to its song and builds a corridor-safe port (NORMAL)', () => {
    expect(resolveEnvironmentTheme(HARBOUR)?.id).toBe('MIDNIGHT_HARBOUR');
    const level = loadFresh(HARBOUR);
    const before = JSON.stringify(level.track.route);
    const world = new World(new THREE.Scene());
    world.loadTrack(level.analysis, level.track, undefined, HARBOUR);
    const theme = world.environmentTheme as MidnightHarbourInstance;
    expect(theme.id).toBe('MIDNIGHT_HARBOUR');
    expect(world.skyline).toBeNull();
    expect(world.signalCity).toBeNull();
    expect(theme.stats.hasShipAlongside).toBe(true);
    expect(theme.stats.hasLighthouse).toBe(true);
    expect(theme.stats.cranes).toBeGreaterThan(2);
    expect(theme.stats.anchoredShips).toBeGreaterThan(0);
    expect(theme.stats.drawBatches).toBeLessThanOrEqual(5);
    expectHarbourSafe(world);
    expect(JSON.stringify(level.track.route)).toBe(before);
    // Water adds no collider: the only death plane is still the world void,
    // and it is still below the route.
    expect(world.physics.getVoidDeathY()).toBeLessThan(Math.min(...level.track.route.map((n) => n.position.y)));
    const registered = OFFICIAL_MAP_REGISTRY.find((e) => e.trackId === HARBOUR)!;
    expect(computeMapIdentity(HARBOUR, level.track, level.analysis).mapFingerprint).toBe(registered.mapFingerprint);
    world.dispose();
  }, 60000);

  it('follows the song onto its SURF course, water still below everything', () => {
    const level = loadFresh(HARBOUR);
    const surf = TrackGenerator.generate(level.analysis, 'SURF');
    const world = new World(new THREE.Scene());
    world.loadTrack(level.analysis, surf, undefined, null, HARBOUR);
    expect(world.environmentTheme?.id).toBe('MIDNIGHT_HARBOUR');
    expectHarbourSafe(world);
    world.dispose();
  }, 60000);

  it('switches cleanly with the other maps', () => {
    const level = loadFresh(HARBOUR);
    const scene = new THREE.Scene();
    const world = new World(scene);
    const count = (): number => {
      let n = 0;
      scene.traverse(() => n++);
      return n;
    };
    world.loadTrack(level.analysis, level.track, undefined, HARBOUR);
    const harbourObjects = count();
    for (const key of ['CITY', 'MIDNIGHT_MOUNTAINS', 'ORBITAL_STATION', 'MIDNIGHT_HARBOUR']) {
      world.loadTrack(level.analysis, level.track, undefined, HARBOUR, key);
      expect(world.worldSafetyReport?.finalUnsafe, key).toBe(0);
    }
    expect(count()).toBe(harbourObjects);
    expect(scene.getObjectByName('HarbourWater')).toBeDefined();
    world.loadTrack(level.analysis, level.track, undefined, HARBOUR, 'CITY');
    expect(scene.getObjectByName('HarbourWater')).toBeUndefined();
    expect(scene.getObjectByName('MidnightHarbour')).toBeUndefined();
    expect(world.sky.mesh.visible).toBe(true);
    world.dispose();
  }, 120000);
});

describe('Route variety guard', () => {
  it('leaves no long plain stretch on any official route', () => {
    const rows: string[] = [];
    for (const track of SignalPackCatalog.getTracks()) {
      const route = loadFresh(track.id).track.route;
      let longest = 0;
      let start = -1;
      for (const node of route) {
        // The first 25 s is the deliberate wide onboarding runway.
        if (node.time < 25) {
          start = -1;
          continue;
        }
        const plain = !node.isSurf && !node.isBoost && (node.type === 'RUNWAY' || node.type === 'STEP_UP');
        if (plain) {
          if (start < 0) start = node.arcLength;
          longest = Math.max(longest, node.arcLength - start);
        } else if (node.type !== 'CHECKPOINT') start = -1;
      }
      rows.push(`${track.id}: ${Math.round(longest)} m`);
      // Before the guard these ran up to 1,578 m.
      expect(longest, track.id).toBeLessThan(450);
    }
    console.log('[VARIETY GUARD] longest plain stretch\n  ' + rows.join('\n  '));
  }, 120000);
});
