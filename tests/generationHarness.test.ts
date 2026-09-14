import { describe, it, expect } from 'vitest';
import { RouteGenerator } from '../src/generation/RouteGenerator';
import { RouteValidator } from '../src/generation/RouteValidator';
import { TrackAnalysis, AnalysisSection, SectionTheme } from '../src/audio/AudioFeatures';
import { RouteNodeType } from '../src/generation/GenerationTypes';

function createMockAnalysis(params: {
  seed: number;
  duration: number;
  bpm: number;
  genre: 'ELECTRONIC_DROP' | 'AMBIENT_SPARSE' | 'BREAKBEAT_DNB' | 'NEAR_SILENT' | 'RANDOM';
  sectionCount?: number;
}): TrackAnalysis {
  const { seed, duration, bpm, genre } = params;
  const sections: AnalysisSection[] = [];

  if (genre === 'ELECTRONIC_DROP') {
    const times = [0, 15, 30, 45, 55, 68, duration];
    const themes: SectionTheme[] = ['FLOW', 'SPEED', 'BREATH', 'BUILDUP', 'DROP', 'FLOW'];
    for (let i = 0; i < themes.length; i++) {
      const s = times[i];
      const e = times[i + 1] || duration;
      sections.push({
        index: i,
        start: s,
        end: e,
        duration: e - s,
        intensity: themes[i] === 'DROP' ? 0.95 : themes[i] === 'BREATH' ? 0.2 : 0.6,
        rhythmicDensity: themes[i] === 'DROP' ? 0.9 : 0.5,
        brightness: 0.6,
        theme: themes[i]
      });
    }
  } else if (genre === 'AMBIENT_SPARSE') {
    const count = 4;
    const sLen = duration / count;
    for (let i = 0; i < count; i++) {
      sections.push({
        index: i,
        start: i * sLen,
        end: (i + 1) * sLen,
        duration: sLen,
        intensity: 0.15 + (i % 2) * 0.1,
        rhythmicDensity: 0.1,
        brightness: 0.4,
        theme: i === 0 ? 'FLOW' : i % 2 === 1 ? 'BREATH' : 'PRECISION'
      });
    }
  } else if (genre === 'BREAKBEAT_DNB') {
    const count = 5;
    const sLen = duration / count;
    for (let i = 0; i < count; i++) {
      sections.push({
        index: i,
        start: i * sLen,
        end: (i + 1) * sLen,
        duration: sLen,
        intensity: 0.75 + (i % 3) * 0.1,
        rhythmicDensity: 0.85,
        brightness: 0.75,
        theme: i === 0 ? 'FLOW' : i === 1 ? 'SPEED' : i === 2 ? 'SURF' : i === 3 ? 'ASCENT' : 'SPEED'
      });
    }
  } else if (genre === 'NEAR_SILENT') {
    const count = 3;
    const sLen = duration / count;
    for (let i = 0; i < count; i++) {
      sections.push({
        index: i,
        start: i * sLen,
        end: (i + 1) * sLen,
        duration: sLen,
        intensity: 0.05,
        rhythmicDensity: 0.02,
        brightness: 0.2,
        theme: i === 0 ? 'FLOW' : 'BREATH'
      });
    }
  } else {
    // RANDOM genre
    const count = params.sectionCount || Math.max(3, Math.floor(duration / 20));
    const step = duration / count;
    const availableThemes: SectionTheme[] = ['FLOW', 'ASCENT', 'DESCENT', 'SURF', 'SPEED', 'PRECISION', 'BREATH', 'BUILDUP', 'DROP'];
    for (let i = 0; i < count; i++) {
      const themeIdx = (seed + i * 7) % availableThemes.length;
      sections.push({
        index: i,
        start: i * step,
        end: (i + 1) * step,
        duration: step,
        intensity: ((seed * 13 + i * 17) % 100) / 100,
        rhythmicDensity: ((seed * 19 + i * 23) % 100) / 100,
        brightness: ((seed * 31 + i * 7) % 100) / 100,
        theme: i === 0 ? 'FLOW' : availableThemes[themeIdx]
      });
    }
  }

  return {
    filename: `stress_test_${genre}_${seed}.wav`,
    duration,
    bpm,
    bpmConfidence: 0.85,
    globalEnergy: 0.6,
    frames: [],
    onsets: [],
    sections,
    waveform: new Float32Array(512),
    seed,
    visualAccent: { name: 'Icy Cyan', hex: '#00f0ff', rgb: [0, 240, 255] }
  };
}

describe('Generation QA Stress Harness (100+ Course Invariants)', () => {
  it('validates invariants on core curated genres', () => {
    const genres: Array<'ELECTRONIC_DROP' | 'AMBIENT_SPARSE' | 'BREAKBEAT_DNB' | 'NEAR_SILENT'> = [
      'ELECTRONIC_DROP',
      'AMBIENT_SPARSE',
      'BREAKBEAT_DNB',
      'NEAR_SILENT'
    ];

    for (const genre of genres) {
      const analysis = createMockAnalysis({
        seed: 0x12345678,
        duration: genre === 'ELECTRONIC_DROP' ? 75 : 60,
        bpm: genre === 'BREAKBEAT_DNB' ? 174 : genre === 'AMBIENT_SPARSE' ? 70 : 128,
        genre
      });

      const track = RouteGenerator.generate(analysis);
      assertTrackInvariants(track, analysis);
    }
  });

  it('validates 100 randomized procedural courses across varied durations, BPMs and seeds', () => {
    const totalRuns = 100;
    for (let i = 0; i < totalRuns; i++) {
      const seed = 0x10000000 + i * 1618033;
      const duration = 25 + (i % 10) * 15; // 25s to 160s
      const bpm = 80 + (i % 25) * 4; // 80 to 180 BPM
      const sectionCount = 3 + (i % 8); // 3 to 10 sections

      const analysis = createMockAnalysis({
        seed,
        duration,
        bpm,
        genre: 'RANDOM',
        sectionCount
      });

      const track = RouteGenerator.generate(analysis);
      assertTrackInvariants(track, analysis);
    }
  });
});

function assertTrackInvariants(
  track: ReturnType<typeof RouteGenerator.generate>,
  analysis: TrackAnalysis
) {
  const { route, checkpoints, finish, totalDistance } = track;

  // 1. Course must contain platforms
  expect(route.length).toBeGreaterThanOrEqual(5);
  expect(totalDistance).toBeGreaterThan(50);
  expect(Number.isFinite(totalDistance)).toBe(true);

  // 2. Start platform invariant
  expect(route[0].type).toBe(RouteNodeType.RUNWAY);
  expect(route[0].time).toBe(0);
  expect(route[0].position.x).toBe(0);
  expect(route[0].position.y).toBe(0);
  expect(route[0].position.z).toBe(0);

  // 3. Finish platform invariant
  expect(finish).toBeDefined();
  const finishNode = route[route.length - 1];
  expect(finishNode.type).toBe(RouteNodeType.FINISH);
  expect(finish.routeNodeId).toBe(finishNode.id);
  expect(finish.time).toBeCloseTo(analysis.duration, 2);

  // 4. Checkpoints count matches sections > 0
  expect(checkpoints.length).toBe(analysis.sections.length - 1);
  for (let c = 0; c < checkpoints.length; c++) {
    const cp = checkpoints[c];
    expect(Number.isFinite(cp.position.x)).toBe(true);
    expect(Number.isFinite(cp.position.y)).toBe(true);
    expect(Number.isFinite(cp.position.z)).toBe(true);
    expect(cp.sectionIndex).toBe(c + 1);
    if (c > 0) {
      expect(cp.time).toBeGreaterThan(checkpoints[c - 1].time);
    }
  }

  // 5. Node-by-node invariants
  let prevArcLength = -1;
  for (let i = 0; i < route.length; i++) {
    const node = route[i];

    // Coordinate finiteness
    expect(Number.isFinite(node.position.x)).toBe(true);
    expect(Number.isFinite(node.position.y)).toBe(true);
    expect(Number.isFinite(node.position.z)).toBe(true);
    expect(Number.isNaN(node.position.x)).toBe(false);
    expect(Number.isNaN(node.position.y)).toBe(false);
    expect(Number.isNaN(node.position.z)).toBe(false);

    // Dimension bounds
    expect(node.dimensions.x).toBeGreaterThanOrEqual(4.99); // min width >= 5.0
    expect(node.dimensions.y).toBeGreaterThanOrEqual(1.0);
    expect(node.dimensions.z).toBeGreaterThanOrEqual(5.99); // min length >= 6.0
    expect(Number.isFinite(node.dimensions.x)).toBe(true);
    expect(Number.isFinite(node.dimensions.y)).toBe(true);
    expect(Number.isFinite(node.dimensions.z)).toBe(true);

    // Progression monotonicity
    expect(node.arcLength).toBeGreaterThanOrEqual(prevArcLength);
    prevArcLength = node.arcLength;

    // Section index validity
    expect(node.sectionIndex).toBeGreaterThanOrEqual(0);
    expect(node.sectionIndex).toBeLessThan(analysis.sections.length);

    // Jump feasability between adjacent platforms
    if (i < route.length - 1) {
      const next = route[i + 1];
      const currentEnd = {
        x: node.position.x + Math.sin(node.yaw) * (node.dimensions.z * 0.5),
        y: node.position.y + node.dimensions.y * 0.5,
        z: node.position.z + Math.cos(node.yaw) * (node.dimensions.z * 0.5)
      };
      const nextStart = {
        x: next.position.x - Math.sin(next.yaw) * (next.dimensions.z * 0.5),
        y: next.position.y + next.dimensions.y * 0.5,
        z: next.position.z - Math.cos(next.yaw) * (next.dimensions.z * 0.5)
      };

      const stepUp = nextStart.y - currentEnd.y;
      // Validator guarantees step up <= maxStepUp (1.35m) with tiny floating tolerance
      expect(stepUp).toBeLessThanOrEqual(1.45);

      const dx = nextStart.x - currentEnd.x;
      const dz = nextStart.z - currentEnd.z;
      const horizontalGap = Math.sqrt(dx * dx + dz * dz);
      expect(Number.isFinite(horizontalGap)).toBe(true);

      // Verify gap is within feasible limits
      const maxJump = RouteValidator.calculateMaxJumpDistance(stepUp);
      // If gap is significant, it must be within safe jump limits or repaired
      if (horizontalGap > 2.0 && !node.isSurf && !next.isSurf) {
        expect(horizontalGap).toBeLessThanOrEqual(Math.max(maxJump * 1.05, 12.0));
      }
    }
  }
}
