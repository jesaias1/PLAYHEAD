/**
 * Audio playback engine managing AudioContext, seeking, volume, and checkpoint restoration
 */

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private currentBuffer: AudioBuffer | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private masterGain: GainNode | null = null;

  private isPlaying = false;
  private isPaused = false;
  private currentOffset = 0;
  private contextStartTime = 0;
  private volume = 0.8;

  public async init(): Promise<void> {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioContextClass();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  public setBuffer(buffer: AudioBuffer): void {
    this.stop();
    this.currentBuffer = buffer;
    this.currentOffset = 0;
  }

  public getBuffer(): AudioBuffer | null {
    return this.currentBuffer;
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
  }

  public play(startOffset = 0): void {
    if (!this.ctx || !this.currentBuffer) return;

    this.stopSource();

    this.currentOffset = Math.max(0, Math.min(startOffset, this.currentBuffer.duration));
    this.contextStartTime = this.ctx.currentTime;

    const source = this.ctx.createBufferSource();
    source.buffer = this.currentBuffer;

    // Small anti-click fade in
    const fadeGain = this.ctx.createGain();
    fadeGain.gain.setValueAtTime(0.001, this.ctx.currentTime);
    fadeGain.gain.linearRampToValueAtTime(1.0, this.ctx.currentTime + 0.03);

    source.connect(fadeGain);
    fadeGain.connect(this.masterGain!);

    source.start(0, this.currentOffset);
    this.currentSource = source;
    this.isPlaying = true;
    this.isPaused = false;

    source.onended = () => {
      if (this.currentSource === source) {
        this.isPlaying = false;
      }
    };
  }

  public pause(): void {
    if (!this.isPlaying || this.isPaused || !this.ctx) return;

    this.currentOffset = this.getCurrentTime();
    this.stopSource();
    this.isPaused = true;
    this.isPlaying = false;
  }

  public resume(): void {
    if (this.isPaused) {
      this.play(this.currentOffset);
    }
  }

  public seek(offset: number): void {
    const wasPlaying = this.isPlaying;
    this.currentOffset = offset;
    if (wasPlaying) {
      this.play(offset);
    }
  }

  public stop(): void {
    this.stopSource();
    this.isPlaying = false;
    this.isPaused = false;
    this.currentOffset = 0;
  }

  public getCurrentTime(): number {
    if (!this.ctx || !this.currentBuffer) return 0;
    if (this.isPaused) return this.currentOffset;
    if (!this.isPlaying) return this.currentOffset;

    const elapsed = this.ctx.currentTime - this.contextStartTime;
    return Math.min(this.currentOffset + elapsed, this.currentBuffer.duration);
  }

  public getDuration(): number {
    return this.currentBuffer ? this.currentBuffer.duration : 0;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  private stopSource(): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch {
        // Source might have already finished
      }
      this.currentSource = null;
    }
  }

  public dispose(): void {
    this.stop();
    this.currentBuffer = null;
  }
}
