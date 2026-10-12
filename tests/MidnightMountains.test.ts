/**
 * MIDNIGHT MOUNTAINS environment theme — wiring and safety contracts.
 *
 *   1. Assignment: exactly the chosen official song; everything else (other
 *      songs, custom audio, tutorial, lab) keeps the default city.
 *   2. Progression: the song's analysed sections map onto the route as a
 *      monotonic OPENING -> BUILD -> PEAK -> BREAKDOWN -> FINALE journey that
 *      crossfades instead of cutting.
 *   3. Reactivity: every layer is clamped and rate-limited (no strobe).
 *   4. World safety: every surviving scenery instance, measured as final
 *      world-space bounds, is outside the RouteExclusionCorridor for both the
 *      NORMAL and the SURF course, and the final safety pass removes none.
 *   5. Identity: the theme is visual only; map fingerprints are unchanged.
 *   6. Lifecycle: switching songs repeatedly neither leaks nor leaves theme
 *      state behind in the city.
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
import { RouteFrame, deriveProgression, sampleProgression } from '../src/world/themes/ThemeProgression';
import { ThemeReactivity } from '../src/world/themes/ThemeReactivity';
import { MidnightMountainsInstance } from '../src/world/themes/midnight/MidnightMountainsTheme';

const PRESET_DIR = path.resolve(__dirname, '../public/music/presets');
const THEMED = 'track_5_gravity_line';
const CITY = 'track_8_wave_surfing';

function loadFresh(trackId: string) {
  const raw = fs.readFileSync(path.join(PRESET_DIR, `${trackId}.json`), 'utf8');
  return PresetLevelCache.buildLevelData(JSON.parse(raw) as Record<string, unknown>);
}

/** Counts scenery instances and how many of them sit inside the corridor. */
function auditTheme(world: World): { instances: number; inside: number } {
  const theme = world.environmentTheme!;
  const corridor = world.corridor!;
  theme.group.updateWorldMatrix(true, true);
  let instances = 0;
  let inside = 0;
  const matrix = new THREE.Matrix4();
  const box = new THREE.Box3();
  theme.group.traverse((object) => {
    const mesh = object as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      box.copy(mesh.geometry.boundingBox!).applyMatrix4(matrix).applyMatrix4(mesh.matrixWorld);
      if (box.max.y < -50000) continue;
      instances++;
      if (corridor.evaluateVolume(box)) inside++;
    }
  });
  return { instances, inside };
}

function channels(overrides: Partial<Record<string, number>> = {}) {
  return {
    bassMass: 0,
    transient: 0,
    sectionEnergy: 0,
    midFlow: 0,
    highGlint: 0,
    slot: 0,
    ...overrides
  };
}

describe('Midnight Mountains — assignment', () => {
  it('is assigned to the chosen official song', () => {
    expect(themedTrackIds()).toContain(THEMED);
    expect(resolveEnvironmentTheme(THEMED)?.id).toBe('MIDNIGHT_MOUNTAINS');
    expect(SignalPackCatalog.getTrackById(THEMED)?.id).toBe(THEMED);
  });

  it('leaves unassigned official songs, and all untrusted sources, on the city', () => {
    for (const track of SignalPackCatalog.getTracks()) {
      if (themedTrackIds().includes(track.id)) {
        // Only the chosen song is Midnight Mountains.
        expect(resolveEnvironmentTheme(track.id)?.id === 'MIDNIGHT_MOUNTAINS', track.id).toBe(track.id === THEMED);
        continue;
      }
      expect(resolveEnvironmentTheme(track.id), track.id).toBeNull();
    }
    expect(resolveEnvironmentTheme(null)).toBeNull();
    expect(resolveEnvironmentTheme(undefined)).toBeNull();
    expect(resolveEnvironmentTheme('')).toBeNull();
    expect(resolveEnvironmentTheme('gravity line.mp3')).toBeNull();
    expect(resolveEnvironmentTheme('toString')).toBeNull();
  });
});

describe('Midnight Mountains — musical progression', () => {
  const level = loadFresh(THEMED);

  it('reads the song as opening, build, peak, breakdown, finale', () => {
    const spans = deriveProgression(level.analysis, level.track);
    expect(spans.map((s) => s.role)).toEqual(['OPENING', 'BUILD', 'PEAK', 'BREAKDOWN', 'FINALE']);
    expect(spans[0].start).toBe(0);
    expect(spans[spans.length - 1].end).toBe(1);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].start).toBe(spans[i - 1].end);
      expect(spans[i].end).toBeGreaterThan(spans[i].start);
    }
    // The peak is the song's most intense inner section.
    const peak = spans.find((s) => s.role === 'PEAK')!;
    const inner = level.analysis.sections.slice(1, -1);
    const strongest = inner.reduce((a, b) => (b.intensity > a.intensity ? b : a));
    expect(peak.sectionIndex).toBe(strongest.index);
  });

  it('lays the same arc over the SURF course of the song', () => {
    const surf = TrackGenerator.generate(level.analysis, 'SURF');
    const spans = deriveProgression(level.analysis, surf);
    expect(spans.map((s) => s.role)).toEqual(['OPENING', 'BUILD', 'PEAK', 'BREAKDOWN', 'FINALE']);
    for (const span of spans) expect(span.end).toBeGreaterThan(span.start);
  });

  it('crossfades between sections instead of cutting', () => {
    const spans = deriveProgression(level.analysis, level.track);
    const values = { OPENING: 0, BUILD: 0.5, PEAK: 1, BREAKDOWN: 0.2, FINALE: 0.8 };
    let previous = sampleProgression(spans, values, 0);
    let largestStep = 0;
    for (let i = 1; i <= 2000; i++) {
      const value = sampleProgression(spans, values, i / 2000);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      largestStep = Math.max(largestStep, Math.abs(value - previous));
      previous = value;
    }
    // 1/2000 of the route is roughly a metre: no value may jump across it.
    expect(largestStep).toBeLessThan(0.02);
  });

  it('samples a stable route frame, including beyond both ends', () => {
    const frame = new RouteFrame(level.track.route, level.track.totalDistance);
    for (const u of [-0.3, 0, 0.25, 0.5, 0.99, 1, 1.4]) {
      const s = frame.sample(u);
      expect(Number.isFinite(s.position.x + s.position.y + s.position.z)).toBe(true);
      expect(s.forward.length()).toBeCloseTo(1, 5);
      expect(s.right.length()).toBeCloseTo(1, 5);
      expect(Math.abs(s.forward.dot(s.right))).toBeLessThan(1e-6);
    }
    expect(frame.fractionAtTime(0)).toBeLessThan(0.05);
    expect(frame.fractionAtTime(level.analysis.duration + 10)).toBe(1);
  });
});

describe('Midnight Mountains — restrained reactivity', () => {
  it('clamps every layer and never rises faster than its attack allows', () => {
    const r = new ThemeReactivity();
    let maxKickStep = 0;
    let maxSustainStep = 0;
    let previousKick = 0;
    let previousSustain = 0;
    // Hostile input: full-scale square wave on everything, at 60 Hz.
    for (let frame = 0; frame < 1200; frame++) {
      const on = frame % 2 === 0 ? 5 : -5;
      r.update(
        { channels: channels({ bassMass: on, transient: on, sectionEnergy: on, midFlow: on, highGlint: on, slot: frame }), energy: on },
        1 / 60
      );
      for (const v of [r.kick, r.accent, r.sustain, r.mid, r.high]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      maxKickStep = Math.max(maxKickStep, Math.abs(r.kick - previousKick));
      maxSustainStep = Math.max(maxSustainStep, Math.abs(r.sustain - previousSustain));
      previousKick = r.kick;
      previousSustain = r.sustain;
    }
    // A lamp cannot go from dark to full in a frame; the aurora barely moves.
    expect(maxKickStep).toBeLessThan(0.25);
    expect(maxSustainStep).toBeLessThan(0.02);
  });

  it('ignores a sustained bassline and answers a hit, then decays smoothly', () => {
    const r = new ThemeReactivity();
    for (let i = 0; i < 600; i++) r.update({ channels: channels({ bassMass: 0.5 }), energy: 0.3 }, 1 / 60);
    expect(r.kick).toBeLessThan(0.05);
    for (let i = 0; i < 6; i++) r.update({ channels: channels({ bassMass: 0.95 }), energy: 0.3 }, 1 / 60);
    const struck = r.kick;
    expect(struck).toBeGreaterThan(0.3);
    let previous = struck;
    for (let i = 0; i < 120; i++) {
      r.update({ channels: channels({ bassMass: 0.5 }), energy: 0.3 }, 1 / 60);
      expect(r.kick).toBeLessThanOrEqual(previous + 1e-6);
      previous = r.kick;
    }
    expect(r.kick).toBeLessThan(0.05);
  });

  it('keeps percussion accents occasional', () => {
    const r = new ThemeReactivity();
    let accents = 0;
    let rising = false;
    let previous = 0;
    // Ten seconds of a strong transient on every single frame.
    for (let frame = 0; frame < 600; frame++) {
      r.update({ channels: channels({ transient: 1, slot: frame }), energy: 0.5 }, 1 / 60);
      const nowRising = r.accent > previous + 1e-4;
      if (nowRising && !rising) accents++;
      rising = nowRising;
      previous = r.accent;
    }
    expect(accents).toBeGreaterThan(3);
    expect(accents).toBeLessThanOrEqual(12);
  });

  it('lets hi-hats glint a different star subset per hit without stacking', () => {
    const r = new ThemeReactivity();
    const idle = { channels: channels(), energy: 0 };
    r.strikeHat(1);
    expect(r.hat).toBeLessThanOrEqual(1);
    expect(r.hat).toBeGreaterThan(0.9);
    const firstSlot = r.hatSlot;
    // A second hit inside the minimum interval is dropped, not stacked.
    r.update(idle, 1 / 60);
    r.strikeHat(1);
    expect(r.hatSlot).toBe(firstSlot);
    // The glint is short: gone within half a second.
    for (let i = 0; i < 30; i++) r.update(idle, 1 / 60);
    expect(r.hat).toBeLessThan(0.08);
    r.strikeHat(0.2);
    expect(r.hatSlot).toBe(firstSlot + 1);
    expect(r.hat).toBeLessThan(0.6);
    // Sixteenth-note hats at 60 Hz never exceed full scale.
    for (let frame = 0; frame < 600; frame++) {
      if (frame % 6 === 0) r.strikeHat(1);
      r.update(idle, 1 / 60);
      expect(r.hat).toBeGreaterThanOrEqual(0);
      expect(r.hat).toBeLessThanOrEqual(1);
    }
  });

  it('follows sub-bass as a slow swell', () => {
    const r = new ThemeReactivity();
    let previous = 0;
    let largestStep = 0;
    for (let frame = 0; frame < 600; frame++) {
      r.update({ channels: channels(), energy: 0, subBass: frame % 2 === 0 ? 4 : -4 }, 1 / 60);
      expect(r.sub).toBeGreaterThanOrEqual(0);
      expect(r.sub).toBeLessThanOrEqual(1);
      largestStep = Math.max(largestStep, Math.abs(r.sub - previous));
      previous = r.sub;
    }
    expect(largestStep).toBeLessThan(0.13);
  });

  it('holds the reactive layers still under reduce-motion', () => {
    const r = new ThemeReactivity();
    for (let frame = 0; frame < 300; frame++) {
      r.update({ channels: channels({ bassMass: frame % 20 < 3 ? 1 : 0.2, transient: 1, slot: frame }), energy: 0.8 }, 1 / 60, true);
      expect(r.kick).toBeLessThan(1e-6);
      expect(r.accent).toBeLessThan(1e-6);
    }
  });
});

describe('Midnight Mountains — world integration', () => {
  it('replaces the city for the NORMAL course and keeps the corridor clear', () => {
    const level = loadFresh(THEMED);
    const before = JSON.stringify(level.track.route);
    const world = new World(new THREE.Scene());
    world.loadTrack(level.analysis, level.track, undefined, THEMED);

    const theme = world.environmentTheme as MidnightMountainsInstance;
    expect(theme?.id).toBe('MIDNIGHT_MOUNTAINS');
    expect(world.skyline).toBeNull();
    expect(world.megastructure).toBeNull();
    expect(world.sky.mesh.visible).toBe(false);
    // The official profile is still resolved: only the scenery changed.
    expect(world.worldProfile.trackId).toBe(THEMED);

    expect(theme.stats.hasObservatory).toBe(true);
    expect(theme.stats.lamps).toBeGreaterThan(8);
    expect(theme.stats.lamps).toBeLessThan(40);
    expect(theme.stats.cabins).toBeGreaterThan(2);
    expect(theme.stats.drawBatches).toBeLessThanOrEqual(8);

    const audit = auditTheme(world);
    expect(audit.instances).toBeGreaterThan(100);
    expect(audit.inside).toBe(0);
    expect(world.worldSafetyReport?.finalUnsafe).toBe(0);
    const themeViolations = world.worldSafetyReport!.violations.filter((v) => v.source.startsWith('EnvironmentTheme'));
    expect(themeViolations).toEqual([]);

    // Scenery never touched the route.
    expect(JSON.stringify(level.track.route)).toBe(before);

    const duration = level.analysis.duration;
    for (const t of [0.02, 0.3, 0.5, 0.7, 0.98]) {
      const node = level.track.route[Math.floor((level.track.route.length - 1) * t)];
      const pos = new THREE.Vector3(node.position.x, node.position.y + 2, node.position.z);
      for (let f = 0; f < 30; f++) world.update(duration * t + f / 60, pos, 0, 1 / 60, undefined);
      for (const key of ['uAuroraGain', 'uAuroraLevel', 'uKick', 'uAccent', 'uLampLevel', 'uMist', 'uHat', 'uSub'] as const) {
        const value = theme.uniforms[key].value as number;
        expect(Number.isFinite(value), key).toBe(true);
        expect(value, key).toBeGreaterThanOrEqual(0);
        expect(value, key).toBeLessThanOrEqual(1.25);
      }
    }
    world.dispose();
  }, 60000);

  it('follows the song onto its SURF course with the same guarantees', () => {
    const level = loadFresh(THEMED);
    const surf = TrackGenerator.generate(level.analysis, 'SURF');
    const world = new World(new THREE.Scene());
    // Exactly how Game loads a surf run: null official id, song id for scenery.
    world.loadTrack(level.analysis, surf, undefined, null, THEMED);

    const theme = world.environmentTheme as MidnightMountainsInstance;
    expect(theme?.id).toBe('MIDNIGHT_MOUNTAINS');
    expect(world.worldProfile.usesOverride).toBe(false);
    expect(theme.stats.hasObservatory).toBe(true);
    expect(theme.stats.lamps).toBeGreaterThan(8);

    const audit = auditTheme(world);
    expect(audit.instances).toBeGreaterThan(100);
    expect(audit.inside).toBe(0);
    expect(world.worldSafetyReport?.finalUnsafe).toBe(0);
    expect(world.worldSafetyReport!.violations.filter((v) => v.source.startsWith('EnvironmentTheme'))).toEqual([]);
    world.dispose();
  }, 60000);

  it('is deterministic for a given course', () => {
    const level = loadFresh(THEMED);
    const build = (): number[] => {
      const world = new World(new THREE.Scene());
      world.loadTrack(level.analysis, level.track, undefined, THEMED);
      const out: number[] = [];
      world.environmentTheme!.group.traverse((o) => {
        const mesh = o as THREE.InstancedMesh;
        if (mesh.isInstancedMesh) out.push(mesh.count, ...Array.from(mesh.instanceMatrix.array.slice(0, 32)));
      });
      world.dispose();
      return out;
    };
    expect(build()).toEqual(build());
  }, 60000);

  it('does not change competitive map identity', () => {
    const level = loadFresh(THEMED);
    const normal = computeMapIdentity(THEMED, level.track, level.analysis);
    const registered = OFFICIAL_MAP_REGISTRY.find((e) => e.trackId === THEMED)!;
    expect(normal.mapFingerprint).toBe(registered.mapFingerprint);

    const world = new World(new THREE.Scene());
    world.loadTrack(level.analysis, level.track, undefined, THEMED);
    expect(computeMapIdentity(THEMED, level.track, level.analysis).mapFingerprint).toBe(registered.mapFingerprint);
    world.dispose();

    const surf = TrackGenerator.generate(level.analysis, 'SURF');
    const surfIdentity = computeSurfMapIdentity(THEMED, surf, level.analysis);
    world.loadTrack(level.analysis, surf, undefined, null, THEMED);
    expect(computeSurfMapIdentity(THEMED, surf, level.analysis).trackId).toBe(surfIdentity.trackId);
    expect(OFFICIAL_SURF_MAP_REGISTRY.some((e) => e.trackId === surfIdentity.trackId)).toBe(true);
    world.dispose();
  }, 60000);
});

describe('Midnight Mountains — lifecycle', () => {
  it('switches to and from the city repeatedly without leaking or leaving state behind', () => {
    const themed = loadFresh(THEMED);
    const city = loadFresh(CITY);
    const scene = new THREE.Scene();
    const world = new World(scene);

    // Minimal stand-in for the Environment's lighting hook.
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

    const countObjects = (): number => {
      let n = 0;
      scene.traverse(() => n++);
      return n;
    };

    world.loadTrack(city.analysis, city.track, environment, CITY);
    const cityObjects = countObjects();
    world.loadTrack(themed.analysis, themed.track, environment, THEMED);
    const themedObjects = countObjects();

    const disposed: string[] = [];
    for (let cycle = 0; cycle < 4; cycle++) {
      world.loadTrack(city.analysis, city.track, environment, CITY);
      expect(world.environmentTheme).toBeNull();
      expect(world.sky.mesh.visible).toBe(true);
      expect(world.skyline).not.toBeNull();
      expect(lighting[lighting.length - 1]).toBeNull();
      expect(countObjects()).toBe(cityObjects);
      expect(scene.getObjectByName('MidnightMountains')).toBeUndefined();
      expect(scene.getObjectByName('MidnightMountainsSky')).toBeUndefined();

      world.loadTrack(themed.analysis, themed.track, environment, THEMED);
      const theme = world.environmentTheme as MidnightMountainsInstance;
      expect(lighting[lighting.length - 1]).toBe(theme.lighting);
      expect(countObjects()).toBe(themedObjects);
      // Exactly one copy of each theme root is ever in the scene.
      let roots = 0;
      scene.traverse((o) => {
        if (o.name === 'MidnightMountains' || o.name === 'MidnightMountainsSky') roots++;
      });
      expect(roots).toBe(2);

      // Every GPU resource the theme owns is released when it is replaced.
      theme.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.addEventListener('dispose', () => disposed.push('geometry'));
        (mesh.material as THREE.Material).addEventListener('dispose', () => disposed.push('material'));
      });
      const before = disposed.length;
      world.loadTrack(city.analysis, city.track, environment, CITY);
      expect(disposed.length).toBeGreaterThan(before);
      expect(theme.group.children.length).toBe(0);
      expect(theme.skyGroup.children.length).toBe(0);
    }

    world.dispose();
    expect(world.environmentTheme).toBeNull();
    expect(world.sky.mesh.visible).toBe(true);
  }, 120000);
});
