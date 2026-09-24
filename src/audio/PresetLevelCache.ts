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

  /** DEV diagnostics: proves presets are not being re-fetched or re-parsed. */
  private static loadCount = 0;
  private static hitCount = 0;
  private static missCount = 0;

  public static set(trackId: string, data: PrecomputedLevelData): void {
    this.cache.set(trackId, data);
  }

  public static get(trackId: string): PrecomputedLevelData | undefined {
    return this.cache.get(trackId);
  }

  /** Clears the in-memory preset cache (used when simulating a cold session). */
  public static clear(): void {
    this.cache.clear();
    this.loadCount = 0;
    this.hitCount = 0;
    this.missCount = 0;
  }

  public static getCacheInfo(): { cached: number; loads: number; hits: number; misses: number } {
    return {
      cached: this.cache.size,
      loads: this.loadCount,
      hits: this.hitCount,
      misses: this.missCount
    };
  }

  /**
   * CANONICAL LEVEL RESOLUTION (pure).
   *
   * This is the ONE function that turns a shipped preset JSON into the exact
   * track a player will run. Both the browser (`loadPreset`) and the canonical
   * registry generator call it, so the map fingerprint can never drift between
   * what the registry claims and what a client actually builds.
   */
  public static buildLevelData(json: Record<string, unknown>): PrecomputedLevelData {
    const analysis = json.analysis as TrackAnalysis | undefined;
    // Restore Float32Array for waveform
    if (analysis && Array.isArray(analysis.waveform)) {
      analysis.waveform = new Float32Array(analysis.waveform as unknown as number[]);
    }

    let track = json.track as GeneratedTrack;

    // Route packages are versioned so official cached levels cannot silently
    // retain obsolete giant ascents or omit gameplay challenges.
    //
    // COMPETITIVE MAP IDENTITY: when the cached package is stale we use the
    // SINGLE canonical generation pipeline and nothing else. Obstacles, spines
    // and forks therefore come from exactly the same code path that produces the
    // map fingerprint, so two clients cannot end up playing different maps for
    // the same official track.
    const hasStaleRoute = !track?.route || track.generationVersion !== ROUTE_GENERATION_VERSION;
    if (hasStaleRoute && analysis) {
      track = RouteGenerator.generate(analysis);
    }

    // Safety nets only (a fully regenerated track already has all of these).
    // They must never re-derive gameplay with different options, because that
    // would change the map out from under the fingerprint.
    if (!track.optionalRamps || track.optionalRamps.length === 0) {
      const rng = new SeededRandom(analysis?.seed || 12345);
      track.optionalRamps = RouteGenerator.generateOptionalSideSurfs(track.route, rng);
    }

    if ((!track.obstacles || track.obstacles.length === 0) && analysis) {
      track.obstacles = RouteChallengeGenerator.generate(track.route, analysis, {
        recoveryShelves: track.recoveryShelves
      });
    }

    if ((!track.signalSpines || track.signalSpines.length === 0) && analysis) {
      const rng = new SeededRandom(analysis?.seed || 12345);
      track.signalSpines = SignalSpineGenerator.generate(track.route, analysis, rng, {
        obstacles: track.obstacles
      });
    }

    return {
      trackId: (json.trackId as string) || '',
      analysis: analysis as TrackAnalysis,
      track,
      spectacleEvents: (json.spectacleEvents as PrecomputedLevelData['spectacleEvents']) || undefined
    };
  }

  public static async loadPreset(trackId: string): Promise<PrecomputedLevelData | null> {
    if (this.cache.has(trackId)) {
      this.hitCount++;
      return this.cache.get(trackId)!;
    }

    this.loadCount++;
    try {
      const response = await fetch(`/music/presets/${trackId}.json`);
      if (!response.ok) {
        this.missCount++;
        return null;
      }

      const json = await response.json();
      const data = PresetLevelCache.buildLevelData(json);
      this.cache.set(trackId, data);
      return data;
    } catch {
      this.missCount++;
      return null;
    }
  }
}
