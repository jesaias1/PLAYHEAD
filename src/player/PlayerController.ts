/**
 * PlayerController implementing Quake/Source-style movement, air-strafing,
 * bunny-hopping, and surfing.
 */

import * as THREE from 'three';
import { CameraController } from './CameraController';
import { DEFAULT_MOVEMENT_CONFIG, MovementConfig, MovementPresetName, MOVEMENT_PRESETS } from './MovementConfig';
import { MovementMath } from './MovementMath';
import { PlayerStats } from './PlayerStats';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { SettingsManager } from '../core/Settings';
import { SurfState } from './SurfState';

export class PlayerController {
  public position = new THREE.Vector3();
  public velocity = new THREE.Vector3();

  public isGrounded = false;
  public isSurfing = false;
  public groundNormal = new THREE.Vector3(0, 1, 0);
  public surfNormal = new THREE.Vector3(0, 1, 0);
  public surfState: SurfState = new SurfState();

  public currentPreset: MovementPresetName = 'PLAYHEAD';
  public config: MovementConfig = { ...DEFAULT_MOVEMENT_CONFIG };
  public stats: PlayerStats = new PlayerStats();
  public cameraController: CameraController;

  public lastAirAccelAdded = 0;
  public lastLandingSpeed = 0;

  public currentStrafeAngle = 90.0;
  public currentStrafeEfficiency = 0.0;
  public currentStrafeRating: 'OPTIMAL' | 'GOOD' | 'WEAK' | 'NONE' = 'NONE';

  private physics: PhysicsWorld;
  private keys = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    restore: false
  };

  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private jumpPressedLastTick = false;
  private prevYaw = 0;

  public onFallCallback?: () => void;
  public onRestoreCallback?: () => void;

  public lastTouchedSurfaceType: 'PLATFORM' | 'SURF' = 'PLATFORM';
  public authoritativeKillY: number | null = null;
  public isRestoring = false;
  private freefallTimer = 0;

  public restoreDiagnosticLogs: Array<{
    reason: string;
    cpId?: number;
    before: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
    after: { x: number; y: number; z: number };
    velBefore: { x: number; y: number; z: number };
    emergencyFallback?: boolean;
    timestamp: number;
  }> = [];

  public surfDiagnostics: Array<{
    timestamp: number;
    pos: { x: number; y: number; z: number };
    vel: { x: number; y: number; z: number };
    surfNormal: { x: number; y: number; z: number };
    intoSurf: number;
    clipped: boolean;
  }> = [];

  constructor(cameraController: CameraController, physics: PhysicsWorld) {
    this.cameraController = cameraController;
    this.physics = physics;
    this.initInputListeners();
  }

  public setPreset(name: MovementPresetName): void {
    if (MOVEMENT_PRESETS[name]) {
      this.currentPreset = name;
      this.config = { ...MOVEMENT_PRESETS[name] };
    }
  }

  public setPosition(pos: THREE.Vector3 | { x: number; y: number; z: number }): void {
    this.position.set(pos.x, pos.y, pos.z);
    this.velocity.set(0, 0, 0);
    this.freefallTimer = 0;
    this.surfState.reset();
    this.isSurfing = false;
    this.isGrounded = true;
    this.syncCamera();
  }

  public setOrientation(yaw: number): void {
    this.cameraController.setOrientation(yaw);
    this.prevYaw = yaw;
  }

  public resetKeys(): void {
    this.keys.forward = false;
    this.keys.backward = false;
    this.keys.left = false;
    this.keys.right = false;
    this.keys.jump = false;
    this.keys.restore = false;
    this.jumpBufferTimer = 0;
    this.cameraController.setTargetRoll(0);
  }

  public get keysState(): { forward: boolean; backward: boolean; left: boolean; right: boolean; jump: boolean } {
    return this.keys;
  }

  public getSpeedUnits(): number {
    const horizSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
    return horizSpeed * this.config.speedUnitScale;
  }

  public updateFixed(dt: number): void {
    if (this.isRestoring) return;

    // 1. Calculate input Wish Direction relative to Camera Yaw
    const forward = this.cameraController.getForwardVector();
    const right = this.cameraController.getRightVector();

    const wishDir = new THREE.Vector3();
    if (this.keys.forward) wishDir.add(forward);
    if (this.keys.backward) wishDir.sub(forward);
    if (this.keys.right) wishDir.add(right);
    if (this.keys.left) wishDir.sub(right);

    const hasInput = wishDir.lengthSq() > 0.001;
    if (hasInput) {
      wishDir.normalize();
    }

    // 2. Jump Timers (Buffer & Coyote Time)
    if (this.isGrounded) {
      this.coyoteTimer = this.config.coyoteTime;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    }

    const holdToBhop = SettingsManager.getInstance().settings.holdToBhop;
    if (this.keys.jump && (holdToBhop || !this.jumpPressedLastTick)) {
      this.jumpBufferTimer = this.config.jumpBufferTime;
    } else {
      this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
    }
    this.jumpPressedLastTick = this.keys.jump;

    const wasGrounded = this.isGrounded;

    // 3. Movement State Processing
    if (this.surfState.isSurfing || this.isSurfing) {
      // In Counter-Strike, a player on a surf ramp is not grounded and cannot jump or walk freely
      this.isGrounded = false;
      this.jumpBufferTimer = 0;
      this.coyoteTimer = 0;

      // Surfing Physics: Zero friction, momentum conservation, downhill gravity, and ramp strafe authority
      this.surfState.updateSurfPhysics(
        this.velocity,
        wishDir,
        hasInput,
        forward,
        right,
        this.surfNormal,
        this.isSurfing,
        this.config.gravity,
        this.config.airAcceleration,
        this.config.maxAirWishSpeed,
        dt
      );
      this.lastAirAccelAdded = 0;
      this.currentStrafeEfficiency = 0;
      this.currentStrafeRating = 'NONE';
    } else if (this.isGrounded) {
      // CRITICAL BHOP FIX: Check jump BEFORE applying ground friction on landing frame!
      if (this.jumpBufferTimer > 0) {
        this.velocity.y = this.config.jumpVelocity;
        this.jumpBufferTimer = 0;
        this.coyoteTimer = 0;
        this.isGrounded = false;
      } else {
        // Apply friction and ground acceleration ONLY if not jumping on this tick
        MovementMath.applyFriction(this.velocity, this.config.friction, this.config.stopSpeed, dt);

        const wishSpeed = hasInput ? this.config.maxGroundWishSpeed : 0;
        if (hasInput) {
          MovementMath.accelerate(this.velocity, wishDir, wishSpeed, this.config.groundAcceleration, dt);
        }
      }
      this.lastAirAccelAdded = 0;
      this.currentStrafeEfficiency = 0;
      this.currentStrafeRating = 'NONE';
    } else {
      // Air Physics: Source Air Strafe + Supplemental Air Steering + Gravity
      if (hasInput) {
        this.lastAirAccelAdded = MovementMath.accelerate(
          this.velocity,
          wishDir,
          this.config.maxAirWishSpeed,
          this.config.airAcceleration,
          dt
        );

        MovementMath.applyAirSteering(
          this.velocity,
          wishDir,
          this.config.supplementalAirSteer,
          dt
        );

        const telemetry = MovementMath.calculateStrafeTelemetry(
          this.velocity,
          wishDir,
          this.lastAirAccelAdded
        );
        this.currentStrafeAngle = telemetry.strafeAngleDeg;
        this.currentStrafeEfficiency = telemetry.efficiency;
        this.currentStrafeRating = telemetry.rating;
      } else {
        this.lastAirAccelAdded = 0;
        this.currentStrafeEfficiency = 0;
        this.currentStrafeRating = 'NONE';
      }

      // Gravity
      this.velocity.y -= this.config.gravity * dt;

      // Check Coyote Jump
      if (this.coyoteTimer > 0 && this.jumpBufferTimer > 0) {
        this.velocity.y = this.config.jumpVelocity;
        this.jumpBufferTimer = 0;
        this.coyoteTimer = 0;
      }

      // Air strafe efficiency calculation
      const yawDelta = this.cameraController.yaw - this.prevYaw;
      const horizSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
      // Good strafe: turning in same direction as lateral key press
      const isStrafingWell = (this.keys.left && yawDelta > 0.005) || (this.keys.right && yawDelta < -0.005);
      this.stats.recordAirborne(isStrafingWell && horizSpeed > 8.0);
    }

    // Subtle camera bank on strafe & turn
    const strafeBank = (this.keys.left ? 0.02 : 0) - (this.keys.right ? 0.02 : 0);
    this.cameraController.setTargetRoll(strafeBank);

    this.prevYaw = this.cameraController.yaw;

    // 4. Integrate Position
    this.position.addScaledVector(this.velocity, dt);

    // 5. Physics Collision Resolution
    const colRes = this.physics.resolveCapsule(
      this.position,
      this.config.playerRadius,
      this.config.playerHeight
    );

    this.position.copy(colRes.adjustedPos);
    this.isSurfing = colRes.isSurfing;
    this.isGrounded = colRes.isGrounded && !colRes.isSurfing;
    this.groundNormal.copy(colRes.groundNormal);
    if (this.isGrounded) {
      this.lastTouchedSurfaceType = 'PLATFORM';
      this.freefallTimer = 0;
    } else if (this.isSurfing) {
      this.lastTouchedSurfaceType = 'SURF';
      this.freefallTimer = 0;
    } else {
      this.freefallTimer += dt;
    }

    if (colRes.isSurfing) {
      this.surfNormal.copy(colRes.surfNormal);
      this.surfState.contactPoint.copy(colRes.surfContactPoint);
      this.isGrounded = false;

      // Clip velocity against surf normal immediately upon contact to avoid penetrating ramp
      const intoSurf = this.velocity.dot(colRes.surfNormal);
      const clipped = intoSurf < 0;
      if (clipped) {
        this.velocity.addScaledVector(colRes.surfNormal, -intoSurf);
      }

      if (this.surfDiagnostics.length >= 50) {
        this.surfDiagnostics.shift();
      }
      this.surfDiagnostics.push({
        timestamp: Date.now(),
        pos: { x: this.position.x, y: this.position.y, z: this.position.z },
        vel: { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z },
        surfNormal: { x: colRes.surfNormal.x, y: colRes.surfNormal.y, z: colRes.surfNormal.z },
        intoSurf,
        clipped
      });
    }

    if (this.isGrounded && !this.isSurfing && this.velocity.y < 0) {
      this.velocity.y = 0;
    }

    if (!wasGrounded && this.isGrounded) {
      this.lastLandingSpeed = this.getSpeedUnits();
    }

    if (colRes.hitWall) {
      // Clip velocity against wall normal
      const intoWall = this.velocity.dot(colRes.wallNormal);
      if (intoWall < 0) {
        this.velocity.addScaledVector(colRes.wallNormal, -intoWall);
      }
    }

    // Boost pad trigger
    if (colRes.isBoost && colRes.boostSpeed > 0) {
      const boostDir = this.cameraController.getForwardVector();
      this.velocity.addScaledVector(boostDir, colRes.boostSpeed * dt * 8);
    }

    // 6. Record Statistics
    this.stats.recordSpeed(this.getSpeedUnits());

    // 7. Check Kill Plane (Fall) with Authoritative Multi-Layer Failsafe
    const isBelowGlobalKillPlane = this.physics.checkKillPlane(this.position);
    const isBelowAuthoritativeKillPlane = this.authoritativeKillY !== null && this.position.y < this.authoritativeKillY;

    // Watchdog timer: If launching from surf, allow high soaring jumps (> 8.0s or until beneath route).
    // From standard platforms, catch prolonged freefall (> 3.5s downward).
    const safeKillHorizon = (this.authoritativeKillY !== null ? this.authoritativeKillY : this.physics.killPlaneY) + 5.0;
    const isSurfAirborne = this.lastTouchedSurfaceType === 'SURF';
    const isWatchdogTriggered = isSurfAirborne
      ? (this.freefallTimer > 8.0 && this.velocity.y < -5.0 && this.position.y < safeKillHorizon)
      : (this.freefallTimer > 3.5 && this.velocity.y < -5.0 && this.position.y < safeKillHorizon);

    // Secondary watchdog: failsafe against any edge case where position falls deep below kill plane
    const isCriticalVoid = this.authoritativeKillY !== null
      ? (this.position.y < this.authoritativeKillY - 25.0)
      : (this.position.y < this.physics.killPlaneY - 25.0);

    if (isBelowGlobalKillPlane || isBelowAuthoritativeKillPlane || isWatchdogTriggered || isCriticalVoid) {
      this.stats.recordFall();
      this.freefallTimer = 0;
      this.onFallCallback?.();
    }

    // Synchronize visual camera
    this.syncCamera();
  }

  public syncCamera(): void {
    this.cameraController.camera.position.set(
      this.position.x,
      this.position.y + this.config.eyeHeight,
      this.position.z
    );
  }

  private initInputListeners(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', (e) => {
      // Prevent space scrolling
      if (e.code === 'Space') e.preventDefault();

      if (e.code === 'KeyW') this.keys.forward = true;
      if (e.code === 'KeyS') this.keys.backward = true;
      if (e.code === 'KeyA') this.keys.left = true;
      if (e.code === 'KeyD') this.keys.right = true;
      if (e.code === 'Space') this.keys.jump = true;

      // Movement Presets (1: CURRENT, 2: SOURCE, 3: TRACK_RUN)
      if (e.code === 'Digit1') this.setPreset('CURRENT');
      if (e.code === 'Digit2') this.setPreset('SOURCE');
      if (e.code === 'Digit3') this.setPreset('PLAYHEAD');

      if (e.code === 'KeyR' && !e.repeat) {
        this.stats.recordRestart();
        this.onRestoreCallback?.();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyW') this.keys.forward = false;
      if (e.code === 'KeyS') this.keys.backward = false;
      if (e.code === 'KeyA') this.keys.left = false;
      if (e.code === 'KeyD') this.keys.right = false;
      if (e.code === 'Space') this.keys.jump = false;
    });

    // Reset keys on window blur to avoid stuck input
    window.addEventListener('blur', () => {
      this.resetKeys();
    });
  }
}
