/**
 * PresetGenerator: Development utility to precompute and serialize level definitions
 * for all Signal Pack tracks, enabling instant runtime loading.
 */

import { SignalPackCatalog, SignalPackTrack } from './SignalPackCatalog';
import { AudioDecoder } from './AudioDecoder';
import { AudioAnalyzer } from './AudioAnalyzer';
import { TrackGenerator } from '../generation/TrackGenerator';
import { SpectaclePlanner } from '../world/SpectaclePlanner';

export class PresetGenerator {
  public static async generatePresetForTrack(track: SignalPackTrack): Promise<string> {
    const buffer = await AudioDecoder.loadAudio(track.audioUrl);
    const analysis = await AudioAnalyzer.analyze(buffer, track.title);
    const generatedCourse = TrackGenerator.generate(analysis);
    const planner = new SpectaclePlanner();
    planner.plan(analysis, generatedCourse);

    const data = {
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      genre: track.genre,
      bpm: track.bpm,
      duration: track.duration,
      difficulty: track.difficulty,
      difficultyLabel: track.difficultyLabel,
      description: track.description,
      accentColor: track.accentColor,
      paletteKey: track.paletteKey,
      analysis: {
        ...analysis,
        waveform: Array.from(analysis.waveform)
      },
      track: generatedCourse,
      spectacleEvents: planner.events
    };

    return JSON.stringify(data, null, 2);
  }

  public static async generateAllPresets(
    onProgress?: (idx: number, total: number, title: string) => void
  ): Promise<Record<string, string>> {
    const tracks = SignalPackCatalog.getTracks();
    const map: Record<string, string> = {};

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      onProgress?.(i + 1, tracks.length, track.title);
      const json = await this.generatePresetForTrack(track);
      map[track.id] = json;
    }

    return map;
  }
}
