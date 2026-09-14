/**
 * Major Drop Setpiece Generator for PLAYHEAD
 * Generates 5 deterministic architectural setpiece families around the primary buildup and drop:
 * 1. SPLIT_MONOLITH
 * 2. SPECTRAL_CATHEDRAL
 * 3. VOID_BRIDGE
 * 4. SIGNAL_GATE
 * 5. FRACTURE
 */

import * as THREE from 'three';
import { TrackAnalysis } from '../audio/AudioFeatures';
import { GeneratedTrack, RouteNode } from '../generation/GenerationTypes';
import { MusicVisualState } from './MusicVisualController';

export type DropSetpieceFamily = 'SPLIT_MONOLITH' | 'SPECTRAL_CATHEDRAL' | 'VOID_BRIDGE' | 'SIGNAL_GATE' | 'FRACTURE';

export class DropSetpiece {
  public group: THREE.Group;
  public family: DropSetpieceFamily;
  private dropNode: RouteNode | null = null;
  private materials: THREE.MeshStandardMaterial[] = [];
  private animatedElements: THREE.Object3D[] = [];

  constructor(scene: THREE.Scene, analysis: TrackAnalysis, track: GeneratedTrack) {
    this.group = new THREE.Group();

    // Deterministically pick family by seed
    const families: DropSetpieceFamily[] = [
      'SPLIT_MONOLITH',
      'SPECTRAL_CATHEDRAL',
      'VOID_BRIDGE',
      'SIGNAL_GATE',
      'FRACTURE'
    ];
    this.family = families[Math.abs(analysis.seed) % families.length];

    this.build(analysis, track);
    scene.add(this.group);
  }

  private build(analysis: TrackAnalysis, track: GeneratedTrack): void {
    const route = track.route;
    if (route.length < 5) return;

    // Find the drop section
    const dropSection = analysis.sections.find(s => s.theme === 'DROP');
    if (!dropSection) return;

    // Find route node closest to drop section start
    let bestDist = 999999;
    for (const node of route) {
      const d = Math.abs(node.time - dropSection.start);
      if (d < bestDist) {
        bestDist = d;
        this.dropNode = node;
      }
    }
    if (!this.dropNode) return;

    const accentCol = new THREE.Color(analysis.visualAccent.hex);

    // 70-85% Dark Brutalist Mass: Basalt concrete
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x080a10,
      roughness: 0.88,
      metalness: 0.2,
      emissive: accentCol,
      emissiveIntensity: 0.02
    });
    this.materials.push(baseMat);

    // Dynamic inner core / accent gate
    const gateMat = new THREE.MeshStandardMaterial({
      color: 0x101520,
      roughness: 0.25,
      metalness: 0.85,
      emissive: accentCol,
      emissiveIntensity: 0.05
    });
    this.materials.push(gateMat);

    const center = this.dropNode.position;
    const yaw = this.dropNode.yaw;

    this.group.position.set(center.x, center.y, center.z);
    this.group.rotation.y = yaw;

    switch (this.family) {
      case 'SPLIT_MONOLITH':
        this.buildSplitMonolith(baseMat, gateMat);
        break;
      case 'SPECTRAL_CATHEDRAL':
        this.buildSpectralCathedral(baseMat, gateMat);
        break;
      case 'VOID_BRIDGE':
        this.buildVoidBridge(baseMat, gateMat);
        break;
      case 'SIGNAL_GATE':
        this.buildSignalGate(baseMat, gateMat);
        break;
      case 'FRACTURE':
      default:
        this.buildFracture(baseMat, gateMat);
        break;
    }
  }

  private buildSplitMonolith(baseMat: THREE.Material, _accentMat: THREE.Material): void {
    // Twin colossal canyon walls leading up to the drop, terminating abruptly to reveal open space
    const wallGeom = new THREE.BoxGeometry(8, 70, 60);
    const leftWall = new THREE.Mesh(wallGeom, baseMat);
    leftWall.position.set(-20, 25, -30);
    this.group.add(leftWall);

    const rightWall = new THREE.Mesh(wallGeom, baseMat);
    rightWall.position.set(20, 25, -30);
    this.group.add(rightWall);
  }

  private buildSpectralCathedral(baseMat: THREE.Material, accentMat: THREE.Material): void {
    // Repeating monumental arches that compress before the drop threshold
    const ribCount = 6;
    for (let i = 0; i < ribCount; i++) {
      const zOffset = -50 + i * 10;
      const width = 22 + i * 4;
      const height = 24 + i * 3;

      const archGroup = new THREE.Group();
      archGroup.position.set(0, 0, zOffset);

      const colGeom = new THREE.BoxGeometry(2, height, 2);
      const lCol = new THREE.Mesh(colGeom, baseMat);
      lCol.position.set(-width * 0.5, height * 0.5, 0);
      archGroup.add(lCol);

      const rCol = new THREE.Mesh(colGeom, baseMat);
      rCol.position.set(width * 0.5, height * 0.5, 0);
      archGroup.add(rCol);

      const beamGeom = new THREE.BoxGeometry(width + 4, 2, 2);
      const beam = new THREE.Mesh(beamGeom, i === ribCount - 1 ? accentMat : baseMat);
      beam.position.set(0, height, 0);
      archGroup.add(beam);

      this.group.add(archGroup);
      this.animatedElements.push(archGroup);
    }
  }

  private buildVoidBridge(baseMat: THREE.Material, accentMat: THREE.Material): void {
    // Deep structural towers flanking the leap into the drop
    for (const side of [-1, 1]) {
      const pylonGeom = new THREE.BoxGeometry(10, 100, 10);
      const pylon = new THREE.Mesh(pylonGeom, baseMat);
      pylon.position.set(side * 28, 30, 0);
      this.group.add(pylon);

      const crossBeamGeom = new THREE.BoxGeometry(18, 3, 3);
      const beam = new THREE.Mesh(crossBeamGeom, accentMat);
      beam.position.set(side * 20, 50, 0);
      this.group.add(beam);
    }
  }

  private buildSignalGate(baseMat: THREE.Material, accentMat: THREE.Material): void {
    // Massive monolithic gate frame directly marking the drop threshold
    const gateColGeom = new THREE.BoxGeometry(5, 55, 6);
    const lCol = new THREE.Mesh(gateColGeom, baseMat);
    lCol.position.set(-22, 20, 0);
    this.group.add(lCol);

    const rCol = new THREE.Mesh(gateColGeom, baseMat);
    rCol.position.set(22, 20, 0);
    this.group.add(rCol);

    const lintelGeom = new THREE.BoxGeometry(54, 8, 8);
    const lintel = new THREE.Mesh(lintelGeom, accentMat);
    lintel.position.set(0, 48, 0);
    this.group.add(lintel);
  }

  private buildFracture(baseMat: THREE.Material, _accentMat: THREE.Material): void {
    // Segmented architectural slabs floating on both sides
    const slabGeom = new THREE.BoxGeometry(6, 18, 14);
    for (let i = 0; i < 8; i++) {
      const side = (i % 2 === 0) ? -1 : 1;
      const slab = new THREE.Mesh(slabGeom, baseMat);
      slab.position.set(side * (22 + (i * 3)), 8 + (i * 2), -40 + (i * 12));
      slab.rotation.set(0.1 * i, 0.15 * side, 0.05 * i);
      this.group.add(slab);
      this.animatedElements.push(slab);
    }
  }

  public update(visualState: MusicVisualState): void {
    const reactMult = visualState.reactivityMultiplier;
    const dropPulse = visualState.dropImpact;
    const buildup = visualState.buildup;

    if (this.materials[0]) {
      this.materials[0].emissiveIntensity = (0.02 + buildup * 0.3 + dropPulse * 1.4) * reactMult;
      this.materials[0].emissive.copy(visualState.bassColor);
    }
    if (this.materials[1]) {
      this.materials[1].emissiveIntensity = (0.05 + buildup * 0.7 + dropPulse * 2.8) * reactMult;
      this.materials[1].emissive.copy(visualState.palette.highlight);
    }
  }

  public dispose(): void {
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
    for (const mat of this.materials) {
      mat.dispose();
    }
    this.materials = [];
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
      }
    });
    this.group.clear();
  }
}
