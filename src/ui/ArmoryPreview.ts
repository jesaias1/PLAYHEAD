/**
 * ArmoryPreview — a single reusable 3D cosmetic preview for the Armory detail
 * panel.
 *
 * ONE lazy renderer / scene / rig, reused for every selection and both modes.
 * The rig is built through the SAME ViewmodelAssetLoader + KarambitSkinSystem
 * paths gameplay uses, so knives and gloves render with the real shaders and
 * textures. All cosmetic state lives on an ISOLATED preview instance of
 * KarambitSkinSystem: previewing never equips, persists, emits equip events,
 * mutates the frozen knife socket, or touches the gameplay/replay cosmetic.
 *
 * The calibrated socket transform is preserved verbatim; only preview parent
 * groups are transformed for framing and drift.
 */

import * as THREE from 'three';
import { ViewmodelAssetLoader, ViewmodelRigInstance } from '../viewmodel/ViewmodelAssetLoader';
import { KarambitSkinSystem } from '../viewmodel/KarambitSkinSystem';

/**
 * There is exactly ONE preview mode: an isolated ITEM view that shows either a
 * knife OR a pair of gloves from the selected slot. The former combined
 * knife+gloves LOADOUT view was removed because compositing both on the shared
 * rig was unreliable and visually buggy.
 */
export type ArmoryPreviewMode = 'item';

export interface ArmoryPreviewSelection {
  /** Which slot the user is inspecting. */
  slot: 'karambit' | 'gloves';
  /** Selected item id for that slot (knife skin id or glove id). */
  itemId: string | null;
  equippedKnifeId: string;
  equippedGloveId: string;
}

/** Known canonical catalog id — safe to construct the rig with, never a video. */
const SAFE_INITIAL_SKIN_ID = 'SIGNAL_CYAN';

// Calibrated socket transform (must never be altered).
const SOCKET_POSITION = new THREE.Vector3(0.0093, 0.1107, 0.0033);
const SOCKET_ROTATION = new THREE.Euler(3.034, 0.3737, 0.2205);
const SOCKET_SCALE = new THREE.Vector3(1.011, 1.011, 1.011);

const MAX_WIDTH = 600;
const MAX_FPS = 30;
const MAX_DPR = 1.5;

export class ArmoryPreview {
  private static activePreview: ArmoryPreview | null = null;
  private readonly root: HTMLElement;
  private readonly canvasHost: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly itemBtn: HTMLButtonElement;

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private readonly cameraTarget = new THREE.Vector3();
  private contentRoot: THREE.Group | null = null;
  private knifeParent: THREE.Group | null = null;
  private rig: ViewmodelRigInstance | null = null;
  private socketHome: THREE.Object3D | null = null;

  /** Preview bone rotations are restored before every selection and mode change. */
  private previewPoseRestore: { bone: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion }[] = [];

  private readonly skinSystem = KarambitSkinSystem.createPreviewInstance();
  private selection: ArmoryPreviewSelection | null = null;
  private mode: ArmoryPreviewMode = 'item';

  private loading = false;
  private visible = false;
  private inViewport = true;
  private running = false;
  private disposed = false;
  private raf = 0;
  private lastFrame = 0;
  private driftPhase = 0;

  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private readonly onDocumentVisibility = (): void => this.evaluate();

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'armory-preview';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'armory-preview-canvas';
    this.canvas.setAttribute('aria-label', '3D cosmetic preview');

    this.canvasHost = document.createElement('div');
    this.canvasHost.className = 'armory-preview-stage';
    this.canvasHost.appendChild(this.canvas);

    const toolbar = document.createElement('div');
    toolbar.className = 'armory-preview-modes';
    this.itemBtn = this.buildModeButton('ITEM PREVIEW', 'item');
    toolbar.appendChild(this.itemBtn);

    this.root.appendChild(this.canvasHost);
    this.root.appendChild(toolbar);
    this.syncModeButtons();

    document.addEventListener('visibilitychange', this.onDocumentVisibility);
  }

  private buildModeButton(label: string, mode: ArmoryPreviewMode): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'armory-preview-mode-btn';
    btn.textContent = label;
    btn.addEventListener('click', () => this.setMode(mode));
    return btn;
  }

  private syncModeButtons(): void {
    this.itemBtn.classList.add('active');
    this.itemBtn.setAttribute('aria-pressed', 'true');
  }

  /**
   * (Re)attach the persistent preview DOM into a freshly rendered detail panel.
   * The renderer/scene/rig are never recreated by a selection re-render.
   */
  public mount(container: HTMLElement): void {
    if (this.disposed) return;
    if (this.root.parentElement !== container) container.appendChild(this.root);
    this.observeViewport();
  }

  /**
   * Kept as a no-op entry point for callers/tests. The only supported mode is
   * 'item'; any legacy 'loadout' request is ignored so the combined view can
   * never be re-entered.
   */
  public setMode(mode: ArmoryPreviewMode): void {
    if (this.disposed || this.mode === mode) return;
    this.mode = 'item';
    this.syncModeButtons();
    if (this.running) this.applySelection();
  }

  public getMode(): ArmoryPreviewMode {
    return this.mode;
  }

  public update(selection: ArmoryPreviewSelection): void {
    if (this.disposed) return;
    this.selection = selection;
    if (this.running) this.applySelection();
    this.evaluate();
  }

  /** The panel is on screen and wants the preview live. */
  public show(): void {
    if (this.disposed) return;
    if (ArmoryPreview.activePreview !== this) ArmoryPreview.activePreview?.hide();
    ArmoryPreview.activePreview = this;
    this.visible = true;
    this.evaluate();
  }

  /** The panel is hidden: stop the loop and release this instance's video. */
  public hide(): void {
    if (this.disposed) return;
    if (ArmoryPreview.activePreview === this) ArmoryPreview.activePreview = null;
    this.visible = false;
    this.evaluate();
  }

  private observeViewport(): void {
    if (this.intersectionObserver || typeof IntersectionObserver === 'undefined') return;
    this.intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) this.inViewport = entry.isIntersecting;
      this.evaluate();
    }, { threshold: 0.01 });
    this.intersectionObserver.observe(this.root);
  }

  private evaluate(): void {
    if (this.disposed) return;
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (this.visible && !hidden && this.inViewport && this.selection && !this.rig) void this.ensureRig();
    const shouldRun = this.visible && !hidden && this.inViewport && !!this.rig;
    if (shouldRun) {
      // Resuming after a hide/suspend re-applies the selection so a released
      // preview video texture is rebuilt on THIS instance only.
      if (!this.running) this.applySelection();
      this.startLoop();
    } else {
      this.stopLoop();
    }
  }

  private async ensureRig(): Promise<void> {
    if (this.disposed || this.rig || this.loading) return;
    this.loading = true;
    this.ensureRenderer();
    try {
      const rig = await ViewmodelAssetLoader.loadRig(new THREE.Color(0x00f0ff), {
        skinSystem: this.skinSystem,
        initialSkinId: SAFE_INITIAL_SKIN_ID
      });
      if (this.disposed) {
        rig.dispose();
        return;
      }
      this.installRig(rig);
    } catch (e) {
      console.warn('[ArmoryPreview] Failed to build preview rig:', e);
    } finally {
      this.loading = false;
      this.evaluate();
    }
  }

  private ensureRenderer(): void {
    if (this.renderer || !this.canvas) return;
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'low-power'
    });
    renderer.setClearColor(0x05090f, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    renderer.shadowMap.enabled = false;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.001, 50);

    // Neutral white key/fill with a restrained cyan rim so glove colour reads
    // truthfully and the cosmic knife keeps its authored identity.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x101820, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(0.8, 1.2, 1.4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.7);
    fill.position.set(-1.0, 0.2, 0.8);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0x00f0ff, 0.5);
    rim.position.set(-0.6, 0.6, -1.0);
    scene.add(rim);

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvasHost);
    this.resize();
  }

  private installRig(rig: ViewmodelRigInstance): void {
    if (!this.scene) return;
    this.rig = rig;
    this.socketHome = rig.handRBone;
    // Preserve the calibrated socket transform verbatim.
    rig.knifeGroup.position.copy(SOCKET_POSITION);
    rig.knifeGroup.rotation.copy(SOCKET_ROTATION);
    rig.knifeGroup.scale.copy(SOCKET_SCALE);

    const contentRoot = new THREE.Group();
    contentRoot.name = 'ArmoryPreviewContent';
    contentRoot.add(rig.rootGroup);
    const knifeParent = new THREE.Group();
    knifeParent.name = 'ArmoryPreviewKnifeParent';
    contentRoot.add(knifeParent);
    this.contentRoot = contentRoot;
    this.knifeParent = knifeParent;
    this.scene.add(contentRoot);

    // Pose to a useful idle frame and hold it (no per-frame skeletal cost).
    if (rig.mixer) {
      rig.mixer.setTime(0.4);
      rig.mixer.update(0);
    }

    this.layout(this.mode === 'item' && this.selection?.slot === 'karambit', this.mode === 'item' && this.selection?.slot === 'gloves');
  }

  private applySelection(): void {
    const rig = this.rig;
    const selection = this.selection;
    if (!rig || !selection) return;

    const selectedIsKnife = selection.slot === 'karambit';
    const itemId = selection.itemId;
    // Both modes resolve the SAME combination: the selected slot uses the
    // inspected item, the other slot uses the equipped cosmetic. The mode only
    // changes the camera/visibility layout below.
    const knifeId = selectedIsKnife && itemId ? itemId : selection.equippedKnifeId;
    const gloveId = !selectedIsKnife && itemId ? itemId : selection.equippedGloveId;

    const visibleKnifeId = this.mode === 'item' && !selectedIsKnife ? SAFE_INITIAL_SKIN_ID : knifeId;
    this.skinSystem.setPreviewSkin(visibleKnifeId);
    rig.applySkin(visibleKnifeId);
    rig.applyGlove(gloveId);

    const isolateKnife = this.mode === 'item' && selectedIsKnife;
    const isolateGloves = this.mode === 'item' && !selectedIsKnife;
    this.layout(isolateKnife, isolateGloves);
  }

  /**
   * ITEM knife: detach the socket into a dedicated preview parent and hide the
   * arms. ITEM gloves: reattach the socket (hidden) and show the arms. LOADOUT:
   * first-person hands + the resolved knife.
   */
  private layout(isolateKnife: boolean, isolateGloves: boolean): void {
    const rig = this.rig;
    const knifeParent = this.knifeParent;
    const home = this.socketHome;
    if (!rig || !knifeParent || !home) return;

    if (isolateKnife) {
      if (rig.knifeGroup.parent !== knifeParent) knifeParent.add(rig.knifeGroup);
      rig.armsScene.visible = false;
      rig.knifeGroup.visible = true;
    } else {
      if (rig.knifeGroup.parent !== home) home.add(rig.knifeGroup);
      rig.knifeGroup.position.copy(SOCKET_POSITION);
      rig.knifeGroup.rotation.copy(SOCKET_ROTATION);
      rig.knifeGroup.scale.copy(SOCKET_SCALE);
      rig.armsScene.visible = true;
      rig.knifeGroup.visible = !isolateGloves;
    }

    // GLOVE ITEM: authored relaxed pose, no knife grip. LOADOUT and the knife
    // ITEM keep the gameplay idle pose (the knife calibration needs it).
    this.resetPreviewPose();
    rig.poseTo(isolateGloves ? 'relax' : null);

    // Reset drift so a mode switch never inherits a stale rotation.
    this.driftPhase = 0;
    if (this.knifeParent) this.knifeParent.rotation.set(0, 0, 0);
    if (this.contentRoot) {
      // Preview parent only: orient the authored arms from below the eyeline.
      this.contentRoot.rotation.set(isolateKnife ? 0 : -Math.PI / 2, 0, 0);
      this.contentRoot.updateMatrixWorld(true);
    }

    if (!isolateKnife) {
      this.applyPreviewGlovePose(isolateGloves);
      this.contentRoot?.updateMatrixWorld(true);
    }
    this.fitCamera(isolateKnife);
  }

  /**
   * Restores every bone we nudged to its authored pose. Called before each
   * layout so preview offsets never accumulate across selections or modes.
   */
  private resetPreviewPose(): void {
    for (const entry of this.previewPoseRestore) {
      entry.bone.position.copy(entry.position);
      entry.bone.quaternion.copy(entry.quaternion);
    }
    this.previewPoseRestore = [];
  }

  /** Record the authored local transform once, then add a local-space offset. */
  private nudgeBone(name: string, rotation: [number, number, number]): THREE.Object3D | null {
    const rig = this.rig;
    if (!rig) return null;
    const bone = rig.armsScene.getObjectByName(name);
    if (!bone) return null;
    this.previewPoseRestore.push({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone() });
    bone.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2])));
    return bone;
  }

  /** Bring both wrists inward; glove ITEM also exposes back and palm/side detail. */
  private applyPreviewGlovePose(isolateGloves: boolean): void {
    // Rotate around preview world Z to bring the wrists inward without stretching.
    for (const [name, angle] of [['upper_armR', -0.35], ['upper_armL', 0.35]] as const) {
      const bone = this.nudgeBone(name, [0, 0, 0]);
      if (!bone) continue;
      const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()).invert());
      bone.rotateOnAxis(axis, angle);
      bone.updateWorldMatrix(false, true);
    }
    if (!isolateGloves) return;
    this.nudgeBone('forearmR', [0, -2.0, 0]);
    // Different forearm rolls provide complementary views of the glove.
    this.nudgeBone('forearmL', [0, 0.35, 0]);
  }

  private fitCamera(isolateKnife: boolean): void {
    const rig = this.rig;
    const camera = this.camera;
    if (!rig || !camera) return;

    // KNIFE ITEM: isolate the real knife at a hero three-quarter angle.
    if (isolateKnife) {
      const box = new THREE.Box3().setFromObject(rig.knifeGroup);
      if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(0.3, 0.3, 0.3));
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      this.cameraTarget.copy(sphere.center);
      const radius = Math.max(sphere.radius, 0.02);
      const dir = new THREE.Vector3(1, 0.12, 0.12).normalize();
      const distance = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2)) * 0.95;
      camera.position.copy(sphere.center).addScaledVector(dir, distance);
      camera.lookAt(sphere.center);
      camera.updateProjectionMatrix();
      return;
    }

    // HANDS (glove ITEM + LOADOUT): frame from the REAL posed wrist bones.
    // Aim above the wrists so the gloves fill the frame and arm ends stay below it.
    const handR = rig.handRBone.getWorldPosition(new THREE.Vector3());
    const handL = rig.handLBone.getWorldPosition(new THREE.Vector3());
    const handCenter = handR.clone().add(handL).multiplyScalar(0.5);
    const spread = Math.max(handR.distanceTo(handL), 0.05);

    // LOADOUT needs more room for the calibrated knife held by the right hand.
    const center = handCenter.clone();
    const isolateGloves = this.mode === 'item' && this.selection?.slot === 'gloves';
    center.y += spread * (isolateGloves ? 0.32 : 0.40);
    this.cameraTarget.copy(center);
    const radius = spread * (isolateGloves ? 0.52 : 0.72) + 0.02;
    const dir = new THREE.Vector3(0, 0.02, 1).normalize();
    const distance = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2)) * 0.95;

    camera.position.copy(center).addScaledVector(dir, distance);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
  }

  private resize(): void {
    const renderer = this.renderer;
    const camera = this.camera;
    if (!renderer || !camera) return;
    const width = Math.max(1, Math.min(this.canvasHost.clientWidth || MAX_WIDTH, MAX_WIDTH));
    const height = Math.max(1, Math.round(width * 0.78));
    this.canvasHost.style.height = `${height}px`;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  private startLoop(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = 0;
    const tick = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      if (now - this.lastFrame < 1000 / MAX_FPS) return;
      const dt = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.1) : 0;
      this.lastFrame = now;
      this.renderFrame(dt);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    // Release only THIS instance's video decode while offscreen/hidden.
    this.skinSystem.suspendActiveVideo();
  }

  private renderFrame(dt: number): void {
    const rig = this.rig;
    const renderer = this.renderer;
    const scene = this.scene;
    const camera = this.camera;
    if (!rig || !renderer || !scene || !camera) return;

    this.driftPhase += dt;
    const isolateKnife = this.mode === 'item' && this.selection?.slot === 'karambit';
    if (isolateKnife && this.knifeParent) {
      this.knifeParent.rotation.y = Math.sin(this.driftPhase * 0.6) * 0.35;
      this.knifeParent.rotation.x = Math.sin(this.driftPhase * 0.4) * 0.08;
    } else if (this.contentRoot) {
      this.contentRoot.rotation.y = Math.sin(this.driftPhase * 0.35) * 0.06;
    }

    rig.cosmicMaterial?.updateTime(dt);
    renderer.render(scene, camera);
  }

  public dispose(): void {
    if (this.disposed) return;
    if (ArmoryPreview.activePreview === this) ArmoryPreview.activePreview = null;
    this.disposed = true;
    this.stopLoop();
    document.removeEventListener('visibilitychange', this.onDocumentVisibility);
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.resizeObserver = null;
    this.intersectionObserver = null;
    this.rig?.dispose();
    this.rig = null;
    this.skinSystem.dispose();
    this.renderer?.dispose();
    this.renderer = null;
    this.root.remove();
  }
}
