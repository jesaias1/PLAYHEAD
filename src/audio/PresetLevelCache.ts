/**
 * PresetLevelCache: Storage and loader for precomputed level definitions.
 * Enables instant world loading for built-in Signal Pack tracks by bypassing
 * runtime offline FFT analysis and procedural route regeneration.
 */

import { TrackAnalysis } from './AudioFeatures';
import { GeneratedTrack } from '../generation/GenerationTypes';
import { SpectacleEvent } from '../world/SpectaclePlanner';
import { ROUTE_GENERATION_VERSION, RouteGenerator } from '../generation/RouteGenerator';
import { RouteChallengeGenerator } from '../generation/RouteChallengeGenerator';
import { SignalSpineGenerator } from '../generation/SignalSpineGenerator';
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

      let track: GeneratedTrack = json.track;
      // Route packages are versioned so official cached levels cannot silently
      // retain obsolete giant ascents or omit gameplay challenges.
      //
      // COMPETITIVE MAP IDENTITY: when the cached package is stale we use the
      // SINGLE canonical generation pipeline and nothing else. Obstacles,
      // spines and forks therefore come from exactly the same code path that
      // produces the map fingerprint, so two clients cannot end up playing
      // different maps for the same official track.
      const hasStaleRoute = !track?.route || track.generationVersion !== ROUTE_GENERATION_VERSION;
      if (hasStaleRoute && json.analysis) {
        track = RouteGenerator.generate(json.analysis);
      }

      // Safety nets only (a fully regenerated track already has all of these).
      // They must never re-derive gameplay with different options, because that
      // would change the map out from under the fingerprint.
      if (!track.optionalRamps || track.optionalRamps.length === 0) {
        const rng = new SeededRandom(json.analysis?.seed || 12345);
        track.optionalRamps = RouteGenerator.generateOptionalSideSurfs(track.route, rng);
      }

      if ((!track.obstacles || track.obstacles.length === 0) && json.analysis) {
        track.obstacles = RouteChallengeGenerator.generate(track.route, json.analysis, {
          recoveryShelves: track.recoveryShelves
        });
      }

      if ((!track.signalSpines || track.signalSpines.length === 0) && json.analysis) {
        const rng = new SeededRandom(json.analysis?.seed || 12345);
        track.signalSpines = SignalSpineGenerator.generate(track.route, json.analysis, rng, {
          obstacles: track.obstacles
        });
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
