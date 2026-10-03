import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { RemoteGhostRenderer, RemoteRacerGhosts } from '../src/online/RemoteGhostRenderer';
import { GhostSample, shouldAcceptRemoteGhost } from '../src/online/RaceRoomService';

afterEach(() => vi.restoreAllMocks());
const packet = (t: number, sequence: number, x: number, teleportId = 0): GhostSample => ({
  userId: 'remote', raceId: 'round-a', colorIndex: 1, t, sequence, teleportId,
  x, y: 0, z: -4, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0,
  checkpointIndex: 0, checkpointTotal: 4, running: true
});

describe('Online Race buffered presentation', () => {
  it('renders between received poses with a bounded delay instead of extrapolating', () => {
    let now = 10000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const ghost = new RemoteGhostRenderer(new THREE.Scene());
    ghost.setSample(packet(now, 1, 0));
    now += 100;
    ghost.setSample(packet(now, 2, 10));
    now += 50;
    ghost.update(0);
    expect(ghost.group.position.x).toBeCloseTo(5);
    now += 200;
    ghost.update(0);
    expect(ghost.group.position.x).toBe(10);
    ghost.dispose();
  });

  it('snaps a restore without interpolating across the world and ignores older packets', () => {
    let now = 10000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const ghost = new RemoteGhostRenderer(new THREE.Scene());
    ghost.setSample(packet(now, 10, 500));
    now += 100;
    ghost.setSample(packet(now, 11, 2, 1));
    ghost.update(0);
    expect(ghost.group.position.x).toBe(2);
    ghost.setSample(packet(now, 9, 900, 0));
    ghost.update(0);
    expect(ghost.group.position.x).toBe(2);
    ghost.dispose();
  });

  it('keeps seven independent remote identities and releases their geometry', () => {
    const scene = new THREE.Scene();
    const ghosts = new RemoteRacerGhosts(scene);
    for (let i = 0; i < 7; i++) ghosts.setSample({ ...packet(Date.now(), 1, i * 2), userId: `remote-${i}`, colorIndex: i });
    ghosts.setStaging(false, 0);
    ghosts.update(0);
    expect(ghosts.getCount()).toBe(7);
    expect(ghosts.states().every(s => s.showing)).toBe(true);
    ghosts.clear();
    expect(scene.children).toHaveLength(0);
  });

  it('rejects nonfinite or out-of-order sequence inputs before they reach rendering', () => {
    const sample = packet(Date.now(), 1, 0);
    expect(shouldAcceptRemoteGhost({ ...sample, x: NaN }, 'local', 'round-a')).toBe(false);
    expect(shouldAcceptRemoteGhost({ ...sample, sequence: Infinity }, 'local', 'round-a')).toBe(false);
    expect(shouldAcceptRemoteGhost(sample, 'local', 'round-b')).toBe(false);
  });
});
