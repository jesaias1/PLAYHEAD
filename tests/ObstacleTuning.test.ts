import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TrackAnalysis } from '../src/audio/AudioFeatures';
import { RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';
import { RouteChallengeGenerator } from '../src/generation/RouteChallengeGenerator';
import { SeededRandom } from '../src/generation/SeededRandom';
import { BoxCollider } from '../src/physics/Collider';
import { GeometryBuilder } from '../src/world/GeometryBuilder';
import { PLAYHEAD_MOVEMENT_V1 } from '../src/player/MovementConfig';

const EDGE_MARGIN = 0.75;

function analysis(seed = 0x504c4159): TrackAnalysis {
  return {
    filename: 'tuning.wav',
    duration: 150,
    bpm: 142,
    bpmConfidence: 0.95,
    globalEnergy: 0.85,
    frames: [],
    onsets: [],
    sections: [{
      index: 0,
      start: 0,
      end: 150,
      duration: 150,
      intensity: 0.85,
      rhythmicDensity: 0.85,
      brightness: 0.7,
      theme: 'BUILDUP'
    }],
    waveform: new Float32Array(16),
    seed,
    visualAccent: { name: 'Test Cyan', hex: '#00f0ff', rgb: [0, 240, 255] }
  };
}

function host(x: number, z: number, id = 1): RouteNode {
  return {
    id,
    time: 30,
    position: { x: 0, y: 0, z: 0 },
    dimensions: { x, y: 2, z },
    yaw: 0,
    pitch: 0,
    roll: 0,
    type: RouteNodeType.RUNWAY,
    intensity: 0.8,
    sectionIndex: 0,
    arcLength: 0,
    isSurf: false,
    isBoost: false
  };
}

function buildThreadWalls(x: number, z: number, count: 2 | 3, speed: number, seed = 7): RouteNode[] {
  const h = host(x, z);
  const rng = new SeededRandom(seed);
  let id = 100;
  const kind = count === 2 ? 'LEFT_RIGHT_THREAD' : 'THREE_WALL_THREAD';
  const walls = RouteChallengeGenerator.buildLabPhrase(kind, h, rng, () => id++, 900, speed);
  expect(walls, `thread x${count} @${speed} produced no walls`).toBeTruthy();
  return walls!;
}

function openingOf(hostNode: RouteNode, wall: RouteNode): number {
  return hostNode.dimensions.x - wall.dimensions.x - EDGE_MARGIN;
}

/** Required lateral change between alternating openings (edge-to-edge). */
function effectiveDelta(hostNode: RouteNode, walls: RouteNode[]): number {
  const opening = openingOf(hostNode, walls[0]);
  // Player centre must clear both fins: opening edge to opening edge plus the
  // player's own diameter.
  const playerDiameter = PLAYHEAD_MOVEMENT_V1.playerRadius * 2;
  return Math.max(0, hostNode.dimensions.x - 2 * opening + playerDiameter);
}

function spacingOf(walls: RouteNode[]): number {
  let min = Infinity;
  for (let i = 1; i < walls.length; i++) {
    min = Math.min(min, Math.abs(walls[i].arcLength - walls[i - 1].arcLength));
  }
  return min;
}

describe('Wall Thread — high-speed solvability', () => {
  for (const count of [2, 3] as const) {
    it(`x${count} retains a traversable lateral envelope at high speed`, () => {
      const h = host(20, count === 2 ? 64 : 76);
      for (const speed of [30, 45, 60]) {
        const walls = buildThreadWalls(h.dimensions.x, h.dimensions.z, count, speed);
        expect(walls.length).toBe(count);
        const spacing = spacingOf(walls);
        const required = RouteChallengeGenerator.laneChangeDistance(effectiveDelta(h, walls), speed);
        expect(required, `x${count} @${speed}: needs ${required.toFixed(1)}m of ${spacing.toFixed(1)}m`).toBeLessThanOrEqual(spacing + 0.75);
      }
    });
  }

  it('produces wider, less aggressive geometry at higher expected speed', () => {
    const h = host(20, 64);
    const slow = buildThreadWalls(h.dimensions.x, h.dimensions.z, 2, 20);
    const fast = buildThreadWalls(h.dimensions.x, h.dimensions.z, 2, 55);
    expect(openingOf(h, fast[0])).toBeGreaterThanOrEqual(openingOf(h, slow[0]));
    expect(spacingOf(fast)).toBeGreaterThanOrEqual(spacingOf(slow));
    // Less aggressive = smaller required lateral delta.
    expect(effectiveDelta(h, fast)).toBeLessThanOrEqual(effectiveDelta(h, slow));
  });

  it('keeps walls thin fins rather than cubes, with a real opening', () => {
    const h = host(20, 64);
    const walls = buildThreadWalls(h.dimensions.x, h.dimensions.z, 3, 50);
    for (const wall of walls) {
      expect(wall.dimensions.z).toBeLessThanOrEqual(0.7);
      expect(wall.dimensions.z).toBeGreaterThanOrEqual(0.3);
      expect(wall.dimensions.y).toBeGreaterThanOrEqual(3.5);
      expect(openingOf(h, wall)).toBeGreaterThanOrEqual(2.75);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = buildThreadWalls(20, 76, 3, 50, 4242);
    const b = buildThreadWalls(20, 76, 3, 50, 4242);
    expect(a).toEqual(b);
  });
});

describe('Sweep Beam — shorter, faster, meaningful motion', () => {
  function beam(x: number, seed = 11): RouteNode {
    const h = host(x, 30);
    const rng = new SeededRandom(seed);
    let id = 500;
    const b = RouteChallengeGenerator.buildLabObstacle('SWEEP_BEAM', h, rng, () => id++, 'BEAM_HOP');
    expect(b).toBeTruthy();
    return b!;
  }

  it('is a short moving segment, not a near-full-width bar', () => {
    for (const x of [14, 18, 24]) {
      const b = beam(x);
      expect(b.dimensions.x).toBeLessThanOrEqual(x * 0.5 + 0.01);
      expect(b.dimensions.x).toBeLessThan(x - 1.2);
      // A usable lane always remains.
      expect(x - b.dimensions.x).toBeGreaterThanOrEqual(2.75 * 2 - 0.01);
    }
  });

  it('has meaningful travel and a readable deterministic speed', () => {
    const b = beam(18);
    const motion = b.obstacleMotion!;
    expect(motion.amplitude).toBeGreaterThanOrEqual(1.5);
    expect(motion.amplitude * motion.speed).toBeGreaterThanOrEqual(3.0);
    expect(motion.speed).toBeGreaterThanOrEqual(1.3);
    expect(motion.speed).toBeLessThanOrEqual(2.1);
    // Deterministic for a given seed.
    expect(beam(18, 11).obstacleMotion).toEqual(motion);
  });

  it('stays jumpable', () => {
    const b = beam(18);
    const apex =
      (PLAYHEAD_MOVEMENT_V1.jumpVelocity ** 2) / (2 * PLAYHEAD_MOVEMENT_V1.gravity);
    expect(b.dimensions.y).toBeLessThan(apex * 0.5);
  });
});

describe('Obstacle tuning — visual / collision parity', () => {
  function buildTunedTrack() {
    const h1 = host(18, 30, 1);
    const h2 = host(20, 64, 2);
    h2.position = { x: 0, y: 0, z: 60 };
    h2.arcLength = 60;
    const rng = new SeededRandom(99);
    let id = 700;
    const obstacles: RouteNode[] = [];
    for (const type of ['SCAN_BAR', 'SWEEP_BEAM', 'PHASE_BLOCK', 'SPLIT_GATE', 'SIGNAL_SHUTTER'] as const) {
      const o = RouteChallengeGenerator.buildLabObstacle(type, h1, rng, () => id++, 'GATE_COMMIT');
      if (o) obstacles.push(o);
    }
    const thread = RouteChallengeGenerator.buildLabPhrase('THREE_WALL_THREAD', h2, rng, () => id++, 950, 50);
    if (thread) obstacles.push(...thread);

    const route = [h1, h2];
    const track = {
      seed: 1,
      route,
      obstacles,
      checkpoints: [],
      finish: { routeNodeId: h2.id, time: 150, position: h2.position, yaw: 0 },
      totalDistance: h2.arcLength,
      targetDuration: 150,
      repairedJumpsCount: 0
    };
    return { route, obstacles, track, h1, h2 };
  }

  it('keeps visible geometry identical to the authoritative collider', () => {
    const { obstacles, track } = buildTunedTrack();
    const built = GeometryBuilder.buildWorld(track, analysis().visualAccent);

    for (const obstacle of obstacles) {
      const mesh = built.rootGroup.getObjectByName(
        `RouteObstacle:${obstacle.obstacleType}:${obstacle.id}`
      ) as THREE.Mesh;
      expect(mesh, `missing mesh for ${obstacle.obstacleType}`).toBeTruthy();
      mesh.geometry.computeBoundingBox();
      const size = mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
      expect(size.x).toBeCloseTo(obstacle.dimensions.x, 5);
      expect(size.y).toBeCloseTo(obstacle.dimensions.y, 5);
      expect(size.z).toBeCloseTo(obstacle.dimensions.z, 5);

      const collider = new BoxCollider(obstacle);
      expect(collider.halfSize.x * 2).toBeCloseTo(size.x, 5);
      expect(collider.halfSize.y * 2).toBeCloseTo(size.y, 5);
      expect(collider.halfSize.z * 2).toBeCloseTo(size.z, 5);
      expect(collider.center.x).toBeCloseTo(mesh.position.x, 5);
      expect(collider.center.z).toBeCloseTo(mesh.position.z, 5);
    }
    built.dispose();
  });

  it('uses distinct material treatments per obstacle family', () => {
    const { obstacles, track } = buildTunedTrack();
    const built = GeometryBuilder.buildWorld(track, analysis().visualAccent);
    const matOf = (o: RouteNode) => {
      const mesh = built.rootGroup.getObjectByName(`RouteObstacle:${o.obstacleType}:${o.id}`) as THREE.Mesh;
      return mesh.material;
    };
    const byType = (t: string) => obstacles.find(o => o.obstacleType === t)!;

    // Scan bar: one full luminous material.
    expect(Array.isArray(matOf(byType('SCAN_BAR')))).toBe(false);
    // Sweep beam: dark body + luminous top rail (multi-material).
    expect(Array.isArray(matOf(byType('SWEEP_BEAM')))).toBe(true);
    // Phase block: dark mass with a lit cap.
    expect(Array.isArray(matOf(byType('PHASE_BLOCK')))).toBe(true);
    // Split gate: dark wall with a lit lintel.
    expect(Array.isArray(matOf(byType('SPLIT_GATE')))).toBe(true);
    // Wall thread fins: plain dark bodies (single material).
    const threadWall = obstacles.find(o => o.obstaclePhraseKind === 'THREE_WALL_THREAD')!;
    expect(Array.isArray(matOf(threadWall))).toBe(false);
    built.dispose();
  });
});
