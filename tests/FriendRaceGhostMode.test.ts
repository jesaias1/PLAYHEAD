/**
 * FRIEND RACE — LIVE OPPONENT GHOST.
 *
 * Human 1v1 testing found that neither player could see the other, while the
 * ordinary solo blueprint ghosts still appeared. The two causes were separate:
 *
 *   1. SOLO GHOSTS WERE NEVER GATED. `GhostManager` created the cyan PB ghost
 *      and the violet ECHO/RIVAL ghost on every race-map load and updated them
 *      unconditionally, so those were the blue/pink boxes on screen.
 *
 *   2. THE REMOTE GHOST WAS NEVER FED BEFORE THE TIMER STARTED. Publication was
 *      gated on the shared session being ACTIVE, so on the start platform the
 *      opponent simply did not exist.
 *
 * These tests protect the repairs:
 *   - friend race disables every solo ghost source (PB / WORLD / BEST RECORDED)
 *   - the remote opponent renderer stays enabled and is the ONLY race ghost
 *   - the opponent is visible before the countdown, with no movement required
 *   - the local player's own transform is never rendered as a remote ghost
 *   - an opponent reset moves the ghost, it does not hide it
 *   - staleness and leave/rejoin stay safe
 *   - leaving friend race restores normal solo ghost behaviour
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';

import { GhostManager } from '../src/replay/GhostManager';
import { GhostRaceController } from '../src/replay/GhostRaceController';
import { GhostVisual } from '../src/replay/GhostVisual';
import { GhostStorage } from '../src/replay/GhostStorage';
import { GeneratedTrack, RouteNodeType } from '../src/generation/GenerationTypes';
import { SettingsManager } from '../src/core/Settings';
import {
  RemoteGhostRenderer,
  RIVAL_SIGNAL_COLOR,
  HOST_SIGNAL_COLOR,
  GUEST_SIGNAL_COLOR,
  STALE_MS
} from '../src/online/RemoteGhostRenderer';
import {
  GhostSample,
  shouldAcceptRemoteGhost
} from '../src/online/RaceRoomService';
import { raceGhostDiagnosticsLine } from '../src/ui/DevOverlay';
import { buildGhostRaceRun, pbGhostLabel } from '../src/replay/GhostRaceSource';
import {
  PovReplay,
  POV_REPLAY_VERSION,
  POV_REPLAY_SAMPLE_HZ,
  writeSample,
  encodePovReplay,
  computeReplayHash
} from '../src/replay/pov/PovReplayFormat';
import * as fs from 'fs';
import * as path from 'path';

const IDENTITY = {
  trackId: 'SIGNAL_01',
  mapVersion: 1,
  mapFingerprint: 'mfp_v1_TEST',
  movementVersion: 'phmv1_2865D271',
  analysisFingerprint: 'afp_v1_TEST'
};

const repoRoot = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const gameSrc = read('src/core/Game.ts');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const memoryStore = new Map<string, string>();

beforeEach(() => {
  memoryStore.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => memoryStore.get(k) ?? null,
      setItem: (k: string, v: string) => memoryStore.set(k, v),
      removeItem: (k: string) => memoryStore.delete(k),
      clear: () => memoryStore.clear()
    },
    writable: true,
    configurable: true
  });
  SettingsManager.getInstance().settings.ghostMode = 'ALL';
});

function makeTrack(seed = 0x9999): GeneratedTrack {
  return {
    seed,
    route: [
      {
        id: 0,
        time: 0,
        position: { x: 0, y: 0, z: 0 },
        dimensions: { x: 8, y: 1, z: 20 },
        yaw: 0,
        pitch: 0,
        roll: 0,
        type: RouteNodeType.RUNWAY,
        intensity: 0.5,
        sectionIndex: 0,
        arcLength: 0,
        isSurf: false,
        isBoost: false
      },
      {
        id: 1,
        time: 5,
        position: { x: 0, y: 0, z: 80 },
        dimensions: { x: 8, y: 1, z: 20 },
        yaw: 0,
        pitch: 0,
        roll: 0,
        type: RouteNodeType.FINISH,
        intensity: 0.5,
        sectionIndex: 0,
        arcLength: 80,
        isSurf: false,
        isBoost: false
      }
    ],
    checkpoints: [],
    finish: { routeNodeId: 1, time: 5, position: { x: 0, y: 0, z: 80 }, yaw: 0 },
    totalDistance: 80,
    targetDuration: 5,
    repairedJumpsCount: 0
  } as unknown as GeneratedTrack;
}

/** Solo ghosts are added to the scene by name, so tests never touch privates. */
function soloGhostGroups(scene: THREE.Scene): THREE.Object3D[] {
  return scene.children.filter(
    (c) => c.name === 'Ghost_Player_PB' || c.name === 'Ghost_Rival_Echo'
  );
}

function visibleSoloGhosts(scene: THREE.Scene): string[] {
  return soloGhostGroups(scene)
    .filter((g) => g.visible)
    .map((g) => g.name);
}

function sample(over: Partial<GhostSample> = {}): GhostSample {
  return {
    userId: 'remote-player',
    t: Date.now(),
    x: 10,
    y: 2,
    z: 20,
    yaw: 0.5,
    pitch: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    running: true,
    attempt: 0,
    ...over
  };
}

function pbRun() {
  const samples: number[] = [];
  const count = Math.round(3 * POV_REPLAY_SAMPLE_HZ);
  for (let i = 0; i < count; i++) {
    const s = i / POV_REPLAY_SAMPLE_HZ;
    writeSample(
      samples,
      s * 1000,
      { x: 0, y: 1.5, z: s * 20 },
      { x: 0, y: 0, z: 20 },
      0,
      0,
      true,
      false,
      0
    );
  }

  const draft: PovReplay = {
    replayVersion: POV_REPLAY_VERSION,
    identity: IDENTITY,
    finishTimeUs: 3_000_000,
    durationMs: 3000,
    sampleHz: POV_REPLAY_SAMPLE_HZ,
    fov: 100,
    startSongTimeMs: 0,
    s: samples,
    events: [{ t: 3000, type: 'FINISH' }],
    cosmetic: { skinId: 'SIGNAL_CYAN' },
    hash: ''
  };
  draft.hash = computeReplayHash(encodePovReplay(draft));

  const built = buildGhostRaceRun({
    kind: 'PB',
    label: pbGhostLabel(),
    replay: draft,
    expectedIdentity: IDENTITY,
    payload: encodePovReplay(draft),
    expectedHash: draft.hash
  });
  if (!built.ok) throw new Error(`fixture failed: ${built.reason}`);
  return built.run;
}

// ---------------------------------------------------------------------------
// 1. Friend race disables EVERY solo ghost source
// ---------------------------------------------------------------------------

describe('Friend race — solo ghosts disabled', () => {
  it('disables the synthetic ECHO / RIVAL ghost', () => {
    const scene = new THREE.Scene();
    const manager = new GhostManager(scene);
    manager.prepareTrack(makeTrack(), 'TEST');
    manager.start();
    manager.update(0.5, new THREE.Vector3(0, 1.5, 0), 0.016);
    expect(visibleSoloGhosts(scene)).toContain('Ghost_Rival_Echo');

    manager.setFriendRaceMode(true);
    manager.update(0.5, new THREE.Vector3(0, 1.5, 0), 0.016);
    expect(visibleSoloGhosts(scene)).not.toContain('Ghost_Rival_Echo');
  });

  it('disables the PB ghost', () => {
    const track = makeTrack(0x4242);
    GhostStorage.savePB(
      track.seed,
      'TEST',
      12,
      1000,
      Array.from({ length: 12 }, (_, i) => ({
        time: i * 0.1,
        px: 0,
        py: 1.5,
        pz: i * 2,
        yaw: 0,
        pitch: 0,
        speed: 10 + i
      })),
      []
    );

    const scene = new THREE.Scene();
    const manager = new GhostManager(scene);
    manager.prepareTrack(track, 'TEST');
    manager.start();
    manager.update(0.2, new THREE.Vector3(0, 1.5, 0), 0.016);
    expect(soloGhostGroups(scene).map((g) => g.name)).toContain('Ghost_Player_PB');
    expect(visibleSoloGhosts(scene)).toContain('Ghost_Player_PB');

    manager.setFriendRaceMode(true);
    manager.update(0.2, new THREE.Vector3(0, 1.5, 0), 0.016);
    expect(visibleSoloGhosts(scene)).not.toContain('Ghost_Player_PB');
  });

  it('overrides the user ghost setting: ALL still means none during a race', () => {
    SettingsManager.getInstance().settings.ghostMode = 'ALL';
    const scene = new THREE.Scene();
    const manager = new GhostManager(scene);
    manager.setFriendRaceMode(true);
    manager.prepareTrack(makeTrack(), 'TEST');
    manager.start();
    manager.update(0.5, new THREE.Vector3(0, 1.5, 0), 0.016);
    expect(visibleSoloGhosts(scene)).toEqual([]);
  });

  it('is a hard no-op in update: a solo ghost cannot be resurrected', () => {
    const scene = new THREE.Scene();
    const manager = new GhostManager(scene);
    manager.prepareTrack(makeTrack(), 'TEST');
    manager.setFriendRaceMode(true);
    // Every solo source is hidden before update.
    manager.update(0.5, new THREE.Vector3(0, 1.5, 0), 0.016);
    manager.update(5.0, new THREE.Vector3(0, 1.5, 0), 0.016);
    manager.applySettingsVisibility();
    expect(visibleSoloGhosts(scene)).toEqual([]);
  });

  it('disables the recorded BEST RECORDED / WORLD ghost controller', () => {
    const scene = new THREE.Scene();
    const controller = new GhostRaceController(scene);
    controller.load(pbRun());
    expect(controller.isActive()).toBe(true);

    controller.setFriendRaceMode(true);
    // Entering friend race RELEASES the recorded ghost entirely.
    expect(controller.isActive()).toBe(false);
    expect(scene.children.filter((c) => c.name === 'GhostRaceRecorded')).toHaveLength(0);
  });

  it('refuses to arm a recorded ghost while friend race mode is on', () => {
    const scene = new THREE.Scene();
    const controller = new GhostRaceController(scene);
    controller.setFriendRaceMode(true);
    controller.load(pbRun());
    expect(controller.isActive()).toBe(false);
    controller.start();
    controller.update(1.0, new THREE.Vector3(0, 0, 0));
    expect(scene.children.filter((c) => c.name === 'GhostRaceRecorded')).toHaveLength(0);
  });

  it('restores normal solo ghost eligibility after leaving the race', () => {
    const scene = new THREE.Scene();
    const manager = new GhostManager(scene);
    manager.prepareTrack(makeTrack(), 'TEST');
    manager.setFriendRaceMode(true);
    manager.update(0.5, new THREE.Vector3(0, 1.5, 0), 0.016);
    expect(visibleSoloGhosts(scene)).toEqual([]);

    manager.setFriendRaceMode(false);
    manager.update(0.5, new THREE.Vector3(0, 1.5, 0), 0.016);
    expect(visibleSoloGhosts(scene)).toContain('Ghost_Rival_Echo');

    // And a recorded ghost can be armed again.
    const controller = new GhostRaceController(scene);
    controller.setFriendRaceMode(true);
    controller.setFriendRaceMode(false);
    controller.load(pbRun());
    expect(controller.isActive()).toBe(true);
  });

  it('never leaves friend-race mode latched on a disposed manager', () => {
    const scene = new THREE.Scene();
    const manager = new GhostManager(scene);
    manager.setFriendRaceMode(true);
    manager.dispose();
    expect(manager.isFriendRaceMode()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. The remote opponent stays enabled and is the ONLY race ghost
// ---------------------------------------------------------------------------

describe('Friend race — remote opponent is the only ghost', () => {
  it('keeps the remote opponent renderer enabled while solo ghosts are off', () => {
    const scene = new THREE.Scene();
    const manager = new GhostManager(scene);
    const remote = new RemoteGhostRenderer(scene);

    manager.setFriendRaceMode(true);
    remote.setSample(sample());

    expect(visibleSoloGhosts(scene)).toEqual([]);
    expect(remote.isShowing()).toBe(true);
  });

  it('creates exactly ONE remote ghost for ONE remote player', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    expect(scene.children.filter((c) => c.name === 'RemoteSignalGhost')).toHaveLength(1);

    remote.setSample(sample({ userId: 'a' }));
    remote.setSample(sample({ userId: 'a' }));
    remote.setSample(sample({ userId: 'a' }));
    expect(scene.children.filter((c) => c.name === 'RemoteSignalGhost')).toHaveLength(1);
    expect(remote.getDiagnostics().samplesReceived).toBe(3);
  });

  it('the game instantiates exactly one remote renderer', () => {
    const matches = gameSrc.match(/new RemoteGhostRenderer\(/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('the remote opponent does not use recorded replay sampling', () => {
    const src = read('src/online/RemoteGhostRenderer.ts');
    expect(src).not.toMatch(/sampleGhost/);
    expect(src).not.toMatch(/GhostRaceRun/);
    expect(src).not.toMatch(/PovReplay/);
    // It uses live realtime packets.
    expect(src).toMatch(/GhostSample/);
  });
});

// ---------------------------------------------------------------------------
// 3. Pre-start presence: visible before the countdown, no movement required
// ---------------------------------------------------------------------------

describe('Friend race — pre-start presence', () => {
  it('spawns the remote ghost from ONE valid transform', () => {
    const remote = new RemoteGhostRenderer(new THREE.Scene());
    expect(remote.isShowing()).toBe(false);
    remote.setSample(sample({ x: 3, y: 1.5, z: -4 }));
    expect(remote.isShowing()).toBe(true);
    expect(remote.getDiagnostics().hasTarget).toBe(true);
  });

  it('requires no movement: a stationary transform is enough', () => {
    const remote = new RemoteGhostRenderer(new THREE.Scene());
    const still = sample({ x: 0, y: 1.5, z: 0, vx: 0, vy: 0, vz: 0 });
    remote.setSample(still);
    expect(remote.isShowing()).toBe(true);
    // And it stays visible on the start platform across frames.
    for (let i = 0; i < 30; i++) {
      remote.update(1 / 120, new THREE.Vector3(0, 1.5, 0));
      still.t = Date.now();
      remote.setSample(still);
    }
    expect(remote.isShowing()).toBe(true);
  });

  it('snaps to the first transform instead of sliding across the map', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    remote.setSample(sample({ x: 100, y: 5, z: -200 }));
    remote.update(1 / 120, new THREE.Vector3(0, 0, 0));
    const group = scene.children.find((c) => c.name === 'RemoteSignalGhost')!;
    expect(group.position.x).toBeCloseTo(100, 3);
    expect(group.position.z).toBeCloseTo(-200, 3);
  });

  it('the game publishes an initial transform on spawn and on entering the world', () => {
    // Published on every spawn (race map load and hold-R restart)...
    const spawnBlock = gameSrc.slice(
      gameSrc.indexOf('this.playerController.setPosition(spawnPos);'),
      gameSrc.indexOf('this.playerController.setPosition(spawnPos);') + 600
    );
    expect(spawnBlock).toMatch(/this\.publishLocalGhostSample\(\)/);

    // ...and again when the world goes live, so countdown-aged samples cannot
    // leave the opponent invisible.
    const playing = gameSrc.slice(
      gameSrc.indexOf('case GameState.PLAYING:'),
      gameSrc.indexOf('case GameState.PLAYING:') + 700
    );
    expect(playing).toMatch(/this\.publishLocalGhostSample\(\)/);
  });

  it('never publishes a stale position before the race map loads', () => {
    const setWorld = gameSrc.slice(
      gameSrc.indexOf('private setFriendRaceWorld('),
      gameSrc.indexOf('private setFriendRaceWorld(') + 900
    );
    // setFriendRaceWorld runs before the map load, so it must not publish.
    expect(setWorld).not.toMatch(/this\.publishLocalGhostSample\(\)/);
    // But it must release any armed recorded solo ghost.
    expect(setWorld).toMatch(/this\.clearGhostRace\(\)/);
  });

  it('publication runs for the whole race world, not only while ACTIVE', () => {
    const update = gameSrc.slice(
      gameSrc.indexOf('private updateRace(frameDelta: number)'),
      gameSrc.indexOf('private updateRace(frameDelta: number)') + 300
    );
    expect(update).toMatch(/if \(!this\.friendRaceWorld\) return;/);
    // The old ACTIVE-only gate must be gone from the publish path.
    expect(update).not.toMatch(/if \(!this\.raceActive \|\| this\.raceStartAtMs === null\) return;/);
  });

  it('publishes the spawn before the shared timer is scheduled', () => {
    const begin = gameSrc.slice(
      gameSrc.indexOf('private async beginRaceFromSchedule('),
      gameSrc.indexOf('private async beginRaceFromSchedule(') + 2200
    );
    // Race world mode (which releases the recorded ghost) is entered before the
    // map load, and the spawn is republished after it.
    expect(begin).toMatch(/this\.setFriendRaceWorld\(true\)/);
    expect(begin.indexOf('this.setFriendRaceWorld(true)')).toBeLessThan(
      begin.indexOf('await this.loadPresetTrack(')
    );
    expect(begin).toMatch(/this\.publishLocalGhostSample\(\)/);
  });

  it('countdown and active states preserve remote visibility', () => {
    const remote = new RemoteGhostRenderer(new THREE.Scene());
    remote.setSample(sample({ running: true }));
    // Countdown: no attempt started yet, still visible.
    remote.update(1 / 60, new THREE.Vector3(0, 0, 0));
    expect(remote.isShowing()).toBe(true);
    // Active: still visible.
    remote.setSample(sample({ x: 40, running: true }));
    remote.update(1 / 60, new THREE.Vector3(0, 0, 0));
    expect(remote.isShowing()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Overlap on the start platform
// ---------------------------------------------------------------------------

describe('Friend race — overlapping players', () => {
  it('the remote ghost is double-sided so an overlap cannot cull it', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    const visual = (remote as unknown as { visual: GhostVisual }).visual;
    const group = visual.group;
    for (const child of group.children) {
      const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      expect(material.side).toBe(THREE.DoubleSide);
    }
  });

  it('recorded solo ghosts keep front faces: their look is unchanged', () => {
    const visual = new GhostVisual(new THREE.Scene(), { color: 0x00f0ff });
    for (const child of visual.group.children) {
      const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      expect(material.side).toBe(THREE.FrontSide);
    }
    visual.dispose();
  });

  it('has NO proximity fade: an overlapping opponent is never faded out', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    const local = new THREE.Vector3(0, 1.5, 0);
    // Remote standing exactly where the local player is.
    remote.setSample(sample({ x: 0, y: 1.5, z: 0 }));
    for (let i = 0; i < 10; i++) {
      remote.setSample(sample({ x: 0, y: 1.5, z: 0 }));
      remote.update(1 / 120, local);
    }
    const diag = remote.getDiagnostics();
    expect(diag.distanceM).toBeCloseTo(0, 2);
    expect(diag.visible).toBe(true);
    // The 1.6 m solo fade constant must not appear in the live path.
    expect(read('src/online/RemoteGhostRenderer.ts')).not.toMatch(/ghostProximityScale|GHOST_NEAR_HIDE_M/);
  });

  it('reports the distance to the remote for diagnostics', () => {
    const remote = new RemoteGhostRenderer(new THREE.Scene());
    remote.setSample(sample({ x: 3, y: 4, z: 0 }));
    remote.update(1 / 60, new THREE.Vector3(0, 0, 0));
    expect(remote.getDiagnostics().distanceM).toBeCloseTo(5, 1);
  });
});

// ---------------------------------------------------------------------------
// 5. Identity: one local player, one remote ghost, deterministic colours
// ---------------------------------------------------------------------------

describe('Friend race — opponent identity', () => {
  it('assigns deterministic host and guest colours', () => {
    expect(HOST_SIGNAL_COLOR).toBe(0x00f0ff);
    expect(GUEST_SIGNAL_COLOR).toBe(RIVAL_SIGNAL_COLOR);
    expect(HOST_SIGNAL_COLOR).not.toBe(GUEST_SIGNAL_COLOR);
  });

  it('each client renders the REMOTE player in the REMOTE player colour', () => {
    const begin = gameSrc.slice(
      gameSrc.indexOf('Deterministic opponent identity'),
      gameSrc.indexOf('Deterministic opponent identity') + 400
    );
    // The HOST sees the guest (violet); the GUEST sees the host (cyan).
    expect(begin).toMatch(/raceRoomService\.isHost\(\) \? GUEST_SIGNAL_COLOR : HOST_SIGNAL_COLOR/);
  });

  it('never renders the local player as a remote ghost', () => {
    const now = Date.now();
    expect(shouldAcceptRemoteGhost(sample({ userId: 'me', t: now }), 'me', now)).toBe(false);
    expect(shouldAcceptRemoteGhost(sample({ userId: 'them', t: now }), 'me', now)).toBe(true);
    expect(shouldAcceptRemoteGhost(sample({ userId: 'them', t: now }), null, now)).toBe(false);
    expect(shouldAcceptRemoteGhost(undefined, 'me', now)).toBe(false);
  });

  it('keeps the self-echo guard at both layers', () => {
    const src = read('src/online/RaceRoomService.ts');
    expect(src).toMatch(/broadcast: \{ self: false \}/);
    expect(src).toMatch(/shouldAcceptRemoteGhost/);
  });
});

// ---------------------------------------------------------------------------
// 6. Reset, leave and staleness
// ---------------------------------------------------------------------------

describe('Friend race — reset, leave, staleness', () => {
  it('an opponent reset moves the ghost to their spawn instead of hiding it', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    const group = scene.children.find((c) => c.name === 'RemoteSignalGhost')!;

    remote.setSample(sample({ x: 80, y: 3, z: 120, running: true }));
    remote.update(1, new THREE.Vector3(0, 0, 0));
    expect(group.position.x).toBeCloseTo(80, 1);

    // Remote held R: their live transform is now the spawn, running:false.
    for (let i = 0; i < 60; i++) {
      remote.setSample(sample({ x: 0, y: 1.5, z: 0, running: false }));
      remote.update(1 / 60, new THREE.Vector3(0, 0, 0));
    }
    expect(group.position.x).toBeCloseTo(0, 1);
    expect(group.position.z).toBeCloseTo(0, 1);
    expect(remote.isShowing()).toBe(true);
  });

  it('a local restart never touches the remote ghost', () => {
    const remote = new RemoteGhostRenderer(new THREE.Scene());
    remote.setSample(sample({ x: 12, y: 2, z: 7 }));
    const before = remote.getDiagnostics();
    // The local player restarting does not clear or move the remote ghost.
    remote.update(1 / 60, new THREE.Vector3(0, 0, 0));
    const after = remote.getDiagnostics();
    expect(after.hasTarget).toBe(before.hasTarget);
    expect(after.visible).toBe(true);

    // And the game never clears the remote ghost on a local attempt restart.
    const restart = gameSrc.slice(
      gameSrc.indexOf('private onRaceAttemptRestart('),
      gameSrc.indexOf('private onRaceAttemptRestart(') + 700
    );
    expect(restart).not.toMatch(/this\.raceGhost\?\.clear\(\)/);
    expect(restart).toMatch(/reportAttemptStart/);
  });

  it('drops stale packets and fades rather than freezing', () => {
    const remote = new RemoteGhostRenderer(new THREE.Scene());
    const stale = sample({ t: Date.now() - (STALE_MS + 500) });
    remote.setSample(stale);
    expect(remote.getDiagnostics().hasTarget).toBe(false);
    expect(remote.isShowing()).toBe(false);
  });

  it('recovers cleanly when the connection resumes', () => {
    const remote = new RemoteGhostRenderer(new THREE.Scene());
    remote.setSample(sample());
    expect(remote.isShowing()).toBe(true);
    remote.clear();
    expect(remote.isShowing()).toBe(false);
    remote.setSample(sample({ x: 50 }));
    expect(remote.isShowing()).toBe(true);
    expect(remote.getDiagnostics().samplesReceived).toBe(1);
  });

  it('leaving removes the ghost and never leaves a persistent transform', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    remote.setSample(sample());
    expect(remote.isShowing()).toBe(true);
    remote.clear();
    const group = scene.children.find((c) => c.name === 'RemoteSignalGhost')!;
    expect(group.visible).toBe(false);
    expect(remote.getDiagnostics().hasTarget).toBe(false);
  });

  it('the game clears the remote ghost on session end and on leave', () => {
    for (const method of ['private endRaceSession(', 'private async leaveRaceRoom(']) {
      const block = gameSrc.slice(gameSrc.indexOf(method), gameSrc.indexOf(method) + 600);
      expect(block, method).toMatch(/this\.raceGhost\?\.clear\(\)/);
    }
  });

  it('leaving restores solo ghost eligibility', () => {
    for (const method of ['private endRaceSession(', 'private async leaveRaceRoom(']) {
      const block = gameSrc.slice(gameSrc.indexOf(method), gameSrc.indexOf(method) + 600);
      expect(block, method).toMatch(/this\.setFriendRaceWorld\(false\)/);
    }
    const ret = gameSrc.slice(
      gameSrc.indexOf('private returnToImport('),
      gameSrc.indexOf('private returnToImport(') + 400
    );
    expect(ret).toMatch(/this\.setFriendRaceWorld\(false\)/);
  });
});

// ---------------------------------------------------------------------------
// 7. No ghost contamination, no gameplay coupling
// ---------------------------------------------------------------------------

describe('Friend race — no contamination', () => {
  it('a solo ghost cannot be armed while the race world is live', () => {
    const arm = gameSrc.slice(
      gameSrc.indexOf('private armPendingGhostRun('),
      gameSrc.indexOf('private armPendingGhostRun(') + 500
    );
    expect(arm).toMatch(/if \(this\.friendRaceWorld\)/);
    expect(arm).toMatch(/this\.clearGhostRace\(\)/);
  });

  it('the live ghost never touches movement, collision or scoring', () => {
    for (const file of [
      'src/online/RemoteGhostRenderer.ts',
      'src/replay/GhostVisual.ts',
      'src/replay/GhostManager.ts'
    ]) {
      const src = read(file);
      expect(src, file).not.toMatch(/from '\.\.\/player\//);
      expect(src, file).not.toMatch(/from '\.\.\/physics\//);
      expect(src, file).not.toMatch(/applyImpulse|setPosition\(/);
    }
  });

  it('the shared 5-minute session rule is untouched', () => {
    const src = read('src/online/RaceRoomService.ts');
    expect(src).toMatch(/export const DEFAULT_SESSION_SECONDS = 300;/);
  });

  it('the remote ghost remains a single cheap visual (no second scene)', () => {
    const src = read('src/online/RemoteGhostRenderer.ts');
    expect(src).not.toMatch(/new THREE\.Scene/);
    expect((src.match(/new GhostVisual\(/g) ?? [])).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 8. Diagnostics
// ---------------------------------------------------------------------------

describe('Friend race — diagnostics', () => {
  it('the DEV overlay reports the whole remote pipeline', () => {
    const overlay = read('src/ui/DevOverlay.ts');
    expect(overlay).toMatch(/raceGhostDiagnosticsLine/);
    for (const label of [
      'REMOTE PLAYER',
      'CONNECTED',
      'PRESENCE',
      'TRANSFORM TX',
      'TRANSFORM RX',
      'REMOTE GHOST',
      'RACE MODE',
      'SOLO GHOSTS',
      'DISTANCE TO REMOTE',
      'PROXIMITY FADE'
    ]) {
      expect(overlay, label).toContain(label);
    }
    expect(overlay).toMatch(/RACE MODE: \$\{race\.friendRace \? 'FRIEND' : 'SOLO'\}/);
  });

  it('reports SPAWNED / HIDDEN / STALE distinctly', () => {
    const overlay = read('src/ui/DevOverlay.ts');
    expect(overlay).toMatch(/'STALE'/);
    expect(overlay).toMatch(/'SPAWNED \/\/ VISIBLE'/);
    expect(overlay).toMatch(/'HIDDEN \/\/ NO SAMPLE'/);
  });

  it('is wired from the game, not invented in the overlay', () => {
    expect(gameSrc).toMatch(/this\.raceGhostDiagnostics\(\)/);
    expect(gameSrc).toMatch(/private raceGhostDiagnostics\(\)/);
  });

  it('renders a complete, readable block for a live race', () => {
    const line = raceGhostDiagnosticsLine({
      friendRace: true,
      raceActive: false,
      raceStartAtMs: Date.now() + 4000,
      soloGhostsDisabled: true,
      recordedGhostArmed: false,
      remoteConnected: true,
      remotePresent: true,
      remoteName: 'RIVAL',
      txCount: 128,
      txAgeMs: 41,
      rxCount: 127,
      rxAgeMs: 55,
      ghostHasTarget: true,
      ghostVisible: true,
      ghostStale: false,
      ghostSamples: 127,
      distanceM: 1.42,
      color: 0x9d8cff
    });
    expect(line).toContain('REMOTE PLAYER: RIVAL');
    expect(line).toContain('CONNECTED YES');
    expect(line).toContain('PRESENCE YES');
    expect(line).toContain('RACE MODE: FRIEND');
    expect(line).toContain('SOLO GHOSTS: DISABLED');
    expect(line).toContain('TRANSFORM TX: 128 | age 41 ms');
    expect(line).toContain('TRANSFORM RX: 127 | age 55 ms');
    expect(line).toContain('REMOTE GHOST: SPAWNED // VISIBLE');
    expect(line).toContain('DISTANCE TO REMOTE: 1.42 m');
    expect(line).toContain('#9d8cff');
    // Never a raw undefined / NaN in the DEV readout.
    expect(line).not.toMatch(/undefined|NaN/);
  });

  it('reports the pre-start window and a missing opponent distinctly', () => {
    const noOpponent = raceGhostDiagnosticsLine({
      friendRace: true,
      raceActive: false,
      raceStartAtMs: null,
      soloGhostsDisabled: true,
      recordedGhostArmed: false,
      remoteConnected: false,
      remotePresent: false,
      remoteName: 'none',
      txCount: 0,
      txAgeMs: -1,
      rxCount: 0,
      rxAgeMs: -1,
      ghostHasTarget: false,
      ghostVisible: false,
      ghostStale: false,
      ghostSamples: 0,
      distanceM: null,
      color: 0x9d8cff
    });
    expect(noOpponent).toContain('PRESENCE NO');
    expect(noOpponent).toContain('REMOTE GHOST: HIDDEN // NO SAMPLE');
    expect(noOpponent).toContain('GO not scheduled');
    expect(noOpponent).toContain('age never');
    expect(noOpponent).toContain('DISTANCE TO REMOTE: n/a');
    expect(noOpponent).not.toMatch(/undefined|NaN/);
  });

  it('reports a stale remote and solo mode without a race', () => {
    const stale = raceGhostDiagnosticsLine({
      friendRace: false,
      raceActive: false,
      raceStartAtMs: null,
      soloGhostsDisabled: false,
      recordedGhostArmed: true,
      remoteConnected: false,
      remotePresent: false,
      remoteName: 'none',
      txCount: 0,
      txAgeMs: -1,
      rxCount: 9,
      rxAgeMs: 4000,
      ghostHasTarget: true,
      ghostVisible: false,
      ghostStale: true,
      ghostSamples: 9,
      distanceM: 300.5,
      color: 0x00f0ff
    });
    expect(stale).toContain('RACE MODE: SOLO');
    expect(stale).toContain('SOLO GHOSTS: ENABLED');
    expect(stale).toContain('RECORDED GHOST ARMED');
    expect(stale).toContain('REMOTE GHOST: STALE');
    expect(stale).toContain('#00f0ff');
  });

  it('degrades safely when no race diagnostics are supplied', () => {
    expect(raceGhostDiagnosticsLine(undefined)).toContain('REMOTE PLAYER: n/a');
  });

  it('exposes ghost TX/RX counters from the realtime service', () => {
    const src = read('src/online/RaceRoomService.ts');
    expect(src).toMatch(/public getGhostDiagnostics\(\)/);
    expect(src).toMatch(/ghostTxCount\+\+/);
    expect(src).toMatch(/ghostRxCount\+\+/);
  });
});
