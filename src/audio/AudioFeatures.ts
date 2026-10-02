/**
 * Audio feature interfaces and data models
 */

export interface AnalysisFrame {
  time: number;
  rms: number;          // 0..1 normalized
  bass: number;         // 0..1 normalized (sub & bass < 250 Hz)
  lowMid: number;       // 0..1 normalized (250 - 800 Hz)
  mid: number;          // 0..1 normalized (800 - 2500 Hz)
  high: number;         // 0..1 normalized (> 2500 Hz)
  centroid: number;     // 0..1 normalized spectral brightness
  flux: number;         // 0..1 normalized spectral transient flux
  density: number;      // 0..1 local rhythmic onset density
}

export interface OnsetEvent {
  time: number;
  strength: number;     // 0..1
  bass: number;         // 0..1
  mids: number;         // 0..1
  highs: number;        // 0..1
}

export type SectionTheme = 'FLOW' | 'ASCENT' | 'PRECISION' | 'DESCENT' | 'SURF' | 'SPEED' | 'BREATH' | 'BUILDUP' | 'DROP';

export interface AnalysisSection {
  index: number;
  start: number;
  end: number;
  duration: number;
  intensity: number;      // 0..1 average energy
  rhythmicDensity: number;// 0..1
  brightness: number;     // 0..1
  theme: SectionTheme;
  /** Optional CUSTOM-only honesty metadata; never present on official presets. */
  confidence?: SectionConfidence;
}

/**
 * Honest, bounded confidence that a CUSTOM section boundary/segment reflects a
 * real musical transition rather than a low-information plateau. Optional and
 * never invented for official precomputed analyses.
 */
export interface SectionConfidence {
  /** 0..1 how strongly the macro descriptors separate this section from its neighbours. */
  boundary: number;
  /** 0..1 how trustworthy the aggregate descriptors are (low on flat/ambient input). */
  descriptor: number;
}

export interface VisualAccent {
  hex: string;
  rgb: [number, number, number];
  name: string;
}

/**
 * Provenance metadata for a track that the player supplied themselves
 * (file import / dev synthetic / movement lab). It is present ONLY on the
 * custom runtime path; official precomputed presets never carry it, so
 * official identity is never inferred from a filename.
 */
export interface CustomSourceMeta {
  /** Where the buffer under analysis came from. */
  source: 'FILE' | 'DEV' | 'LAB';
  /** Filename shown to the player (UI only, never used for identity). */
  displayName: string;
  /**
   * Content-derived identity independent of filename. Derived from the encoded
   * bytes when available (SHA-256), otherwise a robust PCM hash of the decoded
   * buffer. Renaming the file never changes this.
   */
  contentHash: string;
  /** Decoded byte length, when known. */
  byteLength: number;
  /** Whether the hash came from encoded bytes or decoded PCM. */
  hashSource: 'ENCODED_SHA256' | 'PCM';
}

export interface TrackAnalysis {
  filename: string;
  duration: number;
  bpm: number;
  bpmConfidence: number;
  globalEnergy: number;

  frames: AnalysisFrame[];
  onsets: OnsetEvent[];
  sections: AnalysisSection[];

  waveform: Float32Array;   // Downsampled normalized waveform envelope (e.g. 512 points for UI)
  seed: number;
  visualAccent: VisualAccent;

  /** Aggregate motion/dynamics summary used by the custom visual profile. */
  customAggregate?: CustomAggregate;
  /** Present only for player-supplied audio on the custom path. */
  customSource?: CustomSourceMeta;
}

export interface CustomAggregate {
  bass: number;        // 0..1 average sub/bass energy
  brightness: number;  // 0..1 average spectral centroid
  density: number;     // 0..1 average onset density
  dynamics: number;    // 0..1 p90-p10 energy spread
  contrast: number;    // 0..1 bass-vs-high spectral contrast
}
