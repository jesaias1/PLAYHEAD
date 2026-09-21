import { describe, expect, it } from 'vitest';
import { createProgramFingerprint, formatAnalysisStage } from '../src/ui/SignalIdentity';

describe('SignalIdentity', () => {
  it('maps real analyzer callbacks to concise subsystem labels', () => {
    expect(formatAnalysisStage('DECODING SIGNAL')).toBe('[AUDIO] PCM SIGNAL PREP');
    expect(formatAnalysisStage('ANALYSING TRANSIENTS')).toBe('[DSP] FFT + TRANSIENT MAP');
    expect(formatAnalysisStage('ESTIMATING TEMPO')).toBe('[DSP] BPM ESTIMATE');
    expect(formatAnalysisStage('FINDING SECTIONS')).toBe('[DSP] SECTION ANALYSIS');
    expect(formatAnalysisStage('ANALYSIS COMPLETE')).toBe('[SIGNAL] ANALYSIS LOCKED');
  });

  it('preserves explicit PLAYHEAD system labels while normalizing spacing', () => {
    expect(formatAnalysisStage('[WORLD] synthesizing space')).toBe('[WORLD] SYNTHESIZING SPACE');
    expect(formatAnalysisStage('[DSP ] extracting signal')).toBe('[DSP] EXTRACTING SIGNAL');
  });

  it('creates a stable bounded program fingerprint from catalog metadata', () => {
    const first = createProgramFingerprint('signal-drift', 132, 94, 3, 18);
    const again = createProgramFingerprint('signal-drift', 132, 94, 3, 18);
    const other = createProgramFingerprint('signal-drift', 140, 94, 3, 18);

    expect(first).toEqual(again);
    expect(other).not.toEqual(first);
    expect(first).toHaveLength(18);
    expect(first.every((value) => value >= 0 && value <= 1)).toBe(true);
  });
});
