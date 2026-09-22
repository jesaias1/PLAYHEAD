/**
 * Replay recorder recording player position and orientation at 25 Hz
 *
 * ⚠️ REPLAY DATA IS NOT YET SUFFICIENT FOR FIRST-PERSON POV REPLAY.
 *
 * PLAYHEAD replay must ultimately play back the run through the runner's own
 * eyes. That requires more than the current 7-field sample. Missing (see
 * `ReplayIdentity` and the POV Replay V1 milestone):
 *   - camera roll (surf / strafe view roll)
 *   - the equipped knife + knife skin
 *   - the viewmodel calibration snapshot (FOV, sway, accent, mode, samples)
 *   - the live camera FOV at the time of the run
 *   - presentation state: isSurfing / isGrounded / surf normal + side,
 *     strafe angle + efficiency (drives surf visuals, landing feedback, sway)
 *   - Signal Gate sequence state (crossed / passed / missed)
 *
 * The current format is kept intact so existing ghost/replay storage and any
 * already-queued leaderboard payloads stay readable. Additive fields only.
 */

export interface ReplayFrame {
  time: number;       // Run time in seconds
  px: number;
  py: number;
  pz: number;
  yaw: number;
  pitch: number;
  speed: number;
}

/**
 * Identity a replay must carry so a LEADERBOARD → WATCH RUN entry can be
 * reconstructed against the exact world it was played on. This is deliberately
 * a standalone interface (not yet part of the wire format) so the backend can
 * start carrying it without a schema break.
 */
export interface ReplayIdentity {
  trackId: string;
  /** Deterministic route generation version. */
  mapVersion: number;
  /** Content hash of the generated track (route + ramps + spines + forks). */
  mapFingerprint: string;
  /** PLAYHEAD_MOVEMENT_V1 version the run was played under. */
  movementVersion: string;
  /** Replay payload schema version. */
  replayVersion: number;
}

export class ReplayRecorder {
  public frames: ReplayFrame[] = [];
  private sampleInterval = 1 / 25; // 25 Hz
  private accumulator = 0;
  private isRecording = false;

  public start(): void {
    this.frames = [];
    this.accumulator = 0;
    this.isRecording = true;
  }

  public stop(): void {
    this.isRecording = false;
  }

  public record(
    runTime: number,
    dt: number,
    pos: { x: number; y: number; z: number },
    yaw: number,
    pitch: number,
    speed: number
  ): void {
    if (!this.isRecording) return;

    this.accumulator += dt;
    if (this.accumulator >= this.sampleInterval) {
      this.accumulator -= this.sampleInterval;
      this.frames.push({
        time: runTime,
        px: pos.x,
        py: pos.y,
        pz: pos.z,
        yaw,
        pitch,
        speed
      });
    }
  }

  public hasData(): boolean {
    return this.frames.length > 5;
  }

  public getDuration(): number {
    if (this.frames.length === 0) return 0;
    return this.frames[this.frames.length - 1].time;
  }
}
