/**
 * KarambitSkinSystem for PLAYHEAD
 * Cosmetic-only progression system and material profiles for the PLAYHEAD Karambit.
 *
 * Manages:
 * - Authored static cosmetics plus rare video-backed Artifact skins
 * - Persistent track completion records and rank tiers (BRONZE, SILVER, GOLD, DIAMOND)
 * - Evaluates unlock requirements against built-in Signal Pack tracks
 * - LocalStorage persistence for equipped skin and earned achievements
 * - Dev preview mode for instant inspection without modifying real progression
 */

import * as THREE from 'three';
import { SignalPackCatalog } from '../audio/SignalPackCatalog';
import { RunRank } from '../player/PlayerStats';
import { KarambitCosmicMaterial } from './KarambitCosmicShader';
import { dropEligibleGloves, getDropGlove, isDropGloveId } from './DropGloveCatalog';
import type { DropGlove } from './DropGloveCatalog';
import {
  CosmeticDropItem,
  CosmeticKind,
  rollDropCategory,
  resolveDropCategory
} from './CosmeticDrop';

export type CosmeticRarity = 'STANDARD' | 'RARE' | 'RELIC' | 'ARTIFACT' | 'OVERCLOCKED';

interface SignalDropProgressionV2 {
  version: 2;
  awardedRankKeys: string[];
  pendingDropRanks: RunRank[];
  rewardOwnedSkinIds: string[];
  rewardBags: Record<RunRank, string[]>;
  rewardBagCursors: Record<RunRank, number>;
  rngState: number;
  lastRewardSkinId?: string;
  /**
   * SIGNAL DROP GLOVE ownership and bags.
   *
   * ADDITIVE and deliberately SEPARATE from the knife ledgers. Mastery glove
   * ownership stays DERIVED and is never written here, so a random cosmetic
   * ledger can never imply an earned achievement.
   */
  rewardOwnedGloveIds?: string[];
  gloveRewardBags?: Record<RunRank, string[]>;
  gloveRewardBagCursors?: Record<RunRank, number>;
  lastRewardGloveId?: string;
  /**
   * SERVER-ISSUED unopened Signal Drop ids. CLOUD-AUTHORITATIVE.
   *
   * These are minted only by the submit-run Edge Function on the FIRST DIAMOND
   * of a unique official track. A local flag can never fabricate one, so this
   * replaces the old client-controlled "pendingDropRanks means a drop exists"
   * model for real awards. Legacy/DEV pending ranks remain a separate, offline
   * dev path that the server ignores.
   */
  unopenedDropIds?: string[];
  /** Drop ids already opened/spent, so a replayed id can never re-award. */
  openedDropIds?: string[];
  /**
   * Locally-awarded drop ids the server has NOT yet echoed back. Lets
   * reconciliation keep a just-awarded in-flight drop while still dropping a
   * stale pending id that another device already opened/consumed.
   */
  pendingLocalAwardIds?: string[];
  /**
   * Local (non-authoritative) ledger of unique official tracks whose FIRST
   * DIAMOND has already produced a drop notification. Prevents a duplicated
   * client notification; the SERVER unique key is the real anti-re-award guard.
   */
  awardedDiamondDropKeys?: string[];
}

export interface TrackCompletionReward {
  newlyUnlocked: KarambitSkin[];
  dropAwarded: boolean;
  dropsAwarded: number;
  awardedDropRanks: RunRank[];
  pendingDrops: number;
}

export interface OpenedSignalDrop {
  /** Which cosmetic family was awarded. The reveal must never make the player infer it. */
  kind: CosmeticKind;
  /** Unified item view: identical shape for knives and gloves. */
  item: CosmeticDropItem;
  /** Display name of the awarded cosmetic. */
  name: string;
  codename: string;
  rarity: CosmeticRarity;
  /** Secondary tag (knife palette tag, or the glove codename). */
  accentTag: string;
  /** True for a live video artifact. Knives only; gloves are never video. */
  isLive: boolean;
  /** Present only for a knife award, so legacy consumers keep working. */
  skin?: KarambitSkin;
  sourceRank: RunRank;
  qualityLabel: 'STANDARD SIGNAL' | 'REFINED SIGNAL' | 'HIGH-FIDELITY SIGNAL' | 'PRISTINE SIGNAL';
  isCollectionComplete?: boolean;
  /** Server-issued Signal Drop id this open consumed (structured drops only). */
  dropId?: string;
}

const SIGNAL_DROP_PROGRESSION_VERSION = 2 as const;
export const SIGNAL_DROP_STORAGE_KEY = 'playhead.armory.signalDrops';
const DEFAULT_REWARD_RNG_STATE = 0x504c4159;
const RANK_THRESHOLDS: RunRank[] = ['BRONZE', 'SILVER', 'GOLD', 'DIAMOND'];
export const SIGNAL_DROP_RARITY_WEIGHTS: Record<RunRank, Record<CosmeticRarity, number>> = {
  BRONZE: { STANDARD: 120, RARE: 70, RELIC: 20, ARTIFACT: 10, OVERCLOCKED: 1 },
  SILVER: { STANDARD: 70, RARE: 100, RELIC: 50, ARTIFACT: 20, OVERCLOCKED: 3 },
  GOLD: { STANDARD: 30, RARE: 60, RELIC: 110, ARTIFACT: 50, OVERCLOCKED: 8 },
  DIAMOND: { STANDARD: 10, RARE: 50, RELIC: 120, ARTIFACT: 100, OVERCLOCKED: 20 }
};

export interface SkinMaterialProfile {
  baseColor: THREE.Color;
  nebulaPrimary: THREE.Color;
  nebulaSecondary: THREE.Color;
  starColor: THREE.Color;
  rimColor: THREE.Color;
  parallaxDepth: number;
  layer2Scale: number;
  flowSpeed: number;
  sparkleRate: number;
  fresnelPower: number;
  audioReactivity: number;
  isCanonical: boolean;
  isPrism?: boolean;
  isBlackstar?: boolean;
  isVideoArtifact?: boolean;
  texturePath?: string;
  videoPath?: string;
  exposure?: number;
  contrast?: number;
  emission?: number;
  uvScale?: number;
}

export interface KarambitSkin {
  id: string;
  name: string;
  codename: string;
  description: string;
  unlockRequirement: string;
  shortRequirement: string;
  tier: number;
  rarity: CosmeticRarity;
  dropEligible: boolean;
  dropWeight: number;
  paletteTag: string;
  profile: SkinMaterialProfile;
}

export const KARAMBIT_SKINS: KarambitSkin[] = [
  {
    id: 'SIGNAL_CYAN',
    name: '00 // SIGNAL CYAN',
    codename: 'CANONICAL STANDARD',
    description: 'Canonical PLAYHEAD tactical karambit. Charcoal titanium blade body with high-purity cyan emissive fuller and razor cutting edge.',
    unlockRequirement: 'STANDARD ISSUE — UNLOCKED BY DEFAULT',
    shortRequirement: 'DEFAULT',
    tier: 0,
    rarity: 'STANDARD',
    dropEligible: false,
    dropWeight: 0,
    paletteTag: 'CYAN // #00F0FF',
    profile: {
      baseColor: new THREE.Color(0x2d3545),
      nebulaPrimary: new THREE.Color(0x00f0ff),
      nebulaSecondary: new THREE.Color(0x0066aa),
      starColor: new THREE.Color(0xccffff),
      rimColor: new THREE.Color(0x00f0ff),
      parallaxDepth: 0.12,
      layer2Scale: 2.0,
      flowSpeed: 0.04,
      sparkleRate: 1.8,
      fresnelPower: 2.4,
      audioReactivity: 0.20,
      isCanonical: true
    }
  },
  {
    id: 'ASTRAL',
    name: '01 // ASTRAL',
    codename: 'DEEP SPACE NEBULA',
    description: 'Trapped deep-space cosmic cloud shifting in royal indigo and brilliant cyan. Foreground stellar dust cluster sparkles as the blade tilts.',
    unlockRequirement: 'COMPLETE ANY TRACK IN THE SIGNAL PACK',
    shortRequirement: 'COMPLETE 1 TRACK',
    tier: 1,
    rarity: 'RARE',
    dropEligible: true,
    dropWeight: 1,
    paletteTag: 'ASTRAL // #00D2FF',
    profile: {
      baseColor: new THREE.Color(0x181c28),
      nebulaPrimary: new THREE.Color(0x00d2ff),
      nebulaSecondary: new THREE.Color(0x7928ca),
      starColor: new THREE.Color(0xffffff),
      rimColor: new THREE.Color(0x00f0ff),
      parallaxDepth: 0.22,
      layer2Scale: 2.0,
      flowSpeed: 0.06,
      sparkleRate: 2.0,
      fresnelPower: 2.8,
      audioReactivity: 0.25,
      isCanonical: false,
      texturePath: '/assets/viewmodel/karambit/textures/astral_cosmic.webp',
      exposure: 1.25,
      contrast: 1.05,
      emission: 1.2,
      uvScale: 1.0
    }
  },
  {
    id: 'VOID_SIGNAL',
    name: '02 // VOID SIGNAL',
    codename: 'NULL COORDINATE',
    description: 'Near-black abyss interior absorbing ambient light, fractured by sparse cyan signal coordinate fragments drifting across extreme depth.',
    unlockRequirement: 'ACHIEVE SILVER OR BETTER ON >= 2 SIGNAL PACK TRACKS',
    shortRequirement: '2 TRACKS AT SILVER+',
    tier: 2,
    rarity: 'RARE',
    dropEligible: true,
    dropWeight: 1,
    paletteTag: 'VOID // #040608',
    profile: {
      baseColor: new THREE.Color(0x080a10),
      nebulaPrimary: new THREE.Color(0x00a8ff),
      nebulaSecondary: new THREE.Color(0x020814),
      starColor: new THREE.Color(0x00f0ff),
      rimColor: new THREE.Color(0x00e5ff),
      parallaxDepth: 0.26,
      layer2Scale: 2.2,
      flowSpeed: 0.04,
      sparkleRate: 1.4,
      fresnelPower: 3.0,
      audioReactivity: 0.22,
      isCanonical: false,
      texturePath: '/assets/viewmodel/karambit/textures/void_signal_cosmic.webp',
      exposure: 1.18,
      contrast: 1.2,
      emission: 1.15,
      uvScale: 1.0
    }
  },
  {
    id: 'REDSHIFT',
    name: '03 // REDSHIFT',
    codename: 'SOLAR RADIATION',
    description: 'High-energy relativistic cosmic storm in deep crimson, scorch orange, and magenta embers. Crisp searing silhouette.',
    unlockRequirement: 'ACHIEVE GOLD OR BETTER ON >= 2 SIGNAL PACK TRACKS',
    shortRequirement: '2 TRACKS AT GOLD+',
    tier: 3,
    rarity: 'RELIC',
    dropEligible: true,
    dropWeight: 1,
    paletteTag: 'EMBER // #FF3300',
    profile: {
      baseColor: new THREE.Color(0x221118),
      nebulaPrimary: new THREE.Color(0xff3311),
      nebulaSecondary: new THREE.Color(0x990044),
      starColor: new THREE.Color(0xffdd66),
      rimColor: new THREE.Color(0xff4400),
      parallaxDepth: 0.22,
      layer2Scale: 2.0,
      flowSpeed: 0.08,
      sparkleRate: 2.5,
      fresnelPower: 2.6,
      audioReactivity: 0.30,
      isCanonical: false,
      texturePath: '/assets/viewmodel/karambit/textures/redshift_cosmic.webp',
      exposure: 1.3,
      contrast: 1.1,
      emission: 1.3,
      uvScale: 1.0
    }
  },
  {
    id: 'PRISM_STATIC',
    name: '04 // PRISM STATIC',
    codename: 'CHROMATIC DISPERSION',
    description: 'Pearlescent celestial matrix refracted through icy relativistic prisms. Shifting iridescent cyan and pale rose-pink internal depth with embedded star crystals.',
    unlockRequirement: 'ACHIEVE GOLD OR BETTER ON ALL 14 SIGNAL PACK TRACKS',
    shortRequirement: 'ALL 14 TRACKS AT GOLD+',
    tier: 4,
    rarity: 'RELIC',
    dropEligible: true,
    dropWeight: 1,
    paletteTag: 'PEARL // #E0F2FE',
    profile: {
      baseColor: new THREE.Color(0xdde4f0),
      nebulaPrimary: new THREE.Color(0x38bdf8),
      nebulaSecondary: new THREE.Color(0xf472b6),
      starColor: new THREE.Color(0xffffff),
      rimColor: new THREE.Color(0xdbeafe),
      parallaxDepth: 0.25,
      layer2Scale: 2.2,
      flowSpeed: 0.05,
      sparkleRate: 2.0,
      fresnelPower: 2.5,
      audioReactivity: 0.22,
      isCanonical: false,
      isPrism: true,
      texturePath: '/assets/viewmodel/karambit/textures/prism_static_cosmic.webp',
      exposure: 1.08,
      contrast: 1.0,
      emission: 1.12,
      uvScale: 1.0
    }
  },
  {
    id: 'BLACKSTAR',
    name: '05 // BLACKSTAR',
    codename: 'SINGULARITY ARTIFACT',
    description: 'Prestige Diamond artifact. Gravitational singularity core absorbing ambient light, multi-depth parallax void, sparse stars, razor event-horizon rim, and rare stellar diffraction flares.',
    unlockRequirement: 'ACHIEVE DIAMOND ON ALL 14 SIGNAL PACK TRACKS',
    shortRequirement: 'ALL 14 TRACKS AT DIAMOND',
    tier: 5,
    rarity: 'RELIC',
    // RESERVED PRESTIGE: BLACKSTAR is no longer a random Signal Drop. It is the
    // deliberate WORLD RECORD reward, granted server-side by the submit-run
    // Edge Function and claimed once per account. Historical legitimate unlocks
    // (the 14-diamond achievement, or a drop won before this change) are
    // preserved through rewardOwnedSkinIds, which is a set union that never
    // loses a row. Earning it from progress still works; a fresh random roll
    // does not.
    dropEligible: false,
    dropWeight: 1,
    paletteTag: 'SINGULARITY // #020306',
    profile: {
      baseColor: new THREE.Color(0x020306),
      nebulaPrimary: new THREE.Color(0x0c0618),
      nebulaSecondary: new THREE.Color(0x020a14),
      starColor: new THREE.Color(0x80e5ff),
      rimColor: new THREE.Color(0x00f0ff),
      parallaxDepth: 0.32,
      layer2Scale: 2.4,
      flowSpeed: 0.02,
      sparkleRate: 1.2,
      fresnelPower: 3.8,
      audioReactivity: 0.12,
      isCanonical: false,
      isBlackstar: true,
      texturePath: '/assets/viewmodel/karambit/textures/blackstar_cosmic.webp',
      exposure: 0.95,
      contrast: 1.35,
      emission: 1.0,
      uvScale: 1.0
    }
  },
  {
    id: 'AMBER_SIGNAL',
    name: '06 // AMBER SIGNAL',
    codename: 'FIELD SERVICE STANDARD',
    description: 'Dark service steel with a restrained amber carrier signal moving beneath the fuller.',
    unlockRequirement: 'DISCOVERED THROUGH A SIGNAL DROP',
    shortRequirement: 'SIGNAL DROP',
    tier: 6,
    rarity: 'STANDARD',
    dropEligible: true,
    dropWeight: 1,
    paletteTag: 'AMBER // #FFB020',
    profile: {
      baseColor: new THREE.Color(0x2c2720),
      nebulaPrimary: new THREE.Color(0xffb020),
      nebulaSecondary: new THREE.Color(0x6a3512),
      starColor: new THREE.Color(0xffe3a3),
      rimColor: new THREE.Color(0xffb020),
      parallaxDepth: 0.12,
      layer2Scale: 1.8,
      flowSpeed: 0.035,
      sparkleRate: 1.1,
      fresnelPower: 3.0,
      audioReactivity: 0.14,
      isCanonical: false,
      exposure: 0.95,
      contrast: 1.08,
      emission: 0.9,
      uvScale: 1.0
    }
  },
  {
    id: 'WHITE_NOISE',
    name: '07 // WHITE NOISE',
    codename: 'CLEAN CARRIER STANDARD',
    description: 'Cold monochrome signal grain contained by graphite steel and a narrow white carrier edge.',
    unlockRequirement: 'DISCOVERED THROUGH A SIGNAL DROP',
    shortRequirement: 'SIGNAL DROP',
    tier: 7,
    rarity: 'STANDARD',
    dropEligible: true,
    dropWeight: 1,
    paletteTag: 'MONO // #DDE7EF',
    profile: {
      baseColor: new THREE.Color(0x252a31),
      nebulaPrimary: new THREE.Color(0xdde7ef),
      nebulaSecondary: new THREE.Color(0x465363),
      starColor: new THREE.Color(0xffffff),
      rimColor: new THREE.Color(0xc9d8e5),
      parallaxDepth: 0.11,
      layer2Scale: 1.9,
      flowSpeed: 0.03,
      sparkleRate: 1.0,
      fresnelPower: 3.2,
      audioReactivity: 0.12,
      isCanonical: false,
      exposure: 0.9,
      contrast: 1.12,
      emission: 0.88,
      uvScale: 1.0
    }
  },
  {
    id: 'SIGNALISM_ARTIFACT',
    name: '08 // SIGNALISM',
    codename: 'LIVE SIGNAL INTERIOR',
    description: 'A moving transmission suspended inside the blade, held behind a restrained cyan edge and dimensional signal glass.',
    unlockRequirement: 'DISCOVERED THROUGH A SIGNAL DROP',
    shortRequirement: 'SIGNAL DROP',
    tier: 6,
    rarity: 'ARTIFACT',
    dropEligible: true,
    dropWeight: 1,
    paletteTag: 'LIVE SIGNAL // CYAN',
    profile: {
      baseColor: new THREE.Color(0x101820),
      nebulaPrimary: new THREE.Color(0x19e6ee),
      nebulaSecondary: new THREE.Color(0x14394a),
      starColor: new THREE.Color(0xbffcff),
      rimColor: new THREE.Color(0x00eaf2),
      parallaxDepth: 0.16,
      layer2Scale: 1.45,
      flowSpeed: 0.0,
      sparkleRate: 1.2,
      fresnelPower: 3.0,
      audioReactivity: 0.18,
      isCanonical: false,
      isVideoArtifact: true,
      videoPath: '/assets/viewmodel/karambit/videos/signalism.mp4',
      exposure: 1.12,
      contrast: 1.0,
      emission: 1.04,
      uvScale: 1.0
    }
  },
  {
    id: 'GOD_RUN_ARTIFACT',
    name: '09 // GOD RUN',
    codename: 'VELOCITY RELIC FEED',
    description: 'A high-energy run fragment sealed into the steel, tempered by dark metal and a thin hot signal edge.',
    unlockRequirement: 'DISCOVERED THROUGH A SIGNAL DROP',
    shortRequirement: 'SIGNAL DROP',
    tier: 7,
    rarity: 'ARTIFACT',
    dropEligible: true,
    dropWeight: 1,
    paletteTag: 'LIVE SIGNAL // EMBER',
    profile: {
      baseColor: new THREE.Color(0x1b1214),
      nebulaPrimary: new THREE.Color(0xff6b2b),
      nebulaSecondary: new THREE.Color(0x5f174d),
      starColor: new THREE.Color(0xffe0a8),
      rimColor: new THREE.Color(0xff7440),
      parallaxDepth: 0.15,
      layer2Scale: 1.5,
      flowSpeed: 0.0,
      sparkleRate: 1.35,
      fresnelPower: 3.1,
      audioReactivity: 0.2,
      isCanonical: false,
      isVideoArtifact: true,
      videoPath: '/assets/viewmodel/karambit/videos/god-run.mp4',
      exposure: 1.1,
      contrast: 1.0,
      emission: 1.05,
      uvScale: 1.0
    }
  },
  {
    id: 'PRISM_ARTIFACT',
    name: '10 // PRISM',
    codename: 'SPECTRAL LIVE MATRIX',
    description: 'A living spectral matrix refracted through the blade interior with a pale crystalline edge response.',
    unlockRequirement: 'DISCOVERED THROUGH A SIGNAL DROP',
    shortRequirement: 'SIGNAL DROP',
    tier: 8,
    rarity: 'ARTIFACT',
    dropEligible: true,
    dropWeight: 1,
    paletteTag: 'LIVE SIGNAL // PRISM',
    profile: {
      baseColor: new THREE.Color(0x171923),
      nebulaPrimary: new THREE.Color(0x63d8ff),
      nebulaSecondary: new THREE.Color(0xd875d6),
      starColor: new THREE.Color(0xffffff),
      rimColor: new THREE.Color(0xccecff),
      parallaxDepth: 0.14,
      layer2Scale: 1.4,
      flowSpeed: 0.0,
      sparkleRate: 1.1,
      fresnelPower: 2.8,
      audioReactivity: 0.16,
      isCanonical: false,
      isVideoArtifact: true,
      videoPath: '/assets/viewmodel/karambit/videos/prism.mp4',
      exposure: 1.08,
      contrast: 1.0,
      emission: 1.03,
      uvScale: 1.0
    }
  },
  {
    id: 'CYBER_ARTIFACT',
    name: '11 // CYBER',
    codename: 'GRID PULSE ARTIFACT',
    description: 'High-density cybernetic vector stream flowing along the blade fuller with reactive terminal green accents.',
    unlockRequirement: 'DISCOVERED THROUGH A SIGNAL DROP',
    shortRequirement: 'SIGNAL DROP',
    tier: 9,
    rarity: 'OVERCLOCKED',
    dropEligible: true,
    dropWeight: 1,
    paletteTag: 'OVERCLOCKED // #00FF88',
    profile: {
      baseColor: new THREE.Color(0x0a1410),
      nebulaPrimary: new THREE.Color(0x00ff88),
      nebulaSecondary: new THREE.Color(0x006633),
      starColor: new THREE.Color(0x88ffcc),
      rimColor: new THREE.Color(0x00ffaa),
      parallaxDepth: 0.15,
      layer2Scale: 1.4,
      flowSpeed: 0.0,
      sparkleRate: 1.2,
      fresnelPower: 3.0,
      audioReactivity: 0.22,
      isCanonical: false,
      isVideoArtifact: true,
      videoPath: '/assets/viewmodel/karambit/videos/cyber.mp4',
      exposure: 1.15,
      contrast: 1.05,
      emission: 1.08,
      uvScale: 1.0
    }
  },
  {
    id: 'RADIO_ARTIFACT',
    name: '12 // RADIO',
    codename: 'FREQUENCY DRIFT ARTIFACT',
    description: 'Analog RF carrier modulation pattern encased in brushed beryllium bronze with amber glow response.',
    unlockRequirement: 'DISCOVERED THROUGH A SIGNAL DROP',
    shortRequirement: 'SIGNAL DROP',
    tier: 9,
    rarity: 'ARTIFACT',
    dropEligible: true,
    dropWeight: 1,
    paletteTag: 'RADIO // #FFAA00',
    profile: {
      baseColor: new THREE.Color(0x1a1205),
      nebulaPrimary: new THREE.Color(0xffaa00),
      nebulaSecondary: new THREE.Color(0x774400),
      starColor: new THREE.Color(0xffe599),
      rimColor: new THREE.Color(0xffcc33),
      parallaxDepth: 0.14,
      layer2Scale: 1.4,
      flowSpeed: 0.0,
      sparkleRate: 1.25,
      fresnelPower: 2.9,
      audioReactivity: 0.20,
      isCanonical: false,
      isVideoArtifact: true,
      videoPath: '/assets/viewmodel/karambit/videos/radio.mp4',
      exposure: 1.12,
      contrast: 1.0,
      emission: 1.06,
      uvScale: 1.0
    }
  },
  {
    id: 'UNDERWORLD_ARTIFACT',
    name: '13 // UNDERWORLD',
    codename: 'SUBTERRANEAN ANOMALY',
    description: 'Abyssal sub-surface seismic magma pulse trapped under obsidian titanium with searing crimson edge illumination.',
    unlockRequirement: 'DISCOVERED THROUGH A SIGNAL DROP',
    shortRequirement: 'SIGNAL DROP',
    tier: 10,
    rarity: 'ARTIFACT',
    dropEligible: true,
    dropWeight: 1,
    paletteTag: 'ABYSS // #FF0044',
    profile: {
      baseColor: new THREE.Color(0x16050a),
      nebulaPrimary: new THREE.Color(0xff0044),
      nebulaSecondary: new THREE.Color(0x66001a),
      starColor: new THREE.Color(0xff99aa),
      rimColor: new THREE.Color(0xff1a53),
      parallaxDepth: 0.16,
      layer2Scale: 1.5,
      flowSpeed: 0.0,
      sparkleRate: 1.3,
      fresnelPower: 3.2,
      audioReactivity: 0.25,
      isCanonical: false,
      isVideoArtifact: true,
      videoPath: '/assets/viewmodel/karambit/videos/underworld.mp4',
      exposure: 1.18,
      contrast: 1.1,
      emission: 1.1,
      uvScale: 1.0
    }
  },
  {
    id: 'SYNTH_ARTIFACT',
    name: '14 // SYNTH',
    codename: 'NEO-ANALOG WAVEFORM',
    description: 'Vibrant ultraviolet synthwave oscillation pulsing through internal crystal waveguides.',
    unlockRequirement: 'DISCOVERED THROUGH A SIGNAL DROP',
    shortRequirement: 'SIGNAL DROP',
    tier: 10,
    rarity: 'ARTIFACT',
    dropEligible: true,
    dropWeight: 1,
    paletteTag: 'SYNTH // #C026D3',
    profile: {
      baseColor: new THREE.Color(0x180820),
      nebulaPrimary: new THREE.Color(0xc026d3),
      nebulaSecondary: new THREE.Color(0x4a044e),
      starColor: new THREE.Color(0xf0abfc),
      rimColor: new THREE.Color(0xe879f9),
      parallaxDepth: 0.15,
      layer2Scale: 1.45,
      flowSpeed: 0.0,
      sparkleRate: 1.2,
      fresnelPower: 3.0,
      audioReactivity: 0.22,
      isCanonical: false,
      isVideoArtifact: true,
      videoPath: '/assets/viewmodel/karambit/videos/synth.mp4',
      exposure: 1.14,
      contrast: 1.05,
      emission: 1.07,
      uvScale: 1.0
    }
  },
  {
    id: 'DNA_ARTIFACT',
    name: '15 // DNA',
    codename: 'BIOMETRIC HELIX CIPHER',
    description: 'Living genetic transmission matrix looping continuously inside tempered crystal steel.',
    unlockRequirement: 'DISCOVERED THROUGH A SIGNAL DROP',
    shortRequirement: 'SIGNAL DROP',
    tier: 10,
    rarity: 'ARTIFACT',
    dropEligible: true,
    dropWeight: 1,
    paletteTag: 'HELIX // #06B6D4',
    profile: {
      baseColor: new THREE.Color(0x06141a),
      nebulaPrimary: new THREE.Color(0x06b6d4),
      nebulaSecondary: new THREE.Color(0x083344),
      starColor: new THREE.Color(0xa5f3fc),
      rimColor: new THREE.Color(0x22d3ee),
      parallaxDepth: 0.15,
      layer2Scale: 1.4,
      flowSpeed: 0.0,
      sparkleRate: 1.25,
      fresnelPower: 2.9,
      audioReactivity: 0.20,
      isCanonical: false,
      isVideoArtifact: true,
      videoPath: '/assets/viewmodel/karambit/videos/dna.mp4',
      exposure: 1.12,
      contrast: 1.0,
      emission: 1.05,
      uvScale: 1.0
    }
  },
  {
    id: 'MIRRORS_ARTIFACT',
    name: '16 // MIRRORS',
    codename: 'SPECULAR INFINITY VAULT',
    description: 'Multi-layered specular infinity mirror reflecting void coordinates into dimensional depth.',
    unlockRequirement: 'DISCOVERED THROUGH A SIGNAL DROP',
    shortRequirement: 'SIGNAL DROP',
    tier: 11,
    rarity: 'ARTIFACT',
    dropEligible: true,
    dropWeight: 1,
    paletteTag: 'MIRROR // #CBD5E1',
    profile: {
      baseColor: new THREE.Color(0x181c24),
      nebulaPrimary: new THREE.Color(0xcbd5e1),
      nebulaSecondary: new THREE.Color(0x334155),
      starColor: new THREE.Color(0xffffff),
      rimColor: new THREE.Color(0xe2e8f0),
      parallaxDepth: 0.18,
      layer2Scale: 1.55,
      flowSpeed: 0.0,
      sparkleRate: 1.35,
      fresnelPower: 3.2,
      audioReactivity: 0.18,
      isCanonical: false,
      isVideoArtifact: true,
      videoPath: '/assets/viewmodel/karambit/videos/mirrors.mp4',
      exposure: 1.1,
      contrast: 1.08,
      emission: 1.04,
      uvScale: 1.0
    }
  },
  {
    id: 'PINK_SMOKE_ARTIFACT',
    name: '17 // PINK SMOKE',
    codename: 'THERMAL VAPOR DISPERSION',
    description: 'Superheated rose vapor shifting across micro-grooves with an iridescent magenta edge.',
    unlockRequirement: 'DISCOVERED THROUGH A SIGNAL DROP',
    shortRequirement: 'SIGNAL DROP',
    tier: 11,
    rarity: 'ARTIFACT',
    dropEligible: true,
    dropWeight: 1,
    paletteTag: 'VAPOR // #EC4899',
    profile: {
      baseColor: new THREE.Color(0x1a0814),
      nebulaPrimary: new THREE.Color(0xec4899),
      nebulaSecondary: new THREE.Color(0x831843),
      starColor: new THREE.Color(0xfbcfe8),
      rimColor: new THREE.Color(0xf472b6),
      parallaxDepth: 0.14,
      layer2Scale: 1.4,
      flowSpeed: 0.0,
      sparkleRate: 1.15,
      fresnelPower: 2.8,
      audioReactivity: 0.20,
      isCanonical: false,
      isVideoArtifact: true,
      videoPath: '/assets/viewmodel/karambit/videos/pink-smoke.mp4',
      exposure: 1.12,
      contrast: 1.0,
      emission: 1.05,
      uvScale: 1.0
    }
  },
  {
    id: 'BLUE_SMOKE_ARTIFACT',
    name: '18 // BLUE SMOKE',
    codename: 'CRYOGENIC CLOUD CHAMBER',
    description: 'Sub-zero vapor stream trapped in zero gravity, illuminating a cryogenic blue aura.',
    unlockRequirement: 'DISCOVERED THROUGH A SIGNAL DROP',
    shortRequirement: 'SIGNAL DROP',
    tier: 11,
    rarity: 'ARTIFACT',
    dropEligible: true,
    dropWeight: 1,
    paletteTag: 'MIST // #38BDF8',
    profile: {
      baseColor: new THREE.Color(0x081420),
      nebulaPrimary: new THREE.Color(0x38bdf8),
      nebulaSecondary: new THREE.Color(0x075985),
      starColor: new THREE.Color(0xbae6fd),
      rimColor: new THREE.Color(0x7dd3fc),
      parallaxDepth: 0.14,
      layer2Scale: 1.4,
      flowSpeed: 0.0,
      sparkleRate: 1.15,
      fresnelPower: 2.8,
      audioReactivity: 0.20,
      isCanonical: false,
      isVideoArtifact: true,
      videoPath: '/assets/viewmodel/karambit/videos/blue-smoke.mp4',
      exposure: 1.12,
      contrast: 1.0,
      emission: 1.05,
      uvScale: 1.0
    }
  },
  {
    id: 'WHITE_SMOKE_ARTIFACT',
    name: '19 // WHITE SMOKE',
    codename: 'PURE DIFFUSION ENVELOPE',
    description: 'High-vacuum white aerosol veil creating soft volumetric plumes inside the crystal spine.',
    unlockRequirement: 'DISCOVERED THROUGH A SIGNAL DROP',
    shortRequirement: 'SIGNAL DROP',
    tier: 12,
    rarity: 'ARTIFACT',
    dropEligible: true,
    dropWeight: 1,
    paletteTag: 'AETHER // #F8FAFC',
    profile: {
      baseColor: new THREE.Color(0x181c22),
      nebulaPrimary: new THREE.Color(0xf8fafc),
      nebulaSecondary: new THREE.Color(0x475569),
      starColor: new THREE.Color(0xffffff),
      rimColor: new THREE.Color(0xf1f5f9),
      parallaxDepth: 0.13,
      layer2Scale: 1.38,
      flowSpeed: 0.0,
      sparkleRate: 1.1,
      fresnelPower: 2.7,
      audioReactivity: 0.18,
      isCanonical: false,
      isVideoArtifact: true,
      videoPath: '/assets/viewmodel/karambit/videos/white-smoke.mp4',
      exposure: 1.1,
      contrast: 1.02,
      emission: 1.04,
      uvScale: 1.0
    }
  },
  {
    id: 'BLUE_MARBLE_ARTIFACT',
    name: '20 // BLUE MARBLE',
    codename: 'ORBITAL CONTINENTAL CORE',
    description: 'Orbital celestial sphere suspended within the blade blade body, rotating in dark stellar blue.',
    unlockRequirement: 'DISCOVERED THROUGH A SIGNAL DROP',
    shortRequirement: 'SIGNAL DROP',
    tier: 12,
    rarity: 'ARTIFACT',
    dropEligible: true,
    dropWeight: 1,
    paletteTag: 'ORBIT // #2563EB',
    profile: {
      baseColor: new THREE.Color(0x0a1428),
      nebulaPrimary: new THREE.Color(0x2563eb),
      nebulaSecondary: new THREE.Color(0x1e3a8a),
      starColor: new THREE.Color(0xbfdbfe),
      rimColor: new THREE.Color(0x3b82f6),
      parallaxDepth: 0.16,
      layer2Scale: 1.5,
      flowSpeed: 0.0,
      sparkleRate: 1.25,
      fresnelPower: 3.1,
      audioReactivity: 0.22,
      isCanonical: false,
      isVideoArtifact: true,
      videoPath: '/assets/viewmodel/karambit/videos/blue-marble.mp4',
      exposure: 1.15,
      contrast: 1.06,
      emission: 1.08,
      uvScale: 1.0
    }
  },
  {
    id: 'ACID_ARTIFACT',
    name: '21 // ACID',
    codename: 'HYPER-REACTIVE TOXIN',
    description: 'Corrosive neon lime reagent bubbling in ultra-thin titanium capillaries with an intense toxic glow.',
    unlockRequirement: 'DISCOVERED THROUGH A SIGNAL DROP',
    shortRequirement: 'SIGNAL DROP',
    tier: 12,
    rarity: 'ARTIFACT',
    dropEligible: true,
    dropWeight: 1,
    paletteTag: 'ACID // #84CC16',
    profile: {
      baseColor: new THREE.Color(0x0e1806),
      nebulaPrimary: new THREE.Color(0x84cc16),
      nebulaSecondary: new THREE.Color(0x3f6212),
      starColor: new THREE.Color(0xd9f99d),
      rimColor: new THREE.Color(0xa3e635),
      parallaxDepth: 0.15,
      layer2Scale: 1.45,
      flowSpeed: 0.0,
      sparkleRate: 1.35,
      fresnelPower: 3.2,
      audioReactivity: 0.26,
      isCanonical: false,
      isVideoArtifact: true,
      videoPath: '/assets/viewmodel/karambit/videos/acid.mp4',
      exposure: 1.18,
      contrast: 1.1,
      emission: 1.12,
      uvScale: 1.0
    }
  },
  {
    id: 'RAINBOW_VORTEX_ARTIFACT',
    name: '22 // RAINBOW VORTEX',
    codename: 'CHROMATIC SINGULARITY',
    description: 'A multi-spectral gravitational whirlpool bending chromatic light around a rotating event horizon.',
    unlockRequirement: 'DISCOVERED THROUGH A SIGNAL DROP',
    shortRequirement: 'SIGNAL DROP',
    tier: 12,
    rarity: 'ARTIFACT',
    dropEligible: true,
    dropWeight: 1,
    paletteTag: 'VORTEX // #A855F7',
    profile: {
      baseColor: new THREE.Color(0x140a20),
      nebulaPrimary: new THREE.Color(0xa855f7),
      nebulaSecondary: new THREE.Color(0x581c87),
      starColor: new THREE.Color(0xf3e8ff),
      rimColor: new THREE.Color(0xc084fc),
      parallaxDepth: 0.17,
      layer2Scale: 1.5,
      flowSpeed: 0.0,
      sparkleRate: 1.3,
      fresnelPower: 3.1,
      audioReactivity: 0.24,
      isCanonical: false,
      isVideoArtifact: true,
      videoPath: '/assets/viewmodel/karambit/videos/rainbow-vortex.mp4',
      exposure: 1.16,
      contrast: 1.08,
      emission: 1.1,
      uvScale: 1.0
    }
  },
  {
    id: 'BLUE_GEM',
    name: '23 // BLUE GEM',
    codename: 'AZURE LATTICE',
    description: 'Dense azure crystal aggregate shot through with raw gold veining. A static signal interior that reads as solid mineral rather than light.',
    unlockRequirement: 'DISCOVERED THROUGH A SIGNAL DROP',
    shortRequirement: 'SIGNAL DROP',
    tier: 13,
    rarity: 'RARE',
    dropEligible: true,
    dropWeight: 1,
    paletteTag: 'AZURE // #1E6BFF',
    profile: {
      baseColor: new THREE.Color(0x0a1c4a),
      nebulaPrimary: new THREE.Color(0x1e6bff),
      nebulaSecondary: new THREE.Color(0xc9962e),
      starColor: new THREE.Color(0xdff0ff),
      rimColor: new THREE.Color(0x4da6ff),
      parallaxDepth: 0.2,
      layer2Scale: 1.8,
      flowSpeed: 0.0,
      sparkleRate: 1.4,
      fresnelPower: 2.9,
      audioReactivity: 0.22,
      isCanonical: false,
      texturePath: '/assets/viewmodel/karambit/textures/blue_gem_cosmic.webp',
      exposure: 1.2,
      contrast: 1.06,
      emission: 1.15,
      uvScale: 1.0
    }
  }
];

export const TOTAL_SIGNAL_PACK_TRACKS = 14;

export class KarambitSkinSystem {
  private static instance: KarambitSkinSystem | null = null;

  public static getInstance(): KarambitSkinSystem {
    if (!this.instance) {
      this.instance = new KarambitSkinSystem();
    }
    return this.instance;
  }

  private trackRecords: Record<string, RunRank> = {};
  private equippedSkinId = 'SIGNAL_CYAN';
  private devPreviewEnabled = false;
  /**
   * EPHEMERAL replay skin override. NEVER persisted, never the equipped skin.
   * Set only while a replay/review is on screen and cleared on exit.
   */
  private replayPreviewSkinId: string | null = null;
  /**
   * PREVIEW-ONLY selection (Armory / showcase instances). Mirrors the replay
   * override shape but is scoped to a preview instance; it never reaches the
   * gameplay singleton and never persists.
   */
  private previewSkinId: string | null = null;
  private listeners: Array<(skinId: string) => void> = [];
  private committedListeners: Array<() => void> = [];
  private skinTextures: Map<string, THREE.Texture> = new Map();
  private textureLoader = new THREE.TextureLoader();
  private activeVideo: { skinId: string; quality: 'STANDARD' | 'LOW'; element: HTMLVideoElement; texture: THREE.VideoTexture } | null = null;
  /** Which animated-cosmetic encode to decode. Presentation only. */
  private videoQuality: 'STANDARD' | 'LOW' = 'STANDARD';
  /**
   * SERVER-DRIVEN OPEN HOOK.
   *
   * The Armory sets this to a CloudProgression call that performs the atomic
   * open_signal_drop RPC. When it is present, opening a STRUCTURED drop is
   * decided entirely by the server (weighting, duplicate protection, ownership,
   * persistence). The client only animates the resolved result, so it can never
   * reroll, double-spend or mint a premium id.
   */
  private structuredDropOpener:
    | ((dropId: string) => Promise<{
        dropId: string;
        cosmeticId: string | null;
        kind: 'KNIFE' | 'GLOVE' | null;
        rarity?: CosmeticRarity;
      }>)
    | null = null;

  private progression: SignalDropProgressionV2 = this.createDefaultProgression();
  /** Bumped on account switch so in-flight drop opens cannot cross accounts. */
  private accountGeneration = 0;

  private readonly STORAGE_KEY_RECORDS = 'playhead.karambit.trackRecords';
  private readonly STORAGE_KEY_EQUIPPED = 'playhead.karambit.equippedSkin';
  private readonly STORAGE_KEY_DEV = 'playhead.karambit.devPreview';
  /**
   * TRUE for an ephemeral preview instance (Armory / showcase). A preview
   * instance owns ONLY the textures/video it explicitly previews: it never
   * reads or writes localStorage, never touches the equipped skin, never
   * retains the gameplay cosmetic, and its dispose()/suspendActiveVideo()
   * affect only its own resources. Gameplay defaults are therefore untouched
   * while an Armory preview is on screen.
   */
  private readonly previewOnly: boolean;

  private constructor(previewOnly = false) {
    this.previewOnly = previewOnly;
    if (!previewOnly) {
      this.loadState();
      this.preloadTextures();
    }
  }

  /**
   * Creates an isolated, non-persistent KarambitSkinSystem for a preview
   * surface. Same class, same shader/material paths and catalog; separate
   * texture/video ownership so previewing can never disturb gameplay.
   */
  public static createPreviewInstance(): KarambitSkinSystem {
    return new KarambitSkinSystem(true);
  }

  /**
   * STARTUP IS LAZY.
   *
   * Only the EQUIPPED skin's static texture is fetched at boot. Previously every
   * cosmetic texture was downloaded and uploaded up front, which pinned ~28 MB
   * of GPU texture memory and ~12 MB of network for skins the player was not
   * even using. Browsing the Armory must never pay that cost.
   */
  private preloadTextures(): void {
    if (typeof window === 'undefined') return;
    this.retainStaticTextureFor(this.equippedSkinId);
  }

  /**
   * Keeps exactly one static texture resident (the retained skin's) and disposes
   * every other cached one. Bounds GPU texture memory to a single cosmetic
   * instead of growing as the player browses the Armory.
   *
   * Video-backed skins keep no static texture; their lifecycle is handled by
   * releaseActiveVideoTexture().
   */
  private retainStaticTextureFor(skinId: string): void {
    for (const [id, texture] of this.skinTextures) {
      if (id === skinId) continue;
      texture.dispose();
      this.skinTextures.delete(id);
    }
    const skin = this.getSkin(skinId);
    if (skin.profile.texturePath && !skin.profile.videoPath) {
      this.getSkinTexture(skinId);
    }
  }

  public getSkinTexture(skinId: string): THREE.Texture | null {
    const skin = this.getSkin(skinId);
    if (skin.profile.videoPath) {
      return this.getEquippedVideoTexture(skin);
    }

    if (this.skinTextures.has(skinId)) {
      return this.skinTextures.get(skinId)!;
    }
    if (!skin || !skin.profile.texturePath) return null;

    if (typeof document === 'undefined') {
      const fallbackTex = new THREE.Texture();
      this.skinTextures.set(skinId, fallbackTex);
      return fallbackTex;
    }

    const tex = this.textureLoader.load(
      skin.profile.texturePath,
      (loadedTex) => {
        loadedTex.wrapS = THREE.RepeatWrapping;
        loadedTex.wrapT = THREE.RepeatWrapping;
        loadedTex.minFilter = THREE.LinearMipmapLinearFilter;
        loadedTex.magFilter = THREE.LinearFilter;
        loadedTex.generateMipmaps = true;
        loadedTex.needsUpdate = true;
        this.notifyListeners();
      },
      undefined,
      (err) => console.warn(`[KarambitSkinSystem] Failed to load skin texture for ${skinId}:`, err)
    );
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    this.skinTextures.set(skinId, tex);
    return tex;
  }

  private getEquippedVideoTexture(skin: KarambitSkin): THREE.VideoTexture | null {
    const allowed = skin.id === this.equippedSkinId || skin.id === this.previewSkinId;
    if (!skin.profile.videoPath || !allowed || typeof document === 'undefined') {
      return null;
    }
    if (this.activeVideo?.skinId === skin.id && this.activeVideo.quality === this.videoQuality) {
      return this.activeVideo.texture;
    }

    this.releaseActiveVideoTexture();

    const url = this.videoUrlFor(skin);
    if (!url) return null;

    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.controls = false;
    video.disablePictureInPicture = true;

    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    this.activeVideo = { skinId: skin.id, quality: this.videoQuality, element: video, texture };

    try {
      const playResult = video.play();
      playResult?.catch(() => {
        // Muted autoplay can still be denied until the next user gesture.
      });
    } catch {
      // The material remains valid and the first frame can still be sampled.
    }
    return texture;
  }

  /**
   * Resolves the encode for the current quality tier.
   *
   * Convention: `<name>.mp4` is the standard encode and `<name>.low.mp4` is the
   * reduced one. The low variant is only fetched when a weak tier is active, so
   * a strong machine never pays for it.
   */
  private videoUrlFor(skin: KarambitSkin): string | null {
    const base = skin.profile.videoPath;
    if (!base) return null;
    if (this.videoQuality === 'LOW') return base.replace(/\.mp4$/, '.low.mp4');
    return base;
  }

  /**
   * Presentation-only: selects which animated-cosmetic encode is decoded.
   * Never touches gameplay, and never affects the frozen knife socket.
   */
  public setVideoQuality(quality: 'STANDARD' | 'LOW'): void {
    if (quality === this.videoQuality) return;
    this.videoQuality = quality;
    // Force the next material application to rebuild the video at the new size.
    if (this.activeVideo) this.releaseActiveVideoTexture();
    this.notifyListeners();
  }

  public getVideoQuality(): 'STANDARD' | 'LOW' {
    return this.videoQuality;
  }

  /** DEV diagnostics: what the animated cosmetic is actually doing right now. */
  public getVideoDiagnostics(): {
    activeSkinId: string | null;
    quality: 'STANDARD' | 'LOW';
    width: number;
    height: number;
    readyState: number;
    paused: boolean;
    src: string;
  } | null {
    if (!this.activeVideo) return null;
    const v = this.activeVideo.element;
    return {
      activeSkinId: this.activeVideo.skinId,
      quality: this.activeVideo.quality,
      width: v.videoWidth,
      height: v.videoHeight,
      readyState: v.readyState,
      paused: v.paused,
      src: v.currentSrc || v.src
    };
  }

  /** Number of live VideoTextures (must never exceed one). */
  public getActiveVideoCount(): number {
    return this.activeVideo ? 1 : 0;
  }

  /** Number of resident static cosmetic textures (must never exceed one). */
  public getResidentTextureCount(): number {
    return this.skinTextures.size;
  }

  private releaseActiveVideoTexture(): void {
    if (!this.activeVideo) return;
    const { element, texture } = this.activeVideo;
    try {
      element.pause();
      element.removeAttribute('src');
      element.load();
    } catch {
      // Some test/browser media shims do not implement the full lifecycle.
    }
    texture.dispose();
    this.activeVideo = null;
  }

  public getActiveVideoSkinId(): string | null {
    return this.activeVideo?.skinId ?? null;
  }

  /**
   * Releases the active video element without changing the equip or any
   * ownership. Called when the world is left (menu / Armory / account screens),
   * so an equipped ARTIFACT never keeps decoding offscreen. The next material
   * application in gameplay lazily recreates it, and the same-id path resumes
   * instantly because releaseActiveVideoTexture() fully re-initializes.
   */
  public suspendActiveVideo(): void {
    this.releaseActiveVideoTexture();
  }

  private createEmptyRewardBags(): Record<RunRank, string[]> {
    return { BRONZE: [], SILVER: [], GOLD: [], DIAMOND: [] };
  }

  private createEmptyRewardBagCursors(): Record<RunRank, number> {
    return { BRONZE: 0, SILVER: 0, GOLD: 0, DIAMOND: 0 };
  }

  private createDefaultProgression(): SignalDropProgressionV2 {
    return {
      version: SIGNAL_DROP_PROGRESSION_VERSION,
      awardedRankKeys: [],
      pendingDropRanks: [],
      rewardOwnedSkinIds: [],
      rewardBags: this.createEmptyRewardBags(),
      rewardBagCursors: this.createEmptyRewardBagCursors(),
      rngState: DEFAULT_REWARD_RNG_STATE,
      unopenedDropIds: [],
      openedDropIds: [],
      pendingLocalAwardIds: [],
      awardedDiamondDropKeys: []
    };
  }

  /**
   * Sanitizes a structured drop-id ledger. Ids are server-issued uuids or the
   * conservative 'legacy:<rank>' migration keys; anything else is dropped.
   */
  private sanitizeDropIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const item of value) {
      if (typeof item !== 'string' || item.length === 0 || item.length > 96) continue;
      if (/^[0-9a-fA-F-]{36}$/.test(item) || /^legacy:[A-Z]+$/.test(item)) {
        if (!out.includes(item)) out.push(item);
      }
    }
    return out.slice(0, 512);
  }

  private isRunRank(value: unknown): value is RunRank {
    return value === 'BRONZE' || value === 'SILVER' || value === 'GOLD' || value === 'DIAMOND';
  }

  private loadProgression(raw: string | null): void {
    this.progression = this.createDefaultProgression();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<SignalDropProgressionV2>;
      if (parsed.version !== SIGNAL_DROP_PROGRESSION_VERSION) return;

      const officialIds = SignalPackCatalog.getTracks().map(track => track.id);
      const validRankKeys = new Set(
        officialIds.flatMap(levelId => RANK_THRESHOLDS.map(rank => `${levelId}:${rank}`))
      );
      const rewardIds = new Set(KARAMBIT_SKINS.filter(skin => skin.dropEligible).map(skin => skin.id));
      // Signal Drop GLOVES live in their own validated id space.
      const gloveIds = new Set<string>(dropEligibleGloves().map(glove => glove.id));
      const uniqueStrings = (value: unknown, allowed: Set<string>): string[] => {
        if (!Array.isArray(value)) return [];
        return [...new Set(value.filter((item): item is string => typeof item === 'string' && allowed.has(item)))];
      };
      const rewardBags = this.createEmptyRewardBags();
      const rewardBagCursors = this.createEmptyRewardBagCursors();
      for (const rank of RANK_THRESHOLDS) {
        const rawBag = parsed.rewardBags?.[rank];
        rewardBags[rank] = Array.isArray(rawBag)
          ? rawBag.filter((item): item is string => typeof item === 'string' && rewardIds.has(item))
          : [];
        const rawCursor = parsed.rewardBagCursors?.[rank];
        rewardBagCursors[rank] = Number.isFinite(rawCursor)
          ? Math.max(0, Math.min(rewardBags[rank].length, Math.floor(rawCursor as number)))
          : 0;
      }

      // Additive glove ledgers. Validated against the glove catalog so a corrupt
      // or forged entry can never invent ownership.
      const gloveRewardBags = this.createEmptyRewardBags();
      const gloveRewardBagCursors = this.createEmptyRewardBagCursors();
      for (const rank of RANK_THRESHOLDS) {
        const rawBag = parsed.gloveRewardBags?.[rank];
        gloveRewardBags[rank] = Array.isArray(rawBag)
          ? rawBag.filter((item): item is string => typeof item === 'string' && gloveIds.has(item))
          : [];
        const rawCursor = parsed.gloveRewardBagCursors?.[rank];
        gloveRewardBagCursors[rank] = Number.isFinite(rawCursor)
          ? Math.max(0, Math.min(gloveRewardBags[rank].length, Math.floor(rawCursor as number)))
          : 0;
      }

      this.progression = {
        version: SIGNAL_DROP_PROGRESSION_VERSION,
        awardedRankKeys: uniqueStrings(parsed.awardedRankKeys, validRankKeys),
        pendingDropRanks: Array.isArray(parsed.pendingDropRanks)
          ? parsed.pendingDropRanks.filter((rank): rank is RunRank => this.isRunRank(rank)).slice(0, 1000)
          : [],
        rewardOwnedSkinIds: uniqueStrings(parsed.rewardOwnedSkinIds, rewardIds),
        rewardBags,
        rewardBagCursors,
        rngState: Number.isFinite(parsed.rngState) && (parsed.rngState as number) !== 0
          ? (parsed.rngState as number) >>> 0
          : DEFAULT_REWARD_RNG_STATE,
        lastRewardSkinId: typeof parsed.lastRewardSkinId === 'string' && rewardIds.has(parsed.lastRewardSkinId)
          ? parsed.lastRewardSkinId
          : undefined,
        // Additive Signal Drop GLOVE state.
        rewardOwnedGloveIds: uniqueStrings(parsed.rewardOwnedGloveIds, gloveIds),
        gloveRewardBags,
        gloveRewardBagCursors,
        lastRewardGloveId:
          typeof parsed.lastRewardGloveId === 'string' && gloveIds.has(parsed.lastRewardGloveId)
            ? parsed.lastRewardGloveId
            : undefined,
        // Structured, cloud-authoritative drop ledgers.
        unopenedDropIds: this.sanitizeDropIds(parsed.unopenedDropIds),
        openedDropIds: this.sanitizeDropIds(parsed.openedDropIds),
        pendingLocalAwardIds: this.sanitizeDropIds(parsed.pendingLocalAwardIds),
        awardedDiamondDropKeys: Array.isArray(parsed.awardedDiamondDropKeys)
          ? [...new Set(parsed.awardedDiamondDropKeys.filter(
              (k): k is string => typeof k === 'string' && !!SignalPackCatalog.getTrackById(k)
            ))]
          : []
      };
    } catch {
      this.progression = this.createDefaultProgression();
    }
  }

  private loadState(): void {
    if (typeof localStorage === 'undefined') return;

    try {
      const recordsRaw = localStorage.getItem(this.STORAGE_KEY_RECORDS);
      if (recordsRaw) {
        const parsed = JSON.parse(recordsRaw) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          this.trackRecords = Object.fromEntries(
            Object.entries(parsed).filter((entry): entry is [string, RunRank] => this.isRunRank(entry[1]))
          );
        }
      }
    } catch (e) {
      console.warn('[KarambitSkinSystem] Ignoring malformed legacy track records:', e);
      this.trackRecords = {};
    }
    try {
      this.loadProgression(localStorage.getItem(SIGNAL_DROP_STORAGE_KEY));
    } catch (e) {
      console.warn('[KarambitSkinSystem] Failed to load Signal Drop progression:', e);
      this.progression = this.createDefaultProgression();
    }
    try {
      const devRaw = localStorage.getItem(this.STORAGE_KEY_DEV);
      this.devPreviewEnabled = devRaw === 'true';

      const equipped = localStorage.getItem(this.STORAGE_KEY_EQUIPPED);
      if (equipped && KARAMBIT_SKINS.some(s => s.id === equipped) && this.isSkinUnlocked(equipped)) {
        this.equippedSkinId = equipped;
      }
    } catch (e) {
      console.warn('[KarambitSkinSystem] Failed to load equipped skin state:', e);
    }
  }

  private saveState(): void {
    if (this.previewOnly) return;
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.STORAGE_KEY_RECORDS, JSON.stringify(this.trackRecords));
      localStorage.setItem(this.STORAGE_KEY_EQUIPPED, this.equippedSkinId);
      localStorage.setItem(this.STORAGE_KEY_DEV, this.devPreviewEnabled ? 'true' : 'false');
      localStorage.setItem(SIGNAL_DROP_STORAGE_KEY, JSON.stringify(this.progression));
    } catch (e) {
      console.warn('[KarambitSkinSystem] Failed to save skin state:', e);
    }
  }

  public getSkins(): KarambitSkin[] {
    return KARAMBIT_SKINS;
  }

  public getSkin(id: string): KarambitSkin {
    if (!id) return KARAMBIT_SKINS[0];
    const norm = id.toUpperCase();
    const found = KARAMBIT_SKINS.find(s => s.id === id || s.id === norm || s.id.toLowerCase() === id.toLowerCase());
    return found || KARAMBIT_SKINS[0];
  }

  public getEquippedSkin(): KarambitSkin {
    return this.getSkin(this.equippedSkinId);
  }

  public getEquippedSkinId(): string {
    return this.equippedSkinId;
  }

  public equipSkin(id: string): boolean {
    const target = this.getSkin(id);
    if (!this.isSkinUnlocked(target.id) && !this.devPreviewEnabled) {
      return false;
    }
    if (target.id === this.equippedSkinId) return true;
    this.releaseActiveVideoTexture();
    this.equippedSkinId = target.id;
    // Drop the previous cosmetic's static texture so GPU memory does not grow
    // as the player switches skins.
    this.retainStaticTextureFor(target.id);
    this.saveState();
    this.notifyListeners();
    this.notifyCommitted();
    return true;
  }

  /**
   * Applies a REPLAY-ONLY EPHEMERAL skin for a replay/review WITHOUT
   * mutating the player's equipped loadout or persisting anything.
   *
   * Unlike equipSkin() this never writes localStorage, never notifies the equip
   * listeners (so an equip-driven save cannot run) and never releases/retains
   * the static texture registry. Unknown ids fall back to the canonical skin, so
   * an old replay referencing a removed cosmetic cannot break playback.
   *
   * The viewmodel renders this preview until setReplaySkinPreview(null).
   */
  public setReplaySkinPreview(id: string | null): void {
    this.replayPreviewSkinId = id ? this.getSkin(id).id : null;
  }

  public getReplaySkinPreviewId(): string | null {
    return this.replayPreviewSkinId;
  }

  /** The cosmetic the viewmodel should render right now (preview wins). */
  public getRenderSkinId(): string {
    return this.replayPreviewSkinId ?? this.equippedSkinId;
  }

  // -- PREVIEW-ONLY instances (Armory / showcase) --------------------------

  /**
   * Selects the skin a PREVIEW instance should render. Resolves unknown ids to
   * the canonical skin (never throws), releases any static texture/video the
   * PREVIOUS preview selection owned, and never touches equipped state.
   */
  public setPreviewSkin(id: string | null): void {
    const resolved = id ? this.getSkin(id).id : null;
    if (resolved === this.previewSkinId) return;
    this.previewSkinId = resolved;
    if (this.previewOnly) this.retainPreviewTextureFor(resolved);
  }

  public getPreviewSkinId(): string | null {
    return this.previewSkinId;
  }

  /**
   * The skin id an instance should apply to a material: the preview selection
   * when one is set, otherwise the equipped skin. On a preview instance with no
   * selection this is the safe canonical skin, never the player's equipped
   * (possibly video-backed) cosmetic.
   */
  public getActiveRenderSkinId(): string {
    if (this.previewSkinId) return this.previewSkinId;
    return this.previewOnly ? 'SIGNAL_CYAN' : this.equippedSkinId;
  }

  /**
   * Bounds preview-instance GPU memory to exactly the selected cosmetic: keeps
   * the selected static texture resident and disposes every other cached one,
   * and releases the active preview video when the selection changes away from
   * it. Video-backed skins keep no static texture (same rule as gameplay).
   */
  private retainPreviewTextureFor(skinId: string | null): void {
    if (!skinId) {
      for (const texture of this.skinTextures.values()) texture.dispose();
      this.skinTextures.clear();
      this.releaseActiveVideoTexture();
      return;
    }
    for (const [id, texture] of this.skinTextures) {
      if (id === skinId) continue;
      texture.dispose();
      this.skinTextures.delete(id);
    }
    const skin = this.getSkin(skinId);
    if (this.activeVideo?.skinId !== skinId) this.releaseActiveVideoTexture();
    if (!skin.profile.videoPath && skin.profile.texturePath) {
      this.getSkinTexture(skinId);
    }
  }

  public isDevPreview(): boolean {
    return this.devPreviewEnabled;
  }

  public setDevPreview(enabled: boolean): void {
    this.devPreviewEnabled = enabled;
    if (!enabled && !this.isSkinUnlocked(this.equippedSkinId)) {
      this.releaseActiveVideoTexture();
      this.equippedSkinId = 'SIGNAL_CYAN';
      this.retainStaticTextureFor('SIGNAL_CYAN');
    }
    this.saveState();
    this.notifyListeners();
  }

  public toggleDevPreview(): boolean {
    this.setDevPreview(!this.devPreviewEnabled);
    return this.devPreviewEnabled;
  }

  public addListener(fn: (skinId: string) => void): () => void {
    this.listeners.push(fn);
    return () => {
      const idx = this.listeners.indexOf(fn);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /**
   * Subscribes to REAL, PERSISTED player-owned changes only (earned unlock,
   * completed track, genuine equip, drop award). Cloud hydration, replay
   * preview, DEV preview and account-switch resets never fire this, so an
   * auto-save subscriber cannot be re-triggered by its own writes.
   */
  public addCommittedListener(fn: () => void): () => void {
    this.committedListeners.push(fn);
    return () => {
      const idx = this.committedListeners.indexOf(fn);
      if (idx >= 0) this.committedListeners.splice(idx, 1);
    };
  }

  private notifyCommitted(): void {
    for (const fn of this.committedListeners) {
      try {
        fn();
      } catch (err) {
        console.warn('[KarambitSkinSystem] Committed listener error:', err);
      }
    }
  }

  private notifyListeners(): void {
    for (const fn of this.listeners) {
      try {
        fn(this.equippedSkinId);
      } catch (err) {
        console.warn('[KarambitSkinSystem] Listener error:', err);
      }
    }
  }

  /**
   * Rank numerical values for comparison:
   * BRONZE = 1, SILVER = 2, GOLD = 3, DIAMOND = 4
   */
  private rankToValue(rank?: RunRank): number {
    switch (rank) {
      case 'DIAMOND': return 4;
      case 'GOLD': return 3;
      case 'SILVER': return 2;
      case 'BRONZE': return 1;
      default: return 0;
    }
  }

  public getTrackRecords(): Record<string, RunRank> {
    return { ...this.trackRecords };
  }

  /**
   * Replaces the local track-record ledger from an account snapshot.
   *
   * REPLACE, never merge: restoring account A's snapshot after account B must
   * never leave B's track records in place.
   */
  public setTrackRecords(records: Record<string, RunRank> | null | undefined): void {
    const next: Record<string, RunRank> = {};
    for (const [k, v] of Object.entries(records ?? {})) {
      if (typeof k !== 'string' || k.length === 0) continue;
      if (v !== 'BRONZE' && v !== 'SILVER' && v !== 'GOLD' && v !== 'DIAMOND') continue;
      next[k] = v;
    }
    this.trackRecords = next;
    this.saveState();
    this.notifyListeners();
  }

  public recordTrackCompletion(
    trackId: string,
    rank: RunRank,
    officialLevelId?: string | null
  ): TrackCompletionReward {
    const previousUnlocks = KARAMBIT_SKINS.filter(s => this.isSkinUnlocked(s.id));

    const curVal = this.rankToValue(this.trackRecords[trackId]);
    const newVal = this.rankToValue(rank);
    let stateChanged = false;
    if (newVal > curVal) {
      this.trackRecords[trackId] = rank;
      stateChanged = true;
    }

    const awardedDropRanks: RunRank[] = [];
    const isOfficial = !!officialLevelId && !!SignalPackCatalog.getTrackById(officialLevelId);
    if (isOfficial) {
      const newlyReached = RANK_THRESHOLDS
        .filter(threshold => this.rankToValue(threshold) <= newVal)
        .filter(threshold => !this.progression.awardedRankKeys.includes(`${officialLevelId}:${threshold}`))
        .reverse();
      const diamondKeys = (this.progression.awardedDiamondDropKeys ??= []);
      for (const threshold of newlyReached) {
        this.progression.awardedRankKeys.push(`${officialLevelId}:${threshold}`);
        // ONE durable Signal Drop per account per unique official track: the
        // FIRST DIAMOND only. BRONZE/SILVER/GOLD, a repeated DIAMOND and custom
        // audio never mint a drop. The real award is server-issued (the
        // submit-run Edge Function returns signal_drop_id); this only records
        // the tracking achievement and raises the concise results notification.
        if (threshold === 'DIAMOND' && !diamondKeys.includes(officialLevelId)) {
          diamondKeys.push(officialLevelId);
          awardedDropRanks.push(threshold);
        }
      }
    }
    if (awardedDropRanks.length > 0) {
      stateChanged = true;
    }

    if (stateChanged) {
      this.saveState();
      this.notifyCommitted();
    }

    const currentUnlocks = KARAMBIT_SKINS.filter(s => this.isSkinUnlocked(s.id));
    const newlyUnlocked = currentUnlocks.filter(s => !previousUnlocks.some(prev => prev.id === s.id));

    return {
      newlyUnlocked,
      dropAwarded: awardedDropRanks.length > 0,
      dropsAwarded: awardedDropRanks.length,
      awardedDropRanks,
      pendingDrops: this.progression.pendingDropRanks.length
    };
  }

  /**
   * Unopened drops = SERVER-issued structured drops + DEV/legacy pending ranks.
   * The structured list is the authoritative one; the legacy list exists only so
   * the offline DEV decoder and pre-migration devices keep working.
   */
  /** Wires the server-side opener (CloudProgression). Web-only; optional. */
  public setStructuredDropOpener(
    opener:
      | ((dropId: string) => Promise<{
          dropId: string;
          cosmeticId: string | null;
          kind: 'KNIFE' | 'GLOVE' | null;
          rarity?: CosmeticRarity;
        }>)
      | null
  ): void {
    this.structuredDropOpener = opener;
  }

  /**
   * Whether a SERVER-ISSUED structured drop is pending. When true the UI must
   * open through the server (openNextDrop) rather than the offline roller.
   */
  public hasStructuredDropPending(): boolean {
    return !!this.structuredDropOpener && (this.progression.unopenedDropIds?.length ?? 0) > 0;
  }

  public getPendingDropCount(): number {
    if (this.structuredDropOpener) return this.progression.unopenedDropIds?.length ?? 0;
    return this.progression.pendingDropRanks.length + (this.progression.unopenedDropIds?.length ?? 0);
  }

  public getPendingDropRanks(): RunRank[] {
    return [...this.progression.pendingDropRanks];
  }

  /** Legacy/DEV pending rank count only (excludes structured server drops). */
  public getLegacyPendingDropCount(): number {
    return this.progression.pendingDropRanks.length;
  }

  /**
   * Opens the NEXT pending drop.
   *
   * PRODUCTION (a cloud opener IS configured): ONLY a server-issued drop id can
   * ever be opened. A legacy/DEV `pendingDropRanks` entry is NOT a real award in
   * this mode, so when no server id is pending this returns null rather than
   * falling back to the offline rank roller — a local flag can never mint
   * premium ownership. The server path is idempotent and cannot reroll.
   *
   * OFFLINE / DEV (no opener configured): the legacy rank roller is used, which
   * keeps the dedicated dev fixtures and pre-cloud devices working.
   */
  public async openNextDrop(): Promise<OpenedSignalDrop | null> {
    const hasOpener = !!this.structuredDropOpener;
    const dropId = this.progression.unopenedDropIds?.[0];
    if (hasOpener && !dropId) {
      // No server-issued drop is pending: NOTHING may be opened. Never fall
      // through to the client roller while a cloud opener is configured.
      return null;
    }
    if (dropId && this.structuredDropOpener) {
      // ACCOUNT-SCOPED GENERATION: capture the identity of the account that
      // STARTED this open. resetProgressionForAccountSwitch() bumps the counter,
      // so a resolution that arrives AFTER a switch is discarded instead of
      // being applied to (and saved into) the wrong account.
      const generation = this.accountGeneration;
      const res = await this.structuredDropOpener(dropId);
      if (generation !== this.accountGeneration) {
        throw new Error('account changed');
      }
      // The opener may have echoed a different id; never apply an id this
      // account did not have pending.
      if (!(this.progression.unopenedDropIds ?? []).includes(res.dropId)) {
        throw new Error('drop no longer pending for this account');
      }
      return this.applyServerDropResult({
        dropId: res.dropId,
        cosmeticId: res.cosmeticId,
        kind: res.kind,
        rarity: res.rarity
      });
    }
    return this.openSignalDrop();
  }

  /** Server-issued, unopened drop ids (cloud-authoritative). */
  public getUnopenedDropIds(): string[] {
    return [...(this.progression.unopenedDropIds ?? [])];
  }

  /** Drop ids already opened/spent (mirror of the server's open ledger). */
  public getOpenedDropIds(): string[] {
    return [...(this.progression.openedDropIds ?? [])];
  }

  /** Unique official tracks whose first DIAMOND has already paid out a drop. */
  public getAwardedDiamondDropKeys(): string[] {
    return [...(this.progression.awardedDiamondDropKeys ?? [])];
  }

  public hasUnopenedDrops(): boolean {
    return (this.progression.unopenedDropIds?.length ?? 0) > 0 ||
      this.progression.pendingDropRanks.length > 0;
  }

  /**
   * Records a SERVER-ISSUED drop id (from a submit-run response) so the next
   * Armory visit can open it. This only mirrors the server; it never mints
   * ownership and never invents a premium id.
   */
  public mergeCloudDropAward(dropId: string | null | undefined): void {
    if (typeof dropId !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(dropId)) return;
    const ids = (this.progression.unopenedDropIds ??= []);
    if (ids.includes(dropId)) return;
    ids.push(dropId);
    // Mark it as a LOCAL in-flight award so reconciliation does not discard it
    // as stale before the server ledger can echo it back.
    const local = (this.progression.pendingLocalAwardIds ??= []);
    if (!local.includes(dropId)) local.push(dropId);
    this.saveState();
    this.notifyListeners();
  }

  /**
   * Applies the SERVER's resolved open result. The server already persisted the
   * outcome and the ownership, so this only mirrors it locally: the drop leaves
   * the unopened set, the cosmetic becomes owned, and an idempotent replay of
   * the same drop can never reroll or double-award.
   */
  public applyServerDropResult(result: {
    dropId: string;
    cosmeticId: string | null;
    kind: 'KNIFE' | 'GLOVE' | null;
    rarity?: CosmeticRarity;
  }): OpenedSignalDrop | null {
    const ids = (this.progression.unopenedDropIds ??= []);
    const idx = ids.indexOf(result.dropId);
    if (idx >= 0) ids.splice(idx, 1);
    const opened = (this.progression.openedDropIds ??= []);
    if (!opened.includes(result.dropId)) opened.push(result.dropId);
    const local = this.progression.pendingLocalAwardIds ?? [];
    if (local.includes(result.dropId)) {
      this.progression.pendingLocalAwardIds = local.filter((id) => id !== result.dropId);
    }

    const cosmeticId = result.cosmeticId;
    if (!cosmeticId) {
      this.saveState();
      this.notifyListeners();
      this.notifyCommitted();
      return {
        kind: 'KNIFE',
        item: this.knifeDropItem(this.getEquippedSkin()),
        name: this.getEquippedSkin().name,
        codename: this.getEquippedSkin().codename,
        rarity: this.getEquippedSkin().rarity,
        accentTag: this.getEquippedSkin().paletteTag,
        isLive: !!this.getEquippedSkin().profile.isVideoArtifact,
        skin: this.getEquippedSkin(),
        sourceRank: 'DIAMOND',
        qualityLabel: this.getQualityLabel('DIAMOND'),
        isCollectionComplete: true,
        dropId: result.dropId
      };
    }

    if (result.kind === 'GLOVE' || isDropGloveId(cosmeticId)) {
      const glove = getDropGlove(cosmeticId);
      const owned = (this.progression.rewardOwnedGloveIds ??= []);
      if (glove && !owned.includes(glove.id)) owned.push(glove.id);
      this.saveState();
      this.notifyListeners();
      this.notifyCommitted();
      return glove
        ? { ...this.buildGloveDrop(glove, 'DIAMOND'), dropId: result.dropId }
        : null;
    }

    const skin = this.getSkin(cosmeticId);
    if (!this.progression.rewardOwnedSkinIds.includes(skin.id)) {
      this.progression.rewardOwnedSkinIds.push(skin.id);
    }
    this.saveState();
    this.notifyListeners();
    this.notifyCommitted();
    return { ...this.buildKnifeDrop(skin, 'DIAMOND'), dropId: result.dropId };
  }

  public getAwardedRankKeys(): string[] {
    return [...this.progression.awardedRankKeys];
  }

  /**
   * CLOUD HYDRATION.
   *
   * Applies a merged cloud progression onto the local device cache. This is the
   * ONLY external write path into progression, and it is deliberately additive:
   *
   * - `awardedRankKeys` is UNIONED (never removed), so the anti-re-award ledger
   *   can only grow. Losing an entry would let a rank threshold pay out twice.
   * - `rewardOwnedSkinIds` is UNIONED, so no unlock is ever lost and no
   *   duplicate can be created (the sanitizer de-duplicates).
   * - `pendingDropRanks` is SET from the server-derived value (awarded - spent),
   *   which is what makes drop state event-aware rather than a max() guess.
   * - `equippedSkinId` is applied only when it is a known, unlocked skin;
   *   otherwise it falls back safely to SIGNAL_CYAN.
   *
   * DEV preview state and calibration are never touched here.
   */
  /**
   * AUTHORITATIVE DROP-LEDGER RECONCILIATION.
   *
   * Unlike a union, this treats the server's ledger as the truth for the
   * PENDING set: a drop opened on another device disappears locally, and a
   * previously opened id is suppressed so it can never re-award. In-flight
   * local awards (an id the server has not yet returned) are preserved unless
   * they appear in `opened`. Ownership is only ever ADDED, never removed.
   */
  public applyCloudDropLedger(ledger: {
    unopened?: readonly string[];
    opened?: readonly string[];
    tracks?: readonly string[];
  }): void {
    const accepted = (raw: unknown): string | null => {
      if (typeof raw !== 'string' || raw.length === 0 || raw.length > 96) return null;
      if (/^[0-9a-fA-F-]{36}$/.test(raw) || /^legacy:[A-Z]+$/.test(raw)) return raw;
      return null;
    };
    const opened = new Set(
      (ledger.opened ?? []).map(accepted).filter((x): x is string => !!x)
    );
    let changed = false;

    if (ledger.unopened) {
      const serverUnopened = (ledger.unopened ?? [])
        .map(accepted)
        .filter((x): x is string => !!x && !opened.has(x));
      const previous = this.progression.unopenedDropIds ?? [];
      const localAwards = this.progression.pendingLocalAwardIds ?? [];
      // Keep ONLY a locally-awarded id that the server has not yet echoed. A
      // stale id that another device opened is NOT in localAwards, so it is
      // dropped here — the authoritative empty state is honored.
      const inFlight = previous.filter((id) => localAwards.includes(id) && !opened.has(id));
      const next = [...new Set([...serverUnopened, ...inFlight])];
      if (next.length !== previous.length || next.some((id, i) => id !== previous[i])) {
        this.progression.unopenedDropIds = next;
        changed = true;
      }
      // An id the server now reports unopened (or that was opened) is no longer
      // an un-echoed local award.
      const serverSeen = new Set([...serverUnopened, ...opened]);
      const nextLocal = localAwards.filter((id) => !serverSeen.has(id));
      if (nextLocal.length !== localAwards.length) {
        this.progression.pendingLocalAwardIds = nextLocal;
        changed = true;
      }
    }

    const openedList = [...(this.progression.openedDropIds ?? [])];
    for (const id of opened) {
      if (!openedList.includes(id)) openedList.push(id);
    }
    if (openedList.length !== (this.progression.openedDropIds ?? []).length) {
      this.progression.openedDropIds = openedList;
      changed = true;
    }

    if (ledger.tracks) {
      const tracks = [...(this.progression.awardedDiamondDropKeys ?? [])];
      for (const raw of ledger.tracks) {
        if (typeof raw !== 'string' || !SignalPackCatalog.getTrackById(raw)) continue;
        if (!tracks.includes(raw)) tracks.push(raw);
      }
      if (tracks.length !== (this.progression.awardedDiamondDropKeys ?? []).length) {
        this.progression.awardedDiamondDropKeys = tracks;
        changed = true;
      }
    }

    // Any id that is BOTH pending and recorded opened is a contradiction: the
    // server's opened ledger wins, so the stale pending entry is dropped.
    const cleaned = (this.progression.unopenedDropIds ?? []).filter((id) => !opened.has(id));
    if (cleaned.length !== (this.progression.unopenedDropIds ?? []).length) {
      this.progression.unopenedDropIds = cleaned;
      changed = true;
    }

    // SERVER-AUTHORITATIVE MODE: once the server ledger has hydrated, the
    // legacy/DEV `pendingDropRanks` counter is no longer a source of truth (a
    // real award is a server drop id, and the client roller is unreachable
    // while an opener is configured). Reconcile it to EMPTY here so the pending
    // count is not double-counted across devices and a legacy rank can never be
    // mistaken for an openable drop.
    if (this.structuredDropOpener && this.progression.pendingDropRanks.length > 0) {
      this.progression.pendingDropRanks = [];
      changed = true;
    }

    if (changed) {
      this.saveState();
      this.notifyListeners();
    }
  }

  public applyCloudProgression(cloud: {
    awardedRankKeys?: readonly string[];
    rewardOwnedSkinIds?: readonly string[];
    pendingDropRanks?: readonly RunRank[];
    equippedSkinId?: string;
    /** Server-issued unopened drop ids. UNIONED: a cloud drop is never lost. */
    unopenedDropIds?: readonly string[];
  }): void {
    let changed = false;

    if (cloud.awardedRankKeys) {
      const existing = new Set(this.progression.awardedRankKeys);
      for (const key of cloud.awardedRankKeys) {
        if (typeof key !== 'string' || key.length === 0) continue;
        if (existing.has(key)) continue;
        existing.add(key);
        this.progression.awardedRankKeys.push(key);
        changed = true;
      }
    }

    if (cloud.rewardOwnedSkinIds) {
      const existing = new Set(this.progression.rewardOwnedSkinIds);
      const ownedGloves = new Set(this.progression.rewardOwnedGloveIds ?? []);
      for (const id of cloud.rewardOwnedSkinIds) {
        if (typeof id !== 'string' || id.length === 0) continue;
        // The server ledger is a generic cosmetic-id ledger. Split by namespace so
        // a random cosmetic can never be mistaken for a knife (or the reverse),
        // and so Mastery ownership stays DERIVED and is never written here.
        if (isDropGloveId(id)) {
          if (ownedGloves.has(id)) continue;
          ownedGloves.add(id);
          this.progression.rewardOwnedGloveIds = [...ownedGloves];
          changed = true;
          continue;
        }
        if (existing.has(id)) continue;
        existing.add(id);
        this.progression.rewardOwnedSkinIds.push(id);
        changed = true;
      }
    }

    if (cloud.unopenedDropIds) {
      const ids = (this.progression.unopenedDropIds ??= []);
      for (const raw of cloud.unopenedDropIds) {
        if (typeof raw !== 'string') continue;
        if (!/^[0-9a-fA-F-]{36}$/.test(raw) && !/^legacy:[A-Z]+$/.test(raw)) continue;
        if (ids.includes(raw)) continue;
        ids.push(raw);
        changed = true;
      }
    }

    if (cloud.pendingDropRanks) {
      const valid = cloud.pendingDropRanks.filter(
        (r): r is RunRank => r === 'BRONZE' || r === 'SILVER' || r === 'GOLD' || r === 'DIAMOND'
      );
      const same =
        valid.length === this.progression.pendingDropRanks.length &&
        valid.every((r, i) => r === this.progression.pendingDropRanks[i]);
      if (!same) {
        this.progression.pendingDropRanks = valid.slice(0, 1000);
        changed = true;
      }
    }

    if (cloud.equippedSkinId) {
      const skin = this.getSkin(cloud.equippedSkinId);
      const known = this.getSkins().some((s) => s.id === skin.id);
      if (known && this.isSkinUnlocked(skin.id) && skin.id !== this.equippedSkinId) {
        this.equippedSkinId = skin.id;
        changed = true;
      } else if (!known && this.equippedSkinId !== 'SIGNAL_CYAN') {
        // Cloud referenced an unavailable/removed knife: fall back safely.
        this.equippedSkinId = 'SIGNAL_CYAN';
        changed = true;
      }
    }

    if (changed) {
      // Cloud state may have changed the equipped skin: reconcile resident
      // cosmetic resources so a cloud equip does not leak a video or texture.
      if (this.equippedSkinId !== this.activeVideo?.skinId) this.releaseActiveVideoTexture();
      this.retainStaticTextureFor(this.equippedSkinId);
      this.saveState();
      this.notifyListeners();
    }
  }

  public getAwardedDiamondLevelIds(): string[] {
    return this.progression.awardedRankKeys
      .filter(key => key.endsWith(':DIAMOND'))
      .map(key => key.slice(0, -':DIAMOND'.length));
  }

  /**
   * DEV testing helper: grants pending signals for repeatable decoder testing.
   * Preserves legitimate rank history.
   */
  public grantDevPendingSignals(count = 999, rank: RunRank = 'GOLD'): void {
    const ranks: RunRank[] = new Array(count).fill(rank);
    this.progression.pendingDropRanks.push(...ranks);
    this.saveState();
    this.notifyListeners();
  }

  /**
   * ACCOUNT SWITCH RESET.
   *
   * Clears every LOCAL progression ledger and the equipped selection so a
   * different registered account can never inherit (or upload) the previous
   * account's cosmetics, ranks or records.
   */
  public resetProgressionForAccountSwitch(): void {
    // Bump the account generation FIRST so any in-flight drop open that resolves
    // after this switch is discarded rather than applied to the new account.
    this.accountGeneration += 1;
    this.releaseActiveVideoTexture();
    this.progression = this.createDefaultProgression();
    this.trackRecords = {};
    this.equippedSkinId = 'SIGNAL_CYAN';
    this.retainStaticTextureFor('SIGNAL_CYAN');
    this.saveState();
    this.notifyListeners();
  }
  /**
   * DEV testing helper: clears all pending signals.
   */
  public clearDevPendingSignals(): void {
    this.progression.pendingDropRanks = [];
    this.saveState();
    this.notifyListeners();
  }

  /**
   * Grants a single signal drop (e.g. for custom audio first completion).
   */
  public grantSignalDrop(rank: RunRank = 'BRONZE'): void {
    this.progression.pendingDropRanks.push(rank);
    this.saveState();
    this.notifyListeners();
  }

  public getRewardOwnedSkinIds(): string[] {
    return [...this.progression.rewardOwnedSkinIds];
  }

  public isSkinRewardOwned(id: string): boolean {
    return this.progression.rewardOwnedSkinIds.includes(this.getSkin(id).id);
  }

  private nextRandom(): number {
    let state = this.progression.rngState >>> 0;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    this.progression.rngState = state >>> 0 || DEFAULT_REWARD_RNG_STATE;
    return this.progression.rngState / 0x100000000;
  }

  private refillRewardBag(rank: RunRank): void {
    const bag: string[] = [];
    const qualityWeights = SIGNAL_DROP_RARITY_WEIGHTS[rank];
    for (const skin of KARAMBIT_SKINS) {
      if (!skin.dropEligible) continue;
      const entries = qualityWeights[skin.rarity] * skin.dropWeight;
      for (let i = 0; i < entries; i++) bag.push(skin.id);
    }
    this.shuffleBag(bag);
    this.progression.rewardBags[rank] = bag;
    this.progression.rewardBagCursors[rank] = 0;
  }

  /**
   * Glove bags use the SAME rank-weighted rarity principles as knives, drawn from
   * the Signal Drop glove catalog. Separate bag, separate cursor, same rules.
   */
  private refillGloveBag(rank: RunRank): void {
    const bag: string[] = [];
    const qualityWeights = SIGNAL_DROP_RARITY_WEIGHTS[rank];
    for (const glove of dropEligibleGloves()) {
      const entries = qualityWeights[glove.rarity] * glove.dropWeight;
      for (let i = 0; i < entries; i++) bag.push(glove.id);
    }
    this.shuffleBag(bag);
    this.ensureGloveBags()[rank] = bag;
    this.ensureGloveBagCursors()[rank] = 0;
  }

  private shuffleBag(bag: string[]): void {
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(this.nextRandom() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }

  /** Lazily creates the additive glove bag ledger. */
  private ensureGloveBags(): Record<RunRank, string[]> {
    if (!this.progression.gloveRewardBags) {
      this.progression.gloveRewardBags = this.createEmptyRewardBags();
    }
    return this.progression.gloveRewardBags;
  }

  private ensureGloveBagCursors(): Record<RunRank, number> {
    if (!this.progression.gloveRewardBagCursors) {
      this.progression.gloveRewardBagCursors = this.createEmptyRewardBagCursors();
    }
    return this.progression.gloveRewardBagCursors;
  }

  /** Drop glove ids the player owns. Never includes a mastery glove. */
  public getOwnedDropGloveIds(): string[] {
    return [...(this.progression.rewardOwnedGloveIds ?? [])];
  }

  public isDropGloveOwned(id: string): boolean {
    return (this.progression.rewardOwnedGloveIds ?? []).includes(id);
  }

  /** Unified ownership check across both cosmetic families. */
  public isCosmeticOwned(id: string): boolean {
    if (getDropGlove(id)) return this.isDropGloveOwned(id);
    return this.isSkinRewardOwned(id);
  }

  /** Counts of UNOWNED eligible items per category, for duplicate protection. */
  private unownedAvailability(): Record<CosmeticKind, number> {
    const knives = KARAMBIT_SKINS.filter(
      (s) => s.dropEligible && !this.isSkinUnlockedWithoutDev(s.id)
    ).length;
    // NOTE: BLACKSTAR is dropEligible=false (reserved WORLD RECORD reward), so it
    // is already excluded here. It can still be owned by the DIAMOND-ALL unlock
    // or by a historical drop, and such ownership is preserved by the ledger.
    const gloves = dropEligibleGloves().filter(
      (g) => !this.isDropGloveOwned(g.id)
    ).length;
    return { KNIFE: knives, GLOVE: gloves };
  }

  public isGloveCollectionComplete(): boolean {
    const eligible = dropEligibleGloves();
    return eligible.length > 0 && eligible.every((g) => this.isDropGloveOwned(g.id));
  }

  private getNextRewardGlove(rank: RunRank): DropGlove | null {
    const eligible = dropEligibleGloves();
    if (eligible.length === 0) return null;

    const unowned = eligible.filter((g) => !this.isDropGloveOwned(g.id));
    if (unowned.length === 0) return null;

    const candidateIds = new Set<string>(unowned.map((g) => g.id));

    const bags = this.ensureGloveBags();
    const cursors = this.ensureGloveBagCursors();

    for (let refill = 0; refill < 2; refill++) {
      let bag = bags[rank];
      let cursor = cursors[rank];
      if (!bag || cursor >= bag.length) {
        this.refillGloveBag(rank);
        bag = bags[rank];
        cursor = cursors[rank];
      }

      let fallbackIndex = -1;
      for (let i = cursor; i < bag.length; i++) {
        const id = bag[i];
        if (!candidateIds.has(id)) continue;
        if (fallbackIndex < 0) fallbackIndex = i;
        if (unowned.length > 1 && id === this.progression.lastRewardGloveId) continue;
        cursors[rank] = i + 1;
        return getDropGlove(id);
      }
      if (fallbackIndex >= 0) {
        cursors[rank] = fallbackIndex + 1;
        return getDropGlove(bag[fallbackIndex]);
      }
      this.refillGloveBag(rank);
    }
    return unowned[0] ?? null;
  }

  private knifeDropItem(skin: KarambitSkin): CosmeticDropItem {
    return {
      id: skin.id,
      kind: 'KNIFE',
      name: skin.name,
      rarity: skin.rarity,
      dropEligible: skin.dropEligible
    };
  }

  private gloveDropItem(glove: DropGlove): CosmeticDropItem {
    return {
      id: glove.id,
      kind: 'GLOVE',
      name: glove.name,
      rarity: glove.rarity,
      dropEligible: glove.dropEligible
    };
  }

  /** Builds the unified reveal payload for a knife award. */
  private buildKnifeDrop(skin: KarambitSkin, sourceRank: RunRank): OpenedSignalDrop {
    return {
      kind: 'KNIFE',
      item: this.knifeDropItem(skin),
      name: skin.name,
      codename: skin.codename,
      rarity: skin.rarity,
      accentTag: skin.paletteTag,
      isLive: !!skin.profile.isVideoArtifact,
      skin,
      sourceRank,
      qualityLabel: this.getQualityLabel(sourceRank),
      isCollectionComplete: false
    };
  }

  /** Builds the unified reveal payload for a glove award. */
  private buildGloveDrop(glove: DropGlove, sourceRank: RunRank): OpenedSignalDrop {
    return {
      kind: 'GLOVE',
      item: this.gloveDropItem(glove),
      name: glove.name,
      codename: glove.codename,
      rarity: glove.rarity,
      accentTag: glove.codename,
      isLive: false, // gloves are never video assets
      sourceRank,
      qualityLabel: this.getQualityLabel(sourceRank),
      isCollectionComplete: false
    };
  }

  private getNextRewardSkin(rank: RunRank): KarambitSkin | null {
    const eligible = KARAMBIT_SKINS.filter(skin => skin.dropEligible);
    if (eligible.length === 0) return null;

    const trulyUnlocked = (skin: KarambitSkin): boolean => this.isSkinUnlockedWithoutDev(skin.id);
    const unowned = eligible.filter(skin => !trulyUnlocked(skin));
    if (unowned.length === 0) {
      return null;
    }
    const candidateIds = new Set(unowned.map(skin => skin.id));

    for (let refill = 0; refill < 2; refill++) {
      let bag = this.progression.rewardBags[rank];
      let cursor = this.progression.rewardBagCursors[rank];
      if (cursor >= bag.length) {
        this.refillRewardBag(rank);
        bag = this.progression.rewardBags[rank];
        cursor = this.progression.rewardBagCursors[rank];
      }

      let fallbackIndex = -1;
      for (let i = cursor; i < bag.length; i++) {
        const id = bag[i];
        if (!candidateIds.has(id)) continue;
        if (fallbackIndex < 0) fallbackIndex = i;
        if (unowned.length > 1 && id === this.progression.lastRewardSkinId) continue;
        this.progression.rewardBagCursors[rank] = i + 1;
        return this.getSkin(id);
      }
      if (fallbackIndex >= 0) {
        this.progression.rewardBagCursors[rank] = fallbackIndex + 1;
        return this.getSkin(bag[fallbackIndex]);
      }
      this.refillRewardBag(rank);
    }
    return unowned[0] ?? null;
  }

  private getQualityLabel(rank: RunRank): OpenedSignalDrop['qualityLabel'] {
    switch (rank) {
      case 'DIAMOND': return 'PRISTINE SIGNAL';
      case 'GOLD': return 'HIGH-FIDELITY SIGNAL';
      case 'SILVER': return 'REFINED SIGNAL';
      default: return 'STANDARD SIGNAL';
    }
  }

  public isCollectionComplete(): boolean {
    const eligible = KARAMBIT_SKINS.filter(skin => skin.dropEligible);
    return eligible.length > 0 && eligible.every(skin => this.isSkinUnlockedWithoutDev(skin.id));
  }

  /**
   * True only when BOTH Signal Drop categories are exhausted.
   *
   * `isCollectionComplete()` answers a KNIFE-only question and must never be
   * used as the "all signals decoded" gate: a player with every knife but
   * unowned gloves is NOT finished, and the decoder must keep awarding glove
   * drops. This is the category-aware gate the UI uses.
   */
  public isDropPoolComplete(): boolean {
    return this.isCollectionComplete() && this.isGloveCollectionComplete();
  }

  public openSignalDrop(): OpenedSignalDrop | null {
    const sourceRank = this.progression.pendingDropRanks[0];
    if (!sourceRank) return null;

    const exhausted = (): OpenedSignalDrop => ({
      kind: 'KNIFE',
      item: this.knifeDropItem(this.getEquippedSkin()),
      name: this.getEquippedSkin().name,
      codename: this.getEquippedSkin().codename,
      rarity: this.getEquippedSkin().rarity,
      accentTag: this.getEquippedSkin().paletteTag,
      isLive: !!this.getEquippedSkin().profile.isVideoArtifact,
      skin: this.getEquippedSkin(),
      sourceRank,
      qualityLabel: this.getQualityLabel(sourceRank),
      isCollectionComplete: true
    });

    // 1. Category roll (single named weighting), then duplicate protection.
    const availability = this.unownedAvailability();
    const rolled = rollDropCategory(this.nextRandom());
    const category = resolveDropCategory(rolled, availability);

    // 2. Both pools exhausted: preserve the existing "collection complete" path.
    if (!category) return exhausted();

    // 3. Rarity within the resolved category, using the existing rank-weighted bag.
    if (category === 'GLOVE') {
      // Consume the pending rank BEFORE awarding, so a resolved-but-missing
      // glove can never leave the rank in place to be rolled again.
      const glove = this.getNextRewardGlove(sourceRank);
      this.progression.pendingDropRanks.shift();
      if (!glove) return exhausted();
      const owned = this.progression.rewardOwnedGloveIds ?? [];
      if (!owned.includes(glove.id)) owned.push(glove.id);
      this.progression.rewardOwnedGloveIds = owned;
      this.progression.lastRewardGloveId = glove.id;
      this.saveState();
      this.notifyListeners();
      this.notifyCommitted();
      return this.buildGloveDrop(glove, sourceRank);
    }

    const skin = this.getNextRewardSkin(sourceRank);
    if (!skin) return exhausted();
    this.progression.pendingDropRanks.shift();
    if (!this.progression.rewardOwnedSkinIds.includes(skin.id)) {
      this.progression.rewardOwnedSkinIds.push(skin.id);
    }
    this.progression.lastRewardSkinId = skin.id;
    this.saveState();
    this.notifyListeners();
    this.notifyCommitted();
    return this.buildKnifeDrop(skin, sourceRank);
  }

  public getSkinProgress(id: string, includeDevPreview = true): { current: number; total: number; label: string; isUnlocked: boolean } {
    if (includeDevPreview && this.devPreviewEnabled) {
      return { current: 1, total: 1, label: 'DEV PREVIEW UNLOCKED', isUnlocked: true };
    }

    const entries = Object.entries(this.trackRecords);
    const completedCount = entries.filter(([, r]) => this.rankToValue(r) >= 1).length;
    const silverCount = entries.filter(([, r]) => this.rankToValue(r) >= 2).length;
    const goldCount = entries.filter(([, r]) => this.rankToValue(r) >= 3).length;
    const diamondCount = entries.filter(([, r]) => this.rankToValue(r) >= 4).length;

    const norm = (id || '').toUpperCase();

    if (this.progression.rewardOwnedSkinIds.includes(norm)) {
      return { current: 1, total: 1, label: 'SIGNAL DROP', isUnlocked: true };
    }

    switch (norm) {
      case 'SIGNAL_CYAN':
        return { current: 1, total: 1, label: 'STANDARD ISSUE', isUnlocked: true };

      case 'ASTRAL':
        return {
          current: Math.min(1, completedCount),
          total: 1,
          label: `${Math.min(1, completedCount)}/1 TRACKS COMPLETED`,
          isUnlocked: completedCount >= 1
        };

      case 'VOID_SIGNAL':
        return {
          current: Math.min(2, silverCount),
          total: 2,
          label: `${Math.min(2, silverCount)}/2 TRACKS AT SILVER+`,
          isUnlocked: silverCount >= 2
        };

      case 'REDSHIFT':
        return {
          current: Math.min(2, goldCount),
          total: 2,
          label: `${Math.min(2, goldCount)}/2 TRACKS AT GOLD+`,
          isUnlocked: goldCount >= 2
        };

      case 'PRISM_STATIC':
        return {
          current: goldCount,
          total: TOTAL_SIGNAL_PACK_TRACKS,
          label: `${goldCount}/${TOTAL_SIGNAL_PACK_TRACKS} TRACKS AT GOLD+`,
          isUnlocked: goldCount >= TOTAL_SIGNAL_PACK_TRACKS
        };

      case 'BLACKSTAR':
        return {
          current: diamondCount,
          total: TOTAL_SIGNAL_PACK_TRACKS,
          label: `${diamondCount}/${TOTAL_SIGNAL_PACK_TRACKS} TRACKS AT DIAMOND`,
          isUnlocked: diamondCount >= TOTAL_SIGNAL_PACK_TRACKS
        };

      default: {
        const targetSkin = this.getSkin(norm);
        if (targetSkin.dropEligible) {
          return {
            current: 0,
            total: 1,
            label: 'OPEN SIGNAL DROPS',
            isUnlocked: false
          };
        }
        return { current: 0, total: 1, label: 'LOCKED', isUnlocked: false };
      }
    }
  }

  public isSkinUnlocked(id: string): boolean {
    if (this.devPreviewEnabled) return true;
    return this.isSkinUnlockedWithoutDev(id);
  }

  private isSkinUnlockedWithoutDev(id: string): boolean {
    const target = this.getSkin(id);
    if (target.id === 'SIGNAL_CYAN') return true;
    if (this.progression.rewardOwnedSkinIds.includes(target.id)) return true;
    return this.getSkinProgress(target.id, false).isUnlocked;
  }

  /**
   * Applies skin material profile parameters to a KarambitCosmicMaterial
   */
  public applyToMaterial(mat: KarambitCosmicMaterial, skinId?: string): void {
    const targetId = skinId || this.getActiveRenderSkinId();
    const skin = this.getSkin(targetId);
    const p = skin.profile;

    mat.uniforms.uBaseColor.value.copy(p.baseColor);
    mat.uniforms.uNebulaPrimary.value.copy(p.nebulaPrimary);
    mat.uniforms.uNebulaSecondary.value.copy(p.nebulaSecondary);
    mat.uniforms.uStarColor.value.copy(p.starColor);
    mat.uniforms.uRimColor.value.copy(p.rimColor);
    mat.uniforms.uParallaxDepth.value = p.parallaxDepth;
    mat.uniforms.uLayer2Scale.value = p.layer2Scale;
    mat.uniforms.uFlowSpeed.value = p.flowSpeed;
    mat.uniforms.uSparkleRate.value = p.sparkleRate;
    mat.uniforms.uFresnelPower.value = p.fresnelPower;
    mat.uniforms.uAudioReactivity.value = p.audioReactivity;
    mat.uniforms.uIsCanonical.value = p.isCanonical ? 1.0 : 0.0;
    mat.uniforms.uIsPrism.value = p.isPrism ? 1.0 : 0.0;
    mat.uniforms.uIsBlackstar.value = p.isBlackstar ? 1.0 : 0.0;
    mat.uniforms.uIsVideoArtifact.value = p.isVideoArtifact ? 1.0 : 0.0;

    mat.uniforms.uExposure.value = p.exposure ?? 1.0;
    mat.uniforms.uContrast.value = p.contrast ?? 1.0;
    mat.uniforms.uEmission.value = p.emission ?? 1.0;
    mat.uniforms.uCosmicUvScale.value = p.uvScale ?? 1.0;

    if (p.isCanonical) {
      mat.uniforms.tCosmicTexture.value = null;
      mat.uniforms.uHasCosmicTexture.value = 0.0;
    } else {
      const tex = this.getSkinTexture(skin.id);
      mat.uniforms.tCosmicTexture.value = tex;
      mat.uniforms.uHasCosmicTexture.value = tex ? 1.0 : 0.0;
    }
    mat.needsUpdate = true;
  }

  public dispose(): void {
    this.releaseActiveVideoTexture();
    for (const texture of this.skinTextures.values()) texture.dispose();
    this.skinTextures.clear();
    this.listeners = [];
    this.committedListeners = [];
  }
}
