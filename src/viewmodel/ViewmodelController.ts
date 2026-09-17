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

  // Authoritative Knife Transform relative to handR socket (calibrated and authoritative)
  public knifeSocketPos = new THREE.Vector3(0.0093, 0.1107, 0.0033);
  public knifeSocketRot = new THREE.Vector3(3.034, 0.3737, 0.2205);
  public knifeSocketScale = new THREE.Vector3(1.011, 1.011, 1.011);

  // Default hardcoded references for reset
  public static readonly DEFAULT_KNIFE_POS = new THREE.Vector3(0.0093, 0.1107, 0.0033);
  public static readonly DEFAULT_KNIFE_ROT = new THREE.Vector3(3.034, 0.3737, 0.2205);
  public static readonly DEFAULT_KNIFE_SCALE = new THREE.Vector3(1.011, 1.011, 1.011);

  // Viewmodel Actions (F signal pulse & Mouse1 cosmetic sweep)
  private activeAction: 'NONE' | 'PULSE' | 'SWEEP' = 'NONE';
  private actionTimer = 0;
  private actionDuration = 0;
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

    this.rimLight = new THREE.DirectionalLight(0x00f0ff, 1.1);
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
  public updateCalibrationPose(): void {
    const settings = SettingsManager.getInstance().settings;
    if (settings.viewmodelMode === 'OFF') return;

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

  public setPalette(palette: { surfaceDark?: THREE.Color; secondary?: THREE.Color; primary?: THREE.Color; highlight?: THREE.Color }): void {
    if (!palette) return;
    this.styleFilter.setPalette(palette);

    if (palette.surfaceDark) {
      this.hemiLight.groundColor.copy(palette.surfaceDark).multiplyScalar(1.2);
    }
    if (palette.secondary) {
      this.fillLight.color.copy(palette.secondary).lerp(new THREE.Color(0xffffff), 0.65);
    }
    const accentSource = palette.highlight || palette.primary || palette.secondary;
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

  public triggerCosmeticSweep(): void {
    this.activeAction = 'SWEEP';
    this.actionTimer = 0;
    this.actionDuration = 0.20;
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
    if (settings.viewmodelMode === 'OFF') return;

    // Update skeletal animation mixer for idle finger breathing
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

    // 10. Action Motion on actionGroup (F Signal Pulse & Mouse1 Cosmetic Sweep)
    // Moves hand + knife together through additive actionGroup, preserving calibrated knifeGroup transform
    if (this.activeAction !== 'NONE') {
      this.actionTimer += dt;
      const progress = Math.min(1.0, this.actionTimer / this.actionDuration);
      if (this.activeAction === 'PULSE') {
        const p = Math.sin(progress * Math.PI);
        this.actionGroup.position.set(0.002 * p, 0.014 * p, -0.012 * p);
        this.actionGroup.rotation.set(-0.14 * p, 0.04 * p, -0.09 * p);
      } else if (this.activeAction === 'SWEEP') {
        const p = Math.sin(progress * Math.PI);
        this.actionGroup.position.set(-0.022 * p, 0.006 * p, 0.008 * p);
        this.actionGroup.rotation.set(0.05 * p, -0.16 * p, 0.16 * p);
      }
      if (progress >= 1.0) {
        this.activeAction = 'NONE';
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
    const vmAccent = settings.viewmodelAccent || 'ADAPTIVE';
    if (vmAccent === 'OFF') {
      this.rimLight.intensity = 0.0;
    } else if (vmAccent === 'DEFAULT_CYAN') {
      this.rimLight.intensity = 1.1;
      this.rimLight.color.set(0x00f0ff);
      this.accentColor.set(0x00f0ff);
      this.rigInstance.setAccentColor(this.accentColor);
    } else {
      // ADAPTIVE: smoothly follow active map/track palette
      this.rimLight.intensity = 1.1;
      this.accentColor.lerp(this.targetAccentColor, Math.min(1.0, dt * 6.0));
      this.rimLight.color.copy(this.accentColor);
      this.rigInstance.setAccentColor(this.accentColor);
    }
  }

  /**
   * Renders the viewmodel scene with depth clear to prevent clipping into world geometry,
   * while compositing with the dedicated ViewmodelStyleFilter pass.
   */
  public render(renderer: THREE.WebGLRenderer): void {
    const settings = SettingsManager.getInstance().settings;
    if (settings.viewmodelMode === 'OFF') return;

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

  public setAudioLevels(impact: number, bass = 0): void {
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
