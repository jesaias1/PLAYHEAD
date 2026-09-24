/**
 * SongDirector for PLAYHEAD
 * Orchestrates the macro dramatic arc of the entire track.
 * Maps audio analysis into continuous dramatic intensity and distinct experience phases,
 * enforcing contrast and restraint so the world is not constantly hyper-reactive.
 */

import { TrackAnalysis } from '../audio/AudioFeatures';
import { GeneratedTrack, RouteNode } from '../generation/GenerationTypes';
import { MusicVisualState } from './MusicVisualController';
import { SpectaclePlanner, SpectacleEvent } from './SpectaclePlanner';

export type ExperiencePhase =
  | 'INTRO'
  | 'TRAVEL'
  | 'BUILDUP'
  | 'DROP'
  | 'SURF'
  | 'BREAKDOWN'
  | 'CLIMAX'
  | 'OUTRO';

export interface SongDirectorState {
  phase: ExperiencePhase;
  dramaticIntensity: number; // 0.0 to 1.0 continuous curve
  starVisibility: number;    // 0.0 to 1.0 modulates skybox starfield
  fogNear: number;
  fogFar: number;
  bloomStrength: number;
  vignetteIntensity: number;
  spectralReactivity: number;
  activeSpectacle: SpectacleEvent | null;
  isSignatureActive: boolean;
  announcement: string | null;
}

export class SongDirector {
  public state: SongDirectorState;
  public spectaclePlanner: SpectaclePlanner;

  private smoothIntensity = 0.25;
  private smoothStarVis = 0.4;
  private smoothFogNear = 45;
  private smoothFogFar = 380;
  private smoothBloom = 0.26;
  private smoothVignette = 0.35;

  private lastAnnouncedSectionIndex = -1;
  private lastAnnouncedTheme = '';
  public onSectionAnnouncement?: (title: string) => void;

  constructor() {
    this.spectaclePlanner = new SpectaclePlanner();
    this.state = {
      phase: 'INTRO',
      dramaticIntensity: 0.25,
      starVisibility: 0.3,
      fogNear: 45,
      fogFar: 380,
      bloomStrength: 0.26,
      vignetteIntensity: 0.35,
      spectralReactivity: 0.6,
      activeSpectacle: null,
      isSignatureActive: false,
      announcement: null
    };
  }

  public init(analysis: TrackAnalysis, track: GeneratedTrack): void {
    this.spectaclePlanner.plan(analysis, track);
    this.smoothIntensity = 0.2;
    this.smoothStarVis = 0.25;
    this.smoothFogNear = 40;
    this.smoothFogFar = 340;
    this.smoothBloom = 0.22;
    this.smoothVignette = 0.35;
    this.lastAnnouncedSectionIndex = -1;
    this.lastAnnouncedTheme = '';
  }

  public update(
    songTime: number,
    playerArcLength: number,
    dt: number,
    visualState: MusicVisualState,
    nearestNode?: RouteNode
  ): SongDirectorState {
    // 1. Update Spectacle Planner
    const activeSpectacle = this.spectaclePlanner.update(songTime, playerArcLength, dt);
    const isSignatureActive = activeSpectacle ? activeSpectacle.isSignature : false;

    // 2. Determine Experience Phase
    const currentPhase = this.determinePhase(songTime, visualState, nearestNode);

    // Check for Section / Theme changes to trigger temporary HUD title
    let pendingAnnouncement: string | null = null;
    if (
      visualState.sectionIndex !== this.lastAnnouncedSectionIndex ||
      visualState.sectionTheme !== this.lastAnnouncedTheme
    ) {
      this.lastAnnouncedSectionIndex = visualState.sectionIndex;
      this.lastAnnouncedTheme = visualState.sectionTheme;

      const secNum = visualState.sectionIndex + 1;
      const theme = visualState.sectionTheme;

      if (theme === 'DROP') {
        const mins = Math.floor(songTime / 60).toString().padStart(2, '0');
        const secs = Math.floor(songTime % 60).toString().padStart(2, '0');
        pendingAnnouncement = `${mins}:${secs} // THE DROP`;
      } else if (theme === 'BREATH' || theme === 'BREAKDOWN') {
        pendingAnnouncement = `SECTION ${secNum.toString().padStart(2, '0')} // BREATH`;
      } else if (nearestNode && nearestNode.isSurf) {
        pendingAnnouncement = `SECTION ${secNum.toString().padStart(2, '0')} // SURF CANYON`;
      } else {
        pendingAnnouncement = `SECTION ${secNum.toString().padStart(2, '0')} // ${theme}`;
      }

      this.onSectionAnnouncement?.(pendingAnnouncement);
    }

    // 3. Compute Target Dramatic Intensity & Art Profiles based on Phase
    // Calibrated ranges:
    // Quiet: ~0.15 - 0.35
    // Normal: ~0.35 - 0.55
    // Energetic: ~0.55 - 0.75
    // Major: ~0.75 - 0.90
    // Signature: 1.0
    let targetIntensity = 0.4;
    let targetStarVis = 0.45;
    let targetFogNear = 45;
    let targetFogFar = 400;
    let targetBloom = 0.30;
    let targetVignette = 0.35;
    let spectralReactivity = 0.52;

    switch (currentPhase) {
      case 'INTRO':
        // Quiet range: 0.15 - 0.30
        targetIntensity = 0.20 + visualState.energy * 0.10;
        targetStarVis = 0.30;
        targetFogNear = 35;
        targetFogFar = 320;
        targetBloom = 0.20;
        targetVignette = 0.4;
        spectralReactivity = 0.40;
        break;

      case 'TRAVEL':
        // Normal range: 0.35 - 0.55
        targetIntensity = 0.38 + visualState.energy * 0.16;
        targetStarVis = 0.55;
        targetFogNear = 45;
        targetFogFar = 420;
        targetBloom = 0.30;
        targetVignette = 0.35;
        spectralReactivity = 0.60;
        break;

      case 'BUILDUP':
        // Energetic range: 0.55 - 0.75
        targetIntensity = 0.55 + visualState.buildup * 0.20;
        targetStarVis = 0.25; // Dims as tension builds
        targetFogNear = 28;   // Fog draws closer
        targetFogFar = 240;
        targetBloom = 0.42;
        targetVignette = 0.45;
        spectralReactivity = 0.76;

        // Intentional Pre-Drop Tension Dip: in the final breath of buildup, drop intensity sharply
        if (visualState.buildup > 0.82) {
          targetIntensity = 0.22; // Contrast dip
          targetStarVis = 0.15;
          targetFogFar = 190;
        }
        break;

      case 'DROP':
        // Major range: 0.78 - 0.92. Peak deliberately preserved: the whole
        // dynamic-range strategy is to LOWER the floor, not the ceiling.
        targetIntensity = 0.82 + visualState.dropImpact * 0.10;
        targetStarVis = 0.95;
        targetFogNear = 65;
        targetFogFar = 540;   // World bursts open
        targetBloom = 0.72 + visualState.dropImpact * 0.24;
        targetVignette = 0.30;
        spectralReactivity = 1.32;
        break;

      case 'SURF':
        // Major range: 0.75 - 0.88
        targetIntensity = 0.78 + visualState.energy * 0.10;
        targetStarVis = 0.85;
        targetFogNear = 55;
        targetFogFar = 480;
        targetBloom = 0.46;
        targetVignette = 0.40;
        spectralReactivity = 0.92;
        break;

      case 'BREAKDOWN':
        // Quiet range: 0.18 - 0.32
        targetIntensity = 0.20 + visualState.energy * 0.08;
        targetStarVis = 0.35;
        targetFogNear = 42;
        targetFogFar = 360;
        targetBloom = 0.18;
        targetVignette = 0.35;
        // Breakdown still breathes musically — never a dead stretch.
        spectralReactivity = 0.42;
        break;

      case 'CLIMAX':
        // Peak intensity: 0.90 - 1.0
        targetIntensity = 0.95;
        targetStarVis = 1.0;
        targetFogNear = 75;
        targetFogFar = 580;
        targetBloom = 0.80;
        targetVignette = 0.32;
        spectralReactivity = 1.42;
        break;

      case 'OUTRO':
        // Resolution: 0.20 - 0.30
        targetIntensity = 0.22;
        targetStarVis = 0.70; // Calmed stars remain
        targetFogNear = 48;
        targetFogFar = 420;
        targetBloom = 0.20;
        targetVignette = 0.35;
        spectralReactivity = 0.42;
        break;
    }

    // 4. Spectacle Event Overrides & Signature Moment
    if (activeSpectacle) {
      if (isSignatureActive) {
        targetIntensity = 1.0; // Peak signature moment
        targetBloom = Math.max(targetBloom, 0.92);
        targetStarVis = 1.0;
      }

      switch (activeSpectacle.type) {
        case 'VOID_REVEAL':
          targetFogFar = Math.max(targetFogFar, 640);
          targetStarVis = 1.0;
          break;
        case 'STARFIELD_BLOOM':
          targetStarVis = 1.0;
          targetBloom = Math.max(targetBloom, 0.70);
          break;
        case 'WORLD_POWER_DOWN':
          targetIntensity = 0.12;
          targetBloom = 0.12;
          targetStarVis = 0.15;
          targetFogNear = 25;
          targetFogFar = 220;
          break;
        case 'MONOLITH_SPLIT':
          targetFogNear = Math.max(targetFogNear, 60);
          targetFogFar = Math.max(targetFogFar, 500);
          break;
        case 'SURF_CANYON_RELEASE':
          targetIntensity = Math.max(targetIntensity, 0.85);
          targetVignette = 0.45;
          break;
        case 'CATHEDRAL_IGNITION':
          targetBloom = Math.max(targetBloom, 0.56);
          break;
      }
    }

    // Smooth transitions.
    //
    // ASYMMETRIC envelope: rise at the musical rate, fall noticeably faster.
    // This is what buys dynamic range WITHOUT raising peaks — a drop still hits
    // the same ceiling, but the world drops back to the quiet baseline quickly
    // instead of sitting near the top of the range afterwards.
    const attack = Math.min(1.0, dt * 4.0);
    const release = Math.min(1.0, dt * 7.5);
    const approach = (current: number, target: number): number =>
      current + (target - current) * (target < current ? release : attack);
    // Fog keeps the symmetric rate: it is a spatial cue, and asymmetric fog
    // would read as the level breathing rather than the music.
    const fogRate = attack;

    this.smoothIntensity = approach(this.smoothIntensity, targetIntensity);
    this.smoothStarVis = approach(this.smoothStarVis, targetStarVis);
    this.smoothFogNear += (targetFogNear - this.smoothFogNear) * fogRate;
    this.smoothFogFar += (targetFogFar - this.smoothFogFar) * fogRate;
    this.smoothBloom = approach(this.smoothBloom, targetBloom);
    this.smoothVignette = approach(this.smoothVignette, targetVignette);

    this.state = {
      phase: currentPhase,
      dramaticIntensity: this.smoothIntensity,
      starVisibility: this.smoothStarVis,
      fogNear: this.smoothFogNear,
      fogFar: this.smoothFogFar,
      bloomStrength: this.smoothBloom,
      vignetteIntensity: this.smoothVignette,
      // Floor the reactivity multiplier so the world always sustains a musical
      // baseline. The floor is deliberately LOW: "always alive" must not mean
      // "always at 80%", because a drop then has nowhere to go. Quiet sections
      // sit clearly dimmer than dense ones, and the drop range is preserved.
      spectralReactivity: Math.max(0.34, spectralReactivity),
      activeSpectacle,
      isSignatureActive,
      announcement: pendingAnnouncement
    };

    return this.state;
  }

  private determinePhase(
    _songTime: number,
    visualState: MusicVisualState,
    nearestNode?: RouteNode
  ): ExperiencePhase {
    if (nearestNode && nearestNode.isSurf) {
      return 'SURF';
    }

    const theme = visualState.sectionTheme;
    const progress = visualState.progress;

    if (progress < 0.06 || theme === 'INTRO') {
      return 'INTRO';
    }
    if (progress > 0.94 || theme === 'OUTRO') {
      return 'OUTRO';
    }
    if (theme === 'DROP' || visualState.dropImpact > 0.3) {
      if (progress > 0.68) {
        return 'CLIMAX';
      }
      return 'DROP';
    }
    if (theme === 'BUILDUP' || visualState.buildup > 0.35) {
      return 'BUILDUP';
    }
    if (theme === 'BREATH' || (theme === 'VERSE' && visualState.energy < 0.32)) {
      return 'BREAKDOWN';
    }

    return 'TRAVEL';
  }

  public dispose(): void {
    this.spectaclePlanner.dispose();
  }
}
