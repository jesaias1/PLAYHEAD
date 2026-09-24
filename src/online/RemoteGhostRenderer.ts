/**
 * REMOTE GHOST RENDERER — presentation only.
 *
 * Draws the friend as a translucent PLAYHEAD signal ghost, interpolated between
 * the 12 Hz Realtime samples. It is deliberately:
 *   - non-colliding (no player-player collision, ever)
 *   - non-authoritative (local 120 Hz movement stays the source of truth)
 *   - cheap (one mesh, no per-frame network, no per-frame allocations)
 *
 * READABILITY CONTRACT (multiplayer polish):
 *   - visible enough to feel like another player is in the level
 *   - never opaque enough to hide the route behind it
 *   - never bright enough to blind, and no wide glow halo
 *   - visually distinct from gameplay geometry
 *
 * The BODY is normal-blended and translucent, so it can only ever occlude a
 * little of what is behind it — it cannot ADD light and therefore cannot blow
 * out a bright section. Only the thin wireframe TRACE is additive, and at low
 * opacity, which is what keeps the silhouette legible at distance without a
 * halo.
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

/** Rival signal colour. Matches the rival HUD accent so the identity is one thing. */
export const RIVAL_SIGNAL_COLOR = 0x9d8cff;
/** Translucent body — reads as a signal body, cannot add light. */
const BODY_OPACITY = 0.40;
/** Thin additive trace — the silhouette cue, deliberately faint. */
const TRACE_OPACITY = 0.22;

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

  constructor(scene: THREE.Scene, color = RIVAL_SIGNAL_COLOR) {
    this.group = new THREE.Group();
    this.group.name = 'RemoteSignalGhost';
    this.group.visible = false;
    // Presentation only: never part of world-safety or gameplay validation.
    this.group.userData.worldSafetyExempt = true;
    this.group.userData.devHelper = true;

    // Inner core: a slim vertical capsule read as a translucent signal body.
    const coreGeom = new THREE.CapsuleGeometry(0.34, 1.1, 4, 8);
    this.material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: BODY_OPACITY,
      // Normal blending on purpose: the body must never ADD light, so it can
      // never blind the player or wash out a bright section.
      blending: THREE.NormalBlending,
      depthWrite: false
    });
    this.mesh = new THREE.Mesh(coreGeom, this.material);
    this.mesh.position.y = 0.9;
    this.group.add(this.mesh);

    // Outer shell: a faint additive wireframe trace for silhouette readability.
    const shellGeom = new THREE.CapsuleGeometry(0.46, 1.3, 4, 10);
    this.outerMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: TRACE_OPACITY,
      wireframe: true,
      blending: THREE.AdditiveBlending,
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

  /**
   * Presentation-only effect-intensity scale. Applied to both opacities, never
   * to the ghost's position or interpolation.
   */
  public setEffectScale(scale: number): void {
    if (!Number.isFinite(scale) || scale <= 0) return;
    this.material.opacity = Math.min(0.75, BODY_OPACITY * scale);
    this.outerMaterial.opacity = Math.min(0.5, TRACE_OPACITY * scale);
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
