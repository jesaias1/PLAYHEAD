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
