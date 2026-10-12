/**
 * ENVIRONMENT THEMES — the small contract a non-city environment implements.
 *
 * The city (skyline, spectral canyons, megastructure, signage...) is the
 * DEFAULT and is not expressed as a theme: a track with no theme assigned keeps
 * the existing world exactly. A theme REPLACES the city decoration stack and the
 * procedural sky for the tracks it is assigned to, and nothing else.
 *
 * A theme is PRESENTATION ONLY. It never receives a way to change the route,
 * colliders, checkpoints, physics or scoring, and it is not an input to the map
 * fingerprint, replay identity or multiplayer course identity. Everything it
 * places is registered as DECORATION and audited by the same final
 * WorldGeometrySafetyPass as the city, against the same RouteExclusionCorridor.
 */

import * as THREE from 'three';
import { TrackAnalysis } from '../../audio/AudioFeatures';
import { TrackPalette } from '../../audio/TrackPalettes';
import { GeneratedTrack } from '../../generation/GenerationTypes';
import { QualityPreset } from '../../rendering/QualityPresets';
import { MusicVisualState } from '../MusicVisualController';
import { RouteExclusionCorridor } from '../RouteExclusionCorridor';

export type EnvironmentThemeId = 'MIDNIGHT_MOUNTAINS' | 'ORBITAL_STATION' | 'MIDNIGHT_HARBOUR' | 'SIGNAL_CITY';

/** Scene lighting a theme asks the Environment for while it is loaded. */
export interface EnvironmentThemeLighting {
  keyColor: number;
  keyIntensity: number;
  /** Camera-relative key light offset (the light travels with the player). */
  keyOffset: THREE.Vector3;
  hemiSkyColor: number;
  hemiGroundColor: number;
  hemiIntensity: number;
}

export interface EnvironmentThemeBuildContext {
  analysis: TrackAnalysis;
  track: GeneratedTrack;
  /** The authoritative protected gameplay region for the loaded track. */
  corridor: RouteExclusionCorridor;
  palette: TrackPalette;
  /** Resolved quality preset, or null outside a rendering context (tests). */
  quality: QualityPreset | null;
}

export interface EnvironmentThemeFrame {
  dt: number;
  songTime: number;
  visualState: MusicVisualState;
  /** Live spectrum bands from the shared visual bus (low -> high). */
  bands: readonly number[];
  playerPos: THREE.Vector3;
  /** Player progress along the route, 0..1 by arc length. */
  routeProgress: number;
  /** Effect-intensity setting for decorative / reactive output (1 = STANDARD). */
  effectScale: number;
  reduceMotion: boolean;
}

export interface EnvironmentThemeInstance {
  readonly id: EnvironmentThemeId;
  /** World-space scenery. Registered as DECORATION and corridor-audited. */
  readonly group: THREE.Group;
  /** Camera-centred backdrop (sky dome). Exempt from the world safety pass. */
  readonly skyGroup: THREE.Group;
  readonly lighting: EnvironmentThemeLighting;
  update(frame: EnvironmentThemeFrame): void;
  dispose(): void;
}

export interface EnvironmentThemeDefinition {
  readonly id: EnvironmentThemeId;
  readonly displayName: string;
  /** Fresh palette for the route materials, fog and shared colour bus. */
  createPalette(): TrackPalette;
  build(context: EnvironmentThemeBuildContext): EnvironmentThemeInstance;
}
