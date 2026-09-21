import { describe, expect, it } from 'vitest';
import {
  FINISH_GATE_HEIGHT,
  FinishGateDetector,
  segmentCrossesFinishGate
} from '../src/gameplay/FinishGateDetector';

const gate = {
  position: { x: 0, y: 0, z: 0 },
  yaw: 0,
  width: 20,
  height: FINISH_GATE_HEIGHT
};

describe('continuous finish gate detection', () => {
  it('registers a high-speed swept crossing with no sampled point inside the trigger plane', () => {
    expect(segmentCrossesFinishGate(
      { x: 0, y: 1.5, z: -42 },
      { x: 0, y: 1.5, z: 37 },
      gate,
      1.8
    )).toBe(true);
  });

  it('registers the visible outer portion of a rotated goal opening', () => {
    const rotated = { ...gate, position: { x: 12, y: 4, z: -8 }, yaw: Math.PI / 3 };
    const localToWorld = (x: number, z: number) => ({
      x: rotated.position.x + Math.cos(rotated.yaw) * x + Math.sin(rotated.yaw) * z,
      y: 5.5,
      z: rotated.position.z - Math.sin(rotated.yaw) * x + Math.cos(rotated.yaw) * z
    });
    expect(segmentCrossesFinishGate(localToWorld(9.8, -30), localToWorld(9.8, 30), rotated, 1.8)).toBe(true);
    expect(segmentCrossesFinishGate(localToWorld(10.2, -30), localToWorld(10.2, 30), rotated, 1.8)).toBe(false);
  });

  it('fires exactly once after a legitimate crossing', () => {
    const detector = new FinishGateDetector();
    detector.reset({ x: 0, y: 1.5, z: -5 });
    expect(detector.sample({ x: 0, y: 1.5, z: 5 }, gate, 1.8)).toBe(true);
    expect(detector.sample({ x: 0, y: 1.5, z: -5 }, gate, 1.8)).toBe(false);
    expect(detector.sample({ x: 0, y: 1.5, z: 5 }, gate, 1.8)).toBe(false);
  });
});
