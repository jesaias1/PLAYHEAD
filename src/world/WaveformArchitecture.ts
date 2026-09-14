/**
 * Physical 3D Waveform Monument suspended in the distant horizon
 * Directly extruded from the analysed track PCM envelope
 */

import * as THREE from 'three';
import { TrackAnalysis } from '../audio/AudioFeatures';
import { GeneratedTrack } from '../generation/GenerationTypes';

export class WaveformArchitecture {
  public group: THREE.Group;
  private ribbonMesh: THREE.Mesh | null = null;
  private ribMeshes: THREE.InstancedMesh | null = null;

  constructor(analysis: TrackAnalysis, track: GeneratedTrack) {
    this.group = new THREE.Group();
    this.build(analysis, track);
  }

  private build(analysis: TrackAnalysis, track: GeneratedTrack): void {
    const accentColor = new THREE.Color(analysis.visualAccent.hex);
    const route = track.route;
    if (route.length < 2) return;

    // Build a continuous 3D curve parallel to the route at a distance offset
    const points: THREE.Vector3[] = [];
    const lateralOffset = 70.0; // Float 70 metres to the side of route to preserve sightlines
    const verticalOffset = 25.0;

    for (let i = 0; i < route.length; i++) {
      const node = route[i];
      const px = node.position.x + Math.cos(node.yaw) * lateralOffset;
      const pz = node.position.z - Math.sin(node.yaw) * lateralOffset;

      // Sample real waveform envelope at normalized track time
      const timeRatio = Math.min(1, Math.max(0, node.time / analysis.duration));
      const waveIdx = Math.floor(timeRatio * (analysis.waveform.length - 1));
      const amp = analysis.waveform[waveIdx] || 0.2;

      const py = node.position.y + verticalOffset + amp * 32.0;
      points.push(new THREE.Vector3(px, py, pz));
    }

    // 1. Continuous Floating Spectral Ribbon
    const curve = new THREE.CatmullRomCurve3(points);
    const tubeGeom = new THREE.TubeGeometry(curve, points.length * 2, 0.4, 6, false);
    const ribbonMat = new THREE.MeshBasicMaterial({
      color: accentColor,
      transparent: true,
      opacity: 0.6
    });
    this.ribbonMesh = new THREE.Mesh(tubeGeom, ribbonMat);
    this.group.add(this.ribbonMesh);

    // 2. Instanced Vertical Waveform Ribs hanging down from the ribbon
    const ribCount = Math.min(points.length, 120);
    const ribStep = Math.max(1, Math.floor(points.length / ribCount));
    const boxGeom = new THREE.BoxGeometry(0.8, 1.0, 0.8);
    const ribMat = new THREE.MeshStandardMaterial({
      color: 0x0a0c10,
      roughness: 0.9,
      metalness: 0.3
    });

    this.ribMeshes = new THREE.InstancedMesh(boxGeom, ribMat, ribCount);
    const dummy = new THREE.Object3D();
    let instanceIdx = 0;

    for (let i = 0; i < points.length && instanceIdx < ribCount; i += ribStep) {
      const p = points[i];
      const timeRatio = i / points.length;
      const waveIdx = Math.floor(timeRatio * (analysis.waveform.length - 1));
      const amp = analysis.waveform[waveIdx] || 0.2;
      const ribHeight = Math.max(4.0, amp * 45.0);

      dummy.position.set(p.x, p.y - ribHeight * 0.5, p.z);
      dummy.scale.set(1.0, ribHeight, 1.0);
      dummy.updateMatrix();
      this.ribMeshes.setMatrixAt(instanceIdx++, dummy.matrix);
    }
    this.ribMeshes.instanceMatrix.needsUpdate = true;
    this.group.add(this.ribMeshes);
  }

  public dispose(): void {
    if (this.ribbonMesh) {
      this.ribbonMesh.geometry.dispose();
      (this.ribbonMesh.material as THREE.Material).dispose();
    }
    if (this.ribMeshes) {
      this.ribMeshes.geometry.dispose();
      (this.ribMeshes.material as THREE.Material).dispose();
    }
    this.group.clear();
  }
}
