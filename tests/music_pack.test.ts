import { describe, it, expect } from 'vitest';
import { MusicPack } from '../src/audio/MusicPack';
import { CURATED_PALETTES } from '../src/audio/TrackPalettes';

// Lightweight Web Audio mock for Vitest/Node environment
class MockAudioParam {
  value = 1;
  setValueAtTime(v: number) { this.value = v; }
  linearRampToValueAtTime(v: number) { this.value = v; }
  exponentialRampToValueAtTime(v: number) { this.value = v; }
}

class MockAudioNode {
  connect() {}
  disconnect() {}
}

class MockGainNode extends MockAudioNode {
  gain = new MockAudioParam();
}

class MockDelayNode extends MockAudioNode {
  delayTime = new MockAudioParam();
}

class MockBiquadFilterNode extends MockAudioNode {
  frequency = new MockAudioParam();
  Q = new MockAudioParam();
  type = 'lowpass';
}

class MockOscillatorNode extends MockAudioNode {
  frequency = new MockAudioParam();
  type = 'sine';
  start() {}
  stop() {}
}

class MockAudioBufferSourceNode extends MockAudioNode {
  buffer: any = null;
  start() {}
  stop() {}
}

class MockAudioBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  private channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel] || new Float32Array(this.length);
  }
}

class MockOfflineAudioContext {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  destination = new MockAudioNode();

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
  }

  createGain() { return new MockGainNode(); }
  createDelay() { return new MockDelayNode(); }
  createBiquadFilter() { return new MockBiquadFilterNode(); }
  createOscillator() { return new MockOscillatorNode(); }
  createBufferSource() { return new MockAudioBufferSourceNode(); }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const buf = new MockAudioBuffer(channels, length, sampleRate);
    for (let c = 0; c < channels; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }
    return buf;
  }

  async startRendering(): Promise<AudioBuffer> {
    const buf = new MockAudioBuffer(this.numberOfChannels, this.length, this.sampleRate);
    for (let c = 0; c < this.numberOfChannels; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.sin(i * 0.05) * 0.5;
      }
    }
    return buf as unknown as AudioBuffer;
  }
}

if (typeof (globalThis as any).OfflineAudioContext === 'undefined') {
  (globalThis as any).OfflineAudioContext = MockOfflineAudioContext;
}

describe('MusicPack — Bundled Production Catalog', () => {
  const catalog = MusicPack.getCatalog();

  it('contains exactly 5 curated production tracks', () => {
    expect(catalog.length).toBe(5);
  });

  it('has First Contact as the default onboarding course', () => {
    const firstContact = MusicPack.getFirstContact();
    expect(firstContact).toBeDefined();
    expect(firstContact.id).toBe('first-contact');
    expect(firstContact.isFirstContact).toBe(true);
    expect(firstContact.difficulty).toBe(1);
  });

  it('provides complete metadata for every track', () => {
    for (const track of catalog) {
      expect(track.id).toBeTruthy();
      expect(track.title).toBeTruthy();
      expect(track.artist).toBeTruthy();
      expect(track.genre).toBeTruthy();
      expect(track.bpm).toBeGreaterThan(60);
      expect(track.bpm).toBeLessThan(200);
      expect(track.duration).toBeGreaterThanOrEqual(60);
      expect(track.difficulty).toBeGreaterThanOrEqual(1);
      expect(track.difficulty).toBeLessThanOrEqual(5);
      expect(track.difficultyLabel).toBeTruthy();
      expect(track.description.length).toBeGreaterThan(20);
      expect(track.accentColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(CURATED_PALETTES[track.paletteKey]).toBeDefined();
      expect(track.tags.length).toBeGreaterThan(0);
    }
  });

  it('finds tracks by id correctly', () => {
    const track = MusicPack.getTrackById('hyperdrive-collider');
    expect(track).toBeDefined();
    expect(track?.title).toContain('HYPERDRIVE COLLIDER');
    expect(track?.bpm).toBe(128);

    const missing = MusicPack.getTrackById('non-existent');
    expect(missing).toBeUndefined();
  });

  it('synthesizes non-empty preview audio in reasonable time', async () => {
    const sampleRate = 22050; // Use 22.05 kHz for fast test execution
    for (const track of catalog) {
      const startTime = Date.now();
      const previewBuffer = await track.generatePreview(sampleRate);
      const elapsed = Date.now() - startTime;

      expect(previewBuffer).toBeDefined();
      expect(previewBuffer.numberOfChannels).toBe(2);
      expect(previewBuffer.duration).toBeGreaterThanOrEqual(4);
      expect(previewBuffer.duration).toBeLessThanOrEqual(8);
      expect(elapsed).toBeLessThan(1500); // Must generate quickly

      // Verify audio has audio content (not silent zeros)
      const leftChannel = previewBuffer.getChannelData(0);
      let hasSound = false;
      for (let i = 0; i < leftChannel.length; i += 100) {
        if (Math.abs(leftChannel[i]) > 0.001) {
          hasSound = true;
          break;
        }
      }
      expect(hasSound).toBe(true);
    }
  });

  it('synthesizes full track buffer with valid audio data for First Contact', async () => {
    const track = MusicPack.getFirstContact();
    const buffer = await track.generate(22050);

    expect(buffer).toBeDefined();
    expect(buffer.numberOfChannels).toBe(2);
    expect(buffer.duration).toBeCloseTo(track.duration, 0);

    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    // Verify non-zero data
    let leftPeak = 0;
    let rightPeak = 0;
    for (let i = 0; i < left.length; i += 200) {
      leftPeak = Math.max(leftPeak, Math.abs(left[i]));
      rightPeak = Math.max(rightPeak, Math.abs(right[i]));
    }
    expect(leftPeak).toBeGreaterThan(0.05);
    expect(rightPeak).toBeGreaterThan(0.05);
  });
});
