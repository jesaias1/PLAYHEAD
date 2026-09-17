import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { PlayerController } from '../src/player/PlayerController';
import { CameraController } from '../src/player/CameraController';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';

/**
 * HIGH-SPEED MOVEMENT REGRESSION
 *
 * PLAYHEAD has intentionally uncapped/high-speed movement. Legitimate high
 * horizontal velocity must NEVER trigger a checkpoint restore, spawn teleport,
 * watchdog recovery, or position correction of any kind.
 *
 * These tests drive the REAL physics integrator at representative bhop speeds
 * and assert that (a) nothing resets the player and (b) the rendered/physics
 * transform only ever moves like |velocity| * dt.
 */
describe('HighSpeedMovement', () => {
  const FIXED_DT = 1 / 120;

  function setup() {
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
    const domElement = { focus: vi.fn(), requestPointerLock: vi.fn() } as unknown as HTMLElement;
    const cameraController = new CameraController(camera, domElement);
    const physics = new PhysicsWorld();
    const player = new PlayerController(cameraController, physics);
    return { camera, cameraController, physics, player };
  }

  /**
   * Builds a long, flat, walkable runway so a fast player has somewhere
   * legitimate to travel, plus a world void boundary far below it.
   */
  function buildLongRunway(physics: PhysicsWorld, nodeCount = 90, spacing = 40) {
    const route: RouteNode[] = [];
    for (let i = 0; i < nodeCount; i++) {
      route.push({
        id: i,
        time: i * 0.5,
        position: { x: 0, y: 0, z: i * spacing },
        // Dimensions.z equals the spacing exactly, so the runway is a single
        // continuous walkable slab with no gaps to fall between.
        dimensions: { x: 30, y: 2, z: spacing },
        yaw: 0,
        pitch: 0,
        roll: 0,
        type: i === 0 ? RouteNodeType.START : RouteNodeType.PLATFORM,
        isSurf: false,
        arcLength: i * spacing
      });
    }
    physics.buildFromRoute(route);
    return route;
  }

  // Representative of very fast PLAYHEAD bhop/strafe play. The internal unit
  // scale means ~30 units of horizontal velocity is already ~900 speed units.
  const SPEEDS = [40, 120, 400, 1200, 3000];

  it('never resets or reverses the player at any legitimate speed', () => {
    for (const speed of SPEEDS) {
      const { physics, player } = setup();
      player.authoritativeKillY = physics.getVoidDeathY();

      // Build a runway long enough that the player never runs off the end
      // during the measured window — running out of course is a legitimate
      // fall, not the bug under test.
      const steps = 600;
      const travelNeeded = speed * FIXED_DT * steps * 2 + 400;
      const spacing = 40;
      const nodeCount = Math.ceil(travelNeeded / spacing) + 2;
      buildLongRunway(physics, nodeCount, spacing);

      let resets = 0;
      player.onFallCallback = () => { resets++; };

      // Start on the runway, travelling straight down +Z at the target speed.
      player.setPosition({ x: 0, y: 1.05, z: 40 });
      player.velocity.set(0, 0, speed);
      player.isGrounded = true;

      // Count every authoritative position overwrite during the run. The
      // physics integrator NEVER calls setPosition, so any call here is an
      // automatic restore/teleport.
      let externalPositionWrites = 0;
      player.setPosition = ((orig) => function (pos: any) {
        externalPositionWrites++;
        return orig.call(this, pos);
      })(player.setPosition.bind(player));

      let worstBackwardStep = 0;
      let maxStepDisplacement = 0;

      for (let step = 0; step < steps; step++) {
        const before = player.position.clone();
        const velBefore = player.velocity.clone();

        player.updateFixed(FIXED_DT);

        const after = player.position;
        const displacement = after.distanceTo(before);

        // Expected travel for one fixed step. Collision depenetration is small;
        // a teleport is not.
        const expected = velBefore.length() * FIXED_DT;
        const allowance = expected * 2.0 + 2.0;
        if (displacement > allowance) {
          maxStepDisplacement = Math.max(maxStepDisplacement, displacement);
        }

        // Forbidden: being thrown BACKWARD along the travel axis.
        const dz = after.z - before.z;
        if (dz < -0.001) {
          worstBackwardStep = Math.min(worstBackwardStep, dz);
        }

        // Keep supplying forward speed (emulating a player holding a bhop line).
        player.velocity.z = Math.max(player.velocity.z, speed);
      }

      expect(
        resets,
        `speed=${speed}: onFallCallback fired ${resets} time(s) during legitimate high-speed travel`
      ).toBe(0);

      expect(
        externalPositionWrites,
        `speed=${speed}: player position was externally overwritten ${externalPositionWrites} time(s)`
      ).toBe(0);

      expect(
        worstBackwardStep,
        `speed=${speed}: player was moved backward by ${worstBackwardStep.toFixed(3)} units in one step`
      ).toBe(0);

      expect(
        maxStepDisplacement,
        `speed=${speed}: a single physics step displaced the player ${maxStepDisplacement.toFixed(2)} units ` +
        `(far beyond |v|*dt = ${(speed * FIXED_DT).toFixed(2)}) — teleport/correction detected`
      ).toBe(0);
    }
  });

  it('progresses monotonically forward at extreme speed (no snap back toward start)', () => {
    const { physics, player } = setup();
    buildLongRunway(physics, 140, 40);
    player.authoritativeKillY = physics.getVoidDeathY();

    const speed = 2500;
    player.setPosition({ x: 0, y: 1.05, z: 40 });
    player.velocity.set(0, 0, speed);

    let maxZ = player.position.z;
    let regressions = 0;
    for (let step = 0; step < 900; step++) {
      player.updateFixed(FIXED_DT);
      player.velocity.z = Math.max(player.velocity.z, speed);
      const z = player.position.z;
      if (z < maxZ - 0.5) regressions++;
      maxZ = Math.max(maxZ, z);
    }

    expect(regressions, 'player position regressed toward the start mid-run').toBe(0);
    expect(player.position.z).toBeGreaterThan(40);
  });

  it('large legitimate per-step displacement is far below the emergency bound', () => {
    const { physics, player } = setup();
    buildLongRunway(physics);
    player.authoritativeKillY = physics.getVoidDeathY();

    // A single step at an absurd (but finite) legitimate speed must stay well
    // inside the numerical-corruption bound used by the emergency path.
    const absurdSpeed = 10_000;
    player.setPosition({ x: 0, y: 1.05, z: 40 });
    player.velocity.set(0, 0, absurdSpeed);
    player.updateFixed(FIXED_DT);

    expect(player.position.z - 40).toBeLessThan(200);
    expect(Number.isFinite(player.position.z)).toBe(true);
  });

  it('being far from the route centre does not reset the player', () => {
    const { physics, player } = setup();
    buildLongRunway(physics);
    player.authoritativeKillY = physics.getVoidDeathY();

    let resets = 0;
    player.onFallCallback = () => { resets++; };

    // Legitimately flying far to the side, still above the void boundary.
    player.setPosition({ x: 5000, y: 200, z: 400 });
    player.velocity.set(800, -20, 800);
    for (let i = 0; i < 120; i++) {
      player.velocity.x = 800;
      player.velocity.z = 800;
      player.position.y = 200; // hold it airborne above the boundary
      player.updateFixed(FIXED_DT);
    }

    expect(resets).toBe(0);
  });

  it('true void crossing still restores, and emergency state still recovers', () => {
    const { physics, player } = setup();
    buildLongRunway(physics);
    const voidY = physics.getVoidDeathY();
    player.authoritativeKillY = voidY;

    const reasons: string[] = [];
    player.onFallCallback = (r) => { reasons.push(r); };

    // Genuine void crossing.
    player.setPosition({ x: 0, y: 1, z: 40 });
    player.position.y = voidY - 1;
    player.updateFixed(FIXED_DT);
    expect(reasons).toContain('NORMAL_VOID');

    // Numeric corruption.
    reasons.length = 0;
    player.setPosition({ x: 0, y: 1, z: 40 });
    player.position.set(NaN, NaN, NaN);
    player.updateFixed(FIXED_DT);
    expect(reasons.length).toBe(1);
    expect(reasons[0]).not.toBe('NORMAL_VOID');
  });
});