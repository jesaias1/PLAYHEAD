/**
 * Distant Audio Skyline & Future Music Foreshadowing for PLAYHEAD
 * Monumental brutalist towers, frequency pillars, and future energy silhouettes
 * generated outside the playable route.
 */

import * as THREE from 'three';
import { TrackAnalysis } from '../audio/AudioFeatures';
import { GeneratedTrack } from '../generation/GenerationTypes';
import { MusicVisualState } from './MusicVisualController';

export class SkylineArchitecture {
  public group: THREE.Group;
  private bassTowers: THREE.InstancedMesh | null = null;
  private midPillars: THREE.InstancedMesh | null = null;
  private highNeedles: THREE.InstancedMesh | null = null;

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

    // 1. Materials (70-85% Dark Brutalist Mass, low base emissive)
    const bassTowerMat = new THREE.MeshStandardMaterial({
      color: 0x090b10,
      roughness: 0.92,
      metalness: 0.15,
      emissive: accentCol,
      emissiveIntensity: 0.02
    });
    this.towerMaterials.push(bassTowerMat);

    const midPillarMat = new THREE.MeshStandardMaterial({
      color: 0x0c0f16,
      roughness: 0.85,
      metalness: 0.25,
      emissive: accentCol,
      emissiveIntensity: 0.02
    });
    this.towerMaterials.push(midPillarMat);

    const needleMat = new THREE.MeshStandardMaterial({
      color: 0x10141e,
      roughness: 0.35,
      metalness: 0.8,
      emissive: accentCol,
      emissiveIntensity: 0.05
    });
    this.towerMaterials.push(needleMat);

    // 2. Geometry: Shared Box geometries
    const bassGeom = new THREE.BoxGeometry(18, 1, 18);
    const midGeom = new THREE.BoxGeometry(8, 1, 8);
    const highGeom = new THREE.BoxGeometry(2.5, 1, 2.5);

    // Count instances along route
    const step = 2; // Every 2 nodes
    const count = Math.min(120, Math.floor(route.length / step));

    this.bassTowers = new THREE.InstancedMesh(bassGeom, bassTowerMat, count * 2);
    this.midPillars = new THREE.InstancedMesh(midGeom, midPillarMat, count * 2);
    this.highNeedles = new THREE.InstancedMesh(highGeom, needleMat, count * 2);

    const dummy = new THREE.Object3D();
    let bIdx = 0;
    let mIdx = 0;
    let hIdx = 0;

    for (let i = 0; i < route.length - 1 && bIdx < count * 2; i += step) {
      const node = route[i];
      const timeRatio = Math.min(1, Math.max(0, node.time / analysis.duration));
      const frameIdx = Math.floor(timeRatio * (analysis.frames.length - 1));
      const frame = analysis.frames[frameIdx] || { rms: 0.3, bass: 0.3, mid: 0.3, high: 0.3 };

      // Normal perpendicular to route direction
      const fwdX = Math.sin(node.yaw);
      const fwdZ = Math.cos(node.yaw);
      const rightX = fwdZ;
      const rightZ = -fwdX;

      // Bass Towers (Placed 85m to 120m left & right)
      for (const side of [-1, 1]) {
        const offsetDist = 95.0 + ((i * 17) % 30);
        const px = node.position.x + rightX * side * offsetDist;
        const pz = node.position.z + rightZ * side * offsetDist;
        const height = Math.max(25.0, 30.0 + frame.bass * 140.0);
        const py = node.position.y - 15.0 + height * 0.5;

        dummy.position.set(px, py, pz);
        dummy.scale.set(1.0, height, 1.0);
        dummy.rotation.set(0, node.yaw + ((i % 3) * 0.1), 0);
        dummy.updateMatrix();

        this.bassTowers.setMatrixAt(bIdx++, dummy.matrix);
      }

      // Mid Pillars (Placed 55m to 75m left & right)
      for (const side of [-1, 1]) {
        const offsetDist = 65.0 + ((i * 13) % 20);
        const px = node.position.x + rightX * side * offsetDist;
        const pz = node.position.z + rightZ * side * offsetDist;
        const height = Math.max(15.0, 20.0 + frame.mid * 80.0);
        const py = node.position.y - 10.0 + height * 0.5;

        dummy.position.set(px, py, pz);
        dummy.scale.set(1.0, height, 1.0);
        dummy.rotation.set(0, node.yaw, 0);
        dummy.updateMatrix();

        this.midPillars.setMatrixAt(mIdx++, dummy.matrix);
      }

      // High Needles (Placed 45m to 60m left & right)
      for (const side of [-1, 1]) {
        const offsetDist = 48.0 + ((i * 7) % 15);
        const px = node.position.x + rightX * side * offsetDist;
        const pz = node.position.z + rightZ * side * offsetDist;
        const height = Math.max(20.0, 30.0 + frame.high * 110.0);
        const py = node.position.y + height * 0.5;

        dummy.position.set(px, py, pz);
        dummy.scale.set(1.0, height, 1.0);
        dummy.rotation.set(0, node.yaw, 0);
        dummy.updateMatrix();

        this.highNeedles.setMatrixAt(hIdx++, dummy.matrix);
      }
    }

    this.bassTowers.instanceMatrix.needsUpdate = true;
    this.midPillars.instanceMatrix.needsUpdate = true;
    this.highNeedles.instanceMatrix.needsUpdate = true;

    this.group.add(this.bassTowers);
    this.group.add(this.midPillars);
    this.group.add(this.highNeedles);
  }

  public update(visualState: MusicVisualState): void {
    const reactMult = visualState.reactivityMultiplier;

    // Bass towers pulse with sub-bass and drop impact
    if (this.towerMaterials[0]) {
      const baseEmissive = (0.02 + visualState.subBass * 0.35 + visualState.dropImpact * 0.5) * reactMult;
      this.towerMaterials[0].emissiveIntensity = baseEmissive;
      this.towerMaterials[0].emissive.copy(visualState.bassColor);
    }

    // Mid pillars pulse with mids and overall music energy
    if (this.towerMaterials[1]) {
      const midEmissive = (0.02 + visualState.mid * 0.3 + visualState.energy * 0.2) * reactMult;
      this.towerMaterials[1].emissiveIntensity = midEmissive;
      this.towerMaterials[1].emissive.copy(visualState.midColor);
    }

    // High needles pulse with high frequencies and flux shimmer
    if (this.towerMaterials[2]) {
      const needleEmissive = (0.05 + visualState.high * 0.5 + visualState.flux * 0.4 + visualState.dropImpact * 0.7) * reactMult;
      this.towerMaterials[2].emissiveIntensity = needleEmissive;
      this.towerMaterials[2].emissive.copy(visualState.highColor);
    }
  }

  public dispose(): void {
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }

    if (this.bassTowers) {
      this.bassTowers.geometry.dispose();
      this.bassTowers.dispose();
    }
    if (this.midPillars) {
      this.midPillars.geometry.dispose();
      this.midPillars.dispose();
    }
    if (this.highNeedles) {
      this.highNeedles.geometry.dispose();
      this.highNeedles.dispose();
    }

    for (const mat of this.towerMaterials) {
      mat.dispose();
    }
    this.towerMaterials = [];
    this.group.clear();
  }
}
