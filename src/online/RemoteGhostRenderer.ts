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
 * ONE VALID SAMPLE IS ENOUGH. The ghost appears on the first accepted transform
 * and is snapped into place, so the opponent is visible on the start platform
 * before anyone moves — it never waits for two movement packets.
 *
 * The opponent is ALWAYS rendered, including before the shared timer starts and
 * after either player resets. A remote reset simply publishes a new live
 * transform at their spawn; there is no rewind logic here at all.
 */

import * as THREE from 'three';
import type { GhostSample } from './RaceRoomService';
import { GhostVisual } from '../replay/GhostVisual';

/** Ignore samples older than this (stale packet drop). */
export const STALE_MS = 1200;
/** Interpolation smoothing (higher = snappier). */
const POSITION_LERP = 12;
const YAW_LERP = 10;

/** Rival signal colour. Matches the rival HUD accent so the identity is one thing. */
export const RIVAL_SIGNAL_COLOR = 0x9d8cff;
/** Guest signal colour: violet/pink blueprint. */
export const GUEST_SIGNAL_COLOR = RIVAL_SIGNAL_COLOR;
/** Host signal colour: cool signal cyan, matching the host HUD accent. */
export const HOST_SIGNAL_COLOR = 0x00f0ff;

/** Diagnostic snapshot for the DEV overlay. */
export interface RemoteGhostDiagnostics {
  /** True once at least one valid transform has been accepted. */
  hasTarget: boolean;
  /** True while the visual is actually drawn. */
  visible: boolean;
  /** True when the newest sample has aged past the stale threshold. */
  stale: boolean;
  /** Age of the newest accepted sample, in ms. */
  sampleAgeMs: number;
  /** Total accepted samples since the last clear. */
  samplesReceived: number;
  /** Distance to the local player, in metres, or null when unknown. */
  distanceM: number | null;
  /** Current signal colour. */
  color: number;
}

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
  private samplesReceived = 0;
  private distanceM: number | null = null;
  private color = RIVAL_SIGNAL_COLOR;

  constructor(scene: THREE.Scene, color = RIVAL_SIGNAL_COLOR) {
    this.color = color;
    this.visual = new GhostVisual(scene, {
      color,
      // A live opponent can share the local player's exact spawn point. Without
      // double-sided faces the capsule is culled from the inside and the two
      // players standing together would each see nothing.
      doubleSided: true
    });
    this.group = this.visual.group;
    this.group.name = 'RemoteSignalGhost';
  }

  /**
   * Feeds one remote sample. Stale packets are dropped.
   *
   * A remote reset is NOT a special case: the opponent publishes their new live
   * transform (their spawn) like any other, and the ghost follows it. Hiding the
   * ghost on reset would make the opponent disappear exactly when both players
   * are standing together on the start platform.
   */
  public setSample(sample: GhostSample): void {
    if (Math.abs(Date.now() - sample.t) > STALE_MS) return;

    this.targetPos.set(sample.x, sample.y, sample.z);
    this.targetYaw = sample.yaw;
    this.lastSampleAt = Date.now();
    this.samplesReceived++;

    if (!this.hasTarget) {
      // First sample after (re)appearing: snap rather than slide across the map.
      this.currentPos.copy(this.targetPos);
      this.currentYaw = this.targetYaw;
      this.hasTarget = true;
    }
    this.visible = true;
    this.visual.setVisible(true);
  }

  public update(dt: number, localPosition?: THREE.Vector3): void {
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

    if (localPosition) {
      this.distanceM = Math.hypot(
        this.currentPos.x - localPosition.x,
        this.currentPos.y - localPosition.y,
        this.currentPos.z - localPosition.z
      );
    }
  }

  public setColor(color: number): void {
    this.color = color;
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

  /** True while a live opponent transform is being drawn. */
  public isShowing(): boolean {
    return this.hasTarget && this.visible && Date.now() - this.lastSampleAt <= STALE_MS;
  }

  public getDiagnostics(): RemoteGhostDiagnostics {
    const age = this.hasTarget ? Date.now() - this.lastSampleAt : 0;
    return {
      hasTarget: this.hasTarget,
      visible: this.isShowing(),
      stale: this.hasTarget && age > STALE_MS,
      sampleAgeMs: age,
      samplesReceived: this.samplesReceived,
      distanceM: this.distanceM,
      color: this.color
    };
  }

  public clear(): void {
    this.hasTarget = false;
    this.visible = false;
    this.samplesReceived = 0;
    this.distanceM = null;
    this.lastSampleAt = 0;
    this.visual.setVisible(false);
  }

  public dispose(): void {
    this.visual.dispose();
  }
}
