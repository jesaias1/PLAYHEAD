/**
 * AUDIO-REACTIVE WORLD CHOREOGRAPHY — logic tests.
 *
 * These verify the MAPPING between music signals and visual channels, the
 * dynamic range of the response, section-level behaviour, and the architectural
 * rules (one analyser, presentation-only, gameplay untouched).
 *
 * They do NOT and cannot verify that the world looks or feels audio-reactive.
 * Human testing is authoritative for that.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  ChannelIsolation,
  MusicVisualController,
  resolveChannels
} from '../src/world/MusicVisualController';
import {
  AnalysisFrame,
  AnalysisSection,
  OnsetEvent,
  SectionTheme,
  TrackAnalysis
} from '../src/audio/AudioFeatures';
import { PLAYHEAD_MOVEMENT_V1 } from '../src/player/MovementConfig';
import { computeTempoPressure, computeTempoProfile } from '../src/generation/TempoPressure';
import { QUALITY_PRESETS } from '../src/rendering/QualityPresets';
import { RouteGenerator } from '../src/generation/RouteGenerator';

interface BandSpec {
  rms?: number;
  bass?: number;
  subBass?: number;
  lowMid?: number;
  mid?: number;
  high?: number;
  centroid?: number;
  flux?: number;
}

const FRAME_DT = 0.02;

function makeAnalysis(opts: {
  duration?: number;
  bands: BandSpec;
  themes?: Array<{ theme: SectionTheme; start: number; end: number; intensity?: number }>;
  onsets?: Array<{ time: number; strength: number }>;
  seed?: number;
}): TrackAnalysis {
  const duration = opts.duration ?? 12;
  const frameCount = Math.floor(duration / FRAME_DT);
  const b = opts.bands;

  const frames: AnalysisFrame[] = [];
  for (let i = 0; i < frameCount; i++) {
    frames.push({
      time: i * FRAME_DT,
      rms: b.rms ?? 0.4,
      bass: b.bass ?? 0.4,
      lowMid: b.lowMid ?? 0.4,
      mid: b.mid ?? 0.4,
      high: b.high ?? 0.3,
      centroid: b.centroid ?? 0.5,
      flux: b.flux ?? 0.2,
      density: 0.4
    });
  }

  const sections: AnalysisSection[] = (opts.themes ?? [
    { theme: 'FLOW' as SectionTheme, start: 0, end: duration, intensity: 0.5 }
  ]).map((s, i) => ({
    index: i,
    start: s.start,
    end: s.end,
    duration: s.end - s.start,
    intensity: s.intensity ?? 0.5,
    rhythmicDensity: 0.5,
    brightness: 0.5,
    theme: s.theme
  }));

  const onsets: OnsetEvent[] = (opts.onsets ?? []).map((o) => ({
    time: o.time,
    strength: o.strength,
    bass: 0.5,
    mids: 0.5,
    highs: 0.5
  }));

  return {
    filename: 'test.wav',
    duration,
    bpm: 128,
    bpmConfidence: 0.9,
    globalEnergy: 0.6,
    frames,
    onsets,
    sections,
    waveform: new Float32Array(512).fill(0.4),
    seed: opts.seed ?? 1234,
    visualAccent: { name: 'Cyan', hex: '#00f0ff', rgb: [0, 240, 255] }
  };
}

/** Runs the controller forward for `seconds` and returns it. */
function run(
  controller: MusicVisualController,
  seconds: number,
  opts: { from?: number; dt?: number } = {}
): MusicVisualController {
  const dt = opts.dt ?? FRAME_DT;
  let t = opts.from ?? 0;
  const steps = Math.max(1, Math.round(seconds / dt));
  for (let i = 0; i < steps; i++) {
    t += dt;
    controller.update(t, t * 10, dt, 0);
  }
  return controller;
}

function freshController(analysis: TrackAnalysis): MusicVisualController {
  const c = new MusicVisualController();
  c.init(analysis, {
    seed: analysis.seed,
    route: [],
    checkpoints: [],
    finish: { routeNodeId: 0, time: 0, position: { x: 0, y: 0, z: 0 }, yaw: 0 },
    totalDistance: 1000,
    targetDuration: analysis.duration,
    repairedJumpsCount: 0
  });
  return c;
}

describe('Audio choreography — music mapping', () => {
  it('bass drives the bass mass channel', () => {
    const quiet = run(
      freshController(makeAnalysis({ bands: { bass: 0.05, subBass: 0.05 } })),
      2.0
    );
    const loud = run(
      freshController(makeAnalysis({ bands: { bass: 0.95, subBass: 0.9 } })),
      2.0
    );
    expect(loud.state.channels.bassMass).toBeGreaterThan(quiet.state.channels.bassMass + 0.3);
    expect(quiet.state.channels.bassMass).toBeLessThan(0.35);
  });

  it('high frequency + flux drive the high glint channel', () => {
    const quiet = run(freshController(makeAnalysis({ bands: { high: 0.05, flux: 0.02 } })), 1.5);
    const loud = run(freshController(makeAnalysis({ bands: { high: 0.95, flux: 0.9 } })), 1.5);
    expect(loud.state.channels.highGlint).toBeGreaterThan(quiet.state.channels.highGlint + 0.3);
  });

  it('gives bass and highs genuinely different envelopes (heavy vs sharp)', () => {
    const analysis = makeAnalysis({ bands: { bass: 0.9, subBass: 0.9, high: 0.9, flux: 0.9 } });
    const c = freshController(analysis);
    run(c, 1.5);

    const settledBass = c.state.channels.bassMass;
    const settledHigh = c.state.channels.highGlint;
    expect(settledBass).toBeGreaterThan(0.5);
    expect(settledHigh).toBeGreaterThan(0.5);

    // Silence the track, then advance a short window: the sharp channel must
    // fall much further than the heavy one.
    const silent = makeAnalysis({ bands: { bass: 0, subBass: 0, high: 0, flux: 0 } });
    c.init(silent, {
      seed: 1, route: [], checkpoints: [],
      finish: { routeNodeId: 0, time: 0, position: { x: 0, y: 0, z: 0 }, yaw: 0 },
      totalDistance: 1000, targetDuration: silent.duration, repairedJumpsCount: 0
    });
    // Re-seed the envelopes with the loud state, then decay.
    const c2 = freshController(analysis);
    run(c2, 1.5);
    const beforeBass = c2.state.channels.bassMass;
    const beforeHigh = c2.state.channels.highGlint;
    // Swap in a silent analysis without resetting the envelopes.
    (c2 as unknown as { analysis: TrackAnalysis }).analysis = silent;
    run(c2, 0.25, { from: 1.5 });

    const bassDrop = beforeBass - c2.state.channels.bassMass;
    const highDrop = beforeHigh - c2.state.channels.highGlint;
    expect(highDrop).toBeGreaterThan(bassDrop * 1.5);
  });

  it('onsets produce a transient envelope', () => {
    const withOnsets = makeAnalysis({
      bands: { rms: 0.5, bass: 0.5 },
      onsets: [{ time: 1.5, strength: 0.95 }]
    });
    const c = freshController(withOnsets);
    // Stop short of the onset window (the analyser matches within +-25 ms).
    run(c, 1.4);
    const beforeOnset = c.state.channels.transient;
    expect(beforeOnset).toBeLessThan(0.1);

    c.update(1.5, 15, FRAME_DT, 0);
    c.update(1.52, 16, FRAME_DT, 0);
    const atOnset = c.state.channels.transient;
    expect(atOnset).toBeGreaterThan(beforeOnset + 0.2);
    expect(atOnset).toBeGreaterThan(0.4);

    // And it decays again after the hit.
    run(c, 0.4, { from: 1.52 });
    expect(c.state.channels.transient).toBeLessThan(atOnset);
  });

  it('sustained energy keeps a non-zero baseline but stays below the event range', () => {
    const c = run(freshController(makeAnalysis({ bands: { rms: 0.45, bass: 0.45, mid: 0.45, high: 0.4 } })), 2.5);
    const ch = c.state.channels;
    expect(ch.presence).toBeGreaterThan(0);
    // A quiet sustained passage must not sit at the top of the range.
    expect(ch.presence).toBeLessThan(0.85);
  });
});

describe('Audio choreography — drops and sections', () => {
  it('a drop produces a stronger primary response that propagates outward in time', () => {
    const analysis = makeAnalysis({
      bands: { rms: 0.7, bass: 0.8, subBass: 0.8 },
      themes: [
        { theme: 'FLOW', start: 0, end: 2, intensity: 0.4 },
        { theme: 'DROP', start: 2, end: 8, intensity: 0.95 }
      ]
    });
    const c = freshController(analysis);
    run(c, 1.9);
    expect(c.state.channels.dropPrimary).toBeLessThan(0.2);

    // Step across the drop boundary.
    c.update(2.0, 20, FRAME_DT, 0);
    c.update(2.02, 21, FRAME_DT, 0);
    const primaryAtDrop = c.state.channels.dropPrimary;
    expect(primaryAtDrop).toBeGreaterThan(0.5);
    // The delayed channels must lag the primary one at the moment of impact.
    expect(c.state.channels.dropSecondary).toBeLessThan(primaryAtDrop);
    expect(c.state.channels.dropTertiary).toBeLessThan(primaryAtDrop);

    // After the delay window they catch up.
    run(c, 0.35, { from: 2.02 });
    expect(c.state.channels.dropSecondary).toBeGreaterThan(0.2);
    expect(c.state.channels.dropTertiary).toBeGreaterThan(0.1);
  });

  it('BREATH is visually calmer than a dense section, and BUILD raises activity', () => {
    const breath = run(
      freshController(
        makeAnalysis({
          bands: { rms: 0.18, bass: 0.15, mid: 0.12, high: 0.08, flux: 0.05 },
          themes: [{ theme: 'BREATH', start: 0, end: 12, intensity: 0.15 }]
        })
      ),
      3.0
    );
    const dense = run(
      freshController(
        makeAnalysis({
          bands: { rms: 0.8, bass: 0.8, mid: 0.75, high: 0.7, flux: 0.6 },
          themes: [{ theme: 'SPEED', start: 0, end: 12, intensity: 0.85 }]
        })
      ),
      3.0
    );

    expect(breath.state.channels.sectionEnergy).toBeLessThan(dense.state.channels.sectionEnergy);
    expect(breath.state.channels.presence).toBeLessThan(dense.state.channels.presence);

    // BUILD raises section energy above BREATH even with the same audio.
    const bands = { rms: 0.5, bass: 0.5, mid: 0.5, high: 0.4 };
    const build = run(
      freshController(
        makeAnalysis({
          bands,
          themes: [{ theme: 'BUILDUP', start: 0, end: 12, intensity: 0.6 }]
        })
      ),
      3.0
    );
    const flow = run(
      freshController(
        makeAnalysis({ bands, themes: [{ theme: 'FLOW', start: 0, end: 12, intensity: 0.6 }] })
      ),
      3.0
    );
    expect(build.state.channels.sectionEnergy).toBeGreaterThan(flow.state.channels.sectionEnergy);
  });
});

describe('Audio choreography — dynamic range and bounds', () => {
  it('quiet > 0, normal > quiet, drop > normal', () => {
    const quiet = run(
      freshController(
        makeAnalysis({ bands: { rms: 0.12, bass: 0.1, mid: 0.08, high: 0.05 }, themes: [{ theme: 'BREATH', start: 0, end: 12, intensity: 0.12 }] })
      ),
      3.0
    );
    const normal = run(
      freshController(
        makeAnalysis({ bands: { rms: 0.5, bass: 0.5, mid: 0.45, high: 0.35 }, themes: [{ theme: 'FLOW', start: 0, end: 12, intensity: 0.55 }] })
      ),
      3.0
    );
    const drop = run(
      freshController(
        makeAnalysis({ bands: { rms: 0.9, bass: 0.9, mid: 0.85, high: 0.8 }, themes: [{ theme: 'DROP', start: 0, end: 12, intensity: 0.95 }] })
      ),
      3.0
    );

    const q = quiet.state.channels.presence;
    const n = normal.state.channels.presence;
    const d = drop.state.channels.presence;

    expect(q).toBeGreaterThan(0);
    expect(n).toBeGreaterThan(q);
    expect(d).toBeGreaterThan(n);
    // Real headroom: the drop must be clearly stronger, not marginally.
    expect(d).toBeGreaterThan(q + 0.25);
  });

  it('keeps every channel bounded', () => {
    const c = run(
      freshController(
        makeAnalysis({ bands: { rms: 1, bass: 1, mid: 1, high: 1, flux: 1 }, onsets: [{ time: 1, strength: 1 }] })
      ),
      4.0
    );
    const ch = c.state.channels;
    for (const key of [
      'bassMass', 'midFlow', 'highGlint', 'transient',
      'dropPrimary', 'dropSecondary', 'dropTertiary',
      'sectionEnergy', 'presence'
    ] as const) {
      expect(ch[key]).toBeGreaterThanOrEqual(0);
      expect(ch[key]).toBeLessThanOrEqual(1.0001);
    }
    expect(Number.isFinite(ch.scanPhase)).toBe(true);
  });

  it('DEV isolation zeroes the other channel families without touching gameplay', () => {
    const c = run(freshController(makeAnalysis({ bands: { bass: 0.9, mid: 0.9, high: 0.9 } })), 2.0);
    const full = { ...c.state.channels };
    expect(full.bassMass).toBeGreaterThan(0.2);
    expect(full.midFlow).toBeGreaterThan(0.2);
    expect(full.highGlint).toBeGreaterThan(0.2);

    for (const mode of ['BASS', 'MID', 'HIGH'] as ChannelIsolation[]) {
      c.setChannelIsolation(mode);
      run(c, 0.1, { from: 2.0 });
      const ch = c.state.channels;
      const live = mode === 'BASS' ? ch.bassMass : mode === 'MID' ? ch.midFlow : ch.highGlint;
      const others = mode === 'BASS'
        ? [ch.midFlow, ch.highGlint]
        : mode === 'MID'
          ? [ch.bassMass, ch.highGlint]
          : [ch.bassMass, ch.midFlow];
      expect(live).toBeGreaterThan(0);
      for (const o of others) expect(o).toBe(0);
    }

    c.setChannelIsolation('FULL');
    run(c, 0.1, { from: 2.1 });
    expect(c.state.channels.midFlow).toBeGreaterThan(0);
  });
});

describe('Audio choreography — architecture and protected systems', () => {
  const readSrc = (rel: string): string =>
    fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

  it('never creates a second audio analyser or AudioContext', () => {
    const reactiveModules = [
      'src/world/MusicVisualController.ts',
      'src/world/SignalLandmarks.ts',
      'src/world/RouteSignalPackets.ts',
      'src/world/SkylineArchitecture.ts',
      'src/world/CitySignageSystem.ts',
      'src/world/SpectralArchitecture.ts',
      'src/world/ProceduralSky.ts'
    ];
    for (const rel of reactiveModules) {
      const src = readSrc(rel);
      expect(src).not.toMatch(/new\s+AudioContext/);
      expect(src).not.toMatch(/createAnalyser/);
      expect(src).not.toMatch(/AnalyserNode/);
      expect(src).not.toMatch(/new\s+FFT/);
    }
  });

  it('keeps per-track normalisation in the single authoritative analyser', () => {
    const analyzerSrc = readSrc('src/audio/AudioAnalyzer.ts');
    // Percentile normalisation is the existing track-aware normalisation; this
    // pass reuses it rather than adding a parallel one.
    expect(analyzerSrc).toMatch(/normalizePercentile/);
    expect(analyzerSrc).toMatch(/0\.95/);
  });

  it('leaves movement, tempo pressure and quality presets untouched', () => {
    expect(PLAYHEAD_MOVEMENT_V1.gravity).toBe(24.0);
    expect(PLAYHEAD_MOVEMENT_V1.jumpVelocity).toBe(8.8);
    expect(PLAYHEAD_MOVEMENT_V1.groundAcceleration).toBe(10.0);
    expect(PLAYHEAD_MOVEMENT_V1.airAcceleration).toBe(90.0);
    expect(PLAYHEAD_MOVEMENT_V1.maxGroundWishSpeed).toBe(14.0);
    expect(PLAYHEAD_MOVEMENT_V1.maxAirWishSpeed).toBe(3.0);
    expect(PLAYHEAD_MOVEMENT_V1.supplementalAirSteer).toBe(3.5);
    expect(PLAYHEAD_MOVEMENT_V1.friction).toBe(4.5);
    expect(PLAYHEAD_MOVEMENT_V1.stopSpeed).toBe(3.0);
    expect(PLAYHEAD_MOVEMENT_V1.coyoteTime).toBe(0.12);
    expect(PLAYHEAD_MOVEMENT_V1.jumpBufferTime).toBe(0.15);

    const a = makeAnalysis({ bands: { bass: 0.6 } });
    const before = computeTempoProfile(a);
    const pressureBefore = computeTempoPressure(a);
    run(freshController(a), 1.0);
    expect(computeTempoProfile(a)).toEqual(before);
    expect(computeTempoPressure(a)).toBe(pressureBefore);

    // Quality presets stay rendering-only and keep the reactive identity on
    // every tier.
    for (const preset of Object.values(QUALITY_PRESETS)) {
      expect(preset.reactiveLandmarkScale).toBeGreaterThan(0);
      expect(preset.routeSignalPackets).toBeGreaterThan(0);
      expect(preset.bloomScale).toBeGreaterThan(0);
    }
    expect(QUALITY_PRESETS.LOW.reactiveLandmarkScale).toBeLessThan(
      QUALITY_PRESETS.HIGH.reactiveLandmarkScale
    );
    expect(QUALITY_PRESETS.LOW.routeSignalPackets).toBeLessThan(
      QUALITY_PRESETS.HIGH.routeSignalPackets
    );
  });

  it('does not change route generation', () => {
    const a = makeAnalysis({
      bands: { bass: 0.6 },
      themes: [
        { theme: 'FLOW', start: 0, end: 6, intensity: 0.5 },
        { theme: 'SPEED', start: 6, end: 12, intensity: 0.7 }
      ]
    });
    const first = RouteGenerator.generate(a);
    run(freshController(a), 2.0);
    const second = RouteGenerator.generate(a);
    expect(second.route.length).toBe(first.route.length);
    for (let i = 0; i < first.route.length; i++) {
      expect(second.route[i].position.x).toBe(first.route[i].position.x);
      expect(second.route[i].position.y).toBe(first.route[i].position.y);
      expect(second.route[i].position.z).toBe(first.route[i].position.z);
    }
    expect(second.totalDistance).toBe(first.totalDistance);
  });

  it('resolveChannels is a safe compatibility shim for legacy state objects', () => {
    const legacy = {
      time: 4,
      energy: 0.6,
      subBass: 0.7,
      bass: 0.8,
      mid: 0.5,
      high: 0.4,
      flux: 0.3,
      onsetPulse: 0.9,
      dropImpact: 0.2,
      sectionIntensity: 0.6
    };
    const ch = resolveChannels(legacy);
    expect(ch.bassMass).toBeGreaterThan(0.5);
    expect(ch.transient).toBeCloseTo(0.9, 6);
    expect(ch.dropPrimary).toBeCloseTo(0.2, 6);
    expect(ch.presence).toBeGreaterThan(0);
  });
});
