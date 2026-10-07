/**
 * AudioEngine lifecycle regression guard.
 *
 * Covers the finish-fade / natural-end / retry leaks:
 *  - the previous finish fade must not stop a run that started meanwhile,
 *  - a fresh play must restore the master gain to the configured volume,
 *  - a new buffer during a fade must survive,
 *  - natural completion keeps the clock at the buffer duration (no rewind),
 *  - an old source `onended` is harmless to the new run,
 *  - pause / resume / past-song seek keep a finite, clamped clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/audio/AudioEngine';

class FakeParam {
  value = 0;
  setValueAtTime(v: number, _t: number): this { this.value = v; return this; }
  linearRampToValueAtTime(v: number, _t: number): this { this.value = v; return this; }
  setTargetAtTime(v: number, _t: number, _tc: number): this { this.value = v; return this; }
  cancelScheduledValues(_t: number): this { return this; }
}

class FakeGainNode {
  gain = new FakeParam();
  connect(): void {}
  disconnect(): void {}
}

class FakeSourceNode {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  start(_when?: number, _offset?: number): void { this.started = true; }
  stop(): void { this.stopped = true; }
  connect(): void {}
  disconnect(): void {}
}

class FakeAudioContext {
  currentTime = 0;
  state: AudioContextState = 'running';
  destination = {};
  createGain(): FakeGainNode { return new FakeGainNode(); }
  createBufferSource(): FakeSourceNode { return new FakeSourceNode(); }
  async resume(): Promise<void> { this.state = 'running'; }
}

function makeBuffer(duration: number): AudioBuffer {
  return { duration, length: Math.round(duration * 100), sampleRate: 100, numberOfChannels: 1 } as unknown as AudioBuffer;
}

/** Create + init an engine against the fake context, returning it with internals. */
async function makeEngine(): Promise<AudioEngine> {
  const engine = new AudioEngine();
  await engine.init();
  return engine;
}

function internals(engine: AudioEngine): {
  ctx: FakeAudioContext;
  master: FakeGainNode;
  source: FakeSourceNode | null;
} {
  const anyEngine = engine as unknown as { ctx: FakeAudioContext; masterGain: FakeGainNode; currentSource: FakeSourceNode | null };
  return { ctx: anyEngine.ctx, master: anyEngine.masterGain, source: anyEngine.currentSource };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('window', globalThis);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AudioEngine finish-fade lifecycle', () => {
  it('a retry before the finish fade fires keeps playing at the selected volume', async () => {
    const engine = await makeEngine();
    engine.setVolume(0.37);
    engine.setBuffer(makeBuffer(100));
    engine.play(0);
    const { master } = internals(engine);

    engine.fadeOutAndStop(0.25);
    // The user retries / starts again immediately, before the fade timer fires.
    engine.stop();
    engine.play(0);

    vi.advanceTimersByTime(2000);

    expect(master.gain.value).toBeCloseTo(0.37, 5);
    expect(engine.getIsPlaying()).toBe(true);
  });

  it('a new buffer loaded during a fade survives the stale fade timer', async () => {
    const engine = await makeEngine();
    engine.setBuffer(makeBuffer(100));
    engine.play(0);

    engine.fadeOutAndStop(0.25);
    engine.setBuffer(makeBuffer(42));
    engine.play(0);

    vi.advanceTimersByTime(2000);

    expect(engine.getDuration()).toBe(42);
    expect(engine.getIsPlaying()).toBe(true);
    expect(internals(engine).master.gain.value).toBeCloseTo(0.8, 5);
  });

  it('the fade timeout only owns the playback it was scheduled for', async () => {
    const engine = await makeEngine();
    engine.setBuffer(makeBuffer(100));
    engine.play(0);
    engine.fadeOutAndStop(0.25);
    // A fresh play supersedes the fade; the old timer must not stop it.
    engine.play(0);
    vi.advanceTimersByTime(2000);
    expect(engine.getIsPlaying()).toBe(true);
  });
});

describe('AudioEngine natural completion', () => {
  it('pins the stored clock to the buffer duration instead of rewinding to the start offset', async () => {
    const engine = await makeEngine();
    engine.setBuffer(makeBuffer(3));
    // Start partway in; previously a natural end left currentOffset at this
    // start offset, so getCurrentTime() snapped back to it (rewinding the world).
    engine.play(1);

    const { source, ctx } = internals(engine);
    expect(source).not.toBeNull();
    ctx.currentTime = 3;
    source!.onended?.();

    expect(engine.getIsPlaying()).toBe(false);
    expect(engine.getCurrentTime()).toBe(3);
  });

  it('ignores onended from a source replaced by a new run', async () => {
    const engine = await makeEngine();
    engine.setBuffer(makeBuffer(100));
    engine.play(0);
    const oldSource = internals(engine).source;

    engine.stop();
    engine.play(0);

    // The old source reports completion late: harmless to the live run.
    oldSource!.onended?.();
    expect(engine.getIsPlaying()).toBe(true);
    expect(engine.getCurrentTime()).toBe(0);
  });

  it('ignores onended from a stopped source', async () => {
    const engine = await makeEngine();
    engine.setBuffer(makeBuffer(100));
    engine.play(0);
    const source = internals(engine).source;
    engine.stop();
    source!.onended?.();
    expect(engine.getIsPlaying()).toBe(false);
    expect(engine.getCurrentTime()).toBe(0);
  });
});

describe('AudioEngine pause / resume / seek clock', () => {
  it('pause then resume keeps a finite clock at the stored offset', async () => {
    const engine = await makeEngine();
    engine.setBuffer(makeBuffer(50));
    engine.play(0);
    const { ctx } = internals(engine);

    ctx.currentTime = 2;
    engine.pause();
    expect(engine.getCurrentTime()).toBeCloseTo(2, 5);
    expect(engine.getIsPlaying()).toBe(false);

    engine.resume();
    expect(engine.getIsPlaying()).toBe(true);
    expect(engine.getCurrentTime()).toBeCloseTo(2, 5);
  });

  it('seeking past the song end clamps the clock to the duration', async () => {
    const engine = await makeEngine();
    engine.setBuffer(makeBuffer(10));
    engine.play(0);

    engine.seek(999);
    expect(engine.getIsPlaying()).toBe(true);
    expect(engine.getCurrentTime()).toBe(10);
  });

  it('a paused be-yond-end clock stays clamped and finite', async () => {
    const engine = await makeEngine();
    engine.setBuffer(makeBuffer(10));
    engine.play(0);
    internals(engine).ctx.currentTime = 25;
    engine.pause();
    expect(engine.getCurrentTime()).toBe(10);
    engine.resume();
    expect(engine.getCurrentTime()).toBe(10);
  });
});
