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
   * Implements authentic Counter-Strike: Source / CS 1.6 surfing:
   * - Ramp on LEFT: hold A (strafe into ramp) to stay on, hold height, and build speed
   * - Ramp on RIGHT: hold D (strafe into ramp) to stay on, hold height, and build speed
   * - Release keys (no strafe): downhill slope gravity pulls player down the ramp
   * - Press wrong strafe key: accelerates away from ramp, peeling off into air
   * - Forward W input: cannot crawl or walk up steep slope from a dead stop
   * - Zero surface friction: 100% momentum conservation + carving speed boost
   */
  public updateSurfPhysics(
    velocity: THREE.Vector3,
    wishDir: THREE.Vector3,
    hasInput: boolean,
    cameraForward: THREE.Vector3,
    cameraRight: THREE.Vector3 | undefined,
    contactNormal: THREE.Vector3,
    hasPhysicalContact: boolean,
    gravity: number,
    airAcceleration: number,
    _maxAirWishSpeed: number,
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
    const normal = this.surfNormal.clone().normalize();
    const angleRad = Math.acos(Math.max(-1, Math.min(1, normal.y)));
    this.surfaceAngleDeg = (angleRad * 180) / Math.PI;

    // 2. Camera right vector
    const right = cameraRight
      ? cameraRight.clone().normalize()
      : new THREE.Vector3(-cameraForward.z, 0, cameraForward.x).normalize();

    // 3. Determine surf side (is ramp to the player's LEFT or RIGHT?)
    // In FPS coordinates, normal points outward from ramp towards player.
    // Ramp on player's LEFT  => normal points towards player's RIGHT => normal.dot(right) > 0
    // Ramp on player's RIGHT => normal points towards player's LEFT  => normal.dot(right) < 0
    const normalDotRight = normal.dot(right);
    if (normalDotRight > 0.05) {
      this.surfSide = 'LEFT';
    } else if (normalDotRight < -0.05) {
      this.surfSide = 'RIGHT';
    } else {
      this.surfSide = 'NONE';
    }

    // 4. Slope Tangent & Gravity Decomposition
    // Downhill direction: projection of world downward gravity onto the ramp plane
    const grav = new THREE.Vector3(0, -gravity, 0);
    const gravDotNorm = grav.dot(normal);
    const slopeGravity = grav.clone().addScaledVector(normal, -gravDotNorm);

    const downhillDir = slopeGravity.clone();
    if (downhillDir.lengthSq() > 1e-6) {
      downhillDir.normalize();
    } else {
      downhillDir.set(0, -1, 0);
    }
    const uphillDir = downhillDir.clone().negate();

    // 5. Normal Clipping (Zero Penetration / Deflection)
    const intoNormal = velocity.dot(normal);
    if (intoNormal < 0) {
      velocity.addScaledVector(normal, -intoNormal);
    }

    // 6. Apply Downhill Slope Gravity
    // Downhill gravity always pulls the player down steep slopes unless counterbalanced by strafing into the ramp
    velocity.addScaledVector(slopeGravity, dt);

    // 7. Authentic Counter-Strike Surf Strafe Authority & Speed Generation
    // CS Surf Standard parameters (scaled to TRACKRUN units)
    const SURF_AIR_ACCEL = 150.0; // standard CS:S surf sv_airaccelerate
    const SURF_WISH_SPEED = 2.0;  // equivalent to CS:S 30 u/s wishspeed

    if (hasInput && wishDir.lengthSq() > 1e-4) {
      const wish = wishDir.clone().normalize();
      const strafeComp = wish.dot(right);

      // In CS surfing:
      // - Ramp on LEFT: hold A (strafe left, strafeComp < -0.1) to push into ramp
      // - Ramp on RIGHT: hold D (strafe right, strafeComp > 0.1) to push into ramp
      const isStrafingIntoRamp =
        (this.surfSide === 'LEFT' && strafeComp < -0.1) ||
        (this.surfSide === 'RIGHT' && strafeComp > 0.1);

      const isStrafingAwayFromRamp =
        (this.surfSide === 'LEFT' && strafeComp > 0.1) ||
        (this.surfSide === 'RIGHT' && strafeComp < -0.1);

      if (isStrafingIntoRamp) {
        // Player is holding the correct into-ramp strafe key (A for left ramp, D for right ramp)
        // 1. Counterbalance downhill slope gravity to stay on the ramp at steady height!
        const holdStrength = Math.min(1.0, Math.abs(strafeComp));
        velocity.addScaledVector(slopeGravity, -holdStrength * dt);

        // 2. Air Acceleration along ramp surface (Source AirAccelerate)
        const wishOnRamp = wish.clone();
        wishOnRamp.addScaledVector(normal, -wishOnRamp.dot(normal));
        if (wishOnRamp.lengthSq() > 1e-4) {
          wishOnRamp.normalize();
          const currentSpeed = velocity.dot(wishOnRamp);
          const addSpeed = SURF_WISH_SPEED - currentSpeed;
          if (addSpeed > 0) {
            const accelSpeed = Math.min(addSpeed, SURF_AIR_ACCEL * SURF_WISH_SPEED * dt);
            velocity.addScaledVector(wishOnRamp, accelSpeed);
          }
        }

        // 3. Authentic Carving Forward Speed Acceleration:
        // When surfing along the ramp, holding the into-ramp key and carving with mouse
        // produces sustained speed accumulation (classic CS surf speed gain)
        const forwardTangent = cameraForward.clone();
        forwardTangent.addScaledVector(normal, -forwardTangent.dot(normal));
        if (forwardTangent.lengthSq() > 1e-4) {
          forwardTangent.normalize();
          const fwdSpeed = velocity.dot(forwardTangent);
          // If carrying forward momentum along the ramp, holding into the ramp accelerates forward
          if (fwdSpeed > 2.0) {
            const carveBoost = 8.0 * holdStrength * dt;
            velocity.addScaledVector(forwardTangent, carveBoost);
          }
        }
      } else if (isStrafingAwayFromRamp) {
        // Player is strafing AWAY from the ramp (holding D on left ramp, or A on right ramp)
        // Accelerates off the ramp into open air
        MovementMath.accelerate(velocity, wish, SURF_WISH_SPEED * 2.0, airAcceleration, dt);
      } else {
        // Forward (W) or Backward (S) input without into-ramp strafe
        // STRICT CS ANTI-CRAWL INVARIANT:
        // Forward W input must NEVER allow crawling or climbing uphill from a stop!
        const wishOnRamp = wish.clone();
        wishOnRamp.addScaledVector(normal, -wishOnRamp.dot(normal));

        // Eliminate any uphill component from W/S input
        const uphillWish = wishOnRamp.dot(uphillDir);
        if (uphillWish > 0) {
          wishOnRamp.addScaledVector(uphillDir, -uphillWish);
        }

        if (wishOnRamp.lengthSq() > 1e-4) {
          wishOnRamp.normalize();
          MovementMath.accelerate(velocity, wishOnRamp, SURF_WISH_SPEED, airAcceleration, dt);
        }
      }

      // Re-clip against normal to ensure velocity remains strictly on or away from ramp surface
      const intoNormalAfter = velocity.dot(normal);
      if (intoNormalAfter < 0) {
        velocity.addScaledVector(normal, -intoNormalAfter);
      }
    }

    // 8. Record tangential speed
    const normComponent = velocity.dot(normal);
    const tangVel = velocity.clone().addScaledVector(normal, -normComponent);
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
