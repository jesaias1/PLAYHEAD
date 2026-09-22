/**
 * PhysicsWorld managing course colliders and character collision resolution
 */

import * as THREE from 'three';
import { RouteNode } from '../generation/GenerationTypes';
import { BoxCollider } from './Collider';
import { SurfState, SurfaceClassification } from '../player/SurfState';

import { RouteVoidEnvelope } from './RouteVoidEnvelope';

interface DynamicObstacle {
  collider: BoxCollider;
  baseX: number;
  baseY: number;
  baseZ: number;
  /** Unit lateral (local +X) direction in world space. */
  lateralX: number;
  lateralZ: number;
  amplitude: number;
  speed: number;
  phase: number;
}

export class PhysicsWorld {
  public colliders: BoxCollider[] = [];
  public killPlaneY = -40.0; // Beneath lowest route structure
  public voidEnvelope = new RouteVoidEnvelope();

  /**
   * Moving gameplay obstacles (signal shutters / sweep beams). Their motion is
   * a pure function of song time, so the same track always presents the same
   * geometry. Kept separate from the static collider list so per-frame cost is
   * limited to the handful of obstacles that actually move.
   */
  private dynamicObstacles: DynamicObstacle[] = [];

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
   * If x and z are provided, evaluates the route-aware void death boundary at that
   * horizontal position (with stacking protection ensuring lower descending routes
   * remain safe).
   */
  public getVoidDeathY(x?: number, z?: number): number {
    const globalY = Number.isFinite(this.lowestGameplayY)
      ? this.lowestGameplayY - PhysicsWorld.VOID_MARGIN
      : this.killPlaneY;

    if (x !== undefined && z !== undefined) {
      return this.voidEnvelope.getVoidDeathYAt(x, z, globalY);
    }
    return globalY;
  }

  /**
   * Evaluates if a player position has crossed the authoritative route-aware void death boundary.
   */
  public isPositionInVoid(pos: { x: number; y: number; z: number }): boolean {
    const globalY = this.getVoidDeathY();
    return this.voidEnvelope.isBelowVoidEnvelope(pos, globalY);
  }

  public buildFromRoute(
    route: RouteNode[],
    optionalRamps?: RouteNode[],
    recoveryShelves?: RouteNode[],
    obstacles?: RouteNode[],
    signalSpines?: RouteNode[]
  ): void {
    this.colliders = [];
    this.dynamicObstacles = [];
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
        const collider = new BoxCollider(obstacle);
        this.colliders.push(collider);

        if (obstacle.obstacleMotion) {
          const sin = Math.sin(obstacle.yaw);
          const cos = Math.cos(obstacle.yaw);
          this.dynamicObstacles.push({
            collider,
            baseX: obstacle.position.x,
            baseY: obstacle.position.y,
            baseZ: obstacle.position.z,
            lateralX: cos,
            lateralZ: -sin,
            amplitude: obstacle.obstacleMotion.amplitude,
            speed: obstacle.obstacleMotion.speed,
            phase: obstacle.obstacleMotion.phase
          });
        }
      }
    }

    this.lowestGameplayY = lowestY;
    this.killPlaneY = Number.isFinite(lowestY)
      ? (lowestY - PhysicsWorld.VOID_MARGIN)
      : -40.0;

    // Build authoritative route-aware void death envelope beneath legitimate gameplay phrases
    this.voidEnvelope.build(route, optionalRamps, recoveryShelves, signalSpines);
  }

  public addCollider(col: BoxCollider): void {
    this.colliders.push(col);
  }

  public clear(): void {
    this.colliders = [];
    this.dynamicObstacles = [];
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

  /**
   * Advances moving obstacle colliders to their deterministic position for the
   * given song time. No-op when a track has no moving obstacles, so tracks that
   * only use static obstacles pay nothing.
   */
  public updateDynamicObstacles(songTime: number): void {
    if (this.dynamicObstacles.length === 0) return;
    for (const dyn of this.dynamicObstacles) {
      const offset = dyn.amplitude * Math.sin(songTime * dyn.speed + dyn.phase);
      const collider = dyn.collider;
      collider.center.set(
        dyn.baseX + dyn.lateralX * offset,
        dyn.baseY,
        dyn.baseZ + dyn.lateralZ * offset
      );
      collider.matrix.setPosition(collider.center);
      collider.invMatrix.copy(collider.matrix).invert();
    }
  }

  public hasDynamicObstacles(): boolean {
    return this.dynamicObstacles.length > 0;
  }

  public dispose(): void {
    this.colliders = [];
    this.dynamicObstacles = [];
  }
}
