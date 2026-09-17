import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RouteGenerator } from '../src/generation/RouteGenerator';
import { GeometryBuilder } from '../src/world/GeometryBuilder';
import { RouteNode, RouteNodeType, GeneratedTrack } from '../src/generation/GenerationTypes';
import { SeededRandom } from '../src/generation/SeededRandom';

describe('Recovery Catch-Shelves and Void Geometry', () => {
  function makeMockNode(partial: Partial<RouteNode>): RouteNode {
    return {
      id: partial.id ?? 1,
      time: partial.time ?? 0,
      position: partial.position ?? { x: 0, y: 0, z: 0 },
      dimensions: partial.dimensions ?? { x: 10, y: 2, z: 10 },
      yaw: partial.yaw ?? 0,
      pitch: partial.pitch ?? 0,
      roll: partial.roll ?? 0,
      type: partial.type ?? RouteNodeType.RUNWAY,
      intensity: partial.intensity ?? 0.5,
      sectionIndex: partial.sectionIndex ?? 0,
      arcLength: partial.arcLength ?? 0,
      isSurf: partial.isSurf ?? false,
      isBoost: partial.isBoost ?? false
    };
  }

  describe('RouteGenerator.generateRecoveryShelves', () => {
    it('does not generate recovery shelves on normal wide platforms with standard gaps', () => {
      const nodes: RouteNode[] = [
        makeMockNode({ id: 1, position: { x: 0, y: 0, z: 0 }, dimensions: { x: 12, y: 2, z: 10 } }),
        makeMockNode({ id: 2, position: { x: 0, y: 0, z: 14 }, dimensions: { x: 12, y: 2, z: 10 } }),
        makeMockNode({ id: 3, position: { x: 0, y: 0, z: 28 }, dimensions: { x: 12, y: 2, z: 10 } })
      ];

      // Even across 50 different seeds, non-difficult sections must produce 0 shelves
      for (let s = 0; s < 50; s++) {
        const rng = new SeededRandom(s);
        const shelves = RouteGenerator.generateRecoveryShelves(nodes, rng);
        expect(shelves.length).toBe(0);
      }
    });

    it('generates compact, laterally offset shelves on difficult small-platform chains', () => {
      const a = makeMockNode({
        id: 1,
        position: { x: 0, y: 10, z: 0 },
        dimensions: { x: 4.0, y: 2, z: 6 }
      });
      const b = makeMockNode({
        id: 2,
        position: { x: 0, y: 10, z: 12 },
        dimensions: { x: 4.0, y: 2, z: 6 }
      });

      let shelfGenerated = false;
      for (let s = 0; s < 100; s++) {
        const rng = new SeededRandom(s);
        const shelves = RouteGenerator.generateRecoveryShelves([a, b], rng);
        if (shelves.length > 0) {
          shelfGenerated = true;
          const shelf = shelves[0];
          expect(shelf.dimensions).toEqual({ x: 3.2, y: 0.8, z: 4.5 });
          expect(shelf.position.y).toBeCloseTo(b.position.y - 4.5, 4);

          // Centerline of gap is x = 0
          const expectedLateralOffset = a.dimensions.x * 0.5 + 2.4; // 2.0 + 2.4 = 4.4
          expect(Math.abs(shelf.position.x)).toBeCloseTo(expectedLateralOffset, 4);
          expect(shelf.position.z).toBeCloseTo((a.position.z + b.position.z) * 0.5, 4);
          expect(shelf.isRecoveryShelf).toBe(true);
        }
      }
      expect(shelfGenerated).toBe(true);
    });

    it('generates compact shelves on high-gap small-landing combinations', () => {
      const a = makeMockNode({
        id: 1,
        position: { x: 0, y: 0, z: 0 },
        dimensions: { x: 8.0, y: 2, z: 6 }
      });
      const b = makeMockNode({
        id: 2,
        position: { x: 0, y: -2, z: 15 }, // dist = 15 > 7.0
        dimensions: { x: 4.5, y: 2, z: 6 } // b.x <= 5.0
      });

      let count = 0;
      const iterations = 500;
      for (let s = 0; s < iterations; s++) {
        const rng = new SeededRandom(s);
        const shelves = RouteGenerator.generateRecoveryShelves([a, b], rng);
        if (shelves.length > 0) {
          count++;
          const shelf = shelves[0];
          expect(shelf.dimensions).toEqual({ x: 3.2, y: 0.8, z: 4.5 });
          expect(shelf.position.y).toBeCloseTo(b.position.y - 4.5, 4);
          const expectedLateral = a.dimensions.x * 0.5 + 2.4; // 4.0 + 2.4 = 6.4
          expect(Math.abs(shelf.position.x)).toBeCloseTo(expectedLateral, 4);
        }
      }
      // Probability is capped at < 0.35
      const rate = count / iterations;
      expect(rate).toBeGreaterThan(0.20);
      expect(rate).toBeLessThan(0.40);
    });

    it('generates compact shelves on tricky uphill steps', () => {
      const a = makeMockNode({
        id: 1,
        position: { x: 0, y: 0, z: 0 },
        dimensions: { x: 8.0, y: 2, z: 6 },
        type: RouteNodeType.STEP_UP
      });
      const b = makeMockNode({
        id: 2,
        position: { x: 0, y: 3, z: 12 }, // dist = 12 > 5.5
        dimensions: { x: 8.0, y: 2, z: 6 }
      });

      let count = 0;
      for (let s = 0; s < 200; s++) {
        const rng = new SeededRandom(s);
        const shelves = RouteGenerator.generateRecoveryShelves([a, b], rng);
        if (shelves.length > 0) count++;
      }
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('GeometryBuilder underside slabs removal', () => {
    it('does not create chunky underside support slabs beneath standard platforms', () => {
      const track: GeneratedTrack = {
        seed: 12345,
        route: [
          makeMockNode({ id: 0, position: { x: 0, y: 0, z: 0 }, dimensions: { x: 10, y: 2, z: 10 } }),
          makeMockNode({ id: 1, position: { x: 0, y: 0, z: 20 }, dimensions: { x: 10, y: 2, z: 10 } }),
          makeMockNode({ id: 2, position: { x: 0, y: 0, z: 40 }, dimensions: { x: 10, y: 2, z: 10 } })
        ],
        checkpoints: [],
        finish: { routeNodeId: 2, time: 10, position: { x: 0, y: 0, z: 40 }, yaw: 0 },
        totalDistance: 40,
        targetDuration: 10,
        repairedJumpsCount: 0
      };

      const world = GeometryBuilder.buildWorld(track, { name: 'Test', hex: '#ffffff', rgb: [255, 255, 255] });

      // Count BoxGeometry meshes with height around node.dimensions.y * 1.8 = 3.6
      let underSlabCount = 0;
      world.rootGroup.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry instanceof THREE.BoxGeometry) {
          const params = (child.geometry as THREE.BoxGeometry).parameters;
          if (Math.abs(params.height - 3.6) < 0.1 && Math.abs(params.width - 8.6) < 0.1) {
            underSlabCount++;
          }
        }
      });

      expect(underSlabCount).toBe(0);
      world.dispose();
    });

    it('does not create chunky underside foundation beneath optional surf ramps', () => {
      const track: GeneratedTrack = {
        seed: 12345,
        route: [
          makeMockNode({ id: 0, position: { x: 0, y: 0, z: 0 }, dimensions: { x: 10, y: 2, z: 10 } })
        ],
        optionalRamps: [
          makeMockNode({
            id: 90001,
            position: { x: 15, y: 0, z: 0 },
            dimensions: { x: 6.8, y: 2.0, z: 30.0 },
            isSurf: true,
            isOptional: true
          })
        ],
        checkpoints: [],
        finish: { routeNodeId: 0, time: 10, position: { x: 0, y: 0, z: 0 }, yaw: 0 },
        totalDistance: 10,
        targetDuration: 10,
        repairedJumpsCount: 0
      };

      const world = GeometryBuilder.buildWorld(track, { name: 'Test', hex: '#ffffff', rgb: [255, 255, 255] });

      // Count BoxGeometry meshes with ramp underside dimensions (height = 2.0 * 1.6 = 3.2, width = 6.8 * 0.88 = 5.984)
      let rampUnderCount = 0;
      world.rootGroup.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry instanceof THREE.BoxGeometry) {
          const params = (child.geometry as THREE.BoxGeometry).parameters;
          if (Math.abs(params.height - 3.2) < 0.1 && Math.abs(params.width - (6.8 * 0.88)) < 0.1) {
            rampUnderCount++;
          }
        }
      });

      expect(rampUnderCount).toBe(0);
      world.dispose();
    });

    it('preserves deep abyss foundation pillars plunging 320m-540m into the void for i % 6 === 0', () => {
      const track: GeneratedTrack = {
        seed: 12345,
        route: [
          makeMockNode({ id: 0, position: { x: 0, y: 0, z: 0 }, dimensions: { x: 10, y: 2, z: 10 } }),
          makeMockNode({ id: 1, position: { x: 0, y: 0, z: 20 }, dimensions: { x: 10, y: 2, z: 10 } })
        ],
        checkpoints: [],
        finish: { routeNodeId: 1, time: 10, position: { x: 0, y: 0, z: 20 }, yaw: 0 },
        totalDistance: 20,
        targetDuration: 10,
        repairedJumpsCount: 0
      };

      const world = GeometryBuilder.buildWorld(track, { name: 'Test', hex: '#ffffff', rgb: [255, 255, 255] });

      let pylonFound = false;
      world.rootGroup.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry instanceof THREE.BoxGeometry) {
          const params = (child.geometry as THREE.BoxGeometry).parameters;
          if (params.height >= 320.0 && params.height <= 540.0) {
            pylonFound = true;
          }
        }
      });

      expect(pylonFound).toBe(true);
      world.dispose();
    });
  });
});
