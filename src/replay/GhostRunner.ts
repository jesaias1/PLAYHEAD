/**
 * GhostRunner: Visual representation and runtime playback of a ghost run in the 3D scene.
 * Features Monumental Brutalism faceted prism avatar, proximity alpha-fade, and momentum trail.
 */

import * as THREE from 'three';
import { ReplayFrame } from './ReplayRecorder';
import { lerp } from '../utils/math';

export type GhostType = 'PB' | 'RIVAL';

export interface GhostRunnerConfig {
  type: GhostType;
  primaryColor: number;
  emissiveColor: number;
  name: string;
}

export class GhostRunner {
  public isVisible = true;
  public group: THREE.Group;

  private type: GhostType;
  private frames: ReplayFrame[] = [];
  private baseOpacity = 0.75;
  private currentAlpha = 0.75;

  private outerMesh: THREE.Mesh;
  private innerMesh: THREE.Mesh;
  private outerMat: THREE.MeshBasicMaterial;
  private innerMat: THREE.MeshBasicMaterial;

  // Trailing velocity ribbon
  private trailLine: THREE.Line;
  private trailGeom: THREE.BufferGeometry;
  private trailPositions: Float32Array;
  private maxTrailPoints = 14;
  private trailCount = 0;

  // Cached vectors
  private ghostPos = new THREE.Vector3();
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene, config: GhostRunnerConfig) {
    this.scene = scene;
    this.type = config.type;
    this.group = new THREE.Group();
    this.group.name = `Ghost_${config.name}`;

    // Outer faceted geometric shell
    const outerGeom = new THREE.CylinderGeometry(0.44, 0.44, 1.8, 6);
    this.outerMat = new THREE.MeshBasicMaterial({
      color: config.primaryColor,
      wireframe: true,
      transparent: true,
      opacity: this.baseOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.outerMesh = new THREE.Mesh(outerGeom, this.outerMat);
    this.outerMesh.position.y = 0.9;
    this.group.add(this.outerMesh);

    // Inner glowing core
    const innerGeom = new THREE.OctahedronGeometry(0.28, 0);
    this.innerMat = new THREE.MeshBasicMaterial({
      color: config.emissiveColor,
      transparent: true,
      opacity: this.baseOpacity * 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.innerMesh = new THREE.Mesh(innerGeom, this.innerMat);
    this.innerMesh.position.y = 0.9;
    this.group.add(this.innerMesh);

    // Trailing momentum ribbon
    this.trailPositions = new Float32Array(this.maxTrailPoints * 3);
    this.trailGeom = new THREE.BufferGeometry();
    this.trailGeom.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));

    const trailMat = new THREE.LineBasicMaterial({
      color: config.primaryColor,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.trailLine = new THREE.Line(this.trailGeom, trailMat);
    this.trailLine.frustumCulled = false;
    this.scene.add(this.trailLine);

    this.group.visible = false;
    this.trailLine.visible = false;
    this.scene.add(this.group);
  }

  public setFrames(frames: ReplayFrame[]): void {
    this.frames = frames;
    this.trailCount = 0;
  }

  public show(): void {
    this.isVisible = true;
    this.group.visible = true;
    this.trailLine.visible = true;
  }

  public hide(): void {
    this.isVisible = false;
    this.group.visible = false;
    this.trailLine.visible = false;
  }

  public reset(): void {
    this.trailCount = 0;
    for (let i = 0; i < this.trailPositions.length; i++) {
      this.trailPositions[i] = 0;
    }
    this.trailGeom.attributes.position.needsUpdate = true;
  }

  /**
   * Updates the ghost avatar position, rotation, proximity fade, and momentum trail
   */
  public update(time: number, playerPos: THREE.Vector3, dt: number): void {
    if (!this.isVisible || this.frames.length === 0) {
      this.group.visible = false;
      this.trailLine.visible = false;
      return;
    }

    const duration = this.frames[this.frames.length - 1].time;
    if (time < 0 || time > duration + 3.0) {
      this.group.visible = false;
      this.trailLine.visible = false;
      return;
    }

    const current = this.sampleFrame(time);

    // Set position and orientation
    this.ghostPos.set(current.px, current.py, current.pz);
    this.group.position.set(current.px, current.py, current.pz);
    this.group.rotation.y = current.yaw;

    // Gentle core rotation for ethereal feel
    this.innerMesh.rotation.y += dt * 2.5;
    this.innerMesh.rotation.x += dt * 1.5;

    // Proximity Alpha Fade: fade out when closer than 3.0m to avoid blocking first-person view
    const dist = this.ghostPos.distanceTo(playerPos);
    let proximityFactor = 1.0;
    if (dist < 3.2) {
      proximityFactor = Math.max(0, Math.min(1, (dist - 0.7) / 2.5));
    }

    this.currentAlpha = this.baseOpacity * proximityFactor;
    this.outerMat.opacity = this.currentAlpha;
    this.innerMat.opacity = this.currentAlpha * 0.9;
    (this.trailLine.material as THREE.LineBasicMaterial).opacity = 0.45 * proximityFactor;

    this.group.visible = this.currentAlpha > 0.02;
    this.trailLine.visible = this.currentAlpha > 0.02;

    // Update trailing ribbon
    this.updateTrail(current.px, current.py + 0.9, current.pz);
  }

  private updateTrail(x: number, y: number, z: number): void {
    if (this.trailCount < this.maxTrailPoints) {
      const idx = this.trailCount * 3;
      this.trailPositions[idx] = x;
      this.trailPositions[idx + 1] = y;
      this.trailPositions[idx + 2] = z;
      this.trailCount++;
    } else {
      // Shift array
      for (let i = 0; i < (this.maxTrailPoints - 1) * 3; i++) {
        this.trailPositions[i] = this.trailPositions[i + 3];
      }
      const last = (this.maxTrailPoints - 1) * 3;
      this.trailPositions[last] = x;
      this.trailPositions[last + 1] = y;
      this.trailPositions[last + 2] = z;
    }
    this.trailGeom.setDrawRange(0, this.trailCount);
    this.trailGeom.attributes.position.needsUpdate = true;
  }

  private sampleFrame(time: number): ReplayFrame {
    if (time <= this.frames[0].time) return this.frames[0];
    if (time >= this.frames[this.frames.length - 1].time) {
      return this.frames[this.frames.length - 1];
    }

    let low = 0;
    let high = this.frames.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.frames[mid].time < time) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const f0 = this.frames[Math.max(0, low - 1)];
    const f1 = this.frames[Math.min(this.frames.length - 1, low)];

    const span = f1.time - f0.time;
    const t = span > 0.0001 ? (time - f0.time) / span : 0;

    return {
      time,
      px: lerp(f0.px, f1.px, t),
      py: lerp(f0.py, f1.py, t),
      pz: lerp(f0.pz, f1.pz, t),
      yaw: lerp(f0.yaw, f1.yaw, t),
      pitch: lerp(f0.pitch, f1.pitch, t),
      speed: lerp(f0.speed, f1.speed, t)
    };
  }

  public getPosition(): THREE.Vector3 {
    return this.ghostPos;
  }

  public getType(): GhostType {
    return this.type;
  }

  public dispose(): void {
    this.hide();
    this.scene.remove(this.group);
    this.scene.remove(this.trailLine);
    this.outerMesh.geometry.dispose();
    this.outerMat.dispose();
    this.innerMesh.geometry.dispose();
    this.innerMat.dispose();
    this.trailGeom.dispose();
    (this.trailLine.material as THREE.Material).dispose();
  }
}
