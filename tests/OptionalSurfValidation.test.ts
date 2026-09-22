import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { OBB } from 'three/examples/jsm/math/OBB.js';
import { RouteGenerator } from '../src/generation/RouteGenerator';
import { AnalysisSection, SectionTheme, TrackAnalysis } from '../src/audio/AudioFeatures';
import { RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';
import { SeededRandom } from '../src/generation/SeededRandom';
import { getPlatformMaxHalfWidth } from '../src/generation/PlatformShape';

function createMockAnalysis(duration: number, seed: number): TrackAnalysis {
  const count = Math.max(4, Math.floor(duration / 18));
  const step = duration / count;
  const availableThemes: SectionTheme[] = ['FLOW', 'BUILDUP', 'ASCENT', 'FLOW', 'DESCENT', 'SPEED'];
  const sections: AnalysisSection[] = [];
  for (let i = 0; i < count; i++) {
    const theme = availableThemes[(i + (seed % availableThemes.length)) % availableThemes.length];
    sections.push({
      index: i,
      start: i * step,
      end: (i + 1) * step,
      duration: step,
      intensity: 0.5 + (i / count) * 0.4,
      rhythmicDensity: 0.6,
      brightness: 0.6,
      theme
    });
  }

  return {
    filename: `test_${duration}s_${seed}`,
    duration,
    bpm: 128,
    bpmConfidence: 0.85,
    globalEnergy: 0.65,
    frames: [],
    onsets: [],
    sections,
    waveform: new Float32Array(512),
    seed,
    visualAccent: { name: 'Neon Coral', hex: '#ff3366', rgb: [255, 51, 102] }
  };
}

function createNodeOBB(node: RouteNode, clearance: number = 0): OBB {
  const center = new THREE.Vector3(node.position.x, node.position.y, node.position.z);
  const halfSize = new THREE.Vector3(
    node.dimensions.x * 0.5 + clearance,
    node.dimensions.y * 0.5 + clearance,
    node.dimensions.z * 0.5 + clearance
  );
  const euler = new THREE.Euler(node.pitch, node.yaw, node.roll, 'YXZ');
  const rotMatrix = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(euler));
  return new OBB(center, halfSize, rotMatrix);
}

describe('Optional Side Surf Ramps Redesign', () => {
  describe('1. Surfable Face Inward Orientation', () => {
    it('ensures surfNormal points inward toward the main route centerline for all generated ramps', () => {
      const seeds = [0x12345, 0xABCDE, 0x98765, 0x54321];
      let totalRampsTested = 0;

      for (const seed of seeds) {
        const analysis = createMockAnalysis(90.0, seed);
        const track = RouteGenerator.generate(analysis);
        const ramps = track.optionalRamps || [];
        expect(ramps.length).toBeGreaterThan(0);

        for (const ramp of ramps) {
          totalRampsTested++;
          expect(ramp.surfNormal).toBeDefined();
          const sn = new THREE.Vector3(ramp.surfNormal!.x, ramp.surfNormal!.y, ramp.surfNormal!.z);

          // Find closest main route node to determine route direction
          let closestNode = track.route[0];
          let minDistSq = Infinity;
          for (const node of track.route) {
            const dx = node.position.x - ramp.position.x;
            const dz = node.position.z - ramp.position.z;
            const distSq = dx * dx + dz * dz;
            if (distSq < minDistSq) {
              minDistSq = distSq;
              closestNode = node;
            }
          }

          // Vector pointing from ramp toward route in the horizontal plane
          const towardRoute = new THREE.Vector3(
            closestNode.position.x - ramp.position.x,
            0,
            closestNode.position.z - ramp.position.z
          ).normalize();

          // Dot product between horizontal surfNormal and vector toward route must be positive
          const snHorizontal = new THREE.Vector3(sn.x, 0, sn.z);
          const dot = snHorizontal.dot(towardRoute);
          expect(dot).toBeGreaterThan(0.1);
        }
      }

      expect(totalRampsTested).toBeGreaterThanOrEqual(12);
    });

    it('rigorously tests handedness: side = 1 rolls toward +X and side = -1 rolls toward -X', () => {
      // Construct a straight sequence along Z axis (heading = 0)
      const mockRoute: RouteNode[] = [
        {
          id: 0,
          time: 0,
          position: { x: 0, y: 0, z: 0 },
          dimensions: { x: 6.0, y: 2.0, z: 20.0 }, // Narrow platform
          yaw: 0,
          pitch: 0,
          roll: 0,
          type: RouteNodeType.RUNWAY,
          intensity: 0.5,
          sectionIndex: 0,
          arcLength: 0,
          isSurf: false,
          isBoost: false
        },
        {
          id: 1,
          time: 1,
          position: { x: 0, y: 0, z: 25 },
          dimensions: { x: 6.0, y: 2.0, z: 20.0 },
          yaw: 0,
          pitch: 0,
          roll: 0,
          type: RouteNodeType.RUNWAY,
          intensity: 0.5,
          sectionIndex: 0,
          arcLength: 25,
          isSurf: false,
          isBoost: false
        },
        {
          id: 2,
          time: 2,
          position: { x: 0, y: 0, z: 50 },
          dimensions: { x: 6.0, y: 2.0, z: 20.0 },
          yaw: 0,
          pitch: 0,
          roll: 0,
          type: RouteNodeType.RUNWAY,
          intensity: 0.5,
          sectionIndex: 0,
          arcLength: 50,
          isSurf: false,
          isBoost: false
        },
        // Pad with additional dummy nodes to satisfy length >= 12
        ...Array.from({ length: 12 }, (_, k) => ({
          id: 3 + k,
          time: 3 + k,
          position: { x: 0, y: 0, z: 75 + k * 25 },
          dimensions: { x: 10.0, y: 2.0, z: 20.0 },
          yaw: 0,
          pitch: 0,
          roll: 0,
          type: RouteNodeType.RUNWAY,
          intensity: 0.5,
          sectionIndex: 0,
          arcLength: 75 + k * 25,
          isSurf: false,
          isBoost: false
        }))
      ];

      // Test multiple seeds to get both side = 1 (left) and side = -1 (right)
      let foundLeft = false;
      let foundRight = false;

      for (let s = 1; s <= 20; s++) {
        const testRng = new SeededRandom(s);
        const ramps = RouteGenerator.generateOptionalSideSurfs(mockRoute, testRng);
        if (ramps.length > 0) {
          const r = ramps[0];
          if (r.position.x < 0) {
            // Ramp on left of track (negative X)
            foundLeft = true;
            // Ramp roll should tilt top face toward right (+X)
            expect(r.roll).toBeLessThan(0);
            expect(r.surfNormal!.x).toBeGreaterThan(0);
          } else if (r.position.x > 0) {
            // Ramp on right of track (positive X)
            foundRight = true;
            // Ramp roll should tilt top face toward left (-X)
            expect(r.roll).toBeGreaterThan(0);
            expect(r.surfNormal!.x).toBeLessThan(0);
          }
        }
      }

      expect(foundLeft).toBe(true);
      expect(foundRight).toBe(true);
    });
  });

  describe('2. Distance, Dimensions & Profile', () => {
    it('verifies standard SIDE_SURF geometry (shallow, long, sleek, ~2.8m edge gap)', () => {
      const analysis = createMockAnalysis(100.0, 0x77777);
      const track = RouteGenerator.generate(analysis);
      const ramps = track.optionalRamps || [];

      const standardRamps = ramps.filter(r => !r.isLaunchVariant);
      expect(standardRamps.length).toBeGreaterThan(0);

      for (const ramp of standardRamps) {
        expect(ramp.dimensions.x).toBeCloseTo(8.0, 1);
        expect(ramp.dimensions.y).toBeCloseTo(1.2, 1); // Sleek 1.2m
        expect(ramp.dimensions.z).toBeGreaterThanOrEqual(30.0);
        expect(ramp.dimensions.z).toBeLessThanOrEqual(42.0);
        expect(ramp.pitch).toBeCloseTo(-0.06, 2); // Shallow glide
        expect(Math.abs(ramp.roll)).toBeCloseTo(0.68, 2); // Shallow bank ~39 deg
      }
    });

    it('verifies clean lateral edge-to-edge gap (~2.8m air gap)', () => {
      const analysis = createMockAnalysis(100.0, 0x55555);
      const track = RouteGenerator.generate(analysis);
      const ramps = track.optionalRamps || [];

      for (const ramp of ramps) {
        // Find adjacent route nodes
        let closestNode = track.route[0];
        let minDistSq = Infinity;
        for (const node of track.route) {
          const distSq = (node.position.x - ramp.position.x) ** 2 + (node.position.z - ramp.position.z) ** 2;
          if (distSq < minDistSq) {
            minDistSq = distSq;
            closestNode = node;
          }
        }

        const sourceNode = track.route.find(node =>
          Math.abs(node.arcLength - ramp.arcLength) < 1e-6 && Math.abs(node.time - ramp.time) < 1e-6
        ) ?? closestNode;
        const rollAngle = Math.abs(ramp.roll);
        const rampWidth = ramp.dimensions.x;
        const rampEffectiveHalfW = (rampWidth * 0.5) * Math.cos(rollAngle);
        const platHalfW = getPlatformMaxHalfWidth(sourceNode);

        // Perpendicular unit vector in horizontal plane (perpendicular to ramp heading)
        const perpX = Math.cos(ramp.yaw);
        const perpZ = -Math.sin(ramp.yaw);

        // Project horizontal displacement onto perpendicular axis to obtain pure lateral distance
        const dx = ramp.position.x - sourceNode.position.x;
        const dz = ramp.position.z - sourceNode.position.z;
        const lateralDist = Math.abs(dx * perpX + dz * perpZ);

        // Visible edge-to-edge gap
        const edgeGap = lateralDist - rampEffectiveHalfW - platHalfW;
        expect(edgeGap).toBeGreaterThanOrEqual(1.6); // Strictly ensures no overlap
        expect(edgeGap).toBeLessThanOrEqual(4.5); // Comfortably jumpable (~2.8m nominal)
      }
    });
  });

  describe('3. SURF_LAUNCH Variant', () => {
    it('verifies SURF_LAUNCH ramps have distinct upward pitch, bank, and launch metadata', () => {
      // Test across multiple seeds to sample launch variants
      let launchCount = 0;
      let totalRamps = 0;

      for (let seed = 100; seed <= 125; seed++) {
        const analysis = createMockAnalysis(100.0, seed);
        const track = RouteGenerator.generate(analysis);
        const ramps = track.optionalRamps || [];
        totalRamps += ramps.length;

        for (const ramp of ramps) {
          if (ramp.isLaunchVariant) {
            launchCount++;
            expect(ramp.pitch).toBeCloseTo(0.16, 2); // Upward launch
            expect(Math.abs(ramp.roll)).toBeCloseTo(0.80, 2); // Higher bank ~46 deg
            expect(ramp.boostSpeed).toBe(24.0);
            expect(ramp.isBoost).toBe(true);
          }
        }
      }

      expect(totalRamps).toBeGreaterThan(50);
      expect(launchCount).toBeGreaterThan(0);
      // Launch variant should be comparatively rare (~10% - 30% of total ramps)
      const launchRatio = launchCount / totalRamps;
      expect(launchRatio).toBeGreaterThan(0.05);
      expect(launchRatio).toBeLessThan(0.40);
    });
  });

  describe('4. Frequency & Meaningful Placement', () => {
    it('verifies ramp frequency is controlled (3-6 ramps per typical 60-120s course)', () => {
      const durations = [60.0, 90.0, 120.0];
      const seeds = [0x1111, 0x2222, 0x3333, 0x4444, 0x5555];

      for (const duration of durations) {
        for (const seed of seeds) {
          const analysis = createMockAnalysis(duration, seed);
          const track = RouteGenerator.generate(analysis);
          const ramps = track.optionalRamps || [];

          expect(ramps.length).toBeGreaterThanOrEqual(3);
          expect(ramps.length).toBeLessThanOrEqual(6);
        }
      }
    });

    it('verifies ramps are spaced apart along the route to avoid spam', () => {
      for (let seed = 1; seed <= 10; seed++) {
        const analysis = createMockAnalysis(120.0, seed * 1000);
        const track = RouteGenerator.generate(analysis);
        const ramps = track.optionalRamps || [];

        // Track closest route node index for each ramp
        const rampIndices: number[] = [];
        for (const ramp of ramps) {
          let closestIdx = -1;
          let minDistSq = Infinity;
          for (let i = 0; i < track.route.length; i++) {
            const n = track.route[i];
            const distSq = (n.position.x - ramp.position.x) ** 2 + (n.position.z - ramp.position.z) ** 2;
            if (distSq < minDistSq) {
              minDistSq = distSq;
              closestIdx = i;
            }
          }
          rampIndices.push(closestIdx);
        }

        // Verify spacing between successive ramps
        for (let r = 1; r < rampIndices.length; r++) {
          const indexDiff = rampIndices[r] - rampIndices[r - 1];
          // Optional ramps are now a more frequent opportunity (8-node cadence),
          // so this guards against true clustering rather than the old 12.
          expect(indexDiff).toBeGreaterThanOrEqual(7); // Spaced apart along the track
        }
      }
    });
  });

  describe('5. Collision & Clearance Envelope Validation', () => {
    it('verifies ZERO collisions between any optional ramp and main route nodes across multiple courses', () => {
      for (let seed = 10; seed <= 20; seed++) {
        const analysis = createMockAnalysis(90.0, seed * 777);
        const track = RouteGenerator.generate(analysis);
        const ramps = track.optionalRamps || [];

        for (const ramp of ramps) {
          const rampOBB = createNodeOBB(ramp, 0);

          for (const node of track.route) {
            // Check clearance with 1.5m player margin
            const nodeOBB = createNodeOBB(node, 1.5);
            const intersects = rampOBB.intersectsOBB(nodeOBB);
            expect(intersects).toBe(false);
          }
        }
      }
    });

    it('rejects candidate ramps when an obstacle blocks their clearance volume', () => {
      const rng = new SeededRandom(999);
      // Route with an intentional encroaching obstacle right next to where the ramp would be
      const mockRoute: RouteNode[] = [
        {
          id: 0,
          time: 0,
          position: { x: 0, y: 0, z: 0 },
          dimensions: { x: 6.0, y: 2.0, z: 20.0 },
          yaw: 0,
          pitch: 0,
          roll: 0,
          type: RouteNodeType.RUNWAY,
          intensity: 0.5,
          sectionIndex: 0,
          arcLength: 0,
          isSurf: false,
          isBoost: false
        },
        {
          id: 1,
          time: 1,
          position: { x: 0, y: 0, z: 25 },
          dimensions: { x: 6.0, y: 2.0, z: 20.0 },
          yaw: 0,
          pitch: 0,
          roll: 0,
          type: RouteNodeType.RUNWAY,
          intensity: 0.5,
          sectionIndex: 0,
          arcLength: 25,
          isSurf: false,
          isBoost: false
        },
        {
          id: 2,
          time: 2,
          position: { x: 0, y: 0, z: 50 },
          dimensions: { x: 6.0, y: 2.0, z: 20.0 },
          yaw: 0,
          pitch: 0,
          roll: 0,
          type: RouteNodeType.RUNWAY,
          intensity: 0.5,
          sectionIndex: 0,
          arcLength: 50,
          isSurf: false,
          isBoost: false
        },
        // Encroaching obstacle platform flanking BOTH left and right sides
        {
          id: 3,
          time: 1.5,
          position: { x: -9.0, y: 0, z: 25 },
          dimensions: { x: 8.0, y: 4.0, z: 30.0 },
          yaw: 0,
          pitch: 0,
          roll: 0,
          type: RouteNodeType.RUNWAY,
          intensity: 0.5,
          sectionIndex: 0,
          arcLength: 25,
          isSurf: false,
          isBoost: false
        },
        {
          id: 4,
          time: 1.5,
          position: { x: 9.0, y: 0, z: 25 },
          dimensions: { x: 8.0, y: 4.0, z: 30.0 },
          yaw: 0,
          pitch: 0,
          roll: 0,
          type: RouteNodeType.RUNWAY,
          intensity: 0.5,
          sectionIndex: 0,
          arcLength: 25,
          isSurf: false,
          isBoost: false
        },
        ...Array.from({ length: 10 }, (_, k) => ({
          id: 5 + k,
          time: 3 + k,
          position: { x: 0, y: 0, z: 75 + k * 25 },
          dimensions: { x: 10.0, y: 2.0, z: 20.0 },
          yaw: 0,
          pitch: 0,
          roll: 0,
          type: RouteNodeType.RUNWAY,
          intensity: 0.5,
          sectionIndex: 0,
          arcLength: 75 + k * 25,
          isSurf: false,
          isBoost: false
        }))
      ];

      const ramps = RouteGenerator.generateOptionalSideSurfs(mockRoute, rng);
      // Nodes 0..2 should not have ramps because obstacles at x = -9 and x = 9 block both sides!
      for (const r of ramps) {
        expect(r.position.z).toBeGreaterThan(60.0);
      }
    });
  });
});
