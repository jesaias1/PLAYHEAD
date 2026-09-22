/**
 * SignalSpineGenerator for PLAYHEAD
 *
 * Generates procedural top-surface bridging geometry ("Signal Spine") to prevent
 * unfair void deaths across high-variance gameplay sequences:
 * 1. Post-surf landing platform chains (where landing speed varies widely).
 * 2. Staircase & ascent chains (where missed steps drop the player into the void).
 * 3. Small-platform chains (precision footings where missing by 0.5m-1.5m is fatal).
 * 4. Medium & larger platform transfers (where inter-platform gap still punishes arrival speed).
 *
 * Strict Design Invariants:
 * - NO UNDER-SLUNG CONNECTORS: Zero connector bars or support beams under platforms.
 * - TOP-SURFACE SPINE ONLY: Connector exists at the SAME gameplay elevation as the platform tops,
 *   bridging from the exit edge of one platform to the entry edge of the next.
 * - Collider and visible mesh match exactly: player can skate / bhop / run across it.
 * - KEEP RISK: Narrow profile (18% to 30% of platform width), preserving open void on the sides.
 * - CONTROLLED INSTANCE VARIATION: Per-instance variation in width, length/overlap, lateral placement,
 *   and alignment (Fast Line vs Recovery Line vs Center).
 * - SELECTIVE PLACEMENT: Deliberate open void preserved for PRECISION sections, major DROP leaps,
 *   and FINISH gates.
 */

import * as THREE from 'three';
import { TrackAnalysis } from '../audio/AudioFeatures';
import { RouteNode, RouteNodeType } from './GenerationTypes';
import { SeededRandom } from './SeededRandom';
import { PLAYHEAD_MOVEMENT_V1 } from '../player/MovementConfig';

/** Minimum catchable recovery width: one player diameter. */
const RECOVERY_MIN_WIDTH = PLAYHEAD_MOVEMENT_V1.playerRadius * 2;

export interface SignalSpineGenerationReport {
  eligibleGaps: number;
  smallChainConnectors: number;
  mediumLargeConnectors: number;
  microBarConnectors: number;
  highRiskTransfersFound: number;
  highRiskConnectorsGenerated: number;
  obstacleTransfersFound: number;
  obstacleConnectorsGenerated: number;
  transfersLeftUnsupported: number;
  totalGenerated: number;
  rejectedCount: number;
  rejectionReasons: Record<string, number>;
  /** Gap keys ("aId->bId") that received continuous recovery coverage. */
  coveredGapKeys: string[];
}

export interface SpineContinuityViolation {
  gapKey: string;
  reason:
    | 'missing_start_connection'
    | 'missing_end_connection'
    | 'hole_inside_spine'
    | 'below_player_safe_width';
  detail: string;
}

export interface SpineContinuityReport {
  coveredGaps: number;
  segmentsChecked: number;
  violations: SpineContinuityViolation[];
  isValid: boolean;
}

/**
 * Distance tolerance for "connected". Spine segments deliberately overlap each
 * other and the host platforms by design, so the true connection margin is far
 * larger than this. Anything beyond it is a real hole.
 */
const CONTINUITY_TOLERANCE = 0.25;

/**
 * Optional generation context. Obstacles are generated before spines so a gap
 * that sits inside an obstacle section can be treated as elevated risk and
 * receive a skinner recovery line instead of being left with no recovery at
 * all. Obstacle presence is never a reason to blanket-disable a spine.
 */
export interface SignalSpineContext {
  obstacles?: RouteNode[];
}

export class SignalSpineGenerator {
  private static readonly BASE_ID = 90000;
  private static lastReport: SignalSpineGenerationReport | null = null;

  public static getLastReport(): SignalSpineGenerationReport | null {
    return SignalSpineGenerator.lastReport;
  }

  /**
   * Generates procedural Signal Spines for a repaired route.
   */
  public static generate(
    route: RouteNode[],
    analysis: TrackAnalysis,
    rng: SeededRandom,
    context: SignalSpineContext = {}
  ): RouteNode[] {
    if (route.length < 4) return [];

    const spines: RouteNode[] = [];
    let spineId = SignalSpineGenerator.BASE_ID;

    // Obstacle-host platforms. A gap touching one of these is an "obstacle
    // section": it stays eligible for a (skinner) recovery spine.
    const obstacleHostIds = new Set<number>();
    const obstacleLaneByHost = new Map<number, number>();
    for (const obstacle of context.obstacles ?? []) {
      if (obstacle.obstacleSourceNodeId === undefined) continue;
      obstacleHostIds.add(obstacle.obstacleSourceNodeId);
      const lane = obstacle.obstacleSafeLane === 'LEFT' ? -1
        : obstacle.obstacleSafeLane === 'RIGHT' ? 1
          : 0;
      if (lane !== 0 && !obstacleLaneByHost.has(obstacle.obstacleSourceNodeId)) {
        obstacleLaneByHost.set(obstacle.obstacleSourceNodeId, lane);
      }
    }

    // Track which node gaps already have a spine to avoid duplicate stacking
    const coveredGaps = new Set<string>();

    let smallChainConnectors = 0;
    let mediumLargeConnectors = 0;
    let microBarConnectors = 0;
    let highRiskTransfersFound = 0;
    let highRiskConnectorsGenerated = 0;
    let obstacleTransfersFound = 0;
    let obstacleConnectorsGenerated = 0;
    let transfersLeftUnsupported = 0;
    let consecutiveUnsupportedHighRisk = 0;
    let consecutiveUnsupportedObstacle = 0;

    let eligibleGaps = 0;
    let rejectedCount = 0;
    const rejectionReasons: Record<string, number> = {};

    const recordRejection = (reason: string) => {
      rejectedCount++;
      rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
    };

    // Pre-scan surf exit indices to identify post-surf re-entry zones
    const postSurfEligibleGaps = new Set<string>();
    for (let i = 0; i < route.length - 1; i++) {
      if (route[i].isSurf && !route[i + 1].isSurf) {
        // Guarantee coverage for the first 3-5 platforms post-surf
        const maxCoverage = Math.min(route.length - 1, i + 5);
        for (let j = i + 1; j < maxCoverage; j++) {
          if (route[j + 1].isSurf || route[j + 1].type === RouteNodeType.FINISH) break;
          postSurfEligibleGaps.add(`${route[j].id}->${route[j + 1].id}`);
        }
      }
    }

    // -------------------------------------------------------------------------
    // PROCEDURAL CONNECTOR EVALUATION (Across All Consecutive Pairs)
    // -------------------------------------------------------------------------
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i];
      const b = route[i + 1];

      // Exclude surf ramps (surfing geometry is handled by surf physics) and finish gate
      if (a.isSurf || b.isSurf || a.type === RouteNodeType.FINISH || b.type === RouteNodeType.FINISH) {
        continue;
      }

      const gapKey = `${a.id}->${b.id}`;
      if (coveredGaps.has(gapKey)) continue;

      const section = analysis.sections?.[a.sectionIndex];
      const theme = section?.theme;
      if (theme === 'DROP' && i < 6) {
        recordRejection('initial_colossal_drop_leap');
        continue;
      }

      // Compute physical top surface anchors
      const exitTopA = SignalSpineGenerator.getNodeExitTop(a);
      const entryTopB = SignalSpineGenerator.getNodeEntryTop(b);

      const dx = entryTopB.x - exitTopA.x;
      const dy = entryTopB.y - exitTopA.y;
      const dz = entryTopB.z - exitTopA.z;
      const gapHoriz = Math.hypot(dx, dz);
      const gap3D = Math.hypot(gapHoriz, dy);

      // Skip non-gaps (platforms virtually touching or overlapping)
      if (gapHoriz < 1.0) {
        continue;
      }

      eligibleGaps++;

      // Physical sanity bounds: skip impossible leaps or vertical cliffs
      if (gap3D > 22.0) {
        recordRejection('gap_too_wide_for_connector');
        continue;
      }

      const pitch = -Math.atan2(dy, gapHoriz);
      // Slope > 30 degrees is a steep drop or wall, not a runnable connector
      if (Math.abs(pitch) > 0.6) {
        recordRejection('pitch_too_steep');
        continue;
      }

      // Platform size classification
      const minPlatWidth = Math.min(a.dimensions.x, b.dimensions.x);
      const minPlatLen = Math.min(a.dimensions.z, b.dimensions.z);

      // Micro-platform / bar chain classification:
      // Sequences of tiny bars, narrow beams, micro-platforms (width <= 6.5m or length <= 14m),
      // or explicit PRECISION theme sections.
      const isMicroBarChain = minPlatWidth <= 6.5 || minPlatLen <= 14.0 || theme === 'PRECISION';
      const isSmall = !isMicroBarChain && (minPlatWidth <= 8.5 || minPlatLen <= 18.0);

      // Gameplay sequence classifications
      const isPostSurfReentry = postSurfEligibleGaps.has(gapKey);
      const isAscentChain =
        a.type === RouteNodeType.STEP_UP ||
        b.type === RouteNodeType.STEP_UP ||
        a.type === RouteNodeType.ASCENT_CHAIN ||
        b.type === RouteNodeType.ASCENT_CHAIN ||
        a.ascentVariant !== undefined ||
        b.ascentVariant !== undefined ||
        Math.abs(b.position.y - a.position.y) > 0.25;

      // Obstacle sections: an obstacle-host platform on either side of the gap.
      // These transfers stay eligible for a SKINNY recovery spine (never a wide
      // easy bridge) and may not form long zero-recovery sequences.
      const isObstacleSection = obstacleHostIds.size > 0 &&
        (obstacleHostIds.has(a.id) || obstacleHostIds.has(b.id));
      const obstacleLaneBias = obstacleLaneByHost.get(a.id) ?? obstacleLaneByHost.get(b.id) ?? 0;

      let qualify = false;
      let isMicroChain = false;
      let isSmallChain = false;
      let isObstacleChain = false;

      if (isMicroBarChain) {
        // High-Risk Transfer Chain (Micro-platforms, tiny bars, precision landings)
        highRiskTransfersFound++;

        // COVERAGE RULE:
        // Provide Signal Spine on a majority of these transfers (~70-85%), with occasional
        // intentional open jumps so danger remains real.
        // Never allow 3+ consecutive micro-bar leaps with zero recovery option.
        // Max consecutive unsupported high-risk transfers must be <= 2.
        if (consecutiveUnsupportedHighRisk >= 2) {
          qualify = true;
        } else {
          // 84% coverage target: comfortably inside the 70-85% rule even after
          // route-shape variance, so high-tempo stagger chains never lose
          // recovery.
          const roll = rng.next();
          if (roll < 0.84) {
            qualify = true;
          } else {
            consecutiveUnsupportedHighRisk++;
            transfersLeftUnsupported++;
            recordRejection('intentional_high_risk_open_leap');
          }
        }

        if (qualify) {
          consecutiveUnsupportedHighRisk = 0;
          highRiskConnectorsGenerated++;
          isMicroChain = true;
        }
      } else if (isObstacleSection) {
        // Elevated risk: the obstacle already demands a read/dodge, so the
        // surrounding transfer keeps a skinny recovery option. Never allow two
        // consecutive obstacle transfers with no recovery line.
        obstacleTransfersFound++;
        if (consecutiveUnsupportedObstacle >= 1) {
          qualify = true;
        } else if (rng.next() < 0.92) {
          qualify = true;
        } else {
          consecutiveUnsupportedObstacle++;
          transfersLeftUnsupported++;
          recordRejection('intentional_obstacle_open_leap');
        }
        if (qualify) {
          consecutiveUnsupportedObstacle = 0;
          obstacleConnectorsGenerated++;
          isObstacleChain = true;
        }
      } else if (isPostSurfReentry) {
        // Category 1: Post-surf landing platform chains (100% coverage)
        qualify = true;
        isSmallChain = isSmall;
      } else if (isAscentChain) {
        // Category 2: Staircases & Step-Ups / Ascent Chains (100% coverage)
        qualify = true;
        isSmallChain = isSmall;
      } else if (isSmall) {
        // Category 3: Small-platform chains (100% coverage when gap >= 1.4m)
        if (gapHoriz >= 1.4) {
          qualify = true;
          isSmallChain = true;
        } else {
          recordRejection('small_chain_gap_too_short');
        }
      } else {
        // Category 4: Medium & Larger Platform Transfers (Broadened Qualifying Rule)
        if (gapHoriz >= 2.2) {
          // Select ~55% of medium/large transfers so they are common but not universal
          const qualifyRoll = rng.next();
          if (qualifyRoll < 0.55) {
            qualify = true;
            isSmallChain = false;
          } else {
            recordRejection('medium_large_open_void_jump');
          }
        } else {
          recordRejection('medium_large_gap_too_short');
        }
      }

      if (!qualify) continue;

      // -----------------------------------------------------------------------
      // CONTROLLED INSTANCE VARIATION
      // -----------------------------------------------------------------------
      const spineNodes = SignalSpineGenerator.createVariedTopSurfaceSpine(
        () => spineId++,
        a,
        b,
        exitTopA,
        entryTopB,
        gap3D,
        pitch,
        minPlatWidth,
        isMicroChain,
        isObstacleChain,
        obstacleLaneBias,
        isSmallChain,
        isPostSurfReentry,
        rng
      );

      if (spineNodes && spineNodes.length > 0) {
        // Coexistence guard: never let a recovery line clip an authoritative
        // obstacle collider. Obstacles live on platforms and spines span the
        // gap, so this is a safety net rather than the normal case.
        if (context.obstacles && SignalSpineGenerator.overlapsAnyObstacle(spineNodes, context.obstacles)) {
          recordRejection('spine_would_clip_obstacle');
          continue;
        }

        coveredGaps.add(gapKey);
        for (const spine of spineNodes) {
          spines.push(spine);
        }
        if (isMicroChain) {
          microBarConnectors += spineNodes.length;
        } else if (isObstacleChain) {
          // Gap counted at qualification time (obstacleConnectorsGenerated).
        } else if (isSmallChain) {
          smallChainConnectors += spineNodes.length;
        } else {
          mediumLargeConnectors += spineNodes.length;
        }
      }
    }

    SignalSpineGenerator.lastReport = {
      eligibleGaps,
      smallChainConnectors,
      mediumLargeConnectors,
      microBarConnectors,
      highRiskTransfersFound,
      highRiskConnectorsGenerated,
      obstacleTransfersFound,
      obstacleConnectorsGenerated,
      transfersLeftUnsupported,
      totalGenerated: spines.length,
      rejectedCount,
      rejectionReasons,
      coveredGapKeys: Array.from(coveredGaps)
    };

    return spines;
  }

  /**
   * SIGNAL SPINE CONTINUITY VALIDATION.
   *
   * For every gap that received recovery coverage, the union of its spine
   * segments must form one continuous surface from platform A's top to platform
   * B's top, at no less than one player diameter of width.
   *
   * This is the checkable form of the hard rule: NO HOLES in a covered spine.
   * Gaps with NO spine at all are intentional and are simply not part of this
   * report (that is how "intentionally unsupported hero section" stays legal).
   */
  public static validateContinuity(
    route: RouteNode[],
    spines: RouteNode[]
  ): SpineContinuityReport {
    const byId = new Map<number, RouteNode>();
    for (const node of route) byId.set(node.id, node);

    // Group recovery segments by the gap they cover.
    const groups = new Map<string, RouteNode[]>();
    for (const spine of spines) {
      const host = spine.signalSpineHostGap;
      if (!host) continue;
      const key = `${host.aId}->${host.bId}`;
      const list = groups.get(key);
      if (list) list.push(spine);
      else groups.set(key, [spine]);
    }

    const violations: SpineContinuityViolation[] = [];
    let segmentsChecked = 0;

    for (const [key, segments] of groups) {
      const host = segments[0].signalSpineHostGap!;
      const a = byId.get(host.aId);
      const b = byId.get(host.bId);
      if (!a || !b) {
        violations.push({
          gapKey: key,
          reason: 'missing_end_connection',
          detail: 'host platform not found in route'
        });
        continue;
      }

      const exitTopA = SignalSpineGenerator.getNodeExitTop(a);
      const entryTopB = SignalSpineGenerator.getNodeEntryTop(b);
      const dx = entryTopB.x - exitTopA.x;
      const dy = entryTopB.y - exitTopA.y;
      const dz = entryTopB.z - exitTopA.z;
      const gap3D = Math.hypot(dx, dy, dz);
      if (gap3D < 1e-3) continue;

      const ux = dx / gap3D;
      const uy = dy / gap3D;
      const uz = dz / gap3D;

      // Project each segment's top surface onto the gap axis.
      const intervals: Array<{ start: number; end: number; width: number }> = [];
      for (const seg of segments) {
        segmentsChecked++;
        const topCenterY = seg.position.y + seg.dimensions.y * 0.5;
        const relX = seg.position.x - exitTopA.x;
        const relY = topCenterY - exitTopA.y;
        const relZ = seg.position.z - exitTopA.z;
        const centerU = relX * ux + relY * uy + relZ * uz;
        const halfLen = seg.dimensions.z * 0.5;
        intervals.push({
          start: centerU - halfLen,
          end: centerU + halfLen,
          width: seg.dimensions.x
        });

        if (seg.dimensions.x < RECOVERY_MIN_WIDTH - 1e-6) {
          violations.push({
            gapKey: key,
            reason: 'below_player_safe_width',
            detail: `segment width ${seg.dimensions.x.toFixed(3)}m < ${RECOVERY_MIN_WIDTH.toFixed(2)}m`
          });
        }
      }

      intervals.sort((p, q) => p.start - q.start);

      if (intervals[0].start > CONTINUITY_TOLERANCE) {
        violations.push({
          gapKey: key,
          reason: 'missing_start_connection',
          detail: `first segment starts ${intervals[0].start.toFixed(3)}m past the platform edge`
        });
      }

      const last = intervals[intervals.length - 1];
      if (last.end < gap3D - CONTINUITY_TOLERANCE) {
        violations.push({
          gapKey: key,
          reason: 'missing_end_connection',
          detail: `last segment ends ${(gap3D - last.end).toFixed(3)}m short of the next platform`
        });
      }

      let reach = intervals[0].end;
      for (let i = 1; i < intervals.length; i++) {
        const hole = intervals[i].start - reach;
        if (hole > CONTINUITY_TOLERANCE) {
          violations.push({
            gapKey: key,
            reason: 'hole_inside_spine',
            detail: `${hole.toFixed(3)}m uncovered between segments ${i - 1} and ${i}`
          });
        }
        reach = Math.max(reach, intervals[i].end);
      }
    }

    return {
      coveredGaps: groups.size,
      segmentsChecked,
      violations,
      isValid: violations.length === 0
    };
  }

  /**
   * Calculates the exact front exit anchor on the TOP playable surface of a node.
   */
  public static getNodeExitTop(node: RouteNode): THREE.Vector3 {
    const euler = new THREE.Euler(node.pitch || 0, node.yaw || 0, node.roll || 0, 'YXZ');
    const localExit = new THREE.Vector3(
      node.exitLateralOffset || 0,
      node.dimensions.y * 0.5,
      node.dimensions.z * 0.5
    ).applyEuler(euler);
    return new THREE.Vector3(
      node.position.x + localExit.x,
      node.position.y + localExit.y,
      node.position.z + localExit.z
    );
  }

  /**
   * Calculates the exact rear entry anchor on the TOP playable surface of a node.
   */
  public static getNodeEntryTop(node: RouteNode): THREE.Vector3 {
    const euler = new THREE.Euler(node.pitch || 0, node.yaw || 0, node.roll || 0, 'YXZ');
    const localEntry = new THREE.Vector3(
      0,
      node.dimensions.y * 0.5,
      -node.dimensions.z * 0.5
    ).applyEuler(euler);
    return new THREE.Vector3(
      node.position.x + localEntry.x,
      node.position.y + localEntry.y,
      node.position.z + localEntry.z
    );
  }

  /**
   * Creates narrow, top-surface bridging spine segments with controlled width & shape variation.
   * Ensures zero under-slung geometry: top surface sits cleanly at the playable elevation.
   *
   * HARD CONTINUITY RULE:
   * A gap that receives Signal Spine coverage receives a CONTINUOUS traversable
   * surface from platform A's top to platform B's top. Shapes may still taper,
   * move laterally, step, and change width — but every shape spans the full gap
   * and every segment is at least one player diameter wide. There are no holes,
   * no "broken" middle sections and no partial tongues, because the player must
   * never fall because the recovery path itself contained a gap.
   *
   * Visual fragmentation is preserved separately (material/emissive treatment),
   * never by removing collision.
   *
   * Shapes:
   * 1. TAPERED: wider at platform attachments, narrower through the middle.
   * 2. OFFSET:  shifted left or right rather than always centred.
   * 3. STEPPED: overlapping segments with alternating lateral offsets — reads as
   *             a fragmented signal trim while remaining one continuous surface.
   * 4. DEFAULT: straight / curved catwalk.
   */
  private static createVariedTopSurfaceSpine(
    nextId: () => number,
    a: RouteNode,
    b: RouteNode,
    exitTopA: THREE.Vector3,
    entryTopB: THREE.Vector3,
    gap3D: number,
    pitch: number,
    minPlatWidth: number,
    isMicroChain: boolean,
    isObstacleChain: boolean,
    obstacleLaneBias: number,
    isSmallChain: boolean,
    isPostSurfReentry: boolean,
    rng: SeededRandom
  ): RouteNode[] {
    const dx = entryTopB.x - exitTopA.x;
    const dz = entryTopB.z - exitTopA.z;
    const yaw = Math.atan2(dx, dz);

    // Micro chains and obstacle sections share the SKINNY recovery profile.
    // Obstacle difficulty and precision-gap difficulty must not stack, but the
    // recovery line must also never turn the obstacle into a wide easy bridge.
    const isSkinnyRecovery = isMicroChain || isObstacleChain;

    // 1. Adaptive Width according to Movement Phrase:
    // - micro-bar / obstacle-section recovery: ~6–12% of local usable width
    // - post-surf catch / very punishing transfer: ~20–25% of local platform width
    // - normal small-platform chain: ~12–18%
    // - medium / large transfer recovery line: ~8–12%
    let widthRatio: number;
    let minWidthCap: number;
    let maxWidthCap: number;

    if (isMicroChain) {
      widthRatio = rng.nextFloat(0.06, 0.12);
      minWidthCap = 0.35;
      maxWidthCap = Math.max(0.60, minPlatWidth * 0.14);
    } else if (isObstacleChain) {
      // Obstacle-section recovery line: skinny (~6-12% of platform width) but
      // always at least one player diameter, so a recovery landing is
      // genuinely catchable without turning the obstacle into a wide bridge.
      widthRatio = rng.nextFloat(0.06, 0.12);
      minWidthCap = RECOVERY_MIN_WIDTH;
      maxWidthCap = Math.max(RECOVERY_MIN_WIDTH, minPlatWidth * 0.14);
    } else if (isPostSurfReentry) {
      widthRatio = rng.nextFloat(0.20, 0.25);
      minWidthCap = 1.20;
      maxWidthCap = 2.40;
    } else if (isSmallChain) {
      widthRatio = rng.nextFloat(0.12, 0.18);
      minWidthCap = 0.95;
      maxWidthCap = 1.70;
    } else {
      widthRatio = rng.nextFloat(0.08, 0.12);
      minWidthCap = 0.80;
      maxWidthCap = 1.40;
    }

    const baseWidth = Math.max(
      RECOVERY_MIN_WIDTH,
      Math.max(minWidthCap, Math.min(maxWidthCap, minPlatWidth * widthRatio))
    );
    const spineThickness = Math.min(isSkinnyRecovery ? 0.30 : 0.40, Math.min(a.dimensions.y, b.dimensions.y) * 0.35);
    // Obstacle sections bias the recovery line toward the obstacle's safe lane
    // so a player recovering from a dodge is already lined up with the opening.
    const laneShift = obstacleLaneBias !== 0
      ? obstacleLaneBias * Math.min(1.0, Math.max(0, (minPlatWidth - baseWidth) * 0.5))
      : 0;
    const overlap = rng.nextFloat(0.40, 0.80);
    const totalSpan = gap3D + overlap * 2.0;

    // Unit direction from exitTopA to entryTopB
    const dir = new THREE.Vector3(dx, entryTopB.y - exitTopA.y, dz).normalize();
    const spanStart = exitTopA.clone().addScaledVector(dir, -overlap);
    const spanEnd = entryTopB.clone().addScaledVector(dir, overlap);
    const lateralDir = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    const makeSegment = (
      uStart: number,
      uEnd: number,
      segWidth: number,
      latShift: number,
      variant: 'STRAIGHT' | 'OFFSET' | 'CURVED' | 'DIP' | 'CATWALK' | 'SHALLOW_SURF' | 'TAPERED' | 'STEPPED'
    ): RouteNode => {
      const segLen = Math.max(0.2, (uEnd - uStart) * totalSpan);
      const uMid = (uStart + uEnd) * 0.5;
      const topMid = spanStart.clone().lerp(spanEnd, uMid);
      if (latShift !== 0) {
        topMid.addScaledVector(lateralDir, latShift);
      }
      // Rest 2.5cm atop platform surface
      topMid.y += 0.025;

      const topOffset = new THREE.Vector3(0, spineThickness * 0.5, 0).applyEuler(
        new THREE.Euler(pitch, yaw, 0, 'YXZ')
      );
      const spinePos = new THREE.Vector3().subVectors(topMid, topOffset);

      // HARD RULE: every generated segment is at least one player diameter wide,
      // so the continuous recovery surface is always genuinely catchable.
      const safeWidth = Math.max(RECOVERY_MIN_WIDTH, segWidth);

      return {
        id: nextId(),
        time: a.time,
        position: { x: spinePos.x, y: spinePos.y, z: spinePos.z },
        dimensions: { x: safeWidth, y: spineThickness, z: segLen },
        yaw,
        pitch,
        roll: 0,
        type: RouteNodeType.RUNWAY,
        intensity: a.intensity * 0.8,
        sectionIndex: a.sectionIndex,
        arcLength: a.arcLength,
        isSurf: false,
        isBoost: false,
        isOptional: true,
        isSignalSpine: true,
        signalSpineVariant: variant,
        signalSpineHostGap: { aId: a.id, bId: b.id }
      };
    };

    // Shape Selection — every shape spans the FULL gap continuously.
    const turnAngle = b.yaw - a.yaw;
    const isCurved = Math.abs(turnAngle) > 0.05;
    const shapeRoll = rng.next();

    let chosenShape: 'TAPERED' | 'OFFSET' | 'STEPPED' | 'DEFAULT';

    if (shapeRoll < 0.34 && gap3D >= 2.5) {
      chosenShape = 'TAPERED';
    } else if (shapeRoll < 0.62) {
      chosenShape = 'OFFSET';
    } else if (shapeRoll < 0.82 && gap3D >= 3.0) {
      chosenShape = 'STEPPED';
    } else {
      chosenShape = 'DEFAULT';
    }

    // 1. TAPERED SPINE:
    // Wider at platform attachments, narrower through the middle. Spans the full
    // gap (0.0 -> 1.0) so both ends connect directly to their platforms.
    if (chosenShape === 'TAPERED') {
      const entryWidth = isSkinnyRecovery
        ? Math.min(minPlatWidth * 0.16, baseWidth * 1.3)
        : Math.min(2.6, Math.min(minPlatWidth * 0.30, baseWidth * 1.35));
      const midWidth = isSkinnyRecovery
        ? Math.max(RECOVERY_MIN_WIDTH, baseWidth * 0.78)
        : Math.max(RECOVERY_MIN_WIDTH, baseWidth * 0.78);

      return [
        makeSegment(0.0, 0.28, entryWidth, laneShift, 'TAPERED'),
        makeSegment(0.27, 0.73, midWidth, laneShift, 'TAPERED'),
        makeSegment(0.72, 1.0, entryWidth, laneShift, 'TAPERED')
      ];
    }

    // 2. OFFSET SPINE:
    // Slightly left or right of centre rather than always centred.
    if (chosenShape === 'OFFSET') {
      const turnSign = Math.abs(turnAngle) > 0.02
        ? (turnAngle > 0 ? 1 : -1)
        : (rng.next() < 0.5 ? 1 : -1);
      const maxShift = isSkinnyRecovery
        ? Math.min(0.6, Math.max(0, (minPlatWidth - baseWidth) * 0.25))
        : Math.min(2.4, Math.max(0, (minPlatWidth - baseWidth) * 0.35));
      const shift = turnSign * rng.nextFloat(0.45, 0.85) * maxShift + laneShift;

      return [makeSegment(0.0, 1.0, baseWidth, shift, 'OFFSET')];
    }

    // 3. STEPPED SPINE:
    // Overlapping segments with alternating lateral offsets. This is the visual
    // "fragmented signal trim" read — but the segments OVERLAP in span space, so
    // the walkable core is one continuous surface with no hole anywhere.
    if (chosenShape === 'STEPPED') {
      const lateralRange = Math.min(0.9, Math.max(0, (minPlatWidth - baseWidth) * 0.24));
      const stepSign = Math.abs(turnAngle) > 0.02 ? (turnAngle > 0 ? 1 : -1) : 1;
      const lateralA = laneShift;
      const lateralB = laneShift + stepSign * lateralRange;
      const lateralC = laneShift;

      return [
        makeSegment(0.0, 0.38, baseWidth, lateralA, 'STEPPED'),
        makeSegment(0.35, 0.70, baseWidth, lateralB, 'STEPPED'),
        makeSegment(0.67, 1.0, baseWidth, lateralC, 'STEPPED')
      ];
    }

    // 4. DEFAULT (STRAIGHT / CURVED / CATWALK) — one continuous span.
    const variant = isCurved ? 'CURVED' : (baseWidth <= 0.8 ? 'CATWALK' : 'STRAIGHT');
    return [makeSegment(0.0, 1.0, baseWidth, laneShift, variant)];
  }

  /**
   * Conservative cylinder overlap used to guarantee a recovery spine never
   * clips an authoritative obstacle collider. Over-rejecting is safe.
   */
  private static overlapsAnyObstacle(spineNodes: RouteNode[], obstacles: RouteNode[]): boolean {
    for (const spine of spineNodes) {
      for (const obstacle of obstacles) {
        const sx = Math.hypot(spine.dimensions.x, spine.dimensions.z) * 0.5;
        const ox = Math.hypot(obstacle.dimensions.x, obstacle.dimensions.z) * 0.5;
        const dx = spine.position.x - obstacle.position.x;
        const dz = spine.position.z - obstacle.position.z;
        const reach = sx + ox;
        if (dx * dx + dz * dz >= reach * reach) continue;
        const dy = Math.abs(spine.position.y - obstacle.position.y);
        if (dy < (spine.dimensions.y + obstacle.dimensions.y) * 0.5) return true;
      }
    }
    return false;
  }
}
