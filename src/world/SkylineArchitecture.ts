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
import { MusicVisualState } from './MusicVisualController';
import { PixelTextureGenerator } from './PixelTextureGenerator';
import { PixelArtLibrary } from './PixelArtLibrary';
import { RouteExclusionCorridor } from './RouteExclusionCorridor';

export class SkylineArchitecture {
  public group: THREE.Group;
  private primaryMonoliths: THREE.InstancedMesh | null = null;
  private supportStelae: THREE.InstancedMesh | null = null;
  private backgroundRidges: THREE.InstancedMesh | null = null;

  private towerMaterials: THREE.MeshStandardMaterial[] = [];

  constructor(scene: THREE.Scene, analysis: TrackAnalysis, track: GeneratedTrack) {
    this.group = new THREE.Group();
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

    const allCorridorNodes = track.optionalRamps ? [...track.route, ...track.optionalRamps] : track.route;
    const corridor = new RouteExclusionCorridor(allCorridorNodes);

    // Calculate global route minimum Y so every skyscraper extends far below the lowest route elevation
    let minWorldY = 0;
    for (const n of allCorridorNodes) {
      if (n.position.y < minWorldY) minWorldY = n.position.y;
    }

    // Billboard materials for skyscraper facades
    const billboardMats = [
      new THREE.MeshBasicMaterial({
        map: PixelArtLibrary.getSignalBillboardTexture(palette.hex, '#ff00aa'),
        side: THREE.DoubleSide
      }),
      new THREE.MeshBasicMaterial({
        map: PixelArtLibrary.getHazardBillboardTexture('#ffb700'),
        side: THREE.DoubleSide
      }),
      new THREE.MeshBasicMaterial({
        map: PixelArtLibrary.getSpectrogramBillboardTexture(palette.hex),
        side: THREE.DoubleSide
      })
    ];

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

        // 1. Primary Landmark Monolith (155m - 185m away, plunging 340m-600m into deep abyss)
        const pDist = 155.0 + ((i * 19) % 30);
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

        if (!corridor.isPointInsideCorridor(dummy.position, 22.0, pAbyssBottom, pTopY)) {
          this.primaryMonoliths.setMatrixAt(pIdx++, dummy.matrix);

          // Mount authored pixel billboard on every 2nd skyscraper facade facing toward route
          if (pIdx % 2 === 0) {
            const bMat = billboardMats[(pIdx / 2) % billboardMats.length];
            const bMesh = new THREE.Mesh(new THREE.PlaneGeometry(22.0, 11.0), bMat);
            const facadeOffset = -side * 12.2;
            bMesh.position.set(px + rightX * facadeOffset, node.position.y + 42.0, pz + rightZ * facadeOffset);
            bMesh.rotation.y = node.yaw + (side > 0 ? -Math.PI * 0.5 : Math.PI * 0.5);
            this.group.add(bMesh);
          }
        }

        // 2. Secondary Support Stelae (Framing primary monolith, plunging 320m-560m into deep abyss)
        for (let st = -1; st <= 1; st += 2) {
          if (sIdx >= maxInstances * 2) break;
          const sDist = pDist - 28.0 + st * 14.0;
          const sx = node.position.x + rightX * side * sDist + fwdX * (st * 32.0);
          const sz = node.position.z + rightZ * side * sDist + fwdZ * (st * 32.0);
          const sTopY = node.position.y + Math.max(50.0, 55.0 + frame.mid * 80.0);
          const sPlunge = 320.0 + ((i * 29 + st * 71) % 240.0); // 320m - 560m varying plunge
          const sAbyssBottom = minWorldY - sPlunge;
          const sHeight = sTopY - sAbyssBottom;
          const sy = sAbyssBottom + sHeight * 0.5;

          dummy.position.set(sx, sy, sz);
          dummy.scale.set(1.0, sHeight, 1.0);
          dummy.rotation.set(0.04 * st, node.yaw + 0.1 * st, 0.05 * side);
          dummy.updateMatrix();

          if (!corridor.isPointInsideCorridor(dummy.position, 16.0, sAbyssBottom, sTopY)) {
            this.supportStelae.setMatrixAt(sIdx++, dummy.matrix);
          }
        }

        // 3. Distant Background Ridge (260m away in far atmosphere, plunging 360m-600m into abyss)
        if (rIdx < maxInstances) {
          const rDist = 260.0 + ((i * 23) % 45);
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

          if (!corridor.isPointInsideCorridor(dummy.position, 42.0, rAbyssBottom, rTopY)) {
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

    this.group.add(this.primaryMonoliths);
    this.group.add(this.supportStelae);
    this.group.add(this.backgroundRidges);
  }

  public update(visualState: MusicVisualState, _dt = 0): void {
    const baseEmissive = 0.03 + visualState.bass * 0.12 + visualState.dropImpact * 0.35;
    for (const mat of this.towerMaterials) {
      mat.emissiveIntensity = Math.min(1.0, baseEmissive * visualState.reactivityMultiplier);
    }
  }

  public dispose(): void {
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
