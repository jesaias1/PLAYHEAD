import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BoxCollider } from '../src/physics/Collider';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { RouteGenerator } from '../src/generation/RouteGenerator';
import { RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';
import { TrackAnalysis } from '../src/audio/AudioFeatures';

describe('Ascent Platform Trapezoidal Collider Tests', () => {
  const stepNode: RouteNode = {
    id: 101,
    time: 12.5,
    position: { x: 0, y: 0, z: 0 },
    dimensions: { x: 10.0, y: 2.0, z: 14.0 },
    exitWidth: 16.5,
    yaw: 0,
    pitch: 0,
    roll: 0,
    type: RouteNodeType.STEP_UP,
    intensity: 0.9,
    sectionIndex: 1,
    arcLength: 150.0,
    isSurf: false,
    isBoost: false
  };

  const collider = new BoxCollider(stepNode);
  const yTop = stepNode.dimensions.y * 0.5; // 1.0
  const halfLen = stepNode.dimensions.z * 0.5; // 7.0
  const exitHalfWidth = 16.5 * 0.5; // 8.25
  const radius = 0.4;

  it('correctly configures trapezoid properties and bounding radius', () => {
    expect(collider.isTrapezoid).toBe(true);
    expect(collider.entryHalfWidth).toBe(5.0);
    expect(collider.exitHalfWidth).toBe(8.25);
    const expectedBounding = Math.hypot(8.25, 1.0, 7.0);
    expect(collider.boundingRadius).toBeCloseTo(expectedBounding, 4);
  });

  describe('testSphere contact points across trapezoid surface', () => {
    it('a) detects contact and upward normal at center top', () => {
      const pos = new THREE.Vector3(0, yTop + 0.3, 0);
      const res = collider.testSphere(pos, radius);
      expect(res.hasContact).toBe(true);
      expect(res.normal.y).toBeGreaterThan(0.9);
      expect(res.penetration).toBeCloseTo(0.1, 4);
    });

    it('b) detects contact and upward normal at left widened corner near exit', () => {
      const pos = new THREE.Vector3(-exitHalfWidth + 0.3, yTop + 0.3, halfLen - 0.3);
      const res = collider.testSphere(pos, radius);
      expect(res.hasContact).toBe(true);
      expect(res.normal.y).toBeGreaterThan(0.9);
    });

    it('c) detects contact and upward normal at right widened corner near exit', () => {
      const pos = new THREE.Vector3(+exitHalfWidth - 0.3, yTop + 0.3, halfLen - 0.3);
      const res = collider.testSphere(pos, radius);
      expect(res.hasContact).toBe(true);
      expect(res.normal.y).toBeGreaterThan(0.9);
    });

    it('d) detects contact and upward normal at far-left exit edge', () => {
      const pos = new THREE.Vector3(-exitHalfWidth + 0.1, yTop + 0.3, halfLen);
      const res = collider.testSphere(pos, radius);
      expect(res.hasContact).toBe(true);
      expect(res.normal.y).toBeGreaterThan(0.9);
    });

    it('e) detects contact and upward normal at far-right exit edge', () => {
      const pos = new THREE.Vector3(+exitHalfWidth - 0.1, yTop + 0.3, halfLen);
      const res = collider.testSphere(pos, radius);
      expect(res.hasContact).toBe(true);
      expect(res.normal.y).toBeGreaterThan(0.9);
    });

    it('f) reports NO contact outside the widened exit corner', () => {
      const pos = new THREE.Vector3(+exitHalfWidth + 0.8, yTop + 0.3, halfLen);
      const res = collider.testSphere(pos, radius);
      expect(res.hasContact).toBe(false);
    });

    it('g) reports NO contact outside entry corner where exit width would be if rectangular', () => {
      const pos = new THREE.Vector3(+exitHalfWidth - 0.2, yTop + 0.3, -halfLen);
      const res = collider.testSphere(pos, radius);
      expect(res.hasContact).toBe(false);
    });
  });

  describe('deep-inside penetration handling', () => {
    it('pushes up with normal (0, 1, 0) when sphere penetrates top face', () => {
      const pos = new THREE.Vector3(0, yTop - 0.1, 0);
      const res = collider.testSphere(pos, radius);
      expect(res.hasContact).toBe(true);
      expect(res.normal.y).toBeGreaterThan(0.9);
      expect(res.penetration).toBeCloseTo(radius + 0.1, 4);
    });

    it('pushes up with normal (0, 1, 0) when sphere penetrates widened corner near exit', () => {
      const pos = new THREE.Vector3(exitHalfWidth - 0.5, yTop - 0.1, halfLen - 0.5);
      const res = collider.testSphere(pos, radius);
      expect(res.hasContact).toBe(true);
      expect(res.normal.y).toBeGreaterThan(0.9);
      expect(res.penetration).toBeCloseTo(radius + 0.1, 4);
    });
  });

  describe('PhysicsWorld collision resolution on trapezoid platforms', () => {
    it('grounds player on widened trapezoidal exit corner', () => {
      const world = new PhysicsWorld();
      world.addCollider(collider);

      // Player capsule bottom at (exitHalfWidth - 0.3, yTop, halfLen - 0.3)
      const playerPos = new THREE.Vector3(exitHalfWidth - 0.3, yTop, halfLen - 0.3);
      const res = world.resolveCapsule(playerPos, radius, 1.8);

      expect(res.isGrounded).toBe(true);
      expect(res.groundNormal.y).toBeGreaterThan(0.9);
    });

    it('does not ground player outside the entry boundary', () => {
      const world = new PhysicsWorld();
      world.addCollider(collider);

      // Player positioned outside the narrower entry width
      const playerPos = new THREE.Vector3(exitHalfWidth - 0.2, yTop, -halfLen);
      const res = world.resolveCapsule(playerPos, radius, 1.8);

      expect(res.isGrounded).toBe(false);
    });
  });

  describe('RouteGenerator 1.65x ascent widening consistency', () => {
    const analysis: TrackAnalysis = {
      filename: 'ascent_test_track',
      duration: 60.0,
      bpm: 130,
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

    it('consistently widens EVERY STEP_UP node by 1.65x in BUILDUP and ASCENT sections', () => {
      const track = RouteGenerator.generate(analysis);
      const stepUpNodes = track.route.filter(n => n.type === RouteNodeType.STEP_UP);

      expect(stepUpNodes.length).toBeGreaterThan(0);

      for (const step of stepUpNodes) {
        expect(step.exitWidth).toBeDefined();
        expect(step.exitWidth).toBeCloseTo(step.dimensions.x * 1.65, 4);
        expect(step.exitWidth!).toBeGreaterThan(step.dimensions.x);

        // Verify that BoxCollider correctly recognizes every step as a trapezoid
        const col = new BoxCollider(step);
        expect(col.isTrapezoid).toBe(true);
        expect(col.exitHalfWidth).toBeCloseTo((step.dimensions.x * 1.65) * 0.5, 4);
      }
    });
  });
});
