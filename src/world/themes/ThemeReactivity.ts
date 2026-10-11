/**
 * THEME REACTIVITY — three coordinated, deliberately restrained audio layers.
 *
 *   kick     bass / kicks      -> nearby lamps lift briefly, smooth decay
 *   accent   percussion        -> an occasional small accent on one structure
 *   sustain  sustained energy  -> slow aurora / atmosphere change
 *
 * Every layer reads the EXISTING shared visual bus (MusicVisualState), is
 * rate-limited by an attack/release envelope and hard-clamped to 0..1, so no
 * input can produce a strobe or a full-scene flash. Pure and dt-driven, which
 * keeps it testable without a renderer.
 */

import { MusicChannels } from '../MusicVisualController';

export interface ThemeReactivityInput {
  channels: Pick<MusicChannels, 'bassMass' | 'transient' | 'sectionEnergy' | 'midFlow' | 'highGlint' | 'slot'>;
  energy: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** One-pole follower with separate attack and release time constants. */
function follow(current: number, target: number, dt: number, attack: number, release: number): number {
  const tau = target > current ? attack : release;
  const k = 1 - Math.exp(-Math.max(0, dt) / Math.max(1e-4, tau));
  return current + (target - current) * k;
}

/** Fastest any layer is allowed to rise: a lamp never snaps on in one frame. */
const KICK_ATTACK = 0.07;
const KICK_RELEASE = 0.42;
const ACCENT_ATTACK = 0.05;
const ACCENT_RELEASE = 0.55;
/** Percussion below this strength never registers as an accent. */
const ACCENT_GATE = 0.5;
/** Minimum time between two accents, so they stay occasional. */
const ACCENT_MIN_INTERVAL = 0.9;
const SUSTAIN_ATTACK = 1.6;
const SUSTAIN_RELEASE = 3.4;

export class ThemeReactivity {
  /** 0..1 bass lift for nearby lamps. */
  public kick = 0;
  /** 0..1 envelope of the current percussion accent. */
  public accent = 0;
  /** Which authored structure the current accent belongs to. */
  public accentSlot = 0;
  /** 0..1 slow sustained energy. */
  public sustain = 0;
  /** 0..1 slow mid / high colour and shimmer followers for the aurora. */
  public mid = 0;
  public high = 0;
  /** Slow bass reference the kick is measured against. */
  private bassFloor = 0;
  private accentTarget = 0;
  private sinceAccent = ACCENT_MIN_INTERVAL;

  public reset(): void {
    this.kick = 0;
    this.accent = 0;
    this.accentSlot = 0;
    this.sustain = 0;
    this.mid = 0;
    this.high = 0;
    this.bassFloor = 0;
    this.accentTarget = 0;
    this.sinceAccent = ACCENT_MIN_INTERVAL;
  }

  public update(input: ThemeReactivityInput, dt: number, reduceMotion = false): void {
    const step = Math.min(0.1, Math.max(0, dt));
    const bass = clamp01(input.channels.bassMass);

    // Kick: bass ABOVE its own slow average, so a sustained bassline does not
    // hold the lamps up and only the hits read.
    this.bassFloor = follow(this.bassFloor, bass, step, 0.9, 0.9);
    const hit = clamp01((bass - this.bassFloor - 0.015) * 3.4);
    this.kick = clamp01(follow(this.kick, reduceMotion ? 0 : hit, step, KICK_ATTACK, KICK_RELEASE));

    // Accent: a gated transient picks ONE structure, then decays. A new accent
    // cannot start until the minimum interval has passed.
    this.sinceAccent += step;
    const transient = clamp01(input.channels.transient);
    if (!reduceMotion && transient > ACCENT_GATE && this.sinceAccent >= ACCENT_MIN_INTERVAL) {
      this.sinceAccent = 0;
      this.accentTarget = clamp01((transient - ACCENT_GATE) / (1 - ACCENT_GATE)) * 0.6 + 0.4;
      this.accentSlot = Math.max(0, Math.floor(input.channels.slot));
    }
    this.accent = clamp01(follow(this.accent, this.accentTarget, step, ACCENT_ATTACK, ACCENT_RELEASE));
    // The target is a one-shot: once the envelope has risen, let it fall.
    if (this.accent >= this.accentTarget * 0.9) this.accentTarget = 0;
    if (reduceMotion) this.accentTarget = 0;

    const sustained = clamp01(input.channels.sectionEnergy * 0.6 + input.energy * 0.55);
    this.sustain = clamp01(follow(this.sustain, sustained, step, SUSTAIN_ATTACK, SUSTAIN_RELEASE));
    this.mid = clamp01(follow(this.mid, clamp01(input.channels.midFlow), step, 0.9, 2.2));
    this.high = clamp01(follow(this.high, clamp01(input.channels.highGlint), step, 0.5, 1.6));
  }
}
