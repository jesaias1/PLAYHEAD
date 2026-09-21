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

export type CosmeticRarity = 'STANDARD' | 'RARE' | 'RELIC' | 'ARTIFACT';

interface SignalDropProgressionV2 {
  version: 2;
  awardedRankKeys: string[];
  pendingDropRanks: RunRank[];
  rewardOwnedSkinIds: string[];
  rewardBags: Record<RunRank, string[]>;
  rewardBagCursors: Record<RunRank, number>;
  rngState: number;
  lastRewardSkinId?: string;
}

export interface TrackCompletionReward {
  newlyUnlocked: KarambitSkin[];
  dropAwarded: boolean;
  dropsAwarded: number;
  awardedDropRanks: RunRank[];
  pendingDrops: number;
}

export interface OpenedSignalDrop {
  skin: KarambitSkin;
  sourceRank: RunRank;
  qualityLabel: 'STANDARD SIGNAL' | 'REFINED SIGNAL' | 'HIGH-FIDELITY SIGNAL' | 'PRISTINE SIGNAL';
}

const SIGNAL_DROP_PROGRESSION_VERSION = 2 as const;
export const SIGNAL_DROP_STORAGE_KEY = 'playhead.armory.signalDrops';
const DEFAULT_REWARD_RNG_STATE = 0x504c4159;
const RANK_THRESHOLDS: RunRank[] = ['BRONZE', 'SILVER', 'GOLD', 'DIAMOND'];
export const SIGNAL_DROP_RARITY_WEIGHTS: Record<RunRank, Record<CosmeticRarity, number>> = {
  BRONZE: { STANDARD: 12, RARE: 7, RELIC: 2, ARTIFACT: 1 },
  SILVER: { STANDARD: 7, RARE: 10, RELIC: 5, ARTIFACT: 2 },
  GOLD: { STANDARD: 3, RARE: 6, RELIC: 11, ARTIFACT: 5 },
  DIAMOND: { STANDARD: 1, RARE: 5, RELIC: 12, ARTIFACT: 10 }
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
      texturePath: '/assets/viewmodel/karambit/textures/astral_cosmic.png',
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
      texturePath: '/assets/viewmodel/karambit/textures/void_signal_cosmic.png',
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
      texturePath: '/assets/viewmodel/karambit/textures/redshift_cosmic.png',
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
      texturePath: '/assets/viewmodel/karambit/textures/prism_static_cosmic.png',
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
    dropEligible: true,
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
      texturePath: '/assets/viewmodel/karambit/textures/blackstar_cosmic.png',
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
  private listeners: Array<(skinId: string) => void> = [];
  private skinTextures: Map<string, THREE.Texture> = new Map();
  private textureLoader = new THREE.TextureLoader();
  private activeVideo: { skinId: string; element: HTMLVideoElement; texture: THREE.VideoTexture } | null = null;
  private progression: SignalDropProgressionV2 = this.createDefaultProgression();

  private readonly STORAGE_KEY_RECORDS = 'playhead.karambit.trackRecords';
  private readonly STORAGE_KEY_EQUIPPED = 'playhead.karambit.equippedSkin';
  private readonly STORAGE_KEY_DEV = 'playhead.karambit.devPreview';

  private constructor() {
    this.loadState();
    this.preloadTextures();
  }

  private preloadTextures(): void {
    if (typeof window === 'undefined') return;
    for (const skin of KARAMBIT_SKINS) {
      if (skin.profile.texturePath) {
        this.getSkinTexture(skin.id);
      }
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
    if (!skin.profile.videoPath || skin.id !== this.equippedSkinId || typeof document === 'undefined') {
      return null;
    }
    if (this.activeVideo?.skinId === skin.id) return this.activeVideo.texture;

    this.releaseActiveVideoTexture();

    const video = document.createElement('video');
    video.src = skin.profile.videoPath;
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
    this.activeVideo = { skinId: skin.id, element: video, texture };

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
      rngState: DEFAULT_REWARD_RNG_STATE
    };
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
          : undefined
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
    this.saveState();
    this.notifyListeners();
    return true;
  }

  public isDevPreview(): boolean {
    return this.devPreviewEnabled;
  }

  public setDevPreview(enabled: boolean): void {
    this.devPreviewEnabled = enabled;
    if (!enabled && !this.isSkinUnlocked(this.equippedSkinId)) {
      this.releaseActiveVideoTexture();
      this.equippedSkinId = 'SIGNAL_CYAN';
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
      for (const threshold of newlyReached) {
        this.progression.awardedRankKeys.push(`${officialLevelId}:${threshold}`);
        this.progression.pendingDropRanks.push(threshold);
        awardedDropRanks.push(threshold);
      }
    }
    if (awardedDropRanks.length > 0) {
      stateChanged = true;
    }

    if (stateChanged) {
      this.saveState();
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

  public getPendingDropCount(): number {
    return this.progression.pendingDropRanks.length;
  }

  public getPendingDropRanks(): RunRank[] {
    return [...this.progression.pendingDropRanks];
  }

  public getAwardedRankKeys(): string[] {
    return [...this.progression.awardedRankKeys];
  }

  public getAwardedDiamondLevelIds(): string[] {
    return this.progression.awardedRankKeys
      .filter(key => key.endsWith(':DIAMOND'))
      .map(key => key.slice(0, -':DIAMOND'.length));
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
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(this.nextRandom() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    this.progression.rewardBags[rank] = bag;
    this.progression.rewardBagCursors[rank] = 0;
  }

  private getNextRewardSkin(rank: RunRank): KarambitSkin | null {
    const eligible = KARAMBIT_SKINS.filter(skin => skin.dropEligible);
    if (eligible.length === 0) return null;

    const trulyUnlocked = (skin: KarambitSkin): boolean => this.isSkinUnlockedWithoutDev(skin.id);
    const unowned = eligible.filter(skin => !trulyUnlocked(skin));
    const candidates = unowned.length > 0 ? unowned : eligible;
    const candidateIds = new Set(candidates.map(skin => skin.id));

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
        if (candidates.length > 1 && id === this.progression.lastRewardSkinId) continue;
        this.progression.rewardBagCursors[rank] = i + 1;
        return this.getSkin(id);
      }
      if (fallbackIndex >= 0) {
        this.progression.rewardBagCursors[rank] = fallbackIndex + 1;
        return this.getSkin(bag[fallbackIndex]);
      }
      this.refillRewardBag(rank);
    }
    return candidates[0] ?? null;
  }

  private getQualityLabel(rank: RunRank): OpenedSignalDrop['qualityLabel'] {
    switch (rank) {
      case 'DIAMOND': return 'PRISTINE SIGNAL';
      case 'GOLD': return 'HIGH-FIDELITY SIGNAL';
      case 'SILVER': return 'REFINED SIGNAL';
      default: return 'STANDARD SIGNAL';
    }
  }

  public openSignalDrop(): OpenedSignalDrop | null {
    const sourceRank = this.progression.pendingDropRanks[0];
    if (!sourceRank) return null;
    const skin = this.getNextRewardSkin(sourceRank);
    if (!skin) return null;

    this.progression.pendingDropRanks.shift();
    if (!this.progression.rewardOwnedSkinIds.includes(skin.id)) {
      this.progression.rewardOwnedSkinIds.push(skin.id);
    }
    this.progression.lastRewardSkinId = skin.id;
    this.saveState();
    this.notifyListeners();
    return { skin, sourceRank, qualityLabel: this.getQualityLabel(sourceRank) };
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

      case 'SIGNALISM_ARTIFACT':
      case 'GOD_RUN_ARTIFACT':
      case 'PRISM_ARTIFACT':
      case 'AMBER_SIGNAL':
      case 'WHITE_NOISE':
        return {
          current: 0,
          total: 1,
          label: 'OPEN SIGNAL DROPS',
          isUnlocked: false
        };

      default:
        return { current: 0, total: 1, label: 'LOCKED', isUnlocked: false };
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
    const targetId = skinId || this.equippedSkinId;
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
  }
}
