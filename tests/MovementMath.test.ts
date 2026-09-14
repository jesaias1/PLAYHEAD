import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MovementMath } from '../src/player/MovementMath';

describe('MovementMath', () => {
  it('applies friction smoothly without inversion or NaN', () => {
    const vel = new THREE.Vector3(10, 0, 10);
    MovementMath.applyFriction(vel, 5.0, 3.0, 0.016);

    expect(Number.isFinite(vel.x)).toBe(true);
    expect(Number.isFinite(vel.z)).toBe(true);
    expect(vel.x).toBeLessThan(10);
    expect(vel.z).toBeLessThan(10);
    expect(vel.x).toBeGreaterThan(0);
    expect(vel.z).toBeGreaterThan(0);
  });

  it('accelerates along wishDir without exceeding wishSpeed on direct heading', () => {
    const vel = new THREE.Vector3(0, 0, 0);
    const wishDir = new THREE.Vector3(0, 0, 1);
    const wishSpeed = 14.0;
    const accel = 10.0;

    MovementMath.accelerate(vel, wishDir, wishSpeed, accel, 0.1);

    expect(vel.z).toBeGreaterThan(0);
    expect(vel.z).toBeLessThanOrEqual(wishSpeed);
    expect(vel.x).toBe(0);
  });

  it('allows air-strafe speed gain when moving perpendicular to wish direction', () => {
    // Player already moving fast forward (15 m/s along Z)
    const vel = new THREE.Vector3(0, 0, 15);
    // Player turns camera slightly and holds strafe right (along X)
    const wishDir = new THREE.Vector3(1, 0, 0);
    const maxAirWishSpeed = 3.0;
    const airAccel = 20.0;

    // In Source air acceleration, currentSpeed = dot(vel, wishDir) = 0
    // addSpeed = 3.0 - 0 = 3.0 > 0. It will add lateral velocity without slowing down Z!
    MovementMath.accelerate(vel, wishDir, maxAirWishSpeed, airAccel, 0.05);

    expect(vel.x).toBeGreaterThan(0);
    expect(vel.z).toBe(15); // Forward momentum perfectly preserved!
    expect(vel.length()).toBeGreaterThan(15); // Total speed increased!
  });

  it('projects surfing velocity along slope tangent', () => {
    const vel = new THREE.Vector3(0, -2, 10);
    // 45 degree slope normal facing up-left
    const surfNormal = new THREE.Vector3(0.7071, 0.7071, 0);

    MovementMath.applySurf(vel, surfNormal, 22.0, 0.016);

    expect(Number.isFinite(vel.x)).toBe(true);
    expect(Number.isFinite(vel.y)).toBe(true);
    expect(Number.isFinite(vel.z)).toBe(true);
    // Velocity dot normal should be non-negative (not falling through slope)
    expect(vel.dot(surfNormal)).toBeGreaterThanOrEqual(-0.01);
  });

  it('conserves horizontal speed magnitude exactly during applyAirSteering', () => {
    // Initial velocity: 14 m/s (560 u/s) along +Z
    const vel = new THREE.Vector3(0, 0, 14);
    const wishDir = new THREE.Vector3(1, 0, 0); // Holding D
    const initialSpeed = vel.length();

    let totalLatDisp = 0;
    const dt = 1 / 60;
    // Single jump flight duration ~0.625s (approx 38 ticks)
    for (let tick = 0; tick < 38; tick++) {
      MovementMath.applyAirSteering(vel, wishDir, 3.5, dt);
      totalLatDisp += vel.x * dt;
    }

    // Must yield responsive lateral displacement while strictly conserving speed magnitude
    expect(totalLatDisp).toBeGreaterThan(0.5);
    expect(totalLatDisp).toBeLessThan(1.0);
    expect(Math.abs(vel.length() - initialSpeed)).toBeLessThan(1e-5);
  });

  it('calculates read-only strafe telemetry without altering velocity', () => {
    const vel = new THREE.Vector3(0, 0, 14);
    const wishDir = new THREE.Vector3(1, 0, 0); // 90 degree perpendicular strafe
    const initialVel = vel.clone();

    const telemetry = MovementMath.calculateStrafeTelemetry(vel, wishDir, 0.25);

    expect(telemetry.strafeAngleDeg).toBeCloseTo(90.0, 1);
    expect(telemetry.efficiency).toBe(1.0);
    expect(telemetry.rating).toBe('OPTIMAL');

    // Telemetry must be pure read-only: no velocity change
    expect(vel.x).toBe(initialVel.x);
    expect(vel.y).toBe(initialVel.y);
    expect(vel.z).toBe(initialVel.z);
  });

  it('reports zero efficiency when no air acceleration was added', () => {
    const vel = new THREE.Vector3(0, 0, 14);
    const wishDir = new THREE.Vector3(0, 0, 1); // Direct forward, no lateral acceleration

    const telemetry = MovementMath.calculateStrafeTelemetry(vel, wishDir, 0.0);
    expect(telemetry.efficiency).toBe(0.0);
    expect(telemetry.rating).toBe('NONE');
  });
});

import { CURATED_PALETTES, PaletteSelector } from '../src/audio/TrackPalettes';

describe('TrackPalettes 7-Anchor Model', () => {
  it('defines all 7 anchors for every curated palette', () => {
    for (const key of Object.keys(CURATED_PALETTES)) {
      const palette = PaletteSelector.selectPalette(0, 0.5, 0.5);
      // Construct each palette directly
      const conf = CURATED_PALETTES[key];
      const voidCol = new THREE.Color(conf.voidHex);
      const surfCol = new THREE.Color(conf.surfaceHex);
      const primCol = new THREE.Color(conf.primaryHex);
      const secCol = new THREE.Color(conf.secondaryHex);
      const highCol = new THREE.Color(conf.highlightHex);
      const bassCol = new THREE.Color(conf.bassTintHex);
      const highTintCol = new THREE.Color(conf.highTintHex);

      expect(voidCol).toBeDefined();
      expect(surfCol).toBeDefined();
      expect(primCol).toBeDefined();
      expect(secCol).toBeDefined();
      expect(highCol).toBeDefined();
      expect(bassCol).toBeDefined();
      expect(highTintCol).toBeDefined();

      // Architecture mass contrast check: void and surface must be dark (< 0.25 luminance)
      const surfaceLum = surfCol.r * 0.2126 + surfCol.g * 0.7152 + surfCol.b * 0.0722;
      const voidLum = voidCol.r * 0.2126 + voidCol.g * 0.7152 + voidCol.b * 0.0722;
      expect(surfaceLum).toBeLessThan(0.25);
      expect(voidLum).toBeLessThan(0.15);

      // Highlight must have high luminance (> 0.4) for sharp contrast
      const hiLum = highCol.r * 0.2126 + highCol.g * 0.7152 + highCol.b * 0.0722;
      expect(hiLum).toBeGreaterThan(0.4);
    }
  });

  it('selects valid palettes deterministically across seeds and centroid ranges', () => {
    const pal1 = PaletteSelector.selectPalette(42, 0.2, 0.4);
    const pal2 = PaletteSelector.selectPalette(42, 0.2, 0.4);
    expect(pal1.name).toBe(pal2.name);

    const brightPal = PaletteSelector.selectPalette(999, 0.8, 0.9);
    expect(brightPal).toBeDefined();
    expect(brightPal.primary).toBeDefined();
  });
});
