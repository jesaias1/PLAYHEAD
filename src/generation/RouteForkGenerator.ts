/**
 * ROUTE FORKS — controlled SAFE vs FLOW/MASTERY movement choices.
 *
 * Design:
 * - A fork is a POST-PASS over an already-validated main route. The main route
 *   (the SAFE line) is never modified, so it stays byte-identical for a given
 *   analysis/seed and is guaranteed traversable by the existing validator.
 * - The MASTERY branch is a narrow, straight "cut line" that runs parallel to
 *   the main route's span, offset to the side the main route's curve does NOT
 *   occupy. It is entered from the edge of the entry platform (exactly like the
 *   existing optional side-surf ramps) and rejoins at a later main platform.
 * - Because the branch follows the chord while the main route follows its arc,
 *   the mastery line is naturally shorter and has fewer landings. The reward is
 *   movement quality, not a hidden timer bonus.
 * - Everything is deterministic: one SeededRandom derived from the analysis
 *   seed, no unseeded randomness.
 *
 * Gameplay protection: this module only produces RouteNodes. It never touches
 * movement, surf physics, obstacles, spines, TempoPressure or timing.
 */

import { TrackAnalysis } from '../audio/AudioFeatures';
import { ForkType, RouteFork, RouteNode, RouteNodeType } from './GenerationTypes';
import { SeededRandom } from './SeededRandom';
import { getPlatformMaxHalfWidth } from './PlatformShape';
import { getNodeExitAnchor, getNodeEntryAnchor } from './RouteConnectivityValidator';
import { RouteChallengeGenerator } from './RouteChallengeGenerator';

export type { ForkType, RouteFork };

export interface ForkGenerationReport {
  attempts: number;
  accepted: number;
  rejectedNoCandidate: number;
  rejectedGeometry: number;
  rejectedSolvability: number;
  rejectedArchitecture: number;
  rejectedRejoin: number;
  byType: Record<string, number>;
}

const FORK_MIN_SPACING = 320;
const FORK_MIN_ARC_SPAN = 70;
const FORK_MAX_ARC_SPAN = 300;
const MAX_FORKS = 3;
const MIN_PLATFORM_WIDTH = 8.0;
const MAX_AIR_GAP = 9.5;
const MIN_AIR_GAP = 2.5;
const MAX_STEP_UP = 1.4;
const MIN_CLEARANCE = 2.5;
const MAX_ENTRY_HOP = 7.0;

interface ForkParameters {
  length: number;
  width: number;
  gap: number;
  stagger: number;
  lift: number;
  surf: boolean;
  surfRoll: number;
}

interface BranchFit {
  count: number;
  length: number;
  airGap: number;
  score: number;
}

/**
 * Chooses a platform count/length whose air gap fits both the available chord
 * and the movement envelope.
 */
function fitBranch(
  chordLen: number,
  desiredLength: number,
  desiredGap: number,
  minLength: number,
  minCount = 2,
  maxCount = 5
): BranchFit | null {
  let best: BranchFit | null = null;
  for (let count = Math.max(2, minCount); count <= maxCount; count++) {
    const gaps = count - 1;
    const hi = (chordLen - gaps * MIN_AIR_GAP) / count;
    const lo = (chordLen - gaps * MAX_AIR_GAP) / count;
    if (hi < minLength) continue;
    const length = Math.min(Math.max(desiredLength, lo), hi);
    if (length < minLength) continue;
    const airGap = (chordLen - count * length) / gaps;
    if (airGap < MIN_AIR_GAP - 1e-6 || airGap > MAX_AIR_GAP + 1e-6) continue;
    const score = Math.abs(airGap - desiredGap) + Math.abs(length - desiredLength) * 0.35;
    if (!best || score < best.score) best = { count, length, airGap, score };
  }
  return best;
}

/**
 * Edge-to-edge air gap between two platforms, measured in the outgoing
 * platform's frame. This is the distance the player actually has to clear,
 * which is the correct model for a lateral side-entry (unlike centre-to-centre).
 */
function airGapBetween(a: RouteNode, b: RouteNode): { gap: number; dy: number } {
  const ea = getNodeExitAnchor(a).position;
  const eb = getNodeEntryAnchor(b).position;
  const dx = eb.x - ea.x;
  const dz = eb.z - ea.z;
  const fx = Math.sin(a.yaw || 0);
  const fz = Math.cos(a.yaw || 0);
  const px = -fz;
  const pz = fx;

  const along = dx * fx + dz * fz;
  const lateral = dx * px + dz * pz;

  const gapAlong = Math.max(0, along);
  const gapLat = Math.max(
    0,
    Math.abs(lateral) - getPlatformMaxHalfWidth(a) - getPlatformMaxHalfWidth(b)
  );

  return { gap: Math.hypot(gapAlong, gapLat), dy: eb.y - ea.y };
}

function transferFeasible(gap: number, dy: number): boolean {
  if (!Number.isFinite(gap)) return false;
  if (gap > MAX_AIR_GAP + 0.05) return false;
  if (dy > MAX_STEP_UP + 0.02) return false;
  if (dy < -22.0) return false;
  return true;
}

export class RouteForkGenerator {
  private static lastReport: ForkGenerationReport | null = null;

  public static getLastReport(): ForkGenerationReport | null {
    return RouteForkGenerator.lastReport;
  }

  /**
   * Builds deterministic forks for a repaired main route.
   * `tempoPressure` (0..1) only changes fork LANGUAGE, never fork count.
   */
  public static generate(
    route: RouteNode[],
    analysis: TrackAnalysis,
    tempoPressure: number
  ): RouteFork[] {
    const report: ForkGenerationReport = {
      attempts: 0,
      accepted: 0,
      rejectedNoCandidate: 0,
      rejectedGeometry: 0,
      rejectedSolvability: 0,
      rejectedArchitecture: 0,
      rejectedRejoin: 0,
      byType: {}
    };
    RouteForkGenerator.lastReport = report;

    if (route.length < 24) return [];

    const rng = new SeededRandom((analysis.seed ^ 0x464f524b) >>> 0);
    const forks: RouteFork[] = [];

    const totalDistance = route[route.length - 1].arcLength;
    const targetCount = Math.min(MAX_FORKS, Math.max(1, Math.round(totalDistance / 2000)));

    let nextId = 70000;
    const allocateId = () => nextId++;
    let lastForkArc = -Infinity;

    for (let i = 6; i < route.length - 8 && forks.length < targetCount; i++) {
      const entry = route[i];
      if (entry.arcLength - lastForkArc < FORK_MIN_SPACING) continue;

      const candidate = RouteForkGenerator.findSpan(route, analysis, i);
      if (!candidate) {
        report.rejectedNoCandidate++;
        continue;
      }
      report.attempts++;

      const built = RouteForkGenerator.buildFork(
        route,
        analysis,
        candidate.entryIndex,
        candidate.rejoinIndex,
        tempoPressure,
        rng,
        nextId,
        allocateId
      );
      if (!built) {
        report.rejectedGeometry++;
        continue;
      }

      const failure = RouteForkGenerator.validateFork(route, built);
      if (failure) {
        if (failure === 'solvability') report.rejectedSolvability++;
        else if (failure === 'architecture') report.rejectedArchitecture++;
        else report.rejectedRejoin++;
        continue;
      }

      forks.push(built);
      report.accepted++;
      report.byType[built.type] = (report.byType[built.type] || 0) + 1;
      lastForkArc = route[candidate.rejoinIndex].arcLength;
      i = candidate.rejoinIndex;
    }

    return forks;
  }

  /**
   * Finds a suitable main-route span starting at `startIndex`: level, non-surf,
   * not a checkpoint/finish/step-up, and in a section where a route choice is
   * musically sensible (never a release/breath passage).
   */
  private static findSpan(
    route: RouteNode[],
    analysis: TrackAnalysis,
    startIndex: number
  ): { entryIndex: number; rejoinIndex: number } | null {
    for (let span = 3; span <= 5; span++) {
      const rejoinIndex = startIndex + span;
      if (rejoinIndex >= route.length - 3) return null;

      const entry = route[startIndex];
      const rejoin = route[rejoinIndex];
      const arcSpan = rejoin.arcLength - entry.arcLength;
      if (arcSpan < FORK_MIN_ARC_SPAN || arcSpan > FORK_MAX_ARC_SPAN) continue;

      let ok = true;
      for (let k = startIndex; k <= rejoinIndex; k++) {
        const n = route[k];
        const theme = analysis.sections[n.sectionIndex]?.theme;
        if (
          n.isSurf ||
          n.type === RouteNodeType.CHECKPOINT ||
          n.type === RouteNodeType.FINISH ||
          n.type === RouteNodeType.STEP_UP ||
          n.ascentVariant !== undefined ||
          theme === 'DROP' ||
          theme === 'BREATH' ||
          theme === 'SURF' ||
          theme === 'ASCENT' ||
          Math.abs(n.pitch) > 0.02 ||
          Math.abs(n.roll) > 0.02
        ) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      return { entryIndex: startIndex, rejoinIndex };
    }
    return null;
  }

  private static buildFork(
    route: RouteNode[],
    analysis: TrackAnalysis,
    entryIndex: number,
    rejoinIndex: number,
    tempoPressure: number,
    rng: SeededRandom,
    id: number,
    allocateId: () => number
  ): RouteFork | null {
    const entry = route[entryIndex];
    const rejoin = route[rejoinIndex];

    const entryExit = getNodeExitAnchor(entry).position;
    const rejoinEntry = getNodeEntryAnchor(rejoin).position;

    const dx = rejoinEntry.x - entryExit.x;
    const dz = rejoinEntry.z - entryExit.z;
    const chordLen = Math.hypot(dx, dz);
    if (chordLen < 45) return null;

    const ux = dx / chordLen;
    const uz = dz / chordLen;
    const perpX = -uz;
    const perpZ = ux;
    const yaw = Math.atan2(ux, uz);

    // Signed lateral deviation of the main route's interior nodes from the cut.
    let devPositive = 0;
    let devNegative = 0;
    let maxMainHalfWidth = 0;
    for (let k = entryIndex + 1; k < rejoinIndex; k++) {
      const p = route[k].position;
      const lateral = (p.x - entryExit.x) * perpX + (p.z - entryExit.z) * perpZ;
      if (lateral > devPositive) devPositive = lateral;
      if (-lateral > devNegative) devNegative = -lateral;
      const halfW = getPlatformMaxHalfWidth(route[k]);
      if (halfW > maxMainHalfWidth) maxMainHalfWidth = halfW;
    }

    // Put the branch on the side the main route's curve leaves free.
    const side = devPositive >= devNegative ? -1 : 1;
    const conflict = Math.min(devPositive, devNegative);

    const type = RouteForkGenerator.pickType(
      analysis.sections[entry.sectionIndex]?.theme ?? 'FLOW',
      tempoPressure,
      rng
    );
    const param = RouteForkGenerator.typeParameters(type, tempoPressure, rng);

    const branchHalfWidth = param.width * 0.5;
    const entryHalfWidth = getPlatformMaxHalfWidth(entry);

    // Vertical budget: the chord's own climb is spread across the branch's
    // platforms, so a steeper span needs more platforms before the lift on top
    // of it can stay inside the step-up envelope.
    const chordDy = rejoinEntry.y - entryExit.y;
    const minCountForVertical = Math.max(2, Math.ceil(Math.abs(chordDy) / 1.15));

    // Lateral offset: far enough that the branch never crowds the main route,
    // close enough that the entry hop off the platform edge stays generous.
    const minOffset = conflict + branchHalfWidth + maxMainHalfWidth + MIN_CLEARANCE;
    const maxOffset = entryHalfWidth + branchHalfWidth + MAX_ENTRY_HOP;
    const offset = Math.min(Math.max(minOffset, entryHalfWidth + branchHalfWidth + 3.0), maxOffset);
    if (offset < minOffset) {
      return null;
    }

    const fit = fitBranch(
      chordLen,
      param.length,
      param.gap,
      Math.max(14, branchHalfWidth * 2.4),
      minCountForVertical
    );
    if (!fit) {
      return null;
    }

    // Vertical profile (0 at both ends), then the lift is capped so that the
    // largest per-hop change stays inside the step-up envelope.
    const profiles: number[] = [];
    for (let n = 0; n < fit.count; n++) {
      const centerS = n * (fit.length + fit.airGap) + fit.length * 0.5;
      const t = Math.min(1, centerS / chordLen);
      profiles.push(Math.sin(Math.PI * t));
    }
    let maxProfileDelta = 0;
    for (let n = 0; n < profiles.length; n++) {
      const prev = n === 0 ? 0 : profiles[n - 1];
      maxProfileDelta = Math.max(maxProfileDelta, Math.abs(profiles[n] - prev));
    }
    const verticalSlack = Math.max(0, 1.15 - Math.abs(chordDy) / fit.count);
    const lift =
      maxProfileDelta > 1e-3
        ? Math.min(param.lift, verticalSlack / maxProfileDelta)
        : 0;

    const nodes: RouteNode[] = [];
    const speed = 16 + tempoPressure * 10;
    let cursor = 0;
    let staggerLat = 0;

    for (let n = 0; n < fit.count; n++) {
      const length = fit.length;
      const centerS = cursor + length * 0.5;
      cursor += length + fit.airGap;

      const t = Math.min(1, centerS / chordLen);

      // Lateral character. Staggered forks oscillate around the cut line but
      // stay on the safe side of it. Only the oscillation is envelope-limited:
      // the base offset is reached by running along the entry platform's edge.
      let targetStagger = 0;
      if (param.stagger > 0) {
        targetStagger = (n % 2 === 0 ? 1 : -1) * param.stagger;
      }
      const maxDelta = RouteChallengeGenerator.fitLateralOffset(
        Infinity,
        length + fit.airGap,
        speed
      );
      if (Math.abs(targetStagger - staggerLat) > maxDelta) {
        staggerLat = staggerLat + Math.sign(targetStagger - staggerLat) * maxDelta;
      } else {
        staggerLat = targetStagger;
      }
      const lateral = side * offset + side * staggerLat;

      const y = entryExit.y + chordDy * t + lift * profiles[n];

      const isSurfNode = param.surf && (n === 0 || n === fit.count - 1);
      const roll = isSurfNode ? param.surfRoll : 0;

      nodes.push({
        id: allocateId(),
        time: entry.time + (rejoin.time - entry.time) * t,
        position: {
          x: entryExit.x + ux * centerS + perpX * lateral,
          y,
          z: entryExit.z + uz * centerS + perpZ * lateral
        },
        dimensions: { x: param.width, y: 2.0, z: length },
        yaw,
        pitch: 0,
        roll,
        type: isSurfNode ? RouteNodeType.SURF_RAMP : RouteNodeType.RUNWAY,
        intensity: entry.intensity,
        sectionIndex: entry.sectionIndex,
        arcLength: entry.arcLength + centerS,
        isSurf: isSurfNode,
        surfNormal: isSurfNode ? { x: -Math.sin(roll), y: Math.cos(roll), z: 0 } : undefined,
        isBoost: false,
        isOptional: false,
        forkBranchType: type
      });
    }

    return {
      id,
      type,
      entryNodeId: entry.id,
      rejoinNodeId: rejoin.id,
      entryArcLength: entry.arcLength,
      rejoinArcLength: rejoin.arcLength,
      safeDistance: rejoin.arcLength - entry.arcLength,
      masteryDistance: RouteForkGenerator.measureBranch(entryExit, nodes, rejoinEntry),
      masteryNodes: nodes,
      validated: false
    };
  }

  private static pickType(
    theme: string,
    tempoPressure: number,
    rng: SeededRandom
  ): ForkType {
    const highTempo = tempoPressure >= 0.6;
    const lowTempo = tempoPressure <= 0.4;

    if (theme === 'SPEED') {
      if (highTempo) return rng.nextBool() ? 'SAFE_VS_STRAFE' : 'DIRECT_VS_TECHNICAL';
      return 'SAFE_VS_SURF';
    }
    if (lowTempo) {
      // Longer, graceful, broad alternatives.
      return rng.nextBool(0.55) ? 'SAFE_VS_SURF' : 'SAFE_VS_HIGH';
    }
    if (highTempo) {
      // Quicker technical alternatives.
      return rng.nextBool(0.6) ? 'SAFE_VS_STRAFE' : 'DIRECT_VS_TECHNICAL';
    }
    const pool: ForkType[] = [
      'SAFE_VS_STRAFE',
      'SAFE_VS_SURF',
      'SAFE_VS_HIGH',
      'DIRECT_VS_TECHNICAL'
    ];
    return rng.choice(pool);
  }

  private static typeParameters(
    type: ForkType,
    tempoPressure: number,
    rng: SeededRandom
  ): ForkParameters {
    switch (type) {
      case 'SAFE_VS_SURF':
        return {
          length: 24 + rng.nextFloat(0, 4),
          width: 12,
          gap: 5.5,
          stagger: 0,
          lift: 0,
          surf: true,
          surfRoll: 0.42
        };
      case 'SAFE_VS_HIGH':
        return {
          length: 22 + rng.nextFloat(0, 3),
          width: 11,
          gap: 6.0,
          stagger: 0,
          lift: 2.2 + tempoPressure * 0.6,
          surf: false,
          surfRoll: 0.42
        };
      case 'DIRECT_VS_TECHNICAL':
        return {
          length: 19 + rng.nextFloat(0, 2),
          width: 9,
          gap: 4.0,
          stagger: 1.5,
          lift: 0,
          surf: false,
          surfRoll: 0.42
        };
      case 'SAFE_VS_STRAFE':
      default:
        return {
          length: 21 + rng.nextFloat(0, 3),
          width: 10.5,
          gap: 5.5,
          stagger: 3.0,
          lift: 0,
          surf: false,
          surfRoll: 0.42
        };
    }
  }

  private static measureBranch(
    entryExit: { x: number; y: number; z: number },
    nodes: RouteNode[],
    rejoinEntry: { x: number; y: number; z: number }
  ): number {
    let dist = 0;
    let prevX = entryExit.x;
    let prevY = entryExit.y;
    let prevZ = entryExit.z;
    for (const n of nodes) {
      dist += Math.hypot(n.position.x - prevX, n.position.y - prevY, n.position.z - prevZ);
      prevX = n.position.x;
      prevY = n.position.y;
      prevZ = n.position.z;
    }
    dist += Math.hypot(rejoinEntry.x - prevX, rejoinEntry.y - prevY, rejoinEntry.z - prevZ);
    return dist;
  }

  /**
   * Validates the mastery branch end to end: entry transition, internal
   * transfers, rejoin transition, landing sizes, and separation from the main
   * route geometry.
   */
  private static validateFork(
    route: RouteNode[],
    fork: RouteFork
  ): 'solvability' | 'architecture' | 'rejoin' | null {
    const entry = route.find((n) => n.id === fork.entryNodeId);
    const rejoin = route.find((n) => n.id === fork.rejoinNodeId);
    if (!entry || !rejoin) return 'rejoin';

    const sequence: RouteNode[] = [entry, ...fork.masteryNodes, rejoin];
    for (let i = 0; i < sequence.length - 1; i++) {
      const a = sequence[i];
      const b = sequence[i + 1];
      const { gap, dy } = airGapBetween(a, b);
      if (!transferFeasible(gap, dy)) {
        return i === sequence.length - 2 ? 'rejoin' : 'solvability';
      }
      if (b.dimensions.x < MIN_PLATFORM_WIDTH) return 'solvability';
    }

    // The branch must never interpenetrate the main route's platforms. The
    // entry and rejoin platforms are the shared connection points.
    for (const node of fork.masteryNodes) {
      for (const other of route) {
        if (other.id === entry.id || other.id === rejoin.id) continue;
        const dx = node.position.x - other.position.x;
        const dz = node.position.z - other.position.z;
        const reach = getPlatformMaxHalfWidth(node) + getPlatformMaxHalfWidth(other) + 1.0;
        if (dx * dx + dz * dz >= reach * reach) continue;
        const dy = Math.abs(node.position.y - other.position.y);
        if (dy < (node.dimensions.y + other.dimensions.y) * 0.5) {
          return 'architecture';
        }
      }
    }

    fork.validated = true;
    return null;
  }
}

/**
 * Per-fork traversal sequences (entry → mastery nodes → rejoin). Used by the
 * void envelope to protect branch flight paths exactly like the main route.
 */
export function collectForkSequences(
  route: RouteNode[],
  forks: RouteFork[] | undefined
): RouteNode[][] {
  if (!forks || forks.length === 0) return [];
  const byId = new Map<number, RouteNode>();
  for (const node of route) byId.set(node.id, node);

  const sequences: RouteNode[][] = [];
  for (const fork of forks) {
    const entry = byId.get(fork.entryNodeId);
    const rejoin = byId.get(fork.rejoinNodeId);
    if (entry && rejoin) {
      sequences.push([entry, ...fork.masteryNodes, rejoin]);
    } else {
      sequences.push([...fork.masteryNodes]);
    }
  }
  return sequences;
}
