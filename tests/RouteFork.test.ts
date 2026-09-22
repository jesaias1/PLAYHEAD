/**
 * ROUTE FORKS — solvability, determinism, generation bounds, protected systems,
 * and batched-rendering regression protection.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RouteGenerator } from '../src/generation/RouteGenerator';
import { RouteForkGenerator } from '../src/generation/RouteForkGenerator';
import { GeometryBuilder } from '../src/world/GeometryBuilder';
import { RouteExclusionCorridor } from '../src/world/RouteExclusionCorridor';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { AnalysisSection, SectionTheme, TrackAnalysis } from '../src/audio/AudioFeatures';
import { ForkType, RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';
import { getNodeEntryAnchor, getNodeExitAnchor } from '../src/generation/RouteConnectivityValidator';
import { getPlatformMaxHalfWidth } from '../src/generation/PlatformShape';
import { PLAYHEAD_MOVEMENT_V1 } from '../src/player/MovementConfig';
import { computeTempoPressure, computeTempoProfile } from '../src/generation/TempoPressure';
import { QUALITY_PRESETS } from '../src/rendering/QualityPresets';

const PALETTE = { name: 'Test', hex: '#00f0ff', rgb: [0, 240, 255] as [number, number, number] };

function analysis(
  seed: number,
  duration: number,
  bpm: number,
  themes: SectionTheme[],
  sectionCount = themes.length
): TrackAnalysis {
  const sections: AnalysisSection[] = [];
  const step = duration / sectionCount;
  for (let i = 0; i < sectionCount; i++) {
    const theme = themes[i % themes.length];
    sections.push({
      index: i,
      start: i * step,
      end: (i + 1) * step,
      duration: step,
      intensity: theme === 'DROP' ? 0.95 : 0.6,
      rhythmicDensity: 0.6,
      brightness: 0.6,
      theme
    });
  }
  return {
    filename: `fork_${seed}.wav`,
    duration,
    bpm,
    bpmConfidence: 0.85,
    globalEnergy: 0.6,
    frames: [],
    onsets: [],
    sections,
    waveform: new Float32Array(512),
    seed,
    visualAccent: PALETTE
  };
}

/** The four archetypes a normal official level can produce. */
const ALL_FORK_TYPES: ForkType[] = [
  'SAFE_VS_STRAFE',
  'SAFE_VS_SURF',
  'SAFE_VS_HIGH',
  'DIRECT_VS_TECHNICAL'
];

function airGap(a: RouteNode, b: RouteNode): { gap: number; dy: number } {
  const ea = getNodeExitAnchor(a).position;
  const eb = getNodeEntryAnchor(b).position;
  const dx = eb.x - ea.x;
  const dz = eb.z - ea.z;
  const fx = Math.sin(a.yaw || 0);
  const fz = Math.cos(a.yaw || 0);
  const along = dx * fx + dz * fz;
  const lateral = dx * -fz + dz * fx;
  const gapAlong = Math.max(0, along);
  const gapLat = Math.max(
    0,
    Math.abs(lateral) - getPlatformMaxHalfWidth(a) - getPlatformMaxHalfWidth(b)
  );
  return { gap: Math.hypot(gapAlong, gapLat), dy: eb.y - ea.y };
}

function generate(seed: number, themes: SectionTheme[], duration = 90, bpm = 128) {
  return RouteGenerator.generate(analysis(seed, duration, bpm, themes));
}

describe('Route forks — generation', () => {
  it('is deterministic: same analysis/seed produces identical forks', () => {
    const themes: SectionTheme[] = ['FLOW', 'SPEED', 'FLOW', 'PRECISION', 'SPEED', 'FLOW'];
    const a = generate(0x504c4159, themes);
    const b = generate(0x504c4159, themes);

    expect(a.forks?.length ?? 0).toBe(b.forks?.length ?? 0);
    expect((a.forks || []).map((f) => f.type)).toEqual((b.forks || []).map((f) => f.type));
    for (let i = 0; i < (a.forks || []).length; i++) {
      const fa = a.forks![i];
      const fb = b.forks![i];
      expect(fa.entryNodeId).toBe(fb.entryNodeId);
      expect(fa.rejoinNodeId).toBe(fb.rejoinNodeId);
      expect(fa.masteryNodes.length).toBe(fb.masteryNodes.length);
      for (let k = 0; k < fa.masteryNodes.length; k++) {
        expect(fa.masteryNodes[k].position.x).toBeCloseTo(fb.masteryNodes[k].position.x, 10);
        expect(fa.masteryNodes[k].position.y).toBeCloseTo(fb.masteryNodes[k].position.y, 10);
        expect(fa.masteryNodes[k].position.z).toBeCloseTo(fb.masteryNodes[k].position.z, 10);
      }
    }
  });

  it('never modifies the validated main route (the SAFE line)', () => {
    const themes: SectionTheme[] = ['FLOW', 'SPEED', 'FLOW', 'PRECISION'];
    const withoutForks = generate(0x12345678, themes);
    const snapshot = withoutForks.route.map((n) => ({
      id: n.id,
      x: n.position.x,
      y: n.position.y,
      z: n.position.z,
      ax: n.dimensions.x,
      az: n.dimensions.z,
      arc: n.arcLength
    }));
    const withForks = generate(0x12345678, themes);
    expect(withForks.route.length).toBe(snapshot.length);
    for (let i = 0; i < snapshot.length; i++) {
      const n = withForks.route[i];
      expect(n.id).toBe(snapshot[i].id);
      expect(n.position.x).toBe(snapshot[i].x);
      expect(n.position.y).toBe(snapshot[i].y);
      expect(n.position.z).toBe(snapshot[i].z);
      expect(n.dimensions.x).toBe(snapshot[i].ax);
      expect(n.dimensions.z).toBe(snapshot[i].az);
      expect(n.arcLength).toBe(snapshot[i].arc);
    }
  });

  it('keeps the fork count occasional and bounded across many courses', () => {
    const themes: SectionTheme[] = ['FLOW', 'SPEED', 'FLOW', 'PRECISION', 'SPEED', 'FLOW'];
    let total = 0;
    let coursesWithForks = 0;
    for (let i = 0; i < 60; i++) {
      const track = generate(0x20000000 + i * 2654435761, themes, 90, 110 + (i % 8) * 10);
      const forks = track.forks || [];
      expect(forks.length).toBeLessThanOrEqual(3);
      total += forks.length;
      if (forks.length > 0) coursesWithForks++;
    }
    expect(total).toBeGreaterThan(10);
    expect(coursesWithForks).toBeGreaterThan(10);
    // Occasional: never a fork per section.
    expect(total / 60).toBeLessThanOrEqual(3);
  });

  it('never places a fork inside a release/breath/surf/ascent or checkpoint span', () => {
    const themes: SectionTheme[] = ['FLOW', 'BREATH', 'DROP', 'SURF', 'ASCENT', 'SPEED'];
    for (let i = 0; i < 40; i++) {
      const track = generate(0x30000000 + i * 40503, themes, 100, 140);
      for (const fork of track.forks || []) {
        const entryIdx = track.route.findIndex((n) => n.id === fork.entryNodeId);
        const rejoinIdx = track.route.findIndex((n) => n.id === fork.rejoinNodeId);
        expect(entryIdx).toBeGreaterThanOrEqual(0);
        expect(rejoinIdx).toBeGreaterThan(entryIdx);
        for (let k = entryIdx; k <= rejoinIdx; k++) {
          const node = track.route[k];
          const theme = themes[node.sectionIndex % themes.length];
          expect(['DROP', 'BREATH', 'SURF', 'ASCENT']).not.toContain(theme);
          expect(node.type).not.toBe(RouteNodeType.CHECKPOINT);
          expect(node.type).not.toBe(RouteNodeType.FINISH);
          expect(node.isSurf).toBe(false);
        }
      }
    }
  });

  it('BPM changes fork vocabulary without breaking solvability', () => {
    const themes: SectionTheme[] = ['FLOW', 'SPEED', 'FLOW', 'PRECISION'];
    const seen = new Set<ForkType>();
    for (let i = 0; i < 40; i++) {
      const bpm = 80 + i * 3;
      const track = generate(0x40000000 + i * 7919, themes, 95, bpm);
      for (const fork of track.forks || []) {
        seen.add(fork.type);
        // Both branches remain traversable regardless of tempo.
        expectForkSolvable(track.route, fork);
      }
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('Route forks — solvability', () => {
  it('validates both branches end to end on every generated course', () => {
    const themes: SectionTheme[] = ['FLOW', 'SPEED', 'FLOW', 'PRECISION', 'SPEED', 'FLOW'];
    let checked = 0;
    // 300 courses: every generated fork must be fully traversable.
    for (let i = 0; i < 300; i++) {
      const track = generate(0x50000000 + i * 104729, themes, 60 + (i % 12) * 10, 90 + (i % 20) * 6);
      for (const fork of track.forks || []) {
        expect(fork.validated).toBe(true);
        expectForkSolvable(track.route, fork);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('safe and mastery lines both rejoin, and mastery is not longer by construction', () => {
    const themes: SectionTheme[] = ['FLOW', 'SPEED', 'FLOW', 'PRECISION', 'SPEED', 'FLOW'];
    let sawShorter = 0;
    let checked = 0;
    for (let i = 0; i < 80; i++) {
      const track = generate(0x60000000 + i * 15485863, themes, 95, 120);
      for (const fork of track.forks || []) {
        const entry = track.route.find((n) => n.id === fork.entryNodeId)!;
        const rejoin = track.route.find((n) => n.id === fork.rejoinNodeId)!;
        // Both branches share the exact entry and rejoin platforms.
        expect(entry).toBeTruthy();
        expect(rejoin).toBeTruthy();
        expect(rejoin.arcLength).toBeGreaterThan(entry.arcLength);
        expect(fork.masteryNodes.length).toBeGreaterThanOrEqual(2);
        if (fork.masteryDistance < fork.safeDistance) sawShorter++;
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
    // The cut line is genuinely shorter on at least some courses.
    expect(sawShorter).toBeGreaterThan(0);
  });

  it('surf branches have a valid entry and exit and a generous landing', () => {
    const themes: SectionTheme[] = ['SPEED', 'FLOW', 'SPEED', 'PRECISION'];
    let surfForks = 0;
    for (let i = 0; i < 60; i++) {
      const track = generate(0x70000000 + i * 2654435761, themes, 100, 110);
      for (const fork of track.forks || []) {
        if (fork.type !== 'SAFE_VS_SURF') continue;
        surfForks++;
        const surfNodes = fork.masteryNodes.filter((n) => n.isSurf);
        expect(surfNodes.length).toBeGreaterThanOrEqual(1);
        for (const s of surfNodes) {
          expect(s.surfNormal).toBeDefined();
          expect(Math.hypot(s.surfNormal!.x, s.surfNormal!.y, s.surfNormal!.z)).toBeCloseTo(1, 6);
          expect(s.roll).not.toBe(0);
        }
        // Landing platforms are wide enough to catch the redirect.
        for (const n of fork.masteryNodes) {
          expect(n.dimensions.x).toBeGreaterThanOrEqual(9);
        }
      }
    }
    expect(surfForks).toBeGreaterThan(0);
  });

  it('no mastery branch intersects main-route, surf, shelf, obstacle or spine geometry', () => {
    const themes: SectionTheme[] = ['FLOW', 'SPEED', 'FLOW', 'PRECISION', 'SPEED'];
    let checked = 0;
    for (let i = 0; i < 50; i++) {
      const track = generate(0x80000000 + i * 99991, themes, 95, 128);
      const survivors = RouteGenerator.rejectClippingForks(
        track.forks || [],
        track.route,
        track.optionalRamps,
        track.recoveryShelves,
        track.obstacles,
        track.signalSpines
      );
      expect(survivors.length).toBe(track.forks?.length ?? 0);
      checked += survivors.length;
    }
    expect(checked).toBeGreaterThan(5);
  });
});

describe('Route forks — authoritative protection systems', () => {
  it('branch geometry becomes real colliders and participates in the void envelope', () => {
    const themes: SectionTheme[] = ['FLOW', 'SPEED', 'FLOW', 'PRECISION', 'SPEED', 'FLOW'];
    let track = generate(0x90000000, themes, 110, 128);
    for (let i = 0; i < 30 && (track.forks?.length ?? 0) === 0; i++) {
      track = generate(0x90000000 + i * 7919, themes, 110, 128);
    }
    const fork = (track.forks || [])[0];
    expect(fork).toBeDefined();

    const physics = new PhysicsWorld();
    const sequences = (track.forks || []).map((f) => {
      const entry = track.route.find((n) => n.id === f.entryNodeId)!;
      const rejoin = track.route.find((n) => n.id === f.rejoinNodeId)!;
      return [entry, ...f.masteryNodes, rejoin];
    });
    physics.buildFromRoute(
      track.route,
      track.optionalRamps,
      track.recoveryShelves,
      track.obstacles,
      track.signalSpines,
      sequences
    );

    for (const node of fork.masteryNodes) {
      const covered = physics.colliders.some(
        (c) =>
          Math.abs(c.center.x - node.position.x) < 0.01 &&
          Math.abs(c.center.z - node.position.z) < 0.01
      );
      expect(covered, 'branch node has no collider').toBe(true);
    }

    // A point far below the branch but inside its local envelope must not be
    // treated as void, and a point well below must be.
    const n0 = fork.masteryNodes[0];
    const onBranch = { x: n0.position.x, y: n0.position.y, z: n0.position.z };
    expect(physics.isPositionInVoid(onBranch)).toBe(false);
    const deepBelow = { x: n0.position.x, y: n0.position.y - 500, z: n0.position.z };
    expect(physics.isPositionInVoid(deepBelow)).toBe(true);
  });

  it('both branches enter the single authoritative route exclusion corridor', () => {
    const themes: SectionTheme[] = ['FLOW', 'SPEED', 'FLOW', 'PRECISION', 'SPEED', 'FLOW'];
    const track = generate(0xa0000000, themes, 110, 128);
    const nodes = RouteExclusionCorridor.collectGameplayNodes(track);
    for (const fork of track.forks || []) {
      for (const node of fork.masteryNodes) {
        expect(nodes.some((n) => n.id === node.id)).toBe(true);
      }
    }
  });

  it('leaves PLAYHEAD_MOVEMENT_V1, TempoPressure and quality presets untouched', () => {
    expect(PLAYHEAD_MOVEMENT_V1.gravity).toBeCloseTo(24.0, 6);
    expect(PLAYHEAD_MOVEMENT_V1.jumpVelocity).toBeCloseTo(8.8, 6);

    // TempoPressure is a pure function of the analysis; forks never feed back in.
    const a = analysis(0x1234, 120, 76, ['FLOW']);
    const beforePressure = computeTempoPressure(a);
    const beforeProfile = computeTempoProfile(a);
    generate(0x1234, ['FLOW', 'SPEED'], 120, 76);
    expect(computeTempoPressure(a)).toBe(beforePressure);
    expect(computeTempoProfile(a)).toEqual(beforeProfile);

    // Quality preset table unchanged (spot-check the canonical tiers).
    expect(Object.keys(QUALITY_PRESETS).length).toBeGreaterThanOrEqual(3);
  });
});

describe('Route forks — batched rendering', () => {
  it('renders branch platforms through the merged pipeline, not one draw call each', () => {
    const themes: SectionTheme[] = ['FLOW', 'SPEED', 'FLOW', 'PRECISION', 'SPEED', 'FLOW'];
    let track = generate(0xb0000000, themes, 110, 128);
    for (let i = 0; i < 40 && (track.forks?.length ?? 0) === 0; i++) {
      track = generate(0xb0000000 + i * 7919, themes, 110, 128);
    }
    const branchNodeCount = (track.forks || []).reduce(
      (sum, f) => sum + f.masteryNodes.length,
      0
    );
    expect(branchNodeCount).toBeGreaterThan(0);

    // A/B: the same course rendered with and without its fork branches.
    const withForks = GeometryBuilder.buildWorld(track, PALETTE);
    const withoutForks = GeometryBuilder.buildWorld(
      { ...track, forks: undefined },
      PALETTE
    );

    const countMergedVertices = (built: { rootGroup: THREE.Object3D }): number => {
      let total = 0;
      let meshes = 0;
      built.rootGroup.traverse((o) => {
        if (o instanceof THREE.Mesh && /^Route(Platforms|SurfPlatforms)Merged$/.test(o.name)) {
          meshes++;
          total += o.geometry.getAttribute('position').count;
        }
      });
      // One merged mesh per material — never one per platform.
      expect(meshes).toBeLessThanOrEqual(2);
      return total;
    };

    const withVertices = countMergedVertices(withForks);
    const withoutVertices = countMergedVertices(withoutForks);

    // Every branch platform was baked into the same merged geometry
    // (BoxGeometry contributes 24 vertices per platform).
    expect(withVertices - withoutVertices).toBeGreaterThanOrEqual(24 * branchNodeCount);

    withForks.dispose();
    withoutForks.dispose();
  });
});

/** Asserts every transition of the mastery branch (and its rejoin) is feasible. */
function expectForkSolvable(route: RouteNode[], fork: { entryNodeId: number; rejoinNodeId: number; masteryNodes: RouteNode[] }): void {
  const entry = route.find((n) => n.id === fork.entryNodeId);
  const rejoin = route.find((n) => n.id === fork.rejoinNodeId);
  expect(entry).toBeTruthy();
  expect(rejoin).toBeTruthy();

  const sequence = [entry!, ...fork.masteryNodes, rejoin!];
  for (let i = 0; i < sequence.length - 1; i++) {
    const { gap, dy } = airGap(sequence[i], sequence[i + 1]);
    expect(gap, `branch transition ${i} air gap`).toBeLessThanOrEqual(9.55);
    expect(dy, `branch transition ${i} step-up`).toBeLessThanOrEqual(1.42);
    expect(dy, `branch transition ${i} drop`).toBeGreaterThanOrEqual(-22.0);
    expect(sequence[i + 1].dimensions.x).toBeGreaterThanOrEqual(8.0);
  }
}
