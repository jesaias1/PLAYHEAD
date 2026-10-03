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
 *
 * ============================================================================
 * DEV PROBES
 * ============================================================================
 *
 * Three DEV-only switches exist to make the next two-browser test conclusive.
 * They are off in production and change nothing about the shipped presentation:
 *
 *   REMOTE DEBUG MARKER   an unmistakable magenta wireframe cube, rendered as a
 *                         SCENE SIBLING at the raw received transform. It
 *                         bypasses GhostVisual entirely, so it separates "the
 *                         transform/scene path is wrong" from "the ghost visual
 *                         is wrong". It is deliberately a sibling and not a
 *                         child: a child of an invisible group would inherit the
 *                         invisibility and prove nothing.
 *   REMOTE DEBUG OFFSET   renders both marker and ghost 1.5 m to the side, for
 *                         the exact-overlap case where two players share a spawn.
 *   FORCE REMOTE VISIBLE  bypasses state gating, hold dimming and effect scaling
 *                         while still using the real remote transform.
 */

import * as THREE from 'three';
import type { GhostSample } from './RaceRoomService';
import { GhostVisual } from '../replay/GhostVisual';
import { tagWorldRole } from '../world/WorldRoles';

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
const STAGING_SLOTS = [0, 1.15, -1.15, 2.3, -2.3, 3.45, -3.45, 4.6] as const;

/** Rival signal colour. Matches the rival HUD accent so the identity is one thing. */
export const RIVAL_SIGNAL_COLOR = 0x9d8cff;
/** Guest signal colour: violet/pink blueprint. */
export const GUEST_SIGNAL_COLOR = RIVAL_SIGNAL_COLOR;
/** Host signal colour: cool signal cyan, matching the host HUD accent. */
export const HOST_SIGNAL_COLOR = 0x00f0ff;

/** DEV debug marker identity: unmistakable, never used by shipped presentation. */
export const DEBUG_MARKER_COLOR = 0xff00ff;
/** DEV debug marker side length, in metres. */
export const DEBUG_MARKER_SIZE = 1;
/** DEV visual-only lateral offset, for the exact-overlap case. */
export const DEBUG_OFFSET_X = 1.5;

/** Explicit remote-opponent lifecycle state. */
export type RemoteGhostState = 'NO_SAMPLE' | 'LIVE' | 'STALE_HOLD' | 'DISCONNECTED';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

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

  // -- DEV probe surface ----------------------------------------------------
  /** The raw received transform, exactly as it arrived. Null before any sample. */
  rxPosition: Vec3Like | null;
  /** The ghost root's local position. */
  ghostLocal: Vec3Like;
  /** The ghost root's world position, read from matrixWorld. */
  ghostWorld: Vec3Like;
  /** True when the ghost root is attached to a scene. */
  attached: boolean;
  /** True when the ghost root's `visible` flag is set. */
  rootVisible: boolean;
  rootScale: Vec3Like;
  /** How many meshes the ghost root actually owns. Zero means nothing can draw. */
  childCount: number;
  /** Camera distance to the ghost, in metres. */
  cameraDistanceM: number | null;
  /** Whether the ghost root is inside the camera frustum. */
  frustum: 'IN' | 'OUT' | 'UNKNOWN';
  /** `camera.layers.mask`, or null without a camera. */
  cameraLayerMask: number | null;
  ghostLayerMask: number;
  /** Final body opacity actually applied to the material. */
  materialAlpha: number;
  materialVisible: boolean;
  frustumCulled: boolean;
  debugMarker: 'OFF' | 'VISIBLE' | 'HIDDEN';
  debugOffset: boolean;
  forceVisible: boolean;
}

export class RemoteGhostRenderer {
  public group: THREE.Group;

  private visual: GhostVisual;
  private scene: THREE.Scene;

  private hasTarget = false;
  private targetPos = new THREE.Vector3();
  private targetYaw = 0;
  /** Last genuinely received transform. STALE_HOLD freezes here. */
  private currentPos = new THREE.Vector3();
  private currentYaw = 0;
  private lastSampleAt = 0;
  private samplesReceived = 0;
  private lastSequence = -1;
  private teleportId: number | undefined;
  private readonly samples: { at: number; x: number; y: number; z: number; yaw: number }[] = [];
  private interpolationAt = 0;
  private distanceM: number | null = null;
  private color = RIVAL_SIGNAL_COLOR;
  private effectScale = 1;
  private stateScale = 1;

  /** Presence authority, as reported by the room. */
  private remotePresent = true;
  private remoteLeft = false;
  private presenceLostAt = 0;

  // -- DEV probes -----------------------------------------------------------
  private debugMarker: THREE.Mesh | null = null;
  private debugMarkerOn = false;
  private debugOffsetOn = false;
  private forceVisibleOn = false;
  /**
   * COMPETITIVE STAGING OFFSET. When the remote opponent stands on the SAME
   * spawn point as the local player, two identical capsules overlap and neither
   * is discernible. In an actual race (not the recorded solo ghost) the remote
   * capsule is nudged laterally a fixed, deterministic amount so both bodies are
   * unmistakably visible. Presentation only: the offset is applied at render
   * time and never leaks into the stored transform, interpolation or network.
   */
  private stagingOffsetOn = false;
  private stagingOffsetX = 1.15;
  private stagingOffsetZ = 0;
  private nameLabel: THREE.Sprite | null = null;
  private displayName = '';
  public static readonly STAGING_LATERAL_OFFSET = 1.15;

  constructor(scene: THREE.Scene, color = RIVAL_SIGNAL_COLOR) {
    this.color = color;
    this.scene = scene;
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
    if (sample.sequence !== undefined && sample.sequence <= this.lastSequence) return;
    if (sample.sequence !== undefined) this.lastSequence = sample.sequence;
    const discontinuity = sample.teleportId !== undefined && sample.teleportId !== this.teleportId;
    this.teleportId = sample.teleportId;
    if (discontinuity) {
      this.samples.length = 0;
      this.hasTarget = false;
    }
    this.samples.push({ at: Date.now(), x: sample.x, y: sample.y, z: sample.z, yaw: sample.yaw });
    if (this.samples.length === 1) this.interpolationAt = Date.now() - 100;
    if (this.samples.length > 8) this.samples.shift();

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

    // DEV force mode: still driven by the real remote transform, but with every
    // gate, dim and effect scale bypassed, so "nothing is drawn" can never be an
    // alpha or state artefact.
    if (this.forceVisibleOn) {
      this.stateScale = 1;
      this.visual.setOpacityScale(1);
      if (this.hasTarget) {
        this.advanceInterpolation(dt);
        this.applyRenderPosition();
        this.visual.setVisible(true);
        this.measureDistance(localPosition);
      } else {
        this.visual.setVisible(false);
      }
      this.syncDebugMarker();
      return;
    }

    if (state === 'DISCONNECTED') {
      this.visual.setVisible(false);
      this.syncDebugMarker();
      return;
    }
    if (state === 'NO_SAMPLE') {
      // Opponent known to be present but no transform yet: nothing to draw.
      this.visual.setVisible(false);
      this.syncDebugMarker();
      return;
    }

    if (state === 'STALE_HOLD') {
      // FREEZE at the last genuinely received transform. No extrapolation, no
      // invented velocity, no replay of a previous trajectory.
      this.stateScale = STALE_OPACITY_SCALE;
      this.applyOpacity();
      this.applyRenderPosition();
      this.visual.setVisible(true);
      this.measureDistance(localPosition);
      this.syncDebugMarker();
      return;
    }

    // LIVE: normal interpolation towards the newest transform.
    this.stateScale = 1;
    this.applyOpacity();
    this.advanceInterpolation(dt);
    this.applyRenderPosition();
    this.visual.setVisible(true);
    this.measureDistance(localPosition);
    this.syncDebugMarker();
  }

  /** Moves the interpolated pose towards the newest received transform. */
  private advanceInterpolation(dt: number): void {
    this.interpolationAt = Math.max(this.interpolationAt + Math.max(0, dt) * 1000, Date.now() - 100);
    if (this.samples.length >= 2) {
      const renderAt = this.interpolationAt;
      while (this.samples.length > 2 && this.samples[1].at <= renderAt) this.samples.shift();
      const a = this.samples[0], b = this.samples[1];
      const alpha = Math.max(0, Math.min(1, (renderAt - a.at) / Math.max(1, b.at - a.at)));
      this.currentPos.set(a.x + (b.x-a.x)*alpha, a.y + (b.y-a.y)*alpha, a.z + (b.z-a.z)*alpha);
      const delta = Math.atan2(Math.sin(b.yaw-a.yaw), Math.cos(b.yaw-a.yaw));
      this.currentYaw = a.yaw + delta * alpha;
      return;
    }
    const t = Math.min(1, dt * POSITION_LERP);
    this.currentPos.lerp(this.targetPos, t);

    // Shortest-arc yaw interpolation.
    let delta = this.targetYaw - this.currentYaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.currentYaw += delta * Math.min(1, dt * YAW_LERP);
  }

  /**
   * Writes the rendered pose. The DEV offset is applied HERE and only here, so it
   * can never leak into the stored transform, the interpolation or the network.
   */
  private applyRenderPosition(): void {
    const dx =
      (this.debugOffsetOn ? DEBUG_OFFSET_X : 0) +
      (this.stagingOffsetOn ? this.stagingOffsetX : 0);
    this.visual.setTransform(
      this.currentPos.x + dx,
      this.currentPos.y,
      this.currentPos.z + (this.stagingOffsetOn ? this.stagingOffsetZ : 0),
      this.currentYaw
    );
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

  // -- DEV probes -----------------------------------------------------------

  /**
   * DEV: an unmistakable magenta wireframe cube at the raw received transform.
   *
   * Added as a SCENE SIBLING, not a child of the ghost group: a child of an
   * invisible or detached group would inherit the fault and prove nothing. It
   * bypasses GhostVisual, materials, opacity and state entirely.
   */
  public setDebugMarker(enabled: boolean): void {
    this.debugMarkerOn = enabled;
    if (!enabled) {
      if (this.debugMarker) {
        this.debugMarker.removeFromParent();
        this.debugMarker.geometry.dispose();
        (this.debugMarker.material as THREE.Material).dispose();
        this.debugMarker = null;
      }
      return;
    }
    if (this.debugMarker) return;

    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(DEBUG_MARKER_SIZE, DEBUG_MARKER_SIZE, DEBUG_MARKER_SIZE),
      new THREE.MeshBasicMaterial({
        color: DEBUG_MARKER_COLOR,
        wireframe: true,
        side: THREE.DoubleSide
      })
    );
    marker.name = 'RemoteDebugMarker';
    marker.visible = false;
    // A debug marker must never be culled: its whole job is to be seen.
    marker.frustumCulled = false;
    // Same safety contract as the ghost: presentation, outside world safety.
    tagWorldRole(marker, 'IGNORE_WORLD_SAFETY', 'RemoteDebugMarker', true);
    marker.userData.devHelper = true;
    this.scene.add(marker);
    this.debugMarker = marker;
  }

  public setDebugOffset(enabled: boolean): void {
    this.debugOffsetOn = enabled;
  }

  public setForceVisible(enabled: boolean): void {
    this.forceVisibleOn = enabled;
  }

  /** Enables the deterministic competitive staging offset (see field docs). */
  public setStagingOffset(enabled: boolean): void {
    this.stagingOffsetOn = enabled;
  }

  public setStagingOffsetX(x: number): void { this.stagingOffsetX = x; }
  public setStagingOffsetZ(z: number): void { this.stagingOffsetZ = z; }
  public copyInterpolatedPosition(out: THREE.Vector3): boolean {
    if (!this.hasTarget) return false;
    out.copy(this.currentPos);
    return true;
  }

  public setDisplayName(name: string): void {
    if (name === this.displayName || typeof document === 'undefined') return;
    this.displayName = name;
    if (this.nameLabel) {
      this.group.remove(this.nameLabel);
      this.nameLabel.material.map?.dispose();
      this.nameLabel.material.dispose();
    }
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 40;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#000000bb'; ctx.fillRect(0, 0, 256, 40);
    ctx.font = '18px monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = '#' + this.color.toString(16).padStart(6, '0');
    ctx.fillText(name.slice(0, 24), 128, 27, 242);
    const texture = new THREE.CanvasTexture(canvas);
    this.nameLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: .75 }));
    this.nameLabel.position.set(0, 2.1, 0);
    this.nameLabel.scale.set(2.8, .44, 1);
    this.group.add(this.nameLabel);
  }

  public isStagingOffsetEnabled(): boolean {
    return this.stagingOffsetOn;
  }

  public isDebugMarkerEnabled(): boolean {
    return this.debugMarkerOn;
  }

  public isDebugOffsetEnabled(): boolean {
    return this.debugOffsetOn;
  }

  public isForceVisibleEnabled(): boolean {
    return this.forceVisibleOn;
  }

  /** Keeps the debug marker on the raw received transform. */
  private syncDebugMarker(): void {
    if (!this.debugMarker) return;
    if (!this.hasTarget) {
      this.debugMarker.visible = false;
      return;
    }
    const dx =
      (this.debugOffsetOn ? DEBUG_OFFSET_X : 0) +
      (this.stagingOffsetOn ? RemoteGhostRenderer.STAGING_LATERAL_OFFSET : 0);
    this.debugMarker.position.set(
      this.targetPos.x + dx,
      this.targetPos.y,
      this.targetPos.z
    );
    this.debugMarker.visible = true;
  }

  // -- Presentation API -----------------------------------------------------

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

  public getDiagnostics(now = Date.now(), camera?: THREE.Camera | null): RemoteGhostDiagnostics {
    const state = this.getState(now);
    this.group.updateWorldMatrix(true, false);
    const world = new THREE.Vector3().setFromMatrixPosition(this.group.matrixWorld);

    let frustum: 'IN' | 'OUT' | 'UNKNOWN' = 'UNKNOWN';
    let cameraDistanceM: number | null = null;
    let cameraLayerMask: number | null = null;
    if (camera) {
      cameraLayerMask = camera.layers.mask;
      cameraDistanceM = camera.position.distanceTo(world);
      const matrix = new THREE.Matrix4().multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse
      );
      const planes = new THREE.Frustum().setFromProjectionMatrix(matrix);
      // Test the MESHES, not the group: a Group owns no geometry, so
      // `intersectsObject(group)` throws. Any visible mesh inside means the
      // opponent is on screen.
      const meshes = this.group.children.filter(
        (c) => (c as THREE.Mesh).isMesh
      ) as THREE.Mesh[];
      frustum = meshes.some((m) => {
        m.updateWorldMatrix(true, false);
        return planes.intersectsObject(m);
      })
        ? 'IN'
        : 'OUT';
    }

    const body = this.visual.group.children[0] as THREE.Mesh | undefined;
    const material = body?.material as THREE.MeshBasicMaterial | undefined;

    return {
      state,
      hasTarget: this.hasTarget,
      visible: state === 'LIVE' || state === 'STALE_HOLD' || (this.forceVisibleOn && this.hasTarget),
      holding: state === 'STALE_HOLD',
      sampleAgeMs: this.hasTarget ? now - this.lastSampleAt : 0,
      samplesReceived: this.samplesReceived,
      distanceM: this.distanceM,
      color: this.color,
      remotePresent: this.remotePresent,
      remoteLeft: this.remoteLeft,
      rxPosition: this.hasTarget
        ? { x: this.targetPos.x, y: this.targetPos.y, z: this.targetPos.z }
        : null,
      ghostLocal: {
        x: this.group.position.x,
        y: this.group.position.y,
        z: this.group.position.z
      },
      ghostWorld: { x: world.x, y: world.y, z: world.z },
      attached: this.group.parent !== null,
      rootVisible: this.group.visible,
      rootScale: {
        x: this.group.scale.x,
        y: this.group.scale.y,
        z: this.group.scale.z
      },
      childCount: this.group.children.length,
      cameraDistanceM,
      frustum,
      cameraLayerMask,
      ghostLayerMask: this.group.layers.mask,
      materialAlpha: material ? material.opacity : 0,
      materialVisible: material ? material.visible : false,
      frustumCulled: body ? body.frustumCulled : true,
      debugMarker: !this.debugMarkerOn
        ? 'OFF'
        : this.debugMarker?.visible
          ? 'VISIBLE'
          : 'HIDDEN',
      debugOffset: this.debugOffsetOn,
      forceVisible: this.forceVisibleOn
    };
  }

  public clear(): void {
    this.samples.length = 0;
    this.lastSequence = -1;
    this.teleportId = undefined;
    this.hasTarget = false;
    this.samplesReceived = 0;
    this.distanceM = null;
    this.lastSampleAt = 0;
    this.presenceLostAt = 0;
    this.remotePresent = true;
    this.remoteLeft = false;
    this.stateScale = 1;
    this.visual.setVisible(false);
    this.syncDebugMarker();
  }

  public dispose(): void {
    if (this.nameLabel) {
      this.nameLabel.material.map?.dispose();
      this.nameLabel.material.dispose();
      this.group.remove(this.nameLabel);
      this.nameLabel = null;
    }
    this.setDebugMarker(false);
    this.visual.dispose();
  }
}

// ===========================================================================
// ONLINE RACE 2.0 — MULTIPLE REMOTE RACERS
//
// A 2-8 player race needs up to SEVEN simultaneous remote racers. Each one is
// the SAME cheap GhostVisual used for the single opponent, keyed by stable
// userId and drawn with a distinct, stable accent so the racers never merge.
// The manager owns presence, per-racer sampling, interpolation and cleanup; the
// local simulation and the remote renderers never share state.
// ===========================================================================

/**
 * Stable race accents, indexed by the server-assigned colour index (0..7).
 * Chosen to stay readable against the track palette and to remain distinct from
 * one another without relying on hue alone.
 */
export const RACE_ACCENT_COLORS: readonly number[] = [
  0x00f0ff, // 0 signal cyan
  0x9d8cff, // 1 violet
  0x4dffb8, // 2 green
  0xffb020, // 3 amber
  0xff5d9d, // 4 pink
  0xff6b3d, // 5 orange
  0x7ad7ff, // 6 ice blue
  0xd0ff4d // 7 acid lime
];

/** Deterministic accent for a colour index; wraps modulo the palette length. */
export function accentColorFor(index: number): number {
  const i = Number.isFinite(index) ? Math.abs(Math.floor(index)) : 0;
  return RACE_ACCENT_COLORS[i % RACE_ACCENT_COLORS.length];
}

export interface RemoteRacerState {
  userId: string;
  colorIndex: number;
  state: RemoteGhostState;
  showing: boolean;
  samplesReceived: number;
}

/**
 * Owns one RemoteGhostRenderer per remote racer.
 *
 * Allocation discipline: the per-racer renderer is created once and reused for
 * the whole race. A racer leaves and rejoins the same room reusing the SAME
 * entry, so no churn occurs at 12 Hz. Everything here is presentation-only.
 */
export class RemoteRacerGhosts {
  private readonly scene: THREE.Scene;
  private readonly ghosts = new Map<string, RemoteGhostRenderer>();
  private readonly colorIndexByUser = new Map<string, number>();
  private localColorIndex = 0;
  private effectScale = 1;
  private staging = true;
  private stagingYaw = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Cheap: no sample is stored until the first real transform arrives. */
  public setSample(sample: GhostSample): void {
    const ghost = this.ensure(sample.userId, sample.colorIndex);
    ghost.setSample(sample);
  }

  /** Presence authority from the room for one racer. */
  public setRemotePresent(userId: string, present: boolean): void {
    this.ghosts.get(userId)?.setRemotePresent(present);
  }

  public setLocalColorIndex(index: number): void { this.localColorIndex = index; }
  public setStaging(active: boolean, yaw: number): void { this.staging = active; this.stagingYaw = yaw; }
  public setDisplayName(userId: string, name: string): void { this.ghosts.get(userId)?.setDisplayName(name); }
  public copyPosition(userId: string, out: THREE.Vector3): boolean {
    return this.ghosts.get(userId)?.copyInterpolatedPosition(out) ?? false;
  }

  /** Positive evidence a racer left / DNF'd: hide their ghost immediately. */
  public markRemoteLeft(userId: string): void {
    const ghost = this.ghosts.get(userId);
    if (!ghost) return;
    ghost.markRemoteLeft();
  }

  /** Drops every renderer whose racer is no longer in the provided id set. */
  public retainOnly(userIds: ReadonlySet<string>): void {
    for (const [userId, ghost] of this.ghosts) {
      if (!userIds.has(userId)) {
        ghost.clear();
        ghost.dispose();
        this.ghosts.delete(userId);
        this.colorIndexByUser.delete(userId);
      }
    }
  }

  public update(dt: number, localPosition?: THREE.Vector3): void {
    for (const [id, ghost] of this.ghosts) {
      const lateral = STAGING_SLOTS[this.colorIndexByUser.get(id) ?? 0] - STAGING_SLOTS[this.localColorIndex];
      ghost.setStagingOffset(this.staging);
      ghost.setStagingOffsetX(Math.cos(this.stagingYaw) * lateral - Math.sin(this.stagingYaw) * 4);
      ghost.setStagingOffsetZ(-Math.sin(this.stagingYaw) * lateral - Math.cos(this.stagingYaw) * 4);
      ghost.update(dt, localPosition);
    }
  }

  public setEffectScale(scale: number): void {
    this.effectScale = scale;
    for (const ghost of this.ghosts.values()) ghost.setEffectScale(scale);
  }

  /** DEV: notifies every per-racer renderer of the probe switch (presentation only). */
  public setDebugMarker(enabled: boolean): void {
    for (const ghost of this.ghosts.values()) ghost.setDebugMarker(enabled);
  }

  public setDebugOffset(enabled: boolean): void {
    for (const ghost of this.ghosts.values()) ghost.setDebugOffset(enabled);
  }

  public setForceVisible(enabled: boolean): void {
    for (const ghost of this.ghosts.values()) ghost.setForceVisible(enabled);
  }

  public debugMarkerEnabled(): boolean {
    for (const ghost of this.ghosts.values()) return ghost.isDebugMarkerEnabled();
    return false;
  }

  public debugOffsetEnabled(): boolean {
    for (const ghost of this.ghosts.values()) return ghost.isDebugOffsetEnabled();
    return false;
  }

  public forceVisibleEnabled(): boolean {
    for (const ghost of this.ghosts.values()) return ghost.isForceVisibleEnabled();
    return false;
  }

  public isStagingOffsetEnabled(): boolean {
    for (const ghost of this.ghosts.values()) return ghost.isStagingOffsetEnabled();
    return true;
  }

  public isShowingAny(now = Date.now()): boolean {
    for (const ghost of this.ghosts.values()) {
      if (ghost.isShowing(now)) return true;
    }
    return false;
  }

  public hasSample(userId: string): boolean {
    const ghost = this.ghosts.get(userId);
    return ghost !== undefined && ghost.getDiagnostics().hasTarget;
  }

  /** Diagnostics for one racer, or null when that racer has no renderer. */
  public diagnosticsFor(
    userId: string,
    now = Date.now(),
    camera?: THREE.Camera | null
  ): RemoteGhostDiagnostics | null {
    return this.ghosts.get(userId)?.getDiagnostics(now, camera) ?? null;
  }

  public getCount(): number {
    return this.ghosts.size;
  }

  public colorIndexFor(userId: string): number | null {
    return this.colorIndexByUser.get(userId) ?? null;
  }

  public states(now = Date.now()): RemoteRacerState[] {
    const out: RemoteRacerState[] = [];
    for (const [userId, ghost] of this.ghosts) {
      const diag = ghost.getDiagnostics(now);
      out.push({
        userId,
        colorIndex: this.colorIndexByUser.get(userId) ?? 0,
        state: diag.state,
        showing: ghost.isShowing(now),
        samplesReceived: diag.samplesReceived
      });
    }
    return out;
  }

  public clear(): void {
    for (const ghost of this.ghosts.values()) {
      ghost.clear();
      ghost.dispose();
    }
    this.ghosts.clear();
    this.colorIndexByUser.clear();
  }

  private ensure(userId: string, colorIndex: number): RemoteGhostRenderer {
    let ghost = this.ghosts.get(userId);
    if (!ghost) {
      ghost = new RemoteGhostRenderer(this.scene, accentColorFor(colorIndex));
      // COMPETITIVE STAGING: racers may share the exact start node. A fixed
      // deterministic lateral offset stops the identical capsules from
      // overlapping into one indistinguishable blob. Presentation only.
      ghost.setStagingOffset(true);
      ghost.setEffectScale(this.effectScale);
      this.ghosts.set(userId, ghost);
      this.colorIndexByUser.set(userId, colorIndex);
      return ghost;
    }
    // A colour index can only change before the race locks; re-check cheaply.
    if (this.colorIndexByUser.get(userId) !== colorIndex) {
      this.colorIndexByUser.set(userId, colorIndex);
      ghost.setColor(accentColorFor(colorIndex));
    }
    return ghost;
  }
}
