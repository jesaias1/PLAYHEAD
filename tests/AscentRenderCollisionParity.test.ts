import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RouteGenerator } from '../src/generation/RouteGenerator';
import { BoxCollider } from '../src/physics/Collider';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';
import {
  createPlatformGeometry,
  getPlatformCenterOffsetAtLocalZ,
  getPlatformHalfWidthAtLocalZ,
  getPlatformLateralEnvelope
} from '../src/generation/PlatformShape';
import { TrackAnalysis } from '../src/audio/AudioFeatures';

/**
 * RENDER SHAPE == PLAYABLE SHAPE
 *
 * Widened/flared ascent platforms must be supported by collision across their
 * ENTIRE visible top surface. A previous bug left the far corners visually
 * present but non-solid, so the player fell through them.
 *
 * These tests consume the same authoritative platform footprint as the renderer
 * and probe the collider at representative visible and non-visible points.
 */
describe('AscentRenderCollisionParity', () => {
  const PLAYER_RADIUS = 0.35;

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
      const geom = createPlatformGeometry(node);
      const box = geom.boundingBox!;
      const col = new BoxCollider(node);

      const topY = node.dimensions.y * 0.5; // render geometry is centred on origin
      const halfLenZ = node.dimensions.z * 0.5;
      const exitHalfW = node.exitWidth! * 0.5;

      // Sample the visible top surface in the platform's local frame, then
      // convert to world space (the collider API is world-space).
      const nearZ = -halfLenZ * 0.65;
      const farZ = halfLenZ - 0.15;
      const nearHalfW = getPlatformHalfWidthAtLocalZ(node, nearZ);
      const farHalfW = getPlatformHalfWidthAtLocalZ(node, farZ);
      const nearCenterX = getPlatformCenterOffsetAtLocalZ(node, nearZ);
      const farCenterX = getPlatformCenterOffsetAtLocalZ(node, farZ);
      const samples: Array<{ name: string; x: number; z: number }> = [
        { name: 'centre', x: 0, z: 0 },
        { name: 'near-left', x: nearCenterX - nearHalfW + 0.15, z: nearZ },
        { name: 'near-right', x: nearCenterX + nearHalfW - 0.15, z: nearZ },
        { name: 'far-middle', x: farCenterX, z: farZ },
        { name: 'far-left-widened-corner', x: farCenterX - farHalfW + 0.15, z: farZ },
        { name: 'far-right-widened-corner', x: farCenterX + farHalfW - 0.15, z: farZ },
        { name: 'exit-edge', x: node.exitLateralOffset ?? 0, z: halfLenZ - 0.04 }
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
      const lateral = getPlatformLateralEnvelope(node);
      expect(box.max.x).toBeCloseTo(lateral.maxX, 4);
      expect(box.min.x).toBeCloseTo(lateral.minX, 4);
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

      const farZ = node.dimensions.z * 0.5 - 0.15;
      const farHalfW = getPlatformHalfWidthAtLocalZ(node, farZ);
      const farCenterX = getPlatformCenterOffsetAtLocalZ(node, farZ);
      const outside = [
        { name: 'just-outside-right', x: farCenterX + farHalfW + PLAYER_RADIUS + 0.15, z: farZ },
        { name: 'just-outside-left', x: farCenterX - farHalfW - PLAYER_RADIUS - 0.15, z: farZ }
      ];

      for (const s of outside) {
        const yaw = node.yaw;
        const probe = new THREE.Vector3(
          node.position.x + s.x * Math.cos(yaw) + s.z * Math.sin(yaw),
          node.position.y + topY + PLAYER_RADIUS - 0.05,
          node.position.z - s.x * Math.sin(yaw) + s.z * Math.cos(yaw)
        );
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
      const farZ = halfLenZ - 0.15;
      const farCenterX = getPlatformCenterOffsetAtLocalZ(node, farZ);
      const farHalfW = getPlatformHalfWidthAtLocalZ(node, farZ);

      const spots = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(farCenterX + farHalfW - 0.15, 0, farZ),
        new THREE.Vector3(farCenterX - farHalfW + 0.15, 0, farZ),
        new THREE.Vector3(getPlatformCenterOffsetAtLocalZ(node, halfLenZ * 0.5) + exitHalfW * 0.55, 0, halfLenZ * 0.5)
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
