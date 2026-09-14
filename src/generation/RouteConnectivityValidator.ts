/**
 * Authoritative Final Traversal Chain Validator for PLAYHEAD
 * Validates 100% physical connectivity across every single consecutive pair of route nodes.
 * Enforces the hard generation contract: no impossible course may ever reach the player.
 */

import * as THREE from 'three';
import { GeneratedTrack, RouteAnchor, RouteNode, RouteNodeType, Vector3Like } from './GenerationTypes';
import { DEFAULT_VALIDATION_CONFIG, ValidationConfig } from './RouteValidator';

export interface BrokenEdgeReport {
  index: number;
  from: {
    id: number;
    type: RouteNodeType;
    isSurf: boolean;
    position: Vector3Like;
    time: number;
  };
  to: {
    id: number;
    type: RouteNodeType;
    isSurf: boolean;
    position: Vector3Like;
    time: number;
  };
  transitionType: string;
  horizontalDist: number;
  verticalDelta: number;
  totalDist: number;
  headingDist: number;
  lateralDist: number;
  maxAllowedHorizontal: number;
  maxAllowedVertical: number;
  failureReason: string;
}

export interface RouteConnectivityResult {
  isValid: boolean;
  totalEdgesChecked: number;
  brokenEdges: BrokenEdgeReport[];
  maxObservedHorizontalGap: number;
  maxObservedStepUp: number;
  summary: string;
}

/**
 * Calculates the exact exit anchor (front edge center) of a node in 3D world space.
 */
export function getNodeExitAnchor(node: RouteNode): RouteAnchor {
  const euler = new THREE.Euler(node.pitch || 0, node.yaw || 0, node.roll || 0, 'YXZ');
  const halfLen = (node.dimensions.z || 0) * 0.5;
  const localOffset = new THREE.Vector3(0, 0, halfLen).applyEuler(euler);

  const pos: Vector3Like = {
    x: node.position.x + localOffset.x,
    y: node.position.y + localOffset.y,
    z: node.position.z + localOffset.z
  };

  return {
    position: pos,
    yaw: node.yaw,
    elevation: pos.y,
    arcLength: node.arcLength + halfLen
  };
}

/**
 * Calculates the exact entry anchor (back edge center) of a node in 3D world space.
 */
export function getNodeEntryAnchor(node: RouteNode): RouteAnchor {
  const euler = new THREE.Euler(node.pitch || 0, node.yaw || 0, node.roll || 0, 'YXZ');
  const halfLen = (node.dimensions.z || 0) * 0.5;
  const localOffset = new THREE.Vector3(0, 0, -halfLen).applyEuler(euler);

  const pos: Vector3Like = {
    x: node.position.x + localOffset.x,
    y: node.position.y + localOffset.y,
    z: node.position.z + localOffset.z
  };

  return {
    position: pos,
    yaw: node.yaw,
    elevation: pos.y,
    arcLength: Math.max(0, node.arcLength - halfLen)
  };
}

export class RouteConnectivityValidator {
  /**
   * Validates every mandatory traversal edge A -> B in the entire course.
   */
  public static validate(
    track: GeneratedTrack,
    config: ValidationConfig = DEFAULT_VALIDATION_CONFIG
  ): RouteConnectivityResult {
    const route = track.route;
    const brokenEdges: BrokenEdgeReport[] = [];
    let maxObservedHorizontalGap = 0;
    let maxObservedStepUp = 0;

    if (!route || route.length < 2) {
      return {
        isValid: false,
        totalEdgesChecked: 0,
        brokenEdges: [],
        maxObservedHorizontalGap: 0,
        maxObservedStepUp: 0,
        summary: 'Course contains fewer than 2 nodes'
      };
    }

    for (let i = 0; i < route.length - 1; i++) {
      const curr = route[i];
      const next = route[i + 1];

      // 1. Check coordinate finiteness
      if (
        !Number.isFinite(curr.position.x) ||
        !Number.isFinite(curr.position.y) ||
        !Number.isFinite(curr.position.z) ||
        !Number.isFinite(next.position.x) ||
        !Number.isFinite(next.position.y) ||
        !Number.isFinite(next.position.z)
      ) {
        brokenEdges.push(this.createReport(i, curr, next, 'CORRUPT_COORDINATES', 999, 999, 999, 0, 0, 0, 0, 'Non-finite coordinates detected'));
        continue;
      }

      // 2. Compute exact edge anchors
      const exitAnchor = getNodeExitAnchor(curr);
      const entryAnchor = getNodeEntryAnchor(next);

      const dx = entryAnchor.position.x - exitAnchor.position.x;
      const dy = entryAnchor.position.y - exitAnchor.position.y;
      const dz = entryAnchor.position.z - exitAnchor.position.z;

      const horizontalDist = Math.sqrt(dx * dx + dz * dz);
      const totalDist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // Decompose along current exit heading and lateral normal
      const fwdX = Math.sin(curr.yaw);
      const fwdZ = Math.cos(curr.yaw);
      const rightX = fwdZ;
      const rightZ = -fwdX;

      const headingDist = dx * fwdX + dz * fwdZ;
      const lateralDist = Math.abs(dx * rightX + dz * rightZ);

      maxObservedHorizontalGap = Math.max(maxObservedHorizontalGap, horizontalDist);
      maxObservedStepUp = Math.max(maxObservedStepUp, dy);

      // 3. Categorize transition type & evaluate physical constraints
      let transitionType = 'RUNWAY_TO_RUNWAY';
      let maxAllowedHorizontal = 13.5;
      let maxAllowedVertical = config.maxStepUp + 0.10; // 1.45m max step up

      if (curr.type === RouteNodeType.SURF_APPROACH && next.isSurf) {
        // Transition onto surf ramp
        transitionType = 'APPROACH_TO_SURF_RAMP';
        maxAllowedHorizontal = 12.0;
        maxAllowedVertical = 2.0; // Surf ramp lip can have slight vertical offset
      } else if (curr.isSurf && next.isSurf) {
        // Surf ramp to surf ramp transfer
        transitionType = 'SURF_TRANSFER';
        maxAllowedHorizontal = 20.0;
        maxAllowedVertical = 1.0; // Transfers must be level or downward
      } else if (curr.isSurf && next.type === RouteNodeType.LANDING) {
        // Surf ramp to landing catch deck
        transitionType = 'SURF_TO_LANDING';
        maxAllowedHorizontal = 14.0;
        maxAllowedVertical = 1.0; // Landing must catch at or below ramp bottom
      } else if (curr.type === RouteNodeType.LANDING && !next.isSurf) {
        // Landing deck to downstream runway
        transitionType = 'LANDING_TO_RUNWAY';
        maxAllowedHorizontal = 13.5;
        maxAllowedVertical = config.maxStepUp + 0.10;
      } else if (next.type === RouteNodeType.SURF_APPROACH) {
        // Runway leading into surf approach
        transitionType = 'RUNWAY_TO_SURF_APPROACH';
        maxAllowedHorizontal = 13.0;
        maxAllowedVertical = config.maxStepUp + 0.10;
      } else if (curr.type === RouteNodeType.BOOST) {
        // High speed boost exit
        transitionType = 'BOOST_EXIT';
        maxAllowedHorizontal = 18.0;
        maxAllowedVertical = config.maxStepUp + 0.10;
      }

      // 4. Catastrophic gap guard: broad impossible limits
      if (horizontalDist > 24.0 || totalDist > 35.0) {
        brokenEdges.push(
          this.createReport(
            i, curr, next, transitionType,
            horizontalDist, dy, totalDist, headingDist, lateralDist,
            maxAllowedHorizontal, maxAllowedVertical,
            `Catastrophic gap: ${horizontalDist.toFixed(1)}m horizontal (${totalDist.toFixed(1)}m 3D) exceeds absolute ceiling`
          )
        );
        continue;
      }

      // 5. Specific constraint violations
      if (horizontalDist > maxAllowedHorizontal) {
        brokenEdges.push(
          this.createReport(
            i, curr, next, transitionType,
            horizontalDist, dy, totalDist, headingDist, lateralDist,
            maxAllowedHorizontal, maxAllowedVertical,
            `Horizontal gap ${horizontalDist.toFixed(2)}m exceeds limit of ${maxAllowedHorizontal.toFixed(2)}m`
          )
        );
      } else if (dy > maxAllowedVertical) {
        brokenEdges.push(
          this.createReport(
            i, curr, next, transitionType,
            horizontalDist, dy, totalDist, headingDist, lateralDist,
            maxAllowedHorizontal, maxAllowedVertical,
            `Vertical step-up +${dy.toFixed(2)}m exceeds limit of +${maxAllowedVertical.toFixed(2)}m`
          )
        );
      }
    }

    const isValid = brokenEdges.length === 0;
    const summary = isValid
      ? `All ${route.length - 1} mandatory traversal edges validated successfully (max gap: ${maxObservedHorizontalGap.toFixed(2)}m, max step-up: +${maxObservedStepUp.toFixed(2)}m)`
      : `FAILED: ${brokenEdges.length} broken traversal edge(s) found in route chain`;

    return {
      isValid,
      totalEdgesChecked: route.length - 1,
      brokenEdges,
      maxObservedHorizontalGap,
      maxObservedStepUp,
      summary
    };
  }

  private static createReport(
    index: number,
    curr: RouteNode,
    next: RouteNode,
    transitionType: string,
    horizontalDist: number,
    verticalDelta: number,
    totalDist: number,
    headingDist: number,
    lateralDist: number,
    maxAllowedHorizontal: number,
    maxAllowedVertical: number,
    failureReason: string
  ): BrokenEdgeReport {
    return {
      index,
      from: {
        id: curr.id,
        type: curr.type,
        isSurf: curr.isSurf,
        position: { ...curr.position },
        time: curr.time
      },
      to: {
        id: next.id,
        type: next.type,
        isSurf: next.isSurf,
        position: { ...next.position },
        time: next.time
      },
      transitionType,
      horizontalDist,
      verticalDelta,
      totalDist,
      headingDist,
      lateralDist,
      maxAllowedHorizontal,
      maxAllowedVertical,
      failureReason
    };
  }
}
