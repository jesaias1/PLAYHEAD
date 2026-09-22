import { describe, expect, it } from 'vitest';
import { RouteNode } from '../src/generation/GenerationTypes';
import { obstacleLateralOffset } from '../src/generation/ObstacleMotion';
import { PLAYHEAD_MOVEMENT_V1 } from '../src/player/MovementConfig';
import {
  GAUNTLET_STATIONS,
  buildGauntletLayout,
  gauntletStationTitle
} from '../src/lab/gauntletLayout';

function conservativeOverlap(a: RouteNode, b: RouteNode): boolean {
  const ax = Math.hypot(a.dimensions.x, a.dimensions.z) * 0.5;
  const bx = Math.hypot(b.dimensions.x, b.dimensions.z) * 0.5;
  const dx = a.position.x - b.position.x;
  const dz = a.position.z - b.position.z;
  const reach = ax + bx;
  if (dx * dx + dz * dz >= reach * reach) return false;
  return Math.abs(a.position.y - b.position.y) < (a.dimensions.y + b.dimensions.y) * 0.5;
}

describe('Movement Lab — obstacle gauntlet', () => {
  it('builds a deterministic authored layout', () => {
    const a = buildGauntletLayout();
    const b = buildGauntletLayout();
    expect(a.route).toEqual(b.route);
    expect(a.obstacles).toEqual(b.obstacles);
    expect(a.signalSpines).toEqual(b.signalSpines);
    expect(a.checkpoints).toEqual(b.checkpoints);
    expect(a.obstacles.length).toBeGreaterThan(0);
  });

  it('represents every major obstacle type', () => {
    const { obstacles } = buildGauntletLayout();
    const types = new Set(obstacles.map(o => o.obstacleType));
    expect(types).toEqual(new Set([
      'SIGNAL_SHUTTER',
      'SCAN_BAR',
      'SPLIT_GATE',
      'PHASE_BLOCK',
      'SWEEP_BEAM'
    ]));
  });

  it('represents every production obstacle phrase', () => {
    const { obstacles } = buildGauntletLayout();
    const phrases = new Set(obstacles.map(o => o.obstaclePhraseKind));
    for (const kind of [
      'GATE_COMMIT',
      'PHASE_DODGE',
      'BEAM_HOP',
      'JUMP_THEN_STRAFE',
      'LEFT_RIGHT_THREAD',
      'THREE_WALL_THREAD',
      'FALSE_CENTER',
      'CUTOUT_SLALOM',
      'SHUTTER_APPROACH'
    ]) {
      expect(phrases.has(kind as never), `missing phrase ${kind}`).toBe(true);
    }
  });

  it('gives every obstacle station at least one real obstacle', () => {
    const layout = buildGauntletLayout();
    for (let i = 0; i < layout.stations.length; i++) {
      const station = layout.stations[i];
      if (station.kind === 'START' || station.kind === 'FINISH' || station.kind === 'RUNUP') continue;
      const host = layout.route[i];
      const hosted = layout.obstacles.filter(o => o.obstacleSourceNodeId === host.id);
      expect(hosted.length, `${station.label} produced no obstacle`).toBeGreaterThan(0);
      expect(hosted[0].obstaclePhraseKind, `${station.label} missing phrase metadata`).toBeTruthy();
    }
  });

  it('keeps compact signage out of the platform footprint and above head height', () => {
    const layout = buildGauntletLayout();
    expect(layout.signage.length).toBe(layout.stations.length);
    for (let i = 0; i < layout.signage.length; i++) {
      const sign = layout.signage[i];
      const station = layout.stations[i];
      // Beside the route, not over it.
      expect(Math.abs(sign.position.x)).toBeGreaterThan(station.width * 0.5);
      // Above the player's head so it cannot obscure the obstacle.
      expect(sign.position.y).toBeGreaterThan(2.5);
      expect(sign.width).toBeLessThanOrEqual(7);
    }
  });

  it('exposes moving obstacles through the single authoritative motion implementation', () => {
    const { obstacles } = buildGauntletLayout();
    const moving = obstacles.filter(o => o.obstacleMotion);
    expect(moving.some(o => o.obstacleType === 'SIGNAL_SHUTTER')).toBe(true);
    expect(moving.some(o => o.obstacleType === 'SWEEP_BEAM')).toBe(true);

    for (const obstacle of moving) {
      const motion = obstacle.obstacleMotion!;
      for (const time of [0, 0.75, 2.5, 6.125, 11]) {
        const offset = obstacleLateralOffset(motion, time);
        expect(Number.isFinite(offset)).toBe(true);
        expect(Math.abs(offset)).toBeLessThanOrEqual(motion.amplitude + 1e-9);
      }
      // Pure function of time: identical inputs resolve identically.
      expect(obstacleLateralOffset(motion, 3.3)).toBe(obstacleLateralOffset(motion, 3.3));
    }
  });

  it('provides valid, ordered test checkpoints for easy retry', () => {
    const layout = buildGauntletLayout();
    const obstacleStations = layout.stations.filter(s => s.kind !== 'START' && s.kind !== 'FINISH');
    expect(layout.checkpoints.length).toBe(obstacleStations.length);

    for (let i = 0; i < layout.checkpoints.length; i++) {
      const cp = layout.checkpoints[i];
      expect(cp.label).toBe(gauntletStationTitle(obstacleStations[i]));
      expect(cp.position.y).toBeGreaterThan(1.5);
      if (i > 0) {
        expect(cp.position.z).toBeGreaterThan(layout.checkpoints[i - 1].position.z);
      }
    }
  });

  it('keeps station banners in order and leaves approach distance before obstacles', () => {
    const layout = buildGauntletLayout();
    expect(layout.stations.length).toBe(layout.route.length);
    for (let i = 0; i < layout.route.length; i++) {
      expect(layout.route[i].type).toBe(
        layout.stations[i].kind === 'FINISH' ? 'FINISH' : 'RUNWAY'
      );
      if (i > 0) {
        expect(layout.route[i].position.z).toBeGreaterThan(layout.route[i - 1].position.z);
      }
    }
  });

  it('includes an obstacle + skinny spine recovery example', () => {
    const layout = buildGauntletLayout();
    expect(layout.signalSpines.length).toBeGreaterThan(0);

    const spine = layout.signalSpines[0];
    expect(spine.isSignalSpine).toBe(true);

    const spineStationIndex = layout.stations.findIndex(s => s.kind === 'SPINE');
    const host = layout.route[spineStationIndex];
    const widthRatio = spine.dimensions.x / host.dimensions.x;
    // Skinny recovery profile (obstacle-section spine), never a wide bridge.
    expect(widthRatio).toBeLessThanOrEqual(0.12);
    // Still landable: wider than the player diameter.
    expect(spine.dimensions.x).toBeGreaterThan(PLAYHEAD_MOVEMENT_V1.playerRadius * 2);

    // The recovery line is not sealed by the obstacle, and vice versa.
    for (const obstacle of layout.obstacles) {
      expect(conservativeOverlap(spine, obstacle)).toBe(false);
    }
  });

  it('uses the authored station list verbatim (no procedural randomness)', () => {
    const layout = buildGauntletLayout();
    expect(layout.stations).toBe(GAUNTLET_STATIONS);
  });
});
