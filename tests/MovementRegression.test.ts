import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { PlayerController } from '../src/player/PlayerController';
import { CameraController } from '../src/player/CameraController';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { BoxCollider } from '../src/physics/Collider';
import { RouteNodeType } from '../src/generation/GenerationTypes';
import { MovementMath } from '../src/player/MovementMath';
import { DEFAULT_MOVEMENT_CONFIG } from '../src/player/MovementConfig';

describe('Movement Regression & Invariant Tests', () => {
  let camera: THREE.PerspectiveCamera;
  let cameraController: CameraController;
  let physics: PhysicsWorld;
  let player: PlayerController;

  beforeEach(() => {
    camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.1, 1000);
    cameraController = new CameraController(camera, {} as HTMLElement);
    physics = new PhysicsWorld();
    player = new PlayerController(cameraController, physics);
  });

  it('preserves 100% horizontal momentum across landing frame when jump is buffered (Bhop momentum)', () => {
    // Player moving at 14 m/s (560 u/s)
    player.position.set(0, 5, 0);
    player.velocity.set(0, -5, 14.0); // falling towards ground
    player.isGrounded = false;

    // Add ground platform
    physics.addCollider(new BoxCollider({
      id: 0,
      time: 0,
      position: { x: 0, y: 0, z: 0 },
      dimensions: { x: 40, y: 2, z: 40 },
      yaw: 0,
      pitch: 0,
      roll: 0,
      type: RouteNodeType.RUNWAY,
      intensity: 0,
      sectionIndex: 0,
      arcLength: 0,
      isSurf: false,
      isBoost: false
    }));

    // Buffer jump input
    (player as any).keys.jump = true;
    (player as any).jumpBufferTimer = 0.15;

    // Advance ticks until landing
    const dt = 1 / 120;
    for (let tick = 0; tick < 20; tick++) {
      const prevHorizSpeed = Math.sqrt(player.velocity.x * player.velocity.x + player.velocity.z * player.velocity.z);
      player.updateFixed(dt);
      const currHorizSpeed = Math.sqrt(player.velocity.x * player.velocity.x + player.velocity.z * player.velocity.z);

      // On landing, ground friction MUST NOT have bled incoming speed
      if (player.velocity.y > 0) {
        // Jump triggered on this tick!
        expect(currHorizSpeed).toBeGreaterThanOrEqual(prevHorizSpeed - 0.001);
        break;
      }
    }
  });

  it('strictly conserves horizontal velocity in free flight with no input (No-input air)', () => {
    player.position.set(0, 10, 0);
    player.velocity.set(5.0, 8.0, 12.0);
    player.isGrounded = false;

    const initialHorizSpeed = Math.sqrt(player.velocity.x * player.velocity.x + player.velocity.z * player.velocity.z);

    const dt = 1 / 120;
    // Simulate 30 airborne ticks with no collisions
    for (let i = 0; i < 30; i++) {
      player.updateFixed(dt);
    }

    const currentHorizSpeed = Math.sqrt(player.velocity.x * player.velocity.x + player.velocity.z * player.velocity.z);
    expect(currentHorizSpeed).toBeCloseTo(initialHorizSpeed, 5);
  });

  it('proves correct strafe combination yields greater trajectory curvature and speed than wrong combination', () => {
    // Setup two identical players
    const pCorrect = new PlayerController(new CameraController(camera, {} as HTMLElement), new PhysicsWorld());
    const pWrong = new PlayerController(new CameraController(camera, {} as HTMLElement), new PhysicsWorld());

    // Both start at (0, 10, 0) facing +Z (yaw = PI) with forward speed 14 m/s
    pCorrect.setPosition({ x: 0, y: 10, z: 0 });
    pCorrect.velocity.set(0, 8.8, 14.0);
    pCorrect.setOrientation(Math.PI);

    pWrong.setPosition({ x: 0, y: 10, z: 0 });
    pWrong.velocity.set(0, 8.8, 14.0);
    pWrong.setOrientation(Math.PI);

    const dt = 1 / 120;
    // Simulate 60 airborne ticks
    for (let i = 0; i < 60; i++) {
      // Correct: Hold Right (D) and rotate mouse RIGHT (deltaX > 0)
      (pCorrect as any).keys.right = true;
      pCorrect.cameraController.applyMouseDelta(+4, 0);
      pCorrect.updateFixed(dt);

      // Wrong: Hold Right (D) and rotate mouse LEFT (deltaX < 0)
      (pWrong as any).keys.right = true;
      pWrong.cameraController.applyMouseDelta(-4, 0);
      pWrong.updateFixed(dt);
    }

    const speedCorrect = pCorrect.velocity.length();
    const speedWrong = pWrong.velocity.length();

    // Correct strafing must yield higher speed
    expect(speedCorrect).toBeGreaterThan(speedWrong);

    // Correct strafe lateral displacement must be significantly greater than wrong
    expect(Math.abs(pCorrect.position.x)).toBeGreaterThan(Math.abs(pWrong.position.x));
  });

  it('guarantees deterministic simulation given identical fixed-step input sequences', () => {
    const p1 = new PlayerController(new CameraController(camera, {} as HTMLElement), new PhysicsWorld());
    const p2 = new PlayerController(new CameraController(camera, {} as HTMLElement), new PhysicsWorld());

    p1.setPosition({ x: 0, y: 5, z: 0 });
    p1.setOrientation(Math.PI);

    p2.setPosition({ x: 0, y: 5, z: 0 });
    p2.setOrientation(Math.PI);

    const dt = 1 / 120;
    for (let i = 0; i < 100; i++) {
      const pressW = i % 20 < 15;
      const pressSpace = i % 40 === 0;
      (p1 as any).keys.forward = pressW;
      (p1 as any).keys.jump = pressSpace;
      p1.cameraController.applyMouseDelta(i % 5, 0);
      p1.updateFixed(dt);

      (p2 as any).keys.forward = pressW;
      (p2 as any).keys.jump = pressSpace;
      p2.cameraController.applyMouseDelta(i % 5, 0);
      p2.updateFixed(dt);
    }

    expect(p1.position.x).toBeCloseTo(p2.position.x, 6);
    expect(p1.position.y).toBeCloseTo(p2.position.y, 6);
    expect(p1.position.z).toBeCloseTo(p2.position.z, 6);
    expect(p1.velocity.x).toBeCloseTo(p2.velocity.x, 6);
    expect(p1.velocity.y).toBeCloseTo(p2.velocity.y, 6);
    expect(p1.velocity.z).toBeCloseTo(p2.velocity.z, 6);
  });

  it('guarantees zero NaN or Infinity after 500 extended strafe ticks', () => {
    player.setPosition({ x: 0, y: 100, z: 0 });
    player.velocity.set(0, 0, 14.0);
    player.setOrientation(Math.PI);

    const dt = 1 / 120;
    for (let i = 0; i < 500; i++) {
      (player as any).keys.left = i % 2 === 0;
      (player as any).keys.right = i % 2 === 1;
      player.cameraController.applyMouseDelta((i % 2 === 0 ? 1 : -1) * 10, 0);
      player.updateFixed(dt);

      expect(Number.isFinite(player.position.x)).toBe(true);
      expect(Number.isFinite(player.position.y)).toBe(true);
      expect(Number.isFinite(player.position.z)).toBe(true);
      expect(Number.isFinite(player.velocity.x)).toBe(true);
      expect(Number.isFinite(player.velocity.y)).toBe(true);
      expect(Number.isFinite(player.velocity.z)).toBe(true);
    }
  });
});
