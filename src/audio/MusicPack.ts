import { SignalPackCatalog } from './SignalPackCatalog';
import { AudioDecoder } from './AudioDecoder';

export interface TrackCatalogEntry {
  id: string;
  title: string;
  artist: string;
  genre: string;
  bpm: number;
  duration: number; // in seconds
  difficulty: number; // 1 to 5
  difficultyLabel: string;
  description: string;
  accentColor: string;
  paletteKey: 'ICE' | 'EMBER' | 'SIGNAL_RED' | 'ACID' | 'ULTRAVIOLET' | 'GLACIER';
  tags: string[];
  isFirstContact?: boolean;
  audioUrl?: string;
  generate: (sampleRate?: number) => Promise<AudioBuffer>;
  generatePreview: (sampleRate?: number) => Promise<AudioBuffer>;
}


// Synthesis utility functions
function createNoiseBuffer(ctx: BaseAudioContext, duration: number): AudioBuffer {
  const bufferSize = ctx.sampleRate * duration;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function triggerKick(ctx: BaseAudioContext, dest: AudioNode, time: number, punch = 1.0, startPitch = 160, endPitch = 42) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.setValueAtTime(startPitch, time);
  osc.frequency.exponentialRampToValueAtTime(endPitch, time + 0.08);
  gain.gain.setValueAtTime(punch, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(time);
  osc.stop(time + 0.38);
}

function triggerSnare(
  ctx: BaseAudioContext,
  dest: AudioNode,
  delayDest: AudioNode | null,
  noiseBuffer: AudioBuffer,
  time: number,
  gainVal = 0.6,
  filterFreq = 900
) {
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'highpass';
  noiseFilter.frequency.value = filterFreq;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(gainVal, time);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(dest);
  if (delayDest) noiseGain.connect(delayDest);
  noise.start(time);
  noise.stop(time + 0.25);

  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();
  osc.frequency.setValueAtTime(180, time);
  osc.frequency.exponentialRampToValueAtTime(80, time + 0.08);
  oscGain.gain.setValueAtTime(gainVal * 0.7, time);
  oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
  osc.connect(oscGain);
  oscGain.connect(dest);
  osc.start(time);
  osc.stop(time + 0.15);
}

function triggerHiHat(ctx: BaseAudioContext, dest: AudioNode, noiseBuffer: AudioBuffer, time: number, open = false, gainVal = 0.2) {
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 8500;
  filter.Q.value = 2.5;
  const gain = ctx.createGain();
  const hatDuration = open ? 0.25 : 0.05;
  gain.gain.setValueAtTime(gainVal * (open ? 1.2 : 0.8), time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + hatDuration);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  noise.start(time);
  noise.stop(time + hatDuration + 0.02);
}

function triggerSynth(
  ctx: BaseAudioContext,
  dest: AudioNode,
  delayDest: AudioNode | null,
  time: number,
  freq: number,
  duration: number,
  type: OscillatorType = 'sawtooth',
  gainVal = 0.3,
  filterCutoff = 2800
) {
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterCutoff;
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, time);

  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(gainVal, time + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  if (delayDest) gain.connect(delayDest);

  osc.start(time);
  osc.stop(time + duration + 0.05);
}

// ------------------------------------------------------------------------------------------------
// 1. FIRST CONTACT — Melodic Synthwave / Onboarding Flow (120 BPM, 72s)
// ------------------------------------------------------------------------------------------------
export async function synthesizeFirstContact(duration = 72, sampleRate = 44100): Promise<AudioBuffer> {
  const offlineCtx = new OfflineAudioContext(2, Math.floor(sampleRate * duration), sampleRate);
  const bpm = 120;
  const beatDuration = 60 / bpm; // 0.5s
  const barDuration = beatDuration * 4; // 2.0s

  const master = offlineCtx.createGain();
  master.gain.setValueAtTime(0.85, 0);
  master.connect(offlineCtx.destination);

  // Stereo Ping-Pong / Filtered Delay
  const delay = offlineCtx.createDelay();
  delay.delayTime.value = beatDuration * 0.75;
  const delayGain = offlineCtx.createGain();
  delayGain.gain.value = 0.3;
  const delayFilter = offlineCtx.createBiquadFilter();
  delayFilter.type = 'lowpass';
  delayFilter.frequency.value = 3200;
  delay.connect(delayFilter);
  delayFilter.connect(delayGain);
  delayGain.connect(delay);
  delayGain.connect(master);

  const noise = createNoiseBuffer(offlineCtx, 1.0);

  // Chords: Am -> F -> C -> G
  const chords = [
    [220.0, 261.63, 329.63], // Am
    [174.61, 220.0, 261.63], // F
    [130.81, 164.81, 196.0], // C
    [196.0, 246.94, 293.66]  // G
  ];

  const totalBars = Math.floor(duration / barDuration);

  for (let bar = 0; bar < totalBars; bar++) {
    const barTime = bar * barDuration;
    const chord = chords[bar % chords.length];

    if (barTime < 16) {
      // Intro: gentle arpeggiator & soft pulse
      for (let i = 0; i < 4; i++) {
        triggerSynth(offlineCtx, master, delay, barTime + i * beatDuration, chord[i % chord.length] * 2, beatDuration * 0.8, 'triangle', 0.22);
      }
      if (barTime >= 8) {
        triggerKick(offlineCtx, master, barTime, 0.75);
        triggerKick(offlineCtx, master, barTime + beatDuration * 2, 0.75);
      }
    } else if (barTime >= 16 && barTime < 36) {
      // Section 1: Steady 120 BPM driving groove (perfect for bhop learning)
      for (let b = 0; b < 4; b++) {
        const t = barTime + b * beatDuration;
        triggerKick(offlineCtx, master, t, 0.95);
        triggerHiHat(offlineCtx, master, noise, t + beatDuration * 0.5, false, 0.18);
        // Driving rolling bass
        triggerSynth(offlineCtx, master, null, t, chord[0] * 0.5, beatDuration * 0.45, 'sawtooth', 0.4, 1800);
      }
      triggerSnare(offlineCtx, master, delay, noise, barTime + beatDuration * 1, 0.6);
      triggerSnare(offlineCtx, master, delay, noise, barTime + beatDuration * 3, 0.6);

      // Warm background chords
      for (const n of chord) {
        triggerSynth(offlineCtx, master, delay, barTime, n, barDuration * 0.9, 'sine', 0.14);
      }
    } else if (barTime >= 36 && barTime < 48) {
      // Breakdown & Sweeping Surf Section: open filters, soaring lead
      for (const n of chord) {
        triggerSynth(offlineCtx, master, delay, barTime, n * 1.5, barDuration * 0.95, 'sawtooth', 0.2, 4000);
      }
      for (let b = 0; b < 4; b++) {
        triggerHiHat(offlineCtx, master, noise, barTime + b * beatDuration, true, 0.15);
      }
      // Surf glide melody
      const leadNote = chord[bar % chord.length] * 3;
      triggerSynth(offlineCtx, master, delay, barTime, leadNote, beatDuration * 1.8, 'sawtooth', 0.35, 4500);
    } else {
      // Climax / Full Flow: High energy, double hats, driving bass
      for (let b = 0; b < 4; b++) {
        const t = barTime + b * beatDuration;
        triggerKick(offlineCtx, master, t, 1.1);
        triggerHiHat(offlineCtx, master, noise, t + beatDuration * 0.25, false, 0.16);
        triggerHiHat(offlineCtx, master, noise, t + beatDuration * 0.5, true, 0.22);
        triggerHiHat(offlineCtx, master, noise, t + beatDuration * 0.75, false, 0.16);
        triggerSynth(offlineCtx, master, null, t, chord[0] * 0.5, beatDuration * 0.45, 'sawtooth', 0.45, 2400);
      }
      triggerSnare(offlineCtx, master, delay, noise, barTime + beatDuration * 1, 0.85);
      triggerSnare(offlineCtx, master, delay, noise, barTime + beatDuration * 3, 0.85);

      for (let i = 0; i < 4; i++) {
        triggerSynth(offlineCtx, master, delay, barTime + i * beatDuration, chord[i % chord.length] * 2.5, beatDuration * 0.7, 'sawtooth', 0.28, 3800);
      }
    }
  }

  return await offlineCtx.startRendering();
}

// ------------------------------------------------------------------------------------------------
// 2. HYPERDRIVE COLLIDER — Peak-Time Electro / Drop (128 BPM, 75s)
// ------------------------------------------------------------------------------------------------
export async function synthesizeHyperdrive(duration = 75, sampleRate = 44100): Promise<AudioBuffer> {
  const offlineCtx = new OfflineAudioContext(2, Math.floor(sampleRate * duration), sampleRate);
  const bpm = 128;
  const beatDuration = 60 / bpm;
  const barDuration = beatDuration * 4;

  const master = offlineCtx.createGain();
  master.gain.setValueAtTime(0.9, 0);
  master.connect(offlineCtx.destination);

  const delay = offlineCtx.createDelay();
  delay.delayTime.value = beatDuration * 0.75;
  const delayGain = offlineCtx.createGain();
  delayGain.gain.value = 0.26;
  delay.connect(delayGain);
  delayGain.connect(delay);
  delayGain.connect(master);

  const noise = createNoiseBuffer(offlineCtx, 1.0);
  const chords = [
    [185.0, 220.0, 277.18], // F#m
    [146.83, 185.0, 220.0], // D
    [164.81, 207.65, 246.94], // E
    [138.59, 174.61, 207.65]  // C#m
  ];

  const totalBars = Math.floor(duration / barDuration);
  for (let bar = 0; bar < totalBars; bar++) {
    const barTime = bar * barDuration;
    const chord = chords[bar % chords.length];

    if (barTime < 18) {
      // Atmospheric intro
      for (let i = 0; i < 4; i++) {
        triggerSynth(offlineCtx, master, delay, barTime + i * beatDuration, chord[i % chord.length] * 2, beatDuration * 0.75, 'sawtooth', 0.25, 2000);
      }
      if (barTime >= 8) {
        for (let b = 0; b < 4; b++) triggerKick(offlineCtx, master, barTime + b * beatDuration, 0.85);
      }
    } else if (barTime >= 18 && barTime < 40) {
      // Main Electro Drive
      for (let b = 0; b < 4; b++) {
        const t = barTime + b * beatDuration;
        triggerKick(offlineCtx, master, t, 1.2, 180, 38);
        triggerHiHat(offlineCtx, master, noise, t + beatDuration * 0.5, true, 0.22);
        triggerSynth(offlineCtx, master, null, t, chord[0] * 0.5, beatDuration * 0.35, 'sawtooth', 0.55, 3000);
      }
      triggerSnare(offlineCtx, master, delay, noise, barTime + beatDuration * 1, 0.8, 1200);
      triggerSnare(offlineCtx, master, delay, noise, barTime + beatDuration * 3, 0.8, 1200);
    } else if (barTime >= 40 && barTime < 52) {
      // Snare Buildup & Pitch Riser
      const build = (barTime - 40) / 12;
      const step = beatDuration / (build > 0.5 ? 4 : 2);
      const steps = Math.floor(barDuration / step);
      for (let s = 0; s < steps; s++) {
        triggerSnare(offlineCtx, master, delay, noise, barTime + s * step, 0.3 + build * 0.6);
        triggerKick(offlineCtx, master, barTime + s * step, 0.4 + build * 0.6);
      }
      triggerSynth(offlineCtx, master, delay, barTime, 180 + build * 500, barDuration, 'sawtooth', 0.35, 4000);
    } else {
      // THE DROP: Massive kicks, distorted stabs, high-speed surf momentum
      for (let b = 0; b < 4; b++) {
        const t = barTime + b * beatDuration;
        triggerKick(offlineCtx, master, t, 1.35, 200, 36);
        for (let h = 0; h < 4; h++) triggerHiHat(offlineCtx, master, noise, t + h * (beatDuration / 4), h === 2, 0.2);
        triggerSynth(offlineCtx, master, delay, t, chord[0] * 0.5, beatDuration * 0.45, 'sawtooth', 0.6, 3800);
      }
      triggerSnare(offlineCtx, master, delay, noise, barTime + beatDuration * 1, 1.0, 1400);
      triggerSnare(offlineCtx, master, delay, noise, barTime + beatDuration * 3, 1.0, 1400);
      for (let i = 0; i < 4; i++) {
        triggerSynth(offlineCtx, master, delay, barTime + i * beatDuration, chord[i % chord.length] * 4, beatDuration * 0.55, 'sawtooth', 0.35, 4500);
      }
    }
  }

  return await offlineCtx.startRendering();
}

// ------------------------------------------------------------------------------------------------
// 3. NEURAL DRIFT — Liquid Drum & Bass (174 BPM, 66s)
// ------------------------------------------------------------------------------------------------
export async function synthesizeNeuralDrift(duration = 66, sampleRate = 44100): Promise<AudioBuffer> {
  const offlineCtx = new OfflineAudioContext(2, Math.floor(sampleRate * duration), sampleRate);
  const bpm = 174;
  const beatDuration = 60 / bpm; // ~0.345s
  const barDuration = beatDuration * 4;

  const master = offlineCtx.createGain();
  master.gain.setValueAtTime(0.85, 0);
  master.connect(offlineCtx.destination);

  const delay = offlineCtx.createDelay();
  delay.delayTime.value = beatDuration * 0.5;
  const delayGain = offlineCtx.createGain();
  delayGain.gain.value = 0.25;
  delay.connect(delayGain);
  delayGain.connect(delay);
  delayGain.connect(master);

  const noise = createNoiseBuffer(offlineCtx, 1.0);
  const chords = [
    [130.81, 155.56, 196.0, 233.08], // Cm7
    [116.54, 146.83, 174.61, 220.0], // Bb7
    [103.83, 130.81, 155.56, 196.0], // Abmaj7
    [116.54, 138.59, 174.61, 207.65] // Fm7
  ];

  const totalBars = Math.floor(duration / barDuration);
  for (let bar = 0; bar < totalBars; bar++) {
    const barTime = bar * barDuration;
    const chord = chords[bar % chords.length];

    // Liquid Rhodes Chords
    for (const n of chord) {
      triggerSynth(offlineCtx, master, delay, barTime, n * 2, barDuration * 0.9, 'triangle', 0.16, 2200);
    }

    if (barTime >= 8) {
      // 174 BPM Syncopated Breakbeat: Kick on 1 and 2.75, Snare on 2 and 4
      triggerKick(offlineCtx, master, barTime, 1.15, 170, 45);
      triggerKick(offlineCtx, master, barTime + beatDuration * 2.5, 1.0, 160, 45);

      triggerSnare(offlineCtx, master, delay, noise, barTime + beatDuration * 1, 0.9, 1100);
      triggerSnare(offlineCtx, master, delay, noise, barTime + beatDuration * 3, 0.9, 1100);

      // Fast 16th hats
      for (let h = 0; h < 8; h++) {
        triggerHiHat(offlineCtx, master, noise, barTime + h * (beatDuration / 2), h % 2 === 1, 0.18);
      }

      // Reese Sub-Bass
      triggerSynth(offlineCtx, master, null, barTime, chord[0] * 0.5, barDuration * 0.92, 'sawtooth', 0.45, 800);
    }
  }

  return await offlineCtx.startRendering();
}

// ------------------------------------------------------------------------------------------------
// 4. CHRONO CATACLYSM — Industrial Half-Time / Bass (85 BPM, 76s)
// ------------------------------------------------------------------------------------------------
export async function synthesizeChronoCataclysm(duration = 76, sampleRate = 44100): Promise<AudioBuffer> {
  const offlineCtx = new OfflineAudioContext(2, Math.floor(sampleRate * duration), sampleRate);
  const bpm = 85;
  const beatDuration = 60 / bpm; // ~0.706s
  const barDuration = beatDuration * 4;

  const master = offlineCtx.createGain();
  master.gain.setValueAtTime(0.85, 0);
  master.connect(offlineCtx.destination);

  const delay = offlineCtx.createDelay();
  delay.delayTime.value = beatDuration * 0.75;
  const delayGain = offlineCtx.createGain();
  delayGain.gain.value = 0.35;
  delay.connect(delayGain);
  delayGain.connect(delay);
  delayGain.connect(master);

  const noise = createNoiseBuffer(offlineCtx, 1.0);
  const chords = [
    [146.83, 174.61, 220.0], // Dm
    [130.81, 164.81, 196.0], // C
    [116.54, 146.83, 174.61], // Bb
    [164.81, 196.0, 246.94]   // E
  ];

  const totalBars = Math.floor(duration / barDuration);
  for (let bar = 0; bar < totalBars; bar++) {
    const barTime = bar * barDuration;
    const chord = chords[bar % chords.length];

    // Heavy Half-Time Beat: Kick on 1, Snare on 3
    triggerKick(offlineCtx, master, barTime, 1.35, 140, 32);
    if (barTime >= 12) {
      triggerSnare(offlineCtx, master, delay, noise, barTime + beatDuration * 2, 1.1, 750);
      for (let b = 0; b < 4; b++) {
        triggerHiHat(offlineCtx, master, noise, barTime + b * beatDuration + beatDuration * 0.5, true, 0.2);
      }
      // Distorted sawtooth bass growl
      triggerSynth(offlineCtx, master, delay, barTime, chord[0] * 0.5, beatDuration * 1.8, 'sawtooth', 0.55, 1600);
      triggerSynth(offlineCtx, master, delay, barTime + beatDuration * 2.5, chord[1] * 0.5, beatDuration * 1.2, 'sawtooth', 0.5, 2200);
    }
  }

  return await offlineCtx.startRendering();
}

// ------------------------------------------------------------------------------------------------
// 5. VOIDWALKER — Celestial Ambient Flow (72 BPM, 70s)
// ------------------------------------------------------------------------------------------------
export async function synthesizeVoidwalker(duration = 70, sampleRate = 44100): Promise<AudioBuffer> {
  const offlineCtx = new OfflineAudioContext(2, Math.floor(sampleRate * duration), sampleRate);
  const master = offlineCtx.createGain();
  master.gain.setValueAtTime(0.8, 0);
  master.connect(offlineCtx.destination);

  const delay = offlineCtx.createDelay();
  delay.delayTime.value = 1.25;
  const delayGain = offlineCtx.createGain();
  delayGain.gain.value = 0.55;
  delay.connect(delayGain);
  delayGain.connect(delay);
  delayGain.connect(master);

  // Evolving celestial chords
  const chordA = [130.81, 196.0, 261.63, 392.0]; // Cmaj9
  const chordB = [110.0, 164.81, 220.0, 329.63]; // Am9
  const chordC = [174.61, 220.0, 261.63, 349.23]; // Fmaj7

  const chords = [chordA, chordB, chordC];

  for (let t = 0; t < duration - 10; t += 10) {
    const chord = chords[Math.floor(t / 10) % chords.length];
    for (const freq of chord) {
      triggerSynth(offlineCtx, master, delay, t, freq, 12.0, 'sine', 0.18, 1200);
      triggerSynth(offlineCtx, master, delay, t + 0.5, freq * 2, 8.0, 'triangle', 0.08, 2000);
    }
  }

  return await offlineCtx.startRendering();
}

// ------------------------------------------------------------------------------------------------
// Catalog Registry
// ------------------------------------------------------------------------------------------------
export class MusicPack {
  private static catalog: TrackCatalogEntry[] = [];

  public static getCatalog(): TrackCatalogEntry[] {
    if (this.catalog.length === 0) {
      const signalTracks = SignalPackCatalog.getTracks();
      this.catalog = signalTracks.map((t, idx) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        genre: t.genre,
        bpm: t.bpm,
        duration: t.duration,
        difficulty: t.difficulty,
        difficultyLabel: t.difficultyLabel,
        description: t.description,
        accentColor: t.accentColor,
        paletteKey: t.paletteKey,
        tags: t.tags,
        isFirstContact: idx === 0,
        audioUrl: t.audioUrl,
        generate: async (sr) => AudioDecoder.loadAudio(t.audioUrl, sr),
        generatePreview: async (sr) => AudioDecoder.loadAudio(t.audioUrl, sr)
      }));
    }
    return this.catalog;
  }

  public static getTrackById(id: string): TrackCatalogEntry | undefined {
    return this.getCatalog().find(t => t.id === id);
  }

  public static getFirstContact(): TrackCatalogEntry {
    return this.getCatalog()[0];
  }
}
