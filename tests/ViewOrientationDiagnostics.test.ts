import { describe, it, expect } from 'vitest';
import { wrapAngleDelta, MovementDiagnostics, ViewSnapDetector } from '../src/core/MovementDiagnostics';

/**
 * VIEW-ORIENTATION DISCONTINUITY REGRESSION
 *
 * Yaw is an angle. Legitimate +/-PI wrapping must never be classified as a view
 * snap, and a real unexplained orientation change must be caught.
 */
describe('ViewOrientationDiagnostics', () => {
  describe('wrapAngleDelta', () => {
    it('treats anti-podal representations as a small change', () => {
      const D = Math.PI / 180;
      // 179deg -> -179deg is physically a 2deg change, NOT 358deg.
      expect(wrapAngleDelta(-179 * D - 179 * D)).toBeCloseTo(2 * D, 9);
      // -179deg -> 179deg likewise.
      expect(wrapAngleDelta(179 * D - -179 * D)).toBeCloseTo(-2 * D, 9);
      // 359deg -> 1deg is 2deg.
      expect(wrapAngleDelta(1 * D - 359 * D)).toBeCloseTo(2 * D, 9);
      // 1deg -> 359deg is -2deg.
      expect(wrapAngleDelta(359 * D - 1 * D)).toBeCloseTo(-2 * D, 9);
    });

    it('is identity for small deltas and folds larger ones', () => {
      expect(wrapAngleDelta(0.25)).toBeCloseTo(0.25, 12);
      expect(wrapAngleDelta(-0.25)).toBeCloseTo(-0.25, 12);
      expect(wrapAngleDelta(Math.PI * 2)).toBeCloseTo(0, 9);
      expect(wrapAngleDelta(-Math.PI * 2)).toBeCloseTo(0, 9);
      expect(Math.abs(wrapAngleDelta(Math.PI * 3))).toBeLessThanOrEqual(Math.PI + 1e-9);
    });

    it('passes through non-finite values unchanged', () => {
      expect(Number.isNaN(wrapAngleDelta(NaN))).toBe(true);
      expect(wrapAngleDelta(Infinity)).toBe(Infinity);
    });
  });

  describe('ViewSnapDetector', () => {
    const base = {
      baseSensitivity: 0.0022,
      sensitivity: 1.0,
      isLocked: true,
      justLocked: false,
      frameDeltaMs: 16,
      playerPos: { x: 0, y: 0, z: 0 },
      displaySpeed: 0
    };

    it('does NOT report a snap for a normal mouse-driven turn', () => {
      const d = new ViewSnapDetector();
      d.noteMouseDelta(100, 0);
      const expectedYaw = -100 * 0.0022;
      const r = d.endFrame({
        ...base,
        yawBefore: 0,
        yawAfter: expectedYaw,
        pitchBefore: 0,
        pitchAfter: 0,
        quatYawBefore: 0,
        quatYawAfter: expectedYaw,
        quatPitchBefore: 0,
        quatPitchAfter: 0
      });
      expect(r.diagnosis).toBeNull();
    });

    it('does NOT report a snap across a legitimate +/-PI yaw wrap', () => {
      const d = new ViewSnapDetector();
      const D = Math.PI / 180;
      // Raw input that produces a 2deg change near the wrap boundary.
      const factor = 0.0022;
      d.noteMouseDelta(-2 * D / factor, 0);
      const yawBefore = 179 * D;
      const yawAfter = -179 * D;
      const r = d.endFrame({
        ...base,
        yawBefore,
        yawAfter,
        pitchBefore: 0,
        pitchAfter: 0,
        quatYawBefore: yawBefore,
        quatYawAfter: yawAfter,
        quatPitchBefore: 0,
        quatPitchAfter: 0
      });
      expect(r.diagnosis).toBeNull();
    });

    it('REPORTS a snap when yaw changes with no mouse input', () => {
      const d = new ViewSnapDetector();
      const r = d.endFrame({
        ...base,
        yawBefore: 0,
        yawAfter: 1.5,
        pitchBefore: 0,
        pitchAfter: 0,
        quatYawBefore: 0,
        quatYawAfter: 1.5,
        quatPitchBefore: 0,
        quatPitchAfter: 0
      });
      expect(r.diagnosis).toContain('YAW_MISMATCH');
    });

    it('REPORTS a snap when pitch changes without matching mouse input', () => {
      const d = new ViewSnapDetector();
      const r = d.endFrame({
        ...base,
        yawBefore: 0.5,
        yawAfter: 0.5,
        pitchBefore: 0.1,
        pitchAfter: 0.6, // 0.5 rad change with zero input, nowhere near a limit
        quatYawBefore: 0.5,
        quatYawAfter: 0.5,
        quatPitchBefore: 0.1,
        quatPitchAfter: 0.6
      });
      expect(r.diagnosis).toContain('PITCH_MISMATCH');
    });

    it('REPORTS divergence when the camera quaternion disagrees with yaw/pitch', () => {
      const d = new ViewSnapDetector();
      const r = d.endFrame({
        ...base,
        yawBefore: 0,
        yawAfter: 0,
        pitchBefore: 0,
        pitchAfter: 0,
        // A second writer rotated the camera without touching yaw/pitch.
        quatYawBefore: 0,
        quatYawAfter: 2.0,
        quatPitchBefore: 0,
        quatPitchAfter: 0
      });
      expect(r.diagnosis).toContain('QUATERNION_YAW_DIVERGENCE');
    });

    it('does NOT flag pitch clamping at the limit as a snap', () => {
      const d = new ViewSnapDetector();
      // Push well past the clamp: input applied, pitch saturates (capped).
      d.noteMouseDelta(0, 5000);
      const r = d.endFrame({
        ...base,
        yawBefore: 0,
        yawAfter: 0,
        pitchBefore: 1.0,
        pitchAfter: 1.55, // clamp limit absorbs the rest
        quatYawBefore: 0,
        quatYawAfter: 0,
        quatPitchBefore: 1.0,
        quatPitchAfter: 1.55
      });
      expect(r.diagnosis).toBeNull();
    });

    it('keeps a bounded ring buffer of recent samples', () => {
      const d = new ViewSnapDetector();
      for (let i = 0; i < 400; i++) {
        d.endFrame({
          ...base,
          yawBefore: 0, yawAfter: 0, pitchBefore: 0, pitchAfter: 0,
          quatYawBefore: 0, quatYawAfter: 0, quatPitchBefore: 0, quatPitchAfter: 0
        });
      }
      expect(d.recent(1000).length).toBeLessThanOrEqual(240);
      expect(d.lastSample).not.toBeNull();
    });
  });

  describe('diagnostic flag parsing', () => {
    it('parses ?debugMovement=1 and variants', () => {
      expect(MovementDiagnostics.isRequested('?debugMovement=1')).toBe(true);
      expect(MovementDiagnostics.isRequested('?debugMovement=true')).toBe(true);
      expect(MovementDiagnostics.isRequested('?debugMovement=0')).toBe(false);
      expect(MovementDiagnostics.isRequested('?other=1')).toBe(false);
      expect(MovementDiagnostics.isRequested('')).toBe(false);
    });

    it('parses ?debugNoViewmodel=1', () => {
      expect(MovementDiagnostics.isViewmodelHiddenRequested('?debugNoViewmodel=1')).toBe(true);
      expect(MovementDiagnostics.isViewmodelHiddenRequested('?debugMovement=1&debugNoViewmodel=1')).toBe(true);
      expect(MovementDiagnostics.isViewmodelHiddenRequested('?debugMovement=1')).toBe(false);
    });
  });
});