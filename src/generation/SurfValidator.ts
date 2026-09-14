/**
 * SurfValidator for PLAYHEAD
 * Validates generated surf phrases against physical invariants, reachability,
 * slope bounds, sightlines, and safe landings.
 */

import { RouteNode, RouteNodeType, Vector3Like } from './GenerationTypes';
import { GeneratedSurfPhrase } from './SurfPhraseGenerator';

export interface SurfValidationResult {
  isValid: boolean;
  failureReason?: string;
}

export class SurfValidator {
  /**
   * Validate a generated surf phrase
   */
  public static validate(phrase: GeneratedSurfPhrase): SurfValidationResult {
    const nodes = phrase.nodes;
    if (!nodes || nodes.length < 3) {
      return { isValid: false, failureReason: 'Too few nodes in surf phrase' };
    }

    const approach = nodes[0];
    if (approach.type !== RouteNodeType.SURF_APPROACH && approach.type !== RouteNodeType.RUNWAY) {
      return { isValid: false, failureReason: 'Missing clear approach runway' };
    }

    if (approach.dimensions.x < 12.0) {
      return { isValid: false, failureReason: 'Approach platform too narrow' };
    }

    const surfNodes = nodes.filter(n => n.isSurf);
    if (surfNodes.length === 0) {
      return { isValid: false, failureReason: 'No surf ramp nodes present' };
    }

    for (const ramp of surfNodes) {
      // Check slope / bank roll angle
      const slopeDeg = (Math.abs(ramp.roll) * 180) / Math.PI;
      if (slopeDeg < 48.0 || slopeDeg > 70.0) {
        return {
          isValid: false,
          failureReason: `Ramp slope ${slopeDeg.toFixed(1)}° outside surfable envelope (48° - 70°)`
        };
      }

      // Check ramp length
      if (ramp.dimensions.z < 20.0) {
        return {
          isValid: false,
          failureReason: `Ramp length ${ramp.dimensions.z}m too short for stable surf line`
        };
      }
    }

    // Check final landing platform
    const landing = nodes[nodes.length - 1];
    if (landing.type !== RouteNodeType.LANDING && landing.type !== RouteNodeType.RUNWAY) {
      return { isValid: false, failureReason: 'Missing landing catch deck' };
    }

    if (landing.dimensions.x < 16.0) {
      return { isValid: false, failureReason: `Landing width ${landing.dimensions.x}m too narrow` };
    }

    return { isValid: true };
  }

  /**
   * Create safe fallback runway/bhop platforms if a surf phrase fails validation
   */
  public static createFallback(
    startPos: Vector3Like,
    yaw: number,
    startArcLength: number,
    startNodeId: number,
    sectionIndex: number,
    time: number
  ): GeneratedSurfPhrase {
    const nodes: RouteNode[] = [];
    let currentPos = { ...startPos };
    let arcLength = startArcLength;
    let nodeId = startNodeId;

    const runwayLen = 50.0;
    const runwayWidth = 16.0;

    // Advance along yaw
    currentPos = {
      x: currentPos.x + Math.sin(yaw) * (runwayLen * 0.5 + 4.0),
      y: currentPos.y,
      z: currentPos.z + Math.cos(yaw) * (runwayLen * 0.5 + 4.0)
    };
    arcLength += runwayLen * 0.5 + 4.0;

    nodes.push({
      id: nodeId++,
      time,
      position: { ...currentPos },
      dimensions: { x: runwayWidth, y: 2.0, z: runwayLen },
      yaw,
      pitch: 0,
      roll: 0,
      type: RouteNodeType.RUNWAY,
      intensity: 0.5,
      sectionIndex,
      arcLength,
      isSurf: false,
      isBoost: false
    });

    currentPos = {
      x: currentPos.x + Math.sin(yaw) * (runwayLen * 0.5),
      y: currentPos.y,
      z: currentPos.z + Math.cos(yaw) * (runwayLen * 0.5)
    };
    arcLength += runwayLen * 0.5;

    return {
      nodes,
      endPos: currentPos,
      endYaw: yaw,
      endArcLength: arcLength,
      nextNodeId: nodeId
    };
  }
}
