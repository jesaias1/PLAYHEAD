/**
 * Pure movement physics calculations for Source/Quake style movement
 */

import * as THREE from 'three';

export class MovementMath {
  /**
   * Apply ground friction (decelerates velocity smoothly when on walkable ground)
   */
  public static applyFriction(
    velocity: THREE.Vector3,
    friction: number,
    stopSpeed: number,
    dt: number
  ): void {
    const speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    if (speed < 0.0001) {
      velocity.x = 0;
      velocity.z = 0;
      return;
    }

    const control = speed < stopSpeed ? stopSpeed : speed;
    const drop = control * friction * dt;

    let newSpeed = speed - drop;
    if (newSpeed < 0) newSpeed = 0;

    const ratio = newSpeed / speed;
    velocity.x *= ratio;
    velocity.z *= ratio;
  }

  /**
   * Classic Source/Quake acceleration vector addition
   * Only adds speed along wishDir up to wishSpeed; if moving perpendicular, allows unbounded strafe acceleration!
   * Returns the speed added this tick.
   */
  public static accelerate(
    velocity: THREE.Vector3,
    wishDir: THREE.Vector3,
    wishSpeed: number,
    accel: number,
    dt: number
  ): number {
    const currentSpeed = velocity.x * wishDir.x + velocity.z * wishDir.z;
    const addSpeed = wishSpeed - currentSpeed;

    if (addSpeed <= 0) return 0;

    let accelSpeed = accel * wishSpeed * dt;
    if (accelSpeed > addSpeed) {
      accelSpeed = addSpeed;
    }

    velocity.x += wishDir.x * accelSpeed;
    velocity.z += wishDir.z * accelSpeed;

    return accelSpeed;
  }

  /**
   * Supplemental air steering: smoothly turns horizontal velocity toward wishDir
   * without adding unearned speed (preserves horizontal speed magnitude).
   * Inverse-speed authority: responsive at low speed, high momentum inertia at high speed.
   */
  public static applyAirSteering(
    velocity: THREE.Vector3,
    wishDir: THREE.Vector3,
    steerRate: number,
    dt: number
  ): void {
    if (steerRate <= 0) return;
    if (wishDir.lengthSq() < 0.01) return;

    const horizSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    if (horizSpeed < 0.5) return;

    // Turn factor scales inversely with speed: higher speed = larger turning radius
    const effectiveTurnRate = (steerRate / Math.max(horizSpeed, 10.0)) * dt;

    const currentDirX = velocity.x / horizSpeed;
    const currentDirZ = velocity.z / horizSpeed;

    const newDirX = currentDirX + (wishDir.x - currentDirX) * effectiveTurnRate;
    const newDirZ = currentDirZ + (wishDir.z - currentDirZ) * effectiveTurnRate;
    const newDirLen = Math.sqrt(newDirX * newDirX + newDirZ * newDirZ);

    if (newDirLen > 0.0001) {
      velocity.x = (newDirX / newDirLen) * horizSpeed;
      velocity.z = (newDirZ / newDirLen) * horizSpeed;
    }
  }

  /**
   * Pure read-only strafe telemetry calculation for HUD and visualizer ribbons.
   * Does NOT modify player velocity or physics state.
   */
  public static calculateStrafeTelemetry(
    velocity: THREE.Vector3,
    wishDir: THREE.Vector3,
    accelAdded: number
  ): {
    strafeAngleDeg: number;
    efficiency: number;
    rating: 'OPTIMAL' | 'GOOD' | 'WEAK' | 'NONE';
  } {
    const horizSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    if (horizSpeed < 0.1 || wishDir.lengthSq() < 0.01) {
      return { strafeAngleDeg: 90, efficiency: 0, rating: 'NONE' };
    }

    const dot = (velocity.x * wishDir.x + velocity.z * wishDir.z) / horizSpeed;
    const clampedDot = Math.max(-1.0, Math.min(1.0, dot));
    const angleDeg = (Math.acos(clampedDot) * 180.0) / Math.PI;
    const deltaFromPerp = Math.abs(angleDeg - 90.0);

    let efficiency = 0.0;
    let rating: 'OPTIMAL' | 'GOOD' | 'WEAK' | 'NONE' = 'NONE';

    if (accelAdded > 0) {
      if (deltaFromPerp <= 15.0) {
        efficiency = 1.0;
        rating = 'OPTIMAL';
      } else if (deltaFromPerp <= 30.0) {
        efficiency = 0.75;
        rating = 'GOOD';
      } else {
        efficiency = 0.4;
        rating = 'WEAK';
      }
    }

    return {
      strafeAngleDeg: angleDeg,
      efficiency,
      rating
    };
  }

  /**
   * Surfing physics: project velocity and gravity onto slope tangent plane
   */
  public static applySurf(
    velocity: THREE.Vector3,
    surfNormal: THREE.Vector3,
    gravity: number,
    dt: number
  ): void {
    // 1. Clip velocity to remove component penetrating into the surface
    const intoNormal = velocity.dot(surfNormal);
    if (intoNormal < 0) {
      velocity.addScaledVector(surfNormal, -intoNormal * 1.05);
    }

    // 2. Project gravity downward onto the slope
    const grav = new THREE.Vector3(0, -gravity, 0);
    const gravNormal = grav.dot(surfNormal);
    const slopeGravity = grav.clone().addScaledVector(surfNormal, -gravNormal);

    velocity.addScaledVector(slopeGravity, dt);
  }
}
