/**
 * Authoritative Route Exclusion Corridor for PLAYHEAD
 * Enforces strict safety clearance around the playable route, surf ramps,
 * jump trajectories, and landing zones, preventing large brutalist monuments,
 * monoliths, and cantilevers from penetrating playable airspace or collision space.
 */

import * as THREE from 'three';
import { RouteNode, RouteNodeType } from '../generation/GenerationTypes';

export interface ObjectBoundingVolume {
  position: THREE.Vector3;
  radius: number;
  minY: number;
  maxY: number;
}

export class RouteExclusionCorridor {
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
      const trackHalfBreadth = (node.dimensions.x || 10.0) * 0.5;

      let safetyMargin: number;
      if (isSurf) {
        safetyMargin = Math.max(38.0, 18.0 + extraSurfMargin) + 0.85 * objectRadius;
      } else if (isStepUp) {
        safetyMargin = 32.0 + 0.7 * objectRadius;
      } else {
        safetyMargin = 26.0 + 0.65 * objectRadius;
      }
      const requiredDist = trackHalfBreadth + objectRadius + safetyMargin;

      // Vertical clearance envelope: from 25m below platform to 55m above
      const routeMinY = node.position.y - 25.0;
      const routeMaxY = node.position.y + 55.0;

      const verticalOverlap = !(maxY < routeMinY || minY > routeMaxY);
      if (verticalOverlap) {
        const dx = pos.x - node.position.x;
        const dz = pos.z - node.position.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < requiredDist * requiredDist) {
          return true; // Collision with node corridor
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
        const segHalfBreadth = Math.max(trackHalfBreadth, ((nextNode.dimensions.x || 10.0) * 0.5));
        const segRequiredDist = segHalfBreadth + objectRadius + segMargin;

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

        // Jump trajectory vertical clearance: player arcs upward or downward
        const jumpMinY = interpY - 25.0;
        const jumpMaxY = interpY + 55.0;

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
   * Final authoritative validation pass checking decorative meshes against protected gameplay volumes.
   * Traverses decorative objects and safely removes any elements that intrude into surf or route corridors.
   * Supports both regular Mesh hierarchies and InstancedMesh instances.
   */
  public validateDecorationAgainstGameplay(group: THREE.Group, extraSurfMargin = 28.0): number {
    let prunedCount = 0;
    const toRemove: THREE.Object3D[] = [];
    const worldPos = new THREE.Vector3();
    const box = new THREE.Box3();

    group.updateWorldMatrix(true, true);

    for (let i = 0; i < group.children.length; i++) {
      const child = group.children[i];

      if ((child as any).isInstancedMesh) {
        const inst = child as THREE.InstancedMesh;
        const geom = inst.geometry;
        if (!geom.boundingBox) geom.computeBoundingBox();
        const geomBox = geom.boundingBox || new THREE.Box3();
        const instanceMatrix = new THREE.Matrix4();
        const instanceBox = new THREE.Box3();
        const instPos = new THREE.Vector3();
        let modified = false;

        for (let j = 0; j < inst.count; j++) {
          inst.getMatrixAt(j, instanceMatrix);
          instanceBox.copy(geomBox).applyMatrix4(instanceMatrix);
          instanceBox.applyMatrix4(inst.matrixWorld);

          instanceBox.getCenter(instPos);
          const radius = Math.max(
            (instanceBox.max.x - instanceBox.min.x) * 0.5,
            (instanceBox.max.z - instanceBox.min.z) * 0.5
          );

          if (this.isPointInsideCorridor(instPos, radius, instanceBox.min.y, instanceBox.max.y, extraSurfMargin)) {
            // Remove colliding instance by zeroing scale and displacing outside world
            const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
            zeroMatrix.setPosition(0, -99999, 0);
            inst.setMatrixAt(j, zeroMatrix);
            modified = true;
            prunedCount++;
          }
        }
        if (modified) {
          inst.instanceMatrix.needsUpdate = true;
        }
      } else {
        box.setFromObject(child);
        if (box.isEmpty()) continue;

        box.getCenter(worldPos);
        const radius = Math.max(
          (box.max.x - box.min.x) * 0.5,
          (box.max.z - box.min.z) * 0.5
        );

        // Check center and horizontal bounding extremes against corridor
        const penetrates = this.isPointInsideCorridor(worldPos, radius, box.min.y, box.max.y, extraSurfMargin);
        if (penetrates) {
          toRemove.push(child);
        }
      }
    }

    for (const obj of toRemove) {
      group.remove(obj);
      prunedCount++;
    }

    if (prunedCount > 0) {
      console.log(`[RouteExclusionCorridor] Pruned ${prunedCount} conflicting decorative elements from route corridor.`);
    }

    return prunedCount;
  }
}
