
/**
 * ArmoryPreview - a single reusable 3D cosmetic preview for the Armory detail
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
 * groups are transformed for framing.
 *
 * CAMERA ORBIT: the user drives the camera by dragging on the canvas (pointer
 * events, mouse + touch via pointer capture), with arrow keys as a keyboard
 * equivalent and a RESET control that returns to the authored framing. There is
 * NO idle drift: an automatic rotation must never fight or overwrite the view
 * the user chose.
 *
 * SINGLE GLOVE: in glove ITEM view the preview clones the arm geometry, keeps
 * ONLY the right-hand subtree, and renders that filtered index geometry. The
 * clone is owned by this preview and disposed with it; the original gameplay /
 * shared geometry is NEVER mutated.
 */

import * as THREE from 'three';
import { ViewmodelAssetLoader, ViewmodelRigInstance } from '../viewmodel/ViewmodelAssetLoader';
import { KarambitSkinSystem } from '../viewmodel/KarambitSkinSystem';
import { GloveTextureCache, hasAnyOwnGloveTexture, resolveAnyGloveTexturePath } from '../viewmodel/GloveTextures';

/**
 * There is exactly ONE preview mode: an isolated ITEM view that shows either a
 * knife OR gloves from the selected slot. The former combined knife+gloves
 * LOADOUT view was removed because compositing both on the shared rig was
 * unreliable and visually buggy.
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

/** Known canonical catalog id - safe to construct the rig with, never a video. */
const SAFE_INITIAL_SKIN_ID = 'SIGNAL_CYAN';

// Calibrated socket transform (must never be altered).
const SOCKET_POSITION = new THREE.Vector3(0.0093, 0.1107, 0.0033);
const SOCKET_ROTATION = new THREE.Euler(3.034, 0.3737, 0.2205);
const SOCKET_SCALE = new THREE.Vector3(1.011, 1.011, 1.011);

const MAX_WIDTH = 600;
const MAX_FPS = 30;
const MAX_DPR = 1.5;

/** Forearm vertices within this fraction of the hand radius are kept. */
const FOREARM_KEEP_FRACTION = 0.5;
/** Smallest allowed framing radius so a degenerate box cannot clip. */
const MIN_FIT_RADIUS = 0.001;

/** Camera-orbit pitch limits (radians) so the subject never flips over. */
const ORBIT_MIN_PITCH = -0.85;
const ORBIT_MAX_PITCH = 0.85;
/** User-visible orbit hint, hidden once the user has interacted. */
const DRAG_HINT_TEXT = 'DRAG TO ROTATE';

/** True when the ITEM view is isolating the knife. */
export function isolateKnifeSelection(mode: ArmoryPreviewMode, selection: ArmoryPreviewSelection | null): boolean {
  return mode === 'item' && selection?.slot === 'karambit';
}

/** True when the ITEM view is isolating the single glove. */
export function isolateGloveSelection(mode: ArmoryPreviewMode, selection: ArmoryPreviewSelection | null): boolean {
  return mode === 'item' && selection?.slot === 'gloves';
}

/** Pure orbit math, extracted so interactions can be unit tested headlessly. */
export interface OrbitAngles {
  yaw: number;
  pitch: number;
}

export function clampPitch(pitch: number): number {
  return Math.min(ORBIT_MAX_PITCH, Math.max(ORBIT_MIN_PITCH, pitch));
}

/** Applies a drag delta (fraction of the canvas) to the current orbit angles. */
export function applyOrbitDrag(current: OrbitAngles, dxFraction: number, dyFraction: number): OrbitAngles {
  return {
    yaw: current.yaw + dxFraction * Math.PI * 2,
    pitch: clampPitch(current.pitch + dyFraction * Math.PI)
  };
}

/** Applies a keyboard nudge (radians) to the orbit angles. */
export function applyOrbitKeys(current: OrbitAngles, dYaw: number, dPitch: number): OrbitAngles {
  return { yaw: current.yaw + dYaw, pitch: clampPitch(current.pitch + dPitch) };
}

/**
 * The camera position for an orbit offset about the SAME pivot the camera looks
 * at, so the subject stays framed while the user rotates around it.
 */
export function orbitCameraPosition(
  center: THREE.Vector3,
  baseDir: THREE.Vector3,
  distance: number,
  angles: OrbitAngles,
  target: THREE.Vector3
): THREE.Vector3 {
  const base = baseDir.clone().normalize();
  const spherical = new THREE.Spherical().setFromVector3(base);
  spherical.theta += angles.yaw;
  // `angles.pitch` is an OFFSET from the authored framing, so the rest pose
  // (offset 0) is reproduced exactly; only the offset is bounded.
  const pitchOffset = clampPitch(angles.pitch);
  spherical.phi = Math.min(Math.PI - 0.05, Math.max(0.05, spherical.phi + pitchOffset));
  target.setFromSpherical(spherical).multiplyScalar(distance).add(center);
  return target;
}

/** Result of the preview-owned glove filter. */
export interface RetainedGloveGeometry {
  originalGeometry: THREE.BufferGeometry;
  filteredGeometry: THREE.BufferGeometry;
  retainedWorldBox: THREE.Box3;
  keptTriangles: number;
  handRadius: number;
}

/**
 * HEADLESS-CORE: computes the preview-owned glove geometry for a skinned mesh.
 *
 * Returns a plain signature (no Three scene handshake), so it can be unit tested
 * with synthetic skinned geometry. The caller assigns `filteredGeometry` to the
 * mesh and MUST later restore `originalGeometry` and dispose `filteredGeometry`.
 *
 * Rule: keep a triangle only when every vertex is influenced ONLY by bones in
 * the handR `subtree`, OR by `forearmR` within `keepFraction * handRadius` of the
 * posed handR wrist; require at least one triangle vertex dominated by the hand
 * subtree. Returns null when the mesh is not glove-shaped enough to filter.
 */
export function buildRetainedGloveGeometry(
  mesh: THREE.SkinnedMesh,
  handR: THREE.Object3D,
  subtree: Set<string>,
  keepFraction = FOREARM_KEEP_FRACTION
): RetainedGloveGeometry | null {
  const skeleton = mesh.skeleton;
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const skinIndex = geometry.attributes.skinIndex as THREE.BufferAttribute | undefined;
  const skinWeight = geometry.attributes.skinWeight as THREE.BufferAttribute | undefined;
  const position = geometry.attributes.position as THREE.BufferAttribute | undefined;
  const index = geometry.index;
  if (!skeleton || !skinIndex || !skinWeight || !position || !index) return null;

  // applyBoneTransform reads skeleton.boneMatrices, which only the renderer
  // refreshes. Flatten the CURRENT posed bones now so the filter measures the
  // exact pose that will be rendered.
  skeleton.update();
  const boneNames = skeleton.bones.map((b) => b.name);
  const forearmRIndex = boneNames.indexOf('forearmR');
  const wrist = handR.getWorldPosition(new THREE.Vector3());

  const count = position.count;
  const dominantHand = new Uint8Array(count);
  const dist = new Float32Array(count);

  // Posed distance of every vertex from the posed right wrist.
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    mesh.getVertexPosition(i, v);
    v.applyMatrix4(mesh.matrixWorld);
    dist[i] = v.distanceTo(wrist);
  }

  // Hand radius from vertices whose dominant influence is the hand subtree.
  let handRadius = 0;
  for (let i = 0; i < count; i++) {
    let dominantBone = -1;
    let dominantWeight = -1;
    for (let k = 0; k < 4; k++) {
      const weight = skinWeight.getComponent(i, k);
      if (weight <= 1e-4) continue;
      if (weight > dominantWeight) {
        dominantWeight = weight;
        dominantBone = skinIndex.getComponent(i, k);
      }
    }
    dominantHand[i] = subtree.has(boneNames[dominantBone] ?? '') ? 1 : 0;
    if (dominantHand[i]) handRadius = Math.max(handRadius, dist[i]);
  }
  if (!(handRadius > 0)) return null;

  const cut = keepFraction * handRadius;
  const vertexOk = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    let onlyAllowed = true;
    for (let k = 0; k < 4; k++) {
      const weight = skinWeight.getComponent(i, k);
      if (weight <= 1e-4) continue;
      const boneIdx = skinIndex.getComponent(i, k);
      const name = boneNames[boneIdx] ?? '';
      if (subtree.has(name)) continue;
      if (boneIdx === forearmRIndex && dist[i] <= cut) continue;
      onlyAllowed = false;
      break;
    }
    vertexOk[i] = onlyAllowed ? 1 : 0;
  }

  const indices = index.array as ArrayLike<number>;
  const kept: number[] = [];
  const used = new Set<number>();
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t];
    const i1 = indices[t + 1];
    const i2 = indices[t + 2];
    if (!(vertexOk[i0] && vertexOk[i1] && vertexOk[i2])) continue;
    if (!(dominantHand[i0] || dominantHand[i1] || dominantHand[i2])) continue;
    kept.push(i0, i1, i2);
    used.add(i0); used.add(i1); used.add(i2);
  }
  if (kept.length === 0) return null;

  const box = new THREE.Box3();
  const tmp = new THREE.Vector3();
  for (const i of used) {
    mesh.getVertexPosition(i, tmp);
    tmp.applyMatrix4(mesh.matrixWorld);
    box.expandByPoint(tmp);
  }

  const filtered = geometry.clone();
  filtered.setIndex(kept);
  filtered.setDrawRange(0, kept.length);
  filtered.computeBoundingBox();
  filtered.computeBoundingSphere();

  return {
    originalGeometry: geometry,
    filteredGeometry: filtered,
    retainedWorldBox: box,
    keptTriangles: kept.length / 3,
    handRadius
  };
}

export class ArmoryPreview {
  private readonly status: HTMLElement;
  private rigFailed = false;
  private static activePreview: ArmoryPreview | null = null;
  private readonly root: HTMLElement;
  private readonly canvasHost: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly itemBtn: HTMLButtonElement;
  private readonly resetBtn: HTMLButtonElement;
  private readonly hint: HTMLElement;

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private readonly cameraTarget = new THREE.Vector3();
  private readonly cameraBaseDir = new THREE.Vector3(0, 0.02, 1).normalize();
  private cameraDistance = 1;
  private contentRoot: THREE.Group | null = null;
  private knifeParent: THREE.Group | null = null;
  private rig: ViewmodelRigInstance | null = null;
  private socketHome: THREE.Object3D | null = null;

  /** Preview bone rotations are restored before every selection and mode change. */
  private previewPoseRestore: { bone: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion }[] = [];

  private readonly skinSystem = KarambitSkinSystem.createPreviewInstance();
  // Browsing gloves must never evict the texture worn by the gameplay rig.
  private readonly gloveCache = new GloveTextureCache(undefined, undefined, 1);
  private selection: ArmoryPreviewSelection | null = null;
  private mode: ArmoryPreviewMode = 'item';

  /** User camera orbit. Never auto-driven. */
  private orbit: OrbitAngles = { yaw: 0, pitch: 0 };
  private userInteracted = false;
  private dragging = false;
  private pointerId: number | null = null;
  private lastPointer = { x: 0, y: 0 };

  /** Preview-owned single-glove geometry override (null when not in glove view). */
  private gloveFilter: (RetainedGloveGeometry & { mesh: THREE.SkinnedMesh }) | null = null;
  private retainedGloveBox: THREE.Box3 | null = null;

  private loading = false;
  private visible = false;
  private inViewport = true;
  private running = false;
  private disposed = false;
  private raf = 0;
  private lastFrame = 0;

  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private readonly onDocumentVisibility = (): void => this.evaluate();
  private readonly onPointerDown = (e: PointerEvent): void => this.handlePointerDown(e);
  private readonly onPointerMove = (e: PointerEvent): void => this.handlePointerMove(e);
  private readonly onPointerUp = (e: PointerEvent): void => this.handlePointerUp(e);
  private readonly onKeyDown = (e: KeyboardEvent): void => this.handleKeyDown(e);

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'armory-preview';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'armory-preview-canvas';
    this.canvas.setAttribute('aria-label', '3D cosmetic preview');
    // The user drags to orbit; the browser must not scroll/zoom the page instead.
    this.canvas.style.touchAction = 'none';
    this.canvas.tabIndex = 0;

    this.canvasHost = document.createElement('div');
    this.canvasHost.className = 'armory-preview-stage';
    this.canvasHost.appendChild(this.canvas);

    this.hint = document.createElement('div');
    this.hint.className = 'armory-preview-hint';
    this.hint.textContent = DRAG_HINT_TEXT;
    this.canvasHost.appendChild(this.hint);
    this.status = document.createElement('div');
    this.status.className = 'armory-preview-status';
    this.status.setAttribute('role', 'status');
    this.canvasHost.appendChild(this.status);

    const toolbar = document.createElement('div');
    toolbar.className = 'armory-preview-modes';
    this.itemBtn = this.buildModeButton('ITEM PREVIEW', 'item');
    this.resetBtn = document.createElement('button');
    this.resetBtn.type = 'button';
    this.resetBtn.className = 'armory-preview-mode-btn armory-preview-reset';
    this.resetBtn.textContent = 'RESET VIEW';
    this.resetBtn.addEventListener('click', () => this.resetView());
    toolbar.appendChild(this.itemBtn);
    toolbar.appendChild(this.resetBtn);

    this.root.appendChild(this.canvasHost);
    this.root.appendChild(toolbar);
    this.syncModeButtons();

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('lostpointercapture', this.onPointerUp);
    this.root.addEventListener('keydown', this.onKeyDown);

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

  // -- Pointer / keyboard orbit -------------------------------------------

  private handlePointerDown(e: PointerEvent): void {
    if (this.disposed || this.dragging) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.dragging = true;
    this.pointerId = e.pointerId;
    this.lastPointer = { x: e.clientX, y: e.clientY };
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture is best-effort; dragging still works without it.
    }
    this.markInteracted();
    e.preventDefault();
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.dragging || this.pointerId !== e.pointerId) return;
    const width = Math.max(1, this.canvas.clientWidth || 1);
    const height = Math.max(1, this.canvas.clientHeight || 1);
    const dx = (e.clientX - this.lastPointer.x) / width;
    const dy = (e.clientY - this.lastPointer.y) / height;
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.orbit = applyOrbitDrag(this.orbit, dx, dy);
    e.preventDefault();
  }

  private handlePointerUp(e: PointerEvent): void {
    if (this.pointerId !== null && e.pointerId !== this.pointerId) return;
    this.dragging = false;
    this.pointerId = null;
    try {
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Capture may already be gone; nothing to release.
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (this.disposed) return;
    const step = e.shiftKey ? 0.24 : 0.1;
    let dYaw = 0;
    let dPitch = 0;
    switch (e.key) {
      case 'ArrowLeft': dYaw = -step; break;
      case 'ArrowRight': dYaw = step; break;
      case 'ArrowUp': dPitch = -step; break;
      case 'ArrowDown': dPitch = step; break;
      default: return;
    }
    this.orbit = applyOrbitKeys(this.orbit, dYaw, dPitch);
    this.markInteracted();
    e.preventDefault();
  }

  private markInteracted(): void {
    if (this.userInteracted) return;
    this.userInteracted = true;
    this.hint.classList.add('hidden');
  }

  /** Returns the camera to the authored framing and re-shows the hint. */
  public resetView(): void {
    this.orbit = { yaw: 0, pitch: 0 };
    this.userInteracted = false;
    this.hint.classList.remove('hidden');
    this.applyOrbitToCamera();
  }

  /** For tests/diagnostics: the current orbit. */
  public getOrbit(): OrbitAngles {
    return { ...this.orbit };
  }

  // -- Mount / selection ---------------------------------------------------

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
    this.releasePointer();
    this.selection = selection;
    if (this.running) this.applySelection();
    this.evaluate();
  }

  /** Accurate preview status, e.g. for a small loading/error query. */
  public getStatus(): 'no-rig' | 'loading' | 'ready' {
    if (!this.rig) return this.loading ? 'loading' : 'no-rig';
    return 'ready';
  }

  /** The panel is on screen and wants the preview live. */
  public show(): void {
    if (this.disposed) return;
    if (ArmoryPreview.activePreview !== this) ArmoryPreview.activePreview?.hide();
    ArmoryPreview.activePreview = this;
    this.visible = true;
    this.rigFailed = false;
    this.evaluate();
  }

  /** The panel is hidden: stop the loop and release this instance's video. */
  public hide(): void {
    if (this.disposed) return;
    if (ArmoryPreview.activePreview === this) ArmoryPreview.activePreview = null;
    this.visible = false;
    this.releasePointer();
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
    if (this.visible && !hidden && this.inViewport && this.selection && !this.rig && !this.rigFailed) void this.ensureRig();
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
    this.updateLoadingStatus();
    try {
      this.ensureRenderer();
      const rig = await ViewmodelAssetLoader.loadRig(new THREE.Color(0x00f0ff), {
        skinSystem: this.skinSystem,
        gloveCache: this.gloveCache,
        initialSkinId: SAFE_INITIAL_SKIN_ID
      });
      if (this.disposed) {
        rig.dispose();
        return;
      }
      this.installRig(rig);
    } catch (e) {
      this.rigFailed = true;
      console.warn('[ArmoryPreview] Failed to build preview rig:', e);
    } finally {
      this.loading = false;
      this.updateLoadingStatus();
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

    this.layout(isolateKnifeSelection(this.mode, this.selection), isolateGloveSelection(this.mode, this.selection));
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

    const visibleKnifeId = !selectedIsKnife ? SAFE_INITIAL_SKIN_ID : knifeId;
    this.skinSystem.setPreviewSkin(visibleKnifeId);
    rig.applySkin(visibleKnifeId);
    rig.applyGlove(gloveId);

    this.layout(isolateKnifeSelection(this.mode, this.selection), isolateGloveSelection(this.mode, this.selection));
  }

  /**
   * ITEM knife: detach the socket into a dedicated preview parent and hide the
   * arms. ITEM gloves: reattach the socket (hidden) and show ONLY the filtered
   * right-hand geometry.
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

    // GLOVE ITEM: authored relaxed pose, no knife grip. The knife ITEM keeps the
    // gameplay idle pose (the knife calibration needs it).
    this.resetPreviewPose();
    rig.poseTo(isolateGloves ? 'relax' : null);

    // Drop any previous filtered glove geometry BEFORE re-posing so the filter is
    // always computed from the exact pose that will be rendered.
    this.removeSingleGloveGeometry();

    if (this.contentRoot) {
      // Preview parent only: orient the authored arms from below the eyeline.
      this.contentRoot.rotation.set(isolateKnife ? 0 : -Math.PI / 2, 0, 0);
      this.contentRoot.updateMatrixWorld(true);
    }

    if (!isolateKnife) {
      if (isolateGloves) this.installSingleGloveGeometry();
      this.contentRoot?.updateMatrixWorld(true);
    }
    this.fitCamera(isolateKnife);
  }

  // -- Single-glove geometry ----------------------------------------------

  /**
   * Installs a PREVIEW-OWNED filtered geometry for the right hand.
   *
   * The gameplay/shared arm geometry is never mutated: it is cloned, the glove
   * triangle set is selected on the clone, and the clone is disposed with this
   * preview. The cloned mesh additionally exposes the original geometry through
   * `userData.previewOriginalGeometry`, so a disposal walk can release BOTH.
   */
  private installSingleGloveGeometry(): void {
    const rig = this.rig;
    if (!rig || this.gloveFilter) return;

    const skinnedMeshes: THREE.SkinnedMesh[] = [];
    rig.armsScene.traverse((obj) => {
      if ((obj as THREE.SkinnedMesh).isSkinnedMesh) skinnedMeshes.push(obj as THREE.SkinnedMesh);
    });
    if (skinnedMeshes.length === 0) return;

    // Posed positions need current bone matrices; force a fresh skeleton update.
    rig.rootGroup.updateMatrixWorld(true);

    const handR = rig.handRBone;
    const subtree = new Set<string>();
    (function walk(o: THREE.Object3D): void {
      subtree.add(o.name);
      for (const child of o.children) walk(child);
    })(handR);

    for (const mesh of skinnedMeshes) {
      const filter = buildRetainedGloveGeometry(mesh, handR, subtree);
      if (filter) {
        this.gloveFilter = { ...filter, mesh };
        break;
      }
    }
    if (!this.gloveFilter) return;

    const { mesh, originalGeometry, filteredGeometry, retainedWorldBox } = this.gloveFilter;
    mesh.geometry = filteredGeometry;
    mesh.userData.previewOriginalGeometry = originalGeometry;
    mesh.userData.armoryGloveFilter = true;
    mesh.visible = true;
    this.retainedGloveBox = retainedWorldBox;
  }

  /** Restores the original shared geometry and disposes the preview-owned clone. */
  private removeSingleGloveGeometry(): void {
    const filter = this.gloveFilter;
    if (!filter) return;
    filter.mesh.geometry = filter.originalGeometry;
    delete filter.mesh.userData.previewOriginalGeometry;
    delete filter.mesh.userData.armoryGloveFilter;
    filter.filteredGeometry.dispose();
    this.gloveFilter = null;
    this.retainedGloveBox = null;
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

  /**
   * KNIFE ITEM: isolate the knife at a hero three-quarter angle. GLOVES: fit the
   * ACTUAL retained posed geometry (the filtered right-hand box) rather than a
   * two-wrist spread, so the single glove fills the frame on both aspects.
   */
  private fitCamera(isolateKnife: boolean): void {
    const rig = this.rig;
    const camera = this.camera;
    if (!rig || !camera) return;

    if (isolateKnife) {
      const box = new THREE.Box3().setFromObject(rig.knifeGroup);
      if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(0.3, 0.3, 0.3));
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      this.cameraTarget.copy(sphere.center);
      this.cameraDistance = (Math.max(sphere.radius, MIN_FIT_RADIUS) / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2)) * 0.95;
      this.cameraBaseDir.set(1, 0.12, 0.12).normalize();
      this.applyOrbitToCamera();
      return;
    }

    // HANDS: frame the retained posed geometry (falling back to the arms scene).
    const retained = this.retainedGloveBox;
    const box = new THREE.Box3();
    if (retained && !retained.isEmpty()) {
      box.copy(retained);
    } else {
      rig.rootGroup.updateMatrixWorld(true);
      box.setFromObject(rig.armsScene);
    }
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(0.3, 0.3, 0.3));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.cameraTarget.copy(sphere.center);
    // Fit against the NARROWER of the two FOVs so both portrait and landscape
    // canvases keep the subject fully inside the frame.
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(camera.aspect, 0.0001));
    const fitFov = Math.min(vFov, hFov);
    this.cameraDistance = (Math.max(sphere.radius, MIN_FIT_RADIUS) / Math.sin(fitFov / 2)) * 0.98;
    this.cameraBaseDir.set(0, 0.02, 1).normalize();
    this.applyOrbitToCamera();
  }

  /** Re-derives the camera position from the fitted target/distance and orbit. */
  private applyOrbitToCamera(): void {
    const camera = this.camera;
    if (!camera) return;
    orbitCameraPosition(this.cameraTarget, this.cameraBaseDir, this.cameraDistance, this.orbit, camera.position);
    camera.lookAt(this.cameraTarget);
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
    // Refit keeps the subject framed after an aspect change.
    this.fitCamera(isolateKnifeSelection(this.mode, this.selection));
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
    this.releasePointer();
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

    // NO IDLE DRIFT: the camera is only ever moved by the user's own input, so a
    // chosen view is never overwritten by an automatic rotation.
    this.applyOrbitToCamera();
    this.updateLoadingStatus();
    rig.cosmicMaterial?.updateTime(dt);
    renderer.render(scene, camera);
  }

  private updateLoadingStatus(): void {
    let text = this.rigFailed ? 'PREVIEW UNAVAILABLE // REOPEN TO RETRY' : this.loading ? 'LOADING PREVIEW…' : '';
    if (this.rig && this.selection) {
      if (this.selection.slot === 'karambit') {
        const state = this.skinSystem.getTextureStatus(this.skinSystem.getActiveRenderSkinId());
        if (state === 'pending') text = 'LOADING SKIN…';
        if (state === 'error') text = 'SKIN UNAVAILABLE // SELECT AGAIN TO RETRY';
      } else {
        const id = this.selection.itemId ?? this.selection.equippedGloveId;
        if (hasAnyOwnGloveTexture(id)) {
          const state = this.gloveCache.getStatus(resolveAnyGloveTexturePath(id));
          if (state === 'loading') text = 'LOADING GLOVE…';
          if (state === 'error') text = 'GLOVE UNAVAILABLE // SELECT AGAIN TO RETRY';
        }
      }
    }
    if (this.status.textContent !== text) this.status.textContent = text;
    this.canvas.setAttribute('aria-busy', String(text.startsWith('LOADING')));
  }

  public dispose(): void {
    if (this.disposed) return;
    if (ArmoryPreview.activePreview === this) ArmoryPreview.activePreview = null;
    this.disposed = true;
    // Clean, unconditional capture release even if a pointer is mid-drag.
    this.releasePointer();
    this.stopLoop();
    document.removeEventListener('visibilitychange', this.onDocumentVisibility);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('lostpointercapture', this.onPointerUp);
    this.root.removeEventListener('keydown', this.onKeyDown);
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.resizeObserver = null;
    this.intersectionObserver = null;
    // Return the shared geometry BEFORE the rig's dispose walks the tree.
    this.removeSingleGloveGeometry();
    this.rig?.dispose();
    this.rig = null;
    this.skinSystem.dispose();
    this.gloveCache.clear();
    this.renderer?.dispose();
    this.renderer = null;
    this.root.remove();
  }

  private releasePointer(): void {
    this.dragging = false;
    if (this.pointerId === null) return;
    try {
      if (this.canvas.hasPointerCapture(this.pointerId)) this.canvas.releasePointerCapture(this.pointerId);
    } catch {
      // Capture already released or unsupported in this environment.
    }
    this.pointerId = null;
  }
}
