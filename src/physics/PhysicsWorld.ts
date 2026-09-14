/**
 * PhysicsWorld managing course colliders and character collision resolution
 */

import * as THREE from 'three';
import { RouteNode } from '../generation/GenerationTypes';
import { BoxCollider } from './Collider';

export class PhysicsWorld {
  public colliders: BoxCollider[] = [];
  public killPlaneY = -40.0; // Beneath lowest route structure

  public buildFromRoute(route: RouteNode[]): void {
    this.colliders = [];
    let lowestY = 0;

    for (const node of route) {
      const col = new BoxCollider(node);
      this.colliders.push(col);

      const bottomY = node.position.y - node.dimensions.y * 0.5;
      if (bottomY < lowestY) lowestY = bottomY;
    }

    this.killPlaneY = lowestY - 25.0;
  }

  public addCollider(col: BoxCollider): void {
    this.colliders.push(col);
  }

  public clear(): void {
    this.colliders = [];
  }

  /**
   * Resolve capsule collision for player
   * Player capsule represented as two spheres (bottom and top)
   */
  public resolveCapsule(
    position: THREE.Vector3,
    radius: number,
    height: number
  ): {
    adjustedPos: THREE.Vector3;
    isGrounded: boolean;
    groundNormal: THREE.Vector3;
    isSurfing: boolean;
    surfNormal: THREE.Vector3;
    isBoost: boolean;
    boostSpeed: number;
    hitWall: boolean;
    wallNormal: THREE.Vector3;
  } {
    const adjusted = position.clone();
    let isGrounded = false;
    const groundNormal = new THREE.Vector3(0, 1, 0);
    let isSurfing = false;
    const surfNormal = new THREE.Vector3();
    let isBoost = false;
    let boostSpeed = 0;
    let hitWall = false;
    const wallNormal = new THREE.Vector3();

    // Bottom sphere center (feet + radius) and top sphere (head - radius)
    const bottomCenter = new THREE.Vector3(adjusted.x, adjusted.y + radius, adjusted.z);
    const topCenter = new THREE.Vector3(adjusted.x, adjusted.y + height - radius, adjusted.z);

    // Multiple collision resolution iterations for stability
    for (let iter = 0; iter < 3; iter++) {
      bottomCenter.set(adjusted.x, adjusted.y + radius, adjusted.z);
      topCenter.set(adjusted.x, adjusted.y + height - radius, adjusted.z);

      for (const col of this.colliders) {
        const maxDist = col.boundingRadius + radius + 2.0;
        if (col.center.distanceToSquared(adjusted) > maxDist * maxDist) continue;

        // Test bottom sphere
        const resBottom = col.testSphere(bottomCenter, radius);
        if (resBottom.hasContact) {
          // Push out
          adjusted.addScaledVector(resBottom.normal, resBottom.penetration);

          // Check if ground, surf, or wall
          if (resBottom.normal.y >= 0.65) {
            isGrounded = true;
            groundNormal.copy(resBottom.normal);
          } else if (resBottom.isSurf || (resBottom.normal.y >= 0.15 && resBottom.normal.y < 0.65)) {
            isSurfing = true;
            surfNormal.copy(resBottom.normal);
          } else {
            hitWall = true;
            wallNormal.copy(resBottom.normal);
          }

          if (resBottom.isBoost) {
            isBoost = true;
            boostSpeed = Math.max(boostSpeed, resBottom.boostSpeed ?? 0);
          }
        }

        // Test top sphere
        const resTop = col.testSphere(topCenter, radius);
        if (resTop.hasContact) {
          adjusted.addScaledVector(resTop.normal, resTop.penetration);
          if (resTop.normal.y < 0.2) {
            hitWall = true;
            wallNormal.copy(resTop.normal);
          }
        }
      }
    }

    return {
      adjustedPos: adjusted,
      isGrounded,
      groundNormal,
      isSurfing,
      surfNormal,
      isBoost,
      boostSpeed,
      hitWall,
      wallNormal
    };
  }

  public checkKillPlane(pos: THREE.Vector3): boolean {
    return pos.y < this.killPlaneY;
  }

  public dispose(): void {
    this.colliders = [];
  }
}
