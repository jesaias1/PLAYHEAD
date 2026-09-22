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
  finalSurvivingBuildings: number;
}

export interface VolumeEvaluationResult {
  penetration: number;
  nodeIndex: number;
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
      finalSurvivingBuildings: 0
    };
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
   * gameplay platforms, Signal Spines, recovery shelves, and jump flight arcs.
   */
  public evaluateVolume(
    box: THREE.Box3,
    extraSurfMargin = 28.0
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

    // 1. Evaluate against all individual platform geometries
    for (let i = 0; i < allNodes.length; i++) {
      const node = allNodes[i];
      const isSurf = !!node.isSurf;
      const isStepUp = node.type === RouteNodeType.STEP_UP ||
        node.ascentVariant !== undefined ||
        (i < this.mainRoute.length - 1 && this.mainRoute[i + 1]?.type === RouteNodeType.STEP_UP);
      const trackHalfBreadth = getPlatformMaxHalfWidth(node);

      let safetyMargin: number;
      if (isSurf) {
        safetyMargin = Math.max(38.0, 18.0 + extraSurfMargin) + 0.85 * radius;
      } else if (isStepUp) {
        safetyMargin = 32.0 + 0.7 * radius;
      } else {
        safetyMargin = 26.0 + 0.65 * radius;
      }

      if (isColossal) {
        const bgMargin = isSurf ? (55.0 + extraSurfMargin) : 46.0;
        safetyMargin = Math.max(safetyMargin, bgMargin + 0.6 * radius, 40.0 + 0.5 * footprint);
      } else if (isMedium) {
        safetyMargin = Math.max(safetyMargin, 22.0 + 0.4 * footprint);
      }

      const requiredDist = trackHalfBreadth + radius + safetyMargin;
      const rawRequiredDist = trackHalfBreadth + radius + 2.0;

      const comfortMinY = node.position.y - vertBelow;
      const comfortMaxY = node.position.y + vertAbove;
      const rawMinY = node.position.y - JUMP_CORRIDOR_BELOW;
      const rawMaxY = node.position.y + JUMP_CORRIDOR_ABOVE;

      const verticalOverlap = !(box.max.y < comfortMinY || box.min.y > comfortMaxY);
      const rawVerticalOverlap = !(box.max.y < rawMinY || box.min.y > rawMaxY);

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

        const isRawHit = rawVerticalOverlap && dist < rawRequiredDist;
        const isComfortHit = dist < requiredDist;

        if (isRawHit) {
          const penetration = rawRequiredDist - dist;
          if (!worst || !worst.isGameplayCollision || penetration > worst.penetration) {
            worst = { penetration, nodeIndex: i, isGameplayCollision: true, isComfortViolation: false };
          }
        } else if (isComfortHit) {
          const penetration = requiredDist - dist;
          if (!worst || (!worst.isGameplayCollision && penetration > worst.penetration)) {
            worst = { penetration, nodeIndex: i, isGameplayCollision: false, isComfortViolation: true };
          }
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

        if (projFwd > 0 && projFwd < 140.0) {
          const coneRatio = projFwd / 140.0;
          const coneRadius = 24.0 + coneRatio * 36.0 + radius + (isColossal ? 20.0 : 0) + extraSurfMargin * 0.5;
          const latDistSq = (toObjX - fwdX * projFwd) ** 2 + (toObjZ - fwdZ * projFwd) ** 2;

          const coneMinY = node.position.y - 35.0 - (isColossal ? 20.0 : 0);
          const coneMaxY = node.position.y + 70.0 + (isColossal ? 20.0 : 0);
          if (!(box.max.y < coneMinY || box.min.y > coneMaxY)) {
            const latDist = Math.sqrt(latDistSq);
            const penetration = coneRadius - latDist;
            if (penetration > 0 && (!worst || penetration > worst.penetration)) {
              worst = {
                penetration,
                nodeIndex: i,
                isGameplayCollision: penetration > 10.0,
                isComfortViolation: true
              };
            }
          }
        }
      }
    }

    // 2. Evaluate jump flight trajectories between consecutive nodes in the main route
    for (let i = 0; i < this.mainRoute.length - 1; i++) {
      const node = this.mainRoute[i];
      const nextNode = this.mainRoute[i + 1];
      const isSurfSection = !!node.isSurf || !!nextNode.isSurf;
      const isStepUpSection = node.type === RouteNodeType.STEP_UP || nextNode.type === RouteNodeType.STEP_UP;

      let segMargin: number;
      if (isSurfSection) {
        segMargin = Math.max(40.0, 18.0 + extraSurfMargin) + 0.85 * radius;
      } else if (isStepUpSection) {
        segMargin = 32.0 + 0.7 * radius;
      } else {
        segMargin = 30.0 + 0.7 * radius;
      }

      if (isColossal) {
        const bgMargin = isSurfSection ? (55.0 + extraSurfMargin) : 46.0;
        segMargin = Math.max(segMargin, bgMargin + 0.6 * radius, 40.0 + 0.5 * footprint);
      } else if (isMedium) {
        segMargin = Math.max(segMargin, 22.0 + 0.4 * footprint);
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

        const isRawHit = flightRawVerticalOverlap && dist < rawFlightRequiredDist;
        const isComfortHit = dist < segRequiredDist;

        if (isRawHit) {
          const penetration = rawFlightRequiredDist - dist;
          if (!worst || !worst.isGameplayCollision || penetration > worst.penetration) {
            worst = { penetration, nodeIndex: i, isGameplayCollision: true, isComfortViolation: false };
          }
        } else if (isComfortHit) {
          const penetration = segRequiredDist - dist;
          if (!worst || (!worst.isGameplayCollision && penetration > worst.penetration)) {
            worst = { penetration, nodeIndex: i, isGameplayCollision: false, isComfortViolation: true };
          }
        }
      }
    }

    return worst;
  }

  /**
   * Fast boolean query checking if a 3D bounding box violates the corridor.
   * Records candidate diagnostic statistics into lastBuildingReport.
   */
  public isBoxInsideCorridor(box: THREE.Box3, extraSurfMargin = 28.0): boolean {
    RouteExclusionCorridor.lastBuildingReport.candidatesGenerated++;
    const hit = this.evaluateVolume(box, extraSurfMargin);
    if (hit) {
      if (hit.isGameplayCollision) {
        RouteExclusionCorridor.lastBuildingReport.rejectedByGameplayCollision++;
      } else {
        RouteExclusionCorridor.lastBuildingReport.rejectedByComfortClearance++;
      }
      return true;
    }
    RouteExclusionCorridor.lastBuildingReport.finalSurvivingBuildings++;
    return false;
  }
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
