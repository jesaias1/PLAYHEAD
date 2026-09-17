import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  KarambitSkinSystem,
  KARAMBIT_SKINS,
  TOTAL_SIGNAL_PACK_TRACKS
} from '../src/viewmodel/KarambitSkinSystem';
import { KarambitCosmicMaterial } from '../src/viewmodel/KarambitCosmicShader';
import { GrainScanlinePass } from '../src/rendering/GrainScanlinePass';

describe('Karambit Skin System & Cosmic Shaders', () => {
  let skinSystem: KarambitSkinSystem;

  beforeEach(() => {
    // Clear localStorage simulation if present
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
    // Re-instantiate or reset singleton
    (KarambitSkinSystem as any).instance = null;
    skinSystem = KarambitSkinSystem.getInstance();
  });

  it('defines exactly 6 authored karambit skins with full metadata and material profiles', () => {
    const skins = skinSystem.getSkins();
    expect(skins).toHaveLength(6);

    const expectedIds = ['SIGNAL_CYAN', 'ASTRAL', 'VOID_SIGNAL', 'REDSHIFT', 'PRISM_STATIC', 'BLACKSTAR'];
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
    }
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

  it('configures GrainScanlinePass with restrained film grain and scanlines', () => {
    const pass = new GrainScanlinePass();
    expect(pass.uniforms.uGrainIntensity.value).toBeCloseTo(0.015, 3);
    expect(pass.uniforms.uScanlineIntensity.value).toBeCloseTo(0.014, 3);

    pass.update(0.016);
    expect(pass.uniforms.uTime.value).toBeCloseTo(0.016, 3);

    pass.dispose();
  });
});
