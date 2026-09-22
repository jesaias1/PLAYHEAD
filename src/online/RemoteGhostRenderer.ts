/**
 * REMOTE GHOST RENDERER — presentation only.
 *
 * Draws the friend as a translucent PLAYHEAD signal ghost, interpolated between
 * the 12 Hz Realtime samples. It is deliberately:
 *   - non-colliding (no player-player collision, ever)
 *   - non-authoritative (local 120 Hz movement stays the source of truth)
 *   - cheap (one mesh, no per-frame network, no per-frame allocations)
 *
 * When the remote player full-restarts, their packets switch to `running:false`
 * and the ghost is parked back at spawn, so the visual reset matches what
 * actually happened on their machine.
 */

import * as THREE from 'three';
import type { GhostSample } from './RaceRoomService';

/** Ignore samples older than this (stale packet drop). */
const STALE_MS = 1200;
/** Interpolation smoothing (higher = snappier). */
const POSITION_LERP = 12;
const YAW_LERP = 10;

export class RemoteGhostRenderer {
  public group: THREE.Group;

  private mesh: THREE.Mesh;
  private material: THREE.MeshBasicMaterial;
  private outer: THREE.Mesh;
  private outerMaterial: THREE.MeshBasicMaterial;

  private hasTarget = false;
  private targetPos = new THREE.Vector3();
  private targetYaw = 0;
  private currentPos = new THREE.Vector3();
  private currentYaw = 0;
  private visible = false;
  private lastSampleAt = 0;

  constructor(scene: THREE.Scene, color = 0x00f0ff) {
    this.group = new THREE.Group();
    this.group.name = 'RemoteSignalGhost';
    this.group.visible = false;
    // Presentation only: never part of world-safety or gameplay validation.
    this.group.userData.worldSafetyExempt = true;
    this.group.userData.devHelper = true;

    // Inner core: a slim vertical capsule read as a signal body.
    const coreGeom = new THREE.CapsuleGeometry(0.34, 1.1, 4, 8);
    this.material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.mesh = new THREE.Mesh(coreGeom, this.material);
    this.mesh.position.y = 0.9;
    this.group.add(this.mesh);

    // Outer shell: a faint wireframe envelope for silhouette readability.
    const shellGeom = new THREE.CapsuleGeometry(0.46, 1.3, 4, 10);
    this.outerMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.16,
      wireframe: true,
      depthWrite: false
    });
    this.outer = new THREE.Mesh(shellGeom, this.outerMaterial);
    this.outer.position.y = 0.9;
    this.group.add(this.outer);

    scene.add(this.group);
  }

  /** Feeds one remote sample. Stale packets are dropped. */
  public setSample(sample: GhostSample): void {
    if (Math.abs(Date.now() - sample.t) > STALE_MS) return;

    if (!sample.running) {
      // Remote player abandoned the attempt: park the ghost at spawn.
      this.visible = false;
      this.group.visible = false;
      this.hasTarget = false;
      return;
    }

    this.targetPos.set(sample.x, sample.y, sample.z);
    this.targetYaw = sample.yaw;
    this.lastSampleAt = Date.now();

    if (!this.hasTarget) {
      // First sample after (re)appearing: snap rather than slide across the map.
      this.currentPos.copy(this.targetPos);
      this.currentYaw = this.targetYaw;
      this.hasTarget = true;
    }
    this.visible = true;
    this.group.visible = true;
  }

  public update(dt: number): void {
    if (!this.hasTarget) return;
    if (Date.now() - this.lastSampleAt > STALE_MS) {
      // No packets for a while: fade out rather than leaving a frozen ghost.
      this.group.visible = false;
      return;
    }
    this.group.visible = this.visible;

    const t = Math.min(1, dt * POSITION_LERP);
    this.currentPos.lerp(this.targetPos, t);

    // Shortest-arc yaw interpolation.
    let delta = this.targetYaw - this.currentYaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.currentYaw += delta * Math.min(1, dt * YAW_LERP);

    this.group.position.copy(this.currentPos);
    this.group.rotation.y = this.currentYaw;
  }

  public setColor(color: number): void {
    this.material.color.setHex(color);
    this.outerMaterial.color.setHex(color);
  }

  public setVisible(visible: boolean): void {
    this.visible = visible;
    this.group.visible = visible && this.hasTarget;
  }

  public clear(): void {
    this.hasTarget = false;
    this.visible = false;
    this.group.visible = false;
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    this.outer.geometry.dispose();
    this.material.dispose();
    this.outerMaterial.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
