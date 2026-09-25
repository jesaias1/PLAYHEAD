/**
 * GLOVE TREATMENTS — mastery glove visuals, material-parameter only.
 *
 * Production Optimization V1 cut the shipped payload hard, so mastery gloves
 * deliberately introduce:
 *   - NO new textures (the authored glove texture is shared)
 *   - NO new geometry, materials or draw calls
 *   - NO video, no extra fullscreen passes
 *
 * Each glove is a parameter set on the EXISTING arm materials. That keeps the
 * visual cost of a prestige glove at essentially zero, and it keeps the frozen
 * knife calibration untouched because only arm materials are written.
 *
 * Emissive intensities are deliberately far below the 0.88 bloom threshold even
 * at full musical pulse, so a glove can never bloom into route readability.
 */

import * as THREE from 'three';
import type { MasteryGloveId } from '../mastery/MasteryLadder';

export interface GloveTreatment {
  /** Multiplies the authored glove texture (keeps texel detail dominant). */
  tint: number;
  roughness: number;
  metalness: number;
  /** Base emissive colour. */
  emissive: number;
  /** RESTING emissive intensity. Kept well under the bloom threshold. */
  emissiveIntensity: number;
  /** Scales the music-driven emissive lift. 0 = no reactivity at all. */
  audioReactive: number;
  /** Rim / edge accent strength read by the viewmodel controller. */
  accent: number;
  /** Spectral seam strength. Only the top tiers use it. */
  seam: number;
}

/**
 * The ladder's visual identity.
 *
 * Read top to bottom as increasing prestige: a darker premium base, finer
 * structure, cooler/more precise accents. NOTHING here is "brighter than
 * everything else" — the top tier reads as a rare MATERIAL, not a lamp.
 */
export const GLOVE_TREATMENTS: Record<MasteryGloveId, GloveTreatment> = {
  STANDARD_ISSUE: {
    tint: 0xffffff,
    roughness: 0.62,
    metalness: 0.18,
    emissive: 0x101722,
    emissiveIntensity: 0.08,
    audioReactive: 0.2,
    accent: 0,
    seam: 0
  },
  FIRST_CONTACT: {
    tint: 0xf2f7fb,
    roughness: 0.58,
    metalness: 0.2,
    emissive: 0x0d2a33,
    emissiveIntensity: 0.1,
    audioReactive: 0.3,
    accent: 0.15,
    seam: 0
  },
  SIGNAL_RUNNER: {
    tint: 0xe6eef5,
    roughness: 0.52,
    metalness: 0.28,
    emissive: 0x123542,
    emissiveIntensity: 0.12,
    audioReactive: 0.4,
    accent: 0.3,
    seam: 0
  },
  VELOCITY: {
    tint: 0xdfe9f2,
    roughness: 0.42,
    metalness: 0.38,
    emissive: 0x0f3a4d,
    emissiveIntensity: 0.14,
    audioReactive: 0.55,
    accent: 0.45,
    seam: 0.25
  },
  GOLDLINE: {
    // Dark premium base with thin metallic gold tracing, not a solid gold glove.
    tint: 0xf0e6cf,
    roughness: 0.34,
    metalness: 0.55,
    emissive: 0x3a2a08,
    emissiveIntensity: 0.16,
    audioReactive: 0.45,
    accent: 0.6,
    seam: 0.35
  },
  DIAMOND_HAND: {
    // Icy crystalline accents over a dark underlying material.
    tint: 0xe8f4ff,
    roughness: 0.22,
    metalness: 0.62,
    emissive: 0x14314d,
    emissiveIntensity: 0.18,
    audioReactive: 0.5,
    accent: 0.75,
    seam: 0.5
  },
  SIGNAL_MASTER: {
    // Rare-material behaviour: very low roughness, high metalness, a restrained
    // spectral violet identity that answers strong song events.
    tint: 0xf2f6ff,
    roughness: 0.14,
    metalness: 0.72,
    emissive: 0x2a1c4a,
    emissiveIntensity: 0.2,
    audioReactive: 0.75,
    accent: 0.9,
    seam: 0.8
  }
};

/** Peak multiplier applied by a full-strength musical pulse. */
export const GLOVE_AUDIO_PULSE_GAIN = 2.0;

/** Treatment lookup; unknown ids fall back to the default glove. */
export function getGloveTreatment(id: string): GloveTreatment {
  return GLOVE_TREATMENTS[id as MasteryGloveId] ?? GLOVE_TREATMENTS.STANDARD_ISSUE;
}

/**
 * Applies a treatment to the arm materials.
 *
 * `audioPulse` is the viewmodel's existing restrained musical envelope (already
 * capped at 0.32 upstream), and `effectScale` is the presentation-only EFFECT
 * INTENSITY viewmodel scale. Neither can change eligibility.
 */
export function applyGloveTreatment(
  materials: readonly THREE.MeshStandardMaterial[],
  treatment: GloveTreatment,
  audioPulse: number,
  effectScale = 1
): void {
  const clampedPulse = Math.max(0, Math.min(1, Number.isFinite(audioPulse) ? audioPulse : 0));
  const lift = 1 + clampedPulse * treatment.audioReactive * GLOVE_AUDIO_PULSE_GAIN;
  const scale = Number.isFinite(effectScale) && effectScale > 0 ? effectScale : 1;

  for (const mat of materials) {
    mat.color.setHex(treatment.tint);
    mat.roughness = treatment.roughness;
    mat.metalness = treatment.metalness;
    mat.emissive.setHex(treatment.emissive);
    // Hard ceiling: even a max pulse on the top glove stays far below the 0.88
    // bloom threshold, so gloves never compete with route readability.
    mat.emissiveIntensity = Math.min(0.45, treatment.emissiveIntensity * lift * scale);
  }
}

/** Highest emissive intensity any glove can reach at full pulse. */
export function maxGloveEmissiveIntensity(effectScale = 1.3): number {
  let max = 0;
  for (const treatment of Object.values(GLOVE_TREATMENTS)) {
    const lift = 1 + treatment.audioReactive * GLOVE_AUDIO_PULSE_GAIN;
    max = Math.max(max, Math.min(0.45, treatment.emissiveIntensity * lift * effectScale));
  }
  return max;
}
