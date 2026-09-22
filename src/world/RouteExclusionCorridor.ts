/**
 * Authoritative Route Exclusion Corridor for PLAYHEAD
 * Enforces strict safety clearance around the playable route, surf ramps,
 * jump trajectories, and landing zones, preventing large brutalist monuments,
 * monoliths, and cantilevers from penetrating playable airspace or collision space.
 */

import * as THREE from 'three';
import { RouteNode, RouteNodeType } from '../generation/GenerationTypes';
import { getPlatformMaxHalfWidth } from '../generation/PlatformShape';

export interface ObjectBoundingVolume {
  position: THREE.Vector3;
  radius: number;
  minY: number;
  maxY: number;
}

export interface DecorationValidationReport {
  /** Meshes rejected because they penetrated the protected gameplay volume. */
  rejected: Array<{ name: string; penetration: number; nearNode: number }>;
  total: number;
}

export interface BuildingValidationReport {
  candidatesGenerated: number;
  rejectedByGameplayCollision: number;
  rejectedByComfortClearance: number;
  /** Tall structures whose vertical extent pierced the protected band. */
  rejectedByVerticalIntrusion: number;
  /** Structures intruding into a surf launch / travel corridor. */
  rejectedBySurfCorridor: number;
  finalSurvivingBuildings: number;
}

export type ViolationKind =
  | 'GAMEPLAY_OVERLAP'
  | 'SURF_CORRIDOR'
  | 'VERTICAL_INTRUSION'
  | 'COMFORT_CLEARANCE';

export interface VolumeEvaluationResult {
  penetration: number;
  nodeIndex: number;
  kind: ViolationKind;
  isGameplayCollision: boolean;
  isComfortViolation: boolean;
}

/**
 * Height of the protected vertical band above a route node.
 *
 * This is the player's usable airspace: a generous jump/launch apex plus
 * headroom. Architecture may pass overhead ABOVE this band, but nothing may
 * occupy it near the flight path.
 */
export const JUMP_CORRIDOR_ABOVE = 55.0;

/** Depth of protected airspace below a route node. */
export const JUMP_CORRIDOR_BELOW = 25.0;

export class RouteExclusionCorridor {
  public static readonly JUMP_CORRIDOR_ABOVE = JUMP_CORRIDOR_ABOVE;
  public static readonly JUMP_CORRIDOR_BELOW = JUMP_CORRIDOR_BELOW;

  private static lastBuildingReport: BuildingValidationReport = {
    candidatesGenerated: 0,
    rejectedByGameplayCollision: 0,
    rejectedByComfortClearance: 0,
    rejectedByVerticalIntrusion: 0,
    rejectedBySurfCorridor: 0,
    finalSurvivingBuildings: 0
  };

  public static getLastBuildingReport(): BuildingValidationReport {
    return RouteExclusionCorridor.lastBuildingReport;
  }

  public static resetBuildingReport(): void {
    RouteExclusionCorridor.lastBuildingReport = {
      candidatesGenerated: 0,
      rejectedByGameplayCollision: 0,
      rejectedByComfortClearance: 0,
      rejectedByVerticalIntrusion: 0,
      rejectedBySurfCorridor: 0,
      finalSurvivingBuildings: 0
    };
  }

  /**
   * Canonical list of every gameplay surface that decoration must protect:
   * main route, optional surf ramps, recovery shelves, signal spines AND the
   * obstacle solids that sit on the route. Using one helper everywhere means
   * no builder can silently protect a different envelope than the others.
   */
  public static collectGameplayNodes(track: {
    route: RouteNode[];
    optionalRamps?: RouteNode[];
    recoveryShelves?: RouteNode[];
    signalSpines?: RouteNode[];
    obstacles?: RouteNode[];
  }): RouteNode[] {
    return [
      ...track.route,
      ...(track.optionalRamps || []),
      ...(track.recoveryShelves || []),
      ...(track.signalSpines || []),
      ...(track.obstacles || [])
    ];
  }

  private mainRoute: RouteNode[];
  private independentNodes: RouteNode[];

  constructor(route: RouteNode[], secondaryNodes?: RouteNode[]) {
    if (secondaryNodes) {
      this.mainRoute = route;
      this.independentNodes = secondaryNodes;
    } else {
      this.mainRoute = [];
      this.independentNodes = [];
      for (const n of route) {
        if (n.isOptional || n.isSignalSpine) {
          this.independentNodes.push(n);
        } else {
          this.mainRoute.push(n);
        }
      }
    }
  }

  /**
   * Evaluates if a given bounding volume violates the route exclusion corridor.
   * Checks horizontal and vertical clearance against all route nodes, independent gameplay
   * surfaces (spines, shelves, optional surfs), and jump flight paths.
   */
  public isPointInsideCorridor(
    pos: THREE.Vector3,
    objectRadius: number,
    minY: number,
    maxY: number,
    extraSurfMargin = 20.0
  ): boolean {
    const box = new THREE.Box3(
      new THREE.Vector3(pos.x - objectRadius, minY, pos.z - objectRadius),
      new THREE.Vector3(pos.x + objectRadius, maxY, pos.z + objectRadius)
    );
    return this.evaluateVolume(box, extraSurfMargin) !== null;
  }

  /**
   * Attempts to find a safe position outside the exclusion corridor by
   * stepping along the outward direction. Returns null if no safe position is found.
   */
  public findSafeOffsetPosition(
    origin: THREE.Vector3,
    outwardDir: THREE.Vector3,
    initialDistance: number,
    objectRadius: number,
    minY: number,
    maxY: number,
    maxSteps = 8,
    stepDistance = 16.0
  ): THREE.Vector3 | null {
    const dir = outwardDir.clone().setY(0).normalize();
    if (dir.lengthSq() < 0.001) {
      dir.set(1, 0, 0);
    }

    for (let step = 0; step < maxSteps; step++) {
      const currentDist = initialDistance + step * stepDistance;
      const candidate = new THREE.Vector3(
        origin.x + dir.x * currentDist,
        origin.y,
        origin.z + dir.z * currentDist
      );

      const objMinY = candidate.y + minY;
      const objMaxY = candidate.y + maxY;

      if (!this.isPointInsideCorridor(candidate, objectRadius, objMinY, objMaxY)) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Final authoritative validation pass checking decorative meshes against
   * protected gameplay volumes.
   */
  public validateDecorationAgainstGameplay(group: THREE.Group, extraSurfMargin = 28.0): number {
    return this.validateDecorations([group], extraSurfMargin).total;
  }

  /**
   * Validates several decoration roots at once and returns a report.
   */
  public validateDecorations(roots: THREE.Object3D[], extraSurfMargin = 28.0): DecorationValidationReport {
    const rejected: Array<{ name: string; penetration: number; nearNode: number }> = [];
    let total = 0;

    for (const root of roots) {
      root.updateWorldMatrix(true, true);
      const leaves: THREE.Mesh[] = [];
      collectDecorationLeaves(root, leaves, 0);

      // Deepest first so nested children are evaluated individually rather than
      // collapsing an entire hierarchy into one oversized bounding box.
      for (let i = leaves.length - 1; i >= 0; i--) {
        const mesh = leaves[i];
        if (!mesh.parent) continue;
        if ((mesh as any).isInstancedMesh) continue; // handled below

        const box = new THREE.Box3().setFromObject(mesh);
        if (box.isEmpty()) continue;

        const hit = this.evaluateVolume(box, extraSurfMargin);
        if (hit) {
          mesh.parent.remove(mesh);
          rejected.push({
            name: mesh.name || `mesh@${box.getCenter(new THREE.Vector3()).toArray().map((v) => v.toFixed(0)).join(',')}`,
            penetration: hit.penetration,
            nearNode: hit.nodeIndex
          });
          total++;
        }
      }

      // Instanced decorations (skyline clusters, canyon walls, fins)
      const instanced: THREE.InstancedMesh[] = [];
      collectInstanced(root, instanced);
      for (const inst of instanced) {
        const geomBox = inst.geometry.boundingBox || (inst.geometry.computeBoundingBox(), inst.geometry.boundingBox);
        if (!geomBox) continue;
        const instanceMatrix = new THREE.Matrix4();
        const instanceBox = new THREE.Box3();
        let modified = false;

        for (let j = 0; j < inst.count; j++) {
          inst.getMatrixAt(j, instanceMatrix);
          instanceBox.copy(geomBox).applyMatrix4(instanceMatrix).applyMatrix4(inst.matrixWorld);
          const hit = this.evaluateVolume(instanceBox, extraSurfMargin);
          if (hit) {
            const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
            zeroMatrix.setPosition(0, -99999, 0);
            inst.setMatrixAt(j, zeroMatrix);
            modified = true;
            rejected.push({ name: `${inst.name || 'instanced'}[${j}]`, penetration: hit.penetration, nearNode: hit.nodeIndex });
            total++;
          }
        }
        if (modified) inst.instanceMatrix.needsUpdate = true;
      }
    }

    if (total > 0) {
      const worst = rejected.reduce((a, b) => (b.penetration > a.penetration ? b : a), rejected[0]);
      console.log(
        `[RouteExclusionCorridor] Rejected ${total} decorative elements intruding into the gameplay corridor ` +
        `(worst: ${worst.penetration.toFixed(1)}m at node ${worst.nearNode}).`
      );
    }

    return { rejected, total };
  }

  /**
   * Measures one world-space volume against the protected corridor.
   * Tests the complete final vertical extent of the structure against all
   * gameplay platforms, obstacle solids, Signal Spines, recovery shelves, and
   * jump flight arcs, and against surf launch corridors.
   */
  public evaluateVolume(
    box: THREE.Box3,
    extraSurfMargin = 28.0,
    excludeNodeId?: number
  ): VolumeEvaluationResult | null {
    if (this.mainRoute.length === 0 && this.independentNodes.length === 0) return null;

    const center = box.getCenter(new THREE.Vector3());
    const footprintX = box.max.x - box.min.x;
    const footprintZ = box.max.z - box.min.z;
    const footprint = Math.max(footprintX, footprintZ);
    const height = box.max.y - box.min.y;
    const radius = Math.max(footprintX, footprintZ) * 0.5;

    const isColossal = radius >= 12.0 || height >= 60.0;
    const isMedium = !isColossal && (radius >= 6.0 || height >= 25.0);

    const vertAbove = JUMP_CORRIDOR_ABOVE + (isColossal ? 20.0 : (isMedium ? 10.0 : 0.0));
    const vertBelow = JUMP_CORRIDOR_BELOW + (isColossal ? 25.0 : (isMedium ? 15.0 : 0.0));

    let worst: VolumeEvaluationResult | null = null;
    const allNodes = [...this.mainRoute, ...this.independentNodes];

    const consider = (
      kind: ViolationKind,
      penetration: number,
      nodeIndex: number
    ): void => {
      const candidate: VolumeEvaluationResult = {
        penetration,
        nodeIndex,
        kind,
        isGameplayCollision: kind === 'GAMEPLAY_OVERLAP',
        isComfortViolation: kind !== 'GAMEPLAY_OVERLAP'
      };
      if (isWorseViolation(candidate, worst)) worst = candidate;
    };

    // 1. Evaluate against all individual platform geometries
    for (let i = 0; i < allNodes.length; i++) {
      const node = allNodes[i];
      // A structure may be exempted from ITS OWN source node (e.g. a foundation
      // pillar hanging directly beneath the platform it belongs to) while still
      // being rejected for intersecting any other gameplay geometry.
      if (excludeNodeId !== undefined && node.id === excludeNodeId) continue;
      const isSurf = !!node.isSurf;
      const isStepUp = node.type === RouteNodeType.STEP_UP ||
        node.ascentVariant !== undefined ||
        (i < this.mainRoute.length - 1 && this.mainRoute[i + 1]?.type === RouteNodeType.STEP_UP);
      const trackHalfBreadth = getPlatformMaxHalfWidth(node);

      let safetyMargin: number;
      if (isSurf) {
        safetyMargin = Math.max(50.0, 26.0 + extraSurfMargin) + 0.85 * radius;
      } else if (isStepUp) {
        safetyMargin = 42.0 + 0.7 * radius;
      } else {
        safetyMargin = 36.0 + 0.65 * radius;
      }

      if (isColossal) {
        const bgMargin = isSurf ? (70.0 + extraSurfMargin) : 60.0;
        safetyMargin = Math.max(safetyMargin, bgMargin + 0.6 * radius, 52.0 + 0.5 * footprint);
      } else if (isMedium) {
        safetyMargin = Math.max(safetyMargin, 30.0 + 0.4 * footprint);
      }

      const requiredDist = trackHalfBreadth + radius + safetyMargin;
      const rawRequiredDist = trackHalfBreadth + radius + 2.0;

      const comfortMinY = node.position.y - vertBelow;
      const comfortMaxY = node.position.y + vertAbove;
      const rawMinY = node.position.y - JUMP_CORRIDOR_BELOW;
      const rawMaxY = node.position.y + JUMP_CORRIDOR_ABOVE;

      const verticalOverlap = !(box.max.y < comfortMinY || box.min.y > comfortMaxY);
      const rawVerticalOverlap = !(box.max.y < rawMinY || box.min.y > rawMaxY);
      // A structure that spans the WHOLE protected band is piercing through the
      // route's airspace rather than merely standing beside it.
      const spansBand = box.min.y < comfortMinY && box.max.y > comfortMaxY;

      if (verticalOverlap) {
        const halfLen = (node.dimensions.z || 0) * 0.5;
        const fwdX = Math.sin(node.yaw);
        const fwdZ = Math.cos(node.yaw);
        const entryX = node.position.x - fwdX * halfLen;
        const entryZ = node.position.z - fwdZ * halfLen;
        const exitX = node.position.x + fwdX * halfLen;
        const exitZ = node.position.z + fwdZ * halfLen;

        const segDx = exitX - entryX;
        const segDz = exitZ - entryZ;
        const segLenSq = segDx * segDx + segDz * segDz;

        let tNode = 0.5;
        if (segLenSq > 0.0001) {
          tNode = ((center.x - entryX) * segDx + (center.z - entryZ) * segDz) / segLenSq;
          tNode = Math.max(0, Math.min(1, tNode));
        }
        const closestNodeX = entryX + tNode * segDx;
        const closestNodeZ = entryZ + tNode * segDz;

        const dx = center.x - closestNodeX;
        const dz = center.z - closestNodeZ;
        const dist = Math.hypot(dx, dz);

        if (rawVerticalOverlap && dist < rawRequiredDist) {
          consider('GAMEPLAY_OVERLAP', rawRequiredDist - dist, i);
        } else if (dist < requiredDist) {
          consider(
            spansBand ? 'VERTICAL_INTRUSION' : 'COMFORT_CLEARANCE',
            requiredDist - dist,
            i
          );
        }
      }

      // Surf exit launch cone (airborne trajectory flying off the ramp up to 140m)
      if (isSurf && (i === this.mainRoute.length - 1 || !this.mainRoute[i + 1]?.isSurf)) {
        const fwdX = Math.sin(node.yaw);
        const fwdZ = Math.cos(node.yaw);
        const halfLen = (node.dimensions.z || 0) * 0.5;
        const exitX = node.position.x + fwdX * halfLen;
        const exitZ = node.position.z + fwdZ * halfLen;

        const toObjX = center.x - exitX;
        const toObjZ = center.z - exitZ;
        const projFwd = toObjX * fwdX + toObjZ * fwdZ;

        if (projFwd > 0 && projFwd < 150.0) {
          const coneRatio = projFwd / 150.0;
          const coneRadius = 32.0 + coneRatio * 44.0 + radius + (isColossal ? 24.0 : 0) + extraSurfMargin * 0.5;
          const latDistSq = (toObjX - fwdX * projFwd) ** 2 + (toObjZ - fwdZ * projFwd) ** 2;

          const coneMinY = node.position.y - 40.0 - (isColossal ? 20.0 : 0);
          const coneMaxY = node.position.y + 75.0 + (isColossal ? 20.0 : 0);
          if (!(box.max.y < coneMinY || box.min.y > coneMaxY)) {
            const latDist = Math.sqrt(latDistSq);
            const penetration = coneRadius - latDist;
            if (penetration > 0) {
              consider('SURF_CORRIDOR', penetration, i);
            }
          }
        }
      }
    }

    // 2. Evaluate jump flight trajectories between consecutive nodes in the main route
    for (let i = 0; i < this.mainRoute.length - 1; i++) {
      const node = this.mainRoute[i];
      const nextNode = this.mainRoute[i + 1];
      if (
        excludeNodeId !== undefined &&
        (node.id === excludeNodeId || nextNode.id === excludeNodeId)
      ) {
        continue;
      }
      const isSurfSection = !!node.isSurf || !!nextNode.isSurf;
      const isStepUpSection = node.type === RouteNodeType.STEP_UP || nextNode.type === RouteNodeType.STEP_UP;

      let segMargin: number;
      if (isSurfSection) {
        segMargin = Math.max(52.0, 26.0 + extraSurfMargin) + 0.85 * radius;
      } else if (isStepUpSection) {
        segMargin = 42.0 + 0.7 * radius;
      } else {
        segMargin = 40.0 + 0.7 * radius;
      }

      if (isColossal) {
        const bgMargin = isSurfSection ? (70.0 + extraSurfMargin) : 60.0;
        segMargin = Math.max(segMargin, bgMargin + 0.6 * radius, 52.0 + 0.5 * footprint);
      } else if (isMedium) {
        segMargin = Math.max(segMargin, 30.0 + 0.4 * footprint);
      }

      const segHalfBreadth = Math.max(getPlatformMaxHalfWidth(node), getPlatformMaxHalfWidth(nextNode));

      const ax = node.position.x;
      const az = node.position.z;
      const bx = nextNode.position.x;
      const bz = nextNode.position.z;

      const abx = bx - ax;
      const abz = bz - az;
      const segLenSq = abx * abx + abz * abz;

      let t = 0;
      if (segLenSq > 0.0001) {
        t = ((center.x - ax) * abx + (center.z - az) * abz) / segLenSq;
        t = Math.max(0, Math.min(1, t));
      }

      const closestX = ax + t * abx;
      const closestZ = az + t * abz;
      const interpY = node.position.y + t * (nextNode.position.y - node.position.y);

      const segDist = Math.sqrt(segLenSq);
      const gapDist = Math.max(0, segDist - ((node.dimensions.z || 0) * 0.5 + (nextNode.dimensions.z || 0) * 0.5));
      const apexHeight = gapDist > 4.0 ? Math.max(2.5, Math.min(8.5, gapDist * 0.32)) : 0;
      const arcOffset = 4.0 * t * (1.0 - t) * apexHeight;
      const flightY = interpY + arcOffset;

      const jumpComfortMinY = flightY - vertBelow;
      const jumpComfortMaxY = flightY + vertAbove;
      const jumpRawMinY = flightY - JUMP_CORRIDOR_BELOW;
      const jumpRawMaxY = flightY + JUMP_CORRIDOR_ABOVE;
      const flightSpansBand = box.min.y < jumpComfortMinY && box.max.y > jumpComfortMaxY;

      const maxDrift = gapDist > 4.0 ? (isSurfSection ? 3.5 : 2.5) : 0.0;
      const lateralDrift = 4.0 * t * (1.0 - t) * maxDrift;
      const segRequiredDist = segHalfBreadth + radius + segMargin + lateralDrift;
      const rawFlightRequiredDist = segHalfBreadth + radius + 2.0;

      const flightVerticalOverlap = !(box.max.y < jumpComfortMinY || box.min.y > jumpComfortMaxY);
      const flightRawVerticalOverlap = !(box.max.y < jumpRawMinY || box.min.y > jumpRawMaxY);

      if (flightVerticalOverlap) {
        const cdx = center.x - closestX;
        const cdz = center.z - closestZ;
        const dist = Math.hypot(cdx, cdz);

        if (flightRawVerticalOverlap && dist < rawFlightRequiredDist) {
          consider('GAMEPLAY_OVERLAP', rawFlightRequiredDist - dist, i);
        } else if (dist < segRequiredDist) {
          consider(
            flightSpansBand ? 'VERTICAL_INTRUSION' : 'COMFORT_CLEARANCE',
            segRequiredDist - dist,
            i
          );
        }
      }
    }

    return worst;
  }

  /**
   * Fast boolean query checking if a 3D bounding box violates the corridor.
   * Records candidate diagnostic statistics into lastBuildingReport.
   */
  public isBoxInsideCorridor(
    box: THREE.Box3,
    extraSurfMargin = 28.0,
    excludeNodeId?: number
  ): boolean {
    RouteExclusionCorridor.lastBuildingReport.candidatesGenerated++;
    const hit = this.evaluateVolume(box, extraSurfMargin, excludeNodeId);
    if (hit) {
      switch (hit.kind) {
        case 'GAMEPLAY_OVERLAP':
          RouteExclusionCorridor.lastBuildingReport.rejectedByGameplayCollision++;
          break;
        case 'SURF_CORRIDOR':
          RouteExclusionCorridor.lastBuildingReport.rejectedBySurfCorridor++;
          break;
        case 'VERTICAL_INTRUSION':
          RouteExclusionCorridor.lastBuildingReport.rejectedByVerticalIntrusion++;
          break;
        default:
          RouteExclusionCorridor.lastBuildingReport.rejectedByComfortClearance++;
          break;
      }
      return true;
    }
    RouteExclusionCorridor.lastBuildingReport.finalSurvivingBuildings++;
    return false;
  }
}

/** Violation severity: a real overlap outranks a corridor intrusion. */
function violationPriority(kind: ViolationKind): number {
  switch (kind) {
    case 'GAMEPLAY_OVERLAP': return 4;
    case 'SURF_CORRIDOR': return 3;
    case 'VERTICAL_INTRUSION': return 2;
    default: return 1;
  }
}

function isWorseViolation(
  candidate: VolumeEvaluationResult,
  current: VolumeEvaluationResult | null
): boolean {
  if (!current) return true;
  const pc = violationPriority(candidate.kind);
  const pn = violationPriority(current.kind);
  if (pc !== pn) return pc > pn;
  return candidate.penetration > current.penetration;
}

/** Recursively collects decorative mesh leaves (bounded depth). */
function collectDecorationLeaves(obj: THREE.Object3D, out: THREE.Mesh[], depth: number): void {
  if (depth > 8) return;
  const asMesh = obj as THREE.Mesh;
  if (asMesh.isMesh && !(obj as any).isInstancedMesh) {
    out.push(asMesh);
    return;
  }
  for (const child of obj.children) {
    collectDecorationLeaves(child, out, depth + 1);
  }
}

/** Recursively collects instanced meshes (bounded depth). */
function collectInstanced(obj: THREE.Object3D, out: THREE.InstancedMesh[], depth = 0): void {
  if (depth > 8) return;
  if ((obj as any).isInstancedMesh) {
    out.push(obj as THREE.InstancedMesh);
    return;
  }
  for (const child of obj.children) {
    collectInstanced(child, out, depth + 1);
  }
}
