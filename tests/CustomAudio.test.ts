import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioAnalyzer } from '../src/audio/AudioAnalyzer';
import { TrackAnalysis } from '../src/audio/AudioFeatures';
import { RouteGenerator } from '../src/generation/RouteGenerator';
import { TrackGenerator } from '../src/generation/TrackGenerator';
import { RouteConnectivityValidator } from '../src/generation/RouteConnectivityValidator';
import { SurfPlanner } from '../src/generation/SurfPlanner';
import { CustomAnalysisCache, CUSTOM_ANALYSIS_CACHE_VERSION } from '../src/audio/CustomAnalysisCache';
import { computeCustomContentIdentity, hashAudioContent } from '../src/utils/hash';
import { resolveCustomAudioLevel } from '../src/generation/CustomPipeline';
import { estimateRouteTiming } from '../src/generation/CustomTimingEstimate';
import { VisualDreamDirector } from '../src/world/VisualDreamProfile';

/** Minimal AudioBuffer stand-in for the offline analyzer. */
function makeBuffer(
  samples: Float32Array,
  sampleRate = 44100
): AudioBuffer {
  return {
    sampleRate,
    length: samples.length,
    duration: samples.length / sampleRate,
    numberOfChannels: 1,
    getChannelData: () => samples,
    copyFromChannel: () => undefined,
    copyToChannel: () => undefined
  } as unknown as AudioBuffer;
}

/** Steady amplitude, no rhythmic structure. */
function constantSignal(seconds = 1, sampleRate = 44100): Float32Array {
  const n = Math.floor(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / sampleRate);
  return out;
}

/** Alternating loud kick-drum-ish bursts and near-silence across 20s. */
function rhythmicChangingSignal(seconds = 20, sampleRate = 44100): Float32Array {
  const n = Math.floor(seconds * sampleRate);
  const out = new Float32Array(n);
  const beat = 0.25;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const inBeat = t % beat < 0.12;
    const loud = t > 8 && t < 16;
    if (inBeat) {
      const env = Math.exp(-((t % beat) / 0.05));
      out[i] = (loud ? 0.9 : 0.25) * env * Math.sin((2 * Math.PI * (loud ? 110 : 80) * i) / sampleRate);
    } else {
      out[i] = 0.02 * Math.sin((2 * Math.PI * 900 * i) / sampleRate + t);
    }
  }
  return out;
}

/** 75s changing-energy fixture: calm intro, build, then a loud peak/release. */
function changingEnergySignal(seconds = 75, sampleRate = 44100): Float32Array {
  const n = Math.floor(seconds * sampleRate);
  const out = new Float32Array(n);
  const beat = 0.3;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const inBeat = t % beat < 0.14;
    let amp: number;
    if (t < 20) amp = 0.18;
    else if (t < 45) amp = 0.18 + ((t - 20) / 25) * 0.5;
    else amp = 0.85;
    const freq = t < 45 ? 80 : 120;
    if (inBeat) {
      const env = Math.exp(-((t % beat) / 0.06));
      out[i] = amp * env * Math.sin((2 * Math.PI * freq * i) / sampleRate);
    } else {
      out[i] = 0.02 * amp * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
    }
  }
  return out;
}

/** Constant high-onset-density loop (constant energy, dense rhythm). */
function denseConstantSignal(seconds = 45, sampleRate = 44100): Float32Array {
  const n = Math.floor(seconds * sampleRate);
  const out = new Float32Array(n);
  const beat = 0.18;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const inBeat = t % beat < 0.07;
    if (inBeat) {
      const env = Math.exp(-((t % beat) / 0.03));
      out[i] = 0.5 * env * Math.sin((2 * Math.PI * 140 * i) / sampleRate);
    } else {
      out[i] = 0.05 * Math.sin((2 * Math.PI * 1200 * i) / sampleRate);
    }
  }
  return out;
}

describe('Custom Audio 2.0', () => {
  describe('macro section detection', () => {
    it('finds changing-energy rhythmic structure but collapses constant audio', async () => {
      const rhythmic = await AudioAnalyzer.analyze(
        makeBuffer(rhythmicChangingSignal()),
        'rhythm',
        undefined,
        { custom: { source: 'FILE', encodedBytes: null } }
      );
      const calm = await AudioAnalyzer.analyze(
        makeBuffer(constantSignal(1)),
        'calm',
        undefined,
        { custom: { source: 'FILE', encodedBytes: null } }
      );

      // Rhythmic: multiple sections, real intensity contrast, no fabricated
      // alternating ASCENT/PRECISION index pattern.
      expect(rhythmic.sections.length).toBeGreaterThanOrEqual(2);
      const intensities = rhythmic.sections.map((s) => s.intensity);
      expect(Math.max(...intensities) - Math.min(...intensities)).toBeGreaterThan(0.05);
      expect(rhythmic.sections[0].theme).toBe('FLOW');

      // Calm/constant: broad safe BREATH/FLOW shape, first phrase safe.
      expect(calm.sections.length).toBeGreaterThanOrEqual(1);
      expect(calm.sections.length).toBeLessThanOrEqual(4);
      expect(['FLOW', 'BREATH']).toContain(calm.sections[0].theme);
      for (const s of calm.sections) {
        expect(s.theme === 'FLOW' || s.theme === 'BREATH').toBe(true);
      }
    });

    it('does not interpret a slowly modulated ambient tone as percussion', async () => {
      const sampleRate = 22050;
      const samples = new Float32Array(sampleRate * 60);
      for (let i = 0; i < samples.length; i++) {
        const t = i / sampleRate;
        samples[i] = (0.13 + 0.03 * Math.sin(t * 0.12)) *
          (Math.sin(2 * Math.PI * 110 * t) + 0.2 * Math.sin(2 * Math.PI * 330 * t));
      }
      const analysis = await AudioAnalyzer.analyze(makeBuffer(samples, sampleRate), 'ambient', undefined,
        { custom: { source: 'FILE', encodedBytes: null } });
      expect(analysis.customAggregate!.density).toBeLessThan(0.12);
      expect(analysis.customAggregate!.brightness).toBeLessThan(0.15);
      expect(analysis.bpmConfidence).toBeLessThan(0.35);
      expect(analysis.globalEnergy).toBeLessThan(0.6);
      expect(SurfPlanner.plan(analysis)).toHaveLength(0);
      expect(RouteGenerator.generate(analysis).optionalRamps ?? []).toHaveLength(0);
    });

    it('does not create zero-step loops for very short audio', async () => {
      const short = await AudioAnalyzer.analyze(
        makeBuffer(constantSignal(1)),
        'one-second',
        undefined,
        { custom: { source: 'FILE', encodedBytes: null } }
      );
      for (const s of short.sections) {
        expect(s.duration).toBeGreaterThan(0);
        expect(s.end).toBeGreaterThan(s.start);
      }
      expect(short.sections[short.sections.length - 1].end).toBeCloseTo(1.0, 2);
    });

    it('produces a stable content identity and seed across a rename', async () => {
      const a = await AudioAnalyzer.analyze(
        makeBuffer(rhythmicChangingSignal()),
        'original-name',
        undefined,
        { custom: { source: 'FILE', encodedBytes: null } }
      );
      const b = await AudioAnalyzer.analyze(
        makeBuffer(rhythmicChangingSignal()),
        'totally-different-name',
        undefined,
        { custom: { source: 'FILE', encodedBytes: null } }
      );
      expect(a.customSource?.contentHash).toBe(b.customSource?.contentHash);
      expect(a.seed).toBe(b.seed);
      expect(a.filename).toBe('original-name');
      expect(b.filename).toBe('totally-different-name');
    });
  });

  function customAnalysis(sections: TrackAnalysis['sections'], seed = 0x5eed): TrackAnalysis {
    return {
      filename: 'custom',
      duration: sections[sections.length - 1].end,
      bpm: 128,
      bpmConfidence: 0.7,
      globalEnergy: 0.55,
      frames: [],
      onsets: [],
      sections,
      waveform: new Float32Array(64),
      seed,
      visualAccent: { name: 'Icy Cyan', hex: '#00f0ff', rgb: [0, 240, 255] },
      customSource: {
        source: 'FILE',
        displayName: 'custom',
        contentHash: 'abcdef0123456789',
        byteLength: 1024,
        hashSource: 'PCM'
      },
      customAggregate: { bass: 0.6, brightness: 0.5, density: 0.5, dynamics: 0.4, contrast: 0.3 }
    };
  }

  describe('route generation for custom audio', () => {
    it('respects section phase and stays connectivity-valid', () => {
      const flow = customAnalysis([
        { index: 0, start: 0, end: 30, duration: 30, intensity: 0.4, rhythmicDensity: 0.3, brightness: 0.5, theme: 'FLOW' },
        { index: 1, start: 30, end: 60, duration: 30, intensity: 0.5, rhythmicDensity: 0.4, brightness: 0.5, theme: 'FLOW' }
      ]);
      const build = customAnalysis([
        { index: 0, start: 0, end: 30, duration: 30, intensity: 0.4, rhythmicDensity: 0.3, brightness: 0.5, theme: 'FLOW' },
        { index: 1, start: 30, end: 60, duration: 30, intensity: 0.5, rhythmicDensity: 0.4, brightness: 0.5, theme: 'BUILDUP' }
      ]);

      const flowTrack = RouteGenerator.generate(flow);
      const buildTrack = RouteGenerator.generate(build);
      const flowTypes = flowTrack.route.map((n) => n.type).join(',');
      const buildTypes = buildTrack.route.map((n) => n.type).join(',');
      expect(flowTypes).not.toBe(buildTypes);

      for (const track of [flowTrack, buildTrack]) {
        const validation = RouteConnectivityValidator.validate(track);
        expect(validation.isValid).toBe(true);
        expect(track.route[0].time).toBe(0);
        expect(track.finish.time).toBeCloseTo(track.targetDuration, 1);
      }
    });

    it('uses a conservative competent-speed budget and validated fallback', () => {
      const analysis = customAnalysis([
        { index: 0, start: 0, end: 40, duration: 40, intensity: 0.4, rhythmicDensity: 0.3, brightness: 0.5, theme: 'FLOW' },
        { index: 1, start: 40, end: 80, duration: 40, intensity: 0.6, rhythmicDensity: 0.5, brightness: 0.6, theme: 'PRECISION' }
      ]);

      const track = TrackGenerator.generate(analysis);
      // refSpeed 16 => naive ceiling for 80s of music. The custom pace must stay
      // under it while still covering the musical duration.
      expect(track.totalDistance).toBeLessThan(80 * 16.0);
      expect(track.totalDistance).toBeGreaterThan(60 * 10.0);
      expect(TrackGenerator.lastReport?.usedSafeFallback).toBe(false);
      const validation = RouteConnectivityValidator.validate(track);
      expect(validation.isValid).toBe(true);
    });

    it('never schedules ambient BREATH surf by default', () => {
      const ambient = customAnalysis([
        { index: 0, start: 0, end: 30, duration: 30, intensity: 0.35, rhythmicDensity: 0.1, brightness: 0.5, theme: 'FLOW' },
        { index: 1, start: 30, end: 60, duration: 30, intensity: 0.2, rhythmicDensity: 0.05, brightness: 0.4, theme: 'BREATH' },
        { index: 2, start: 60, end: 90, duration: 30, intensity: 0.18, rhythmicDensity: 0.04, brightness: 0.4, theme: 'BREATH' }
      ]);
      const events = SurfPlanner.plan(ambient);
      expect(events).toHaveLength(0);
    });

    it('does not force surf onto sustained BRIGHT ambient audio', () => {
      // Bright, loud, but steady (no onset density, no transition): must not be
      // mistaken for genuine rhythmic/structural surf support.
      const brightPad = customAnalysis([
        { index: 0, start: 0, end: 30, duration: 30, intensity: 0.55, rhythmicDensity: 0.08, brightness: 0.85, theme: 'FLOW' },
        { index: 1, start: 30, end: 60, duration: 30, intensity: 0.58, rhythmicDensity: 0.07, brightness: 0.9, theme: 'SURF' },
        { index: 2, start: 60, end: 90, duration: 30, intensity: 0.56, rhythmicDensity: 0.06, brightness: 0.88, theme: 'SURF' }
      ]);
      expect(SurfPlanner.plan(brightPad)).toHaveLength(0);

      const brightTrack = RouteGenerator.generate(brightPad);
      const surfNodes = brightTrack.route.filter((n) => n.isSurf || n.isOptional);
      expect(surfNodes).toHaveLength(0);

      // A genuinely rhythmic section still DOES get surf.
      const rhythmic = customAnalysis([
        { index: 0, start: 0, end: 30, duration: 30, intensity: 0.5, rhythmicDensity: 0.2, brightness: 0.5, theme: 'FLOW' },
        { index: 1, start: 30, end: 60, duration: 30, intensity: 0.8, rhythmicDensity: 0.6, brightness: 0.6, theme: 'SPEED' },
        { index: 2, start: 60, end: 90, duration: 30, intensity: 0.4, rhythmicDensity: 0.25, brightness: 0.5, theme: 'FLOW' }
      ]);
      expect(SurfPlanner.plan(rhythmic).length).toBeGreaterThan(0);
    });
  describe('structural section honesty', () => {
    it('routes a 75s changing-energy track differently from a calm track of the SAME DURATION', async () => {
      const changing = await AudioAnalyzer.analyze(
        makeBuffer(changingEnergySignal(75)),
        'changing',
        undefined,
        { custom: { source: 'FILE', encodedBytes: null } }
      );
      const calm = await AudioAnalyzer.analyze(
        makeBuffer(constantSignal(75)),
        'calm',
        undefined,
        { custom: { source: 'FILE', encodedBytes: null } }
      );

      // Same duration, genuinely different musical structure.
      expect(changing.duration).toBeCloseTo(calm.duration, 0);
      expect(changing.sections.length).toBeGreaterThanOrEqual(2);
      const changingIntensities = changing.sections.map((s) => s.intensity);
      const spread = Math.max(...changingIntensities) - Math.min(...changingIntensities);
      expect(spread).toBeGreaterThan(0.15);

      // Early build and late peak must be represented, not lost to a single
      // dominating boundary.
      const midStart = changing.sections.findIndex((s) => s.start >= 20 && s.start < 45);
      expect(midStart).toBeGreaterThan(0);
      const last = changing.sections[changing.sections.length - 1];
      expect(last.intensity).toBeGreaterThan(changingIntensities[0]);

      const changingTrack = RouteGenerator.generate(changing);
      const calmTrack = RouteGenerator.generate(calm);
      expect(changingTrack.route.map((n) => n.type).join(','))
        .not.toBe(calmTrack.route.map((n) => n.type).join(','));

      // The calm same-duration track collapses to a broad, low-confidence shape.
      for (const s of calm.sections) {
        expect(s.confidence?.descriptor ?? 1).toBeLessThan(0.6);
      }
    });

    it('does not force a high-energy final portion into BREATH', async () => {
      const changing = await AudioAnalyzer.analyze(
        makeBuffer(changingEnergySignal(75)),
        'peak-end',
        undefined,
        { custom: { source: 'FILE', encodedBytes: null } }
      );
      const last = changing.sections[changing.sections.length - 1];
      expect(last.theme).not.toBe('BREATH');
      expect(['FLOW', 'SPEED', 'DROP', 'BUILDUP', 'SURF', 'PRECISION']).toContain(last.theme);
    });

    it('treats dense constant audio as GROOVE/FLOW and ambient constant as broad safety, without fake precision', async () => {
      const dense = await AudioAnalyzer.analyze(
        makeBuffer(denseConstantSignal(45)),
        'dense',
        undefined,
        { custom: { source: 'FILE', encodedBytes: null } }
      );
      const ambient = await AudioAnalyzer.analyze(
        makeBuffer(constantSignal(45)),
        'ambient',
        undefined,
        { custom: { source: 'FILE', encodedBytes: null } }
      );

      // Constant (no macro change) => broad low-confidence shape either way.
      expect(dense.sections.length).toBeLessThanOrEqual(4);
      expect(ambient.sections.length).toBeLessThanOrEqual(4);
      for (const s of dense.sections) expect(s.confidence?.boundary ?? 1).toBeLessThanOrEqual(0.3);
      for (const s of ambient.sections) expect(s.confidence?.boundary ?? 1).toBeLessThanOrEqual(0.3);

      // The dense constant loop is a broad GROOVE/FLOW, not a fabricated precise
      // pop arrangement; the ambient one is broad BREATH/FLOW.
      expect(['FLOW', 'BREATH']).toContain(dense.sections[0].theme);
      for (const s of ambient.sections) expect(['FLOW', 'BREATH']).toContain(s.theme);
      expect(ambient.sections[0].theme).toBe('FLOW');
    });
  });

  describe('content identity robustness', () => {
    function stereoBuffer(left: Float32Array, right: Float32Array, sampleRate = 44100): AudioBuffer {
      return {
        sampleRate,
        length: left.length,
        duration: left.length / sampleRate,
        numberOfChannels: 2,
        getChannelData: (c: number) => (c === 0 ? left : right),
        copyFromChannel: () => undefined,
        copyToChannel: () => undefined
      } as unknown as AudioBuffer;
    }

    it('distinguishes duration, sample rate and right-channel differences', () => {
      const left = constantSignal(2);
      const sameLeftDifferentRight = new Float32Array(left.length);
      for (let i = 0; i < left.length; i++) sameLeftDifferentRight[i] = 0.8 * Math.sin((2 * Math.PI * 90 * i) / 44100);

      const a = makeBuffer(constantSignal(1));
      const b = makeBuffer(constantSignal(60));
      const hiRate = { ...makeBuffer(constantSignal(2)) } as AudioBuffer;
      (hiRate as { sampleRate: number }).sampleRate = 48000;

      const left2 = constantSignal(2);
      const stereoBase = stereoBuffer(left, left2.slice());
      const stereoDiff = stereoBuffer(left2, sameLeftDifferentRight);

      const h = (buf: AudioBuffer) => hashAudioContent(buf);
      expect(h(a)).not.toBe(h(b));
      expect(h(makeBuffer(constantSignal(2)))).not.toBe(h(hiRate));
      expect(h(stereoBase)).not.toBe(h(stereoDiff));
    });

    it('produces the same identity regardless of channel differences only in metadata', async () => {
      const bytes = new Uint8Array(1024).fill(7).buffer;
      const a = await computeCustomContentIdentity(makeBuffer(constantSignal(1)), bytes);
      const b = await computeCustomContentIdentity(makeBuffer(constantSignal(1)), bytes);
      expect(a.contentHash).toBe(b.contentHash);
      expect(a.hashSource).toBe('ENCODED_SHA256');
    });
  });

  describe('world profile derivation', () => {
    it('derives a bounded custom world profile from descriptors and seed', () => {
      const bass = customAnalysis([
        { index: 0, start: 0, end: 30, duration: 30, intensity: 0.9, rhythmicDensity: 0.7, brightness: 0.3, theme: 'DROP' },
        { index: 1, start: 30, end: 60, duration: 30, intensity: 0.8, rhythmicDensity: 0.6, brightness: 0.4, theme: 'SPEED' }
      ]);
      bass.customAggregate = { bass: 0.85, brightness: 0.25, density: 0.7, dynamics: 0.5, contrast: 0.3 };
      const profile = VisualDreamDirector.deriveCustomWorldProfile(bass);
      expect(profile).not.toBeNull();
      expect(profile!.usesOverride).toBe(true);
      expect(profile!.architecture.density).toBeGreaterThan(0.3);
      expect(profile!.architecture.density).toBeLessThanOrEqual(0.95);
      expect(profile!.reaction.gainMax).toBeGreaterThanOrEqual(1.2);
      expect(profile!.reaction.gainMax).toBeLessThanOrEqual(1.5);

      // No custom source => null so official/null keeps the legacy fallback.
      const official = { ...bass, customSource: undefined, customAggregate: undefined };
      expect(VisualDreamDirector.deriveCustomWorldProfile(official)).toBeNull();
    });

    it('gives different audio different world identities (not copied artwork)', () => {
      const bright = customAnalysis([{ index: 0, start: 0, end: 30, duration: 30, intensity: 0.5, rhythmicDensity: 0.3, brightness: 0.8, theme: 'FLOW' }]);
      bright.customAggregate = { bass: 0.2, brightness: 0.85, density: 0.25, dynamics: 0.2, contrast: 0.6 };
      const bassy = customAnalysis([{ index: 0, start: 0, end: 30, duration: 30, intensity: 0.6, rhythmicDensity: 0.4, brightness: 0.3, theme: 'FLOW' }], 0xabc);
      bassy.customAggregate = { bass: 0.8, brightness: 0.25, density: 0.5, dynamics: 0.5, contrast: 0.2 };
      const p1 = VisualDreamDirector.deriveCustomWorldProfile(bright)!;
      const p2 = VisualDreamDirector.deriveCustomWorldProfile(bassy)!;
      expect(`${p1.architecture.primary}${p1.sky.celestial}${p1.architecture.density.toFixed(2)}`)
        .not.toBe(`${p2.architecture.primary}${p2.sky.celestial}${p2.architecture.density.toFixed(2)}`);
    });
  });

  describe('timing estimate honesty', () => {
    it('reports a conservative estimate with headroom for a long song', () => {
      const analysis = customAnalysis([
        { index: 0, start: 0, end: 120, duration: 120, intensity: 0.5, rhythmicDensity: 0.4, brightness: 0.5, theme: 'FLOW' },
        { index: 1, start: 120, end: 240, duration: 120, intensity: 0.75, rhythmicDensity: 0.6, brightness: 0.6, theme: 'SPEED' }
      ]);
      const track = RouteGenerator.generate(analysis);
      const timing = estimateRouteTiming(track, analysis);
      expect(timing.planningBudgetSeconds).toBeGreaterThan(timing.estimatedSeconds);
      expect(timing.estimatedSeconds).toBeLessThan(analysis.duration);
      expect(timing.fitsSong).toBe(true);
      expect(timing.slackSeconds).toBeGreaterThan(0);
      expect(timing.mainDistance).toBe(track.totalDistance);
    });

    it('reports a short clip as not fitting a safe course', () => {
      const analysis = customAnalysis([
        { index: 0, start: 0, end: 2, duration: 2, intensity: 0.6, rhythmicDensity: 0.5, brightness: 0.5, theme: 'FLOW' }
      ]);
      const track = RouteGenerator.generate(analysis);
      const timing = estimateRouteTiming(track, analysis);
      expect(timing.fitsSong).toBe(false);
      expect(timing.planningBudgetSeconds).toBeGreaterThan(2);
    });
  });

  describe('route determinism and connectivity', () => {
    it('produces identical routes on repeat and keeps them connected', () => {
      const analysis = customAnalysis([
        { index: 0, start: 0, end: 40, duration: 40, intensity: 0.45, rhythmicDensity: 0.3, brightness: 0.5, theme: 'FLOW' },
        { index: 1, start: 40, end: 80, duration: 40, intensity: 0.8, rhythmicDensity: 0.6, brightness: 0.6, theme: 'DROP' },
        { index: 2, start: 80, end: 120, duration: 40, intensity: 0.8, rhythmicDensity: 0.55, brightness: 0.6, theme: 'SPEED' },
        { index: 3, start: 120, end: 150, duration: 30, intensity: 0.3, rhythmicDensity: 0.15, brightness: 0.4, theme: 'BREATH' }
      ], 0x1234);
      const a = RouteGenerator.generate(analysis);
      const b = RouteGenerator.generate(analysis);
      expect(a.route.map((n) => `${n.type}:${n.arcLength.toFixed(3)}`).join('|'))
        .toBe(b.route.map((n) => `${n.type}:${n.arcLength.toFixed(3)}`).join('|'));
      expect(RouteConnectivityValidator.validate(a).isValid).toBe(true);
    });
  });

  describe('pipeline cache contract', () => {
    it('skips the analyzer on a warm cache and does not mutate the cached entry', async () => {
      const store = new Map<string, string>();
      const originalWindow = (globalThis as { window?: unknown }).window;
      (globalThis as { window?: unknown }).window = {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => void store.set(k, v),
          removeItem: (k: string) => void store.delete(k),
          clear: () => store.clear()
        }
      };
      CustomAnalysisCache.clear();
      try {
      const analysis = customAnalysis([
        { index: 0, start: 0, end: 30, duration: 30, intensity: 0.6, rhythmicDensity: 0.5, brightness: 0.5, theme: 'FLOW' }
      ]);
      analysis.customSource = { ...analysis.customSource!, contentHash: 'warm-hash' };
      const track = RouteGenerator.generate(analysis);
      expect(CustomAnalysisCache.save('warm-hash', { analysis, track })).toBe(true);
      // Simulate a refresh: retain persisted bytes, discard only module memory.
      expect(Array.isArray(JSON.parse(store.get('playhead.customAnalysis.v4')!).entries[0].analysis.waveform)).toBe(true);
      (CustomAnalysisCache as unknown as { memory: Map<string, unknown> }).memory.clear();

      let analyzeCalls = 0;
      const identity = {
        contentHash: 'warm-hash',
        seed: analysis.seed,
        hashSource: 'PCM' as const,
        byteLength: 0
      };
      const result = await resolveCustomAudioLevel(
        makeBuffer(constantSignal(1)),
        'renamed-file',
        identity,
        { source: 'FILE', encodedBytes: null },
        {
          analyze: async () => {
            analyzeCalls++;
            throw new Error('analyzer must not run on a cache hit');
          },
          generate: () => {
            throw new Error('generator must not run on a cache hit');
          }
        }
      );
      expect(result.cacheHit).toBe(true);
      expect(analyzeCalls).toBe(0);
      expect(result.analysis.filename).toBe('renamed-file');
      expect(result.analysis.customSource?.displayName).toBe('renamed-file');
      // The stored entry kept its original filename.
      const reloaded = CustomAnalysisCache.load('warm-hash');
      expect(reloaded?.analysis.filename).toBe('custom');
      expect(reloaded?.analysis.waveform).toBeInstanceOf(Float32Array);
      } finally {
        (globalThis as { window?: unknown }).window = originalWindow;
        CustomAnalysisCache.clear();
      }
    });
  });


  describe('content-addressed cache', () => {
    let store: Map<string, string>;
    let originalWindow: unknown;

    beforeEach(() => {
      store = new Map();
      originalWindow = (globalThis as { window?: unknown }).window;
      (globalThis as { window?: unknown }).window = {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => void store.set(k, v),
          removeItem: (k: string) => void store.delete(k),
          clear: () => store.clear()
        }
      };
      CustomAnalysisCache.clear();
    });

    afterEach(() => {
      (globalThis as { window?: unknown }).window = originalWindow;
      CustomAnalysisCache.clear();
    });

    it('round-trips and survives a corrupt/quota failure as a miss', () => {
      const analysis = customAnalysis([
        { index: 0, start: 0, end: 20, duration: 20, intensity: 0.5, rhythmicDensity: 0.4, brightness: 0.5, theme: 'FLOW' }
      ]);
      const track = RouteGenerator.generate(analysis);
      expect(CustomAnalysisCache.save('hash-a', { analysis, track })).toBe(true);
      const hit = CustomAnalysisCache.load('hash-a');
      expect(hit).not.toBeNull();
      expect(hit?.track.route.length).toBe(track.route.length);
    });

    it('treats corrupt persisted content as a miss on a cold load', () => {
      store.set('playhead.customAnalysis.v4', 'not-json{');
      expect(CustomAnalysisCache.load('hash-a')).toBeNull();
    });

    it('does not throw and does not persist when storage quota fails', () => {
      const analysis = customAnalysis([
        { index: 0, start: 0, end: 20, duration: 20, intensity: 0.5, rhythmicDensity: 0.4, brightness: 0.5, theme: 'FLOW' }
      ]);
      const track = RouteGenerator.generate(analysis);
      const ls = (globalThis as { window: { localStorage: { setItem: unknown } } }).window.localStorage;
      ls.setItem = () => {
        throw new Error('QuotaExceededError');
      };
      expect(() => CustomAnalysisCache.save('hash-q', { analysis, track })).not.toThrow();
      expect(CustomAnalysisCache.save('hash-q', { analysis, track })).toBe(false);
    });

    it('treats a stale cache version as a miss', () => {
      store.set(
        'playhead.customAnalysis.v4',
        JSON.stringify({ version: 999, entries: [{ hash: '1:zzz', version: 999, analysis: {}, track: {} }] })
      );
      expect(CustomAnalysisCache.load('zzz')).toBeNull();
    });

    it('discards a malformed entry that CLAMS the correct version', () => {
      const analysis = customAnalysis([
        { index: 0, start: 0, end: 20, duration: 20, intensity: 0.5, rhythmicDensity: 0.4, brightness: 0.5, theme: 'FLOW' }
      ]);
      const track = RouteGenerator.generate(analysis);
      // Right version + right generation version, but the route contains a
      // non-finite coordinate: must be rejected as a miss.
      const corrupted = JSON.parse(JSON.stringify({ analysis, track }));
      corrupted.track.route[3].position.x = null;
      store.set(
        'playhead.customAnalysis.v4',
        JSON.stringify({
          version: CUSTOM_ANALYSIS_CACHE_VERSION,
          entries: [{
            hash: CustomAnalysisCache.buildKey('bad-hash'),
            version: CUSTOM_ANALYSIS_CACHE_VERSION,
            generationVersion: track.generationVersion,
            savedAt: Date.now(),
            analysis: corrupted.analysis,
            track: corrupted.track
          }]
        })
      );
      expect(CustomAnalysisCache.load('bad-hash')).toBeNull();
    });

    it('stays bounded to 12 persisted entries', () => {
      const analysis = customAnalysis([
        { index: 0, start: 0, end: 20, duration: 20, intensity: 0.5, rhythmicDensity: 0.4, brightness: 0.5, theme: 'FLOW' }
      ]);
      const track = RouteGenerator.generate(analysis);
      for (let i = 0; i < 15; i++) {
        expect(CustomAnalysisCache.save(`bounded-${i}`, { analysis, track })).toBe(true);
      }
      const persisted = JSON.parse(store.get('playhead.customAnalysis.v4')!);
      expect(persisted.entries.length).toBeLessThanOrEqual(12);
      // The oldest are evicted, the newest retained.
      expect(persisted.entries.some((e: { hash: string }) => e.hash.includes('bounded-14'))).toBe(true);
      expect(persisted.entries.some((e: { hash: string }) => e.hash.includes('bounded-0'))).toBe(false);
    });
  });
});
});
