/**
 * SurfPlanner for PLAYHEAD
 * Analyzes track structure and musical features to schedule intentional,
 * musically-timed surf events.
 */

import { TrackAnalysis, AnalysisSection } from '../audio/AudioFeatures';

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
      // - Sections shorter than 6 seconds
      if (sec.start < 18.0) continue;
      if (sec.start + sec.duration > totalDuration - 12.0) continue;
      if (sec.duration < 6.0) continue;

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
      // 6. General energetic section
      else if (sec.intensity >= 0.60) {
        score = 0.55;
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

    // Pick top 1-3 candidates with minimum time spacing of 25 seconds between surfs
    const maxEvents = Math.min(3, Math.max(1, Math.floor(totalDuration / 75.0)));
    const selected: typeof candidates = [];

    for (const cand of candidates) {
      if (selected.length >= maxEvents) break;

      const tooClose = selected.some(s =>
        Math.abs(s.section.start - cand.section.start) < 25.0
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
      const duration = Math.min(item.section.duration * 0.75, isSignature ? 18.0 : 12.0);

      events.push({
        id: i + 1,
        sectionIndex: item.sectionIndex,
        startTime: item.section.start,
        endTime: item.section.start + duration,
        duration,
        type: isSignature ? (item.preferredType === 'SURF_DROP' ? 'SURF_DROP' : 'SURF_TRANSFER') : item.preferredType,
        intensity: item.section.intensity,
        suitability: item.suitability,
        entrySpeedTarget: 16.0 + item.section.intensity * 6.0,
        isSignature
      });
    }

    return events;
  }
}
