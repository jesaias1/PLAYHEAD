import { AnalysisSection, TrackAnalysis } from '../audio/AudioFeatures';
import { RouteNode, RouteNodeType, RouteObstacleType, Vector3Like } from './GenerationTypes';
import { SeededRandom } from './SeededRandom';

const MIN_CHALLENGE_SPACING = 72;
const MIN_SAFE_LANE = 5.25;
const MAX_OBSTACLES = 8;

const ELIGIBLE_TYPES = new Set<RouteNodeType>([
  RouteNodeType.RUNWAY,
  RouteNodeType.WIDE_FLOW,
  RouteNodeType.LANDING,
  RouteNodeType.BOOST
]);

/**
 * Deterministic, deliberately sparse gameplay challenges. These are generated
 * after route repair so they never influence the authored traversal chain.
 */
export class RouteChallengeGenerator {
  public static generate(route: RouteNode[], analysis: TrackAnalysis): RouteNode[] {
    if (route.length < 8) return [];

    const rng = new SeededRandom((analysis.seed ^ 0x524f5554) >>> 0);
    const obstacles: RouteNode[] = [];
    let lastArcLength = -Infinity;
    let lastType: RouteObstacleType | null = null;
    let obstacleId = 1_000_000;
    const maxForRoute = Math.min(MAX_OBSTACLES, Math.max(1, Math.floor(route.length / 9)));

    for (let i = 2; i < route.length - 3 && obstacles.length < maxForRoute; i++) {
      const node = route[i];
      const section = analysis.sections[node.sectionIndex];
      if (!section || !this.isEligibleNode(route, i, node)) continue;
      if (node.arcLength - lastArcLength < MIN_CHALLENGE_SPACING) continue;
      if (!rng.nextBool(this.densityForSection(section))) continue;

      const available = this.archetypesForSection(section).filter(type => type !== lastType);
      const obstacleType = rng.choice(available.length > 0 ? available : this.archetypesForSection(section));
      const obstacle = this.createObstacle(node, obstacleType, obstacleId++, rng);
      if (!obstacle) continue;

      obstacles.push(obstacle);
      lastArcLength = node.arcLength;
      lastType = obstacleType;
    }

    return obstacles;
  }

  private static isEligibleNode(route: RouteNode[], index: number, node: RouteNode): boolean {
    if (
      node.time < 25 ||
      node.isSurf ||
      !ELIGIBLE_TYPES.has(node.type) ||
      node.dimensions.x < 12 ||
      node.dimensions.z < 22 ||
      Math.abs(node.pitch) > 0.01 ||
      Math.abs(node.roll) > 0.01
    ) return false;

    // Never stack an obstacle immediately beside a gate, ascent, finish, or
    // other precision transition. The platform itself owns this challenge.
    for (let offset = -2; offset <= 2; offset++) {
      if (offset === 0) continue;
      const neighbour = route[index + offset];
      if (!neighbour) continue;
      if (
        neighbour.type === RouteNodeType.CHECKPOINT ||
        neighbour.type === RouteNodeType.FINISH ||
        neighbour.type === RouteNodeType.STEP_UP ||
        neighbour.isSurf
      ) return false;
    }
    return true;
  }

  private static densityForSection(section: AnalysisSection): number {
    if (section.theme === 'DROP' || section.theme === 'BREATH' || section.theme === 'SURF') return 0;
    if (section.theme === 'BUILDUP') return 0.42;
    if (section.theme === 'PRECISION') return 0.34;
    if (section.rhythmicDensity >= 0.72) return 0.30;
    if (section.theme === 'SPEED') return 0.18;
    return 0.22;
  }

  private static archetypesForSection(section: AnalysisSection): RouteObstacleType[] {
    if (section.theme === 'BUILDUP') return ['SIGNAL_SHUTTER', 'SPLIT_GATE', 'SCAN_BAR'];
    if (section.theme === 'PRECISION' || section.rhythmicDensity >= 0.72) {
      return ['SCAN_BAR', 'SPLIT_GATE', 'SIGNAL_SHUTTER'];
    }
    return ['SIGNAL_SHUTTER', 'SCAN_BAR'];
  }

  private static createObstacle(
    source: RouteNode,
    type: RouteObstacleType,
    id: number,
    rng: SeededRandom
  ): RouteNode | null {
    const platformTop = source.position.y + source.dimensions.y * 0.5;
    const localZ = Math.min(2.5, source.dimensions.z * 0.1);
    let width: number;
    let height: number;
    let depth: number;
    let localX = 0;
    let safeLane: RouteNode['obstacleSafeLane'];

    if (type === 'SCAN_BAR') {
      width = source.dimensions.x - 1.4;
      height = 0.62;
      depth = 0.55;
      safeLane = 'JUMP';
    } else if (type === 'SIGNAL_SHUTTER') {
      width = Math.min(4.4, source.dimensions.x * 0.32);
      height = 3.6;
      depth = 0.9;
      safeLane = 'BOTH';
      if ((source.dimensions.x - width) * 0.5 < MIN_SAFE_LANE) return null;
    } else {
      const openSide: 'LEFT' | 'RIGHT' = rng.nextBool() ? 'LEFT' : 'RIGHT';
      const edgeMargin = 0.75;
      width = source.dimensions.x - MIN_SAFE_LANE - edgeMargin;
      if (width < 3.0) return null;
      height = 4.2;
      depth = 0.95;
      const blockedSide = openSide === 'LEFT' ? 1 : -1;
      localX = blockedSide * (source.dimensions.x * 0.5 - edgeMargin - width * 0.5);
      safeLane = openSide;
    }

    const centerHeight = type === 'SCAN_BAR' ? height * 0.5 : height * 0.5;
    const position = localToWorld(source, localX, platformTop - source.position.y + centerHeight, localZ);
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
      obstacleTelegraphDistance: type === 'SCAN_BAR' ? 15 : 18,
      obstacleSourceNodeId: source.id
    };
  }
}

function localToWorld(source: RouteNode, localX: number, localY: number, localZ: number): Vector3Like {
  const sin = Math.sin(source.yaw);
  const cos = Math.cos(source.yaw);
  return {
    x: source.position.x + cos * localX + sin * localZ,
    y: source.position.y + localY,
    z: source.position.z - sin * localX + cos * localZ
  };
}

export const ROUTE_CHALLENGE_LIMITS = {
  minSpacing: MIN_CHALLENGE_SPACING,
  minSafeLane: MIN_SAFE_LANE,
  maxObstacles: MAX_OBSTACLES
} as const;
