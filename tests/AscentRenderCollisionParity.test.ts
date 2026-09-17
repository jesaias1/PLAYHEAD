import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RouteGenerator } from '../src/generation/RouteGenerator';
import { BoxCollider } from '../src/physics/Collider';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';
import { TrackAnalysis } from '../src/audio/AudioFeatures';

/**
 * RENDER SHAPE == PLAYABLE SHAPE
 *
 * Widened/flared ascent platforms must be supported by collision across their
 * ENTIRE visible top surface. A previous bug left the far corners visually
 * present but non-solid, so the player fell through them.
 *
 * These tests reconstruct the exact render geometry used by GeometryBuilder
 * (its flared trapezoid path) and probe the collider at the same sample points:
 * centre, left/right middle, far-left/right widened corners, exit edge, and
 * just outside each lateral edge.
 */
describe('AscentRenderCollisionParity', () => {
  const PLAYER_RADIUS = 0.35;

  /**
   * Mirrors the flared-trapezoid geometry built in GeometryBuilder.buildWorld
   * for a node that has exitWidth > dimensions.x.
   */
  function buildRenderGeometry(node: RouteNode): THREE.BufferGeometry {
    const geom = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
    const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
    const entryW = node.dimensions.x;
    const exitW = node.exitWidth!;
    const h = node.dimensions.y;
    const l = node.dimensions.z;
    for (let v = 0; v < posAttr.count; v++) {
      const zNorm = posAttr.getZ(v);
      const xNorm = posAttr.getX(v);
      const yNorm = posAttr.getY(v);
      const width = zNorm > 0 ? exitW : entryW;
      posAttr.setXYZ(v, xNorm * width, yNorm * h, zNorm * l);
    }
    geom.computeVertexNormals();
    geom.computeBoundingBox();
    return geom;
  }

  function ascentTrack(): RouteNode[] {
    const analysis: TrackAnalysis = {
      filename: 'parity',
      duration: 60,
      bpm: 128,
      bpmConfidence: 0.9,
      globalEnergy: 0.7,
      frames: [],
      onsets: [],
      sections: [
        { index: 0, start: 0, end: 30, duration: 30, intensity: 0.8, rhythmicDensity: 0.6, brightness: 0.6, theme: 'BUILDUP' },
        { index: 1, start: 30, end: 60, duration: 30, intensity: 0.9, rhythmicDensity: 0.8, brightness: 0.7, theme: 'ASCENT' }
      ],
      waveform: new Float32Array(512),
      seed: 0x12345678,
      visualAccent: { name: 'Icy Cyan', hex: '#00f0ff', rgb: [0, 240, 255] }
    };
    return RouteGenerator.generate(analysis).route;
  }

  it('every visible top-surface sample is physically supported', () => {
    const stepUps = ascentTrack().filter(
      (n) => n.type === RouteNodeType.STEP_UP && n.exitWidth && n.exitWidth > n.dimensions.x
    );
    expect(stepUps.length).toBeGreaterThan(0);

    for (const node of stepUps) {
      const geom = buildRenderGeometry(node);
      const box = geom.boundingBox!;
      const col = new BoxCollider(node);

      const topY = node.dimensions.y * 0.5; // render geometry is centred on origin
      const halfLenZ = node.dimensions.z * 0.5;
      const exitHalfW = node.exitWidth! * 0.5;

      // Sample the visible top surface in the platform's local frame, then
      // convert to world space (the collider API is world-space).
      const samples: Array<{ name: string; x: number; z: number }> = [
        { name: 'centre', x: 0, z: 0 },
        { name: 'left-middle', x: -exitHalfW * 0.7, z: 0 },
        { name: 'right-middle', x: exitHalfW * 0.7, z: 0 },
        { name: 'far-left-widened-corner', x: -(exitHalfW - 0.15), z: halfLenZ - 0.15 },
        { name: 'far-right-widened-corner', x: exitHalfW - 0.15, z: halfLenZ - 0.15 },
        { name: 'exit-edge', x: 0, z: halfLenZ - 0.15 }
      ];

      const yaw = node.yaw;
      const toWorld = (lx: number, ly: number, lz: number) =>
        new THREE.Vector3(
          node.position.x + lx * Math.cos(yaw) + lz * Math.sin(yaw),
          node.position.y + ly,
          node.position.z - lx * Math.sin(yaw) + lz * Math.cos(yaw)
        );

      for (const s of samples) {
        // Place the capsule so its bottom sphere centre sits just above the top
        // face, exactly as the physics integrator would.
        const probe = toWorld(s.x, topY + PLAYER_RADIUS - 0.05, s.z);
        const res = col.testSphere(probe, PLAYER_RADIUS);
        expect(
          res.hasContact,
          `${node.type} visible sample "${s.name}" at local (${s.x.toFixed(2)}, ${s.z.toFixed(2)}) is NOT solid`
        ).toBe(true);
        expect(res.normal.y).toBeGreaterThan(0.5);
      }

      // The render geometry must genuinely include the widened corners.
      expect(box.max.x).toBeCloseTo(exitHalfW, 4);
      expect(box.min.x).toBeCloseTo(-exitHalfW, 4);
      expect(box.max.z).toBeCloseTo(halfLenZ, 4);
    }
  });

  it('just outside the visible platform is NOT supported', () => {
    const stepUps = ascentTrack().filter(
      (n) => n.type === RouteNodeType.STEP_UP && n.exitWidth && n.exitWidth > n.dimensions.x
    );

    for (const node of stepUps) {
      const col = new BoxCollider(node);
      const topY = node.dimensions.y * 0.5;
      const exitHalfW = node.exitWidth! * 0.5;

      const outside = [
        { name: 'beyond-right-exit', x: exitHalfW + PLAYER_RADIUS + 0.6, z: node.dimensions.z * 0.5 - 0.15 },
        { name: 'beyond-left-exit', x: -(exitHalfW + PLAYER_RADIUS + 0.6), z: node.dimensions.z * 0.5 - 0.15 },
        { name: 'beyond-entry-narrow', x: exitHalfW - 0.2, z: -(node.dimensions.z * 0.5) - 0.4 }
      ];

      for (const s of outside) {
        const probe = new THREE.Vector3(s.x, topY + PLAYER_RADIUS - 0.05, s.z);
        const res = col.testSphere(probe, PLAYER_RADIUS);
        expect(
          res.hasContact,
          `sample "${s.name}" outside the visible platform is wrongly solid`
        ).toBe(false);
      }
    }
  });

  it('PhysicsWorld grounds the player across the whole widened surface', () => {
    const stepUps = ascentTrack().filter(
      (n) => n.type === RouteNodeType.STEP_UP && n.exitWidth && n.exitWidth > n.dimensions.x
    );

    for (const node of stepUps) {
      const world = new PhysicsWorld();
      world.addCollider(new BoxCollider(node));

      const topY = node.dimensions.y * 0.5;
      const exitHalfW = node.exitWidth! * 0.5;
      const halfLenZ = node.dimensions.z * 0.5;

      const spots = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(exitHalfW - 0.15, 0, halfLenZ - 0.15),
        new THREE.Vector3(-(exitHalfW - 0.15), 0, halfLenZ - 0.15),
        new THREE.Vector3(exitHalfW * 0.7, 0, halfLenZ * 0.5)
      ];

      const yaw = node.yaw;
      for (const local of spots) {
        const worldPos = new THREE.Vector3(
          node.position.x + local.x * Math.cos(yaw) + local.z * Math.sin(yaw),
          node.position.y + topY - 0.05,
          node.position.z - local.x * Math.sin(yaw) + local.z * Math.cos(yaw)
        );
        const res = world.resolveCapsule(worldPos, PLAYER_RADIUS, 1.8);
        expect(
          res.isGrounded,
          `player not grounded at local (${local.x.toFixed(2)}, ${local.z.toFixed(2)}) on widened STEP_UP`
        ).toBe(true);
      }
    }
  });
});