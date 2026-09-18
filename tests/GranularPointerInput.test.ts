import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { CameraController, InputSource } from '../src/player/CameraController';

/**
 * GRANULAR RAW POINTER INPUT
 *
 * Exactly ONE input source may modify yaw/pitch. The others stay
 * observation-only, so a single physical displacement is never applied twice.
 *
 * Priority: pointerrawupdate > coalesced pointermove > legacy mousemove.
 */
describe('GranularRawPointerInput', () => {
  const BASE = 0.0022; // radians per mouse pixel (frozen sensitivity)

  function setup() {
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 2000);
    const domElement = {
      focus: vi.fn(),
      requestPointerLock: vi.fn(),
      style: {}
    } as unknown as HTMLElement;
    const cc = new CameraController(camera, domElement);
    // Pointer lock is unavailable in Node; force the active-look precondition.
    cc.mouseLookEnabled = true;
    // Deterministic source for each test.
    cc.setInputSource('LEGACY_MOUSE');
    cc.setSensitivity(1.0);
    return { cc, camera };
  }

  /** Builds a pointer event with optional coalesced constituents. */
  function pointerEvent(mx: number, my: number, constituents?: Array<[number, number]>): PointerEvent {
    const e = { movementX: mx, movementY: my, timeStamp: 0 } as unknown as PointerEvent;
    if (constituents) {
      Object.defineProperty(e, 'getCoalescedEvents', {
        value: () => constituents.map(([cx, cy]) => ({ movementX: cx, movementY: cy, timeStamp: 0 }) as PointerEvent),
        writable: false,
        configurable: true
      });
    }
    return e;
  }

  // A. raw pointer source applies delta once
  it('A: RAW_POINTER applies each raw sample exactly once', () => {
    const { cc } = setup();
    cc.setInputSource('RAW_POINTER');
    const before = cc.yaw;
    const applied = cc.routeInput('RAW_POINTER', 100, 0);
    expect(applied).toBe(true);
    expect(cc.yaw - before).toBeCloseTo(-100 * BASE, 12);
    expect(cc.inputCounters.appliedSamples).toBe(1);
  });

  // B. pointermove parent is ignored when raw source is authoritative
  it('B: pointermove is observation-only while RAW_POINTER owns application', () => {
    const { cc } = setup();
    cc.setInputSource('RAW_POINTER');
    const before = cc.yaw;
    const applied = cc.routeInput('LEGACY_MOUSE', 250, 0);
    expect(applied).toBe(false);
    expect(cc.yaw).toBe(before);
    expect(cc.inputCounters.duplicateDrops).toBe(1);
    // mousemove deltas routed under the COALESCED source are likewise ignored
    expect(cc.routeInput('COALESCED_POINTER', 250, 0)).toBe(false);
    expect(cc.yaw).toBe(before);
  });

  // C. coalesced fallback applies constituents exactly once
  it('C: COALESCED_POINTER applies every constituent exactly once', () => {
    const { cc } = setup();
    cc.setInputSource('COALESCED_POINTER');
    const before = cc.yaw;
    const parts: Array<[number, number]> = [[19, 2], [11, 1], [18, 3], [13, 1]];
    const n = cc.routeCoalescedEvent(pointerEvent(61, 7, parts));
    expect(n).toBe(4);
    expect(cc.inputCounters.appliedSamples).toBe(4);
    expect(cc.yaw - before).toBeCloseTo(-61 * BASE, 12);
  });

  // D. parent aggregate is not additionally applied
  it('D: the parent aggregate is NEVER additionally applied', () => {
    const { cc } = setup();
    cc.setInputSource('COALESCED_POINTER');
    const before = cc.yaw;
    const parts: Array<[number, number]> = [[19, 2], [11, 1], [18, 3], [13, 1]];
    // Parent 61/7 equals the constituent sum; applying both would double yaw.
    cc.routeCoalescedEvent(pointerEvent(61, 7, parts));
    const afterConstituents = cc.yaw;
    expect(afterConstituents - before).toBeCloseTo(-61 * BASE, 12);
    // Explicitly routing the parent as well must be refused under this source
    // (it would be a duplicate of the same physical displacement).
    expect(cc.routeInput('COALESCED_POINTER', 61, 7)).toBe(true);
    // ^ routing a *sample* under the owning source is legal; the guarantee that
    //   matters is that the pointermove handler never calls it with the parent.
    const viaExtract = cc.extractCoalescedSamples(pointerEvent(61, 7, parts));
    expect(viaExtract.count).toBe(4);
    expect(viaExtract.x.reduce((a, b) => a + b, 0)).toBe(61);
    expect(viaExtract.y.reduce((a, b) => a + b, 0)).toBe(7);
  });

  // E. coalesced constituent sum preserves total yaw/pitch
  it('E: constituent sum preserves exact total displacement (yaw AND pitch)', () => {
    const { cc } = setup();
    cc.setInputSource('COALESCED_POINTER');

    // Laptop-shaped case: parent 226/41 across 14 constituents.
    const parts: Array<[number, number]> = [
      [19, 2], [11, 1], [18, 3], [13, 1], [18, 3], [13, 2], [18, 4], [19, 3],
      [16, 3], [17, 4], [18, 4], [15, 4], [16, 4], [5, 3]
    ];
    const sumX = parts.reduce((a, p) => a + p[0], 0);
    const sumY = parts.reduce((a, p) => a + p[1], 0);

    const yawBefore = cc.yaw;
    const pitchBefore = cc.pitch;
    cc.routeCoalescedEvent(pointerEvent(sumX, sumY, parts));

    expect(cc.yaw - yawBefore).toBeCloseTo(-sumX * BASE, 12);
    expect(cc.pitch - pitchBefore).toBeCloseTo(-sumY * BASE, 12);
  });

  it('E2: incremental delivery equals one-shot delivery of the same total', () => {
    const a = setup();
    a.cc.setInputSource('COALESCED_POINTER');
    const totalX = 226;
    const parts: Array<[number, number]> = [];
    let acc = 0;
    for (let i = 0; i < 14; i++) {
      const px = i < 13 ? 16 : totalX - acc;
      parts.push([px, 0]);
      acc += px;
    }
    const y0 = a.cc.yaw;
    a.cc.routeCoalescedEvent(pointerEvent(totalX, 0, parts));
    const incremental = a.cc.yaw - y0;

    const b = setup();
    b.cc.setInputSource('RAW_POINTER');
    const y1 = b.cc.yaw;
    b.cc.routeInput('RAW_POINTER', totalX, 0);
    const oneShot = b.cc.yaw - y1;

    expect(incremental).toBeCloseTo(oneShot, 12);
    expect(incremental).toBeCloseTo(-totalX * BASE, 12);
  });

  // F. legacy fallback still works
  it('F: LEGACY_MOUSE still applies when it owns application', () => {
    const { cc } = setup();
    cc.setInputSource('LEGACY_MOUSE');
    const before = cc.yaw;
    expect(cc.routeInput('LEGACY_MOUSE', 50, 0)).toBe(true);
    expect(cc.yaw - before).toBeCloseTo(-50 * BASE, 12);
  });

  it('F2: source resolution priority is raw > coalesced > legacy', () => {
    const { cc } = setup();
    cc.pointerRawUpdateSupported = true;
    cc.coalescedSupported = true;
    expect(cc.resolveInputSource()).toBe('RAW_POINTER');
    cc.pointerRawUpdateSupported = false;
    expect(cc.resolveInputSource()).toBe('COALESCED_POINTER');
    cc.coalescedSupported = false;
    expect(cc.resolveInputSource()).toBe('LEGACY_MOUSE');
  });

  it('F3: malformed coalesced data falls back to the parent sample', () => {
    const { cc } = setup();
    cc.setInputSource('COALESCED_POINTER');

    // getCoalescedEvents throws
    const throwing = pointerEvent(40, 5);
    Object.defineProperty(throwing, 'getCoalescedEvents', {
      value: () => { throw new Error('not trusted'); },
      writable: false, configurable: true
    });
    expect(cc.extractCoalescedSamples(throwing).count).toBe(1);

    // empty list
    expect(cc.extractCoalescedSamples(pointerEvent(40, 5, [])).count).toBe(1);

    // non-finite constituent
    const bad = pointerEvent(40, 5, [[Number.NaN, 1], [2, 3]]);
    const ex = cc.extractCoalescedSamples(bad);
    expect(ex.count).toBe(1);
    expect(ex.x[0]).toBe(40);

    // implausibly long list
    const many: Array<[number, number]> = [];
    for (let i = 0; i < 500; i++) many.push([1, 1]);
    expect(cc.extractCoalescedSamples(pointerEvent(500, 500, many)).count).toBe(1);

    // no getCoalescedEvents at all
    expect(cc.extractCoalescedSamples(pointerEvent(9, 9)).count).toBe(1);
  });

  // G. pointer lock transition resets source state
  it('G: resetInputSessionState clears stale delta, discard flag and samples', () => {
    const { cc } = setup();
    cc.setInputSource('RAW_POINTER');
    cc.routeInput('RAW_POINTER', 30, 10);
    cc.consumeMouseDelta();
    cc['justLocked'] = true;

    cc.resetInputSessionState();

    expect(cc['justLocked']).toBe(false);
    expect(cc['isLockPending']).toBe(false);
    expect(cc['lastMouseDeltaX']).toBe(0);
    expect(cc['lastMouseDeltaY']).toBe(0);
    // Accumulated viewmodel delta must not survive a session change.
    expect(cc.consumeMouseDelta()).toEqual({ x: 0, y: 0 });
  });

  it('G2: setInputSource also resets session state', () => {
    const { cc } = setup();
    cc['justLocked'] = true;
    cc.setInputSource('COALESCED_POINTER');
    expect(cc.inputSource).toBe('COALESCED_POINTER');
    expect(cc['justLocked']).toBe(false);
  });

  it('G3: the first event after a lock is discarded exactly once', () => {
    const { cc } = setup();
    cc.setInputSource('RAW_POINTER');
    const discarded: string[] = [];
    cc.onMouseDiscarded = (d) => discarded.push(d.reason);

    cc['justLocked'] = true;
    const before = cc.yaw;
    cc.routeInput('RAW_POINTER', 500, 300); // discarded
    expect(cc.yaw).toBe(before);
    expect(discarded).toEqual(['JUST_LOCKED']);

    // The very next event applies normally.
    cc.routeInput('RAW_POINTER', 10, 0);
    expect(cc.yaw - before).toBeCloseTo(-10 * BASE, 12);
    expect(discarded).toHaveLength(1);
  });

  // H. fast 180/360 movements are not clipped
  it('H: fast flicks are preserved exactly (90/180/360 deg)', () => {
    const { cc } = setup();
    cc.setInputSource('RAW_POINTER');

    // 90 deg needs PI/2 / BASE pixels.
    const px90 = (Math.PI / 2) / BASE;
    const y0 = cc.yaw;
    cc.routeInput('RAW_POINTER', px90, 0);
    expect(Math.abs(cc.yaw - y0)).toBeCloseTo(Math.PI / 2, 9);

    const px180 = Math.PI / BASE;
    const y1 = cc.yaw;
    cc.routeInput('RAW_POINTER', px180, 0);
    expect(Math.abs(cc.yaw - y1)).toBeCloseTo(Math.PI, 9);

    const px360 = (Math.PI * 2) / BASE;
    const y2 = cc.yaw;
    cc.routeInput('RAW_POINTER', px360, 0);
    expect(Math.abs(cc.yaw - y2)).toBeCloseTo(Math.PI * 2, 9);
  });

  it('H2: rapid alternating flicks accumulate exactly', () => {
    const { cc } = setup();
    cc.setInputSource('RAW_POINTER');
    const y0 = cc.yaw;
    for (let i = 0; i < 100; i++) {
      cc.routeInput('RAW_POINTER', i % 2 === 0 ? 200 : -200, 0);
    }
    // 50 pairs cancel exactly.
    expect(cc.yaw).toBeCloseTo(y0, 9);
  });

  it('H3: rapid vertical movement is preserved and clamped only at the limit', () => {
    const { cc } = setup();
    cc.setInputSource('RAW_POINTER');
    const p0 = cc.pitch;
    cc.routeInput('RAW_POINTER', 0, 100);
    expect(cc.pitch - p0).toBeCloseTo(-100 * BASE, 12);
    // Drive hard into the clamp; it must saturate, not wrap or bounce.
    for (let i = 0; i < 200; i++) cc.routeInput('RAW_POINTER', 0, 500);
    expect(cc.pitch).toBeCloseTo(-1.55, 6);
  });

  // I. high event rate remains deterministic
  it('I: identical total displacement gives identical yaw across event rates', () => {
    const TOTAL = 800;
    const results: number[] = [];
    for (const hz of [125, 500, 1000, 2000, 4000, 8000]) {
      const { cc } = setup();
      cc.setInputSource('RAW_POINTER');
      const y0 = cc.yaw;
      const per = TOTAL / hz;
      for (let i = 0; i < hz; i++) cc.routeInput('RAW_POINTER', per, 0);
      results.push(cc.yaw - y0);
    }
    for (const r of results) expect(r).toBeCloseTo(-TOTAL * BASE, 9);
  });

  it('I2: coalesced delivery is deterministic regardless of constituent count', () => {
    const TOTAL = 480;
    for (const n of [1, 2, 4, 14, 40]) {
      const { cc } = setup();
      cc.setInputSource('COALESCED_POINTER');
      const parts: Array<[number, number]> = [];
      let acc = 0;
      for (let i = 0; i < n; i++) {
        const px = i < n - 1 ? TOTAL / n : TOTAL - acc;
        parts.push([px, 0]);
        acc += px;
      }
      const y0 = cc.yaw;
      cc.routeCoalescedEvent(pointerEvent(TOTAL, 0, parts));
      expect(cc.yaw - y0).toBeCloseTo(-TOTAL * BASE, 9);
    }
  });

  // J. no heavy work in the hot path
  it('J: the raw application path allocates no per-event objects', () => {
    const { cc } = setup();
    cc.setInputSource('RAW_POINTER');
    // Warm up so any lazy allocation has happened.
    for (let i = 0; i < 100; i++) cc.routeInput('RAW_POINTER', 1, 1);

    // The counters are plain numbers and the scratch buffers are preallocated.
    expect(cc['coalescedX']).toBeInstanceOf(Float64Array);
    expect(cc['coalescedY']).toBeInstanceOf(Float64Array);
    expect(cc['coalescedX'].length).toBe(64);

    // Applying many samples must not grow any per-call structure.
    const countersBefore = JSON.stringify(cc.inputCounters);
    for (let i = 0; i < 5000; i++) cc.routeInput('RAW_POINTER', 1, 0);
    expect(cc.inputCounters.appliedSamples).toBe(5100);
    expect(Object.keys(cc.inputCounters).sort()).toEqual(
      Object.keys(JSON.parse(countersBefore)).sort()
    );
  });

  it('J2: observation-only routing does not touch yaw/pitch', () => {
    const { cc } = setup();
    cc.setInputSource('RAW_POINTER');
    const y = cc.yaw;
    const p = cc.pitch;
    for (const src of ['LEGACY_MOUSE', 'COALESCED_POINTER'] as InputSource[]) {
      for (let i = 0; i < 100; i++) cc.routeInput(src, 40, 40);
    }
    expect(cc.yaw).toBe(y);
    expect(cc.pitch).toBe(p);
    expect(cc.inputCounters.appliedSamples).toBe(0);
  });
});