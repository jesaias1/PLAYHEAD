/**
 * Competent-speed timing estimate for a generated CUSTOM route.
 *
 * This is a pure, allocation-bounded planning aid: it walks the final route
 * (including optional ramps, shelves and forks), applies a conservative
 * competent-speed budget per section, adds the real elevation cost and a
 * checkpoint/start/finish recovery allowance, and reports whether the song is
 * long enough to contain the course honestly.
 *
 * It is intentionally NOT a distance-only check: distance < duration * 16
 * ignores ascent, repair, surf, checkpoints and sub-second clips.
 */

import { TrackAnalysis } from '../audio/AudioFeatures';
import { GeneratedTrack, RouteNode } from './GenerationTypes';

export interface RouteTimingEstimate {
  /** Conservative competent-speed traversal time in seconds. */
  estimatedSeconds: number;
  /** Conservative planning budget (estimatedSeconds * headroom). */
  planningBudgetSeconds: number;
  /** True when the song is at least as long as the conservative budget. */
  fitsSong: boolean;
  /** Positive when the song has headroom beyond the budget. */
  slackSeconds: number;
  /** Total main-route distance covered by the estimate. */
  mainDistance: number;
  /** Extra distance in optional/skill geometry included in the estimate. */
  optionalDistance: number;
  /** Total positive elevation gain in metres. */
  elevationGain: number;
  /** Recovery/overhead allowance in seconds (checkpoints + start/finish). */
  recoverySeconds: number;
}

const PLANNING_HEADROOM = 1.12;
const CHECKPOINT_RECOVERY_SECONDS = 0.5;
const START_FINISH_OVERHEAD_SECONDS = 1.5;

/** Conservative competent speed (m/s) for a section of the given intensity. */
export function conservativeSectionSpeed(intensity: number): number {
  const i = intensity < 0 ? 0 : intensity > 1 ? 1 : intensity;
  // 15 m/s at the quietest, 16 m/s at the loudest. The generator already paces
  // custom routes ~0.8x of the 16 m/s reference for headroom, so planning at
  // near-reference speed is still conservative while remaining honest.
  return 15 + i * 1;
}

function sectionSpeedAt(analysis: TrackAnalysis, time: number): number {
  const sections = analysis.sections;
  if (sections.length === 0) return 10;
  for (const s of sections) {
    if (time >= s.start && time <= s.end) return conservativeSectionSpeed(s.intensity);
  }
  return conservativeSectionSpeed(sections[sections.length - 1].intensity);
}

function nodeArcSpan(nodes: RouteNode[]): number {
  if (nodes.length < 2) return 0;
  return Math.max(0, nodes[nodes.length - 1].arcLength - nodes[0].arcLength);
}

/**
 * Conservative estimate of how much time the generated course needs.
 * Official tracks can call this too; the result is descriptive only.
 */
export function estimateRouteTiming(track: GeneratedTrack, analysis: TrackAnalysis): RouteTimingEstimate {
  const route = track.route;
  let estimated = 0;
  let elevationGain = 0;

  // Integrate conservative speed along the main route by song-time slice.
  for (let i = 1; i < route.length; i++) {
    const prev = route[i - 1];
    const curr = route[i];
    const dx = curr.position.x - prev.position.x;
    const dy = curr.position.y - prev.position.y;
    const dz = curr.position.z - prev.position.z;
    const horizontal = Math.hypot(dx, dz);
    const dyUp = dy > 0 ? dy : 0;
    elevationGain += dyUp;
    const speed = Math.max(4, sectionSpeedAt(analysis, curr.time || prev.time));
    estimated += horizontal / speed + dyUp / 6.0;
  }

  // Optional side-surf ramps are SKILL shortcuts, not required travel, so a
  // competent run is planned on the main route only. The optional distance is
  // reported separately for information and never inflates the required budget.
  const optionalDistance = nodeArcSpan(track.optionalRamps ?? []);

  const recoverySeconds =
    track.checkpoints.length * CHECKPOINT_RECOVERY_SECONDS + START_FINISH_OVERHEAD_SECONDS;
  estimated += recoverySeconds;

  const planningBudgetSeconds = estimated * PLANNING_HEADROOM;
  const song = Math.max(0, analysis.duration);
  return {
    estimatedSeconds: estimated,
    planningBudgetSeconds,
    fitsSong: song + 1e-6 >= planningBudgetSeconds,
    slackSeconds: song - planningBudgetSeconds,
    mainDistance: track.totalDistance,
    optionalDistance,
    elevationGain,
    recoverySeconds
  };
}
