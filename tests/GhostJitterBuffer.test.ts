import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { RemoteGhostRenderer } from '../src/online/RemoteGhostRenderer';

const sample = (seq: number) => ({
  sequence: seq, userId: 'u', raceId: 'r', colorIndex: 0, t: Date.now(),
  x: seq, y: 0, z: 0, yaw: 0, pitch: 0
}) as never;

describe('remote ghost interpolation delay', () => {
  afterEach(() => vi.useRealTimers());

  function run(gaps: number[]): number {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const ghost = new RemoteGhostRenderer(new THREE.Scene());
    let seq = 0;
    ghost.setSample(sample(seq++));
    for (const gap of gaps) {
      vi.setSystemTime(Date.now() + gap);
      ghost.setSample(sample(seq++));
    }
    return ghost.getInterpolationDelayMs();
  }

  it('stays at the 100 ms floor on a steady 12 Hz link', () => {
    expect(run(Array(40).fill(83))).toBe(100);
  });

  it('grows with jitter, so a shaky link gets a deeper buffer, and is capped', () => {
    const shaky = run(Array.from({ length: 60 }, (_, i) => (i % 2 ? 190 : 20)));
    expect(shaky).toBeGreaterThan(130);
    expect(shaky).toBeLessThanOrEqual(300);
  });
});
