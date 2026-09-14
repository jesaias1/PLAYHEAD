/**
 * Centralized Audio-Visual Signal Bus for PLAYHEAD
 * Exposes smoothed, visual-ready signals with attack/decay envelopes
 * and precomputed lookahead anticipation.
 */

import * as THREE from 'three';
import { AnalysisSection, TrackAnalysis } from '../audio/AudioFeatures';
import { TrackPalette, PaletteSelector } from '../audio/TrackPalettes';
import { GeneratedTrack } from '../generation/GenerationTypes';

export interface MusicVisualState {
  time: number;
  progress: number;
  playerProgress: number;
  syncDelta: number;

  energy: number;
  subBass: number;
  bass: number;
  lowMid: number;
  mid: number;
  high: number;

  brightness: number;
  flux: number;
  onsetPulse: number;

  sectionIndex: number;
  sectionTheme: string;
  sectionIntensity: number;
  sectionProgress: number;

  buildup: number;
  dropImpact: number;

  upcomingEnergy: number;
  upcomingDropDistance: number;
  nextDropTime: number;

  palette: TrackPalette;

  // Multi-anchor dynamic color mixing & routing
  primaryMix: number;
  secondaryMix: number;
  highlightMix: number;

  bassColor: THREE.Color;
  midColor: THREE.Color;
  highColor: THREE.Color;
  activeHorizonColor: THREE.Color;
  activeHazeColor: THREE.Color;
  routePulsePhase: number;
  kineticMusicIntensity: number;

  reactivityMultiplier: number;
}

export class MusicVisualController {
  public state: MusicVisualState;
  public reactivityMultiplier = 1.0;

  private analysis: TrackAnalysis | null = null;
  private track: GeneratedTrack | null = null;
  private lastTime = 0;

  // Smoothing envelopes
  private smoothEnergy = 0;
  private smoothSubBass = 0;
  private smoothBass = 0;
  private smoothLowMid = 0;
  private smoothMid = 0;
  private smoothHigh = 0;
  private smoothBrightness = 0;
  private smoothFlux = 0;
  private smoothOnsetPulse = 0;
  private smoothBuildup = 0;
  private dropImpactEnvelope = 0;

  // Section Color Mix Envelopes
  private smoothPrimaryMix = 0.5;
  private smoothSecondaryMix = 0.2;
  private smoothHighlightMix = 0.05;

  // Drop detection tracker
  private triggeredDrops = new Set<number>();

  constructor() {
    const defaultPalette = PaletteSelector.selectPalette(12345, 0.5, 0.5);
    this.state = {
      time: 0,
      progress: 0,
      playerProgress: 0,
      syncDelta: 0,
      energy: 0,
      subBass: 0,
      bass: 0,
      lowMid: 0,
      mid: 0,
      high: 0,
      brightness: 0,
      flux: 0,
      onsetPulse: 0,
      sectionIndex: 0,
      sectionTheme: 'FLOW',
      sectionIntensity: 0.5,
      sectionProgress: 0,
      buildup: 0,
      dropImpact: 0,
      upcomingEnergy: 0,
      upcomingDropDistance: 9999,
      nextDropTime: -1,
      palette: defaultPalette,
      primaryMix: 0.5,
      secondaryMix: 0.2,
      highlightMix: 0.05,
      bassColor: defaultPalette.surface.clone(),
      midColor: defaultPalette.surface.clone(),
      highColor: defaultPalette.surface.clone(),
      activeHorizonColor: defaultPalette.void.clone(),
      activeHazeColor: defaultPalette.void.clone(),
      routePulsePhase: 0,
      kineticMusicIntensity: 0,
      reactivityMultiplier: 1.0
    };
  }

  public init(analysis: TrackAnalysis, track: GeneratedTrack): void {
    this.analysis = analysis;
    this.track = track;
    this.lastTime = 0;
    this.triggeredDrops.clear();

    const palette = PaletteSelector.selectPalette(
      analysis.seed,
      analysis.frames.length > 0 ? analysis.frames[0].centroid : 0.5,
      analysis.globalEnergy
    );

    this.state.palette = palette;
    this.resetEnvelopes();
  }

  public resetEnvelopes(): void {
    this.smoothEnergy = 0;
    this.smoothSubBass = 0;
    this.smoothBass = 0;
    this.smoothLowMid = 0;
    this.smoothMid = 0;
    this.smoothHigh = 0;
    this.smoothBrightness = 0;
    this.smoothFlux = 0;
    this.smoothOnsetPulse = 0;
    this.smoothBuildup = 0;
    this.dropImpactEnvelope = 0;
  }

  public update(songTime: number, playerRouteProgress: number, dt: number, playerSpeed = 0): void {
    if (!this.analysis || this.analysis.frames.length === 0) return;

    if (songTime < this.lastTime || Math.abs(songTime - this.lastTime) > 2.0) {
      this.resetEnvelopes();
    }

    const frames = this.analysis.frames;
    const duration = Math.max(1, this.analysis.duration);
    const timeClamped = Math.max(0, Math.min(duration, songTime));

    // Find current frame index
    const frameDur = frames.length > 1 ? frames[1].time - frames[0].time : 0.0116;
    const frameIdx = Math.max(0, Math.min(frames.length - 1, Math.floor(timeClamped / frameDur)));
    const frame = frames[frameIdx];

    // Find current section
    const sections = this.analysis.sections;
    let secIdx = 0;
    for (let i = 0; i < sections.length; i++) {
      if (timeClamped >= sections[i].start && timeClamped <= sections[i].end) {
        secIdx = i;
        break;
      }
    }
    const currentSection: AnalysisSection = sections[secIdx] || {
      index: 0,
      start: 0,
      end: duration,
      duration: duration,
      intensity: 0.5,
      rhythmicDensity: 0.5,
      brightness: 0.5,
      theme: 'FLOW'
    };

    const sectionDuration = Math.max(0.1, currentSection.end - currentSection.start);
    const sectionProgress = Math.max(0, Math.min(1, (timeClamped - currentSection.start) / sectionDuration));

    // 1. Process Envelopes with Attack & Release
    // Sub-bass & Bass: fast attack, slow decay (heavy atmospheric pressure)
    const rawBass = frame.bass;
    const subBassTarget = rawBass * 1.1;
    this.smoothSubBass = this.applyEnvelope(this.smoothSubBass, subBassTarget, 0.02, 0.38, dt);
    this.smoothBass = this.applyEnvelope(this.smoothBass, rawBass, 0.02, 0.28, dt);

    // High frequencies: fast attack, fast decay (shimmer)
    this.smoothHigh = this.applyEnvelope(this.smoothHigh, frame.high, 0.01, 0.08, dt);

    // Mids & Low Mids
    this.smoothLowMid = this.applyEnvelope(this.smoothLowMid, frame.lowMid, 0.04, 0.20, dt);
    this.smoothMid = this.applyEnvelope(this.smoothMid, frame.mid, 0.04, 0.20, dt);

    // General Energy: medium attack, medium/slow release (environmental breathing)
    this.smoothEnergy = this.applyEnvelope(this.smoothEnergy, frame.rms, 0.12, 0.45, dt);

    // Flux & Brightness
    this.smoothFlux = this.applyEnvelope(this.smoothFlux, frame.flux, 0.015, 0.12, dt);
    this.smoothBrightness = this.applyEnvelope(this.smoothBrightness, frame.centroid, 0.08, 0.25, dt);

    // Onset pulse: check if an onset occurred recently
    let rawOnset = 0;
    const onsets = this.analysis.onsets;
    for (let i = 0; i < onsets.length; i++) {
      const o = onsets[i];
      if (Math.abs(o.time - timeClamped) < 0.025) {
        rawOnset = Math.max(rawOnset, o.strength);
      }
    }
    this.smoothOnsetPulse = this.applyEnvelope(this.smoothOnsetPulse, rawOnset, 0.01, 0.15, dt);

    // 2. Buildup & Drop Detection
    // Buildup tension
    if (currentSection.theme === 'BUILDUP') {
      this.smoothBuildup = Math.min(1, this.smoothBuildup + dt * 0.45);
    } else {
      this.smoothBuildup = Math.max(0, this.smoothBuildup - dt * 0.8);
    }

    // Drop Trigger
    if (currentSection.theme === 'DROP' && !this.triggeredDrops.has(currentSection.index)) {
      this.triggeredDrops.add(currentSection.index);
      this.dropImpactEnvelope = 1.0;
    }
    // Drop decay: ~1.5s exponential decay
    this.dropImpactEnvelope = Math.max(0, this.dropImpactEnvelope - dt * 0.65);

    // 3. Section Color Evolution Interpolation (2 - 8s target interpolation)
    let targetPri = 0.5;
    let targetSec = 0.25;
    let targetHi = 0.1;

    switch (currentSection.theme) {
      case 'BREATH':
        targetPri = 0.25;
        targetSec = 0.45;
        targetHi = 0.08;
        break;
      case 'BUILDUP':
        targetPri = 0.4;
        targetSec = 0.4;
        targetHi = 0.25 + 0.35 * sectionProgress;
        break;
      case 'DROP':
        targetPri = 0.8;
        targetSec = 0.15;
        targetHi = 0.45;
        break;
      case 'SPEED':
        targetPri = 0.7;
        targetSec = 0.2;
        targetHi = 0.35;
        break;
      case 'SURF':
        targetPri = 0.4;
        targetSec = 0.55;
        targetHi = 0.2;
        break;
      case 'PRECISION':
        targetPri = 0.35;
        targetSec = 0.45;
        targetHi = 0.3;
        break;
      case 'ASCENT':
        targetPri = 0.45;
        targetSec = 0.35;
        targetHi = 0.2;
        break;
      case 'DESCENT':
        targetPri = 0.5;
        targetSec = 0.3;
        targetHi = 0.15;
        break;
      case 'FLOW':
      default:
        targetPri = 0.55;
        targetSec = 0.25;
        targetHi = 0.12;
        break;
    }

    this.smoothPrimaryMix = this.applyEnvelope(this.smoothPrimaryMix, targetPri, 2.5, 3.5, dt);
    this.smoothSecondaryMix = this.applyEnvelope(this.smoothSecondaryMix, targetSec, 2.5, 3.5, dt);
    this.smoothHighlightMix = this.applyEnvelope(this.smoothHighlightMix, targetHi, 1.5, 2.5, dt);

    // 4. Multi-Anchor Frequency Color Derivations
    const pal = this.state.palette;
    const reactMult = this.reactivityMultiplier;

    // Bass color: dark surface modulated toward bassTint/primary by sub-bass
    this.state.bassColor.copy(pal.surface).lerp(
      pal.bassTint || pal.primary,
      Math.min(1.0, this.smoothSubBass * 0.9 * reactMult)
    );

    // Mid color: surface modulated toward secondary
    this.state.midColor.copy(pal.surface).lerp(
      pal.secondary,
      Math.min(1.0, this.smoothMid * 0.85 * reactMult)
    );

    // High color: surface modulated toward highlight/highTint
    this.state.highColor.copy(pal.surface).lerp(
      pal.highTint || pal.highlight,
      Math.min(1.0, (this.smoothHigh * 0.8 + this.smoothFlux * 0.4) * reactMult)
    );

    // Active horizon color: void tinted by bass energy and drop impact
    this.state.activeHorizonColor.copy(pal.void).lerp(
      pal.bassTint || pal.primary,
      Math.min(0.85, (this.smoothSubBass * 0.5 + this.dropImpactEnvelope * 0.7) * reactMult)
    );

    // Active haze color: void tinted by secondary mid energy
    this.state.activeHazeColor.copy(pal.void).lerp(
      pal.secondary,
      Math.min(0.7, (this.smoothEnergy * 0.4 + this.smoothBuildup * 0.3) * reactMult)
    );

    // Route pulse phase: propagates forward along the track
    this.state.routePulsePhase = (this.state.routePulsePhase + dt * (3.0 + this.smoothSubBass * 8.0)) % (Math.PI * 2);

    // Kinetic music intensity: speed combined with audio energy
    const normSpeed = Math.min(2.0, playerSpeed / 600.0);
    this.state.kineticMusicIntensity = normSpeed * this.smoothEnergy * reactMult;

    // 5. Lookahead: Upcoming Energy and Drop Distance
    const lookaheadTime = Math.min(duration, timeClamped + 18.0);
    const lookaheadFrameIdx = Math.min(frames.length - 1, Math.floor(lookaheadTime / frameDur));
    const upcomingEnergy = frames[lookaheadFrameIdx] ? frames[lookaheadFrameIdx].rms : 0.3;

    let nextDropTime = -1;
    for (let i = secIdx; i < sections.length; i++) {
      if (sections[i].theme === 'DROP') {
        nextDropTime = sections[i].start;
        break;
      }
    }

    let upcomingDropDistance = 9999;
    if (nextDropTime >= 0 && this.track && this.track.totalDistance > 0) {
      const dropProgress = nextDropTime / duration;
      const dropWorldDist = dropProgress * this.track.totalDistance;
      upcomingDropDistance = Math.max(0, dropWorldDist - playerRouteProgress);
    }

    // Reference timeline progress
    const timelineProgress = duration > 0 ? timeClamped / duration : 0;
    const playerNormalizedProgress = (this.track && this.track.totalDistance > 0)
      ? Math.max(0, Math.min(1, playerRouteProgress / this.track.totalDistance))
      : 0;

    const syncDelta = (playerNormalizedProgress - timelineProgress) * duration;

    // 6. Commit to State
    this.state.time = timeClamped;
    this.state.progress = timelineProgress;
    this.state.playerProgress = playerNormalizedProgress;
    this.state.syncDelta = syncDelta;

    this.state.energy = this.smoothEnergy;
    this.state.subBass = Math.min(1, this.smoothSubBass);
    this.state.bass = Math.min(1, this.smoothBass);
    this.state.lowMid = Math.min(1, this.smoothLowMid);
    this.state.mid = Math.min(1, this.smoothMid);
    this.state.high = Math.min(1, this.smoothHigh);

    this.state.brightness = this.smoothBrightness;
    this.state.flux = this.smoothFlux;
    this.state.onsetPulse = this.smoothOnsetPulse;

    this.state.sectionIndex = currentSection.index;
    this.state.sectionTheme = currentSection.theme;
    this.state.sectionIntensity = currentSection.intensity;
    this.state.sectionProgress = sectionProgress;

    this.state.buildup = this.smoothBuildup;
    this.state.dropImpact = this.dropImpactEnvelope;

    this.state.upcomingEnergy = upcomingEnergy;
    this.state.upcomingDropDistance = upcomingDropDistance;
    this.state.nextDropTime = nextDropTime;

    this.state.primaryMix = this.smoothPrimaryMix;
    this.state.secondaryMix = this.smoothSecondaryMix;
    this.state.highlightMix = this.smoothHighlightMix;
    this.state.reactivityMultiplier = this.reactivityMultiplier;

    this.lastTime = songTime;
  }

  public setReactivityMultiplier(mult: number): void {
    this.reactivityMultiplier = Math.max(0.1, Math.min(3.0, mult));
    this.state.reactivityMultiplier = this.reactivityMultiplier;
  }

  private applyEnvelope(current: number, target: number, attackTime: number, decayTime: number, dt: number): number {
    const isAttacking = target > current;
    const rate = isAttacking
      ? Math.min(1, dt / Math.max(1e-4, attackTime))
      : Math.min(1, dt / Math.max(1e-4, decayTime));
    return current + (target - current) * rate;
  }
}
