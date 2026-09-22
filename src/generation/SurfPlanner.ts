/**
 * SurfPlanner for PLAYHEAD
 * Analyzes track structure and musical features to schedule intentional,
 * musically-timed surf events.
 */

import { TrackAnalysis, AnalysisSection } from '../audio/AudioFeatures';
import { computeTempoProfile } from './TempoPressure';

export type SurfPhraseType =
  | 'SURF_DROP'
  | 'SURF_RELEASE'
  | 'SURF_TRANSFER'
  | 'SURF_CANYON'
  | 'SURF_CHAIN';

export interface SurfEvent {
  id: number;
  sectionIndex: number;
  startTime: number;
  endTime: number;
  duration: number;
  type: SurfPhraseType;
  intensity: number;
  suitability: number;
  entrySpeedTarget: number; // in m/s
  isSignature: boolean;
}

export class SurfPlanner {
  /**
   * Plan surf events for an analysed track.
   * Evaluates section themes, musical pacing, drop transitions, and energy profiles.
   */
  public static plan(analysis: TrackAnalysis): SurfEvent[] {
    const events: SurfEvent[] = [];
    const sections = analysis.sections;

    if (!sections || sections.length === 0) return events;

    const totalDuration = analysis.duration;
    // TEMPO PRESSURE changes surf VOCABULARY and cadence, not raw ramp count
    // alone: slow tracks get longer graceful glides, fast tracks get shorter,
    // more frequent redirects and launch-to-rejoin sequences.
    const tempo = computeTempoProfile(analysis);
    const pressure = tempo.pressure;
    const candidates: {
      sectionIndex: number;
      section: AnalysisSection;
      suitability: number;
      preferredType: SurfPhraseType;
    }[] = [];

    // Evaluate each section for surf suitability
    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      const prevSec = i > 0 ? sections[i - 1] : null;

      // 1. Ineligibility constraints:
      // - First onboarding window (first 18 seconds)
      // - Right before finish (last 12 seconds)
      // - Very short sections
      if (sec.start < 18.0) continue;
      if (sec.start + sec.duration > totalDuration - 12.0) continue;
      if (sec.duration < 5.0) continue;

      let score = 0;
      let preferredType: SurfPhraseType = 'SURF_RELEASE';

      // 2. High-value candidate: BUILDUP -> DROP transition
      if (sec.theme === 'DROP' || (prevSec && prevSec.theme === 'BUILDUP')) {
        score = 0.95;
        preferredType = 'SURF_DROP';
      }
      // 3. High sustained energy or driving bass
      else if (sec.intensity >= 0.75) {
        score = 0.82;
        preferredType = sec.duration >= 14.0 ? 'SURF_TRANSFER' : 'SURF_CANYON';
      }
      // 4. Flow or Breath section release
      else if (sec.theme === 'FLOW' || sec.theme === 'BREATH') {
        score = 0.68;
        preferredType = 'SURF_RELEASE';
      }
      // 5. DnB / High tempo rhythmic syncopation
      else if (analysis.bpm >= 155 && sec.intensity >= 0.65) {
        score = 0.75;
        preferredType = 'SURF_TRANSFER';
      }
      // 6. General energetic section (broadened so surf is a recurring pillar)
      else if (sec.intensity >= 0.45) {
        score = 0.58;
        preferredType = 'SURF_CHAIN';
      }

      if (score >= 0.50) {
        candidates.push({
          sectionIndex: i,
          section: sec,
          suitability: score,
          preferredType
        });
      }
    }

    if (candidates.length === 0) return events;

    // Sort candidates by suitability descending
    candidates.sort((a, b) => b.suitability - a.suitability);

    // Surf presence: more events than before, scaled by tempo pressure.
    const maxEvents = Math.min(6, Math.max(2, Math.round(2 + pressure * 4)));
    const minSpacing = 18.0 - pressure * 6.0; // 12-18s between surf moments
    const selected: typeof candidates = [];

    for (const cand of candidates) {
      if (selected.length >= maxEvents) break;

      const tooClose = selected.some(s =>
        Math.abs(s.section.start - cand.section.start) < minSpacing
      );

      if (!tooClose) {
        selected.push(cand);
      }
    }

    // Sort selected back chronologically by startTime
    selected.sort((a, b) => a.section.start - b.section.start);

    // Designate the single highest-suitability event as the SIGNATURE SURF
    let highestSuitability = -1;
    let signatureIdx = -1;
    for (let i = 0; i < selected.length; i++) {
      if (selected[i].suitability > highestSuitability) {
        highestSuitability = selected[i].suitability;
        signatureIdx = i;
      }
    }

    // Convert to SurfEvents
    for (let i = 0; i < selected.length; i++) {
      const item = selected[i];
      const isSignature = i === signatureIdx;
      const type = tempoAdjustedType(item.preferredType, pressure, isSignature);
      // Slow tracks glide longer; fast tracks are shorter and more frequent.
      const baseDuration = isSignature ? lerp(20.0, 13.0, pressure) : lerp(15.0, 8.0, pressure);
      const duration = Math.min(item.section.duration * 0.8, baseDuration);

      events.push({
        id: i + 1,
        sectionIndex: item.sectionIndex,
        startTime: item.section.start,
        endTime: item.section.start + duration,
        duration,
        type,
        intensity: item.section.intensity,
        suitability: item.suitability,
        entrySpeedTarget: 16.0 + item.section.intensity * 6.0,
        isSignature
      });
    }

    return events;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

/**
 * Tempo reshapes surf vocabulary:
 * - LOW pressure: long, graceful transfers and releases.
 * - HIGH pressure: shorter, more aggressive chains / canyons with quicker
 *   redirects and launch-to-rejoin sequences.
 */
function tempoAdjustedType(
  preferred: SurfPhraseType,
  pressure: number,
  isSignature: boolean
): SurfPhraseType {
  if (pressure >= 0.62) {
    if (preferred === 'SURF_DROP' || isSignature) return 'SURF_TRANSFER';
    return preferred === 'SURF_CANYON' ? 'SURF_CANYON' : 'SURF_CHAIN';
  }
  if (pressure <= 0.38) {
    if (preferred === 'SURF_CHAIN' || preferred === 'SURF_CANYON') return 'SURF_RELEASE';
    return preferred;
  }
  return isSignature && preferred !== 'SURF_DROP' ? 'SURF_TRANSFER' : preferred;
}
