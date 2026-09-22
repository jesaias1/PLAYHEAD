/**
 * TEMPO PRESSURE — how the music's tempo shapes ROUTE difficulty.
 *
 * Design rule: BPM changes how quickly the route asks the player to make
 * movement decisions. It NEVER changes movement physics, platform safety
 * limits, recovery, or jump distances.
 *
 * This module is pure and deterministic: same analysis in, same values out.
 */

import { TrackAnalysis } from '../audio/AudioFeatures';

export type TempoBand = 'LOW' | 'MODERATE' | 'FAST' | 'HIGH' | 'OVERDRIVE';

export type TempoInterpretation = 'RAW' | 'HALF_TIME_UP' | 'DOUBLE_TIME_DOWN';

export interface TempoProfile {
  /** BPM as reported by analysis. */
  rawBpm: number;
  /** BPM after conservative half/double-time resolution. */
  effectiveBpm: number;
  /** Confidence in the interpretation, 0..1 (1 = raw untouched). */
  confidence: number;
  interpretation: TempoInterpretation;
  /** Normalised onset/percussion density, 0..1. */
  density: number;
  /** Onsets per second. */
  onsetRate: number;
  energy: number;
  /** Global tempo pressure, 0..1. */
  pressure: number;
  band: TempoBand;
}

export const TEMPO_BAND_EDGES = {
  moderate: 100,
  fast: 125,
  high: 150,
  overdrive: 175
} as const;

/** Pressure contributions (sum to 1.0). BPM dominates by design. */
export const TEMPO_WEIGHTS = {
  bpm: 0.55,
  density: 0.25,
  energy: 0.12,
  section: 0.08
} as const;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

/** Section context contribution — the moment-to-moment expression. */
export function sectionTempoContext(theme?: string): number {
  switch (theme) {
    case 'BUILDUP': return 0.85;
    case 'SPEED': return 0.8;
    case 'DROP': return 0.45;
    case 'BREATH': return 0.15;
    case 'PRECISION': return 0.5;
    case 'SURF': return 0.5;
    case 'ASCENT':
    case 'DESCENT': return 0.4;
    case 'FLOW':
    default: return 0.5;
  }
}

/** Onsets per second across the analysed track. */
export function estimateOnsetRate(analysis: TrackAnalysis): number {
  const duration = Math.max(1, analysis.duration);
  if (analysis.onsets && analysis.onsets.length > 0) {
    return analysis.onsets.length / duration;
  }
  // Fall back to mean frame density when no discrete onsets are available.
  return meanFrameDensity(analysis) * 6.0;
}

/** Mean local rhythmic onset density across analysed frames (0..1). */
export function meanFrameDensity(analysis: TrackAnalysis): number {
  const frames = analysis.frames;
  if (!frames || frames.length === 0) return 0.4;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < frames.length; i++) {
    const d = frames[i].density;
    if (Number.isFinite(d)) {
      sum += d;
      n++;
    }
  }
  return n > 0 ? clamp01(sum / n) : 0.4;
}

/** Blended percussion-density signal (0..1) used by tempo pressure. */
export function percussionDensity(analysis: TrackAnalysis): number {
  const rate = estimateOnsetRate(analysis);
  const fromRate = clamp01((rate - 1.2) / 5.2);
  const fromFrames = meanFrameDensity(analysis);
  return clamp01(0.65 * fromRate + 0.35 * fromFrames);
}

/**
 * Conservative half-time / double-time resolution.
 *
 * A 174 BPM track is often detected as 87; an 85 BPM track can be reported as
 * 170. We only re-interpret when the percussion evidence strongly supports it
 * AND the resulting BPM lands in a musically plausible range. Otherwise the
 * raw, stable reading is kept.
 */
export function resolveEffectiveGameplayBpm(analysis: TrackAnalysis): {
  effectiveBpm: number;
  confidence: number;
  interpretation: TempoInterpretation;
} {
  const raw = analysis.bpm;
  if (!Number.isFinite(raw) || raw <= 0) {
    return { effectiveBpm: 120, confidence: 0, interpretation: 'RAW' };
  }

  const density = percussionDensity(analysis);
  const reportedConfidence = clamp01(analysis.bpmConfidence ?? 0.5);

  // Half-time detected as slow: dense breakbeat evidence for a fast track.
  if (raw >= 68 && raw < TEMPO_BAND_EDGES.moderate) {
    const doubled = raw * 2;
    if (
      density >= 0.55 &&
      doubled >= 140 && doubled <= 190 &&
      reportedConfidence >= 0.30
    ) {
      return { effectiveBpm: doubled, confidence: clamp01(0.4 + density * 0.5), interpretation: 'HALF_TIME_UP' };
    }
  }

  // Double-time detected as fast: sparse material that is really half-time.
  if (raw > 152 && raw <= 200) {
    const halved = raw / 2;
    if (density <= 0.28 && halved >= 70 && halved < TEMPO_BAND_EDGES.moderate) {
      return { effectiveBpm: halved, confidence: clamp01(0.4 + (0.28 - density) * 1.5), interpretation: 'DOUBLE_TIME_DOWN' };
    }
  }

  return { effectiveBpm: raw, confidence: reportedConfidence, interpretation: 'RAW' };
}

export function tempoBandFor(effectiveBpm: number): TempoBand {
  if (effectiveBpm >= TEMPO_BAND_EDGES.overdrive) return 'OVERDRIVE';
  if (effectiveBpm >= TEMPO_BAND_EDGES.high) return 'HIGH';
  if (effectiveBpm >= TEMPO_BAND_EDGES.fast) return 'FAST';
  if (effectiveBpm >= TEMPO_BAND_EDGES.moderate) return 'MODERATE';
  return 'LOW';
}

/**
 * Normalised BPM pressure. Continuous (no hard steps at band edges) so a route
 * never changes character because BPM moved from 149 to 150.
 */
export function bpmPressure(effectiveBpm: number): number {
  return clamp01((effectiveBpm - 90) / 90);
}

/** Global tempo pressure for a whole track (0..1). */
export function computeTempoPressure(analysis: TrackAnalysis, sectionTheme?: string): number {
  const { effectiveBpm } = resolveEffectiveGameplayBpm(analysis);
  const density = percussionDensity(analysis);
  const energy = clamp01(analysis.globalEnergy);
  const section = sectionTempoContext(sectionTheme);
  return clamp01(
    TEMPO_WEIGHTS.bpm * bpmPressure(effectiveBpm) +
    TEMPO_WEIGHTS.density * density +
    TEMPO_WEIGHTS.energy * energy +
    TEMPO_WEIGHTS.section * section
  );
}

/** Full tempo profile used by route generation and DEV telemetry. */
export function computeTempoProfile(analysis: TrackAnalysis): TempoProfile {
  const resolved = resolveEffectiveGameplayBpm(analysis);
  const density = percussionDensity(analysis);
  const energy = clamp01(analysis.globalEnergy);
  const pressure = clamp01(
    TEMPO_WEIGHTS.bpm * bpmPressure(resolved.effectiveBpm) +
    TEMPO_WEIGHTS.density * density +
    TEMPO_WEIGHTS.energy * energy +
    TEMPO_WEIGHTS.section * sectionTempoContext(undefined)
  );

  return {
    rawBpm: analysis.bpm,
    effectiveBpm: resolved.effectiveBpm,
    confidence: resolved.confidence,
    interpretation: resolved.interpretation,
    density,
    onsetRate: estimateOnsetRate(analysis),
    energy,
    pressure,
    band: tempoBandFor(resolved.effectiveBpm)
  };
}

/**
 * Route-generation effects derived from tempo pressure. Higher pressure means a
 * faster movement DECISION cadence — never smaller/safer-breaking geometry.
 */
export function tempoRouteEffects(profile: TempoProfile): {
  /** Probability bias for starting a staggered strafe chain (0..1). */
  staggerPressure: number;
  /** Extra alternating steps in a stagger chain (0..2). */
  staggerSteps: number;
  /** Lateral offset scale for staggered platforms (metres, before fitting). */
  staggerOffset: number;
  /** Bias toward faster surf vocabulary (0..1). */
  surfPressure: number;
  /** Multiplier applied to obstacle phrase spacing (lower = tighter cadence). */
  obstacleCadence: number;
} {
  const p = clamp01(profile.pressure);
  return {
    staggerPressure: p,
    staggerSteps: Math.round(p * 2),
    staggerOffset: 2.5 + p * 4.0,
    surfPressure: p,
    // High pressure tightens obstacle cadence, but never below 0.72 of the
    // base spacing so sections keep breathing room.
    obstacleCadence: 1.25 - 0.5 * p
  };
}
