/**
 * ORBITAL STATION environment theme — wiring and safety contracts.
 *
 *   1. Assignment: exactly the chosen official song; Midnight Mountains keeps
 *      its own song and every other source keeps the city.
 *   2. Progression: the song's plateau structure is read as opening, build,
 *      peak, a breakdown inside the plateau, peak again, finale.
 *   3. World safety: every surviving station instance, measured as final
 *      world-space bounds, is outside the RouteExclusionCorridor for both the
 *      NORMAL and the SURF course; the final safety pass removes none of it.
 *   4. Nothing is ever placed beneath the route.
 *   5. Identity: visual only; map fingerprints and surf board ids unchanged.
 *   6. Lifecycle: switching between the station, the mountains and the city
 *      repeatedly neither leaks nor leaves state behind.
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
import { computeSurfMapIdentity } from '../src/online/SurfMapIdentity';
import { OFFICIAL_MAP_REGISTRY } from '../src/online/OfficialMapRegistry';
import { OFFICIAL_SURF_MAP_REGISTRY } from '../src/online/OfficialSurfMapRegistry';
import { World } from '../src/world/World';
import { resolveEnvironmentTheme, themedTrackIds } from '../src/world/themes/EnvironmentThemeRegistry';
import { EnvironmentThemeLighting } from '../src/world/themes/EnvironmentTheme';
import { deriveProgression } from '../src/world/themes/ThemeProgression';
import { OrbitalStationInstance } from '../src/world/themes/orbital/OrbitalStationTheme';

const PRESET_DIR = path.resolve(__dirname, '../public/music/presets');
const STATION = 'track_3_surf_the_void';
const MOUNTAINS = 'track_5_gravity_line';
const CITY = 'track_8_wave_surfing';

function loadFresh(trackId: string) {
  const raw = fs.readFileSync(path.join(PRESET_DIR, `${trackId}.json`), 'utf8');
  return PresetLevelCache.buildLevelData(JSON.parse(raw) as Record<string, unknown>);
}

/** Final world-space bounds of every surviving scenery instance. */
function instanceBoxes(world: World): THREE.Box3[] {
  const theme = world.environmentTheme!;
  theme.group.updateWorldMatrix(true, true);
  const boxes: THREE.Box3[] = [];
  const matrix = new THREE.Matrix4();
  theme.group.traverse((object) => {
    const mesh = object as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      const box = new THREE.Box3().copy(mesh.geometry.boundingBox!).applyMatrix4(matrix).applyMatrix4(mesh.matrixWorld);
      if (box.max.y < -50000) continue;
      boxes.push(box);
    }
  });
  return boxes;
}

function expectStationSafe(world: World): void {
  const corridor = world.corridor!;
  const boxes = instanceBoxes(world);
  expect(boxes.length).toBeGreaterThan(80);
  expect(boxes.filter((box) => corridor.evaluateVolume(box) !== null).length).toBe(0);
  expect(world.worldSafetyReport?.finalUnsafe).toBe(0);
  expect(world.worldSafetyReport!.violations.filter((v) => v.source.startsWith('EnvironmentTheme'))).toEqual([]);

  // Nothing beneath the route: no instance whose footprint covers a route node
  // may sit below that node. (Pieces overhead are allowed; the corridor has
  // already proven they are high enough.)
  let beneath = 0;
  for (const node of world.track!.route) {
    for (const box of boxes) {
      const over =
        node.position.x > box.min.x && node.position.x < box.max.x &&
        node.position.z > box.min.z && node.position.z < box.max.z;
      if (over && box.max.y < node.position.y) beneath++;
    }
  }
  expect(beneath).toBe(0);
}

describe('Orbital Station — assignment', () => {
  it('is assigned to the chosen song and leaves the others alone', () => {
    expect(resolveEnvironmentTheme(STATION)?.id).toBe('ORBITAL_STATION');
    expect(resolveEnvironmentTheme(MOUNTAINS)?.id).toBe('MIDNIGHT_MOUNTAINS');
    expect(themedTrackIds()).toEqual(expect.arrayContaining([STATION, MOUNTAINS]));
    for (const track of SignalPackCatalog.getTracks()) {
      if (themedTrackIds().includes(track.id)) continue;
      expect(resolveEnvironmentTheme(track.id), track.id).toBeNull();
    }
    expect(resolveEnvironmentTheme(null)).toBeNull();
    expect(resolveEnvironmentTheme('surf the void.ogg')).toBeNull();
  });
});

describe('Orbital Station — musical progression', () => {
  it('reads the plateau song as peak, a breakdown inside it, and peak again', () => {
    const level = loadFresh(STATION);
    const spans = deriveProgression(level.analysis, level.track);
    expect(spans.map((s) => s.role)).toEqual(['OPENING', 'BUILD', 'PEAK', 'PEAK', 'BREAKDOWN', 'PEAK', 'FINALE']);
    // The reveal is where the music first arrives: the largest jump in energy.
    const sections = level.analysis.sections;
    let jump = 1;
    for (let i = 2; i < sections.length; i++) {
      if (sections[i].intensity - sections[i - 1].intensity > sections[jump].intensity - sections[jump - 1].intensity) jump = i;
    }
    expect(spans.find((s) => s.role === 'PEAK')!.sectionIndex).toBe(jump);
  });

  it('still reads Gravity Line as a five-part arc', () => {
    const level = loadFresh(MOUNTAINS);
    expect(deriveProgression(level.analysis, level.track).map((s) => s.role)).toEqual([
      'OPENING', 'BUILD', 'PEAK', 'BREAKDOWN', 'FINALE'
    ]);
  });
});

describe('Orbital Station — world integration', () => {
  it('builds the station for the NORMAL course and keeps the corridor clear', () => {
    const level = loadFresh(STATION);
    const before = JSON.stringify(level.track.route);
    const world = new World(new THREE.Scene());
    world.loadTrack(level.analysis, level.track, undefined, STATION);

    const theme = world.environmentTheme as OrbitalStationInstance;
    expect(theme?.id).toBe('ORBITAL_STATION');
    expect(world.skyline).toBeNull();
    expect(world.sky.mesh.visible).toBe(false);
    expect(world.worldProfile.trackId).toBe(STATION);

    expect(theme.stats.hasPassage).toBe(true);
    expect(theme.stats.hasCommsArray).toBe(true);
    expect(theme.stats.gantries).toBeGreaterThan(5);
    expect(theme.stats.solarPanels).toBeGreaterThan(8);
    expect(theme.stats.navLights).toBeGreaterThan(20);
    expect(theme.stats.navLights).toBeLessThan(140);
    expect(theme.stats.drawBatches).toBeLessThanOrEqual(6);

    expectStationSafe(world);
    expect(JSON.stringify(level.track.route)).toBe(before);

    const duration = level.analysis.duration;
    for (const t of [0.02, 0.2, 0.3, 0.6, 0.98]) {
      const node = level.track.route[Math.floor((level.track.route.length - 1) * t)];
      const pos = new THREE.Vector3(node.position.x, node.position.y + 2, node.position.z);
      for (let f = 0; f < 30; f++) world.update(duration * t + f / 60, pos, 0, 1 / 60, undefined);
      for (const key of ['uStation', 'uKick', 'uHat', 'uAccent'] as const) {
        const value = theme.uniforms[key].value as number;
        expect(Number.isFinite(value), key).toBe(true);
        expect(value, key).toBeGreaterThanOrEqual(0);
        expect(value, key).toBeLessThanOrEqual(1);
      }
    }
    // The planet is fixed in the sky: travelling the course never moves it.
    const planet = theme.uniforms.uPlanetDir.value.clone();
    world.update(duration * 0.5, new THREE.Vector3(500, -20, 1500), 0, 1 / 60, undefined);
    expect(theme.uniforms.uPlanetDir.value.equals(planet)).toBe(true);
    expect(planet.y).toBeLessThan(-0.5);
    world.dispose();
  }, 60000);

  it('follows the song onto its SURF course with the same guarantees', () => {
    const level = loadFresh(STATION);
    const surf = TrackGenerator.generate(level.analysis, 'SURF');
    const world = new World(new THREE.Scene());
    world.loadTrack(level.analysis, surf, undefined, null, STATION);
    const theme = world.environmentTheme as OrbitalStationInstance;
    expect(theme?.id).toBe('ORBITAL_STATION');
    expect(theme.stats.hasCommsArray).toBe(true);
    expect(theme.stats.gantries).toBeGreaterThan(3);
    expectStationSafe(world);
    world.dispose();
  }, 60000);

  it('does not change competitive map identity', () => {
    const level = loadFresh(STATION);
    const registered = OFFICIAL_MAP_REGISTRY.find((e) => e.trackId === STATION)!;
    const world = new World(new THREE.Scene());
    world.loadTrack(level.analysis, level.track, undefined, STATION);
    expect(computeMapIdentity(STATION, level.track, level.analysis).mapFingerprint).toBe(registered.mapFingerprint);
    const surf = TrackGenerator.generate(level.analysis, 'SURF');
    const surfId = computeSurfMapIdentity(STATION, surf, level.analysis).trackId;
    world.loadTrack(level.analysis, surf, undefined, null, STATION);
    expect(computeSurfMapIdentity(STATION, surf, level.analysis).trackId).toBe(surfId);
    expect(OFFICIAL_SURF_MAP_REGISTRY.some((e) => e.trackId === surfId)).toBe(true);
    world.dispose();
  }, 60000);
});

describe('Orbital Station — lifecycle', () => {
  it('switches between station, mountains and city without leaking', () => {
    const levels = { station: loadFresh(STATION), mountains: loadFresh(MOUNTAINS), city: loadFresh(CITY) };
    const scene = new THREE.Scene();
    const world = new World(scene);
    const lighting: Array<EnvironmentThemeLighting | null> = [];
    const environment = {
      activePreset: undefined,
      decorationLodDistance: 0,
      effectProfile: { emissiveScale: 1 },
      setPalette: () => undefined,
      clearWorldProfile: () => undefined,
      applyWorldProfile: () => undefined,
      updateAtmosphere: () => undefined,
      setThemeLighting: (value: EnvironmentThemeLighting | null) => lighting.push(value)
    } as unknown as Parameters<World['loadTrack']>[2];
    const count = (): number => {
      let n = 0;
      scene.traverse(() => n++);
      return n;
    };
    const themeRoots = (): string[] => {
      const names: string[] = [];
      scene.traverse((o) => {
        if (/^(OrbitalStation|MidnightMountains)/.test(o.name) && o.parent === scene) names.push(o.name);
      });
      return names.sort();
    };

    const baseline: Record<string, number> = {};
    const load = (key: 'station' | 'mountains' | 'city', id: string): void => {
      world.loadTrack(levels[key].analysis, levels[key].track, environment, id);
      if (baseline[key] === undefined) baseline[key] = count();
      expect(count(), key).toBe(baseline[key]);
    };

    for (let cycle = 0; cycle < 3; cycle++) {
      load('station', STATION);
      const station = world.environmentTheme as OrbitalStationInstance;
      expect(themeRoots()).toEqual(['OrbitalStation', 'OrbitalStationSky']);
      expect(lighting[lighting.length - 1]).toBe(station.lighting);
      let disposed = 0;
      station.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.addEventListener('dispose', () => disposed++);
      });

      load('mountains', MOUNTAINS);
      expect(disposed).toBeGreaterThan(0);
      expect(station.group.children.length).toBe(0);
      expect(themeRoots()).toEqual(['MidnightMountains', 'MidnightMountainsSky']);
      expect(world.environmentTheme?.id).toBe('MIDNIGHT_MOUNTAINS');

      load('city', CITY);
      expect(themeRoots()).toEqual([]);
      expect(world.environmentTheme).toBeNull();
      expect(world.sky.mesh.visible).toBe(true);
      expect(world.skyline).not.toBeNull();
      expect(lighting[lighting.length - 1]).toBeNull();
    }
    world.dispose();
  }, 180000);
});
