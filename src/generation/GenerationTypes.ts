/**
 * Generation interfaces and data types for procedural courses
 */

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface RouteAnchor {
  position: Vector3Like;
  yaw: number;
  elevation: number;
  arcLength: number;
}

export interface TraversalPhrase {
  entry: RouteAnchor;
  exit: RouteAnchor;
  nodes: RouteNode[];
  checkpoint?: CheckpointDefinition;
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
  FINISH = 'FINISH',
  SIGNAL_SHUTTER = 'SIGNAL_SHUTTER',
  SCAN_BAR = 'SCAN_BAR',
  SPLIT_GATE = 'SPLIT_GATE',
  PHASE_BLOCK = 'PHASE_BLOCK',
  SWEEP_BEAM = 'SWEEP_BEAM'
}

/**
 * Obstacle vocabulary. Every element is a deliberate, readable movement
 * challenge; obstacles are placed as deterministic PHRASES rather than as
 * isolated random blockers.
 */
export type RouteObstacleType =
  | 'SIGNAL_SHUTTER'
  | 'SCAN_BAR'
  | 'SPLIT_GATE'
  | 'PHASE_BLOCK'
  | 'SWEEP_BEAM';

/**
 * ROUTE FORKS — controlled SAFE vs FLOW/MASTERY movement choices.
 * A fork is a post-pass over the validated main route: the main route is the
 * SAFE line and is never modified; the MASTERY branch is extra parallel
 * geometry that diverges and rejoins.
 */
export type ForkType =
  | 'SAFE_VS_STRAFE'
  | 'SAFE_VS_SURF'
  | 'SAFE_VS_HIGH'
  | 'DIRECT_VS_TECHNICAL';

export interface RouteFork {
  id: number;
  type: ForkType;
  entryNodeId: number;
  rejoinNodeId: number;
  entryArcLength: number;
  rejoinArcLength: number;
  safeDistance: number;
  masteryDistance: number;
  masteryNodes: RouteNode[];
  validated: boolean;
}

/** Coherent multi-element movement phrases built from the obstacle vocabulary. */
export type ObstaclePhraseKind =
  | 'GATE_COMMIT'
  | 'PHASE_DODGE'
  | 'BEAM_HOP'
  | 'JUMP_THEN_STRAFE'
  | 'LEFT_RIGHT_THREAD'
  | 'THREE_WALL_THREAD'
  | 'FALSE_CENTER'
  | 'CUTOUT_SLALOM'
  | 'SHUTTER_APPROACH';

export type ObstacleDifficulty = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * Deterministic lateral oscillation for moving obstacles (shutters, sweep
 * beams). Purely a function of song time, so the same track always produces
 * the same motion. Never used for audio-reactive jitter.
 */
export interface ObstacleMotion {
  /** Peak lateral displacement from the authored centre, metres. */
  amplitude: number;
  /** Angular rate in radians per second of song time. */
  speed: number;
  /** Deterministic phase offset, radians. */
  phase: number;
}

export type AscentVariant =
  | 'FLOW_STAIR'
  | 'FLARED_ASCENT'
  | 'BREATHER_ASCENT'
  | 'OFFSET_ASCENT';

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
  isOptional?: boolean;
  isLaunchVariant?: boolean;
  exitWidth?: number;
  /** Local-X shift of the far/exit edge, used for asymmetric outside catch wings. */
  exitLateralOffset?: number;
  ascentVariant?: AscentVariant;
  ascentPhraseId?: number;
  ascentStepIndex?: number;
  ascentStepCount?: number;
  ascentExpectedSpeed?: number;
  ascentMinimumApproach?: number;
  ascentPostLandingRunway?: number;
  isRecoveryShelf?: boolean;
  isSignalSpine?: boolean;
  signalSpineVariant?: 'STRAIGHT' | 'OFFSET' | 'CURVED' | 'DIP' | 'CATWALK' | 'SHALLOW_SURF' | 'TAPERED' | 'BROKEN' | 'TAPER_TO_REJOIN';
  obstacleType?: RouteObstacleType;
  obstacleGroupId?: number;
  obstacleSafeLane?: 'LEFT' | 'RIGHT' | 'BOTH' | 'JUMP';
  obstacleTelegraphDistance?: number;
  obstacleSourceNodeId?: number;
  /** Phrase this element belongs to (all elements of a phrase share an id). */
  obstaclePhraseId?: number;
  /** Readable movement pattern the phrase is asking the player to solve. */
  obstaclePhraseKind?: ObstaclePhraseKind;
  /** Internal difficulty budget used to keep phrases fair for the geometry. */
  obstacleDifficulty?: ObstacleDifficulty;
  /** Index of this element within its phrase (0 = first encountered). */
  obstacleThreadIndex?: number;
  /** Number of elements in the owning phrase. */
  obstacleThreadCount?: number;
  /** Deterministic song-time motion, present only on moving obstacles. */
  obstacleMotion?: ObstacleMotion;
  /** Section theme at generation time (DEV diagnostics only). */
  obstacleMusicTheme?: string;
  /** Set on nodes that belong to a fork's mastery branch. */
  forkBranchType?: ForkType;
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
  generationVersion?: number;
  seed: number;
  route: RouteNode[];
  optionalRamps?: RouteNode[];
  recoveryShelves?: RouteNode[];
  signalSpines?: RouteNode[];
  obstacles?: RouteNode[];
  /** Optional SAFE vs MASTERY route forks (mastery branch geometry). */
  forks?: RouteFork[];
  checkpoints: CheckpointDefinition[];
  finish: FinishDefinition;
  totalDistance: number;
  targetDuration: number;
  repairedJumpsCount: number;
}
