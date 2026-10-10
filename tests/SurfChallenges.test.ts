import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { buildSurfChallengeTargets, SurfChallengeTracker } from '../src/feedback/SurfChallenges';
import { SignalPackCatalog } from '../src/audio/SignalPackCatalog';
import { PresetLevelCache } from '../src/audio/PresetLevelCache';
import { TrackGenerator } from '../src/generation/TrackGenerator';
import { SurfObstacleGenerator, SURF_OBSTACLE } from '../src/generation/SurfObstacleGenerator';
import { BoxCollider } from '../src/physics/Collider';
import type { GeneratedTrack } from '../src/generation/GenerationTypes';

function fixture(): GeneratedTrack {
  return { courseType: 'SURF', route: [0, 1, 2].map(id => ({ id, ribbon: { stations: [{
    center: { x: 0, y: 0, z: 10 + id * 40 }, normal: { x: 0, y: 1, z: 0 },
    tangent: { x: 0, y: 0, z: 1 }, right: { x: 1, y: 0, z: 0 }, halfWidth: 8
  }] } })), obstacles: [0, 1, 2].map(id => ({
    obstacleSourceNodeId: id, obstaclePhraseId: id === 2 ? 20 : 10,
    obstacleSurfPhraseKind: id === 2 ? 'SURF_RIB' : 'SURF_DOUBLE',
    obstacleSafeLane: 'LEFT', dimensions: { x: 3, y: 1, z: 2 }, arcLength: id * 40
  })) } as unknown as GeneratedTrack;
}
const sample = (z: number, x = -1.5, y = 0.6, surfing = true) => ({
  position: { x, y, z }, velocity: { x: 0, y: 0, z: 30 }, surfing
});
function cross(tracker: SurfChallengeTracker, z: number, x = -1.5, y = 0.6, surfing = true) {
  tracker.suspend(); tracker.update(1 / 120, sample(z - 0.2, x, y, surfing));
  return tracker.update(1 / 120, sample(z + 0.2, x, y, surfing));
}

describe('optional Surf challenge feedback', () => {
  it('requires the full ordered phrase and awards a clean streak once', () => {
    const tracker = new SurfChallengeTracker(); tracker.configure(fixture());
    expect(cross(tracker, 12.2)).toBeNull();
    expect(cross(tracker, 52.2)).toEqual({ kind: 'SURF_DOUBLE', streak: 1 });
    expect(cross(tracker, 52.2)).toBeNull();
    expect(cross(tracker, 92.2)).toEqual({ kind: 'SURF_RIB', streak: 2 });
  });
  it.each([[4, 0.6, true], [-1.5, 5, true], [-1.5, 0.6, false]])('does not award missed lanes, high bypasses, or airborne passes (%s,%s,%s)', (x, y, surfing) => {
    const tracker = new SurfChallengeTracker(); tracker.configure(fixture());
    cross(tracker, 12.2, x, y, surfing);
    expect(cross(tracker, 52.2)).toBeNull();
  });
  it('rejects out-of-order reads and teleport crossings', () => {
    const tracker = new SurfChallengeTracker(); tracker.configure(fixture());
    expect(cross(tracker, 52.2)).toBeNull();
    expect(cross(tracker, 12.2)).toBeNull();
    tracker.configure(fixture()); tracker.update(1 / 120, sample(0));
    expect(tracker.update(1 / 120, sample(20))).toBeNull();
    expect(cross(tracker, 52.2)).toBeNull();
  });
  it('breaks partial phrases on restore and resets on a new run', () => {
    const tracker = new SurfChallengeTracker(); tracker.configure(fixture());
    cross(tracker, 12.2); tracker.interrupt(); expect(cross(tracker, 52.2)).toBeNull();
    expect(cross(tracker, 92.2)?.streak).toBe(1);
    tracker.interrupt(); expect(cross(tracker, 92.2)).toBeNull();
    tracker.configure(fixture()); cross(tracker, 12.2);
    expect(cross(tracker, 52.2)?.streak).toBe(1);
  });
  it('does not bridge a paused interval or process a normal-mode track', () => {
    const tracker = new SurfChallengeTracker(); tracker.configure(fixture());
    tracker.update(1 / 120, sample(12)); tracker.suspend();
    expect(tracker.update(1 / 120, sample(12.4))).toBeNull();
    expect(cross(tracker, 52.2)).toBeNull();
    tracker.configure({ ...fixture(), courseType: 'PLAYHEAD' });
    expect(cross(tracker, 92.2)).toBeNull();
  });
});

describe('official Surf challenge variety', () => {
  it('ships distinct deterministic reads with safe keyholes across the catalog', () => {
    const allKinds = new Set<string>();
    for (const entry of SignalPackCatalog.getTracks()) {
      const { analysis } = PresetLevelCache.buildLevelData(JSON.parse(readFileSync(`public/music/presets/${entry.id}.json`, 'utf8')));
      const track = TrackGenerator.generate(analysis, 'SURF');
      expect(SurfObstacleGenerator.generate(track.route, analysis, track.checkpoints.map(cp => cp.routeNodeId))).toEqual(track.obstacles);
      const kinds = new Set(track.obstacles!.map(node => node.obstacleSurfPhraseKind));
      expect(kinds.size, entry.id).toBeGreaterThanOrEqual(3);
      for (const kind of kinds) allKinds.add(kind!);
      expect(track.obstacles!.length).toBeLessThanOrEqual(SURF_OBSTACLE.MAX_OBSTACLES);
      const targets = buildSurfChallengeTargets(track);
      expect(targets.length).toBeGreaterThan(0);
      for (const target of targets.filter(target => target.kind === 'SURF_KEYHOLE')) {
        expect(target.total).toBe(1);
        const solids = track.obstacles!.filter(node => node.obstaclePhraseId === target.phraseId);
        expect(solids.length).toBe(2);
        const a = SurfObstacleGenerator.describePlacement(solids[0], track.route)!;
        const b = SurfObstacleGenerator.describePlacement(solids[1], track.route)!;
        expect(Math.max(a.blockedMinLateral, b.blockedMinLateral) - Math.min(a.blockedMaxLateral, b.blockedMaxLateral)).toBeGreaterThanOrEqual(5.5 - 1e-6);
        const center = SurfObstacleGenerator.safeLaneWorldPoint(a, 0.5);
        for (const solid of solids) expect(new BoxCollider(solid).testSphere(new THREE.Vector3(center.x, center.y, center.z), 0.5).hasContact).toBe(false);
      }
    }
    expect([...allKinds]).toEqual(expect.arrayContaining(['SURF_DOUBLE', 'SURF_SWITCHBACK', 'SURF_KEYHOLE', 'SURF_SLALOM', 'SURF_WEAVE']));
  });
});
