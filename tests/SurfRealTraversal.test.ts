/**
 * REAL SURF TRAVERSAL ACCEPTANCE (runtime integration)
 *
 * These tests drive the ACTUAL PlayerController.updateFixed at the frozen
 * 120 Hz gameplay timestep against REAL PhysicsWorld.buildFromRoute colliders
 * built from generated SURF courses. Movement is produced only by legal input
 * state (WASD keys exposed by the controller) plus legal camera-yaw steering.
 * Nothing calls setPosition() or rewrites velocity per step; the sole exception
 * is a ONE-SHOT initial launch velocity for focused transfer experiments, which
 * the brief explicitly permits.
 *
 * Geometry-only sweeps in SurfMode.test.ts are NOT player traversals. This file
 * is the runtime integration evidence.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { PlayerController } from '../src/player/PlayerController';
import { CameraController } from '../src/player/CameraController';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { RibbonSurfaceCollider } from '../src/physics/Collider';
import { SurfCourseGenerator } from '../src/generation/SurfCourseGenerator';
import { SurfCourseValidator, ballisticTransferCheck } from '../src/generation/SurfCourseValidator';
import { TrackGenerator } from '../src/generation/TrackGenerator';
import {
  RouteConnectivityValidator,
  getNodeEntryAnchor,
  getNodeExitAnchor
} from '../src/generation/RouteConnectivityValidator';
import { SurfState } from '../src/player/SurfState';
import { TrackAnalysis, AnalysisSection, SectionTheme } from '../src/audio/AudioFeatures';
import { RouteNode } from '../src/generation/GenerationTypes';

const FIXED_DT = 1 / 120;

function mock(seed: number, duration: number, bpm: number, themes: SectionTheme[]): TrackAnalysis {
  const count = themes.length, step = duration / count;
  const sections: AnalysisSection[] = themes.map((t, i) => ({
    index: i,
    start: i * step,
    end: (i + 1) * step,
    duration: step,
    intensity: t === 'DROP' ? 0.95 : t === 'BREATH' ? 0.25 : 0.6,
    rhythmicDensity: 0.7,
    brightness: 0.6,
    theme: t
  }));
  return {
    filename: `s_${seed}`,
    duration,
    bpm,
    bpmConfidence: 0.85,
    globalEnergy: 0.65,
    frames: [],
    onsets: [],
    sections,
    waveform: new Float32Array(512),
    seed,
    visualAccent: { name: 'x', hex: '#00f0ff', rgb: [0, 240, 255] }
  };
}

const ENERGETIC: SectionTheme[] = [
  'FLOW', 'BUILDUP', 'DROP', 'SPEED', 'DROP', 'PRECISION', 'DESCENT', 'ASCENT', 'DROP', 'FLOW'
];

function setup() {
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
  const domElement = { focus: vi.fn(), requestPointerLock: vi.fn() } as unknown as HTMLElement;
  const cameraController = new CameraController(camera, domElement);
  const physics = new PhysicsWorld();
  const player = new PlayerController(cameraController, physics);
  return { camera, cameraController, physics, player };
}

function keys(player: PlayerController): Record<string, boolean> {
  return (player as unknown as { keys: Record<string, boolean> }).keys;
}

function setYaw(player: PlayerController, yaw: number): void {
  player.cameraController.setOrientation(yaw);
}

function yawTo(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

function spawnOnPlatform(player: PlayerController, node: RouteNode, forwardYaw: number): void {
  const safeMargin = Math.min(2.5, node.dimensions.z * 0.25);
  const backDist = Math.max(0, node.dimensions.z * 0.5 - safeMargin);
  player.setPosition({
    x: node.position.x - Math.sin(node.yaw) * backDist,
    y: node.position.y + node.dimensions.y * 0.5 + 0.05,
    z: node.position.z - Math.cos(node.yaw) * backDist
  });
  setYaw(player, forwardYaw);
  player.authoritativeKillY = (player as unknown as { physics: PhysicsWorld }).physics.getVoidDeathY();
}

interface CourseResult {
  ticks: number;
  finished: boolean;
  maxSurfTime: number;
  surfTicks: number;
  reachedNodeIndex: number;
  died: boolean;
  deathReason?: string;
  maxSpeed: number;
  contactTicks: number;
}

function runCourse(
  player: PlayerController,
  route: RouteNode[],
  opts: { maxTicks: number; holdJump?: boolean }
): CourseResult {
  const k = keys(player);
  let goal = 1;
  let died = false;
  let deathReason: string | undefined;
  player.onFallCallback = (reason) => { died = true; deathReason = reason; };
  let surfTicks = 0, contactTicks = 0, maxSurfTime = 0, maxSpeed = 0;
  let finished = false;
  let reached = 0;
  let t = 0;
  for (let i = 0; i < opts.maxTicks; i++) {
    while (goal < route.length - 1) {
      const entry = getNodeEntryAnchor(route[goal]).position;
      const dx = entry.x - player.position.x, dz = entry.z - player.position.z;
      const tangent = route[goal].ribbon?.stations[0].tangent;
      const ahead = dx * (tangent?.x ?? Math.sin(route[goal].yaw)) + dz * (tangent?.z ?? Math.cos(route[goal].yaw));
      if (ahead > 1.0) break;
      goal++;
    }
    const target = getNodeEntryAnchor(route[Math.min(goal + 3, route.length - 1)]).position;
    setYaw(player, yawTo(player.position, target));
    k.forward = !player.isSurfing;
    k.backward = false;
    k.left = false;
    k.right = false;
    if (player.isSurfing) {
      const right = player.cameraController.getRightVector();
      const side = player.surfNormal.dot(right);
      k.left = side > 0.05;
      k.right = side < -0.05;
    }
    k.jump = !!opts.holdJump;

    player.updateFixed(FIXED_DT);
    t += FIXED_DT;
    if (player.surfState.isSurfing || player.isSurfing) surfTicks++;
    if (player.isSurfing || player.isGrounded) contactTicks++;
    if (player.surfState.timeSurfing > maxSurfTime) maxSurfTime = player.surfState.timeSurfing;
    const sp = Math.hypot(player.velocity.x, player.velocity.z);
    if (sp > maxSpeed) maxSpeed = sp;
    if (goal > reached) reached = goal;
    if (died) break;
    if (goal >= route.length - 1) {
      const fin = route[route.length - 1];
      const d = Math.hypot(player.position.x - fin.position.x, player.position.z - fin.position.z);
      if (d < Math.max(6, fin.dimensions.z * 0.5)) { finished = true; break; }
    }
    if (t > 400) break;
  }
  return { ticks: t / FIXED_DT, finished, maxSurfTime, surfTicks, reachedNodeIndex: reached, died, deathReason, maxSpeed, contactTicks };
}

describe('SURF real-integrator traversal', () => {
  it('platform -> surf entry: legal W input reaches a real surf contact without void death', () => {
    const track = SurfCourseGenerator.generate(mock(0x12345, 180, 128, ENERGETIC), 'SURF');
    const { physics, player } = setup();
    physics.buildFromRoute(track.route);
    spawnOnPlatform(player, track.route[0], track.route[0].yaw);

    const k = keys(player);
    k.forward = true;
    let becameSurfing = false, maxSpeed = 0, died = false;
    player.onFallCallback = () => { died = true; };
    for (let i = 0; i < 1200; i++) {
      const surfEntry = track.route.find(n => n.isSurf);
      if (surfEntry) setYaw(player, yawTo(player.position, getNodeEntryAnchor(surfEntry).position));
      player.updateFixed(FIXED_DT);
      if (player.surfState.isSurfing || player.isSurfing) becameSurfing = true;
      maxSpeed = Math.max(maxSpeed, Math.hypot(player.velocity.x, player.velocity.z));
      if (died) break;
    }
    console.log('[SURF-ENTRY]', JSON.stringify({ becameSurfing, maxSpeed: Number(maxSpeed.toFixed(2)), died }));
    expect(died).toBe(false);
    expect(becameSurfing).toBe(true);
    expect(maxSpeed).toBeGreaterThan(0);
  });

  it('intended AIR transfers are caught by the real integrator at envelope speeds', () => {
    const track = SurfCourseGenerator.generate(mock(0x12345, 180, 128, ENERGETIC), 'SURF');
    const airTargets: Array<{ launch: RouteNode; target: RouteNode }> = [];
    for (let i = 0; i < track.route.length - 1; i++) {
      if (track.route[i + 1].surfTransition === 'AIR') {
        airTargets.push({ launch: track.route[i], target: track.route[i + 1] });
      }
    }
    expect(airTargets.length).toBeGreaterThan(0);

    const results: Array<{ speed: number; caught: number; total: number }> = [];
    for (const speed of [12, 20, 30]) {
      let caught = 0;
      for (const { launch, target } of airTargets) {
        const { physics, player } = setup();
        physics.buildFromRoute(track.route);
        const chain = track.route.filter(n => n.ribbonId === target.ribbonId);
        const check = ballisticTransferCheck(launch, target, speed, chain);
        expect(check.trajectory).toBeTruthy();
        const arc = check.trajectory!;
        // The validator models the bottom sphere centre; the player stores feet.
        player.setPosition({ ...arc.start, y: arc.start.y - player.config.playerRadius });
        player.velocity.set(arc.velocity.x, arc.velocity.y, arc.velocity.z);
        setYaw(player, Math.atan2(-arc.velocity.x, -arc.velocity.z));
        const catchPoint = new THREE.Vector3(arc.start.x, arc.start.y, arc.start.z)
          .addScaledVector(new THREE.Vector3(arc.velocity.x, arc.velocity.y, arc.velocity.z), arc.duration);
        catchPoint.y -= player.config.gravity * arc.duration * arc.duration * 0.5;
        player.isGrounded = false;
        player.isSurfing = false;
        player.surfState.reset();
        player.authoritativeKillY = physics.getVoidDeathY();

        const k = keys(player);
        let hitTarget = false, died = false;
        player.onFallCallback = () => { died = true; };
        for (let i = 0; i < 900 && !died; i++) {
          k.forward = false;
          player.updateFixed(FIXED_DT);
          if (player.isSurfing && i * FIXED_DT > Math.max(0.02, arc.duration - 0.1)) {
            const d = Math.hypot(player.position.x - catchPoint.x, player.position.z - catchPoint.z);
            if (d < 3) { hitTarget = true; break; }
          }
        }
        if (hitTarget) caught++;
      }
      results.push({ speed, caught, total: airTargets.length });
    }
    console.log('[SURF-AIR-TRANSFER]', JSON.stringify(results));
    for (const r of results) expect(r.caught).toBe(r.total);
  });

  it('records a full-course driver attempt without treating it as a finish proof', () => {
    const track = SurfCourseGenerator.generate(mock(0x12345, 180, 128, ENERGETIC), 'SURF');
    const { physics, player } = setup();
    physics.buildFromRoute(track.route);
    spawnOnPlatform(player, track.route[0], track.route[0].yaw);
    const result = runCourse(player, track.route, { maxTicks: 120 * 240 });
    console.log('[SURF-FULLCOURSE]', JSON.stringify({
      ...result, routeNodes: track.route.length, checkpoints: track.checkpoints.length
    }));
    if (!result.finished) {
      console.log('[SURF-FULLCOURSE-NOTE] controller did not complete; not proof of unreachable geometry');
    }
    expect(result.surfTicks).toBeGreaterThan(0);
  });

  it('every checkpoint supports a legal runway takeoff into surf', () => {
    const track = SurfCourseGenerator.generate(mock(0x12345, 180, 128, ENERGETIC), 'SURF');
    for (const checkpoint of track.checkpoints) {
      const index = track.route.findIndex(n => n.id === checkpoint.routeNodeId);
      const node = track.route[index];
      const nextSurf = track.route.slice(index + 1).find(n => n.ribbon)!;
      const { physics, player } = setup();
      physics.buildFromRoute(track.route);
      spawnOnPlatform(player, node, yawTo(node.position, getNodeEntryAnchor(nextSurf).position));
      let contact = false;
      let died = false;
      player.onFallCallback = () => { died = true; };
      keys(player).forward = true;
      for (let tick = 0; tick < 1200 && !contact && !died; tick++) {
        player.updateFixed(FIXED_DT);
        contact = player.isSurfing;
      }
      expect(contact, `checkpoint ${checkpoint.id}`).toBe(true);
      expect(died).toBe(false);
    }
  });

  it('final release reaches the finite finish deck with the real integrator', () => {
    const track = SurfCourseGenerator.generate(mock(0x12345, 180, 128, ENERGETIC), 'SURF');
    const launch = track.route[track.route.length - 2];
    const finish = track.route[track.route.length - 1];
    const { physics, player } = setup();
    physics.buildFromRoute(track.route);
    const exit = getNodeExitAnchor(launch).position;
    const station = launch.ribbon!.stations[1];
    player.setPosition({ x: exit.x + station.normal.x * 0.5,
      y: exit.y + station.normal.y * 0.5 - 0.5, z: exit.z + station.normal.z * 0.5 });
    const speed = 20 / Math.hypot(station.tangent.x, station.tangent.z);
    player.velocity.set(station.tangent.x * speed, station.tangent.y * speed, station.tangent.z * speed);
    player.authoritativeKillY = physics.getVoidDeathY();
    let landed = false;
    for (let tick = 0; tick < 480 && !landed; tick++) {
      player.updateFixed(FIXED_DT);
      landed = player.isGrounded && Math.hypot(player.position.x - finish.position.x,
        player.position.z - finish.position.z) < finish.dimensions.z / 2;
    }
    expect(landed).toBe(true);
  });
});

describe('SURF bank angles vs real isSurfing classification', () => {
  it('every ribbon top-face normal classifies as SURF_SURFACE (never walkable)', () => {
    const track = SurfCourseGenerator.generate(mock(0x12345, 180, 128, ENERGETIC), 'SURF');
    let checked = 0, steepEnoughWithoutFlag = 0, maxNy = 0;
    for (const node of track.route) {
      if (!node.ribbon) continue;
      for (const s of node.ribbon.stations) {
        const nv = new THREE.Vector3(s.normal.x, s.normal.y, s.normal.z).normalize();
        expect(SurfState.classifySurface(nv, true)).toBe('SURF_SURFACE');
        maxNy = Math.max(maxNy, nv.y);
        if (nv.y < 0.70) steepEnoughWithoutFlag++;
        checked++;
      }
    }
    console.log('[SURF-BANK]', JSON.stringify({ checked, steepEnoughWithoutFlag, maxNy }));
    expect(checked).toBeGreaterThan(0);
    expect(steepEnoughWithoutFlag).toBeGreaterThan(0);
    // Explicit surf stays slick across neutral crossovers and the exit.
  });
});

describe('SURF transfer authoring diagnosis (maxgap)', () => {
  it('reports surviving AIR transfers and observed max gap per seed', () => {
    const rows: Array<{ seed: number; airs: number; nodes: number; maxgap: number; valid: boolean }> = [];
    for (const seed of [0x12345, 0xABCDE, 0x98765, 42, 999]) {
      const analysis = mock(seed, 180, 128, ENERGETIC);
      const track = TrackGenerator.generate(analysis, 'SURF');
      const conn = RouteConnectivityValidator.validate(track);
      const airs = track.route.filter(n => n.surfTransition === 'AIR').length;
      rows.push({
        seed, airs, nodes: track.route.length,
        maxgap: Number(conn.maxObservedHorizontalGap.toFixed(2)),
        valid: SurfCourseValidator.validate(track).isValid
      });
    }
    console.log('[SURF-MAXGAP]', JSON.stringify(rows));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.valid).toBe(true);
  });
});

describe('SURF backend collision cost on generated courses', () => {
  it('reports collider/triangle counts and resolve timings (no fragile limits)', () => {
    const report: Array<{
      seed: number; nodes: number; colliders: number; ribbonColliders: number;
      triangles: number; msPer1000: number;
    }> = [];
    for (const seed of [0x12345, 0xABCDE, 42]) {
      const track = SurfCourseGenerator.generate(mock(seed, 180, 128, ENERGETIC), 'SURF');
      const physics = new PhysicsWorld();
      physics.buildFromRoute(track.route);
      const ribbons = physics.colliders.filter(c => c instanceof RibbonSurfaceCollider) as Array<
        RibbonSurfaceCollider & { triangles: unknown[] }
      >;
      const triangles = ribbons.reduce((sum, c) => sum + (c.triangles ? c.triangles.length : 0), 0);
      const pos = new THREE.Vector3();
      const contactNodes = track.route.filter(n => n.ribbon);
      const start = performance.now();
      const N = 1000;
      for (let i = 0; i < N; i++) {
        const node = contactNodes[i % contactNodes.length];
        const station = node.ribbon?.stations[0];
        const point = station?.center ?? node.position;
        const normal = station?.normal ?? { x: 0, y: 1, z: 0 };
        pos.set(point.x + normal.x * 0.4, point.y + normal.y * 0.4 - 0.5, point.z + normal.z * 0.4);
        physics.resolveCapsule(pos, 0.5, 1.8);
      }
      const ms = performance.now() - start;
      report.push({
        seed, nodes: track.route.length, colliders: physics.colliders.length,
        ribbonColliders: ribbons.length, triangles, msPer1000: Number(ms.toFixed(2))
      });
    }
    console.log('[SURF-COLLISION-COST]', JSON.stringify(report));
    expect(report.every(r => r.triangles > 0)).toBe(true);
  });
});
