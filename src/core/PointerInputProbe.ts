/**
 * POINTER INPUT COALESCING PROBE (experimental, diagnostics only)
 *
 * Answers: when PLAYHEAD receives a large `mousemove` delta (e.g. 131/-188),
 * is that a genuine single raw sample, or is the browser merging several
 * smaller physical samples into one dispatch?
 *
 * Registers `pointerrawupdate` / `pointermove` listeners PURELY to observe.
 * It NEVER applies input — the production `mousemove` path remains the single
 * authoritative mouse-look source. Enabled only by ?pointerInputExperiment=1.
 *
 * Client-side only. No telemetry, no network.
 */

export interface CoalescedSample {
  movementX: number;
  movementY: number;
  timeStamp: number;
}

export interface PointerProbeReport {
  /** Which DOM event produced this observation. */
  source: 'pointerrawupdate' | 'pointermove';
  parentX: number;
  parentY: number;
  parentMagnitude: number;
  /** Number of constituent samples the browser exposed (>=1). */
  constituentCount: number;
  constituents: CoalescedSample[];
  sumX: number;
  sumY: number;
  /** True when the constituents sum to the parent delta. */
  sumMatchesParent: boolean;
  largestConstituentMagnitude: number;
  /** Spread between first and last constituent timestamp, ms. */
  timestampSpreadMs: number;
  timeSincePrevEventMs: number;
  isLocked: boolean;
  gameState: string;
}

export interface PointerInputCapabilities {
  hasPointerEvent: boolean;
  hasGetCoalescedEvents: boolean;
  hasPointerRawUpdate: boolean;
  hasUnadjustedMovement: boolean;
  /** Actual result of requesting raw pointer lock, if attempted. */
  rawLockResult: string;
}

/**
 * Observes pointer input granularity. Cheap: the handler does arithmetic and
 * bounded array work only, and only runs while the experiment is enabled.
 */
export class PointerInputProbe {
  private lastEventTime = 0;
  private reports: PointerProbeReport[] = [];
  private readonly maxReports = 200;

  /** Aggregate counters for the overlay. */
  public counts = {
    rawUpdate: 0,
    pointerMove: 0,
    multiConstituent: 0,
    maxConstituentCount: 0,
    largestParentMagnitude: 0,
    largestConstituentMagnitude: 0,
    sumMismatches: 0
  };

  public static detectCapabilities(): PointerInputCapabilities {
    const w = typeof window !== 'undefined' ? window : ({} as Window);
    const pe = typeof (w as unknown as { PointerEvent?: unknown }).PointerEvent !== 'undefined';
    const proto = pe ? (w as unknown as { PointerEvent: { prototype: object } }).PointerEvent.prototype : null;
    return {
      hasPointerEvent: pe,
      hasGetCoalescedEvents: !!(proto && typeof (proto as { getCoalescedEvents?: unknown }).getCoalescedEvents === 'function'),
      hasPointerRawUpdate: typeof w !== 'undefined' && 'onpointerrawupdate' in w,
      hasUnadjustedMovement: typeof document !== 'undefined' && 'pointerLockElement' in document,
      rawLockResult: 'unknown'
    };
  }

  /**
   * Builds a report from a pointer event. `getCoalescedEvents` is optional and
   * feature-detected; when absent, the parent event is treated as a single
   * constituent sample.
   */
  public observe(
    source: 'pointerrawupdate' | 'pointermove',
    e: PointerEvent | MouseEvent,
    ctx: { isLocked: boolean; gameState: string }
  ): PointerProbeReport {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const sincePrev = this.lastEventTime ? now - this.lastEventTime : 0;
    this.lastEventTime = now;

    const parentX = e.movementX;
    const parentY = e.movementY;
    const parentMagnitude = Math.hypot(parentX, parentY);

    // Feature-detected coalesced samples.
    let constituents: CoalescedSample[] = [];
    const maybe = e as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
    if (typeof maybe.getCoalescedEvents === 'function') {
      try {
        const list = maybe.getCoalescedEvents();
        if (list && list.length > 0) {
          constituents = list.map((c) => ({
            movementX: c.movementX,
            movementY: c.movementY,
            timeStamp: c.timeStamp
          }));
        }
      } catch {
        // getCoalescedEvents can throw for non-trusted events.
      }
    }
    if (constituents.length === 0) {
      constituents = [{ movementX: parentX, movementY: parentY, timeStamp: e.timeStamp }];
    }

    let sumX = 0;
    let sumY = 0;
    let largestConstituentMagnitude = 0;
    let minT = Infinity;
    let maxT = -Infinity;
    for (const c of constituents) {
      sumX += c.movementX;
      sumY += c.movementY;
      largestConstituentMagnitude = Math.max(largestConstituentMagnitude, Math.hypot(c.movementX, c.movementY));
      minT = Math.min(minT, c.timeStamp);
      maxT = Math.max(maxT, c.timeStamp);
    }

    const TOL = 0.5;
    const sumMatchesParent =
      Math.abs(sumX - parentX) <= TOL && Math.abs(sumY - parentY) <= TOL;

    const report: PointerProbeReport = {
      source,
      parentX,
      parentY,
      parentMagnitude,
      constituentCount: constituents.length,
      constituents,
      sumX,
      sumY,
      sumMatchesParent,
      largestConstituentMagnitude,
      timestampSpreadMs: Number.isFinite(minT) && Number.isFinite(maxT) ? maxT - minT : 0,
      timeSincePrevEventMs: sincePrev,
      isLocked: ctx.isLocked,
      gameState: ctx.gameState
    };

    // Counters
    if (source === 'pointerrawupdate') this.counts.rawUpdate++;
    else this.counts.pointerMove++;
    if (constituents.length > 1) this.counts.multiConstituent++;
    this.counts.maxConstituentCount = Math.max(this.counts.maxConstituentCount, constituents.length);
    this.counts.largestParentMagnitude = Math.max(this.counts.largestParentMagnitude, parentMagnitude);
    this.counts.largestConstituentMagnitude = Math.max(
      this.counts.largestConstituentMagnitude,
      largestConstituentMagnitude
    );
    if (!sumMatchesParent) this.counts.sumMismatches++;

    this.reports.push(report);
    if (this.reports.length > this.maxReports) this.reports.shift();

    return report;
  }

  /** Most recent observations. */
  public recent(n = 10): PointerProbeReport[] {
    return this.reports.slice(-n);
  }

  /**
   * The largest parent-magnitude event seen, with its constituent breakdown.
   * This is the key artefact: does the big delta decompose into small samples?
   */
  public get largestParentEvent(): PointerProbeReport | null {
    let best: PointerProbeReport | null = null;
    for (const r of this.reports) {
      if (!best || r.parentMagnitude > best.parentMagnitude) best = r;
    }
    return best;
  }

  public clear(): void {
    this.reports = [];
  }
}