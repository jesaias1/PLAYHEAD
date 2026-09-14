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
    if (ny >= 0.70) {
      // Explicit surf ramps are slick on all non-vertical faces (cannot walk/stand on them)
      if (isExplicitSurf) {
        return SurfaceClassification.SURF_SURFACE;
      }
      return SurfaceClassification.WALKABLE_GROUND;
    }

    // Surf surface: steep slope between ~45.6° and ~79.6° (ny between 0.18 and 0.70)
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

    // 3. Slope Tangent Vectors
    // Downhill direction: projection of world downward gravity onto the slope plane
    const grav = new THREE.Vector3(0, -gravity, 0);
    const gravDotNorm = grav.dot(this.surfNormal);
    const slopeGravity = grav.clone().addScaledVector(this.surfNormal, -gravDotNorm);

    const downhillDir = slopeGravity.clone();
    if (downhillDir.lengthSq() > 1e-6) {
      downhillDir.normalize();
    } else {
      downhillDir.set(0, -1, 0);
    }
    const uphillDir = downhillDir.clone().negate();

    // 4. Clip inward velocity penetrating into the surface
    const intoNormal = velocity.dot(this.surfNormal);
    if (intoNormal < 0) {
      velocity.addScaledVector(this.surfNormal, -intoNormal);
    }

    // 5. Apply Downhill Slope Gravity (accelerates player downhill along slope face)
    // In Counter-Strike, gravity always pulls players down steep slopes so they cannot hover or crawl
    velocity.addScaledVector(slopeGravity, dt);

    // Record uphill velocity before input
    const uphillSpeedBeforeInput = Math.max(0, velocity.dot(uphillDir));

    // 6. Authentic Counter-Strike Air Acceleration on Surf Ramp:
    // - In CS, players hold strafe (A or D) into the ramp to hug the surface and build speed.
    // - Players CANNOT walk or crawl uphill on the steep slope with W.
    if (hasInput) {
      // Project wish direction onto the slope tangent plane
      const wishTangent = wishDir.clone();
      const wishDotNorm = wishTangent.dot(this.surfNormal);
      wishTangent.addScaledVector(this.surfNormal, -wishDotNorm);

      // Strictly eliminate any uphill component from wish direction
      const wishUphill = wishTangent.dot(uphillDir);
      if (wishUphill > 0) {
        wishTangent.addScaledVector(uphillDir, -wishUphill);
      }

      if (wishTangent.lengthSq() > 1e-4) {
        wishTangent.normalize();

        // Authentic CS air wish speed (~2.0 m/s; prevents ground-speed climbing)
        const surfWishSpeed = Math.min(maxAirWishSpeed, 2.5);

        MovementMath.accelerate(
          velocity,
          wishTangent,
          surfWishSpeed,
          airAcceleration,
          dt
        );
      }

      // Re-clip against normal so pushing into ramp stays strictly on surface
      const intoNormalAfterInput = velocity.dot(this.surfNormal);
      if (intoNormalAfterInput < 0) {
        velocity.addScaledVector(this.surfNormal, -intoNormalAfterInput);
      }

      // STRICT CS SURF INVARIANT:
      // Normal clipping or input must NEVER increase uphill velocity beyond pre-input momentum!
      // This completely prevents the "crawling up the steep ramp" bug.
      const currentUphillSpeed = velocity.dot(uphillDir);
      if (currentUphillSpeed > uphillSpeedBeforeInput) {
        velocity.addScaledVector(uphillDir, uphillSpeedBeforeInput - currentUphillSpeed);
      }
    }

    // 7. Record tangential speed
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
