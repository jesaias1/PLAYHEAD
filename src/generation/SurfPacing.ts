/**
 * SURF pacing model — deterministic song-length budgeting for SURF courses.
 *
 * The SURF product requirement is that a generated course lasts ROUGHLY the
 * song duration for a competent surfer, instead of finishing in a handful of
 * seconds. This module is the single source of truth for that mapping:
 *
 *   - a REALISTIC cruise speed (calibrated against the frozen surf integrator),
 *   - a distance budget derived from the song duration and its musical traits,
 *   - per-section weight allocation so a section only spends the time it owns,
 *   - a vertical-drop-per-distance clamp so long descents cannot pump the
 *     player to absurd speed.
 *
 * Everything here is pure and deterministic: same analysis in, same numbers
 * out. It touches no movement, no collision and no stored metadata.
 */

import { AnalysisSection, TrackAnalysis } from '../audio/AudioFeatures';

/**
 * Planning cruise speed in metres-per-second of HORIZONTAL travel.
 *
 * The FROZEN surf integrator preserves tangential momentum and only adds
 * downhill gravity, so a driver that keeps the line can sit well above the old
 * 27-32 band. A real full-course integrator run peaked near 41 m/s on a banked
 * plunge (work/surf-product-focused-partial.log: maxSpeed 40.99) while a
 * controlled line can cruise lower. 37 m/s is a planning assumption below that
 * observed peak; human playtesting must refine it. Skill changes completion time
 * rather than claiming a single exact calibration. A LOWER speed here produces a
 * SHORTER course (distance = seconds * speed), so the old low end would have
 * finished EARLY, not late.
 */
export const SURF_CRUISE_SPEED = 37.0;

/** Fraction of the song a competent run is expected to occupy, mid-route. */
const COMPLETION_FRACTION = 0.94;

/** Base pickup runway + finish overhead in metres (peel-in + landing). */
const BASE_RUNWAY_METRES = 194.0;

/**
 * Hard bounds so a pathological analysis can never explode the course, while a
 * genuinely long song (300s+) is NOT truncated. Geometry volume is bounded by
 * the per-section phrase budget and the ribbon segment cap instead of by a
 * distance ceiling, so long cruise budget is spent rather than discarded.
 */
const MIN_BUDGET_METRES = 240.0;

export interface SurfPacingBudget {
  /** Realistic cruise speed used for the budget (m/s). */
  cruiseSpeed: number;
  /** Target route distance in metres for the whole course. */
  targetDistance: number;
  /** Target route time in seconds (COMPLETION_FRACTION of the song). */
  targetSeconds: number;
}

/** Per-section traversal budget, in metres. */
export function surfBudgetMeters(analysis: TrackAnalysis): SurfPacingBudget {
  const song = Math.max(1, analysis.duration || 0);
  const seconds = song * COMPLETION_FRACTION;
  const target = Math.max(seconds * SURF_CRUISE_SPEED - BASE_RUNWAY_METRES, MIN_BUDGET_METRES);
  return { cruiseSpeed: SURF_CRUISE_SPEED, targetDistance: target, targetSeconds: seconds };
}

/**
 * Relative travel weight per section, from musical traits (NOT raw difficulty).
 * Loud, dense, fast sections own more of the signal; quiet breath sections own
 * less. Weights are normalised so they sum to 1.
 */
export function sectionTravelWeights(sections: AnalysisSection[], bpm: number): number[] {
  if (sections.length === 0) return [];
  const bpmFactor = clamp((bpm - 70) / 100, 0, 1); // 70..170 -> 0..1
  const raw = sections.map((s) => {
    const intensity = clamp(s.intensity, 0, 1);
    const density = clamp(s.rhythmicDensity, 0, 1);
    const themeWeight =
      s.theme === 'DROP' ? 1.25 :
      s.theme === 'SPEED' ? 1.15 :
      s.theme === 'BUILDUP' || s.theme === 'ASCENT' ? 0.95 :
      s.theme === 'PRECISION' || s.theme === 'SURF' ? 1.0 :
      s.theme === 'DESCENT' ? 1.05 :
      s.theme === 'BREATH' ? 0.5 :
      0.8;
    // Musical rush: a touch of tempo and rhythmic density on top of intensity.
    const rush = 0.7 + intensity * 0.8 + density * 0.25 + bpmFactor * 0.2;
    return Math.max(0.15, themeWeight * rush);
  });
  const total = raw.reduce((a, b) => a + b, 0) || 1;
  return raw.map((w) => w / total);
}

/** Derived musical traits for deterministic phrase selection. */
export interface SurfTraitProfile {
  intensity: number;
  density: number;
  /** Onsets per second inside the section window (0 when onsets are absent). */
  onsetRate: number;
  bpm: number;
  energy: number;
}

export function surfTraits(analysis: TrackAnalysis, section: AnalysisSection): SurfTraitProfile {
  const start = section.start;
  const end = section.end;
  let count = 0;
  const onsets = analysis.onsets;
  if (onsets && onsets.length > 0) {
    for (let i = 0; i < onsets.length; i++) {
      const t = onsets[i].time;
      if (t >= start && t < end) count++;
    }
  }
  const seconds = Math.max(0.25, end - start);
  const density = clamp(section.rhythmicDensity, 0, 1);
  // When the analyser produced no onsets (fixtures), fall back to density/tempo
  // so FLOW/DROP fixtures still receive genuinely varied, transfer-capable
  // phrase selection rather than a uniform stream.
  const onsetRate = onsets && onsets.length > 0
    ? count / seconds
    : 1.4 + density * 3.0 + (clamp(analysis.bpm, 60, 190) / 190) * 1.2;
  return {
    intensity: clamp(section.intensity, 0, 1),
    density,
    onsetRate,
    bpm: analysis.bpm,
    energy: clamp(analysis.globalEnergy ?? 0.6, 0, 1)
  };
}

/**
 * Clamp a descent's vertical drop so a long, steep plunge cannot inject
 * unbounded speed. Slope is bounded per metre of travelled length; the result
 * is the largest allowed drop (positive metres) for that length. The frozen
 * integrator converts slope directly into gravity-along-surface acceleration,
 * so 0.30 (~17 degrees) was very generous and let stacked descents pump speed
 * without bound. 0.12 (~7 degrees) keeps every drop meaningful while making the
 * NET course descent controllable. Movement itself is never capped here.
 */
export const MAX_DESCENT_SLOPE = 0.12;
export function clampDescentDrop(drop: number, length: number): number {
  const magnitude = Math.min(Math.abs(drop), Math.abs(length) * MAX_DESCENT_SLOPE);
  return -magnitude;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
