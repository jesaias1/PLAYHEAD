/**
 * SurfState & Surf Physics for PLAYHEAD
 * Implements authentic FPS surf mechanics:
 * - Precise surface classification (Walkable vs Surf vs Wall)
 * - Pure tangential momentum preservation
 * - Downhill gravitational acceleration along slope tangent
 * - Air-strafe authority into ramp for speed generation without sticking
 * - Anti-chatter contact stabilization
 */

import * as THREE from 'three';
import { MovementMath } from './MovementMath';

export enum SurfaceClassification {
  WALKABLE_GROUND = 'WALKABLE_GROUND',
  SURF_SURFACE = 'SURF_SURFACE',
  WALL = 'WALL',
  AIR = 'AIR'
}

export interface SurfTelemetry {
  isSurfing: boolean;
  surfaceAngleDeg: number;
  entrySpeed: number;
  currentSpeed: number;
  tangentialSpeed: number;
  surfNormal: THREE.Vector3;
  contactPoint: THREE.Vector3;
  surfSide: 'LEFT' | 'RIGHT' | 'NONE';
  timeSurfing: number;
}

export class SurfState {
  public isSurfing = false;
  public surfNormal = new THREE.Vector3(0, 1, 0);
  public contactPoint = new THREE.Vector3();
  public entrySpeed = 0;
  public tangentialSpeed = 0;
  public surfaceAngleDeg = 0;
  public surfSide: 'LEFT' | 'RIGHT' | 'NONE' = 'NONE';
  public timeSurfing = 0;

  // Anti-chatter: grace period in seconds to prevent state flapping over micro-seams
  private contactGraceTimer = 0;
  private readonly CONTACT_GRACE_DURATION = 0.05; // ~3-4 ticks at 60Hz

  /**
   * Classify surface normal
   */
  public static classifySurface(normal: THREE.Vector3, isExplicitSurf = false): SurfaceClassification {
    const ny = normal.y;

    // Normal pointing steeply upward (> 45.6 degrees from horizontal)
    if (ny >= 0.70 && !isExplicitSurf) {
      return SurfaceClassification.WALKABLE_GROUND;
    }

    // Surf surface: either explicitly tagged as surf ramp, or steep slope between ~45° and ~79°
    if (isExplicitSurf || (ny >= 0.18 && ny < 0.70)) {
      return SurfaceClassification.SURF_SURFACE;
    }

    // Near-vertical wall (ny < 0.18, angle > ~79.6 degrees)
    return SurfaceClassification.WALL;
  }

  /**
   * Update surf physics step
   */
  public updateSurfPhysics(
    velocity: THREE.Vector3,
    wishDir: THREE.Vector3,
    hasInput: boolean,
    cameraForward: THREE.Vector3,
    contactNormal: THREE.Vector3,
    hasPhysicalContact: boolean,
    gravity: number,
    airAcceleration: number,
    maxAirWishSpeed: number,
    dt: number
  ): void {
    if (hasPhysicalContact) {
      this.contactGraceTimer = this.CONTACT_GRACE_DURATION;
      this.surfNormal.copy(contactNormal);

      if (!this.isSurfing) {
        // Entering surf state
        this.isSurfing = true;
        this.timeSurfing = 0;
        this.entrySpeed = velocity.length();
      }
    } else {
      this.contactGraceTimer -= dt;
      if (this.contactGraceTimer <= 0) {
        this.isSurfing = false;
        this.surfSide = 'NONE';
        this.timeSurfing = 0;
        return;
      }
    }

    this.timeSurfing += dt;

    // 1. Calculate surface angle relative to horizontal plane
    const angleRad = Math.acos(Math.max(-1, Math.min(1, this.surfNormal.y)));
    this.surfaceAngleDeg = (angleRad * 180) / Math.PI;

    // 2. Determine surf side (is ramp to the player's left or right?)
    const crossY = cameraForward.x * this.surfNormal.z - cameraForward.z * this.surfNormal.x;
    if (crossY > 0.1) {
      this.surfSide = 'LEFT';
    } else if (crossY < -0.1) {
      this.surfSide = 'RIGHT';
    } else {
      this.surfSide = 'NONE';
    }

    // 3. Clip velocity moving into the ramp surface (preserve tangential velocity)
    const intoNormal = velocity.dot(this.surfNormal);
    if (intoNormal < 0) {
      // Zero the velocity component penetrating into the surface
      velocity.addScaledVector(this.surfNormal, -intoNormal);
    }

    // 4. Project gravity onto the slope tangent plane (pulls player downhill along the ramp)
    const grav = new THREE.Vector3(0, -gravity, 0);
    const gravDotNorm = grav.dot(this.surfNormal);
    const slopeGravity = grav.clone().addScaledVector(this.surfNormal, -gravDotNorm);
    velocity.addScaledVector(slopeGravity, dt);

    // 5. Authentic Source Air-Acceleration on Surf Ramp:
    // When player presses wishDir into/along ramp, air acceleration increases speed.
    // Clipping keeps them on the tangent plane, generating forward/downhill drive!
    if (hasInput) {
      MovementMath.accelerate(
        velocity,
        wishDir,
        maxAirWishSpeed * 2.5,
        airAcceleration,
        dt
      );

      // Re-clip against normal so pushing into ramp doesn't sink into it
      const intoNormalAfterInput = velocity.dot(this.surfNormal);
      if (intoNormalAfterInput < 0) {
        velocity.addScaledVector(this.surfNormal, -intoNormalAfterInput);
      }
    }

    // 6. Record tangential speed
    const normComponent = velocity.dot(this.surfNormal);
    const tangVel = velocity.clone().addScaledVector(this.surfNormal, -normComponent);
    this.tangentialSpeed = tangVel.length();
  }

  public reset(): void {
    this.isSurfing = false;
    this.timeSurfing = 0;
    this.entrySpeed = 0;
    this.tangentialSpeed = 0;
    this.surfaceAngleDeg = 0;
    this.surfSide = 'NONE';
    this.contactGraceTimer = 0;
  }

  public getTelemetry(): SurfTelemetry {
    return {
      isSurfing: this.isSurfing,
      surfaceAngleDeg: this.surfaceAngleDeg,
      entrySpeed: this.entrySpeed,
      currentSpeed: this.tangentialSpeed,
      tangentialSpeed: this.tangentialSpeed,
      surfNormal: this.surfNormal.clone(),
      contactPoint: this.contactPoint.clone(),
      surfSide: this.surfSide,
      timeSurfing: this.timeSurfing
    };
  }
}
