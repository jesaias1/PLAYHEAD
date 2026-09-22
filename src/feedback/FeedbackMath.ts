/**
 * MOVEMENT JUICE — pure presentation classification.
 *
 * These functions decide how strongly a movement moment should be presented.
 * They are pure, deterministic, allocation-free, and have NO gameplay effect:
 * nothing here can change velocity, jump state, collision or timing.
 */

export type SpeedBand = 'NORMAL' | 'FAST' | 'VERY_FAST' | 'EXTREME';

/**
 * Speed band thresholds in PLAYHEAD display units (m/s * speedUnitScale 40).
 * Running is ~560 u/s, a good bhop chain ~900-1300, and high-speed surf /
 * transfers reach several thousand.
 */
export const SPEED_BAND_THRESHOLDS = {
  fast: 620,
  veryFast: 1100,
  extreme: 1900
} as const;

/** Speed at which speed presentation begins / saturates (u/s). */
export const SPEED_PRESENTATION = {
  onset: 520,
  full: 2300
} as const;

export function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

export function speedBand(speedUnits: number): SpeedBand {
  if (speedUnits >= SPEED_BAND_THRESHOLDS.extreme) return 'EXTREME';
  if (speedUnits >= SPEED_BAND_THRESHOLDS.veryFast) return 'VERY_FAST';
  if (speedUnits >= SPEED_BAND_THRESHOLDS.fast) return 'FAST';
  return 'NORMAL';
}

/**
 * Smooth 0..1 speed presentation intensity. Normal running speed is
 * essentially unaffected; it ramps in as the player builds real momentum.
 */
export function speedIntensity(speedUnits: number): number {
  const t = (speedUnits - SPEED_PRESENTATION.onset) / (SPEED_PRESENTATION.full - SPEED_PRESENTATION.onset);
  const s = clamp01(t);
  // Slight ease-in so low-fast speeds stay subtle.
  return s * s * (3 - 2 * s);
}

export interface LandingInput {
  /** Horizontal speed at touchdown, display units. */
  landingSpeedUnits: number;
  /** Continuous airborne time before touchdown, seconds. */
  airtime: number;
  /** Height fallen from the airborne apex, metres (>= 0). */
  verticalDrop: number;
}

export interface LandingResult {
  /** 0..1 presentation intensity. */
  intensity: number;
  /** True for substantial transfers (long airtime and/or big drop). */
  major: boolean;
}

/**
 * Classifies a landing. Ordinary hops register a low intensity (and are
 * further suppressed by the caller's bhop cooldown); long/high transfers
 * register high and are flagged major.
 */
export function classifyLanding(input: LandingInput): LandingResult {
  const speedT = clamp01((input.landingSpeedUnits - 400) / 1700);
  const airT = clamp01((input.airtime - 0.30) / 1.70);
  const dropT = clamp01((input.verticalDrop - 2.0) / 20.0);

  const intensity = clamp01(
    0.42 * dropT +
    0.30 * airT +
    0.28 * speedT +
    0.18 * Math.min(1, dropT + airT)
  );

  const major =
    input.verticalDrop >= 11.0 ||
    input.airtime >= 1.15 ||
    (input.airtime >= 0.70 && input.landingSpeedUnits >= 1500);

  return { intensity, major };
}

export interface SurfExitInput {
  /** Speed when the surf contact began, display units. */
  entrySpeedUnits: number;
  /** Speed at the moment of clean separation, display units. */
  exitSpeedUnits: number;
  /** Continuous surf contact time, seconds. */
  timeSurfing: number;
}

export interface SurfExitResult {
  /** 0..1 quality. */
  quality: number;
  /** Conservative "SIGNAL LOCK" flag — uncommon by design. */
  perfect: boolean;
}

/**
 * Classifies a surf exit. Deliberately conservative: a clean, committed surf
 * that retains (or gains) speed qualifies; a short slide does not.
 */
export function classifySurfExit(input: SurfExitInput): SurfExitResult {
  const retained = input.exitSpeedUnits / Math.max(1, input.entrySpeedUnits);
  const retainT = clamp01((retained - 0.92) / 0.30);
  const durationT = clamp01((input.timeSurfing - 0.45) / 1.15);
  const speedT = clamp01((input.exitSpeedUnits - 950) / 1500);

  const quality = clamp01(0.45 * retainT + 0.30 * durationT + 0.25 * speedT);

  const perfect =
    quality >= 0.74 &&
    retained >= 1.0 &&
    input.timeSurfing >= 0.55 &&
    input.exitSpeedUnits >= 1150;

  return { quality, perfect };
}

/**
 * Near-miss strength. `clearance` is the fraction of the near-miss shell
 * already closed (0 = just entered the shell, 1 = touching the obstacle).
 */
export function nearMissIntensity(speedUnits: number, clearance: number): number {
  const speedT = clamp01((speedUnits - 400) / 1700);
  const closeness = clamp01(1 - clearance);
  return clamp01(speedT * (0.35 + 0.65 * closeness) * 1.15);
}

/** Minimum speed (u/s) for a near miss to be considered meaningful. */
export const NEAR_MISS_MIN_SPEED = 420;

/** Near-miss shell thickness beyond the player capsule radius, metres. */
export const NEAR_MISS_MARGIN = 0.55;

/** Per-obstacle near-miss re-arm cooldown, seconds. */
export const NEAR_MISS_COOLDOWN = 1.6;

/**
 * A near miss is only confirmed after this short window with no contact, so a
 * pass that actually clips the obstacle never also counts as a near miss.
 * Imperceptibly short in practice.
 */
export const NEAR_MISS_CONFIRM_DELAY = 0.22;

/** Landing presentation is suppressed for this long after the previous one. */
export const LANDING_FEEDBACK_COOLDOWN = 0.22;

/** Surf "SIGNAL LOCK" cannot fire more often than this, seconds. */
export const SURF_LOCK_COOLDOWN = 2.5;

/** Minimum landing intensity worth presenting at all. */
export const LANDING_MIN_INTENSITY = 0.16;
