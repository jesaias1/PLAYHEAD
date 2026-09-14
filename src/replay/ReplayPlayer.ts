/**
 * Replay player playing recorded run data with smooth interpolation and cinematic camera
 */

import * as THREE from 'three';
import { ReplayFrame, ReplayRecorder } from './ReplayRecorder';
import { ReplayCamera } from './ReplayCamera';
import { lerp } from '../utils/math';

export class ReplayPlayer {
  public isPlaying = false;
  public currentTime = 0;

  private frames: ReplayFrame[] = [];
  private replayCamera: ReplayCamera;
  private avatarMesh: THREE.Mesh;
  private scene: THREE.Scene;

  public onCompleteCallback?: () => void;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.replayCamera = new ReplayCamera(camera);

    // Create an elegant brutalist wireframe avatar representing the player
    const geom = new THREE.CylinderGeometry(0.5, 0.5, 1.8, 8);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x00f0ff,
      emissiveIntensity: 0.8,
      wireframe: true
    });
    this.avatarMesh = new THREE.Mesh(geom, mat);
    this.avatarMesh.visible = false;
    this.scene.add(this.avatarMesh);
  }

  public start(recorder: ReplayRecorder): boolean {
    if (!recorder.hasData()) return false;

    this.frames = recorder.frames;
    this.currentTime = 0;
    this.isPlaying = true;
    this.avatarMesh.visible = true;
    this.replayCamera.reset();
    return true;
  }

  public stop(): void {
    this.isPlaying = false;
    this.avatarMesh.visible = false;
  }

  public update(dt: number): void {
    if (!this.isPlaying || this.frames.length === 0) return;

    this.currentTime += dt;
    const duration = this.frames[this.frames.length - 1].time;

    if (this.currentTime >= duration) {
      this.stop();
      this.onCompleteCallback?.();
      return;
    }

    // Binary search for surrounding frames
    const current = this.sampleFrame(this.currentTime);

    // Update avatar mesh
    this.avatarMesh.position.set(current.px, current.py + 0.9, current.pz);
    this.avatarMesh.rotation.y = current.yaw;

    // Update cinematic camera
    const playerPos = new THREE.Vector3(current.px, current.py, current.pz);
    this.replayCamera.update(playerPos, current.yaw, current.pitch, current.speed, dt);
  }

  private sampleFrame(time: number): ReplayFrame {
    // Edge checks
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

  public dispose(): void {
    this.stop();
    this.scene.remove(this.avatarMesh);
    this.avatarMesh.geometry.dispose();
    (this.avatarMesh.material as THREE.Material).dispose();
  }
}
