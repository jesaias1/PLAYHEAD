/**
 * EFFECT INTENSITY — presentation-only display control.
 *
 * LOW / STANDARD / HIGH scale DECORATIVE and AUDIO-REACTIVE emissive output
 * only. Nothing in this module is read by any physics, collision, route
 * generation, map-identity, timing or scoring path, so it is structurally
 * incapable of altering gameplay or competitive state.
 *
 * STANDARD is the authored reference look: every scale is exactly 1.0, so
 * selecting it reproduces the shipped art direction with no drift.
 */

import type { EffectIntensity } from '../core/Settings';

export type { EffectIntensity };

export const EFFECT_INTENSITIES: readonly EffectIntensity[] = ['LOW', 'STANDARD', 'HIGH'];

export interface EffectIntensityProfile {
  /**
   * Multiplier on the music-driven reactivity multiplier. This is the single
   * global lever behind world emissive: route trim, gates, skyline, spectral
   * architecture, drop setpiece. It never scales the legibility floor that
   * keeps the route and its signals readable in a quiet section.
   */
  emissiveScale: number;
  /** Multiplier on bloom strength (bloom itself is never disabled). */
  bloomScale: number;
  /**
   * Multiplier on the music-driven exposure LIFT only. The base exposure is
   * never scaled, so LOW darkens the peaks rather than dimming the whole frame.
   */
  exposureLiftScale: number;
  /** Multiplier on decorative additive layers (packets, landmarks, ghost). */
  additiveScale: number;
  /** Multiplier on the viewmodel musical accent and blade signal strip. */
  viewmodelScale: number;
}

export const EFFECT_INTENSITY_PROFILES: Record<EffectIntensity, EffectIntensityProfile> = {
  LOW: {
    emissiveScale: 0.55,
    bloomScale: 0.5,
    exposureLiftScale: 0.35,
    additiveScale: 0.55,
    viewmodelScale: 0.5
  },
  STANDARD: {
    emissiveScale: 1.0,
    bloomScale: 1.0,
    exposureLiftScale: 1.0,
    additiveScale: 1.0,
    viewmodelScale: 1.0
  },
  HIGH: {
    emissiveScale: 1.18,
    bloomScale: 1.3,
    exposureLiftScale: 1.4,
    additiveScale: 1.35,
    viewmodelScale: 1.3
  }
};

/**
 * Resolves any stored or unknown value to a valid profile.
 * Missing / corrupt saved settings fall back to STANDARD (the reference look).
 */
export function resolveEffectProfile(value: unknown): EffectIntensityProfile {
  if (value === 'LOW' || value === 'HIGH') return EFFECT_INTENSITY_PROFILES[value];
  return EFFECT_INTENSITY_PROFILES.STANDARD;
}
