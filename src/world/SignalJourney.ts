import { TrackAnalysis } from '../audio/AudioFeatures';
import { GeneratedTrack } from '../generation/GenerationTypes';
import { OfficialWorldProfile, resolveCompositionBands } from './SignalWorldProfile';

/** Load-time composition from the cached music and the unchanged route. */
export function planSignalJourney(analysis: TrackAnalysis, track: GeneratedTrack, profile: OfficialWorldProfile) {
  const bands = { ...resolveCompositionBands(profile) };
  if (!bands.active || track.route.length < 2) return { bands, signatureTimes: [], heroIndex: 0 };
  const route = track.route;
  const duration = Math.max(1, analysis.duration);
  const atTime = (time: number): number => {
    let best = 0;
    for (let i = 1; i < route.length; i++) {
      if (Math.abs(route[i].time - time) < Math.abs(route[best].time - time)) best = i;
    }
    return best;
  };
  const arcAt = (time: number): number => route[atTime(time)].arcLength / Math.max(1, route[route.length - 1].arcLength);
  const sections = (analysis.sections ?? []).filter(s => s.start >= duration * 0.12 && s.start < duration * 0.86);
  const ranked = sections.slice().sort((a, b) => {
    const score = (s: typeof a) => s.intensity + (profile.reaction.curatedThemes.includes(s.theme) ? 0.2 : 0);
    return score(b) - score(a) || a.start - b.start;
  });
  const peak = ranked[0];
  const signatureTimes: number[] = [];
  if (peak) {
    signatureTimes.push(peak.start);
    const second = ranked.find(s => Math.abs(s.start - peak.start) >= duration * 0.22);
    if (second) signatureTimes.push(second.start);
    signatureTimes.sort((a, b) => a - b);
    bands.revealArc = arcAt(peak.start);
    bands.denseStart = arcAt(peak.start + Math.min(4, peak.duration * 0.15));
    bands.denseEnd = arcAt(peak.end);
    const quiet = sections.filter(s => s !== peak).sort((a, b) => a.intensity - b.intensity || a.start - b.start)[0];
    if (quiet) {
      bands.lateStart = arcAt(quiet.start);
      bands.lateEnd = arcAt(quiet.end);
    }
  }
  return { bands, signatureTimes, heroIndex: peak ? atTime(peak.start) : atTime(duration * 0.62) };
}

/** A slow prepared landmark activation at at most two section boundaries. */
export function signatureEnvelope(times: readonly number[], songTime: number): number {
  let activation = 0;
  for (let i = 0; i < times.length; i++) {
    const elapsed = songTime - times[i];
    if (elapsed >= 0 && elapsed < 8) activation = Math.max(activation, Math.sin(Math.PI * elapsed / 8) ** 2);
  }
  return activation;
}
