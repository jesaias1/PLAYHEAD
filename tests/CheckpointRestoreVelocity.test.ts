import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PlayerController } from '../src/player/PlayerController';
import { CameraController } from '../src/player/CameraController';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';

function makePlayer(): { player: PlayerController; camera: CameraController } {
  const camera = new THREE.PerspectiveCamera();
  const cameraController = new CameraController(camera);
  const physics = new PhysicsWorld();
  const player = new PlayerController(cameraController, physics);
  return { player, camera: cameraController };
}

describe('Checkpoint restore resume velocity', () => {
  it('fires FORWARD along the camera forward vector, not backward', () => {
    const { player, camera } = makePlayer();
    const yaw = calculateLookYaw({ x: 0, z: 0 }, { x: 10, z: 20 });
    player.setOrientation(yaw);
    camera.setOrientation(yaw);

    player.applyRestoreVelocity(yaw, PlayerController.CHECKPOINT_RESTORE_SPEED_UNITS);

    const forward = camera.getForwardVector();
    const v = player.velocity.clone();
    v.y = 0;
    const horizontal = v.clone().normalize();
    const dot = horizontal.dot(forward.normalize());
    // A backward sign would make this negative; it must be ~+1.
    expect(dot).toBeGreaterThan(0.999);
  });

  it('applies the exact display speed horizontally with zero Y', () => {
    const { player } = makePlayer();
    const yaw = 0.7;
    player.applyRestoreVelocity(yaw, PlayerController.CHECKPOINT_RESTORE_SPEED_UNITS);
    const expectedMps = PlayerController.CHECKPOINT_RESTORE_SPEED_UNITS / player.config.speedUnitScale;
    expect(player.velocity.y).toBe(0);
    expect(Math.hypot(player.velocity.x, player.velocity.z)).toBeCloseTo(expectedMps, 6);
    // ~12.5 m/s at the default speedUnitScale.
    expect(expectedMps).toBeCloseTo(12.5, 1);
  });

  it('matches CameraController.getForwardVector() component for component', () => {
    const { player, camera } = makePlayer();
    const yaw = -2.1;
    player.applyRestoreVelocity(yaw, PlayerController.CHECKPOINT_RESTORE_SPEED_UNITS);
    camera.setOrientation(yaw);
    const forward = camera.getForwardVector();
    expect(Math.sign(player.velocity.x)).toBe(Math.sign(forward.x));
    expect(Math.sign(player.velocity.z)).toBe(Math.sign(forward.z));
  });
});

// Same convention as Game.ts / math.ts.
function calculateLookYaw(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}
