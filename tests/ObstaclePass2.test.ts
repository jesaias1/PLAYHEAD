import { describe, expect, it, vi } from 'vitest';
import { AnalysisSection, TrackAnalysis } from '../src/audio/AudioFeatures';
import { RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';
import { RouteGenerator } from '../src/generation/RouteGenerator';
import {
  ROUTE_CHALLENGE_LIMITS,
  RouteChallengeGenerator
} from '../src/generation/RouteChallengeGenerator';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { PLAYHEAD_MOVEMENT_V1 } from '../src/player/MovementConfig';

const JUMP_APEX =
  (PLAYHEAD_MOVEMENT_V1.jumpVelocity ** 2) / (2 * PLAYHEAD_MOVEMENT_V1.gravity);

function analysis(
  theme: TrackAnalysis['sections'][number]['theme'] = 'BUILDUP',
  seed = 0x504c4159,
  overrides: Partial<AnalysisSection> = {}
): TrackAnalysis {
  return {
    filename: 'obstacle-pass-2.wav',
    duration: 180,
    bpm: 140,
    bpmConfidence: 0.95,
    globalEnergy: 0.8,
    frames: [],
    onsets: [],
    sections: [{
      index: 0,
      start: 0,
      end: 180,
      duration: 180,
      intensity: 0.8,
      rhythmicDensity: 0.8,
      brightness: 0.7,
      theme,
      ...overrides
    }],
    waveform: new Float32Array(512),
    seed,
    visualAccent: { name: 'Test Cyan', hex: '#00f0ff', rgb: [0, 240, 255] }
  };
}

function routeOf(
  count: number,
  dims: { x: number; z: number },
  type: RouteNodeType = RouteNodeType.RUNWAY
): RouteNode[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    time: 20 + index * 3.5,
    position: { x: 0, y: 0, z: index * 34 },
    dimensions: { x: dims.x, y: 2, z: dims.z },
    yaw: 0,
    pitch: 0,
    roll: 0,
    type: index === count - 1 ? RouteNodeType.FINISH : type,
    intensity: 0.8,
    sectionIndex: 0,
    arcLength: index * 34,
    isSurf: false,
    isBoost: false
  }));
}

/** Mirrors the generator's conservative cylinder overlap. */
function conservativeOverlap(a: RouteNode, b: RouteNode): boolean {
  const ax = Math.hypot(a.dimensions.x, a.dimensions.z) * 0.5;
  const bx = Math.hypot(b.dimensions.x, b.dimensions.z) * 0.5;
  const dx = a.position.x - b.position.x;
  const dz = a.position.z - b.position.z;
  const reach = ax + bx;
  if (dx * dx + dz * dz >= reach * reach) return false;
  return Math.abs(a.position.y - b.position.y) < (a.dimensions.y + b.dimensions.y) * 0.5;
}

describe('Obstacle Pass 2 — determinism', () => {
  it('produces an identical layout for the same seed', () => {
    const route = routeOf(60, { x: 16, z: 30 });
    const a = RouteChallengeGenerator.generate(route, analysis('FLOW', 1234));
    const b = RouteChallengeGenerator.generate(route, analysis('FLOW', 1234));
    expect(a).toEqual(b);
  });

  it('produces meaningful variation for a different seed', () => {
    const route = routeOf(60, { x: 16, z: 30 });
    const a = RouteChallengeGenerator.generate(route, analysis('FLOW', 1234));
    const b = RouteChallengeGenerator.generate(route, analysis('FLOW', 998877));
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    const fingerprint = (list: RouteNode[]) =>
      list.map(o => `${o.obstacleType}@${o.arcLength.toFixed(2)}`).join('|');
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });
});

describe('Obstacle Pass 2 — placement safety', () => {
  it('never places an obstacle on a micro-platform chain', () => {
    const micro = routeOf(60, { x: 6, z: 12 });
    expect(RouteChallengeGenerator.generate(micro, analysis('FLOW'))).toEqual([]);
  });

  it('keeps spawn, checkpoint and finish arcs clean', () => {
    const track = RouteGenerator.generate(analysis('FLOW', 4242));
    const obstacles = track.obstacles ?? [];
    expect(obstacles.length).toBeGreaterThan(0);

    for (const obstacle of obstacles) {
      expect(obstacle.time).toBeGreaterThanOrEqual(ROUTE_CHALLENGE_LIMITS.startGraceTime);
    }

    const checkpointArcs = track.checkpoints.map(cp => {
      const node = track.route.find(n => n.id === cp.routeNodeId);
      return node ? node.arcLength : cp.time;
    });
    for (const obstacle of obstacles) {
      for (const arc of checkpointArcs) {
        expect(Math.abs(obstacle.arcLength - arc))
          .toBeGreaterThan(ROUTE_CHALLENGE_LIMITS.checkpointClearance * 0.5);
      }
      expect(Math.abs(obstacle.arcLength - track.route.at(-1)!.arcLength))
        .toBeGreaterThan(ROUTE_CHALLENGE_LIMITS.finishClearance * 0.5);
    }
  });

  it('does not block the Signal Spine recovery layer or recovery shelves', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const track = RouteGenerator.generate(analysis('FLOW', seed * 7919));
      const obstacles = track.obstacles ?? [];
      for (const obstacle of obstacles) {
        for (const spine of track.signalSpines ?? []) {
          expect(conservativeOverlap(obstacle, spine)).toBe(false);
        }
        for (const shelf of track.recoveryShelves ?? []) {
          expect(conservativeOverlap(obstacle, shelf)).toBe(false);
        }
      }
    }
  });

  it('leaves surf travel corridors clear', () => {
    const track = RouteGenerator.generate(analysis('SURF', 31337));
    for (const obstacle of track.obstacles ?? []) {
      const source = track.route.find(n => n.id === obstacle.obstacleSourceNodeId)!;
      expect(source.isSurf).toBe(false);
      expect(obstacle.isSurf).toBe(false);
      const index = track.route.indexOf(source);
      for (let offset = -2; offset <= 2; offset++) {
        const neighbour = track.route[index + offset];
        if (neighbour) expect(neighbour.isSurf).toBe(false);
      }
    }
  });
});

describe('Obstacle Pass 2 — solvability', () => {
  it('always retains a traversable opening', () => {
    const route = routeOf(80, { x: 18, z: 32 });
    const obstacles = RouteChallengeGenerator.generate(route, analysis('BUILDUP', 5150));
    expect(obstacles.length).toBeGreaterThan(0);

    for (const obstacle of obstacles) {
      const source = route.find(n => n.id === obstacle.obstacleSourceNodeId)!;
      const type = obstacle.obstacleType;
      if (type === 'SCAN_BAR' || type === 'SWEEP_BEAM') {
        expect(obstacle.dimensions.y).toBeLessThan(JUMP_APEX * 0.5);
      } else if (type === 'SPLIT_GATE') {
        const opening = source.dimensions.x - obstacle.dimensions.x - 0.75;
        expect(opening).toBeGreaterThanOrEqual(ROUTE_CHALLENGE_LIMITS.minOpening);
      } else if (type === 'SIGNAL_SHUTTER') {
        const staticLane = (source.dimensions.x - obstacle.dimensions.x) * 0.5;
        const amplitude = obstacle.obstacleMotion?.amplitude ?? 0;
        expect(staticLane - amplitude).toBeGreaterThanOrEqual(ROUTE_CHALLENGE_LIMITS.minSafeLane);
      }
    }
  });

  it('never lets a phrase seal the route', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const route = routeOf(70, { x: 16, z: 30 });
      const obstacles = RouteChallengeGenerator.generate(route, analysis('BUILDUP', seed * 104729));
      const byPhrase = new Map<number, RouteNode[]>();
      for (const obstacle of obstacles) {
        const list = byPhrase.get(obstacle.obstaclePhraseId!) ?? [];
        list.push(obstacle);
        byPhrase.set(obstacle.obstaclePhraseId!, list);
      }
      for (const [, elements] of byPhrase) {
        const source = route.find(n => n.id === elements[0].obstacleSourceNodeId)!;
        // Count only blockers that share the same cross-section (within 2m of
        // each other along the route). Thread walls are intentionally offset.
        for (const element of elements) {
          for (const other of elements) {
            if (element === other) continue;
            const sameSlice = Math.abs(element.arcLength - other.arcLength) < 2.0;
            if (!sameSlice) continue;
            const blocked = blockedSpan(element) + blockedSpan(other);
            expect(blocked).toBeLessThanOrEqual(source.dimensions.x - ROUTE_CHALLENGE_LIMITS.minOpening);
          }
        }
      }
    }
  });
});

function blockedSpan(element: RouteNode): number {
  if (element.dimensions.y < 1.8) return 0;
  if (element.obstacleType === 'SPLIT_GATE') return element.dimensions.x + 0.75;
  if (element.obstacleType === 'SIGNAL_SHUTTER') {
    return element.dimensions.x + (element.obstacleMotion?.amplitude ?? 0) * 2;
  }
  return element.dimensions.x;
}

describe('Obstacle Pass 2 — music mapping', () => {
  it('keeps breakdown / low-energy sections lighter than dense sections', () => {
    const route = routeOf(90, { x: 16, z: 30 });
    let low = 0;
    let dense = 0;
    for (let seed = 1; seed <= 8; seed++) {
      low += RouteChallengeGenerator.generate(
        route,
        analysis('FLOW', seed, { intensity: 0.2, rhythmicDensity: 0.3 })
      ).length;
      dense += RouteChallengeGenerator.generate(
        route,
        analysis('FLOW', seed, { intensity: 0.85, rhythmicDensity: 0.85 })
      ).length;
    }
    expect(low).toBeLessThan(dense);
  });

  it('keeps drop and breath sections open and lets buildup carry pressure', () => {
    const route = routeOf(90, { x: 16, z: 30 });
    expect(RouteChallengeGenerator.generate(route, analysis('DROP')).length).toBe(0);
    expect(RouteChallengeGenerator.generate(route, analysis('BREATH')).length).toBe(0);
    expect(RouteChallengeGenerator.generate(route, analysis('SURF')).length).toBe(0);
    expect(RouteChallengeGenerator.generate(route, analysis('BUILDUP', 7)).length).toBeGreaterThan(0);
  });
});

describe('Obstacle Pass 2 — density', () => {
  it('fills broad eligible traversal sections far more than the old cap of 8', () => {
    const route = routeOf(90, { x: 16, z: 30 });
    let best = 0;
    let total = 0;
    const seeds = 10;
    for (let seed = 1; seed <= seeds; seed++) {
      const count = RouteChallengeGenerator.generate(route, analysis('BUILDUP', seed * 13)).length;
      best = Math.max(best, count);
      total += count;
    }
    expect(best).toBeGreaterThan(8);
    expect(total / seeds).toBeGreaterThan(6);
  });

  it('reports DEV diagnostics for the last generation', () => {
    const route = routeOf(60, { x: 16, z: 30 });
    RouteChallengeGenerator.generate(route, analysis('BUILDUP', 99));
    const report = RouteChallengeGenerator.getLastReport();
    expect(report).toBeTruthy();
    expect(report!.obstaclesGenerated).toBeGreaterThan(0);
    expect(report!.phrasesGenerated).toBeGreaterThan(0);
    expect(Object.keys(report!.countByType).length).toBeGreaterThan(0);
    expect(Object.keys(report!.countByPhrase).length).toBeGreaterThan(0);
  });
});

describe('Obstacle Pass 2 — performance / state', () => {
  it('never uses unseeded randomness', () => {
    const spy = vi.spyOn(Math, 'random');
    try {
      const route = routeOf(70, { x: 16, z: 30 });
      RouteChallengeGenerator.generate(route, analysis('BUILDUP', 2024));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('advances moving obstacle colliders deterministically and cheaply', () => {
    const route = routeOf(70, { x: 16, z: 30 });
    const obstacles = RouteChallengeGenerator.generate(route, analysis('BUILDUP', 606));
    const moving = obstacles.filter(o => o.obstacleMotion);
    expect(moving.length).toBeGreaterThan(0);

    const world = new PhysicsWorld();
    world.buildFromRoute(route, [], [], obstacles);
    expect(world.hasDynamicObstacles()).toBe(true);

    const before = moving.map(o => ({ ...o.position }));
    world.updateDynamicObstacles(0);
    world.updateDynamicObstacles(4.25);
    // Static obstacles are never touched by the dynamic pass.
    const stillStatic = obstacles.filter(o => !o.obstacleMotion);
    for (const obstacle of stillStatic) {
      const collider = world.colliders.find(c =>
        Math.abs(c.center.x - obstacle.position.x) < 1e-6 &&
        Math.abs(c.center.z - obstacle.position.z) < 1e-6
      );
      expect(collider).toBeTruthy();
    }

    // The same song time always resolves to the same collider position.
    const sample = (time: number) => {
      world.updateDynamicObstacles(time);
      return world.colliders.map(c => `${c.center.x.toFixed(6)},${c.center.z.toFixed(6)}`).join(';');
    };
    expect(sample(7.5)).toBe(sample(7.5));
    expect(sample(7.5)).not.toBe(sample(9.1));
    void before;
  });
});
