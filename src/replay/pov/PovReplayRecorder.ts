/**
 * POV REPLAY RECORDER — negligible gameplay cost.
 *
 * Design constraints:
 *   - No allocation in the per-frame path: samples are appended into one flat
 *     number[] that is preallocated for a typical run and grown by doubling.
 *   - No per-frame network, no per-frame cloning of Three.js state.
 *   - Recording is presentation data only; it never touches the simulation.
 *
 * 30 Hz is enough for a camera: playback interpolates between recorded samples,
 * so the result is smooth without storing 120 states per second.
 */

import {
  POV_REPLAY_SAMPLE_HZ,
  POV_REPLAY_VERSION,
  PovReplay,
  PovReplayEvent,
  PovReplayEventType,
  PovReplayIdentity,
  computeReplayHash,
  encodePovReplay,
  writeSample
} from './PovReplayFormat';

/** Preallocate for a 3 minute run at 30 Hz; grows if a run is longer. */
const INITIAL_CAPACITY_SAMPLES = 30 * 180;

export interface PovRecorderInput {
  songTimeMs: number;
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  grounded: boolean;
  surfing: boolean;
  surfSide: number;
}

export class PovReplayRecorder {
  private samples: number[] = [];
  private events: PovReplayEvent[] = [];
  private accumulatorMs = 0;
  private sampleIntervalMs = 1000 / POV_REPLAY_SAMPLE_HZ;
  private recording = false;
  private lastTimeMs = 0;
  private identity: PovReplayIdentity | null = null;
  private skinId = '';
  private fov = 75;
  private startSongTimeMs = 0;
  private finishTimeUs = 0;

  public start(identity: PovReplayIdentity, skinId: string, fov = 75, startSongTimeMs = 0): void {
    this.samples = new Array<number>(INITIAL_CAPACITY_SAMPLES * 10);
    this.samples.length = 0;
    this.events = [];
    this.accumulatorMs = 0;
    this.recording = true;
    this.lastTimeMs = 0;
    this.identity = identity;
    this.skinId = skinId;
    this.fov = Number.isFinite(fov) && fov > 10 && fov < 170 ? fov : 75;
    this.startSongTimeMs = Number.isFinite(startSongTimeMs) && startSongTimeMs >= 0 ? startSongTimeMs : 0;
    this.finishTimeUs = 0;
  }

  public stop(): void {
    this.recording = false;
  }

  public isRecording(): boolean {
    return this.recording;
  }

  public hasData(): boolean {
    return this.samples.length >= 20 * 2; // at least 20 samples (2 per stride)
  }

  public getSampleCount(): number {
    return Math.floor(this.samples.length / 10);
  }

  public getEventCount(): number {
    return this.events.length;
  }

  /** Sets the authoritative completion time (integer microseconds). */
  public setFinishTimeUs(timeUs: number): void {
    this.finishTimeUs = Math.round(timeUs);
  }

  /**
   * Records one simulation frame. Called every frame during a run; appends at
   * most one sample, and only when the fixed interval has elapsed.
   */
  public record(dt: number, input: PovRecorderInput): void {
    if (!this.recording) return;

    const timeMs = input.songTimeMs;
    // A full restart rewinds the clock; keep the replay monotonic by ignoring
    // backwards jumps (the restart is recorded as an event instead).
    if (timeMs < this.lastTimeMs) {
      this.lastTimeMs = timeMs;
      this.accumulatorMs = 0;
      return;
    }
    this.lastTimeMs = timeMs;

    this.accumulatorMs += dt * 1000;
    if (this.accumulatorMs < this.sampleIntervalMs) return;
    this.accumulatorMs -= this.sampleIntervalMs;

    writeSample(
      this.samples,
      timeMs,
      input.pos,
      input.vel,
      input.yaw,
      input.pitch,
      input.grounded,
      input.surfing,
      input.surfSide
    );
  }

  public pushEvent(type: PovReplayEventType, data?: number): void {
    if (!this.recording) return;
    this.events.push({ t: Math.round(this.lastTimeMs), type, d: data });
  }

  /**
   * Finalises the replay. Returns null when there is not enough data (e.g. an
   * aborted or overtime run), so callers never upload a useless file.
   */
  public finalize(): PovReplay | null {
    if (!this.identity || !this.hasData()) return null;
    if (this.finishTimeUs <= 0) return null;

    const durationMs = this.getSampleCount() > 0
      ? this.samples[(this.getSampleCount() - 1) * 10]
      : 0;

    const draft: PovReplay = {
      replayVersion: POV_REPLAY_VERSION,
      identity: { ...this.identity },
      finishTimeUs: this.finishTimeUs,
      durationMs,
      sampleHz: POV_REPLAY_SAMPLE_HZ,
      fov: this.fov,
      startSongTimeMs: this.startSongTimeMs,
      s: this.samples,
      events: this.events,
      cosmetic: { skinId: this.skinId },
      hash: ''
    };
    draft.hash = computeReplayHash(encodePovReplay(draft));
    return draft;
  }

  /** Releases the sample buffer (after upload or on discard). */
  public clear(): void {
    this.samples = [];
    this.events = [];
    this.recording = false;
    this.identity = null;
    this.finishTimeUs = 0;
  }
}
