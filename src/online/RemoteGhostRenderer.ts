/**
 * REMOTE GHOST RENDERER — live multiplayer ghost source (presentation only).
 *
 * Draws the friend as a translucent PLAYHEAD signal ghost, interpolated between
 * the 12 Hz Realtime samples. It is deliberately:
 *   - non-colliding (no player-player collision, ever)
 *   - non-authoritative (local 120 Hz movement stays the source of truth)
 *   - cheap (one mesh, no per-frame network, no per-frame allocations)
 *
 * The visual representation itself lives in `replay/GhostVisual` and is SHARED
 * with the recorded-run ghost race, so a live rival and a replay ghost can never
 * drift into two different visual languages. This class owns only the live
 * concern: network sample staleness and interpolation.
 *
 * When the remote player full-restarts, their packets switch to `running:false`
 * and the ghost is parked back at spawn, so the visual reset matches what
 * actually happened on their machine.
 */

import * as THREE from 'three';
import type { GhostSample } from './RaceRoomService';
import { GhostVisual } from '../replay/GhostVisual';

/** Ignore samples older than this (stale packet drop). */
const STALE_MS = 1200;
/** Interpolation smoothing (higher = snappier). */
const POSITION_LERP = 12;
const YAW_LERP = 10;

/** Rival signal colour. Matches the rival HUD accent so the identity is one thing. */
export const RIVAL_SIGNAL_COLOR = 0x9d8cff;

export class RemoteGhostRenderer {
  public group: THREE.Group;

  private visual: GhostVisual;

  private hasTarget = false;
  private targetPos = new THREE.Vector3();
  private targetYaw = 0;
  private currentPos = new THREE.Vector3();
  private currentYaw = 0;
  private visible = false;
  private lastSampleAt = 0;

  constructor(scene: THREE.Scene, color = RIVAL_SIGNAL_COLOR) {
    this.visual = new GhostVisual(scene, { color });
    this.group = this.visual.group;
    this.group.name = 'RemoteSignalGhost';
  }

  /** Feeds one remote sample. Stale packets are dropped. */
  public setSample(sample: GhostSample): void {
    if (Math.abs(Date.now() - sample.t) > STALE_MS) return;

    if (!sample.running) {
      // Remote player abandoned the attempt: park the ghost at spawn.
      this.visible = false;
      this.visual.setVisible(false);
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
    this.visual.setVisible(true);
  }

  public update(dt: number): void {
    if (!this.hasTarget) return;
    if (Date.now() - this.lastSampleAt > STALE_MS) {
      // No packets for a while: fade out rather than leaving a frozen ghost.
      this.visual.setVisible(false);
      return;
    }
    this.visual.setVisible(this.visible);

    const t = Math.min(1, dt * POSITION_LERP);
    this.currentPos.lerp(this.targetPos, t);

    // Shortest-arc yaw interpolation.
    let delta = this.targetYaw - this.currentYaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.currentYaw += delta * Math.min(1, dt * YAW_LERP);

    this.visual.setTransform(this.currentPos.x, this.currentPos.y, this.currentPos.z, this.currentYaw);
  }

  public setColor(color: number): void {
    this.visual.setColor(color);
  }

  /**
   * Presentation-only effect-intensity scale. Applied to both opacities, never
   * to the ghost's position or interpolation.
   */
  public setEffectScale(scale: number): void {
    this.visual.setOpacityScale(scale);
  }

  public setVisible(visible: boolean): void {
    this.visible = visible;
    this.visual.setVisible(visible && this.hasTarget);
  }

  public clear(): void {
    this.hasTarget = false;
    this.visible = false;
    this.visual.setVisible(false);
  }

  public dispose(): void {
    this.visual.dispose();
  }
}
