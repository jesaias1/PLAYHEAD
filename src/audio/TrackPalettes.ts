/**
 * Curated deterministic track color palettes for PLAYHEAD SIGNAL RENDER
 * "Cosmic Pixel Brutalism" visual palette families.
 * Selected deterministically based on audio analysis seed, spectral brightness, and energy.
 */

import * as THREE from 'three';

export interface TrackPalette {
  name: string;
  void: THREE.Color;
  surfaceDark: THREE.Color;
  surfaceLight: THREE.Color;
  surface: THREE.Color; // Backward compatibility (points to surfaceDark)
  primary: THREE.Color;
  secondary: THREE.Color;
  highlight: THREE.Color;
  bassTint: THREE.Color;
  highTint: THREE.Color;
  fogColor: THREE.Color;

  // Backward compatibility helpers
  primaryHex: string;
  secondaryHex: string;
  backgroundHex: string;
  background: THREE.Color;
  accentRgb: [number, number, number];
}

export interface PaletteConfig {
  voidHex: string;
  surfaceHex: string; // Backward compatibility alias
  surfaceDarkHex: string;
  surfaceLightHex: string;
  primaryHex: string;
  secondaryHex: string;
  highlightHex: string;
  bassTintHex: string;
  highTintHex: string;
  accentRgb: [number, number, number];
}

export const CURATED_PALETTES: Record<string, PaletteConfig> = {
  MOONGLASS: {
    voidHex: '#040814',
    surfaceHex: '#0b1329',
    surfaceDarkHex: '#0b1329',
    surfaceLightHex: '#1c284d',
    primaryHex: '#7ee7f8',     // Pale cyan
    secondaryHex: '#a78bfa',   // Lavender
    highlightHex: '#f8fafc',   // Moon-white
    bassTintHex: '#0c1836',
    highTintHex: '#c4b5fd',
    accentRgb: [126, 231, 248]
  },
  EMBER_VOID: {
    voidHex: '#090507',
    surfaceHex: '#1c0c14',
    surfaceDarkHex: '#1c0c14',
    surfaceLightHex: '#381622',
    primaryHex: '#ea580c',     // Burnt orange
    secondaryHex: '#f472b6',   // Dusty pink
    highlightHex: '#fef3c7',   // Cream
    bassTintHex: '#3b0d18',
    highTintHex: '#fed7aa',
    accentRgb: [234, 88, 12]
  },
  ACID_DREAM: {
    voidHex: '#030906',
    surfaceHex: '#0c1a11',
    surfaceDarkHex: '#0c1a11',
    surfaceLightHex: '#1a3322',
    primaryHex: '#a3e635',     // Acid lime
    secondaryHex: '#c084fc',   // Violet
    highlightHex: '#f0fdf4',   // Pale mint off-white
    bassTintHex: '#142913',
    highTintHex: '#d9f99d',
    accentRgb: [163, 230, 53]
  },
  DEEP_SIGNAL: {
    voidHex: '#02040d',
    surfaceHex: '#0c1430',
    surfaceDarkHex: '#0c1430',
    surfaceLightHex: '#162552',
    primaryHex: '#2563eb',     // Cobalt / signal blue
    secondaryHex: '#f59e0b',   // Warm gold
    highlightHex: '#f1f5f9',   // Silver-white
    bassTintHex: '#081030',
    highTintHex: '#fde68a',
    accentRgb: [37, 99, 235]
  },
  BLOOD_MOON: {
    voidHex: '#050204',
    surfaceHex: '#1a060d',
    surfaceDarkHex: '#1a060d',
    surfaceLightHex: '#360d1b',
    primaryHex: '#e11d48',     // Deep crimson
    secondaryHex: '#fda4af',   // Salmon/pink
    highlightHex: '#fafafa',   // Bone white
    bassTintHex: '#380512',
    highTintHex: '#fecdd3',
    accentRgb: [225, 29, 72]
  },
  DUSK: {
    voidHex: '#06040d',
    surfaceHex: '#140d24',
    surfaceDarkHex: '#140d24',
    surfaceLightHex: '#281b45',
    primaryHex: '#f97316',     // Muted orange
    secondaryHex: '#fb7185',   // Dusty rose
    highlightHex: '#fdf4ff',   // Pale cream
    bassTintHex: '#1c0e33',
    highTintHex: '#fbcfe8',
    accentRgb: [249, 115, 22]
  },
  // Production catalog compatibility entries
  ICE: {
    voidHex: '#040814',
    surfaceHex: '#0b1329',
    surfaceDarkHex: '#0b1329',
    surfaceLightHex: '#1c284d',
    primaryHex: '#00f0ff',
    secondaryHex: '#38bdf8',
    highlightHex: '#e0f8ff',
    bassTintHex: '#0c2236',
    highTintHex: '#bdf4fe',
    accentRgb: [0, 240, 255]
  },
  EMBER: {
    voidHex: '#090507',
    surfaceHex: '#1c0c14',
    surfaceDarkHex: '#1c0c14',
    surfaceLightHex: '#381622',
    primaryHex: '#ea580c',
    secondaryHex: '#f472b6',
    highlightHex: '#fef3c7',
    bassTintHex: '#3b0d18',
    highTintHex: '#fed7aa',
    accentRgb: [234, 88, 12]
  },
  SIGNAL_RED: {
    voidHex: '#050204',
    surfaceHex: '#1a060d',
    surfaceDarkHex: '#1a060d',
    surfaceLightHex: '#360d1b',
    primaryHex: '#e11d48',
    secondaryHex: '#fda4af',
    highlightHex: '#ffffff',
    bassTintHex: '#380512',
    highTintHex: '#fecdd3',
    accentRgb: [225, 29, 72]
  },
  ACID: {
    voidHex: '#030906',
    surfaceHex: '#0c1a11',
    surfaceDarkHex: '#0c1a11',
    surfaceLightHex: '#1a3322',
    primaryHex: '#a3e635',
    secondaryHex: '#c084fc',
    highlightHex: '#f0fdf4',
    bassTintHex: '#142913',
    highTintHex: '#d9f99d',
    accentRgb: [163, 230, 53]
  },
  ULTRAVIOLET: {
    voidHex: '#06030a',
    surfaceHex: '#130f1b',
    surfaceDarkHex: '#130f1b',
    surfaceLightHex: '#26183a',
    primaryHex: '#b5179e',
    secondaryHex: '#7209b7',
    highlightHex: '#f5e6ff',
    bassTintHex: '#280538',
    highTintHex: '#e0aaff',
    accentRgb: [181, 23, 158]
  },
  GLACIER: {
    voidHex: '#040608',
    surfaceHex: '#101418',
    surfaceDarkHex: '#101418',
    surfaceLightHex: '#1a2028',
    primaryHex: '#38bdf8',
    secondaryHex: '#94a3b8',
    highlightHex: '#f8fafc',
    bassTintHex: '#0d1e2b',
    highTintHex: '#e2e8f0',
    accentRgb: [56, 189, 248]
  }
};

export class PaletteSelector {
  public static selectPalette(seed: number, centroid: number, energy: number): TrackPalette {
    const primaryKeys = ['MOONGLASS', 'EMBER_VOID', 'ACID_DREAM', 'DEEP_SIGNAL', 'BLOOD_MOON', 'DUSK'];

    // Deterministic selection based on musical fingerprint + seed
    let chosenKey: string;
    if (centroid > 0.65 && energy > 0.6) {
      chosenKey = (Math.abs(seed) % 2 === 0) ? 'BLOOD_MOON' : 'DEEP_SIGNAL';
    } else if (centroid > 0.52) {
      chosenKey = (Math.abs(seed) % 2 === 0) ? 'ACID_DREAM' : 'MOONGLASS';
    } else if (energy < 0.35) {
      chosenKey = (Math.abs(seed) % 2 === 0) ? 'DUSK' : 'MOONGLASS';
    } else {
      const idx = Math.abs(seed) % primaryKeys.length;
      chosenKey = primaryKeys[idx];
    }

    const conf = CURATED_PALETTES[chosenKey] || CURATED_PALETTES.MOONGLASS;
    const voidCol = new THREE.Color(conf.voidHex);
    const surfDarkCol = new THREE.Color(conf.surfaceDarkHex);
    const surfLightCol = new THREE.Color(conf.surfaceLightHex);
    const primCol = new THREE.Color(conf.primaryHex);
    const secCol = new THREE.Color(conf.secondaryHex);
    const highCol = new THREE.Color(conf.highlightHex);
    const bassCol = new THREE.Color(conf.bassTintHex);
    const highTintCol = new THREE.Color(conf.highTintHex);

    return {
      name: chosenKey,
      void: voidCol,
      surfaceDark: surfDarkCol,
      surfaceLight: surfLightCol,
      surface: surfDarkCol, // Alias
      primary: primCol,
      secondary: secCol,
      highlight: highCol,
      bassTint: bassCol,
      highTint: highTintCol,
      fogColor: voidCol.clone(),

      // Aliases for backward compatibility
      primaryHex: conf.primaryHex,
      secondaryHex: conf.secondaryHex,
      backgroundHex: conf.voidHex,
      background: voidCol,
      accentRgb: conf.accentRgb
    };
  }

  public static getPaletteByName(name: string): TrackPalette {
    const conf = CURATED_PALETTES[name] || CURATED_PALETTES.MOONGLASS;
    const voidCol = new THREE.Color(conf.voidHex);
    const surfDarkCol = new THREE.Color(conf.surfaceDarkHex);
    const surfLightCol = new THREE.Color(conf.surfaceLightHex);
    const primCol = new THREE.Color(conf.primaryHex);
    const secCol = new THREE.Color(conf.secondaryHex);
    const highCol = new THREE.Color(conf.highlightHex);
    const bassCol = new THREE.Color(conf.bassTintHex);
    const highTintCol = new THREE.Color(conf.highTintHex);

    return {
      name: conf === CURATED_PALETTES[name] ? name : 'MOONGLASS',
      void: voidCol,
      surfaceDark: surfDarkCol,
      surfaceLight: surfLightCol,
      surface: surfDarkCol,
      primary: primCol,
      secondary: secCol,
      highlight: highCol,
      bassTint: bassCol,
      highTint: highTintCol,
      fogColor: voidCol.clone(),
      primaryHex: conf.primaryHex,
      secondaryHex: conf.secondaryHex,
      backgroundHex: conf.voidHex,
      background: voidCol,
      accentRgb: conf.accentRgb
    };
  }

  public static getPaletteForTrackId(trackId: string): TrackPalette {
    const map: Record<string, string> = {
      'signal-01-flow': 'MOONGLASS',
      'signal-02-velocity': 'ACID_DREAM',
      'signal-03-apex': 'BLOOD_MOON',
      'signal-04-horizon': 'DUSK',
      'signal-05-abyss': 'EMBER_VOID',
      'signal-06-singularity': 'DEEP_SIGNAL'
    };
    const key = map[trackId] || 'MOONGLASS';
    return PaletteSelector.getPaletteByName(key);
  }
}
