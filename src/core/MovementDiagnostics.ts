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
  | 'OTHER';

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

    this.overlay.textContent = [
      `=== MOVEMENT DIAGNOSTICS (debugMovement) ===`,
      `${snapshot.buildLabel}   frames-events=${this.eventCount}`,
      `SPEED      ${num(snapshot.speedUnits, 1)}`,
      `PLAYER     ${num(snapshot.player.x, 2)}, ${num(snapshot.player.y, 2)}, ${num(snapshot.player.z, 2)}`,
      `YAW/PITCH  ${num(snapshot.yawDeg, 2)} / ${num(snapshot.pitchDeg, 2)}   FOV ${num(snapshot.fov, 1)}   dt ${num(snapshot.frameDeltaMs, 1)}ms`,
      `VOID_Y     ${snapshot.voidDeathY === null ? 'null' : num(snapshot.voidDeathY, 2)}`,
      ``,
      `LAST EVENT ${e ? new Date(e.timestamp).toISOString().slice(11, 23) : '-'}`,
      `REASON     ${reasonLine}`,
      detailLine
    ].join('\n');
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
 * Process-wide instance so low-level systems (collision, restore) can emit
 * diagnostics without threading a reference through gameplay code.
 * Disabled by default; only the URL flag turns it on.
 */
export const movementDiagnostics = new MovementDiagnostics();