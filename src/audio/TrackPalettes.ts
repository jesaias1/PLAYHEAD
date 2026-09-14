/**
 * Curated deterministic track color palettes for PLAYHEAD
 * Selected based on audio analysis seed and spectral features
 */

import * as THREE from 'three';

export interface TrackPalette {
  name: string;
  void: THREE.Color;
  surface: THREE.Color;
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

export const CURATED_PALETTES: Record<string, {
  voidHex: string;
  surfaceHex: string;
  primaryHex: string;
  secondaryHex: string;
  highlightHex: string;
  bassTintHex: string;
  highTintHex: string;
  accentRgb: [number, number, number];
}> = {
  ICE: {
    voidHex: '#03060a',
    surfaceHex: '#0e141c',
    primaryHex: '#00f0ff',
    secondaryHex: '#38bdf8',
    highlightHex: '#e0f8ff',
    bassTintHex: '#0c2236',
    highTintHex: '#bdf4fe',
    accentRgb: [0, 240, 255]
  },
  EMBER: {
    voidHex: '#070403',
    surfaceHex: '#16110f',
    primaryHex: '#ff9e00',
    secondaryHex: '#ff5400',
    highlightHex: '#fff3d6',
    bassTintHex: '#3a1808',
    highTintHex: '#ffe4a0',
    accentRgb: [255, 158, 0]
  },
  SIGNAL_RED: {
    voidHex: '#080305',
    surfaceHex: '#161014',
    primaryHex: '#ff2a55',
    secondaryHex: '#ff8099',
    highlightHex: '#ffffff',
    bassTintHex: '#380a15',
    highTintHex: '#ffd4dc',
    accentRgb: [255, 42, 85]
  },
  ACID: {
    voidHex: '#040705',
    surfaceHex: '#121614',
    primaryHex: '#b8ff00',
    secondaryHex: '#d9f04d',
    highlightHex: '#f0fff4',
    bassTintHex: '#2e3d14',
    highTintHex: '#c8fedd',
    accentRgb: [184, 255, 0]
  },
  ULTRAVIOLET: {
    voidHex: '#06030a',
    surfaceHex: '#130f1b',
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
    primaryHex: '#38bdf8',
    secondaryHex: '#94a3b8',
    highlightHex: '#f8fafc',
    bassTintHex: '#0d1e2b',
    highTintHex: '#e2e8f0',
    accentRgb: [224, 242, 254]
  }
};

export class PaletteSelector {
  public static selectPalette(seed: number, centroid: number, energy: number): TrackPalette {
    const keys = ['ICE', 'EMBER', 'SIGNAL_RED', 'ACID', 'ULTRAVIOLET', 'GLACIER'];

    // Choose deterministically based on seed and audio brightness
    let chosenKey: string;
    if (centroid > 0.65 && energy > 0.6) {
      chosenKey = 'SIGNAL_RED';
    } else if (centroid > 0.55) {
      chosenKey = (seed % 2 === 0) ? 'ACID' : 'ICE';
    } else if (energy < 0.25) {
      chosenKey = (seed % 2 === 0) ? 'GLACIER' : 'ICE';
    } else {
      const idx = Math.abs(seed) % keys.length;
      chosenKey = keys[idx];
    }

    const conf = CURATED_PALETTES[chosenKey];
    const voidCol = new THREE.Color(conf.voidHex);
    const surfCol = new THREE.Color(conf.surfaceHex);
    const primCol = new THREE.Color(conf.primaryHex);
    const secCol = new THREE.Color(conf.secondaryHex);
    const highCol = new THREE.Color(conf.highlightHex);
    const bassCol = new THREE.Color(conf.bassTintHex);
    const highTintCol = new THREE.Color(conf.highTintHex);

    return {
      name: chosenKey,
      void: voidCol,
      surface: surfCol,
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
}
