import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import {
  KarambitSkinSystem,
  KARAMBIT_SKINS,
  SIGNAL_DROP_RARITY_WEIGHTS,
  SIGNAL_DROP_STORAGE_KEY,
  TOTAL_SIGNAL_PACK_TRACKS
} from '../src/viewmodel/KarambitSkinSystem';
import { KarambitCosmicMaterial } from '../src/viewmodel/KarambitCosmicShader';
import { GrainScanlinePass } from '../src/rendering/GrainScanlinePass';
import { SignalPackCatalog } from '../src/audio/SignalPackCatalog';

function createLocalStorageMock(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, String(value)); }
  };
}

describe('Karambit Skin System & Cosmic Shaders', () => {
  let skinSystem: KarambitSkinSystem;

  beforeEach(() => {
    (KarambitSkinSystem as any).instance?.dispose?.();
    Object.defineProperty(globalThis, 'localStorage', {
      value: createLocalStorageMock(),
      configurable: true,
      writable: true
    });
    (KarambitSkinSystem as any).instance = null;
    skinSystem = KarambitSkinSystem.getInstance();
  });

  afterEach(() => {
    (KarambitSkinSystem as any).instance?.dispose?.();
    (KarambitSkinSystem as any).instance = null;
    vi.restoreAllMocks();
  });

  it('defines the static collection and video Artifact skins with complete rarity metadata', () => {
    const skins = skinSystem.getSkins();
    expect(skins).toHaveLength(23);

    const expectedIds = [
      'SIGNAL_CYAN', 'ASTRAL', 'VOID_SIGNAL', 'REDSHIFT', 'PRISM_STATIC', 'BLACKSTAR',
      'AMBER_SIGNAL', 'WHITE_NOISE',
      'SIGNALISM_ARTIFACT', 'GOD_RUN_ARTIFACT', 'PRISM_ARTIFACT',
      'CYBER_ARTIFACT', 'RADIO_ARTIFACT', 'UNDERWORLD_ARTIFACT', 'SYNTH_ARTIFACT',
      'DNA_ARTIFACT', 'MIRRORS_ARTIFACT', 'PINK_SMOKE_ARTIFACT', 'BLUE_SMOKE_ARTIFACT',
      'WHITE_SMOKE_ARTIFACT', 'BLUE_MARBLE_ARTIFACT', 'ACID_ARTIFACT', 'RAINBOW_VORTEX_ARTIFACT'
    ];
    expect(skins.map(s => s.id)).toEqual(expectedIds);

    for (const skin of skins) {
      expect(skin.name).toBeDefined();
      expect(skin.description).toBeDefined();
      expect(skin.unlockRequirement).toBeDefined();
      expect(skin.profile).toBeDefined();
      expect(skin.profile.baseColor).toBeInstanceOf(THREE.Color);
      expect(skin.profile.nebulaPrimary).toBeInstanceOf(THREE.Color);
      expect(skin.profile.rimColor).toBeInstanceOf(THREE.Color);
      expect(skin.profile.parallaxDepth).toBeGreaterThan(0);
      expect(skin.profile.layer2Scale).toBeGreaterThan(1.0);
      expect(['STANDARD', 'RARE', 'RELIC', 'ARTIFACT', 'OVERCLOCKED']).toContain(skin.rarity);
    }

    const artifacts = skins.filter(skin => skin.rarity === 'ARTIFACT');
    expect(artifacts).toHaveLength(14);
    expect(artifacts.every(skin => skin.profile.isVideoArtifact && skin.profile.videoPath)).toBe(true);

    const overclocked = skins.filter(skin => skin.rarity === 'OVERCLOCKED');
    expect(overclocked).toHaveLength(1);
    expect(overclocked[0].id).toBe('CYBER_ARTIFACT');
    expect(overclocked[0].profile.isVideoArtifact).toBe(true);

    expect(SIGNAL_DROP_RARITY_WEIGHTS.BRONZE.ARTIFACT).toBeGreaterThan(0);
    expect(SIGNAL_DROP_RARITY_WEIGHTS.DIAMOND.ARTIFACT).toBeGreaterThan(
      SIGNAL_DROP_RARITY_WEIGHTS.BRONZE.ARTIFACT
    );
    expect(SIGNAL_DROP_RARITY_WEIGHTS.BRONZE.STANDARD).toBeGreaterThan(
      SIGNAL_DROP_RARITY_WEIGHTS.DIAMOND.STANDARD
    );
  });

  it('guarantees 00 // SIGNAL CYAN is the default equipped canonical skin and always unlocked', () => {
    expect(skinSystem.getEquippedSkinId()).toBe('SIGNAL_CYAN');
    expect(skinSystem.isSkinUnlocked('SIGNAL_CYAN')).toBe(true);

    const canonical = skinSystem.getSkin('SIGNAL_CYAN');
    expect(canonical.profile.isCanonical).toBe(true);
  });

  it('evaluates performance unlocks accurately based on Signal Pack track completion and ranks', () => {
    // Initially only SIGNAL_CYAN is unlocked
    expect(skinSystem.isSkinUnlocked('ASTRAL')).toBe(false);
    expect(skinSystem.isSkinUnlocked('VOID_SIGNAL')).toBe(false);
    expect(skinSystem.isSkinUnlocked('REDSHIFT')).toBe(false);
    expect(skinSystem.isSkinUnlocked('PRISM_STATIC')).toBe(false);
    expect(skinSystem.isSkinUnlocked('BLACKSTAR')).toBe(false);

    // 1. Complete 1 track with BRONZE -> unlocks ASTRAL
    const res1 = skinSystem.recordTrackCompletion('track_01.ogg', 'BRONZE');
    expect(skinSystem.isSkinUnlocked('ASTRAL')).toBe(true);
    expect(res1.newlyUnlocked.some(s => s.id === 'ASTRAL')).toBe(true);
    expect(skinSystem.isSkinUnlocked('VOID_SIGNAL')).toBe(false);

    // 2. Complete track 1 and track 2 with SILVER -> unlocks VOID_SIGNAL (>= 2 at SILVER+)
    skinSystem.recordTrackCompletion('track_01.ogg', 'SILVER');
    const res2 = skinSystem.recordTrackCompletion('track_02.ogg', 'SILVER');
    expect(skinSystem.isSkinUnlocked('VOID_SIGNAL')).toBe(true);
    expect(res2.newlyUnlocked.some(s => s.id === 'VOID_SIGNAL')).toBe(true);
    expect(skinSystem.isSkinUnlocked('REDSHIFT')).toBe(false);

    // 3. Complete track 1 and track 2 with GOLD -> unlocks REDSHIFT (>= 2 at GOLD+)
    skinSystem.recordTrackCompletion('track_01.ogg', 'GOLD');
    const res3 = skinSystem.recordTrackCompletion('track_02.ogg', 'GOLD');
    expect(skinSystem.isSkinUnlocked('REDSHIFT')).toBe(true);
    expect(res3.newlyUnlocked.some(s => s.id === 'REDSHIFT')).toBe(true);
    expect(skinSystem.isSkinUnlocked('PRISM_STATIC')).toBe(false);

    // 4. Complete all 14 tracks with GOLD -> unlocks PRISM_STATIC
    for (let i = 1; i <= TOTAL_SIGNAL_PACK_TRACKS; i++) {
      skinSystem.recordTrackCompletion(`track_${i.toString().padStart(2, '0')}.ogg`, 'GOLD');
    }
    expect(skinSystem.isSkinUnlocked('PRISM_STATIC')).toBe(true);
    expect(skinSystem.isSkinUnlocked('BLACKSTAR')).toBe(false);

    // 5. Complete all 14 tracks with DIAMOND -> unlocks BLACKSTAR
    let lastRes: any;
    for (let i = 1; i <= TOTAL_SIGNAL_PACK_TRACKS; i++) {
      lastRes = skinSystem.recordTrackCompletion(`track_${i.toString().padStart(2, '0')}.ogg`, 'DIAMOND');
    }
    expect(skinSystem.isSkinUnlocked('BLACKSTAR')).toBe(true);
    expect(lastRes.newlyUnlocked.some((s: any) => s.id === 'BLACKSTAR')).toBe(true);
  });

  it('supports dev preview toggle for instant inspection without altering recorded progression', () => {
    expect(skinSystem.isDevPreview()).toBe(false);
    expect(skinSystem.isSkinUnlocked('BLACKSTAR')).toBe(false);

    // Toggle dev preview ON
    skinSystem.setDevPreview(true);
    expect(skinSystem.isDevPreview()).toBe(true);
    expect(skinSystem.isSkinUnlocked('BLACKSTAR')).toBe(true);
    expect(skinSystem.equipSkin('BLACKSTAR')).toBe(true);
    expect(skinSystem.getEquippedSkinId()).toBe('BLACKSTAR');

    // Toggle dev preview OFF -> real progress is preserved (still locked)
    skinSystem.setDevPreview(false);
    expect(skinSystem.isDevPreview()).toBe(false);
    expect(skinSystem.isSkinUnlocked('BLACKSTAR')).toBe(false);
  });

  it('applies skin profile uniforms correctly to KarambitCosmicMaterial', () => {
    const mat = new KarambitCosmicMaterial();

    // Apply ASTRAL skin
    skinSystem.applyToMaterial(mat, 'ASTRAL');
    const astral = skinSystem.getSkin('ASTRAL');

    expect(mat.uniforms.uNebulaPrimary.value.getHex()).toBe(astral.profile.nebulaPrimary.getHex());
    expect(mat.uniforms.uParallaxDepth.value).toBe(astral.profile.parallaxDepth);
    expect(mat.uniforms.uLayer2Scale.value).toBe(astral.profile.layer2Scale);
    expect(mat.uniforms.uIsCanonical.value).toBe(0.0);
    expect(mat.uniforms.uIsPrism.value).toBe(0.0);

    // Apply PRISM_STATIC skin
    skinSystem.applyToMaterial(mat, 'PRISM_STATIC');
    expect(mat.uniforms.uIsPrism.value).toBe(1.0);

    // Apply SIGNAL_CYAN skin
    skinSystem.applyToMaterial(mat, 'SIGNAL_CYAN');
    expect(mat.uniforms.uIsCanonical.value).toBe(1.0);

    mat.dispose();
  });

  it('awards each official level rank threshold once and never rewards custom audio', () => {
    const [first, second] = SignalPackCatalog.getTracks();

    const bronze = skinSystem.recordTrackCompletion(first.id, 'BRONZE', first.id);
    expect(bronze.awardedDropRanks).toEqual(['BRONZE']);
    expect(bronze.pendingDrops).toBe(1);

    const repeatClear = skinSystem.recordTrackCompletion(first.id, 'BRONZE', first.id);
    expect(repeatClear.dropAwarded).toBe(false);
    expect(repeatClear.pendingDrops).toBe(1);

    expect(skinSystem.recordTrackCompletion(first.id, 'SILVER', first.id).awardedDropRanks).toEqual(['SILVER']);
    expect(skinSystem.recordTrackCompletion(first.id, 'GOLD', first.id).awardedDropRanks).toEqual(['GOLD']);
    expect(skinSystem.recordTrackCompletion(first.id, 'DIAMOND', first.id).awardedDropRanks).toEqual(['DIAMOND']);

    const firstDiamond = skinSystem.recordTrackCompletion(second.id, 'DIAMOND', second.id);
    expect(firstDiamond.awardedDropRanks).toEqual(['DIAMOND', 'GOLD', 'SILVER', 'BRONZE']);
    expect(firstDiamond.pendingDrops).toBe(8);

    const customClear = skinSystem.recordTrackCompletion('custom-upload.wav', 'DIAMOND', 'custom-upload');
    expect(customClear.dropAwarded).toBe(false);
    expect(customClear.pendingDrops).toBe(8);
  });

  it('preserves pending drops and reward ownership across reloads', () => {
    const official = SignalPackCatalog.getTracks()[0];
    skinSystem.recordTrackCompletion(official.id, 'DIAMOND', official.id);

    (KarambitSkinSystem as any).instance = null;
    skinSystem = KarambitSkinSystem.getInstance();
    expect(skinSystem.getPendingDropCount()).toBe(4);
    expect(skinSystem.getAwardedDiamondLevelIds()).toEqual([official.id]);

    const reward = skinSystem.openSignalDrop();
    expect(reward).not.toBeNull();
    expect(reward!.sourceRank).toBe('DIAMOND');
    expect(reward!.qualityLabel).toBe('PRISTINE SIGNAL');
    // Ownership lands in the ledger for the resolved CATEGORY.
    expect(skinSystem.isCosmeticOwned(reward!.item.id)).toBe(true);

    (KarambitSkinSystem as any).instance = null;
    skinSystem = KarambitSkinSystem.getInstance();
    expect(skinSystem.getPendingDropCount()).toBe(3);
    expect(skinSystem.isCosmeticOwned(reward!.item.id)).toBe(true);
    if (reward!.kind === 'KNIFE') {
      expect(skinSystem.isSkinUnlocked(reward!.item.id)).toBe(true);
    } else {
      expect(skinSystem.isDropGloveOwned(reward!.item.id)).toBe(true);
    }
  });

  it('uses a deterministic persisted bag, protects unowned rewards, and avoids identical streaks', () => {
    const runCollection = (): string[] => {
      const system = KarambitSkinSystem.getInstance();
      for (const track of SignalPackCatalog.getTracks()) {
        system.recordTrackCompletion(track.id, 'DIAMOND', track.id);
      }
      const rewards: string[] = [];
      while (system.getPendingDropCount() > 0 && !(system.isCollectionComplete() && system.isGloveCollectionComplete())) {
        const drop = system.openSignalDrop();
        if (!drop || drop.isCollectionComplete) break;
        rewards.push(`${drop.kind}:${drop.item.id}`);
      }
      return rewards;
    };

    const firstSequence = runCollection();
    // Strict duplicate protection: each awarded drop is unique
    expect(new Set(firstSequence).size).toBe(firstSequence.length);
    expect(firstSequence.length).toBeGreaterThan(0);

    localStorage.clear();
    (KarambitSkinSystem as any).instance = null;
    const secondSequence = runCollection();
    expect(secondSequence).toEqual(firstSequence);
  });

  it('sanitizes corrupt versioned progression without damaging legacy skin records', () => {
    localStorage.setItem('playhead.karambit.trackRecords', JSON.stringify({ legacy_track: 'GOLD' }));
    localStorage.setItem(SIGNAL_DROP_STORAGE_KEY, '{not-json');
    (KarambitSkinSystem as any).instance = null;
    skinSystem = KarambitSkinSystem.getInstance();

    expect(skinSystem.getTrackRecords()).toEqual({ legacy_track: 'GOLD' });
    expect(skinSystem.getPendingDropCount()).toBe(0);
    expect(skinSystem.getRewardOwnedSkinIds()).toEqual([]);
  });

  it('creates video resources only for an equipped owned Artifact and releases them on unequip', async () => {
    for (const track of SignalPackCatalog.getTracks()) {
      skinSystem.recordTrackCompletion(track.id, 'DIAMOND', track.id);
    }
    // Only KNIFE awards can be video Artifacts. A glove drop is skipped.
    let opened = skinSystem.openSignalDrop()!;
    let guard = 0;
    while (
      opened &&
      !opened.isCollectionComplete &&
      guard++ < 400 &&
      !(opened.kind === 'KNIFE' && opened.skin?.rarity === 'ARTIFACT')
    ) {
      const next = skinSystem.openSignalDrop();
      if (!next) break;
      opened = next;
    }
    expect(opened.kind).toBe('KNIFE');
    const artifact = opened.skin!;
    expect(artifact.rarity).toBe('ARTIFACT');

    const fakeVideo = {
      src: '', muted: false, defaultMuted: false, loop: false, playsInline: false,
      preload: '', crossOrigin: '', controls: true, disablePictureInPicture: false,
      play: vi.fn(() => Promise.resolve()),
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn()
    };
    const originalDocument = globalThis.document;
    Object.defineProperty(globalThis, 'document', {
      value: { createElement: vi.fn(() => fakeVideo) },
      configurable: true
    });

    const mat = new KarambitCosmicMaterial();
    skinSystem.applyToMaterial(mat, artifact.id);
    expect(fakeVideo.play).not.toHaveBeenCalled();
    expect(skinSystem.getActiveVideoSkinId()).toBeNull();

    expect(skinSystem.equipSkin(artifact.id)).toBe(true);
    skinSystem.applyToMaterial(mat, artifact.id);
    expect(fakeVideo.play).toHaveBeenCalledTimes(1);
    expect(fakeVideo.muted).toBe(true);
    expect(mat.uniforms.uIsVideoArtifact.value).toBe(1);
    expect(mat.uniforms.uHasCosmicTexture.value).toBe(1);
    expect(skinSystem.getActiveVideoSkinId()).toBe(artifact.id);

    expect(skinSystem.equipSkin('SIGNAL_CYAN')).toBe(true);
    expect(fakeVideo.pause).toHaveBeenCalledTimes(1);
    expect(fakeVideo.removeAttribute).toHaveBeenCalledWith('src');
    expect(skinSystem.getActiveVideoSkinId()).toBeNull();

    mat.dispose();
    Object.defineProperty(globalThis, 'document', {
      value: originalDocument,
      configurable: true
    });
  });

  it('configures GrainScanlinePass with restrained film grain and scanlines', () => {
    const pass = new GrainScanlinePass();
    expect(pass.uniforms.uGrainIntensity.value).toBeCloseTo(0.015, 3);
    expect(pass.uniforms.uScanlineIntensity.value).toBeCloseTo(0.014, 3);

    pass.update(0.016);
    expect(pass.uniforms.uTime.value).toBeCloseTo(0.016, 3);

    pass.dispose();
  });
});
