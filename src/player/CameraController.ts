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
  public registeredHandlerCounts = { mousemove: 0, pointerlockchange: 0, pointerlockerror: 0, pointerdown: 0, pointerrawupdate: 0, pointermove: 0 };

  /** True when the OS has confirmed raw (unaccelerated) pointer input is active. */
  public rawInputActive = false;

  /**
   * Raw-input session accounting, so `RAW INPUT: true` is only ever shown for
   * the CURRENT lock session and a silent fallback cannot masquerade as raw.
   */
  public rawInputSession = {
    /** Incremented on every lock request, so results can be attributed. */
    requestId: 0,
    requestedMode: 'none' as 'none' | 'unadjustedMovement' | 'plain',
    resolvedMode: 'none' as 'none' | 'unadjustedMovement' | 'plain',
    resolvedRequestId: -1,
    fallbackCount: 0,
    lastError: ''
  };

  /** Diagnostics hook: pointer-granularity observations (never applies input). */
  public onPointerProbeEvent?: (source: 'pointerrawupdate' | 'pointermove', e: PointerEvent) => void;

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

    // RAW / UNACCELERATED MOUSE INPUT (Pointer Lock 2.0).
    //
    // By default the browser reports movementX/movementY AFTER OS mouse
    // acceleration. On platforms with pointer acceleration that can turn a fast
    // flick into a single very large delta, which the camera then faithfully
    // applies as a large instantaneous turn — a view snap the raw-input spike
    // detector reports as an outlier with no orientation mismatch.
    //
    // `unadjustedMovement: true` requests the raw device delta instead. It is
    // feature-detected: when it is unsupported the request rejects (or the
    // browser ignores the argument), and we fall back to a plain lock. The
    // fallback is immediate so lock acquisition is never delayed.
    this.requestPointerLockSafe();
  }

  /**
   * Requests pointer lock, preferring raw (unadjusted) movement.
   *
   * Never throws and never leaves the lock pending: on any failure it falls
   * back to the plain `requestPointerLock()` call.
   */
  private requestPointerLockSafe(): void {
    const el = this.domElement as HTMLElement & {
      requestPointerLock?: (options?: { unadjustedMovement?: boolean }) => Promise<void> | void;
    };
    if (!el || typeof el.requestPointerLock !== 'function') {
      this.isLockPending = false;
      return;
    }

    const requestId = ++this.rawInputSession.requestId;
    this.rawInputSession.requestedMode = 'unadjustedMovement';
    this.rawInputSession.resolvedMode = 'none';
    this.rawInputSession.lastError = '';

    let result: Promise<void> | void;
    try {
      result = el.requestPointerLock({ unadjustedMovement: true });
    } catch (err) {
      this.rawInputSession.lastError = String(err);
      this.plainRequestPointerLock(el, requestId);
      return;
    }

    // Browsers that do not support the options argument return undefined and
    // have already granted (or refused) the plain lock — nothing more to do.
    if (!result || typeof (result as Promise<void>).then !== 'function') {
      this.rawInputSession.resolvedMode = 'plain';
      this.rawInputSession.resolvedRequestId = requestId;
      this.rawInputActive = false;
      return;
    }

    (result as Promise<void>).then(
      () => {
        // Only trust this if it belongs to the current lock request.
        if (requestId === this.rawInputSession.requestId) {
          this.rawInputActive = true;
          this.rawInputSession.resolvedMode = 'unadjustedMovement';
          this.rawInputSession.resolvedRequestId = requestId;
        }
      },
      (err) => {
        // NotSupportedError / SecurityError — retry with the plain call.
        this.rawInputSession.lastError = err && err.name ? String(err.name) : String(err);
        if (requestId === this.rawInputSession.requestId) {
          this.rawInputActive = false;
        }
        this.plainRequestPointerLock(el, requestId);
      }
    );
  }

  private plainRequestPointerLock(
    el: HTMLElement & { requestPointerLock?: () => unknown },
    requestId: number
  ): void {
    this.rawInputSession.fallbackCount++;
    if (requestId === this.rawInputSession.requestId) {
      this.rawInputSession.resolvedMode = 'plain';
      this.rawInputSession.resolvedRequestId = requestId;
      this.rawInputActive = false;
    }
    try {
      const p = el.requestPointerLock?.();
      if (p && typeof (p as Promise<void>).then === 'function') {
        (p as Promise<void>).then(undefined, () => {
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

    // EVENT-LOCAL ATTRIBUTION (diagnostics only).
    // Yaw/pitch are mutated here, inside the DOM event, so expected-vs-actual
    // must be compared within this same call. Comparing against a later
    // CameraController.update() window produces spurious mismatches.
    const diagYawBefore = this.yaw;
    const diagPitchBefore = this.pitch;

    this.lastMouseDeltaX += deltaX;
    this.lastMouseDeltaY += deltaY;

    // Physical mouse RIGHT => yaw decreases => rotates view toward player's RIGHT
    this.yaw -= deltaX * factor;

    // Physical mouse UP (negative deltaY in browser) => pitch increases => looks UP
    this.pitch -= deltaY * factor;

    // Clamp pitch between approx -88.8° and +88.8° (prevents pole gimbal lock and flipping)
    const pitchBeforeClamp = this.pitch;
    this.pitch = clamp(this.pitch, -1.55, 1.55);

    this.updateCameraRotation();

    if (this.onMouseApplied) {
      this.onMouseApplied({
        movementX: deltaX,
        movementY: deltaY,
        yawBefore: diagYawBefore,
        yawAfter: this.yaw,
        pitchBefore: diagPitchBefore,
        pitchAfter: this.pitch,
        expectedYawDelta: -deltaX * factor,
        expectedPitchDelta: -deltaY * factor,
        pitchClamped: pitchBeforeClamp !== this.pitch,
        isLocked: this.isLocked,
        justLocked: this.justLocked,
        mouseLookEnabled: this.mouseLookEnabled
      });
    }
  }

  /** Diagnostics hook: an input event was deliberately discarded. */
  public onMouseDiscarded?: (e: { movementX: number; movementY: number; reason: string }) => void;

  /** Diagnostics hook: fired inside applyMouseDelta, atomically per event. */
  public onMouseApplied?: (e: {
    movementX: number;
    movementY: number;
    yawBefore: number;
    yawAfter: number;
    pitchBefore: number;
    pitchAfter: number;
    expectedYawDelta: number;
    expectedPitchDelta: number;
    pitchClamped: boolean;
    isLocked: boolean;
    justLocked: boolean;
    mouseLookEnabled: boolean;
  }) => void;

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
    this.registeredHandlerCounts = { mousemove: 0, pointerlockchange: 0, pointerlockerror: 0, pointerdown: 0, pointerrawupdate: 0, pointermove: 0 };

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
        // Intentional discard of the first delta after acquiring lock (it can
        // carry the whole cursor displacement). Report it as such so it is never
        // confused with an orientation fault.
        if (this.onMouseDiscarded) {
          this.onMouseDiscarded({
            movementX: e.movementX,
            movementY: e.movementY,
            reason: 'JUST_LOCKED'
          });
        }
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

    // --- Experimental pointer-granularity observation ---------------------
    // (?pointerInputExperiment=1) These listeners NEVER apply input; they only
    // report what the browser delivers. The production mousemove path therefore
    // stays the single authoritative mouse-look source, and no delta can be
    // applied twice.
    this.registeredHandlerCounts.pointerrawupdate = 0;
    this.registeredHandlerCounts.pointermove = 0;

    if (typeof window !== 'undefined' && 'onpointerrawupdate' in window) {
      this.registeredHandlerCounts.pointerrawupdate++;
      window.addEventListener('pointerrawupdate', (e) => {
        if (this.onPointerProbeEvent) this.onPointerProbeEvent('pointerrawupdate', e as PointerEvent);
      });
    }

    this.registeredHandlerCounts.pointermove++;
    window.addEventListener('pointermove', (e) => {
      if (this.onPointerProbeEvent) this.onPointerProbeEvent('pointermove', e as PointerEvent);
    });
  }
}
