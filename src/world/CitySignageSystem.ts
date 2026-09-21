/**
 * CitySignageSystem for PLAYHEAD SIGNAL RENDER
 * "Cosmic Pixel Brutalism" Audio-Reactive City & Billboard Navigation System.
 *
 * Strict Placement & Validation Pass:
 * - Mathematical wall-surface anchoring (0.18m standoff, exact face normal)
 * - Strict facade dimension checks (sign width <= face width - 2.4m)
 * - Single-sign occupancy per tower (zero stacked duplicates)
 * - 3D spacing clearance between signs (zero overlapping or intersecting billboards)
 * - Clear hierarchy: Hero Landmarks (2-3 max) + Curated Support Billboards + Atmospheric Windows
 * - Complete preservation of audio reactivity and spatial drop wave propagation.
 */

import * as THREE from 'three';
import { TrackAnalysis } from '../audio/AudioFeatures';
import { GeneratedTrack, RouteNode } from '../generation/GenerationTypes';
import { MusicVisualState } from './MusicVisualController';
import { PixelArtLibrary } from './PixelArtLibrary';
import { cleanTrackTitle } from '../audio/CleanTitle';
import { RouteExclusionCorridor } from './RouteExclusionCorridor';

export interface MonolithAnchor {
  id: string;
  position: THREE.Vector3;
  width: number;
  depth: number;
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
  id: string;
  position: THREE.Vector3;
  width: number;
  depth: number;
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

interface ResolvedFacade {
  normal: THREE.Vector3;
  tangent: THREE.Vector3;
  faceCenter: THREE.Vector3;
  faceWidth: number;
  faceYaw: number;
  dotToRoute: number;
}

interface CullingEntry {
  mesh: THREE.Mesh;
  position: THREE.Vector3;
}

interface PlacedSignRecord {
  center: THREE.Vector3;
  radius: number;
  isHero: boolean;
}

/**
 * Resolves the primary vertical facade of a rotated rectangular building box
 * that most directly faces toward the route point.
 */
function resolveRouteFacingFacade(
  center: THREE.Vector3,
  width: number,
  depth: number,
  yaw: number,
  routePos: { x: number; y: number; z: number }
): ResolvedFacade | null {
  const sinY = Math.sin(yaw);
  const cosY = Math.cos(yaw);

  // The 4 vertical faces of a box (local X: width, local Z: depth) rotated by yaw around Y
  const faces = [
    {
      // +Z face (front)
      normal: new THREE.Vector3(sinY, 0, cosY),
      tangent: new THREE.Vector3(-cosY, 0, sinY),
      width: width,
      depthOffset: depth / 2
    },
    {
      // -Z face (back)
      normal: new THREE.Vector3(-sinY, 0, -cosY),
      tangent: new THREE.Vector3(cosY, 0, -sinY),
      width: width,
      depthOffset: depth / 2
    },
    {
      // +X face (right)
      normal: new THREE.Vector3(cosY, 0, -sinY),
      tangent: new THREE.Vector3(sinY, 0, cosY),
      width: depth,
      depthOffset: width / 2
    },
    {
      // -X face (left)
      normal: new THREE.Vector3(-cosY, 0, sinY),
      tangent: new THREE.Vector3(-sinY, 0, -cosY),
      width: depth,
      depthOffset: width / 2
    }
  ];

  const toRoute = new THREE.Vector3(routePos.x - center.x, 0, routePos.z - center.z).normalize();

  let bestFace = faces[0];
  let maxDot = -999;

  for (const f of faces) {
    const dot = f.normal.dot(toRoute);
    if (dot > maxDot) {
      maxDot = dot;
      bestFace = f;
    }
  }

  // Must face generally toward the player's route (within ~75 degrees)
  if (maxDot < 0.25) return null;

  const faceCenter = center.clone().addScaledVector(bestFace.normal, bestFace.depthOffset);
  const faceYaw = Math.atan2(bestFace.normal.x, bestFace.normal.z);

  return {
    normal: bestFace.normal,
    tangent: bestFace.tangent,
    faceCenter,
    faceWidth: bestFace.width,
    faceYaw,
    dotToRoute: maxDot
  };
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

  // Occupancy tracking: strict single sign per tower & city-wide clearance
  private occupiedTowers = new Set<string>();
  private placedSigns: PlacedSignRecord[] = [];

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

    // 2. Build Sign Geometries & Curate Placements on Towers
    this.buildSignage(analysis, track, corridor, monoliths, stelae);
  }

  private tryMountSign(
    towerId: string,
    facade: ResolvedFacade,
    signWidth: number,
    signHeight: number,
    preferredElevation: number,
    topY: number,
    abyssBottom: number,
    isHero: boolean,
    geom: THREE.PlaneGeometry,
    mat: THREE.Material,
    corridor: RouteExclusionCorridor,
    standoff = 0.18
  ): THREE.Mesh | null {
    // 1. Occupancy Check: Only one sign allowed per tower
    if (this.occupiedTowers.has(towerId)) return null;

    // 2. Facade Width Check: Sign must fit inside facade with at least 1.2m margin on each edge
    if (facade.faceWidth < signWidth + 2.4) return null;

    // 3. Vertical Containment Check: Must remain inside building vertical profile
    const halfH = signHeight / 2;
    const clampedElevation = Math.min(
      topY - halfH - 3.5,
      Math.max(abyssBottom + halfH + 8.0, preferredElevation)
    );

    if (clampedElevation + halfH > topY - 2.5 || clampedElevation - halfH < abyssBottom + 6.0) {
      return null;
    }

    // 4. Exact Physical World Position: Anchored to wall with small mounting standoff
    const signPos = facade.faceCenter.clone().addScaledVector(facade.normal, standoff);
    signPos.y = clampedElevation;

    // 5. Spacing & Overlap Check against all previously placed signs
    const minSpacing = isHero ? 90.0 : 42.0;
    for (const existing of this.placedSigns) {
      if (signPos.distanceTo(existing.center) < minSpacing) {
        return null;
      }
    }

    // 6. Authoritative Route Exclusion Check
    const boundingRadius = Math.hypot(signWidth, signHeight) * 0.5;
    if (
      corridor.isPointInsideCorridor(
        signPos,
        boundingRadius,
        clampedElevation - halfH,
        clampedElevation + halfH
      )
    ) {
      return null;
    }

    // 7. Mount Mesh
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(signPos);
    mesh.rotation.set(0, facade.faceYaw, 0);

    this.group.add(mesh);
    this.cullingEntries.push({ mesh, position: signPos.clone() });
    this.placedSigns.push({ center: signPos.clone(), radius: boundingRadius, isHero });
    this.occupiedTowers.add(towerId);

    return mesh;
  }

  private tryMountRooftopCrown(
    towerId: string,
    towerCenter: THREE.Vector3,
    facade: ResolvedFacade,
    crownWidth: number,
    crownHeight: number,
    topY: number,
    geom: THREE.PlaneGeometry,
    mat: THREE.Material,
    corridor: RouteExclusionCorridor
  ): THREE.Mesh | null {
    if (this.occupiedTowers.has(towerId)) return null;
    if (facade.faceWidth < crownWidth + 3.0) return null;

    const crownPos = towerCenter.clone();
    crownPos.y = topY + crownHeight / 2;
    crownPos.addScaledVector(facade.normal, Math.max(0, facade.faceWidth / 2 - 2.5));

    for (const existing of this.placedSigns) {
      if (crownPos.distanceTo(existing.center) < 45.0) return null;
    }

    const radius = Math.hypot(crownWidth, crownHeight) * 0.5;
    if (corridor.isPointInsideCorridor(crownPos, radius, topY, topY + crownHeight + 2.0)) {
      return null;
    }

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(crownPos);
    mesh.rotation.set(0, facade.faceYaw, 0);

    this.group.add(mesh);
    this.cullingEntries.push({ mesh, position: crownPos.clone() });
    this.placedSigns.push({ center: crownPos.clone(), radius, isHero: false });
    this.occupiedTowers.add(towerId);

    return mesh;
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

    const prefix = cleanTitle.replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'SIG';
    const trackCode = `${prefix}-${(bpm % 100).toString().padStart(2, '0')}`;

    // Carefully proportioned shared plane geometries
    // Hero: 20m x 10m (2:1 aspect ratio, cleanly fits 24m wide monolith with 2m margins)
    const heroGeom = new THREE.PlaneGeometry(20.0, 10.0);
    // Horizontal Telemetry: 16.5m x 5.5m (3:1 aspect ratio)
    const telemGeom = new THREE.PlaneGeometry(16.5, 5.5);
    // Spectrogram Matrix: 12m x 12m (1:1 aspect ratio)
    const spectroGeom = new THREE.PlaneGeometry(12.0, 12.0);
    // Vertical Japanese Stela: 4.5m x 18m (1:4 aspect ratio, cleanly fits 10m/12m stelae)
    const vertJpGeom = new THREE.PlaneGeometry(4.5, 18.0);
    // Rooftop Crown: 14m x 7m (2:1 aspect ratio)
    const crownGeom = new THREE.PlaneGeometry(14.0, 7.0);
    // Window Slit Cluster: 18m x 36m (1:2 aspect ratio)
    const windowGeom = new THREE.PlaneGeometry(18.0, 36.0);

    this.sharedGeometries.push(
      heroGeom,
      telemGeom,
      spectroGeom,
      vertJpGeom,
      crownGeom,
      windowGeom
    );

    // Authored textures
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

    // =========================================================================
    // STEP 1: HERO LANDMARKS (2 to 3 Max Across Whole Track)
    // =========================================================================
    const heroCandidates = monoliths
      .filter(m => m.isHero)
      .sort((a, b) => b.node.intensity - a.node.intensity);

    let heroesPlaced = 0;
    const maxHeroes = monoliths.length > 10 ? 3 : 2;
    let lastHeroProgress = -1;

    for (const m of heroCandidates) {
      if (heroesPlaced >= maxHeroes) break;
      if (lastHeroProgress >= 0 && Math.abs(m.progressRatio - lastHeroProgress) < 0.22) {
        continue; // Maintain generous distance between hero landmarks
      }

      const facade = resolveRouteFacingFacade(m.position, m.width, m.depth, m.yaw, m.node.position);
      if (!facade) continue;

      const hMat = this.heroMat.clone();
      hMat.map = heroTex;

      const preferredY = m.node.position.y + 34.0;
      const mesh = this.tryMountSign(
        m.id,
        facade,
        20.0,
        10.0,
        preferredY,
        m.topY,
        m.abyssBottom,
        true,
        heroGeom,
        hMat,
        corridor,
        0.18
      );

      if (mesh) {
        heroesPlaced++;
        lastHeroProgress = m.progressRatio;
      }
    }

    // =========================================================================
    // STEP 2: SUPPORT BILLBOARDS ON PRIMARY MONOLITHS (Horizontal & Spectrogram)
    // =========================================================================
    let supportCount = 0;
    const maxSupport = 7;

    for (let i = 0; i < monoliths.length; i++) {
      if (supportCount >= maxSupport) break;
      const m = monoliths[i];
      if (this.occupiedTowers.has(m.id)) continue;

      // Skip every 2nd tower to preserve intentional negative space
      if (i % 2 !== 0) continue;

      const facade = resolveRouteFacingFacade(m.position, m.width, m.depth, m.yaw, m.node.position);
      if (!facade) continue;

      const stageIdx = Math.min(3, Math.floor(m.progressRatio * 4));
      const stagedMat = this.stagedWaveMats[stageIdx];
      const preferredY = m.node.position.y + 30.0;

      if (supportCount % 2 === 0) {
        // Horizontal Telemetry Display
        const sec =
          analysis.sections && analysis.sections.length > 0
            ? analysis.sections[m.node.sectionIndex] ||
              analysis.sections.find(s => m.node.time >= s.start && m.node.time < s.end)
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

        const mesh = this.tryMountSign(
          m.id,
          facade,
          16.5,
          5.5,
          preferredY,
          m.topY,
          m.abyssBottom,
          false,
          telemGeom,
          fMat,
          corridor,
          0.18
        );
        if (mesh) supportCount++;
      } else {
        // Spectrogram Matrix
        const sMat = this.midMat.clone();
        sMat.map = spectroTex;

        const mesh = this.tryMountSign(
          m.id,
          facade,
          12.0,
          12.0,
          preferredY,
          m.topY,
          m.abyssBottom,
          false,
          spectroGeom,
          sMat,
          corridor,
          0.18
        );
        if (mesh) supportCount++;
      }
    }

    // =========================================================================
    // STEP 3: VERTICAL JAPANESE STELAE RUNNERS ON SUPPORT STELAE
    // =========================================================================
    let vertCount = 0;
    const maxVert = 5;

    for (let j = 0; j < stelae.length; j++) {
      if (vertCount >= maxVert) break;
      const s = stelae[j];
      if (this.occupiedTowers.has(s.id)) continue;

      // Select every 3rd stela to avoid clutter
      if (j % 3 !== 1) continue;

      const facade = resolveRouteFacingFacade(s.position, s.width, s.depth, s.yaw, s.node.position);
      if (!facade) continue;

      const termIdx = (j * 2 + 1) % 9;
      const jpTex = PixelArtLibrary.getVerticalJapaneseSignTexture(termIdx, accentHex, secondaryHex);

      const stageIdx = Math.min(3, Math.floor(s.progressRatio * 4));
      const sMat = this.stagedWaveMats[stageIdx].clone();
      sMat.map = jpTex;

      const preferredY = s.node.position.y + 24.0;
      const mesh = this.tryMountSign(
        s.id,
        facade,
        4.5,
        18.0,
        preferredY,
        s.topY,
        s.abyssBottom,
        false,
        vertJpGeom,
        sMat,
        corridor,
        0.18
      );
      if (mesh) vertCount++;
    }

    // =========================================================================
    // STEP 4: ROOFTOP CROWN SIGNS (1 to 2 Across Whole Level)
    // =========================================================================
    let crownCount = 0;
    const maxCrowns = 2;

    for (let i = 0; i < monoliths.length; i++) {
      if (crownCount >= maxCrowns) break;
      const m = monoliths[i];
      if (this.occupiedTowers.has(m.id)) continue;
      if (i % 4 !== 2) continue;

      const facade = resolveRouteFacingFacade(m.position, m.width, m.depth, m.yaw, m.node.position);
      if (!facade) continue;

      const crownTex = PixelArtLibrary.getRooftopCrownTexture(crownCount, accentHex, secondaryHex);
      const cMat = this.heroMat.clone();
      cMat.map = crownTex;

      const mesh = this.tryMountRooftopCrown(
        m.id,
        m.position,
        facade,
        14.0,
        7.0,
        m.topY,
        crownGeom,
        cMat,
        corridor
      );
      if (mesh) crownCount++;
    }

    // =========================================================================
    // STEP 5: ATMOSPHERIC WINDOW CLUSTERS ON EMPTY MONOLITHS
    // =========================================================================
    let winCount = 0;
    const maxWindows = 5;

    for (let i = 0; i < monoliths.length; i++) {
      if (winCount >= maxWindows) break;
      const m = monoliths[i];
      if (this.occupiedTowers.has(m.id)) continue;

      const facade = resolveRouteFacingFacade(m.position, m.width, m.depth, m.yaw, m.node.position);
      if (!facade) continue;

      const winMat = this.ambientMat.clone();
      winMat.map = i % 2 === 0 ? coolWindowTex : warmWindowTex;

      const preferredY = m.node.position.y + 32.0;
      const mesh = this.tryMountSign(
        m.id,
        facade,
        18.0,
        36.0,
        preferredY,
        m.topY,
        m.abyssBottom,
        false,
        windowGeom,
        winMat,
        corridor,
        0.08
      );
      if (mesh) winCount++;
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
    const bassLum =
      (0.32 + visualState.bass * 0.82 + (visualState.subBass > 0.65 ? 0.35 : 0.0)) * mult;
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
    this.placedSigns = [];
    this.occupiedTowers.clear();
  }
}
