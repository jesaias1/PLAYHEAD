/**
 * SignalWorldProfile — DATA-DRIVEN OFFICIAL VISUAL WORLD PROFILES.
 *
 * GENERALIZE THE TECHNOLOGY, NOT THE ARTWORK.
 *
 * This is the single authored description of how each of the 14 official Signal
 * Pack tracks presents its world. It is intentionally a COMPACT, tunable data
 * table plus a pure resolver; it owns no rendering code. Consumers read the
 * resolved profile and adapt their own existing systems:
 *
 *   World.loadTrack          -> resolves the profile for the loaded track
 *   SkylineArchitecture      -> architecture family / proportions / spacing / signage density
 *   SignalLandmarks          -> hero motivation + celestial rarity
 *   CelestialLandmarks       -> cloud / spectacle / star character
 *   Megastructure            -> abyss, openness, verticality
 *   Environment / ProceduralSky -> atmosphere + sky + star tint
 *   MusicVisualController    -> section/drop response bounds + reaction emphasis
 *   GeometryBuilder          -> route material family
 *
 * IDENTITY IS NOT COLOUR. Colour lives in the existing TrackPalette; the
 * profile carries character (composition, density, scale, celestial, material,
 * signage) so a grayscale screenshot still reads as a distinct world.
 *
 * RESOLUTION IS DETERMINISTIC AND SAFE:
 *   - Official tracks resolve from a trusted catalog id ONLY (the id arrives
 *     from SignalPackCatalog, never from an arbitrary uploaded filename).
 *   - Unknown / custom audio / tutorial / lab fall back to `fallbackProfile`.
 *   - Signal Drift is the baseline reference: `resolveForTrackId` returns the
 *     frozen `SIGNAL_DRIFT_PROFILE`, which declares `usesOverride: false` so
 *     consumers keep their exact current rendering for that track.
 */

import { SignalPackTrack } from '../audio/SignalPackCatalog';

export type ArchitectureFamily =
  | 'MONOLITHIC'
  | 'FRAMEWORK'
  | 'RUINED'
  | 'STACKED'
  | 'CANYON'
  | 'SPIRE'
  | 'MACHINE'
  | 'FLOATING'
  | 'FRACTURED'
  | 'MEGACITY';

export type RouteMaterialFamily =
  | 'FRACTURED_SLAB'
  | 'POLISHED_SIGNAL_STONE'
  | 'INDUSTRIAL_PLATE'
  | 'COLD_GLASS'
  | 'NEAR_BLACK_CERAMIC'
  | 'WEATHERED_BRUTALIST';

export type CelestialMotif =
  | 'NONE'
  | 'MOON'
  | 'ECLIPSE'
  | 'HALO'
  | 'NEBULA'
  | 'GALAXY_BAND'
  | 'DISTANT_LIGHT_FIELD';

export type SignageDensity = 'NONE' | 'SPARSE' | 'MODERATE' | 'DENSE';

export type HeroMotif =
  | 'ORBITAL_RING'
  | 'SUSPENDED_FRAME'
  | 'SIGNAL_WALL'
  | 'ENERGY_CHASM'
  | 'IMPOSSIBLE_TOWER'
  | 'HANGING_ARCHITECTURE'
  | 'FRACTURED_ARCHIPELAGO'
  | 'CELESTIAL_ASCENT'
  | 'INVERTED_SKYLINE'
  | 'MACHINE_SPINE'
  | 'MONOLITH_FIELD';

/** Bounded, smoothed music response. Consumers may only scale WITHIN these. */
export interface SectionReaction {
  /** Elements this track lets respond to the music (never "everything"). */
  emphasis: Array<'SKYLINE' | 'SIGNAGE' | 'HERO' | 'SKY' | 'ATMOSPHERE'>;
  /** [min,max] multiplier applied to a reacting subsystem's driving scalar. */
  gainMin: number;
  gainMax: number;
  /** Section themes that are allowed to push to gainMax. */
  curatedThemes: string[];
  /** Slow smoothing constant (seconds) for bounded, non-jittery change. */
  smoothingSeconds: number;
  /** Maximum simultaneous reaction families (restraint: not all at once). */
  maxSimultaneous: number;
}

/**
 * Authored macro-composition zones, expressed in ARC-LENGTH fraction of the
 * route (0 = start, 1 = finish). This is what turns procedurally placed
 * scenery into an art-directed journey instead of uniform noise:
 *
 *   lateStart / lateEnd    an EMPTY zone — silent negative space (restraint)
 *   denseStart / denseEnd  a DENSE zone — monumental concentration
 *   revealArc              a single prepared REVEAL moment (hero/frame opening)
 *   finishFunnel           where the skyline closes into a structural funnel
 *                          that frames the finish approach
 *
 * Every band is OPTIONAL. When absent (Signal Drift / fallback, or a track that
 * chooses not to use it) the resolver returns the inert defaults, so the
 * reference composition is untouched. Bands only ever THIN or SHIFT existing
 * instances; they never add geometry, materials or draw calls.
 */
export interface CompositionBand {
  lateStart: number;
  lateEnd: number;
  denseStart: number;
  denseEnd: number;
  revealArc: number | null;
  finishFunnel: number | null;
}

export interface OfficialWorldProfile {
  /** Trusted catalog id, or 'FALLBACK' for custom/tutorial/lab. */
  trackId: string;
  displayName: string;

  /** False for Signal Drift (baseline) and the fallback: consumers keep their existing output. */
  usesOverride: boolean;

  architecture: {
    primary: ArchitectureFamily;
    secondary: ArchitectureFamily;
    /** 0 = sparse monumental isolation, 1 = dense canyon of structures. */
    density: number;
    /** Typical tower height multiplier vs the base silhouette. */
    proportionScale: number;
    /** 0 = heavy solid mass, 1 = tall slender frames. */
    slenderness: number;
    /** Relative frequency of silhouette cutouts / negative-space voids. */
    cutoutFrequency: number;
    /** Spacing multiplier (larger = more open negative space). */
    spacingScale: number;
    /** Support-structure language: 0 = ground pylons, 1 = floating. */
    floating: number;
  };

  space: {
    openness: number;      // 0 = enclosed, 1 = vast horizon
    verticality: number;   // 0 = flat, 1 = towering ascent
    abyssVisibility: number;
    distantDistribution: number;
  };

  sky: {
    starDensity: number;   // 0..1 multiplier
    starTint: string;      // hex, subtle tint of the starfield highlight
    celestial: CelestialMotif;
    hazeStrength: number;  // 0..1 fog/haze weight
    backgroundTint: string;// subtle background/horizon shift
  };

  material: {
    route: RouteMaterialFamily;
    /** Structure surface treatment descriptor (read by tower shaders). */
    structureTone: 'BASALT' | 'CONCRETE' | 'GLASS' | 'RUSTED' | 'CERAMIC';
    emission: number;      // 0..1 base emissive character
    surfaceBreakup: number;// 0..1 breakup/roughness character
  };

  signage: {
    density: SignageDensity;
    /** 0..1 density multiplier applied to authored sign counts. */
    amountScale: number;
    /** 0 = minimal terminology, 1 = heavy signal-wording. */
    terminology: number;
    mascotUsage: number;
  };

  celestialRarity: {
    /** Probability-like weight 0..1 that the rare celestial motif is present. */
    presence: number;
    /** True when this track is allowed the rare/expensive motif at all. */
    allowRare: boolean;
  };

  hero: {
    motif: HeroMotif;
    /** Authored hero scale multiplier. */
    scale: number;
    /** Whether the hero is the dominant composition element. */
    dominant: boolean;
  };

  /**
   * Authored macro-composition zones (arc-length fractions). Optional: absent
   * means inert. Signal Drift / fallback never declare bands.
   */
  composition?: CompositionBand;

  reaction: SectionReaction;
}

const REACTION_DEFAULT: SectionReaction = {
  emphasis: ['SKYLINE', 'SIGNAGE'],
  gainMin: 0.85,
  gainMax: 1.35,
  curatedThemes: ['DROP', 'BUILDUP'],
  smoothingSeconds: 2.0,
  maxSimultaneous: 2
};

/** Fallback for custom audio, tutorial, lab, and any unknown id. */
export const FALLBACK_WORLD_PROFILE: OfficialWorldProfile = {
  trackId: 'FALLBACK',
  displayName: 'CUSTOM SIGNAL',
  usesOverride: false,
  architecture: {
    primary: 'MONOLITHIC',
    secondary: 'FRACTURED',
    density: 0.5,
    proportionScale: 1.0,
    slenderness: 0.4,
    cutoutFrequency: 0.5,
    spacingScale: 1.0,
    floating: 0.25
  },
  space: { openness: 0.5, verticality: 0.5, abyssVisibility: 0.6, distantDistribution: 0.5 },
  sky: { starDensity: 0.55, starTint: '#c4b5fd', celestial: 'MOON', hazeStrength: 0.5, backgroundTint: '#0b1329' },
  material: { route: 'WEATHERED_BRUTALIST', structureTone: 'CONCRETE', emission: 0.4, surfaceBreakup: 0.5 },
  signage: { density: 'MODERATE', amountScale: 1.0, terminology: 0.5, mascotUsage: 0.4 },
  celestialRarity: { presence: 0.5, allowRare: true },
  hero: { motif: 'ORBITAL_RING', scale: 1.0, dominant: false },
  reaction: { ...REACTION_DEFAULT }
};

/**
 * SIGNAL DRIFT — THE BASELINE.
 * usesOverride=false: every consumer keeps its exact current rendering, so the
 * reference vertical slice is preserved byte-for-byte in composition/material/
 * music output. The values recorded here document the current defaults only.
 */
export const SIGNAL_DRIFT_PROFILE: OfficialWorldProfile = {
  trackId: 'track_1_signal_drift',
  displayName: 'SIGNAL DRIFT',
  usesOverride: false,
  architecture: {
    primary: 'MONOLITHIC',
    secondary: 'FLOATING',
    density: 0.42,
    proportionScale: 1.0,
    slenderness: 0.45,
    cutoutFrequency: 0.55,
    spacingScale: 1.0,
    floating: 0.3
  },
  space: { openness: 0.72, verticality: 0.45, abyssVisibility: 0.6, distantDistribution: 0.5 },
  sky: { starDensity: 0.6, starTint: '#7ee7f8', celestial: 'MOON', hazeStrength: 0.5, backgroundTint: '#0b1329' },
  material: { route: 'FRACTURED_SLAB', structureTone: 'BASALT', emission: 0.35, surfaceBreakup: 0.5 },
  signage: { density: 'MODERATE', amountScale: 1.0, terminology: 0.5, mascotUsage: 0.5 },
  celestialRarity: { presence: 0.6, allowRare: true },
  hero: { motif: 'ORBITAL_RING', scale: 1.0, dominant: false },
  reaction: { ...REACTION_DEFAULT }
};

/**
 * THE 14 AUTHORED PROFILES. Keyed by the ACTUAL stable catalog ids produced by
 * SignalPackCatalog (track_<n>_<slug>). Each is an authored combination derived
 * from the real catalog metadata and the precomputed analysis (BPM, energy,
 * sections, spectral/route/surf character) — never a seed-random palette swap.
 *
 * Design notes per track are inline. SIGNAL DRIFT intentionally points at the
 * baseline reference above.
 */
const TRACK_PROFILES: OfficialWorldProfile[] = [
  SIGNAL_DRIFT_PROFILE,

  // 02 FLOW STATE — chilled long-flow intro; calm, readable, wide breathing room.
  {
    trackId: 'track_2_flow_state',
    displayName: 'FLOW STATE',
    usesOverride: true,
    architecture: {
      primary: 'FLOATING',
      secondary: 'MONOLITHIC',
      density: 0.3,
      proportionScale: 0.9,
      slenderness: 0.35,
      cutoutFrequency: 0.35,
      spacingScale: 1.5,
      floating: 0.7
    },
    space: { openness: 0.88, verticality: 0.25, abyssVisibility: 0.75, distantDistribution: 0.3 },
    sky: { starDensity: 0.7, starTint: '#c084fc', celestial: 'DISTANT_LIGHT_FIELD', hazeStrength: 0.4, backgroundTint: '#0c1a2a' },
    material: { route: 'POLISHED_SIGNAL_STONE', structureTone: 'CONCRETE', emission: 0.3, surfaceBreakup: 0.3 },
    signage: { density: 'SPARSE', amountScale: 0.55, terminology: 0.3, mascotUsage: 0.2 },
    celestialRarity: { presence: 0.35, allowRare: true },
    hero: { motif: 'FRACTURED_ARCHIPELAGO', scale: 0.9, dominant: false },
    composition: { lateStart: 0.3, lateEnd: 0.45, denseStart: 0.55, denseEnd: 0.72, revealArc: 0.8, finishFunnel: 0.9 },
    reaction: { emphasis: ['SKYLINE', 'HERO'], gainMin: 0.85, gainMax: 1.2, curatedThemes: ['ASCENT', 'PRECISION'], smoothingSeconds: 2.6, maxSimultaneous: 2 }
  },

  // 03 SURF THE VOID — dream-surf over abysses; suspended frames, deep voids.
  {
    trackId: 'track_3_surf_the_void',
    displayName: 'SURF THE VOID',
    usesOverride: true,
    architecture: {
      primary: 'FRAMEWORK',
      secondary: 'FLOATING',
      density: 0.4,
      proportionScale: 1.15,
      slenderness: 0.7,
      cutoutFrequency: 0.5,
      spacingScale: 1.2,
      floating: 0.8
    },
    space: { openness: 0.8, verticality: 0.4, abyssVisibility: 0.95, distantDistribution: 0.55 },
    sky: { starDensity: 0.55, starTint: '#38bdf8', celestial: 'HALO', hazeStrength: 0.45, backgroundTint: '#0a1a2e' },
    material: { route: 'COLD_GLASS', structureTone: 'GLASS', emission: 0.45, surfaceBreakup: 0.35 },
    signage: { density: 'SPARSE', amountScale: 0.6, terminology: 0.35, mascotUsage: 0.25 },
    celestialRarity: { presence: 0.4, allowRare: true },
    hero: { motif: 'SUSPENDED_FRAME', scale: 1.25, dominant: true },
    composition: { lateStart: 0.07, lateEnd: 0.16, denseStart: 0.28, denseEnd: 0.46, revealArc: 0.62, finishFunnel: 0.88 },
    reaction: { emphasis: ['HERO', 'SKY'], gainMin: 0.9, gainMax: 1.3, curatedThemes: ['SURF', 'PRECISION'], smoothingSeconds: 2.2, maxSimultaneous: 2 }
  },

  // 04 AIRWAVE THEORY — atmospheric air-strafe; broad tiered public plazas, airy.
  {
    trackId: 'track_4_airwave_theory',
    displayName: 'AIRWAVE THEORY',
    usesOverride: true,
    architecture: {
      primary: 'STACKED',
      secondary: 'MONOLITHIC',
      density: 0.45,
      proportionScale: 1.0,
      slenderness: 0.4,
      cutoutFrequency: 0.45,
      spacingScale: 1.35,
      floating: 0.35
    },
    space: { openness: 0.78, verticality: 0.55, abyssVisibility: 0.5, distantDistribution: 0.5 },
    sky: { starDensity: 0.5, starTint: '#94a3b8', celestial: 'GALAXY_BAND', hazeStrength: 0.55, backgroundTint: '#0c1420' },
    material: { route: 'INDUSTRIAL_PLATE', structureTone: 'CONCRETE', emission: 0.4, surfaceBreakup: 0.45 },
    signage: { density: 'MODERATE', amountScale: 0.9, terminology: 0.5, mascotUsage: 0.4 },
    celestialRarity: { presence: 0.55, allowRare: true },
    hero: { motif: 'IMPOSSIBLE_TOWER', scale: 1.0, dominant: false },
    composition: { lateStart: 0.28, lateEnd: 0.4, denseStart: 0.55, denseEnd: 0.74, revealArc: 0.8, finishFunnel: 0.92 },
    reaction: { emphasis: ['SKYLINE', 'SIGNAGE'], gainMin: 0.85, gainMax: 1.25, curatedThemes: ['ASCENT', 'PRECISION'], smoothingSeconds: 2.2, maxSimultaneous: 2 }
  },

  // 05 GRAVITY LINE — synthesiser bhop through arch monuments; ordered processional.
  {
    trackId: 'track_5_gravity_line',
    displayName: 'GRAVITY LINE',
    usesOverride: true,
    architecture: {
      primary: 'MONOLITHIC',
      secondary: 'STACKED',
      density: 0.5,
      proportionScale: 1.1,
      slenderness: 0.5,
      cutoutFrequency: 0.6,
      spacingScale: 1.05,
      floating: 0.2
    },
    space: { openness: 0.6, verticality: 0.55, abyssVisibility: 0.5, distantDistribution: 0.5 },
    sky: { starDensity: 0.5, starTint: '#ffd28a', celestial: 'MOON', hazeStrength: 0.55, backgroundTint: '#141026' },
    material: { route: 'INDUSTRIAL_PLATE', structureTone: 'BASALT', emission: 0.4, surfaceBreakup: 0.5 },
    signage: { density: 'MODERATE', amountScale: 1.0, terminology: 0.55, mascotUsage: 0.5 },
    celestialRarity: { presence: 0.5, allowRare: true },
    hero: { motif: 'MONOLITH_FIELD', scale: 1.05, dominant: false },
    composition: { lateStart: 0.4, lateEnd: 0.52, denseStart: 0.6, denseEnd: 0.8, revealArc: 0.86, finishFunnel: 0.94 },
    reaction: { emphasis: ['SKYLINE', 'SIGNAGE', 'HERO'], gainMin: 0.85, gainMax: 1.3, curatedThemes: ['SPEED', 'ASCENT'], smoothingSeconds: 2.0, maxSimultaneous: 3 }
  },

  // 06 OVER THE EDGE — hardwave drift; aggressive drops, ruined collapsing edges.
  {
    trackId: 'track_6_over_the_edge',
    displayName: 'OVER THE EDGE',
    usesOverride: true,
    architecture: {
      primary: 'RUINED',
      secondary: 'FRACTURED',
      density: 0.55,
      proportionScale: 1.05,
      slenderness: 0.4,
      cutoutFrequency: 0.75,
      spacingScale: 1.0,
      floating: 0.4
    },
    space: { openness: 0.55, verticality: 0.45, abyssVisibility: 0.7, distantDistribution: 0.6 },
    sky: { starDensity: 0.4, starTint: '#fda4af', celestial: 'ECLIPSE', hazeStrength: 0.6, backgroundTint: '#1c0c14' },
    material: { route: 'FRACTURED_SLAB', structureTone: 'RUSTED', emission: 0.5, surfaceBreakup: 0.75 },
    signage: { density: 'MODERATE', amountScale: 1.1, terminology: 0.6, mascotUsage: 0.5 },
    celestialRarity: { presence: 0.5, allowRare: true },
    hero: { motif: 'FRACTURED_ARCHIPELAGO', scale: 1.1, dominant: false },
    composition: { lateStart: 0.42, lateEnd: 0.55, denseStart: 0.22, denseEnd: 0.4, revealArc: 0.8, finishFunnel: 0.9 },
    reaction: { emphasis: ['SKYLINE', 'SIGNAGE'], gainMin: 0.9, gainMax: 1.4, curatedThemes: ['SURF', 'PRECISION'], smoothingSeconds: 1.8, maxSimultaneous: 3 }
  },

  // 07 DROP ZONE SURFER — breakbeat kinetic; surf inclines + fast chaining, energetic.
  {
    trackId: 'track_7_drop_zone_surfer',
    displayName: 'DROP ZONE SURFER',
    usesOverride: true,
    architecture: {
      primary: 'CANYON',
      secondary: 'FRAMEWORK',
      density: 0.7,
      proportionScale: 1.2,
      slenderness: 0.6,
      cutoutFrequency: 0.5,
      spacingScale: 0.85,
      floating: 0.3
    },
    space: { openness: 0.45, verticality: 0.65, abyssVisibility: 0.6, distantDistribution: 0.65 },
    sky: { starDensity: 0.45, starTint: '#c084fc', celestial: 'NEBULA', hazeStrength: 0.6, backgroundTint: '#130f1b' },
    material: { route: 'POLISHED_SIGNAL_STONE', structureTone: 'BASALT', emission: 0.55, surfaceBreakup: 0.5 },
    signage: { density: 'DENSE', amountScale: 1.35, terminology: 0.7, mascotUsage: 0.6 },
    celestialRarity: { presence: 0.5, allowRare: true },
    hero: { motif: 'ENERGY_CHASM', scale: 1.15, dominant: true },
    composition: { lateStart: 0.44, lateEnd: 0.6, denseStart: 0.15, denseEnd: 0.33, revealArc: 0.84, finishFunnel: 0.93 },
    reaction: { emphasis: ['SKYLINE', 'SIGNAGE', 'HERO'], gainMin: 0.9, gainMax: 1.4, curatedThemes: ['ASCENT', 'PRECISION'], smoothingSeconds: 1.9, maxSimultaneous: 3 }
  },

  // 08 WAVE SURFING — progressive glide; continuous harmonic surf, rhythmic.
  {
    trackId: 'track_8_wave_surfing',
    displayName: 'WAVE SURFING',
    usesOverride: true,
    architecture: {
      primary: 'CANYON',
      secondary: 'STACKED',
      density: 0.6,
      proportionScale: 1.1,
      slenderness: 0.55,
      cutoutFrequency: 0.5,
      spacingScale: 0.95,
      floating: 0.3
    },
    space: { openness: 0.5, verticality: 0.6, abyssVisibility: 0.65, distantDistribution: 0.6 },
    sky: { starDensity: 0.5, starTint: '#a3e635', celestial: 'HALO', hazeStrength: 0.55, backgroundTint: '#0c1a11' },
    material: { route: 'POLISHED_SIGNAL_STONE', structureTone: 'CONCRETE', emission: 0.5, surfaceBreakup: 0.5 },
    signage: { density: 'MODERATE', amountScale: 1.1, terminology: 0.6, mascotUsage: 0.5 },
    celestialRarity: { presence: 0.5, allowRare: true },
    hero: { motif: 'SIGNAL_WALL', scale: 1.15, dominant: false },
    composition: { lateStart: 0.16, lateEnd: 0.3, denseStart: 0.35, denseEnd: 0.5, revealArc: 0.66, finishFunnel: 0.9 },
    reaction: { emphasis: ['SKYLINE', 'HERO'], gainMin: 0.9, gainMax: 1.35, curatedThemes: ['SURF', 'SPEED'], smoothingSeconds: 2.0, maxSimultaneous: 2 }
  },

  // 09 NEON ABYSS — dark electro void; heavy bass, monumental dark framing, abyss.
  {
    trackId: 'track_9_neon_abyss',
    displayName: 'NEON ABYSS',
    usesOverride: true,
    architecture: {
      primary: 'MEGACITY',
      secondary: 'FRACTURED',
      density: 0.75,
      proportionScale: 1.35,
      slenderness: 0.5,
      cutoutFrequency: 0.65,
      spacingScale: 0.8,
      floating: 0.3
    },
    space: { openness: 0.4, verticality: 0.7, abyssVisibility: 1.0, distantDistribution: 0.7 },
    sky: { starDensity: 0.35, starTint: '#bf00ff', celestial: 'ECLIPSE', hazeStrength: 0.7, backgroundTint: '#0a0614' },
    material: { route: 'NEAR_BLACK_CERAMIC', structureTone: 'BASALT', emission: 0.55, surfaceBreakup: 0.55 },
    signage: { density: 'DENSE', amountScale: 1.3, terminology: 0.65, mascotUsage: 0.55 },
    celestialRarity: { presence: 0.6, allowRare: true },
    hero: { motif: 'ENERGY_CHASM', scale: 1.3, dominant: true },
    composition: { lateStart: 0.3, lateEnd: 0.48, denseStart: 0.1, denseEnd: 0.36, revealArc: 0.58, finishFunnel: 0.88 },
    reaction: { emphasis: ['SKYLINE', 'ATMOSPHERE', 'HERO'], gainMin: 0.9, gainMax: 1.45, curatedThemes: ['SURF', 'ASCENT'], smoothingSeconds: 2.1, maxSimultaneous: 3 }
  },

  // 10 NEON SLIPSTREAM — hyperpop speedway; near-black ceramic lanes, minimal rest.
  {
    trackId: 'track_10_neon_slipstream',
    displayName: 'NEON SLIPSTREAM',
    usesOverride: true,
    architecture: {
      primary: 'SPIRE',
      secondary: 'FRAMEWORK',
      density: 0.35,
      proportionScale: 1.4,
      slenderness: 0.9,
      cutoutFrequency: 0.4,
      spacingScale: 1.4,
      floating: 0.5
    },
    space: { openness: 0.72, verticality: 0.75, abyssVisibility: 0.55, distantDistribution: 0.5 },
    sky: { starDensity: 0.6, starTint: '#e2e8f0', celestial: 'DISTANT_LIGHT_FIELD', hazeStrength: 0.4, backgroundTint: '#06080d' },
    material: { route: 'NEAR_BLACK_CERAMIC', structureTone: 'CERAMIC', emission: 0.5, surfaceBreakup: 0.3 },
    signage: { density: 'SPARSE', amountScale: 0.6, terminology: 0.4, mascotUsage: 0.3 },
    celestialRarity: { presence: 0.3, allowRare: false },
    hero: { motif: 'IMPOSSIBLE_TOWER', scale: 1.2, dominant: false },
    composition: { lateStart: 0.33, lateEnd: 0.52, denseStart: 0.6, denseEnd: 0.8, revealArc: 0.86, finishFunnel: 0.94 },
    reaction: { emphasis: ['HERO', 'SKY'], gainMin: 0.9, gainMax: 1.3, curatedThemes: ['ASCENT', 'SURF'], smoothingSeconds: 1.7, maxSimultaneous: 2 }
  },

  // 11 EX GRAVITY — neurofunk precision; machine vertical world, drop-driven.
  {
    trackId: 'track_11_ex_gravity',
    displayName: 'EX GRAVITY',
    usesOverride: true,
    architecture: {
      primary: 'MACHINE',
      secondary: 'SPIRE',
      density: 0.65,
      proportionScale: 1.3,
      slenderness: 0.75,
      cutoutFrequency: 0.55,
      spacingScale: 0.9,
      floating: 0.4
    },
    space: { openness: 0.5, verticality: 0.8, abyssVisibility: 0.6, distantDistribution: 0.6 },
    sky: { starDensity: 0.4, starTint: '#d9f99d', celestial: 'NEBULA', hazeStrength: 0.55, backgroundTint: '#08120a' },
    material: { route: 'INDUSTRIAL_PLATE', structureTone: 'RUSTED', emission: 0.55, surfaceBreakup: 0.65 },
    signage: { density: 'MODERATE', amountScale: 1.0, terminology: 0.6, mascotUsage: 0.5 },
    celestialRarity: { presence: 0.5, allowRare: true },
    hero: { motif: 'MACHINE_SPINE', scale: 1.25, dominant: true },
    composition: { lateStart: 0.34, lateEnd: 0.48, denseStart: 0.7, denseEnd: 0.86, revealArc: 0.6, finishFunnel: 0.9 },
    reaction: { emphasis: ['SKYLINE', 'HERO', 'SIGNAGE'], gainMin: 0.9, gainMax: 1.45, curatedThemes: ['DROP', 'BUILDUP'], smoothingSeconds: 1.8, maxSimultaneous: 3 }
  },

  // 12 SHADOWS OVER THE CIRCUIT — cyberpunk technical; analytical, muted, technical.
  {
    trackId: 'track_12_shadows_over_the_circuit',
    displayName: 'SHADOWS OVER THE CIRCUIT',
    usesOverride: true,
    architecture: {
      primary: 'FRAMEWORK',
      secondary: 'MACHINE',
      density: 0.6,
      proportionScale: 0.95,
      slenderness: 0.65,
      cutoutFrequency: 0.7,
      spacingScale: 0.9,
      floating: 0.45
    },
    space: { openness: 0.42, verticality: 0.5, abyssVisibility: 0.65, distantDistribution: 0.6 },
    sky: { starDensity: 0.3, starTint: '#94a3b8', celestial: 'GALAXY_BAND', hazeStrength: 0.75, backgroundTint: '#070a12' },
    material: { route: 'COLD_GLASS', structureTone: 'GLASS', emission: 0.35, surfaceBreakup: 0.4 },
    signage: { density: 'MODERATE', amountScale: 0.9, terminology: 0.75, mascotUsage: 0.35 },
    celestialRarity: { presence: 0.4, allowRare: true },
    hero: { motif: 'SIGNAL_WALL', scale: 1.05, dominant: false },
    composition: { lateStart: 0.14, lateEnd: 0.27, denseStart: 0.32, denseEnd: 0.5, revealArc: 0.72, finishFunnel: 0.9 },
    reaction: { emphasis: ['SIGNAGE', 'SKYLINE'], gainMin: 0.85, gainMax: 1.25, curatedThemes: ['ASCENT', 'PRECISION'], smoothingSeconds: 2.4, maxSimultaneous: 2 }
  },

  // 13 WAVEFORM DESCENT — halftime descent; steep steps, hanging architecture below.
  {
    trackId: 'track_13_waveform_descent',
    displayName: 'WAVEFORM DESCENT',
    usesOverride: true,
    architecture: {
      primary: 'STACKED',
      secondary: 'FLOATING',
      density: 0.55,
      proportionScale: 1.0,
      slenderness: 0.45,
      cutoutFrequency: 0.6,
      spacingScale: 1.1,
      floating: 0.65
    },
    space: { openness: 0.55, verticality: 0.35, abyssVisibility: 0.7, distantDistribution: 0.5 },
    sky: { starDensity: 0.45, starTint: '#9d00ff', celestial: 'NEBULA', hazeStrength: 0.6, backgroundTint: '#140c22' },
    material: { route: 'POLISHED_SIGNAL_STONE', structureTone: 'CONCRETE', emission: 0.45, surfaceBreakup: 0.5 },
    signage: { density: 'MODERATE', amountScale: 0.9, terminology: 0.5, mascotUsage: 0.45 },
    celestialRarity: { presence: 0.5, allowRare: true },
    hero: { motif: 'HANGING_ARCHITECTURE', scale: 1.15, dominant: true },
    composition: { lateStart: 0.5, lateEnd: 0.65, denseStart: 0.35, denseEnd: 0.48, revealArc: 0.8, finishFunnel: 0.92 },
    reaction: { emphasis: ['HERO', 'ATMOSPHERE'], gainMin: 0.9, gainMax: 1.3, curatedThemes: ['ASCENT', 'BREATH'], smoothingSeconds: 2.3, maxSimultaneous: 2 }
  },

  // 14 KZ ASCENT — max-difficulty industrial climb; near-black endgame void, minimal.
  {
    trackId: 'track_14_kz_ascent',
    displayName: 'KZ ASCENT',
    usesOverride: true,
    architecture: {
      primary: 'SPIRE',
      secondary: 'STACKED',
      density: 0.4,
      proportionScale: 1.5,
      slenderness: 0.85,
      cutoutFrequency: 0.5,
      spacingScale: 1.15,
      floating: 0.4
    },
    space: { openness: 0.58, verticality: 0.95, abyssVisibility: 0.75, distantDistribution: 0.45 },
    sky: { starDensity: 0.25, starTint: '#ffb4b4', celestial: 'NONE', hazeStrength: 0.65, backgroundTint: '#050204' },
    material: { route: 'NEAR_BLACK_CERAMIC', structureTone: 'CERAMIC', emission: 0.3, surfaceBreakup: 0.4 },
    signage: { density: 'SPARSE', amountScale: 0.5, terminology: 0.45, mascotUsage: 0.3 },
    celestialRarity: { presence: 0.0, allowRare: false },
    hero: { motif: 'CELESTIAL_ASCENT', scale: 1.4, dominant: true },
    composition: { lateStart: 0.36, lateEnd: 0.52, denseStart: 0.75, denseEnd: 0.9, revealArc: 0.9, finishFunnel: 0.96 },
    reaction: { emphasis: ['SKYLINE', 'HERO'], gainMin: 0.85, gainMax: 1.35, curatedThemes: ['ASCENT', 'PRECISION'], smoothingSeconds: 2.0, maxSimultaneous: 2 }
  }
];

export class SignalWorldProfileRegistry {
  private static byId: Map<string, OfficialWorldProfile> | null = null;

  private static ensure(): Map<string, OfficialWorldProfile> {
    if (!this.byId) {
      this.byId = new Map();
      for (const p of TRACK_PROFILES) this.byId.set(p.trackId, p);
    }
    return this.byId;
  }

  /** All 14 authored official profiles, stable order. */
  public static all(): OfficialWorldProfile[] {
    return TRACK_PROFILES;
  }

  /**
   * Resolve by TRUSTED catalog id.
   *
   * `officialTrackId` must come from SignalPackCatalog / MusicPack (i.e. a real
   * catalog selection), never from an arbitrary uploaded file name. Custom
   * audio, tutorial and lab pass null/unknown and receive the fallback.
   */
  public static resolveForTrackId(officialTrackId: string | null | undefined): OfficialWorldProfile {
    if (!officialTrackId) return FALLBACK_WORLD_PROFILE;
    const found = this.ensure().get(officialTrackId);
    return found ?? FALLBACK_WORLD_PROFILE;
  }

  /**
   * Resolve from a catalog entry. This still only trusts the catalog id, so a
   * custom upload whose filename happens to resemble an official title cannot
   * receive an official profile.
   */
  public static resolveForCatalogTrack(track: SignalPackTrack | null | undefined): OfficialWorldProfile {
    if (!track) return FALLBACK_WORLD_PROFILE;
    return this.resolveForTrackId(track.id);
  }
}

/**
 * Bounded, smoothed section/drop reaction gain.
 *
 * Consumers multiply their existing reactivity by this value. It is:
 *   - BOUNDED to the profile's [gainMin, gainMax], so no track can blow out the
 *     shared music bus (keep existing load-bearing gate/finish/knife reactivity).
 *   - SMOOTHED over `smoothingSeconds`, so section changes glide.
 *   - CURATED: only the profile's `curatedThemes` may reach gainMax; every other
 *     section sits at gainMin. This is the restraint rule — not everything
 *     reacts at once, and drops stay special.
 *   - INERT for Signal Drift / fallback (usesOverride=false returns 1.0), so the
 *     reference world is untouched.
 */
export function stepProfileReactionGain(
  profile: OfficialWorldProfile,
  sectionTheme: string,
  dt: number,
  current: number
): number {
  const r = profile.reaction;
  if (!profile.usesOverride) return 1.0;
  const target = r.curatedThemes.includes(sectionTheme) ? r.gainMax : r.gainMin;
  const rate = Math.min(1, Math.max(0, dt) / Math.max(0.05, r.smoothingSeconds));
  const next = current + (target - current) * rate;
  return Math.max(r.gainMin, Math.min(r.gainMax, next));
}

/**
 * Resolved macro-composition bands. INERT for Signal Drift / fallback: when the
 * profile does not opt in, 'active' is false and every helper returns identity.
 */
export interface ResolvedCompositionBands {
  lateStart: number;
  lateEnd: number;
  denseStart: number;
  denseEnd: number;
  revealArc: number | null;
  finishFunnel: number | null;
  active: boolean;
}

export const INERT_COMPOSITION_BANDS: ResolvedCompositionBands = {
  lateStart: 1,
  lateEnd: 1,
  denseStart: 0,
  denseEnd: 0,
  revealArc: null,
  finishFunnel: null,
  active: false
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Pure resolver for a profile's authored bands. Clamps and orders the zone
 * bounds so a malformed band can never invert or escape [0,1]; an inverted or
 * degenerate band simply becomes empty rather than misbehaving.
 */
export function resolveCompositionBands(profile: OfficialWorldProfile): ResolvedCompositionBands {
  const c = profile.composition;
  if (!profile.usesOverride || !c) return INERT_COMPOSITION_BANDS;
  const lateStart = clamp01(Math.min(c.lateStart, c.lateEnd));
  const lateEnd = clamp01(Math.max(c.lateStart, c.lateEnd));
  const denseStart = clamp01(Math.min(c.denseStart, c.denseEnd));
  const denseEnd = clamp01(Math.max(c.denseStart, c.denseEnd));
  const revealArc = c.revealArc == null ? null : clamp01(c.revealArc);
  const finishFunnel = c.finishFunnel == null ? null : clamp01(c.finishFunnel);
  return { lateStart, lateEnd, denseStart, denseEnd, revealArc, finishFunnel, active: true };
}

/**
 * Density multiplier for purely decorative skyline clusters at an arc-length
 * fraction along the route.
 *
 *  - authored EMPTY zone   -> strongly thinned (silent negative space)
 *  - prepared REVEAL point -> moderately thinned (opens the sight line)
 *  - FINISH funnel run-in  -> progressively thinned (frame the end)
 *  - authored DENSE core   -> never thinned (protective monumental mass)
 *  - everything else       -> 1.0
 *
 * Bands only ever REMOVE or KEEP existing instances, so this can never add a
 * draw call and can never place geometry inside gameplay. Allocation-free and
 * deterministic (no RNG, no time). Identity (1.0) on the inert path.
 */
export function compositionDensityScale(
  bands: ResolvedCompositionBands,
  arcFraction: number,
  revealRadius = 0.05
): number {
  if (!bands.active) return 1.0;
  const f = clamp01(arcFraction);

  // A protected DENSE core is never thinned, so concentration still reads even
  // when it sits next to an empty zone.
  if (f >= bands.denseStart && f < bands.denseEnd) return 1.0;
  if (f >= bands.lateStart && f < bands.lateEnd) return 0.22;
  if (bands.revealArc != null && Math.abs(f - bands.revealArc) < revealRadius) return 0.5;
  if (bands.finishFunnel != null && f >= bands.finishFunnel) {
    const t = (f - bands.finishFunnel) / Math.max(0.0001, 1 - bands.finishFunnel);
    return Math.max(0.4, 1 - t * 0.6);
  }
  return 1.0;
}
