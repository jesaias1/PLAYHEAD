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
import { CelestialLandmarks } from './CelestialLandmarks';
import { RouteExclusionCorridor } from './RouteExclusionCorridor';
import { getNodeExitAnchor, getNodeEntryAnchor } from '../generation/RouteConnectivityValidator';
import { obstacleLateralOffset } from '../generation/ObstacleMotion';

export class World {
  public physics: PhysicsWorld;
  public visualController: MusicVisualController;
  public sky: ProceduralSky;
  public playheadSystem: PlayheadSystem;
  public songDirector: SongDirector;
  public spectacleRenderer: SpectacleRenderer;

  public skyline: SkylineArchitecture | null = null;
  public celestialLandmarks: CelestialLandmarks | null = null;
  public spectralArchitecture: SpectralArchitecture | null = null;
  public dropSetpiece: DropSetpiece | null = null;
  public debugChainMesh: THREE.LineSegments | null = null;

  /** DEV-only debug visualization of the protected gameplay region. */
  public debugCorridorGroup: THREE.Group | null = null;

  public track: GeneratedTrack | null = null;
  public analysis: TrackAnalysis | null = null;

  /**
   * PRESENTATION ONLY. A short-lived multiplier added on top of the
   * music-driven reactivity when a movement moment fires (landing, surf lock,
   * finish). Decays back into the music state on its own.
   */
  public signalImpulse = 0;

  /** Authoritative gameplay protection region for the loaded track. */
  public corridor: RouteExclusionCorridor | null = null;

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
    this.physics.buildFromRoute(track.route, track.optionalRamps, track.recoveryShelves, track.obstacles, track.signalSpines);

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

    // Register major gate / finish / accent surfaces as always-present audio
    // beacons. Their authored emissive is read as the rest luminance, then
    // driven per-frame from the shared MusicVisualController state.
    for (const beacon of this.builtAssets.reactiveBeacons) {
      this.playheadSystem.registerReactive(beacon.mesh, beacon.channel);
    }

    // 4. Build Distant Audio Skyline
    this.skyline = new SkylineArchitecture(this.scene, analysis, track);

    // 5. Build Celestial Landmarks (Giant low-res Moon / Eclipse / Halos in negative space)
    this.celestialLandmarks = new CelestialLandmarks(
      this.scene,
      analysis,
      track,
      this.visualController.state.palette
    );

    // 6. Build Spatial Spectral Architecture (Waveform Canyons, Canopy, Onset Gates)
    this.spectralArchitecture = new SpectralArchitecture(this.scene, analysis, track);

    // 6. Build Major Drop Setpiece
    this.dropSetpiece = new DropSetpiece(this.scene, analysis, track);

    // ==========================================================
    // FINAL AUTHORITATIVE GAMEPLAY-SAFETY PASS
    //
    // This runs AFTER every system that can affect decoration placement
    // (route generation, route repair, surf insertion, optional surf, recovery
    // geometry, scaling, rotation, translation, skyline, brutalist landmarks,
    // spectral architecture, drop setpiece, celestial landmarks).
    //
    // It operates on FINAL WORLD-SPACE GEOMETRY, measuring each individual
    // mesh's real bounding box rather than any declared proxy radius, so it
    // cannot be defeated by stale bounds, pre-scale/pre-rotation bounds, or
    // nested groups. Invalid decoration is REJECTED; gameplay is never moved
    // or deformed to accommodate decoration. Gameplay wins.
    // ==========================================================
    const allCorridorNodes = [
      ...track.route,
      ...(track.optionalRamps || []),
      ...(track.recoveryShelves || []),
      ...(track.signalSpines || [])
    ];
    this.corridor = new RouteExclusionCorridor(allCorridorNodes);

    const decorationRoots: THREE.Object3D[] = [
      this.dropSetpiece.group,
      this.spectralArchitecture.group,
      this.skyline.group
    ];
    if (this.celestialLandmarks?.group) decorationRoots.push(this.celestialLandmarks.group);
    if (this.builtAssets?.decorativeGroup) decorationRoots.push(this.builtAssets.decorativeGroup);

    const report = this.corridor.validateDecorations(decorationRoots);
    if (report.total > 0) {
      console.log(
        `[World] Gameplay-safety pass rejected ${report.total} decorative elements ` +
        `intruding into protected route volumes.`
      );
    }

    const buildingReport = RouteExclusionCorridor.getLastBuildingReport();
    if (buildingReport.candidatesGenerated > 0) {
      console.log(
        `[World] Building Validation: ${buildingReport.candidatesGenerated} candidates generated, ` +
        `${buildingReport.rejectedByGameplayCollision} rejected by direct collision, ` +
        `${buildingReport.rejectedByComfortClearance} rejected by comfort clearance, ` +
        `${buildingReport.finalSurvivingBuildings} surviving.`
      );
    }

    // Refresh authored transforms so distance culling never resurrects rejected buildings
    this.skyline.refreshAuthoredTransformsAfterValidation();

    // ==========================================================
    // STATIC TRANSFORM FREEZE
    //
    // The vast majority of world decoration never moves after placement, yet
    // every mesh defaults to matrixAutoUpdate = true, which makes Three.js
    // recompute its local matrix and re-multiply the world matrix every frame.
    // Freezing genuinely-static subtrees removes that per-frame CPU cost.
    //
    // Only subtrees whose transforms are never touched at runtime are frozen.
    // Animated groups (drop setpiece, spectral canyon/onset, celestial
    // landmarks, playhead edges) are deliberately left alone.
    // ==========================================================
    const staticRoots: THREE.Object3D[] = [this.skyline.group];
    if (this.builtAssets?.decorativeGroup) staticRoots.push(this.builtAssets.decorativeGroup);
    const frozen = this.freezeStaticTransforms(staticRoots);
    if (frozen > 0) {
      console.log(`[World] Froze ${frozen} static world transforms.`);
    }

    // 7. Initialize Spectacle Visual Renderer
    this.spectacleRenderer.init(track);

    // 8. Authoritative Route Continuity Debug Chain
    this.buildDebugChain(track);

    // 9. DEV-only protected-corridor visualization (hidden by default)
    this.buildCorridorDebug();
  }

  /** PRESENTATION ONLY: brief world signal pulse (decays back to music). */
  public pulseSignal(strength: number): void {
    this.signalImpulse = Math.min(1.2, this.signalImpulse + strength);
  }

  public update(
    songTime: number,
    playerPos: THREE.Vector3,
    playerYaw: number,
    dt: number,
    environment?: Environment,
    playerSpeed = 0,
    reduceMotion = false
  ): { arcProgress: number; syncDelta: number; progressRatio: number; targetSongTime: number } {
    // Decoration LOD distance is owned by the quality system (0 = never cull).
    const lodDistance = environment ? environment.decorationLodDistance : 0;

    // Deterministic moving obstacles (shutters / sweep beams). Their collision
    // boxes and visible meshes advance together from song time only.
    this.physics.updateDynamicObstacles(songTime);
    if (this.builtAssets && this.builtAssets.animatedObstacles.length > 0) {
      for (const item of this.builtAssets.animatedObstacles) {
        const offset = obstacleLateralOffset(
          { amplitude: item.amplitude, speed: item.speed, phase: item.phase },
          songTime
        );
        const x = item.baseX + item.lateralX * offset;
        const z = item.baseZ + item.lateralZ * offset;
        item.mesh.position.set(x, item.baseY, z);
        if (item.outline) item.outline.position.set(x, item.baseY, z);
      }
    }

    const progress = this.getRouteProgress(playerPos);
    const totalDist = this.track && this.track.totalDistance > 0 ? this.track.totalDistance : 1;
    const progressRatio = progress.arcProgress / totalDist;

    // Update central visual bus
    this.visualController.update(songTime, progress.arcProgress, dt, playerSpeed);
    const vState = this.visualController.state;

    // Update Song Director (macro dramatic arc, experience phases, spectacle planning)
    const directorState = this.songDirector.update(songTime, progress.arcProgress, dt, vState, progress.nearestNode);
    vState.dramaticIntensity = directorState.dramaticIntensity;

    // Movement feedback may add a short-lived impulse on top of the music-driven
    // reactivity, which then naturally decays back into the music state.
    if (this.signalImpulse > 0) {
      this.signalImpulse = Math.max(0, this.signalImpulse - dt * 1.9);
    }
    this.visualController.reactivityMultiplier = directorState.spectralReactivity + this.signalImpulse;

    // Update procedural sky & atmosphere with director modulation
    this.sky.update(vState, playerPos, directorState.starVisibility);
    if (environment) {
      environment.updateAtmosphere(vState, dt, directorState);
    }

    // Update spectacle runtime renderer (6 distinct event families)
    this.spectacleRenderer.update(directorState.activeSpectacle, vState, playerPos, reduceMotion);

    // Update skyline architecture
    if (this.skyline) {
      this.skyline.update(vState);
      // Purely decorative: safe to thin by distance. Gameplay surfaces are
      // never touched by this path.
      this.skyline.applyDistanceCulling(playerPos, lodDistance);
    }

    // Update celestial landmarks (moon, eclipse, halos, relics)
    if (this.celestialLandmarks) {
      this.celestialLandmarks.update(songTime, vState.bass, vState.dropImpact);
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

    if (this.celestialLandmarks) {
      this.celestialLandmarks.dispose();
      this.scene.remove(this.celestialLandmarks.group);
      this.celestialLandmarks = null;
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

    if (this.debugCorridorGroup) {
      this.scene.remove(this.debugCorridorGroup);
      this.debugCorridorGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      this.debugCorridorGroup = null;
    }

    this.playheadSystem.clear();
    this.songDirector.dispose();
    this.physics.dispose();
    this.corridor = null;
    this.signalImpulse = 0;
    this.track = null;
    this.analysis = null;
  }

  public setDebugChainVisible(visible: boolean): void {
    if (this.debugChainMesh) {
      this.debugChainMesh.visible = visible;
    }
  }

  /**
   * Bakes world matrices for subtrees that never move, then disables per-frame
   * matrix recomputation on them. Safe only for genuinely static decoration.
   */
  private freezeStaticTransforms(roots: THREE.Object3D[]): number {
    let frozen = 0;
    for (const root of roots) {
      if (!root) continue;
      root.updateWorldMatrix(true, true);
      root.traverse((obj) => {
        // Keep the root itself dynamic (cheap, and avoids surprising callers).
        if (obj === root) return;
        if (obj.matrixAutoUpdate) {
          obj.matrixAutoUpdate = false;
          frozen++;
        }
      });
    }
    return frozen;
  }

  /**
   * DEV-ONLY: visualize the authoritative gameplay protection region.
   *
   * Draws the protected volume around every gameplay node so a screenshot can
   * immediately show whether a piece of decoration sits inside gameplay space.
   * Off by default and never enabled in normal play.
   */
  public setCorridorDebugVisible(visible: boolean): boolean {
    if (!this.corridor || !this.debugCorridorGroup) return false;
    this.debugCorridorGroup.visible = visible;
    return visible;
  }

  public buildCorridorDebug(): void {    if (this.debugCorridorGroup) {
      this.scene.remove(this.debugCorridorGroup);
      this.debugCorridorGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      this.debugCorridorGroup = null;
    }
    if (!this.corridor || !this.track) return;

    const group = new THREE.Group();
    group.name = 'CorridorDebug';
    group.visible = false;

    const route = this.track.route;
    for (let i = 0; i < route.length; i++) {
      const node = route[i];
      const isSurf = !!node.isSurf;
      const isStepUp = node.type === 'STEP_UP';
      const halfBreadth = (node.dimensions.x || 10) * 0.5;

      // Representative clearance for a mid-size structure, so the drawn volume
      // matches what large decoration is actually measured against.
      const proxyRadius = 20.0;
      let margin: number;
      if (isSurf) margin = Math.max(38.0, 46.0) + 0.85 * proxyRadius;
      else if (isStepUp) margin = 32.0 + 0.7 * proxyRadius;
      else margin = 26.0 + 0.65 * proxyRadius;
      const radius = halfBreadth + proxyRadius + margin;

      const color = isSurf ? 0xff4488 : (isStepUp ? 0xffcc00 : 0x00ff88);

      const geom = new THREE.CylinderGeometry(radius, radius, 1.0, 16, 1, true);
      const mat = new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity: 0.18,
        depthWrite: false
      });
      const h = RouteExclusionCorridor.JUMP_CORRIDOR_ABOVE + RouteExclusionCorridor.JUMP_CORRIDOR_BELOW;
      const marker = new THREE.Mesh(geom, mat);
      marker.position.set(node.position.x, node.position.y, node.position.z);
      marker.scale.y = h;
      // Centre the band on the protected envelope: [-BELOW, +ABOVE] around y.
      marker.position.y += (RouteExclusionCorridor.JUMP_CORRIDOR_ABOVE - RouteExclusionCorridor.JUMP_CORRIDOR_BELOW) * 0.5;
      group.add(marker);
    }

    this.debugCorridorGroup = group;
    this.scene.add(group);
    console.log(`[World] Corridor debug built: ${route.length} protected volumes (radius ~= node footprint + clearance).`);
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
