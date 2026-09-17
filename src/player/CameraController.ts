/**
 * Camera controller managing Pointer Lock, raw mouse look, and view vectors.
 * 
 * COORDINATE SYSTEM ARCHITECTURE:
 * - Native Three.js / OpenGL convention:
 *   Identity rotation (pitch=0, yaw=0, roll=0) faces down -Z: (0, 0, -1).
 *   Camera right is +X: (1, 0, 0).
 *   Camera up is +Y: (0, 1, 0).
 * - For an arbitrary horizontal yaw:
 *   Forward Vector: F(yaw) = (-sin(yaw), 0, -cos(yaw))
 *   Right Vector:   R(yaw) = ( cos(yaw), 0, -sin(yaw))
 * - Mouse Look Semantics:
 *   Mouse Right (movementX > 0) => yaw decreases => Forward rotates towards Right (+dot with Right).
 *   Mouse Left  (movementX < 0) => yaw increases => Forward rotates towards Left  (-dot with Right).
 *   Mouse Up    (movementY < 0) => pitch increases => view rotates upward (+Y).
 *   Mouse Down  (movementY > 0) => pitch decreases => view rotates downward (-Y).
 */

import * as THREE from 'three';
import { clamp } from '../utils/math';

export class CameraController {
  public camera: THREE.PerspectiveCamera;
  public yaw = 0;   // Radians
  public pitch = 0; // Radians
  public roll = 0;  // Bank angle

  public cameraBankEnabled = false; // Disabled by default for raw testing
  public lastMouseDeltaX = 0;
  public lastMouseDeltaY = 0;
  private domElement: HTMLElement;
  private isLocked = false;
  private justLocked = false;
  private sensitivity = 1.0;
  private targetRoll = 0;

  // Diagnostics scratch (never used for control flow).
  private diagEuler = new THREE.Euler();
  private diagQuatBefore = { x: 0, y: 0 };
  private diagQuatAfter = { x: 0, y: 0 };

  // Base sensitivity: radians per raw mouse pixel
  private static readonly BASE_SENSITIVITY = 0.0022;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.domElement = domElement;
    if (this.domElement) {
      this.domElement.tabIndex = -1;
      if (this.domElement.style) {
        this.domElement.style.outline = 'none';
      }
    }

    this.initEvents();
  }

  public setSensitivity(val: number): void {
    this.sensitivity = clamp(val, 0.1, 3.0);
  }

  public getSensitivity(): number {
    return this.sensitivity;
  }

  public setOrientation(yaw: number, pitch = 0): void {
    this.yaw = yaw;
    this.pitch = clamp(pitch, -1.55, 1.55);
    this.updateCameraRotation();
  }

  public setTargetRoll(bank: number, reduceMotion = false): void {
    if (!this.cameraBankEnabled || reduceMotion) {
      this.targetRoll = 0;
      this.roll = 0;
      return;
    }
    this.targetRoll = clamp(bank, -0.04, 0.04);
  }

  public update(dt: number): void {
    // Capture orientation before this frame's update for diagnostics.
    const diagYawBefore = this.yaw;
    const diagPitchBefore = this.pitch;
    this.getQuaternionOrientation(this.diagQuatBefore);

    if (this.cameraBankEnabled) {
      this.roll += (this.targetRoll - this.roll) * Math.min(1, dt * 10);
    } else {
      this.roll = 0;
    }
    this.updateCameraRotation();

    // Report the frame to the view-snap detector (diagnostics only; this reads
    // state and never writes yaw/pitch/quaternion).
    if (this.onOrientationFrame) {
      this.getQuaternionOrientation(this.diagQuatAfter);
      this.onOrientationFrame({
        yawBefore: diagYawBefore,
        yawAfter: this.yaw,
        pitchBefore: diagPitchBefore,
        pitchAfter: this.pitch,
        quatYawBefore: this.diagQuatBefore.x,
        quatYawAfter: this.diagQuatAfter.x,
        quatPitchBefore: this.diagQuatBefore.y,
        quatPitchAfter: this.diagQuatAfter.y,
        isLocked: this.isLocked,
        justLocked: this.justLocked
      });
    }
  }

  /**
   * Extracts (yaw, pitch) from the LIVE camera quaternion, using the same YXZ
   * convention the camera is built with. Used to prove the quaternion did not
   * diverge from yaw/pitch (i.e. no second orientation writer).
   */
  public getQuaternionOrientation(out: { x: number; y: number }): void {
    this.diagEuler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    out.x = this.diagEuler.y; // yaw
    out.y = this.diagEuler.x; // pitch
  }

  /** Diagnostics hook: raw mouse delta as delivered by the browser. */
  public onRawMouseDelta?: (movementX: number, movementY: number, justLocked: boolean) => void;

  /** Counts of handler registrations performed by initEvents(). */
  public registeredHandlerCounts = { mousemove: 0, pointerlockchange: 0, pointerlockerror: 0, pointerdown: 0 };

  /** Diagnostics hook, invoked once per CameraController.update(). */
  public onOrientationFrame?: (frame: {
    yawBefore: number;
    yawAfter: number;
    pitchBefore: number;
    pitchAfter: number;
    quatYawBefore: number;
    quatYawAfter: number;
    quatPitchBefore: number;
    quatPitchAfter: number;
    isLocked: boolean;
    justLocked: boolean;
  }) => void;

  public onUnlock?: () => void;
  /** Fired whenever pointer lock is actually acquired (true) or lost (false). */
  public onLockChange?: (locked: boolean) => void;
  mouseLookEnabled = false;
  private isLockPending = false;
  private lastLockAttempt = 0;

  public lock(): void {
    this.mouseLookEnabled = true;

    if (typeof document !== 'undefined' && document.body?.style) {
      document.body.style.cursor = 'none';
    }
    if (this.domElement?.style) {
      this.domElement.style.cursor = 'none';
    }
    if (typeof this.domElement?.focus === 'function') {
      this.domElement.focus();
    }

    if (typeof document !== 'undefined' && document.pointerLockElement === this.domElement) {
      this.isLocked = true;
      this.isLockPending = false;
      return;
    }

    if (this.isLockPending && Date.now() - this.lastLockAttempt < 300) {
      return;
    }

    this.isLockPending = true;
    this.lastLockAttempt = Date.now();

    try {
      const promise = this.domElement?.requestPointerLock?.();
      if (promise && typeof (promise as any).catch === 'function') {
        (promise as any).catch(() => {
          this.isLockPending = false;
        });
      }
    } catch {
      this.isLockPending = false;
    }
  }

  public unlock(): void {
    this.mouseLookEnabled = false;
    this.isLockPending = false;
    if (typeof document !== 'undefined' && document.body?.style) {
      document.body.style.cursor = 'default';
    }
    if (this.domElement?.style) {
      this.domElement.style.cursor = 'default';
    }
    if (typeof document !== 'undefined' && document.pointerLockElement) {
      try {
        document.exitPointerLock?.();
      } catch {
        // Ignore if already unlocked
      }
    }
    this.isLocked = false;
  }

  public getIsLocked(): boolean {
    return this.isLocked || (typeof document !== 'undefined' && document.pointerLockElement === this.domElement);
  }

  public isControlActive(): boolean {
    return this.mouseLookEnabled || this.getIsLocked();
  }

  /**
   * Exact horizontal forward vector matching camera.getWorldDirection() on XZ plane
   */
  public getForwardVector(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
  }

  /**
   * Exact horizontal right vector (Forward x Up)
   */
  public getRightVector(): THREE.Vector3 {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
  }

  /**
   * Apply raw physical mouse delta
   * movementX > 0: physical mouse right
   * movementY > 0: physical mouse down
   */
  public applyMouseDelta(deltaX: number, deltaY: number): void {
    const factor = CameraController.BASE_SENSITIVITY * this.sensitivity;

    this.lastMouseDeltaX += deltaX;
    this.lastMouseDeltaY += deltaY;

    // Physical mouse RIGHT => yaw decreases => rotates view toward player's RIGHT
    this.yaw -= deltaX * factor;

    // Physical mouse UP (negative deltaY in browser) => pitch increases => looks UP
    this.pitch -= deltaY * factor;

    // Clamp pitch between approx -88.8° and +88.8° (prevents pole gimbal lock and flipping)
    this.pitch = clamp(this.pitch, -1.55, 1.55);

    this.updateCameraRotation();
  }

  public consumeMouseDelta(): { x: number; y: number } {
    const d = { x: this.lastMouseDeltaX, y: this.lastMouseDeltaY };
    this.lastMouseDeltaX = 0;
    this.lastMouseDeltaY = 0;
    return d;
  }

  private updateCameraRotation(): void {
    this.pitch = clamp(this.pitch, -1.55, 1.55);
    const euler = new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
  }

  private initEvents(): void {
    if (typeof document === 'undefined') return;

    // Count registrations so diagnostics can prove the listener lifecycle stays
    // stable across Movement Lab enter/exit and pause/resume cycles (a duplicate
    // mousemove handler would apply every delta twice → an apparent snap).
    this.registeredHandlerCounts = { mousemove: 0, pointerlockchange: 0, pointerlockerror: 0, pointerdown: 0 };

    this.registeredHandlerCounts.pointerlockerror++;
    document.addEventListener('pointerlockerror', () => {
      this.isLockPending = false;
      const locked = document.pointerLockElement === this.domElement;
      this.isLocked = locked;
      // A failed lock must NOT leave the game pretending it is playable while
      // the cursor is free and mouse look is dead. Report the failure so the
      // owner can keep the game paused and ask the user again.
      this.onLockChange?.(false);
      if (this.mouseLookEnabled) {
        if (document.body?.style) {
          document.body.style.cursor = 'none';
        }
        if (this.domElement?.style) {
          this.domElement.style.cursor = 'none';
        }
      } else {
        if (document.body?.style) {
          document.body.style.cursor = 'default';
        }
        if (this.domElement?.style) {
          this.domElement.style.cursor = 'default';
        }
      }
    });

    this.registeredHandlerCounts.pointerlockchange++;
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.domElement;
      const wasLocked = this.isLocked;
      this.isLocked = locked;
      this.isLockPending = false;
      this.onLockChange?.(locked);
      if (locked) {
        this.mouseLookEnabled = true;
        if (typeof document !== 'undefined' && document.body?.style) {
          document.body.style.cursor = 'none';
        }
        if (this.domElement?.style) {
          this.domElement.style.cursor = 'none';
        }
        // Prevent first-frame giant delta snap when pointer lock engages
        this.justLocked = true;
      } else {
        if (!this.mouseLookEnabled) {
          if (typeof document !== 'undefined' && document.body?.style) {
            document.body.style.cursor = 'default';
          }
          if (this.domElement?.style) {
            this.domElement.style.cursor = 'default';
          }
        }
        if (wasLocked && !locked && !this.isLockPending) {
          this.onUnlock?.();
        }
      }
    });

    this.registeredHandlerCounts.mousemove++;
    document.addEventListener('mousemove', (e) => {
      if (!this.isLocked && !this.mouseLookEnabled) return;

      // Record the raw delta BEFORE any filtering so diagnostics can prove
      // whether the applied change matches what the browser delivered.
      if (this.onRawMouseDelta) {
        this.onRawMouseDelta(e.movementX, e.movementY, this.justLocked);
      }

      if (this.justLocked) {
        this.justLocked = false;
        return;
      }

      this.applyMouseDelta(e.movementX, e.movementY);

      if (this.mouseLookEnabled && !this.isLocked && !this.isLockPending && Date.now() - this.lastLockAttempt > 1200) {
        this.lock();
      }
    });

    this.registeredHandlerCounts.pointerdown++;
    document.addEventListener('pointerdown', () => {
      if (this.mouseLookEnabled && !this.isLocked) {
        this.lock();
      }
    });
  }
}
