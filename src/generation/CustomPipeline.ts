/**
 * Small orchestration helper for the CUSTOM audio load path.
 *
 * Extracted so the cache-hit contract is unit-testable: on a warm cache the
 * injected `analyze` must never be called, and the cached entry must never be
 * mutated (the returned analysis carries the NEW filename while the stored
 * entry is left untouched).
 */

import { CustomSourceMeta, TrackAnalysis } from '../audio/AudioFeatures';
import { GeneratedTrack } from './GenerationTypes';
import { CustomAnalysisCache } from '../audio/CustomAnalysisCache';
import { CustomContentIdentity } from '../utils/hash';

export interface CustomAnalyzeOptions {
  custom: { source: CustomSourceMeta['source']; encodedBytes?: ArrayBuffer | null };
  contentIdentity?: CustomContentIdentity;
}

export interface CustomPipelineDeps {
  analyze: (
    buffer: AudioBuffer,
    filename: string,
    onProgress: ((stage: string, progress: number) => void) | undefined,
    options: CustomAnalyzeOptions
  ) => Promise<TrackAnalysis>;
  generate: (analysis: TrackAnalysis) => GeneratedTrack;
}

export interface CustomPipelineResult {
  analysis: TrackAnalysis;
  track: GeneratedTrack;
  cacheHit: boolean;
}

export async function resolveCustomAudioLevel(
  buffer: AudioBuffer,
  filename: string,
  identity: CustomContentIdentity,
  custom: { source: CustomSourceMeta['source']; encodedBytes?: ArrayBuffer | null },
  deps: CustomPipelineDeps,
  onProgress?: (stage: string, progress: number) => void
): Promise<CustomPipelineResult> {
  const cached = CustomAnalysisCache.load(identity.contentHash);
  if (cached) {
    onProgress?.('[CACHE] ANALYSIS AND VALIDATED ROUTE RESTORED', 1);
    // Provenance reflects the NEW filename; the cached entry is not mutated.
    const analysis: TrackAnalysis = {
      ...cached.analysis,
      filename,
      ...(cached.analysis.customSource
        ? { customSource: { ...cached.analysis.customSource, displayName: filename } }
        : {})
    };
    return { analysis, track: cached.track, cacheHit: true };
  }

  const analysis = await deps.analyze(buffer, filename, onProgress, {
    custom,
    contentIdentity: identity
  });
  onProgress?.('[MAP] COMPOSING TRAVERSAL', 1);
  const track = deps.generate(analysis);
  CustomAnalysisCache.save(identity.contentHash, { analysis, track });
  return { analysis, track, cacheHit: false };
}
