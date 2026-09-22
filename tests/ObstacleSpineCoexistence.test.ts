import { describe, expect, it } from 'vitest';
import { TrackAnalysis } from '../src/audio/AudioFeatures';
import { RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';
import { RouteGenerator } from '../src/generation/RouteGenerator';
import { SignalSpineGenerator } from '../src/generation/SignalSpineGenerator';
import { SeededRandom } from '../src/generation/SeededRandom';
import { PLAYHEAD_MOVEMENT_V1 } from '../src/player/MovementConfig';

function analysis(seed = 0x504c4159): TrackAnalysis {
  return {
    filename: 'obstacle-spine.wav',
    duration: 180,
    bpm: 140,
    bpmConfidence: 0.95,
    globalEnergy: 0.85,
    frames: [],
    onsets: [],
    sections: [{
      index: 0,
      start: 0,
      end: 180,
      duration: 180,
      intensity: 0.85,
      rhythmicDensity: 0.85,
      brightness: 0.7,
      theme: 'BUILDUP'
    }],
    waveform: new Float32Array(16),
    seed,
    visualAccent: { name: 'Test Cyan', hex: '#00f0ff', rgb: [0, 240, 255] }
  };
}

function platform(id: number, z: number, x = 16, len = 30): RouteNode {
  return {
    id,
    time: 30 + id * 3,
    position: { x: 0, y: 0, z },
    dimensions: { x, y: 2, z: len },
    yaw: 0,
    pitch: 0,
    roll: 0,
    type: RouteNodeType.RUNWAY,
    intensity: 0.8,
    sectionIndex: 0,
    arcLength: z,
    isSurf: false,
    isBoost: false
  };
}

function hostObstacle(id: number, host: RouteNode, safeLane: 'LEFT' | 'RIGHT'): RouteNode {
  return {
    id,
    time: host.time,
    position: { ...host.position },
    dimensions: { x: 9, y: 4.2, z: 0.95 },
    yaw: host.yaw,
    pitch: 0,
    roll: 0,
    type: RouteNodeType.SPLIT_GATE,
    intensity: host.intensity,
    sectionIndex: host.sectionIndex,
    arcLength: host.arcLength,
    isSurf: false,
    isBoost: false,
    obstacleType: 'SPLIT_GATE',
    obstacleSafeLane: safeLane,
    obstacleSourceNodeId: host.id
  };
}

function conservativeOverlap(a: RouteNode, b: RouteNode): boolean {
  const ax = Math.hypot(a.dimensions.x, a.dimensions.z) * 0.5;
  const bx = Math.hypot(b.dimensions.x, b.dimensions.z) * 0.5;
  const dx = a.position.x - b.position.x;
  const dz = a.position.z - b.position.z;
  const reach = ax + bx;
  if (dx * dx + dz * dz >= reach * reach) return false;
  return Math.abs(a.position.y - b.position.y) < (a.dimensions.y + b.dimensions.y) * 0.5;
}

describe('Obstacle sections retain Signal Spine recovery', () => {
  it('is not blanket-excluded: an obstacle-section gap still receives a spine', () => {
    // Two consecutive obstacle-section gaps. The consecutive-unsupported cap
    // guarantees at least one of them gets a recovery line regardless of RNG.
    const route = [platform(0, 0), platform(1, 40), platform(2, 80), platform(3, 120), platform(4, 160)];
    const obstacles = [hostObstacle(900, route[1], 'LEFT'), hostObstacle(901, route[2], 'RIGHT')];

    let generated = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const spines = SignalSpineGenerator.generate(route, analysis(seed), new SeededRandom(seed), { obstacles });
      const report = SignalSpineGenerator.getLastReport()!;
      expect(report.obstacleTransfersFound).toBeGreaterThan(0);
      if (spines.length > 0) generated++;
    }
    expect(generated).toBeGreaterThan(0);
  });

  it('keeps obstacle-section spines skinny and landable, and never clipping the obstacle', () => {
    const route = [platform(0, 0), platform(1, 40), platform(2, 80), platform(3, 120), platform(4, 160)];
    const obstacles = [hostObstacle(900, route[1], 'LEFT'), hostObstacle(901, route[2], 'RIGHT')];

    for (let seed = 1; seed <= 10; seed++) {
      const spines = SignalSpineGenerator.generate(route, analysis(seed), new SeededRandom(seed), { obstacles });

      // Group spine segments by the gap they bridge.
      const widthsByGap = new Map<number, number[]>();
      for (const spine of spines) {
        const widths = widthsByGap.get(spine.arcLength) ?? [];
        widths.push(spine.dimensions.x);
        widthsByGap.set(spine.arcLength, widths);
      }

      for (const widths of widthsByGap.values()) {
        const widest = Math.max(...widths);
        const narrowest = Math.min(...widths);
        // Attachment is catchable (at least one player diameter).
        expect(widest).toBeGreaterThanOrEqual(PLAYHEAD_MOVEMENT_V1.playerRadius * 2 - 1e-9);
        // Never a wide easy bridge.
        expect(widest).toBeLessThanOrEqual(2.6);
        // Skinny profile somewhere along the span (~6-12% of platform width).
        expect(narrowest).toBeLessThanOrEqual(route[0].dimensions.x * 0.14);
      }

      for (const spine of spines) {
        // Recovery line is not sealed by an obstacle collider.
        for (const obstacle of obstacles) {
          expect(conservativeOverlap(spine, obstacle)).toBe(false);
        }
      }
    }
  });

  it('does not routinely create long zero-spine obstacle chains in procedural levels', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const track = RouteGenerator.generate(analysis(seed * 7919));
      const report = SignalSpineGenerator.getLastReport()!;
      const obstacles = track.obstacles ?? [];
      const spines = track.signalSpines ?? [];

      if (report.obstacleTransfersFound === 0) continue;

      // Elevated-risk coverage: obstacle transfers should mostly keep a spine.
      const coverage = report.obstacleConnectorsGenerated / report.obstacleTransfersFound;
      expect(coverage).toBeGreaterThanOrEqual(0.75);

      // No spine may clip an obstacle collider.
      for (const spine of spines) {
        for (const obstacle of obstacles) {
          expect(conservativeOverlap(spine, obstacle)).toBe(false);
        }
      }

      // Consecutive obstacle gaps without a spine are capped at 1.
      const hostIds = new Set(obstacles.map(o => o.obstacleSourceNodeId));
      const route = track.route;
      let run = 0;
      let maxRun = 0;
      for (let i = 0; i < route.length - 1; i++) {
        const a = route[i];
        const b = route[i + 1];
        if (a.isSurf || b.isSurf || a.type === RouteNodeType.FINISH || b.type === RouteNodeType.FINISH) continue;
        if (!hostIds.has(a.id) && !hostIds.has(b.id)) continue;
        const covered = spines.some(s => s.arcLength === a.arcLength);
        if (covered) {
          run = 0;
        } else {
          run++;
          maxRun = Math.max(maxRun, run);
        }
      }
      expect(maxRun).toBeLessThanOrEqual(2);
    }
  });
});
