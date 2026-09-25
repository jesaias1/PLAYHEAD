/**
 * GLOVE TEXTURE PIPELINE — real texture-based mastery glove skins.
 *
 * ONE shared arm mesh + ONE optional base-color texture per mastery glove +
 * the existing GloveTreatments material parameters.
 *
 *   TEXTURE   pattern, stitching, panel layout, markings, gold lines, crystal
 *             structure, spectral detail. Authored externally.
 *   TREATMENT roughness, metalness, emissive, audio response, effect intensity.
 *
 * WHY THERE IS A MASK
 *
 * The authored arms atlas is ~74% EXPOSED SKIN: the glove occupies a dark,
 * desaturated band across the middle of the 512x512 sheet, and the rest of the
 * sheet is bare forearm and hand. A global material tint or a global metalness
 * value therefore repaints human skin as metallic gold.
 *
 * So the pipeline supports ONE shared glove-region mask (`glove_mask.webp`),
 * used per pixel to scope metalness/roughness to glove pixels only. It is
 * OPTIONAL: with no mask present the shader patch is a no-op, so the shipped
 * look is unchanged.
 *
 * The base color is NEVER tinted globally when a glove ships its own texture —
 * the texture carries the colour, which is what keeps skin out of the treatment.
 *
 * PERFORMANCE (Production Optimization V1 must not regress)
 *   - no new geometry, no new draw calls, no new Three.js scene
 *   - no video, ever: a mastery glove texture may not be a video asset
 *   - one in-memory cache; a texture is fetched at most once per session
 *   - only the equipped glove is loaded at viewmodel creation
 *   - target size 512-1024 px maximum dimension
 */

import * as THREE from 'three';
import type { MasteryGloveId } from '../mastery/MasteryLadder';
import { getDropGlove } from './DropGloveCatalog';

/** Runtime directory for mastery glove textures. */
export const GLOVE_TEXTURE_DIR = '/assets/viewmodel/gloves';

/** The canonical authored arms atlas. Also the safe fallback for every glove. */
export const BASE_GLOVE_TEXTURE_PATH = '/assets/viewmodel/textures/arms_gloves_01.webp';

/** Optional shared glove-region mask (greyscale, R = glove). */
export const GLOVE_MASK_TEXTURE_PATH = `${GLOVE_TEXTURE_DIR}/glove_mask.webp`;

/**
 * Optional per-glove base-color texture.
 *
 * `null` means "use the canonical authored atlas". A listed path that is missing
 * on disk falls back to the atlas at runtime — the viewmodel never breaks because
 * an optional texture has not been authored yet.
 */
export const GLOVE_TEXTURES: Record<MasteryGloveId, string | null> = {
  STANDARD_ISSUE: null,
  FIRST_CONTACT: `${GLOVE_TEXTURE_DIR}/first_contact.webp`,
  SIGNAL_RUNNER: `${GLOVE_TEXTURE_DIR}/signal_runner.webp`,
  VELOCITY: `${GLOVE_TEXTURE_DIR}/velocity.webp`,
  GOLDLINE: `${GLOVE_TEXTURE_DIR}/goldline.webp`,
  DIAMOND_HAND: `${GLOVE_TEXTURE_DIR}/diamond_hand.webp`,
  SIGNAL_MASTER: `${GLOVE_TEXTURE_DIR}/signal_master.webp`
};

/** True when this glove ships (or will ship) its own base-color texture. */
export function hasOwnGloveTexture(gloveId: string): boolean {
  return GLOVE_TEXTURES[gloveId as MasteryGloveId] != null;
}

/** The path to try for a glove. Never null: falls back to the authored atlas. */
export function resolveGloveTexturePath(gloveId: string): string {
  return GLOVE_TEXTURES[gloveId as MasteryGloveId] ?? BASE_GLOVE_TEXTURE_PATH;
}

/**
 * Resolves the base-color texture for ANY glove id — mastery or Signal Drop.
 *
 * Signal Drop gloves carry their path on the catalog entry, so the reward logic
 * never has to know about texture plumbing.
 */
export function resolveAnyGloveTexturePath(gloveId: string): string {
  const drop = getDropGlove(gloveId);
  if (drop) return drop.texturePath;
  return resolveGloveTexturePath(gloveId);
}

/** True when a glove (of either family) ships its own texture. */
export function hasAnyOwnGloveTexture(gloveId: string): boolean {
  if (getDropGlove(gloveId)) return true;
  return hasOwnGloveTexture(gloveId);
}

/** Rejects anything that is not a still image, so a video can never slip in. */
export function isAllowedGloveTexturePath(path: string): boolean {
  return /\.(webp|png|jpg|jpeg)$/i.test(path);
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** Applied to every glove texture, matching the authored arms convention. */
export function configureGloveTexture(texture: THREE.Texture): THREE.Texture {
  // The arms GLB is authored with flipped V, so the texture must not be flipped.
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.NearestFilter; // keeps the sharp retro PSX texel look
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** Applies to the mask: linear data, no sRGB conversion, smooth filtering. */
export function configureMaskTexture(texture: THREE.Texture): THREE.Texture {
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * In-memory texture cache.
 *
 * A texture is fetched AT MOST ONCE per session: concurrent requests for the same
 * path share one in-flight promise, and a resolved texture is retained until the
 * cache is cleared.
 */
export class GloveTextureCache {
  private textures = new Map<string, THREE.Texture>();
  private inFlight = new Map<string, Promise<THREE.Texture | null>>();
  /** Counts real network/disk loads, so tests can prove cache reuse. */
  public loadCount = 0;

  constructor(
    private readonly configure: (t: THREE.Texture) => THREE.Texture = configureGloveTexture,
    private readonly loader: {
      load: (
        url: string,
        onLoad: (texture: THREE.Texture) => void,
        onProgress: undefined,
        onError: () => void
      ) => unknown;
    } = new THREE.TextureLoader()
  ) {}

  public has(path: string): boolean {
    return this.textures.has(path);
  }

  public get(path: string): THREE.Texture | null {
    return this.textures.get(path) ?? null;
  }

  public size(): number {
    return this.textures.size;
  }

  /**
   * Loads a texture lazily. Never throws: a missing or invalid asset resolves to
   * `null` so the caller can fall back safely.
   */
  public load(path: string): Promise<THREE.Texture | null> {
    const cached = this.textures.get(path);
    if (cached) return Promise.resolve(cached);

    const pending = this.inFlight.get(path);
    if (pending) return pending;

    if (!isAllowedGloveTexturePath(path)) {
      // A video (or any non-still asset) is never a mastery glove texture.
      return Promise.resolve(null);
    }

    this.loadCount++;
    const promise = new Promise<THREE.Texture | null>((resolve) => {
      this.loader.load(
        path,
        (texture) => {
          const configured = this.configure(texture);
          this.textures.set(path, configured);
          this.inFlight.delete(path);
          resolve(configured);
        },
        undefined,
        () => {
          // Missing optional asset: fall back, never crash the viewmodel.
          this.inFlight.delete(path);
          resolve(null);
        }
      );
    });

    this.inFlight.set(path, promise);
    return promise;
  }

  /** Disposes every cached texture. */
  public clear(): void {
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
    this.inFlight.clear();
  }
}

/**
 * Applies glove textures with a STALE-LOAD GUARD.
 *
 * Texture loading is asynchronous, so a slow load for an earlier glove must never
 * overwrite a later selection. Every `apply` takes a monotonically increasing
 * generation token; a resolved load is discarded unless its token is still the
 * current one.
 */
export class GloveTextureSwitcher {
  private generation = 0;

  constructor(private readonly cache: GloveTextureCache) {}

  /** The current selection token, for diagnostics. */
  public getGeneration(): number {
    return this.generation;
  }

  /**
   * Resolves and applies a glove's texture.
   *
   * `onApply` is called at most twice: once immediately with a safe texture (the
   * cached one, or the canonical base as a fallback) and once more if an optional
   * texture finishes loading and is still the current selection.
   */
  public async apply(
    gloveId: string,
    baseTexture: THREE.Texture | null,
    onApply: (texture: THREE.Texture | null, hasOwnTexture: boolean) => void
  ): Promise<void> {
    const generation = ++this.generation;
    const hasOwn = hasAnyOwnGloveTexture(gloveId);
    const path = resolveAnyGloveTexturePath(gloveId);

    const cached = this.cache.get(path);
    if (cached) {
      onApply(cached, true);
      return;
    }

    // The viewmodel is never blank: apply a safe texture straight away.
    onApply(baseTexture, hasOwn);
    if (!hasOwn) return;

    const texture = await this.cache.load(path);
    // STALE GUARD: a newer glove selection already won.
    if (generation !== this.generation) return;
    // Missing optional asset: keep the canonical base, never break the viewmodel.
    onApply(texture ?? baseTexture, texture !== null);
  }
}

/** Shared session cache for per-glove base-color textures. */
export const gloveTextureCache = new GloveTextureCache(configureGloveTexture);
/** Shared session cache for the optional glove-region mask. */
export const gloveMaskCache = new GloveTextureCache(configureMaskTexture);

/** Releases every cached glove texture. Called when the viewmodel is disposed. */
export function disposeGloveTextureCaches(): void {
  gloveTextureCache.clear();
  gloveMaskCache.clear();
}

// ---------------------------------------------------------------------------
// Shared mask shader patch
// ---------------------------------------------------------------------------

/** Uniforms injected into an arm material when the glove patch is installed. */
export interface GloveMaskUniforms {
  uGloveMask: { value: THREE.Texture | null };
  uGloveMaskOn: { value: number };
  uGloveColorMap: { value: THREE.Texture | null };
  uGloveColorOn: { value: number };
  uGloveMetal: { value: number };
  uGloveRough: { value: number };
}

/**
 * Installs the shared-mask patch on an arm material.
 *
 * The patch does two things, both scoped by the SAME shared mask:
 *
 *   1. BASE-COLOUR COMPOSITION. The material's `map` stays the canonical atlas,
 *      so exposed skin keeps the player's own hand tone, and the cosmetic glove
 *      texture is blended in ONLY where the mask says "glove". This is what stops
 *      a drop glove from importing its own baked skin tone.
 *   2. METALNESS / ROUGHNESS SCOPING. The treatment's material values only apply
 *      to glove pixels, so exposed skin never becomes metallic.
 *
 * UV NOTE: three r174 uses per-map UV varyings. `vMapUv` is the correct one here
 * because the arm materials always have a `map`. Using `vUv` would have been
 * silently inert.
 *
 * No new material, no new geometry, no extra draw call.
 */
export function installGloveMaskPatch(material: THREE.MeshStandardMaterial): GloveMaskUniforms {
  const existing = material.userData.gloveMaskUniforms as GloveMaskUniforms | undefined;
  if (existing) return existing;

  const uniforms: GloveMaskUniforms = {
    uGloveMask: { value: null },
    uGloveMaskOn: { value: 0 },
    uGloveColorMap: { value: null },
    uGloveColorOn: { value: 0 },
    uGloveMetal: { value: material.metalness },
    uGloveRough: { value: material.roughness }
  };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGloveMask = uniforms.uGloveMask;
    shader.uniforms.uGloveMaskOn = uniforms.uGloveMaskOn;
    shader.uniforms.uGloveColorMap = uniforms.uGloveColorMap;
    shader.uniforms.uGloveColorOn = uniforms.uGloveColorOn;
    shader.uniforms.uGloveMetal = uniforms.uGloveMetal;
    shader.uniforms.uGloveRough = uniforms.uGloveRough;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uGloveMask;
uniform float uGloveMaskOn;
uniform sampler2D uGloveColorMap;
uniform float uGloveColorOn;
uniform float uGloveMetal;
uniform float uGloveRough;
// 1.0 = apply glove treatment, 0.0 = leave the authored pixel alone.
float gloveMaskFactor = 0.0;`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
#ifdef USE_MAP
  gloveMaskFactor = mix(1.0, texture2D(uGloveMask, vMapUv).r, uGloveMaskOn);
  if (uGloveColorOn > 0.5) {
    vec4 gloveCosmetic = texture2D(uGloveColorMap, vMapUv);
    diffuseColor.rgb = mix(diffuseColor.rgb, gloveCosmetic.rgb, gloveMaskFactor);
  }
#endif`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, uGloveRough, gloveMaskFactor);`
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, uGloveMetal, gloveMaskFactor);`
      );
  };
  material.needsUpdate = true;

  material.userData.gloveMaskUniforms = uniforms;
  return uniforms;
}

/**
 * Enables/disables base-colour composition.
 *
 * `colorMap` is the cosmetic glove texture; `enabled` blends it in only where the
 * shared mask says "glove". Disabled means the material's own `map` is the base
 * colour, exactly as before this pipeline existed.
 */
export function setGloveColorComposite(
  material: THREE.MeshStandardMaterial,
  colorMap: THREE.Texture | null,
  enabled: boolean
): void {
  const uniforms = installGloveMaskPatch(material);
  uniforms.uGloveColorMap.value = colorMap;
  uniforms.uGloveColorOn.value = enabled && colorMap ? 1 : 0;
}

/** Updates the shared mask on a material. `null` disables the scoping entirely. */
export function setGloveMask(
  material: THREE.MeshStandardMaterial,
  mask: THREE.Texture | null,
  metalness: number,
  roughness: number
): void {
  const uniforms = installGloveMaskPatch(material);
  uniforms.uGloveMask.value = mask;
  uniforms.uGloveMaskOn.value = mask ? 1 : 0;
  uniforms.uGloveMetal.value = metalness;
  uniforms.uGloveRough.value = roughness;
}
