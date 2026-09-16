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
 * - Inspect Flourish: [F] key triggers a 360° ring spin flourish.
 */

import * as THREE from 'three';
import { PlayerController } from '../player/PlayerController';
import { CameraController } from '../player/CameraController';
import { SettingsManager } from '../core/Settings';
import { ViewmodelAssetLoader, ViewmodelRigInstance } from './ViewmodelAssetLoader';
import { clamp } from '../utils/math';

export class ViewmodelController {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  private rigInstance: ViewmodelRigInstance;
  private isRigLoaded = false;

  public get isLoaded(): boolean {
    return this.isRigLoaded;
  }

  // Rig Groups
  private rootGroup: THREE.Group;
  private swayGroup: THREE.Group;
  private motionGroup: THREE.Group;

  // Arms Base Transform (calibrated for Drillimpact PSX arms)
  private readonly baseArmsPos = new THREE.Vector3(0, -1.58, 0);
  private readonly baseArmsRotY = Math.PI;

  // Default Knife Transform relative to handR socket
  private readonly defaultKnifePos = new THREE.Vector3(-0.015, 0.055, 0.015);
  private readonly defaultKnifeRot = new THREE.Vector3(-Math.PI * 0.38, 0.15, -Math.PI * 0.26);

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

  // Inspect Flourish State
  private isInspecting = false;
  private inspectTimer = 0;
  private readonly inspectDuration = 1.25; // seconds

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

    // 2. Dedicated Local Lighting
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x223040, 1.4);
    this.scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
    keyLight.position.set(1.5, 2.5, 2.0);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x88ccff, 1.4);
    fillLight.position.set(-2.0, 1.5, 1.5);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x00f0ff, 1.0);
    rimLight.position.set(-1.0, -1.8, -1.2);
    this.scene.add(rimLight);

    // 3. Hierarchy: scene -> rootGroup -> swayGroup -> motionGroup -> rigInstance.rootGroup
    this.rootGroup = new THREE.Group();
    this.swayGroup = new THREE.Group();
    this.motionGroup = new THREE.Group();

    this.swayGroup.add(this.motionGroup);
    this.rootGroup.add(this.swayGroup);
    this.scene.add(this.rootGroup);

    // Initial temporary fallback rig while asynchronous assets load
    this.rigInstance = ViewmodelAssetLoader.buildFallbackRig(this.accentColor);
    this.applyRigBaseTransform();
    this.motionGroup.add(this.rigInstance.rootGroup);

    // 4. Asynchronously load real artist-made assets
    this.loadRealAssets();

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.onResize);
    }
  }

  private async loadRealAssets(): Promise<void> {
    try {
      const realRig = await ViewmodelAssetLoader.loadRig(this.accentColor);
      this.motionGroup.remove(this.rigInstance.rootGroup);
      this.rigInstance.dispose();

      this.rigInstance = realRig;
      this.applyRigBaseTransform();
      this.motionGroup.add(this.rigInstance.rootGroup);
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
      knife.position.copy(this.defaultKnifePos);
      knife.rotation.set(this.defaultKnifeRot.x, this.defaultKnifeRot.y, this.defaultKnifeRot.z);
    }
  }

  public setAccentColor(col: THREE.Color): void {
    this.accentColor.copy(col);
    this.rigInstance.setAccentColor(col);
  }

  /**
   * Triggers the [F] Karambit inspect flourish
   */
  public triggerInspect(): void {
    this.isInspecting = true;
    this.inspectTimer = 0;
  }

  public isInspectActive(): boolean {
    return this.isInspecting;
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

    // 8. Inspect Flourish Animation ([F] key)
    if (this.isInspecting) {
      this.updateInspectFlourish(dt);
    } else {
      // Reset knife transform relative to handR socket
      if (this.rigInstance.knifeGroup) {
        this.rigInstance.knifeGroup.position.copy(this.defaultKnifePos);
        this.rigInstance.knifeGroup.rotation.set(
          this.defaultKnifeRot.x,
          this.defaultKnifeRot.y,
          this.defaultKnifeRot.z
        );
      }
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
  }

  /**
   * Updates the karambit spin flourish animation around its finger ring
   */
  private updateInspectFlourish(dt: number): void {
    this.inspectTimer += dt;
    const progress = this.inspectTimer / this.inspectDuration;

    if (progress >= 1.0) {
      this.isInspecting = false;
      this.inspectTimer = 0;
      return;
    }

    const knife = this.rigInstance.knifeGroup;
    if (!knife) return;

    if (progress < 0.40) {
      // Phase 1: Rapid 360° spin around the finger ring
      const spinP = progress / 0.40;
      const angle = spinP * Math.PI * 2;
      knife.position.set(
        this.defaultKnifePos.x,
        this.defaultKnifePos.y + Math.sin(angle) * 0.015,
        this.defaultKnifePos.z
      );
      knife.rotation.set(
        this.defaultKnifeRot.x + angle,
        this.defaultKnifeRot.y,
        this.defaultKnifeRot.z
      );
    } else if (progress < 0.75) {
      // Phase 2: Inverted blade display (angled towards camera displaying the hawkbill curve)
      const displayP = (progress - 0.40) / 0.35;
      const easeDisplay = Math.sin(displayP * Math.PI);
      knife.position.set(
        this.defaultKnifePos.x + 0.01 * easeDisplay,
        this.defaultKnifePos.y + 0.015 * easeDisplay,
        this.defaultKnifePos.z + 0.01 * easeDisplay
      );
      knife.rotation.set(
        this.defaultKnifeRot.x + 0.3 * easeDisplay,
        this.defaultKnifeRot.y + 0.25 * easeDisplay,
        this.defaultKnifeRot.z + 0.2 * easeDisplay
      );
    } else {
      // Phase 3: Snap cleanly back into combat ready grip
      const snapP = (progress - 0.75) / 0.25;
      const t = clamp(snapP, 0, 1);
      const easeSnap = 1 - (1 - t) * (1 - t);

      knife.position.set(
        THREE.MathUtils.lerp(this.defaultKnifePos.x + 0.01, this.defaultKnifePos.x, easeSnap),
        THREE.MathUtils.lerp(this.defaultKnifePos.y + 0.015, this.defaultKnifePos.y, easeSnap),
        THREE.MathUtils.lerp(this.defaultKnifePos.z + 0.01, this.defaultKnifePos.z, easeSnap)
      );
      knife.rotation.set(
        THREE.MathUtils.lerp(this.defaultKnifeRot.x + 0.3, this.defaultKnifeRot.x, easeSnap),
        THREE.MathUtils.lerp(this.defaultKnifeRot.y + 0.25, this.defaultKnifeRot.y, easeSnap),
        THREE.MathUtils.lerp(this.defaultKnifeRot.z + 0.2, this.defaultKnifeRot.z, easeSnap)
      );
    }
  }

  /**
   * Renders the viewmodel scene with depth clear to prevent clipping into world geometry,
   * while preserving the already rendered world color buffer.
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

    // Clear depth buffer so the first-person hands & karambit render cleanly on top of the world
    const origAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = origAutoClear;
  }

  private onResize = (): void => {
    if (typeof window !== 'undefined') {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    }
  };

  public dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.onResize);
    }
    this.rigInstance.dispose();
  }
}
