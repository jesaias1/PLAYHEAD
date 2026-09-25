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
  SAMPLE_REJECT_MS,
  LIVE_MS,
  PRESENCE_GRACE_MS,
  STALE_OPACITY_SCALE,
  RemoteGhostState
} from '../src/online/RemoteGhostRenderer';
import {
  GhostSample,
  shouldAcceptRemoteGhost,
  RaceRoomService
} from '../src/online/RaceRoomService';
import { OnlineClient } from '../src/online/supabaseClient';
import { AuthService } from '../src/online/AuthService';
import { raceGhostDiagnosticsLine, RaceGhostDiagnosticState } from '../src/ui/DevOverlay';
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

/** Baseline DEV race-diagnostics snapshot; tests override only what they assert. */
function baseRaceDiagnostics(): RaceGhostDiagnosticState {
  return {
    friendRace: false,
    raceActive: false,
    raceStartAtMs: null,
    soloGhostsDisabled: false,
    recordedGhostArmed: false,
    remoteConnected: false,
    remotePresent: false,
    remoteName: 'none',
    txCount: 0,
    txAgeMs: -1,
    txBackgroundCount: 0,
    rxCount: 0,
    rxAgeMs: -1,
    ghostState: 'NO_SAMPLE',
    ghostHasTarget: false,
    ghostVisible: false,
    ghostSamples: 0,
    distanceM: null,
    color: 0x9d8cff,
    documentVisible: true,
    windowFocused: true,
    lastVisibilityChangeAt: 0,
    rxPosition: null,
    ghostLocal: { x: 0, y: 0, z: 0 },
    ghostWorld: { x: 0, y: 0, z: 0 },
    ghostAttached: false,
    ghostRootVisible: false,
    ghostRootScale: { x: 1, y: 1, z: 1 },
    ghostChildCount: 0,
    cameraDistanceM: null,
    ghostFrustum: 'UNKNOWN',
    cameraLayerMask: null,
    ghostLayerMask: 1,
    ghostMaterialAlpha: 0,
    ghostMaterialVisible: false,
    ghostFrustumCulled: true,
    debugMarker: 'OFF',
    debugOffset: false,
    forceVisible: false
  };
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

  it('drops genuinely stale packets at the receiver', () => {
    const remote = new RemoteGhostRenderer(new THREE.Scene());
    const stale = sample({ t: Date.now() - (SAMPLE_REJECT_MS + 500) });
    remote.setSample(stale);
    // Nothing was ever accepted, so there is no pose to hold.
    expect(remote.getDiagnostics().hasTarget).toBe(false);
    expect(remote.getState()).toBe('NO_SAMPLE');
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

  it('reports every lifecycle state distinctly', () => {
    const overlay = read('src/ui/DevOverlay.ts');
    expect(overlay).toMatch(/ghostState\.replace\('_', ' '\)/);
    for (const state of ['NO_SAMPLE', 'LIVE', 'STALE_HOLD', 'DISCONNECTED']) {
      expect(overlay, state).toContain(state);
    }
  });

  it('reports DOCUMENT, WINDOW and the last visibility change', () => {
    const overlay = read('src/ui/DevOverlay.ts');
    expect(overlay).toContain('DOCUMENT');
    expect(overlay).toContain('VISIBLE');
    expect(overlay).toContain('HIDDEN');
    expect(overlay).toContain('WINDOW');
    expect(overlay).toContain('FOCUSED');
    expect(overlay).toContain('BLURRED');
    expect(overlay).toContain('LAST VISIBILITY CHANGE');
    expect(overlay).toContain('background ${race.txBackgroundCount}');
  });

  it('is wired from the game, not invented in the overlay', () => {
    expect(gameSrc).toMatch(/this\.raceGhostDiagnostics\(\)/);
    expect(gameSrc).toMatch(/private raceGhostDiagnostics\(\)/);
  });

  it('renders a complete, readable block for a live race', () => {
    const line = raceGhostDiagnosticsLine({
      ...baseRaceDiagnostics(),
      friendRace: true,
      raceActive: true,
      raceStartAtMs: Date.now() - 1000,
      soloGhostsDisabled: true,
      remoteConnected: true,
      remotePresent: true,
      remoteName: 'RIVAL',
      txCount: 128,
      txAgeMs: 41,
      txBackgroundCount: 7,
      rxCount: 127,
      rxAgeMs: 55,
      ghostState: 'LIVE',
      ghostHasTarget: true,
      ghostVisible: true,
      ghostSamples: 127,
      distanceM: 1.42,
      documentVisible: true,
      windowFocused: true,
      lastVisibilityChangeAt: Date.now() - 3000
    });
    expect(line).toContain('REMOTE PLAYER: RIVAL');
    expect(line).toContain('CONNECTED YES');
    expect(line).toContain('PRESENCE PRESENT');
    expect(line).toContain('DOCUMENT VISIBLE');
    expect(line).toContain('WINDOW FOCUSED');
    expect(line).toContain('RACE MODE: FRIEND');
    expect(line).toContain('SOLO GHOSTS: DISABLED');
    expect(line).toContain('TRANSFORM TX: 128 | age 41 ms | background 7');
    expect(line).toContain('TRANSFORM RX: 127 | age 55 ms | LIVE');
    expect(line).toContain('REMOTE GHOST STATE: LIVE');
    expect(line).toContain('DISTANCE TO REMOTE: 1.42 m');
    expect(line).toContain('#9d8cff');
    expect(line).not.toMatch(/undefined|NaN/);
  });

  it('renders the STALE_HOLD case the Alt-Tab test actually hits', () => {
    const line = raceGhostDiagnosticsLine({
      ...baseRaceDiagnostics(),
      friendRace: true,
      raceActive: true,
      raceStartAtMs: Date.now() - 30_000,
      soloGhostsDisabled: true,
      remoteConnected: true,
      remotePresent: true,
      remoteName: 'RIVAL',
      txCount: 12,
      txAgeMs: 900,
      txBackgroundCount: 11,
      rxCount: 40,
      rxAgeMs: 6200,
      ghostState: 'STALE_HOLD',
      ghostHasTarget: true,
      ghostVisible: true,
      ghostSamples: 40,
      distanceM: 12.5,
      documentVisible: false,
      windowFocused: false,
      lastVisibilityChangeAt: Date.now() - 6200
    });
    expect(line).toContain('DOCUMENT HIDDEN');
    expect(line).toContain('WINDOW BLURRED');
    // Presence still present: the opponent is held, NOT deleted.
    expect(line).toContain('PRESENCE PRESENT');
    expect(line).toContain('TRANSFORM RX: 40 | age 6200 ms | STALE');
    expect(line).toContain('REMOTE GHOST STATE: STALE HOLD');
    expect(line).not.toMatch(/undefined|NaN/);
  });

  it('reports the pre-start window and a missing opponent distinctly', () => {
    const noOpponent = raceGhostDiagnosticsLine({
      ...baseRaceDiagnostics(),
      friendRace: true,
      raceActive: false,
      raceStartAtMs: null,
      soloGhostsDisabled: true,
      remoteConnected: false,
      remotePresent: false,
      remoteName: 'none',
      txCount: 0,
      txAgeMs: -1,
      rxCount: 0,
      rxAgeMs: -1,
      ghostState: 'NO_SAMPLE',
      ghostHasTarget: false,
      ghostVisible: false,
      ghostSamples: 0,
      distanceM: null
    });
    expect(noOpponent).toContain('PRESENCE ABSENT');
    expect(noOpponent).toContain('REMOTE GHOST STATE: NO SAMPLE');
    expect(noOpponent).toContain('GO not scheduled');
    expect(noOpponent).toContain('age never');
    expect(noOpponent).toContain('DISTANCE TO REMOTE: n/a');
    expect(noOpponent).not.toMatch(/undefined|NaN/);
  });

  it('reports a transient reconnect as RECONNECTING, not gone', () => {
    const reconnecting = raceGhostDiagnosticsLine({
      ...baseRaceDiagnostics(),
      friendRace: true,
      remotePresent: true,
      remoteConnected: false,
      remoteName: 'RIVAL',
      ghostState: 'STALE_HOLD',
      ghostHasTarget: true,
      ghostVisible: true
    });
    expect(reconnecting).toContain('PRESENCE RECONNECTING');
    expect(reconnecting).toContain('REMOTE GHOST STATE: STALE HOLD');
  });

  it('reports a disconnected remote and solo mode without a race', () => {
    const stale = raceGhostDiagnosticsLine({
      ...baseRaceDiagnostics(),
      friendRace: false,
      soloGhostsDisabled: false,
      recordedGhostArmed: true,
      remoteConnected: false,
      remotePresent: false,
      remoteName: 'none',
      rxCount: 9,
      rxAgeMs: 4000,
      ghostState: 'DISCONNECTED',
      ghostHasTarget: true,
      ghostVisible: false,
      ghostSamples: 9,
      distanceM: 300.5,
      color: 0x00f0ff
    });
    expect(stale).toContain('RACE MODE: SOLO');
    expect(stale).toContain('SOLO GHOSTS: ENABLED');
    expect(stale).toContain('RECORDED GHOST ARMED');
    expect(stale).toContain('REMOTE GHOST STATE: DISCONNECTED');
    expect(stale).toContain('#00f0ff');
  });

  it('degrades safely when no race diagnostics are supplied', () => {
    expect(raceGhostDiagnosticsLine(undefined)).toContain('REMOTE PLAYER: n/a');
  });

  it('exposes ghost TX/RX counters and the background counter', () => {
    const src = read('src/online/RaceRoomService.ts');
    expect(src).toMatch(/public getGhostDiagnostics\(\)/);
    expect(src).toMatch(/ghostTxCount\+\+/);
    expect(src).toMatch(/ghostRxCount\+\+/);
    expect(src).toMatch(/ghostTxBackgroundCount\+\+/);
  });
});

// ---------------------------------------------------------------------------
// 9. BACKGROUND THROTTLING - the Alt-Tab failure
//
// A background tab throttles requestAnimationFrame to zero and timers to about
// 1 Hz. The opponent must NOT disappear merely because their transform stream
// paused: NETWORK STALE != PLAYER GONE.
// ---------------------------------------------------------------------------

describe('Friend race � background throttling', () => {
  /** Drive the ghost forward in time without touching real clocks. */
  function advance(remote: RemoteGhostRenderer, ms: number, local?: THREE.Vector3): void {
    remote.update(ms / 1000, local);
  }

  it('A. fresh packets are LIVE', () => {
    const remote = new RemoteGhostRenderer(new THREE.Scene());
    remote.setSample(sample({ x: 5, y: 2, z: 5 }));
    expect(remote.getState()).toBe('LIVE');
    expect(remote.isShowing()).toBe(true);
  });

  it('B. no packet for >1200 ms with presence true is STALE_HOLD and stays visible', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    remote.setSample(sample({ x: 5, y: 2, z: 5 }));
    remote.setRemotePresent(true);

    // Age the sample past the live threshold by backdating it.
    const aged = sample({ x: 5, y: 2, z: 5, t: Date.now() - (LIVE_MS + 400) });
    (remote as unknown as { lastSampleAt: number }).lastSampleAt = aged.t;

    expect(remote.getState()).toBe('STALE_HOLD');
    expect(remote.isShowing()).toBe(true);
    advance(remote, 16, new THREE.Vector3(0, 0, 0));
    expect(scene.children.find((c) => c.name === 'RemoteSignalGhost')!.visible).toBe(true);
  });

  it('C. 10+ seconds of silence still holds the last transform, with no extrapolation', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    const group = scene.children.find((c) => c.name === 'RemoteSignalGhost')!;
    const frozen = { x: 42, y: 3, z: -17 };
    remote.setSample(sample({ ...frozen, yaw: 1.1 }));
    remote.setRemotePresent(true);
    advance(remote, 16);
    const posAfterFirstFrame = { x: group.position.x, y: group.position.y, z: group.position.z };

    // Simulate 10 seconds of background silence.
    (remote as unknown as { lastSampleAt: number }).lastSampleAt = Date.now() - 10_000;
    for (let i = 0; i < 600; i++) {
      advance(remote, 16, new THREE.Vector3(0, 0, 0));
    }

    expect(remote.getState()).toBe('STALE_HOLD');
    expect(remote.isShowing()).toBe(true);
    // Frozen exactly where it was: no dead reckoning, no invented velocity.
    expect(group.position.x).toBeCloseTo(posAfterFirstFrame.x, 6);
    expect(group.position.y).toBeCloseTo(posAfterFirstFrame.y, 6);
    expect(group.position.z).toBeCloseTo(posAfterFirstFrame.z, 6);
    expect(group.position.x).toBeCloseTo(42, 1);
    expect(group.position.z).toBeCloseTo(-17, 1);
  });

  it('D. a fresh packet after a hold returns to LIVE and interpolation resumes', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    const group = scene.children.find((c) => c.name === 'RemoteSignalGhost')!;
    remote.setSample(sample({ x: 0, y: 0, z: 0 }));
    (remote as unknown as { lastSampleAt: number }).lastSampleAt = Date.now() - 5000;
    expect(remote.getState()).toBe('STALE_HOLD');

    remote.setSample(sample({ x: 100, y: 0, z: 0 }));
    expect(remote.getState()).toBe('LIVE');
    for (let i = 0; i < 120; i++) advance(remote, 16, new THREE.Vector3(0, 0, 0));
    // Interpolation has carried it towards the new transform.
    expect(group.position.x).toBeGreaterThan(50);
  });

  it('E. going hidden publishes one final transform immediately', () => {
    const src = read('src/online/RaceRoomService.ts');
    const handler = src.slice(
      src.indexOf("addEventListener('visibilitychange'"),
      src.indexOf("addEventListener('visibilitychange'") + 500
    );
    expect(handler).toMatch(/document\.hidden/);
    expect(handler).toMatch(/this\.publishNow\(\)/);
  });

  it('F. becoming visible publishes immediately and resyncs presence', () => {
    const src = read('src/online/RaceRoomService.ts');
    const handler = src.slice(
      src.indexOf("addEventListener('visibilitychange'"),
      src.indexOf("addEventListener('visibilitychange'") + 500
    );
    expect(handler).toMatch(/this\.resyncRacePresence\(\)/);
    const resync = src.slice(
      src.indexOf('public resyncRacePresence('),
      src.indexOf('public resyncRacePresence(') + 400
    );
    expect(resync).toMatch(/this\.publishNow\(\)/);
    expect(resync).toMatch(/refreshPlayers\(\)/);
    // Focus and Page Lifecycle resume both resync too.
    expect(src).toMatch(/addEventListener\('focus'/);
    expect(src).toMatch(/addEventListener\('resume'/);
  });

  it('G. a confirmed leave disconnects and removes the ghost immediately', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    remote.setSample(sample());
    expect(remote.isShowing()).toBe(true);

    remote.markRemoteLeft();
    expect(remote.getState()).toBe('DISCONNECTED');
    expect(remote.isShowing()).toBe(false);
    remote.update(1 / 60);
    expect(scene.children.find((c) => c.name === 'RemoteSignalGhost')!.visible).toBe(false);
  });

  it('H. a transient presence loss holds through a grace period, then disconnects', () => {
    const remote = new RemoteGhostRenderer(new THREE.Scene());
    remote.setSample(sample());
    // Presence signal lost AND the stream has paused: the classic reconnect case.
    (remote as unknown as { lastSampleAt: number }).lastSampleAt = Date.now() - (LIVE_MS + 400);
    remote.setRemotePresent(false);

    // Immediately: still held, not deleted.
    expect(remote.getState()).toBe('STALE_HOLD');
    expect(remote.isShowing()).toBe(true);

    // Inside the grace period: still held.
    (remote as unknown as { presenceLostAt: number }).presenceLostAt =
      Date.now() - (PRESENCE_GRACE_MS - 500);
    expect(remote.getState()).toBe('STALE_HOLD');

    // Past the grace period: gone.
    (remote as unknown as { presenceLostAt: number }).presenceLostAt =
      Date.now() - (PRESENCE_GRACE_MS + 500);
    expect(remote.getState()).toBe('DISCONNECTED');
    expect(remote.isShowing()).toBe(false);
  });

  it('a fresh transform outranks a stale presence row: a streaming player is never hidden', () => {
    const remote = new RemoteGhostRenderer(new THREE.Scene());
    remote.setSample(sample());
    remote.setRemotePresent(false);
    // Packets are still arriving, so the opponent is demonstrably still here.
    expect(remote.getState()).toBe('LIVE');
    expect(remote.isShowing()).toBe(true);
  });

  it('I. the race ending removes the ghost normally', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    remote.setSample(sample());
    remote.clear();
    expect(remote.getState()).toBe('NO_SAMPLE');
    expect(remote.isShowing()).toBe(false);
    expect(scene.children.find((c) => c.name === 'RemoteSignalGhost')!.visible).toBe(false);
  });

  it('J. a confirmed leave in the game marks the ghost left at once', () => {
    const callback = gameSrc.slice(
      gameSrc.indexOf('onPlayerLeft:'),
      gameSrc.indexOf('onPlayerLeft:') + 400
    );
    expect(callback).toMatch(/this\.raceGhost\?\.markRemoteLeft\(\)/);
  });

  it('presence, not packet age, decides whether the opponent exists', () => {
    const src = read('src/online/RemoteGhostRenderer.ts');
    // The state machine reads presence for DISCONNECTED...
    expect(src).toMatch(/remotePresent/);
    expect(src).toMatch(/PRESENCE_GRACE_MS/);
    const update = src.slice(src.indexOf('public update('), src.indexOf('public update(') + 2600);
    // ...and the STALE_HOLD branch freezes at the last received transform.
    expect(update).toMatch(/state === 'STALE_HOLD'/);
    // The render pose is written from currentPos (the frozen pose), and the
    // STALE_HOLD path never advances interpolation.
    const stale = src.slice(
      src.indexOf("if (state === 'STALE_HOLD')"),
      src.indexOf("if (state === 'STALE_HOLD')") + 460
    );
    expect(stale).toMatch(/applyRenderPosition\(\)/);
    expect(stale).toMatch(/return;/);
    expect(stale).not.toMatch(/advanceInterpolation/);
    expect(src).toMatch(/private applyRenderPosition\(\)/);
    // No extrapolation anywhere: currentPos only ever moves towards a genuinely
    // received target, and never on its own.
    expect(update).not.toMatch(/currentPos\.addScaledVector|currentPos\.add\(/);
  });

  it('STALE_HOLD is dimmed but never invisible, and overlap still shows it', () => {
    expect(STALE_OPACITY_SCALE).toBeGreaterThan(0.5);
    expect(STALE_OPACITY_SCALE).toBeLessThan(0.8);

    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    const visual = (remote as unknown as { visual: GhostVisual }).visual;
    const body = visual.group.children[0] as THREE.Mesh;
    const material = body.material as THREE.MeshBasicMaterial;

    remote.setSample(sample({ x: 0, y: 1.5, z: 0 }));
    remote.update(1 / 60);
    const liveOpacity = material.opacity;

    (remote as unknown as { lastSampleAt: number }).lastSampleAt = Date.now() - 5000;
    remote.update(1 / 60, new THREE.Vector3(0, 1.5, 0));
    const holdOpacity = material.opacity;

    expect(holdOpacity).toBeLessThan(liveOpacity);
    expect(holdOpacity).toBeGreaterThan(0);
    // Same-spawn overlap: double-sided faces keep a held ghost visible.
    expect(material.side).toBe(THREE.DoubleSide);
    expect(remote.isShowing()).toBe(true);
  });

  it('the broadcast scheduler is independent of requestAnimationFrame', () => {
    const src = read('src/online/RaceRoomService.ts');
    // The cadence is a timer, and the timestamp is stamped at SEND time.
    expect(src).toMatch(/window\.setInterval\(\(\) => \{\s*this\.publishNow\(\);/);
    const publish = src.slice(
      src.indexOf('public publishNow('),
      src.indexOf('public publishNow(') + 900
    );
    expect(publish).toMatch(/t: Date\.now\(\)/);
    expect(publish).toMatch(/\.\.\.this\.myTransform/);
    // The game loop only STORES the transform; it does not send.
    const store = gameSrc.slice(
      gameSrc.indexOf('private storeLocalTransform('),
      gameSrc.indexOf('private storeLocalTransform(') + 700
    );
    expect(store).toMatch(/raceRoomService\.setLocalTransform\(/);
    expect(store).not.toMatch(/\.send\(|publishNow/);
  });

  it('never defeats background throttling with a hack', () => {
    for (const file of ['src/online/RaceRoomService.ts', 'src/online/RemoteGhostRenderer.ts']) {
      const src = read(file);
      expect(src, file).not.toMatch(/Worker\(/);
      expect(src, file).not.toMatch(/wakeLock|WakeLock/);
      expect(src, file).not.toMatch(/createElement\('audio'\)|AudioContext/);
      expect(src, file).not.toMatch(/setInterval\([^,]+,\s*(?:[1-9]\d?|[1-4]\d\d)\)/);
    }
  });

  it('a frozen remote transform still reports a valid distance for diagnostics', () => {
    const remote = new RemoteGhostRenderer(new THREE.Scene());
    remote.setSample(sample({ x: 3, y: 0, z: 4 }));
    (remote as unknown as { lastSampleAt: number }).lastSampleAt = Date.now() - 8000;
    remote.update(1 / 60, new THREE.Vector3(0, 0, 0));
    const diag = remote.getDiagnostics();
    expect(diag.state).toBe('STALE_HOLD');
    expect(diag.distanceM).toBeCloseTo(5, 1);
    expect(diag.remotePresent).toBe(true);
  });

  it('a solo run restores normal solo ghost behaviour after a race', () => {
    const scene = new THREE.Scene();
    const manager = new GhostManager(scene);
    const remote = new RemoteGhostRenderer(scene);

    manager.setFriendRaceMode(true);
    remote.setSample(sample());
    expect(visibleSoloGhosts(scene)).toEqual([]);

    // Race over.
    remote.clear();
    manager.setFriendRaceMode(false);
    manager.prepareTrack(makeTrack(), 'TEST');
    manager.update(0.5, new THREE.Vector3(0, 1.5, 0), 0.016);
    expect(visibleSoloGhosts(scene)).toContain('Ghost_Rival_Echo');
  });
});

// ---------------------------------------------------------------------------
// 10. BROADCAST SCHEDULER - behavioural, against a fake Realtime client
//
// This is the precise regression. Measured platform behaviour: a backgrounded
// tab runs requestAnimationFrame at 0 fps while its timers keep ticking. The old
// design stamped the packet timestamp inside the rAF-driven game loop, so a
// backgrounded opponent kept RE-SENDING a packet whose timestamp was frozen, and
// the receiver rejected every one of them as stale. The opponent vanished even
// though the network was perfectly healthy.
// ---------------------------------------------------------------------------

describe('Friend race - broadcast scheduler', () => {
  interface SentPacket {
    event: string;
    payload: GhostSample;
  }

  function fakeRealtime(): { channel: unknown; sent: SentPacket[] } {
    const sent: SentPacket[] = [];
    const channel: Record<string, unknown> = {};
    channel.on = () => channel;
    channel.subscribe = (cb?: (s: string) => void) => {
      cb?.('SUBSCRIBED');
      return channel;
    };
    channel.send = (msg: SentPacket) => {
      sent.push(msg);
      return Promise.resolve('ok');
    };
    channel.unsubscribe = () => Promise.resolve('ok');
    return { channel, sent };
  }

  function makeService(): {
    service: RaceRoomService;
    sent: SentPacket[];
  } {
    const onlineClient = OnlineClient.__createWithClientForTests(null);
    const auth = { getUserId: () => 'me' } as unknown as AuthService;
    const service = new RaceRoomService(onlineClient, auth);
    const fake = fakeRealtime();
    (service as unknown as { channel: unknown }).channel = fake.channel;
    return { service, sent: fake.sent };
  }

  const transform = {
    x: 11,
    y: 2.5,
    z: -3,
    yaw: 0.4,
    pitch: 0.1,
    vx: 1,
    vy: 0,
    vz: 2,
    running: true
  };

  it('storing a transform does NOT send: the scheduler owns the cadence', () => {
    const { service, sent } = makeService();
    service.setLocalTransform(transform);
    expect(sent).toHaveLength(0);
    expect(service.getGhostDiagnostics().hasLocalSample).toBe(true);
  });

  it('publishing sends exactly one packet with the stored transform', () => {
    const { service, sent } = makeService();
    service.setLocalTransform(transform);
    service.publishNow();
    expect(sent).toHaveLength(1);
    expect(sent[0].event).toBe('ghost');
    expect(sent[0].payload.x).toBe(11);
    expect(sent[0].payload.userId).toBe('me');
  });

  it('REGRESSION: the timestamp is stamped at SEND time, never frozen', async () => {
    const { service, sent } = makeService();
    service.setLocalTransform(transform);

    service.publishNow();
    const first = sent[0].payload.t;

    // Simulate rAF stopping (the tab is backgrounded): the game loop never calls
    // setLocalTransform again, but the timer keeps firing.
    await new Promise((r) => setTimeout(r, 60));
    service.publishNow();
    service.publishNow();

    expect(sent).toHaveLength(3);
    const second = sent[1].payload.t;
    const third = sent[2].payload.t;
    // Every packet carries a FRESH timestamp, so a backgrounded sender is never
    // rejected as stale by the receiver.
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThanOrEqual(second);
    // And it still carries the last known position.
    expect(sent[2].payload.x).toBe(11);
    expect(sent[2].payload.z).toBe(-3);
  });

  it('a frozen sender stays acceptable to the receiver filter', async () => {
    const { service, sent } = makeService();
    service.setLocalTransform(transform);
    // Ten seconds of "backgrounded": no game loop, but the timer still fires.
    service.publishNow();
    await new Promise((r) => setTimeout(r, 100));
    service.publishNow();
    const packet = sent[sent.length - 1].payload;
    // The receiver's own staleness filter would accept this packet.
    expect(shouldAcceptRemoteGhost(packet, 'them')).toBe(true);
  });

  it('publishing is a safe no-op without a channel', () => {
    const onlineClient = OnlineClient.__createWithClientForTests(null);
    const auth = { getUserId: () => 'me' } as unknown as AuthService;
    const service = new RaceRoomService(onlineClient, auth);
    service.setLocalTransform(transform);
    expect(() => service.publishNow()).not.toThrow();
    expect(service.getGhostDiagnostics().txCount).toBe(0);
  });

  it('counts packets published while the document is hidden', () => {
    const { service, sent } = makeService();
    service.setLocalTransform(transform);
    const originalDocument = (globalThis as { document?: unknown }).document;
    try {
      (globalThis as { document?: unknown }).document = { hidden: true };
      service.publishNow();
      service.publishNow();
      expect(sent).toHaveLength(2);
      expect(service.getGhostDiagnostics().txBackgroundCount).toBe(2);
      (globalThis as { document?: unknown }).document = { hidden: false };
      service.publishNow();
      // Foreground publishes are not counted as background.
      expect(service.getGhostDiagnostics().txBackgroundCount).toBe(2);
    } finally {
      (globalThis as { document?: unknown }).document = originalDocument;
    }
  });

  it('resync publishes immediately and reconciles presence', () => {
    const { service, sent } = makeService();
    service.setLocalTransform(transform);
    const playersBefore = service.getGhostDiagnostics().rxCount;
    service.resyncRacePresence();
    // Published at once, without waiting for the next tick.
    expect(sent).toHaveLength(1);
    expect(playersBefore).toBe(0);
  });

  it('reports document and focus state for the Alt-Tab diagnosis', () => {
    const { service } = makeService();
    const diag = service.getGhostDiagnostics();
    expect(typeof diag.documentVisible).toBe('boolean');
    expect(typeof diag.windowFocused).toBe('boolean');
    expect(diag.lastVisibilityChangeAt).toBe(0);
  });

  it('the game stores every frame and never sends from the render loop', () => {
    const store = gameSrc.slice(
      gameSrc.indexOf('private storeLocalTransform('),
      gameSrc.indexOf('private storeLocalTransform(') + 700
    );
    expect(store).toMatch(/raceRoomService\.setLocalTransform\(/);
    // And updateRace calls it unconditionally for the whole race world.
    const update = gameSrc.slice(
      gameSrc.indexOf('private updateRace(frameDelta: number)'),
      gameSrc.indexOf('private updateRace(frameDelta: number)') + 4200
    );
    expect(update).toMatch(/this\.storeLocalTransform\(\)/);
    expect(update).not.toMatch(/GHOST_BROADCAST_HZ/);
  });
});
