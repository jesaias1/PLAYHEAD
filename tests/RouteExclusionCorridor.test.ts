import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RouteExclusionCorridor } from '../src/world/RouteExclusionCorridor';
import { RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';

describe('RouteExclusionCorridor', () => {
  const mockRoute: RouteNode[] = [
    {
      id: 1,
      time: 0,
      position: { x: 0, y: 0, z: 0 },
      dimensions: { x: 12, y: 1.5, z: 20 },
      yaw: 0,
      pitch: 0,
      roll: 0,
      type: RouteNodeType.RUNWAY,
      isSurf: false,
      arcLength: 0
    } as any,
    {
      id: 2,
      time: 2,
      position: { x: 0, y: -5, z: 50 },
      dimensions: { x: 14, y: 1.5, z: 30 },
      yaw: 0,
      pitch: -0.15,
      roll: 0.35,
      type: RouteNodeType.SURF_RAMP,
      isSurf: true,
      arcLength: 50
    } as any,
    {
      id: 3,
      time: 4,
      position: { x: 30, y: -10, z: 100 },
      dimensions: { x: 12, y: 1.5, z: 20 },
      yaw: 0.5,
      pitch: 0,
      roll: 0,
      type: RouteNodeType.CHECKPOINT,
      isSurf: false,
      arcLength: 110
    } as any
  ];

  const corridor = new RouteExclusionCorridor(mockRoute);

  it('rejects an object placed directly on the track', () => {
    const pos = new THREE.Vector3(0, 0, 0);
    const radius = 10;
    const isInside = corridor.isPointInsideCorridor(pos, radius, -5, 50);
    expect(isInside).toBe(true);
  });

  it('enforces strengthened horizontal clearance on standard platforms (rejecting objects at 22m)', () => {
    // Node 1 is a standard platform at x=0, z=0 with trackHalfBreadth = 6m
    // Strengthened margin: 26.0 + 0.65 * objectRadius (for radius 2m: 26.0 + 1.3 = 27.3m)
    // Required distance: 6 + 2 + 27.3 = 35.3m
    // Objects at 22m were previously allowed (old margin was 16m + 0.4*r -> required 24.8m)
    const closePos = new THREE.Vector3(22, 0, 0); // 22m away horizontally (rejected)
    const safePos = new THREE.Vector3(55, 0, 0);  // 55m away horizontally (outside both platform and surf jump transition)

    expect(corridor.isPointInsideCorridor(closePos, 2, -5, 10)).toBe(true);
    expect(corridor.isPointInsideCorridor(safePos, 2, -5, 10)).toBe(false);
  });

  it('enforces stair / ascent section clearance (32.0m base margin)', () => {
    const stepUpRoute: RouteNode[] = [
      {
        id: 1,
        time: 0,
        position: { x: 0, y: 0, z: 0 },
        dimensions: { x: 12, y: 1.5, z: 20 },
        yaw: 0,
        pitch: 0.1,
        roll: 0,
        type: RouteNodeType.STEP_UP,
        isSurf: false,
        arcLength: 0
      } as any,
      {
        id: 2,
        time: 2,
        position: { x: 0, y: 5, z: 40 },
        dimensions: { x: 12, y: 1.5, z: 20 },
        yaw: 0,
        pitch: 0,
        roll: 0,
        type: RouteNodeType.RUNWAY,
        isSurf: false,
        arcLength: 40
      } as any
    ];
    const stepUpCorridor = new RouteExclusionCorridor(stepUpRoute);

    // Node 1: trackHalfBreadth 6m, radius 2m. Margin: 32.0 + 0.7 * 2 = 33.4m. Required: 41.4m.
    const insideStepUp = new THREE.Vector3(38, 0, 0);
    const outsideStepUp = new THREE.Vector3(45, 0, 0);

    expect(stepUpCorridor.isPointInsideCorridor(insideStepUp, 2, -5, 10)).toBe(true);
    expect(stepUpCorridor.isPointInsideCorridor(outsideStepUp, 2, -5, 10)).toBe(false);
  });

  it('enforces strengthened lateral clearance on surf sections (rejecting objects at 36m)', () => {
    // Node 2 is a surf ramp with dimensions.x = 14 (half-breadth 7m)
    // Surf margin: Math.max(38.0, 18.0 + extraSurfMargin) + 0.85 * objectRadius
    // For radius 5m: 38.0 + 4.25 = 42.25m -> Required: 7 + 5 + 42.25 = 54.25m
    const closeSurfPos = new THREE.Vector3(36, -5, 50); // 36m away horizontally
    const farSurfPos = new THREE.Vector3(70, -5, 50);   // 70m away horizontally

    expect(corridor.isPointInsideCorridor(closeSurfPos, 5, -10, 40)).toBe(true);
    expect(corridor.isPointInsideCorridor(farSurfPos, 5, -10, 40)).toBe(false);
  });

  it('rejects an object placed directly in the jump flight path between nodes', () => {
    // Middle of segment between node 1 and node 2 (z = 25)
    const pos = new THREE.Vector3(0, -2.5, 25);
    const radius = 8;
    const isInside = corridor.isPointInsideCorridor(pos, radius, -10, 40);
    expect(isInside).toBe(true);

    // Lateral clearance on jump flight path with surf transition (margin 40.0 + 0.85 * r)
    // For radius 2m: segHalfBreadth 7m + 2m + 40.0 + 1.7m = 50.7m
    const nearFlightPos = new THREE.Vector3(35, -2.5, 25);
    const farFlightPos = new THREE.Vector3(65, -2.5, 25);
    expect(corridor.isPointInsideCorridor(nearFlightPos, 2, -10, 40)).toBe(true);
    expect(corridor.isPointInsideCorridor(farFlightPos, 2, -10, 40)).toBe(false);
  });

  it('enforces vertical clearance volume (headroom up to 50m and underside down to -25m)', () => {
    // Headroom: routeMaxY is node.position.y + 55.0m
    // Object at y = 50m directly above node 1 (y = 0) was previously outside (old max was +36m), now rejected
    const headroomPos = new THREE.Vector3(0, 50, 0);
    expect(corridor.isPointInsideCorridor(headroomPos, 2, 48, 52)).toBe(true);

    // Object far above in stratosphere (y = 80m) is allowed
    const stratospherePos = new THREE.Vector3(0, 80, 0);
    expect(corridor.isPointInsideCorridor(stratospherePos, 2, 75, 85)).toBe(false);

    // Underside: routeMinY is node.position.y - 25.0m
    // Object at y = -18m directly below node 1 was previously outside (old min was -10m), now rejected
    const undersidePos = new THREE.Vector3(0, -18, 0);
    expect(corridor.isPointInsideCorridor(undersidePos, 2, -22, -14)).toBe(true);

    // Object deep in the abyss (y = -40m) is allowed
    const deepAbyssPos = new THREE.Vector3(0, -40, 0);
    expect(corridor.isPointInsideCorridor(deepAbyssPos, 2, -45, -35)).toBe(false);
  });

  it('finds a safe offset position outward from candidate', () => {
    const origin = new THREE.Vector3(0, 0, 0);
    const rightDir = new THREE.Vector3(1, 0, 0); // Outward along +X
    const safePos = corridor.findSafeOffsetPosition(origin, rightDir, 10, 15, -10, 50, 8, 16);

    expect(safePos).not.toBeNull();
    if (safePos) {
      // Must be safely outside corridor
      expect(corridor.isPointInsideCorridor(safePos, 15, -10, 50)).toBe(false);
      expect(safePos.x).toBeGreaterThanOrEqual(25);
    }
  });

  it('validates and prunes decorative objects intruding into corridor', () => {
    const group = new THREE.Group();

    // Colliding mesh at (22, 0, 0)
    const intrudingGeom = new THREE.BoxGeometry(4, 4, 4);
    const mat = new THREE.MeshBasicMaterial();
    const intrudingMesh = new THREE.Mesh(intrudingGeom, mat);
    intrudingMesh.position.set(22, 0, 0);
    group.add(intrudingMesh);

    // Safe mesh at (75, 0, 0)
    const safeMesh = new THREE.Mesh(intrudingGeom, mat);
    safeMesh.position.set(75, 0, 0);
    group.add(safeMesh);

    expect(group.children.length).toBe(2);
    const pruned = corridor.validateDecorationAgainstGameplay(group);
    expect(pruned).toBe(1);
    expect(group.children.length).toBe(1);
    expect(group.children[0]).toBe(safeMesh);
  });
});
