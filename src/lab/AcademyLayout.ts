/**
 * MOVEMENT ACADEMY — authored geometry + anchors.
 *
 * DOM-free, THREE-only for the surf normal helper, and deterministic: it
 * returns plain RouteNode data so the session and the tests consume EXACTLY
 * the same layout (no floating targets, no test/production drift).
 *
 * Geometry is authored against the FROZEN PlayerController constants
 * (14 m/s run, 8.8 m/s jump, 24 m/s^2 gravity, speedUnitScale 40):
 *   - a flat jump covers ~10 m with ~0.73 s airtime.
 *   - flat pads are 2 m thick with their TOP surface at y=1.
 *   - every anchor spawn has its feet just above a real pad top.
 *
 * All five lessons sit in a far-negative Z band, so the Academy never overlaps
 * the Lab and its void envelope stays close (a missed jump restores quickly).
 */

import * as THREE from 'three';
import { RouteNode, RouteNodeType } from '../generation/GenerationTypes';
import { LessonAnchor, LessonId } from './MovementAcademyProgress';

export interface AcademyDef {
  name: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  length: number;
  surf?: boolean;
  roll?: number;
  pitch?: number;
  yaw?: number;
  /** Non-colliding authored marking (lane stripe / arrow / edge ribbon). */
  marking?: boolean;
  color?: number;
}

export interface AcademyLayout {
  nodes: RouteNode[];
  defs: AcademyDef[];
  anchors: Record<LessonId, LessonAnchor>;
}

const LESSON_Z: Record<LessonId, number> = {
  MOVEMENT: -10000,
  AIR_STRAFE: -10200,
  BHOP: -10400,
  SURF: -10600,
  FLOW: -10800
};

export function buildAcademyLayout(): AcademyLayout {
  const defs: AcademyDef[] = [];
  const nodes: RouteNode[] = [];
  const anchors = {} as Record<LessonId, LessonAnchor>;
  const box = (name: string, x: number, y: number, z: number, width: number,
    length: number, surf = false, roll = 0, pitch = 0) => {
    defs.push({ name, x, y, z, width, height: 2, length, surf, roll, pitch });
    const normal = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(pitch, 0, roll, 'YXZ'));
    nodes.push({ id: 7000 + nodes.length, time: 0, position: { x, y, z },
      dimensions: { x: width, y: 2, z: length }, yaw: 0, pitch, roll,
      type: surf ? RouteNodeType.SURF_RAMP : RouteNodeType.RUNWAY,
      intensity: 0.4, sectionIndex: 0, arcLength: nodes.length * 10,
      isSurf: surf, isBoost: false,
      ...(surf ? { surfNormal: { x: normal.x, y: normal.y, z: normal.z } } : {}) });
  };
  const mark = (name: string, x: number, y: number, z: number, width: number,
    length: number, color = 0x00f0ff, roll = 0) => {
    defs.push({ name, x, y, z, width, height: 0.04, length, color, marking: true, roll });
  };
  const anchor = (id: LessonId, end: number, y = 0) => {
    anchors[id] = { id, spawn: { x: 0, y: 1.05, z: LESSON_Z[id] + 3 },
      spawnYaw: Math.PI, goalMinZ: LESSON_Z[id] + end, goalY: y - 1,
      goalX: 0, goalRadius: 22, minSpeedUnits: 80 };
    mark(`${id}_TARGET`, 0, y + 1.04, LESSON_Z[id] + end, 18, 1.2);
    for (const x of [-23, 23]) {
      defs.push({ name: `${id}_SIGNAL_${x}`, x, y: y + 2.5,
        z: LESSON_Z[id] + end, width: 0.25, height: 3, length: 0.25,
        marking: true, color: 0x00f0ff });
    }
    // Floor chevrons give forward direction without text covering the route.
    for (const sign of [-1, 1]) {
      defs.push({ name: `${id}_DIRECTION_${sign}`, x: sign * 0.5, y: 1.04,
        z: LESSON_Z[id] + 9, width: 0.14, height: 0.04, length: 1.6,
        pitch: 0, yaw: -sign * 0.65, roll: 0, marking: true, color: 0xffb703 });
    }
  };

  let z = LESSON_Z.MOVEMENT;
  box('M_APPROACH', 0, 0, z + 10, 20, 20);
  box('M_LANDING', 0, 0, z + 33, 28, 20); // forgiving 3m gap
  mark('M_TAKEOFF', 0, 1.04, z + 18, 16, 0.5, 0xffb703);
  anchor('MOVEMENT', 32);

  z = LESSON_Z.AIR_STRAFE;
  box('A_APPROACH', 0, 0, z + 10, 20, 20);
  box('A_LANDING', 0, 0, z + 38, 42, 28); // 4m gap + wide curved landing
  mark('A_TAKEOFF', 0, 1.04, z + 18, 16, 0.5, 0xffb703);
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    mark(`A_ARC_${i}`, 7 * t * t, 1.1 + Math.sin(t * Math.PI) * 1.4,
      z + 18 + 10 * t, 0.3, 0.6);
  }
  anchor('AIR_STRAFE', 26);

  z = LESSON_Z.BHOP;
  for (let i = 0; i < 5; i++) {
    box(`B_PAD_${i}`, 0, 0, z + 6 + i * 14, 42, i === 4 ? 28 : 12);
    mark(`B_LAND_${i}`, 0, 1.04, z + 6 + i * 14, 24, 0.5);
  }
  anchor('BHOP', 59);

  const surfLine = (prefix: string, base: number, start: number) => {
    // Positive X is the player's LEFT when looking +Z. The +60deg bank
    // exposes its bright top face toward the approach lane at x=0.
    box(`${prefix}_SURF`, 2, -1.5, base + start + 15, 12, 30, true, Math.PI / 3, -0.03);
    box(`${prefix}_CATCH`, 0, -5, base + start + 45, 44, 34);
    mark(`${prefix}_ENTRY`, 0, 1.04, base + start - 2, 16, 0.5, 0xffb703);
  };
  z = LESSON_Z.SURF;
  box('S_APPROACH', 0, 0, z + 12, 20, 24);
  surfLine('S', z, 24);
  anchor('SURF', 61, -5);

  z = LESSON_Z.FLOW;
  for (let i = 0; i < 5; i++) {
    box(`F_PAD_${i}`, 0, 0, z + 6 + i * 14, 42, 12);
    mark(`F_SIGNAL_${i}`, 0, 1.04, z + 6 + i * 14, 20, 0.5);
  }
  surfLine('F', z, 68);
  anchor('FLOW', 112, -5);
  return { nodes, defs, anchors };
}

/**
 * Geometry self-check used by tests: every anchor must spawn above a real
 * collider and the goal band must land on a real pad. Returns human-readable
 * problems (empty = the authored course is physically sound).
 */
export function validateAcademyGeometry(layout: AcademyLayout = buildAcademyLayout()): string[] {
  const issues: string[] = [];
  const contains = (n: { position: { x: number; y: number; z: number }; dimensions: { x: number; y: number; z: number } }, x: number, z: number) =>
    Math.abs(x - n.position.x) <= n.dimensions.x * 0.5 + 0.001 &&
    Math.abs(z - n.position.z) <= n.dimensions.z * 0.5 + 0.001;

  for (const id of Object.keys(layout.anchors) as LessonId[]) {
    const a = layout.anchors[id];
    const spawnPad = layout.nodes.find((n) =>
      contains(n, a.spawn.x, a.spawn.z) && n.position.y <= a.spawn.y + 1 && n.position.y > a.spawn.y - 6
    );
    if (!spawnPad) issues.push(`${id}: spawn (${a.spawn.x},${a.spawn.y},${a.spawn.z}) is not above a pad`);

    const goalPad = layout.nodes.find((n) => {
      const halfZ = n.dimensions.z * 0.5;
      const lo = n.position.z - halfZ;
      const hi = n.position.z + halfZ;
      return a.goalMinZ >= lo && a.goalMinZ <= hi;
    });
    if (!goalPad) issues.push(`${id}: goalMinZ ${a.goalMinZ} does not land on a pad`);

    if (a.spawnYaw === 0 && !a.reversed) issues.push(`${id}: spawnYaw 0 faces -Z on a +Z forward course`);
  }

  if (!layout.nodes.some((n) => n.isSurf && n.position.z >= -10620 && n.position.z <= -10560)) {
    issues.push('SURF: no reachable surf ramp on the route');
  }
  if (!layout.nodes.some((n) => n.isSurf && n.position.z >= -10720 && n.position.z <= -10680)) {
    issues.push('FLOW: no reachable surf ramp on the route');
  }
  if (layout.nodes.length === 0) issues.push('layout produced no colliders');
  return issues;
}
