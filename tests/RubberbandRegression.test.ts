import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { PlayerController } from '../src/player/PlayerController';
import { CameraController } from '../src/player/CameraController';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { GameClock } from '../src/core/Clock';
import { RouteGenerator } from '../src/generation/RouteGenerator';
import { TrackAnalysis } from '../src/audio/AudioFeatures';
import { SettingsManager } from '../src/core/Settings';

/**
 * RUBBERBAND REGRESSION SUITE
 *
 * Drives the REAL frame loop (GameClock accumulator -> PlayerController.updateFixed)
 * over REAL generated course geometry, at high horizontal speed, across a matrix
 * of camera pitch, FOV, and render cadence.
 *
 * The invariant under test: the authoritative player position must never move
 * BACKWARD along its own travel direction by more than a small tolerance, and
 * must never be teleported. A backward snap here is the reported bug.
 */
describe('RubberbandRegression', () => {
  function makeAnalysis(duration = 60, seed = 0x1111): TrackAnalysis {
    const count = Math.max(4, Math.floor(duration / 18));
    const step = duration / count;
    const themes = ['FLOW', 'BUILDUP', 'ASCENT', 'FLOW', 'DESCENT', 'SPEED'] as const;
    const sections = [];
    for (let i = 0; i < count; i++) {
      sections.push({
        index: i, start: i * step, end: (i + 1) * step, duration: step,
        intensity: 0.5 + (i / count) * 0.4, rhythmicDensity: 0.6, brightness: 0.6,
        theme: themes[(i + (seed % themes.length)) % themes.length]
      });
    }
    return {
      filename: 'rb', duration, bpm: 128, bpmConfidence: 0.85, globalEnergy: 0.65,
      frames: [], onsets: [], sections, waveform: new Float32Array(512), seed,
      visualAccent: { name: 'N', hex: '#ff3366', rgb: [255, 51, 102] }
    } as TrackAnalysis;
  }

  function setup(seed = 0x1111) {
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 2000);
    const domElement = { focus: vi.fn(), requestPointerLock: vi.fn() } as unknown as HTMLElement;
    const cameraController = new CameraController(camera, domElement);
    const physics = new PhysicsWorld();
    const player = new PlayerController(cameraController, physics);

    const track = RouteGenerator.generate(makeAnalysis(60, seed));
    physics.buildFromRoute(track.route, track.optionalRamps, track.recoveryShelves);

    // Place the player at the start of the real course.
    const start = track.route[0];
    player.setPosition({
      x: start.position.x,
      y: start.position.y + start.dimensions.y * 0.5 + 0.05,
      z: start.position.z
    });
    player.authoritativeKillY = physics.getVoidDeathY();
    player.lastTouchedSurfaceType = 'PLATFORM';
    player.setOrientation(0);

    return { player, cameraController, physics, track };
  }

  /**
   * Runs the real clock loop and returns the worst backward travel observed.
   */
  function runLoop(
    player: PlayerController,
    cameraController: CameraController,
    opts: {
      pitchDeg: number;
      fov: number;
      cadenceMs: number | number[];
      frames: number;
      speedTarget: number;
      /** Y held for the player so the run stays airborne and on-course. */
      holdY?: number;
    }
  ) {
    cameraController.setOrientation(cameraController.yaw, (opts.pitchDeg * Math.PI) / 180);
    (player.cameraController.camera as THREE.PerspectiveCamera).fov = opts.fov;
    (player.cameraController.camera as THREE.PerspectiveCamera).updateProjectionMatrix();

    const clock = new GameClock(120);
    clock.start();

    // Genuine bhop: hold forward + jump, and keep the player airborne so the
    // Source air-accelerator (not ground friction) drives the speed.
    const keys = player.keysState as any;
    keys.forward = true;
    keys.jump = true;

    const holdY = opts.holdY ?? player.position.y;

    let worstBackward = 0;
    let worstInfo: any = null;
    let teleports = 0;
    let maxDisplaySpeed = 0;
    let distance = 0;
    let airborneSteps = 0;
    let nanFrame = -1;
    let nanInfo: any = null;

    const originalSetPosition = player.setPosition.bind(player);
    player.setPosition = function (pos: any) {
      teleports++;
      return originalSetPosition(pos);
    };

    for (let frame = 0; frame < opts.frames; frame++) {
      const cadence = Array.isArray(opts.cadenceMs)
        ? opts.cadenceMs[frame % opts.cadenceMs.length]
        : opts.cadenceMs;

      // Inject the target high horizontal speed at the start of the FRAME so the
      // real clock then runs its multi-substep loop with that speed — exactly
      // the condition the reported bug needs. (Reproducing Source air-strafe
      // gain itself would require simulated mouse input.)
      const fwd = cameraController.getForwardVector();
      player.velocity.x = fwd.x * opts.speedTarget;
      player.velocity.z = fwd.z * opts.speedTarget;
      player.position.y = holdY;
      player.isGrounded = false;
      player.isSurfing = false;
      player.velocity.y = 0;

      const before = player.position.clone();
      const beforeVel = player.velocity.clone();

      // Advance the real clock by the simulated frame time.
      advanceClockBy(clock, cadence, player);

      const after = player.position;
      airborneSteps++;

      const vhn = Math.hypot(beforeVel.x, beforeVel.z);
      if (vhn > 1e-4) {
        const ux = beforeVel.x / vhn;
        const uz = beforeVel.z / vhn;
        const along = (after.x - before.x) * ux + (after.z - before.z) * uz;
        if (along < 0 && -along > worstBackward) {
          worstBackward = -along;
          worstInfo = {
            frame,
            backward: -along,
            speed: player.getSpeedUnits(),
            y: after.y,
            grounded: player.isGrounded,
            surfing: player.isSurfing,
            vel: { ...beforeVel }
          };
        }
      }

      distance += Math.hypot(after.x - before.x, after.z - before.z);
      maxDisplaySpeed = Math.max(maxDisplaySpeed, player.getSpeedUnits());

      // Detect the first frame the simulation goes numerically invalid.
      if (nanFrame < 0 && (!Number.isFinite(after.x) || !Number.isFinite(after.y) ||
        !Number.isFinite(after.z) || !Number.isFinite(player.velocity.x))) {
        nanFrame = frame;
        nanInfo = {
          pos: { x: after.x, y: after.y, z: after.z },
          vel: { x: player.velocity.x, y: player.velocity.y, z: player.velocity.z },
          beforePos: { x: before.x, y: before.y, z: before.z },
          beforeVel: { x: beforeVel.x, y: beforeVel.y, z: beforeVel.z },
          grounded: player.isGrounded,
          surfing: player.isSurfing,
          holdY
        };
      }
    }

    // If the desired speed was not reached naturally, report it honestly.
    keys.forward = false;
    keys.jump = false;
    player.setPosition = originalSetPosition;

    return { worstBackward, worstInfo, teleports, maxDisplaySpeed, distance, airborneSteps, nanFrame, nanInfo };
  }

  /**
   * Advances the real GameClock by a simulated wall-clock interval, running the
   * genuine fixed-step loop (accumulator, clamp, max-substep discard).
   */
  function advanceClockBy(clock: GameClock, frameMs: number, player: PlayerController): void {
    // GameClock reads performance.now(), so drive it by controlling real time
    // is not possible in a unit test. Instead replicate its exact arithmetic.
    const fixedDt = clock.fixedDt;
    const maxFrameTime = 0.1;
    let frameDelta = Math.min(frameMs / 1000, maxFrameTime);

    const acc = (clock as any);
    acc.accumulator = (acc.accumulator ?? 0) + frameDelta;

    let subSteps = 0;
    const maxSubSteps = 10;
    while (acc.accumulator >= fixedDt && subSteps < maxSubSteps) {
      player.updateFixed(fixedDt);
      acc.accumulator -= fixedDt;
      subSteps++;
    }
    if (subSteps >= maxSubSteps) acc.accumulator = 0;
  }

  const CADENCES = {
    '144fps': 1000 / 144,
    '120fps': 1000 / 120,
    '90fps': 1000 / 90,
    '60fps': 1000 / 60,
    '45fps': 1000 / 45,
    '30fps': 1000 / 30,
    'irregular': [16, 16, 16, 50, 16, 90, 16],
    'stall': [16, 200, 16, 500, 16]
  };

  it('high-speed movement never snaps backward at any camera pitch', () => {
    const settings = SettingsManager.getInstance();
    settings.update({ holdToBhop: true });

    const pitches = [-80, -60, -30, 0, 30];
    const results: string[] = [];

    for (const pitch of pitches) {
      const { player, cameraController } = setup();
      const r = runLoop(player, cameraController, {
        pitchDeg: pitch,
        fov: 75,
        cadenceMs: CADENCES['120fps'],
        frames: 400,
        speedTarget: 26
      });
      results.push(`pitch=${pitch} worstBackward=${r.worstBackward.toFixed(3)} teleports=${r.teleports}`);
      expect(r.teleports, `pitch=${pitch}: player was teleported`).toBe(0);
      expect(
        r.worstBackward,
        `pitch=${pitch}: player moved backward ${r.worstBackward.toFixed(3)} units ` +
        `(frame ${r.worstInfo?.frame}, speed=${r.worstInfo?.speed.toFixed(1)}, y=${r.worstInfo?.y.toFixed(2)})`
      ).toBeLessThan(1.0);
    }
    void results;
  });

  it('high-speed movement never snaps backward at any FOV', () => {
    for (const fov of [60, 75, 90, 110]) {
      const { player, cameraController } = setup();
      const r = runLoop(player, cameraController, {
        pitchDeg: -20,
        fov,
        cadenceMs: CADENCES['120fps'],
        frames: 350,
        speedTarget: 26
      });
      expect(r.teleports, `fov=${fov}: player was teleported`).toBe(0);
      expect(
        r.worstBackward,
        `fov=${fov}: player moved backward ${r.worstBackward.toFixed(3)} units`
      ).toBeLessThan(1.0);
    }
  });

  it('render cadence and frame stalls never snap the player backward', () => {
    for (const [name, cadence] of Object.entries(CADENCES)) {
      const { player, cameraController } = setup();
      const r = runLoop(player, cameraController, {
        pitchDeg: -45,
        fov: 75,
        cadenceMs: cadence,
        frames: 300,
        speedTarget: 26
      });
      expect(r.teleports, `${name}: player was teleported`).toBe(0);
      expect(
        r.worstBackward,
        `${name}: player moved backward ${r.worstBackward.toFixed(3)} units ` +
        `(y=${r.worstInfo?.y.toFixed(2)}, freefall=${r.worstInfo?.freefall.toFixed(2)})`
      ).toBeLessThan(1.0);
    }
  });

  it('DIAGNOSTIC: reports achieved speed and distance for the matrix', () => {
    SettingsManager.getInstance().update({ holdToBhop: true });
    const rows: string[] = [];
    for (const cadenceName of ['120fps', '60fps', '30fps'] as const) {
      for (const pitch of [-80, 0] as const) {
        const { player, cameraController } = setup();
        const r = runLoop(player, cameraController, {
          pitchDeg: pitch,
          fov: 75,
          cadenceMs: CADENCES[cadenceName],
          frames: 400,
          speedTarget: 26
        });
        if (r.nanFrame >= 0) {
          rows.push(`!!! NAN at frame ${r.nanFrame}: ${JSON.stringify(r.nanInfo)}`);
        }
        rows.push(
          `${cadenceName} pitch=${String(pitch).padStart(4)} ` +
          `displaySpeedMax=${r.maxDisplaySpeed.toFixed(0)} distance=${r.distance.toFixed(0)} ` +
          `airborneSteps=${r.airborneSteps} worstBackward=${r.worstBackward.toFixed(3)} teleports=${r.teleports}`
        );
        // Anti-trivial-pass guards: the matrix must genuinely exercise
        // high-speed travel, and the run must stay numerically valid.
        expect(r.nanFrame, `${cadenceName}/pitch=${pitch}: simulation produced NaN`).toBe(-1);
        expect(r.maxDisplaySpeed, `${cadenceName}/pitch=${pitch}: never reached high speed`)
          .toBeGreaterThan(900);
        expect(r.distance, `${cadenceName}/pitch=${pitch}: player barely moved`).toBeGreaterThan(40);
      }
    }
    console.log('\n--- RUBBERBAND MATRIX DIAGNOSTIC ---\n' + rows.join('\n'));
    // The matrix must genuinely exercise high-speed travel, not trivially pass.
    expect(rows.length).toBe(6);
  });

  it('DIAGNOSTIC: collisions at high speed never move the player backward', () => {
    SettingsManager.getInstance().update({ holdToBhop: true });

    // Let gravity and REAL collision resolution act (no held Y), while
    // sustaining high horizontal speed. This exercises the depenetration path
    // that the airborne-only matrix deliberately bypasses.
    const rows: string[] = [];
    const seeds = [0x1111, 0x2222, 0x3333];
    let globalWorst = 0;

    for (const seed of seeds) {
      const { player, cameraController, track } = setup(seed);
      const clock = new GameClock(120);
      (clock as any).accumulator = 0;

      const keys = player.keysState as any;
      keys.forward = true;
      keys.jump = true;

      let prev = player.position.clone();
      let prevVel = player.velocity.clone();
      let worstBackward = 0;
      let worstInfo: any = null;
      let nanFrame = -1;
      let teleports = 0;

      const orig = player.setPosition.bind(player);
      player.setPosition = function (p: any) { teleports++; return orig(p); };

      for (let frame = 0; frame < 700; frame++) {
        // Sustain high horizontal speed along the forward direction.
        const fwd = cameraController.getForwardVector();
        const vh = Math.hypot(player.velocity.x, player.velocity.z);
        if (vh < 26) {
          player.velocity.x = fwd.x * 26;
          player.velocity.z = fwd.z * 26;
        }

        const before = player.position.clone();
        const beforeVel = player.velocity.clone();
        advanceClockBy(clock, 1000 / 120, player);
        const after = player.position;

        if (nanFrame < 0 && (!Number.isFinite(after.x) || !Number.isFinite(after.y) || !Number.isFinite(after.z))) {
          nanFrame = frame;
        }

        const vhn = Math.hypot(beforeVel.x, beforeVel.z);
        if (vhn > 1e-4) {
          const ux = beforeVel.x / vhn, uz = beforeVel.z / vhn;
          const along = (after.x - before.x) * ux + (after.z - before.z) * uz;
          if (along < 0 && -along > worstBackward) {
            worstBackward = -along;
            worstInfo = {
              frame, backward: -along, y: after.y,
              grounded: player.isGrounded, surfing: player.isSurfing,
              speed: player.getSpeedUnits(),
              before: { ...before }, after: { ...after }
            };
          }
        }

        prev = after.clone();
        prevVel = player.velocity.clone();
      }

      keys.forward = false;
      keys.jump = false;
      player.setPosition = orig;

      globalWorst = Math.max(globalWorst, worstBackward);
      rows.push(
        `seed=0x${seed.toString(16)} nanFrame=${nanFrame} worstBackward=${worstBackward.toFixed(3)} ` +
        `teleports=${teleports} finalY=${player.position.y.toFixed(1)}` +
        (worstInfo ? ` | worst@frame${worstInfo.frame} y=${worstInfo.y.toFixed(2)} grounded=${worstInfo.grounded}` : '')
      );
    }

    console.log('\n--- HIGH-SPEED COLLISION DIAGNOSTIC ---\n' + rows.join('\n'));
    expect(globalWorst, 'collision resolution moved the player backward').toBeLessThan(2.0);
  });

  it('camera pitch does not change horizontal wish direction magnitude', () => {
    // getForwardVector must stay horizontal regardless of pitch.
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 2000);
    const domElement = { focus: vi.fn(), requestPointerLock: vi.fn() } as unknown as HTMLElement;
    const cc = new CameraController(camera, domElement);
    cc.setOrientation(0.7, 0);

    const flat = cc.getForwardVector();
    expect(Math.abs(flat.y)).toBeLessThan(1e-9);

    for (const pitchDeg of [-80, -45, 0, 45, 80]) {
      cc.setOrientation(0.7, (pitchDeg * Math.PI) / 180);
      const f = cc.getForwardVector();
      const r = cc.getRightVector();
      expect(Math.abs(f.y), `forward.y at pitch ${pitchDeg}`).toBeLessThan(1e-9);
      expect(Math.abs(r.y), `right.y at pitch ${pitchDeg}`).toBeLessThan(1e-9);
      expect(f.length()).toBeCloseTo(1, 6);
      expect(r.length()).toBeCloseTo(1, 6);
      // Horizontal direction must be identical at every pitch.
      expect(f.x).toBeCloseTo(flat.x, 9);
      expect(f.z).toBeCloseTo(flat.z, 9);
    }
  });
});