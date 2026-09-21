/**
 * SignalDecoderAudio: Original procedural audio synthesizer for the
 * PLAYHEAD Signal Decoder reel and cosmetic reveal.
 *
 * Implements:
 * - Real-time mechanical/data ticks synchronized to item-crossing cadence
 * - Distinct mechanical lock / latch sound upon final card selection
 * - Rarity-tiered musical reveal accents: STANDARD < RARE < RELIC < ARTIFACT < OVERCLOCKED
 * - Volume scaled to user master volume settings
 */

import { SettingsManager } from '../core/Settings';
import { CosmeticRarity } from '../viewmodel/KarambitSkinSystem';

export class SignalDecoderAudio {
  private static instance: SignalDecoderAudio;
  private ctx: AudioContext | null = null;

  private constructor() {}

  public static getInstance(): SignalDecoderAudio {
    if (!SignalDecoderAudio.instance) {
      SignalDecoderAudio.instance = new SignalDecoderAudio();
    }
    return SignalDecoderAudio.instance;
  }

  private getContext(): AudioContext | null {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtxClass) {
        this.ctx = new AudioCtxClass();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private getMasterVolume(): number {
    try {
      return SettingsManager.getInstance().settings.masterVolume;
    } catch {
      return 0.8;
    }
  }

  /**
   * Subtle mechanical/data tick sound played whenever a reel card crosses the center reticle.
   */
  public playTick(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const masterVol = this.getMasterVolume();
    if (masterVol <= 0) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.012);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1600, now);
    filter.Q.setValueAtTime(3.0, now);

    const tickVol = 0.16 * masterVol;
    gain.gain.setValueAtTime(tickVol, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.012);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.015);
  }

  /**
   * Distinct mechanical lock / latch impact played when the reel halts on the target card.
   */
  public playLockImpact(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const masterVol = this.getMasterVolume();
    if (masterVol <= 0) return;

    const now = ctx.currentTime;

    // Body thud (low damped body)
    const lowOsc = ctx.createOscillator();
    const lowGain = ctx.createGain();
    lowOsc.type = 'sine';
    lowOsc.frequency.setValueAtTime(180, now);
    lowOsc.frequency.exponentialRampToValueAtTime(45, now + 0.045);

    lowGain.gain.setValueAtTime(0.24 * masterVol, now);
    lowGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

    lowOsc.connect(lowGain);
    lowGain.connect(ctx.destination);
    lowOsc.start(now);
    lowOsc.stop(now + 0.05);

    // Sharp mechanical latch transient
    const highOsc = ctx.createOscillator();
    const highGain = ctx.createGain();
    const highFilter = ctx.createBiquadFilter();

    highOsc.type = 'sawtooth';
    highOsc.frequency.setValueAtTime(2400, now + 0.012);
    highOsc.frequency.exponentialRampToValueAtTime(600, now + 0.035);

    highFilter.type = 'bandpass';
    highFilter.frequency.setValueAtTime(2000, now + 0.012);
    highFilter.Q.setValueAtTime(4.0, now + 0.012);

    highGain.gain.setValueAtTime(0.18 * masterVol, now + 0.012);
    highGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);

    highOsc.connect(highFilter);
    highFilter.connect(highGain);
    highGain.connect(ctx.destination);
    highOsc.start(now + 0.012);
    highOsc.stop(now + 0.04);
  }

  /**
   * Tonal/data reveal accent played when the celebration card appears.
   * Tailored to the unlocked rarity tier.
   */
  public playRevealAccent(rarity: CosmeticRarity): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const masterVol = this.getMasterVolume();
    if (masterVol <= 0) return;

    const now = ctx.currentTime;

    switch (rarity) {
      case 'OVERCLOCKED': {
        // Apex high-tech dual-layer surge: sub bass hit + resonant synth flourish
        const subOsc = ctx.createOscillator();
        const subGain = ctx.createGain();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(110, now);
        subOsc.frequency.exponentialRampToValueAtTime(35, now + 0.22);
        subGain.gain.setValueAtTime(0.32 * masterVol, now);
        subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
        subOsc.connect(subGain);
        subGain.connect(ctx.destination);
        subOsc.start(now);
        subOsc.stop(now + 0.25);

        // Sweeping resonant saw flourish
        const sawOsc = ctx.createOscillator();
        const sawFilter = ctx.createBiquadFilter();
        const sawGain = ctx.createGain();
        sawOsc.type = 'sawtooth';
        sawOsc.frequency.setValueAtTime(440, now);
        sawOsc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
        sawOsc.frequency.exponentialRampToValueAtTime(1320, now + 0.35);

        sawFilter.type = 'lowpass';
        sawFilter.frequency.setValueAtTime(800, now);
        sawFilter.frequency.exponentialRampToValueAtTime(4200, now + 0.14);
        sawFilter.frequency.exponentialRampToValueAtTime(1200, now + 0.45);
        sawFilter.Q.setValueAtTime(6.0, now);

        sawGain.gain.setValueAtTime(0.24 * masterVol, now);
        sawGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);

        sawOsc.connect(sawFilter);
        sawFilter.connect(sawGain);
        sawGain.connect(ctx.destination);
        sawOsc.start(now);
        sawOsc.stop(now + 0.5);
        break;
      }

      case 'ARTIFACT': {
        // Harmonic triad flourish with warm resonance
        const freqs = [330, 495, 660, 990];
        freqs.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const delay = idx * 0.04;
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + delay);
          gain.gain.setValueAtTime(0.12 * masterVol, now + delay);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.38);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + delay);
          osc.stop(now + delay + 0.4);
        });
        break;
      }

      case 'RELIC': {
        // Crystalline ascending arpeggio
        const freqs = [370, 466, 554, 740];
        freqs.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const delay = idx * 0.035;
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + delay);
          gain.gain.setValueAtTime(0.1 * masterVol, now + delay);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.3);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + delay);
          osc.stop(now + delay + 0.32);
        });
        break;
      }

      case 'RARE': {
        // Ascending major electronic triad
        const freqs = [440, 554, 659];
        freqs.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const delay = idx * 0.04;
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + delay);
          gain.gain.setValueAtTime(0.1 * masterVol, now + delay);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.22);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + delay);
          osc.stop(now + delay + 0.25);
        });
        break;
      }

      case 'STANDARD':
      default: {
        // Clean gentle dual chime
        const freqs = [523, 659];
        freqs.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const delay = idx * 0.03;
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + delay);
          gain.gain.setValueAtTime(0.09 * masterVol, now + delay);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.16);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + delay);
          osc.stop(now + delay + 0.18);
        });
        break;
      }
    }
  }
}
