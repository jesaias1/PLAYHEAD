/**
 * ViewmodelController for PLAYHEAD
 * Manages the first-person hands and stylized karambit.
 *
 * Implements second-order spring-damper inertia, mouse look lag/snap,
 * strafe banking, fluid bhop landing compression, authentic surf balancing,
 * and the [F] karambit inspect flourish.
 */

import * as THREE from 'three';
import { PlayerController } from '../player/PlayerController';
import { CameraController } from '../player/CameraController';
import { SettingsManager } from '../core/Settings';
import { ViewmodelGeometry, ViewmodelMeshes } from './ViewmodelGeometry';
import { clamp } from '../utils/math';

export class ViewmodelController {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  private meshes: ViewmodelMeshes;

  // Rig Groups
  private rootGroup: THREE.Group;
  private swayGroup: THREE.Group;
  private bobGroup: THREE.Group;
  private rightArmGroup: THREE.Group;
  private leftArmGroup: THREE.Group;
  private knifeGroup: THREE.Group;

  // Base Offsets (lower right of screen, clear center for route readability)
  private readonly baseRightPos = new THREE.Vector3(0.17, -0.12, -0.28);
  private readonly baseRightRot = new THREE.Vector3(-0.10, 0.14, -0.03);
  private readonly baseLeftPos = new THREE.Vector3(-0.19, -0.16, -0.27);
  private readonly baseLeftRot = new THREE.Vector3(-0.06, -0.18, 0.08);

  private readonly defaultKnifePos = new THREE.Vector3(0.015, -0.012, -0.075);
  private readonly defaultKnifeRot = new THREE.Vector3(-0.22, 0.20, -0.12);

  // Spring Physics State (Damped Harmonic Oscillator)
  private swayPos = new THREE.Vector3();
  private swayPosVel = new THREE.Vector3();
  private swayRot = new THREE.Euler(0, 0, 0, 'YXZ');
  private swayRotVel = new THREE.Vector3();

  // Target Offsets
  private targetSwayPos = new THREE.Vector3();
  private targetSwayRot = new THREE.Vector3();

  // Bobbing & Locomotion State
  private bobTimer = 0;
  private bobOffset = new THREE.Vector3();
  private bobRotOffset = new THREE.Vector3();

  // Vertical Compression (Jump / Landing)
  private compressionY = 0;
  private compressionVelY = 0;
  private wasGroundedLastFrame = true;
  private lastJumpTime = 0;

  // Surfing Balance Blend
  private surfBlend = 0;
  private surfSideTilt = 0;

  // Inspect Flourish State
  private isInspecting = false;
  private inspectTimer = 0;
  private readonly inspectDuration = 1.5; // seconds
  private inspectVariant = 0;

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

    // 2. Dedicated Local Lighting (hands are always clearly readable regardless of world shadows)
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x303d50, 1.4);
    this.scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.6);
    dirLight.position.set(1.8, 3.0, 2.2);
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x88bbff, 1.6);
    fillLight.position.set(-2.2, 1.8, 1.8);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x00f0ff, 1.3);
    rimLight.position.set(-1.0, -1.8, -1.2);
    this.scene.add(rimLight);

    // 3. Construct Rig Geometry
    this.meshes = ViewmodelGeometry.buildRig(this.accentColor);
    this.rootGroup = this.meshes.rootGroup;
    this.rightArmGroup = this.meshes.rightArmGroup;
    this.leftArmGroup = this.meshes.leftArmGroup;
    this.knifeGroup = this.meshes.knifeGroup;

    // Hierarchy: scene -> rootGroup -> swayGroup -> bobGroup -> arms
    this.swayGroup = new THREE.Group();
    this.bobGroup = new THREE.Group();

    this.rootGroup.remove(this.rightArmGroup);
    this.rootGroup.remove(this.leftArmGroup);

    this.bobGroup.add(this.rightArmGroup);
    this.bobGroup.add(this.leftArmGroup);
    this.swayGroup.add(this.bobGroup);
    this.rootGroup.add(this.swayGroup);
    this.scene.add(this.rootGroup);

    this.applyBasePose();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.onResize);
    }
  }

  public setAccentColor(col: THREE.Color): void {
    this.accentColor.copy(col);
    this.meshes.knifeSignalMaterial.emissive.copy(col);
  }

  private applyBasePose(): void {
    this.rightArmGroup.position.copy(this.baseRightPos);
    this.rightArmGroup.rotation.set(this.baseRightRot.x, this.baseRightRot.y, this.baseRightRot.z);

    this.leftArmGroup.position.copy(this.baseLeftPos);
    this.leftArmGroup.rotation.set(this.baseLeftRot.x, this.baseLeftRot.y, this.baseLeftRot.z);
  }

  /**
   * Triggers the [F] Karambit inspect flourish
   */
  public triggerInspect(): void {
    this.isInspecting = true;
    this.inspectTimer = 0;
    this.inspectVariant = (this.inspectVariant + 1) % 2;
  }

  public isInspectActive(): boolean {
    return this.isInspecting;
  }

  /**
   * Updates viewmodel physics, animations, and movement responses
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

    const swayScale = settings.viewmodelSway !== undefined ? settings.viewmodelSway : 1.0;
    const speed = player.getSpeedUnits();
    const isGrounded = player.isGrounded;
    const isSurfing = player.isSurfing || player.surfState.isSurfing;
    const keys = player.keysState;

    // 1. Mouse Look Sway (Lag and Snap Inertia)
    // Horizontal mouse delta creates lateral drift and subtle roll bank
    const mouseSensitivityFactor = 0.0018 * swayScale;
    this.targetSwayRot.y = -mouseDeltaX * mouseSensitivityFactor;
    this.targetSwayRot.z = mouseDeltaX * mouseSensitivityFactor * 0.75;
    this.targetSwayRot.x = mouseDeltaY * mouseSensitivityFactor * 0.85;

    this.targetSwayPos.x = -mouseDeltaX * 0.00035 * swayScale;
    this.targetSwayPos.y = mouseDeltaY * 0.00025 * swayScale;

    // 2. Strafe Reaction (Holding A / D banks into the turn and shifts laterally)
    let strafeInputX = 0;
    if (keys.left) strafeInputX += 1;
    if (keys.right) strafeInputX -= 1;

    // Strafe inertia: moving left pushes viewmodel slightly right and banks left
    const strafeDriftX = strafeInputX * 0.016 * swayScale;
    const strafeBankRoll = -strafeInputX * 0.045 * swayScale;
    this.targetSwayPos.x += strafeDriftX;
    this.targetSwayRot.z += strafeBankRoll;

    // 3. High-Speed Aerodynamic Tuck
    if (speed > 16.0) {
      const speedExcess = Math.min(1.0, (speed - 16.0) / 25.0);
      this.targetSwayPos.z = -speedExcess * 0.025; // Pull back slightly
      this.targetSwayRot.x -= speedExcess * 0.04;  // Angle knife slightly forward
    } else {
      this.targetSwayPos.z = 0;
    }

    // 4. Spring-Damper Simulation for Sway (Second-order harmonic oscillator)
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

    // 5. Running Bob & Micro-Idle Breathing
    if (isGrounded && speed > 2.0 && !isSurfing) {
      const bobFreq = Math.min(18.0, 7.5 + speed * 0.4);
      this.bobTimer += dt * bobFreq;

      const bobAmp = Math.min(0.012, 0.004 + (speed / 30.0) * 0.008) * swayScale;
      this.bobOffset.x = Math.sin(this.bobTimer * 0.5) * bobAmp * 0.7;
      this.bobOffset.y = Math.abs(Math.sin(this.bobTimer)) * bobAmp;
      this.bobRotOffset.z = Math.sin(this.bobTimer * 0.5) * 0.02 * swayScale;
    } else if (!isGrounded && !isSurfing) {
      // In air: bob fades, light suspended float
      this.bobOffset.lerp(new THREE.Vector3(0, 0.008, 0.005), Math.min(1.0, dt * 8.0));
      this.bobRotOffset.lerp(new THREE.Vector3(-0.03, 0, 0), Math.min(1.0, dt * 8.0));
    } else {
      // Idle micro-breathing
      this.bobTimer += dt * 1.8;
      this.bobOffset.set(0, Math.sin(this.bobTimer) * 0.0015, 0);
      this.bobRotOffset.set(Math.sin(this.bobTimer) * 0.004, 0, 0);
    }

    // 6. Jump Takeoff & Landing Compression (Fluid Bhop Chaining)
    if (!this.wasGroundedLastFrame && isGrounded) {
      // Just landed!
      const fallSpeed = Math.abs(player.velocity.y);
      const isQuickBhop = Date.now() - this.lastJumpTime < 280;

      // Bhop chaining: impact is short and springy with instantaneous recovery
      const impactMultiplier = isQuickBhop ? 0.35 : 1.0;
      const landingDip = Math.min(0.026, Math.max(0.006, fallSpeed * 0.002)) * impactMultiplier;
      this.compressionVelY = -landingDip * 35.0;
    } else if (this.wasGroundedLastFrame && !isGrounded && player.velocity.y > 1.0) {
      // Just jumped! Initial light takeoff dip
      this.compressionVelY = -0.15;
      this.lastJumpTime = Date.now();
    }
    this.wasGroundedLastFrame = isGrounded;

    // Compression spring
    const compK = 55.0;
    const compDamping = 12.0;
    const compForce = -compK * this.compressionY - compDamping * this.compressionVelY;
    this.compressionVelY += compForce * dt;
    this.compressionY += this.compressionVelY * dt;

    this.bobGroup.position.set(
      this.bobOffset.x,
      this.bobOffset.y + this.compressionY,
      this.bobOffset.z
    );
    this.bobGroup.rotation.set(
      this.bobRotOffset.x,
      this.bobRotOffset.y,
      this.bobRotOffset.z
    );

    // 7. Surfing Balance Posture
    const targetSurfBlend = isSurfing ? 1.0 : 0.0;
    this.surfBlend += (targetSurfBlend - this.surfBlend) * Math.min(1.0, dt * 7.0);

    if (this.surfBlend > 0.01) {
      const surfSide = player.surfState.surfSide;
      const targetSideTilt = surfSide === 'LEFT' ? -1.0 : (surfSide === 'RIGHT' ? 1.0 : 0.0);
      this.surfSideTilt += (targetSideTilt - this.surfSideTilt) * Math.min(1.0, dt * 8.0);

      // Downhill slide balance:
      // Left ramp (holding A): right arm tilts down parallel to slope, left arm extends outwards for balance
      const tiltAngle = this.surfSideTilt * 0.12 * this.surfBlend;
      this.rightArmGroup.rotation.z = this.baseRightRot.z + tiltAngle;
      this.rightArmGroup.position.y = this.baseRightPos.y + this.surfBlend * 0.012;

      this.leftArmGroup.rotation.z = this.baseLeftRot.z + tiltAngle * 1.5;
      this.leftArmGroup.position.x = this.baseLeftPos.x - this.surfSideTilt * 0.025 * this.surfBlend;

      // High-speed wind rush micro-vibration
      const vibration = Math.sin(Date.now() * 0.045) * 0.001 * (speed / 28.0) * this.surfBlend;
      this.bobGroup.position.x += vibration;
      this.bobGroup.position.y += vibration * 0.5;
    } else {
      this.rightArmGroup.rotation.z = this.baseRightRot.z;
      this.rightArmGroup.position.y = this.baseRightPos.y;
      this.leftArmGroup.rotation.z = this.baseLeftRot.z;
      this.leftArmGroup.position.x = this.baseLeftPos.x;
    }

    // 8. Inspect Flourish Animation ([F] key)
    if (this.isInspecting) {
      this.updateInspectFlourish(dt);
    } else {
      // Reset knife relative to right hand
      this.knifeGroup.position.copy(this.defaultKnifePos);
      this.knifeGroup.rotation.set(this.defaultKnifeRot.x, this.defaultKnifeRot.y, this.defaultKnifeRot.z);
    }

    // 9. Minimal Mode Support (hides left arm, pulls right arm slightly closer to edge)
    if (settings.viewmodelMode === 'MINIMAL') {
      this.leftArmGroup.visible = false;
      this.rightArmGroup.position.x = this.baseRightPos.x + 0.04;
      this.rightArmGroup.position.y = this.baseRightPos.y - 0.03;
    } else {
      this.leftArmGroup.visible = true;
    }
  }

  /**
   * Updates the karambit spin flourish animation
   */
  private updateInspectFlourish(dt: number): void {
    this.inspectTimer += dt;
    const progress = this.inspectTimer / this.inspectDuration;

    if (progress >= 1.0) {
      this.isInspecting = false;
      this.inspectTimer = 0;
      return;
    }

    if (progress < 0.35) {
      // Phase 1: Rapid 360° spin around the index finger ring
      const spinP = progress / 0.35;
      const angle = spinP * Math.PI * 2;
      this.knifeGroup.position.set(
        this.defaultKnifePos.x,
        this.defaultKnifePos.y + Math.sin(angle) * 0.012,
        this.defaultKnifePos.z
      );
      this.knifeGroup.rotation.set(
        this.defaultKnifeRot.x + angle,
        this.defaultKnifeRot.y,
        this.defaultKnifeRot.z
      );
    } else if (progress < 0.75) {
      // Phase 2: Inverted blade display (showing off the glowing signal channel)
      const displayP = (progress - 0.35) / 0.40;
      const easeDisplay = Math.sin(displayP * Math.PI);
      this.knifeGroup.position.set(0.018, 0.01 * easeDisplay, -0.075);
      this.knifeGroup.rotation.set(0.4 * easeDisplay, 0.35 * easeDisplay, 0.25 * easeDisplay);
    } else {
      // Phase 3: Snap cleanly back into combat ready grip
      const snapP = (progress - 0.75) / 0.25;
      const t = clamp(snapP, 0, 1);
      const easeSnap = 1 - (1 - t) * (1 - t);

      this.knifeGroup.position.set(
        THREE.MathUtils.lerp(0.018, this.defaultKnifePos.x, easeSnap),
        THREE.MathUtils.lerp(0.0, this.defaultKnifePos.y, easeSnap),
        THREE.MathUtils.lerp(-0.075, this.defaultKnifePos.z, easeSnap)
      );
      this.knifeGroup.rotation.set(
        THREE.MathUtils.lerp(0.4, this.defaultKnifeRot.x, easeSnap),
        THREE.MathUtils.lerp(0.35, this.defaultKnifeRot.y, easeSnap),
        THREE.MathUtils.lerp(0.25, this.defaultKnifeRot.z, easeSnap)
      );
    }
  }

  /**
   * Renders the viewmodel scene with depth clear to prevent clipping into world geometry
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
    // Disable autoClear so the rendered world frame is preserved beneath the viewmodel
    const origAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = origAutoClear;
  }

  private onResize = (): void => {
    if (typeof window === 'undefined') return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  public dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.onResize);
    }
    this.meshes.dispose();
  }
}
