/**
 * Distant Audio Skyline & Monumental Composition for PLAYHEAD SIGNAL RENDER
 * "Cosmic Pixel Brutalism" structured horizon architecture.
 *
 * Replaces repetitive box grids with composed architectural clusters:
 * Primary Landmark Monolith + Secondary Support Stelae + Background Negative Space.
 */

import * as THREE from 'three';
import { TrackAnalysis } from '../audio/AudioFeatures';
import { GeneratedTrack } from '../generation/GenerationTypes';
import { MusicVisualState, resolveChannels } from './MusicVisualController';
import { PixelTextureGenerator } from './PixelTextureGenerator';
import { RouteExclusionCorridor } from './RouteExclusionCorridor';
import { CitySignageSystem, MonolithAnchor, StelaAnchor } from './CitySignageSystem';
import { tagWorldRole } from './WorldRoles';

/**
 * Patches a standard material with a world-Y "signal band" sweep.
 *
 * All skyline tiers share the same sweep phase so the city reads as one giant
 * machine processing sound, while each tier owns its own gain/sharpness so the
 * tiers do not all light up together.
 */
function patchSignalBands(
  material: THREE.MeshStandardMaterial,
  uniforms: Record<string, THREE.IUniform>
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSignalPhase = uniforms.uSignalPhase;
    shader.uniforms.uSignalGain = uniforms.uSignalGain;
    shader.uniforms.uSignalSegCount = uniforms.uSignalSegCount;
    shader.uniforms.uSignalSegSharp = uniforms.uSignalSegSharp;
    shader.uniforms.uSignalBandScale = uniforms.uSignalBandScale;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vSignalWorldY;'
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  vSignalWorldY = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).y;
#else
  vSignalWorldY = ( modelMatrix * vec4( transformed, 1.0 ) ).y;
#endif`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vSignalWorldY;
uniform float uSignalPhase;
uniform float uSignalGain;
uniform float uSignalSegCount;
uniform float uSignalSegSharp;
uniform float uSignalBandScale;`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float signalCoord = vSignalWorldY * uSignalBandScale;
  float signalSeg = fract( signalCoord * uSignalSegCount - uSignalPhase );
  float signalPulse = pow( 1.0 - abs( signalSeg * 2.0 - 1.0 ), uSignalSegSharp );
  totalEmissiveRadiance += diffuseColor.rgb * signalPulse * uSignalGain;
}`
      );
  };
  material.needsUpdate = true;
}

export class SkylineArchitecture {
  public group: THREE.Group;
  private primaryMonoliths: THREE.InstancedMesh | null = null;
  private supportStelae: THREE.InstancedMesh | null = null;
  private backgroundRidges: THREE.InstancedMesh | null = null;

  private towerMaterials: THREE.MeshStandardMaterial[] = [];
  public signageSystem: CitySignageSystem | null = null;

  // --- Audio-reactive signal bands -----------------------------------------
  // One shared sweep phase (so the whole city scans as a single machine) plus
  // per-tier gains, patched into the three tower materials. This costs three
  // uniform writes per frame and zero extra draw calls.
  private scanPhaseUniform: THREE.IUniform = { value: 0 };
  private tierSignalUniforms: Array<Record<string, THREE.IUniform>> = [];

  // Authored per-instance transforms, retained so distance culling can restore
  // them exactly (never regenerating geometry or changing silhouettes).
  private primaryBase: THREE.Matrix4[] = [];
  private supportBase: THREE.Matrix4[] = [];
  private ridgeBase: THREE.Matrix4[] = [];
  private hiddenFlags: Map<THREE.InstancedMesh, boolean[]> = new Map();
  private cullingActive = false;

  constructor(scene: THREE.Scene, analysis: TrackAnalysis, track: GeneratedTrack) {
    this.group = new THREE.Group();
    // World role: declared explicitly so the final world safety pass can
    // never mistake this geometry for gameplay (or miss it entirely).
    tagWorldRole(this.group, 'DECORATION', 'SkylineArchitecture');
    this.build(analysis, track);
    scene.add(this.group);
  }

  private build(analysis: TrackAnalysis, track: GeneratedTrack): void {
    const route = track.route;
    if (route.length < 5) return;

    const palette = analysis.visualAccent;
    const accentCol = new THREE.Color(palette.hex);

    // Authored pixel textures
    const basaltTex = PixelTextureGenerator.getBlackBasaltTexture();
    const concreteTex = PixelTextureGenerator.getDarkConcreteTexture();

    // 1. Materials (Dark Basalt & Brutalist Monolithic Concrete)
    const primaryMat = new THREE.MeshStandardMaterial({
      color: 0x05070a,
      roughness: 0.94,
      metalness: 0.12,
      map: basaltTex,
      emissive: accentCol,
      emissiveIntensity: 0.03
    });
    this.towerMaterials.push(primaryMat);

    const stelaMat = new THREE.MeshStandardMaterial({
      color: 0x080c14,
      roughness: 0.88,
      metalness: 0.2,
      map: concreteTex,
      emissive: accentCol,
      emissiveIntensity: 0.04
    });
    this.towerMaterials.push(stelaMat);

    const ridgeMat = new THREE.MeshStandardMaterial({
      color: 0x030406,
      roughness: 0.96,
      metalness: 0.08,
      emissive: accentCol,
      emissiveIntensity: 0.01
    });
    this.towerMaterials.push(ridgeMat);

    // 1b. Patch the three tiers with the shared signal-band sweep. Tier 0
    // (primary monoliths) gets the sharpest, brightest bands; the distant
    // ridge tier gets broad, faint ones.
    const bandConfigs = [
      { gain: 0.0, segCount: 22.0, segSharp: 3.4, bandScale: 0.055 },
      { gain: 0.0, segCount: 15.0, segSharp: 2.6, bandScale: 0.040 },
      { gain: 0.0, segCount: 9.0, segSharp: 1.9, bandScale: 0.028 }
    ];
    this.tierSignalUniforms = bandConfigs.map((cfg) => {
      const uniforms: Record<string, THREE.IUniform> = {
        uSignalPhase: this.scanPhaseUniform,
        uSignalGain: { value: cfg.gain },
        uSignalSegCount: { value: cfg.segCount },
        uSignalSegSharp: { value: cfg.segSharp },
        uSignalBandScale: { value: cfg.bandScale }
      };
      return uniforms;
    });
    for (let t = 0; t < this.towerMaterials.length && t < this.tierSignalUniforms.length; t++) {
      patchSignalBands(this.towerMaterials[t], this.tierSignalUniforms[t]);
    }

    // 2. Geometries
    // Primary Colossal Monolith
    const monolithGeom = new THREE.BoxGeometry(24, 1, 24);
    // Secondary Support Stela
    const stelaGeom = new THREE.BoxGeometry(10, 1, 12);
    // Background Distant Ridge Slab
    const ridgeGeom = new THREE.BoxGeometry(70, 1, 18);

    // Controlled cluster spacing: every 6 nodes to preserve generous negative space
    const step = 6;
    const clusterCount = Math.floor(route.length / step);
    const maxInstances = Math.min(36, clusterCount) * 2;

    this.primaryMonoliths = new THREE.InstancedMesh(monolithGeom, primaryMat, maxInstances);
    this.supportStelae = new THREE.InstancedMesh(stelaGeom, stelaMat, maxInstances * 2);
    this.backgroundRidges = new THREE.InstancedMesh(ridgeGeom, ridgeMat, maxInstances);

    const dummy = new THREE.Object3D();
    let pIdx = 0;
    let sIdx = 0;
    let rIdx = 0;

    const allCorridorNodes = RouteExclusionCorridor.collectGameplayNodes(track);
    const corridor = new RouteExclusionCorridor(allCorridorNodes);

    // Calculate global route minimum Y so every skyscraper extends far below the lowest route elevation
    let minWorldY = 0;
    for (const n of allCorridorNodes) {
      if (n.position.y < minWorldY) minWorldY = n.position.y;
    }

    const monolithAnchors: MonolithAnchor[] = [];
    const stelaeAnchors: StelaAnchor[] = [];

    for (let i = 2; i < route.length - 2 && pIdx < maxInstances; i += step) {
      const node = route[i];
      const timeRatio = Math.min(1, Math.max(0, node.time / analysis.duration));
      const frameIdx = Math.floor(timeRatio * (analysis.frames.length - 1));
      const frame = analysis.frames[frameIdx] || { rms: 0.3, bass: 0.3, mid: 0.3, high: 0.3 };

      const fwdX = Math.sin(node.yaw);
      const fwdZ = Math.cos(node.yaw);
      const rightX = fwdZ;
      const rightZ = -fwdX;

      // Place architectural clusters left or right alternating
      for (const side of [-1, 1]) {
        // Skip some sides to maintain asymmetric negative space
        if (((i / step) % 3 === 0) && side === 1) continue;

        // 1. Primary Landmark Monolith (175m - 210m away, plunging 340m-600m into deep abyss)
        const pDist = 175.0 + ((i * 19) % 35);
        const px = node.position.x + rightX * side * pDist;
        const pz = node.position.z + rightZ * side * pDist;
        const pTopY = node.position.y + Math.max(90.0, 100.0 + frame.bass * 160.0);
        const pPlunge = 340.0 + ((i * 37 + (side > 0 ? 113 : 47)) % 260.0); // 340m - 600m varying plunge
        const pAbyssBottom = minWorldY - pPlunge;
        const pHeight = pTopY - pAbyssBottom;
        const py = pAbyssBottom + pHeight * 0.5;

        dummy.position.set(px, py, pz);
        dummy.scale.set(1.0, pHeight, 1.0);
        dummy.rotation.set(0, node.yaw + (side > 0 ? 0.15 : -0.15), 0);
        dummy.updateMatrix();

        // Authoritative full 3D rotated bounding-box validation
        const mLocalBox = new THREE.Box3(
          new THREE.Vector3(-12.0, -0.5, -12.0),
          new THREE.Vector3(12.0, 0.5, 12.0)
        );
        const mCandidateBox = mLocalBox.applyMatrix4(dummy.matrix);

        if (!corridor.isBoxInsideCorridor(mCandidateBox)) {
          this.primaryMonoliths.setMatrixAt(pIdx++, dummy.matrix);

          monolithAnchors.push({
            id: `monolith_${i}_${side}`,
            position: dummy.position.clone(),
            width: 24.0,
            depth: 24.0,
            height: pHeight,
            topY: pTopY,
            abyssBottom: pAbyssBottom,
            yaw: node.yaw + (side > 0 ? 0.15 : -0.15),
            side,
            fwdX,
            fwdZ,
            rightX,
            rightZ,
            node,
            nodeIndex: i,
            progressRatio: i / (route.length - 1),
            isHero:
              (analysis.sections &&
                analysis.sections.some(
                  s => s.theme === 'DROP' && node.time >= s.start && node.time <= s.end
                )) ||
              frame.bass > 0.65 ||
              (i / step) % 4 === 1
          });
        }

        // 2. Secondary Support Stelae (Framing primary monolith, staying 160m-225m away)
        for (let st = -1; st <= 1; st += 2) {
          if (sIdx >= maxInstances * 2) break;
          const sDist = pDist + (st > 0 ? 16.0 : -12.0);
          const sx = node.position.x + rightX * side * sDist + fwdX * (st * 24.0);
          const sz = node.position.z + rightZ * side * sDist + fwdZ * (st * 24.0);
          const sTopY = node.position.y + Math.max(50.0, 55.0 + frame.mid * 80.0);
          const sPlunge = 320.0 + ((i * 29 + st * 71) % 240.0); // 320m - 560m varying plunge
          const sAbyssBottom = minWorldY - sPlunge;
          const sHeight = sTopY - sAbyssBottom;
          const sy = sAbyssBottom + sHeight * 0.5;

          dummy.position.set(sx, sy, sz);
          dummy.scale.set(1.0, sHeight, 1.0);
          dummy.rotation.set(0.04 * st, node.yaw + 0.1 * st, 0.05 * side);
          dummy.updateMatrix();

          const sLocalBox = new THREE.Box3(
            new THREE.Vector3(-5.0, -0.5, -6.0),
            new THREE.Vector3(5.0, 0.5, 6.0)
          );
          const sCandidateBox = sLocalBox.applyMatrix4(dummy.matrix);

          if (!corridor.isBoxInsideCorridor(sCandidateBox)) {
            this.supportStelae.setMatrixAt(sIdx++, dummy.matrix);

            stelaeAnchors.push({
              id: `stela_${i}_${side}_${st}`,
              position: dummy.position.clone(),
              width: 10.0,
              depth: 12.0,
              height: sHeight,
              topY: sTopY,
              abyssBottom: sAbyssBottom,
              yaw: node.yaw + 0.1 * st,
              side,
              fwdX,
              fwdZ,
              rightX,
              rightZ,
              node,
              progressRatio: i / (route.length - 1)
            });
          }
        }

        // 3. Distant Background Ridge (280m - 330m away in far atmosphere)
        if (rIdx < maxInstances) {
          const rDist = 280.0 + ((i * 23) % 50);
          const rx = node.position.x + rightX * side * rDist;
          const rz = node.position.z + rightZ * side * rDist;
          const rTopY = node.position.y + Math.max(55.0, 60.0 + frame.bass * 70.0);
          const rPlunge = 360.0 + ((i * 41) % 240.0); // 360m - 600m varying plunge
          const rAbyssBottom = minWorldY - rPlunge;
          const rHeight = rTopY - rAbyssBottom;
          const ry = rAbyssBottom + rHeight * 0.5;

          dummy.position.set(rx, ry, rz);
          dummy.scale.set(1.0, rHeight, 1.0);
          dummy.rotation.set(0, node.yaw + 0.3, 0);
          dummy.updateMatrix();

          const rLocalBox = new THREE.Box3(
            new THREE.Vector3(-35.0, -0.5, -9.0),
            new THREE.Vector3(35.0, 0.5, 9.0)
          );
          const rCandidateBox = rLocalBox.applyMatrix4(dummy.matrix);

          if (!corridor.isBoxInsideCorridor(rCandidateBox)) {
            this.backgroundRidges.setMatrixAt(rIdx++, dummy.matrix);
          }
        }
      }
    }

    this.primaryMonoliths.count = pIdx;
    this.supportStelae.count = sIdx;
    this.backgroundRidges.count = rIdx;

    this.primaryMonoliths.instanceMatrix.needsUpdate = true;
    this.supportStelae.instanceMatrix.needsUpdate = true;
    this.backgroundRidges.instanceMatrix.needsUpdate = true;

    // Retain authored transforms for distance culling.
    const capture = (mesh: THREE.InstancedMesh | null): THREE.Matrix4[] => {
      if (!mesh) return [];
      const out: THREE.Matrix4[] = [];
      const tmp = new THREE.Matrix4();
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, tmp);
        out.push(tmp.clone());
      }
      this.hiddenFlags.set(mesh, new Array(mesh.count).fill(false));
      return out;
    };
    this.primaryBase = capture(this.primaryMonoliths);
    this.supportBase = capture(this.supportStelae);
    this.ridgeBase = capture(this.backgroundRidges);

    this.group.add(this.primaryMonoliths);
    this.group.add(this.supportStelae);
    this.group.add(this.backgroundRidges);

    // 4. Mount Audio-Reactive City Signage & Facade Displays
    this.signageSystem = new CitySignageSystem(
      analysis,
      track,
      corridor,
      monolithAnchors,
      stelaeAnchors
    );
    this.group.add(this.signageSystem.group);
  }

  public update(visualState: MusicVisualState, dt = 0, reduceMotion = false): void {
    const react = visualState.reactivityMultiplier;
    const energy = visualState.energy;
    const ch = resolveChannels(visualState);
    const slot = ch.slot;

    // REACTIVITY HIERARCHY — the city answers the music with a clear order AND
    // a clear delay:
    //   PRIMARY   nearby monoliths:  first to answer (0-80 ms drop window)
    //   SECONDARY support stelae:    answers next (150-350 ms)
    //   TERTIARY  distant ridges:    answers last (250-600 ms)
    //
    // The transient answer is scheduled across the tiers by the music-driven
    // channel slot, so a beat does not light every layer at once. That layered
    // distribution is what makes the city read as separate parts of the music
    // rather than one brightness scalar.
    const primaryOnset = ch.transient * (slot % 3 === 0 ? 1.0 : 0.3);
    const secondaryOnset = ch.transient * (slot % 3 === 1 ? 1.0 : 0.26);
    const tertiaryOnset = ch.transient * (slot % 3 === 2 ? 1.0 : 0.18);

    // Every layer keeps a non-zero baseline so the skyline always breathes,
    // but the baselines stay LOW so a drop has headroom to be obviously bigger.
    const primary =
      (0.10 + energy * 0.14 + ch.bassMass * 0.44 + primaryOnset * 0.58 + ch.dropPrimary * 1.15) * react;
    const secondary =
      (0.06 + energy * 0.10 + ch.bassMass * 0.26 + secondaryOnset * 0.34 + ch.dropSecondary * 0.72) * react;
    const tertiary =
      (0.03 + energy * 0.06 + ch.bassMass * 0.14 + tertiaryOnset * 0.22 + ch.dropTertiary * 0.40) * react;

    if (this.towerMaterials[0]) {
      this.towerMaterials[0].emissiveIntensity = Math.min(1.05, primary);
    }
    if (this.towerMaterials[1]) {
      this.towerMaterials[1].emissiveIntensity = Math.min(0.78, secondary);
    }
    if (this.towerMaterials[2]) {
      this.towerMaterials[2].emissiveIntensity = Math.min(0.52, tertiary);
    }

    // Signal band sweep: one shared phase, per-tier gain. Reduced motion slows
    // the sweep right down but keeps the luminance response.
    const motionScale = reduceMotion ? 0.3 : 1.0;
    this.scanPhaseUniform.value = ch.scanPhase * motionScale;
    if (this.tierSignalUniforms.length >= 3) {
      this.tierSignalUniforms[0].uSignalGain.value =
        Math.min(0.9, (0.06 + ch.bassMass * 0.5 + primaryOnset * 0.6 + ch.dropPrimary * 0.9) * react);
      this.tierSignalUniforms[1].uSignalGain.value =
        Math.min(0.6, (0.03 + ch.bassMass * 0.3 + secondaryOnset * 0.4 + ch.dropSecondary * 0.6) * react);
      this.tierSignalUniforms[2].uSignalGain.value =
        Math.min(0.35, (0.02 + ch.bassMass * 0.16 + tertiaryOnset * 0.24 + ch.dropTertiary * 0.4) * react);
    }

    if (this.signageSystem) {
      this.signageSystem.update(visualState, dt);
    }
  }

   /**
   * Refreshes the authored transform baseline after the authoritative world-space
   * RouteExclusionCorridor validation pass has run. This guarantees distance culling
   * and instance restoration never resurrect rejected or zeroed-out instances.
   */
  public refreshAuthoredTransformsAfterValidation(): void {
    const refresh = (mesh: THREE.InstancedMesh | null): THREE.Matrix4[] => {
      if (!mesh) return [];
      const out: THREE.Matrix4[] = [];
      const tmp = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, tmp);
        pos.setFromMatrixPosition(tmp);
        // If an instance was rejected/zeroed by RouteExclusionCorridor, keep it permanently as zeroMatrix
        if (pos.y < -50000 || tmp.elements[0] === 0) {
          const zero = new THREE.Matrix4().makeScale(0, 0, 0);
          zero.setPosition(0, -99999, 0);
          out.push(zero);
        } else {
          out.push(tmp.clone());
        }
      }
      return out;
    };
    this.primaryBase = refresh(this.primaryMonoliths);
    this.supportBase = refresh(this.supportStelae);
    this.ridgeBase = refresh(this.backgroundRidges);
    if (this.primaryMonoliths) this.hiddenFlags.set(this.primaryMonoliths, new Array(this.primaryMonoliths.count).fill(false));
    if (this.supportStelae) this.hiddenFlags.set(this.supportStelae, new Array(this.supportStelae.count).fill(false));
    if (this.backgroundRidges) this.hiddenFlags.set(this.backgroundRidges, new Array(this.backgroundRidges.count).fill(false));
  }

  /**
   * Distance-based visibility for purely decorative skyline clusters.
   *
   * These sit 155-260m+ out and plunge hundreds of metres, so at long range
   * they are a large amount of fill for very little on-screen contribution.
   * Culling individual instances (rather than a whole layer) keeps the
   * silhouette continuous, and because the cutoff is generous and gradual there
   * is no popping near the player.
   *
   * `maxDistance <= 0` disables culling entirely (HIGH / ULTRA).
   */
  /**
   * DEV diagnostics: how many skyline instances are currently drawn vs total.
   * Cheap (reads the cached visibility flags).
   */
  public getVisibleCounts(): { visible: number; total: number } {
    let visible = 0;
    let total = 0;
    const meshes: Array<THREE.InstancedMesh | null> = [
      this.primaryMonoliths,
      this.supportStelae,
      this.backgroundRidges
    ];
    for (const mesh of meshes) {
      if (!mesh) continue;
      total += mesh.count;
      const flags = this.hiddenFlags.get(mesh);
      for (let i = 0; i < mesh.count; i++) {
        if (!flags || !flags[i]) visible++;
      }
    }
    return { visible, total };
  }

  /**
   * Distance-based visibility for purely decorative skyline clusters.
   *
   * `maxDistance <= 0` disables culling entirely (HIGH / ULTRA).
   */
  public applyDistanceCulling(cameraPos: THREE.Vector3, maxDistance: number): void {
    if (this.signageSystem) {
      this.signageSystem.applyDistanceCulling(cameraPos, maxDistance);
    }

    if (maxDistance <= 0) {
      if (this.cullingActive) {
        this.restoreAllInstances();
        this.cullingActive = false;
      }
      return;
    }

    this.cullingActive = true;

    const targets: Array<{ mesh: THREE.InstancedMesh; base: THREE.Matrix4[] }> = [
      { mesh: this.primaryMonoliths!, base: this.primaryBase },
      { mesh: this.supportStelae!, base: this.supportBase },
      { mesh: this.backgroundRidges!, base: this.ridgeBase }
    ];

    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    hidden.setPosition(0, -99999, 0);
    const pos = new THREE.Vector3();

    for (const { mesh, base } of targets) {
      if (!mesh) continue;
      let dirty = false;
      // Fade band: hide only clearly beyond the cutoff so nothing pops in.
      const cutoffSq = maxDistance * maxDistance;
      for (let i = 0; i < mesh.count; i++) {
        const m = base[i];
        if (!m) continue;
        pos.setFromMatrixPosition(m);
        // Permanently rejected instances stay zeroed
        if (pos.y < -50000 || m.elements[0] === 0) {
          mesh.setMatrixAt(i, hidden);
          continue;
        }

        const far = pos.distanceToSquared(cameraPos) > cutoffSq;
        const current = this.hiddenFlags.get(mesh)![i];
        if (current === far) continue;
        this.hiddenFlags.get(mesh)![i] = far;
        mesh.setMatrixAt(i, far ? hidden : m);
        dirty = true;
      }
      if (dirty) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Restores every instance to its authored transform. */
  private restoreAllInstances(): void {
    const pairs: Array<{ mesh: THREE.InstancedMesh | null; base: THREE.Matrix4[] }> = [
      { mesh: this.primaryMonoliths, base: this.primaryBase },
      { mesh: this.supportStelae, base: this.supportBase },
      { mesh: this.backgroundRidges, base: this.ridgeBase }
    ];
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    hidden.setPosition(0, -99999, 0);
    const pos = new THREE.Vector3();

    for (const { mesh, base } of pairs) {
      if (!mesh) continue;
      for (let i = 0; i < mesh.count; i++) {
        if (base[i]) {
          const m = base[i];
          pos.setFromMatrixPosition(m);
          if (pos.y < -50000 || m.elements[0] === 0) {
            mesh.setMatrixAt(i, hidden);
          } else {
            mesh.setMatrixAt(i, m);
          }
        }
      }
      const flags = this.hiddenFlags.get(mesh);
      if (flags) flags.fill(false);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  public dispose(): void {
    if (this.signageSystem) {
      this.signageSystem.dispose();
      this.signageSystem = null;
    }

    this.group.traverse(obj => {
      if (obj instanceof THREE.InstancedMesh || obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
  }
}
