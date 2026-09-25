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
    const hasOwn = hasOwnGloveTexture(gloveId);
    const path = resolveGloveTexturePath(gloveId);

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

/** Uniforms injected into an arm material when the mask patch is installed. */
export interface GloveMaskUniforms {
  uGloveMask: { value: THREE.Texture | null };
  uGloveMaskOn: { value: number };
  uGloveMetal: { value: number };
  uGloveRough: { value: number };
}

/**
 * Installs the shared-mask patch on an arm material.
 *
 * The patch only ever LERPS toward the treatment values where the mask says
 * "glove". With `uGloveMaskOn = 0` every mix is a no-op, so a build without a
 * mask behaves exactly as it did before this pipeline existed.
 *
 * No new material, no new geometry, no extra draw call.
 */
export function installGloveMaskPatch(material: THREE.MeshStandardMaterial): GloveMaskUniforms {
  const existing = material.userData.gloveMaskUniforms as GloveMaskUniforms | undefined;
  if (existing) return existing;

  const uniforms: GloveMaskUniforms = {
    uGloveMask: { value: null },
    uGloveMaskOn: { value: 0 },
    uGloveMetal: { value: material.metalness },
    uGloveRough: { value: material.roughness }
  };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGloveMask = uniforms.uGloveMask;
    shader.uniforms.uGloveMaskOn = uniforms.uGloveMaskOn;
    shader.uniforms.uGloveMetal = uniforms.uGloveMetal;
    shader.uniforms.uGloveRough = uniforms.uGloveRough;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uGloveMask;
uniform float uGloveMaskOn;
uniform float uGloveMetal;
uniform float uGloveRough;`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
#ifdef USE_UV
  float gloveMaskR = mix(1.0, texture2D(uGloveMask, vUv).r, uGloveMaskOn);
  roughnessFactor = mix(roughnessFactor, uGloveRough, gloveMaskR);
#endif`
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
#ifdef USE_UV
  float gloveMaskM = mix(1.0, texture2D(uGloveMask, vUv).r, uGloveMaskOn);
  metalnessFactor = mix(metalnessFactor, uGloveMetal, gloveMaskM);
#endif`
      );
  };
  material.needsUpdate = true;

  material.userData.gloveMaskUniforms = uniforms;
  return uniforms;
}

/** Updates the shared mask on a material. `null` disables the patch entirely. */
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
