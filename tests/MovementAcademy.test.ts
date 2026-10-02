import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MovementAcademy } from '../src/lab/MovementAcademy';
import { ACADEMY_LESSON_ORDER, LessonId, createProgress, skipLesson, loadProgress, saveProgress } from '../src/lab/MovementAcademyProgress';
import { buildAcademyLayout, validateAcademyGeometry } from '../src/lab/AcademyLayout';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { CameraController } from '../src/player/CameraController';
import { PlayerController } from '../src/player/PlayerController';
import { RestoreReason } from '../src/player/RestorePolicy';
import { SettingsManager } from '../src/core/Settings';

function setup() {
  const physics = new PhysicsWorld();
  const camera = new CameraController(new THREE.PerspectiveCamera(), {} as HTMLElement);
  const player = new PlayerController(camera, physics);
  const academy = new MovementAcademy(new THREE.Scene(), physics, player, camera, {} as HTMLElement);
  const falls: RestoreReason[] = [];
  player.onFallCallback = reason => { falls.push(reason); academy.reportVoidRestore(); };
  return { physics, camera, player, academy, falls };
}

/** Actual key/yaw input through the same 120Hz controller used in production.
 * No position/velocity writes occur after the authored lesson spawn. */
function drive(ctx: ReturnType<typeof setup>, id: LessonId) {
  const { player, camera, academy, falls } = ctx;
  const base = academy.anchorsForTesting[id].spawn.z - 3;
  let airTick = 0;
  let flightCount = 0;
  let launched = false;
  const startFalls = falls.length;
  const trace: string[] = [];
  for (let tick = 0; tick < 2400; tick++) {
    const z = player.position.z - base;
    const keys = player.keysState;
    keys.forward = true; keys.backward = false; keys.left = false; keys.right = false; keys.jump = false;
    if (player.isGrounded) airTick = 0;
    else airTick++;
    if (airTick === 1) flightCount++;
    const hopping = id === 'BHOP' || id === 'FLOW';
    if (hopping) keys.jump = z >= 9 && (id !== 'FLOW' || z < 60) &&
      (SettingsManager.getInstance().settings.holdToBhop || player.isGrounded ||
        (player.velocity.y < -4 && player.position.y < 1.9));
    else if (id !== 'SURF' && !launched && z >= 17) keys.jump = true;
    if (!player.isGrounded && player.velocity.y > 0) launched = true;

    if (id === 'MOVEMENT') {
      camera.yaw = Math.PI + (tick < 24 ? Math.sin(tick / 4) * 0.03 : 0);
    } else if (id !== 'SURF' && !player.isSurfing && airTick >= 20 && airTick < 44) {
      keys.forward = false;
      const left = flightCount % 2 === 1;
      keys.left = left; keys.right = !left;
      camera.yaw += left ? 0.006 : -0.006;
    } else if (!player.isSurfing) {
      camera.yaw += Math.max(-0.006, Math.min(0.006, Math.PI - camera.yaw));
    }
    const surfEntry = id === 'SURF' ? 23 : 67;
    if ((id === 'SURF' || id === 'FLOW') && z >= surfEntry) {
      keys.forward = false; keys.left = true; keys.jump = false;
      camera.yaw = Math.PI;
      // Leave the face in the forward direction when it ends.
      if (z >= surfEntry + 31) { keys.left = false; keys.forward = true; }
    }
    player.updateFixed(1 / 120);
    if (tick % 60 === 0) trace.push(`${tick}: ${player.position.toArray().map(n => n.toFixed(1))} v=${player.getSpeedUnits().toFixed(0)} surfing=${player.isSurfing} ${academy.getObserver().diagnose()}`);
    academy.update(1 / 120);
    if (academy.getProgress().lessons[id] === 'COMPLETE') return tick;
    if (falls.length > startFalls) break;
  }
  throw new Error(`${id}: pos=${player.position.toArray()} speed=${player.getSpeedUnits()} ${academy.getObserver().diagnose()} falls=${falls.slice(startFalls)} trace=${trace.join('; ')}`);
}

describe('Movement Academy actual physics', () => {
  it('places every spawn and target on gameplay geometry', () => {
    expect(validateAcademyGeometry(buildAcademyLayout())).toEqual([]);
  });
  it.each(ACADEMY_LESSON_ORDER)('completes %s with actual player input', id => {
    const ctx = setup();
    ctx.academy.selectLesson(id);
    const ticks = drive(ctx, id);
    expect(ticks).toBeGreaterThan(30);
    expect(ctx.falls).toEqual([]);
    ctx.academy.dispose();
  });
  it('completes all five in one session', () => {
    const ctx = setup();
    for (const id of ACADEMY_LESSON_ORDER) {
      expect(ctx.academy.getActiveLesson()).toBe(id);
      drive(ctx, id);
    }
    expect(ctx.academy.isComplete()).toBe(true);
    ctx.academy.dispose();
  });
  it('teaches bhop with manual jump timing when hold-to-bhop is disabled', () => {
    const settings = SettingsManager.getInstance().settings;
    const prior = settings.holdToBhop;
    settings.holdToBhop = false;
    const ctx = setup();
    try {
      ctx.academy.selectLesson('BHOP');
      drive(ctx, 'BHOP');
      expect(ctx.falls).toEqual([]);
    } finally {
      settings.holdToBhop = prior;
      ctx.academy.dispose();
    }
  });
  it('never treats walking off an edge as a demonstrated jump', () => {
    const ctx = setup();
    let jumped = false;
    for (let tick = 0; tick < 900 && ctx.falls.length === 0; tick++) {
      ctx.player.keysState.forward = true;
      ctx.player.updateFixed(1 / 120); ctx.academy.update(1 / 120);
      jumped ||= ctx.academy.getObserver().hasJump;
    }
    expect(ctx.falls).toEqual([RestoreReason.NORMAL_VOID]);
    expect(jumped).toBe(false);
    expect(ctx.academy.getProgress().lessons.MOVEMENT).not.toBe('COMPLETE');
    ctx.academy.dispose();
  });
  it.each(['AIR_STRAFE', 'SURF'] as const)('restores a real %s fall then permits retry', id => {
    const ctx = setup();
    ctx.academy.selectLesson(id);
    const spawn = { ...ctx.player.position };
    const base = spawn.z - 3;
    let touchedSurf = false;
    // Miss the air approach; for Surf, enter the REAL face before steering off.
    for (let tick = 0; tick < 900 && ctx.falls.length === 0; tick++) {
      const keys = ctx.player.keysState;
      keys.forward = false; keys.left = false; keys.right = false;
      if (id === 'SURF') {
        touchedSurf ||= ctx.player.isSurfing;
        if (touchedSurf) keys.right = true;
        else if (ctx.player.position.z - base < 23) keys.forward = true;
        else keys.left = true;
      } else keys.right = true;
      ctx.player.updateFixed(1 / 120); ctx.academy.update(1 / 120);
    }
    if (id === 'SURF') expect(touchedSurf).toBe(true);
    expect(ctx.falls).toEqual([RestoreReason.NORMAL_VOID]);
    expect(ctx.player.position.x).toBeCloseTo(spawn.x);
    expect(ctx.player.position.z).toBeCloseTo(spawn.z);
    expect(ctx.academy.getProgress().lessons[id]).not.toBe('COMPLETE');
    expect(ctx.academy.getObserver().hasJump).toBe(false);
    ctx.academy.retryCurrent();
    drive(ctx, id);
    ctx.academy.dispose();
  });
  it('skip advances without awarding completion and progress survives reentry', () => {
    let stored = '';
    const storage = { getItem: () => stored, setItem: (_: string, value: string) => { stored = value; } };
    const progress = skipLesson(createProgress(), 'MOVEMENT').progress;
    expect(progress.active).toBe('AIR_STRAFE');
    expect(progress.lessons.MOVEMENT).toBe('SKIPPED');
    saveProgress(progress, storage);
    expect(loadProgress(storage)).toEqual(progress);
    const ctx = setup();
    ctx.academy.skipCurrent();
    expect(ctx.academy.getActiveLesson()).toBe('AIR_STRAFE');
    ctx.academy.selectLesson('MOVEMENT');
    drive(ctx, 'MOVEMENT');
    expect(ctx.academy.getProgress().lessons.MOVEMENT).toBe('COMPLETE');
    ctx.academy.dispose();
  });
});
