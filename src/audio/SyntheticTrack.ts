/**
 * Synthetic Test Track Generator for TRACK//RUN
 * Synthesizes test tracks offline using OfflineAudioContext for zero-setup local playtesting.
 * Supports:
 *   - 'ELECTRONIC_DROP' (128 BPM, intro, beat, breakdown, snare buildup, massive drop, outro)
 *   - 'AMBIENT_SPARSE'  (70 BPM, slow evolving pads, gentle textures, sparse transients)
 *   - 'BREAKBEAT_DNB'   (174 BPM, high-speed syncopated breakbeats, driving sub-bass)
 *   - 'NEAR_SILENT'     (Faint atmospheric hiss and isolated chimes to test edge cases)
 */

export type SyntheticGenre = 'ELECTRONIC_DROP' | 'AMBIENT_SPARSE' | 'BREAKBEAT_DNB' | 'NEAR_SILENT';

export class SyntheticTrack {
  public static async generate(genre: SyntheticGenre = 'ELECTRONIC_DROP', sampleRate = 44100): Promise<AudioBuffer> {
    switch (genre) {
      case 'AMBIENT_SPARSE':
        return this.generateAmbient(sampleRate);
      case 'BREAKBEAT_DNB':
        return this.generateDnB(sampleRate);
      case 'NEAR_SILENT':
        return this.generateNearSilent(sampleRate);
      case 'ELECTRONIC_DROP':
      default:
        return this.generateElectronicDrop(sampleRate);
    }
  }

  private static async generateElectronicDrop(sampleRate: number): Promise<AudioBuffer> {
    const duration = 75;
    const offlineCtx = new OfflineAudioContext(2, Math.floor(sampleRate * duration), sampleRate);
    const bpm = 128;
    const beatDuration = 60 / bpm;
    const barDuration = beatDuration * 4;

    const masterGain = offlineCtx.createGain();
    masterGain.gain.setValueAtTime(0.85, 0);
    masterGain.connect(offlineCtx.destination);

    const delay = offlineCtx.createDelay();
    delay.delayTime.value = beatDuration * 0.75;
    const delayGain = offlineCtx.createGain();
    delayGain.gain.value = 0.28;
    const delayFilter = offlineCtx.createBiquadFilter();
    delayFilter.type = 'lowpass';
    delayFilter.frequency.value = 3500;
    delay.connect(delayFilter);
    delayFilter.connect(delayGain);
    delayGain.connect(delay);
    delayGain.connect(masterGain);

    const noiseBuffer = createNoiseBuffer(offlineCtx, 1.0);

    const chords = [
      [220.00, 261.63, 329.63], // Am
      [174.61, 220.00, 261.63], // F
      [196.00, 246.94, 293.66], // G
      [164.81, 196.00, 246.94]  // Em
    ];

    const totalBars = Math.floor(duration / barDuration);
    for (let bar = 0; bar < totalBars; bar++) {
      const barTime = bar * barDuration;
      const chord = chords[bar % chords.length];

      if (barTime < 15) {
        // Intro arp
        for (let i = 0; i < 4; i++) {
          triggerSynth(offlineCtx, masterGain, delay, barTime + i * beatDuration, chord[i % chord.length] * 2, beatDuration * 0.8, 'triangle', 0.2);
        }
      } else if (barTime >= 15 && barTime < 30) {
        // Beat 1: 128 BPM 4-on-the-floor
        for (let b = 0; b < 4; b++) {
          const t = barTime + b * beatDuration;
          triggerKick(offlineCtx, masterGain, t, 0.95);
          triggerHiHat(offlineCtx, masterGain, noiseBuffer, t + beatDuration * 0.5, false);
          triggerSynth(offlineCtx, masterGain, delay, t + beatDuration * 0.25, chord[0] * 0.5, beatDuration * 0.65, 'sawtooth', 0.35);
        }
        triggerSnare(offlineCtx, masterGain, delay, noiseBuffer, barTime + beatDuration * 1, 0.5);
        triggerSnare(offlineCtx, masterGain, delay, noiseBuffer, barTime + beatDuration * 3, 0.5);
      } else if (barTime >= 30 && barTime < 45) {
        // Breakdown: Quiet pads
        for (let note of chord) {
          triggerSynth(offlineCtx, masterGain, delay, barTime, note, barDuration * 0.95, 'sine', 0.18);
        }
        for (let b = 0; b < 4; b++) {
          triggerHiHat(offlineCtx, masterGain, noiseBuffer, barTime + b * beatDuration, true);
        }
      } else if (barTime >= 45 && barTime < 55) {
        // Buildup: accelerating snare roll
        const buildProgress = (barTime - 45) / 10;
        const subdiv = buildProgress > 0.6 ? 4 : 2;
        const step = beatDuration / (subdiv / 2);
        const steps = Math.floor(barDuration / step);
        for (let s = 0; s < steps; s++) {
          const t = barTime + s * step;
          triggerSnare(offlineCtx, masterGain, delay, noiseBuffer, t, 0.3 + buildProgress * 0.5);
          triggerKick(offlineCtx, masterGain, t, 0.5 + buildProgress * 0.4);
        }
        triggerSynth(offlineCtx, masterGain, delay, barTime, 220 + buildProgress * 440, barDuration, 'sawtooth', 0.25);
      } else if (barTime >= 55 && barTime < 68) {
        // DROP: Heavy kick, driving bass, rapid hats
        for (let b = 0; b < 4; b++) {
          const t = barTime + b * beatDuration;
          triggerKick(offlineCtx, masterGain, t, 1.25);
          for (let h = 0; h < 4; h++) {
            triggerHiHat(offlineCtx, masterGain, noiseBuffer, t + h * (beatDuration / 4), h === 2);
          }
          const bassNote = (b % 2 === 0) ? chord[0] * 0.5 : chord[1] * 0.5;
          triggerSynth(offlineCtx, masterGain, delay, t, bassNote, beatDuration * 0.4, 'sawtooth', 0.5);
        }
        triggerSnare(offlineCtx, masterGain, delay, noiseBuffer, barTime + beatDuration * 1, 0.85);
        triggerSnare(offlineCtx, masterGain, delay, noiseBuffer, barTime + beatDuration * 3, 0.85);
        const leadNotes = [chord[0] * 4, chord[1] * 4, chord[2] * 4, chord[0] * 5];
        for (let i = 0; i < 4; i++) {
          triggerSynth(offlineCtx, masterGain, delay, barTime + i * beatDuration, leadNotes[i], beatDuration * 0.6, 'sawtooth', 0.3);
        }
      } else {
        // Outro
        triggerSynth(offlineCtx, masterGain, delay, barTime, 220, 6.0, 'sine', 0.2);
        triggerSynth(offlineCtx, masterGain, delay, barTime, 261.63, 6.0, 'sine', 0.15);
      }
    }

    return await offlineCtx.startRendering();
  }

  private static async generateAmbient(sampleRate: number): Promise<AudioBuffer> {
    const duration = 60;
    const offlineCtx = new OfflineAudioContext(2, Math.floor(sampleRate * duration), sampleRate);

    const masterGain = offlineCtx.createGain();
    masterGain.gain.setValueAtTime(0.7, 0);
    masterGain.connect(offlineCtx.destination);

    const delay = offlineCtx.createDelay();
    delay.delayTime.value = 1.2;
    const delayGain = offlineCtx.createGain();
    delayGain.gain.value = 0.5;
    delay.connect(delayGain);
    delayGain.connect(delay);
    delayGain.connect(masterGain);

    // Evolving warm drone chords
    const chordA = [130.81, 196.00, 261.63, 392.00]; // Cmaj9
    const chordB = [110.00, 164.81, 220.00, 329.63]; // Am9

    for (let t = 0; t < duration - 10; t += 12) {
      const notes = (t / 12) % 2 === 0 ? chordA : chordB;
      for (const f of notes) {
        triggerSynth(offlineCtx, masterGain, delay, t, f, 14.0, 'sine', 0.18);
      }
    }

    return await offlineCtx.startRendering();
  }

  private static async generateDnB(sampleRate: number): Promise<AudioBuffer> {
    const duration = 60;
    const offlineCtx = new OfflineAudioContext(2, Math.floor(sampleRate * duration), sampleRate);
    const bpm = 174;
    const beatDuration = 60 / bpm; // ~0.344s
    const barDuration = beatDuration * 4;

    const masterGain = offlineCtx.createGain();
    masterGain.gain.setValueAtTime(0.85, 0);
    masterGain.connect(offlineCtx.destination);

    const noiseBuffer = createNoiseBuffer(offlineCtx, 1.0);
    const delay = offlineCtx.createDelay();
    delay.delayTime.value = beatDuration * 0.5;
    const delayGain = offlineCtx.createGain();
    delayGain.gain.value = 0.2;
    delay.connect(delayGain);
    delayGain.connect(masterGain);

    const totalBars = Math.floor(duration / barDuration);
    for (let bar = 0; bar < totalBars; bar++) {
      const barTime = bar * barDuration;

      // 174 BPM 2-step breakbeat pattern
      // Kick on 1 and offbeat 2.75
      triggerKick(offlineCtx, masterGain, barTime, 1.1);
      triggerKick(offlineCtx, masterGain, barTime + beatDuration * 2.5, 0.95);

      // Snare on 2 and 4
      triggerSnare(offlineCtx, masterGain, delay, noiseBuffer, barTime + beatDuration * 1, 0.85);
      triggerSnare(offlineCtx, masterGain, delay, noiseBuffer, barTime + beatDuration * 3, 0.85);

      // Fast 16th hats
      for (let h = 0; h < 8; h++) {
        triggerHiHat(offlineCtx, masterGain, noiseBuffer, barTime + h * (beatDuration / 2), h % 2 === 1);
      }

      // Reese Sub Bass
      triggerSynth(offlineCtx, masterGain, delay, barTime, 55.0, barDuration * 0.9, 'sawtooth', 0.45);
    }

    return await offlineCtx.startRendering();
  }

  private static async generateNearSilent(sampleRate: number): Promise<AudioBuffer> {
    const duration = 45;
    const offlineCtx = new OfflineAudioContext(2, Math.floor(sampleRate * duration), sampleRate);

    const masterGain = offlineCtx.createGain();
    masterGain.gain.setValueAtTime(0.08, 0); // Very quiet
    masterGain.connect(offlineCtx.destination);

    // Faint low frequency hum
    const osc = offlineCtx.createOscillator();
    osc.frequency.value = 50;
    osc.connect(masterGain);
    osc.start(0);
    osc.stop(duration);

    return await offlineCtx.startRendering();
  }
}

function createNoiseBuffer(ctx: BaseAudioContext, duration: number): AudioBuffer {
  const bufferSize = ctx.sampleRate * duration;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function triggerKick(ctx: BaseAudioContext, dest: AudioNode, time: number, punch = 1.0) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.setValueAtTime(160, time);
  osc.frequency.exponentialRampToValueAtTime(42, time + 0.08);
  gain.gain.setValueAtTime(punch, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.32);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(time);
  osc.stop(time + 0.35);
}

function triggerSnare(ctx: BaseAudioContext, dest: AudioNode, delayDest: AudioNode, noiseBuffer: AudioBuffer, time: number, gainVal = 0.6) {
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'highpass';
  noiseFilter.frequency.value = 900;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(gainVal, time);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(dest);
  noiseGain.connect(delayDest);

  const osc = ctx.createOscillator();
  const toneGain = ctx.createGain();
  osc.frequency.setValueAtTime(220, time);
  osc.frequency.exponentialRampToValueAtTime(110, time + 0.08);
  toneGain.gain.setValueAtTime(gainVal * 0.7, time);
  toneGain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
  osc.connect(toneGain);
  toneGain.connect(dest);

  noise.start(time);
  noise.stop(time + 0.25);
  osc.start(time);
  osc.stop(time + 0.15);
}

function triggerHiHat(ctx: BaseAudioContext, dest: AudioNode, noiseBuffer: AudioBuffer, time: number, open = false) {
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 8500;
  filter.Q.value = 3.0;

  const gain = ctx.createGain();
  const dec = open ? 0.22 : 0.045;
  gain.gain.setValueAtTime(open ? 0.3 : 0.22, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + dec);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(dest);

  noise.start(time);
  noise.stop(time + dec + 0.02);
}

function triggerSynth(ctx: BaseAudioContext, dest: AudioNode, delayDest: AudioNode, time: number, freq: number, dur: number, type: OscillatorType = 'sawtooth', gainVal = 0.25) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, time);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(freq * 3, time);
  filter.frequency.exponentialRampToValueAtTime(freq * 1.5, time + dur);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(gainVal, time + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  gain.connect(delayDest);

  osc.start(time);
  osc.stop(time + dur + 0.05);
}
