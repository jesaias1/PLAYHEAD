/**
 * GHOST RACING V1 — recorded-run ghost tests.
 *
 * Locks in the ghost-race contract:
 *
 *   1. A ghost is only accepted when its recorded canonical map identity matches
 *      the map the player is about to run. Anything else is refused, never run.
 *   2. Playback is sampled from the RECORDED transforms and interpolated. Inputs
 *      are never re-simulated, so a ghost cannot drift and cannot influence local
 *      physics, collision or timing.
 *   3. Playback follows the AUTHORITATIVE RUN TIMER. At run start both are zero.
 *      A full restart resets both; a checkpoint restore rewinds neither.
 *   4. Splits and the finish delta use recorded event times and raw integer
 *      microseconds.
 *   5. At most ONE solo ghost exists, and it is a separate lifecycle from the
 *      live friend-race ghost.
 *   6. Quality / effect intensity change ghost PRESENTATION only.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';

import {
  POV_REPLAY_SAMPLE_HZ,
  POV_REPLAY_VERSION,
  PovReplay,
  PovReplayIdentity,
  computeReplayHash,
  encodePovReplay,
  decodePovReplay,
  writeSample
} from '../src/replay/pov/PovReplayFormat';
import {
  GHOST_NEAR_FULL_M,
  GHOST_NEAR_HIDE_M,
  buildGhostRaceRun,
  ghostFinishDelta,
  ghostProximityScale,
  ghostSplitAt,
  pbGhostLabel,
  sampleGhost,
  worldGhostLabel
} from '../src/replay/GhostRaceSource';
import {
  GhostRaceController,
  PB_GHOST_COLOR,
  WORLD_GHOST_COLOR
} from '../src/replay/GhostRaceController';
import { GhostVisual } from '../src/replay/GhostVisual';
import { RemoteGhostRenderer } from '../src/online/RemoteGhostRenderer';

const repoRoot = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const IDENTITY: PovReplayIdentity = {
  trackId: 'track_14_kz_ascent',
  mapVersion: 5,
  mapFingerprint: 'mfp_v1_C95B69E61B60700F_7859',
  movementVersion: 'phmv1_2865D271'
};

/**
 * DETERMINISTIC 12 s fixture: accelerating forward, a jump, a surf segment, a
 * landing. Checkpoints are recorded at 3.5 s and 8.5 s.
 */
function buildFixture(overrides: Partial<PovReplay> = {}): PovReplay {
  const samples: number[] = [];
  const count = Math.round(12 * POV_REPLAY_SAMPLE_HZ);
  for (let i = 0; i < count; i++) {
    const t = (i / POV_REPLAY_SAMPLE_HZ) * 1000;
    const s = i / POV_REPLAY_SAMPLE_HZ;
    const airborne = s >= 3 && s < 5;
    const surfing = s >= 5 && s < 8;
    writeSample(
      samples,
      t,
      { x: s * 12, y: surfing ? 4 : 0, z: s * 4 },
      { x: 12, y: airborne ? 6 : 0, z: 4 },
      s * 1.2,
      Math.sin(s) * 0.4,
      !airborne,
      surfing,
      surfing ? 1 : 0
    );
  }

  const draft: PovReplay = {
    replayVersion: POV_REPLAY_VERSION,
    identity: IDENTITY,
    finishTimeUs: 12_000_000,
    durationMs: 12_000,
    sampleHz: POV_REPLAY_SAMPLE_HZ,
    fov: 100,
    startSongTimeMs: 0,
    s: samples,
    events: [
      { t: 3000, type: 'JUMP' },
      { t: 3500, type: 'CHECKPOINT', d: 0 },
      { t: 5000, type: 'SURF_ENTER' },
      { t: 8000, type: 'SURF_EXIT' },
      { t: 8500, type: 'CHECKPOINT', d: 1 },
      { t: 12000, type: 'FINISH' }
    ],
    cosmetic: { skinId: 'SIGNAL_CYAN' },
    hash: ''
  };
  Object.assign(draft, overrides);
  draft.hash = computeReplayHash(encodePovReplay(draft));
  return draft;
}

function buildRun(overrides: { label?: string; replay?: PovReplay } = {}) {
  const replay = overrides.replay ?? buildFixture();
  const payload = encodePovReplay(replay);
  const result = buildGhostRaceRun({
    kind: 'PB',
    label: overrides.label ?? pbGhostLabel(),
    replay,
    expectedIdentity: IDENTITY,
    payload,
    expectedHash: replay.hash
  });
  if (!result.ok) throw new Error(`fixture rejected: ${result.reason} ${result.detail}`);
  return result.run;
}

// ---------------------------------------------------------------------------
// 1. Identity validation
// ---------------------------------------------------------------------------

describe('Ghost race — canonical identity', () => {
  const cases: Array<[string, PovReplayIdentity, string]> = [
    ['track id', { ...IDENTITY, trackId: 'track_5_gravity_line' }, 'TRACK_MISMATCH'],
    ['map version', { ...IDENTITY, mapVersion: 4 }, 'MAP_VERSION_MISMATCH'],
    ['map fingerprint', { ...IDENTITY, mapFingerprint: 'mfp_v1_0000000000000000_dead' }, 'MAP_FINGERPRINT_MISMATCH'],
    ['movement version', { ...IDENTITY, movementVersion: 'phmv1_DEADBEEF' }, 'MOVEMENT_VERSION_MISMATCH']
  ];

  for (const [name, identity, reason] of cases) {
    it(`refuses a ghost with a different ${name}`, () => {
      const replay = buildFixture();
      const result = buildGhostRaceRun({
        kind: 'WORLD',
        label: worldGhostLabel(1, 'SIGNAL-4F21'),
        replay,
        expectedIdentity: identity,
        payload: encodePovReplay(replay),
        expectedHash: replay.hash
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(reason);
    });
  }

  it('accepts a ghost whose identity matches exactly', () => {
    const run = buildRun();
    expect(run.replay.identity.mapFingerprint).toBe(IDENTITY.mapFingerprint);
    expect(run.replay.identity.movementVersion).toBe(IDENTITY.movementVersion);
  });

  it('maps every identity rejection to the required player-facing text', () => {
    const game = read('src/core/Game.ts');
    expect(game).toMatch(/GHOST \/\/ MAP VERSION MISMATCH/);
    // All four identity reasons funnel through the same mapping.
    for (const reason of [
      'MAP_VERSION_MISMATCH',
      'MAP_FINGERPRINT_MISMATCH',
      'MOVEMENT_VERSION_MISMATCH',
      'TRACK_MISMATCH'
    ]) {
      expect(game).toContain(reason);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Integrity + malformed replays
// ---------------------------------------------------------------------------

describe('Ghost race — integrity', () => {
  it('still verifies the recorded replay hash', () => {
    const replay = buildFixture();
    const payload = encodePovReplay(replay);
    const result = buildGhostRaceRun({
      kind: 'WORLD',
      label: worldGhostLabel(1, 'RUNNER'),
      replay,
      expectedIdentity: IDENTITY,
      payload,
      expectedHash: 'rph_v1_deadbeefdeadbeef'
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('HASH_MISMATCH');
  });

  it('verifies the finish time against the leaderboard time when supplied', () => {
    const replay = buildFixture();
    const result = buildGhostRaceRun({
      kind: 'WORLD',
      label: worldGhostLabel(1, 'RUNNER'),
      replay,
      expectedIdentity: IDENTITY,
      expectedFinishTimeUs: 11_500_000,
      payload: encodePovReplay(replay),
      expectedHash: replay.hash
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('FINISH_TIME_MISMATCH');
  });

  it('rejects a malformed payload before it can become a ghost', () => {
    expect(decodePovReplay('not json').ok).toBe(false);
    expect(decodePovReplay('{}').ok).toBe(false);
    expect(decodePovReplay(JSON.stringify({ replayVersion: 1, identity: {} })).ok).toBe(false);
  });

  it('rejects a structurally valid but insensible replay', () => {
    const replay = buildFixture({ durationMs: 0, s: buildFixture().s.slice(0, 10) });
    const result = buildGhostRaceRun({
      kind: 'PB',
      label: pbGhostLabel(),
      replay,
      expectedIdentity: IDENTITY,
      payload: encodePovReplay(replay),
      expectedHash: replay.hash
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('DURATION_INSENSIBLE');
  });
});

// ---------------------------------------------------------------------------
// 3. Timeline synchronisation
// ---------------------------------------------------------------------------

describe('Ghost race — timeline', () => {
  it('starts at t=0 alongside the player', () => {
    const run = buildRun();
    const atZero = sampleGhost(run, 0);
    const firstRecorded = sampleGhost(run, 0);
    expect(atZero.t).toBe(0);
    expect(atZero.x).toBeCloseTo(firstRecorded.x, 6);
    // The recorded origin is the spawn, not an arbitrary offset.
    expect(atZero.x).toBeCloseTo(0, 6);
    expect(atZero.z).toBeCloseTo(0, 6);
  });

  it('is a pure function of the run timer (no wall clock anywhere)', () => {
    const run = buildRun();
    const a = sampleGhost(run, 4200);
    const b = sampleGhost(run, 4200);
    expect(a.x).toBe(b.x);
    expect(a.y).toBe(b.y);
    expect(a.z).toBe(b.z);
    expect(a.yaw).toBe(b.yaw);
  });

  it('interpolates between recorded samples rather than snapping', () => {
    const run = buildRun();
    // 30 Hz: sample 30 is t=1000 ms, sample 31 is t=1033.33 ms.
    const lo = sampleGhost(run, 1000);
    const hi = sampleGhost(run, 1000 + 1000 / POV_REPLAY_SAMPLE_HZ);
    const mid = sampleGhost(run, 1000 + 500 / POV_REPLAY_SAMPLE_HZ);

    expect(mid.x).toBeGreaterThan(lo.x);
    expect(mid.x).toBeLessThan(hi.x);
    expect(mid.x).not.toBeCloseTo(lo.x, 6);
    expect(mid.x).not.toBeCloseTo(hi.x, 6);
    // Linear interpolation of a linear fixture is the average of the bracketing
    // samples, up to the recorded timestamp quantisation.
    expect(mid.x).toBeCloseTo((lo.x + hi.x) / 2, 2);
  });

  it('carries recorded discrete state at the exact recorded instant', () => {
    const run = buildRun();
    // Surf starts at 5 s in the fixture.
    expect(sampleGhost(run, 4900).surfing).toBe(false);
    expect(sampleGhost(run, 5000).surfing).toBe(true);
    expect(sampleGhost(run, 7900).surfing).toBe(true);
    expect(sampleGhost(run, 8000).surfing).toBe(false);
  });

  it('clamps rather than extrapolating past the recording', () => {
    const run = buildRun();
    const atEnd = sampleGhost(run, 12_000);
    const beyond = sampleGhost(run, 60_000);
    expect(beyond.x).toBeCloseTo(atEnd.x, 6);
  });
});

// ---------------------------------------------------------------------------
// 4. Reset + checkpoint behaviour
// ---------------------------------------------------------------------------

describe('Ghost race — reset behaviour', () => {
  it('a full restart returns the ghost to its recorded origin', () => {
    const scene = new THREE.Scene();
    const controller = new GhostRaceController(scene);
    controller.load(buildRun());

    controller.update(6, new THREE.Vector3(0, 0, 0));
    const moved = controller['visual']!.group.position.x;
    expect(moved).toBeGreaterThan(10);

    // Hold-R full restart.
    controller.start();
    expect(controller['visual']!.group.position.x).toBeCloseTo(0, 6);
    expect(controller['visual']!.group.position.z).toBeCloseTo(0, 6);

    controller.dispose();
  });

  it('re-sampling the same run time never rewinds or advances the ghost', () => {
    const controller = new GhostRaceController(new THREE.Scene());
    controller.load(buildRun());

    controller.update(9, new THREE.Vector3(0, 0, 0));
    const at9 = controller['visual']!.group.position.clone();
    // A checkpoint restore does NOT reset the run timer, so the ghost is simply
    // re-sampled at the same authoritative time and must be identical.
    controller.update(9, new THREE.Vector3(0, 0, 0));
    expect(controller['visual']!.group.position.x).toBeCloseTo(at9.x, 9);
    expect(controller['visual']!.group.position.z).toBeCloseTo(at9.z, 9);

    controller.dispose();
  });

  it('start() is the ONLY rewind, and it is wired to run start', () => {
    const src = read('src/replay/GhostRaceController.ts');
    // No method other than start() writes a zeroed timeline.
    expect(src).toMatch(/public start\(\): void/);
    expect((src.match(/applySample\(0\)/g) ?? []).length).toBe(1);

    const game = read('src/core/Game.ts');
    // Called from prepareTrackForRun (run start + hold-R restart) via the arming
    // helper — never from the checkpoint path.
    expect(game).toMatch(/private armPendingGhostRun\(\): void/);
    expect(game).toMatch(/this\.armPendingGhostRun\(\);/);
    const checkpointBlock = game.slice(
      game.indexOf('const ghostSplit = this.ghostRace.onPlayerCheckpoint'),
      game.indexOf('const ghostSplit = this.ghostRace.onPlayerCheckpoint') + 900
    );
    expect(checkpointBlock).not.toMatch(/ghostRace\.start\(\)/);
  });
});

// ---------------------------------------------------------------------------
// 5. Splits + finish comparison
// ---------------------------------------------------------------------------

describe('Ghost race — splits', () => {
  it('computes a signed split from the recorded checkpoint event', () => {
    const run = buildRun();

    const ahead = ghostSplitAt(run, 1, 8.0);
    expect(ahead).not.toBeNull();
    expect(ahead!.deltaSeconds).toBeCloseTo(-0.5, 6);
    expect(ahead!.isAhead).toBe(true);

    const behind = ghostSplitAt(run, 1, 9.104);
    expect(behind!.deltaSeconds).toBeCloseTo(0.604, 6);
    expect(behind!.isAhead).toBe(false);
  });

  it('never fabricates a split for a checkpoint the ghost did not record', () => {
    const run = buildRun();
    expect(ghostSplitAt(run, 7, 5.0)).toBeNull();
  });

  it('carries a restrained label for the HUD', () => {
    const pb = buildRun();
    expect(ghostSplitAt(pb, 0, 3.5)!.label).toBe('PB GHOST');

    const worldReplay = buildFixture();
    const built = buildGhostRaceRun({
      kind: 'WORLD',
      label: worldGhostLabel(1, 'SIGNAL-4F21'),
      replay: worldReplay,
      expectedIdentity: IDENTITY,
      payload: encodePovReplay(worldReplay),
      expectedHash: worldReplay.hash
    });
    if (!built.ok) throw new Error('fixture rejected');
    expect(ghostSplitAt(built.run, 0, 3.5)!.label).toBe('WORLD #1 // SIGNAL-4F21');
  });

  it('the HUD honours the ghost label instead of guessing', () => {
    const hud = read('src/ui/HUD.ts');
    expect(hud).toMatch(/split\.label \?\?/);
    expect(read('src/replay/GhostManager.ts')).toMatch(/'PB' \| 'ECHO' \| 'GHOST'/);
  });
});

describe('Ghost race — finish comparison', () => {
  it('compares raw integer microseconds', () => {
    const run = buildRun();
    const comparison = ghostFinishDelta(run, 12_500_000);
    expect(comparison.deltaUs).toBe(500_000);
    expect(comparison.ghostTimeUs).toBe(12_000_000);
    expect(comparison.label).toBe('PB GHOST');
  });

  it('a faster run produces a negative delta and is recognised as a win', () => {
    const run = buildRun();
    const comparison = ghostFinishDelta(run, 11_580_000);
    expect(comparison.deltaUs).toBe(-420_000);
    expect(comparison.deltaUs).toBeLessThan(0);
  });

  it('never compares formatted strings', () => {
    const src = read('src/replay/GhostRaceSource.ts');
    expect(src).toMatch(/playerFinishUs - run\.finishTimeUs/);
    expect(src).not.toMatch(/toFixed/);
  });
});

// ---------------------------------------------------------------------------
// 6. One ghost maximum + separation from the live friend ghost
// ---------------------------------------------------------------------------

describe('Ghost race — lifecycle', () => {
  it('keeps at most one solo ghost in the scene', () => {
    const scene = new THREE.Scene();
    const controller = new GhostRaceController(scene);

    controller.load(buildRun());
    expect(scene.children.length).toBe(1);

    controller.load(buildRun());
    expect(scene.children.length).toBe(1);

    controller.load(buildRun());
    expect(scene.children.length).toBe(1);

    controller.dispose();
    expect(scene.children.length).toBe(0);
  });

  it('uses distinct identities for a PB ghost and a world ghost', () => {
    const scene = new THREE.Scene();
    const controller = new GhostRaceController(scene);

    controller.load(buildRun());
    const pbColor = (controller['visual'] as GhostVisual as unknown as {
      bodyMaterial: THREE.MeshBasicMaterial;
    }).bodyMaterial.color.getHex();
    expect(pbColor).toBe(PB_GHOST_COLOR);

    const worldReplay = buildFixture();
    const built = buildGhostRaceRun({
      kind: 'WORLD',
      label: worldGhostLabel(1, 'SIGNAL-4F21'),
      replay: worldReplay,
      expectedIdentity: IDENTITY,
      payload: encodePovReplay(worldReplay),
      expectedHash: worldReplay.hash
    });
    if (!built.ok) throw new Error('fixture rejected');
    controller.load(built.run);
    const worldColor = (controller['visual'] as GhostVisual as unknown as {
      bodyMaterial: THREE.MeshBasicMaterial;
    }).bodyMaterial.color.getHex();
    expect(worldColor).toBe(WORLD_GHOST_COLOR);
    expect(worldColor).not.toBe(pbColor);

    controller.dispose();
  });

  it('the ghost never replaces itself mid-run', () => {
    const controller = new GhostRaceController(new THREE.Scene());
    controller.load(buildRun());
    const original = controller.getRun();

    // Simulating a whole run: many updates must never swap the opponent.
    for (let t = 0; t <= 12; t += 0.25) {
      controller.update(t, new THREE.Vector3(0, 0, 0));
      expect(controller.getRun()).toBe(original);
    }
    controller.dispose();
  });

  it('clearing a ghost does not touch the live friend-race ghost', () => {
    const game = read('src/core/Game.ts');
    const clearBlock = game.slice(
      game.indexOf('public clearGhostRace()'),
      game.indexOf('public clearGhostRace()') + 300
    );
    expect(clearBlock).toMatch(/this\.ghostRace\.clear\(\)/);
    expect(clearBlock).not.toMatch(/raceGhost/);

    // And the recorded-ghost modules never IMPORT multiplayer code.
    for (const file of [
      'src/replay/GhostRaceSource.ts',
      'src/replay/GhostRaceController.ts',
      'src/replay/GhostVisual.ts'
    ]) {
      const src = read(file);
      const imports = src.match(/^import[\s\S]*?from\s+'[^']+';/gm) ?? [];
      for (const line of imports) {
        expect(line, `${file}: ${line}`).not.toMatch(/online\//);
        expect(line, `${file}: ${line}`).not.toMatch(/RaceRoomService/);
      }
    }
  });

  it('a live friend race explicitly clears any armed solo ghost', () => {
    const game = read('src/core/Game.ts');
    const raceBlock = game.slice(
      game.indexOf('private async beginRaceFromSchedule'),
      game.indexOf('private async beginRaceFromSchedule') + 400
    );
    expect(raceBlock).toMatch(/this\.clearGhostRace\(\)/);
  });

  it('the live multiplayer renderer still works independently', () => {
    const scene = new THREE.Scene();
    const live = new RemoteGhostRenderer(scene);
    expect(scene.children.length).toBe(1);
    // The recorded-ghost controller adds its own, separate object.
    const controller = new GhostRaceController(scene);
    controller.load(buildRun());
    expect(scene.children.length).toBe(2);
    controller.dispose();
    expect(scene.children.length).toBe(1);
    live.dispose();
    expect(scene.children.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Ghost cannot affect gameplay
// ---------------------------------------------------------------------------

describe('Ghost race — gameplay isolation', () => {
  it('no ghost module imports physics, movement, generation or scoring', () => {
    for (const file of [
      'src/replay/GhostRaceSource.ts',
      'src/replay/GhostRaceController.ts',
      'src/replay/GhostVisual.ts'
    ]) {
      const src = read(file);
      expect(src, file).not.toMatch(/from '\.\.\/physics\//);
      expect(src, file).not.toMatch(/from '\.\.\/player\//);
      expect(src, file).not.toMatch(/from '\.\.\/generation\//);
      expect(src, file).not.toMatch(/PLAYHEAD_MOVEMENT_V1/);
      expect(src, file).not.toMatch(/PlayerStats|computeResults/);
    }
  });

  it('the ghost visual is declared exempt from world-safety validation', () => {
    const src = read('src/replay/GhostVisual.ts');
    expect(src).toMatch(/worldSafetyExempt = true/);
    // It is presentation geometry: no collider, no trigger volume.
    expect(src).not.toMatch(/Collider|Box3|Raycaster/);
  });

  it('the controller only ever reads the run timer and player position', () => {
    const src = read('src/replay/GhostRaceController.ts');
    expect(src).toMatch(/public update\(runElapsedSeconds: number, playerPosition: THREE\.Vector3\)/);
    // No write-back to any gameplay object: only the ghost visual is mutated.
    expect(src).not.toMatch(/this\.playerController|playerController\./);
    expect(src).not.toMatch(/PhysicsWorld|PlayerStats/);
    expect((src.match(/setTransform\(/g) ?? []).length).toBe(1);
    expect((src.match(/setVisible\(/g) ?? []).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Presentation scaling must not alter trajectory or timing
// ---------------------------------------------------------------------------

describe('Ghost race — presentation only', () => {
  it('effect intensity changes opacity and nothing else', () => {
    const controller = new GhostRaceController(new THREE.Scene());
    controller.load(buildRun());
    const visual = controller['visual'] as GhostVisual;
    const body = (visual as unknown as { bodyMaterial: THREE.MeshBasicMaterial }).bodyMaterial;

    controller.update(4, new THREE.Vector3(0, 0, 0));
    const poseBefore = visual.group.position.clone();
    const opacityBefore = body.opacity;

    controller.setEffectScale(0.55);
    controller.update(4, new THREE.Vector3(0, 0, 0));
    expect(body.opacity).not.toBe(opacityBefore);
    expect(visual.group.position.x).toBeCloseTo(poseBefore.x, 9);
    expect(visual.group.position.z).toBeCloseTo(poseBefore.z, 9);

    controller.setEffectScale(1.3);
    controller.update(4, new THREE.Vector3(0, 0, 0));
    expect(visual.group.position.x).toBeCloseTo(poseBefore.x, 9);

    // And the sampled trajectory itself is untouched by any scale.
    const run = buildRun();
    const before = sampleGhost(run, 4000);
    controller.setEffectScale(0.2);
    const after = sampleGhost(run, 4000);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);

    controller.dispose();
  });

  it('a weak tier never erases the ghost completely', () => {
    const visual = new GhostVisual(new THREE.Scene(), { color: PB_GHOST_COLOR });
    const body = (visual as unknown as { bodyMaterial: THREE.MeshBasicMaterial }).bodyMaterial;
    visual.setOpacityScale(0.01);
    expect(body.opacity).toBeGreaterThan(0.1);
    visual.dispose();
  });

  it('fades the ghost as it approaches the camera so it cannot block the route', () => {
    expect(ghostProximityScale(GHOST_NEAR_HIDE_M - 0.1)).toBe(0);
    expect(ghostProximityScale(GHOST_NEAR_HIDE_M)).toBe(0);
    expect(ghostProximityScale(GHOST_NEAR_FULL_M)).toBe(1);
    expect(ghostProximityScale(50)).toBe(1);
    expect(ghostProximityScale(Number.NaN)).toBe(1);

    const mid = ghostProximityScale((GHOST_NEAR_HIDE_M + GHOST_NEAR_FULL_M) / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('hides the visual when the ghost is inside the camera', () => {
    const controller = new GhostRaceController(new THREE.Scene());
    controller.load(buildRun());
    const visual = controller['visual'] as GhostVisual;

    // Position the ghost, then stand exactly on top of it.
    controller.update(6, new THREE.Vector3(0, 0, 500));
    const pose = visual.group.position.clone();
    expect(visual.group.visible).toBe(true);

    controller.update(6, pose);
    expect(visual.group.visible).toBe(false);

    // Well away from the player again.
    controller.update(6, new THREE.Vector3(0, 0, 500));
    expect(visual.group.visible).toBe(true);

    controller.dispose();
  });
});

// ---------------------------------------------------------------------------
// 9. Labels
// ---------------------------------------------------------------------------

describe('Ghost race — labels', () => {
  it('uses restrained, non-holographic wording', () => {
    expect(pbGhostLabel()).toBe('PB GHOST');
    expect(worldGhostLabel(1, 'SIGNAL-4F21')).toBe('WORLD #1 // SIGNAL-4F21');
  });
});
