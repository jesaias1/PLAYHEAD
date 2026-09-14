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

  it('preserves tangential momentum and applies downhill slope gravity when no keys held', () => {
    const surf = new SurfState();
    // 60-degree ramp: normal facing (-X, +Y) with ny = 0.5, nx = -0.866
    const surfNormal = new THREE.Vector3(-0.866025, 0.5, 0).normalize();

    // Player entering at 20 m/s along +Z (tangential to the ramp slope)
    const vel = new THREE.Vector3(0, 0, 20.0);
    const wishDir = new THREE.Vector3();
    const camForward = new THREE.Vector3(0, 0, 1);
    const camRight = new THREE.Vector3(-1, 0, 0); // facing +Z in right-handed coords
    const gravity = 24.0;
    const dt = 1 / 60;

    surf.updateSurfPhysics(
      vel,
      wishDir,
      false, // no keys held
      camForward,
      camRight,
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

    // No strafe held -> downhill slope gravity accelerates player down the ramp
    expect(vel.y).toBeLessThan(0); // sliding downhill
    expect(vel.dot(surfNormal)).toBeCloseTo(0, 5); // strictly on the tangent plane
  });

  it('holding A on a left-side ramp keeps player on the ramp and gains carving speed', () => {
    const surf = new SurfState();
    // Ramp on left: when looking along +Z, player's left is +X.
    // Ramp surface faces toward the player (-X direction): normal = (-0.866, 0.5, 0)
    const surfNormal = new THREE.Vector3(-0.866025, 0.5, 0).normalize();

    const vel = new THREE.Vector3(0, 0, 14.0);
    const camForward = new THREE.Vector3(0, 0, 1);
    const camRight = new THREE.Vector3(-1, 0, 0);
    // Player holds KeyA (strafe left into the left ramp, wishDir = -camRight = (+1, 0, 0))
    const wishDir = new THREE.Vector3(1, 0, 0);
    const gravity = 24.0;
    const dt = 1 / 120;

    const initialSpeed = vel.length();

    // Simulate 30 ticks (0.25 seconds) of holding A into the ramp
    for (let i = 0; i < 30; i++) {
      surf.updateSurfPhysics(
        vel,
        wishDir,
        true, // holding A
        camForward,
        camRight,
        surfNormal,
        true,
        gravity,
        150.0,
        2.0,
        dt
      );
    }

    // 1. Holding A must counterbalance slope gravity: Y velocity must NOT drop!
    expect(vel.y).toBeGreaterThanOrEqual(-0.01);

    // 2. Forward speed along +Z must be maintained and gain carving speed
    expect(vel.z).toBeGreaterThan(14.0);
    expect(vel.length()).toBeGreaterThan(initialSpeed);

    // 3. SurfSide is classified as LEFT
    expect(surf.surfSide).toBe('LEFT');
  });

  it('holding D on a right-side ramp keeps player on the ramp and maintains altitude', () => {
    const surf = new SurfState();
    // Ramp on right: when looking along +Z, player's right is -X.
    // Ramp surface faces toward player (+X direction): normal = (0.866, 0.5, 0)
    const surfNormal = new THREE.Vector3(0.866025, 0.5, 0).normalize();

    const vel = new THREE.Vector3(0, 0, 14.0);
    const camForward = new THREE.Vector3(0, 0, 1);
    const camRight = new THREE.Vector3(-1, 0, 0);
    // Player holds KeyD (strafe right into the right ramp, wishDir = +camRight = (-1, 0, 0))
    const wishDir = new THREE.Vector3(-1, 0, 0);
    const gravity = 24.0;
    const dt = 1 / 120;

    for (let i = 0; i < 30; i++) {
      surf.updateSurfPhysics(
        vel,
        wishDir,
        true, // holding D
        camForward,
        camRight,
        surfNormal,
        true,
        gravity,
        150.0,
        2.0,
        dt
      );
    }

    // Altitude maintained on right ramp when holding D
    expect(vel.y).toBeGreaterThanOrEqual(-0.01);
    expect(vel.z).toBeGreaterThan(14.0);
    expect(surf.surfSide).toBe('RIGHT');
  });

  it('stabilizes contact across micro-seams using contact grace period', () => {
    const surf = new SurfState();
    const surfNormal = new THREE.Vector3(0.866, 0.5, 0).normalize();
    const vel = new THREE.Vector3(0, 0, 15.0);
    const wishDir = new THREE.Vector3();
    const camForward = new THREE.Vector3(0, 0, 1);
    const camRight = new THREE.Vector3(-1, 0, 0);
    const dt = 1 / 120;

    // Frame 1: Contact
    surf.updateSurfPhysics(vel, wishDir, false, camForward, camRight, surfNormal, true, 24.0, 90.0, 3.0, dt);
    expect(surf.isSurfing).toBe(true);

    // Frame 2: 1-tick micro-separation (e.g. crossing seam between ramp segments)
    surf.updateSurfPhysics(vel, wishDir, false, camForward, camRight, surfNormal, false, 24.0, 90.0, 3.0, dt);
    // Must maintain surf state through the grace window
    expect(surf.isSurfing).toBe(true);

    // Frame 3: Resumed contact
    surf.updateSurfPhysics(vel, wishDir, false, camForward, camRight, surfNormal, true, 24.0, 90.0, 3.0, dt);
    expect(surf.isSurfing).toBe(true);
  });

  it('prohibits crawling or walking uphill on steep surf ramps and slides player downhill under gravity', () => {
    const surf = new SurfState();
    // 60-degree ramp: normal facing (+X, +Y) with ny = 0.5, nx = 0.866
    const surfNormal = new THREE.Vector3(0.866025, 0.5, 0).normalize();

    // Player stationary on the ramp (v = 0)
    const vel = new THREE.Vector3(0, 0, 0);

    // Player looks directly into/up the ramp (-X direction) and presses W (forward)
    const wishDir = new THREE.Vector3(-1, 0, 0);
    const camForward = new THREE.Vector3(-1, 0, 0);
    const camRight = new THREE.Vector3(0, 0, -1);
    const gravity = 24.0;
    const dt = 1 / 120;

    // Simulate 30 ticks (0.25 seconds) of holding W into/up the steep ramp
    for (let i = 0; i < 30; i++) {
      surf.updateSurfPhysics(
        vel,
        wishDir,
        true, // holding W
        camForward,
        camRight,
        surfNormal,
        true,
        gravity,
        90.0,
        3.0,
        dt
      );
    }

    // Must be sliding DOWNHILL under gravity, NOT crawling UP the ramp!
    expect(vel.y).toBeLessThan(0); // Y must be strictly negative (falling/sliding down)
    expect(vel.x).toBeGreaterThan(0); // sliding away from the wall down the slope (+X direction)

    // Verify upward slope component is strictly <= 0
    const grav = new THREE.Vector3(0, -gravity, 0);
    const slopeGravity = grav.clone().addScaledVector(surfNormal, -grav.dot(surfNormal));
    const uphillDir = slopeGravity.clone().normalize().negate();
    expect(vel.dot(uphillDir)).toBeLessThanOrEqual(0);
  });
});

