import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TrackAnalysis } from '../src/audio/AudioFeatures';
import { RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';
import { RouteChallengeGenerator } from '../src/generation/RouteChallengeGenerator';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { GeometryBuilder } from '../src/world/GeometryBuilder';

function analysis(seed = 0x504c4159): TrackAnalysis {
  return {
    filename: 'telegraph.wav',
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

function broadRoute(count = 40): RouteNode[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    time: 20 + index * 3.5,
    position: { x: 0, y: 0, z: index * 34 },
    dimensions: { x: 18, y: 2, z: 30 },
    yaw: 0,
    pitch: 0,
    roll: 0,
    type: index === count - 1 ? RouteNodeType.FINISH : RouteNodeType.RUNWAY,
    intensity: 0.85,
    sectionIndex: 0,
    arcLength: index * 34,
    isSurf: false,
    isBoost: false
  }));
}

describe('Obstacle floor telegraph removal', () => {
  it('does not create any floor telegraph mesh for obstacles', () => {
    const route = broadRoute();
    const obstacles = RouteChallengeGenerator.generate(route, analysis());
    expect(obstacles.length).toBeGreaterThan(0);

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

    let telegraphCount = 0;
    let obstacleMeshCount = 0;
    built.rootGroup.traverse((obj) => {
      if (obj.name.startsWith('RouteObstacleTelegraph:')) telegraphCount++;
      if (obj.name.startsWith('RouteObstacle:')) obstacleMeshCount++;
    });

    expect(telegraphCount).toBe(0);
    expect(obstacleMeshCount).toBe(obstacles.length);
    built.dispose();
  });

  it('does not create flat colored floor rectangles at obstacle approach', () => {
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

    // Any wide, very thin, near-horizontal box near an obstacle top surface
    // would be a telegraph-style floor marker. There must be none.
    const suspicious: string[] = [];
    built.rootGroup.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const geom = obj.geometry as THREE.BufferGeometry;
      geom.computeBoundingBox();
      const box = geom.boundingBox;
      if (!box) return;
      const size = box.getSize(new THREE.Vector3());
      const isFlat = size.y <= 0.1 && size.x >= 4 && size.z >= 8;
      if (isFlat && !obj.name.startsWith('Area')) suspicious.push(obj.name || '(unnamed)');
    });

    expect(suspicious).toEqual([]);
    built.dispose();
  });

  it('still creates authoritative obstacle colliders after the visual removal', () => {
    const route = broadRoute();
    const obstacles = RouteChallengeGenerator.generate(route, analysis());
    const world = new PhysicsWorld();
    world.buildFromRoute(route, [], [], obstacles);
    expect(world.colliders.length).toBe(route.length + obstacles.length);
    // Moving obstacles are still registered for deterministic motion.
    expect(world.hasDynamicObstacles()).toBe(obstacles.some(o => !!o.obstacleMotion));
  });
});
