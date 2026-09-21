/**
 * PhysicsWorld managing course colliders and character collision resolution
 */

import * as THREE from 'three';
import { RouteNode } from '../generation/GenerationTypes';
import { BoxCollider } from './Collider';
import { SurfState, SurfaceClassification } from '../player/SurfState';

export class PhysicsWorld {
  public colliders: BoxCollider[] = [];
  public killPlaneY = -40.0; // Beneath lowest route structure

  /**
   * Vertical clearance below the LOWEST legitimate gameplay geometry.
   *
   * The boundary is global and geometry-derived, so long airborne transfers
   * remain safe regardless of speed, distance, or airtime. Twenty metres still
   * clears playable undersides while avoiding several extra seconds of empty fall.
   */
  public static readonly VOID_MARGIN = 20.0;

  /** Lowest legitimate gameplay Y found by the most recent buildFromRoute. */
  public lowestGameplayY = Infinity;

  /**
   * AUTHORITATIVE VOID DEATH BOUNDARY.
   *
   * Derived from FINAL legitimate gameplay geometry (main route + mandatory
   * surf + optional surf + recovery shelves), then pushed down by VOID_MARGIN.
   *
   * Normal falling death is fundamentally "player crosses below this Y".
   * It is intentionally NOT tied to the current platform or the current
   * checkpoint, so it stays correct on vertically complex maps and never
   * punishes a player who is merely below their local platform while still
   * flying high above the true void.
   */
  public getVoidDeathY(): number {
    return Number.isFinite(this.lowestGameplayY)
      ? this.lowestGameplayY - PhysicsWorld.VOID_MARGIN
      : this.killPlaneY;
  }

  public buildFromRoute(
    route: RouteNode[],
    optionalRamps?: RouteNode[],
    recoveryShelves?: RouteNode[],
    obstacles?: RouteNode[],
    signalSpines?: RouteNode[]
  ): void {
    this.colliders = [];
    let lowestY = Infinity;

    for (const node of route) {
      const col = new BoxCollider(node);
      this.colliders.push(col);

      const bottomY = node.position.y - node.dimensions.y * 0.5;
      if (bottomY < lowestY) lowestY = bottomY;
    }

    if (optionalRamps) {
      for (const ramp of optionalRamps) {
        const col = new BoxCollider(ramp);
        this.colliders.push(col);
        const bottomY = ramp.position.y - ramp.dimensions.y * 0.5;
        if (bottomY < lowestY) lowestY = bottomY;
      }
    }

    if (recoveryShelves) {
      for (const shelf of recoveryShelves) {
        const col = new BoxCollider(shelf);
        this.colliders.push(col);
        const bottomY = shelf.position.y - shelf.dimensions.y * 0.5;
        if (bottomY < lowestY) lowestY = bottomY;
      }
    }

    if (signalSpines) {
      for (const spine of signalSpines) {
        const col = new BoxCollider(spine);
        this.colliders.push(col);
        const bottomY = spine.position.y - spine.dimensions.y * 0.5;
        if (bottomY < lowestY) lowestY = bottomY;
      }
    }

    // Obstacles are intentional above-route solids. They collide normally but
    // never lower the authoritative void boundary, which is derived only from
    // playable route/surf/recovery geometry.
    if (obstacles) {
      for (const obstacle of obstacles) {
        this.colliders.push(new BoxCollider(obstacle));
      }
    }

    this.lowestGameplayY = lowestY;
    this.killPlaneY = Number.isFinite(lowestY)
      ? (lowestY - PhysicsWorld.VOID_MARGIN)
      : -40.0;
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
    surfContactPoint: THREE.Vector3;
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
    const surfContactPoint = new THREE.Vector3();
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

          // Classify surface: WALKABLE_GROUND vs SURF_SURFACE vs WALL
          const classification = SurfState.classifySurface(resBottom.normal, resBottom.isSurf);
          if (classification === SurfaceClassification.WALKABLE_GROUND) {
            isGrounded = true;
            groundNormal.copy(resBottom.normal);
          } else if (classification === SurfaceClassification.SURF_SURFACE) {
            isSurfing = true;
            surfNormal.copy(resBottom.normal);
            surfContactPoint.copy(resBottom.contactPoint);
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

    // In Counter-Strike, surfing and ground states are strictly mutually exclusive.
    // A player on a surf ramp is never grounded (no ground friction, no jumping, no walking).
    if (isSurfing) {
      isGrounded = false;
    }

    return {
      adjustedPos: adjusted,
      isGrounded,
      groundNormal,
      isSurfing,
      surfNormal,
      surfContactPoint,
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
