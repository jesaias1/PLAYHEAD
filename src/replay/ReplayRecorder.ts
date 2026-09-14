/**
 * Replay recorder recording player position and orientation at 25 Hz
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
