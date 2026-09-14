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
}

export class SongDirector {
  public state: SongDirectorState;
  public spectaclePlanner: SpectaclePlanner;

  private smoothIntensity = 0.2;
  private smoothStarVis = 0.3;
  private smoothFogNear = 45;
  private smoothFogFar = 380;
  private smoothBloom = 0.4;
  private smoothVignette = 0.35;

  constructor() {
    this.spectaclePlanner = new SpectaclePlanner();
    this.state = {
      phase: 'INTRO',
      dramaticIntensity: 0.2,
      starVisibility: 0.3,
      fogNear: 45,
      fogFar: 380,
      bloomStrength: 0.4,
      vignetteIntensity: 0.35,
      spectralReactivity: 0.6,
      activeSpectacle: null,
      isSignatureActive: false
    };
  }

  public init(analysis: TrackAnalysis, track: GeneratedTrack): void {
    this.spectaclePlanner.plan(analysis, track);
    this.smoothIntensity = 0.15;
    this.smoothStarVis = 0.2;
    this.smoothFogNear = 35;
    this.smoothFogFar = 320;
    this.smoothBloom = 0.35;
    this.smoothVignette = 0.35;
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

    // 3. Compute Target Dramatic Intensity & Art Profiles based on Phase
    let targetIntensity = 0.25;
    let targetStarVis = 0.4;
    let targetFogNear = 45;
    let targetFogFar = 380;
    let targetBloom = 0.45;
    let targetVignette = 0.35;
    let spectralReactivity = 0.7;

    switch (currentPhase) {
      case 'INTRO':
        targetIntensity = 0.15 + visualState.energy * 0.1;
        targetStarVis = 0.25; // Subtle emergence
        targetFogNear = 35;
        targetFogFar = 300;   // Restrained horizon
        targetBloom = 0.35;
        targetVignette = 0.4;
        spectralReactivity = 0.5; // Restrained
        break;

      case 'TRAVEL':
        targetIntensity = 0.35 + visualState.energy * 0.25;
        targetStarVis = 0.5;
        targetFogNear = 45;
        targetFogFar = 400;
        targetBloom = 0.45;
        targetVignette = 0.35;
        spectralReactivity = 0.75;
        break;

      case 'BUILDUP':
        targetIntensity = 0.65 + visualState.buildup * 0.35;
        targetStarVis = 0.2; // Dims as tension builds
        targetFogNear = 25;  // Fog closes in
        targetFogFar = 220;
        targetBloom = 0.55 + visualState.buildup * 0.25;
        targetVignette = 0.45;
        spectralReactivity = 1.0;
        break;

      case 'DROP':
        targetIntensity = 0.95 + visualState.dropImpact * 0.05;
        targetStarVis = 1.0; // Starfield ignition
        targetFogNear = 65;  // Horizon opens wide
        targetFogFar = 520;
        targetBloom = 0.75 + visualState.dropImpact * 0.25;
        targetVignette = 0.3;
        spectralReactivity = 1.35;
        break;

      case 'SURF':
        targetIntensity = 0.85 + visualState.energy * 0.15;
        targetStarVis = 0.8;
        targetFogNear = 55;
        targetFogFar = 460;
        targetBloom = 0.65;
        targetVignette = 0.4; // Speed focus
        spectralReactivity = 1.2;
        break;

      case 'BREAKDOWN':
        targetIntensity = 0.15 + visualState.energy * 0.1;
        targetStarVis = 0.3;
        targetFogNear = 40;
        targetFogFar = 340;
        targetBloom = 0.3;
        targetVignette = 0.35;
        spectralReactivity = 0.4; // Quiet breathing room
        break;

      case 'CLIMAX':
        targetIntensity = 1.0;
        targetStarVis = 1.0;
        targetFogNear = 70;
        targetFogFar = 550;
        targetBloom = 0.85;
        targetVignette = 0.35;
        spectralReactivity = 1.4;
        break;

      case 'OUTRO':
        targetIntensity = 0.2;
        targetStarVis = 0.7; // Stars remain in quiet resolution
        targetFogNear = 50;
        targetFogFar = 420;
        targetBloom = 0.35;
        targetVignette = 0.35;
        spectralReactivity = 0.5;
        break;
    }

    // Spectacle event overrides
    if (activeSpectacle) {
      if (activeSpectacle.type === 'VOID_REVEAL') {
        targetFogFar = Math.max(targetFogFar, 580);
      } else if (activeSpectacle.type === 'STARFIELD_BLOOM') {
        targetStarVis = 1.0;
        targetBloom = Math.max(targetBloom, 0.8);
      } else if (activeSpectacle.type === 'WORLD_POWER_DOWN') {
        targetIntensity = 0.05;
        targetBloom = 0.15;
        targetStarVis = 0.1;
      }
    }

    // Smooth transitions
    const lerpRate = Math.min(1.0, dt * 4.0);
    this.smoothIntensity += (targetIntensity - this.smoothIntensity) * lerpRate;
    this.smoothStarVis += (targetStarVis - this.smoothStarVis) * lerpRate;
    this.smoothFogNear += (targetFogNear - this.smoothFogNear) * lerpRate;
    this.smoothFogFar += (targetFogFar - this.smoothFogFar) * lerpRate;
    this.smoothBloom += (targetBloom - this.smoothBloom) * lerpRate;
    this.smoothVignette += (targetVignette - this.smoothVignette) * lerpRate;

    this.state = {
      phase: currentPhase,
      dramaticIntensity: this.smoothIntensity,
      starVisibility: this.smoothStarVis,
      fogNear: this.smoothFogNear,
      fogFar: this.smoothFogFar,
      bloomStrength: this.smoothBloom,
      vignetteIntensity: this.smoothVignette,
      spectralReactivity,
      activeSpectacle,
      isSignatureActive
    };

    return this.state;
  }

  private determinePhase(
    _songTime: number,
    visualState: MusicVisualState,
    nearestNode?: RouteNode
  ): ExperiencePhase {
    // If player is surfing, SURF phase takes priority
    if (nearestNode && nearestNode.isSurf) {
      return 'SURF';
    }

    // Song section theme mapping
    const theme = visualState.sectionTheme;
    const progress = visualState.progress;

    if (progress < 0.06 || theme === 'INTRO') {
      return 'INTRO';
    }
    if (progress > 0.94 || theme === 'OUTRO') {
      return 'OUTRO';
    }
    if (theme === 'DROP' || visualState.dropImpact > 0.3) {
      // If late in the song, this drop could be the CLIMAX
      if (progress > 0.7) {
        return 'CLIMAX';
      }
      return 'DROP';
    }
    if (theme === 'BUILDUP' || visualState.buildup > 0.35) {
      return 'BUILDUP';
    }
    if (theme === 'BREATH' || (theme === 'VERSE' && visualState.energy < 0.3)) {
      return 'BREAKDOWN';
    }

    return 'TRAVEL';
  }

  public dispose(): void {
    this.spectaclePlanner.dispose();
  }
}
