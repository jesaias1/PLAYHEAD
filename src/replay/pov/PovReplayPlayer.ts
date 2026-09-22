/**
 * POV REPLAY PLAYER — true first-person playback of a recorded run.
 *
 * Reconstructs what the runner saw using RECORDED samples:
 *   camera position (recorded player position + frozen eye height)
 *   yaw and pitch (shortest-arc interpolated)
 *   the recorded base FOV
 *   the recorded song time, so audio and the music-reactive world stay in sync
 *   the recorded movement state (grounded / surfing / surf side / velocity)
 *   the runner's equipped cosmetic (with a safe fallback)
 *
 * It does NOT re-simulate input, so browser or device differences cannot make a
 * replay drift. There is no third-person camera, no capsule and no box here —
 * the legacy debug representation lives in DEV only.
 */

import * as THREE from 'three';
import { PLAYHEAD_MOVEMENT_V1 } from '../../player/MovementConfig';
import {
  POV_REPLAY_VERSION,
  PovReplay,
  PovReplayEvent,
  PovReplayIdentity,
  PovSample,
  decodePovReplay,
  getSampleCount,
  samplePovReplay,
  validatePovReplay
} from './PovReplayFormat';

export interface PovReplayLoadResult {
  ok: boolean;
  reason?: string;
}

/** A frame of reconstructed presentation state for the world / viewmodel. */
export interface PovReplayFrame {
  timeMs: number;
  durationMs: number;
  songTimeMs: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  yaw: number;
  pitch: number;
  fov: number;
  grounded: boolean;
  surfing: boolean;
  surfSide: number;
  speed: number;
}

export class PovReplayPlayer {
  public isPlaying = false;
  public isPaused = false;

  private replay: PovReplay | null = null;
  private currentMs = 0;
  private eventCursor = 0;
  private emitted: PovReplayEvent[] = [];
  private frame: PovReplayFrame;

  /** Fired as the playhead crosses recorded events. */
  public onEvent?: (event: PovReplayEvent) => void;
  public onComplete?: () => void;

  constructor() {
    this.frame = {
      timeMs: 0,
      durationMs: 0,
      songTimeMs: 0,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      fov: 75,
      grounded: true,
      surfing: false,
      surfSide: 0,
      speed: 0
    };
  }

  /**
   * Loads and validates a replay against the canonical map it claims to be for.
   * Playback is refused outright if the identity does not match, so a replay can
   * never be played against the wrong map.
   */
  public load(
    payload: string,
    expected: { identity: PovReplayIdentity; finishTimeUs?: number; expectedHash?: string }
  ): PovReplayLoadResult {
    const decoded = decodePovReplay(payload);
    if (!decoded.ok) return { ok: false, reason: decoded.reason };

    const validation = validatePovReplay(decoded.replay, {
      identity: expected.identity,
      finishTimeUs: expected.finishTimeUs,
      payload,
      expectedHash: expected.expectedHash
    });
    if (!validation.ok) return { ok: false, reason: `${validation.reason}: ${validation.detail}` };

    this.replay = decoded.replay;
    this.currentMs = 0;
    this.eventCursor = 0;
    this.emitted = [];
    this.isPlaying = false;
    this.isPaused = false;
    this.updateFrame(0);
    return { ok: true };
  }

  public play(): void {
    if (!this.replay) return;
    this.isPlaying = true;
    this.isPaused = false;
  }

  public pause(): void {
    this.isPaused = true;
  }

  public resume(): void {
    if (!this.replay) return;
    this.isPaused = false;
    this.isPlaying = true;
  }

  public restart(): void {
    if (!this.replay) return;
    this.currentMs = 0;
    this.eventCursor = 0;
    this.emitted = [];
    this.isPaused = false;
    this.isPlaying = true;
    this.updateFrame(0);
  }

  public stop(): void {
    this.isPlaying = false;
    this.isPaused = false;
  }

  public unload(): void {
    this.stop();
    this.replay = null;
    this.currentMs = 0;
    this.eventCursor = 0;
    this.emitted = [];
  }

  public hasReplay(): boolean {
    return this.replay !== null;
  }

  public getReplay(): PovReplay | null {
    return this.replay;
  }

  public getDurationMs(): number {
    return this.replay?.durationMs ?? 0;
  }

  public getCurrentMs(): number {
    return this.currentMs;
  }

  public getFinishTimeUs(): number {
    return this.replay?.finishTimeUs ?? 0;
  }

  /** The runner's equipped cosmetic id (may be unknown to this client). */
  public getSkinId(): string {
    return this.replay?.cosmetic.skinId ?? '';
  }

  public getStartSongTimeMs(): number {
    return this.replay?.startSongTimeMs ?? 0;
  }

  public getReplayVersion(): number {
    return this.replay?.replayVersion ?? POV_REPLAY_VERSION;
  }

  /** Events crossed so far, for presentation hooks. */
  public getEmittedEvents(): readonly PovReplayEvent[] {
    return this.emitted;
  }

  /** Advances playback and returns the reconstructed frame. */
  public update(dt: number): PovReplayFrame {
    if (!this.replay) return this.frame;
    if (this.isPlaying && !this.isPaused) {
      this.currentMs += dt * 1000;
      if (this.currentMs >= this.replay.durationMs) {
        this.currentMs = this.replay.durationMs;
        this.isPlaying = false;
        this.onComplete?.();
      }
    }
    this.updateFrame(this.currentMs);
    return this.frame;
  }

  /** Reconstructs presentation state at an arbitrary time (used for seeking). */
  public updateFrame(timeMs: number): PovReplayFrame {
    if (!this.replay) return this.frame;

    const sample: PovSample = samplePovReplay(this.replay, timeMs);

    this.frame.timeMs = timeMs;
    this.frame.durationMs = this.replay.durationMs;
    // Song time is derived from the recorded start plus run time, so audio and
    // the music-reactive world stay locked to the recording.
    this.frame.songTimeMs = this.replay.startSongTimeMs + sample.t;
    // The recorded position is the player's base; the camera sits at eye height.
    this.frame.position.set(sample.x, sample.y + PLAYHEAD_MOVEMENT_V1.eyeHeight, sample.z);
    this.frame.velocity.set(sample.vx, sample.vy, sample.vz);
    this.frame.yaw = sample.yaw;
    this.frame.pitch = sample.pitch;
    this.frame.fov = this.replay.fov;
    this.frame.grounded = sample.grounded;
    this.frame.surfing = sample.surfing;
    this.frame.surfSide = sample.surfSide;
    this.frame.speed = Math.hypot(sample.vx, sample.vy, sample.vz);

    // Emit any events the playhead has just crossed (monotonic cursor, so a
    // restart replays them and seeking backwards does not double-fire).
    while (
      this.eventCursor < this.replay.events.length &&
      this.replay.events[this.eventCursor].t <= timeMs
    ) {
      const event = this.replay.events[this.eventCursor++];
      this.emitted.push(event);
      this.onEvent?.(event);
    }

    return this.frame;
  }

  /** Deterministic trajectory sampler for tests and diagnostics. */
  public sampleAt(timeMs: number): PovSample | null {
    if (!this.replay) return null;
    return samplePovReplay(this.replay, timeMs);
  }

  public getSampleCount(): number {
    return this.replay ? getSampleCount(this.replay) : 0;
  }
}
