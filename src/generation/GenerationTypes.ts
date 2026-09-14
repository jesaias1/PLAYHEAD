/**
 * Generation interfaces and data types for procedural courses
 */

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export enum RouteNodeType {
  RUNWAY = 'RUNWAY',
  STEP_UP = 'STEP_UP',
  STEP_DOWN = 'STEP_DOWN',
  GAP = 'GAP',
  OFFSET_GAP = 'OFFSET_GAP',
  ASCENT_CHAIN = 'ASCENT_CHAIN',
  DESCENT_CHAIN = 'DESCENT_CHAIN',
  TURN = 'TURN',
  WIDE_FLOW = 'WIDE_FLOW',
  NARROW_FLOW = 'NARROW_FLOW',
  BOOST = 'BOOST',
  SURF_APPROACH = 'SURF_APPROACH',
  SURF_RAMP = 'SURF_RAMP',
  LANDING = 'LANDING',
  SECTION_GATE = 'SECTION_GATE',
  CHECKPOINT = 'CHECKPOINT',
  FINISH = 'FINISH'
}

export interface RouteNode {
  id: number;
  time: number;               // Corresponding song timestamp (seconds)
  position: Vector3Like;       // Center of the platform surface
  dimensions: Vector3Like;     // Width (X), Height/Thickness (Y), Length (Z)
  yaw: number;                 // Horizontal heading angle (radians)
  pitch: number;               // Slope inclination (radians)
  roll: number;                // Bank / surf tilt angle (radians)
  type: RouteNodeType;
  intensity: number;           // 0..1 audio energy
  sectionIndex: number;
  arcLength: number;           // Cumulative distance from start (metres)
  isSurf: boolean;
  surfNormal?: Vector3Like;    // Normal vector for surf plane
  isBoost: boolean;
  boostSpeed?: number;
}

export interface CheckpointDefinition {
  id: number;
  routeNodeId: number;
  time: number;
  position: Vector3Like;
  yaw: number;
  sectionIndex: number;
}

export interface FinishDefinition {
  routeNodeId: number;
  time: number;
  position: Vector3Like;
  yaw: number;
}

export interface GeneratedTrack {
  seed: number;
  route: RouteNode[];
  checkpoints: CheckpointDefinition[];
  finish: FinishDefinition;
  totalDistance: number;
  targetDuration: number;
  repairedJumpsCount: number;
}
