import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { PlayerController } from '../src/player/PlayerController';
import { CameraController } from '../src/player/CameraController';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';

/**
 * VOID FALL REGRESSION
 *
 * Governing rule: the ONLY gameplay death is crossing the authoritative world
 * void boundary (final legitimate geometry minus a generous margin). Airborne
 * duration, speed, distance, platform proximity and route progression are never
 * kill rules. See tests/VoidRestorePolicy.test.ts for the full policy suite.
 */
describe('VoidFallRegression', () => {
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

  it('triggers fall recovery when player descends below authoritativeKillY', () => {
    const { player } = setupPlayer();
    let fallCalled = false;
    player.onFallCallback = () => {
      fallCalled = true;
    };

    player.setPosition({ x: 0, y: 100, z: 0 });
    player.authoritativeKillY = 75.0;

    // Simulate physics step where player is at y = 70 (< 75.0)
    player.position.y = 70.0;
    player.updateFixed(1 / 120);

    expect(fallCalled).toBe(true);
  });

  it('NO freefall timer kill: prolonged falling above the void plane is safe', () => {
    const { player } = setupPlayer();
    let fallCalled = false;
    player.onFallCallback = () => {
      fallCalled = true;
    };

    player.setPosition({ x: 0, y: 1000, z: 0 });
    player.authoritativeKillY = -500; // Authoritative world void boundary, far below

    // 3.4 seconds of falling with negative vertical velocity
    player.velocity.y = -20;
    for (let i = 0; i < 3.4 * 60; i++) {
      player.updateFixed(1 / 60);
    }
    expect(fallCalled).toBe(false);

    // Well past the old 3.5s watchdog threshold — still no kill, because
    // airborne duration must never by itself restore the player.
    player.velocity.y = -20;
    for (let i = 0; i < 10 * 60; i++) {
      player.position.y = 1000 - i * 0.01; // stay far above the boundary
      player.velocity.y = -20;
      player.updateFixed(1 / 60);
    }
    expect(fallCalled).toBe(false);
  });

  it('correctly tracks lastTouchedSurfaceType for surf vs platform', () => {
    const { player, physics } = setupPlayer();

    // Create a ground platform and a surf ramp in route
    const route: RouteNode[] = [
      {
        id: 1,
        time: 0,
        position: { x: 0, y: 0, z: 0 },
        dimensions: { x: 10, y: 2, z: 10 },
        yaw: 0,
        pitch: 0,
        roll: 0,
        type: RouteNodeType.START,
        isSurf: false,
        arcLength: 0
      },
      {
        id: 2,
        time: 2,
        position: { x: 50, y: 0, z: 0 },
        dimensions: { x: 10, y: 2, z: 10 },
        yaw: 0,
        pitch: 0,
        roll: 0.6, // Tilted surf ramp
        type: RouteNodeType.PLATFORM,
        isSurf: true,
        arcLength: 50
      }
    ];
    physics.buildFromRoute(route);

    // Place on normal platform
    player.setPosition({ x: 0, y: 2, z: 0 });
    player.updateFixed(1 / 60);
    expect(player.lastTouchedSurfaceType).toBe('PLATFORM');

    // Jump into air
    player.position.y = 10;
    player.updateFixed(1 / 60);
    // Preserves platform in air
    expect(player.lastTouchedSurfaceType).toBe('PLATFORM');
  });

  it('PhysicsWorld calculates killPlaneY properly when route starts above y = 0', () => {
    const physics = new PhysicsWorld();
    const highRoute: RouteNode[] = [
      {
        id: 1,
        time: 0,
        position: { x: 0, y: 150, z: 0 },
        dimensions: { x: 10, y: 2, z: 10 },
        yaw: 0,
        pitch: 0,
        roll: 0,
        type: RouteNodeType.START,
        isSurf: false,
        arcLength: 0
      },
      {
        id: 2,
        time: 2,
        position: { x: 0, y: 120, z: 50 },
        dimensions: { x: 10, y: 2, z: 10 },
        yaw: 0,
        pitch: 0,
        roll: 0,
        type: RouteNodeType.PLATFORM,
        isSurf: false,
        arcLength: 50
      }
    ];

    physics.buildFromRoute(highRoute);
    // lowest bottomY is 120 - 1 = 119
    // killPlaneY must be 119 - VOID_MARGIN (40) = 79, NOT -25!
    expect(physics.killPlaneY).toBe(119 - PhysicsWorld.VOID_MARGIN);
    expect(physics.getVoidDeathY()).toBe(119 - PhysicsWorld.VOID_MARGIN);
  });

  it('allows high surf jumps (> 5 seconds airtime) above track level without false void fall', () => {
    const { player } = setupPlayer();
    let fallCalled = false;
    player.onFallCallback = () => {
      fallCalled = true;
    };

    player.setPosition({ x: 0, y: 10, z: 0 });
    player.lastTouchedSurfaceType = 'SURF';
    player.authoritativeKillY = -25.0;

    // Simulate jumping high to y = 60m and descending for 5.5 seconds above route level
    player.position.y = 60.0;
    player.velocity.y = -6.0;

    for (let i = 0; i < 5.5 * 60; i++) {
      player.updateFixed(1 / 60);
      // Keep player position in the sky above the track (> 10.0m)
      if (player.position.y < 15.0) player.position.y = 50.0;
    }

    // Must NOT trigger fall since player is high in the sky performing a surf jump
    expect(fallCalled).toBe(false);
  });

  it('reports NORMAL_VOID when the player crosses the authoritative void boundary', () => {
    const { player } = setupPlayer();
    const reasons: string[] = [];
    player.onFallCallback = (reason) => {
      reasons.push(reason);
    };

    player.setPosition({ x: 0, y: 0, z: 0 });
    player.authoritativeKillY = -500.0; // World void boundary, far below the route

    // Far below the local platform but still above the true void boundary:
    // no restore.
    player.position.y = -60.0;
    player.updateFixed(1 / 120);
    expect(reasons).toEqual([]);

    // Genuinely crosses the boundary.
    player.position.y = -500.5;
    player.updateFixed(1 / 120);
    expect(reasons).toEqual(['NORMAL_VOID']);
  });
});
