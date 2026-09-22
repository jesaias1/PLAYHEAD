import { describe, expect, it } from 'vitest';
import { TrackAnalysis, SectionTheme } from '../src/audio/AudioFeatures';
import {
  computeTempoPressure,
  computeTempoProfile,
  percussionDensity,
  resolveEffectiveGameplayBpm,
  tempoBandFor,
  tempoRouteEffects
} from '../src/generation/TempoPressure';
import { SurfPlanner } from '../src/generation/SurfPlanner';
import { RouteGenerator } from '../src/generation/RouteGenerator';
import { RouteChallengeGenerator } from '../src/generation/RouteChallengeGenerator';
import { PLAYHEAD_MOVEMENT_V1 } from '../src/player/MovementConfig';

function makeAnalysis(opts: {
  bpm: number;
  confidence?: number;
  onsetRate?: number;
  density?: number;
  energy?: number;
  duration?: number;
  themes?: SectionTheme[];
}): TrackAnalysis {
  const duration = opts.duration ?? 180;
  const onsetRate = opts.onsetRate ?? 2.5;
  const density = opts.density ?? 0.5;
  const themes = opts.themes ?? ['FLOW', 'FLOW', 'FLOW', 'FLOW'];
  const sectionCount = themes.length;

  const frames = [];
  for (let t = 0; t < duration; t += 0.05) {
    frames.push({
      time: t,
      rms: opts.energy ?? 0.6,
      bass: 0.5,
      lowMid: 0.4,
      mid: 0.4,
      high: 0.4,
      centroid: 0.5,
      flux: 0.3,
      density
    });
  }

  const onsets = [];
  const count = Math.round(onsetRate * duration);
  for (let i = 0; i < count; i++) {
    onsets.push({ time: (i / Math.max(1, count)) * duration, strength: 0.7, bass: 0.6, mids: 0.5, highs: 0.4 });
  }

  const sections = themes.map((theme, i) => ({
    index: i,
    start: (i / sectionCount) * duration,
    end: ((i + 1) / sectionCount) * duration,
    duration: duration / sectionCount,
    intensity: opts.energy ?? 0.6,
    rhythmicDensity: density,
    brightness: 0.5,
    theme
  }));

  return {
    filename: 'tempo.wav',
    duration,
    bpm: opts.bpm,
    bpmConfidence: opts.confidence ?? 0.8,
    globalEnergy: opts.energy ?? 0.6,
    frames,
    onsets,
    sections,
    waveform: new Float32Array(64),
    seed: 0x504c4159,
    visualAccent: { name: 'Test Cyan', hex: '#00f0ff', rgb: [0, 240, 255] }
  };
}

describe('Tempo pressure — BPM normalisation', () => {
  it('resolves an obvious half-time detection upward', () => {
    // 87 BPM detected, dense breakbeat evidence -> ~174.
    const a = makeAnalysis({ bpm: 87, onsetRate: 6.0, density: 0.85, energy: 0.85 });
    const resolved = resolveEffectiveGameplayBpm(a);
    expect(resolved.interpretation).toBe('HALF_TIME_UP');
    expect(resolved.effectiveBpm).toBeCloseTo(174, 5);
    expect(tempoBandFor(resolved.effectiveBpm)).toBe('HIGH');
  });

  it('does NOT blindly double a sparse slow track', () => {
    const a = makeAnalysis({ bpm: 85, onsetRate: 1.0, density: 0.15, energy: 0.35 });
    const resolved = resolveEffectiveGameplayBpm(a);
    expect(resolved.interpretation).toBe('RAW');
    expect(resolved.effectiveBpm).toBe(85);
  });

  it('leaves a stable normal BPM unchanged', () => {
    for (const bpm of [110, 128, 140]) {
      const a = makeAnalysis({ bpm, onsetRate: 3.0, density: 0.55 });
      expect(resolveEffectiveGameplayBpm(a).effectiveBpm).toBe(bpm);
      expect(resolveEffectiveGameplayBpm(a).interpretation).toBe('RAW');
    }
  });

  it('can resolve a sparse fast reading down to half time', () => {
    const a = makeAnalysis({ bpm: 170, onsetRate: 0.9, density: 0.12, energy: 0.4 });
    const resolved = resolveEffectiveGameplayBpm(a);
    expect(resolved.interpretation).toBe('DOUBLE_TIME_DOWN');
    expect(resolved.effectiveBpm).toBe(85);
  });
});

describe('Tempo pressure — pressure value', () => {
  it('higher BPM yields higher pressure for otherwise identical analysis', () => {
    const slow = computeTempoPressure(makeAnalysis({ bpm: 92 }));
    const mid = computeTempoPressure(makeAnalysis({ bpm: 128 }));
    const fast = computeTempoPressure(makeAnalysis({ bpm: 168 }));
    expect(mid).toBeGreaterThan(slow);
    expect(fast).toBeGreaterThan(mid);
  });

  it('lets low energy / onset density moderate a high BPM', () => {
    const dense = computeTempoPressure(makeAnalysis({ bpm: 170, onsetRate: 6.0, density: 0.9, energy: 0.9 }));
    const sparse = computeTempoPressure(makeAnalysis({ bpm: 170, onsetRate: 0.8, density: 0.1, energy: 0.2 }));
    expect(sparse).toBeLessThan(dense);
    // A sparse 170 BPM ambient track must not automatically be procedural hell.
    expect(sparse).toBeLessThan(0.62);
  });

  it('interpolates smoothly with no band-edge discontinuity', () => {
    let prev = -1;
    for (let bpm = 80; bpm <= 200; bpm += 2) {
      const p = computeTempoPressure(makeAnalysis({ bpm }));
      expect(p).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      // No jump larger than a small step between adjacent BPM samples.
      if (prev >= 0) expect(p - prev).toBeLessThan(0.06);
      prev = p;
    }
  });

  it('lets section context override global tempo pressure', () => {
    const a = makeAnalysis({ bpm: 168, energy: 0.85, density: 0.85 });
    const build = computeTempoPressure(a, 'BUILDUP');
    const drop = computeTempoPressure(a, 'DROP');
    const breath = computeTempoPressure(a, 'BREATH');
    expect(build).toBeGreaterThan(drop);
    expect(breath).toBeLessThan(build);
    expect(breath).toBeLessThan(drop);
  });

  it('derives route effects that only tighten cadence', () => {
    const low = tempoRouteEffects(computeTempoProfile(makeAnalysis({ bpm: 92, density: 0.2, energy: 0.3 })));
    const high = tempoRouteEffects(computeTempoProfile(makeAnalysis({ bpm: 172, density: 0.9, energy: 0.9 })));
    expect(high.staggerPressure).toBeGreaterThan(low.staggerPressure);
    expect(high.staggerOffset).toBeGreaterThan(low.staggerOffset);
    expect(high.staggerSteps).toBeGreaterThanOrEqual(low.staggerSteps);
    expect(high.surfPressure).toBeGreaterThan(low.surfPressure);
    // Cadence multiplier stays in a safe, non-spammy band.
    expect(high.obstacleCadence).toBeLessThan(low.obstacleCadence);
    expect(high.obstacleCadence).toBeGreaterThanOrEqual(0.75);
    expect(low.obstacleCadence).toBeLessThanOrEqual(1.25);
  });
});

describe('Tempo pressure — route effects', () => {
  it('produces more stagger pressure at high tempo than low tempo', () => {
    const low = RouteGenerator.generate(makeAnalysis({ bpm: 90, density: 0.2, energy: 0.3, themes: ['FLOW', 'FLOW', 'FLOW', 'FLOW'] }));
    const lowReport = RouteGenerator.lastTempoReport!;
    const high = RouteGenerator.generate(makeAnalysis({ bpm: 172, density: 0.9, energy: 0.9, themes: ['FLOW', 'FLOW', 'FLOW', 'FLOW'] }));
    const highReport = RouteGenerator.lastTempoReport!;

    expect(highReport.pressure).toBeGreaterThan(lowReport.pressure);
    // Higher pressure means MORE staggered platforms overall...
    expect(highReport.staggerSteps).toBeGreaterThan(lowReport.staggerSteps);
    // ...and longer alternating chains when they do occur.
    const highChainLength = highReport.staggerSteps / Math.max(1, highReport.staggerChains);
    const lowChainLength = lowReport.staggerSteps / Math.max(1, lowReport.staggerChains);
    expect(highChainLength).toBeGreaterThanOrEqual(lowChainLength);
    expect(low.route.length).toBeGreaterThan(0);
    expect(high.route.length).toBeGreaterThan(0);
  });

  it('never shrinks platforms below safe dimensions for high tempo', () => {
    const high = RouteGenerator.generate(makeAnalysis({ bpm: 174, density: 0.95, energy: 0.95 }));
    const playable = high.route.filter(n =>
      n.type === 'RUNWAY' || n.type === 'WIDE_FLOW' || n.type === 'BOOST' || n.type === 'LANDING');
    expect(playable.length).toBeGreaterThan(0);
    for (const n of playable) {
      expect(n.dimensions.x).toBeGreaterThanOrEqual(8.0);
      expect(n.dimensions.z).toBeGreaterThanOrEqual(10.0);
    }
  });

  it('keeps staggered lateral offsets inside the movement solvability envelope', () => {
    const speeds = [16, 24, 32, 45];
    const forwards = [18, 24, 30, 40];
    for (const speed of speeds) {
      for (const forward of forwards) {
        const offset = RouteChallengeGenerator.fitLateralOffset(9.0, forward, speed);
        const required = RouteChallengeGenerator.laneChangeDistance(offset * 2, speed);
        expect(required).toBeLessThanOrEqual(forward * 0.85 + 1e-6);
      }
    }
  });

  it('uses a different surf vocabulary at high tempo than low tempo', () => {
    const slowEvents = SurfPlanner.plan(makeAnalysis({
      bpm: 92, density: 0.25, energy: 0.6, onsetRate: 1.6,
      themes: ['FLOW', 'FLOW', 'FLOW', 'FLOW', 'FLOW']
    }));
    const fastEvents = SurfPlanner.plan(makeAnalysis({
      bpm: 174, density: 0.9, energy: 0.9, onsetRate: 6.0,
      themes: ['FLOW', 'FLOW', 'FLOW', 'FLOW', 'FLOW']
    }));

    expect(slowEvents.length).toBeGreaterThan(0);
    expect(fastEvents.length).toBeGreaterThan(0);
    const slowTypes = slowEvents.map(e => e.type).join(',');
    const fastTypes = fastEvents.map(e => e.type).join(',');
    const slowAvgDuration = slowEvents.reduce((a, e) => a + e.duration, 0) / slowEvents.length;
    const fastAvgDuration = fastEvents.reduce((a, e) => a + e.duration, 0) / fastEvents.length;

    expect(slowTypes).not.toBe(fastTypes);
    expect(slowAvgDuration).toBeGreaterThan(fastAvgDuration);
  });

  it('keeps surf presence substantially higher than the old 3-event cap', () => {
    const events = SurfPlanner.plan(makeAnalysis({
      bpm: 174, density: 0.9, energy: 0.9, onsetRate: 6.0, duration: 240,
      themes: ['FLOW', 'FLOW', 'FLOW', 'FLOW', 'FLOW', 'FLOW', 'FLOW', 'FLOW']
    }));
    expect(events.length).toBeGreaterThan(3);
    expect(events.length).toBeLessThanOrEqual(6);
  });

  it('is deterministic for the same analysis and seed', () => {
    const a = makeAnalysis({ bpm: 168, density: 0.8, energy: 0.85 });
    const first = RouteGenerator.generate(a);
    const firstReport = RouteGenerator.lastTempoReport!;
    const second = RouteGenerator.generate(a);
    const secondReport = RouteGenerator.lastTempoReport!;

    expect(secondReport).toEqual(firstReport);
    expect(second.route.length).toBe(first.route.length);
    for (let i = 0; i < first.route.length; i++) {
      expect(second.route[i].position.x).toBeCloseTo(first.route[i].position.x, 9);
      expect(second.route[i].position.z).toBeCloseTo(first.route[i].position.z, 9);
    }
  });
});

describe('Tempo pressure — protected systems', () => {
  it('does not change any movement constant', () => {
    expect(PLAYHEAD_MOVEMENT_V1.gravity).toBe(24.0);
    expect(PLAYHEAD_MOVEMENT_V1.jumpVelocity).toBe(8.8);
    expect(PLAYHEAD_MOVEMENT_V1.groundAcceleration).toBe(10.0);
    expect(PLAYHEAD_MOVEMENT_V1.airAcceleration).toBe(90.0);
    expect(PLAYHEAD_MOVEMENT_V1.maxGroundWishSpeed).toBe(14.0);
    expect(PLAYHEAD_MOVEMENT_V1.maxAirWishSpeed).toBe(3.0);
    expect(PLAYHEAD_MOVEMENT_V1.supplementalAirSteer).toBe(3.5);
    expect(PLAYHEAD_MOVEMENT_V1.friction).toBe(4.5);
    expect(PLAYHEAD_MOVEMENTV1_SAFE()).toBe(true);
  });

  it('keeps Signal Spine recovery available at high tempo', () => {
    const track = RouteGenerator.generate(makeAnalysis({ bpm: 176, density: 0.95, energy: 0.95 }));
    expect(track.signalSpines.length).toBeGreaterThan(0);
  });

  it('does not reduce surf ramps at high tempo', () => {
    const high = RouteGenerator.generate(makeAnalysis({ bpm: 176, density: 0.95, energy: 0.95 }));
    expect((high.optionalRamps ?? []).length).toBeGreaterThanOrEqual(4);
    expect(high.route.some(n => n.isSurf)).toBe(true);
  });
});

function PLAYHEAD_MOVEMENTV1_SAFE(): boolean {
  return (
    PLAYHEAD_MOVEMENT_V1.coyoteTime === 0.12 &&
    PLAYHEAD_MOVEMENT_V1.jumpBufferTime === 0.15 &&
    PLAYHEAD_MOVEMENT_V1.stopSpeed === 3.0 &&
    PLAYHEAD_MOVEMENT_V1.playerHeight === 1.8 &&
    PLAYHEAD_MOVEMENT_V1.playerRadius === 0.5 &&
    PLAYHEAD_MOVEMENT_V1.speedUnitScale === 40
  );
}

// Keep the density helper referenced so the metric stays exercised.
describe('Tempo pressure — percussion density', () => {
  it('is bounded and monotonic with onset rate', () => {
    const low = percussionDensity(makeAnalysis({ bpm: 120, onsetRate: 0.5, density: 0.1 }));
    const high = percussionDensity(makeAnalysis({ bpm: 120, onsetRate: 7.0, density: 0.95 }));
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(1);
    expect(high).toBeGreaterThan(low);
  });
});
