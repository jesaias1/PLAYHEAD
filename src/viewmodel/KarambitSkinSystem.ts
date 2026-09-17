/**
 * KarambitSkinSystem for PLAYHEAD
 * Cosmetic-only progression system and material profiles for the PLAYHEAD Karambit.
 *
 * Manages:
 * - 6 authored cosmetic skins (1 canonical default + 5 performance unlocks)
 * - Persistent track completion records and rank tiers (BRONZE, SILVER, GOLD, DIAMOND)
 * - Evaluates unlock requirements against built-in Signal Pack tracks
 * - LocalStorage persistence for equipped skin and earned achievements
 * - Dev preview mode for instant inspection without modifying real progression
 */

import * as THREE from 'three';
import { RunRank } from '../player/PlayerStats';
import { KarambitCosmicMaterial } from './KarambitCosmicShader';

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
  texturePath?: string;
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
    if (this.skinTextures.has(skinId)) {
      return this.skinTextures.get(skinId)!;
    }
    const skin = this.getSkin(skinId);
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

  private loadState(): void {
    if (typeof localStorage === 'undefined') return;

    try {
      const recordsRaw = localStorage.getItem(this.STORAGE_KEY_RECORDS);
      if (recordsRaw) {
        this.trackRecords = JSON.parse(recordsRaw);
      }

      const equipped = localStorage.getItem(this.STORAGE_KEY_EQUIPPED);
      if (equipped && KARAMBIT_SKINS.some(s => s.id === equipped)) {
        this.equippedSkinId = equipped;
      }

      const devRaw = localStorage.getItem(this.STORAGE_KEY_DEV);
      this.devPreviewEnabled = devRaw === 'true';
    } catch (e) {
      console.warn('[KarambitSkinSystem] Failed to load skin state:', e);
    }
  }

  private saveState(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.STORAGE_KEY_RECORDS, JSON.stringify(this.trackRecords));
      localStorage.setItem(this.STORAGE_KEY_EQUIPPED, this.equippedSkinId);
      localStorage.setItem(this.STORAGE_KEY_DEV, this.devPreviewEnabled ? 'true' : 'false');
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

  public recordTrackCompletion(trackId: string, rank: RunRank): { newlyUnlocked: KarambitSkin[] } {
    const previousUnlocks = KARAMBIT_SKINS.filter(s => this.isSkinUnlocked(s.id));

    const curVal = this.rankToValue(this.trackRecords[trackId]);
    const newVal = this.rankToValue(rank);
    if (newVal > curVal) {
      this.trackRecords[trackId] = rank;
      this.saveState();
    }

    const currentUnlocks = KARAMBIT_SKINS.filter(s => this.isSkinUnlocked(s.id));
    const newlyUnlocked = currentUnlocks.filter(s => !previousUnlocks.some(prev => prev.id === s.id));

    return { newlyUnlocked };
  }

  public getSkinProgress(id: string): { current: number; total: number; label: string; isUnlocked: boolean } {
    if (this.devPreviewEnabled) {
      return { current: 1, total: 1, label: 'DEV PREVIEW UNLOCKED', isUnlocked: true };
    }

    const entries = Object.entries(this.trackRecords);
    const completedCount = entries.filter(([, r]) => this.rankToValue(r) >= 1).length;
    const silverCount = entries.filter(([, r]) => this.rankToValue(r) >= 2).length;
    const goldCount = entries.filter(([, r]) => this.rankToValue(r) >= 3).length;
    const diamondCount = entries.filter(([, r]) => this.rankToValue(r) >= 4).length;

    const norm = (id || '').toUpperCase();

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

      default:
        return { current: 0, total: 1, label: 'LOCKED', isUnlocked: false };
    }
  }

  public isSkinUnlocked(id: string): boolean {
    if (this.devPreviewEnabled) return true;
    const target = this.getSkin(id);
    if (target.id === 'SIGNAL_CYAN') return true;
    return this.getSkinProgress(target.id).isUnlocked;
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
}
