/**
 * RouteVoidEnvelope for PLAYHEAD
 *
 * Implements a route-aware void death envelope beneath legitimate gameplay phrases
 * (platforms, jump arcs, surf ramps, signal spines, recovery shelves).
 *
 * Eliminates multi-second empty falls on vertically complex maps while strictly
 * preserving:
 *   1. Pure Y-boundary crossing semantics (never uses airtime, speed, or distance).
 *   2. Complete safety for lower descending routes and recovery geometry (stacking protection).
 *   3. Complete safety for legitimate high-speed airborne transfers and surf launches.
 */

import { RouteNode } from '../generation/GenerationTypes';
import { getPlatformMaxHalfWidth } from '../generation/PlatformShape';

export interface RouteVoidVolume {
  x1: number;
  z1: number;
  y1: number;
  x2: number;
  z2: number;
  y2: number;
  halfWidth: number;
}

export class RouteVoidEnvelope {
  private volumes: RouteVoidVolume[] = [];
  public lowestGeometryY = Infinity;

  /** Margin in metres beneath the lowest local underside before void death triggers. */
  public static readonly LOCAL_VOID_MARGIN = 20.0;

  /** Lateral reach around platforms (allowing wide air-strafes and bhop drifts). */
  public static readonly LATERAL_MARGIN = 26.0;

  public build(
    route: RouteNode[],
    optionalRamps?: RouteNode[],
    recoveryShelves?: RouteNode[],
    signalSpines?: RouteNode[]
  ): void {
    this.volumes = [];
    this.lowestGeometryY = Infinity;

    const allNodes: RouteNode[] = [
      ...route,
      ...(optionalRamps || []),
      ...(recoveryShelves || []),
      ...(signalSpines || [])
    ];

    // 1. Process all physical platform/ramp nodes
    for (const node of allNodes) {
      const halfLen = (node.dimensions.z || 0) * 0.5;
      const fwdX = Math.sin(node.yaw);
      const fwdZ = Math.cos(node.yaw);
      const pitch = node.pitch || 0;

      // Pitch-adjusted vertical offset along the platform length
      const pitchDy = -Math.sin(pitch) * halfLen;

      const entryX = node.position.x - fwdX * halfLen;
      const entryZ = node.position.z - fwdZ * halfLen;
      const exitX = node.position.x + fwdX * halfLen;
      const exitZ = node.position.z + fwdZ * halfLen;

      const trackHalfBreadth = getPlatformMaxHalfWidth(node);
      const halfWidth = trackHalfBreadth + RouteVoidEnvelope.LATERAL_MARGIN;

      const halfThickness = (node.dimensions.y || 2.0) * 0.5;
      const entryBottomY = node.position.y - pitchDy - halfThickness;
      const exitBottomY = node.position.y + pitchDy - halfThickness;

      const nodeMinBottom = Math.min(entryBottomY, exitBottomY);
      if (nodeMinBottom < this.lowestGeometryY) {
        this.lowestGeometryY = nodeMinBottom;
      }

      this.volumes.push({
        x1: entryX,
        z1: entryZ,
        y1: entryBottomY,
        x2: exitX,
        z2: exitZ,
        y2: exitBottomY,
        halfWidth
      });

      // For surf exits, extend flight corridor coverage 120m forward
      if (node.isSurf) {
        const surfLaunchLen = 120.0;
        const launchExitX = exitX + fwdX * surfLaunchLen;
        const launchExitZ = exitZ + fwdZ * surfLaunchLen;
        this.volumes.push({
          x1: exitX,
          z1: exitZ,
          y1: exitBottomY,
          x2: launchExitX,
          z2: launchExitZ,
          y2: exitBottomY - 16.0, // Accounts for descending surf launch trajectory
          halfWidth: halfWidth + 12.0
        });
      }
    }

    // 2. Process airborne flight paths between consecutive route nodes
    for (let i = 0; i < route.length - 1; i++) {
      const curr = route[i];
      const next = route[i + 1];

      const halfLenCurr = (curr.dimensions.z || 0) * 0.5;
      const fwdXCurr = Math.sin(curr.yaw);
      const fwdZCurr = Math.cos(curr.yaw);
      const pitchCurr = curr.pitch || 0;
      const pitchDyCurr = -Math.sin(pitchCurr) * halfLenCurr;
      const exitCurrX = curr.position.x + fwdXCurr * halfLenCurr;
      const exitCurrZ = curr.position.z + fwdZCurr * halfLenCurr;
      const exitCurrY = curr.position.y + pitchDyCurr - (curr.dimensions.y || 2.0) * 0.5;

      const halfLenNext = (next.dimensions.z || 0) * 0.5;
      const fwdXNext = Math.sin(next.yaw);
      const fwdZNext = Math.cos(next.yaw);
      const pitchNext = next.pitch || 0;
      const pitchDyNext = -Math.sin(pitchNext) * halfLenNext;
      const entryNextX = next.position.x - fwdXNext * halfLenNext;
      const entryNextZ = next.position.z - fwdZNext * halfLenNext;
      const entryNextY = next.position.y - pitchDyNext - (next.dimensions.y || 2.0) * 0.5;

      const halfWidth = Math.max(
        getPlatformMaxHalfWidth(curr),
        getPlatformMaxHalfWidth(next)
      ) + RouteVoidEnvelope.LATERAL_MARGIN + 4.0;

      this.volumes.push({
        x1: exitCurrX,
        z1: exitCurrZ,
        y1: exitCurrY - 1.5,
        x2: entryNextX,
        z2: entryNextZ,
        y2: entryNextY - 1.5,
        halfWidth
      });
    }
  }

  /**
   * Evaluates the authoritative void death Y boundary for a given world position.
   *
   * If the position sits within the horizontal coverage of any gameplay phrases,
   * the death boundary is derived from the LOWEST gameplay underside among all covering
   * volumes (stacking protection), minus LOCAL_VOID_MARGIN (20m).
   *
   * If the position sits in open space outside all gameplay phrases, it falls back
   * to the global world void boundary.
   */
  public getVoidDeathYAt(x: number, z: number, globalVoidY: number): number {
    let lowestCoveringBottomY = Infinity;

    for (let i = 0; i < this.volumes.length; i++) {
      const vol = this.volumes[i];

      // Distance from point (x, z) to 2D line segment [ (x1, z1), (x2, z2) ]
      const dx = vol.x2 - vol.x1;
      const dz = vol.z2 - vol.z1;
      const lenSq = dx * dx + dz * dz;

      let t = 0.5;
      let distSq: number;
      if (lenSq < 0.0001) {
        const dpx = x - vol.x1;
        const dpz = z - vol.z1;
        distSq = dpx * dpx + dpz * dpz;
      } else {
        t = Math.max(0, Math.min(1, ((x - vol.x1) * dx + (z - vol.z1) * dz) / lenSq));
        const projX = vol.x1 + t * dx;
        const projZ = vol.z1 + t * dz;
        const dpx = x - projX;
        const dpz = z - projZ;
        distSq = dpx * dpx + dpz * dpz;
      }

      if (distSq <= vol.halfWidth * vol.halfWidth) {
        // Interpolate the local bottom elevation along the segment
        const localBottomY = vol.y1 + t * (vol.y2 - vol.y1);
        if (localBottomY < lowestCoveringBottomY) {
          lowestCoveringBottomY = localBottomY;
        }
      }
    }

    if (!Number.isFinite(lowestCoveringBottomY)) {
      return globalVoidY;
    }

    const localKillY = lowestCoveringBottomY - RouteVoidEnvelope.LOCAL_VOID_MARGIN;
    return Math.max(globalVoidY, localKillY);
  }

  /** Fast boolean check whether a player position has crossed the authoritative void death envelope. */
  public isBelowVoidEnvelope(pos: { x: number; y: number; z: number }, globalVoidY: number): boolean {
    const killY = this.getVoidDeathYAt(pos.x, pos.z, globalVoidY);
    return pos.y < killY;
  }
}
