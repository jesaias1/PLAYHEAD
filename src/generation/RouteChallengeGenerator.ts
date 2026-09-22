import { AnalysisSection, TrackAnalysis } from '../audio/AudioFeatures';
import {
  ObstacleDifficulty,
  ObstaclePhraseKind,
  RouteNode,
  RouteNodeType,
  RouteObstacleType,
  Vector3Like
} from './GenerationTypes';
import { SeededRandom } from './SeededRandom';
import { PLAYHEAD_MOVEMENT_V1 } from '../player/MovementConfig';

/**
 * Obstacle Pass 2 — deterministic movement-challenge / route-reading pass.
 *
 * The previous implementation placed at most eight isolated blockers on a
 * whole route, spaced 72m apart, so broad platforms read as empty travel
 * space. This pass keeps the same deterministic philosophy but generates
 * coherent OBSTACLE PHRASES (read -> dodge -> jump -> strafe -> choose line)
 * at a density driven by the music section, the platform's real footprint, and
 * a fair-traversal validation step.
 *
 * Hard rules honoured here:
 * - No unseeded randomness: every decision comes from one SeededRandom.
 * - No cheap kill volumes: punishment is collision / lost line / worse exit.
 * - No moving geometry driven by audio: motion is a pure function of song time.
 * - Micro-platform chains are never overloaded; surf, spine, checkpoint, spawn
 *   and finish regions are protected.
 */

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Minimum arc-length spacing between the start of two phrases (metres). */
const MIN_PHRASE_SPACING = 38;
/** Generous legacy lane width used for LOW-difficulty openings. */
const MIN_SAFE_LANE = 4.0;
/** Absolute minimum traversable opening: player diameter (1.0) + fair margin. */
const MIN_OPENING = 2.75;
/** No obstacles during the opening stretch of the run. */
const START_GRACE_TIME = 12;
/** Clean recovery arc around a checkpoint restore. */
const CHECKPOINT_CLEARANCE = 30;
/** Clean arc around the finish opening. */
const FINISH_CLEARANCE = 34;
/** Soft cap on phrases per route; protects both feel and performance. */
const MAX_PHRASES = 40;
/** Hard cap on emitted obstacle elements (defensive). */
const MAX_OBSTACLES = 96;

const EDGE_MARGIN = 0.75;
const OBSTACLE_ID_BASE = 1_000_000;
const PHRASE_ID_BASE = 2_000_000;

/** Peak jump height of the frozen movement model (m). */
const JUMP_APEX =
  (PLAYHEAD_MOVEMENT_V1.jumpVelocity * PLAYHEAD_MOVEMENT_V1.jumpVelocity) /
  (2 * PLAYHEAD_MOVEMENT_V1.gravity);
/** A low beam taller than half the apex becomes an unfair instant wall. */
const MAX_JUMPABLE_HEIGHT = JUMP_APEX * 0.5;

const ELIGIBLE_TYPES = new Set<RouteNodeType>([
  RouteNodeType.RUNWAY,
  RouteNodeType.WIDE_FLOW,
  RouteNodeType.LANDING,
  RouteNodeType.BOOST
]);

const PROTECTED_NEIGHBOUR_TYPES = new Set<RouteNodeType>([
  RouteNodeType.CHECKPOINT,
  RouteNodeType.FINISH,
  RouteNodeType.SURF_APPROACH,
  RouteNodeType.SURF_RAMP
]);

type SizeClass = 'MEDIUM' | 'BROAD';

interface SectionProfile {
  density: number;
  maxDifficulty: ObstacleDifficulty;
}

interface ReservedArc {
  arc: number;
  radius: number;
}

export interface RouteChallengeContext {
  signalSpines?: RouteNode[];
  recoveryShelves?: RouteNode[];
}

export interface RouteChallengeGenerationReport {
  eligibleNodes: number;
  phrasesGenerated: number;
  obstaclesGenerated: number;
  countByType: Record<string, number>;
  countByPhrase: Record<string, number>;
  countByDifficulty: Record<string, number>;
  countByTheme: Record<string, number>;
  rejected: number;
  rejectionReasons: Record<string, number>;
}

/**
 * Deterministic, readable gameplay challenges. Generated after route repair,
 * so they never influence the authored traversal chain.
 */
export class RouteChallengeGenerator {
  private static lastReport: RouteChallengeGenerationReport | null = null;

  public static getLastReport(): RouteChallengeGenerationReport | null {
    return RouteChallengeGenerator.lastReport;
  }

  public static generate(
    route: RouteNode[],
    analysis: TrackAnalysis,
    context: RouteChallengeContext = {}
  ): RouteNode[] {
    RouteChallengeGenerator.lastReport = null;
    if (route.length < 8) return [];

    const rng = new SeededRandom((analysis.seed ^ 0x4f425354) >>> 0);
    const obstacles: RouteNode[] = [];
    const report = RouteChallengeGenerator.emptyReport();

    const reserved = RouteChallengeGenerator.collectReservedArcs(route);

    let nextObstacleId = OBSTACLE_ID_BASE;
    let nextPhraseId = PHRASE_ID_BASE;
    let lastPhraseEndArc = -Infinity;
    let phrases = 0;

    for (let i = 2; i < route.length - 3; i++) {
      if (phrases >= MAX_PHRASES || obstacles.length >= MAX_OBSTACLES) break;

      const node = route[i];
      const size = RouteChallengeGenerator.classifyPlatform(node);
      if (!size) continue;

      const section = analysis.sections[node.sectionIndex];
      if (!section) continue;
      if (!RouteChallengeGenerator.isEligibleNode(route, i, node, reserved)) continue;

      report.eligibleNodes++;

      const profile = RouteChallengeGenerator.profileForSection(section);
      if (profile.density <= 0) continue;
      if (node.arcLength - lastPhraseEndArc < MIN_PHRASE_SPACING) continue;
      if (!rng.nextBool(profile.density)) continue;

      // A genuinely broad, long deck can carry the signature threading read
      // even in a quieter section; it is never a micro chain.
      const selectionBand: ObstacleDifficulty =
        size === 'BROAD' && node.dimensions.z >= 30 ? 'HIGH' : profile.maxDifficulty;
      const candidates = RouteChallengeGenerator.phraseCandidates(selectionBand, size, node);
      if (candidates.length === 0) continue;

      const kind = rng.choice(candidates);
      const elements = RouteChallengeGenerator.buildPhrase(
        kind,
        node,
        size,
        rng,
        () => nextObstacleId++
      );

      if (!elements || elements.length === 0) {
        RouteChallengeGenerator.recordRejection(report, 'phrase_geometry_rejected');
        continue;
      }

      const difficulty = RouteChallengeGenerator.difficultyForPhrase(kind);
      RouteChallengeGenerator.decoratePhrase(
        elements,
        kind,
        difficulty,
        section.theme,
        nextPhraseId
      );

      const failure = RouteChallengeGenerator.validatePhrase(elements, node, context, reserved);
      if (failure) {
        RouteChallengeGenerator.recordRejection(report, failure);
        continue;
      }

      nextPhraseId++;
      phrases++;
      lastPhraseEndArc = node.arcLength + RouteChallengeGenerator.phraseReach(elements, node);

      for (const element of elements) {
        obstacles.push(element);
        report.obstaclesGenerated++;
        RouteChallengeGenerator.bump(report.countByType, element.obstacleType!);
        RouteChallengeGenerator.bump(report.countByTheme, section.theme);
      }
      RouteChallengeGenerator.bump(report.countByPhrase, kind);
      RouteChallengeGenerator.bump(report.countByDifficulty, difficulty);
      report.phrasesGenerated++;
    }

    RouteChallengeGenerator.lastReport = report;
    return obstacles;
  }

  // -------------------------------------------------------------------------
  // LAB API — Movement Lab obstacle gauntlet
  //
  // These reuse the EXACT production element/phrase factories, so Lab
  // obstacles are real production obstacles (same RouteNode data model, same
  // collider, same deterministic motion) placed at an authored location
  // instead of a procedural one. Nothing here changes procedural generation.
  // -------------------------------------------------------------------------

  /** Builds a single production obstacle element on an authored Lab host. */
  public static buildLabObstacle(
    type: RouteObstacleType,
    host: RouteNode,
    rng: SeededRandom,
    nextId: () => number,
    phraseKind: ObstaclePhraseKind
  ): RouteNode | null {
    const id = nextId();
    let element: RouteNode | null = null;

    switch (type) {
      case 'SPLIT_GATE': {
        const x = host.dimensions.x;
        const opening = clamp(x * 0.32, MIN_SAFE_LANE, 7.0);
        const wallWidth = x - opening - EDGE_MARGIN;
        if (wallWidth < 3.0) return null;
        const openSide: 'LEFT' | 'RIGHT' = rng.nextBool() ? 'LEFT' : 'RIGHT';
        element = RouteChallengeGenerator.makeWall(host, wallWidth, openSide, 0, 4.2, 0.95, id);
        break;
      }
      case 'SCAN_BAR':
        element = RouteChallengeGenerator.makeScanBar(host, 0, id);
        break;
      case 'SWEEP_BEAM':
        element = RouteChallengeGenerator.makeSweepBeam(host, 0, rng, id);
        break;
      case 'PHASE_BLOCK':
        element = RouteChallengeGenerator.makePhaseBlock(host, rng, 0, id);
        break;
      case 'SIGNAL_SHUTTER':
        element = RouteChallengeGenerator.makeShutter(host, rng, id);
        break;
    }

    if (!element) return null;
    RouteChallengeGenerator.decoratePhrase(
      [element],
      phraseKind,
      RouteChallengeGenerator.difficultyForPhrase(phraseKind),
      'LAB',
      id
    );
    return element;
  }

  /** Builds a full production phrase on an authored Lab host. */
  public static buildLabPhrase(
    kind: ObstaclePhraseKind,
    host: RouteNode,
    rng: SeededRandom,
    nextId: () => number,
    phraseId: number
  ): RouteNode[] | null {
    const size = RouteChallengeGenerator.classifyPlatform(host);
    if (!size) return null;

    const elements = RouteChallengeGenerator.buildPhrase(kind, host, size, rng, nextId);
    if (!elements || elements.length === 0) return null;

    RouteChallengeGenerator.decoratePhrase(
      elements,
      kind,
      RouteChallengeGenerator.difficultyForPhrase(kind),
      'LAB',
      phraseId
    );
    return elements;
  }

  // -------------------------------------------------------------------------
  // Eligibility & music mapping
  // -------------------------------------------------------------------------

  private static classifyPlatform(node: RouteNode): SizeClass | null {
    if (
      node.isSurf ||
      !ELIGIBLE_TYPES.has(node.type) ||
      Math.abs(node.pitch) > 0.01 ||
      Math.abs(node.roll) > 0.01
    ) {
      return null;
    }
    // Small / micro platforms stay clean: their precision geometry is already
    // the challenge, and stacking obstacles there would be unfair.
    if (node.dimensions.x >= 15 && node.dimensions.z >= 25) return 'BROAD';
    if (node.dimensions.x >= 10.0 && node.dimensions.z >= 19) return 'MEDIUM';
    return null;
  }

  private static isEligibleNode(
    route: RouteNode[],
    index: number,
    node: RouteNode,
    reserved: ReservedArc[]
  ): boolean {
    if (node.time < START_GRACE_TIME) return false;
    // Ascent steps are precision geometry; never layer obstacles onto them.
    if (node.ascentVariant !== undefined) return false;

    for (const zone of reserved) {
      if (Math.abs(node.arcLength - zone.arc) < zone.radius) return false;
    }

    // Backward neighbours: the platform a player lands on directly after a
    // step-up must stay clear (no blind blocker after a blind landing).
    for (const offset of [-2, -1]) {
      const neighbour = route[index + offset];
      if (!neighbour) continue;
      if (neighbour.type === RouteNodeType.STEP_UP || neighbour.ascentVariant !== undefined) {
        return false;
      }
    }

    // Immediate neighbours: gates, surf entries/ramps, and the finish own the
    // challenge on their own approach.
    for (let offset = -1; offset <= 1; offset++) {
      if (offset === 0) continue;
      const neighbour = route[index + offset];
      if (!neighbour) continue;
      if (PROTECTED_NEIGHBOUR_TYPES.has(neighbour.type) || neighbour.isSurf) return false;
    }
    return true;
  }

  private static collectReservedArcs(route: RouteNode[]): ReservedArc[] {
    const zones: ReservedArc[] = [];
    for (const node of route) {
      if (node.type === RouteNodeType.CHECKPOINT) {
        zones.push({ arc: node.arcLength, radius: CHECKPOINT_CLEARANCE });
      } else if (node.type === RouteNodeType.FINISH) {
        zones.push({ arc: node.arcLength, radius: FINISH_CLEARANCE });
      }
    }
    return zones;
  }

  /**
   * Music-aware density. PLAYHEAD is not a rhythm game: this only shapes how
   * much route pressure a section carries, never beat-exact jump timing.
   */
  private static profileForSection(section: AnalysisSection): SectionProfile {
    switch (section.theme) {
      case 'DROP':
      case 'SURF':
      case 'BREATH':
        // Release / spectacular traversal: keep it open.
        return { density: 0, maxDifficulty: 'LOW' };
      case 'PRECISION':
        // Precision geometry already supplies the difficulty; only ever add a
        // single readable LOW obstacle.
        return { density: 0.85, maxDifficulty: 'LOW' };
      case 'ASCENT':
      case 'DESCENT':
        // Ascent steps themselves are never hosts (see isEligibleNode).
        return { density: 0.85, maxDifficulty: 'LOW' };
      case 'BUILDUP':
        // Progressive route pressure: shutters / split walls / threading.
        return { density: 0.95, maxDifficulty: 'HIGH' };
      case 'SPEED':
        return { density: 0.9, maxDifficulty: 'MEDIUM' };
      case 'FLOW':
      default:
        if (section.intensity < 0.35) {
          // Breakdown / low energy: broader readable lines, breathing room.
          return { density: 0.65, maxDifficulty: 'LOW' };
        }
        if (section.rhythmicDensity >= 0.7) {
          // Dense percussive: quicker readable sequences.
          return { density: 0.95, maxDifficulty: 'HIGH' };
        }
        return { density: 0.92, maxDifficulty: 'MEDIUM' };
    }
  }

  private static phraseCandidates(
    maxDifficulty: ObstacleDifficulty,
    size: SizeClass,
    node: RouteNode
  ): ObstaclePhraseKind[] {
    // Explicit weights: threading phrases are the signature movement read, so
    // they are deliberately well represented wherever the geometry supports
    // them, while single readable blockers keep their share.
    const pool: ObstaclePhraseKind[] = [];
    const add = (kind: ObstaclePhraseKind, weight: number) => {
      for (let i = 0; i < weight; i++) pool.push(kind);
    };

    if (maxDifficulty === 'LOW') {
      add('GATE_COMMIT', 2);
      add('PHASE_DODGE', 2);
      add('BEAM_HOP', 2);
      add('SHUTTER_APPROACH', 1);
      add('LEFT_RIGHT_THREAD', 1);
    } else if (maxDifficulty === 'MEDIUM') {
      add('JUMP_THEN_STRAFE', 2);
      add('LEFT_RIGHT_THREAD', 3);
      add('FALSE_CENTER', 2);
      add('CUTOUT_SLALOM', 2);
      add('SHUTTER_APPROACH', 2);
      add('BEAM_HOP', 1);
      add('PHASE_DODGE', 1);
    } else {
      add('THREE_WALL_THREAD', 3);
      add('LEFT_RIGHT_THREAD', 3);
      add('CUTOUT_SLALOM', 2);
      add('JUMP_THEN_STRAFE', 1);
      add('FALSE_CENTER', 1);
      add('SHUTTER_APPROACH', 1);
    }

    return pool.filter(kind => RouteChallengeGenerator.phraseFits(kind, size, node));
  }

  private static phraseFits(kind: ObstaclePhraseKind, size: SizeClass, node: RouteNode): boolean {
    const x = node.dimensions.x;
    const z = node.dimensions.z;
    switch (kind) {
      case 'THREE_WALL_THREAD':
        // A three-wall slalom needs a genuinely long, broad deck.
        return size === 'BROAD' && z >= 30;
      case 'LEFT_RIGHT_THREAD':
        return z >= 23 && x >= 13;
      case 'SHUTTER_APPROACH':
      case 'CUTOUT_SLALOM':
        // Moving elements need lateral room to read their opening.
        return x >= 14;
      default:
        return true;
    }
  }

  private static difficultyForPhrase(kind: ObstaclePhraseKind): ObstacleDifficulty {
    switch (kind) {
      case 'GATE_COMMIT':
      case 'PHASE_DODGE':
      case 'BEAM_HOP':
        return 'LOW';
      case 'JUMP_THEN_STRAFE':
      case 'LEFT_RIGHT_THREAD':
      case 'FALSE_CENTER':
      case 'SHUTTER_APPROACH':
      case 'CUTOUT_SLALOM':
        return 'MEDIUM';
      case 'THREE_WALL_THREAD':
        return 'HIGH';
      default:
        return 'MEDIUM';
    }
  }

  // -------------------------------------------------------------------------
  // Phrase construction
  // -------------------------------------------------------------------------

  private static buildPhrase(
    kind: ObstaclePhraseKind,
    node: RouteNode,
    size: SizeClass,
    rng: SeededRandom,
    nextId: () => number
  ): RouteNode[] | null {
    switch (kind) {
      case 'GATE_COMMIT':
        return RouteChallengeGenerator.buildGateCommit(node, rng, nextId);
      case 'PHASE_DODGE':
        return RouteChallengeGenerator.buildPhaseDodge(node, rng, nextId);
      case 'BEAM_HOP':
        return RouteChallengeGenerator.buildBeamHop(node, size, rng, nextId);
      case 'JUMP_THEN_STRAFE':
        return RouteChallengeGenerator.buildJumpThenStrafe(node, rng, nextId);
      case 'LEFT_RIGHT_THREAD':
        return RouteChallengeGenerator.buildThread(node, 2, rng, nextId);
      case 'THREE_WALL_THREAD':
        return RouteChallengeGenerator.buildThread(node, 3, rng, nextId);
      case 'FALSE_CENTER':
        return RouteChallengeGenerator.buildFalseCenter(node, rng, nextId);
      case 'CUTOUT_SLALOM':
        return RouteChallengeGenerator.buildCutoutSlalom(node, rng, nextId);
      case 'SHUTTER_APPROACH':
        return RouteChallengeGenerator.buildShutterApproach(node, size, rng, nextId);
      default:
        return null;
    }
  }

  /** Single large wall with a generous opening on one side. */
  private static buildGateCommit(
    node: RouteNode,
    rng: SeededRandom,
    nextId: () => number
  ): RouteNode[] | null {
    const x = node.dimensions.x;
    const opening = clamp(x * 0.34, MIN_SAFE_LANE + EDGE_MARGIN, 8.0);
    const wallWidth = x - opening - EDGE_MARGIN;
    if (wallWidth < 3.0) return null;

    const openSide: 'LEFT' | 'RIGHT' = rng.nextBool() ? 'LEFT' : 'RIGHT';
    const wall = RouteChallengeGenerator.makeWall(node, wallWidth, openSide, 0, 4.2, 0.95, nextId());
    if (!wall) return null;
    return [wall];
  }

  /** One dark slab occupying part of the lane; strafe around it. */
  private static buildPhaseDodge(
    node: RouteNode,
    rng: SeededRandom,
    nextId: () => number
  ): RouteNode[] | null {
    const block = RouteChallengeGenerator.makePhaseBlock(node, rng, 0, nextId());
    return block ? [block] : null;
  }

  /** One low beam to read and clear while preserving momentum. */
  private static buildBeamHop(
    node: RouteNode,
    size: SizeClass,
    rng: SeededRandom,
    nextId: () => number
  ): RouteNode[] | null {
    const localZ = -node.dimensions.z * 0.06;
    // Broad decks occasionally use the moving sweep beam for a timing read.
    if (size === 'BROAD' && rng.nextBool(0.45)) {
      const beam = RouteChallengeGenerator.makeSweepBeam(node, localZ, rng, nextId());
      return beam ? [beam] : null;
    }
    const bar = RouteChallengeGenerator.makeScanBar(node, localZ, nextId());
    return bar ? [bar] : null;
  }

  /** Jump a low scan bar, then air-strafe around an offset phase block. */
  private static buildJumpThenStrafe(
    node: RouteNode,
    rng: SeededRandom,
    nextId: () => number
  ): RouteNode[] | null {
    const z = node.dimensions.z;
    const barZ = -z * 0.18;
    const blockZ = z * 0.16;

    const bar = RouteChallengeGenerator.makeScanBar(node, barZ, nextId());
    if (!bar) return null;
    const block = RouteChallengeGenerator.makePhaseBlock(node, rng, blockZ, nextId());
    if (!block) return null;
    return [bar, block];
  }

  /** Two or three thin walls with alternating openings; slalom through. */
  private static buildThread(
    node: RouteNode,
    count: 2 | 3,
    rng: SeededRandom,
    nextId: () => number
  ): RouteNode[] | null {
    const x = node.dimensions.x;
    const z = node.dimensions.z;

    // Narrower openings for a 3-wall thread, still comfortably traversable.
    const targetOpening = count === 3
      ? clamp(x * 0.24, MIN_OPENING + 0.5, 5.4)
      : clamp(x * 0.3, MIN_SAFE_LANE, 6.5);

    const startSide: 'LEFT' | 'RIGHT' = rng.nextBool() ? 'LEFT' : 'RIGHT';
    const spacing = count === 3 ? z * 0.22 : z * 0.16;
    const startZ = count === 3 ? -z * 0.22 : -z * 0.16;

    const walls: RouteNode[] = [];
    for (let i = 0; i < count; i++) {
      const side: 'LEFT' | 'RIGHT' =
        (i % 2 === 0) === (startSide === 'LEFT') ? 'LEFT' : 'RIGHT';
      const wallWidth = x - targetOpening - EDGE_MARGIN;
      if (wallWidth < 2.6) return null;
      const wall = RouteChallengeGenerator.makeWall(
        node,
        wallWidth,
        side,
        startZ + spacing * i,
        4.2,
        0.85,
        nextId()
      );
      if (!wall) return null;
      walls.push(wall);
    }
    return walls;
  }

  /** Centered block, then a committed side opening with a cleaner exit line. */
  private static buildFalseCenter(
    node: RouteNode,
    rng: SeededRandom,
    nextId: () => number
  ): RouteNode[] | null {
    const x = node.dimensions.x;
    const z = node.dimensions.z;

    const blockWidth = clamp(x * 0.3, 3.2, 6.5);
    const block = RouteChallengeGenerator.makePhaseBlock(
      node,
      rng,
      -z * 0.15,
      nextId(),
      blockWidth,
      0,
      2.4
    );
    if (!block) return null;

    const opening = clamp(x * 0.32, MIN_SAFE_LANE, 7.0);
    const wallWidth = x - opening - EDGE_MARGIN;
    if (wallWidth < 3.0) return null;
    const openSide: 'LEFT' | 'RIGHT' = rng.nextBool() ? 'LEFT' : 'RIGHT';
    const wall = RouteChallengeGenerator.makeWall(node, wallWidth, openSide, z * 0.16, 4.2, 0.95, nextId());
    if (!wall) return null;
    return [block, wall];
  }

  /**
   * Trench-slat read: a moving low beam sweeps the deck, then an offset block
   * forces a second line choice. Literal platform holes are deliberately NOT
   * cut (that would mutate protected gameplay geometry and create void risk);
   * the slalom read is delivered with safe, non-lethal elements.
   */
  private static buildCutoutSlalom(
    node: RouteNode,
    rng: SeededRandom,
    nextId: () => number
  ): RouteNode[] | null {
    const z = node.dimensions.z;
    const beamZ = -z * 0.16;
    const blockZ = z * 0.15;

    const beam = RouteChallengeGenerator.makeSweepBeam(node, beamZ, rng, nextId());
    if (!beam) return null;
    const block = RouteChallengeGenerator.makePhaseBlock(node, rng, blockZ, nextId());
    if (!block) return null;
    return [beam, block];
  }

  /** Wide approach, moving shutter with a readable opening, clean rejoin. */
  private static buildShutterApproach(
    node: RouteNode,
    size: SizeClass,
    rng: SeededRandom,
    nextId: () => number
  ): RouteNode[] | null {
    const shutter = RouteChallengeGenerator.makeShutter(node, rng, nextId());
    if (!shutter) return null;

    // MEDIUM shutter approaches occasionally add a follow-up blocker so the
    // phrase reads as a two-beat decision rather than a single dodge.
    if (size === 'BROAD' && rng.nextBool(0.5)) {
      const block = RouteChallengeGenerator.makePhaseBlock(node, rng, node.dimensions.z * 0.18, nextId());
      if (block) return [shutter, block];
    }
    return [shutter];
  }

  // -------------------------------------------------------------------------
  // Element factories
  // -------------------------------------------------------------------------

  private static makeWall(
    node: RouteNode,
    wallWidth: number,
    openSide: 'LEFT' | 'RIGHT',
    localZ: number,
    height: number,
    depth: number,
    id: number
  ): RouteNode | null {
    if (wallWidth < 2.6) return null;
    const blockedSide = openSide === 'LEFT' ? 1 : -1;
    const localX = blockedSide * (node.dimensions.x * 0.5 - EDGE_MARGIN - wallWidth * 0.5);
    return RouteChallengeGenerator.element(
      node, 'SPLIT_GATE', wallWidth, height, depth, localX, localZ, openSide, id
    );
  }

  private static makeScanBar(node: RouteNode, localZ: number, id: number): RouteNode | null {
    const width = node.dimensions.x - 1.2;
    const height = Math.min(0.62, MAX_JUMPABLE_HEIGHT * 0.85);
    if (width < 6) return null;
    return RouteChallengeGenerator.element(
      node, 'SCAN_BAR', width, height, 0.55, 0, localZ, 'JUMP', id
    );
  }

  private static makeSweepBeam(
    node: RouteNode,
    localZ: number,
    rng: SeededRandom,
    id: number
  ): RouteNode | null {
    const width = node.dimensions.x - 1.2;
    const height = Math.min(0.62, MAX_JUMPABLE_HEIGHT * 0.85);
    if (width < 6) return null;
    const beam = RouteChallengeGenerator.element(
      node, 'SWEEP_BEAM', width, height, 0.55, 0, localZ, 'JUMP', id
    );
    // Low, jumpable, and slow enough to read on approach.
    beam.obstacleMotion = {
      amplitude: Math.min(2.4, Math.max(1.2, (node.dimensions.x - width) * 0.5 + 1.4)),
      speed: rng.nextFloat(0.7, 1.0),
      phase: rng.nextFloat(0, Math.PI * 2)
    };
    return beam;
  }

  private static makePhaseBlock(
    node: RouteNode,
    rng: SeededRandom,
    localZ: number,
    id: number,
    widthOverride?: number,
    localXOverride?: number,
    heightOverride?: number
  ): RouteNode | null {
    const x = node.dimensions.x;
    // A centred block must still leave a traversable lane on both sides.
    const maxWidth = x - 2 * MIN_OPENING;
    if (maxWidth < 3.0) return null;

    const desiredWidth = widthOverride ?? clamp(x * 0.34, 3.2, 7.5);
    const width = Math.min(desiredWidth, maxWidth);
    const height = heightOverride ?? 2.8;

    // Pull the lateral offset in until both strafe lanes stay traversable.
    const requestedOffset = localXOverride ?? (rng.nextBool() ? 1 : -1) * x * 0.14;
    const maxOffset = Math.max(0, x * 0.5 - MIN_OPENING - width * 0.5);
    const localX = clamp(requestedOffset, -maxOffset, maxOffset);

    const laneA = x * 0.5 + localX - width * 0.5;
    const laneB = x * 0.5 - localX - width * 0.5;
    if (Math.min(laneA, laneB) < MIN_OPENING - 1e-6) return null;

    const safeLane = laneA >= laneB ? 'RIGHT' : 'LEFT';
    return RouteChallengeGenerator.element(
      node, 'PHASE_BLOCK', width, height, 1.5, localX, localZ, safeLane, id
    );
  }

  private static makeShutter(node: RouteNode, rng: SeededRandom, id: number): RouteNode | null {
    const x = node.dimensions.x;
    // Panel must leave a static safe lane on BOTH sides even at full sweep.
    const maxPanel = x - 2 * (MIN_SAFE_LANE + 0.6);
    if (maxPanel < 3.0) return null;
    const panelWidth = Math.min(clamp(x * 0.26, 3.0, 6.0), maxPanel);

    const staticLane = (x - panelWidth) * 0.5;
    const amplitude = Math.min(2.6, Math.max(0.6, staticLane - MIN_SAFE_LANE));
    if (staticLane - amplitude < MIN_SAFE_LANE - 1e-6) return null;

    const shutter = RouteChallengeGenerator.element(
      node, 'SIGNAL_SHUTTER', panelWidth, 3.6, 0.9, 0, 0, 'BOTH', id
    );
    shutter.obstacleMotion = {
      amplitude,
      speed: rng.nextFloat(0.5, 0.85),
      phase: rng.nextFloat(0, Math.PI * 2)
    };
    return shutter;
  }

  private static element(
    source: RouteNode,
    type: RouteObstacleType,
    width: number,
    height: number,
    depth: number,
    localX: number,
    localZ: number,
    safeLane: RouteNode['obstacleSafeLane'],
    id: number
  ): RouteNode {
    const surfaceOffset = source.dimensions.y * 0.5;
    const position = localToWorld(
      source,
      localX,
      surfaceOffset + height * 0.5,
      localZ
    );
    return {
      id,
      time: source.time,
      position,
      dimensions: { x: width, y: height, z: depth },
      yaw: source.yaw,
      pitch: 0,
      roll: 0,
      type: RouteNodeType[type],
      intensity: source.intensity,
      sectionIndex: source.sectionIndex,
      arcLength: source.arcLength + localZ,
      isSurf: false,
      isBoost: false,
      obstacleType: type,
      obstacleGroupId: id,
      obstacleSafeLane: safeLane,
      obstacleSourceNodeId: source.id
    };
  }

  private static decoratePhrase(
    elements: RouteNode[],
    kind: ObstaclePhraseKind,
    difficulty: ObstacleDifficulty,
    theme: string,
    phraseId: number
  ): void {
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      element.obstaclePhraseId = phraseId;
      element.obstacleGroupId = phraseId;
      element.obstaclePhraseKind = kind;
      element.obstacleDifficulty = difficulty;
      element.obstacleThreadIndex = i;
      element.obstacleThreadCount = elements.length;
      element.obstacleMusicTheme = theme;
      // Only the leading element carries the approach telegraph, so thread
      // walls do not stack overlapping read-strips.
      if (i === 0) {
        element.obstacleTelegraphDistance =
          element.obstacleType === 'SCAN_BAR' || element.obstacleType === 'SWEEP_BEAM' ? 15 : 18;
      }
    }
  }

  private static phraseReach(elements: RouteNode[], node: RouteNode): number {
    let maxZ = 0;
    for (const element of elements) {
      const z = element.arcLength - node.arcLength;
      if (z > maxZ) maxZ = z;
    }
    return maxZ + node.dimensions.z * 0.25;
  }

  // -------------------------------------------------------------------------
  // Solvability validation
  // -------------------------------------------------------------------------

  /**
   * Rejects a phrase that would seal the route, clip the Signal Spine recovery
   * layer, clip recovery shelves, or intrude on a checkpoint / finish / spawn
   * safety arc. Returns a rejection reason, or null when the phrase is safe.
   */
  private static validatePhrase(
    elements: RouteNode[],
    source: RouteNode,
    context: RouteChallengeContext,
    reserved: ReservedArc[]
  ): string | null {
    for (const element of elements) {
      // Opening / clearance sanity for tall blockers.
      if (element.dimensions.y >= 1.8) {
        const opening = RouteChallengeGenerator.openingFor(element, source);
        if (opening < MIN_OPENING) return 'opening_too_narrow';
      } else if (element.dimensions.y > MAX_JUMPABLE_HEIGHT) {
        // Low elements must remain jumpable with the frozen jump arc.
        return 'beam_not_jumpable';
      }

      // Checkpoint / finish / spawn safety.
      for (const zone of reserved) {
        if (Math.abs(element.arcLength - zone.arc) < zone.radius * 0.5) {
          return 'intrudes_checkpoint_or_finish';
        }
      }

      // Signal Spine recovery layer must stay usable.
      if (context.signalSpines) {
        for (const spine of context.signalSpines) {
          if (conservativeOverlap(element, spine)) return 'blocks_signal_spine';
        }
      }

      // Recovery shelves must stay usable.
      if (context.recoveryShelves) {
        for (const shelf of context.recoveryShelves) {
          if (conservativeOverlap(element, shelf)) return 'blocks_recovery_shelf';
        }
      }
    }

    // Elements within a phrase must not fuse into a sealed wall. Thread walls
    // are deliberately offset along the route, so only elements sharing the
    // same cross-section can seal it.
    for (let i = 0; i < elements.length; i++) {
      for (let j = i + 1; j < elements.length; j++) {
        const a = elements[i];
        const b = elements[j];
        if (Math.abs(a.arcLength - b.arcLength) >= 2.0) continue;
        if (!conservativeOverlap(a, b)) continue;
        if (RouteChallengeGenerator.sealsRoute(a, b, source)) {
          return 'phrase_seals_route';
        }
      }
    }

    return null;
  }

  /**
   * Width of the traversable opening a tall element leaves on its platform.
   */
  private static openingFor(element: RouteNode, source: RouteNode): number {
    if (element.obstacleType === 'SPLIT_GATE') {
      return source.dimensions.x - element.dimensions.x - EDGE_MARGIN;
    }
    if (element.obstacleType === 'PHASE_BLOCK') {
      const x = source.dimensions.x;
      const localX = RouteChallengeGenerator.localXOf(element, source);
      const laneA = x * 0.5 + localX - element.dimensions.x * 0.5;
      const laneB = x * 0.5 - localX - element.dimensions.x * 0.5;
      return Math.max(laneA, laneB);
    }
    if (element.obstacleType === 'SIGNAL_SHUTTER') {
      const staticLane = (source.dimensions.x - element.dimensions.x) * 0.5;
      const amplitude = element.obstacleMotion?.amplitude ?? 0;
      return staticLane - amplitude;
    }
    return source.dimensions.x;
  }

  /** Two overlapping tall elements must not combine into a full-width wall. */
  private static sealsRoute(a: RouteNode, b: RouteNode, source: RouteNode): boolean {
    const blockedWidth =
      RouteChallengeGenerator.blockedSpan(a) +
      RouteChallengeGenerator.blockedSpan(b);
    return blockedWidth > source.dimensions.x - MIN_OPENING;
  }

  private static blockedSpan(element: RouteNode): number {
    if (element.dimensions.y < 1.8) return 0;
    if (element.obstacleType === 'SPLIT_GATE') return element.dimensions.x + EDGE_MARGIN;
    if (element.obstacleType === 'SIGNAL_SHUTTER') {
      return element.dimensions.x + (element.obstacleMotion?.amplitude ?? 0) * 2;
    }
    return element.dimensions.x;
  }

  private static localXOf(element: RouteNode, source: RouteNode): number {
    const dx = element.position.x - source.position.x;
    const dz = element.position.z - source.position.z;
    const sin = Math.sin(source.yaw);
    const cos = Math.cos(source.yaw);
    return dx * cos - dz * sin;
  }

  // -------------------------------------------------------------------------
  // Report helpers
  // -------------------------------------------------------------------------

  private static emptyReport(): RouteChallengeGenerationReport {
    return {
      eligibleNodes: 0,
      phrasesGenerated: 0,
      obstaclesGenerated: 0,
      countByType: {},
      countByPhrase: {},
      countByDifficulty: {},
      countByTheme: {},
      rejected: 0,
      rejectionReasons: {}
    };
  }

  private static recordRejection(report: RouteChallengeGenerationReport, reason: string): void {
    report.rejected++;
    RouteChallengeGenerator.bump(report.rejectionReasons, reason);
  }

  private static bump(record: Record<string, number>, key: string): void {
    record[key] = (record[key] || 0) + 1;
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function localToWorld(source: RouteNode, localX: number, localY: number, localZ: number): Vector3Like {
  const sin = Math.sin(source.yaw);
  const cos = Math.cos(source.yaw);
  return {
    x: source.position.x + cos * localX + sin * localZ,
    y: source.position.y + localY,
    z: source.position.z - sin * localX + cos * localZ
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Conservative cylinder overlap. Treats both boxes as upright cylinders so
 * rotated geometry can never sneak past the check. Over-rejecting is safe.
 */
function conservativeOverlap(a: RouteNode, b: RouteNode): boolean {
  const ax = Math.hypot(a.dimensions.x, a.dimensions.z) * 0.5;
  const bx = Math.hypot(b.dimensions.x, b.dimensions.z) * 0.5;
  const dx = a.position.x - b.position.x;
  const dz = a.position.z - b.position.z;
  const reach = ax + bx;
  if (dx * dx + dz * dz >= reach * reach) return false;
  const dy = Math.abs(a.position.y - b.position.y);
  return dy < (a.dimensions.y + b.dimensions.y) * 0.5;
}

export const ROUTE_CHALLENGE_LIMITS = {
  minSpacing: MIN_PHRASE_SPACING,
  minSafeLane: MIN_SAFE_LANE,
  minOpening: MIN_OPENING,
  maxPhrases: MAX_PHRASES,
  maxObstacles: MAX_OBSTACLES,
  checkpointClearance: CHECKPOINT_CLEARANCE,
  finishClearance: FINISH_CLEARANCE,
  startGraceTime: START_GRACE_TIME
} as const;
