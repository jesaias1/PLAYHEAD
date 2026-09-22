/**
 * Authoritative obstacle motion for PLAYHEAD.
 *
 * There is exactly ONE obstacle motion implementation. It is consumed by:
 *  - PhysicsWorld.updateDynamicObstacles (collision)
 *  - World.update (production mesh animation)
 *  - MovementLab (obstacle gauntlet, driven by a deterministic Lab clock)
 *
 * Motion is a pure function of time, so a given track always presents the same
 * obstacle geometry. It is never driven by audio and never jitters.
 */

import { ObstacleMotion } from './GenerationTypes';

/** Peak lateral displacement of a moving obstacle at a given time. */
export function obstacleLateralOffset(motion: ObstacleMotion, time: number): number {
  return motion.amplitude * Math.sin(time * motion.speed + motion.phase);
}

/** Unit local +X (lateral) direction in world space for a node yaw. */
export function obstacleLateralDirection(yaw: number): { x: number; z: number } {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}
