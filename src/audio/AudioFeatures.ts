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
}

export interface VisualAccent {
  hex: string;
  rgb: [number, number, number];
  name: string;
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
}
