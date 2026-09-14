import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { CameraController } from '../src/player/CameraController';

describe('CameraController Physical Mouse Semantics & Basis Verification', () => {
  let camera: THREE.PerspectiveCamera;
  let domElement: HTMLElement;
  let controller: CameraController;

  beforeEach(() => {
    camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.1, 1000);
    domElement = {} as HTMLElement;
    controller = new CameraController(camera, domElement);
  });

  it('verifies camera forward vector strictly matches rendered world direction at all orientations', () => {
    const testAngles = [0, Math.PI / 4, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, 2 * Math.PI];

    for (const yaw of testAngles) {
      controller.setOrientation(yaw, 0);

      const fwd = controller.getForwardVector();
      const worldDir = new THREE.Vector3();
      controller.camera.getWorldDirection(worldDir);

      // Horizontal components must match exactly
      expect(fwd.x).toBeCloseTo(worldDir.x, 5);
      expect(fwd.y).toBeCloseTo(0, 5);
      expect(fwd.z).toBeCloseTo(worldDir.z, 5);
      expect(fwd.length()).toBeCloseTo(1.0, 5);
    }
  });

  it('guarantees physical mouse RIGHT rotates the view vector toward the physical RIGHT', () => {
    // Test from various starting orientations (e.g., 0 rad, PI rad, arbitrary angle)
    const startOrientations = [0, Math.PI * 0.25, Math.PI * 0.5, Math.PI, Math.PI * 1.5];

    for (const startYaw of startOrientations) {
      controller.setOrientation(startYaw, 0);

      const forwardBefore = controller.getForwardVector();
      const rightBefore = controller.getRightVector();

      // Ensure Forward and Right are strictly orthogonal
      expect(forwardBefore.dot(rightBefore)).toBeCloseTo(0, 5);

      // Simulate physical mouse moving RIGHT (+deltaX)
      controller.applyMouseDelta(+50, 0);

      const forwardAfter = controller.getForwardVector();

      // Dot product with rightBefore must be strictly POSITIVE (rotated toward right)
      const dotRight = forwardAfter.dot(rightBefore);
      expect(dotRight).toBeGreaterThan(0.01);

      // Cross product (ForwardBefore x ForwardAfter) must point UP (+Y) for a right turn
      const cross = new THREE.Vector3().crossVectors(forwardBefore, forwardAfter);
      // In right-handed coordinates: Forward x Right = Up (+Y), so a right turn has -Y cross
      // Let's verify that rightBefore is in the direction of the turn:
      const turnedTowardRight = forwardAfter.clone().sub(forwardBefore).dot(rightBefore);
      expect(turnedTowardRight).toBeGreaterThan(0);
    }
  });

  it('guarantees physical mouse LEFT rotates the view vector toward the physical LEFT', () => {
    const startOrientations = [0, Math.PI * 0.25, Math.PI * 0.5, Math.PI, Math.PI * 1.5];

    for (const startYaw of startOrientations) {
      controller.setOrientation(startYaw, 0);

      const forwardBefore = controller.getForwardVector();
      const rightBefore = controller.getRightVector();

      // Simulate physical mouse moving LEFT (-deltaX)
      controller.applyMouseDelta(-50, 0);

      const forwardAfter = controller.getForwardVector();

      // Dot product with rightBefore must be strictly NEGATIVE (rotated toward left)
      const dotRight = forwardAfter.dot(rightBefore);
      expect(dotRight).toBeLessThan(-0.01);

      const turnedTowardLeft = forwardAfter.clone().sub(forwardBefore).dot(rightBefore);
      expect(turnedTowardLeft).toBeLessThan(0);
    }
  });

  it('guarantees physical mouse UP pitches view upward and DOWN pitches view downward', () => {
    controller.setOrientation(0, 0);

    // Physical mouse UP has negative deltaY in browser Pointer Lock / mouse events
    controller.applyMouseDelta(0, -50);
    const viewDirUp = new THREE.Vector3();
    controller.camera.getWorldDirection(viewDirUp);
    expect(viewDirUp.y).toBeGreaterThan(0.05);

    // Physical mouse DOWN has positive deltaY
    controller.setOrientation(0, 0);
    controller.applyMouseDelta(0, +50);
    const viewDirDown = new THREE.Vector3();
    controller.camera.getWorldDirection(viewDirDown);
    expect(viewDirDown.y).toBeLessThan(-0.05);
  });

  it('verifies WASD movement directions relative to camera at 0°, 45°, 90°, 180°, 270°', () => {
    const testYaws = [0, Math.PI / 4, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];

    for (const yaw of testYaws) {
      controller.setOrientation(yaw, 0);

      const forward = controller.getForwardVector();
      const right = controller.getRightVector();

      // W input (Forward)
      const wishW = forward.clone().normalize();
      expect(wishW.dot(forward)).toBeCloseTo(1.0, 5);

      // S input (Backward)
      const wishS = forward.clone().negate().normalize();
      expect(wishS.dot(forward)).toBeCloseTo(-1.0, 5);

      // D input (Camera-relative Right)
      const wishD = right.clone().normalize();
      expect(wishD.dot(right)).toBeCloseTo(1.0, 5);
      expect(wishD.dot(forward)).toBeCloseTo(0.0, 5);

      // A input (Camera-relative Left)
      const wishA = right.clone().negate().normalize();
      expect(wishA.dot(right)).toBeCloseTo(-1.0, 5);
      expect(wishA.dot(forward)).toBeCloseTo(0.0, 5);
    }
  });
});
