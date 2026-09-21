import { murmurHash3 } from '../utils/hash';

const ANALYSIS_STAGE_LABELS: Readonly<Record<string, string>> = {
  'DECODING SIGNAL': '[AUDIO] PCM SIGNAL PREP',
  'ANALYSING TRANSIENTS': '[DSP] FFT + TRANSIENT MAP',
  'MAPPING ENERGY': '[DSP] ENERGY ENVELOPE',
  'FINDING ONSETS': '[DSP] ONSET MAP',
  'ESTIMATING TEMPO': '[DSP] BPM ESTIMATE',
  'FINDING SECTIONS': '[DSP] SECTION ANALYSIS',
  'ANALYSIS COMPLETE': '[SIGNAL] ANALYSIS LOCKED'
};

export function formatAnalysisStage(stage: string): string {
  const normalized = stage.trim().replace(/\s+/g, ' ').toUpperCase();
  return ANALYSIS_STAGE_LABELS[normalized] ?? normalized.replace(/^\[([A-Z]+)\s+\]/, '[$1]');
}

/**
 * A compact program identity derived only from catalog metadata. It is deliberately
 * presented as instrumentation, not as an audio waveform or analysis result.
 */
export function createProgramFingerprint(
  trackId: string,
  bpm: number,
  duration: number,
  difficulty: number,
  count = 18
): number[] {
  let state = murmurHash3(`${trackId}|${bpm}|${duration.toFixed(3)}|${difficulty}`, 0x504c4159);
  const bars: number[] = [];

  for (let i = 0; i < count; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const noise = (state & 0xffff) / 0xffff;
    const rhythm = 0.5 + 0.5 * Math.sin((i + 1) * (bpm / 60) * 0.72);
    const level = 0.18 + (noise * 0.52) + (rhythm * 0.2) + (Math.min(5, difficulty) * 0.02);
    bars.push(Math.min(1, Number(level.toFixed(3))));
  }

  return bars;
}
