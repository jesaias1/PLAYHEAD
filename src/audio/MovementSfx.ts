/**
 * MovementSfx — original PLAYHEAD movement feedback sound design.
 *
 * Synthesized with the Web Audio API (same architecture as SignalDecoderAudio):
 * no external audio files, small and stylistically consistent with PLAYHEAD's
 * mechanical / signal / digital / physical palette.
 *
 * These are presentation-only. They are never read by gameplay.
 */

import { SettingsManager } from '../core/Settings';

export class MovementSfx {
  private static instance: MovementSfx;
  private ctx: AudioContext | null = null;

  // Persistent wind / air layer (reused, never recreated per frame).
  private windSource: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private windLevel = 0;

  private constructor() {}

  public static getInstance(): MovementSfx {
    if (!MovementSfx.instance) {
      MovementSfx.instance = new MovementSfx();
    }
    return MovementSfx.instance;
  }

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx || this.ctx.state === 'closed') {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private master(): number {
    try {
      return SettingsManager.getInstance().settings.masterVolume;
    } catch {
      return 0.8;
    }
  }

  private makeNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Deterministic-ish white noise; only used for texture.
    let seed = 0x9e3779b9;
    for (let i = 0; i < length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    return buffer;
  }

  /** Short peripheral whoosh for a close non-collision pass. */
  public playNearMiss(intensity: number, side = 0): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const vol = this.master() * Math.min(1, Math.max(0, intensity));
    if (vol <= 0.001) return;

    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.makeNoiseBuffer(ctx, 0.25);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.setValueAtTime(1.4, now);
    filter.frequency.setValueAtTime(1800, now);
    filter.frequency.exponentialRampToValueAtTime(420, now + 0.18);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.14 * vol, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

    let tail: AudioNode = gain;
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(Math.max(-0.85, Math.min(0.85, side)), now);
      gain.connect(panner);
      tail = panner;
    }
    src.connect(filter);
    filter.connect(gain);
    tail.connect(ctx.destination);

    src.start(now);
    src.stop(now + 0.22);
  }

  /** Landing impact. `major` adds a deeper, longer mechanical body. */
  public playLanding(intensity: number, major: boolean): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const vol = this.master() * Math.min(1, Math.max(0, intensity));
    if (vol <= 0.001) return;

    const now = ctx.currentTime;

    // Low mechanical body
    const low = ctx.createOscillator();
    const lowGain = ctx.createGain();
    low.type = 'sine';
    low.frequency.setValueAtTime(major ? 150 : 190, now);
    low.frequency.exponentialRampToValueAtTime(major ? 34 : 58, now + (major ? 0.16 : 0.07));
    lowGain.gain.setValueAtTime((major ? 0.3 : 0.16) * vol, now);
    lowGain.gain.exponentialRampToValueAtTime(0.0001, now + (major ? 0.22 : 0.1));
    low.connect(lowGain);
    lowGain.connect(ctx.destination);
    low.start(now);
    low.stop(now + (major ? 0.24 : 0.12));

    // Short physical crack
    const src = ctx.createBufferSource();
    src.buffer = this.makeNoiseBuffer(ctx, 0.12);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(major ? 900 : 1400, now);
    filter.frequency.exponentialRampToValueAtTime(260, now + 0.08);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime((major ? 0.13 : 0.07) * vol, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.1);
  }

  /** Short digital "SIGNAL LOCK" confirmation for a clean surf exit. */
  public playSurfLock(quality: number): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const vol = this.master() * Math.min(1, Math.max(0, quality));
    if (vol <= 0.001) return;

    const now = ctx.currentTime;
    const freqs = [660, 990];
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const delay = i * 0.055;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + delay);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.5, now + delay + 0.09);
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.11 * vol, now + delay + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.18);
    });
  }

  /** Decisive finish impact: signal-lock transient + low mechanical hit + tail. */
  public playFinishImpact(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const vol = this.master();
    if (vol <= 0.001) return;

    const now = ctx.currentTime;

    // Sharp signal-lock transient
    const lock = ctx.createOscillator();
    const lockGain = ctx.createGain();
    const lockFilter = ctx.createBiquadFilter();
    lock.type = 'sawtooth';
    lock.frequency.setValueAtTime(2600, now);
    lock.frequency.exponentialRampToValueAtTime(520, now + 0.05);
    lockFilter.type = 'bandpass';
    lockFilter.frequency.setValueAtTime(2200, now);
    lockFilter.Q.setValueAtTime(4.0, now);
    lockGain.gain.setValueAtTime(0.22 * vol, now);
    lockGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    lock.connect(lockFilter);
    lockFilter.connect(lockGain);
    lockGain.connect(ctx.destination);
    lock.start(now);
    lock.stop(now + 0.07);

    // Low mechanical impact
    const low = ctx.createOscillator();
    const lowGain = ctx.createGain();
    low.type = 'sine';
    low.frequency.setValueAtTime(140, now);
    low.frequency.exponentialRampToValueAtTime(32, now + 0.2);
    lowGain.gain.setValueAtTime(0.34 * vol, now);
    lowGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    low.connect(lowGain);
    lowGain.connect(ctx.destination);
    low.start(now);
    low.stop(now + 0.3);

    // Small digital tail
    const tail = ctx.createOscillator();
    const tailGain = ctx.createGain();
    tail.type = 'triangle';
    tail.frequency.setValueAtTime(1320, now + 0.05);
    tail.frequency.exponentialRampToValueAtTime(440, now + 0.3);
    tailGain.gain.setValueAtTime(0.0001, now + 0.05);
    tailGain.gain.exponentialRampToValueAtTime(0.07 * vol, now + 0.08);
    tailGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    tail.connect(tailGain);
    tailGain.connect(ctx.destination);
    tail.start(now + 0.05);
    tail.stop(now + 0.36);
  }

  /**
   * Persistent wind / air layer driven by speed. Reuses one looping source;
   * the gain is only written when it actually changes.
   */
  public setWindLevel(level: number): void {
    const target = Math.max(0, Math.min(1, level));
    if (Math.abs(target - this.windLevel) < 0.005) return;

    if (target <= 0.001 && !this.windSource) {
      this.windLevel = target;
      return;
    }

    const ctx = this.getContext();
    if (!ctx) return;

    if (!this.windSource) {
      const src = ctx.createBufferSource();
      src.buffer = this.makeNoiseBuffer(ctx, 2.0);
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(420, ctx.currentTime);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      src.start();
      this.windSource = src;
      this.windFilter = filter;
      this.windGain = gain;
    }

    const now = ctx.currentTime;
    if (this.windGain) {
      this.windGain.gain.cancelScheduledValues(now);
      this.windGain.gain.setTargetAtTime(0.11 * target * this.master(), now, 0.25);
    }
    if (this.windFilter) {
      this.windFilter.frequency.setTargetAtTime(380 + 900 * target, now, 0.3);
    }
    this.windLevel = target;
  }

  public reset(): void {
    this.setWindLevel(0);
  }

  public dispose(): void {
    try {
      this.windSource?.stop();
    } catch {
      // already stopped
    }
    this.windSource = null;
    this.windFilter = null;
    this.windGain = null;
    this.windLevel = 0;
  }
}
