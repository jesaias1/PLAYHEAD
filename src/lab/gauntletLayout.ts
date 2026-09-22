/**
 * MOVEMENT LAB — OBSTACLE GAUNTLET LAYOUT
 *
 * A compact, fully authored, deterministic obstacle test course. It exists so
 * every obstacle type and phrase can be validated in 1–3 minutes without
 * hunting for them in procedural levels.
 *
 * Design constraints honoured here:
 *  - Uses the REAL production obstacle factories (RouteChallengeGenerator lab
 *    API) and the real RouteNode/collider/motion data model. Nothing is a
 *    fake visual-only copy.
 *  - No procedural RNG: one fixed seed, authored host platforms and an
 *    authored station order, so the layout is identical every run.
 *  - WALL THREAD stations are built with the production SPEED-AWARE envelope at
 *    a deliberately high design speed, and are preceded by a long speed run-up
 *    so they can be tested at normal / high / very high speed.
 *  - Does NOT touch procedural route generation, obstacle density, or spines.
 *
 * This module is intentionally free of THREE/DOM so it can be unit-tested.
 */

import {
  ObstaclePhraseKind,
  RouteNode,
  RouteNodeType,
  RouteObstacleType,
  Vector3Like
} from '../generation/GenerationTypes';
import { RouteChallengeGenerator } from '../generation/RouteChallengeGenerator';
import { SeededRandom } from '../generation/SeededRandom';

export const GAUNTLET_SEED = 0x0ba57ac1;

/**
 * Design speed used for the Lab's wall threads. ~2000 u/s, i.e. the high end of
 * the human-reported testing range, so the Lab demonstrates production
 * high-speed tuning rather than a soft hand-tuned variant.
 */
export const GAUNTLET_DESIGN_SPEED = 50;

const START_Z = 2260;
const PLATFORM_Y = 0;
const PLATFORM_HEIGHT = 2;
const PLATFORM_TOP_Y = PLATFORM_Y + PLATFORM_HEIGHT * 0.5;
const PLATFORM_WIDTH = 18;
const THREAD_WIDTH = 20;
const DEFAULT_LENGTH = 26;
const THREAD_X2_LENGTH = 64;
const THREAD_X3_LENGTH = 76;
const RUNUP_LENGTH = 72;
const GAP = 9;
const SPAWN_CLEARANCE = 4;

/** A single authored obstacle test station. */
export interface GauntletStation {
  index: number;
  label: string;
  kind: 'START' | 'RUNUP' | 'SINGLE' | 'PHRASE' | 'SPINE' | 'FINISH';
  /** Single obstacle type for SINGLE / SPINE stations. */
  obstacle?: RouteObstacleType;
  /** Phrase to build for PHRASE stations (and the metadata kind for singles). */
  phrase?: ObstaclePhraseKind;
  length: number;
  width: number;
}

export interface GauntletCheckpoint {
  position: Vector3Like;
  yaw: number;
  label: string;
}

/** Compact side signage. Pure data so tests can verify it clears the route. */
export interface GauntletSignage {
  label: string;
  position: Vector3Like;
  yaw: number;
  width: number;
  height: number;
}

export interface GauntletLayout {
  route: RouteNode[];
  obstacles: RouteNode[];
  signalSpines: RouteNode[];
  stations: GauntletStation[];
  checkpoints: GauntletCheckpoint[];
  signage: GauntletSignage[];
  startZ: number;
  endZ: number;
}

/**
 * Authored station order. Every major obstacle type and every production
 * phrase appears exactly once (BEAM_HOP covers the single scan bar and the
 * single sweep beam, which share a builder family).
 */
export const GAUNTLET_STATIONS: GauntletStation[] = [
  { index: 0, label: 'START // GAUNTLET', kind: 'START', length: 24, width: 20 },
  { index: 1, label: 'SIGNAL SHUTTER', kind: 'SINGLE', obstacle: 'SIGNAL_SHUTTER', phrase: 'SHUTTER_APPROACH', length: DEFAULT_LENGTH, width: PLATFORM_WIDTH },
  { index: 2, label: 'SCAN BAR', kind: 'SINGLE', obstacle: 'SCAN_BAR', phrase: 'BEAM_HOP', length: DEFAULT_LENGTH, width: PLATFORM_WIDTH },
  { index: 3, label: 'PHASE BLOCK', kind: 'SINGLE', obstacle: 'PHASE_BLOCK', phrase: 'PHASE_DODGE', length: DEFAULT_LENGTH, width: PLATFORM_WIDTH },
  { index: 4, label: 'SPLIT GATE', kind: 'SINGLE', obstacle: 'SPLIT_GATE', phrase: 'GATE_COMMIT', length: DEFAULT_LENGTH, width: PLATFORM_WIDTH },
  { index: 5, label: 'SWEEP BEAM', kind: 'SINGLE', obstacle: 'SWEEP_BEAM', phrase: 'BEAM_HOP', length: DEFAULT_LENGTH, width: PLATFORM_WIDTH },
  // Long straight to build speed before the threading section.
  { index: 6, label: 'SPEED RUN-UP', kind: 'RUNUP', length: RUNUP_LENGTH, width: THREAD_WIDTH },
  { index: 7, label: 'WALL THREAD x2', kind: 'PHRASE', phrase: 'LEFT_RIGHT_THREAD', length: THREAD_X2_LENGTH, width: THREAD_WIDTH },
  { index: 8, label: 'WALL THREAD x3', kind: 'PHRASE', phrase: 'THREE_WALL_THREAD', length: THREAD_X3_LENGTH, width: THREAD_WIDTH },
  { index: 9, label: 'JUMP + STRAFE', kind: 'PHRASE', phrase: 'JUMP_THEN_STRAFE', length: DEFAULT_LENGTH, width: PLATFORM_WIDTH },
  { index: 10, label: 'FALSE CENTER', kind: 'PHRASE', phrase: 'FALSE_CENTER', length: DEFAULT_LENGTH, width: PLATFORM_WIDTH },
  { index: 11, label: 'CUTOUT SLALOM', kind: 'PHRASE', phrase: 'CUTOUT_SLALOM', length: DEFAULT_LENGTH, width: PLATFORM_WIDTH },
  { index: 12, label: 'SHUTTER APPROACH', kind: 'PHRASE', phrase: 'SHUTTER_APPROACH', length: DEFAULT_LENGTH, width: PLATFORM_WIDTH },
  { index: 13, label: 'OBSTACLE + SPINE', kind: 'SPINE', obstacle: 'SPLIT_GATE', phrase: 'GATE_COMMIT', length: 30, width: PLATFORM_WIDTH },
  { index: 14, label: 'FINISH', kind: 'FINISH', length: 26, width: PLATFORM_WIDTH }
];

/** Formats a station banner, e.g. "[01] SIGNAL SHUTTER". */
export function gauntletStationTitle(station: GauntletStation): string {
  if (station.kind === 'START' || station.kind === 'FINISH') return station.label;
  return `[${station.index.toString().padStart(2, '0')}] ${station.label}`;
}

/**
 * Builds the authored gauntlet. Deterministic for a fixed seed; the same
 * obstacle layout is produced on every run.
 */
export function buildGauntletLayout(): GauntletLayout {
  const rng = new SeededRandom(GAUNTLET_SEED);
  let nextId = 50000;
  let nextPhraseId = 60000;
  const nextObstacleId = () => nextId++;

  const route: RouteNode[] = [];
  const obstacles: RouteNode[] = [];
  const signalSpines: RouteNode[] = [];
  const checkpoints: GauntletCheckpoint[] = [];
  const signage: GauntletSignage[] = [];

  let cursor = START_Z;
  let spineHostIndex = -1;

  for (const station of GAUNTLET_STATIONS) {
    const centerZ = cursor + station.length * 0.5;
    const isFinish = station.kind === 'FINISH';

    const host: RouteNode = {
      id: nextId++,
      time: 0,
      position: { x: 0, y: PLATFORM_Y, z: centerZ },
      dimensions: { x: station.width, y: PLATFORM_HEIGHT, z: station.length },
      yaw: 0,
      pitch: 0,
      roll: 0,
      type: isFinish ? RouteNodeType.FINISH : RouteNodeType.RUNWAY,
      intensity: 0.7,
      sectionIndex: 0,
      arcLength: centerZ - START_Z,
      isSurf: false,
      isBoost: false
    };
    route.push(host);

    if (station.kind !== 'START' && station.kind !== 'FINISH') {
      checkpoints.push({
        position: { x: 0, y: PLATFORM_TOP_Y + 0.6, z: centerZ - station.length * 0.5 + SPAWN_CLEARANCE },
        yaw: Math.PI,
        label: gauntletStationTitle(station)
      });
    }

    // Compact side signage: raised and offset beside the platform so the
    // upcoming obstacle geometry stays visible on approach.
    signage.push({
      label: gauntletStationTitle(station),
      position: {
        x: -(station.width * 0.5 + 5.0),
        y: 6.5,
        z: centerZ - station.length * 0.5 + 2.0
      },
      yaw: Math.PI,
      width: 6.0,
      height: 1.5
    });

    if ((station.kind === 'SINGLE' || station.kind === 'SPINE') && station.obstacle && station.phrase) {
      if (station.kind === 'SPINE') spineHostIndex = route.length - 1;
      const element = RouteChallengeGenerator.buildLabObstacle(
        station.obstacle,
        host,
        rng,
        nextObstacleId,
        station.phrase
      );
      if (element) obstacles.push(element);
    } else if (station.kind === 'PHRASE' && station.phrase) {
      const elements = RouteChallengeGenerator.buildLabPhrase(
        station.phrase,
        host,
        rng,
        nextObstacleId,
        nextPhraseId++,
        GAUNTLET_DESIGN_SPEED
      );
      if (elements) obstacles.push(...elements);
    }

    cursor = centerZ + station.length * 0.5 + GAP;
  }

  // Skinny Signal Spine recovery example (obstacle + recovery line). The spine
  // bridges the gap between the SPINE station and the finish platform using the
  // same RouteNode shape / collider path as production spines, at a
  // deliberately narrow profile.
  const spineStation = GAUNTLET_STATIONS.find(s => s.kind === 'SPINE');
  if (spineStation && spineHostIndex >= 0) {
    const a = route[spineHostIndex];
    const b = route[spineHostIndex + 1];
    if (a && b) {
      const overlap = 1.2;
      const exitZ = a.position.z + a.dimensions.z * 0.5;
      const entryZ = b.position.z - b.dimensions.z * 0.5;
      const span = (entryZ - exitZ) + overlap * 2;
      const thickness = 0.3;
      const width = Math.max(1.1, a.dimensions.x * 0.07);
      signalSpines.push({
        id: nextId++,
        time: 0,
        position: {
          x: 0,
          y: PLATFORM_TOP_Y - thickness * 0.5,
          z: (exitZ + entryZ) * 0.5
        },
        dimensions: { x: width, y: thickness, z: span },
        yaw: 0,
        pitch: 0,
        roll: 0,
        type: RouteNodeType.RUNWAY,
        intensity: 0.5,
        sectionIndex: 0,
        arcLength: a.arcLength,
        isSurf: false,
        isBoost: false,
        isOptional: true,
        isSignalSpine: true,
        signalSpineVariant: 'CATWALK'
      });
    }
  }

  return {
    route,
    obstacles,
    signalSpines,
    stations: GAUNTLET_STATIONS,
    checkpoints,
    signage,
    startZ: START_Z,
    endZ: cursor
  };
}
