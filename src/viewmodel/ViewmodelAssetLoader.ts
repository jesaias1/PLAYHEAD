/**
 * ViewmodelAssetLoader
 * Loads and prepares real licensed artist-made assets for the first-person viewmodel:
 * 1. PSX First Person Arms (Drillimpact, CC0) with hand-painted glove textures
 * 2. Low-Poly Karambit (alixor22, CC-BY 4.0) with PBR materials and track emissive channel
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

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
  accentColor: THREE.Color;
  setAccentColor: (col: THREE.Color) => void;
  dispose: () => void;
}

export class ViewmodelAssetLoader {
  private static armsUrl = '/assets/viewmodel/arms/arms_rig.glb';
  private static karambitUrl = '/assets/viewmodel/karambit/karambit.glb';
  private static gloveTexUrl = '/assets/viewmodel/textures/arms_gloves_01.png';

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
              roughness: 0.55,
              metalness: 0.25
            });
            mesh.material = mat;
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

    // Apply PLAYHEAD dark titanium / charcoal aesthetic and emissive channel
    const knifeMaterials: THREE.Material[] = [];
    const activeAccent = accentColor.clone();

    knifeScene.traverse((obj: THREE.Object3D) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        if (mesh.material) {
          const origMat = mesh.material as THREE.MeshStandardMaterial;
          const stylizedMat = new THREE.MeshStandardMaterial({
            map: origMat.map || null,
            normalMap: origMat.normalMap || null,
            metalnessMap: origMat.metalnessMap || null,
            roughnessMap: origMat.roughnessMap || null,
            color: new THREE.Color(0x3a4250),
            roughness: 0.22,
            metalness: 0.88,
            emissive: activeAccent,
            emissiveIntensity: 0.35
          });
          mesh.material = stylizedMat;
          knifeMaterials.push(stylizedMat);
        }
      }
    });

    knifeGroup.add(knifeScene);

    // Attach karambit into right hand bone socket
    handRBone.add(knifeGroup);

    // Calibrated socket transform:
    // Palm wraps securely around handle grooves, retention ring rests against heel of palm, blade curls forward/left
    knifeGroup.position.set(0.0105, 0.1101, 0.0009);
    knifeGroup.rotation.set(3.0159, 0.4466, 0.2277);
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

    const setAccentColor = (col: THREE.Color) => {
      activeAccent.copy(col);
      knifeMaterials.forEach((m) => {
        if ((m as THREE.MeshStandardMaterial).emissive) {
          (m as THREE.MeshStandardMaterial).emissive.copy(col);
        }
      });
    };

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
      accentColor: activeAccent,
      setAccentColor,
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

    const mat = new THREE.MeshStandardMaterial({
      color: 0x334455,
      emissive: accentColor,
      emissiveIntensity: 0.5
    });

    return {
      rootGroup,
      armsScene,
      knifeGroup,
      handRBone,
      handLBone,
      mixer: null,
      knifeIdleAction: null,
      knifeDrawAction: null,
      knifeMaterials: [mat],
      accentColor: accentColor.clone(),
      setAccentColor: (col: THREE.Color) => {
        mat.emissive.copy(col);
      },
      dispose: () => {
        mat.dispose();
      }
    };
  }
}
