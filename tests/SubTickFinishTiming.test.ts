import { describe, it, expect } from 'vitest';
import {
  FINISH_GATE_HEIGHT,
  FinishGateDetector,
  getSegmentFinishGateCrossing
} from '../src/gameplay/FinishGateDetector';
import { formatTime } from '../src/utils/math';
import { PlayerController } from '../src/player/PlayerController';

describe('Sub-Tick Finish Timing & Contact Precision', () => {
  const gate = {
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    width: 20,
    height: FINISH_GATE_HEIGHT
  };

  it('computes exact sub-tick fraction t for high-speed swept crossing', () => {
    // Player moves from z = -10 to z = +10 across gate plane at z = 0 with radius = 0
    const prev = { x: 0, y: 1.5, z: -10 };
    const curr = { x: 0, y: 1.5, z: 10 };

    const crossing = getSegmentFinishGateCrossing(prev, curr, gate, 1.8, 0.0);
    expect(crossing).not.toBeNull();
    expect(crossing!.hit).toBe(true);

    // Plane at z = 0 is crossed at t = 10 / 20 = 0.5 (within small zTol)
    expect(crossing!.t).toBeCloseTo(0.5, 2);
    expect(crossing!.contactPosition.x).toBeCloseTo(0, 4);
    expect(crossing!.contactPosition.y).toBeCloseTo(1.5, 4);
    expect(crossing!.contactPosition.z).toBeCloseTo(0, 1);
  });

  it('first valid contact triggers at the player bounding cylinder boundary', () => {
    // Player radius 0.5m approaching gate at z = 0
    // Starts at z = -2.5, moves to z = +2.5 (total dz = 5.0m)
    // First contact occurs when front of player reaches z = 0 (i.e. player center at z = -0.5)
    // t = (-0.5 - (-2.5)) / 5.0 = 2.0 / 5.0 = 0.4
    const prev = { x: 0, y: 1.5, z: -2.5 };
    const curr = { x: 0, y: 1.5, z: 2.5 };

    const crossing = getSegmentFinishGateCrossing(prev, curr, gate, 1.8, 0.5);
    expect(crossing).not.toBeNull();
    expect(crossing!.hit).toBe(true);
    expect(crossing!.t).toBeCloseTo(0.4, 3);
  });

  it('calculates sub-tick timestamp T_finish = T_start + t * dt without drift', () => {
    const detector = new FinishGateDetector();
    const dt = 1 / 120; // 120Hz fixed tick = ~0.008333s
    const tickStartTime = 40.9125;

    detector.reset({ x: 0, y: 1.5, z: -1.0 });

    // Step from z = -1.0 to z = 1.0 (crossing at t = 0.5 for R=0)
    const crossing = detector.sampleDetailed({ x: 0, y: 1.5, z: 1.0 }, gate, 1.8, 0.0);
    expect(crossing).not.toBeNull();
    expect(crossing!.hit).toBe(true);

    const finishTime = tickStartTime + crossing!.t * dt;
    expect(finishTime).toBeGreaterThan(tickStartTime);
    expect(finishTime).toBeLessThan(tickStartTime + dt);
  });

  it('sampleDetailed returns null after completion (single latch trigger)', () => {
    const detector = new FinishGateDetector();
    detector.reset({ x: 0, y: 1.5, z: -5.0 });

    const first = detector.sampleDetailed({ x: 0, y: 1.5, z: 5.0 }, gate, 1.8);
    expect(first).not.toBeNull();
    expect(first!.hit).toBe(true);

    // Subsequent sample after completion returns null
    const second = detector.sampleDetailed({ x: 0, y: 1.5, z: 10.0 }, gate, 1.8);
    expect(second).toBeNull();
  });
});

describe('Authoritative Time Formatting Consistency', () => {
  it('correctly formats floating point milliseconds without IEEE 754 modulo degradation', () => {
    // In legacy code: 40.916 % 1 * 1000 was 915.999... -> Math.floor gave 915 instead of 916
    expect(formatTime(40.916)).toBe('00:40.916');
    expect(formatTime(40.9168)).toBe('00:40.917');
    expect(formatTime(40.9164)).toBe('00:40.916');
    expect(formatTime(0)).toBe('00:00.000');
    expect(formatTime(59.9999)).toBe('01:00.000');
    expect(formatTime(65.432)).toBe('01:05.432');
  });

  it('guarantees identical formatted strings when COMPLETION, PB, and LOCAL #1 share timestamp', () => {
    const authoritativeTimestamp = 40.916123456;
    const completionFormatted = formatTime(authoritativeTimestamp);
    const pbFormatted = formatTime(authoritativeTimestamp);
    const local1Formatted = formatTime(authoritativeTimestamp);

    expect(completionFormatted).toBe('00:40.916');
    expect(pbFormatted).toBe('00:40.916');
    expect(local1Formatted).toBe('00:40.916');
    expect(completionFormatted).toEqual(pbFormatted);
    expect(pbFormatted).toEqual(local1Formatted);
  });

  it('HOLD_RESTART_SECONDS is calibrated to 0.6s', () => {
    expect(PlayerController.HOLD_RESTART_SECONDS).toBe(0.6);
  });
});
