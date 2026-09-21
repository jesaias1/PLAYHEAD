import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { PlayerController } from '../src/player/PlayerController';
import { CameraController } from '../src/player/CameraController';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';
import {
  decideRestore,
  hasInvalidNumericState,
  RestoreReason,
  EMERGENCY_COORD_LIMIT
} from '../src/player/RestorePolicy';

/**
 * VOID / RESTORE POLICY REGRESSION SUITE
 *
 * These tests exercise the REAL decision logic. The governing gameplay rule is:
 *
 *   NOTHING except crossing the authoritative world void boundary (or a
 *   numerically broken state) may restore the player.
 *
 * PLAYHEAD must permit expert players to make absurdly long, fast transfers.
 */
describe('VoidRestorePolicy', () => {
  const VOID_Y = -60;

  const state = (y: number, over: Partial<{ x: number; z: number; vy: number; vx: number }> = {}) => ({
    position: { x: over.x ?? 0, y, z: over.z ?? 0 },
    velocity: { x: over.vx ?? 0, y: over.vy ?? 0, z: 0 }
  });

  // A. Player far ABOVE the route -> NO restore
  it('A: player far above the route is never restored', () => {
    expect(decideRestore(state(5000), VOID_Y)).toBeNull();
    expect(decideRestore(state(500), VOID_Y)).toBeNull();
  });

  // B. Extremely far horizontally but above the void plane -> NO restore
  it('B: extreme horizontal distance above the void plane is never restored', () => {
    expect(decideRestore(state(10, { x: 250_000 }), VOID_Y)).toBeNull();
    expect(decideRestore(state(10, { z: -180_000 }), VOID_Y)).toBeNull();
  });

  // C. Airborne for a very long time -> NO restore (policy has no time input at all)
  it('C: prolonged airborne time alone cannot restore (policy is time-independent)', () => {
    // The policy signature has no time/freefall parameter by construction, so a
    // long freefall above the boundary is simply a safe state.
    for (const y of [900, 400, 120, 5, -10, -59.9]) {
      expect(decideRestore(state(y), VOID_Y)).toBeNull();
    }
  });

  // D. Extreme horizontal speed -> NO restore
  it('D: extreme horizontal speed above the void plane is never restored', () => {
    expect(decideRestore(state(20, { vx: 900, vy: -20 }), VOID_Y)).toBeNull();
    expect(decideRestore(state(20, { vx: 50_000 }), VOID_Y)).toBeNull();
  });

  // E. Below a local platform but above the global death plane -> NO restore
  it('E: below the local platform but above the global void plane is never restored', () => {
    // Local platform sits at y=100; player has dropped 150m below it but the
    // world void plane is far lower (-60). This previously restored the player.
    const localPlatformY = 100;
    const belowLocal = localPlatformY - 150; // -50
    expect(belowLocal).toBeLessThan(localPlatformY);
    expect(belowLocal).toBeGreaterThan(VOID_Y);
    expect(decideRestore(state(belowLocal), VOID_Y)).toBeNull();
  });

  // F. Genuinely crosses the void boundary -> restore
  it('F: crossing the authoritative void plane produces NORMAL_VOID', () => {
    expect(decideRestore(state(VOID_Y - 0.01), VOID_Y)).toBe(RestoreReason.NORMAL_VOID);
    expect(decideRestore(state(-1000), VOID_Y)).toBe(RestoreReason.NORMAL_VOID);
  });

  // H. NaN / invalid numeric state -> emergency path, not normal void
  it('H: invalid numeric state routes to emergency, never NORMAL_VOID', () => {
    const nan = decideRestore(
      { position: { x: NaN, y: NaN, z: NaN }, velocity: { x: 0, y: 0, z: 0 } },
      VOID_Y
    );
    expect(nan).toBe(RestoreReason.INVALID_NUMERIC_STATE);

    const inf = decideRestore(
      { position: { x: Infinity, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
      VOID_Y
    );
    expect(inf).toBe(RestoreReason.INVALID_NUMERIC_STATE);

    const absurd = decideRestore(
      { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: EMERGENCY_COORD_LIMIT * 3 } },
      VOID_Y
    );
    expect(absurd).toBe(RestoreReason.INVALID_NUMERIC_STATE);

    // Absurd but finite POSITION is classified as out-of-bounds, not generic
    const outOfBounds = decideRestore(
      { position: { x: 0, y: EMERGENCY_COORD_LIMIT * 5, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
      VOID_Y
    );
    expect(outOfBounds).toBe(RestoreReason.EMERGENCY_OUT_OF_BOUNDS);

    // The emergency classifier must agree
    expect(hasInvalidNumericState({ position: { x: NaN, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } })).toBe(true);
    expect(hasInvalidNumericState(state(0))).toBe(false);
  });

  it('null void plane never produces a void restore', () => {
    expect(decideRestore(state(-99999), null)).toBeNull();
  });

  /**
   * THE HIGH-SPEED RUBBERBAND REGRESSION.
   *
   * The world void boundary must be a single world constant derived from final
   * geometry. It must NEVER be re-derived from the current checkpoint, because
   * an elevated checkpoint then raises the death plane above the lower parts of
   * the course — and a player legitimately diving through that lower section at
   * speed is instantly restored (the observed "rubberband toward the start").
   */
  it('REGRESSION: an elevated checkpoint must not raise the death plane', () => {
    // World geometry: the route descends 60m. Final geometry spans y=0..100, so
    // the authoritative boundary is derived once from the LOWEST geometry.
    const lowestGameplayY = 0;
    const WORLD_VOID_MARGIN = 40;
    const worldVoidY = lowestGameplayY - WORLD_VOID_MARGIN; // -40

    // A checkpoint sits high on the ascent at y=100.
    const checkpointY = 100;

    // The OLD (buggy) behavior derived the plane from the checkpoint:
    const oldBuggyKillY = checkpointY - 25.0; // +75

    // A player legitimately diving through the lower route at speed:
    const divingPlayerY = 20;

    // Under the old rule this player is killed while flying over real geometry.
    expect(decideRestore(state(divingPlayerY), oldBuggyKillY)).toBe(RestoreReason.NORMAL_VOID);

    // Under the authoritative world boundary the same player is safe.
    expect(decideRestore(state(divingPlayerY), worldVoidY)).toBeNull();

    // And the boundary is far below every piece of legitimate geometry, so only
    // a genuine void fall can reach it.
    expect(worldVoidY).toBeLessThan(lowestGameplayY);
  });

  it('REGRESSION: no automatic restore at any speed or airborne duration above the boundary', () => {
    const worldVoidY = -40;

    // Sweep representative fast-play states. None may restore.
    for (const speed of [40, 120, 400, 1200, 3000]) {
      for (const y of [500, 200, 50, 1, -20, -39.9]) {
        for (const vy of [0, -5, -50, -400]) {
          expect(
            decideRestore(
              { position: { x: speed * 3, y, z: -speed * 2 }, velocity: { x: speed, y: vy, z: speed } },
              worldVoidY
            ),
            `unexpected restore at speed=${speed} y=${y} vy=${vy}`
          ).toBeNull();
        }
      }
    }
  });

  it('exactly at the boundary is still safe (strict crossing required)', () => {
    expect(decideRestore(state(VOID_Y), VOID_Y)).toBeNull();
  });
});

describe('PlayerController void death integration', () => {
  function setupPlayer() {
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
    const domElement = {
      focus: vi.fn(),
      requestPointerLock: vi.fn()
    } as unknown as HTMLElement;
    const cameraController = new CameraController(camera, domElement);
    const physics = new PhysicsWorld();
    const player = new PlayerController(cameraController, physics);
    return { camera, cameraController, physics, player };
  }

  it('C: long freefall above the boundary never triggers onFallCallback', () => {
    const { player } = setupPlayer();
    let fallCalled = false;
    player.onFallCallback = () => { fallCalled = true; };

    player.setPosition({ x: 0, y: 1000, z: 0 });
    player.authoritativeKillY = -500;

    // 10 seconds of continuous fast falling, still far above the boundary.
    player.velocity.y = -40;
    for (let i = 0; i < 10 * 60; i++) {
      player.updateFixed(1 / 60);
      if (player.position.y < 100) {
        // keep it airborne well above the void plane
        player.position.y = 100;
        player.velocity.y = -40;
      }
    }
    expect(fallCalled).toBe(false);
  });

  it('E: player below the local platform but above the void plane is not restored', () => {
    const { player } = setupPlayer();
    let fallCalled = false;
    player.onFallCallback = () => { fallCalled = true; };

    player.authoritativeKillY = -60;
    player.setPosition({ x: 0, y: -50, z: 0 });
    player.velocity.y = -10;

    for (let i = 0; i < 30; i++) {
      player.position.y = -50;
      player.velocity.y = -10;
      player.updateFixed(1 / 60);
    }
    expect(fallCalled).toBe(false);
  });

  it('F: crossing the void plane reports NORMAL_VOID', () => {
    const { player } = setupPlayer();
    const reasons: RestoreReason[] = [];
    player.onFallCallback = (reason) => { reasons.push(reason); };

    player.authoritativeKillY = -60;
    player.setPosition({ x: 0, y: 0, z: 0 });
    player.position.y = -60.5;
    player.updateFixed(1 / 120);

    expect(reasons).toEqual([RestoreReason.NORMAL_VOID]);
  });

  it('H: NaN position reports an emergency reason, not NORMAL_VOID', () => {
    const { player } = setupPlayer();
    const reasons: RestoreReason[] = [];
    player.onFallCallback = (reason) => { reasons.push(reason); };

    player.authoritativeKillY = -60;
    player.position.set(NaN, NaN, NaN);
    player.updateFixed(1 / 120);

    expect(reasons.length).toBe(1);
    expect(reasons[0]).not.toBe(RestoreReason.NORMAL_VOID);
    expect(reasons[0]).toBe(RestoreReason.INVALID_NUMERIC_STATE);
  });

  it('exposes void-plane state for diagnostics', () => {
    const { player } = setupPlayer();
    player.authoritativeKillY = -60;
    player.position.y = -61;
    expect(player.isBelowVoidDeathPlane()).toBe(true);
    player.position.y = 0;
    expect(player.isBelowVoidDeathPlane()).toBe(false);
  });
});

/**
 * G. Restore must clear dangerous stale velocity/contact state.
 * Exercised through the real `setPosition` transaction, which is what the
 * atomic restore calls.
 */
describe('G: restore clears stale state', () => {
  function setupPlayer() {
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
    const domElement = { focus: vi.fn(), requestPointerLock: vi.fn() } as unknown as HTMLElement;
    const cameraController = new CameraController(camera, domElement);
    const physics = new PhysicsWorld();
    return { player: new PlayerController(cameraController, physics), physics, cameraController };
  }

  it('setPosition zeroes the full velocity vector', () => {
    const { player } = setupPlayer();
    player.velocity.set(300, -900, 120);
    player.setPosition({ x: 0, y: 10, z: 0 });
    expect(player.velocity.x).toBe(0);
    expect(player.velocity.y).toBe(0);
    expect(player.velocity.z).toBe(0);
  });

  it('setPosition clears surf/contact/ground state so the old trajectory cannot resume', () => {
    const { player } = setupPlayer();
    player.isSurfing = true;
    player.isGrounded = false;
    player.surfState.surfSide = 'LEFT';

    player.setPosition({ x: 5, y: 20, z: 5 });

    expect(player.isSurfing).toBe(false);
    expect(player.isGrounded).toBe(true);
    expect(player.surfState.isSurfing).toBe(false);
    expect(player.getFreefallTime()).toBe(0);
  });

  it('setPosition synchronizes the camera to the restored transform', () => {
    const { player, cameraController } = setupPlayer();
    player.setPosition({ x: 12, y: 34, z: 56 });
    expect(cameraController.camera.position.x).toBe(12);
    expect(cameraController.camera.position.y).toBeCloseTo(34 + player.config.eyeHeight, 5);
    expect(cameraController.camera.position.z).toBe(56);
  });
});

describe('Route-Aware Void Death Envelope & Stacking Protection', () => {
  it('restores promptly beneath an elevated platform without waiting for global void plane', () => {
    const physics = new PhysicsWorld();
    const highPlatform: RouteNode = {
      id: 1,
      time: 0,
      position: { x: 0, y: 100, z: 0 },
      dimensions: { x: 14, y: 2, z: 30 },
      yaw: 0,
      pitch: 0,
      roll: 0,
      type: RouteNodeType.RUNWAY,
      intensity: 0.5,
      sectionIndex: 0,
      arcLength: 0,
      isSurf: false
    };

    physics.buildFromRoute([highPlatform]);
    // Global kill plane is lowest - 20m = 99 - 20 = 79m (if single platform)
    // Now let's add a distant deep platform at y = -80m
    const deepPlatform: RouteNode = {
      id: 2,
      time: 10,
      position: { x: 500, y: -80, z: 500 },
      dimensions: { x: 14, y: 2, z: 30 },
      yaw: 0,
      pitch: 0,
      roll: 0,
      type: RouteNodeType.RUNWAY,
      intensity: 0.5,
      sectionIndex: 0,
      arcLength: 100,
      isSurf: false
    };

    physics.buildFromRoute([highPlatform, deepPlatform]);
    // Global void death Y is deepPlatform bottom - 20m = -81 - 20 = -101m
    expect(physics.getVoidDeathY()).toBeCloseTo(-101, 1);

    // Beneath high platform at (0, z=0), local threshold is around 77.5m - 79m (prompt fall)
    const localVoidY = physics.getVoidDeathY(0, 0);
    expect(localVoidY).toBeGreaterThanOrEqual(77);
    expect(localVoidY).toBeLessThanOrEqual(80);

    // Player falling at y = 75m directly under high platform is in void!
    expect(physics.isPositionInVoid({ x: 0, y: 75, z: 0 })).toBe(true);
    // Player at y = 90m (only 10m below) is still safe
    expect(physics.isPositionInVoid({ x: 0, y: 90, z: 0 })).toBe(false);
  });

  it('guarantees lower descending routes remain 100% safe (Stacking Protection)', () => {
    const physics = new PhysicsWorld();
    const upperPlatform: RouteNode = {
      id: 1,
      time: 0,
      position: { x: 0, y: 100, z: 0 },
      dimensions: { x: 14, y: 2, z: 30 },
      yaw: 0,
      pitch: 0,
      roll: 0,
      type: RouteNodeType.RUNWAY,
      intensity: 0.5,
      sectionIndex: 0,
      arcLength: 0,
      isSurf: false
    };

    // Lower deck platform directly beneath at y = 30m
    const lowerDeck: RouteNode = {
      id: 2,
      time: 5,
      position: { x: 0, y: 30, z: 10 },
      dimensions: { x: 20, y: 2, z: 40 },
      yaw: 0,
      pitch: 0,
      roll: 0,
      type: RouteNodeType.RUNWAY,
      intensity: 0.5,
      sectionIndex: 0,
      arcLength: 50,
      isSurf: false
    };

    physics.buildFromRoute([upperPlatform, lowerDeck]);

    // Beneath upper platform where lower deck exists, local threshold must be below LOWER deck (30 - 1 - 20 = 9m)!
    const thresholdAboveLowerDeck = physics.getVoidDeathY(0, 10);
    expect(thresholdAboveLowerDeck).toBeCloseTo(9, 1);

    // Player descending between upper and lower platform at y = 60m must NOT be restored!
    expect(physics.isPositionInVoid({ x: 0, y: 60, z: 10 })).toBe(false);
    // Player descending at y = 32m just landing on lower platform must NOT be restored!
    expect(physics.isPositionInVoid({ x: 0, y: 32, z: 10 })).toBe(false);
    // Player falling beneath lower deck at y = 5m IS in void!
    expect(physics.isPositionInVoid({ x: 0, y: 5, z: 10 })).toBe(true);
  });

  it('keeps legitimate fast airborne transfers between platforms safe', () => {
    const physics = new PhysicsWorld();
    const platA: RouteNode = {
      id: 1,
      time: 0,
      position: { x: 0, y: 80, z: 0 },
      dimensions: { x: 12, y: 2, z: 20 },
      yaw: 0,
      pitch: 0,
      roll: 0,
      type: RouteNodeType.RUNWAY,
      intensity: 0.5,
      sectionIndex: 0,
      arcLength: 0,
      isSurf: false
    };
    const platB: RouteNode = {
      id: 2,
      time: 2,
      position: { x: 0, y: 70, z: 50 },
      dimensions: { x: 12, y: 2, z: 20 },
      yaw: 0,
      pitch: 0,
      roll: 0,
      type: RouteNodeType.RUNWAY,
      intensity: 0.5,
      sectionIndex: 0,
      arcLength: 50,
      isSurf: false
    };

    physics.buildFromRoute([platA, platB]);

    // Midpoint of airborne jump gap at z = 25
    const jumpMidThreshold = physics.getVoidDeathY(0, 25);
    // Flight path bottom around y = 68.5 -> threshold is around 68.5 - 20 = 48.5m
    expect(jumpMidThreshold).toBeLessThanOrEqual(50);

    // Airborne player at y = 75 is safe
    expect(physics.isPositionInVoid({ x: 0, y: 75, z: 25 })).toBe(false);
    // Player missing jump and plunging to y = 40 is in void
    expect(physics.isPositionInVoid({ x: 0, y: 40, z: 25 })).toBe(true);
  });
});