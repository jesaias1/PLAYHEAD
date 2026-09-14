/**
 * Spatial Spectral Architecture for PLAYHEAD
 * Replaces the isolated floating waveform with an architectural language:
 * - Waveform Canyon (twin monumental waveform relief walls on flanks)
 * - Overhead Spectral Canopy (high suspended brutalist fins above clearance)
 * - Onset Gates & Rhythm Corridors (beat-synced architectural frames)
 * - Frequency Column Clusters (spectral band pillars)
 */

import * as THREE from 'three';
import { TrackAnalysis } from '../audio/AudioFeatures';
import { GeneratedTrack } from '../generation/GenerationTypes';
import { MusicVisualState } from './MusicVisualController';

export class SpectralArchitecture {
  public group: THREE.Group;

  // 1. Waveform Canyon
  private canyonWallsLeft: THREE.InstancedMesh | null = null;
  private canyonWallsRight: THREE.InstancedMesh | null = null;
  private canyonMaterial: THREE.MeshStandardMaterial;

  // 2. Overhead Canopy Fins
  private canopyFins: THREE.InstancedMesh | null = null;
  private canopyMaterial: THREE.MeshStandardMaterial;

  // 3. Rhythm Frames / Onset Gates
  private onsetFrames: THREE.Group = new THREE.Group();
  private frameMaterials: THREE.MeshStandardMaterial[] = [];

  // Lintel materials for onset gates
  private lintelMaterials: THREE.MeshStandardMaterial[] = [];

  constructor(scene: THREE.Scene, analysis: TrackAnalysis, track: GeneratedTrack) {
    this.group = new THREE.Group();

    const accent = analysis.visualAccent;
    const accentCol = new THREE.Color(accent.hex);

    // 70-85% dark brutalist mass: dark matte slate concrete
    this.canyonMaterial = new THREE.MeshStandardMaterial({
      color: 0x0c0f16,
      roughness: 0.9,
      metalness: 0.15,
      emissive: accentCol,
      emissiveIntensity: 0.02
    });

    this.canopyMaterial = new THREE.MeshStandardMaterial({
      color: 0x10151f,
      roughness: 0.7,
      metalness: 0.5,
      emissive: accentCol,
      emissiveIntensity: 0.04
    });

    this.build(analysis, track);
    scene.add(this.group);
  }

  private build(analysis: TrackAnalysis, track: GeneratedTrack): void {
    const route = track.route;
    if (route.length < 3) return;

    // ==========================================
    // 1. WAVEFORM CANYON (Left & Right Flanks)
    // ==========================================
    const canyonCount = Math.min(route.length, 160);
    const canyonStep = Math.max(1, Math.floor(route.length / canyonCount));
    const wallGeom = new THREE.BoxGeometry(6.0, 1.0, 12.0);

    this.canyonWallsLeft = new THREE.InstancedMesh(wallGeom, this.canyonMaterial, canyonCount);
    this.canyonWallsRight = new THREE.InstancedMesh(wallGeom, this.canyonMaterial, canyonCount);

    const dummy = new THREE.Object3D();
    const lateralOffset = 68.0; // Clear of gameplay route
    let instIdx = 0;

    for (let i = 0; i < route.length && instIdx < canyonCount; i += canyonStep) {
      const node = route[i];
      const timeRatio = Math.min(1, Math.max(0, node.time / analysis.duration));
      const waveIdx = Math.floor(timeRatio * (analysis.waveform.length - 1));
      const amp = analysis.waveform[waveIdx] || 0.25;

      const wallHeight = Math.max(8.0, amp * 55.0);
      const rightX = Math.cos(node.yaw);
      const rightZ = -Math.sin(node.yaw);

      // Left Wall
      const lx = node.position.x - rightX * lateralOffset;
      const lz = node.position.z - rightZ * lateralOffset;
      dummy.position.set(lx, node.position.y + wallHeight * 0.5 - 5.0, lz);
      dummy.scale.set(1.0, wallHeight, 1.0);
      dummy.rotation.set(0, node.yaw, 0);
      dummy.updateMatrix();
      this.canyonWallsLeft.setMatrixAt(instIdx, dummy.matrix);

      // Right Wall
      const rx = node.position.x + rightX * lateralOffset;
      const rz = node.position.z + rightZ * lateralOffset;
      dummy.position.set(rx, node.position.y + wallHeight * 0.5 - 5.0, rz);
      dummy.scale.set(1.0, wallHeight, 1.0);
      dummy.rotation.set(0, node.yaw, 0);
      dummy.updateMatrix();
      this.canyonWallsRight.setMatrixAt(instIdx, dummy.matrix);

      instIdx++;
    }

    this.canyonWallsLeft.instanceMatrix.needsUpdate = true;
    this.canyonWallsRight.instanceMatrix.needsUpdate = true;
    this.group.add(this.canyonWallsLeft);
    this.group.add(this.canyonWallsRight);

    // ==========================================
    // 2. OVERHEAD SPECTRAL CANOPY FINS
    // High overhead (y > 22m above player)
    // ==========================================
    const finCount = Math.min(route.length, 90);
    const finStep = Math.max(1, Math.floor(route.length / finCount));
    const finGeom = new THREE.BoxGeometry(28.0, 1.2, 3.5);

    this.canopyFins = new THREE.InstancedMesh(finGeom, this.canopyMaterial, finCount);
    let fIdx = 0;

    for (let i = 0; i < route.length && fIdx < finCount; i += finStep) {
      const node = route[i];
      const timeRatio = Math.min(1, Math.max(0, node.time / analysis.duration));
      const frameIdx = Math.floor(timeRatio * (analysis.frames.length - 1));
      const frame = analysis.frames[frameIdx] || { mid: 0.3, high: 0.3 };

      const finHeight = 22.0 + frame.high * 16.0;
      dummy.position.set(node.position.x, node.position.y + finHeight, node.position.z);
      dummy.scale.set(1.0, 1.0, 1.0);
      dummy.rotation.set(0, node.yaw + Math.PI * 0.5, 0);
      dummy.updateMatrix();

      this.canopyFins.setMatrixAt(fIdx++, dummy.matrix);
    }

    this.canopyFins.instanceMatrix.needsUpdate = true;
    this.group.add(this.canopyFins);

    // ==========================================
    // 3. ONSET GATES & RHYTHM FRAMES
    // Generated at strong musical onsets
    // ==========================================
    this.group.add(this.onsetFrames);
    const onsets = analysis.onsets.filter(o => o.strength > 0.65);
    const maxGates = Math.min(35, onsets.length);
    const gateStep = Math.max(1, Math.floor(onsets.length / maxGates));

    for (let i = 0; i < onsets.length && this.frameMaterials.length < maxGates; i += gateStep) {
      const onset = onsets[i];
      // Find nearest route node
      const targetTime = onset.time;
      let nearestNode = route[0];
      let minDist = 999999;
      for (const n of route) {
        const d = Math.abs(n.time - targetTime);
        if (d < minDist) {
          minDist = d;
          nearestNode = n;
        }
      }

      // Create an architectural monumental portal arch
      const frameGroup = new THREE.Group();
      frameGroup.position.set(nearestNode.position.x, nearestNode.position.y, nearestNode.position.z);
      frameGroup.rotation.y = nearestNode.yaw;

      // Base column material (70-85% dark basalt concrete mass)
      const colMat = new THREE.MeshStandardMaterial({
        color: 0x0a0d14,
        emissive: new THREE.Color(analysis.visualAccent.hex),
        emissiveIntensity: 0.02,
        roughness: 0.85,
        metalness: 0.25
      });
      this.frameMaterials.push(colMat);

      // Overhead lintel beam material (excited into highlight)
      const lintelMat = new THREE.MeshStandardMaterial({
        color: 0x0e131d,
        emissive: new THREE.Color(analysis.visualAccent.hex),
        emissiveIntensity: 0.04,
        roughness: 0.4,
        metalness: 0.7
      });
      this.lintelMaterials.push(lintelMat);

      // Left column
      const colGeom = new THREE.BoxGeometry(1.5, 16.0, 1.5);
      const leftCol = new THREE.Mesh(colGeom, colMat);
      leftCol.position.set(-11, 8, 0);
      frameGroup.add(leftCol);

      // Right column
      const rightCol = new THREE.Mesh(colGeom, colMat);
      rightCol.position.set(11, 8, 0);
      frameGroup.add(rightCol);

      // Top lintel beam
      const beamGeom = new THREE.BoxGeometry(24, 1.5, 1.5);
      const topBeam = new THREE.Mesh(beamGeom, lintelMat);
      topBeam.position.set(0, 16, 0);
      frameGroup.add(topBeam);

      this.onsetFrames.add(frameGroup);
    }
  }

  public update(visualState: MusicVisualState): void {
    const reactMult = visualState.reactivityMultiplier;

    // 1. Waveform Canyon: low-frequency Y dilation & bass-routed excitation
    if (this.canyonWallsLeft && this.canyonWallsRight) {
      const dilationY = 1.0 + visualState.subBass * 0.18 * reactMult;
      this.canyonWallsLeft.scale.y = dilationY;
      this.canyonWallsRight.scale.y = dilationY;
    }
    const canyonEmissive = (0.02 + visualState.subBass * 0.4 + visualState.dropImpact * 0.7) * reactMult;
    this.canyonMaterial.emissiveIntensity = canyonEmissive;
    this.canyonMaterial.emissive.copy(visualState.bassColor);

    // 2. Overhead Canopy Fins: shimmer with high frequencies & mid energy
    const canopyEmissive = (0.04 + visualState.high * 0.5 + visualState.flux * 0.35) * reactMult;
    this.canopyMaterial.emissiveIntensity = canopyEmissive;
    this.canopyMaterial.emissive.copy(visualState.highColor);

    // 3. Onset Gates: Bottom-to-top onset gate ignition
    // Columns ignite with primary/bass, lintel ignites with sharp highlight
    const colEmissive = (0.02 + visualState.onsetPulse * 1.5 + visualState.dropImpact * 1.8) * reactMult;
    for (let i = 0; i < this.frameMaterials.length; i++) {
      this.frameMaterials[i].emissiveIntensity = colEmissive;
      this.frameMaterials[i].emissive.copy(visualState.palette.primary);
    }

    const lintelEmissive = (0.04 + visualState.onsetPulse * 2.4 + visualState.dropImpact * 2.8) * reactMult;
    for (let i = 0; i < this.lintelMaterials.length; i++) {
      this.lintelMaterials[i].emissiveIntensity = lintelEmissive;
      this.lintelMaterials[i].emissive.copy(visualState.palette.highlight);
    }
  }

  public dispose(): void {
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }

    if (this.canyonWallsLeft) {
      this.canyonWallsLeft.geometry.dispose();
      this.canyonWallsLeft.dispose();
    }
    if (this.canyonWallsRight) {
      this.canyonWallsRight.geometry.dispose();
      this.canyonWallsRight.dispose();
    }
    if (this.canopyFins) {
      this.canopyFins.geometry.dispose();
      this.canopyFins.dispose();
    }

    this.canyonMaterial.dispose();
    this.canopyMaterial.dispose();

    for (const mat of this.frameMaterials) {
      mat.dispose();
    }
    this.frameMaterials = [];

    for (const mat of this.lintelMaterials) {
      mat.dispose();
    }
    this.lintelMaterials = [];

    this.onsetFrames.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
      }
    });
    this.onsetFrames.clear();
    this.group.clear();
  }
}
