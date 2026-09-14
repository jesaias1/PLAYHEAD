import { TrackAnalysis } from '../audio/AudioFeatures';
import { GeneratedTrack } from './GenerationTypes';
import { RouteGenerator } from './RouteGenerator';
import { RouteConnectivityValidator, RouteConnectivityResult } from './RouteConnectivityValidator';

export interface GenerationReport {
  track: GeneratedTrack;
  attempts: number;
  wasRepaired: boolean;
  wasRegenerated: boolean;
  usedSafeFallback: boolean;
  connectivity: RouteConnectivityResult;
}

export class TrackGenerator {
  public static lastReport: GenerationReport | null = null;

  public static generate(analysis: TrackAnalysis): GeneratedTrack {
    console.log(`[TrackGenerator] Generating course for "${analysis.filename}" (${analysis.duration.toFixed(1)}s, ${analysis.bpm} BPM, seed: 0x${analysis.seed.toString(16)})`);

    const maxAttempts = 5;
    let attempts = 0;
    let currentAnalysis = analysis;

    while (attempts < maxAttempts) {
      attempts++;
      const track = RouteGenerator.generate(currentAnalysis);
      const validation = RouteConnectivityValidator.validate(track);

      if (validation.isValid) {
        console.log(`[TrackGenerator] Success on attempt ${attempts}: ${validation.summary}`);
        console.log(`[TrackGenerator] Generated ${track.route.length} nodes, ${track.checkpoints.length} checkpoints, ${track.repairedJumpsCount} repaired transitions, total distance: ${track.totalDistance.toFixed(1)}m`);

        this.lastReport = {
          track,
          attempts,
          wasRepaired: track.repairedJumpsCount > 0,
          wasRegenerated: attempts > 1,
          usedSafeFallback: false,
          connectivity: validation
        };

        return track;
      }

      console.warn(`[TrackGenerator] Attempt ${attempts} failed connectivity validation: ${validation.brokenEdges.length} broken edge(s) found. Retrying with deterministic derived seed...`);
      for (const be of validation.brokenEdges) {
        console.warn(`  Broken Edge ${be.index}: ${be.from.type} -> ${be.to.type} (gap: ${be.horizontalDist.toFixed(1)}m, step: ${be.verticalDelta.toFixed(1)}m) - ${be.failureReason}`);
      }

      // Derive deterministic retry seed
      currentAnalysis = {
        ...currentAnalysis,
        seed: ((currentAnalysis.seed * 1664525 + 1013904223) >>> 0)
      };
    }

    // Defensive layer: Guaranteed safe fallback course
    console.error(`[TrackGenerator] CRITICAL: All ${maxAttempts} procedural generation attempts failed connectivity validation. Generating guaranteed safe fallback course.`);
    const fallbackTrack = RouteGenerator.generateSafeFallback(analysis);
    const fallbackValidation = RouteConnectivityValidator.validate(fallbackTrack);

    this.lastReport = {
      track: fallbackTrack,
      attempts,
      wasRepaired: false,
      wasRegenerated: true,
      usedSafeFallback: true,
      connectivity: fallbackValidation
    };

    return fallbackTrack;
  }
}
