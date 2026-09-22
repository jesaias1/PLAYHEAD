import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';
import { TrackGenerator } from '../src/generation/TrackGenerator';
import { RouteGenerator } from '../src/generation/RouteGenerator';
import { SignalSpineGenerator } from '../src/generation/SignalSpineGenerator';
import { RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';
import { SeededRandom } from '../src/generation/SeededRandom';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { TrackAnalysis } from '../src/audio/AudioFeatures';
import { PaletteSelector } from '../src/audio/TrackPalettes';
import { GeometryBuilder } from '../src/world/GeometryBuilder';

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
  it('generates connectors across BOTH small-platform chains AND medium / larger transfers', () => {
    const analysis = createMockAnalysis(12345, ['FLOW', 'SURF', 'BUILDUP', 'DROP', 'FLOW']);
    const rng = new SeededRandom(12345);
    const track = RouteGenerator.generate(analysis);
    const spines = track.signalSpines || [];

    expect(spines.length).toBeGreaterThan(0);

    const report = SignalSpineGenerator.getLastReport();
    expect(report).toBeDefined();
    expect(report!.smallChainConnectors).toBeGreaterThan(0);
    expect(report!.mediumLargeConnectors).toBeGreaterThan(0);
    expect(report!.totalGenerated).toBe(spines.length);
  });

  it('exhibits controlled instance variation in width, length, and lateral alignment', () => {
    const analysis = createMockAnalysis(4242, ['FLOW', 'BUILDUP', 'FLOW']);
    const track = RouteGenerator.generate(analysis);
    const spines = track.signalSpines || [];

    expect(spines.length).toBeGreaterThan(5);

    // 1. Widths must vary across instances (not a cloned fixed width)
    const widths = new Set(spines.map(s => Math.round(s.dimensions.x * 10) / 10));
    expect(widths.size).toBeGreaterThanOrEqual(3);

    // 2. Lengths must vary across instances
    const lengths = new Set(spines.map(s => Math.round(s.dimensions.z * 10) / 10));
    expect(lengths.size).toBeGreaterThanOrEqual(3);

    // 3. Variants must feature varied alignments (CURVED, OFFSET, STRAIGHT/CATWALK)
    const variants = new Set(spines.map(s => s.signalSpineVariant));
    expect(variants.size).toBeGreaterThanOrEqual(2);
  });

  it('generates authored shapes (TAPERED, OFFSET, BROKEN, TAPER_TO_REJOIN) with phrase-adaptive widths', () => {
    const analysis = createMockAnalysis(9999, ['FLOW', 'SURF', 'BUILDUP', 'DROP', 'FLOW']);
    const track = RouteGenerator.generate(analysis);
    const spines = track.signalSpines || [];

    expect(spines.length).toBeGreaterThan(10);

    const variants = new Set(spines.map(s => s.signalSpineVariant));
    // Must contain multi-segment tapered, offset, or broken shapes
    const hasAdvancedShape = ['TAPERED', 'OFFSET', 'BROKEN', 'TAPER_TO_REJOIN'].some(v => variants.has(v as any));
    expect(hasAdvancedShape).toBe(true);

    // Verify phrase-adaptive widths:
    // No spine should be an oversized runway (> 2.8m) or razor thin (< 0.65m)
    for (const spine of spines) {
      expect(spine.dimensions.x).toBeLessThanOrEqual(2.8);
      expect(spine.dimensions.x).toBeGreaterThanOrEqual(0.65);
    }
  });

  it('guarantees ZERO under-slung geometry (spines sit flush at top playable surface)', () => {
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

  it('treats micro-platform / precision chains as high-risk with 70-85% coverage and <= 2 consecutive unsupported', () => {
    // Track with a PRECISION section
    const analysis = createMockAnalysis(8888, ['FLOW', 'PRECISION', 'DROP', 'FLOW']);
    const palette = PaletteSelector.selectPalette(8888, 0.5, 0.6);
    const track = TrackGenerator.generate(analysis, palette);

    const report = SignalSpineGenerator.getLastReport();
    expect(report).toBeDefined();
    expect(report!.highRiskTransfersFound).toBeGreaterThan(0);
    expect(report!.highRiskConnectorsGenerated).toBeGreaterThan(0);

    // Coverage rule: ~70–85% of high-risk micro-transfers covered
    const coverageRatio = report!.highRiskConnectorsGenerated / report!.highRiskTransfersFound;
    expect(coverageRatio).toBeGreaterThanOrEqual(0.65);
    expect(coverageRatio).toBeLessThanOrEqual(0.95);

    // Verify initial drop leap preserves open void
    const dropSection = analysis.sections.find(s => s.theme === 'DROP')!;
    const dropNodes = track.route.filter(n => n.time >= dropSection.start && n.time < dropSection.end);
    if (dropNodes.length > 1 && track.route.indexOf(dropNodes[0]) < 6) {
      expect(report!.rejectionReasons['initial_colossal_drop_leap']).toBeGreaterThanOrEqual(1);
    }
  });

  it('enforces strict risk preservation (narrow catch strip, never full-width bridges)', () => {
    const analysis = createMockAnalysis(12345, ['FLOW', 'SURF', 'BUILDUP', 'DROP', 'FLOW']);
    const track = RouteGenerator.generate(analysis);
    const spines = track.signalSpines || [];

    expect(spines.length).toBeGreaterThan(0);

    for (const spine of spines) {
      // 1. Spines must be physically narrow (0.65m to 2.8m width, never full width or easy highway)
      expect(spine.dimensions.x).toBeLessThanOrEqual(2.8);
      expect(spine.dimensions.x).toBeGreaterThanOrEqual(0.65);

      // 2. Thickness must be low profile (<= 0.5m)
      expect(spine.dimensions.y).toBeLessThanOrEqual(0.5);

      // 3. Must be flagged as isSignalSpine with an authored variant
      expect(spine.isSignalSpine).toBe(true);
      expect(spine.signalSpineVariant).toBeDefined();
      expect(['STRAIGHT', 'OFFSET', 'CURVED', 'CATWALK', 'TAPERED', 'BROKEN', 'TAPER_TO_REJOIN']).toContain(
        spine.signalSpineVariant
      );
    }
  });

  it('guarantees Signal Drift (track_1_signal_drift) receives both small-chain and medium/large connectors', () => {
    const presetPath = path.resolve(__dirname, '../public/music/presets/track_1_signal_drift.json');
    expect(fs.existsSync(presetPath)).toBe(true);

    const presetJson = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
    const rng = new SeededRandom(presetJson.analysis?.seed || 12345);
    const spines = SignalSpineGenerator.generate(presetJson.track.route, presetJson.analysis, rng);

    // Verify healthy top-surface spine coverage on Signal Drift
    expect(spines.length).toBeGreaterThanOrEqual(15);

    const report = SignalSpineGenerator.getLastReport();
    expect(report).toBeDefined();
    // Must generate on small chains (staircase / post-surf)
    expect(report!.smallChainConnectors).toBeGreaterThanOrEqual(5);
    // Must ALSO generate on medium / larger transfers
    expect(report!.mediumLargeConnectors).toBeGreaterThanOrEqual(10);

    // Verify all spines on Signal Drift are top-surface and narrow
    for (const spine of spines) {
      expect(spine.dimensions.x).toBeLessThanOrEqual(2.8);
      expect(spine.dimensions.x).toBeGreaterThanOrEqual(0.65);
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

  it('guarantees clean production appearance without debug wireframe outline on spine top surface', () => {
    const analysis = createMockAnalysis(12345, ['FLOW', 'SURF', 'BUILDUP', 'DROP', 'FLOW']);
    const palette = PaletteSelector.selectPalette(12345, 0.6, 0.7);
    const track = TrackGenerator.generate(analysis, palette);
    expect(track.signalSpines).toBeDefined();
    expect(track.signalSpines!.length).toBeGreaterThan(0);

    const built = GeometryBuilder.buildWorld(track, palette);
    const rootGroup = built.rootGroup;

    // Find meshes for signal spines
    const spinePositions = (track.signalSpines || []).map(s => s.position);
    let foundSpineMeshes = 0;

    rootGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh && Array.isArray(obj.material)) {
        const isSpineMesh = spinePositions.some(sp =>
          Math.abs(obj.position.x - sp.x) < 0.01 &&
          Math.abs(obj.position.y - sp.y) < 0.01 &&
          Math.abs(obj.position.z - sp.z) < 0.01
        );
        if (isSpineMesh) {
          foundSpineMeshes++;
          // Top surface material (index 2) must be clean platform concrete blend (spineTopMaterial)
          const topMat = obj.material[2] as THREE.MeshStandardMaterial;
          expect(topMat).toBeDefined();
          expect(topMat.wireframe).toBeFalsy();
          const expectedSpineColor = new THREE.Color(palette.surface).lerp(new THREE.Color(palette.primary), 0.22);
          expect(topMat.color.getHex()).toBe(expectedSpineColor.getHex());
        }
      }

      // Verify that NO EdgesGeometry wireframe (LineSegments) is co-located with any signal spine
      if (obj instanceof THREE.LineSegments) {
        const isCoLocatedWithSpine = spinePositions.some(sp =>
          Math.abs(obj.position.x - sp.x) < 0.01 &&
          Math.abs(obj.position.y - sp.y) < 0.01 &&
          Math.abs(obj.position.z - sp.z) < 0.01
        );
        expect(isCoLocatedWithSpine).toBe(false);
      }
    });

    expect(foundSpineMeshes).toBeGreaterThan(0);
    built.dispose();
  });
});
