import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { BoxCollider } from '../src/physics/Collider';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { PlayerController } from '../src/player/PlayerController';
import { RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';
import { MovementFeedbackController } from '../src/feedback/MovementFeedbackController';

const DT = 1 / 120;

interface FakePlayer {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  isGrounded: boolean;
  isSurfing: boolean;
  lastLandingSpeed: number;
  config: { playerRadius: number; playerHeight: number; speedUnitScale: number };
  surfState: { timeSurfing: number; entrySpeed: number };
  cameraController: { yaw: number };
  getSpeedUnits(): number;
}

function makePlayer(): FakePlayer {
  const p: FakePlayer = {
    position: { x: 0, y: 1.0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    isGrounded: true,
    isSurfing: false,
    lastLandingSpeed: 0,
    config: { playerRadius: 0.5, playerHeight: 1.8, speedUnitScale: 40 },
    surfState: { timeSurfing: 0, entrySpeed: 0 },
    cameraController: { yaw: 0 },
    getSpeedUnits() {
      return Math.hypot(this.velocity.x, this.velocity.z) * this.config.speedUnitScale;
    }
  };
  return p;
}

function makeObstaclePhysics(): PhysicsWorld {
  const physics = { obstacleColliders: [] } as unknown as PhysicsWorld;
  const node: RouteNode = {
    id: 42,
    time: 0,
    position: { x: 0, y: 1.5, z: 0 },
    dimensions: { x: 2, y: 4, z: 1 },
    yaw: 0,
    pitch: 0,
    roll: 0,
    type: RouteNodeType.SPLIT_GATE,
    intensity: 0.5,
    sectionIndex: 0,
    arcLength: 0,
    isSurf: false,
    isBoost: false,
    obstacleType: 'SPLIT_GATE'
  };
  physics.obstacleColliders.push({ collider: new BoxCollider(node), id: node.id, type: 'SPLIT_GATE' });
  return physics;
}

function makeSinks() {
  return {
    nearMiss: vi.fn(),
    landing: vi.fn(),
    surfLock: vi.fn(),
    finish: vi.fn()
  };
}

/** Sweeps the player along +Z past the obstacle at a lateral clearance. */
function sweepPast(
  controller: MovementFeedbackController,
  player: FakePlayer,
  physics: PhysicsWorld,
  lateralX: number,
  speedUnits: number
) {
  const speedMs = speedUnits / player.config.speedUnitScale;
  for (let z = -5; z <= 5; z += 0.04) {
    player.position.x = lateralX;
    player.position.z = z;
    player.position.y = 1.0;
    player.velocity.z = speedMs;
    controller.update(DT, player as unknown as PlayerController, physics);
  }
}

describe('Movement feedback — near miss', () => {
  it('fires exactly once for a close non-collision pass', () => {
    const sinks = makeSinks();
    const controller = new MovementFeedbackController(sinks);
    const player = makePlayer();
    const physics = makeObstaclePhysics();

    sweepPast(controller, player, physics, 1.6, 1600);

    expect(sinks.nearMiss).toHaveBeenCalledTimes(1);
    const [intensity, , obstacleId] = sinks.nearMiss.mock.calls[0];
    expect(intensity).toBeGreaterThan(0);
    expect(intensity).toBeLessThanOrEqual(1);
    expect(obstacleId).toBe(42);
    expect(controller.state.lastEvent).toBe('NEAR MISS');
  });

  it('does not count an actual collision as a near miss', () => {
    const sinks = makeSinks();
    const controller = new MovementFeedbackController(sinks);
    const player = makePlayer();
    const physics = makeObstaclePhysics();

    // Path straight through the obstacle (penetrating).
    sweepPast(controller, player, physics, 0.2, 1600);

    expect(sinks.nearMiss).not.toHaveBeenCalled();
  });

  it('does not fire at low speed', () => {
    const sinks = makeSinks();
    const controller = new MovementFeedbackController(sinks);
    const player = makePlayer();
    const physics = makeObstaclePhysics();

    sweepPast(controller, player, physics, 1.6, 200);

    expect(sinks.nearMiss).not.toHaveBeenCalled();
  });

  it('cannot fire every frame while lingering inside the shell', () => {
    const sinks = makeSinks();
    const controller = new MovementFeedbackController(sinks);
    const player = makePlayer();
    const physics = makeObstaclePhysics();

    player.position.x = 1.6;
    player.position.y = 1.0;
    player.position.z = 0;
    player.velocity.z = 40;
    for (let i = 0; i < 240; i++) {
      controller.update(DT, player as unknown as PlayerController, physics);
    }

    expect(sinks.nearMiss).toHaveBeenCalledTimes(1);
  });

  it('re-arms after reset (clean state between runs)', () => {
    const sinks = makeSinks();
    const controller = new MovementFeedbackController(sinks);
    const player = makePlayer();
    const physics = makeObstaclePhysics();

    sweepPast(controller, player, physics, 1.6, 1600);
    expect(sinks.nearMiss).toHaveBeenCalledTimes(1);

    controller.reset();
    sweepPast(controller, player, physics, 1.6, 1600);
    expect(sinks.nearMiss).toHaveBeenCalledTimes(2);
  });
});

describe('Movement feedback — landing', () => {
  function runAirborne(controller: MovementFeedbackController, player: FakePlayer, physics: PhysicsWorld, airtimeSec: number, peakY: number) {
    player.isGrounded = false;
    player.position.y = 0;
    controller.update(DT, player as unknown as PlayerController, physics);
    player.position.y = peakY;
    const ticks = Math.round(airtimeSec / DT);
    for (let i = 0; i < ticks; i++) {
      controller.update(DT, player as unknown as PlayerController, physics);
    }
  }

  it('keeps an ordinary hop below the presentation threshold', () => {
    const sinks = makeSinks();
    const controller = new MovementFeedbackController(sinks);
    const player = makePlayer();
    const physics = makeObstaclePhysics();

    runAirborne(controller, player, physics, 0.30, 1.0);
    player.isGrounded = true;
    player.position.y = 0;
    player.lastLandingSpeed = 700;
    controller.update(DT, player as unknown as PlayerController, physics);

    expect(sinks.landing).not.toHaveBeenCalled();
    expect(controller.state.landingMajor).toBe(false);
  });

  it('presents a hard transfer landing as major', () => {
    const sinks = makeSinks();
    const controller = new MovementFeedbackController(sinks);
    const player = makePlayer();
    const physics = makeObstaclePhysics();

    runAirborne(controller, player, physics, 1.5, 15);
    player.isGrounded = true;
    player.position.y = 0;
    player.lastLandingSpeed = 1600;
    controller.update(DT, player as unknown as PlayerController, physics);

    expect(sinks.landing).toHaveBeenCalledTimes(1);
    const [intensity, major] = sinks.landing.mock.calls[0];
    expect(major).toBe(true);
    expect(intensity).toBeGreaterThan(0.7);
    expect(controller.state.lastEvent).toBe('MAJOR TRANSFER');
  });

  it('never alters velocity or grounded state (presentation only)', () => {
    const sinks = makeSinks();
    const controller = new MovementFeedbackController(sinks);
    const player = makePlayer();
    const physics = makeObstaclePhysics();

    runAirborne(controller, player, physics, 1.5, 15);
    player.isGrounded = true;
    player.position.y = 0;
    player.lastLandingSpeed = 1600;

    const velBefore = { ...player.velocity };
    const groundedBefore = player.isGrounded;
    const landingSpeedBefore = player.lastLandingSpeed;
    controller.update(DT, player as unknown as PlayerController, physics);

    expect(player.velocity).toEqual(velBefore);
    expect(player.isGrounded).toBe(groundedBefore);
    expect(player.lastLandingSpeed).toBe(landingSpeedBefore);
  });
});

describe('Movement feedback — surf exit', () => {
  it('flags a clean committed surf once, and not a short slide', () => {
    const sinks = makeSinks();
    const controller = new MovementFeedbackController(sinks);
    const player = makePlayer();
    const physics = makeObstaclePhysics();

    // Short slide: no lock.
    player.isSurfing = true;
    player.surfState.entrySpeed = 20;
    player.surfState.timeSurfing = 0.2;
    player.velocity.x = 20;
    controller.update(DT, player as unknown as PlayerController, physics);
    player.isSurfing = false;
    player.velocity.x = 0;
    controller.update(DT, player as unknown as PlayerController, physics);
    expect(sinks.surfLock).not.toHaveBeenCalled();

    // Committed surf: lock.
    controller.reset();
    player.isSurfing = true;
    player.surfState.entrySpeed = 20;
    player.velocity.x = 45;
    for (let i = 0; i < Math.round(1.5 / DT); i++) {
      player.surfState.timeSurfing += DT;
      controller.update(DT, player as unknown as PlayerController, physics);
    }
    player.isSurfing = false;
    controller.update(DT, player as unknown as PlayerController, physics);

    expect(sinks.surfLock).toHaveBeenCalledTimes(1);
    expect(controller.state.lastEvent).toBe('SURF LOCK');
  });
});

describe('Movement feedback — finish', () => {
  it('fires exactly once', () => {
    const sinks = makeSinks();
    const controller = new MovementFeedbackController(sinks);

    controller.notifyFinish();
    controller.notifyFinish();
    expect(sinks.finish).toHaveBeenCalledTimes(1);

    controller.reset();
    controller.notifyFinish();
    expect(sinks.finish).toHaveBeenCalledTimes(2);
  });

  it('keeps the authoritative finish sequence free of timer writes', () => {
    const src = readFileSync('src/core/Game.ts', 'utf8');
    const start = src.indexOf('private handleFinishSequence()');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('\n  private ', start + 10);
    const body = src.slice(start, end > start ? end : start + 2000);
    // The presentation sequence must not WRITE the authoritative run timer.
    expect(body).not.toMatch(/this\.runElapsedTime\s*[-+*/]?=/);
    expect(body).toContain('notifyFinish');
  });
});

describe('Movement feedback — state hygiene', () => {
  it('reset clears cooldowns, events and camera offset', () => {
    const sinks = makeSinks();
    const controller = new MovementFeedbackController(sinks);
    const player = makePlayer();
    const physics = makeObstaclePhysics();

    sweepPast(controller, player, physics, 1.6, 1600);
    expect(controller.state.lastEvent).toBe('NEAR MISS');

    controller.reset();
    expect(controller.state.lastEvent).toBe('—');
    expect(controller.state.landingIntensity).toBe(0);
    expect(controller.state.surfQuality).toBe(0);
    expect(controller.state.cameraOffsetY).toBe(0);
  });
});
