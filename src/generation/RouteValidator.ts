/**
 * RouteValidator for TRACK//RUN
 * Validates critical path jump feasibility and repairs impossible gaps/steps
 */

import { RouteNode, RouteNodeType } from './GenerationTypes';

export interface ValidationConfig {
  playerRunSpeed: number;   // Expected running speed (m/s)
  playerJumpImpulse: number;// Vertical jump impulse (m/s)
  gravity: number;          // Gravity acceleration (m/s^2)
  safetyFactor: number;     // Conservative margin (e.g. 0.8)
  maxStepUp: number;        // Max single jump height gain (m)
}

export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  playerRunSpeed: 14.0,
  playerJumpImpulse: 8.8,
  gravity: 24.0,
  safetyFactor: 0.82,
  maxStepUp: 1.35
};

export class RouteValidator {
  public static validateAndRepair(
    nodes: RouteNode[],
    config: ValidationConfig = DEFAULT_VALIDATION_CONFIG
  ): { repairedNodes: RouteNode[]; repairsCount: number } {
    let repairsCount = 0;
    const repaired = [...nodes];

    for (let i = 0; i < repaired.length - 1; i++) {
      const current = repaired[i];
      const next = repaired[i + 1];

      // Calculate edge-to-edge distance along route heading
      // Current node end edge:
      const halfLenCurrent = current.dimensions.z * 0.5;
      const currentEnd = {
        x: current.position.x + Math.sin(current.yaw) * halfLenCurrent,
        y: current.position.y + current.dimensions.y * 0.5,
        z: current.position.z + Math.cos(current.yaw) * halfLenCurrent
      };

      // Next node start edge:
      const halfLenNext = next.dimensions.z * 0.5;
      const nextStart = {
        x: next.position.x - Math.sin(next.yaw) * halfLenNext,
        y: next.position.y + next.dimensions.y * 0.5,
        z: next.position.z - Math.cos(next.yaw) * halfLenNext
      };

      const dx = nextStart.x - currentEnd.x;
      const dz = nextStart.z - currentEnd.z;
      const horizontalGap = Math.sqrt(dx * dx + dz * dz);
      const dy = nextStart.y - currentEnd.y; // Positive if stepping UP

      // 1. Check upward elevation limit
      if (dy > config.maxStepUp) {
        // Lower next node elevation to safe limit
        const excess = dy - config.maxStepUp;
        next.position.y -= excess;
        repairsCount++;
      }

      // 2. Check maximum jump distance for this vertical delta
      const updatedDy = (next.position.y + next.dimensions.y * 0.5) - currentEnd.y;
      const maxFeasibleGap = this.calculateMaxJumpDistance(updatedDy, config);

      if (horizontalGap > maxFeasibleGap) {
        // Gap is too wide! Pull next node closer
        const safeGap = Math.max(1.0, maxFeasibleGap * 0.85);
        const pullRatio = safeGap / (horizontalGap + 1e-5);

        const newStartX = currentEnd.x + dx * pullRatio;
        const newStartZ = currentEnd.z + dz * pullRatio;

        next.position.x = newStartX + Math.sin(next.yaw) * halfLenNext;
        next.position.z = newStartZ + Math.cos(next.yaw) * halfLenNext;

        // Also widen landing platform for comfort
        next.dimensions.x = Math.max(next.dimensions.x, 8.0);
        next.dimensions.z = Math.max(next.dimensions.z, 10.0);

        repairsCount++;
      }

      // 3. Prevent landing platforms from being razor-thin, with generous dimensions in the first 25 seconds
      const isEarlyOnboarding = next.time < 25.0;
      const minWidth = isEarlyOnboarding ? 14.0 : 5.0;
      const minLength = isEarlyOnboarding ? 14.0 : 6.0;

      if (next.dimensions.x < minWidth) {
        next.dimensions.x = minWidth;
        repairsCount++;
      }
      if (next.dimensions.z < minLength && next.type !== RouteNodeType.CHECKPOINT) {
        next.dimensions.z = minLength;
        repairsCount++;
      }
    }

    return { repairedNodes: repaired, repairsCount };
  }

  /**
   * Physics trajectory calculation for reachable gap
   */
  public static calculateMaxJumpDistance(
    deltaY: number,
    config: ValidationConfig = DEFAULT_VALIDATION_CONFIG
  ): number {
    const vY = config.playerJumpImpulse;
    const g = config.gravity;
    const vX = config.playerRunSpeed;

    // Discriminant for: -0.5 * g * t^2 + vY * t - deltaY = 0
    // => 0.5 * g * t^2 - vY * t + deltaY = 0
    const disc = vY * vY - 2 * g * deltaY;

    if (disc < 0) {
      // Cannot reach this height with a normal jump
      return 0;
    }

    const tAir = (vY + Math.sqrt(disc)) / g;
    return vX * tAir * config.safetyFactor;
  }
}
