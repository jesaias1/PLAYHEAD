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
 * concern: presence, sample staleness and interpolation.
 *
 * ============================================================================
 * NETWORK STALE IS NOT THE SAME AS PLAYER GONE.
 * ============================================================================
 *
 * Browsers throttle a background tab's requestAnimationFrame and timers. A
 * backgrounded opponent therefore stops producing fresh transforms, and a naive
 * "no packet for 1.2 s => hide" rule makes the two of them mutually invisible:
 * whoever is in front hides the other, so a same-machine two-browser test can
 * never confirm presence at all.
 *
 * So there are FOUR states, and only two of them hide anything:
 *
 *   NO_SAMPLE     opponent is in the room, no transform received yet  -> hidden
 *   LIVE          fresh transforms                                     -> interpolate
 *   STALE_HOLD    transforms paused, opponent STILL in the room        -> FROZEN,
 *                 visible, slightly dimmed, never extrapolated
 *   DISCONNECTED  positive evidence the opponent is gone               -> hidden
 *
 * A stale transform is NEVER dead-reckoned, never extrapolated and never
 * replaced by invented velocity. The ghost simply stops where it was last
 * genuinely seen. Presence — not packet age — decides whether the opponent
 * still exists.
 */

import * as THREE from 'three';
import type { GhostSample } from './RaceRoomService';
import { GhostVisual } from '../replay/GhostVisual';

/** Above this sample age the ghost stops interpolating and holds. */
export const LIVE_MS = 1200;
/** Ignore inbound samples older than this (stale packet drop at the receiver). */
export const SAMPLE_REJECT_MS = 1200;
/**
 * How long a lost presence signal is tolerated before the ghost is removed.
 *
 * A Realtime reconnect is transient: the opponent is usually still there. This
 * grace period prevents a socket blip from deleting a real player, while a
 * genuine leave still cleans up promptly (and `markRemoteLeft()` is immediate).
 */
export const PRESENCE_GRACE_MS = 4000;
/** STALE_HOLD opacity multiplier: understandable, deliberately subtle. */
export const STALE_OPACITY_SCALE = 0.65;

/** Interpolation smoothing (higher = snappier). */
const POSITION_LERP = 12;
const YAW_LERP = 10;

/** Rival signal colour. Matches the rival HUD accent so the identity is one thing. */
export const RIVAL_SIGNAL_COLOR = 0x9d8cff;
/** Guest signal colour: violet/pink blueprint. */
export const GUEST_SIGNAL_COLOR = RIVAL_SIGNAL_COLOR;
/** Host signal colour: cool signal cyan, matching the host HUD accent. */
export const HOST_SIGNAL_COLOR = 0x00f0ff;

/** Explicit remote-opponent lifecycle state. */
export type RemoteGhostState = 'NO_SAMPLE' | 'LIVE' | 'STALE_HOLD' | 'DISCONNECTED';

/** Diagnostic snapshot for the DEV overlay. */
export interface RemoteGhostDiagnostics {
  state: RemoteGhostState;
  /** True once at least one valid transform has been accepted. */
  hasTarget: boolean;
  /** True while the visual is actually drawn (LIVE or STALE_HOLD). */
  visible: boolean;
  /** True when transforms have paused but the opponent is still present. */
  holding: boolean;
  /** Age of the newest accepted sample, in ms. */
  sampleAgeMs: number;
  /** Total accepted samples since the last clear. */
  samplesReceived: number;
  /** Distance to the local player, in metres, or null when unknown. */
  distanceM: number | null;
  /** Current signal colour. */
  color: number;
  /** Presence as last reported by the room. */
  remotePresent: boolean;
  /** True after an explicit confirmed leave. */
  remoteLeft: boolean;
}

export class RemoteGhostRenderer {
  public group: THREE.Group;

  private visual: GhostVisual;

  private hasTarget = false;
  private targetPos = new THREE.Vector3();
  private targetYaw = 0;
  /** Last genuinely received transform. STALE_HOLD freezes here. */
  private currentPos = new THREE.Vector3();
  private currentYaw = 0;
  private lastSampleAt = 0;
  private samplesReceived = 0;
  private distanceM: number | null = null;
  private color = RIVAL_SIGNAL_COLOR;
  private effectScale = 1;
  private stateScale = 1;

  /** Presence authority, as reported by the room. */
  private remotePresent = true;
  private remoteLeft = false;
  private presenceLostAt = 0;

  constructor(scene: THREE.Scene, color = RIVAL_SIGNAL_COLOR) {
    this.color = color;
    this.visual = new GhostVisual(scene, {
      color,
      // A live opponent can share the local player's exact spawn point. Without
      // double-sided faces the capsule is culled from the inside and the two
      // players standing together would each see nothing. This applies equally
      // to a frozen STALE_HOLD opponent.
      doubleSided: true
    });
    this.group = this.visual.group;
    this.group.name = 'RemoteSignalGhost';
  }

  /**
   * Feeds one remote sample. Only genuinely stale packets are dropped.
   *
   * A remote reset is NOT a special case: the opponent publishes their new live
   * transform (their spawn) like any other, and the ghost follows it. Hiding the
   * ghost on reset would make the opponent disappear exactly when both players
   * are standing together on the start platform.
   */
  public setSample(sample: GhostSample): void {
    if (Math.abs(Date.now() - sample.t) > SAMPLE_REJECT_MS) return;

    this.targetPos.set(sample.x, sample.y, sample.z);
    this.targetYaw = sample.yaw;
    this.lastSampleAt = Date.now();
    this.samplesReceived++;
    // A fresh transform is positive evidence the opponent is still there.
    this.remotePresent = true;
    this.remoteLeft = false;
    this.presenceLostAt = 0;

    if (!this.hasTarget) {
      // First sample after (re)appearing: snap rather than slide across the map.
      this.currentPos.copy(this.targetPos);
      this.currentYaw = this.targetYaw;
      this.hasTarget = true;
    }
  }

  /**
   * Presence authority from the room. This — not packet age — decides whether
   * the opponent still exists. `false` starts a grace period; only a confirmed
   * leave (`markRemoteLeft`) removes the ghost immediately.
   */
  public setRemotePresent(present: boolean): void {
    if (present === this.remotePresent) return;
    this.remotePresent = present;
    if (present) {
      this.remoteLeft = false;
      this.presenceLostAt = 0;
    } else {
      this.presenceLostAt = Date.now();
    }
  }

  /** Positive evidence the opponent left the room. Removes the ghost at once. */
  public markRemoteLeft(): void {
    this.remoteLeft = true;
    this.remotePresent = false;
    this.presenceLostAt = Date.now();
  }

  /** The opponent's current lifecycle state. Pure read; safe every frame. */
  public getState(now = Date.now()): RemoteGhostState {
    if (this.remoteLeft) return 'DISCONNECTED';
    if (!this.remotePresent && now - this.presenceLostAt > PRESENCE_GRACE_MS) {
      return 'DISCONNECTED';
    }
    if (!this.hasTarget) return 'NO_SAMPLE';
    if (now - this.lastSampleAt > LIVE_MS) return 'STALE_HOLD';
    return 'LIVE';
  }

  public update(dt: number, localPosition?: THREE.Vector3): void {
    const now = Date.now();
    const state = this.getState(now);

    if (state === 'DISCONNECTED') {
      this.visual.setVisible(false);
      return;
    }
    if (state === 'NO_SAMPLE') {
      // Opponent known to be present but no transform yet: nothing to draw.
      this.visual.setVisible(false);
      return;
    }

    if (state === 'STALE_HOLD') {
      // FREEZE at the last genuinely received transform. No extrapolation, no
      // invented velocity, no replay of a previous trajectory.
      this.stateScale = STALE_OPACITY_SCALE;
      this.applyOpacity();
      this.visual.setTransform(
        this.currentPos.x,
        this.currentPos.y,
        this.currentPos.z,
        this.currentYaw
      );
      this.visual.setVisible(true);
      this.measureDistance(localPosition);
      return;
    }

    // LIVE: normal interpolation towards the newest transform.
    this.stateScale = 1;
    this.applyOpacity();

    const t = Math.min(1, dt * POSITION_LERP);
    this.currentPos.lerp(this.targetPos, t);

    // Shortest-arc yaw interpolation.
    let delta = this.targetYaw - this.currentYaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.currentYaw += delta * Math.min(1, dt * YAW_LERP);

    this.visual.setTransform(
      this.currentPos.x,
      this.currentPos.y,
      this.currentPos.z,
      this.currentYaw
    );
    this.visual.setVisible(true);
    this.measureDistance(localPosition);
  }

  private measureDistance(localPosition?: THREE.Vector3): void {
    if (!localPosition) return;
    this.distanceM = Math.hypot(
      this.currentPos.x - localPosition.x,
      this.currentPos.y - localPosition.y,
      this.currentPos.z - localPosition.z
    );
  }

  private applyOpacity(): void {
    this.visual.setOpacityScale(this.effectScale * this.stateScale);
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
    this.effectScale = scale;
    this.applyOpacity();
  }

  public setVisible(visible: boolean): void {
    this.visual.setVisible(visible && this.getState() !== 'DISCONNECTED' && this.hasTarget);
  }

  /** True while a live or held opponent is being drawn. */
  public isShowing(now = Date.now()): boolean {
    const state = this.getState(now);
    return state === 'LIVE' || state === 'STALE_HOLD';
  }

  public getDiagnostics(now = Date.now()): RemoteGhostDiagnostics {
    const state = this.getState(now);
    return {
      state,
      hasTarget: this.hasTarget,
      visible: state === 'LIVE' || state === 'STALE_HOLD',
      holding: state === 'STALE_HOLD',
      sampleAgeMs: this.hasTarget ? now - this.lastSampleAt : 0,
      samplesReceived: this.samplesReceived,
      distanceM: this.distanceM,
      color: this.color,
      remotePresent: this.remotePresent,
      remoteLeft: this.remoteLeft
    };
  }

  public clear(): void {
    this.hasTarget = false;
    this.samplesReceived = 0;
    this.distanceM = null;
    this.lastSampleAt = 0;
    this.presenceLostAt = 0;
    this.remotePresent = true;
    this.remoteLeft = false;
    this.stateScale = 1;
    this.visual.setVisible(false);
  }

  public dispose(): void {
    this.visual.dispose();
  }
}
