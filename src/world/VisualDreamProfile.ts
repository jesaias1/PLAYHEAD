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
  public static selectProfile(
    seed: number,
    analysis: TrackAnalysis,
    palette: TrackPalette
  ): VisualDreamProfile {
    const energy = analysis.globalEnergy || 0.5;
    const bpm = analysis.bpm || 120;
    const absSeed = Math.abs(seed);

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
}
