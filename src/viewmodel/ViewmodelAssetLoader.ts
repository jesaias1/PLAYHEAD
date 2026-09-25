/**
 * ViewmodelAssetLoader
 * Loads and prepares real licensed artist-made assets for the first-person viewmodel:
 * 1. PSX First Person Arms (Drillimpact, CC0) with hand-painted glove textures
 * 2. Low-Poly Karambit (alixor22, CC-BY 4.0) with PBR materials and cosmic shader integration
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KarambitCosmicMaterial } from './KarambitCosmicShader';
import { KarambitSkinSystem } from './KarambitSkinSystem';
import { DEFAULT_MASTERY_GLOVE_ID } from '../mastery/MasteryLadder';
import { applyGloveTreatment, getGloveTreatment } from './GloveTreatments';
import {
  GLOVE_MASK_TEXTURE_PATH,
  GloveTextureSwitcher,
  gloveMaskCache,
  gloveTextureCache,
  hasOwnGloveTexture,
  setGloveMask
} from './GloveTextures';

export interface ViewmodelRigInstance {
  rootGroup: THREE.Group;
  armsScene: THREE.Group;
  knifeGroup: THREE.Group;
  handRBone: THREE.Bone | THREE.Object3D;
  handLBone: THREE.Bone | THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  knifeIdleAction: THREE.AnimationAction | null;
  knifeDrawAction: THREE.AnimationAction | null;
  knifeMaterials: THREE.Material[];
  cosmicMaterial: KarambitCosmicMaterial | null;
  applySkin: (skinId: string) => void;
  accentColor: THREE.Color;
  setAccentColor: (col: THREE.Color) => void;
  /** Weak musical accent applied to the hands' reflected-light shading. */
  setAudioPulse: (pulse: number) => void;
  /**
   * MASTERY GLOVE: applies a mastery treatment to the EXISTING arm materials.
   * Material parameters only — no new textures, geometry, materials or draw
   * calls, and it never touches the frozen knife socket.
   */
  applyGlove: (gloveId: string, effectScale?: number) => void;
  /** The glove currently applied, for DEV diagnostics and tests. */
  getActiveGloveId: () => string;
  /** The base-color texture currently on the arm materials. */
  getActiveGloveTexture: () => THREE.Texture | null;
  /** Arm materials, exposed for DEV diagnostics and tests. */
  armMaterials: THREE.MeshStandardMaterial[];
  dispose: () => void;
}

export class ViewmodelAssetLoader {
  private static armsUrl = '/assets/viewmodel/arms/arms_rig.glb';
  private static karambitUrl = '/assets/viewmodel/karambit/karambit.glb';
  private static gloveTexUrl = '/assets/viewmodel/textures/arms_gloves_01.webp';

  /**
   * Loads and constructs the complete viewmodel rig with arms and karambit
   */
  public static async loadRig(accentColor: THREE.Color = new THREE.Color(0x00f0ff)): Promise<ViewmodelRigInstance> {
    const loader = new GLTFLoader();
    const texLoader = new THREE.TextureLoader();

    const rootGroup = new THREE.Group();
    rootGroup.name = 'ViewmodelRootGroup';

    let armsGltf: any;
    let knifeGltf: any;
    let gloveTexture: THREE.Texture | null = null;

    try {
      const results = await Promise.all([
        new Promise((res, rej) => loader.load(this.armsUrl, res, undefined, rej)),
        new Promise((res, rej) => loader.load(this.karambitUrl, res, undefined, rej)),
        new Promise<THREE.Texture | null>((res) => texLoader.load(this.gloveTexUrl, (tex) => res(tex), undefined, () => res(null)))
      ]);
      armsGltf = results[0];
      knifeGltf = results[1];
      gloveTexture = results[2];
    } catch (e) {
      console.warn('[ViewmodelAssetLoader] Failed to load GLB assets, building procedural fallback:', e);
      return this.buildFallbackRig(accentColor);
    }

    const armsScene = armsGltf.scene as THREE.Group;
    armsScene.name = 'ArmsScene';

    // Keep the authored skin/glove texture as the dominant colour source.
    // Palette colour is supplied spatially by the dedicated fill/rim lights and
    // the silhouette pass; putting it in material emissive colours every texel
    // equally and reads as recoloured skin. This tiny neutral lift only prevents
    // crushed detail and carries a deliberately faint audio response.
    const armMaterials: THREE.MeshStandardMaterial[] = [];
    const baseHandEmissive = new THREE.Color(0x101722);
    const baseHandEmissiveIntensity = 0.08;
    let handAudioPulse = 0;
    // MASTERY GLOVE treatment. Defaults to the standard-issue glove, which is
    // the same neutral lift the hands used before mastery gloves existed.
    let activeGloveTreatment = getGloveTreatment(DEFAULT_MASTERY_GLOVE_ID);
    let gloveEffectScale = 1;
    let activeGloveId: string = DEFAULT_MASTERY_GLOVE_ID;
    let activeGloveHasOwnTexture = false;
    /** Shared glove-region mask. Null until (and unless) the optional asset loads. */
    let gloveMaskTexture: THREE.Texture | null = null;
    /**
     * Monotonic selection token. A slow texture load for an EARLIER glove must
     * never overwrite a later selection.
     */
    const gloveSwitcher = new GloveTextureSwitcher(gloveTextureCache);

    const applyArmMaterialLift = () => {
      applyGloveTreatment(
        armMaterials,
        activeGloveTreatment,
        handAudioPulse,
        gloveEffectScale,
        activeGloveHasOwnTexture
      );
      // Scope metalness/roughness to glove pixels when a shared mask exists.
      for (const mat of armMaterials) {
        setGloveMask(
          mat,
          gloveMaskTexture,
          activeGloveTreatment.metalness,
          activeGloveTreatment.roughness
        );
      }
    };

    // Configure Arms Materials and Textures
    if (gloveTexture) {
      gloveTexture.flipY = false;
      gloveTexture.minFilter = THREE.LinearMipmapLinearFilter;
      gloveTexture.magFilter = THREE.NearestFilter; // Sharp retro PSX texture filtering
      gloveTexture.generateMipmaps = true;

      armsScene.traverse((obj: THREE.Object3D) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          if (mesh.material) {
            const mat = new THREE.MeshStandardMaterial({
              map: gloveTexture,
              roughness: 0.62,
              metalness: 0.18,
              emissive: baseHandEmissive.clone(),
              emissiveIntensity: baseHandEmissiveIntensity
            });
            mesh.material = mat;
            armMaterials.push(mat);
          }
        }
      });
    }

    // Locate hand bones (Three.js sanitizes bone names like hand.R -> handR)
    let handRBone: THREE.Object3D | null = null;
    let handLBone: THREE.Object3D | null = null;

    armsScene.traverse((obj: THREE.Object3D) => {
      if (obj.name === 'hand.R' || obj.name === 'handR') handRBone = obj;
      if (obj.name === 'hand.L' || obj.name === 'handL') handLBone = obj;
    });

    if (!handRBone) {
      console.warn('[ViewmodelAssetLoader] handR not found, using root of arms');
      handRBone = armsScene;
    }
    if (!handLBone) {
      handLBone = armsScene;
    }

    // Configure Karambit Model & Socket
    const knifeScene = knifeGltf.scene as THREE.Group;
    const knifeGroup = new THREE.Group();
    knifeGroup.name = 'KarambitSocket';

    // Scale and orient knife for authentic FPS karambit hold
    const knifeScale = 0.85;
    knifeScene.scale.set(knifeScale, knifeScale, knifeScale);
    // Shift knife local origin so the handle sits precisely inside the right hand palm tunnel
    knifeScene.position.set(0.0, 0.025, 0.065);

    // Apply Karambit Cosmic Shader & Tactical Titanium handle
    let cosmicMaterial: KarambitCosmicMaterial | null = null;
    const knifeMaterials: THREE.Material[] = [];
    const canonicalCyan = new THREE.Color(0x00f0ff);
    const activeAccent = canonicalCyan.clone();
    const artifactRim = canonicalCyan.clone();

    knifeScene.traverse((obj: THREE.Object3D) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        if (mesh.material) {
          const origMat = mesh.material as THREE.MeshStandardMaterial;

          cosmicMaterial = new KarambitCosmicMaterial();
          cosmicMaterial.uniforms.tDiffuse.value = origMat.map || null;
          cosmicMaterial.uniforms.tNormal.value = origMat.normalMap || null;
          cosmicMaterial.uniforms.tMetallicRoughness.value = origMat.metalnessMap || origMat.roughnessMap || null;

          // Initialize with currently equipped skin from KarambitSkinSystem
          KarambitSkinSystem.getInstance().applyToMaterial(cosmicMaterial);

          mesh.material = cosmicMaterial;
          knifeMaterials.push(cosmicMaterial);
        }
      }
    });

    knifeGroup.add(knifeScene);

    // Attach karambit into right hand bone socket
    handRBone.add(knifeGroup);

    // Calibrated socket transform:
    // Palm wraps securely around handle grooves, retention ring rests against heel of palm, blade curls forward/left
    knifeGroup.position.set(0.0093, 0.1107, 0.0033);
    knifeGroup.rotation.set(3.034, 0.3737, 0.2205);
    knifeGroup.scale.set(1.011, 1.011, 1.011);

    // Animation Mixer Setup
    let mixer: THREE.AnimationMixer | null = null;
    let knifeIdleAction: THREE.AnimationAction | null = null;
    let knifeDrawAction: THREE.AnimationAction | null = null;

    if (armsGltf.animations && armsGltf.animations.length > 0) {
      mixer = new THREE.AnimationMixer(armsScene);

      const idleClip = armsGltf.animations.find((a: THREE.AnimationClip) => a.name === 'knife_idle') ||
        armsGltf.animations.find((a: THREE.AnimationClip) => a.name === 'guard_idle') ||
        armsGltf.animations[0];

      if (idleClip) {
        knifeIdleAction = mixer.clipAction(idleClip);
        knifeIdleAction.setEffectiveTimeScale(0.85); // Gentle, subtle breathing cadence
        knifeIdleAction.play();
      }

      const drawClip = armsGltf.animations.find((a: THREE.AnimationClip) => a.name === 'knife_draw');
      if (drawClip) {
        knifeDrawAction = mixer.clipAction(drawClip);
        knifeDrawAction.setLoop(THREE.LoopOnce, 1);
        knifeDrawAction.clampWhenFinished = true;
      }
    }

    rootGroup.add(armsScene);

    const applySkin = (skinId: string) => {
      if (cosmicMaterial) {
        KarambitSkinSystem.getInstance().applyToMaterial(cosmicMaterial, skinId);
      }
    };

    const setAccentColor = (col: THREE.Color) => {
      // Palette-dominant accent. The knife's canonical SIGNAL CYAN identity is
      // retained as a minor 20% anchor rather than the dominant term, so the
      // accent actually tracks the map (violet map -> violet, red -> crimson)
      // while never snapping to a raw fully-saturated hue.
      activeAccent.copy(col).lerp(canonicalCyan, 0.2);

      if (cosmicMaterial) {
        const equipped = KarambitSkinSystem.getInstance().getEquippedSkin();
        if (equipped.profile.isCanonical) {
          cosmicMaterial.uniforms.uRimColor.value.copy(activeAccent);
        } else if (equipped.profile.isVideoArtifact) {
          // The level palette belongs on the physical edge/reflection only.
          // It never multiplies the source video sampled inside the blade.
          artifactRim.copy(equipped.profile.rimColor).lerp(activeAccent, 0.58);
          cosmicMaterial.uniforms.uRimColor.value.copy(artifactRim);
        }
      }
    };

    const setAudioPulse = (pulse: number) => {
      handAudioPulse = Math.max(0, Math.min(0.32, pulse));
      applyArmMaterialLift();
    };

    /**
     * MASTERY GLOVE — texture + treatment, async safe.
     *
     * 1. resolve treatment
     * 2. resolve texture path
     * 3. load lazily (cache hit avoids any fetch)
     * 4. apply to the EXISTING arm materials
     * 5. apply the material treatment
     *
     * Geometry, skeleton, mixer, knife and the viewmodel root are never touched.
     * A missing optional texture falls back to the canonical atlas, and a slow
     * load can never overwrite a newer selection (see GloveTextureSwitcher).
     */
    const applyGlove = (gloveId: string, effectScale = 1) => {
      activeGloveId = gloveId;
      activeGloveTreatment = getGloveTreatment(gloveId);
      gloveEffectScale = Number.isFinite(effectScale) && effectScale > 0 ? effectScale : 1;
      activeGloveHasOwnTexture = hasOwnGloveTexture(gloveId);

      void gloveSwitcher.apply(gloveId, gloveTexture, (texture, hasOwnTexture) => {
        setArmTexture(texture, hasOwnTexture);
        applyArmMaterialLift();
      });
    };

    /** Swaps the base-color map on every arm material. Nothing else changes. */
    const setArmTexture = (texture: THREE.Texture | null, neutralColor: boolean) => {
      for (const mat of armMaterials) {
        if (texture) mat.map = texture;
        if (neutralColor) {
          // The texture carries the colour, so skin is never repainted.
          mat.color.setHex(0xffffff);
        }
        mat.needsUpdate = true;
      }
    };

    // The shared glove mask is fetched once per session, lazily, and is entirely
    // optional: with no mask the shader patch is a no-op.
    void gloveMaskCache.load(GLOVE_MASK_TEXTURE_PATH).then((mask) => {
      if (!mask) return;
      gloveMaskTexture = mask;
      applyArmMaterialLift();
    });

    // Start on the standard-issue glove so the authored look is unchanged until
    // the controller applies the equipped mastery glove.
    applyArmMaterialLift();

    const dispose = () => {
      if (mixer) mixer.stopAllAction();
      rootGroup.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const m = obj as THREE.Mesh;
          m.geometry?.dispose();
          if (Array.isArray(m.material)) {
            m.material.forEach((mat) => mat.dispose());
          } else {
            m.material?.dispose();
          }
        }
      });
      gloveTexture?.dispose();
    };

    return {
      rootGroup,
      armsScene,
      knifeGroup,
      handRBone,
      handLBone,
      mixer,
      knifeIdleAction,
      knifeDrawAction,
      knifeMaterials,
      cosmicMaterial,
      applySkin,
      accentColor: activeAccent,
      setAccentColor,
      setAudioPulse,
      applyGlove,
      getActiveGloveId: () => activeGloveId,
      getActiveGloveTexture: () => armMaterials[0]?.map ?? null,
      armMaterials,
      dispose
    };
  }

  /**
   * Lightweight fallback rig for unit test environments or headless tests
   */
  public static buildFallbackRig(accentColor: THREE.Color = new THREE.Color(0x00f0ff)): ViewmodelRigInstance {
    const rootGroup = new THREE.Group();
    const armsScene = new THREE.Group();
    const handRBone = new THREE.Group();
    const handLBone = new THREE.Group();
    const knifeGroup = new THREE.Group();

    handRBone.name = 'hand.R';
    handLBone.name = 'hand.L';
    handRBone.position.set(0.18, -0.15, -0.3);
    handLBone.position.set(-0.18, -0.15, -0.3);

    armsScene.add(handRBone);
    armsScene.add(handLBone);
    handRBone.add(knifeGroup);
    rootGroup.add(armsScene);

    const cosmicMat = new KarambitCosmicMaterial();
    KarambitSkinSystem.getInstance().applyToMaterial(cosmicMat);
    const fallbackRim = new THREE.Color();

    // A real hand material so mastery glove treatments are exercised (and
    // testable) even without the authored GLB assets.
    const fallbackHandMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.62,
      metalness: 0.18,
      emissive: 0x101722,
      emissiveIntensity: 0.08
    });
    const armMaterials: THREE.MeshStandardMaterial[] = [fallbackHandMaterial];
    let handAudioPulse = 0;
    let activeGloveTreatment = getGloveTreatment(DEFAULT_MASTERY_GLOVE_ID);
    let gloveEffectScale = 1;
    let activeGloveId: string = DEFAULT_MASTERY_GLOVE_ID;
    let activeGloveHasOwnTexture = false;

    return {
      rootGroup,
      armsScene,
      knifeGroup,
      handRBone,
      handLBone,
      mixer: null,
      knifeIdleAction: null,
      knifeDrawAction: null,
      knifeMaterials: [cosmicMat],
      cosmicMaterial: cosmicMat,
      applySkin: (skinId: string) => {
        KarambitSkinSystem.getInstance().applyToMaterial(cosmicMat, skinId);
      },
      accentColor: accentColor.clone(),
      setAccentColor: (col: THREE.Color) => {
        const equipped = KarambitSkinSystem.getInstance().getEquippedSkin();
        if (equipped.profile.isCanonical) {
          cosmicMat.uniforms.uRimColor.value.copy(col);
        } else if (equipped.profile.isVideoArtifact) {
          fallbackRim.copy(equipped.profile.rimColor).lerp(col, 0.58);
          cosmicMat.uniforms.uRimColor.value.copy(fallbackRim);
        }
      },
      setAudioPulse: (pulse: number) => {
        handAudioPulse = Math.max(0, Math.min(0.32, pulse));
        applyGloveTreatment(
          armMaterials,
          activeGloveTreatment,
          handAudioPulse,
          gloveEffectScale,
          activeGloveHasOwnTexture
        );
      },
      applyGlove: (gloveId: string, effectScale = 1) => {
        activeGloveTreatment = getGloveTreatment(gloveId);
        activeGloveId = gloveId;
        activeGloveHasOwnTexture = hasOwnGloveTexture(gloveId);
        gloveEffectScale = Number.isFinite(effectScale) && effectScale > 0 ? effectScale : 1;
        applyGloveTreatment(
          armMaterials,
          activeGloveTreatment,
          handAudioPulse,
          gloveEffectScale,
          activeGloveHasOwnTexture
        );
        for (const mat of armMaterials) {
          setGloveMask(mat, null, activeGloveTreatment.metalness, activeGloveTreatment.roughness);
        }
      },
      getActiveGloveId: () => activeGloveId,
      getActiveGloveTexture: () => armMaterials[0]?.map ?? null,
      armMaterials,
      dispose: () => {
        cosmicMat.dispose();
        fallbackHandMaterial.dispose();
      }
    };
  }
}
