/**
 * AuthorGhostGenerator: Synthesizes a deterministic, high-skill benchmark rival run ("The Echo")
 * from any procedural GeneratedTrack.
 */

import { GeneratedTrack, RouteNodeType } from '../generation/GenerationTypes';
import { ReplayFrame } from './ReplayRecorder';
import { lerp } from '../utils/math';

export interface AuthorGhostRun {
  seed: number;
  completionTime: number;
  frames: ReplayFrame[];
  checkpointTimes: number[];
}

export class AuthorGhostGenerator {
  /**
   * Generates a deterministic benchmark run for the given track.
   * Runs at 25 Hz sampling rate, matching the replay recording frequency.
   */
  public static generate(track: GeneratedTrack): AuthorGhostRun {
    const route = track.route;
    if (route.length < 2) {
      return {
        seed: track.seed,
        completionTime: 0,
        frames: [],
        checkpointTimes: []
      };
    }

    const frames: ReplayFrame[] = [];
    const sampleRate = 25; // 25 Hz
    const dt = 1 / sampleRate;

    // Author runs at ~95% of targetDuration (expert pace)
    const paceScale = 0.95;

    let currentTime = 0;
    let currentSpeed = 16.0; // Starting run speed in u/s
    let hopTimer = 0;
    const hopInterval = 0.52; // Bunny hop period in seconds

    // Track checkpoint times
    const checkpointTimes: number[] = new Array(track.checkpoints.length).fill(0);
    const reachedCheckpoints = new Set<number>();

    // Initial frame at start node
    const startNode = route[0];
    const startSurfaceY = startNode.position.y + (startNode.isSurf ? 0 : startNode.dimensions.y * 0.5);
    frames.push({
      time: 0,
      px: startNode.position.x,
      py: startSurfaceY,
      pz: startNode.position.z,
      yaw: startNode.yaw,
      pitch: 0,
      speed: currentSpeed
    });

    for (let i = 0; i < route.length - 1; i++) {
      const n0 = route[i];
      const n1 = route[i + 1];

      const dx = n1.position.x - n0.position.x;
      const dy = n1.position.y - n0.position.y;
      const dz = n1.position.z - n0.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // Determine segment duration based on node timestamps scaled by pace
      let segDuration = (n1.time - n0.time) * paceScale;
      if (segDuration < 0.1 || isNaN(segDuration)) {
        // Fallback to speed-based duration if node times are too tight
        segDuration = Math.max(0.1, dist / Math.max(currentSpeed, 12.0));
      }

      // Dynamic speed adjustments based on node type
      let targetSpeed = 20.0;
      if (n0.isBoost || n1.isBoost) {
        targetSpeed = Math.max(n0.boostSpeed || 32.0, 32.0);
      } else if (n0.isSurf || n1.isSurf) {
        targetSpeed = 26.0;
      } else if (n1.type === RouteNodeType.GAP || n1.type === RouteNodeType.OFFSET_GAP) {
        targetSpeed = 22.0;
      }

      const steps = Math.max(1, Math.round(segDuration / dt));
      const actualDt = segDuration / steps;

      for (let s = 1; s <= steps; s++) {
        const u = s / steps;
        currentTime += actualDt;
        hopTimer += actualDt;

        // Smooth speed transition
        currentSpeed = lerp(currentSpeed, targetSpeed, 0.1);

        // Horizontal position interpolation (Hermite-like smooth interpolation)
        const smoothU = u * u * (3 - 2 * u);
        const px = lerp(n0.position.x, n1.position.x, smoothU);
        const pz = lerp(n0.position.z, n1.position.z, smoothU);

        // Vertical position handling with physics feel from top of platform surfaces
        const surface0 = n0.position.y + (n0.isSurf ? 0 : n0.dimensions.y * 0.5);
        const surface1 = n1.position.y + (n1.isSurf ? 0 : n1.dimensions.y * 0.5);
        const basePy = lerp(surface0, surface1, u);

        let py: number;

        if (n0.isSurf && n1.isSurf) {
          // On surf ramp: follow ramp slope cleanly with slight lift
          py = basePy + 0.25;
        } else if (n1.type === RouteNodeType.GAP || n1.type === RouteNodeType.OFFSET_GAP || n1.type === RouteNodeType.STEP_DOWN) {
          // Parabolic jump arc over gap
          const jumpApex = Math.max(0.8, dist * 0.08);
          const arc = 4 * jumpApex * u * (1 - u);
          py = basePy + arc;
        } else {
          // Ground platform bhop hops: rhythmic slight bounce (0.4m apex)
          const hopPhase = (hopTimer % hopInterval) / hopInterval;
          const hopHeight = 0.45 * Math.sin(Math.PI * hopPhase);
          py = basePy + hopHeight;
        }

        // Heading & Pitch calculation
        const nextX = lerp(n0.position.x, n1.position.x, Math.min(1.0, smoothU + 0.05));
        const nextZ = lerp(n0.position.z, n1.position.z, Math.min(1.0, smoothU + 0.05));
        const moveDx = nextX - px;
        const moveDz = nextZ - pz;
        const hDist = Math.sqrt(moveDx * moveDx + moveDz * moveDz);

        let yaw = n0.yaw;
        if (hDist > 0.001) {
          yaw = Math.atan2(moveDx, moveDz);
          // Slight strafe oscillation synced to bhop
          if (!n0.isSurf) {
            const strafeWiggle = 0.04 * Math.sin((currentTime * Math.PI * 2) / hopInterval);
            yaw += strafeWiggle;
          }
        }

        const pitch = hDist > 0.001 ? Math.atan2(-(n1.position.y - n0.position.y), dist) * 0.3 : 0;

        frames.push({
          time: currentTime,
          px,
          py,
          pz,
          yaw,
          pitch,
          speed: currentSpeed
        });

        // Check if Author Ghost reached any checkpoints
        for (let c = 0; c < track.checkpoints.length; c++) {
          if (!reachedCheckpoints.has(c)) {
            const cp = track.checkpoints[c];
            const cdx = px - cp.position.x;
            const cdz = pz - cp.position.z;
            if (cdx * cdx + cdz * cdz < 10.0 * 10.0) {
              reachedCheckpoints.add(c);
              checkpointTimes[c] = currentTime;
            }
          }
        }
      }
    }

    // Ensure all checkpoints have reasonable fallback times if not geometrically triggered
    for (let c = 0; c < track.checkpoints.length; c++) {
      if (!reachedCheckpoints.has(c) || checkpointTimes[c] === 0) {
        checkpointTimes[c] = track.checkpoints[c].time * paceScale;
      }
    }

    const completionTime = frames[frames.length - 1].time;

    return {
      seed: track.seed,
      completionTime,
      frames,
      checkpointTimes
    };
  }
}
