import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SurfState, SurfaceClassification } from '../src/player/SurfState';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { BoxCollider } from '../src/physics/Collider';
import { RouteNodeType } from '../src/generation/GenerationTypes';

describe('SurfPhysics & Surface Classification', () => {
  it('correctly classifies walkable ground, surf surfaces, and steep walls', () => {
    // 1. Flat or gentle slope (normal.y = 1.0, 0.75) -> Walkable
    expect(SurfState.classifySurface(new THREE.Vector3(0, 1, 0), false)).toBe(SurfaceClassification.WALKABLE_GROUND);
    expect(SurfState.classifySurface(new THREE.Vector3(0.66, 0.75, 0), false)).toBe(SurfaceClassification.WALKABLE_GROUND);

    // 2. Surf slope (60 degree bank: normal.y = cos(60 deg) = 0.50) -> Surf Surface
    expect(SurfState.classifySurface(new THREE.Vector3(0.866, 0.50, 0), false)).toBe(SurfaceClassification.SURF_SURFACE);

    // 3. Explicitly marked surf node -> Always Surf Surface unless completely vertical
    expect(SurfState.classifySurface(new THREE.Vector3(0.7071, 0.7071, 0), true)).toBe(SurfaceClassification.SURF_SURFACE);

    // 4. Steep vertical wall (normal.y = 0.05, 0.0) -> Wall
    expect(SurfState.classifySurface(new THREE.Vector3(1, 0, 0), false)).toBe(SurfaceClassification.WALL);
    expect(SurfState.classifySurface(new THREE.Vector3(0.998, 0.05, 0), false)).toBe(SurfaceClassification.WALL);
  });

  it('preserves tangential momentum and applies downhill slope gravity without ground friction', () => {
    const surf = new SurfState();
    // 60-degree ramp: normal facing (+X, +Y) with ny = 0.5, nx = 0.866
    const surfNormal = new THREE.Vector3(0.866025, 0.5, 0).normalize();

    // Player entering at 20 m/s along +Z (tangential to the ramp slope)
    const vel = new THREE.Vector3(0, 0, 20.0);
    const wishDir = new THREE.Vector3();
    const camForward = new THREE.Vector3(0, 0, 1);
    const gravity = 24.0;
    const dt = 1 / 60;

    surf.updateSurfPhysics(
      vel,
      wishDir,
      false,
      camForward,
      surfNormal,
      true, // in physical contact
      gravity,
      90.0,
      3.0,
      dt
    );

    expect(surf.isSurfing).toBe(true);
    // Forward tangential speed (+Z) must be preserved (no friction!)
    expect(vel.z).toBeCloseTo(20.0, 4);

    // Gravity projected along slope:
    // grav = (0, -24, 0). grav.dot(normal) = -12.
    // slopeGravity = (0, -24, 0) - (-12 * normal) = (0, -24, 0) + (10.39, 6.0, 0) = (10.39, -18.0, 0)
    // Pulls down (-Y) and outward (-X downhill)
    expect(vel.y).toBeLessThan(0); // sliding downhill
    expect(vel.dot(surfNormal)).toBeCloseTo(0, 5); // strictly on the tangent plane
  });

  it('allows air-strafe input into the ramp to accelerate forward along tangent', () => {
    const surf = new SurfState();
    // Ramp on player's right: normal points toward -X
    const surfNormal = new THREE.Vector3(-0.866025, 0.5, 0).normalize();

    const vel = new THREE.Vector3(0, 0, 14.0);
    const camForward = new THREE.Vector3(0, 0, 1);
    // Player strafes right (holding D, wishDir towards +X into the ramp)
    const wishDir = new THREE.Vector3(1, 0, 0);
    const gravity = 24.0;
    const dt = 1 / 60;

    const initialSpeed = vel.length();

    surf.updateSurfPhysics(
      vel,
      wishDir,
      true,
      camForward,
      surfNormal,
      true,
      gravity,
      90.0,
      3.0,
      dt
    );

    // Input directed into ramp was clipped against normal and converted to tangent acceleration
    expect(vel.length()).toBeGreaterThan(initialSpeed);
    // Velocity dot normal remains >= 0 (never sinking into the ramp)
    expect(vel.dot(surfNormal)).toBeGreaterThanOrEqual(-1e-6);
  });

  it('stabilizes contact across micro-seams using contact grace period', () => {
    const surf = new SurfState();
    const surfNormal = new THREE.Vector3(0.866, 0.5, 0).normalize();
    const vel = new THREE.Vector3(0, 0, 15.0);
    const wishDir = new THREE.Vector3();
    const camForward = new THREE.Vector3(0, 0, 1);
    const dt = 1 / 120;

    // Frame 1: Contact
    surf.updateSurfPhysics(vel, wishDir, false, camForward, surfNormal, true, 24.0, 90.0, 3.0, dt);
    expect(surf.isSurfing).toBe(true);

    // Frame 2: 1-tick micro-separation (e.g. crossing seam between ramp segments)
    surf.updateSurfPhysics(vel, wishDir, false, camForward, surfNormal, false, 24.0, 90.0, 3.0, dt);
    // Must maintain surf state through the grace window
    expect(surf.isSurfing).toBe(true);

    // Frame 3: Resumed contact
    surf.updateSurfPhysics(vel, wishDir, false, camForward, surfNormal, true, 24.0, 90.0, 3.0, dt);
    expect(surf.isSurfing).toBe(true);
  });
});
