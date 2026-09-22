/**
 * PLAYHEAD — Quality presets, render scale, and adaptive quality policy.
 *
 * Deliberately pure (no THREE / no DOM) so the preset table and the adaptive
 * decision logic can be unit-tested directly.
 *
 * Degradation order is fixed and gameplay-safe:
 *   1. render resolution  (render scale / DPR cap)
 *   2. postprocessing cost (signal pixel size, dither, bloom strength)
 *   3. distant decoration detail (LOD distance)
 *   4. secondary effects (grain / scanlines)
 *
 * Adaptive quality NEVER touches: gameplay geometry, collision, physics
 * timestep, movement, or route generation.
 */

export type QualityTier = 'AUTO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA';

export const QUALITY_TIERS: QualityTier[] = ['AUTO', 'LOW', 'MEDIUM', 'HIGH', 'ULTRA'];

/** Tier used to resolve AUTO before any measurement is available. */
export const AUTO_START_TIER: Exclude<QualityTier, 'AUTO'> = 'HIGH';

/**
 * Concrete render/visual settings for a resolved (non-AUTO) tier.
 *
 * HIGH is the reference look and is intentionally identical to the previous
 * behaviour (full render scale, full postprocessing) so the visual identity is
 * preserved exactly.
 */
export interface QualityPreset {
  /** Multiplier applied to the CSS resolution for the 3D render target. */
  renderScale: number;
  /** Hard cap on devicePixelRatio, to avoid pathological retina cost. */
  dprCap: number;
  /** Postprocessing signal pass pixel-stepping size (higher = chunkier, cheaper). */
  signalPixelSize: number;
  signalDither: number;
  signalQuantize: number;
  /** Vignette from the director is scaled by this. */
  vignetteScale: number;
  /** Bloom strength multiplier (bloom itself is never disabled). */
  bloomScale: number;
  /** Grain + scanline intensity multipliers (0 disables the pass). */
  grainScale: number;
  /** Whether the world pixel/signal pass runs at all. */
  signalPassEnabled: boolean;
  /** Distance beyond which purely decorative architecture is hidden (0 = never). */
  decorationLodDistance: number;
  /** MSAA sample count for the viewmodel overlay target (1 = off). */
  viewmodelSamples: number;
  /**
   * Scales the QUANTITY of audio-reactive landmarks (0..1). The core idea —
   * bass mass, route pulses, primary city response and the major drop response —
   * is never removed; only how many hero landmarks and tertiary glints exist.
   */
  reactiveLandmarkScale: number;
  /** Pool size for the travelling route signal packets (one draw call total). */
  routeSignalPackets: number;
}

export const QUALITY_PRESETS: Record<Exclude<QualityTier, 'AUTO'>, QualityPreset> = {
  LOW: {
    renderScale: 0.68,
    dprCap: 1.0,
    signalPixelSize: 3.0,
    signalDither: 0.06,
    signalQuantize: 24.0,
    vignetteScale: 0.7,
    bloomScale: 0.7,
    grainScale: 0.6,
    signalPassEnabled: true,
    decorationLodDistance: 900,
    viewmodelSamples: 1,
    // Fewer hero landmarks and a smaller packet pool, but every core reactive
    // behaviour (bass mass, route pulse, primary city, drop) is retained.
    reactiveLandmarkScale: 0.35,
    routeSignalPackets: 12
  },
  MEDIUM: {
    renderScale: 0.85,
    dprCap: 1.25,
    signalPixelSize: 2.5,
    signalDither: 0.09,
    signalQuantize: 28.0,
    vignetteScale: 0.85,
    bloomScale: 0.85,
    grainScale: 0.8,
    signalPassEnabled: true,
    decorationLodDistance: 1500,
    viewmodelSamples: 2,
    reactiveLandmarkScale: 0.65,
    routeSignalPackets: 20
  },
  HIGH: {
    // Reference look — matches the pre-existing behaviour.
    renderScale: 1.0,
    dprCap: 2.0,
    signalPixelSize: 2.0,
    signalDither: 0.12,
    signalQuantize: 32.0,
    vignetteScale: 1.0,
    bloomScale: 1.0,
    grainScale: 1.0,
    signalPassEnabled: true,
    decorationLodDistance: 0,
    viewmodelSamples: 4,
    reactiveLandmarkScale: 1.0,
    routeSignalPackets: 32
  },
  ULTRA: {
    renderScale: 1.0,
    dprCap: 3.0,
    signalPixelSize: 1.0,
    signalDither: 0.05,
    signalQuantize: 48.0,
    vignetteScale: 1.0,
    bloomScale: 1.05,
    grainScale: 1.0,
    signalPassEnabled: true,
    decorationLodDistance: 0,
    viewmodelSamples: 4,
    reactiveLandmarkScale: 1.0,
    routeSignalPackets: 40
  }
};

/** Resolves a tier (including AUTO) to a concrete preset. */
export function resolvePreset(tier: QualityTier, autoTier: Exclude<QualityTier, 'AUTO'> = AUTO_START_TIER): QualityPreset {
  const resolved = tier === 'AUTO' ? autoTier : tier;
  return QUALITY_PRESETS[resolved] ?? QUALITY_PRESETS.HIGH;
}

/**
 * Effective device pixel ratio for a preset.
 * Caps pathological DPR and is clamped to a sane positive range.
 */
export function effectivePixelRatio(devicePixelRatio: number, preset: QualityPreset): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.max(0.5, Math.min(dpr, preset.dprCap));
}

/**
 * Render target size for the 3D scene given CSS size.
 * The CSS/UI layer always stays at native resolution; only this target scales.
 */
export function scaledRenderSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  preset: QualityPreset
): { width: number; height: number; ratio: number } {
  const ratio = effectivePixelRatio(devicePixelRatio, preset) * preset.renderScale;
  const width = Math.max(2, Math.floor(cssWidth * ratio));
  const height = Math.max(2, Math.floor(cssHeight * ratio));
  return { width, height, ratio };
}

// ---------------------------------------------------------------------------
// Adaptive quality (AUTO)
// ---------------------------------------------------------------------------

export interface AdaptiveOptions {
  /** Frames averaged before any decision (avoids reacting to spikes). */
  sampleWindow?: number;
  /** Below this average FPS, consider stepping down. */
  downshiftFps?: number;
  /** Above this average FPS, consider stepping up. */
  upshiftFps?: number;
  /** Minimum frames between tier changes (hysteresis). */
  minFramesBetweenChanges?: number;
}

export const DEFAULT_ADAPTIVE_OPTIONS: Required<AdaptiveOptions> = {
  sampleWindow: 90,
  downshiftFps: 48,
  upshiftFps: 58,
  minFramesBetweenChanges: 240
};

/** Ordered from cheapest to most expensive. */
const TIER_ORDER: Array<Exclude<QualityTier, 'AUTO'>> = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'];

/**
 * Conservative adaptive quality controller.
 *
 * Uses an averaged frame time and requires the average to sit outside a dead
 * band on BOTH sides before changing tier, plus a minimum number of frames
 * between changes. This prevents the constant oscillation that a naive
 * per-frame decision produces.
 */
export class AdaptiveQuality {
  private frameTimes: number[] = [];
  private framesSinceChange = 0;
  private options: Required<AdaptiveOptions>;

  constructor(
    public tier: Exclude<QualityTier, 'AUTO'> = AUTO_START_TIER,
    options: AdaptiveOptions = {}
  ) {
    this.options = { ...DEFAULT_ADAPTIVE_OPTIONS, ...options };
  }

  public get averageFps(): number {
    if (this.frameTimes.length === 0) return 0;
    const avgMs = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    return avgMs > 0 ? 1000 / avgMs : 0;
  }

  /**
   * Feeds one frame's delta (seconds).
   * @returns the new tier if it changed, otherwise null.
   */
  public sample(dtSeconds: number): Exclude<QualityTier, 'AUTO'> | null {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return null;

    this.frameTimes.push(dtSeconds * 1000);
    this.framesSinceChange++;

    if (this.frameTimes.length > this.options.sampleWindow) {
      this.frameTimes.shift();
    }
    // Need a full window and enough distance from the last change.
    if (this.frameTimes.length < this.options.sampleWindow) return null;
    if (this.framesSinceChange < this.options.minFramesBetweenChanges) return null;

    const fps = this.averageFps;
    const idx = TIER_ORDER.indexOf(this.tier);
    let nextIdx = idx;

    if (fps < this.options.downshiftFps && idx > 0) {
      nextIdx = idx - 1;
    } else if (fps > this.options.upshiftFps && idx < TIER_ORDER.length - 1) {
      nextIdx = idx + 1;
    }

    if (nextIdx === idx) return null;

    this.tier = TIER_ORDER[nextIdx];
    this.framesSinceChange = 0;
    this.frameTimes.length = 0;
    return this.tier;
  }

  public reset(): void {
    this.frameTimes.length = 0;
    this.framesSinceChange = 0;
  }
}