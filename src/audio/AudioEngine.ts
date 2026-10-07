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

  /**
   * Monotonic ownership token for the CURRENT playback attempt. Every async
   * callback that could outlive its attempt (the fade-out timeout or a source
   * `onended`) captures the token value at creation and bails out when it no
   * longer matches. This is the single mechanism that keeps a stale finish
   * fade, or an old source completing, from corrupting a fresh run.
   */
  private playbackToken = 0;
  private fadeTimer: number | null = null;

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
    this.cancelPendingFade();
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

    // A new playback supersedes any in-flight finish fade: cancel its timer
    // and restore the master gain so the fresh attempt is not left quiet.
    this.cancelPendingFade();
    this.stopSource();

    this.currentOffset = Math.max(0, Math.min(startOffset, this.currentBuffer.duration));
    this.contextStartTime = this.ctx.currentTime;
    this.isPaused = false;

    if (this.masterGain) {
      this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }

    const source = this.ctx.createBufferSource();
    source.buffer = this.currentBuffer;

    // Small anti-click fade in
    const fadeGain = this.ctx.createGain();
    fadeGain.gain.setValueAtTime(0.001, this.ctx.currentTime);
    fadeGain.gain.linearRampToValueAtTime(1.0, this.ctx.currentTime + 0.03);

    source.connect(fadeGain);
    fadeGain.connect(this.masterGain!);

    const token = ++this.playbackToken;
    source.onended = () => {
      // Only the source that still owns the current playback may complete it.
      // A stopped / replaced source (or a source from a superseded attempt)
      // must never end the run that is now playing.
      if (this.currentSource !== source || this.playbackToken !== token) return;

      // Natural completion: pin the stored clock to the buffer end so
      // getCurrentTime() reports the duration instead of resetting to the
      // start offset (which would rewind world visuals / progress in overtime).
      this.isPlaying = false;
      this.isPaused = false;
      this.currentOffset = this.currentBuffer ? this.currentBuffer.duration : this.currentOffset;
      this.currentSource = null;
      this.contextStartTime = this.ctx ? this.ctx.currentTime : this.contextStartTime;
    };

    // Own the source and mark the run live BEFORE start(), so even a
    // synchronous onended is attributed to this exact source/token.
    this.currentSource = source;
    this.isPlaying = true;
    source.start(0, this.currentOffset);
  }

  public pause(): void {
    if (!this.isPlaying || this.isPaused || !this.ctx) return;

    this.currentOffset = this.getCurrentTime();
    this.cancelPendingFade();
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
    const duration = this.getDuration();
    const bounded = Math.max(0, Math.min(offset, duration > 0 ? duration : offset));
    const wasPlaying = this.isPlaying;
    this.currentOffset = bounded;
    if (wasPlaying) {
      this.play(bounded);
    }
  }

  public fadeOutAndStop(fadeDuration = 0.25): void {
    this.cancelPendingFade();
    if (!this.isPlaying || !this.ctx || !this.masterGain) {
      this.stop();
      return;
    }
    const ctx = this.ctx;
    const gain = this.masterGain;
    const token = this.playbackToken;
    const currT = ctx.currentTime;
    gain.gain.cancelScheduledValues(currT);
    gain.gain.setValueAtTime(this.volume, currT);
    gain.gain.linearRampToValueAtTime(0.001, currT + fadeDuration);
    this.fadeTimer = window.setTimeout(() => {
      this.fadeTimer = null;
      // The timeout may only stop the playback it was scheduled for. If a
      // retry / new play / new buffer took over meanwhile, leave it alone.
      if (this.playbackToken !== token) return;
      this.stop();
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
        this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
      }
    }, fadeDuration * 1000 + 20);
  }

  public stop(): void {
    this.cancelPendingFade();
    this.stopSource();
    this.isPlaying = false;
    this.isPaused = false;
    this.currentOffset = 0;
  }

  public getCurrentTime(): number {
    if (!this.ctx || !this.currentBuffer) return 0;
    if (this.isPaused) return this.currentOffset;
    if (!this.isPlaying) return Math.min(this.currentOffset, this.currentBuffer.duration);

    const elapsed = this.ctx.currentTime - this.contextStartTime;
    return Math.min(this.currentOffset + elapsed, this.currentBuffer.duration);
  }

  public getDuration(): number {
    return this.currentBuffer ? this.currentBuffer.duration : 0;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Cancel a pending finish-fade: clears its timer and restores the master
   * gain to the configured volume. Deliberately does NOT touch playbackToken,
   * so a fade scheduled for the current attempt keeps a valid owner token.
   */
  private cancelPendingFade(): void {
    if (this.fadeTimer !== null) {
      window.clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
  }

  private stopSource(): void {
    if (this.currentSource) {
      const source = this.currentSource;
      this.currentSource = null;
      // Invalidate the natural-completion callback of this source.
      this.playbackToken++;
      try {
        source.stop();
        source.disconnect();
      } catch {
        // Source might have already finished
      }
    }
  }

  public dispose(): void {
    this.stop();
    this.currentBuffer = null;
  }
}
