/**
 * PresetLevelCache: Storage and loader for precomputed level definitions.
 * Enables instant world loading for built-in Signal Pack tracks by bypassing
 * runtime offline FFT analysis and procedural route regeneration.
 */

import { TrackAnalysis } from './AudioFeatures';
import { GeneratedTrack } from '../generation/GenerationTypes';
import { SpectacleEvent } from '../world/SpectaclePlanner';
import { RouteGenerator } from '../generation/RouteGenerator';
import { SeededRandom } from '../generation/SeededRandom';

export interface PrecomputedLevelData {
  trackId: string;
  analysis: TrackAnalysis;
  track: GeneratedTrack;
  spectacleEvents?: SpectacleEvent[];
}

export class PresetLevelCache {
  private static cache: Map<string, PrecomputedLevelData> = new Map();

  public static set(trackId: string, data: PrecomputedLevelData): void {
    this.cache.set(trackId, data);
  }

  public static get(trackId: string): PrecomputedLevelData | undefined {
    return this.cache.get(trackId);
  }

  public static async loadPreset(trackId: string): Promise<PrecomputedLevelData | null> {
    if (this.cache.has(trackId)) {
      return this.cache.get(trackId)!;
    }

    try {
      const response = await fetch(`/music/presets/${trackId}.json`);
      if (!response.ok) {
        return null;
      }

      const json = await response.json();
      // Restore Float32Array for waveform
      if (json.analysis && Array.isArray(json.analysis.waveform)) {
        json.analysis.waveform = new Float32Array(json.analysis.waveform);
      }

      const track: GeneratedTrack = json.track;
      // Ensure optional side-surf skill ramps are present even in cached presets
      if (!track.optionalRamps || track.optionalRamps.length === 0) {
        const rng = new SeededRandom(json.analysis?.seed || 12345);
        track.optionalRamps = RouteGenerator.generateOptionalSideSurfs(track.route, rng);
      }

      const data: PrecomputedLevelData = {
        trackId: json.trackId || trackId,
        analysis: json.analysis,
        track,
        spectacleEvents: json.spectacleEvents || json.spectaclePlan
      };

      this.cache.set(trackId, data);
      return data;
    } catch {
      return null;
    }
  }
}
