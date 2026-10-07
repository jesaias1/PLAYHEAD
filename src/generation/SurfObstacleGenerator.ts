/**
 * SurfObstacleGenerator - deliberate, SURF-ONLY obstacle phrases on ribbons.
 *
 * Long banked ribbons used to read as empty ramps. This pass authors a small,
 * deterministic set of REAL gameplay solids on the ribbon surface itself:
 * partial ribs anchored to one edge, staggered blockers and short slalom /
 * weave reads. Every element is
 *
 *   - a genuine collider (the same RouteNode obstacle pipeline as normal mode,
 *     consumed by PhysicsWorld.addObstacleCollider), never decoration;
 *   - placed on an ACTUAL shared ribbon station basis (centre / forward /
 *     normal / right), never a guessed Euler normal, and its box rotation is
 *     the eulerFromBasis(yaw,pitch,roll) of that same basis, so the rendered
 *     mesh and the BoxCollider agree even on a banked station;
 *   - a LANE CHOICE, never a wall: a broad safe lane of at least
 *     SURF_OBSTACLE.SAFE_LANE_MIN metres always remains.
 *
 * Hard rules honoured here:
 *   - Deterministic: one SeededRandom, no audio-reactive placement.
 *   - Never in the entry stretch, the exit / finish stretch, a checkpoint arc
 *     or a ballistic AIR launch / landing zone (including its run-out).
 *   - Small solids only: no full-width walls, no micro snags, no clutter.
 *   - Runs AFTER the final snapped route, so solids are derived from the
 *     geometry the player actually rides and are part of the map fingerprint.
 */

import { TrackAnalysis } from '../audio/AudioFeatures';
import { RouteNode, RouteNodeType, SurfRibbonStation, Vector3Like } from './GenerationTypes';
import { SeededRandom } from './SeededRandom';
import {
  eulerFromBasis,
  vAdd,
  vNormalize,
  vScale,
  vSub
} from './SurfRibbon';

/** Salt keeps the surf obstacle layout deterministic but distinct from the route. */
const SURF_OBSTACLE_SEED_SALT = 0x5355524f; // 'SURO'

/** Obstacle ids start above the normal-mode obstacle id space. */
export const SURF_OBSTACLE_ID_BASE = 3_000_000;

/** Authored SURF-only obstacle phrase vocabulary. */
export type SurfObstaclePhraseKind =
  | 'SURF_RIB'      // one partial rib on the upper lane -> take the lower lane
  | 'SURF_STAGGER'  // two ribs staggered from opposite edges -> one lateral read
  | 'SURF_SLALOM'   // three ribs alternating sides -> a sustained weave
  | 'SURF_WEAVE';   // four ribs alternating sides -> a tightening line

export const SURF_OBSTACLE = {
  /** Minimum traversable lane that must remain beside every solid (metres). */
  SAFE_LANE_MIN: 5.5,
  /** Gap kept between a solid and the ribbon edge it is anchored to (metres). */
  EDGE_MARGIN: 0.9,
  /** Minimum arc-length spacing between two phrases (metres). */
  MIN_GROUP_SPACING: 55,
  /** Clean opening stretch after the start runway (metres). */
  ENTRY_CLEARANCE: 48,
  /** Clean stretch before the finish deck (metres). */
  EXIT_CLEARANCE: 42,
  /** Clean arc around a checkpoint restore (metres). */
  CHECKPOINT_CLEARANCE: 34,
  /** Clean stretch before an AIR launch edge (metres). */
  AIR_CLEARANCE_BEFORE: 20,
  /** Clean launch plus ballistic landing run-out after an AIR edge (metres). */
  AIR_CLEARANCE_AFTER: 34,
  /** Rib width bounds (metres). */
  MIN_RIB_WIDTH: 2.0,
  MAX_RIB_WIDTH: 9.0,
  /**
   * Rib width may never exceed this fraction of the USABLE ribbon width
   * (usable = halfWidth - EDGE_MARGIN on each side). ~40% leaves a common
   * continuous clearance lane even on the narrowest station of a phrase.
   */
  MAX_RIB_WIDTH_USABLE_FRACTION: 0.4,
  /** Rib depth bounds along the ribbon (metres). */
  MIN_RIB_DEPTH: 2.0,
  MAX_RIB_DEPTH: 3.4,
  /** Rib height bounds (metres): small solids, never micro snags. */
  MIN_RIB_HEIGHT: 1.0,
  MAX_RIB_HEIGHT: 1.8,
  /** A ribbon chain shorter than this never carries a phrase (metres). */
  MIN_RIBBON_LENGTH: 64,
  /** Hard caps; protect both feel and performance. */
  MAX_PHRASES: 26,
  MAX_OBSTACLES: 72,
  /**
   * ACTUAL ARC LENGTH (metres) required between two same-phrase elements.
   * Chains vary station spacing, so the anchor search measures the real
   * station chord instead of counting stations. 35 m at the expected surf
   * speed (~37 m/s) reads as a deliberate lateral question, never the old
   * 5 m / 0.14 s alternating rib stutter.
   */
  MIN_ELEMENT_ARC_SPACING: 35,
  /** Maximum same-phrase elements (matches SURF_WEAVE). */
  MAX_PHRASE_ELEMENTS: 4
} as const;

/**
 * A resolved placement of one solid on a real shared ribbon station. Used by
 * the generator AND by tests, so lane clearance is measured against the exact
 * basis the collider is built from.
 */
export interface SurfObstaclePlacement {
  /** Route node whose ribbon owns this station (source id metadata). */
  host: RouteNode;
  /** Index of the shared station inside its ribbon chain. */
  stationIndex: number;
  /** Real station centre on the rideable surface. */
  surfaceCenter: Vector3Like;
  /** Shared station tangent (authoritative forward). */
  forward: Vector3Like;
  /** Shared station right axis of the top face. */
  right: Vector3Like;
  /** Shared station surface normal. */
  normal: Vector3Like;
  /** Half width of the ribbon at this station. */
  halfWidth: number;
  /** Real arc length from the chain start to this station (metres). */
  stationArc: number;
  /** Blocked lateral interval in ribbon-local units (metres, signed). */
  blockedMinLateral: number;
  blockedMaxLateral: number;
  /** Ribbon-local lateral centre of the remaining safe lane. */
  safeLaneCenterLateral: number;
  /** Width of the remaining safe lane (metres). */
  safeLaneWidth: number;
  /** Which side of the travel direction the safe lane is on. */
  safeLane: 'LEFT' | 'RIGHT';
  /** Local lateral centre of the solid itself. */
  ribLateral: number;
}

interface ReservedArc {
  start: number;
  end: number;
}

/** Ordered ribbon chain: station list plus the node owning each entry station. */
interface RibbonChain {
  ribbonId: number;
  nodes: RouteNode[];
  stations: SurfRibbonStation[];
  /** Host node for the segment between stations[k] and stations[k+1]. */
  hosts: RouteNode[];
  length: number;
  /** Real cumulative arc length at each station (arc[0] = 0). */
  arc: number[];
}

export class SurfObstacleGenerator {
  /**
   * Author deterministic SURF obstacle phrases on the FINAL route. Returns the
   * obstacle nodes; never mutates the route.
   */
  public static generate(route: RouteNode[], analysis: TrackAnalysis, checkpointNodeIds: readonly number[] = []): RouteNode[] {
    const obstacles: RouteNode[] = [];
    if (route.length < 6) return obstacles;

    const rng = new SeededRandom((analysis.seed ^ SURF_OBSTACLE_SEED_SALT) >>> 0);
    const reserved = SurfObstacleGenerator.collectReservedArcs(route, checkpointNodeIds);
    const chains = SurfObstacleGenerator.collectChains(route);

    let nextId = SURF_OBSTACLE_ID_BASE;
    let nextPhraseId = SURF_OBSTACLE_ID_BASE + 500000;
    let phrases = 0;
    let lastArc = -Infinity;

    for (const chain of chains) {
      if (phrases >= SURF_OBSTACLE.MAX_PHRASES) break;
      if (obstacles.length >= SURF_OBSTACLE.MAX_OBSTACLES) break;
      if (chain.length < SURF_OBSTACLE.MIN_RIBBON_LENGTH) continue;

      // Phrase kind from the music section at the chain mid-point: harder music
      // reads a longer weave, quiet music keeps a single readable rib.
      const midHost = chain.hosts[Math.floor(chain.hosts.length / 2)] ?? chain.hosts[0];
      const theme = analysis.sections[midHost.sectionIndex]?.theme ?? 'FLOW';
      const kind = SurfObstacleGenerator.chooseKind(rng, theme, chain.length);
      const elementCount =
        kind === 'SURF_RIB' ? 1 :
        kind === 'SURF_STAGGER' ? 2 :
        kind === 'SURF_SLALOM' ? 3 : 4;

      const lastStation = chain.stations.length - 1;
      // A phrase needs elementCount reads spaced by REAL arc metres (chains vary
      // station spacing, so counting stations could compress a read to a few
      // metres). Only elementCount=1 may use any station.
      const anchors = SurfObstacleGenerator.pickAnchors(chain, elementCount, rng);
      if (!anchors) continue;

      const firstHost = chain.hosts[Math.min(anchors[0], chain.hosts.length - 1)];
      // Spacing counts the PREVIOUS phrase's LAST element, never its first, so
      // a long weave cannot crowd the next read.
      if (firstHost.arcLength - lastArc < SURF_OBSTACLE.MIN_GROUP_SPACING) continue;

      // Build the phrase; every element must leave a broad safe lane. If any
      // element cannot, the whole phrase is dropped (never partial clutter).
      const phrase: RouteNode[] = [];
      let sharedLaneLow = -Infinity;
      let sharedLaneHigh = Infinity;
      let skip = false;
      // Deterministic side alternation: STAGGER / SLALOM / WEAVE genuinely weave
      // left/right; a single rib takes one random (but seeded) edge.
      const baseSide: 1 | -1 = rng.nextBool() ? 1 : -1;
      for (let e = 0; e < elementCount; e++) {
        const stationIndex = anchors[e];
        const host = chain.hosts[Math.min(stationIndex, chain.hosts.length - 1)];
        const station = chain.stations[stationIndex];
        const nextStation = chain.stations[Math.min(stationIndex + 1, lastStation)];
        const forward = SurfObstacleGenerator.stationForward(station, nextStation);
        const side: 1 | -1 = e % 2 === 0 ? baseSide : (baseSide === 1 ? -1 : 1);
        const depth = rng.nextFloat(SURF_OBSTACLE.MIN_RIB_DEPTH, SURF_OBSTACLE.MAX_RIB_DEPTH);
        // Guard the solid's FULL depth, not just its anchor point, against the
        // reserved entry / exit / checkpoint / AIR arc windows.
        if (SurfObstacleGenerator.isReservedRange(host, depth, reserved)) {
          skip = true;
          break;
        }
        const placement = SurfObstacleGenerator.planPlacement(
          host, station, stationIndex, chain.arc[stationIndex], forward, side, rng
        );
        if (!placement) {
          skip = true;
          break;
        }
        sharedLaneLow = Math.max(sharedLaneLow, side > 0 ? -placement.halfWidth : placement.blockedMaxLateral);
        sharedLaneHigh = Math.min(sharedLaneHigh, side > 0 ? placement.blockedMinLateral : placement.halfWidth);
        const height = rng.nextFloat(SURF_OBSTACLE.MIN_RIB_HEIGHT, SURF_OBSTACLE.MAX_RIB_HEIGHT);
        const width = placement.blockedMaxLateral - placement.blockedMinLateral;
        phrase.push(
          SurfObstacleGenerator.buildSolid(host, placement, station, forward, width, height, depth, nextId++)
        );
      }
      if (skip || phrase.length !== elementCount || sharedLaneHigh - sharedLaneLow < SURF_OBSTACLE.SAFE_LANE_MIN) continue;

      // Shared phrase metadata, so a read is one authored movement question.
      for (let i = 0; i < phrase.length; i++) {
        phrase[i].obstaclePhraseId = nextPhraseId;
        phrase[i].obstacleGroupId = nextPhraseId;
        phrase[i].obstacleSurfPhraseKind = kind;
        phrase[i].obstaclePhraseKind = SurfObstacleGenerator.movementPhraseFor(kind);
        phrase[i].obstacleDifficulty =
          kind === 'SURF_RIB' ? 'LOW' : kind === 'SURF_WEAVE' ? 'HIGH' : 'MEDIUM';
        phrase[i].obstacleThreadIndex = i;
        phrase[i].obstacleThreadCount = phrase.length;
        phrase[i].obstacleMusicTheme = theme;
        if (i === 0) phrase[i].obstacleTelegraphDistance = 14;
        obstacles.push(phrase[i]);
      }
      nextPhraseId++;
      phrases++;
      lastArc = phrase[phrase.length - 1].arcLength;
    }

    return obstacles;
  }

  /**
   * Resolve where a solid may sit on a real ribbon station, or null when the
   * station is too narrow for a fair rib plus a broad safe lane.
   */
  public static planPlacement(
    host: RouteNode,
    station: SurfRibbonStation,
    stationIndex: number,
    stationArc: number,
    forward: Vector3Like,
    side: 1 | -1,
    rng: SeededRandom
  ): SurfObstaclePlacement | null {
    const halfWidth = station.halfWidth;
    const usableHalf = halfWidth - SURF_OBSTACLE.EDGE_MARGIN;
    if (usableHalf <= 0) return null;

    const normal = vNormalize(station.normal);
    const right = station.right ? vNormalize(station.right) : vNormalize(vCrossSafe(normal, forward));

    const maxWidth = Math.min(
      SURF_OBSTACLE.MAX_RIB_WIDTH,
      usableHalf * 2 * SURF_OBSTACLE.MAX_RIB_WIDTH_USABLE_FRACTION,
      usableHalf - SURF_OBSTACLE.SAFE_LANE_MIN * 0.5,
      usableHalf * 2 - SURF_OBSTACLE.SAFE_LANE_MIN
    );
    if (maxWidth < SURF_OBSTACLE.MIN_RIB_WIDTH) return null;

    // Bounded width: never a full-width wall, never a micro snag.
    const width = Math.min(
      maxWidth,
      rng.nextFloat(SURF_OBSTACLE.MIN_RIB_WIDTH, maxWidth)
    );
    const blockedMin = side > 0 ? usableHalf - width : -usableHalf;
    const blockedMax = side > 0 ? usableHalf : -usableHalf + width;

    const safeLaneWidth = usableHalf * 2 - width;
    if (safeLaneWidth < SURF_OBSTACLE.SAFE_LANE_MIN - 1e-9) return null;

    const safeLaneCenter = side > 0
      ? -usableHalf + safeLaneWidth * 0.5
      : usableHalf - safeLaneWidth * 0.5;

    return {
      host,
      stationIndex,
      surfaceCenter: { ...station.center },
      forward: vNormalize(forward),
      right,
      normal,
      halfWidth,
      stationArc,
      blockedMinLateral: blockedMin,
      blockedMaxLateral: blockedMax,
      safeLaneCenterLateral: safeLaneCenter,
      safeLaneWidth,
      safeLane: side > 0 ? 'LEFT' : 'RIGHT',
      ribLateral: (blockedMin + blockedMax) * 0.5
    };
  }

  /** Re-resolve an emitted solid placement from the FINAL route, for tests. */
  public static describePlacement(obstacle: RouteNode, route: RouteNode[]): SurfObstaclePlacement | null {
    if (obstacle.obstacleHostStationIndex === undefined) return null;
    const chain = SurfObstacleGenerator.collectChains(route)
      .find((c) => c.ribbonId === obstacle.obstacleHostRibbonId);
    if (!chain) return null;
    const k = obstacle.obstacleHostStationIndex;
    const station = chain.stations[k];
    if (!station) return null;
    const host = chain.hosts[Math.min(k, chain.hosts.length - 1)];
    const nextStation = chain.stations[Math.min(k + 1, chain.stations.length - 1)];
    const forward = SurfObstacleGenerator.stationForward(station, nextStation);
    const usableHalf = station.halfWidth - SURF_OBSTACLE.EDGE_MARGIN;
    const width = obstacle.dimensions.x;
    const leftSide = obstacle.obstacleSafeLane === 'LEFT';
    const blockedMin = leftSide ? usableHalf - width : -usableHalf;
    const blockedMax = leftSide ? usableHalf : -usableHalf + width;
    const safeLaneWidth = obstacle.obstacleSafeLaneWidth ?? usableHalf * 2 - width;
    return {
      host,
      stationIndex: k,
      stationArc: chain.arc[k] ?? 0,
      surfaceCenter: { ...station.center },
      forward,
      right: station.right ? vNormalize(station.right) : vNormalize(vCrossSafe(vNormalize(station.normal), forward)),
      normal: vNormalize(station.normal),
      halfWidth: station.halfWidth,
      blockedMinLateral: blockedMin,
      blockedMaxLateral: blockedMax,
      safeLaneCenterLateral: obstacle.obstacleSafeLaneLateral ?? (leftSide ? -usableHalf + safeLaneWidth * 0.5 : usableHalf - safeLaneWidth * 0.5),
      safeLaneWidth,
      safeLane: leftSide ? 'LEFT' : 'RIGHT',
      ribLateral: (blockedMin + blockedMax) * 0.5
    };
  }

  /** World-space centre of the safe lane for a placement. */
  public static safeLaneWorldPoint(placement: SurfObstaclePlacement, lift = 0): Vector3Like {
    const onSurface = vAdd(placement.surfaceCenter, vScale(placement.right, placement.safeLaneCenterLateral));
    return vAdd(onSurface, vScale(placement.normal, lift));
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private static stationForward(station: SurfRibbonStation, next: SurfRibbonStation): Vector3Like {
    if (station.tangent) return vNormalize(station.tangent);
    const chord = vSub(next.center, station.center);
    if (Math.hypot(chord.x, chord.y, chord.z) < 1e-6) return vNormalize({ x: 0, y: 0, z: 1 });
    return vNormalize(chord);
  }

  /**
   * Build one solid RouteNode from a resolved placement. The body sits ON the
   * rideable surface (centre pushed out along the real station normal by half
   * the rib height) and its Euler rotation is eulerFromBasis(forward, normal),
   * so the drawn mesh and the BoxCollider agree on a banked station.
   */
  private static buildSolid(
    host: RouteNode,
    placement: SurfObstaclePlacement,
    station: SurfRibbonStation,
    forward: Vector3Like,
    width: number,
    height: number,
    depth: number,
    id: number
  ): RouteNode {
    // Body sits ON the rideable surface: centre is the station surface point
    // pushed out along the real station normal by half the rib height.
    const onSurface = vAdd(station.center, vScale(placement.right, placement.ribLateral));
    const position = vAdd(onSurface, vScale(placement.normal, height * 0.5));
    const { yaw, pitch, roll } = eulerFromBasis(forward, placement.normal);
    return {
      id,
      time: host.time,
      position,
      dimensions: { x: width, y: height, z: depth },
      yaw,
      pitch,
      roll,
      type: RouteNodeType.PHASE_BLOCK,
      intensity: host.intensity,
      sectionIndex: host.sectionIndex,
      arcLength: host.arcLength,
      isSurf: false,
      isBoost: false,
      obstacleType: 'PHASE_BLOCK',
      obstacleGroupId: id,
      obstacleSafeLane: placement.safeLane,
      obstacleSafeLaneWidth: placement.safeLaneWidth,
      obstacleSafeLaneLateral: placement.safeLaneCenterLateral,
      obstacleHostStationIndex: placement.stationIndex,
      obstacleHostRibbonId: host.ribbonId,
      obstacleSourceNodeId: host.id
    };
  }

  private static chooseKind(rng: SeededRandom, theme: string, ribbonLength: number): SurfObstaclePhraseKind {
    if (ribbonLength < 110) return rng.nextBool(0.7) ? 'SURF_RIB' : 'SURF_STAGGER';
    if (theme === 'DROP' || theme === 'SPEED' || theme === 'BUILDUP') {
      return rng.nextBool(0.5) ? 'SURF_SLALOM' : 'SURF_WEAVE';
    }
    if (theme === 'BREATH' || theme === 'PRECISION') {
      return rng.nextBool(0.65) ? 'SURF_RIB' : 'SURF_STAGGER';
    }
    return rng.choice<SurfObstaclePhraseKind>(['SURF_RIB', 'SURF_STAGGER', 'SURF_SLALOM']);
  }

  private static movementPhraseFor(kind: SurfObstaclePhraseKind): RouteNode['obstaclePhraseKind'] {
    switch (kind) {
      case 'SURF_RIB': return 'PHASE_DODGE';
      case 'SURF_STAGGER': return 'LEFT_RIGHT_THREAD';
      case 'SURF_SLALOM': return 'CUTOUT_SLALOM';
      case 'SURF_WEAVE': return 'THREE_WALL_THREAD';
    }
  }

  private static collectChains(route: RouteNode[]): RibbonChain[] {
    const byRibbon = new Map<number, RouteNode[]>();
    for (const node of route) {
      if (node.ribbonId === undefined || !node.ribbon || !node.isSurf) continue;
      const list = byRibbon.get(node.ribbonId) ?? [];
      list.push(node);
      byRibbon.set(node.ribbonId, list);
    }
    const chains: RibbonChain[] = [];
    for (const [ribbonId, list] of byRibbon) {
      list.sort((a, b) => (a.ribbonStationIndex ?? 0) - (b.ribbonStationIndex ?? 0));
      const stations: SurfRibbonStation[] = [list[0].ribbon!.stations[0]];
      const hosts: RouteNode[] = [];
      let length = 0;
      for (const node of list) {
        stations.push(node.ribbon!.stations[1]);
        hosts.push(node);
        length += node.dimensions.z;
      }
      // Real cumulative arc length per station, measured on the actual
      // station centres, so spacing is in metres rather than station count
      // (chains vary station spacing).
      const arc: number[] = [0];
      for (let i = 1; i < stations.length; i++) {
        const delta = vSub(stations[i].center, stations[i - 1].center);
        arc.push(arc[i - 1] + Math.hypot(delta.x, delta.y, delta.z));
      }
      chains.push({ ribbonId, nodes: list, stations, hosts, length, arc });
    }
    chains.sort((a, b) => a.ribbonId - b.ribbonId);
    return chains;
  }

  /**
   * Arc windows (in metres) that must stay free of solids: the exit / finish
   * stretch, checkpoints, and every AIR launch / ballistic landing zone.
   */
  private static collectReservedArcs(route: RouteNode[], checkpointNodeIds: readonly number[]): ReservedArc[] {
    const reserved: ReservedArc[] = [{ start: -Infinity, end: route[0].arcLength + SURF_OBSTACLE.ENTRY_CLEARANCE }];
    const finish = route[route.length - 1];
    if (finish) {
      // The whole final release ribbon launches into the finish deck.
      reserved.push({ start: finish.arcLength - 190, end: Infinity });
    }
    for (let i = 0; i < route.length; i++) {
      const node = route[i];
      if (node.type === RouteNodeType.CHECKPOINT || checkpointNodeIds.includes(node.id)) {
        reserved.push({
          start: node.arcLength - SURF_OBSTACLE.CHECKPOINT_CLEARANCE,
          end: node.arcLength + SURF_OBSTACLE.CHECKPOINT_CLEARANCE
        });
      }
      if (node.surfTransition === 'AIR') {
        const prev = route[i - 1];
        reserved.push({
          start: (prev ? prev.arcLength : node.arcLength) - SURF_OBSTACLE.AIR_CLEARANCE_BEFORE,
          end: node.arcLength + node.dimensions.z + SURF_OBSTACLE.AIR_CLEARANCE_AFTER
        });
      }
    }
    return reserved;
  }

  /**
   * Reserved check over the obstacle's FULL depth, not just its anchor point:
   * The anchor is at the host entry station, before its centre arc. Reserve
   * both halves of the solid and conservatively cover the host interval.
   */
  private static isReservedRange(host: RouteNode, depth: number, reserved: ReservedArc[]): boolean {
    const start = host.arcLength - host.dimensions.z * 0.5 - depth * 0.5;
    const end = host.arcLength + depth * 0.5;
    for (const zone of reserved) {
      if (end > zone.start && start < zone.end) return true;
    }
    return false;
  }

  /**
   * Pick anchor station indices for one phrase so consecutive ELEMENTS are at
   * least SURF_OBSTACLE.MIN_ELEMENT_ARC_SPACING real arc metres apart (chains
   * vary station spacing, so measuring metres is the only honest way to keep a
   * readable gap). Element 0 is any station with room on both sides; the old
   * first-element-reset bug is gone because the caller spaces against the
   * PREVIOUS phrase's last element.
   */
  private static pickAnchors(chain: RibbonChain, elementCount: number, rng: SeededRandom): number[] | null {
    const last = chain.stations.length - 2; // keep one station of run-out
    if (last < 1) return null;
    if (elementCount <= 1) return [rng.nextInt(1, last)];

    let startMax = last - 1;
    const lastStartArc = chain.arc[last] - (elementCount - 1) * SURF_OBSTACLE.MIN_ELEMENT_ARC_SPACING;
    while (startMax > 0 && chain.arc[startMax] > lastStartArc) startMax--;
    if (startMax < 1) return null;
    const start = rng.nextInt(1, startMax);
    const anchors: number[] = [start];
    for (let e = 1; e < elementCount; e++) {
      const need = chain.arc[anchors[e - 1]] + SURF_OBSTACLE.MIN_ELEMENT_ARC_SPACING;
      let found = -1;
      for (let j = anchors[e - 1] + 1; j <= last; j++) {
        if (chain.arc[j] >= need) { found = j; break; }
      }
      if (found < 0) return null;
      anchors.push(found);
    }
    return anchors;
  }
}

function vCrossSafe(a: Vector3Like, b: Vector3Like): Vector3Like {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}


