/**
 * ViewmodelController for PLAYHEAD
 * Manages the first-person viewmodel using real licensed artist-made assets:
 * - PSX First Person Arms (Drillimpact, CC0) with hand-painted runner gloves
 * - Low-Poly Karambit (alixor22, CC-BY 4.0) attached to right hand bone in tactical reverse grip
 *
 * Physics-Driven Motion:
 * - ZERO Periodic Walk Bob: Rock-solid stability when running on flat ground.
 * - Mouse Look Inertia: Second-order spring-damper lag and snap.
 * - Air-Strafe Banking: Aerodynamic bank roll and lateral wind drift responding to [A]/[D] & lateral velocity.
 * - Jump Takeoff & Landing Compression: Scaled one-shot impacts with fluid bhop chain absorption.
 * - Surf Balance Stance: Ramp-aligned lean with aerodynamic tuck.
 */

import * as THREE from 'three';
import { PlayerController } from '../player/PlayerController';
import { CameraController } from '../player/CameraController';
import { SettingsManager } from '../core/Settings';
import { ViewmodelAssetLoader, ViewmodelRigInstance } from './ViewmodelAssetLoader';
import { ViewmodelStyleFilter } from './ViewmodelStyleFilter';
import { QualityMode } from '../rendering/PostProcessing';
import { QualityPreset } from '../rendering/QualityPresets';
import { KarambitSkinSystem } from './KarambitSkinSystem';
import { KarambitCosmicMaterial } from './KarambitCosmicShader';
import { resolveEffectProfile } from '../rendering/EffectIntensity';
import { MasteryGloveSystem } from '../mastery/MasteryGloveSystem';
import { disposeGloveTextureCaches, setGloveTextureQuality } from './GloveTextures';
import { clamp } from '../utils/math';

/** One pose of a keyed viewmodel action: time, offset (m), rotation (rad). */
interface ActionKey {
  t: number;
  pos: [number, number, number];
  rot: [number, number, number];
  ease?: 'in' | 'out' | 'smooth';
}

/**
 * Knife spin, arm part: while the knife whirls the hand is held lifted and
 * turned in a little. View space: +x right, +y up, -z away from the camera.
 */
const SPIN_HOLD_POS: [number, number, number] = [-0.033, 0.032, 0];
const SPIN_HOLD_ROT: [number, number, number] = [0.09, 0.32, 0.11];

/** Knife spin is a fidget toy: it runs while clicks keep coming, then catches. */
const SPIN_SPEED = 20; // rad/s at full whirl (about 3 turns a second)
const SPIN_SUSTAIN = 0.4; // s after the last click before the knife is caught
const SPIN_CATCH_DECEL = 40; // rad/s^2: how gently the knife slows once the clicks stop
const SPIN_CATCH_EASE = 6; // 1/s: the last stretch eases out instead of braking hard
const SPIN_CATCH_MIN_SPEED = 0.6; // rad/s: the last sliver of the turn, so it never stalls
const SPIN_REST_HOLD = 0.12; // s the knife sits in the palm before the fingers close
const SPIN_CLOSE_RATE = 8; // 1/s: how fast the hand settles shut (opening is quicker)

/** Speed line: shows once the knife has turned this many times in one go. */
const SPIN_TRAIL_TURNS = 2.5;
const SPIN_TRAIL_LIFE = 0.07; // s of the blade tip's path the line keeps
const SPIN_TRAIL_MAX_POINTS = 48;
const SPIN_TRAIL_HALF_WIDTH = 0.005;

/**
 * The karambit's finger ring in knife-socket space: the centre of the hole and
 * the axis through it. Measured from karambit.glb; the knife spins about this.
 */
const KARAMBIT_RING_CENTER = new THREE.Vector3(0, 0.0131, -0.0388);
const KARAMBIT_RING_AXIS = new THREE.Vector3(1, 0, 0);
/** The blade tip in the same space: the vertex farthest from the ring. */
const KARAMBIT_TIP = new THREE.Vector3(0, -0.0815, 0.1921);
/** Along the knife, ring to tip: rolling about it shows the blade's two flats. */
const KARAMBIT_LENGTH_AXIS = KARAMBIT_TIP.clone().sub(KARAMBIT_RING_CENTER).normalize();

/**
 * Inspect: the hand lifts the knife to the middle of the view with the
 * fingers a little loose, the KNIFE rolls over about its own length to show
 * both flats (see INSPECT_AXIS), then the hand settles back. The arm itself
 * only lifts and leans a little: swinging the whole arm to show the blade
 * brought the cut end of the arm mesh into view at wide viewmodel FOV.
 */
const INSPECT_KEYS: ActionKey[] = [
  { t: 0.3, pos: [-0.1, 0.07, -0.02], rot: [0.1, 0.35, 0.3], ease: 'smooth' },
  { t: 0.85, pos: [-0.105, 0.075, -0.02], rot: [0.12, 0.4, 0.35], ease: 'smooth' },
  { t: 1.15, pos: [-0.1, 0.08, -0.02], rot: [0.02, 0.15, 0.2], ease: 'smooth' },
  { t: 1.7, pos: [-0.1, 0.085, -0.025], rot: [-0.04, 0.05, 0.12], ease: 'smooth' },
  { t: 2.05, pos: [-0.065, 0.045, -0.01], rot: [0.04, 0.15, 0.15], ease: 'smooth' },
  { t: 2.4, pos: [0, 0, 0], rot: [0, 0, 0], ease: 'smooth' }
];
/** The roll's turn (rad) at the end of each phase: show one flat, hold, show the other. */
const INSPECT_ROLL_FIRST = [0.3, 0.85] as const;
const INSPECT_ROLL_SECOND = [1.15, 1.7] as const;
const INSPECT_FINGER_OPEN = 0.4;
/** Viewmodel FOV the inspect and spin poses were tuned at. */
const POSE_REFERENCE_FOV = 65;

/** Fingers open one after another, index first, pinky last (and fold in the opposite order). */
const FINGER_STAGGER_MAX = 0.45;
const FINGER_DELAYS: Record<string, number> = { thumb: 0.04, index: 0, middle: 0.1, ring: 0.2, pinky: 0.3 };

/** Springy settle: a small nod as the spin starts and as the knife drops back into the palm. */
const KICK_STIFFNESS = 220;
const KICK_DAMPING = 16;

const smoothstep = (k: number): number => {
  const c = clamp(k, 0, 1);
  return c * c * (3 - 2 * c);
};

/** Ease with a slight overshoot at the end, so a roll settles instead of stopping dead. */
const easeInOutBack = (x: number): number => {
  const c = clamp(x, 0, 1);
  const c2 = 1.525;
  return c < 0.5
    ? (Math.pow(2 * c, 2) * ((c2 + 1) * 2 * c - c2)) / 2
    : (Math.pow(2 * c - 2, 2) * ((c2 + 1) * (c * 2 - 2) + c2) + 2) / 2;
};

/** How late a finger bone starts opening, from its name (three.js drops the dots: f_index01R). */
const fingerDelay = (boneName: string): number => {
  const m = /^(?:f_)?(thumb|index|middle|ring|pinky)0?(\d)/.exec(boneName);
  return m ? FINGER_DELAYS[m[1]] + 0.04 * (Number(m[2]) - 1) : 0;
};

const SCRATCH_A = new THREE.Vector3();
const SCRATCH_B = new THREE.Vector3();
const SCRATCH_C = new THREE.Vector3();
const SCRATCH_D = new THREE.Vector3();
const MAT_T = new THREE.Matrix4();
const MAT_W = new THREE.Matrix4();
const MAT_I = new THREE.Matrix4();
const MAT_L = new THREE.Matrix4();
const EULER = new THREE.Euler();

export class ViewmodelController {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  private rigInstance: ViewmodelRigInstance;
  private isRigLoaded = false;
  private styleFilter: ViewmodelStyleFilter;
  private hemiLight: THREE.HemisphereLight;
  private fillLight: THREE.DirectionalLight;
  private keyLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;

  private unsubscribeSkin?: () => void;
  private unsubscribeGlove?: () => void;
  /** Last mastery glove + effect scale applied, so re-application is cheap. */
  private appliedGloveId: string | null = null;
  private appliedGloveScale = -1;
  private audioImpact = 0;
  private audioBass = 0;

  // Viewmodel musical accent (deliberately far weaker than the world gates)
  private viewmodelAudioPulse = 0;
  private transientPulse = 0;
  private sustainedPulse = 0;

  public get isLoaded(): boolean {
    return this.isRigLoaded;
  }

  // Rig Groups
  private rootGroup: THREE.Group;
  private swayGroup: THREE.Group;
  private motionGroup: THREE.Group;
  private actionGroup: THREE.Group;

  // Arms Base Transform (calibrated for Drillimpact PSX arms)
  private readonly baseArmsPos = new THREE.Vector3(0, -1.58, 0);
  private readonly baseArmsRotY = Math.PI;

  /**
   * PRESENTATION OFFSET (viewmodel framing polish).
   *
   * Applied to `rootGroup`, which is the common parent of BOTH hands and the
   * knife. Moving this shifts the entire viewmodel as one rigid unit, so the
   * hand-to-knife relationship and the calibrated knife socket transform are
   * completely unaffected. Small downward shift to sit the arms/blade slightly
   * lower and less centrally on screen. Keep this modest: framing belongs here,
   * never in the calibrated knife socket or individual hand transforms.
   */
  private readonly presentationOffset = new THREE.Vector3(0, -0.105, 0);

  // Authoritative Knife Transform relative to handR socket (calibrated and authoritative)
  public knifeSocketPos = new THREE.Vector3(0.0093, 0.1107, 0.0033);
  public knifeSocketRot = new THREE.Vector3(3.034, 0.3737, 0.2205);
  public knifeSocketScale = new THREE.Vector3(1.011, 1.011, 1.011);

  // Default hardcoded references for reset
  public static readonly DEFAULT_KNIFE_POS = new THREE.Vector3(0.0093, 0.1107, 0.0033);
  public static readonly DEFAULT_KNIFE_ROT = new THREE.Vector3(3.034, 0.3737, 0.2205);
  public static readonly DEFAULT_KNIFE_SCALE = new THREE.Vector3(1.011, 1.011, 1.011);

  // Viewmodel Actions (presentation only): Mouse1 knife spin, F inspect, and
  // the legacy signal pulse. They move the ACTION GROUP (hand + knife
  // together); the spin also opens the fingers and turns the knife's flourish
  // group. The calibrated knife socket is never touched.
  private activeAction: 'NONE' | 'PULSE' | 'SPIN' | 'INSPECT' = 'NONE';
  private actionTimer = 0;
  private actionDuration = 0;
  private actionKeys: ActionKey[] = [];
  /** Knife spin: how open the fingers are (0..1) and the knife's turn so far. */
  private fingerOpen = 0;
  private spinAngle = 0;
  private spinOmega = 0;
  private spinLastClick = -10;
  /** The clicks stopped: the knife is slowing to the next whole turn. */
  private spinCatching = false;
  /** The knife is back at rest in the palm; the fingers are closing. */
  private spinAtRest = false;
  private spinDone = false;
  private spinCatchTarget = 0;
  private spinRestTime = 0;
  /** Springy nod and the wrist's small circle, added on top of the arm pose. */
  private kickY = 0;
  private kickVel = 0;
  private readonly spinWobblePos = new THREE.Vector3();
  private readonly spinWobbleRot = new THREE.Vector3();
  private readonly posePos = new THREE.Vector3();
  private readonly poseRot = new THREE.Vector3();

  // Speed line behind the blade tip while the knife whirls fast.
  private trailMesh: THREE.Mesh | null = null;
  private trailPositions = new Float32Array(SPIN_TRAIL_MAX_POINTS * 2 * 3);
  private trailColors = new Float32Array(SPIN_TRAIL_MAX_POINTS * 2 * 3);
  private readonly trailPoints: { p: THREE.Vector3; t: number }[] = [];
  private trailStrength = 0;
  /** Finger rotations as the mixer left them, restored before it runs again. */
  private readonly fingerBaseQuats: THREE.Quaternion[] = [];
  private fingersPosed = false;
  private actionClock = 0;
  /** Right-hand position in action-group space: rotations pivot about it. */
  private readonly actionPivot = new THREE.Vector3();
  /** Pose the action is blending out of, so a new input never snaps. */
  private readonly actionFromPos = new THREE.Vector3();
  private readonly actionFromRot = new THREE.Vector3();
  private readonly actionPos = new THREE.Vector3();
  private readonly actionRot = new THREE.Vector3();
  private readonly leftHandActionOffset = new THREE.Vector3();
  /** Root bone of the knife arm (see resolveKnifeArmRoot) and its rest pose. */
  private armRoot: THREE.Object3D | null = null;
  private armRootFor: THREE.Object3D | null | undefined = undefined;
  private armPosed = false;
  private offArmRoot: THREE.Object3D | null = null;
  private offArmPosed = false;
  private readonly offArmBasePos = new THREE.Vector3();
  private readonly offArmBaseQuat = new THREE.Quaternion();
  private readonly armBasePos = new THREE.Vector3();
  private readonly armBaseQuat = new THREE.Quaternion();
  private targetAccentColor = new THREE.Color(0x00f0ff);

  // Spring Physics State (Damped Harmonic Oscillator)
  private swayPos = new THREE.Vector3();
  private swayPosVel = new THREE.Vector3();
  private swayRot = new THREE.Euler(0, 0, 0, 'YXZ');
  private swayRotVel = new THREE.Vector3();

  // Target Offsets
  private targetSwayPos = new THREE.Vector3();
  private targetSwayRot = new THREE.Vector3();

  // Vertical Compression & Physics Offsets
  private compressionY = 0;
  private compressionVelY = 0;
  private wasGroundedLastFrame = true;
  private lastJumpTime = 0;

  // Air & Jump State
  private airOffset = new THREE.Vector3();
  private airRotOffset = new THREE.Vector3();

  // Surfing Balance Blend
  private surfBlend = 0;
  private surfSideTilt = 0;

  // Movement-feedback accent (ADDITIVE presentation only; never touches the
  // base knife/hand calibration or the socket transform).
  private feedbackAccentY = 0;
  private feedbackAccentVelY = 0;
  private feedbackAccentPulse = 0;

  // Track Emissive Color
  private accentColor = new THREE.Color(0x00f0ff);

  constructor() {
    // 1. Dedicated Viewmodel Scene & Camera (completely isolates viewmodel from world clipping)
    this.scene = new THREE.Scene();

    const fov = SettingsManager.getInstance().settings.viewmodelFov || 65;
    const aspect = typeof window !== 'undefined' ? window.innerWidth / window.innerHeight : 16 / 9;
    this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.01, 10.0);
    this.camera.position.set(0, 0, 0);
    this.camera.quaternion.set(0, 0, 0, 1);

    // 2. Dedicated Local Lighting (with palette adaptability)
    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x182030, 1.4);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
    this.keyLight.position.set(1.5, 2.5, 2.0);
    this.scene.add(this.keyLight);

    this.fillLight = new THREE.DirectionalLight(0x88ccff, 1.4);
    this.fillLight.position.set(-2.0, 1.5, 1.5);
    this.scene.add(this.fillLight);

    this.rimLight = new THREE.DirectionalLight(0x00f0ff, 0.75);
    this.rimLight.position.set(-1.0, -1.8, -1.2);
    this.scene.add(this.rimLight);

    // 3. Viewmodel Style Filter (4x4 Bayer dither + 48-level quantization + 1px signal rim)
    this.styleFilter = new ViewmodelStyleFilter();
    const savedQuality = SettingsManager.getInstance().settings.visualQuality;
    if (savedQuality) {
      this.styleFilter.setQuality(savedQuality);
    }

    // 4. Hierarchy: scene -> rootGroup -> swayGroup -> motionGroup -> actionGroup -> rigInstance.rootGroup
    this.rootGroup = new THREE.Group();
    this.swayGroup = new THREE.Group();
    this.motionGroup = new THREE.Group();
    this.actionGroup = new THREE.Group();

    // Presentation framing: shifts hands + knife together, never the socket.
    this.rootGroup.position.copy(this.presentationOffset);

    this.motionGroup.add(this.actionGroup);
    this.swayGroup.add(this.motionGroup);
    this.rootGroup.add(this.swayGroup);
    this.scene.add(this.rootGroup);

    // Check for developer saved calibration in localStorage
    this.loadSavedCalibration();

    // Initial temporary fallback rig while asynchronous assets load
    this.rigInstance = ViewmodelAssetLoader.buildFallbackRig(this.accentColor);
    this.applyRigBaseTransform();
    this.actionGroup.add(this.rigInstance.rootGroup);

    // 5. Asynchronously load real artist-made assets
    this.loadRealAssets();

    // 6. Subscribe to KarambitSkinSystem equip updates
    this.unsubscribeSkin = KarambitSkinSystem.getInstance().addListener(() => {
      // Always the skin that should be RENDERED (equipped, or a replay's own):
      // a late texture load must not swap a replay knife for the equipped one.
      this.applySkin(KarambitSkinSystem.getInstance().getRenderSkinId());
    });

    // 7. Subscribe to mastery glove equip updates. Eligibility is derived by the
    //    mastery system; this only re-applies the visual treatment.
    this.unsubscribeGlove = MasteryGloveSystem.getInstance().addListener(() => {
      this.applyMasteryGlove(true);
    });
    this.applyMasteryGlove(true);

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.onResize);
    }
  }

  public loadSavedCalibration(): boolean {
    try {
      if (typeof localStorage === 'undefined') return false;
      const raw = localStorage.getItem('playhead.viewmodel.karambitCalibration');
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.position) && Array.isArray(data.rotationRad)) {
        this.knifeSocketPos.set(data.position[0], data.position[1], data.position[2]);
        this.knifeSocketRot.set(data.rotationRad[0], data.rotationRad[1], data.rotationRad[2]);
        const s = typeof data.scale === 'number' ? data.scale : 1.0;
        this.knifeSocketScale.set(s, s, s);
        return true;
      }
    } catch (err) {
      console.warn('[ViewmodelController] Failed to load saved calibration:', err);
    }
    return false;
  }

  public setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  public getKnifeGroup(): THREE.Group | null {
    return this.rigInstance?.knifeGroup || null;
  }

  public getHandRBone(): THREE.Object3D | null {
    return this.rigInstance?.handRBone || null;
  }

  /**
   * Freezes viewmodel in pristine knife idle pose during developer calibration.
   * Completely zeroes out mouse sway, strafe banking, bhop impact, and surf tilt.
   */
  /**
   * DIAGNOSTIC ONLY: hides the hands/knife to isolate whether an apparent view
   * snap is the world view or a viewmodel sway illusion.
   *
   * This does NOT touch camera, input, physics, FOV or collision — it only
   * suppresses the viewmodel's own update/render.
   */
  private diagnosticHidden = false;

  public setDiagnosticHidden(hidden: boolean): void {
    this.diagnosticHidden = hidden;
    if (this.rootGroup) this.rootGroup.visible = !hidden;
  }

  private isSuppressed(): boolean {
    return this.diagnosticHidden;
  }

  public updateCalibrationPose(): void {
    const settings = SettingsManager.getInstance().settings;
    if (this.isSuppressed() || settings.viewmodelMode === 'OFF') return;

    // Reset sway and spring velocity
    this.swayPos.set(0, 0, 0);
    this.swayPosVel.set(0, 0, 0);
    this.swayRot.set(0, 0, 0, 'YXZ');
    this.swayRotVel.set(0, 0, 0);
    this.swayGroup.position.set(0, 0, 0);
    this.swayGroup.rotation.set(0, 0, 0);

    // Reset physics compression and air offsets
    this.compressionY = 0;
    this.compressionVelY = 0;
    this.airOffset.set(0, 0, 0);
    this.airRotOffset.set(0, 0, 0);
    this.motionGroup.position.set(0, 0, 0);
    this.motionGroup.rotation.set(0, 0, 0);
    this.actionGroup.position.set(0, 0, 0);
    this.actionGroup.rotation.set(0, 0, 0);
    this.resetKnifeSpin();

    // Maintain knife socket attachment with current calibrated values
    if (this.rigInstance.knifeGroup) {
      this.rigInstance.knifeGroup.position.copy(this.knifeSocketPos);
      this.rigInstance.knifeGroup.rotation.set(
        this.knifeSocketRot.x,
        this.knifeSocketRot.y,
        this.knifeSocketRot.z
      );
      this.rigInstance.knifeGroup.scale.copy(this.knifeSocketScale);
    }
  }

  private async loadRealAssets(): Promise<void> {
    try {
      const realRig = await ViewmodelAssetLoader.loadRig(this.accentColor);
      this.actionGroup.remove(this.rigInstance.rootGroup);
      this.rigInstance.dispose();

      this.rigInstance = realRig;
      this.applyRigBaseTransform();
      this.rigInstance.applySkin(KarambitSkinSystem.getInstance().getRenderSkinId());
      // Re-apply the mastery glove: the real rig replaced the fallback rig.
      this.applyMasteryGlove(true);
      this.actionGroup.add(this.rigInstance.rootGroup);
      this.isRigLoaded = true;
    } catch (err) {
      console.warn('[ViewmodelController] Asset load error, keeping fallback:', err);
    }
  }

  private applyRigBaseTransform(): void {
    const arms = this.rigInstance.armsScene;
    if (arms) {
      arms.position.copy(this.baseArmsPos);
      arms.rotation.set(0, this.baseArmsRotY, 0);
    }
    const knife = this.rigInstance.knifeGroup;
    if (knife) {
      knife.position.copy(this.knifeSocketPos);
      knife.rotation.set(this.knifeSocketRot.x, this.knifeSocketRot.y, this.knifeSocketRot.z);
      knife.scale.copy(this.knifeSocketScale);
    }
  }

  public setQuality(mode: QualityMode): void {
    this.styleFilter.setQuality(mode);
  }

  /** Applies a resolved quality preset (render scale / MSAA / stylization cost). */
  public applyQuality(preset: QualityPreset): void {
    this.styleFilter.applyPreset(preset);
    // HIGH / ULTRA load the sharper 1024 glove textures. The equipped glove is
    // re-applied so the switch is immediate and never disturbs equipped state:
    // the tier only changes which asset path is fetched, not what is worn.
    if (setGloveTextureQuality(preset.gloveTextureQuality)) {
      this.applyMasteryGlove(true, this.appliedGloveScale);
    }
  }

  public setPalette(palette: { surfaceDark?: THREE.Color; secondary?: THREE.Color; primary?: THREE.Color; highlight?: THREE.Color }): void {
    if (!palette) return;
    this.styleFilter.setPalette(
      palette.primary ? { primary: palette.primary, secondary: palette.secondary } : {}
    );

    if (palette.surfaceDark) {
      this.hemiLight.groundColor.copy(palette.surfaceDark).multiplyScalar(1.2);
    }
    if (palette.secondary) {
      this.fillLight.color.copy(palette.secondary).lerp(new THREE.Color(0xffffff), 0.65);
    }

    // ADAPTIVE VIEWMODEL ACCENT: the map's `primary` carries the section
    // identity hue, so it drives the accent. Using `highlight` here washed the
    // accent out to near-white on every palette.
    const accentSource = palette.primary || palette.secondary || palette.highlight;
    if (accentSource) {
      this.targetAccentColor.copy(accentSource);
    }
  }

  public setAccentColor(col: THREE.Color): void {
    this.targetAccentColor.copy(col);
  }

  public triggerSignalPulse(): void {
    this.activeAction = 'PULSE';
    this.actionTimer = 0;
    this.actionDuration = 0.32;
    this.audioImpact = Math.max(this.audioImpact, 1.8);
  }

  /**
   * Mouse1: the fingers open and the karambit spins round the index finger.
   * Every click keeps it going, so mashing the button is a fidget toy; when the
   * clicks stop the knife slows to a whole turn, drops into the palm and the
   * hand closes on it. A click at any point, even mid-catch, picks the spin up
   * again without restarting. Returns true so the caller can voice each click.
   * Presentation only.
   */
  public triggerSpin(): boolean {
    // The inspect rolls the knife about a different axis; let it finish first.
    if (this.activeAction === 'INSPECT') return false;
    this.spinLastClick = this.actionClock;
    this.spinCatching = false;
    this.spinAtRest = false;
    this.spinRestTime = 0;
    if (this.activeAction !== 'SPIN') {
      this.spinAngle = 0;
      this.spinOmega = 0;
      this.spinDone = false;
      this.kickVel = -0.12; // a small dip before the hand lifts
      this.beginAction('SPIN', []);
    }
    this.audioImpact = Math.max(this.audioImpact, 1.4);
    return true;
  }

  /** F: raise the knife and turn it over to look at both sides. */
  public triggerInspect(): void {
    if (this.activeAction === 'INSPECT' || this.activeAction === 'SPIN') return;
    this.beginAction('INSPECT', INSPECT_KEYS);
  }

  private beginAction(kind: 'SPIN' | 'INSPECT', keys: ActionKey[]): void {
    // Start from wherever the hand currently is, so interrupting an inspect
    // with a spin (or chaining spins) blends instead of popping.
    this.actionFromPos.copy(this.actionPos);
    this.actionFromRot.copy(this.actionRot);
    this.activeAction = kind;
    this.actionKeys = keys;
    this.actionTimer = 0;
    this.actionDuration = keys.length > 0 ? keys[keys.length - 1].t : Infinity;
  }

  /**
   * Advances the knife spin: the whirl while clicks keep coming, the catch to a
   * whole turn once they stop, then the fingers closing. Sets the arm pose the
   * keyed-action code applies and the finger opening applyKnifeSpin uses.
   */
  private updateSpin(dt: number): void {
    if (!this.spinCatching && !this.spinAtRest && this.actionClock - this.spinLastClick > SPIN_SUSTAIN) {
      this.spinCatching = true;
      // Slow at a steady rate to the first whole turn that leaves room to stop.
      const stopping = (this.spinOmega * this.spinOmega) / (2 * SPIN_CATCH_DECEL);
      this.spinCatchTarget = Math.ceil((this.spinAngle + stopping - 1e-4) / (Math.PI * 2)) * Math.PI * 2;
    }

    if (!this.spinAtRest) {
      if (this.spinCatching) {
        const remaining = this.spinCatchTarget - this.spinAngle;
        this.spinOmega = Math.min(
          this.spinOmega,
          Math.max(
            SPIN_CATCH_MIN_SPEED,
            Math.min(Math.sqrt(2 * SPIN_CATCH_DECEL * Math.max(0, remaining)), remaining * SPIN_CATCH_EASE)
          )
        );
        if (remaining <= this.spinOmega * dt) {
          this.spinAngle = this.spinCatchTarget;
          this.spinOmega = 0;
          this.spinAtRest = true;
          this.kickVel = -0.16; // the handle lands in the palm
          this.audioImpact = Math.max(this.audioImpact, 0.9);
        } else {
          this.spinAngle += this.spinOmega * dt;
        }
      } else {
        this.spinOmega += (SPIN_SPEED - this.spinOmega) * Math.min(1, dt * 10);
        this.spinAngle += this.spinOmega * dt;
      }
    }

    if (this.spinAtRest) this.spinRestTime += dt;
    const closing = this.spinAtRest && this.spinRestTime > SPIN_REST_HOLD;
    const blend = Math.min(1, dt * (closing ? SPIN_CLOSE_RATE : 16));
    this.fingerOpen += ((closing ? 0 : 1) - this.fingerOpen) * blend;
    const hold = closing ? 0 : 1;
    this.actionPos.lerp(SCRATCH_C.fromArray(SPIN_HOLD_POS).multiplyScalar(hold), blend);
    this.actionRot.lerp(SCRATCH_C.fromArray(SPIN_HOLD_ROT).multiplyScalar(hold), blend);

    // Follow-through: a springy nod, and a small circle of the wrist in time with the knife.
    const h = Math.min(dt, 0.033);
    this.kickVel += (-KICK_STIFFNESS * this.kickY - KICK_DAMPING * this.kickVel) * h;
    this.kickY += this.kickVel * h;
    const swirl = Math.min(1, this.spinOmega / SPIN_SPEED) * this.fingerOpen;
    this.spinWobblePos.set(0, this.kickY + 0.004 * Math.sin(this.spinAngle * 2) * swirl, 0);
    this.spinWobbleRot.set(
      -this.kickY * 3 + 0.035 * Math.sin(this.spinAngle) * swirl,
      0.03 * Math.cos(this.spinAngle) * swirl,
      0
    );

    if (
      closing &&
      this.fingerOpen < 0.03 &&
      this.actionPos.lengthSq() < 1e-6 &&
      Math.abs(this.kickY) < 1e-3 &&
      Math.abs(this.kickVel) < 0.02
    ) {
      this.spinDone = true;
    }
  }

  /** Inspect: the knife's roll and how loosely the hand holds it, from the action clock. */
  private updateInspect(): number {
    const t = this.actionTimer;
    const roll = (a: readonly [number, number]): number => easeInOutBack((t - a[0]) / (a[1] - a[0]));
    let angle: number;
    if (t <= INSPECT_ROLL_FIRST[0]) angle = 0;
    else if (t < INSPECT_ROLL_FIRST[1]) angle = Math.PI * roll(INSPECT_ROLL_FIRST);
    else if (t <= INSPECT_ROLL_SECOND[0]) angle = Math.PI;
    else if (t < INSPECT_ROLL_SECOND[1]) angle = Math.PI + Math.PI * roll(INSPECT_ROLL_SECOND);
    else angle = Math.PI * 2;
    this.fingerOpen =
      INSPECT_FINGER_OPEN * smoothstep((t - 0.1) / 0.3) * (1 - smoothstep((t - 1.85) / 0.35));
    return angle;
  }

  /**
   * The speed line: a tapering ribbon along the path the blade tip took in the
   * last moment, drawn additively in the accent colour. It only shows once the
   * knife has turned a few times in one go and fades as the spin slows.
   */
  private updateSpinTrail(dt: number): void {
    const whirling = this.activeAction === 'SPIN' && !this.spinAtRest;
    const fast = whirling && this.spinAngle > SPIN_TRAIL_TURNS * Math.PI * 2 && this.spinOmega > 10;
    this.trailStrength += ((fast ? 1 : 0) - this.trailStrength) * Math.min(1, dt * (fast ? 12 : 9));

    const now = this.actionClock;
    if (whirling) {
      this.rootGroup.updateMatrixWorld(true);
      const p = (this.trailPoints.length >= SPIN_TRAIL_MAX_POINTS ? this.trailPoints.shift()!.p : new THREE.Vector3())
        .copy(KARAMBIT_TIP)
        .applyMatrix4(this.rigInstance.knifeFlourishGroup.matrixWorld);
      this.trailPoints.push({ p, t: now });
    }
    while (this.trailPoints.length > 0 && now - this.trailPoints[0].t > SPIN_TRAIL_LIFE) this.trailPoints.shift();

    const pts = this.trailPoints;
    if (this.trailStrength < 0.02 || pts.length < 2) {
      if (this.trailMesh) this.trailMesh.visible = false;
      return;
    }
    if (!this.trailMesh) this.trailMesh = this.createTrailMesh();
    const mesh = this.trailMesh;
    const pos = this.trailPositions;
    const col = this.trailColors;
    // Accent colour, lifted toward white so it reads as light, not paint.
    SCRATCH_C.set(this.accentColor.r, this.accentColor.g, this.accentColor.b).lerp(SCRATCH_D.set(1, 1, 1), 0.45);
    for (let i = 0; i < pts.length; i++) {
      const age = (now - pts[i].t) / SPIN_TRAIL_LIFE;
      const life = Math.max(0, 1 - age);
      const prev = pts[Math.max(0, i - 1)].p;
      const next = pts[Math.min(pts.length - 1, i + 1)].p;
      // Across the path, square to the line of sight (the camera sits at the origin).
      SCRATCH_A.copy(next).sub(prev).cross(pts[i].p).normalize();
      const w = SPIN_TRAIL_HALF_WIDTH * life * this.trailStrength;
      const b = i * 6;
      pos[b] = pts[i].p.x + SCRATCH_A.x * w;
      pos[b + 1] = pts[i].p.y + SCRATCH_A.y * w;
      pos[b + 2] = pts[i].p.z + SCRATCH_A.z * w;
      pos[b + 3] = pts[i].p.x - SCRATCH_A.x * w;
      pos[b + 4] = pts[i].p.y - SCRATCH_A.y * w;
      pos[b + 5] = pts[i].p.z - SCRATCH_A.z * w;
      const f = life * life * this.trailStrength;
      for (let k = 0; k < 2; k++) {
        col[b + k * 3] = SCRATCH_C.x * f;
        col[b + k * 3 + 1] = SCRATCH_C.y * f;
        col[b + k * 3 + 2] = SCRATCH_C.z * f;
      }
    }
    const geo = mesh.geometry;
    geo.getAttribute('position').needsUpdate = true;
    geo.getAttribute('color').needsUpdate = true;
    geo.setDrawRange(0, (pts.length - 1) * 6);
    mesh.visible = true;
  }

  private createTrailMesh(): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.trailColors, 3).setUsage(THREE.DynamicDrawUsage));
    const index: number[] = [];
    for (let i = 0; i < SPIN_TRAIL_MAX_POINTS - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(index);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'KnifeSpinTrail';
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    this.scene.add(mesh);
    return mesh;
  }

  /**
   * Evaluates the current keyed action (spin / inspect) and poses the action
   * group. The pose is a translation plus a rotation ABOUT THE RIGHT HAND, so
   * turning the knife over reads as a wrist and forearm move rather than the
   * whole rig swinging round the camera. The off hand simply follows the
   * body: moving its bone independently would stretch the skinned arm.
   */
  private applyKeyedAction(): void {
    const rig = this.rigInstance;
    const group = this.actionGroup;
    const handR = rig.handRBone;

    // Find the knife hand with the action group at rest.
    group.position.set(0, 0, 0);
    group.rotation.set(0, 0, 0);
    group.updateWorldMatrix(true, true);
    if (handR) group.worldToLocal(handR.getWorldPosition(this.actionPivot));
    else this.actionPivot.set(0.12, -0.12, -0.3);

    // Sample the keys, blending out of the pose the action started from. The
    // spin has no keys: updateSpin has already set its pose.
    if (this.activeAction !== 'SPIN') {
      const keys = this.actionKeys;
      // The arm reaches further into view as the FOV widens: shrink the pose to match.
      const reach =
        this.activeAction === 'INSPECT'
          ? clamp(
              Math.tan((POSE_REFERENCE_FOV * Math.PI) / 360) / Math.tan((this.camera.fov * Math.PI) / 360),
              0.55,
              1
            )
          : 1;
      const t = Math.min(this.actionTimer, this.actionDuration);
      let i = 0;
      while (i < keys.length - 1 && keys[i].t <= t) i++;
      const b = keys[i];
      const aT = i === 0 ? 0 : keys[i - 1].t;
      const aPos = i === 0 ? this.actionFromPos : SCRATCH_A.fromArray(keys[i - 1].pos).multiplyScalar(reach);
      const aRot = i === 0 ? this.actionFromRot : SCRATCH_B.fromArray(keys[i - 1].rot).multiplyScalar(reach);
      const span = Math.max(1e-4, b.t - aT);
      let k = Math.min(1, Math.max(0, (t - aT) / span));
      if (b.ease === 'out') k = 1 - Math.pow(1 - k, 3);
      else if (b.ease === 'in') k = k * k;
      else k = k * k * (3 - 2 * k);
      this.actionPos.copy(aPos).lerp(SCRATCH_C.fromArray(b.pos).multiplyScalar(reach), k);
      this.actionRot.copy(aRot).lerp(SCRATCH_C.fromArray(b.rot).multiplyScalar(reach), k);
    }

    // Preferred: pose the KNIFE ARM ALONE. The motion is applied to the root
    // bone of the right arm, so the off hand stays exactly in its idle pose at
    // every FOV instead of being dragged across the view.
    const arm = this.resolveKnifeArmRoot();
    if (arm && arm.parent) {
      this.armBasePos.copy(arm.position);
      this.armBaseQuat.copy(arm.quaternion);
      this.posePos.copy(this.actionPos).add(this.spinWobblePos);
      this.poseRot.copy(this.actionRot).add(this.spinWobbleRot);
      this.poseArmRoot(arm, this.actionPivot, this.posePos, this.poseRot);
      this.armPosed = true;

      // The off arm answers with a small counter-motion, as a body does when
      // the other shoulder drives forward: it draws back and dips a little and
      // turns slightly with the torso. Moved as a whole from its own shoulder,
      // so it can never stretch; it only stirs.
      const off = this.offArmRoot;
      const handL = this.rigInstance.handLBone;
      if (off && off.parent && handL) {
        const amount = 0.3;
        this.offArmBasePos.copy(off.position);
        this.offArmBaseQuat.copy(off.quaternion);
        group.worldToLocal(handL.getWorldPosition(SCRATCH_A));
        SCRATCH_B.set(
          this.actionPos.x * 0.1 * amount,
          (this.actionPos.y * -0.25 - Math.abs(this.actionPos.x) * 0.07) * amount,
          this.actionPos.z * -0.34 * amount
        );
        SCRATCH_D.set(this.actionRot.x * 0.1 * amount, this.actionRot.y * 0.13 * amount, this.actionRot.z * 0.08 * amount);
        this.poseArmRoot(off, SCRATCH_A, SCRATCH_B, SCRATCH_D);
        this.offArmPosed = true;
      }
      return;
    }

    // Fallback (no separable arm): move the whole action group about the hand.
    group.rotation.set(this.actionRot.x, this.actionRot.y, this.actionRot.z);
    SCRATCH_C.copy(this.actionPivot).applyEuler(group.rotation);
    group.position.copy(this.actionPivot).sub(SCRATCH_C).add(this.actionPos);
  }

  /**
   * The knife flourish proper (spin or inspect roll), on top of the keyed arm
   * motion: opens the right fingers toward the rig's relaxed pose, one after
   * another, and turns the flourish group about `axis` through the karambit's
   * ring. The ring rides on the index finger, so the knife first follows that
   * finger as it straightens. The fingers are put back before the mixer next
   * evaluates (see update), as the arm roots are.
   */
  private applyKnifeFlourish(angle: number, axis: THREE.Vector3): void {
    const rig = this.rigInstance;

    // Where the index finger carries the ring, in right-hand space.
    const index = rig.indexBaseBone;
    if (index) this.matrixInHand(index, MAT_I).invert();
    rig.fingerOpenPoses.forEach((finger, i) => {
      (this.fingerBaseQuats[i] ??= new THREE.Quaternion()).copy(finger.bone.quaternion);
      const amount = smoothstep(this.fingerOpen * (1 + FINGER_STAGGER_MAX) - fingerDelay(finger.bone.name));
      finger.bone.quaternion.slerp(finger.open, amount * finger.weight);
    });
    this.fingersPosed = rig.fingerOpenPoses.length > 0;
    if (index) this.matrixInHand(index, MAT_T).multiply(MAT_I);
    else MAT_T.identity();

    // The same move in socket space, then the turn about the ring.
    const socket = rig.knifeGroup;
    socket.updateMatrix();
    MAT_W.copy(socket.matrix).invert().multiply(MAT_T).multiply(socket.matrix);
    MAT_L.makeRotationAxis(axis, angle);
    SCRATCH_C.copy(KARAMBIT_RING_CENTER).applyMatrix4(MAT_L);
    MAT_L.setPosition(SCRATCH_A.copy(KARAMBIT_RING_CENTER).sub(SCRATCH_C));
    MAT_W.multiply(MAT_L);
    MAT_W.decompose(rig.knifeFlourishGroup.position, rig.knifeFlourishGroup.quaternion, SCRATCH_C);
  }

  /** A right-hand bone's transform relative to the hand bone. */
  private matrixInHand(bone: THREE.Object3D, out: THREE.Matrix4): THREE.Matrix4 {
    out.identity();
    for (let n: THREE.Object3D | null = bone; n && n !== this.rigInstance.handRBone; n = n.parent) {
      n.updateMatrix();
      out.premultiply(n.matrix);
    }
    return out;
  }

  private resetKnifeSpin(): void {
    this.fingerOpen = 0;
    this.kickY = 0;
    this.kickVel = 0;
    this.spinWobblePos.set(0, 0, 0);
    this.spinWobbleRot.set(0, 0, 0);
    this.spinAngle = 0;
    this.spinOmega = 0;
    this.spinCatching = false;
    this.spinAtRest = false;
    this.spinDone = false;
    this.spinRestTime = 0;
    this.rigInstance.knifeFlourishGroup.position.set(0, 0, 0);
    this.rigInstance.knifeFlourishGroup.quaternion.identity();
  }

  /**
   * Applies "rotate about `pivot`, then offset" (given in action-group space)
   * to one arm's root bone, leaving the rest of the rig alone.
   */
  private poseArmRoot(arm: THREE.Object3D, pivot: THREE.Vector3, pos: THREE.Vector3, rot: THREE.Vector3): void {
    const group = this.actionGroup;
    MAT_T.makeRotationFromEuler(EULER.set(rot.x, rot.y, rot.z));
    SCRATCH_C.copy(pivot).applyMatrix4(MAT_T);
    MAT_T.setPosition(pivot.x - SCRATCH_C.x + pos.x, pivot.y - SCRATCH_C.y + pos.y, pivot.z - SCRATCH_C.z + pos.z);
    // The same transform in world space, then in the arm's parent space.
    MAT_W.copy(group.matrixWorld).multiply(MAT_T).multiply(MAT_I.copy(group.matrixWorld).invert());
    arm.updateMatrix();
    MAT_L.copy(arm.parent!.matrixWorld).invert().multiply(MAT_W).multiply(arm.parent!.matrixWorld).multiply(arm.matrix);
    MAT_L.decompose(arm.position, arm.quaternion, SCRATCH_C);
  }

  /**
   * The highest node of the right arm that the left hand does not also hang
   * from. Null when the rig has no separable knife arm.
   */
  private resolveKnifeArmRoot(): THREE.Object3D | null {
    const handR = this.rigInstance.handRBone;
    const handL = this.rigInstance.handLBone;
    if (this.armRootFor === handR) return this.armRoot;
    this.armRootFor = handR ?? null;
    this.armRoot = null;
    this.offArmRoot = null;
    if (!handR || !handL) return null;
    const shared = new Set<THREE.Object3D>();
    for (let n: THREE.Object3D | null = handL; n; n = n.parent) shared.add(n);
    let node: THREE.Object3D = handR;
    while (node.parent && !shared.has(node.parent)) node = node.parent;
    // Only a real chain counts: the hand bone alone would bend the wrist only.
    this.armRoot = node !== handR && node.parent ? node : null;
    // And the mirror image: the off arm's own root.
    const sharedR = new Set<THREE.Object3D>();
    for (let n: THREE.Object3D | null = handR; n; n = n.parent) sharedR.add(n);
    let offNode: THREE.Object3D = handL;
    while (offNode.parent && !sharedR.has(offNode.parent)) offNode = offNode.parent;
    this.offArmRoot = this.armRoot && offNode !== handL && offNode.parent ? offNode : null;
    return this.armRoot;
  }

  /**
   * ADDITIVE movement-feedback accent. Only offsets the motion group / accent
   * pulse — the base socket calibration is never modified.
   */
  public triggerMovementAccent(
    kind: 'LANDING' | 'HARD_LANDING' | 'NEAR_MISS' | 'SURF_LOCK' | 'FINISH',
    intensity = 1
  ): void {
    const p = Math.max(0, Math.min(1, intensity));
    switch (kind) {
      case 'LANDING':
        this.feedbackAccentVelY -= 0.06 * p;
        break;
      case 'HARD_LANDING':
        this.feedbackAccentVelY -= 0.14 * p;
        break;
      case 'NEAR_MISS':
        this.feedbackAccentPulse = Math.max(this.feedbackAccentPulse, 0.5 * p);
        break;
      case 'SURF_LOCK':
        this.feedbackAccentPulse = Math.max(this.feedbackAccentPulse, 0.85 * p);
        break;
      case 'FINISH':
        this.feedbackAccentPulse = Math.max(this.feedbackAccentPulse, 1.0 * p);
        break;
    }
  }

  /** Current additive accent pulse (0..1). Presentation only. */
  public getFeedbackAccentPulse(): number {
    return this.feedbackAccentPulse;
  }

  /**
   * Updates viewmodel physics, animations, and movement responses.
   * NOTE: Periodic walking bob is strictly ZERO.
   */
  public update(
    dt: number,
    player: PlayerController,
    _camera?: CameraController,
    mouseDeltaX = 0,
    mouseDeltaY = 0
  ): void {
    const settings = SettingsManager.getInstance().settings;
    if (this.isSuppressed() || settings.viewmodelMode === 'OFF') return;

    // Update skeletal animation mixer for idle finger breathing
    // Remove last frame's additive left-hand recoil before the animation mixer
    // evaluates its authored pose. This keeps the jab non-accumulating and safe
    // for both animated and fallback rigs.
    // Likewise put the knife arm back before the mixer evaluates.
    if (this.armPosed && this.armRoot) {
      this.armRoot.position.copy(this.armBasePos);
      this.armRoot.quaternion.copy(this.armBaseQuat);
      this.armPosed = false;
    }
    if (this.offArmPosed && this.offArmRoot) {
      this.offArmRoot.position.copy(this.offArmBasePos);
      this.offArmRoot.quaternion.copy(this.offArmBaseQuat);
      this.offArmPosed = false;
    }
    // And the fingers the knife spin opened: the mixer skips unchanged tracks.
    if (this.fingersPosed) {
      this.rigInstance.fingerOpenPoses.forEach((finger, i) => finger.bone.quaternion.copy(this.fingerBaseQuats[i]));
      this.fingersPosed = false;
    }
    if (this.leftHandActionOffset.lengthSq() > 0 && this.rigInstance.handLBone) {
      this.rigInstance.handLBone.position.sub(this.leftHandActionOffset);
      this.leftHandActionOffset.set(0, 0, 0);
    }

    if (this.rigInstance.mixer) {
      this.rigInstance.mixer.update(dt);
    }

    // Update cosmic shader elapsed time and audio pulse
    if (this.rigInstance.cosmicMaterial) {
      this.rigInstance.cosmicMaterial.updateTime(dt);
      this.rigInstance.cosmicMaterial.setAudioImpact(this.audioImpact, this.audioBass);
    }

    const swayScale = settings.viewmodelSway !== undefined ? settings.viewmodelSway : 1.0;
    const speed = player.getSpeedUnits();
    const isGrounded = player.isGrounded;
    const isSurfing = player.isSurfing || player.surfState.isSurfing;

    // 1. Mouse Look Inertia (Lag & Snap via damped spring)
    const mouseSens = 0.0018 * swayScale;
    const maxMouseOffset = 0.035;

    this.targetSwayPos.x = clamp(-mouseDeltaX * mouseSens * 0.7, -maxMouseOffset, maxMouseOffset);
    this.targetSwayPos.y = clamp(mouseDeltaY * mouseSens * 0.5, -maxMouseOffset, maxMouseOffset);

    this.targetSwayRot.y = clamp(-mouseDeltaX * mouseSens * 1.8, -0.08, 0.08);
    this.targetSwayRot.x = clamp(mouseDeltaY * mouseSens * 1.5, -0.06, 0.06);

    // 2. Air-Strafe Banking & Lateral Wind Drift (Input & velocity driven, NOT cyclic)
    const keys = player.keysState as any;
    let targetStrafeRoll = 0;
    let targetStrafeX = 0;

    if (keys.left && !keys.right) {
      targetStrafeRoll = -0.045 * swayScale;
      targetStrafeX = -0.012 * swayScale;
    } else if (keys.right && !keys.left) {
      targetStrafeRoll = 0.045 * swayScale;
      targetStrafeX = 0.012 * swayScale;
    }

    this.targetSwayRot.z = targetStrafeRoll;
    this.targetSwayPos.x += targetStrafeX;

    // 3. High-Speed Aerodynamic Tuck & Drag (Continuous scaling, no hard switch)
    if (speed > 16.0) {
      const speedRatio = clamp((speed - 16.0) / 30.0, 0, 1);
      this.targetSwayPos.z = -speedRatio * 0.015; // Subtle backward drag
      this.targetSwayPos.y += -speedRatio * 0.008; // Aerodynamic tuck
    } else {
      this.targetSwayPos.z = 0;
    }

    // 4. Spring-Damper Simulation for Mouse & Strafe Sway (Second-order harmonic oscillator)
    const springK = 38.0;
    const dampingC = 9.5;

    // Position spring
    const fX = -springK * (this.swayPos.x - this.targetSwayPos.x) - dampingC * this.swayPosVel.x;
    const fY = -springK * (this.swayPos.y - this.targetSwayPos.y) - dampingC * this.swayPosVel.y;
    const fZ = -springK * (this.swayPos.z - this.targetSwayPos.z) - dampingC * this.swayPosVel.z;

    this.swayPosVel.x += fX * dt;
    this.swayPosVel.y += fY * dt;
    this.swayPosVel.z += fZ * dt;

    this.swayPos.x += this.swayPosVel.x * dt;
    this.swayPos.y += this.swayPosVel.y * dt;
    this.swayPos.z += this.swayPosVel.z * dt;

    // Rotation spring
    const rfX = -springK * (this.swayRot.x - this.targetSwayRot.x) - dampingC * this.swayRotVel.x;
    const rfY = -springK * (this.swayRot.y - this.targetSwayRot.y) - dampingC * this.swayRotVel.y;
    const rfZ = -springK * (this.swayRot.z - this.targetSwayRot.z) - dampingC * this.swayRotVel.z;

    this.swayRotVel.x += rfX * dt;
    this.swayRotVel.y += rfY * dt;
    this.swayRotVel.z += rfZ * dt;

    this.swayRot.x += this.swayRotVel.x * dt;
    this.swayRot.y += this.swayRotVel.y * dt;
    this.swayRot.z += this.swayRotVel.z * dt;

    this.swayGroup.position.copy(this.swayPos);
    this.swayGroup.rotation.copy(this.swayRot);

    // 5. Jump Takeoff & Landing Compression (Fluid Bhop Chaining)
    if (!this.wasGroundedLastFrame && isGrounded) {
      // Just landed! One-shot impact compression
      const fallSpeed = Math.abs(player.velocity.y);
      const isQuickBhop = Date.now() - this.lastJumpTime < 300;

      // In a fast bhop chain, attenuate impact by 35% to keep hops springy and light
      const compressionScale = isQuickBhop ? 0.65 : 1.0;
      const impactMagnitude = clamp(fallSpeed * 0.0018, 0.005, 0.025) * compressionScale;

      this.compressionY = -impactMagnitude;
      this.compressionVelY = 0;
    } else if (this.wasGroundedLastFrame && !isGrounded && player.velocity.y > 2.0) {
      // Just jumped! Small one-shot upward release
      this.lastJumpTime = Date.now();
      this.compressionY = -0.008;
      this.compressionVelY = 0.25;
    }
    this.wasGroundedLastFrame = isGrounded;

    // Spring rebound for landing compression (fast spring return)
    const reboundSpringK = 45.0;
    const reboundDamping = 12.0;
    const compAcc = -reboundSpringK * this.compressionY - reboundDamping * this.compressionVelY;
    this.compressionVelY += compAcc * dt;
    this.compressionY += this.compressionVelY * dt;

    // 6. Airborne Stance (Vertical velocity influence, NO periodic bob)
    if (!isGrounded && !isSurfing) {
      const vY = player.velocity.y;
      const targetAirY = clamp(-vY * 0.0012, -0.015, 0.012);
      this.airOffset.y += (targetAirY - this.airOffset.y) * Math.min(1.0, dt * 8.0);
      this.airRotOffset.x += (clamp(vY * 0.002, -0.03, 0.03) - this.airRotOffset.x) * Math.min(1.0, dt * 8.0);
    } else {
      this.airOffset.set(0, 0, 0);
      this.airRotOffset.set(0, 0, 0);
    }

    // Movement-feedback accent spring (additive, tiny, never touches base pose)
    const fbAcc = -120.0 * this.feedbackAccentY - 17.0 * this.feedbackAccentVelY;
    this.feedbackAccentVelY += fbAcc * dt;
    this.feedbackAccentY += this.feedbackAccentVelY * dt;
    if (this.feedbackAccentY < -0.02) {
      this.feedbackAccentY = -0.02;
      if (this.feedbackAccentVelY < 0) this.feedbackAccentVelY = 0;
    } else if (this.feedbackAccentY > 0.008) {
      this.feedbackAccentY = 0.008;
      if (this.feedbackAccentVelY > 0) this.feedbackAccentVelY = 0;
    }
    if (this.feedbackAccentPulse > 0) {
      this.feedbackAccentPulse = Math.max(0, this.feedbackAccentPulse - dt * 2.2);
    }

    // Apply combined motion (compression + air offset + feedback accent) to motionGroup
    this.motionGroup.position.set(0, this.compressionY + this.airOffset.y + this.feedbackAccentY, this.airOffset.z);
    this.motionGroup.rotation.set(this.airRotOffset.x, this.airRotOffset.y, this.airRotOffset.z);

    // 7. Surfing Balance Stance
    const targetSurfBlend = isSurfing ? 1.0 : 0.0;
    this.surfBlend += (targetSurfBlend - this.surfBlend) * Math.min(1.0, dt * 7.0);

    if (this.surfBlend > 0.01) {
      const surfSide = player.surfState.surfSide;
      const targetSideTilt = surfSide === 'LEFT' ? -1.0 : (surfSide === 'RIGHT' ? 1.0 : 0.0);
      this.surfSideTilt += (targetSideTilt - this.surfSideTilt) * Math.min(1.0, dt * 8.0);

      // Downhill surf lean
      const tiltAngle = this.surfSideTilt * 0.08 * this.surfBlend;
      this.motionGroup.rotation.z += tiltAngle;
      this.motionGroup.position.x += -this.surfSideTilt * 0.015 * this.surfBlend;
    }

    // 8. Knife Socket Attachment
    if (this.rigInstance.knifeGroup) {
      this.rigInstance.knifeGroup.position.copy(this.knifeSocketPos);
      this.rigInstance.knifeGroup.rotation.set(
        this.knifeSocketRot.x,
        this.knifeSocketRot.y,
        this.knifeSocketRot.z
      );
      this.rigInstance.knifeGroup.scale.copy(this.knifeSocketScale);
    }

    // 9. Minimal Mode Support (hides left hand)
    if (settings.viewmodelMode === 'MINIMAL') {
      if (this.rigInstance.handLBone) {
        this.rigInstance.handLBone.visible = false;
      }
      this.motionGroup.position.x = 0.03;
    } else {
      if (this.rigInstance.handLBone) {
        this.rigInstance.handLBone.visible = true;
      }
    }

    // 10. Action Motion on actionGroup (F inspect & Mouse1 knife spin)
    // Moves hand + knife together through additive actionGroup, preserving calibrated knifeGroup transform
    this.actionClock += dt;
    if (this.activeAction !== 'NONE') {
      this.actionTimer += dt;
      if (this.activeAction === 'SPIN') this.updateSpin(dt);
      const progress =
        this.activeAction === 'SPIN' ? (this.spinDone ? 1 : 0) : Math.min(1.0, this.actionTimer / this.actionDuration);
      if (this.activeAction === 'PULSE') {
        const p = Math.sin(progress * Math.PI);
        this.actionGroup.position.set(0.002 * p, 0.014 * p, -0.012 * p);
        this.actionGroup.rotation.set(-0.14 * p, 0.04 * p, -0.09 * p);
        this.actionPos.set(0, 0, 0);
        this.actionRot.set(0, 0, 0);
      } else {
        const roll = this.activeAction === 'INSPECT' ? this.updateInspect() : 0;
        this.applyKeyedAction();
        if (this.activeAction === 'SPIN') this.applyKnifeFlourish(this.spinAngle, KARAMBIT_RING_AXIS);
        else if (this.activeAction === 'INSPECT') this.applyKnifeFlourish(roll, KARAMBIT_LENGTH_AXIS);
      }
      if (progress >= 1.0) {
        this.activeAction = 'NONE';
        this.resetKnifeSpin();
        this.actionPos.set(0, 0, 0);
        this.actionRot.set(0, 0, 0);
        this.actionGroup.position.set(0, 0, 0);
        this.actionGroup.rotation.set(0, 0, 0);
      }
    } else {
      this.actionGroup.position.set(0, 0, 0);
      this.actionGroup.rotation.set(0, 0, 0);
    }

    this.updateSpinTrail(dt);

    // Decay audio impact
    if (this.audioImpact > 0) {
      this.audioImpact = Math.max(0, this.audioImpact - dt * 3.5);
    }

    // 11. Adaptive Viewmodel Accent (ADAPTIVE, DEFAULT_CYAN, OFF)
    // Viewmodel musical accent envelope: fast attack on transients, quick decay,
    // plus a slow sustained term.
    //
    // Deliberately MUCH weaker than the world gates: `transientPulse` is the raw
    // onset strength (0..1) and is scaled to at most 0.32 here, so a loud
    // transient produces a faint rim/flourish lift rather than the gate's
    // full bloom step. The viewmodel must never compete with the architecture.
    //
    // EFFECT INTENSITY scales this accent only. It cannot reach the frozen knife
    // socket or any movement behaviour.
    const vmEffectScale = resolveEffectProfile(settings.effectIntensity).viewmodelScale;
    this.transientPulse = Math.max(this.transientPulse - dt * 4.5, 0);
    const pulseTarget = Math.min(
      0.32,
      this.transientPulse * 0.55 + this.sustainedPulse * 0.16
    ) * vmEffectScale;
    this.viewmodelAudioPulse += (pulseTarget - this.viewmodelAudioPulse) * Math.min(1.0, dt * 9.0);

    const vmAccent = settings.viewmodelAccent || 'ADAPTIVE';    if (vmAccent === 'OFF') {
      this.rimLight.intensity = 0.0;
      this.styleFilter.setAudioPulse(0);
      this.rigInstance.setAudioPulse(0);
    } else if (vmAccent === 'DEFAULT_CYAN') {
      this.rimLight.intensity = 0.75 * vmEffectScale;
      this.rimLight.color.set(0x00f0ff);
      this.accentColor.set(0x00f0ff);
      this.rigInstance.setAccentColor(this.accentColor);
      this.styleFilter.setPalette({ primary: this.accentColor });
      this.styleFilter.setAudioPulse(this.viewmodelAudioPulse);
      this.rigInstance.setAudioPulse(this.viewmodelAudioPulse);
    } else {
      // ADAPTIVE: smoothly follow active map/track palette
      this.accentColor.lerp(this.targetAccentColor, Math.min(1.0, dt * 6.0));
      this.rimLight.color.copy(this.accentColor);
      this.rimLight.intensity = 0.75 * vmEffectScale * (1.0 + this.viewmodelAudioPulse * 0.25);
      this.rigInstance.setAccentColor(this.accentColor);
      this.styleFilter.setAudioPulse(this.viewmodelAudioPulse);
      this.rigInstance.setAudioPulse(this.viewmodelAudioPulse);
    }

    // 12. MASTERY GLOVE.
    // Applied to the EXISTING arm materials: material parameters only, no new
    // textures, geometry or draw calls. Presentation only — eligibility is
    // derived by the mastery system and this can never change what was earned.
    // The frozen knife socket is never touched.
    this.applyMasteryGlove(false, vmEffectScale);
  }

  /**
   * Applies the equipped mastery glove to the arm materials.
   *
   * `force` re-applies even when nothing changed (used on equip and on rig load).
   */
  private applyMasteryGlove(force: boolean, effectScale = 1): void {
    if (!this.rigInstance?.applyGlove) return;
    const gloveId = MasteryGloveSystem.getInstance().getEffectiveGloveId();
    const scale = Number.isFinite(effectScale) && effectScale > 0 ? effectScale : 1;
    if (!force && gloveId === this.appliedGloveId && scale === this.appliedGloveScale) return;
    this.appliedGloveId = gloveId;
    this.appliedGloveScale = scale;
    this.rigInstance.applyGlove(gloveId, scale);
  }

  /**
   * Renders the viewmodel scene with depth clear to prevent clipping into world geometry,
   * while compositing with the dedicated ViewmodelStyleFilter pass.
   */
  public render(renderer: THREE.WebGLRenderer): void {
    const settings = SettingsManager.getInstance().settings;
    if (this.isSuppressed() || settings.viewmodelMode === 'OFF') return;

    // Update camera FOV if adjusted in settings
    const targetFov = settings.viewmodelFov || 65;
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }

    // Clear depth buffer and render viewmodel with dedicated style filter
    const origAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    this.styleFilter.render(renderer, this.scene, this.camera);
    renderer.autoClear = origAutoClear;
  }

  /**
   * Feeds the viewmodel the SAME authoritative music state the world uses.
   *
   * - impact   : sustained musical energy (artist 0..1)
   * - transient: real onset/transient strength from the analyser
   * - bass     : sub-bass energy, used by the karambit cosmic shader
   */
  public setAudioLevels(impact: number, transient = 0, bass = 0): void {
    // Fast attack, slow-ish decay: preserves transient definition without jitter.
    this.transientPulse = Math.max(this.transientPulse, transient);
    this.sustainedPulse = impact;
    this.audioImpact = impact;
    this.audioBass = bass;
    if (this.rigInstance?.cosmicMaterial) {
      this.rigInstance.cosmicMaterial.setAudioImpact(impact, bass);
    }
  }

  public applySkin(skinId: string): void {
    if (this.rigInstance) {
      this.rigInstance.applySkin(skinId);
    }
  }

  /**
   * Re-applies the exact cosmetic the viewmodel should be rendering. Used after
   * a replay/review sets or clears an ephemeral skin override: the equip-listener
   * path only fires on a real equip, so the override must be pushed explicitly.
   */
  public refreshRenderedSkin(): void {
    this.applySkin(KarambitSkinSystem.getInstance().getRenderSkinId());
  }

  public getCosmicMaterial(): KarambitCosmicMaterial | null {
    return this.rigInstance?.cosmicMaterial || null;
  }

  private onResize = (): void => {
    if (typeof window !== 'undefined') {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.styleFilter.resize(w, h);
    }
  };

  public dispose(): void {
    if (this.unsubscribeSkin) {
      this.unsubscribeSkin();
    }
    if (this.unsubscribeGlove) {
      this.unsubscribeGlove();
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.onResize);
    }
    this.styleFilter.dispose();
    if (this.trailMesh) {
      this.trailMesh.geometry.dispose();
      (this.trailMesh.material as THREE.Material).dispose();
    }
    this.rigInstance.dispose();
    // Release the shared mastery glove texture cache with the viewmodel.
    disposeGloveTextureCaches();
  }
}
