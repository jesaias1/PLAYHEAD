/**
 * SURF EXTRAS: the optional flow rings and the restore entry boost.
 * Neither changes movement equations, timing or the leaderboard.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SurfCourseGenerator } from '../src/generation/SurfCourseGenerator';
import { TrackAnalysis, AnalysisSection, SectionTheme } from '../src/audio/AudioFeatures';
import { buildFlowRingChains, FlowRings, distanceToSegment, FLOW_RING_RADIUS } from '../src/surf/FlowRings';
import {
  computeRestoreBoostUnits,
  RESTORE_BOOST_MAX_UNITS,
  RESTORE_BOOST_MIN_UNITS
} from '../src/player/RestorePolicy';
import { PlayerController } from '../src/player/PlayerController';
import { CameraController } from '../src/player/CameraController';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';

function mock(seed: number, duration: number, themes: SectionTheme[]): TrackAnalysis {
  const count = themes.length, step = duration / count;
  const sections: AnalysisSection[] = themes.map((t, i) => ({
    index: i, start: i * step, end: (i + 1) * step, duration: step,
    intensity: t === 'DROP' ? 0.95 : 0.6, rhythmicDensity: 0.7, brightness: 0.6, theme: t
  }));
  return {
    filename: `s_${seed}`, duration, bpm: 128, bpmConfidence: 0.85, globalEnergy: 0.65,
    frames: [], onsets: [], sections, waveform: new Float32Array(512), seed,
    visualAccent: { name: 'x', hex: '#00f0ff', rgb: [0, 240, 255] }
  };
}
const THEMES: SectionTheme[] = ['FLOW', 'BUILDUP', 'DROP', 'SPEED', 'DROP', 'PRECISION', 'DESCENT', 'ASCENT', 'DROP', 'FLOW'];
const track = SurfCourseGenerator.generate(mock(0x12345, 180, THEMES), 'SURF');

describe('flow rings', () => {
  const chains = buildFlowRingChains(track);

  it('are occasional: some ramps, never all of them', () => {
    const ribbons = new Set(track.route.filter(n => n.isSurf && n.ribbonId !== undefined).map(n => n.ribbonId));
    expect(chains.length).toBeGreaterThan(0);
    expect(chains.length).toBeLessThan(ribbons.size);
    for (const chain of chains) {
      expect(chain.rings.length).toBeGreaterThanOrEqual(4);
      expect(chain.rings.length).toBeLessThanOrEqual(7);
    }
  });

  it('are deterministic and finite', () => {
    expect(JSON.stringify(buildFlowRingChains(track))).toBe(JSON.stringify(chains));
    for (const chain of chains) {
      for (const ring of chain.rings) {
        expect(Number.isFinite(ring.center.x + ring.center.y + ring.center.z)).toBe(true);
        expect(Math.hypot(ring.forward.x, ring.forward.y, ring.forward.z)).toBeCloseTo(1, 4);
      }
    }
  });

  it('stay clear of obstacles and are absent on non-surf tracks', () => {
    for (const chain of chains) {
      for (const ring of chain.rings) {
        for (const o of track.obstacles ?? []) {
          expect(Math.hypot(ring.center.x - o.position.x, ring.center.y - o.position.y, ring.center.z - o.position.z)).toBeGreaterThan(3);
        }
      }
    }
    expect(buildFlowRingChains(null)).toEqual([]);
    expect(buildFlowRingChains({ ...track, courseType: 'PLAYHEAD' } as typeof track)).toEqual([]);
  });

  it('light up on a pass, once, and re-light on reset', () => {
    const rings = new FlowRings(new THREE.Scene());
    rings.configure(track);
    const first = chains[0].rings[0];
    const before = { x: first.center.x - first.forward.x * 3, y: first.center.y - first.forward.y * 3, z: first.center.z - first.forward.z * 3 };
    const after = { x: first.center.x + first.forward.x * 3, y: first.center.y + first.forward.y * 3, z: first.center.z + first.forward.z * 3 };
    rings.update(0.016, before, true);
    const hit = rings.update(0.016, after, true);
    expect(hit?.count).toBe(1);
    expect(hit?.chainId).toBe(chains[0].id);
    // Passing again does nothing until the rings are re-lit.
    rings.update(0.016, before, true);
    expect(rings.update(0.016, after, true)).toBeNull();
    rings.reset();
    rings.update(0.016, before, true);
    expect(rings.update(0.016, after, true)?.count).toBe(1);
    rings.dispose();
  });

  it('ignore a pass that misses by more than the ring radius, and do nothing when off', () => {
    const rings = new FlowRings(new THREE.Scene());
    rings.configure(track);
    const r = chains[0].rings[0];
    const off = { x: r.center.x + FLOW_RING_RADIUS * 3, y: r.center.y, z: r.center.z };
    rings.update(0.016, { x: off.x, y: off.y, z: off.z - 3 }, true);
    expect(rings.update(0.016, { x: off.x, y: off.y, z: off.z + 3 }, true)).toBeNull();
    expect(distanceToSegment({ x: 0, y: 1, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeCloseTo(1, 6);
    rings.dispose();
  });
});

describe('restore entry boost', () => {
  it('is 60% of the checkpoint speed, kept between the floor and the cap', () => {
    expect(computeRestoreBoostUnits(1000)).toBeCloseTo(600, 6);
    expect(computeRestoreBoostUnits(100)).toBe(RESTORE_BOOST_MIN_UNITS);
    expect(computeRestoreBoostUnits(9000)).toBe(RESTORE_BOOST_MAX_UNITS);
    expect(computeRestoreBoostUnits(NaN)).toBe(RESTORE_BOOST_MIN_UNITS);
  });

  it('raises speed along the facing, never lowers it, and leaves vertical velocity alone', () => {
    const camera = new CameraController(new THREE.PerspectiveCamera());
    const player = new PlayerController(camera, new PhysicsWorld());
    player.velocity.set(0, -3, 0);
    expect(player.applyEntryBoost(0.4, 600)).toBe(true);
    expect(player.getSpeedUnits()).toBeCloseTo(600, 3);
    expect(player.velocity.y).toBe(-3);
    // Already faster: untouched.
    player.applyRestoreVelocity(0.4, 900);
    expect(player.applyEntryBoost(0.4, 600)).toBe(false);
    expect(player.getSpeedUnits()).toBeCloseTo(900, 3);
  });
});
