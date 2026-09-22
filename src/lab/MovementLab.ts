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
import { GeneratedTrack, RouteNode, RouteNodeType } from '../generation/GenerationTypes';
import { VisualAccent } from '../audio/AudioFeatures';
import { obstacleLateralOffset } from '../generation/ObstacleMotion';
import { AnimatedObstacleItem, GeometryBuilder } from '../world/GeometryBuilder';
import { MovementLabHUD } from './MovementLabHUD';
import {
  GauntletCheckpoint,
  buildGauntletLayout,
  gauntletStationTitle
} from './gauntletLayout';

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

  // Obstacle gauntlet
  private labTime = 0;
  private gauntletAnimated: AnimatedObstacleItem[] = [];
  private gauntletCheckpoints: GauntletCheckpoint[] = [];
  private gauntletStartZ = 0;
  private gauntletCheckpointIndex = -1;

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

    // Build the deterministic obstacle gauntlet (obstacle vocabulary testing)
    this.buildObstacleGauntlet();

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

    // ==========================================
    // AREA F1 — EASY SINGLE RAMP (z: 1040 .. 1160)
    // [KEY 4 WARP] Big descending plane (roll ~57°), generous catch platform
    // ==========================================
    this.createAreaBanner('AREA F1 // EASY SINGLE RAMP [KEY 4]', 0, 4.5, 1040);
    addBox('AreaF1_Approach', 0, 0, 1055, 14, 2, 24);
    // 57 degree banked surf ramp (roll = 1.0 rad, pitch = -0.06)
    addBox('AreaF1_Ramp', -3.5, 0.5, 1095, 10, 2, 50, surfMat, true, 1.0, -0.06);
    // Wide catch landing
    addBox('AreaF1_Landing', 0, -2.5, 1140, 24, 2, 36);

    // ==========================================
    // AREA F2 — LONG FLOW RAMP (z: 1180 .. 1330)
    // [KEY 5 WARP] Extended 75m continuous surf line to test sustained speed
    // ==========================================
    this.createAreaBanner('AREA F2 // LONG FLOW RAMP [KEY 5]', 0, 8.5, 1180);
    addBox('AreaF2_ElevatedTakeoff', 0, 4.0, 1195, 14, 2, 26);
    // 58 degree banked surf ramp on right side (roll = -1.02 rad, pitch = -0.07)
    addBox('AreaF2_FlowRamp', 4.0, 2.5, 1255, 11, 2, 85, surfMat, true, -1.02, -0.07);
    addBox('AreaF2_ExitRunway', 0, -2.0, 1315, 22, 2, 34);

    // ==========================================
    // AREA F3 — TRANSFER TEST (z: 1350 .. 1510)
    // [KEY 6 WARP] Left ramp (-X) to Right ramp (+X) transfer gap
    // ==========================================
    this.createAreaBanner('AREA F3 // TRANSFER TEST [KEY 6]', 0, 6.5, 1350);
    addBox('AreaF3_Approach', 0, 2.0, 1365, 14, 2, 24);
    // Left ramp (banked right, roll = 1.05)
    addBox('AreaF3_Ramp1', -4.5, 1.5, 1405, 8, 2, 45, surfMat, true, 1.05, -0.06);
    // Right ramp (banked left, roll = -1.05) across 8m lateral offset and 8m longitudinal gap
    addBox('AreaF3_Ramp2', 4.5, -0.5, 1465, 8, 2, 45, surfMat, true, -1.05, -0.06);
    // Landing catch deck
    addBox('AreaF3_Landing', 0, -2.5, 1505, 24, 2, 32);

    // ==========================================
    // AREA F4 — HIGH-SPEED SURF CHUTE (z: 1530 .. 1700)
    // [KEY 7 WARP] Boost entry into steep 62° downhill surf chute
    // ==========================================
    this.createAreaBanner('AREA F4 // HIGH-SPEED SURF CHUTE [KEY 7]', 0, 4.5, 1530);
    addBox('AreaF4_Approach', 0, 0, 1545, 14, 2, 24);
    // Boost pad accelerating player into chute
    const boostNode = {
      id: 1990,
      time: 0,
      position: { x: 0, y: 0.1, z: 1565 },
      dimensions: { x: 12, y: 0.2, z: 16 },
      yaw: 0,
      pitch: 0,
      roll: 0,
      type: RouteNodeType.BOOST,
      intensity: 1.0,
      sectionIndex: 0,
      arcLength: 1565,
      isSurf: false,
      isBoost: true,
      boostSpeed: 20.0
    };
    const boostCol = new BoxCollider(boostNode);
    this.physics.addCollider(boostCol);
    const boostMesh = new THREE.Mesh(
      new THREE.BoxGeometry(12, 0.2, 16),
      accentMat
    );
    boostMesh.position.set(0, 0.1, 1565);
    this.rootGroup.add(boostMesh);

    // Steep 62-degree downhill surf chute
    addBox('AreaF4_Chute', -4.0, -1.0, 1615, 10, 2, 70, surfMat, true, 1.08, -0.12);
    // Broad high-speed landing plain
    addBox('AreaF4_Landing', 0, -8.0, 1675, 28, 2, 45);

    // ==========================================
    // AREA F5 — SURF EXIT & LAUNCH TEST (z: 1720 .. 1880)
    // [KEY 8 WARP] Surf ramp ending with upward kicker launching player onto catch deck
    // ==========================================
    this.createAreaBanner('AREA F5 // SURF EXIT & LAUNCH [KEY 8]', 0, 4.5, 1720);
    addBox('AreaF5_Approach', 0, 0, 1735, 14, 2, 24);
    // Surf ramp with kicker pitch
    addBox('AreaF5_KickerRamp', 3.5, 0.5, 1780, 9, 2, 55, surfMat, true, -1.02, 0.04);
    // Void gap: 20m
    addBox('AreaF5_CatchDeck', 0, 1.0, 1845, 26, 2, 45);
  }

  /**
   * Deterministic OBSTACLE GAUNTLET.
   *
   * Reuses the production obstacle construction (RouteChallengeGenerator lab
   * API), production obstacle rendering (GeometryBuilder), production obstacle
   * collision (PhysicsWorld.addObstacleCollider) and the single authoritative
   * motion implementation (obstacleLateralOffset). Nothing here is a fake
   * visual-only copy, and nothing here touches procedural generation.
   */
  private buildObstacleGauntlet(): void {
    const layout = buildGauntletLayout();
    this.gauntletCheckpoints = layout.checkpoints;
    this.gauntletStartZ = layout.startZ;

    const finishNode = layout.route[layout.route.length - 1];
    const track: GeneratedTrack = {
      seed: 0x0ba57ac1,
      route: layout.route,
      obstacles: layout.obstacles,
      signalSpines: layout.signalSpines,
      optionalRamps: [],
      recoveryShelves: [],
      checkpoints: [],
      finish: {
        routeNodeId: finishNode.id,
        time: 0,
        position: { ...finishNode.position },
        yaw: finishNode.yaw
      },
      totalDistance: finishNode.arcLength,
      targetDuration: 0,
      repairedJumpsCount: 0
    };

    const accent: VisualAccent = { name: 'LAB CYAN', hex: '#00f0ff', rgb: [0, 240, 255] };
    const built = GeometryBuilder.buildWorld(track, accent);
    this.rootGroup.add(built.rootGroup);
    this.gauntletAnimated = built.animatedObstacles;

    // Authoritative colliders (platforms, skinny recovery spine, obstacles).
    for (const node of layout.route) {
      this.physics.addCollider(new BoxCollider(node));
    }
    for (const spine of layout.signalSpines) {
      this.physics.addCollider(new BoxCollider(spine));
    }
    for (const obstacle of layout.obstacles) {
      this.physics.addObstacleCollider(obstacle);
    }

    // Compact station signage (one banner per station entry).
    for (let i = 0; i < layout.stations.length; i++) {
      const station = layout.stations[i];
      const host = layout.route[i];
      const bannerZ = host.position.z - station.length * 0.5 + 2.0;
      this.createAreaBanner(gauntletStationTitle(station), 0, 5.5, bannerZ);
    }
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

  public update(dt: number): void {
    if (this.isDisposed) return;

    // Deterministic Lab clock feeds the SAME authoritative obstacle motion
    // function as production, for both collision and meshes, so moving
    // obstacles really move in the Lab too.
    this.labTime += dt;
    this.physics.updateDynamicObstacles(this.labTime);
    if (this.gauntletAnimated.length > 0) {
      for (const item of this.gauntletAnimated) {
        const offset = obstacleLateralOffset(
          { amplitude: item.amplitude, speed: item.speed, phase: item.phase },
          this.labTime
        );
        const x = item.baseX + item.lateralX * offset;
        const z = item.baseZ + item.lateralZ * offset;
        item.mesh.position.set(x, item.baseY, z);
        if (item.outline) item.outline.position.set(x, item.baseY, z);
      }
    }

    this.updateGauntletProgress();

    // Check kill plane
    if (this.player.position.y < -20) {
      this.respawnAtTestCheckpoint();
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

  public teleportPlayer(pos: THREE.Vector3, yaw: number): void {
    this.player.setPosition(pos);
    this.player.setOrientation(yaw);
    this.player.velocity.set(0, 0, 0);
    this.clearTrajectory();
  }

  /**
   * Restores to the last passed gauntlet test checkpoint (or the lab spawn when
   * the player is outside the gauntlet). Used by tap-R / fall restore so a
   * failed obstacle attempt does not send the player back to the very start.
   * Hold-R still performs the normal full restart (lab spawn).
   */
  public respawnAtTestCheckpoint(): void {
    const cp = this.gauntletCheckpointIndex >= 0
      ? this.gauntletCheckpoints[this.gauntletCheckpointIndex]
      : null;
    if (cp) {
      this.teleportPlayer(
        new THREE.Vector3(cp.position.x, cp.position.y, cp.position.z),
        cp.yaw
      );
    } else {
      this.resetPlayer();
    }
  }

  /** DEV quick-jump: teleport to a gauntlet station checkpoint. */
  public teleportToStation(stationIndex: number): void {
    if (this.gauntletCheckpoints.length === 0) return;
    const clamped = Math.max(0, Math.min(this.gauntletCheckpoints.length - 1, stationIndex));
    const cp = this.gauntletCheckpoints[clamped];
    if (!cp) return;
    this.gauntletCheckpointIndex = clamped;
    this.hud.setObstacleSection(cp.label);
    this.teleportPlayer(new THREE.Vector3(cp.position.x, cp.position.y, cp.position.z), cp.yaw);
  }

  private cycleStation(delta: number): void {
    const base = this.gauntletCheckpointIndex;
    this.teleportToStation(base + delta);
  }

  private updateGauntletProgress(): void {
    if (this.gauntletCheckpoints.length === 0) return;
    const z = this.player.position.z;
    if (z < this.gauntletStartZ - 20) {
      if (this.gauntletCheckpointIndex !== -1) {
        this.gauntletCheckpointIndex = -1;
        this.hud.setObstacleSection(null);
      }
      return;
    }

    let index = -1;
    for (let i = 0; i < this.gauntletCheckpoints.length; i++) {
      if (z >= this.gauntletCheckpoints[i].position.z - 1.0) index = i;
    }
    if (index > this.gauntletCheckpointIndex) {
      this.gauntletCheckpointIndex = index;
      this.hud.setObstacleSection(this.gauntletCheckpoints[index].label);
    }
  }

  private initListeners(): void {
    if (typeof window === 'undefined') return;

    this.keyListener = (e: KeyboardEvent) => {
      // NOTE: R is intentionally NOT handled here. Tap-R (checkpoint restore)
      // and hold-R (full restart) are owned by the production PlayerController
      // path so the Lab uses the normal movement control semantics.
      if (e.code === 'KeyT' && !e.repeat) {
        this.toggleTrajectory();
      } else if (e.code === 'Digit9' && !e.repeat) {
        // OBSTACLE GAUNTLET: jump to the start of the obstacle test course.
        this.teleportToStation(0);
      } else if (e.code === 'BracketRight' && !e.repeat) {
        this.cycleStation(1);
      } else if (e.code === 'BracketLeft' && !e.repeat) {
        this.cycleStation(-1);
      } else if (e.code === 'Digit4' && !e.repeat) {
        // Area F1: Easy Single Ramp
        this.teleportPlayer(new THREE.Vector3(0, 1.5, 1050), Math.PI);
      } else if (e.code === 'Digit5' && !e.repeat) {
        // Area F2: Long Flow Ramp
        this.teleportPlayer(new THREE.Vector3(0, 5.5, 1190), Math.PI);
      } else if (e.code === 'Digit6' && !e.repeat) {
        // Area F3: Transfer Test
        this.teleportPlayer(new THREE.Vector3(0, 3.5, 1360), Math.PI);
      } else if (e.code === 'Digit7' && !e.repeat) {
        // Area F4: High-Speed Surf Chute
        this.teleportPlayer(new THREE.Vector3(0, 1.5, 1540), Math.PI);
      } else if (e.code === 'Digit8' && !e.repeat) {
        // Area F5: Surf Exit & Launch
        this.teleportPlayer(new THREE.Vector3(0, 1.5, 1730), Math.PI);
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
