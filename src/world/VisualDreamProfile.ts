/**
 * VisualDreamProfile for PLAYHEAD SIGNAL RENDER
 * "Cosmic Pixel Brutalism" deterministic dream director.
 *
 * Maps audio analysis features & song seed to one of 6 distinct visual dream profiles:
 * - CELESTIAL: Moons, eclipses, tiered starfields, open cosmic negative space
 * - ORGANIC: Surreal pixel blossoms, signal moths, floating relics, soft dusk palettes
 * - MONUMENTAL: Colossal brutalist monoliths, cantilevers, split towers, heavy architecture
 * - FRACTURED: Broken slabs, fractured arches, floating ruins, jagged signal fins
 * - RITUAL: Cathedral ribs, double pylon gates, halos, eye in the void, altar podiums
 * - SIGNAL: Waveform canyons, circuit etchings, hazard edge grids, speed conduits
 */

import { TrackAnalysis } from '../audio/AudioFeatures';
import { TrackPalette } from '../audio/TrackPalettes';
import { ArchitectureFamily, CelestialMotif, OfficialWorldProfile, RouteMaterialFamily, SignageDensity } from './SignalWorldProfile';

export type VisualDreamType =
  | 'CELESTIAL'
  | 'ORGANIC'
  | 'MONUMENTAL'
  | 'FRACTURED'
  | 'RITUAL'
  | 'SIGNAL';

export interface VisualDreamProfile {
  type: VisualDreamType;
  title: string;
  description: string;
  paletteFamily: string;
  primaryArchitecture: 'MONOLITHS' | 'RIBS' | 'FRACTURED_SLABS' | 'SIGNAL_FINS' | 'CANTILEVERS' | 'PYLONS';
  celestialMotif: 'MOON' | 'ECLIPSE' | 'EYE_VOID' | 'HALO_DISC';
  symbolicSprites: ('MOON' | 'ECLIPSE' | 'EYE' | 'FLOWER' | 'MOTH' | 'HALO' | 'STAR_CROSS')[];
  fogDensityBias: number;
  starVisibilityBias: number;
  skylineSpacing: number;
  muralFrequency: number;
}

export class VisualDreamDirector {
  /**
   * Derive a bounded, data-driven CUSTOM world profile from the audio
   * descriptors + content seed. This reuses the EXISTING SignalWorldProfile
   * mechanisms (architecture/sky/space/material/reaction) so the custom world
   * reaches actual runtime construction — it never copies an official track's
   * authored artwork wholesale.
   *
   * Returns null when there is no custom source (official/null keeps the
   * untouched legacy fallback path).
   */
  public static deriveCustomWorldProfile(
    analysis: TrackAnalysis,
    seedOffset = 0
  ): OfficialWorldProfile | null {
    const aggregate = analysis.customAggregate;
    if (!aggregate) return null;
    const seed = (analysis.seed + seedOffset) >>> 0;
    const absSeed = Math.abs(seed);

    const bass = clamp01(aggregate.bass);
    const density = clamp01(aggregate.density);
    const brightness = clamp01(aggregate.brightness);
    const dynamics = clamp01(aggregate.dynamics);
    const contrast = clamp01(aggregate.contrast);

    const drive = bass * 0.45 + density * 0.35 + dynamics * 0.2;
    const shimmer = brightness * 0.6 + contrast * 0.4;

    const architecture: { primary: ArchitectureFamily; secondary: ArchitectureFamily } =
      drive > 0.62 && bass > 0.5
        ? { primary: 'MEGACITY', secondary: 'MACHINE' }
        : shimmer > 0.6
          ? { primary: 'SPIRE', secondary: 'FRACTURED' }
          : drive > 0.45
            ? { primary: 'MONOLITHIC', secondary: 'STACKED' }
            : brightness < 0.42 && density < 0.3
              ? { primary: 'FLOATING', secondary: 'RUINED' }
              : { primary: 'FRAMEWORK', secondary: 'CANYON' };

    const celestial: CelestialMotif =
      brightness > 0.66 ? 'NEBULA' : bass > 0.6 ? 'ECLIPSE' : density < 0.25 ? 'MOON' : absSeed % 2 === 0 ? 'HALO' : 'NONE';
    const material: RouteMaterialFamily =
      brightness > 0.62
        ? 'COLD_GLASS'
        : drive > 0.55
          ? 'INDUSTRIAL_PLATE'
          : density > 0.45
            ? 'POLISHED_SIGNAL_STONE'
            : 'WEATHERED_BRUTALIST';
    const signage: SignageDensity = density > 0.55 ? 'DENSE' : density > 0.3 ? 'MODERATE' : 'SPARSE';

    // Content hash tints the sky family; the palette supplies the base colour.
    const hue = (absSeed % 360) / 360;
    const starTint = hslHex(hue, 0.55, 0.72);
    const starDensity = clamp(0.3 + brightness * 0.7 + density * 0.35, 0.25, 1.35);
    const hazeStrength = clamp(0.4 + dynamics * 0.45 - brightness * 0.2, 0.25, 0.85);
    const openness = clamp(0.4 + brightness * 0.4 - density * 0.25, 0.2, 0.9);
    const abyss = clamp(0.4 + bass * 0.4, 0.25, 0.9);

    const reaction: OfficialWorldProfile['reaction'] = {
      emphasis: drive > 0.6 ? ['SKYLINE', 'HERO'] : shimmer > 0.55 ? ['SKY', 'SIGNAGE'] : ['ATMOSPHERE', 'SKYLINE'],
      gainMin: 0.85,
      gainMax: clamp(1.25 + dynamics * 0.2, 1.2, 1.5),
      curatedThemes: ['DROP', 'BUILDUP', 'SPEED', 'SURF'],
      smoothingSeconds: 2.0,
      maxSimultaneous: 2
    };

    return {
      trackId: `CUSTOM:${analysis.seed.toString(16)}`,
      displayName: analysis.customSource?.displayName || 'CUSTOM SIGNAL',
      usesOverride: true,
      architecture: {
        primary: architecture.primary,
        secondary: architecture.secondary,
        density: clamp(0.3 + density * 0.6, 0.2, 0.95),
        proportionScale: clamp(0.9 + bass * 0.45, 0.8, 1.4),
        slenderness: clamp(0.3 + brightness * 0.5, 0.2, 0.85),
        cutoutFrequency: clamp(0.35 + density * 0.4, 0.2, 0.8),
        spacingScale: clamp(1.0 + (1 - density) * 0.5, 0.9, 1.6),
        floating: clamp(0.2 + (1 - bass) * 0.4, 0.1, 0.7)
      },
      space: { openness, verticality: clamp(0.4 + bass * 0.5, 0.3, 0.95), abyssVisibility: abyss, distantDistribution: clamp(0.4 + brightness * 0.3, 0.3, 0.8) },
      sky: { starDensity, starTint, celestial, hazeStrength, backgroundTint: hslHex(hue, 0.4, 0.08) },
      material: { route: material, structureTone: brightness > 0.6 ? 'GLASS' : drive > 0.55 ? 'BASALT' : 'CONCRETE', emission: clamp(0.3 + brightness * 0.4, 0.2, 0.8), surfaceBreakup: clamp(0.3 + dynamics * 0.4, 0.25, 0.8) },
      signage: { density: signage, amountScale: clamp(0.4 + density * 0.8, 0.3, 1.2), terminology: clamp(0.3 + contrast * 0.5, 0.2, 0.8), mascotUsage: clamp(0.2 + dynamics * 0.4, 0.1, 0.7) },
      celestialRarity: { presence: clamp(0.2 + brightness * 0.5, 0.1, 0.7), allowRare: brightness > 0.6 && absSeed % 2 === 0 },
      hero: { motif: drive > 0.6 ? 'IMPOSSIBLE_TOWER' : shimmer > 0.55 ? 'CELESTIAL_ASCENT' : 'MONOLITH_FIELD', scale: clamp(0.9 + dynamics * 0.5, 0.8, 1.5), dominant: drive > 0.6 },
      reaction
    };
  }

  public static selectProfile(
    seed: number,
    analysis: TrackAnalysis,
    palette: TrackPalette
  ): VisualDreamProfile {
    const energy = analysis.globalEnergy || 0.5;
    const bpm = analysis.bpm || 120;
    const absSeed = Math.abs(seed);

    // CUSTOM audio drives the dream from aggregate spectral/motion character
    // (not BPM alone), with section evolution supplied by the existing
    // SongDirector / DropSetpiece once the world is wired.
    if (analysis.customAggregate) {
      return VisualDreamDirector.selectCustomProfile(seed, analysis, palette);
    }

    let type: VisualDreamType = 'CELESTIAL';

    if (palette.name === 'BLOOD_MOON' || (energy > 0.68 && bpm > 130)) {
      type = (absSeed % 2 === 0) ? 'RITUAL' : 'FRACTURED';
    } else if (palette.name === 'ACID_DREAM' || bpm > 145) {
      type = 'SIGNAL';
    } else if (palette.name === 'EMBER_VOID' || palette.name === 'DUSK') {
      type = (energy < 0.45) ? 'ORGANIC' : 'MONUMENTAL';
    } else if (palette.name === 'DEEP_SIGNAL') {
      type = (absSeed % 2 === 0) ? 'MONUMENTAL' : 'SIGNAL';
    } else {
      // MOONGLASS / ICE / GLACIER
      type = (energy < 0.4) ? 'CELESTIAL' : ((absSeed % 2 === 0) ? 'MONUMENTAL' : 'ORGANIC');
    }

    switch (type) {
      case 'CELESTIAL':
        return {
          type: 'CELESTIAL',
          title: 'CELESTIAL HORIZON',
          description: 'Vast cosmic negative space framed by giant pixel moon and tiered star clusters.',
          paletteFamily: palette.name,
          primaryArchitecture: 'MONOLITHS',
          celestialMotif: 'MOON',
          symbolicSprites: ['MOON', 'HALO', 'STAR_CROSS'],
          fogDensityBias: 0.85,
          starVisibilityBias: 1.2,
          skylineSpacing: 3,
          muralFrequency: 6
        };

      case 'ORGANIC':
        return {
          type: 'ORGANIC',
          title: 'SURREAL FLORA',
          description: 'Cosmic blossoms and signal moths suspended along contemplative quiet sections.',
          paletteFamily: palette.name,
          primaryArchitecture: 'CANTILEVERS',
          celestialMotif: 'MOON',
          symbolicSprites: ['FLOWER', 'MOTH', 'HALO'],
          fogDensityBias: 1.0,
          starVisibilityBias: 0.9,
          skylineSpacing: 4,
          muralFrequency: 5
        };

      case 'MONUMENTAL':
        return {
          type: 'MONUMENTAL',
          title: 'MONUMENTAL SLABS',
          description: 'Towering brutalist monoliths and heavy cantilevers framing the racing route.',
          paletteFamily: palette.name,
          primaryArchitecture: 'MONOLITHS',
          celestialMotif: (absSeed % 2 === 0) ? 'ECLIPSE' : 'HALO_DISC',
          symbolicSprites: ['HALO', 'STAR_CROSS'],
          fogDensityBias: 1.1,
          starVisibilityBias: 0.8,
          skylineSpacing: 2,
          muralFrequency: 4
        };

      case 'FRACTURED':
        return {
          type: 'FRACTURED',
          title: 'FRACTURED RUINS',
          description: 'Broken brutalist arches and floating split slabs suspended over the void.',
          paletteFamily: palette.name,
          primaryArchitecture: 'FRACTURED_SLABS',
          celestialMotif: 'ECLIPSE',
          symbolicSprites: ['STAR_CROSS', 'HALO'],
          fogDensityBias: 1.05,
          starVisibilityBias: 1.0,
          skylineSpacing: 3,
          muralFrequency: 5
        };

      case 'RITUAL':
        return {
          type: 'RITUAL',
          title: 'RITUAL SANCTUM',
          description: 'Cathedral arch ribs, cosmic halos, and the colossal Eye in the Void.',
          paletteFamily: palette.name,
          primaryArchitecture: 'RIBS',
          celestialMotif: 'EYE_VOID',
          symbolicSprites: ['EYE', 'HALO', 'STAR_CROSS'],
          fogDensityBias: 1.15,
          starVisibilityBias: 0.85,
          skylineSpacing: 2,
          muralFrequency: 3
        };

      case 'SIGNAL':
      default:
        return {
          type: 'SIGNAL',
          title: 'SIGNAL CONDUIT',
          description: 'Kinetic waveform fins and high-contrast digital runic surface etchings.',
          paletteFamily: palette.name,
          primaryArchitecture: 'SIGNAL_FINS',
          celestialMotif: 'HALO_DISC',
          symbolicSprites: ['HALO', 'STAR_CROSS'],
          fogDensityBias: 0.95,
          starVisibilityBias: 1.1,
          skylineSpacing: 2,
          muralFrequency: 4
        };
    }
  }

  /**
   * Deterministic custom profile derived from aggregate bass/brightness/density/
   * dynamics/contrast plus the content seed. Section-to-section evolution is
   * still handled by the existing SongDirector and DropSetpiece; this only
   * picks the bounded world identity.
   */
  private static selectCustomProfile(
    seed: number,
    analysis: TrackAnalysis,
    palette: TrackPalette
  ): VisualDreamProfile {
    const aggregate = analysis.customAggregate!;
    const absSeed = Math.abs(seed);
    const drive = aggregate.bass * 0.45 + aggregate.density * 0.35 + aggregate.dynamics * 0.2;
    const shimmer = aggregate.brightness * 0.6 + aggregate.contrast * 0.4;

    let type: VisualDreamType;
    if (drive > 0.62 && aggregate.bass > 0.5) {
      type = absSeed % 2 === 0 ? 'RITUAL' : 'FRACTURED';
    } else if (shimmer > 0.6) {
      type = 'SIGNAL';
    } else if (drive > 0.45) {
      type = absSeed % 2 === 0 ? 'MONUMENTAL' : 'FRACTURED';
    } else if (aggregate.brightness < 0.42 && aggregate.density < 0.3) {
      type = 'ORGANIC';
    } else {
      type = absSeed % 3 === 0 ? 'CELESTIAL' : absSeed % 3 === 1 ? 'MONUMENTAL' : 'ORGANIC';
    }

    const base = VisualDreamDirector.profileForType(type, absSeed);
    return {
      ...base,
      paletteFamily: palette.name,
      muralFrequency: clampFrequency(base.muralFrequency + (aggregate.density > 0.5 ? 1 : 0)),
      fogDensityBias: base.fogDensityBias * (0.95 + aggregate.dynamics * 0.15)
    };
  }

  private static profileForType(type: VisualDreamType, absSeed: number): VisualDreamProfile {
    switch (type) {
      case 'CELESTIAL':
        return {
          type: 'CELESTIAL', title: 'CELESTIAL HORIZON',
          description: 'Vast cosmic negative space framed by giant pixel moon and tiered star clusters.',
          paletteFamily: '', primaryArchitecture: 'MONOLITHS', celestialMotif: 'MOON',
          symbolicSprites: ['MOON', 'HALO', 'STAR_CROSS'],
          fogDensityBias: 0.85, starVisibilityBias: 1.2, skylineSpacing: 3, muralFrequency: 6
        };
      case 'ORGANIC':
        return {
          type: 'ORGANIC', title: 'SURREAL FLORA',
          description: 'Cosmic blossoms and signal moths suspended along contemplative quiet sections.',
          paletteFamily: '', primaryArchitecture: 'CANTILEVERS', celestialMotif: 'MOON',
          symbolicSprites: ['FLOWER', 'MOTH', 'HALO'],
          fogDensityBias: 1.0, starVisibilityBias: 0.9, skylineSpacing: 4, muralFrequency: 5
        };
      case 'MONUMENTAL':
        return {
          type: 'MONUMENTAL', title: 'MONUMENTAL SLABS',
          description: 'Towering brutalist monoliths and heavy cantilevers framing the racing route.',
          paletteFamily: '', primaryArchitecture: 'MONOLITHS',
          celestialMotif: absSeed % 2 === 0 ? 'ECLIPSE' : 'HALO_DISC',
          symbolicSprites: ['HALO', 'STAR_CROSS'],
          fogDensityBias: 1.1, starVisibilityBias: 0.8, skylineSpacing: 2, muralFrequency: 4
        };
      case 'FRACTURED':
        return {
          type: 'FRACTURED', title: 'FRACTURED RUINS',
          description: 'Broken brutalist arches and floating split slabs suspended over the void.',
          paletteFamily: '', primaryArchitecture: 'FRACTURED_SLABS', celestialMotif: 'ECLIPSE',
          symbolicSprites: ['STAR_CROSS', 'HALO'],
          fogDensityBias: 1.05, starVisibilityBias: 1.0, skylineSpacing: 3, muralFrequency: 5
        };
      case 'RITUAL':
        return {
          type: 'RITUAL', title: 'RITUAL SANCTUM',
          description: 'Cathedral arch ribs, cosmic halos, and the colossal Eye in the Void.',
          paletteFamily: '', primaryArchitecture: 'RIBS', celestialMotif: 'EYE_VOID',
          symbolicSprites: ['EYE', 'HALO', 'STAR_CROSS'],
          fogDensityBias: 1.15, starVisibilityBias: 0.85, skylineSpacing: 2, muralFrequency: 3
        };
      case 'SIGNAL':
      default:
        return {
          type: 'SIGNAL', title: 'SIGNAL CONDUIT',
          description: 'Kinetic waveform fins and high-contrast digital runic surface etchings.',
          paletteFamily: '', primaryArchitecture: 'SIGNAL_FINS', celestialMotif: 'HALO_DISC',
          symbolicSprites: ['HALO', 'STAR_CROSS'],
          fogDensityBias: 0.95, starVisibilityBias: 1.1, skylineSpacing: 2, muralFrequency: 4
        };
    }
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Deterministic HSL hex, used for content-derived (not copied) sky tints. */
function hslHex(h: number, s: number, l: number): string {
  const hue = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => {
    const k = (n + hue * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const toHex = (v: number): string => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

function clampFrequency(value: number): number {
  return value < 2 ? 2 : value > 8 ? 8 : Math.round(value);
}
