/**
 * Collision primitives and query routines for TRACK//RUN
 */

import * as THREE from 'three';
import { RouteNode, RouteNodeType } from '../generation/GenerationTypes';
import {
  getPlatformFootprint,
  interpolatePlatformCenterOffset,
  interpolatePlatformHalfWidth
} from '../generation/PlatformShape';
import { buildRibbonChainSurface, RibbonSurfaceTriangle } from '../generation/SurfRibbon';

export interface CollisionResult {
  hasContact: boolean;
  contactPoint: THREE.Vector3;
  normal: THREE.Vector3;
  penetration: number;
  isSurf: boolean;
  isBoost: boolean;
  boostSpeed?: number;
}

export class BoxCollider {
  public center = new THREE.Vector3();
  public halfSize = new THREE.Vector3();
  public rotation = new THREE.Euler();
  public matrix = new THREE.Matrix4();
  public invMatrix = new THREE.Matrix4();
  public isSurf: boolean;
  public isBoost: boolean;
  public boostSpeed: number;
  public nodeType: RouteNodeType;
  public surfNormal?: THREE.Vector3;
  public boundingRadius: number;
  public entryHalfWidth: number;
  public exitHalfWidth: number;
  public exitLateralOffset: number;
  public isTrapezoid: boolean;

  constructor(node: RouteNode) {
    this.center.set(node.position.x, node.position.y, node.position.z);
    const footprint = getPlatformFootprint(node);
    this.halfSize.set(footprint.entryHalfWidth, footprint.halfHeight, footprint.halfDepth);
    this.entryHalfWidth = footprint.entryHalfWidth;
    this.exitHalfWidth = footprint.exitHalfWidth;
    this.exitLateralOffset = footprint.exitLateralOffset;
    this.isTrapezoid = Math.abs(this.exitHalfWidth - this.entryHalfWidth) > 1e-6 ||
      Math.abs(this.exitLateralOffset) > 1e-6;

    const maxHalfWidth = Math.max(
      this.entryHalfWidth,
      Math.abs(this.exitLateralOffset - this.exitHalfWidth),
      Math.abs(this.exitLateralOffset + this.exitHalfWidth)
    );
    this.boundingRadius = Math.hypot(maxHalfWidth, this.halfSize.y, this.halfSize.z);
    this.rotation.set(node.pitch, node.yaw, node.roll, 'YXZ');

    this.matrix.makeRotationFromEuler(this.rotation);
    this.matrix.setPosition(this.center);
    this.invMatrix.copy(this.matrix).invert();

    this.isSurf = node.isSurf;
    this.isBoost = node.isBoost;
    this.boostSpeed = node.boostSpeed || 12.0;
    this.nodeType = node.type;

    if (node.surfNormal) {
      this.surfNormal = new THREE.Vector3(node.surfNormal.x, node.surfNormal.y, node.surfNormal.z).normalize();
    }
  }

  /**
   * Test sphere/capsule against this OBB
   */
  public testSphere(sphereCenter: THREE.Vector3, radius: number): CollisionResult {
    // Transform sphere center into OBB local space
    const localPoint = sphereCenter.clone().applyMatrix4(this.invMatrix);

    // Find closest point in local AABB / trapezoid
    let clamped: THREE.Vector3;
    let currentHalfW = this.halfSize.x;
    let currentCenterX = 0;

    if (this.isTrapezoid) {
      const clampedZ = Math.max(-this.halfSize.z, Math.min(this.halfSize.z, localPoint.z));
      currentHalfW = interpolatePlatformHalfWidth(
        this.entryHalfWidth,
        this.exitHalfWidth,
        this.halfSize.z,
        clampedZ
      );
      currentCenterX = interpolatePlatformCenterOffset(
        this.exitLateralOffset,
        this.halfSize.z,
        clampedZ
      );
      const clampedX = Math.max(
        currentCenterX - currentHalfW,
        Math.min(currentCenterX + currentHalfW, localPoint.x)
      );
      const clampedY = Math.max(-this.halfSize.y, Math.min(this.halfSize.y, localPoint.y));
      clamped = new THREE.Vector3(clampedX, clampedY, clampedZ);
    } else {
      clamped = new THREE.Vector3(
        Math.max(-this.halfSize.x, Math.min(this.halfSize.x, localPoint.x)),
        Math.max(-this.halfSize.y, Math.min(this.halfSize.y, localPoint.y)),
        Math.max(-this.halfSize.z, Math.min(this.halfSize.z, localPoint.z))
      );
    }

    const localDiff = localPoint.clone().sub(clamped);
    const distSq = localDiff.lengthSq();

    // Check if outside radius
    if (distSq > radius * radius && distSq > 1e-6) {
      return {
        hasContact: false,
        contactPoint: new THREE.Vector3(),
        normal: new THREE.Vector3(),
        penetration: 0,
        isSurf: this.isSurf,
        isBoost: this.isBoost,
        boostSpeed: this.boostSpeed
      };
    }

    // Contact detected
    let localNormal: THREE.Vector3;
    let penetration: number;

    if (distSq > 1e-6) {
      const dist = Math.sqrt(distSq);
      localNormal = localDiff.divideScalar(dist);
      penetration = radius - dist;
    } else {
      // Sphere center is inside box - find shallowest face
      const dxLeft = localPoint.x - (currentCenterX - currentHalfW);
      const dxRight = (currentCenterX + currentHalfW) - localPoint.x;
      const dx = Math.min(dxLeft, dxRight);
      const dy = this.halfSize.y - localPoint.y;
      const dz = this.halfSize.z - Math.abs(localPoint.z);

      if (dy <= dx && dy <= dz) {
        localNormal = new THREE.Vector3(0, 1, 0);
        penetration = radius + dy;
      } else {
        const dyBottom = this.halfSize.y + localPoint.y;
        if (dyBottom <= dx && dyBottom <= dz) {
          localNormal = new THREE.Vector3(0, -1, 0);
          penetration = radius + dyBottom;
        } else if (dx <= dz) {
          localNormal = new THREE.Vector3(dxRight <= dxLeft ? 1 : -1, 0, 0);
          penetration = radius + dx;
        } else {
          localNormal = new THREE.Vector3(0, 0, localPoint.z >= 0 ? 1 : -1);
          penetration = radius + dz;
        }
      }
    }

    // Transform normal back to world space
    const normalMatrix = new THREE.Matrix3().setFromMatrix4(this.matrix);
    const worldNormal = localNormal.clone().applyMatrix3(normalMatrix).normalize();
    const contactPoint = clamped.applyMatrix4(this.matrix);

    return {
      hasContact: true,
      contactPoint,
      normal: worldNormal,
      penetration,
      isSurf: this.isSurf,
      isBoost: this.isBoost,
      boostSpeed: this.boostSpeed
    };
  }
}


/**
 * SURF RIBBON SURFACE COLLIDER.
 *
 * A dedicated collider for sampled curved/banked ribbon sections. It replaces
 * the per-segment OBB proxy for surf ribbon nodes because a rotated box is NOT
 * the surface the player rides once bank/heading change across the segment.
 *
 * The collider is defined by the SAME world-space triangles the renderer
 * draws, merged across the whole continuous ribbon from its ordered stations. It supports sphere
 * closest-point contact against the top face, the underside and the two OUTER
 * lateral faces. The internal entry/exit end faces are deliberately excluded so
 * adjacent segments in one continuous ribbon never form an internal slab wall
 * that could snag or eject a high-speed player.
 *
 * Physics RESPONSE is unchanged: this only supplies a different contact
 * normal / penetration, and PhysicsWorld consumes it exactly like any other
 * collider.
 */
export class RibbonSurfaceCollider extends BoxCollider {
  /**
   * Exact finite triangles the player can touch: the sampled TOP face, the
   * underside, and the two OUTER lateral faces. The travel-perpendicular
   * entry/exit caps are deliberately absent, so a continuous ribbon never forms
   * an internal slab wall that could snag or eject a high-speed player.
   */
  private readonly triangles: RibbonSurfaceTriangle[];
  /** Per-triangle bounding spheres for a cheap broad reject (parallel arrays). */
  private readonly triangleCenters: THREE.Vector3[] = [];
  private readonly triangleRadii: number[] = [];
  private readonly outwardNormal = new THREE.Vector3(0, 1, 0);
  private readonly topCenter = new THREE.Vector3();

  constructor(nodes: RouteNode | RouteNode[]) {
    const ordered = Array.isArray(nodes) ? nodes : [nodes];
    super(ordered[0]);
    // One collider per CONTINUOUS ribbon: the whole ordered chain is merged into
    // a single finite-triangle surface. Adjacent segments share an exact boundary
    // edge, so the union has no internal walls and produces no duplicated
    // correction at a shared seam.
    const chain = buildRibbonChainSurface(ordered);
    this.triangles = chain ? chain.collisionTriangles : [];
    for (const tri of this.triangles) {
      const c = tri.a.clone().add(tri.b).add(tri.c).multiplyScalar(1 / 3);
      const r = Math.sqrt(Math.max(
        tri.a.distanceToSquared(c),
        tri.b.distanceToSquared(c),
        tri.c.distanceToSquared(c)
      ));
      this.triangleCenters.push(c);
      this.triangleRadii.push(r);
    }
    if (chain) {
      this.outwardNormal.copy(chain.topNormal);
      this.topCenter.copy(chain.center);
      // Authoritative centre and radius come from the exact sampled vertices.
      this.center.copy(chain.center);
      this.boundingRadius = chain.boundingRadius;
    }
  }

  /**
   * Exact closest-point contact against the finite sampled slab.
   *
   * There is NO averaged-plane fast path and no interior side test: a sphere
   * contacts only when it is within `radius` of a real face, so a point beyond
   * the end or side of the quad never reports contact (even when it lies inside
   * a broad bounding sphere), and a sphere well below the underside is not
   * dragged up toward the top plane.
   */
  public override testSphere(sphereCenter: THREE.Vector3, radius: number): CollisionResult {
    if (this.triangles.length === 0) return this.noContact();

    const broad = this.boundingRadius + radius;
    if (sphereCenter.distanceToSquared(this.center) > broad * broad) return this.noContact();

    const rSq = radius * radius;
    let bestDistSq = Infinity;
    let bestPoint: THREE.Vector3 | null = null;
    let bestTri: RibbonSurfaceTriangle | null = null;
    for (let i = 0; i < this.triangles.length; i++) {
      // Cheap per-triangle bounding-sphere reject before the exact closest-point.
      const reach = this.triangleRadii[i] + radius;
      if (sphereCenter.distanceToSquared(this.triangleCenters[i]) > reach * reach) continue;
      const tri = this.triangles[i];
      const p = closestPointOnTriangle(sphereCenter, tri.a, tri.b, tri.c);
      const dSq = p.distanceToSquared(sphereCenter);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestPoint = p;
        bestTri = tri;
      }
    }

    if (bestPoint === null || bestTri === null || bestDistSq > rSq) return this.noContact();

    // Outward normal comes from the WINNING triangle ONLY, never an average over
    // the whole chain. On an exact shared interior edge the closest point lies on
    // both adjacent triangles; each side's outward normal points the same way, so
    // the push is single, stable and along the true surface - never a wall.
    // The face normal is the STABLE default; the exact `away` direction is used
    // only when the sphere centre clearly lies outside the face, so a near-zero
    // closest distance can never flip the push direction.
    const outward = bestTri.normal;
    let normal: THREE.Vector3 = outward.clone();
    if (bestDistSq > 1e-10) {
      const dist = Math.sqrt(bestDistSq);
      const away = sphereCenter.clone().sub(bestPoint);
      if (away.dot(outward) > 0.5 * dist) normal = away.normalize();
    }
    const dist = Math.sqrt(Math.max(0, bestDistSq));
    return this.contact(bestPoint.clone(), normal, Math.max(0, radius - dist));
  }

  private noContact(): CollisionResult {
    return {
      hasContact: false,
      contactPoint: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      penetration: 0,
      isSurf: this.isSurf,
      isBoost: this.isBoost,
      boostSpeed: this.boostSpeed
    };
  }

  private contact(point: THREE.Vector3, normal: THREE.Vector3, penetration: number): CollisionResult {
    return {
      hasContact: true,
      contactPoint: point,
      normal,
      penetration,
      isSurf: this.isSurf,
      isBoost: this.isBoost,
      boostSpeed: this.boostSpeed
    };
  }
}

/** Ericson: closest point on a triangle to p (Real-Time Collision Detection). */
function closestPointOnTriangle(
  p: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3
): THREE.Vector3 {
  const ab = b.clone().sub(a);
  const ac = c.clone().sub(a);
  const ap = p.clone().sub(a);
  const d1 = ab.dot(ap);
  const d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) return a.clone();

  const bp = p.clone().sub(b);
  const d3 = ab.dot(bp);
  const d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) return b.clone();

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return a.clone().add(ab.clone().multiplyScalar(v));
  }

  const cp = p.clone().sub(c);
  const d5 = ab.dot(cp);
  const d6 = ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) return c.clone();

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return a.clone().add(ac.clone().multiplyScalar(w));
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return b.clone().add(c.clone().sub(b).multiplyScalar(w));
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return a.clone().add(ab.clone().multiplyScalar(v)).add(ac.clone().multiplyScalar(w));
}
