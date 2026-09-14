/**
 * SpectaclePlanner for PLAYHEAD
 * Plans 3 to 6 major cinematic architectural events across the song with cooldowns,
 * exactly one SIGNATURE EVENT at peak intensity, and active runtime progress tracking.
 */

import { TrackAnalysis } from '../audio/AudioFeatures';
import { GeneratedTrack } from '../generation/GenerationTypes';

export type SpectacleType =
  | 'MONOLITH_SPLIT'
  | 'CATHEDRAL_IGNITION'
  | 'VOID_REVEAL'
  | 'STARFIELD_BLOOM'
  | 'WORLD_POWER_DOWN'
  | 'SHOCKWAVE';

export interface SpectacleEvent {
  id: number;
  type: SpectacleType;
  triggerTime: number;
  triggerArcLength: number;
  duration: number;
  isSignature: boolean;
  nodeIndex: number;
  active: boolean;
  progress: number; // 0.0 to 1.0 while active
  finished: boolean;
}

export class SpectaclePlanner {
  public events: SpectacleEvent[] = [];
  public activeEvent: SpectacleEvent | null = null;
  public signatureEvent: SpectacleEvent | null = null;

  public plan(analysis: TrackAnalysis, track: GeneratedTrack): void {
    this.events = [];
    this.activeEvent = null;
    this.signatureEvent = null;

    const route = track.route;
    if (route.length < 10) return;

    const duration = analysis.duration;
    // Determine target count: 3-6 events, roughly one per 25-35s
    const targetCount = Math.max(3, Math.min(6, Math.floor(duration / 28)));
    const minCooldown = 20.0; // Minimum 20 seconds between events

    // Candidate trigger points from music sections
    interface Candidate {
      time: number;
      nodeIndex: number;
      arcLength: number;
      weight: number;
      preferredType?: SpectacleType;
    }

    const candidates: Candidate[] = [];

    // 1. Drops are highest priority candidates
    for (let i = 0; i < analysis.sections.length; i++) {
      const sec = analysis.sections[i];
      if (sec.theme === 'DROP') {
        const nodeIdx = this.findNearestNodeIndex(route, sec.start);
        candidates.push({
          time: sec.start,
          nodeIndex: nodeIdx,
          arcLength: route[nodeIdx].arcLength,
          weight: 100 + sec.intensity * 50,
          preferredType: 'VOID_REVEAL'
        });
      } else if (sec.theme === 'BUILDUP') {
        // Buildup midpoint candidate for power-down or ignition
        const midTime = sec.start + (sec.end - sec.start) * 0.7;
        const nodeIdx = this.findNearestNodeIndex(route, midTime);
        candidates.push({
          time: midTime,
          nodeIndex: nodeIdx,
          arcLength: route[nodeIdx].arcLength,
          weight: 70 + sec.intensity * 30,
          preferredType: 'WORLD_POWER_DOWN'
        });
      }
    }

    // 2. Surf sequence entries
    for (let i = 1; i < route.length; i++) {
      if (route[i].isSurf && !route[i - 1].isSurf) {
        candidates.push({
          time: route[i].time,
          nodeIndex: i,
          arcLength: route[i].arcLength,
          weight: 85,
          preferredType: 'MONOLITH_SPLIT'
        });
      }
    }

    // 3. Strong musical peaks / onsets if more candidates needed
    const sortedOnsets = [...analysis.onsets].sort((a, b) => b.strength - a.strength);
    for (const onset of sortedOnsets.slice(0, 15)) {
      if (onset.strength > 0.8) {
        const nodeIdx = this.findNearestNodeIndex(route, onset.time);
        candidates.push({
          time: onset.time,
          nodeIndex: nodeIdx,
          arcLength: route[nodeIdx].arcLength,
          weight: 50 + onset.strength * 20,
          preferredType: 'SHOCKWAVE'
        });
      }
    }

    // Sort candidates by time
    candidates.sort((a, b) => a.time - b.time);

    // Filter with cooldown constraint
    const selected: Candidate[] = [];
    for (const cand of candidates) {
      if (cand.time < 5.0 || cand.time > duration - 6.0) continue; // Skip very beginning / end
      const tooClose = selected.some(s => Math.abs(s.time - cand.time) < minCooldown);
      if (!tooClose) {
        selected.push(cand);
        if (selected.length >= targetCount) break;
      }
    }

    // If fewer than 3, add evenly spaced candidates
    if (selected.length < 3) {
      const stepTime = duration / (targetCount + 1);
      for (let s = 1; s <= targetCount; s++) {
        const t = s * stepTime;
        if (!selected.some(c => Math.abs(c.time - t) < minCooldown)) {
          const nodeIdx = this.findNearestNodeIndex(route, t);
          selected.push({
            time: t,
            nodeIndex: nodeIdx,
            arcLength: route[nodeIdx].arcLength,
            weight: 40
          });
        }
      }
      selected.sort((a, b) => a.time - b.time);
    }

    // Find candidate with highest weight for SIGNATURE EVENT
    let highestWeightIdx = 0;
    let maxW = -1;
    for (let i = 0; i < selected.length; i++) {
      if (selected[i].weight > maxW) {
        maxW = selected[i].weight;
        highestWeightIdx = i;
      }
    }

    // Available spectacle families
    const families: SpectacleType[] = [
      'MONOLITH_SPLIT',
      'CATHEDRAL_IGNITION',
      'VOID_REVEAL',
      'STARFIELD_BLOOM',
      'WORLD_POWER_DOWN',
      'SHOCKWAVE'
    ];

    // Build planned events
    for (let i = 0; i < selected.length; i++) {
      const c = selected[i];
      const isSignature = (i === highestWeightIdx);
      const type = c.preferredType || families[(i + Math.abs(analysis.seed)) % families.length];
      const durationSec = isSignature ? 7.5 : 5.0;

      const evt: SpectacleEvent = {
        id: i + 1,
        type,
        triggerTime: c.time,
        triggerArcLength: c.arcLength,
        duration: durationSec,
        isSignature,
        nodeIndex: c.nodeIndex,
        active: false,
        progress: 0,
        finished: false
      };

      this.events.push(evt);
      if (isSignature) {
        this.signatureEvent = evt;
      }
    }
  }

  public update(songTime: number, _playerArcLength: number, _dt: number): SpectacleEvent | null {
    this.activeEvent = null;

    for (const evt of this.events) {
      if (evt.finished) continue;

      // Trigger condition: song reaches triggerTime (within 0.25s anticipation window)
      if (!evt.active && songTime >= evt.triggerTime - 0.25 && songTime < evt.triggerTime + evt.duration) {
        evt.active = true;
        evt.progress = 0;
      }

      if (evt.active) {
        const elapsed = songTime - evt.triggerTime;
        evt.progress = Math.max(0, Math.min(1.0, elapsed / evt.duration));

        if (elapsed >= evt.duration) {
          evt.active = false;
          evt.finished = true;
          evt.progress = 1.0;
        } else {
          this.activeEvent = evt;
        }
      }
    }

    return this.activeEvent;
  }

  private findNearestNodeIndex(route: { time: number }[], targetTime: number): number {
    let bestDist = 999999;
    let bestIdx = 0;
    for (let i = 0; i < route.length; i++) {
      const d = Math.abs(route[i].time - targetTime);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  public dispose(): void {
    this.events = [];
    this.activeEvent = null;
    this.signatureEvent = null;
  }
}
