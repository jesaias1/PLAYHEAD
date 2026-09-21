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
import { clamp } from '../utils/math';

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

  // Viewmodel Actions (F signal pulse & Mouse1 presentation-only micro-jab)
  private activeAction: 'NONE' | 'PULSE' | 'JAB' = 'NONE';
  private actionTimer = 0;
  private actionDuration = 0;
  private jabBlend = 0;
  private jabStartBlend = 0;
  private readonly leftHandActionOffset = new THREE.Vector3();
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
    this.unsubscribeSkin = KarambitSkinSystem.getInstance().addListener((skinId) => {
      this.applySkin(skinId);
    });

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
      this.rigInstance.applySkin(KarambitSkinSystem.getInstance().getEquippedSkinId());
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

  public triggerMicroJab(): void {
    this.jabStartBlend = this.activeAction === 'JAB' ? this.jabBlend : 0;
    this.activeAction = 'JAB';
    this.actionTimer = 0;
    this.actionDuration = 0.24;
    this.audioImpact = Math.max(this.audioImpact, 1.4);
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

    // Apply combined motion (compression + air offset) to motionGroup
    this.motionGroup.position.set(0, this.compressionY + this.airOffset.y, this.airOffset.z);
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

    // 10. Action Motion on actionGroup (F Signal Pulse & Mouse1 Micro-Jab)
    // Moves hand + knife together through additive actionGroup, preserving calibrated knifeGroup transform
    if (this.activeAction !== 'NONE') {
      this.actionTimer += dt;
      const progress = Math.min(1.0, this.actionTimer / this.actionDuration);
      if (this.activeAction === 'PULSE') {
        const p = Math.sin(progress * Math.PI);
        this.actionGroup.position.set(0.002 * p, 0.014 * p, -0.012 * p);
        this.actionGroup.rotation.set(-0.14 * p, 0.04 * p, -0.09 * p);
      } else if (this.activeAction === 'JAB') {
        const extensionDuration = 0.095;
        if (this.actionTimer <= extensionDuration) {
          const t = Math.min(1, this.actionTimer / extensionDuration);
          const easeOut = 1 - Math.pow(1 - t, 3);
          this.jabBlend = this.jabStartBlend + (1 - this.jabStartBlend) * easeOut;
        } else {
          const t = Math.min(1, (this.actionTimer - extensionDuration) / (this.actionDuration - extensionDuration));
          const smoothReturn = t * t * (3 - 2 * t);
          this.jabBlend = 1 - smoothReturn;
        }

        // The common action group carries the right hand and knife forward and
        // slightly inward. A much smaller inverse offset on the left hand sells
        // the upper-body counter-motion without touching the knife socket.
        const p = this.jabBlend;
        this.actionGroup.position.set(-0.006 * p, 0.002 * p, -0.030 * p);
        this.actionGroup.rotation.set(-0.035 * p, 0.025 * p, -0.018 * p);
        if (this.rigInstance.handLBone) {
          // Arms are authored facing +Z then rotated 180 degrees by the rig,
          // so negative local Z counters the action group's forward motion.
          // The net left-hand recoil is ~9 mm versus the right's 30 mm jab.
          this.leftHandActionOffset.set(0.002 * p, -0.001 * p, -0.039 * p);
          this.rigInstance.handLBone.position.add(this.leftHandActionOffset);
        }
      }
      if (progress >= 1.0) {
        this.activeAction = 'NONE';
        this.jabBlend = 0;
        this.jabStartBlend = 0;
        this.actionGroup.position.set(0, 0, 0);
        this.actionGroup.rotation.set(0, 0, 0);
      }
    } else {
      this.actionGroup.position.set(0, 0, 0);
      this.actionGroup.rotation.set(0, 0, 0);
    }

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
    this.transientPulse = Math.max(this.transientPulse - dt * 4.5, 0);
    const pulseTarget = Math.min(
      0.32,
      this.transientPulse * 0.55 + this.sustainedPulse * 0.16
    );
    this.viewmodelAudioPulse += (pulseTarget - this.viewmodelAudioPulse) * Math.min(1.0, dt * 9.0);

    const vmAccent = settings.viewmodelAccent || 'ADAPTIVE';
    if (vmAccent === 'OFF') {
      this.rimLight.intensity = 0.0;
      this.styleFilter.setAudioPulse(0);
      this.rigInstance.setAudioPulse(0);
    } else if (vmAccent === 'DEFAULT_CYAN') {
      this.rimLight.intensity = 0.75;
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
      this.rimLight.intensity = 0.75 * (1.0 + this.viewmodelAudioPulse * 0.25);
      this.rigInstance.setAccentColor(this.accentColor);
      this.styleFilter.setAudioPulse(this.viewmodelAudioPulse);
      this.rigInstance.setAudioPulse(this.viewmodelAudioPulse);
    }
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
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.onResize);
    }
    this.styleFilter.dispose();
    this.rigInstance.dispose();
  }
}
