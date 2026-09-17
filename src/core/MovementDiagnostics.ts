/**
 * PLAYHEAD — Movement diagnostics (opt-in runtime instrumentation)
 *
 * Enabled explicitly with `?debugMovement=1` in the URL. Works identically in
 * `npm run build` output and under the Vite dev server — it is a RUNTIME flag,
 * never a compile-time one, so it cannot be stripped by the production build.
 *
 * This module is diagnostics only:
 *   - it never writes to player, camera, physics, collision or void state
 *   - it performs no network I/O and no telemetry
 *   - everything stays client-side
 */

import { BUILD_LABEL } from './BuildInfo';

export type MovementDiagEventKind =
  | 'RESTORE'
  | 'PLAYER_CORRECTION'
  | 'CAMERA_DESYNC'
  | 'VIEW_SNAP'
  | 'RAW_MOUSE_SPIKE'
  | 'OTHER';

/**
 * Shortest signed angular difference, in radians, in [-PI, PI].
 *
 * Yaw is an angle: a transition from +179deg to -179deg is a 2deg physical
 * change, not a 358deg one. Every angular delta in this module goes through
 * this helper so legitimate +/-PI wrapping is NEVER reported as a snap.
 */
export function wrapAngleDelta(delta: number): number {
  if (!Number.isFinite(delta)) return delta;
  let d = (delta + Math.PI) % (Math.PI * 2);
  if (d < 0) d += Math.PI * 2;
  return d - Math.PI;
}

export interface MouseDeltaSample {
  movementX: number;
  movementY: number;
  eventCount: number;
}

export interface FrameOrientationSample {
  yawBefore: number;
  yawAfter: number;
  pitchBefore: number;
  pitchAfter: number;
  rawX: number;
  rawY: number;
  eventCount: number;
  expectedYawDelta: number;
  expectedPitchDelta: number;
  actualYawDelta: number;
  actualPitchDelta: number;
  sensitivity: number;
  isLocked: boolean;
  justLocked: boolean;
  frameDeltaMs: number;
  playerPos: { x: number; y: number; z: number };
  displaySpeed: number;
  timestamp: number;
}

/**
 * Detects a view-orientation discontinuity that cannot be explained by the
 * mouse input actually applied during that update.
 *
 * Two independent assertions per frame:
 *  1. the applied mouse delta must match the observed yaw/pitch change
 *  2. the yaw/pitch change must match the change reconstructed from the final
 *     camera quaternion (catches a second orientation writer)
 */
export class ViewSnapDetector {
  private ring: FrameOrientationSample[] = [];
  private readonly capacity = 240;

  private pendingX = 0;
  private pendingY = 0;
  private pendingCount = 0;

  /** Called from the mousemove path with the RAW values the browser delivered. */
  public noteMouseDelta(movementX: number, movementY: number): void {
    this.pendingX += movementX;
    this.pendingY += movementY;
    this.pendingCount++;
  }

  /**
   * Called once per frame after camera orientation has been updated.
   * Returns a diagnosis when the change is unexplained, else null.
   */
  public endFrame(args: {
    yawBefore: number;
    yawAfter: number;
    pitchBefore: number;
    pitchAfter: number;
    quatYawBefore: number;
    quatYawAfter: number;
    quatPitchBefore: number;
    quatPitchAfter: number;
    sensitivity: number;
    baseSensitivity: number;
    isLocked: boolean;
    justLocked: boolean;
    frameDeltaMs: number;
    playerPos: { x: number; y: number; z: number };
    displaySpeed: number;
  }): FrameOrientationSample & { diagnosis: string | null } {
    const factor = args.baseSensitivity * args.sensitivity;

    // Expected change from the mouse input actually applied this frame.
    const expectedYawDelta = -this.pendingX * factor;
    const expectedPitchDelta = -this.pendingY * factor;

    // Observed change (wrapped: angles, not linear values).
    const actualYawDelta = wrapAngleDelta(args.yawAfter - args.yawBefore);
    const actualPitchDelta = args.pitchAfter - args.pitchBefore;

    const sample: FrameOrientationSample = {
      yawBefore: args.yawBefore,
      yawAfter: args.yawAfter,
      pitchBefore: args.pitchBefore,
      pitchAfter: args.pitchAfter,
      rawX: this.pendingX,
      rawY: this.pendingY,
      eventCount: this.pendingCount,
      expectedYawDelta,
      expectedPitchDelta,
      actualYawDelta,
      actualPitchDelta,
      sensitivity: args.sensitivity,
      isLocked: args.isLocked,
      justLocked: args.justLocked,
      frameDeltaMs: args.frameDeltaMs,
      playerPos: args.playerPos,
      displaySpeed: args.displaySpeed,
      timestamp: Date.now()
    };

    let diagnosis: string | null = null;

    // 1. Applied mouse delta vs observed yaw/pitch change.
    // Tolerance accounts for the pitch clamp legitimately absorbing input when
    // the player is pinned at a pitch limit.
    const yawResidual = wrapAngleDelta(actualYawDelta - expectedYawDelta);
    const pitchResidual = actualPitchDelta - expectedPitchDelta;
    const atPitchLimit = Math.abs(args.pitchAfter) >= 1.5499 || Math.abs(args.pitchBefore) >= 1.5499;

    const ANGLE_TOL = 0.01; // rad
    if (Math.abs(yawResidual) > ANGLE_TOL) {
      diagnosis = `YAW_MISMATCH residual=${yawResidual.toFixed(5)} (expected ${expectedYawDelta.toFixed(5)}, actual ${actualYawDelta.toFixed(5)})`;
    } else if (Math.abs(pitchResidual) > ANGLE_TOL && !atPitchLimit) {
      diagnosis = `PITCH_MISMATCH residual=${pitchResidual.toFixed(5)} (expected ${expectedPitchDelta.toFixed(5)}, actual ${actualPitchDelta.toFixed(5)})`;
    }

    // 2. Camera quaternion must agree with yaw/pitch (no second writer).
    if (!diagnosis) {
      const qYaw = wrapAngleDelta(args.quatYawAfter - args.yawAfter);
      const qPitch = args.quatPitchAfter - args.pitchAfter;
      const Q_TOL = 0.02; // rad
      if (Math.abs(qYaw) > Q_TOL) {
        diagnosis = `QUATERNION_YAW_DIVERGENCE quatYaw=${args.quatYawAfter.toFixed(5)} yaw=${args.yawAfter.toFixed(5)} diff=${qYaw.toFixed(5)}`;
      } else if (Math.abs(qPitch) > Q_TOL) {
        diagnosis = `QUATERNION_PITCH_DIVERGENCE quatPitch=${args.quatPitchAfter.toFixed(5)} pitch=${args.pitchAfter.toFixed(5)} diff=${qPitch.toFixed(5)}`;
      }
    }

    this.ring.push(sample);
    if (this.ring.length > this.capacity) this.ring.shift();

    this.pendingX = 0;
    this.pendingY = 0;
    this.pendingCount = 0;

    return { ...sample, diagnosis };
  }

  /** Most recent orientation samples, oldest first. */
  public recent(n = 30): FrameOrientationSample[] {
    return this.ring.slice(-n);
  }

  public get lastSample(): FrameOrientationSample | null {
    return this.ring.length ? this.ring[this.ring.length - 1] : null;
  }
}

export interface MovementDiagEvent {
  kind: MovementDiagEventKind;
  reason: string;
  source: string;
  detail: Record<string, unknown>;
  timestamp: number;
}

export interface MovementDiagSnapshot {
  buildLabel: string;
  speedUnits: number;
  player: { x: number; y: number; z: number };
  yawDeg: number;
  pitchDeg: number;
  fov: number;
  frameDeltaMs: number;
  voidDeathY: number | null;
  lastEvent: MovementDiagEvent | null;
  /** Live orientation detail (from ViewSnapDetector). */
  orientation?: {
    rawX: number;
    rawY: number;
    mouseEvents: number;
    yawBeforeDeg: number;
    yawAfterDeg: number;
    pitchBeforeDeg: number;
    pitchAfterDeg: number;
    expectedYawDeg: number;
    expectedPitchDeg: number;
    actualYawDeg: number;
    actualPitchDeg: number;
    isLocked: boolean;
    justLocked: boolean;
    mouseHandlers: number;
    rawInputActive: boolean;
  };
  lastViewSnap: MovementDiagEvent | null;
  lastRawSpike: MovementDiagEvent | null;
}

const num = (v: number, digits = 3): string =>
  Number.isFinite(v) ? v.toFixed(digits) : String(v);

/**
 * Runtime movement-diagnostics controller.
 *
 * The `isEnabled` flag is read from the URL at construction, so a production
 * bundle activates it purely by URL. Logging calls are always compiled in; the
 * flag only decides whether anything is recorded/rendered.
 */
export class MovementDiagnostics {
  public readonly isEnabled: boolean;
  private lastEvent: MovementDiagEvent | null = null;
  private eventCount = 0;
  private overlay: HTMLElement | null = null;
  /** Guards against a single frame emitting the same event repeatedly. */
  private lastEventSignature = '';
  private lastEventTime = 0;

  constructor(search?: string) {
    const q = search ?? (typeof window !== 'undefined' ? window.location.search : '');
    this.isEnabled = MovementDiagnostics.isRequested(q);
    if (this.isEnabled) {
      this.createOverlay();
    }
  }

  /** True when the URL explicitly requests movement diagnostics. */
  public static isRequested(search: string): boolean {
    try {
      const params = new URLSearchParams(search || '');
      const v = params.get('debugMovement');
      return v === '1' || v === 'true';
    } catch {
      return false;
    }
  }

  /**
   * True when the URL asks for the viewmodel to be hidden, to isolate whether an
   * apparent view snap is the world view or the viewmodel sway illusion.
   * Hides the hands/knife ONLY — camera, input, FOV and physics are untouched.
   */
  public static isViewmodelHiddenRequested(search: string): boolean {
    try {
      const params = new URLSearchParams(search || '');
      const v = params.get('debugNoViewmodel');
      return v === '1' || v === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Counts the game's own mousemove handler registrations, to prove the
   * listener lifecycle stays stable across Movement Lab enter/exit and
   * pause/resume cycles (a duplicate mousemove handler would apply every delta
   * twice, which would look exactly like a view snap).
   */
  public static describeHandlerCount(count: number): string {
    return count === 1 ? '1 (ok)' : `${count} (EXPECTED 1)`;
  }

  /** Records an event and mirrors it to the console. */
  public record(
    kind: MovementDiagEventKind,
    reason: string,
    source: string,
    detail: Record<string, unknown>
  ): void {
    const event: MovementDiagEvent = { kind, reason, source, detail, timestamp: Date.now() };
    this.lastEvent = event;
    this.eventCount++;

    // Keep the console output for every event (unconditional: this is the whole
    // point of the mode existing in production).
    const tag = kind === 'RESTORE'
      ? '[PLAYHEAD RESTORE]'
      : kind === 'PLAYER_CORRECTION'
        ? '[PLAYER CORRECTION]'
        : kind === 'CAMERA_DESYNC'
          ? '[CAMERA DESYNC]'
          : kind === 'VIEW_SNAP'
            ? '[VIEW SNAP]'
            : kind === 'RAW_MOUSE_SPIKE'
              ? '[RAW MOUSE SPIKE]'
              : '[MOVEMENT DIAG]';

    // `reason` is inlined into the string so it is readable immediately in the
    // DevTools console without expanding the object. The full structured detail
    // is passed as a second argument so every field stays inspectable.
    console.warn(
      `${tag} reason=${reason} source=${source}`,
      { kind, reason, source, ...detail, timestamp: event.timestamp }
    );
  }

  /**
   * Rate-limited variant, for conditions that could otherwise fire every frame
   * (e.g. a sustained collision correction).
   */
  public recordThrottled(
    kind: MovementDiagEventKind,
    reason: string,
    source: string,
    detail: Record<string, unknown>,
    signature: string,
    minIntervalMs = 250
  ): void {
    const now = Date.now();
    if (signature === this.lastEventSignature && now - this.lastEventTime < minIntervalMs) {
      // Still update the stored event so the overlay stays truthful.
      this.lastEvent = { kind, reason, source, detail, timestamp: now };
      return;
    }
    this.lastEventSignature = signature;
    this.lastEventTime = now;
    this.record(kind, reason, source, detail);
  }

  public getLastEvent(): MovementDiagEvent | null {
    return this.lastEvent;
  }

  public getEventCount(): number {
    return this.eventCount;
  }

  /** Updates the on-screen overlay (no-op when disabled). */
  public update(snapshot: MovementDiagSnapshot): void {
    if (!this.isEnabled || !this.overlay) return;

    const e = snapshot.lastEvent;
    const reasonLine = e ? `${e.kind} :: ${e.reason}` : '(no events yet)';
    const detailLine = e
      ? Object.entries(e.detail)
          .slice(0, 14)
          .map(([k, v]) =>
            typeof v === 'number' ? `${k}=${num(v)}` : `${k}=${JSON.stringify(v)}`
          )
          .join('  ')
      : '';

    const lines = [
      `=== MOVEMENT DIAGNOSTICS (debugMovement) ===`,
      `${snapshot.buildLabel}   events=${this.eventCount}   mouseHandlers=${snapshot.orientation ? snapshot.orientation.mouseHandlers : '?'}`,
      `SPEED      ${num(snapshot.speedUnits, 1)}`,
      `PLAYER     ${num(snapshot.player.x, 2)}, ${num(snapshot.player.y, 2)}, ${num(snapshot.player.z, 2)}`,
      `YAW/PITCH  ${num(snapshot.yawDeg, 2)} / ${num(snapshot.pitchDeg, 2)}   FOV ${num(snapshot.fov, 1)}   dt ${num(snapshot.frameDeltaMs, 1)}ms`,
      `VOID_Y     ${snapshot.voidDeathY === null ? 'null' : num(snapshot.voidDeathY, 2)}`
    ];

    if (snapshot.orientation) {
      const o = snapshot.orientation;
      lines.push(
        ``,
        `RAW DX/DY  ${num(o.rawX, 1)} / ${num(o.rawY, 1)}   events=${o.mouseEvents}`,
        `YAW   ${num(o.yawBeforeDeg, 2)} -> ${num(o.yawAfterDeg, 2)}`,
        `PITCH ${num(o.pitchBeforeDeg, 2)} -> ${num(o.pitchAfterDeg, 2)}`,
        `EXPECTED D ${num(o.expectedYawDeg, 3)} / ${num(o.expectedPitchDeg, 3)}`,
        `ACTUAL   D ${num(o.actualYawDeg, 3)} / ${num(o.actualPitchDeg, 3)}`,
        `POINTER LOCK ${o.isLocked}   JUST LOCKED ${o.justLocked}   RAW INPUT ${o.rawInputActive}`
      );
    }

    lines.push(
      ``,
      `LAST EVENT ${e ? new Date(e.timestamp).toISOString().slice(11, 23) : '-'}`,
      `REASON     ${reasonLine}`,
      detailLine
    );

    const vs = snapshot.lastViewSnap;
    if (vs) {
      lines.push(
        `LAST VIEW SNAP ${new Date(vs.timestamp).toISOString().slice(11, 23)}`,
        `VS REASON  ${vs.reason}`,
        Object.entries(vs.detail)
          .slice(0, 12)
          .map(([k, v]) => (typeof v === 'number' ? `${k}=${num(v)}` : `${k}=${JSON.stringify(v)}`))
          .join('  ')
      );
    }

    const rs = snapshot.lastRawSpike;
    if (rs) {
      lines.push(
        `LAST RAW SPIKE ${new Date(rs.timestamp).toISOString().slice(11, 23)}`,
        `RS REASON  ${rs.reason}`,
        Object.entries(rs.detail)
          .slice(0, 12)
          .map(([k, v]) => (typeof v === 'number' ? `${k}=${num(v)}` : `${k}=${JSON.stringify(v)}`))
          .join('  ')
      );
    }

    this.overlay.textContent = lines.join('\n');
  }

  private createOverlay(): void {
    if (typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.id = 'movement-diag-overlay';
    el.style.cssText = [
      'position:fixed',
      'left:8px',
      'bottom:8px',
      'z-index:2147483647',
      'max-width:min(1080px, 96vw)',
      'padding:8px 10px',
      'background:rgba(4,8,14,0.86)',
      'border:1px solid rgba(0,240,255,0.45)',
      'color:#00f0ff',
      'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      'white-space:pre-wrap',
      'word-break:break-word',
      'pointer-events:none',
      'text-shadow:0 0 4px rgba(0,240,255,0.35)'
    ].join(';');
    el.textContent = `${BUILD_LABEL} — movement diagnostics active`;
    document.body.appendChild(el);
    this.overlay = el;
  }

  public dispose(): void {
    if (this.overlay && this.overlay.parentElement) {
      this.overlay.parentElement.removeChild(this.overlay);
    }
    this.overlay = null;
  }
}

/**
 * RAW MOUSE INPUT SPIKE DETECTOR
 *
 * Class B diagnosis: the raw browser `movementX/movementY` itself jumps, and the
 * camera then CORRECTLY follows that bad input — so an actual-vs-expected
 * orientation comparison reports nothing. This detector watches the raw stream
 * instead, using robust statistics over recent history rather than a hard-coded
 * threshold, so ordinary fast flicks are not flagged.
 */
export interface RawMouseSample {
  timestamp: number;
  movementX: number;
  movementY: number;
  magnitude: number;
  eventsThisFrame: number;
  sumXThisFrame: number;
  sumYThisFrame: number;
  maxAbsXThisFrame: number;
  maxAbsYThisFrame: number;
  sincePrevEventMs: number;
  frameDeltaMs: number;
  isLocked: boolean;
  mouseLookEnabled: boolean;
  gameState: string;
}

export interface RawSpikeReport {
  reason: string;
  sample: RawMouseSample;
  medianMagnitude: number;
  mad: number;
  ratio: number;
  windowSize: number;
}

export class RawMouseSpikeDetector {
  private history: number[] = [];
  private readonly maxHistory = 400;
  private readonly minHistory = 30;

  private frameEvents = 0;
  private frameSumX = 0;
  private frameSumY = 0;
  private frameMaxAbsX = 0;
  private frameMaxAbsY = 0;
  private lastEventTime = 0;

  private lastSample: RawMouseSample | null = null;

  private median(values: number[]): number {
    if (values.length === 0) return 0;
    const s = [...values].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  /** Records one raw DOM mouse event. Returns a report if it looks anomalous. */
  public noteEvent(
    movementX: number,
    movementY: number,
    ctx: {
      frameDeltaMs: number;
      isLocked: boolean;
      mouseLookEnabled: boolean;
      gameState: string;
    }
  ): RawSpikeReport | null {
    const now = Date.now();
    const magnitude = Math.hypot(movementX, movementY);
    const sincePrev = this.lastEventTime ? now - this.lastEventTime : 0;
    this.lastEventTime = now;

    this.frameEvents++;
    this.frameSumX += movementX;
    this.frameSumY += movementY;
    this.frameMaxAbsX = Math.max(this.frameMaxAbsX, Math.abs(movementX));
    this.frameMaxAbsY = Math.max(this.frameMaxAbsY, Math.abs(movementY));

    // Establish the "normal" distribution before judging anything.
    const ready = this.history.length >= this.minHistory;
    const med = this.median(this.history);
    const deviations = this.history.map((v) => Math.abs(v - med));
    const mad = this.median(deviations);

    let report: RawSpikeReport | null = null;

    if (ready && magnitude > 0) {
      // Robust z-score. 1.4826 scales MAD to a standard-deviation equivalent.
      const sigma = Math.max(mad * 1.4826, 1e-6);
      const ratio = magnitude / Math.max(med, 1e-6);
      const z = (magnitude - med) / sigma;

      // Flag only genuinely extreme single-event outliers: a large robust z AND
      // a large multiple of the recent typical magnitude. A fast flick is a
      // sustained stream of moderate events, so it does not trip this.
      if (z > 12 && ratio > 8 && magnitude > 120) {
        report = {
          reason: `SINGLE_EVENT_OUTLIER z=${z.toFixed(1)} ratio=${ratio.toFixed(1)}`,
          sample: this.buildSample(movementX, movementY, magnitude, sincePrev, ctx),
          medianMagnitude: med,
          mad,
          ratio,
          windowSize: this.history.length
        };
      }
    }

    // Update history with the observed magnitude (floored so idle noise cannot
    // shrink MAD to zero and make everything look like an outlier).
    this.history.push(Math.max(magnitude, 1));
    if (this.history.length > this.maxHistory) this.history.shift();

    this.lastSample = this.buildSample(movementX, movementY, magnitude, sincePrev, ctx);
    return report;
  }

  private buildSample(
    movementX: number,
    movementY: number,
    magnitude: number,
    sincePrev: number,
    ctx: { frameDeltaMs: number; isLocked: boolean; mouseLookEnabled: boolean; gameState: string }
  ): RawMouseSample {
    return {
      timestamp: Date.now(),
      movementX,
      movementY,
      magnitude,
      eventsThisFrame: this.frameEvents,
      sumXThisFrame: this.frameSumX,
      sumYThisFrame: this.frameSumY,
      maxAbsXThisFrame: this.frameMaxAbsX,
      maxAbsYThisFrame: this.frameMaxAbsY,
      sincePrevEventMs: sincePrev,
      frameDeltaMs: ctx.frameDeltaMs,
      isLocked: ctx.isLocked,
      mouseLookEnabled: ctx.mouseLookEnabled,
      gameState: ctx.gameState
    };
  }

  /**
   * Called once per rendered frame. Reports an aggregate spike when a single
   * frame accumulates an implausibly large angular displacement.
   *
   * `degPerPixel` converts the raw sum into the angular delta the camera will
   * actually apply, so the threshold is expressed in real view terms.
   */
  public endFrame(degPerPixel: number): RawSpikeReport | null {
    const sumMagnitude = Math.hypot(this.frameSumX, this.frameSumY);
    const impliedDegrees = sumMagnitude * degPerPixel * (180 / Math.PI);

    let report: RawSpikeReport | null = null;

    // A single rendered frame implying an enormous turn (>170deg) from a large
    // number of pixels is the signature of a discontinuity rather than a flick:
    // a genuine flick is spread across many frames and many DOM events.
    if (impliedDegrees > 170 && sumMagnitude > 400 && this.frameEvents <= 2) {
      report = {
        reason: `FRAME_ANGULAR_SPIKE impliedDeg=${impliedDegrees.toFixed(1)} events=${this.frameEvents} sumPx=${sumMagnitude.toFixed(1)}`,
        sample: this.lastSample ?? {
          timestamp: Date.now(),
          movementX: 0, movementY: 0, magnitude: 0,
          eventsThisFrame: this.frameEvents,
          sumXThisFrame: this.frameSumX, sumYThisFrame: this.frameSumY,
          maxAbsXThisFrame: this.frameMaxAbsX, maxAbsYThisFrame: this.frameMaxAbsY,
          sincePrevEventMs: 0, frameDeltaMs: 0,
          isLocked: false, mouseLookEnabled: false, gameState: 'UNKNOWN'
        },
        medianMagnitude: this.median(this.history),
        mad: 0,
        ratio: sumMagnitude / Math.max(this.median(this.history), 1e-6),
        windowSize: this.history.length
      };
    }

    this.frameEvents = 0;
    this.frameSumX = 0;
    this.frameSumY = 0;
    this.frameMaxAbsX = 0;
    this.frameMaxAbsY = 0;

    return report;
  }

  public get last(): RawMouseSample | null {
    return this.lastSample;
  }

  public get historySize(): number {
    return this.history.length;
  }
}

/**
 * Process-wide instance so low-level systems (collision, restore) can emit
 * diagnostics without threading a reference through gameplay code.
 * Disabled by default; only the URL flag turns it on.
 */
export const movementDiagnostics = new MovementDiagnostics();