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
  /**
   * Height of the protected vertical band above a route node.
   *
   * This is the player's usable airspace: a generous jump/launch apex plus
   * headroom. Architecture may pass overhead ABOVE this band, but nothing may
   * occupy it near the flight path.
   */
  public static readonly JUMP_CORRIDOR_ABOVE = JUMP_CORRIDOR_ABOVE;

  /** Depth of protected airspace below a route node. */
  public static readonly JUMP_CORRIDOR_BELOW = JUMP_CORRIDOR_BELOW;

  private route: RouteNode[];

  constructor(route: RouteNode[]) {
    this.route = route;
  }

  /**
   * Evaluates if a given bounding volume violates the route exclusion corridor.
   * Checks horizontal and vertical clearance against all route nodes and jump flight paths.
   */
  public isPointInsideCorridor(
    pos: THREE.Vector3,
    objectRadius: number,
    minY: number,
    maxY: number,
    extraSurfMargin = 20.0
  ): boolean {
    if (this.route.length === 0) return false;

    // Check individual nodes
    for (let i = 0; i < this.route.length; i++) {
      const node = this.route[i];
      const isSurf = !!node.isSurf;
      const isStepUp = node.type === RouteNodeType.STEP_UP ||
        (i < this.route.length - 1 && this.route[i + 1].type === RouteNodeType.STEP_UP);
      const trackHalfBreadth = getPlatformMaxHalfWidth(node);

      let safetyMargin: number;
      if (isSurf) {
        safetyMargin = Math.max(38.0, 18.0 + extraSurfMargin) + 0.85 * objectRadius;
      } else if (isStepUp) {
        safetyMargin = 32.0 + 0.7 * objectRadius;
      } else {
        safetyMargin = 26.0 + 0.65 * objectRadius;
      }

      // Background architecture clearance for large monumental structures / skyscrapers
      if (objectRadius >= 12.0 || (maxY - minY) >= 60.0) {
        const bgMargin = isSurf ? (55.0 + extraSurfMargin) : 46.0;
        safetyMargin = Math.max(safetyMargin, bgMargin + 0.6 * objectRadius);
      }
      const requiredDist = trackHalfBreadth + objectRadius + safetyMargin;

      // Vertical clearance envelope: usable player airspace around the route
      const routeMinY = node.position.y - JUMP_CORRIDOR_BELOW;
      const routeMaxY = node.position.y + JUMP_CORRIDOR_ABOVE;

      const verticalOverlap = !(maxY < routeMinY || minY > routeMaxY);
      if (verticalOverlap) {
        // Continuous oriented platform segment clearance from entry anchor to exit anchor
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
          tNode = ((pos.x - entryX) * segDx + (pos.z - entryZ) * segDz) / segLenSq;
          tNode = Math.max(0, Math.min(1, tNode));
        }
        const closestNodeX = entryX + tNode * segDx;
        const closestNodeZ = entryZ + tNode * segDz;

        const dx = pos.x - closestNodeX;
        const dz = pos.z - closestNodeZ;
        const distSq = dx * dx + dz * dz;
        if (distSq < requiredDist * requiredDist) {
          return true; // Collision with node corridor
        }
      }

      // Check surf exit launch cone (protects entire airborne trajectory flying off the ramp up to 130m)
      if (isSurf && (i === this.route.length - 1 || !this.route[i + 1].isSurf)) {
        const fwdX = Math.sin(node.yaw);
        const fwdZ = Math.cos(node.yaw);
        const halfLen = (node.dimensions.z || 0) * 0.5;
        const exitX = node.position.x + fwdX * halfLen;
        const exitZ = node.position.z + fwdZ * halfLen;

        const toObjX = pos.x - exitX;
        const toObjZ = pos.z - exitZ;
        const projFwd = toObjX * fwdX + toObjZ * fwdZ;

        if (projFwd > 0 && projFwd < 130.0) {
          const coneRatio = projFwd / 130.0;
          const coneRadius = 24.0 + coneRatio * 32.0 + objectRadius + (extraSurfMargin ? extraSurfMargin * 0.5 : 0);
          const latDistSq = (toObjX - fwdX * projFwd) ** 2 + (toObjZ - fwdZ * projFwd) ** 2;

          const coneMinY = node.position.y - 30.0;
          const coneMaxY = node.position.y + 65.0;
          if (!(maxY < coneMinY || minY > coneMaxY)) {
            if (latDistSq < coneRadius * coneRadius) {
              return true; // Collision with surf exit launch cone
            }
          }
        }
      }

      // Check flight trajectory segment to next node
      if (i < this.route.length - 1) {
        const nextNode = this.route[i + 1];
        const isSurfSection = isSurf || !!nextNode.isSurf;
        const isStepUpSection = node.type === RouteNodeType.STEP_UP || nextNode.type === RouteNodeType.STEP_UP;

        let segMargin: number;
        if (isSurfSection) {
          segMargin = Math.max(40.0, 18.0 + extraSurfMargin) + 0.85 * objectRadius;
        } else if (isStepUpSection) {
          segMargin = 32.0 + 0.7 * objectRadius;
        } else {
          segMargin = 30.0 + 0.7 * objectRadius;
        }
        const segHalfBreadth = Math.max(trackHalfBreadth, getPlatformMaxHalfWidth(nextNode));

        const ax = node.position.x;
        const az = node.position.z;
        const bx = nextNode.position.x;
        const bz = nextNode.position.z;

        const abx = bx - ax;
        const abz = bz - az;
        const segLenSq = abx * abx + abz * abz;

        let t = 0;
        if (segLenSq > 0.0001) {
          t = ((pos.x - ax) * abx + (pos.z - az) * abz) / segLenSq;
          t = Math.max(0, Math.min(1, t));
        }

        const closestX = ax + t * abx;
        const closestZ = az + t * abz;
        const interpY = node.position.y + t * (nextNode.position.y - node.position.y);

        // 3D Parabolic jump arc apex calculation over airborne gaps
        const segDist = Math.sqrt(segLenSq);
        const gapDist = Math.max(0, segDist - ((node.dimensions.z || 0) * 0.5 + (nextNode.dimensions.z || 0) * 0.5));
        const apexHeight = gapDist > 4.0 ? Math.max(2.5, Math.min(8.5, gapDist * 0.32)) : 0;
        const arcOffset = 4.0 * t * (1.0 - t) * apexHeight;
        const flightY = interpY + arcOffset;

        // Jump trajectory vertical clearance
        const jumpMinY = flightY - JUMP_CORRIDOR_BELOW;
        const jumpMaxY = flightY + JUMP_CORRIDOR_ABOVE;

        // Lateral air-strafe drift expansion over airborne gaps
        const maxDrift = gapDist > 4.0 ? (isSurfSection ? 3.5 : 2.5) : 0.0;
        const lateralDrift = 4.0 * t * (1.0 - t) * maxDrift;
        const segRequiredDist = segHalfBreadth + objectRadius + segMargin + lateralDrift;

        const segVerticalOverlap = !(maxY < jumpMinY || minY > jumpMaxY);
        if (segVerticalOverlap) {
          const cdx = pos.x - closestX;
          const cdz = pos.z - closestZ;
          const cDistSq = cdx * cdx + cdz * cdz;
          if (cDistSq < segRequiredDist * segRequiredDist) {
            return true; // Collision with jump flight corridor
          }
        }
      }
    }

    return false;
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
   *
   * AUTHORITATIVE RULE: this operates on FINAL WORLD-SPACE GEOMETRY. It walks
   * the hierarchy recursively and measures each individual mesh's real world
   * AABB, so it cannot be defeated by:
   *   - a proxy radius that is smaller than the final rotated/scaled geometry
   *   - nested groups (e.g. a frame's meshes inside a sub-group)
   *   - bounds captured before scaling or rotation
   *
   * Only genuinely decorative leaves are rejected. Gameplay geometry is never
   * moved or deformed to accommodate decoration.
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
   * Returns the penetration depth (metres inside the protected volume) and the
   * offending node, or null when the volume is clear.
   */
  public evaluateVolume(box: THREE.Box3, extraSurfMargin = 28.0): { penetration: number; nodeIndex: number } | null {
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(
      (box.max.x - box.min.x) * 0.5,
      (box.max.z - box.min.z) * 0.5
    );

    let worst: { penetration: number; nodeIndex: number } | null = null;

    for (let i = 0; i < this.route.length; i++) {
      const node = this.route[i];
      const isSurf = !!node.isSurf;
      const isStepUp = node.type === RouteNodeType.STEP_UP ||
        (i < this.route.length - 1 && this.route[i + 1].type === RouteNodeType.STEP_UP);
      const trackHalfBreadth = getPlatformMaxHalfWidth(node);

      let safetyMargin: number;
      if (isSurf) {
        safetyMargin = Math.max(38.0, 18.0 + extraSurfMargin) + 0.85 * radius;
      } else if (isStepUp) {
        safetyMargin = 32.0 + 0.7 * radius;
      } else {
        safetyMargin = 26.0 + 0.65 * radius;
      }
      // Background architecture clearance for large monumental structures / skyscrapers
      if (radius >= 12.0 || (box.max.y - box.min.y) >= 60.0) {
        const bgMargin = isSurf ? (55.0 + extraSurfMargin) : 46.0;
        safetyMargin = Math.max(safetyMargin, bgMargin + 0.6 * radius);
      }
      const requiredDist = trackHalfBreadth + radius + safetyMargin;

      const routeMinY = node.position.y - JUMP_CORRIDOR_BELOW;
      const routeMaxY = node.position.y + JUMP_CORRIDOR_ABOVE;

      if (!(box.max.y < routeMinY || box.min.y > routeMaxY)) {
        // Continuous oriented platform segment clearance from entry anchor to exit anchor
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
        const dist = Math.sqrt(dx * dx + dz * dz);
        const penetration = requiredDist - dist;
        if (penetration > 0 && (!worst || penetration > worst.penetration)) {
          worst = { penetration, nodeIndex: i };
        }
      }

      // Check surf exit launch cone (protects entire airborne trajectory flying off the ramp up to 130m)
      if (isSurf && (i === this.route.length - 1 || !this.route[i + 1].isSurf)) {
        const fwdX = Math.sin(node.yaw);
        const fwdZ = Math.cos(node.yaw);
        const halfLen = (node.dimensions.z || 0) * 0.5;
        const exitX = node.position.x + fwdX * halfLen;
        const exitZ = node.position.z + fwdZ * halfLen;

        const toObjX = center.x - exitX;
        const toObjZ = center.z - exitZ;
        const projFwd = toObjX * fwdX + toObjZ * fwdZ;

        if (projFwd > 0 && projFwd < 130.0) {
          const coneRatio = projFwd / 130.0;
          const coneRadius = 24.0 + coneRatio * 32.0 + radius + extraSurfMargin * 0.5;
          const latDistSq = (toObjX - fwdX * projFwd) ** 2 + (toObjZ - fwdZ * projFwd) ** 2;

          const coneMinY = node.position.y - 30.0;
          const coneMaxY = node.position.y + 65.0;
          if (!(box.max.y < coneMinY || box.min.y > coneMaxY)) {
            const latDist = Math.sqrt(latDistSq);
            const penetration = coneRadius - latDist;
            if (penetration > 0 && (!worst || penetration > worst.penetration)) {
              worst = { penetration, nodeIndex: i };
            }
          }
        }
      }

      // Flight trajectory segment to next node
      if (i < this.route.length - 1) {
        const nextNode = this.route[i + 1];
        const isSurfSection = isSurf || !!nextNode.isSurf;
        const isStepUpSection = node.type === RouteNodeType.STEP_UP || nextNode.type === RouteNodeType.STEP_UP;

        let segMargin: number;
        if (isSurfSection) {
          segMargin = Math.max(40.0, 18.0 + extraSurfMargin) + 0.85 * radius;
        } else if (isStepUpSection) {
          segMargin = 32.0 + 0.7 * radius;
        } else {
          segMargin = 30.0 + 0.7 * radius;
        }
        const segHalfBreadth = Math.max(trackHalfBreadth, getPlatformMaxHalfWidth(nextNode));

        const ax = node.position.x;
        const az = node.position.z;
        const abx = nextNode.position.x - ax;
        const abz = nextNode.position.z - az;
        const segLenSq = abx * abx + abz * abz;

        let t = 0;
        if (segLenSq > 0.0001) {
          t = ((center.x - ax) * abx + (center.z - az) * abz) / segLenSq;
          t = Math.max(0, Math.min(1, t));
        }

        const closestX = ax + t * abx;
        const closestZ = az + t * abz;
        const interpY = node.position.y + t * (nextNode.position.y - node.position.y);

        // 3D Parabolic jump arc apex calculation over airborne gaps
        const segDist = Math.sqrt(segLenSq);
        const gapDist = Math.max(0, segDist - ((node.dimensions.z || 0) * 0.5 + (nextNode.dimensions.z || 0) * 0.5));
        const apexHeight = gapDist > 4.0 ? Math.max(2.5, Math.min(8.5, gapDist * 0.32)) : 0;
        const arcOffset = 4.0 * t * (1.0 - t) * apexHeight;
        const flightY = interpY + arcOffset;

        const jumpMinY = flightY - JUMP_CORRIDOR_BELOW;
        const jumpMaxY = flightY + JUMP_CORRIDOR_ABOVE;

        // Lateral air-strafe drift expansion over airborne gaps
        const maxDrift = gapDist > 4.0 ? (isSurfSection ? 3.5 : 2.5) : 0.0;
        const lateralDrift = 4.0 * t * (1.0 - t) * maxDrift;
        const segRequiredDist = segHalfBreadth + radius + segMargin + lateralDrift;

        if (!(box.max.y < jumpMinY || box.min.y > jumpMaxY)) {
          const cdx = center.x - closestX;
          const cdz = center.z - closestZ;
          const dist = Math.sqrt(cdx * cdx + cdz * cdz);
          const penetration = segRequiredDist - dist;
          if (penetration > 0 && (!worst || penetration > worst.penetration)) {
            worst = { penetration, nodeIndex: i };
          }
        }
      }
    }

    return worst;
  }

  /**
   * Fast boolean query checking if a 3D bounding box violates the corridor.
   */
  public isBoxInsideCorridor(box: THREE.Box3, extraSurfMargin = 28.0): boolean {
    return this.evaluateVolume(box, extraSurfMargin) !== null;
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
