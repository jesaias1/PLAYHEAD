import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DROP_GLOVES } from '../src/viewmodel/DropGloveCatalog';
import { GLOVE_TEXTURES, gloveTexturePathVariants, setGloveColorComposite, setGloveMask, setGloveTextureQuality, resolveAnyGloveTexturePath } from '../src/viewmodel/GloveTextures';

describe('Original mastery artwork', () => {
  it('ships unique original standard and high textures for all earned gloves', () => {
    const hashes = new Set<string>();
    for (const [id,path] of Object.entries(GLOVE_TEXTURES)) {
      if (!path) continue;
      expect(path).toContain('/mastery/');
      const variants=gloveTexturePathVariants(id);
      expect(variants).toHaveLength(2);
      for (const variant of variants) {
        const file='public'+variant; expect(existsSync(file)).toBe(true);
        const hash=createHash('sha256').update(readFileSync(file)).digest('hex');
        expect(hashes.has(hash)).toBe(false); hashes.add(hash);
      }
      setGloveTextureQuality('HIGH'); expect(resolveAnyGloveTexturePath(id)).toBe(variants[1]);
      setGloveTextureQuality('STANDARD'); expect(resolveAnyGloveTexturePath(id)).toBe(variants[0]);
    }
  });
});

describe('White finishes and intentional hand tones', () => {
  it('adds three distinct white finishes with fair, tan and deep authored tones', () => {
    const tones=DROP_GLOVES.filter(glove=>glove.authoredSkinTone);
    expect(tones.map(glove=>glove.authoredSkinTone).sort()).toEqual(['DEEP','FAIR','TAN']);
    expect(new Set(tones.map(glove=>glove.texturePath)).size).toBe(3);
    for (const glove of tones) {
      expect(glove.dropEligible).toBe(true);
      expect(existsSync('public'+glove.texturePath)).toBe(true);
      expect(existsSync('public'+glove.hiTexturePath)).toBe(true);
    }
  });
  it('opts into authored skin colour only while that real cosmetic texture is active', () => {
    const material=new THREE.MeshStandardMaterial(); const cosmetic=new THREE.Texture(); const mask=new THREE.Texture();
    setGloveMask(material,mask,.2,.6);
    setGloveColorComposite(material,cosmetic,true,true);
    const uniforms=material.userData.gloveMaskUniforms;
    expect(uniforms.uGloveAuthoredSkin.value).toBe(1);
    expect(uniforms.uGloveMask.value).toBe(mask); expect(uniforms.uGloveMetal.value).toBe(.2);
    setGloveColorComposite(material,cosmetic,true);
    expect(uniforms.uGloveAuthoredSkin.value).toBe(0);
    setGloveColorComposite(material,null,false,true);
    expect(uniforms.uGloveAuthoredSkin.value).toBe(0); expect(uniforms.uGloveColorOn.value).toBe(0);
    material.dispose(); cosmetic.dispose(); mask.dispose();
  });
});
