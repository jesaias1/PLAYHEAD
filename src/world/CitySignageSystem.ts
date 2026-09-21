/**
 * CitySignageSystem for PLAYHEAD SIGNAL RENDER
 * "Cosmic Pixel Brutalism" Audio-Reactive City & Billboard Navigation System.
 *
 * Populates distant skyscraper facades with song-derived billboards,
 * authentic Japanese system typography, multi-band audio spectrograms,
 * rooftop crowns, brutalist slit window clusters, and spatial drop wave propagation.
 */

import * as THREE from 'three';
import { TrackAnalysis } from '../audio/AudioFeatures';
import { GeneratedTrack, RouteNode } from '../generation/GenerationTypes';
import { MusicVisualState } from './MusicVisualController';
import { PixelArtLibrary } from './PixelArtLibrary';
import { cleanTrackTitle } from '../audio/CleanTitle';
import { RouteExclusionCorridor } from './RouteExclusionCorridor';

export interface MonolithAnchor {
  position: THREE.Vector3;
  width: number;
  height: number;
  topY: number;
  abyssBottom: number;
  yaw: number;
  side: number;
  fwdX: number;
  fwdZ: number;
  rightX: number;
  rightZ: number;
  node: RouteNode;
  nodeIndex: number;
  progressRatio: number;
  isHero: boolean;
}

export interface StelaAnchor {
  position: THREE.Vector3;
  width: number;
  height: number;
  topY: number;
  abyssBottom: number;
  yaw: number;
  side: number;
  fwdX: number;
  fwdZ: number;
  rightX: number;
  rightZ: number;
  node: RouteNode;
  progressRatio: number;
}

interface CullingEntry {
  mesh: THREE.Mesh;
  position: THREE.Vector3;
}

export class CitySignageSystem {
  public group: THREE.Group;

  // Shared reactive materials (hierarchical audio channels)
  private ambientMat: THREE.MeshBasicMaterial;
  private bassMat: THREE.MeshBasicMaterial;
  private midMat: THREE.MeshBasicMaterial;
  private highMat: THREE.MeshBasicMaterial;
  private heroMat: THREE.MeshBasicMaterial;
  private stagedWaveMats: THREE.MeshBasicMaterial[] = [];

  // Reusable shared geometries to maximize GPU instancing/batching
  private sharedGeometries: THREE.PlaneGeometry[] = [];

  // Distance culling registration
  private cullingEntries: CullingEntry[] = [];
  private cullingActive = false;

  // Spatial drop wave propagation tracking
  private lastDropTime = -999;
  private lastDropStrength = 0;
  private dropActiveLastFrame = false;

  constructor(
    analysis: TrackAnalysis,
    track: GeneratedTrack,
    corridor: RouteExclusionCorridor,
    monoliths: MonolithAnchor[],
    stelae: StelaAnchor[]
  ) {
    this.group = new THREE.Group();
    this.group.name = 'CitySignageSystem';

    // 1. Initialize Shared Reactive Materials
    const palette = analysis.visualAccent;
    const accentCol = new THREE.Color(palette.hex);

    this.ambientMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.2, 0.2, 0.2),
      side: THREE.DoubleSide
    });

    this.bassMat = new THREE.MeshBasicMaterial({
      color: accentCol.clone().multiplyScalar(0.7),
      side: THREE.DoubleSide
    });

    this.midMat = new THREE.MeshBasicMaterial({
      color: accentCol.clone().multiplyScalar(0.8),
      side: THREE.DoubleSide
    });

    this.highMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.8, 0.8, 0.9),
      side: THREE.DoubleSide
    });

    this.heroMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.0, 1.0, 1.0),
      side: THREE.DoubleSide
    });

    // 4 staged wave materials across 4 distance sectors along the course
    for (let s = 0; s < 4; s++) {
      this.stagedWaveMats.push(
        new THREE.MeshBasicMaterial({
          color: accentCol.clone().multiplyScalar(0.75),
          side: THREE.DoubleSide
        })
      );
    }

    // 2. Build Sign Geometries & Mount on Towers
    this.buildSignage(analysis, track, corridor, monoliths, stelae);
  }

  private buildSignage(
    analysis: TrackAnalysis,
    _track: GeneratedTrack,
    corridor: RouteExclusionCorridor,
    monoliths: MonolithAnchor[],
    stelae: StelaAnchor[]
  ): void {
    const cleanTitle = cleanTrackTitle(analysis.filename || 'SIGNAL DRIFT');
    const bpm = Math.round(analysis.bpm || 120);
    const accentHex = analysis.visualAccent?.hex || '#00f0ff';
    const secondaryHex = '#ff00aa';

    // Generate deterministic track code: e.g. "PH://SD-105"
    const prefix = cleanTitle.replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'SIG';
    const trackCode = `${prefix}-${(bpm % 100).toString().padStart(2, '0')}`;

    // Shared plane geometries
    const heroGeom = new THREE.PlaneGeometry(46.0, 22.0);
    const facadeGeom = new THREE.PlaneGeometry(28.0, 12.0);
    const spectroGeom = new THREE.PlaneGeometry(20.0, 20.0);
    const vertJpGeom = new THREE.PlaneGeometry(6.5, 42.0);
    const vertJpSmallGeom = new THREE.PlaneGeometry(5.0, 30.0);
    const crownGeom = new THREE.PlaneGeometry(24.0, 8.5);
    const windowGeom = new THREE.PlaneGeometry(22.0, 84.0);

    this.sharedGeometries.push(
      heroGeom,
      facadeGeom,
      spectroGeom,
      vertJpGeom,
      vertJpSmallGeom,
      crownGeom,
      windowGeom
    );

    // Shared authored textures from PixelArtLibrary
    const heroTex = PixelArtLibrary.getTrackHeroBannerTexture(
      cleanTitle,
      bpm,
      trackCode,
      accentHex,
      secondaryHex,
      analysis.waveform
    );

    const spectroTex = PixelArtLibrary.getSpectrogramMatrixTexture(accentHex, secondaryHex);
    const coolWindowTex = PixelArtLibrary.getWindowClusterTexture('cool', accentHex);
    const warmWindowTex = PixelArtLibrary.getWindowClusterTexture('warm', accentHex);

    // Track hero candidates count
    let heroCount = 0;

    // Helper to safely mount a mesh if outside RouteExclusionCorridor
    const tryMount = (mesh: THREE.Mesh, radius: number, minY: number, maxY: number): boolean => {
      if (!corridor.isPointInsideCorridor(mesh.position, radius, minY, maxY)) {
        this.group.add(mesh);
        this.cullingEntries.push({ mesh, position: mesh.position.clone() });
        return true;
      }
      return false;
    };

    // =========================================================================
    // 1. PRIMARY MONOLITHS: Facade Billboards, Japanese Stelae & Window Slits
    // =========================================================================
    for (let i = 0; i < monoliths.length; i++) {
      const m = monoliths[i];
      const stageIdx = Math.min(3, Math.floor(m.progressRatio * 4));
      const stagedMat = this.stagedWaveMats[stageIdx];

      // Surface facing the route is located at offset = -m.side * 12.15
      const facadeOffset = -m.side * 12.2;
      const rotY = m.node.yaw + (m.side > 0 ? -Math.PI * 0.5 : Math.PI * 0.5);

      const facadeBaseX = m.position.x + m.rightX * facadeOffset;
      const facadeBaseZ = m.position.z + m.rightZ * facadeOffset;

      // A. Architectural Slit Window Cluster (breathing brutalist megacity)
      const winMat = this.ambientMat.clone();
      winMat.map = i % 2 === 0 ? coolWindowTex : warmWindowTex;
      const winMesh = new THREE.Mesh(windowGeom, winMat);
      winMesh.position.set(facadeBaseX, m.node.position.y + 44.0, facadeBaseZ);
      winMesh.rotation.y = rotY;
      tryMount(winMesh, 24.0, m.abyssBottom, m.topY);

      // B. Main Facade Display
      const displayOffset = -m.side * 0.25;
      const displayX = facadeBaseX + m.rightX * displayOffset;
      const displayZ = facadeBaseZ + m.rightZ * displayOffset;

      if (m.isHero && heroCount < 3) {
        // Colossal Hero Landmark Billboard
        const hMat = this.heroMat.clone();
        hMat.map = heroTex;
        const hMesh = new THREE.Mesh(heroGeom, hMat);
        hMesh.position.set(displayX, m.node.position.y + 48.0, displayZ);
        hMesh.rotation.y = rotY;
        if (tryMount(hMesh, 28.0, m.abyssBottom, m.topY)) {
          heroCount++;
        }
      } else if (i % 2 === 0) {
        const sec = (analysis.sections && analysis.sections.length > 0)
          ? (analysis.sections[m.node.sectionIndex] || analysis.sections.find(s => m.node.time >= s.start && m.node.time < s.end))
          : null;
        const sectionTheme = sec ? sec.theme : (m.node.type || 'FLOW').replace(/_/g, ' ');
        const telemTex = PixelArtLibrary.getHorizontalTelemetryTexture(
          cleanTitle,
          sectionTheme,
          accentHex,
          secondaryHex
        );
        const fMat = stagedMat.clone();
        fMat.map = telemTex;
        const fMesh = new THREE.Mesh(facadeGeom, fMat);
        fMesh.position.set(displayX, m.node.position.y + 38.0, displayZ);
        fMesh.rotation.y = rotY;
        tryMount(fMesh, 18.0, m.abyssBottom, m.topY);
      } else {
        // Spectrogram 16-band LED Frequency Matrix
        const sMat = this.midMat.clone();
        sMat.map = spectroTex;
        const sMesh = new THREE.Mesh(spectroGeom, sMat);
        sMesh.position.set(displayX, m.node.position.y + 40.0, displayZ);
        sMesh.rotation.y = rotY;
        tryMount(sMesh, 16.0, m.abyssBottom, m.topY);
      }

      // C. Vertical Japanese Stelae Runner (edge-mounted)
      if (i % 2 === 1 || m.isHero) {
        const termIdx = (i * 3 + (m.side > 0 ? 1 : 4)) % 9;
        const jpTex = PixelArtLibrary.getVerticalJapaneseSignTexture(termIdx, accentHex, secondaryHex);
        const jpMat = this.bassMat.clone();
        jpMat.map = jpTex;

        const edgeShift = (i % 4 === 1 ? -8.5 : 8.5);
        const jMesh = new THREE.Mesh(vertJpGeom, jpMat);
        jMesh.position.set(
          displayX + m.fwdX * edgeShift,
          m.node.position.y + 34.0,
          displayZ + m.fwdZ * edgeShift
        );
        jMesh.rotation.y = rotY;
        tryMount(jMesh, 22.0, m.abyssBottom, m.topY);
      }

      // D. Rooftop Crown Signs (mounted atop tower parapet)
      if (i % 3 === 0) {
        const crownTex = PixelArtLibrary.getRooftopCrownTexture(i / 3, accentHex, secondaryHex);
        const cMat = this.heroMat.clone();
        cMat.map = crownTex;
        const cMesh = new THREE.Mesh(crownGeom, cMat);
        cMesh.position.set(facadeBaseX, m.topY + 4.25, facadeBaseZ);
        cMesh.rotation.y = rotY;
        tryMount(cMesh, 18.0, m.topY, m.topY + 12.0);
      }
    }

    // =========================================================================
    // 2. SECONDARY SUPPORT STELAE: Japanese Runners & Status Panels
    // =========================================================================
    for (let j = 0; j < stelae.length; j += 2) {
      const s = stelae[j];
      const stageIdx = Math.min(3, Math.floor(s.progressRatio * 4));
      const stagedMat = this.stagedWaveMats[stageIdx];

      const stelaOffset = -s.side * 5.2;
      const rotY = s.node.yaw + (s.side > 0 ? -Math.PI * 0.5 : Math.PI * 0.5);
      const sx = s.position.x + s.rightX * stelaOffset;
      const sz = s.position.z + s.rightZ * stelaOffset;

      const termIdx = (j * 2 + 3) % 9;
      const jpTex = PixelArtLibrary.getVerticalJapaneseSignTexture(termIdx, accentHex, secondaryHex);
      const sMat = stagedMat.clone();
      sMat.map = jpTex;

      const sMesh = new THREE.Mesh(vertJpSmallGeom, sMat);
      sMesh.position.set(sx, s.node.position.y + 28.0, sz);
      sMesh.rotation.y = rotY;
      tryMount(sMesh, 16.0, s.abyssBottom, s.topY);
    }
  }

  /**
   * Central Audio-Reactive Update Loop
   * Drives hierarchical reactive channels:
   * - Ambient: slow breathing with energy & sub-bass
   * - Bass: large neon tubes and sign bodies
   * - Mids: spectrogram meters & waveform motion
   * - Highs: edge lights, tickers, micro-shimmer
   * - Hero: transient punch on onsets and explosive ignition on drops
   * - Spatial Drop Wave: sequential outward ripple across distant towers
   */
  public update(visualState: MusicVisualState, _dt = 0): void {
    const mult = visualState.reactivityMultiplier;

    // 1. Ambient Channel (window slits & architectural ribs)
    const ambLum = (0.16 + visualState.energy * 0.18 + visualState.subBass * 0.12) * mult;
    this.ambientMat.color.setScalar(ambLum);

    // 2. Bass Channel (neon signage bodies & Japanese Kanji)
    const bassLum = (0.32 + visualState.bass * 0.82 + (visualState.subBass > 0.65 ? 0.35 : 0.0)) * mult;
    this.bassMat.color.setScalar(bassLum);

    // 3. Mid Channel (spectrogram LED matrices)
    const midLum = (0.35 + visualState.mid * 0.88 + visualState.lowMid * 0.32) * mult;
    this.midMat.color.setScalar(midLum);

    // 4. High Channel (fine glyph borders, status tickers & edge lights)
    const shimmer = Math.sin(visualState.time * 28.0) * 0.08 * visualState.high;
    const highLum = (0.26 + visualState.high * 0.88 + visualState.flux * 0.35 + shimmer) * mult;
    this.highMat.color.setScalar(highLum);

    // 5. Hero Landmark Channel (onset punch & colossal drop ignition)
    const isBreakdown = visualState.sectionTheme === 'BREATH' || visualState.energy < 0.22;
    let heroLum: number;
    if (isBreakdown) {
      // Graceful dimming during breakdowns to maximize dynamic contrast
      heroLum = (0.2 + visualState.energy * 0.25) * mult;
    } else {
      const onsetPunch = visualState.onsetPulse * 0.75;
      const dropBoost = visualState.dropImpact * 1.85;
      heroLum = (0.45 + visualState.bass * 0.45 + onsetPunch + dropBoost) * mult;
    }
    this.heroMat.color.setScalar(heroLum);

    // 6. Spatial Drop Wave Propagation
    // Detect rising edge of drop impact
    if (visualState.dropImpact > 0.3 && !this.dropActiveLastFrame) {
      this.lastDropTime = visualState.time;
      this.lastDropStrength = visualState.dropImpact;
    }
    this.dropActiveLastFrame = visualState.dropImpact > 0.3;

    for (let s = 0; s < 4; s++) {
      const stageDelay = s * 0.085; // ~85ms per stage, sweeping across 340ms
      const dtWave = visualState.time - this.lastDropTime - stageDelay;
      let wavePulse = 0;
      if (dtWave >= 0 && dtWave < 0.22) {
        wavePulse = Math.sin((dtWave / 0.22) * Math.PI) * this.lastDropStrength * 1.5;
      }
      const stageLum = (0.34 + visualState.bass * 0.76 + wavePulse) * mult;
      this.stagedWaveMats[s].color.setScalar(stageLum);
    }
  }

  /**
   * Distance-based LOD visibility culling.
   * Hides distant billboards when the camera is beyond maxDistance.
   */
  public applyDistanceCulling(cameraPos: THREE.Vector3, maxDistance: number): void {
    if (maxDistance <= 0) {
      if (this.cullingActive) {
        for (const entry of this.cullingEntries) {
          entry.mesh.visible = true;
        }
        this.cullingActive = false;
      }
      return;
    }

    this.cullingActive = true;
    const cutoffSq = maxDistance * maxDistance;
    for (const entry of this.cullingEntries) {
      const far = entry.position.distanceToSquared(cameraPos) > cutoffSq;
      entry.mesh.visible = !far;
    }
  }

  public dispose(): void {
    for (const geom of this.sharedGeometries) {
      geom.dispose();
    }
    this.sharedGeometries = [];

    this.ambientMat.dispose();
    this.bassMat.dispose();
    this.midMat.dispose();
    this.highMat.dispose();
    this.heroMat.dispose();
    for (const mat of this.stagedWaveMats) {
      mat.dispose();
    }
    this.stagedWaveMats = [];

    this.group.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
    this.cullingEntries = [];
  }
}
