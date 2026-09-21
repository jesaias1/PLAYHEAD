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
import { SettingsManager } from '../core/Settings';

/**
 * Authoritative mouse-look input source.
 *
 * Exactly ONE of these feeds `applyMouseDelta` at any time; the others remain
 * observation-only so a single physical displacement can never be applied
 * twice. Selected by `resolveInputSource()` in priority order.
 */
export type InputSource = 'RAW_POINTER' | 'COALESCED_POINTER' | 'LEGACY_MOUSE';

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

    // Feature-detect the granular pointer APIs, then pick the best source.
    if (typeof window !== 'undefined' && typeof PointerEvent !== 'undefined') {
      const proto = PointerEvent.prototype as unknown as { getCoalescedEvents?: unknown };
      this.coalescedSupported = typeof proto.getCoalescedEvents === 'function';
    }
    this.inputSource = this.resolveInputSource();

    const initialSens = SettingsManager.getInstance().settings.mouseSensitivity;
    if (typeof initialSens === 'number' && !isNaN(initialSens)) {
      this.sensitivity = clamp(initialSens, 0.1, 3.0);
    }
    SettingsManager.getInstance().subscribe((settings, changed) => {
      if (changed.has('mouseSensitivity')) {
        this.setSensitivity(settings.mouseSensitivity);
      }
    });
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

  // ---------------------------------------------------------------------
  // GRANULAR INPUT SOURCE STATE
  // ---------------------------------------------------------------------

  /** Upper bound on constituent samples accepted from one pointer event. */
  private static readonly MAX_COALESCED_SAMPLES = 64;

  /** The single source currently allowed to modify yaw/pitch. */
  public inputSource: InputSource = 'LEGACY_MOUSE';

  public pointerRawUpdateSupported = false;
  public coalescedSupported = false;

  /** Reusable scratch arrays: the raw/coalesced paths allocate nothing. */
  private coalescedX = new Float64Array(CameraController.MAX_COALESCED_SAMPLES);
  private coalescedY = new Float64Array(CameraController.MAX_COALESCED_SAMPLES);

  /** Internal observation sink used by the diagnostics probe. */
  public pointerProbeSink?: (source: 'pointerrawupdate' | 'pointermove', e: PointerEvent) => void;

  /** Cheap numeric counters for the overlay (no allocations, no logging). */
  public inputCounters = {
    rawEvents: 0,
    parentEvents: 0,
    appliedSamples: 0,
    duplicateDrops: 0,
    largestAppliedSample: 0,
    maxConstituents: 0
  };

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

      // A new lock session must not inherit any residual input state from the
      // previous one (stale accumulated delta, pending samples, discard flag).
      this.resetInputSessionState();
      this.inputCounters.rawEvents = 0;
      this.inputCounters.parentEvents = 0;

      if (locked) {
        this.mouseLookEnabled = true;
        if (typeof document !== 'undefined' && document.body?.style) {
          document.body.style.cursor = 'none';
        }
        if (this.domElement?.style) {
          this.domElement.style.cursor = 'none';
        }
        // The first delta after acquiring lock can carry the whole cursor
        // displacement; discard exactly one event. Set AFTER the reset above so
        // it is well-defined for the new session.
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
      if (!this.isMouseLookActive()) return;

      // mousemove is the LEGACY source. When a finer source owns application it
      // is observation-only, so the same physical displacement cannot be
      // applied twice.
      this.observeRaw(e.movementX, e.movementY);
      this.routeInput('LEGACY_MOUSE', e.movementX, e.movementY);
    });

    this.registeredHandlerCounts.pointerdown++;
    document.addEventListener('pointerdown', () => {
      if (this.mouseLookEnabled && !this.isLocked) {
        this.lock();
      }
    });

    // --- Granular pointer input sources -----------------------------------
    // Registers the finer event streams. Exactly ONE source applies input at a
    // time (see `inputSource`), so pointerrawupdate / pointermove / mousemove
    // can never stack.
    this.registeredHandlerCounts.pointerrawupdate = 0;
    this.registeredHandlerCounts.pointermove = 0;

    if (typeof window !== 'undefined' && 'onpointerrawupdate' in window) {
      this.pointerRawUpdateSupported = true;
      this.registeredHandlerCounts.pointerrawupdate++;

      // While pointer lock is active, pointerrawupdate targets the locked
      // element, so the listener must be on document. Registering on window
      // alone would miss every locked event.
      document.addEventListener('pointerrawupdate', (e) => {
        this.onPointerRawUpdate(e as PointerEvent);
      });
    }

    this.registeredHandlerCounts.pointermove++;
    document.addEventListener('pointermove', (e) => {
      this.onPointerMove(e as PointerEvent);
    });
  }

  /** True when mouse look should process events at all. */
  private isMouseLookActive(): boolean {
    return this.isLocked || this.mouseLookEnabled;
  }

  /**
   * PRIMARY SOURCE: pointerrawupdate.
   *
   * This stream delivers the granular physical samples as the browser receives
   * them, BEFORE they are batched into a coalesced pointermove parent. Applying
   * these applies each physical sample once and spreads the motion across the
   * time it actually occurred, instead of one late angular jump.
   *
   * Deliberately minimal: no allocations, no logging, no DOM work.
   */
  private onPointerRawUpdate(e: PointerEvent): void {
    if (!this.isMouseLookActive()) return;
    this.inputCounters.rawEvents++;

    if (this.pointerProbeSink) this.pointerProbeSink('pointerrawupdate', e);

    // Only the authoritative source may modify yaw/pitch.
    this.routeInput('RAW_POINTER', e.movementX, e.movementY);
  }

  /**
   * FALLBACK 1: pointermove with getCoalescedEvents().
   *
   * Applies EACH constituent sample exactly once and never additionally applies
   * the parent aggregate (which is the sum of those constituents).
   */
  private onPointerMove(e: PointerEvent): void {
    if (!this.isMouseLookActive()) return;
    this.inputCounters.parentEvents++;

    if (this.pointerProbeSink) this.pointerProbeSink('pointermove', e);

    this.routeCoalescedEvent(e);
  }

  /**
   * Single routing decision for one input sample.
   *
   * Returns true when the sample was handed to applyMouseDelta, false when it
   * was observation-only. This is the ONLY place that decides application, so a
   * physical displacement can never be applied twice.
   */
  public routeInput(source: InputSource, movementX: number, movementY: number): boolean {
    if (this.inputSource !== source) {
      this.inputCounters.duplicateDrops++;
      return false;
    }
    this.applyFromEvent(movementX, movementY);
    return true;
  }

  /**
   * Applies a pointermove event via its coalesced constituents when that source
   * is authoritative. The parent aggregate is NEVER additionally applied.
   */
  public routeCoalescedEvent(e: PointerEvent): number {
    if (this.inputSource !== 'COALESCED_POINTER') {
      this.inputCounters.duplicateDrops++;
      return 0;
    }
    const samples = this.readCoalescedSamples(e);
    for (let i = 0; i < samples.count; i++) {
      this.applyFromEvent(this.coalescedX[i], this.coalescedY[i]);
    }
    return samples.count;
  }

  /**
   * Returns the constituent samples that WOULD be applied for a pointer event,
   * without applying them. Exposed for verification of displacement
   * preservation and parent/constituent non-duplication.
   */
  public extractCoalescedSamples(e: PointerEvent): { count: number; x: number[]; y: number[] } {
    const samples = this.readCoalescedSamples(e);
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < samples.count; i++) {
      x.push(this.coalescedX[i]);
      y.push(this.coalescedY[i]);
    }
    return { count: samples.count, x, y };
  }

  /**
   * Extracts reliable constituent samples from a pointer event.
   *
   * Robust against every browser behaviour we can observe:
   *  - getCoalescedEvents missing            -> parent only
   *  - returns empty list                    -> parent only
   *  - returns one sample equal to the parent-> parent only
   *  - returns several samples               -> those samples
   *  - throws / malformed values             -> parent only
   *
   * Writes into reusable scratch arrays so this allocates nothing per call.
   */
  private readCoalescedSamples(e: PointerEvent): { count: number } {
    const maybe = e as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };

    if (typeof maybe.getCoalescedEvents === 'function') {
      let list: PointerEvent[] | null = null;
      try {
        list = maybe.getCoalescedEvents();
      } catch {
        list = null;
      }

      if (list && list.length > 0) {
        // Guard against an implausible list rather than trusting it blindly.
        if (list.length > CameraController.MAX_COALESCED_SAMPLES) {
          this.coalescedX[0] = e.movementX;
          this.coalescedY[0] = e.movementY;
          return { count: 1 };
        }

        let n = 0;
        let finite = true;
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          const cx = c && typeof c.movementX === 'number' ? c.movementX : 0;
          const cy = c && typeof c.movementY === 'number' ? c.movementY : 0;
          if (!Number.isFinite(cx) || !Number.isFinite(cy)) { finite = false; break; }
          this.coalescedX[n] = cx;
          this.coalescedY[n] = cy;
          n++;
        }

        if (finite && n > 0) {
          this.inputCounters.maxConstituents = Math.max(this.inputCounters.maxConstituents, n);
          return { count: n };
        }
      }
    }

    // Fallback: the parent delta IS the single sample.
    this.coalescedX[0] = e.movementX;
    this.coalescedY[0] = e.movementY;
    return { count: 1 };
  }

  /**
   * SINGLE APPLICATION POINT.
   *
   * Handles the intentional first-event discard after acquiring lock, records
   * the largest applied sample, then applies the delta exactly once.
   */
  private applyFromEvent(movementX: number, movementY: number): void {
    if (this.justLocked) {
      this.justLocked = false;
      if (this.onMouseDiscarded) {
        this.onMouseDiscarded({ movementX, movementY, reason: 'JUST_LOCKED' });
      }
      return;
    }

    const magnitude = Math.abs(movementX) + Math.abs(movementY);
    if (magnitude > this.inputCounters.largestAppliedSample) {
      this.inputCounters.largestAppliedSample = magnitude;
    }
    this.inputCounters.appliedSamples++;

    this.applyMouseDelta(movementX, movementY);
  }

  /** Cheap raw-delta observation for the spike detector (numbers only). */
  private observeRaw(movementX: number, movementY: number): void {
    if (this.onRawMouseDelta) {
      this.onRawMouseDelta(movementX, movementY, this.justLocked);
    }
  }

  /**
   * Resolves the authoritative input source for this environment.
   *
   * Priority: pointerrawupdate > coalesced pointermove > legacy mousemove.
   * A `?inputSource=` override exists for A/B testing on affected hardware; it
   * is a debug affordance only and is never surfaced in player settings.
   */
  public resolveInputSource(): InputSource {
    let override = '';
    try {
      override = new URLSearchParams(
        typeof window !== 'undefined' ? window.location.search : ''
      ).get('inputSource') || '';
    } catch {
      override = '';
    }

    if (override === 'raw' || override === 'coalesced' || override === 'legacy') {
      // Honour the override, but never select a source the browser cannot do.
      if (override === 'raw' && !this.pointerRawUpdateSupported) return 'COALESCED_POINTER';
      if (override === 'coalesced' && !this.coalescedSupported) return 'LEGACY_MOUSE';
      return override === 'raw' ? 'RAW_POINTER'
        : override === 'coalesced' ? 'COALESCED_POINTER'
          : 'LEGACY_MOUSE';
    }

    if (this.pointerRawUpdateSupported) return 'RAW_POINTER';
    if (this.coalescedSupported) return 'COALESCED_POINTER';
    return 'LEGACY_MOUSE';
  }

  public setInputSource(source: InputSource): void {
    this.inputSource = source;
    this.resetInputSessionState();
  }

  /**
   * Clears all input-session state. Called on lock transitions so a stale
   * delta, discard flag or residual sample cannot leak across sessions.
   */
  public resetInputSessionState(): void {
    this.justLocked = false;
    this.isLockPending = false;
    this.lastMouseDeltaX = 0;
    this.lastMouseDeltaY = 0;
  }
}
