import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AnalysisSection, TrackAnalysis } from '../src/audio/AudioFeatures';
import { RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';
import { RouteGenerator } from '../src/generation/RouteGenerator';
import {
  ROUTE_CHALLENGE_LIMITS,
  RouteChallengeGenerator
} from '../src/generation/RouteChallengeGenerator';
import { BoxCollider } from '../src/physics/Collider';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { GeometryBuilder } from '../src/world/GeometryBuilder';
import { PLAYHEAD_MOVEMENT_V1 } from '../src/player/MovementConfig';

const JUMP_APEX =
  (PLAYHEAD_MOVEMENT_V1.jumpVelocity ** 2) / (2 * PLAYHEAD_MOVEMENT_V1.gravity);

function analysis(
  theme: TrackAnalysis['sections'][number]['theme'] = 'BUILDUP',
  seed = 0x504c4159,
  overrides: Partial<AnalysisSection> = {}
): TrackAnalysis {
  return {
    filename: 'route-challenges.wav',
    duration: 150,
    bpm: 142,
    bpmConfidence: 0.95,
    globalEnergy: 0.8,
    frames: [],
    onsets: [],
    sections: [{
      index: 0,
      start: 0,
      end: 150,
      duration: 150,
      intensity: 0.82,
      rhythmicDensity: 0.84,
      brightness: 0.7,
      theme,
      ...overrides
    }],
    waveform: new Float32Array(512),
    seed,
    visualAccent: { name: 'Test Cyan', hex: '#00f0ff', rgb: [0, 240, 255] }
  };
}

function broadRoute(count = 36): RouteNode[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    time: 20 + index * 3.5,
    position: { x: 0, y: 0, z: index * 34 },
    dimensions: { x: 16, y: 2, z: 28 },
    yaw: 0,
    pitch: 0,
    roll: 0,
    type: index === count - 1 ? RouteNodeType.FINISH : RouteNodeType.RUNWAY,
    intensity: 0.82,
    sectionIndex: 0,
    arcLength: index * 34,
    isSurf: false,
    isBoost: false
  }));
}

describe('deterministic readable route challenges', () => {
  it('is deterministic for a given seed', () => {
    const route = broadRoute();
    const first = RouteChallengeGenerator.generate(route, analysis());
    const second = RouteChallengeGenerator.generate(route, analysis());
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThanOrEqual(ROUTE_CHALLENGE_LIMITS.maxObstacles);
  });

  it('keeps phrases spaced and never spams every platform', () => {
    const route = broadRoute();
    const obstacles = RouteChallengeGenerator.generate(route, analysis());

    // Group by phrase and verify phrase anchor spacing.
    const anchors = new Map<number, number>();
    for (const obstacle of obstacles) {
      const id = obstacle.obstaclePhraseId!;
      const current = anchors.get(id);
      if (current === undefined || obstacle.arcLength < current) {
        anchors.set(id, obstacle.arcLength);
      }
    }
    const sorted = [...anchors.values()].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(ROUTE_CHALLENGE_LIMITS.minSpacing);
    }

    // Obstacle count stays a small fraction of the platform count.
    expect(obstacles.length).toBeLessThan(route.length);
  });

  it('gives every obstacle a fair, measurable response', () => {
    const route = broadRoute();
    const obstacles = RouteChallengeGenerator.generate(route, analysis());
    for (const obstacle of obstacles) {
      const source = route.find(node => node.id === obstacle.obstacleSourceNodeId)!;
      expect(source).toBeTruthy();
      expect(obstacle.obstaclePhraseKind).toBeTruthy();
      expect(obstacle.obstacleDifficulty).toBeTruthy();

      if (obstacle.obstacleType === 'SCAN_BAR' || obstacle.obstacleType === 'SWEEP_BEAM') {
        expect(obstacle.dimensions.y).toBeLessThan(JUMP_APEX * 0.5);
        expect(obstacle.obstacleSafeLane).toBe('JUMP');
      } else if (obstacle.obstacleType === 'SPLIT_GATE') {
        const laneWidth = source.dimensions.x - obstacle.dimensions.x - 0.75;
        expect(laneWidth).toBeGreaterThanOrEqual(ROUTE_CHALLENGE_LIMITS.minOpening);
        expect(['LEFT', 'RIGHT']).toContain(obstacle.obstacleSafeLane);
      } else if (obstacle.obstacleType === 'SIGNAL_SHUTTER') {
        const staticLane = (source.dimensions.x - obstacle.dimensions.x) * 0.5;
        const amplitude = obstacle.obstacleMotion?.amplitude ?? 0;
        expect(staticLane - amplitude).toBeGreaterThanOrEqual(ROUTE_CHALLENGE_LIMITS.minSafeLane);
        expect(obstacle.obstacleSafeLane).toBe('BOTH');
      } else {
        // PHASE_BLOCK: both strafe lanes must remain traversable.
        expect(obstacle.dimensions.y).toBeGreaterThanOrEqual(1.8);
      }
    }
  });

  it('leaves drop, surf and breath release sections obstacle-free', () => {
    expect(RouteChallengeGenerator.generate(broadRoute(), analysis('DROP'))).toEqual([]);
    expect(RouteChallengeGenerator.generate(broadRoute(), analysis('BREATH'))).toEqual([]);
    expect(RouteChallengeGenerator.generate(broadRoute(), analysis('SURF'))).toEqual([]);
  });

  it('integrates the full challenge vocabulary across generated courses', () => {
    const seen = new Set<string>();
    const phrases = new Set<string>();
    let generatedCount = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const track = RouteGenerator.generate(analysis('FLOW', seed));
      for (const obstacle of track.obstacles ?? []) {
        seen.add(obstacle.obstacleType!);
        phrases.add(obstacle.obstaclePhraseKind!);
        generatedCount++;
      }
    }
    expect(generatedCount).toBeGreaterThan(0);
    expect(seen).toEqual(new Set(['SIGNAL_SHUTTER', 'SCAN_BAR', 'SPLIT_GATE', 'PHASE_BLOCK', 'SWEEP_BEAM']));
    expect(phrases.size).toBeGreaterThanOrEqual(4);
  });

  it('uses identical visible and collision bounds', () => {
    const route = broadRoute();
    const obstacles = RouteChallengeGenerator.generate(route, analysis());
    const track = {
      seed: 1,
      route,
      obstacles,
      checkpoints: [],
      finish: { routeNodeId: route.at(-1)!.id, time: 150, position: route.at(-1)!.position, yaw: 0 },
      totalDistance: route.at(-1)!.arcLength,
      targetDuration: 150,
      repairedJumpsCount: 0
    };
    const built = GeometryBuilder.buildWorld(track, analysis().visualAccent);

    for (const obstacle of obstacles) {
      const mesh = built.rootGroup.getObjectByName(`RouteObstacle:${obstacle.obstacleType}:${obstacle.id}`) as THREE.Mesh;
      expect(mesh).toBeTruthy();
      mesh.geometry.computeBoundingBox();
      const size = mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
      expect(size.x).toBeCloseTo(obstacle.dimensions.x, 5);
      expect(size.y).toBeCloseTo(obstacle.dimensions.y, 5);
      expect(size.z).toBeCloseTo(obstacle.dimensions.z, 5);

      const collider = new BoxCollider(obstacle);
      expect(collider.center.x).toBeCloseTo(mesh.position.x, 5);
      expect(collider.center.y).toBeCloseTo(mesh.position.y, 5);
      expect(collider.center.z).toBeCloseTo(mesh.position.z, 5);
      expect(collider.halfSize.x * 2).toBeCloseTo(size.x, 5);
      expect(collider.halfSize.y * 2).toBeCloseTo(size.y, 5);
      expect(collider.halfSize.z * 2).toBeCloseTo(size.z, 5);
    }

    built.dispose();
  });

  it('adds obstacle collision without changing the gameplay void boundary', () => {
    const route = broadRoute();
    const obstacles = RouteChallengeGenerator.generate(route, analysis());
    const world = new PhysicsWorld();
    world.buildFromRoute(route, [], [], obstacles);
    expect(world.colliders.length).toBe(route.length + obstacles.length);
    expect(world.lowestGameplayY).toBe(-1);
    expect(world.getVoidDeathY()).toBe(-1 - PhysicsWorld.VOID_MARGIN);
  });
});
