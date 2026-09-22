/**
 * MOVEMENT JUICE — central movement presentation controller.
 *
 * Watches movement state and fires discrete PRESENTATION events (near miss,
 * landing, surf lock, finish). It reads player/physics state only; it never
 * writes velocity, jump state, collision or timing. All gameplay authority
 * stays where it already is.
 *
 * Continuous speed presentation is a cheap per-tick scalar. Discrete effects
 * use per-obstacle armed/cooldown arrays (no per-frame allocation).
 */

import { BoxCollider } from '../physics/Collider';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PlayerController } from '../player/PlayerController';
import {
  LANDING_FEEDBACK_COOLDOWN,
  LANDING_MIN_INTENSITY,
  NEAR_MISS_COOLDOWN,
  NEAR_MISS_CONFIRM_DELAY,
  NEAR_MISS_MARGIN,
  NEAR_MISS_MIN_SPEED,
  SURF_LOCK_COOLDOWN,
  SpeedBand,
  clamp01,
  classifyLanding,
  classifySurfExit,
  nearMissIntensity,
  speedBand,
  speedIntensity
} from './FeedbackMath';

export interface MovementFeedbackSinks {
  nearMiss(intensity: number, side: number, obstacleId: number): void;
  landing(intensity: number, major: boolean): void;
  surfLock(quality: number): void;
  finish(): void;
}

export interface MovementFeedbackState {
  speedUnits: number;
  speedIntensity: number;
  speedBand: SpeedBand;
  landingIntensity: number;
  landingMajor: boolean;
  surfQuality: number;
  lastNearMissId: number;
  lastEvent: string;
  lastEventTime: number;
  cameraOffsetY: number;
}

export class MovementFeedbackController {
  public readonly state: MovementFeedbackState = {
    speedUnits: 0,
    speedIntensity: 0,
    speedBand: 'NORMAL',
    landingIntensity: 0,
    landingMajor: false,
    surfQuality: 0,
    lastNearMissId: -1,
    lastEvent: '—',
    lastEventTime: 0,
    cameraOffsetY: 0
  };

  private sinks: MovementFeedbackSinks;

  private prevGrounded = false;
  private prevSurfing = false;
  private airtime = 0;
  private airPeakY = 0;
  private lastSurfSpeedUnits = 0;
  private lastSurfTime = 0;
  private surfEntrySpeedUnits = 1;

  private landingCooldown = 0;
  private surfLockCooldown = 0;

  private cameraImpulseVel = 0;
  private finishFired = false;

  // Per-obstacle near-miss bookkeeping (sized to the obstacle list).
  // 0 = idle/armed, 1 = pending confirmation.
  private nearMissState = new Uint8Array(0);
  private nearMissTimer = new Float32Array(0);
  private nearMissCooldown = new Float32Array(0);
  private nearMissPendingIntensity = new Float32Array(0);
  private nearMissPendingSide = new Int8Array(0);

  private clock = 0;

  constructor(sinks: MovementFeedbackSinks) {
    this.sinks = sinks;
  }

  public reset(): void {
    this.prevGrounded = false;
    this.prevSurfing = false;
    this.airtime = 0;
    this.airPeakY = 0;
    this.lastSurfSpeedUnits = 0;
    this.lastSurfTime = 0;
    this.surfEntrySpeedUnits = 1;
    this.landingCooldown = 0;
    this.surfLockCooldown = 0;
    this.cameraImpulseVel = 0;
    this.finishFired = false;
    this.nearMissState.fill(0);
    this.nearMissTimer.fill(0);
    this.nearMissCooldown.fill(0);
    this.state.landingIntensity = 0;
    this.state.landingMajor = false;
    this.state.surfQuality = 0;
    this.state.lastNearMissId = -1;
    this.state.lastEvent = '—';
    this.state.lastEventTime = 0;
    this.state.cameraOffsetY = 0;
    this.clock = 0;
  }

  /** Fire the finish presentation once. */
  public notifyFinish(): void {
    if (this.finishFired) return;
    this.finishFired = true;
    this.state.lastEvent = 'FINISH';
    this.state.lastEventTime = this.clock;
    this.sinks.finish();
  }

  public update(dt: number, player: PlayerController, physics: PhysicsWorld): void {
    this.clock += dt;
    const speedUnits = player.getSpeedUnits();
    this.state.speedUnits = speedUnits;
    this.state.speedIntensity = speedIntensity(speedUnits);
    this.state.speedBand = speedBand(speedUnits);

    if (this.landingCooldown > 0) this.landingCooldown = Math.max(0, this.landingCooldown - dt);
    if (this.surfLockCooldown > 0) this.surfLockCooldown = Math.max(0, this.surfLockCooldown - dt);

    // Airborne tracking (used for landing classification).
    if (!player.isGrounded && !player.isSurfing) {
      this.airtime += dt;
      if (player.position.y > this.airPeakY) this.airPeakY = player.position.y;
    }

    // --- Landing ---------------------------------------------------------
    if (!this.prevGrounded && player.isGrounded) {
      const verticalDrop = Math.max(0, this.airPeakY - player.position.y);
      const result = classifyLanding({
        landingSpeedUnits: player.lastLandingSpeed,
        airtime: this.airtime,
        verticalDrop
      });
      this.state.landingIntensity = result.intensity;
      this.state.landingMajor = result.major;

      if (result.intensity >= LANDING_MIN_INTENSITY && this.landingCooldown <= 0) {
        this.landingCooldown = LANDING_FEEDBACK_COOLDOWN;
        // Tiny damped downward camera dip (presentation only).
        this.cameraImpulseVel -= (result.major ? 0.85 : 0.32) * result.intensity;
        this.sinks.landing(result.intensity, result.major);
        this.setLastEvent(result.major ? 'MAJOR TRANSFER' : 'LANDING');
      }
    }
    if (player.isGrounded || player.isSurfing) {
      this.airtime = 0;
      this.airPeakY = player.position.y;
    }

    // --- Surf enter / exit ----------------------------------------------
    if (player.isSurfing) {
      this.lastSurfSpeedUnits = speedUnits;
      this.lastSurfTime = player.surfState.timeSurfing;
    }
    if (!this.prevSurfing && player.isSurfing) {
      this.surfEntrySpeedUnits = Math.max(
        1,
        player.surfState.entrySpeed * player.config.speedUnitScale
      );
      this.setLastEvent('SURF ENTER');
    }
    if (this.prevSurfing && !player.isSurfing) {
      const result = classifySurfExit({
        entrySpeedUnits: this.surfEntrySpeedUnits,
        exitSpeedUnits: this.lastSurfSpeedUnits,
        timeSurfing: this.lastSurfTime
      });
      this.state.surfQuality = result.quality;
      if (result.perfect && this.surfLockCooldown <= 0) {
        this.surfLockCooldown = SURF_LOCK_COOLDOWN;
        this.sinks.surfLock(result.quality);
        this.setLastEvent('SURF LOCK');
      }
    }

    // --- Near miss -------------------------------------------------------
    this.updateNearMiss(dt, player, physics, speedUnits);

    // --- Camera impulse spring (critically damped, tiny) ------------------
    const springK = 95.0;
    const damping = 15.0;
    const acc = -springK * this.state.cameraOffsetY - damping * this.cameraImpulseVel;
    this.cameraImpulseVel += acc * dt;
    this.state.cameraOffsetY += this.cameraImpulseVel * dt;
    if (this.state.cameraOffsetY < -0.035) {
      this.state.cameraOffsetY = -0.035;
      if (this.cameraImpulseVel < 0) this.cameraImpulseVel = 0;
    } else if (this.state.cameraOffsetY > 0.015) {
      this.state.cameraOffsetY = 0.015;
      if (this.cameraImpulseVel > 0) this.cameraImpulseVel = 0;
    }

    this.prevGrounded = player.isGrounded;
    this.prevSurfing = player.isSurfing;
  }

  private updateNearMiss(
    dt: number,
    player: PlayerController,
    physics: PhysicsWorld,
    speedUnits: number
  ): void {
    const obstacles = physics.obstacleColliders;
    if (obstacles.length === 0) return;

    if (this.nearMissState.length !== obstacles.length) {
      this.nearMissState = new Uint8Array(obstacles.length);
      this.nearMissTimer = new Float32Array(obstacles.length);
      this.nearMissCooldown = new Float32Array(obstacles.length);
      this.nearMissPendingIntensity = new Float32Array(obstacles.length);
      this.nearMissPendingSide = new Int8Array(obstacles.length);
    }

    const radius = player.config.playerRadius;
    const height = player.config.playerHeight;
    const px = player.position.x;
    const py = player.position.y;
    const pz = player.position.z;
    const shell = radius + NEAR_MISS_MARGIN;
    const contactGap = radius + 0.02;

    for (let i = 0; i < obstacles.length; i++) {
      const collider = obstacles[i].collider;

      if (this.nearMissCooldown[i] > 0) {
        this.nearMissCooldown[i] = Math.max(0, this.nearMissCooldown[i] - dt);
      }

      const gap = Math.min(
        this.gapToBox(px, py + radius, pz, collider),
        this.gapToBox(px, py + height - radius, pz, collider)
      );

      // Pending: waiting to confirm the pass was clean.
      if (this.nearMissState[i] === 1) {
        if (gap < contactGap) {
          // Actually collided: never a near miss.
          this.nearMissState[i] = 0;
          this.nearMissCooldown[i] = NEAR_MISS_COOLDOWN;
          continue;
        }
        this.nearMissTimer[i] -= dt;
        if (this.nearMissTimer[i] <= 0) {
          this.nearMissState[i] = 0;
          this.nearMissCooldown[i] = NEAR_MISS_COOLDOWN;
          const intensity = this.nearMissPendingIntensity[i];
          if (intensity > 0.05) {
            this.state.lastNearMissId = obstacles[i].id;
            this.sinks.nearMiss(intensity, this.nearMissPendingSide[i], obstacles[i].id);
            this.setLastEvent('NEAR MISS');
          }
        }
        continue;
      }

      if (this.nearMissCooldown[i] > 0) continue;
      if (gap >= shell || gap < contactGap) continue;
      if (speedUnits < NEAR_MISS_MIN_SPEED) continue;

      // Entering the shell at speed: arm a pending near miss.
      const clearance = clamp01((gap - radius) / NEAR_MISS_MARGIN);
      this.nearMissState[i] = 1;
      this.nearMissTimer[i] = NEAR_MISS_CONFIRM_DELAY;
      this.nearMissPendingIntensity[i] = nearMissIntensity(speedUnits, clearance);
      this.nearMissPendingSide[i] = this.lateralSide(px, pz, collider, player);
    }
  }

  /** Distance from a point to the obstacle box surface (0 when inside). */
  private gapToBox(px: number, py: number, pz: number, collider: BoxCollider): number {
    const dx = px - collider.center.x;
    const dy = py - collider.center.y;
    const dz = pz - collider.center.z;

    const yaw = collider.rotation.y;
    const cos = Math.cos(-yaw);
    const sin = Math.sin(-yaw);
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;

    const qx = Math.max(-collider.halfSize.x, Math.min(collider.halfSize.x, lx));
    const qy = Math.max(-collider.halfSize.y, Math.min(collider.halfSize.y, dy));
    const qz = Math.max(-collider.halfSize.z, Math.min(collider.halfSize.z, lz));

    const ex = lx - qx;
    const ey = dy - qy;
    const ez = lz - qz;
    return Math.sqrt(ex * ex + ey * ey + ez * ez);
  }

  /** -1 / +1 for a peripheral audio streak on the side that was passed. */
  private lateralSide(
    px: number,
    pz: number,
    collider: BoxCollider,
    player: PlayerController
  ): number {
    const dx = collider.center.x - px;
    const dz = collider.center.z - pz;
    const yaw = player.cameraController.yaw;
    // Camera right vector: (cos yaw, 0, -sin yaw)
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const dot = dx * rightX + dz * rightZ;
    return dot >= 0 ? 1 : -1;
  }

  private setLastEvent(label: string): void {
    this.state.lastEvent = label;
    this.state.lastEventTime = this.clock;
  }
}
