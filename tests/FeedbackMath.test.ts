import { describe, expect, it } from 'vitest';
import {
  SPEED_BAND_THRESHOLDS,
  classifyLanding,
  classifySurfExit,
  nearMissIntensity,
  speedBand,
  speedIntensity
} from '../src/feedback/FeedbackMath';

describe('Movement feedback — speed bands', () => {
  it('treats normal running speed as essentially unaffected', () => {
    // ~14 m/s running = 560 u/s
    expect(speedBand(560)).toBe('NORMAL');
    expect(speedIntensity(560)).toBeLessThan(0.05);
    expect(speedIntensity(0)).toBe(0);
  });

  it('ramps smoothly and monotonically with speed', () => {
    let prev = -1;
    for (let s = 0; s <= 3000; s += 100) {
      const v = speedIntensity(s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(speedIntensity(SPEED_BAND_THRESHOLDS.extreme)).toBeGreaterThan(0.6);
    expect(speedIntensity(4000)).toBe(1);
  });

  it('classifies bands with the documented thresholds', () => {
    expect(speedBand(SPEED_BAND_THRESHOLDS.fast - 1)).toBe('NORMAL');
    expect(speedBand(SPEED_BAND_THRESHOLDS.fast)).toBe('FAST');
    expect(speedBand(SPEED_BAND_THRESHOLDS.veryFast)).toBe('VERY_FAST');
    expect(speedBand(SPEED_BAND_THRESHOLDS.extreme)).toBe('EXTREME');
  });

  it('is deterministic', () => {
    expect(speedIntensity(1234.5)).toBe(speedIntensity(1234.5));
    expect(speedBand(1234.5)).toBe(speedBand(1234.5));
  });
});

describe('Movement feedback — landing classification', () => {
  it('keeps an ordinary bhop hop low and non-major', () => {
    const r = classifyLanding({ landingSpeedUnits: 700, airtime: 0.35, verticalDrop: 0.6 });
    expect(r.major).toBe(false);
    expect(r.intensity).toBeLessThan(0.2);
  });

  it('classifies a big transfer as major with high intensity', () => {
    const r = classifyLanding({ landingSpeedUnits: 1600, airtime: 1.5, verticalDrop: 15 });
    expect(r.major).toBe(true);
    expect(r.intensity).toBeGreaterThan(0.7);
  });

  it('marks a long airborne transfer major even without a big drop', () => {
    const r = classifyLanding({ landingSpeedUnits: 900, airtime: 1.3, verticalDrop: 2 });
    expect(r.major).toBe(true);
  });

  it('is deterministic', () => {
    const a = classifyLanding({ landingSpeedUnits: 1200, airtime: 0.9, verticalDrop: 7 });
    const b = classifyLanding({ landingSpeedUnits: 1200, airtime: 0.9, verticalDrop: 7 });
    expect(a).toEqual(b);
  });
});

describe('Movement feedback — surf exit classification', () => {
  it('does not flag a short or slow slide', () => {
    const short = classifySurfExit({ entrySpeedUnits: 900, exitSpeedUnits: 900, timeSurfing: 0.4 });
    expect(short.perfect).toBe(false);

    const slow = classifySurfExit({ entrySpeedUnits: 500, exitSpeedUnits: 520, timeSurfing: 1.2 });
    expect(slow.perfect).toBe(false);
  });

  it('flags a committed, speed-retaining surf as perfect', () => {
    const r = classifySurfExit({ entrySpeedUnits: 800, exitSpeedUnits: 1800, timeSurfing: 1.5 });
    expect(r.perfect).toBe(true);
    expect(r.quality).toBeGreaterThan(0.74);
  });

  it('is deterministic', () => {
    const a = classifySurfExit({ entrySpeedUnits: 800, exitSpeedUnits: 1800, timeSurfing: 1.5 });
    const b = classifySurfExit({ entrySpeedUnits: 800, exitSpeedUnits: 1800, timeSurfing: 1.5 });
    expect(a).toEqual(b);
  });
});

describe('Movement feedback — near miss intensity', () => {
  it('scales with speed and closeness, bounded to 0..1', () => {
    expect(nearMissIntensity(100, 0)).toBe(0);
    const tight = nearMissIntensity(1600, 0.05);
    const loose = nearMissIntensity(1600, 0.9);
    expect(tight).toBeGreaterThan(loose);
    expect(tight).toBeLessThanOrEqual(1);
    expect(nearMissIntensity(5000, 0)).toBeLessThanOrEqual(1);
  });
});
