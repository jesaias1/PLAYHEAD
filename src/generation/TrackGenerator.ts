/**
 * High-level TrackGenerator coordinating analysis and procedural generation
 */

import { TrackAnalysis } from '../audio/AudioFeatures';
import { GeneratedTrack } from './GenerationTypes';
import { RouteGenerator } from './RouteGenerator';

export class TrackGenerator {
  public static generate(analysis: TrackAnalysis): GeneratedTrack {
    console.log(`[TrackGenerator] Generating course for "${analysis.filename}" (${analysis.duration.toFixed(1)}s, ${analysis.bpm} BPM, seed: 0x${analysis.seed.toString(16)})`);
    const track = RouteGenerator.generate(analysis);
    console.log(`[TrackGenerator] Generated ${track.route.length} nodes, ${track.checkpoints.length} checkpoints, ${track.repairedJumpsCount} repaired transitions, total distance: ${track.totalDistance.toFixed(1)}m`);
    return track;
  }
}
