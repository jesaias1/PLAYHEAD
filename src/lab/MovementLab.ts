/**
 * Dedicated Movement Lab for TRACK//RUN
 * Provides a structured testing course for raw controls, bunny-hopping, air-strafing,
 * speed growth, surfing, and jump distance calibration without loading an audio file.
 */

import * as THREE from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { BoxCollider } from '../physics/Collider';
import { PlayerController } from '../player/PlayerController';
import { CameraController } from '../player/CameraController';
import { RouteNode, RouteNodeType } from '../generation/GenerationTypes';
import { MovementLabHUD } from './MovementLabHUD';

export class MovementLab {
  private scene: THREE.Scene;
  private physics: PhysicsWorld;
  private player: PlayerController;
  private cameraController: CameraController;

  private rootGroup = new THREE.Group();
  private hud: MovementLabHUD;

  // Trajectory visualizer
  private trajPointsMesh: THREE.Points;
  private trajPositions: Float32Array;
  private trajCount = 0;
  private trajEnabled = false;
  private readonly MAX_TRAJ_POINTS = 240;

  // Respawn position
  private spawnPosition = new THREE.Vector3(0, 1.5, 5.0);
  private spawnYaw = Math.PI; // Looking forward along +Z

  private isDisposed = false;
  private keyListener?: (e: KeyboardEvent) => void;

  constructor(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    player: PlayerController,
    cameraController: CameraController,
    hudMount: HTMLElement
  ) {
    this.scene = scene;
    this.physics = physics;
    this.player = player;
    this.cameraController = cameraController;

    // Initialize HUD
    this.hud = new MovementLabHUD();
    hudMount.appendChild(this.hud.element);

    // Initialize Trajectory Breadcrumbs
    this.trajPositions = new Float32Array(this.MAX_TRAJ_POINTS * 3);
    const trajGeom = new THREE.BufferGeometry();
    trajGeom.setAttribute('position', new THREE.BufferAttribute(this.trajPositions, 3));
    const trajMat = new THREE.PointsMaterial({
      color: 0x00f0ff,
      size: 0.25,
      transparent: true,
      opacity: 0.85
    });
    this.trajPointsMesh = new THREE.Points(trajGeom, trajMat);
    this.trajPointsMesh.frustumCulled = false;
    this.rootGroup.add(this.trajPointsMesh);

    // Build the 7 test areas
    this.buildCourse();
    this.scene.add(this.rootGroup);

    // Spawn player
    this.resetPlayer();

    // Input listeners for Lab utilities (R: Reset, T: Trajectory)
    this.initListeners();
  }

  private buildCourse(): void {
    // Shared materials
    const concreteMat = new THREE.MeshStandardMaterial({
      color: 0x222831,
      roughness: 0.65,
      metalness: 0.2
    });
    const surfMat = new THREE.MeshStandardMaterial({
      color: 0x2e3846,
      roughness: 0.25,
      metalness: 0.7
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00f0ff,
      emissiveIntensity: 0.8
    });
    const markerMat = new THREE.MeshStandardMaterial({
      color: 0xffb703,
      emissive: 0xffb703,
      emissiveIntensity: 0.5
    });

    let idCounter = 1000;

    const addBox = (
      name: string,
      x: number,
      y: number,
      z: number,
      width: number,
      height: number,
      length: number,
      material: THREE.Material = concreteMat,
      isSurf = false,
      roll = 0,
      pitch = 0
    ) => {
      const geom = new THREE.BoxGeometry(width, height, length);
      const mesh = new THREE.Mesh(geom, material);
      mesh.name = name;
      mesh.position.set(x, y, z);
      mesh.rotation.set(pitch, 0, roll, 'YXZ');
      this.rootGroup.add(mesh);

      // Edge outline
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geom),
        new THREE.LineBasicMaterial({
          color: isSurf ? 0x00f0ff : 0x556677,
          transparent: true,
          opacity: 0.6
        })
      );
      edges.position.copy(mesh.position);
      edges.rotation.copy(mesh.rotation);
      this.rootGroup.add(edges);

      // Physics Box Collider
      const node: RouteNode = {
        id: idCounter++,
        time: 0,
        position: { x, y, z },
        dimensions: { x: width, y: height, z: length },
        yaw: 0,
        pitch,
        roll,
        type: isSurf ? RouteNodeType.SURF_RAMP : RouteNodeType.RUNWAY,
        intensity: 0.5,
        sectionIndex: 0,
        arcLength: z,
        isSurf,
        isBoost: false
      };

      if (isSurf) {
        node.surfNormal = {
          x: -Math.sin(roll),
          y: Math.cos(roll),
          z: 0
        };
      }

      const col = new BoxCollider(node);
      this.physics.addCollider(col);
    };

    // ==========================================
    // AREA A — FLAT RUNWAY (z: 0 .. 70)
    // ==========================================
    addBox('AreaA_Runway', 0, 0, 35, 20, 2, 70);
    this.createAreaBanner('AREA A // FLAT RUNWAY', 0, 4.5, 5);

    // ==========================================
    // AREA B — BHOP STRAIGHT (z: 80 .. 200)
    // 5 platforms with 4m-5m gaps
    // ==========================================
    this.createAreaBanner('AREA B // BHOP STRAIGHT', 0, 4.5, 80);
    const bhopZ = [90, 115, 140, 165, 190];
    for (const z of bhopZ) {
      addBox(`AreaB_Pad_${z}`, 0, 0, z, 14, 2, 18);
    }

    // ==========================================
    // AREA C — AIR STRAFE GAP (z: 210 .. 310)
    // Takeoff pad, 26m open void, huge landing
    // ==========================================
    this.createAreaBanner('AREA C // AIR STRAFE GAP', 0, 4.5, 215);
    addBox('AreaC_Takeoff', 0, 0, 230, 14, 2, 24);
    // Visual grid reference below the gap (y: -8)
    addBox('AreaC_VoidGrid', 0, -8, 265, 30, 0.5, 40, markerMat);
    addBox('AreaC_Landing', 0, 0, 295, 20, 2, 24);

    // ==========================================
    // AREA D — SLALOM (z: 320 .. 450)
    // Alternating left/right offset platforms
    // ==========================================
    this.createAreaBanner('AREA D // SLALOM', 0, 4.5, 325);
    addBox('AreaD_1', -7, 0, 345, 12, 2, 18);
    addBox('AreaD_2', 7, 0, 375, 12, 2, 18);
    addBox('AreaD_3', -7, 0, 405, 12, 2, 18);
    addBox('AreaD_4', 0, 0, 435, 16, 2, 20);

    // ==========================================
    // AREA E — SPEED STRAIGHT (z: 460 .. 600)
    // Long continuous runway with distance pillars
    // ==========================================
    this.createAreaBanner('AREA E // SPEED STRAIGHT', 0, 4.5, 465);
    addBox('AreaE_Runway', 0, 0, 535, 16, 2, 130);

    // ==========================================
    // AREA F — SURF RAMP (z: 620 .. 750)
    // Approach -> 60 deg ramp -> transfer -> landing
    // ==========================================
    this.createAreaBanner('AREA F // SURF RAMP', 0, 4.5, 625);
    addBox('AreaF_Approach', 0, 0, 640, 14, 2, 22);

    // 60-degree banked surf ramp (roll = 1.05 rad)
    addBox('AreaF_Surf1', -3, 1, 675, 8, 2, 40, surfMat, true, 1.05, -0.06);

    // Transfer ramp opposite bank (roll = -1.05 rad)
    addBox('AreaF_Surf2', 3, 0, 715, 8, 2, 35, surfMat, true, -1.05, -0.06);

    // Landing pad
    addBox('AreaF_Landing', 0, -2, 745, 16, 2, 22);

    // ==========================================
    // AREA G — JUMP CALIBRATION (z: 770 .. 920)
    // Takeoff edge at z = 790, pads at 4m, 6m, 8m, 10m, 12m, 15m, 18m
    // ==========================================
    this.createAreaBanner('AREA G // JUMP CALIBRATION', 0, 4.5, 775);
    const takeoffZ = 790;
    addBox('AreaG_Takeoff', 0, 0, takeoffZ - 10, 14, 2, 20);

    // Distance pads
    const testDistances = [4, 6, 8, 10, 12, 15, 18];
    for (const dist of testDistances) {
      const padLen = 3.5;
      const padCenterZ = takeoffZ + dist + padLen * 0.5;
      addBox(`AreaG_Pad_${dist}m`, 0, 0, padCenterZ, 12, 2, padLen, accentMat);
    }
    addBox('AreaG_Finish', 0, 0, 840, 16, 2, 30);

    // ==========================================
    // AREA H — LATERAL STEER CALIBRATION (z: 880 .. 1000)
    // 24m wide platform for calibrating 3.5m-4.5m lateral displacement
    // ==========================================
    this.createAreaBanner('AREA H // LATERAL STEER CALIBRATION', 0, 4.5, 885);
    addBox('AreaH_Takeoff', 0, 0, 900, 16, 2, 20);
    // Wide runway with lateral lane markings
    addBox('AreaH_Runway', 0, 0, 960, 24, 2, 90);
    // Visual lane marker rails at -8m, -4m, 0m, +4m, +8m
    for (const laneX of [-8, -4, 4, 8]) {
      addBox(`AreaH_Lane_${laneX}`, laneX, 0.05, 960, 0.4, 0.1, 90, markerMat);
    }
    addBox('AreaH_CenterLine', 0, 0.05, 960, 0.4, 0.1, 90, accentMat);
  }

  private createAreaBanner(text: string, x: number, y: number, z: number): void {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#07080a';
    ctx.fillRect(0, 0, 512, 128);

    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 504, 120);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = Math.PI; // Face player approaching along +Z
    this.rootGroup.add(mesh);
  }

  public update(_dt: number): void {
    if (this.isDisposed) return;

    // Check kill plane
    if (this.player.position.y < -20) {
      this.resetPlayer();
    }

    // Update Trajectory Breadcrumbs
    if (this.trajEnabled && !this.player.isGrounded) {
      if (this.trajCount < this.MAX_TRAJ_POINTS) {
        const idx = this.trajCount * 3;
        this.trajPositions[idx] = this.player.position.x;
        this.trajPositions[idx + 1] = this.player.position.y;
        this.trajPositions[idx + 2] = this.player.position.z;
        this.trajCount++;
        this.trajPointsMesh.geometry.attributes.position.needsUpdate = true;
        this.trajPointsMesh.geometry.setDrawRange(0, this.trajCount);
      }
    } else if (this.player.isGrounded && this.trajCount > 0 && !this.trajEnabled) {
      this.clearTrajectory();
    }

    // Update Debug HUD
    this.hud.update(
      this.player,
      this.cameraController,
      this.cameraController.camera.fov,
      this.trajEnabled
    );
  }

  public resetPlayer(): void {
    this.player.setPosition(this.spawnPosition);
    this.player.setOrientation(this.spawnYaw);
    this.player.velocity.set(0, 0, 0);
    this.clearTrajectory();
  }

  public toggleTrajectory(): void {
    this.trajEnabled = !this.trajEnabled;
    if (!this.trajEnabled) {
      this.clearTrajectory();
    }
  }

  public isTrajectoryEnabled(): boolean {
    return this.trajEnabled;
  }

  private clearTrajectory(): void {
    this.trajCount = 0;
    this.trajPointsMesh.geometry.setDrawRange(0, 0);
  }

  private initListeners(): void {
    if (typeof window === 'undefined') return;

    this.keyListener = (e: KeyboardEvent) => {
      if (e.code === 'KeyR' && !e.repeat) {
        this.resetPlayer();
      } else if (e.code === 'KeyT' && !e.repeat) {
        this.toggleTrajectory();
      }
    };
    window.addEventListener('keydown', this.keyListener);
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    if (this.keyListener && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.keyListener);
    }

    // Remove HUD
    this.hud.destroy();

    // Clear meshes and geometries
    this.rootGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      } else if (obj instanceof THREE.LineSegments || obj instanceof THREE.Points) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });

    this.scene.remove(this.rootGroup);
    this.physics.clear();
  }
}
