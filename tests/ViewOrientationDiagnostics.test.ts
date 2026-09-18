import { describe, it, expect } from 'vitest';
import { wrapAngleDelta, MovementDiagnostics, ViewSnapDetector } from '../src/core/MovementDiagnostics';
import { PointerInputProbe } from '../src/core/PointerInputProbe';

/**
 * VIEW-ORIENTATION + RAW-INPUT DIAGNOSTICS
 *
 * The critical distinction this suite locks down:
 *  - yaw/pitch are mutated SYNCHRONOUSLY inside the DOM mouse event, so
 *    expected-vs-actual attribution must be EVENT-LOCAL. A frame-separated
 *    comparison reports spurious mismatches.
 */
describe('ViewOrientationDiagnostics', () => {
  const BASE = 0.0022;

  describe('wrapAngleDelta', () => {
    it('treats anti-podal representations as a small change', () => {
      const D = Math.PI / 180;
      expect(wrapAngleDelta(-179 * D - 179 * D)).toBeCloseTo(2 * D, 9);
      expect(wrapAngleDelta(179 * D - -179 * D)).toBeCloseTo(-2 * D, 9);
      expect(wrapAngleDelta(1 * D - 359 * D)).toBeCloseTo(2 * D, 9);
      expect(wrapAngleDelta(359 * D - 1 * D)).toBeCloseTo(-2 * D, 9);
    });

    it('is identity for small deltas and folds larger ones', () => {
      expect(wrapAngleDelta(0.25)).toBeCloseTo(0.25, 12);
      expect(wrapAngleDelta(Math.PI * 2)).toBeCloseTo(0, 9);
      expect(Math.abs(wrapAngleDelta(Math.PI * 3))).toBeLessThanOrEqual(Math.PI + 1e-9);
    });
  });

  describe('EVENT-LOCAL attribution (checkEvent)', () => {
    const evt = (over: Partial<Parameters<ViewSnapDetector['checkEvent']>[0]> = {}) => {
      const movementX = over.movementX ?? 0;
      const movementY = over.movementY ?? 0;
      const expectedYawDelta = over.expectedYawDelta ?? -movementX * BASE;
      const expectedPitchDelta = over.expectedPitchDelta ?? -movementY * BASE;
      return {
        movementX,
        movementY,
        yawBefore: over.yawBefore ?? 0,
        yawAfter: over.yawAfter ?? (over.yawBefore ?? 0) + expectedYawDelta,
        pitchBefore: over.pitchBefore ?? 0,
        pitchAfter: over.pitchAfter ?? (over.pitchBefore ?? 0) + expectedPitchDelta,
        expectedYawDelta,
        expectedPitchDelta,
        pitchClamped: over.pitchClamped ?? false,
        isLocked: over.isLocked ?? true,
        justLocked: over.justLocked ?? false
      };
    };

    it('a correctly applied event reports NO mismatch', () => {
      const d = new ViewSnapDetector();
      expect(d.checkEvent(evt({ movementX: -10, movementY: -3 }))).toBeNull();
      expect(d.checkEvent(evt({ movementX: 131, movementY: -188 }))).toBeNull();
    });

    it('the exact false-positive case (rawX=-10, rawY=-3) is clean', () => {
      // This is the case the human saw reported as YAW_MISMATCH. Applied
      // correctly, it must be silent.
      const d = new ViewSnapDetector();
      const movementX = -10;
      const movementY = -3;
      const yawBefore = 0.42;
      const pitchBefore = -0.11;
      expect(d.checkEvent({
        movementX,
        movementY,
        yawBefore,
        pitchBefore,
        yawAfter: yawBefore - movementX * BASE,
        pitchAfter: pitchBefore - movementY * BASE,
        expectedYawDelta: -movementX * BASE,
        expectedPitchDelta: -movementY * BASE,
        pitchClamped: false,
        isLocked: true,
        justLocked: false
      })).toBeNull();
    });

    it('a genuinely dropped yaw application IS reported', () => {
      const d = new ViewSnapDetector();
      const r = d.checkEvent(evt({
        movementX: 100,
        yawBefore: 0,
        yawAfter: 0 // input was not applied
      }));
      expect(r).toContain('YAW_MISMATCH');
    });

    it('a genuinely dropped pitch application IS reported', () => {
      const d = new ViewSnapDetector();
      const r = d.checkEvent(evt({
        movementY: 100,
        pitchBefore: 0,
        pitchAfter: 0
      }));
      expect(r).toContain('PITCH_MISMATCH');
    });

    it('pitch clamp saturation is NOT reported', () => {
      const d = new ViewSnapDetector();
      const r = d.checkEvent(evt({
        movementY: 5000,
        pitchBefore: 1.0,
        pitchAfter: 1.55,
        pitchClamped: true
      }));
      expect(r).toBeNull();
    });

    it('large raw events (laptop-style 131/-188) apply exactly', () => {
      const d = new ViewSnapDetector();
      const yawBefore = 1.234;
      const pitchBefore = -0.5;
      const r = d.checkEvent({
        movementX: 131,
        movementY: -188,
        yawBefore,
        pitchBefore,
        yawAfter: yawBefore - 131 * BASE,
        pitchAfter: pitchBefore + 188 * BASE,
        expectedYawDelta: -131 * BASE,
        expectedPitchDelta: 188 * BASE,
        pitchClamped: false,
        isLocked: true,
        justLocked: false
      });
      expect(r).toBeNull();
    });
  });

  describe('FRAME-LEVEL quaternion check (checkQuaternion)', () => {
    it('agrees when the quaternion matches yaw/pitch', () => {
      const d = new ViewSnapDetector();
      expect(d.checkQuaternion({ yaw: 0.7, pitch: 0.2, quatYaw: 0.7, quatPitch: 0.2 })).toBeNull();
    });

    it('reports divergence from a second orientation writer', () => {
      const d = new ViewSnapDetector();
      expect(d.checkQuaternion({ yaw: 0, pitch: 0, quatYaw: 2.0, quatPitch: 0 }))
        .toContain('QUATERNION_YAW_DIVERGENCE');
      expect(d.checkQuaternion({ yaw: 0, pitch: 0, quatYaw: 0, quatPitch: 1.0 }))
        .toContain('QUATERNION_PITCH_DIVERGENCE');
    });

    it('does not confuse yaw wrapping with divergence', () => {
      const d = new ViewSnapDetector();
      const D = Math.PI / 180;
      // 181deg and -179deg are the SAME physical yaw (2*PI apart).
      expect(d.checkQuaternion({ yaw: 181 * D, pitch: 0, quatYaw: -179 * D, quatPitch: 0 })).toBeNull();
      // 540deg (unbounded accumulation) and 180deg are also the same yaw.
      expect(d.checkQuaternion({ yaw: 540 * D, pitch: 0, quatYaw: 180 * D, quatPitch: 0 })).toBeNull();
      // 179deg vs -179deg differ by a real 2deg and MUST be reported.
      expect(d.checkQuaternion({ yaw: 179 * D, pitch: 0, quatYaw: -179 * D, quatPitch: 0 }))
        .toContain('QUATERNION_YAW_DIVERGENCE');
    });
  });

  describe('diagnostic flag parsing', () => {
    it('parses ?debugMovement=1 and variants', () => {
      expect(MovementDiagnostics.isRequested('?debugMovement=1')).toBe(true);
      expect(MovementDiagnostics.isRequested('?debugMovement=true')).toBe(true);
      expect(MovementDiagnostics.isRequested('?debugMovement=0')).toBe(false);
      expect(MovementDiagnostics.isRequested('')).toBe(false);
    });

    it('parses ?debugNoViewmodel=1', () => {
      expect(MovementDiagnostics.isViewmodelHiddenRequested('?debugNoViewmodel=1')).toBe(true);
      expect(MovementDiagnostics.isViewmodelHiddenRequested('?debugMovement=1')).toBe(false);
    });

    it('parses ?pointerInputExperiment=1', () => {
      expect(MovementDiagnostics.isPointerInputExperimentRequested('?pointerInputExperiment=1')).toBe(true);
      expect(MovementDiagnostics.isPointerInputExperimentRequested('?debugMovement=1')).toBe(false);
    });
  });
});

/**
 * Coalesced pointer-input accounting.
 * The probe must PRESERVE total displacement and never double-apply.
 */
describe('PointerInputProbe', () => {
  function fakePointerEvent(mx: number, my: number, constituents?: Array<[number, number]>): PointerEvent {
    const e = {
      movementX: mx,
      movementY: my,
      timeStamp: 1000
    } as unknown as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
    if (constituents) {
      e.getCoalescedEvents = () =>
        constituents.map(([cx, cy], i) => ({
          movementX: cx,
          movementY: cy,
          timeStamp: 1000 + i
        }) as PointerEvent);
    }
    return e;
  }

  it('treats an event without getCoalescedEvents as one sample', () => {
    const p = new PointerInputProbe();
    const r = p.observe('pointermove', fakePointerEvent(10, -4), { isLocked: true, gameState: 'PLAYING' });
    expect(r.constituentCount).toBe(1);
    expect(r.sumX).toBe(10);
    expect(r.sumY).toBe(-4);
    expect(r.sumMatchesParent).toBe(true);
  });

  it('preserves total displacement across coalesced constituents', () => {
    const p = new PointerInputProbe();
    // Parent 131/-188 composed of many small samples.
    const parts: Array<[number, number]> = [];
    let sx = 0, sy = 0;
    for (let i = 0; i < 20; i++) {
      const cx = i < 19 ? 7 : 131 - sx;
      const cy = i < 19 ? -10 : -188 - sy;
      parts.push([cx, cy]);
      sx += cx; sy += cy;
    }
    const r = p.observe('pointerrawupdate', fakePointerEvent(131, -188, parts), { isLocked: true, gameState: 'PLAYING' });
    expect(r.constituentCount).toBe(20);
    expect(r.sumX).toBeCloseTo(131, 6);
    expect(r.sumY).toBeCloseTo(-188, 6);
    expect(r.sumMatchesParent).toBe(true);
    expect(r.largestConstituentMagnitude).toBeLessThan(r.parentMagnitude);
  });

  it('flags a parent/constituent sum mismatch (would imply double-apply risk)', () => {
    const p = new PointerInputProbe();
    // Constituents that do NOT sum to the parent delta.
    const r = p.observe('pointermove', fakePointerEvent(100, 0, [[10, 0], [10, 0]]), { isLocked: true, gameState: 'PLAYING' });
    expect(r.sumMatchesParent).toBe(false);
    expect(p.counts.sumMismatches).toBe(1);
  });

  it('tracks the largest parent event with its breakdown', () => {
    const p = new PointerInputProbe();
    p.observe('pointermove', fakePointerEvent(5, 0), { isLocked: true, gameState: 'PLAYING' });
    p.observe('pointerrawupdate', fakePointerEvent(229, -1, [[11, 0], [12, 0]]), { isLocked: true, gameState: 'PLAYING' });
    p.observe('pointermove', fakePointerEvent(6, 0), { isLocked: true, gameState: 'PLAYING' });
    const largest = p.largestParentEvent!;
    expect(largest.parentMagnitude).toBeCloseTo(229, 0);
    expect(largest.constituentCount).toBe(2);
    expect(p.counts.maxConstituentCount).toBe(2);
  });

  it('counts multi-constituent deliveries separately', () => {
    const p = new PointerInputProbe();
    p.observe('pointermove', fakePointerEvent(3, 0), { isLocked: true, gameState: 'PLAYING' });
    p.observe('pointermove', fakePointerEvent(9, 0, [[3, 0], [3, 0], [3, 0]]), { isLocked: true, gameState: 'PLAYING' });
    expect(p.counts.multiConstituent).toBe(1);
    expect(p.counts.pointerMove).toBe(2);
  });

  it('reports capabilities without throwing when APIs are absent', () => {
    const caps = PointerInputProbe.detectCapabilities();
    expect(typeof caps.hasPointerEvent).toBe('boolean');
    expect(typeof caps.hasGetCoalescedEvents).toBe('boolean');
    expect(typeof caps.hasPointerRawUpdate).toBe('boolean');
  });
});