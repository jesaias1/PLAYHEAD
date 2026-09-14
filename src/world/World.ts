/**
 * World orchestrator for PLAYHEAD
 * Coordinates route geometry, colliders, procedural sky, skyline architecture,
 * spectral architecture, drop setpieces, and the playhead temporal system.
 */

import * as THREE from 'three';
import { TrackAnalysis } from '../audio/AudioFeatures';
import { GeneratedTrack, RouteNode } from '../generation/GenerationTypes';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { GeometryBuilder, BuiltWorldAssets } from './GeometryBuilder';
import { MusicVisualController } from './MusicVisualController';
import { ProceduralSky } from './ProceduralSky';
import { SkylineArchitecture } from './SkylineArchitecture';
import { PlayheadSystem } from './PlayheadSystem';
import { SpectralArchitecture } from './SpectralArchitecture';
import { DropSetpiece } from './DropSetpiece';
import { Environment } from './Environment';
import { SongDirector } from './SongDirector';
import { SpectacleRenderer } from './SpectacleRenderer';
import { getNodeExitAnchor, getNodeEntryAnchor } from '../generation/RouteConnectivityValidator';

export class World {
  public physics: PhysicsWorld;
  public visualController: MusicVisualController;
  public sky: ProceduralSky;
  public playheadSystem: PlayheadSystem;
  public songDirector: SongDirector;
  public spectacleRenderer: SpectacleRenderer;

  public skyline: SkylineArchitecture | null = null;
  public spectralArchitecture: SpectralArchitecture | null = null;
  public dropSetpiece: DropSetpiece | null = null;
  public debugChainMesh: THREE.LineSegments | null = null;

  public track: GeneratedTrack | null = null;
  public analysis: TrackAnalysis | null = null;

  private scene: THREE.Scene;
  private builtAssets: BuiltWorldAssets | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.physics = new PhysicsWorld();
    this.visualController = new MusicVisualController();
    this.sky = new ProceduralSky(scene);
    this.playheadSystem = new PlayheadSystem(scene);
    this.songDirector = new SongDirector();
    this.spectacleRenderer = new SpectacleRenderer(scene);
  }

  public loadTrack(analysis: TrackAnalysis, track: GeneratedTrack, environment?: Environment): void {
    this.disposeTrackAssets();

    this.analysis = analysis;
    this.track = track;

    // 1. Initialize Visual Signal Bus with Palette and Song Director
    this.visualController.init(analysis, track);
    this.songDirector.init(analysis, track);
    if (environment) {
      environment.setPalette(this.visualController.state.palette);
    }

    // 2. Build Physics Colliders (frozen authoritative physics)
    this.physics.buildFromRoute(track.route);

    // 3. Build Procedural Route & Monolith Meshes
    this.builtAssets = GeometryBuilder.buildWorld(track, this.visualController.state.palette);
    this.scene.add(this.builtAssets.rootGroup);

    // Register route edge trim with PlayheadSystem for temporal activation
    for (const item of this.builtAssets.routeEdgeItems) {
      this.playheadSystem.registerItem(
        item.mesh,
        item.nodeArcLength,
        item.nodeTime,
        0.85,
        1.0
      );
    }

    // 4. Build Distant Audio Skyline
    this.skyline = new SkylineArchitecture(this.scene, analysis, track);

    // 5. Build Spatial Spectral Architecture (Waveform Canyons, Canopy, Onset Gates)
    this.spectralArchitecture = new SpectralArchitecture(this.scene, analysis, track);

    // 6. Build Major Drop Setpiece
    this.dropSetpiece = new DropSetpiece(this.scene, analysis, track);

    // 7. Initialize Spectacle Visual Renderer
    this.spectacleRenderer.init(track);

    // 8. Authoritative Route Continuity Debug Chain
    this.buildDebugChain(track);
  }

  public update(
    songTime: number,
    playerPos: THREE.Vector3,
    playerYaw: number,
    dt: number,
    environment?: Environment,
    playerSpeed = 0
  ): { arcProgress: number; syncDelta: number; progressRatio: number; targetSongTime: number } {
    const progress = this.getRouteProgress(playerPos);
    const totalDist = this.track && this.track.totalDistance > 0 ? this.track.totalDistance : 1;
    const progressRatio = progress.arcProgress / totalDist;

    // Update central visual bus
    this.visualController.update(songTime, progress.arcProgress, dt, playerSpeed);
    const vState = this.visualController.state;

    // Update Song Director (macro dramatic arc, experience phases, spectacle planning)
    const directorState = this.songDirector.update(songTime, progress.arcProgress, dt, vState, progress.nearestNode);
    vState.dramaticIntensity = directorState.dramaticIntensity;
    this.visualController.reactivityMultiplier = directorState.spectralReactivity;

    // Update procedural sky & atmosphere with director modulation
    this.sky.update(vState, playerPos, directorState.starVisibility);
    if (environment) {
      environment.updateAtmosphere(vState, dt, directorState);
    }

    // Update spectacle runtime renderer (shockwaves, ignition pulses)
    this.spectacleRenderer.update(directorState.activeSpectacle, vState, playerPos);

    // Update skyline architecture
    if (this.skyline) {
      this.skyline.update(vState);
    }

    // Update spatial spectral architecture
    if (this.spectralArchitecture) {
      this.spectralArchitecture.update(vState);
    }

    // Update drop setpiece
    if (this.dropSetpiece) {
      this.dropSetpiece.update(vState);
    }

    // Update playhead temporality (Future / Present / Past)
    this.playheadSystem.update(playerPos, progress.arcProgress, playerYaw, vState);

    const syncDelta = songTime - progress.targetSongTime;

    return {
      arcProgress: progress.arcProgress,
      syncDelta,
      progressRatio,
      targetSongTime: progress.targetSongTime
    };
  }

  /**
   * Find nearest route node and current distance progress along the route
   */
  public getRouteProgress(playerPos: THREE.Vector3): {
    nearestNode: RouteNode;
    nodeIndex: number;
    arcProgress: number;
    targetSongTime: number;
  } {
    if (!this.track || this.track.route.length === 0) {
      const dummyNode: RouteNode = {
        id: 0, time: 0, position: { x: 0, y: 0, z: 0 },
        dimensions: { x: 10, y: 2, z: 20 }, yaw: 0, pitch: 0, roll: 0,
        type: 'RUNWAY' as any, intensity: 0, sectionIndex: 0,
        arcLength: 0, isSurf: false, isBoost: false
      };
      return { nearestNode: dummyNode, nodeIndex: 0, arcProgress: 0, targetSongTime: 0 };
    }

    const route = this.track.route;
    let closestDistSq = Infinity;
    let closestIdx = 0;

    for (let i = 0; i < route.length; i++) {
      const node = route[i];
      const dx = playerPos.x - node.position.x;
      const dy = playerPos.y - node.position.y;
      const dz = playerPos.z - node.position.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq < closestDistSq) {
        closestDistSq = distSq;
        closestIdx = i;
      }
    }

    const nearestNode = route[closestIdx];
    const arcProgress = nearestNode.arcLength;
    const targetSongTime = nearestNode.time;

    return {
      nearestNode,
      nodeIndex: closestIdx,
      arcProgress,
      targetSongTime
    };
  }

  private disposeTrackAssets(): void {
    if (this.builtAssets) {
      this.scene.remove(this.builtAssets.rootGroup);
      this.builtAssets.dispose();
      this.builtAssets = null;
    }

    if (this.skyline) {
      this.skyline.dispose();
      this.skyline = null;
    }

    if (this.spectralArchitecture) {
      this.spectralArchitecture.dispose();
      this.spectralArchitecture = null;
    }

    if (this.dropSetpiece) {
      this.dropSetpiece.dispose();
      this.dropSetpiece = null;
    }

    if (this.debugChainMesh) {
      this.scene.remove(this.debugChainMesh);
      this.debugChainMesh.geometry.dispose();
      (this.debugChainMesh.material as THREE.Material).dispose();
      this.debugChainMesh = null;
    }

    this.playheadSystem.clear();
    this.songDirector.dispose();
    this.physics.dispose();
    this.track = null;
    this.analysis = null;
  }

  public setDebugChainVisible(visible: boolean): void {
    if (this.debugChainMesh) {
      this.debugChainMesh.visible = visible;
    }
  }

  private buildDebugChain(track: GeneratedTrack): void {
    const route = track.route;
    if (route.length < 2) return;

    const positions: number[] = [];
    const colors: number[] = [];

    for (let i = 0; i < route.length - 1; i++) {
      const exit = getNodeExitAnchor(route[i]).position;
      const entry = getNodeEntryAnchor(route[i + 1]).position;

      positions.push(exit.x, exit.y + 0.2, exit.z);
      positions.push(entry.x, entry.y + 0.2, entry.z);

      const dx = entry.x - exit.x;
      const dy = entry.y - exit.y;
      const dz = entry.z - exit.z;
      const horizDist = Math.sqrt(dx * dx + dz * dz);

      let col = new THREE.Color(0x00ff88); // Green: well connected
      if (horizDist > 14.0 || dy > 1.45) {
        col = new THREE.Color(0xff2244); // Red: invalid gap
      } else if (horizDist > 10.0 || dy > 1.2) {
        col = new THREE.Color(0xffcc00); // Yellow: marginal gap
      }

      colors.push(col.r, col.g, col.b);
      colors.push(col.r, col.g, col.b);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      linewidth: 2
    });

    this.debugChainMesh = new THREE.LineSegments(geom, mat);
    this.debugChainMesh.visible = false;
    this.scene.add(this.debugChainMesh);
  }

  public dispose(): void {
    this.disposeTrackAssets();
    this.sky.dispose();
    this.playheadSystem.dispose();
  }
}
