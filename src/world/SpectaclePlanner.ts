/**
 * SpectaclePlanner for PLAYHEAD
 * Plans 3 to 6 major cinematic architectural events across the song with cooldowns,
 * exactly one SIGNATURE EVENT at peak intensity, and active runtime progress tracking.
 */

import { TrackAnalysis } from '../audio/AudioFeatures';
import { GeneratedTrack } from '../generation/GenerationTypes';

export type SpectacleType =
  | 'MONOLITH_SPLIT'
  | 'VOID_REVEAL'
  | 'CATHEDRAL_IGNITION'
  | 'STARFIELD_BLOOM'
  | 'WORLD_POWER_DOWN'
  | 'SURF_CANYON_RELEASE';

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
      preferredType: SpectacleType;
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
          preferredType: (i % 2 === 0) ? 'VOID_REVEAL' : 'MONOLITH_SPLIT'
        });
      } else if (sec.theme === 'BUILDUP') {
        // Buildup midpoint candidate for power-down anticipation
        const midTime = sec.start + (sec.end - sec.start) * 0.65;
        const nodeIdx = this.findNearestNodeIndex(route, midTime);
        candidates.push({
          time: midTime,
          nodeIndex: nodeIdx,
          arcLength: route[nodeIdx].arcLength,
          weight: 70 + sec.intensity * 30,
          preferredType: 'WORLD_POWER_DOWN'
        });
      } else if (sec.theme === 'FLOW' || sec.theme === 'SPEED' || sec.theme === 'PRECISION') {
        // Rhythmic sections for cathedral ignition
        const midTime = sec.start + (sec.end - sec.start) * 0.5;
        const nodeIdx = this.findNearestNodeIndex(route, midTime);
        candidates.push({
          time: midTime,
          nodeIndex: nodeIdx,
          arcLength: route[nodeIdx].arcLength,
          weight: 60 + sec.intensity * 25,
          preferredType: 'CATHEDRAL_IGNITION'
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
          weight: 90,
          preferredType: 'SURF_CANYON_RELEASE'
        });
      }
    }

    // 3. Elevated scenic nodes for celestial bloom
    for (let i = 5; i < route.length - 5; i += 12) {
      if (route[i].position.y > 10.0 && !route[i].isSurf) {
        candidates.push({
          time: route[i].time,
          nodeIndex: i,
          arcLength: route[i].arcLength,
          weight: 65,
          preferredType: 'STARFIELD_BLOOM'
        });
      }
    }

    // Sort candidates by time
    candidates.sort((a, b) => a.time - b.time);

    // Filter with cooldown constraint
    const selected: Candidate[] = [];
    for (const cand of candidates) {
      if (cand.time < 6.0 || cand.time > duration - 8.0) continue; // Skip very beginning / end
      const tooClose = selected.some(s => Math.abs(s.time - cand.time) < minCooldown);
      if (!tooClose) {
        selected.push(cand);
        if (selected.length >= targetCount) break;
      }
    }

    // If fewer than 3, add evenly spaced candidates
    if (selected.length < 3) {
      const stepTime = duration / (targetCount + 1);
      const fallbackTypes: SpectacleType[] = ['VOID_REVEAL', 'CATHEDRAL_IGNITION', 'STARFIELD_BLOOM', 'MONOLITH_SPLIT'];
      for (let s = 1; s <= targetCount; s++) {
        const t = s * stepTime;
        if (!selected.some(c => Math.abs(c.time - t) < minCooldown)) {
          const nodeIdx = this.findNearestNodeIndex(route, t);
          selected.push({
            time: t,
            nodeIndex: nodeIdx,
            arcLength: route[nodeIdx].arcLength,
            weight: 40,
            preferredType: fallbackTypes[s % fallbackTypes.length]
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
    const allFamilies: SpectacleType[] = [
      'MONOLITH_SPLIT',
      'VOID_REVEAL',
      'CATHEDRAL_IGNITION',
      'STARFIELD_BLOOM',
      'WORLD_POWER_DOWN',
      'SURF_CANYON_RELEASE'
    ];

    // Build planned events enforcing non-repetition
    let lastType: SpectacleType | null = null;
    for (let i = 0; i < selected.length; i++) {
      const c = selected[i];
      const isSignature = (i === highestWeightIdx);
      let type = c.preferredType;

      // Enforce event diversity: if type equals lastType, pick next distinct family
      if (type === lastType) {
        const alt = allFamilies.find(f => f !== lastType) || 'VOID_REVEAL';
        type = alt;
      }
      lastType = type;

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
