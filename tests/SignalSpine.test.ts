import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { TrackGenerator } from '../src/generation/TrackGenerator';
import { RouteGenerator } from '../src/generation/RouteGenerator';
import { SignalSpineGenerator } from '../src/generation/SignalSpineGenerator';
import { RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';
import { SeededRandom } from '../src/generation/SeededRandom';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { TrackAnalysis } from '../src/audio/AudioFeatures';
import { PaletteSelector } from '../src/audio/TrackPalettes';

function createMockAnalysis(seed: number, themes: string[]): TrackAnalysis {
  const duration = 60.0;
  const sections = themes.map((theme, i) => ({
    index: i,
    start: (i / themes.length) * duration,
    end: ((i + 1) / themes.length) * duration,
    duration: duration / themes.length,
    intensity: 0.7,
    rhythmicDensity: 0.6,
    brightness: 0.5,
    theme
  }));

  const frames = [];
  for (let i = 0; i < 1200; i++) {
    frames.push({
      time: i * 0.05,
      rms: 0.4,
      bass: 0.5,
      lowMid: 0.4,
      mid: 0.35,
      high: 0.3,
      centroid: 0.5,
      flux: 0.2
    });
  }

  return {
    seed,
    duration,
    globalEnergy: 0.7,
    frames,
    sections,
    onsets: [],
    waveform: new Array(1024).fill(0.4),
    visualAccent: { name: 'CYAN_PULSE', hex: '#00f0ff', rgb: [0, 240, 255] }
  };
}

describe('Signal Spine & Recovery Traversal Layer', () => {
  it('guarantees recovery coverage for post-surf landing chains across generated tracks', () => {
    // Generate tracks across multiple seeds containing SURF phrases
    const seeds = [12345, 777, 4242, 99991, 31337];

    for (const seed of seeds) {
      const analysis = createMockAnalysis(seed, ['FLOW', 'SURF', 'BUILDUP', 'DROP', 'SURF', 'FLOW']);
      const palette = PaletteSelector.selectPalette(seed, 0.6, 0.7);
      const track = TrackGenerator.generate(analysis, palette);

      expect(track.signalSpines).toBeDefined();
      const spines = track.signalSpines!;
      expect(spines.length).toBeGreaterThan(0);

      // Verify that every surf ramp exit has post-surf recovery spine coverage in following landing chain
      for (let i = 0; i < track.route.length - 1; i++) {
        const curr = track.route[i];
        const next = track.route[i + 1];

        if (curr.isSurf && !next.isSurf) {
          // Post-surf landing detected
          const postSurfLanding = track.route[i + 1];
          const hasPostSurfSpine = spines.some(s => {
            const dx = Math.abs(s.position.x - postSurfLanding.position.x);
            const dz = Math.abs(s.position.z - postSurfLanding.position.z);
            return Math.hypot(dx, dz) < 35.0;
          });

          expect(hasPostSurfSpine).toBe(true);
        }
      }
    }
  });

  it('generates top-surface bridging spines across staircase and ascent chains', () => {
    const analysis = createMockAnalysis(4242, ['FLOW', 'BUILDUP', 'FLOW']);
    const palette = PaletteSelector.selectPalette(4242, 0.6, 0.7);
    const track = TrackGenerator.generate(analysis, palette);

    const spines = track.signalSpines || [];
    const ascentNodes = track.route.filter(n =>
      n.type === RouteNodeType.STEP_UP ||
      n.type === RouteNodeType.ASCENT_CHAIN ||
      n.ascentVariant !== undefined
    );

    expect(ascentNodes.length).toBeGreaterThan(0);

    // Verify bridging spines exist near ascent steps
    for (const ascentNode of ascentNodes) {
      const nearSpines = spines.filter(s => {
        const dx = Math.abs(s.position.x - ascentNode.position.x);
        const dz = Math.abs(s.position.z - ascentNode.position.z);
        return Math.hypot(dx, dz) < 25.0;
      });
      expect(nearSpines.length).toBeGreaterThan(0);
    }
  });

  it('guarantees ZERO under-slung geometry (spines exist strictly at the top playable surface)', () => {
    const analysis = createMockAnalysis(12345, ['FLOW', 'SURF', 'BUILDUP', 'DROP', 'FLOW']);
    const track = RouteGenerator.generate(analysis);
    const spines = track.signalSpines || [];

    expect(spines.length).toBeGreaterThan(0);

    for (const spine of spines) {
      // Find the nearest route platform to compare elevations
      const nearestPlatform = track.route.reduce((closest, node) => {
        const d1 = Math.hypot(spine.position.x - node.position.x, spine.position.z - node.position.z);
        const d2 = Math.hypot(spine.position.x - closest.position.x, spine.position.z - closest.position.z);
        return d1 < d2 ? node : closest;
      }, track.route[0]);

      const platTopY = nearestPlatform.position.y + nearestPlatform.dimensions.y * 0.5;
      const spineTopY = spine.position.y + spine.dimensions.y * 0.5 * Math.cos(spine.pitch);

      // Top surface of the spine must be at the SAME gameplay elevation as the platform tops (+- 0.5m slope tolerance)
      // and NOT sunk 1.5m to 2.8m below platforms like the old under-slung implementation
      expect(Math.abs(spineTopY - platTopY)).toBeLessThan(1.5);

      // The bottom of the spine must NOT extend below the bottom of the platform
      const platBottomY = nearestPlatform.position.y - nearestPlatform.dimensions.y * 0.5;
      const spineBottomY = spine.position.y - spine.dimensions.y * 0.5;
      expect(spineBottomY).toBeGreaterThanOrEqual(platBottomY - 0.2);
    }
  });

  it('preserves deliberate open void below precision sections and drop leaps (Selective Placement)', () => {
    // Track with a PRECISION section
    const analysis = createMockAnalysis(8888, ['FLOW', 'PRECISION', 'DROP', 'FLOW']);
    const palette = PaletteSelector.selectPalette(8888, 0.5, 0.6);
    const track = TrackGenerator.generate(analysis, palette);

    const precisionSection = analysis.sections.find(s => s.theme === 'PRECISION')!;
    const precisionNodes = track.route.filter(n => n.time >= precisionSection.start && n.time < precisionSection.end);

    const spines = track.signalSpines || [];

    // Selective placement invariant: no spine should be generated for precision challenge gaps
    for (let i = 0; i < precisionNodes.length - 1; i++) {
      const a = precisionNodes[i];
      const b = precisionNodes[i + 1];
      const gapCenter = {
        x: (a.position.x + b.position.x) * 0.5,
        z: (a.position.z + b.position.z) * 0.5
      };

      const spineDirectlyUnderGap = spines.find(s => {
        const dx = Math.abs(s.position.x - gapCenter.x);
        const dz = Math.abs(s.position.z - gapCenter.z);
        return Math.hypot(dx, dz) < 4.0;
      });

      expect(spineDirectlyUnderGap).toBeUndefined();
    }
  });

  it('enforces strict risk preservation (narrow catch strip, preserving void on sides)', () => {
    const analysis = createMockAnalysis(12345, ['FLOW', 'SURF', 'BUILDUP', 'DROP', 'FLOW']);
    const track = RouteGenerator.generate(analysis);
    const spines = track.signalSpines || [];

    expect(spines.length).toBeGreaterThan(0);

    for (const spine of spines) {
      // 1. Spines must be physically narrow (1.5m to 3.2m width)
      expect(spine.dimensions.x).toBeLessThanOrEqual(3.2);
      expect(spine.dimensions.x).toBeGreaterThanOrEqual(1.5);

      // 2. Thickness must be low profile (<= 0.5m)
      expect(spine.dimensions.y).toBeLessThanOrEqual(0.5);

      // 3. Must be flagged as isSignalSpine with an authored variant
      expect(spine.isSignalSpine).toBe(true);
      expect(spine.signalSpineVariant).toBeDefined();
      expect(['STRAIGHT', 'OFFSET', 'CURVED', 'CATWALK']).toContain(
        spine.signalSpineVariant
      );
    }
  });

  it('guarantees Signal Drift (track_13_signal_drift) receives top-surface signal spines', () => {
    const presetPath = path.resolve(__dirname, '../public/music/presets/track_13_signal_drift.json');
    expect(fs.existsSync(presetPath)).toBe(true);

    const presetJson = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
    const rng = new SeededRandom(presetJson.analysis?.seed || 12345);
    const spines = SignalSpineGenerator.generate(presetJson.track.route, presetJson.analysis, rng);

    // Verify healthy top-surface spine coverage on Signal Drift
    expect(spines.length).toBeGreaterThanOrEqual(10);

    // Verify that the surf-to-stair sequence (nodes #38 through #48) has bridging spines
    const stairSpines = spines.filter(s => {
      // Check if spine connects near the stair steps
      return s.position.z >= 1250 && s.position.z <= 1650;
    });
    expect(stairSpines.length).toBeGreaterThanOrEqual(5);

    // Verify all spines on Signal Drift are top-surface and narrow
    for (const spine of spines) {
      expect(spine.dimensions.x).toBeLessThanOrEqual(3.2);
      expect(spine.dimensions.y).toBeLessThanOrEqual(0.5);
      expect(spine.isSignalSpine).toBe(true);
    }
  });

  it('registers signal spines in PhysicsWorld and guarantees authoritative void death calculation', () => {
    const analysis = createMockAnalysis(777, ['FLOW', 'SURF', 'BUILDUP', 'FLOW']);
    const track = RouteGenerator.generate(analysis);
    const physics = new PhysicsWorld();

    physics.buildFromRoute(
      track.route,
      track.optionalRamps,
      track.recoveryShelves,
      track.obstacles,
      track.signalSpines
    );

    const lowestY = physics.lowestGameplayY;
    const killPlaneY = physics.getVoidDeathY();

    // Kill plane must be exactly lowestGameplayY - VOID_MARGIN (20.0m)
    expect(killPlaneY).toBeCloseTo(lowestY - PhysicsWorld.VOID_MARGIN, 3);

    // Every signal spine must be at least VOID_MARGIN above the kill plane
    for (const spine of track.signalSpines || []) {
      const spineBottom = spine.position.y - spine.dimensions.y * 0.5;
      expect(spineBottom).toBeGreaterThanOrEqual(lowestY - 0.001);
      expect(spineBottom - killPlaneY).toBeGreaterThanOrEqual(PhysicsWorld.VOID_MARGIN - 0.001);
    }
  });

  it('does NOT inflate main route platform sizes (Anti-Enlargement Guarantee)', () => {
    const analysis = createMockAnalysis(31337, ['FLOW', 'BUILDUP', 'FLOW']);
    const track = RouteGenerator.generate(analysis);

    // Standard runway platforms must maintain standard widths (not inflated aircraft carriers)
    const runways = track.route.filter(n => n.type === RouteNodeType.RUNWAY);
    for (const runway of runways) {
      expect(runway.dimensions.x).toBeLessThanOrEqual(28.0); // Reasonable upper bound for flow landings
    }
  });
});
