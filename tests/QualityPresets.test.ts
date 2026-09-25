import { describe, expect, it } from 'vitest';
import {
  AUTO_START_TIER,
  AdaptiveQuality,
  DEFAULT_ADAPTIVE_OPTIONS,
  QUALITY_PRESETS,
  QUALITY_TIERS,
  effectivePixelRatio,
  resolvePreset,
  scaledRenderSize
} from '../src/rendering/QualityPresets';
import { PLAYHEAD_MOVEMENT_V1 } from '../src/player/MovementConfig';

describe('Quality presets — deterministic table', () => {
  it('exposes exactly the documented tiers', () => {
    expect(QUALITY_TIERS).toEqual(['AUTO', 'LOW', 'MEDIUM', 'HIGH', 'ULTRA']);
    expect(Object.keys(QUALITY_PRESETS).sort()).toEqual(['HIGH', 'LOW', 'MEDIUM', 'ULTRA']);
  });

  it('keeps HIGH as the unchanged reference look', () => {
    // HIGH must remain the pre-existing visual behaviour.
    expect(QUALITY_PRESETS.HIGH.renderScale).toBe(1.0);
    expect(QUALITY_PRESETS.HIGH.dprCap).toBe(2.0);
    expect(QUALITY_PRESETS.HIGH.signalPassEnabled).toBe(true);
    expect(QUALITY_PRESETS.HIGH.decorationLodDistance).toBe(0);
    expect(QUALITY_PRESETS.HIGH.grainScale).toBe(1.0);
  });

  it('is monotonic: cheaper tiers cost less', () => {
    const order = ['LOW', 'MEDIUM', 'HIGH'] as const;
    for (let i = 1; i < order.length; i++) {
      const cheaper = QUALITY_PRESETS[order[i - 1]];
      const dearer = QUALITY_PRESETS[order[i]];
      expect(cheaper.renderScale).toBeLessThanOrEqual(dearer.renderScale);
      expect(cheaper.dprCap).toBeLessThanOrEqual(dearer.dprCap);
      expect(cheaper.signalPixelSize).toBeGreaterThanOrEqual(dearer.signalPixelSize);
    }
  });

  it('never disables the signal identity in any tier', () => {
    for (const preset of Object.values(QUALITY_PRESETS)) {
      // Bloom is never removed; the emissive signal look is core identity.
      expect(preset.bloomScale).toBeGreaterThan(0);
      expect(preset.renderScale).toBeGreaterThan(0.5);
    }
  });

  it('resolves AUTO to a concrete tier deterministically', () => {
    expect(resolvePreset('AUTO')).toBe(QUALITY_PRESETS[AUTO_START_TIER]);
    expect(resolvePreset('LOW')).toBe(QUALITY_PRESETS.LOW);
  });
});

describe('Quality presets — DPR and render scale', () => {
  it('caps pathological device pixel ratios', () => {
    expect(effectivePixelRatio(3, QUALITY_PRESETS.LOW)).toBe(1.0);
    expect(effectivePixelRatio(3, QUALITY_PRESETS.MEDIUM)).toBe(1.25);
    expect(effectivePixelRatio(3, QUALITY_PRESETS.HIGH)).toBe(2.0);
    expect(effectivePixelRatio(1.5, QUALITY_PRESETS.HIGH)).toBe(1.5);
  });

  it('is robust against missing or absurd DPR values', () => {
    // Non-positive / non-finite DPR falls back to 1 (never 0, never negative).
    expect(effectivePixelRatio(0, QUALITY_PRESETS.HIGH)).toBe(1);
    expect(effectivePixelRatio(NaN, QUALITY_PRESETS.HIGH)).toBe(1);
    expect(effectivePixelRatio(-4, QUALITY_PRESETS.HIGH)).toBe(1);
    expect(effectivePixelRatio(Infinity, QUALITY_PRESETS.HIGH)).toBe(1);
  });

  it('scales only the 3D target, never below a usable size', () => {
    const low = scaledRenderSize(1920, 1080, 2, QUALITY_PRESETS.LOW);
    const high = scaledRenderSize(1920, 1080, 2, QUALITY_PRESETS.HIGH);
    expect(low.width).toBeLessThan(high.width);
    expect(low.ratio).toBeCloseTo(1.0 * 0.68, 5);
    expect(high.ratio).toBeCloseTo(2.0 * 1.0, 5);
    const tiny = scaledRenderSize(1, 1, 2, QUALITY_PRESETS.LOW);
    expect(tiny.width).toBeGreaterThanOrEqual(2);
    expect(tiny.height).toBeGreaterThanOrEqual(2);
  });
});

describe('Adaptive quality (AUTO) — hysteresis', () => {
  const frameAt = (fps: number) => 1 / fps;

  it('does not react to a single slow frame', () => {
    const adaptive = new AdaptiveQuality('HIGH');
    // 200 good frames then one slow frame.
    for (let i = 0; i < 200; i++) adaptive.sample(frameAt(60));
    expect(adaptive.sample(frameAt(10))).toBeNull();
    expect(adaptive.tier).toBe('HIGH');
  });

  it('steps down only after a sustained bad window', () => {
    const adaptive = new AdaptiveQuality('HIGH');
    const { sampleWindow, minFramesBetweenChanges } = DEFAULT_ADAPTIVE_OPTIONS;
    // A full window is required before any decision.
    for (let i = 0; i < sampleWindow - 1; i++) adaptive.sample(frameAt(30));
    expect(adaptive.tier).toBe('HIGH');
    // Still inside the minimum-frames guard.
    for (let i = sampleWindow - 1; i < minFramesBetweenChanges - 1; i++) adaptive.sample(frameAt(30));
    expect(adaptive.tier).toBe('HIGH');
    // Crossing the guard with a bad average steps down exactly one tier.
    expect(adaptive.sample(frameAt(30))).toBe('MEDIUM');
    expect(adaptive.tier).toBe('MEDIUM');
  });

  it('does not oscillate: a change resets the sample window and the guard', () => {
    const adaptive = new AdaptiveQuality('HIGH');
    const { minFramesBetweenChanges } = DEFAULT_ADAPTIVE_OPTIONS;
    for (let i = 0; i < minFramesBetweenChanges; i++) adaptive.sample(frameAt(30));
    expect(adaptive.tier).toBe('MEDIUM');
    // Immediately flipping to great frames must NOT instantly upshift.
    for (let i = 0; i < 10; i++) expect(adaptive.sample(frameAt(200))).toBeNull();
    expect(adaptive.tier).toBe('MEDIUM');
  });

  it('recovers one tier after a long sustained good window', () => {
    const adaptive = new AdaptiveQuality('MEDIUM');
    const { minFramesBetweenChanges } = DEFAULT_ADAPTIVE_OPTIONS;
    for (let i = 0; i < minFramesBetweenChanges; i++) adaptive.sample(frameAt(120));
    expect(adaptive.tier).toBe('HIGH');
  });

  it('never steps below LOW or above ULTRA', () => {
    const low = new AdaptiveQuality('LOW');
    const { minFramesBetweenChanges } = DEFAULT_ADAPTIVE_OPTIONS;
    for (let i = 0; i < minFramesBetweenChanges * 2; i++) low.sample(frameAt(20));
    expect(low.tier).toBe('LOW');

    const ultra = new AdaptiveQuality('ULTRA');
    for (let i = 0; i < minFramesBetweenChanges * 2; i++) ultra.sample(frameAt(300));
    expect(ultra.tier).toBe('ULTRA');
  });

  it('ignores non-finite frame deltas', () => {
    const adaptive = new AdaptiveQuality('HIGH');
    expect(adaptive.sample(NaN)).toBeNull();
    expect(adaptive.sample(0)).toBeNull();
    expect(adaptive.sample(-1)).toBeNull();
    expect(adaptive.averageFps).toBe(0);
  });
});

describe('Quality presets — gameplay protection', () => {
  it('the preset table contains only rendering fields', () => {
    const allowed = new Set([
      'renderScale', 'dprCap', 'signalPixelSize', 'signalDither', 'signalQuantize',
      'vignetteScale', 'bloomScale', 'grainScale', 'signalPassEnabled',
      'decorationLodDistance', 'viewmodelSamples',
      'reactiveLandmarkScale', 'routeSignalPackets', 'cosmeticVideoScale',
      // Which cosmetic ASSET resolution a tier loads. Presentation only: it
      // selects a texture path and can never touch gameplay state.
      'gloveTextureQuality'
    ]);
    for (const preset of Object.values(QUALITY_PRESETS)) {
      for (const key of Object.keys(preset)) {
        expect(allowed.has(key)).toBe(true);
      }
    }
  });

  it('leaves every movement constant untouched', () => {
    expect(PLAYHEAD_MOVEMENT_V1.gravity).toBe(24.0);
    expect(PLAYHEAD_MOVEMENT_V1.jumpVelocity).toBe(8.8);
    expect(PLAYHEAD_MOVEMENT_V1.groundAcceleration).toBe(10.0);
    expect(PLAYHEAD_MOVEMENT_V1.airAcceleration).toBe(90.0);
    expect(PLAYHEAD_MOVEMENT_V1.maxGroundWishSpeed).toBe(14.0);
    expect(PLAYHEAD_MOVEMENT_V1.maxAirWishSpeed).toBe(3.0);
    expect(PLAYHEAD_MOVEMENT_V1.supplementalAirSteer).toBe(3.5);
    expect(PLAYHEAD_MOVEMENT_V1.friction).toBe(4.5);
    expect(PLAYHEAD_MOVEMENT_V1.stopSpeed).toBe(3.0);
    expect(PLAYHEAD_MOVEMENT_V1.coyoteTime).toBe(0.12);
    expect(PLAYHEAD_MOVEMENT_V1.jumpBufferTime).toBe(0.15);
  });
});
