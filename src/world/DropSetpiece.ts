/**
 * Major Drop Setpiece Generator for PLAYHEAD SIGNAL RENDER
 * "Cosmic Pixel Brutalism" drop setpieces:
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
import { BrutalistShapeLibrary } from './BrutalistShapeLibrary';
import { PixelTextureGenerator } from './PixelTextureGenerator';
import { RouteExclusionCorridor } from './RouteExclusionCorridor';

export type DropSetpieceFamily = 'SPLIT_MONOLITH' | 'SPECTRAL_CATHEDRAL' | 'VOID_BRIDGE' | 'SIGNAL_GATE' | 'FRACTURE';

export class DropSetpiece {
  public group: THREE.Group;
  public family: DropSetpieceFamily;
  private dropNode: RouteNode | null = null;
  private materials: THREE.MeshStandardMaterial[] = [];
  private animatedElements: THREE.Object3D[] = [];

  constructor(scene: THREE.Scene, analysis: TrackAnalysis, track: GeneratedTrack) {
    this.group = new THREE.Group();

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

    const dropSection = analysis.sections.find(s => s.theme === 'DROP');
    if (!dropSection) return;

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
    const basaltTex = PixelTextureGenerator.getBlackBasaltTexture();
    const concreteTex = PixelTextureGenerator.getDarkConcreteTexture();

    // Dark Basalt Material
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x05080e,
      roughness: 0.9,
      metalness: 0.15,
      map: basaltTex,
      emissive: accentCol,
      emissiveIntensity: 0.03
    });
    this.materials.push(baseMat);

    // Accent Gate Material
    const gateMat = new THREE.MeshStandardMaterial({
      color: 0x0a101d,
      roughness: 0.3,
      metalness: 0.8,
      map: concreteTex,
      emissive: accentCol,
      emissiveIntensity: 0.08
    });
    this.materials.push(gateMat);

    const center = this.dropNode.position;
    const yaw = this.dropNode.yaw;

    this.group.position.set(center.x, center.y, center.z);
    this.group.rotation.y = yaw;

    const corridor = new RouteExclusionCorridor(track.route);

    switch (this.family) {
      case 'SPLIT_MONOLITH':
        this.buildSplitMonolith(baseMat, gateMat, corridor);
        break;
      case 'SPECTRAL_CATHEDRAL':
        this.buildSpectralCathedral(baseMat, gateMat);
        break;
      case 'VOID_BRIDGE':
        this.buildVoidBridge(baseMat, gateMat, corridor);
        break;
      case 'SIGNAL_GATE':
        this.buildSignalGate(baseMat, gateMat, corridor);
        break;
      case 'FRACTURE':
      default:
        this.buildFracture(baseMat, gateMat, corridor);
        break;
    }
  }

  private buildSplitMonolith(baseMat: THREE.Material, _accentMat: THREE.Material, _corridor: RouteExclusionCorridor): void {
    // Twin colossal brutalist monoliths flanking the drop threshold with safe clearance
    const lateralDist = 38.0;
    const leftMonolith = BrutalistShapeLibrary.createMonolith(18.0, 95.0, 24.0, baseMat);
    leftMonolith.position.set(-lateralDist, 0, -25.0);
    this.group.add(leftMonolith);
    this.animatedElements.push(leftMonolith);

    const rightMonolith = BrutalistShapeLibrary.createMonolith(18.0, 95.0, 24.0, baseMat);
    rightMonolith.position.set(lateralDist, 0, -25.0);
    this.group.add(rightMonolith);
    this.animatedElements.push(rightMonolith);
  }

  private buildSpectralCathedral(baseMat: THREE.Material, accentMat: THREE.Material): void {
    // Repeating sweeping cathedral arch ribs leading up to drop with wide clear passage
    const ribCount = 5;
    for (let i = 0; i < ribCount; i++) {
      const zOffset = -45.0 + i * 11.0;
      const width = 42.0 + i * 4.0; // Wide clear passage
      const height = 34.0 + i * 3.5;

      const rib = BrutalistShapeLibrary.createCathedralRib(
        width,
        height,
        5.0,
        2.5,
        i === ribCount - 1 ? accentMat : baseMat
      );
      rib.position.set(0, 0, zOffset);
      this.group.add(rib);
      this.animatedElements.push(rib);
    }
  }

  private buildVoidBridge(baseMat: THREE.Material, _accentMat: THREE.Material, _corridor: RouteExclusionCorridor): void {
    // Twin cantilever pylons flanking the drop jump with wide clearance
    const lateralDist = 38.0;
    const leftCant = BrutalistShapeLibrary.createCantilever(45.0, 16.0, 12.0, baseMat);
    leftCant.position.set(-lateralDist, 0, 0);
    leftCant.scale.x = -1;
    this.group.add(leftCant);
    this.animatedElements.push(leftCant);

    const rightCant = BrutalistShapeLibrary.createCantilever(45.0, 16.0, 12.0, baseMat);
    rightCant.position.set(lateralDist, 0, 0);
    this.group.add(rightCant);
    this.animatedElements.push(rightCant);
  }

  private buildSignalGate(baseMat: THREE.Material, accentMat: THREE.Material, _corridor: RouteExclusionCorridor): void {
    // Massive brutalist pylon stelae framing the threshold with wide top lintel
    const lateralDist = 38.0;
    const leftPylon = BrutalistShapeLibrary.createPylonStela(12.0, 75.0, 14.0, baseMat);
    leftPylon.position.set(-lateralDist, 0, 0);
    this.group.add(leftPylon);

    const rightPylon = BrutalistShapeLibrary.createPylonStela(12.0, 75.0, 14.0, baseMat);
    rightPylon.position.set(lateralDist, 0, 0);
    this.group.add(rightPylon);

    const lintel = new THREE.Mesh(new THREE.BoxGeometry(lateralDist * 2.2, 8.0, 12.0), accentMat);
    lintel.position.set(0, 68.0, 0);
    this.group.add(lintel);
    this.animatedElements.push(lintel);
  }

  private buildFracture(baseMat: THREE.Material, _accentMat: THREE.Material, _corridor: RouteExclusionCorridor): void {
    // Broken slabs and floating ruins hovering over the drop void outside playable path
    for (let i = 0; i < 6; i++) {
      const side = (i % 2 === 0) ? -1 : 1;
      const broken = BrutalistShapeLibrary.createBrokenSlab(24.0, 16.0, 18.0, baseMat);
      broken.position.set(side * (36.0 + i * 5.0), 6.0 + i * 2.0, -35.0 + i * 14.0);
      this.group.add(broken);
      this.animatedElements.push(broken);
    }
  }

  public update(visualState: MusicVisualState): void {
    const reactMult = visualState.reactivityMultiplier;
    const dropPulse = visualState.dropImpact;
    const buildup = visualState.buildup;

    if (this.materials[0]) {
      this.materials[0].emissiveIntensity = (0.03 + buildup * 0.35 + dropPulse * 1.5) * reactMult;
      this.materials[0].emissive.copy(visualState.bassColor);
    }
    if (this.materials[1]) {
      this.materials[1].emissiveIntensity = (0.08 + buildup * 0.75 + dropPulse * 2.8) * reactMult;
      this.materials[1].emissive.copy(visualState.palette.highlight);
    }

    // Dynamic geometric response based on setpiece family
    if (this.family === 'SPLIT_MONOLITH' && this.animatedElements.length >= 2) {
      // Monoliths split open laterally on buildup & drop from safe base distance 38.0m
      const splitOffset = (buildup * 8.0 + dropPulse * 16.0) * reactMult;
      this.animatedElements[0].position.x = -38.0 - splitOffset;
      this.animatedElements[1].position.x = 38.0 + splitOffset;
    } else if (this.family === 'SPECTRAL_CATHEDRAL') {
      for (let i = 0; i < this.animatedElements.length; i++) {
        const arch = this.animatedElements[i];
        const phase = visualState.time * 2.0 + i * 0.6;
        arch.position.y = Math.sin(phase) * 1.0 + dropPulse * 4.5;
      }
    } else if (this.family === 'FRACTURE') {
      for (let i = 0; i < this.animatedElements.length; i++) {
        const broken = this.animatedElements[i];
        const side = (i % 2 === 0) ? -1 : 1;
        broken.rotation.y = 0.12 * side + Math.sin(visualState.time * 0.8 + i) * 0.08;
        broken.position.y = 6.0 + (i * 2.0) + Math.sin(visualState.time * 1.4 + i * 0.7) * 1.2 + dropPulse * 3.5;
      }
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
