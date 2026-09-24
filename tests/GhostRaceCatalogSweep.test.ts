/**
 * GHOST RACING — OFFICIAL CATALOG SWEEP.
 *
 * Ghost Racing V1 was human-tested on KZ ASCENT only. This sweeps ALL 14
 * official Signal Pack tracks to prove the feature is generic:
 *
 *   1. canonical preset resolves
 *   2. registry identity matches
 *   3. a deterministic replay fixture is built for that EXACT map identity
 *   4. the fixture passes through GhostRaceSource
 *   5. GhostRaceController arms / starts / samples / resets it
 *   6. t=0 starts correctly (on the canonical route origin)
 *   7. mid-run interpolation returns finite, in-bounds transforms
 *   8. full restart returns the ghost to start
 *   9. finish delta uses raw integer microseconds
 *  10. the correct track's identity is accepted
 *  11. the SAME replay is rejected against a different official track/map
 *  12. ghost presentation has no collision/gameplay references
 *  13. normal PLAY is unaffected
 *
 * Verification only: this file adds no production behaviour.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';

import { SignalPackCatalog } from '../src/audio/SignalPackCatalog';
import { PresetLevelCache } from '../src/audio/PresetLevelCache';
import { computeMapIdentity } from '../src/online/MapIdentity';
import { OFFICIAL_MAP_REGISTRY } from '../src/online/OfficialMapRegistry';
import {
  POV_REPLAY_SAMPLE_HZ,
  POV_REPLAY_VERSION,
  PovReplay,
  PovReplayIdentity,
  computeReplayHash,
  encodePovReplay,
  writeSample
} from '../src/replay/pov/PovReplayFormat';
import {
  buildGhostRaceRun,
  ghostFinishDelta,
  ghostSplitAt,
  sampleGhost
} from '../src/replay/GhostRaceSource';
import { GhostRaceController } from '../src/replay/GhostRaceController';
import { GeneratedTrack, RouteNode } from '../src/generation/GenerationTypes';

const repoRoot = path.resolve(__dirname, '..');
const PRESET_DIR = path.join(repoRoot, 'public', 'music', 'presets');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

/** Fresh parse every call: simulates a brand new session / cold load. */
function loadFresh(trackId: string) {
  const raw = fs.readFileSync(path.join(PRESET_DIR, `${trackId}.json`), 'utf8');
  return PresetLevelCache.buildLevelData(JSON.parse(raw) as Record<string, unknown>);
}

function expectedIdentityFor(trackId: string): PovReplayIdentity {
  const level = loadFresh(trackId);
  const identity = computeMapIdentity(trackId, level.track, level.analysis);
  return {
    trackId,
    mapVersion: identity.mapVersion,
    mapFingerprint: identity.mapFingerprint,
    movementVersion: identity.movementVersion
  };
}

// ---------------------------------------------------------------------------
// Deterministic per-track replay fixture, built from the CANONICAL ROUTE
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Unwraps yaw onto a continuous curve so recorded values never spin the long way. */
function unwrapYaw(previous: number, next: number): number {
  let delta = next - previous;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return previous + delta;
}

/**
 * Builds a replay that walks the track's real route, so interpolated ghost
 * transforms are verified against actual canonical geometry rather than noise.
 */
function buildRouteFixture(track: GeneratedTrack, identity: PovReplayIdentity): PovReplay {
  const route = track.route;
  const endSec = Math.max(1, route[route.length - 1].time);
  const count = Math.max(8, Math.round(endSec * POV_REPLAY_SAMPLE_HZ));
  const dtMs = 1000 / POV_REPLAY_SAMPLE_HZ;

  // Continuous yaw track across route nodes.
  const yaws: number[] = [route[0].yaw];
  for (let i = 1; i < route.length; i++) {
    yaws.push(unwrapYaw(yaws[i - 1], route[i].yaw));
  }

  const sampleAt = (tSec: number): { node: number; f: number } => {
    let i = 0;
    while (i < route.length - 2 && route[i + 1].time <= tSec) i++;
    const a = route[i];
    const b = route[i + 1] ?? a;
    const span = b.time - a.time;
    const f = span > 0 ? Math.min(1, Math.max(0, (tSec - a.time) / span)) : 0;
    return { node: i, f };
  };

  const samples: number[] = [];
  const positions: Array<{ x: number; y: number; z: number }> = [];

  for (let k = 0; k < count; k++) {
    const tSec = (k / POV_REPLAY_SAMPLE_HZ);
    const { node, f } = sampleAt(tSec);
    const a = route[node];
    const b = route[node + 1] ?? a;
    const x = lerp(a.position.x, b.position.x, f);
    const y = lerp(a.position.y, b.position.y, f) + a.dimensions.y * 0.5 + 0.05;
    const z = lerp(a.position.z, b.position.z, f);
    const yaw = lerp(yaws[node], yaws[node + 1] ?? yaws[node], f);

    positions.push({ x, y, z });
    const prev = positions[positions.length - 2] ?? positions[positions.length - 1];
    const vx = (x - prev.x) / (dtMs / 1000);
    const vy = (y - prev.y) / (dtMs / 1000);
    const vz = (z - prev.z) / (dtMs / 1000);

    writeSample(
      samples,
      Math.round(k * dtMs * 1000) / 1000,
      { x, y, z },
      { x: vx, y: vy, z: vz },
      yaw,
      0,
      true,
      a.isSurf,
      a.isSurf ? 1 : 0
    );
  }

  const durationMs = Math.round((count - 1) * dtMs);
  const events: PovReplay['events'] = track.checkpoints.map((cp, index) => ({
    t: Math.max(0, Math.round(cp.time * 1000)),
    type: 'CHECKPOINT' as const,
    d: index
  }));
  events.push({ t: durationMs, type: 'FINISH' });

  const draft: PovReplay = {
    replayVersion: POV_REPLAY_VERSION,
    identity,
    finishTimeUs: durationMs * 1000,
    durationMs,
    sampleHz: POV_REPLAY_SAMPLE_HZ,
    fov: 100,
    startSongTimeMs: 0,
    s: samples,
    events,
    cosmetic: { skinId: 'SIGNAL_CYAN' },
    hash: ''
  };
  draft.hash = computeReplayHash(encodePovReplay(draft));
  return draft;
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

interface SweepRow {
  trackId: string;
  mapVersion: number;
  mapFingerprint: string;
  movementVersion: string;
  identity: 'PASS' | 'FAIL';
  ghostLoad: 'PASS' | 'FAIL';
  midRun: 'PASS' | 'FAIL';
  reset: 'PASS' | 'FAIL';
  finishDelta: 'PASS' | 'FAIL';
  wrongMap: 'PASS' | 'FAIL';
}

const rows: SweepRow[] = [];
const failures: string[] = [];

const catalogTracks = SignalPackCatalog.getTracks();

describe('Ghost racing — official catalog sweep', () => {
  it('covers all 14 official tracks, one preset each', () => {
    expect(catalogTracks.length).toBe(14);
    expect(OFFICIAL_MAP_REGISTRY.length).toBe(14);
    const registryIds = OFFICIAL_MAP_REGISTRY.map((e) => e.trackId).sort();
    const catalogIds = catalogTracks.map((t) => t.id).sort();
    expect(catalogIds).toEqual(registryIds);
  });

  for (const track of catalogTracks) {
    it(`${track.id} — full ghost-race sweep`, () => {
      const row: SweepRow = {
        trackId: track.id,
        mapVersion: 0,
        mapFingerprint: '',
        movementVersion: '',
        identity: 'FAIL',
        ghostLoad: 'FAIL',
        midRun: 'FAIL',
        reset: 'FAIL',
        finishDelta: 'FAIL',
        wrongMap: 'FAIL'
      };
      rows.push(row);
      const fail = (what: string): void => {
        failures.push(`${track.id}: ${what}`);
      };

      // 1 + 2. Canonical preset resolves and registry identity matches.
      const level = loadFresh(track.id);
      expect(level.track.route.length, `${track.id} route`).toBeGreaterThan(5);

      const identity = expectedIdentityFor(track.id);
      row.mapVersion = identity.mapVersion;
      row.mapFingerprint = identity.mapFingerprint;
      row.movementVersion = identity.movementVersion;

      const registered = OFFICIAL_MAP_REGISTRY.find((e) => e.trackId === track.id);
      expect(registered, `${track.id} registry entry`).toBeTruthy();
      expect(identity.mapFingerprint, `${track.id} fingerprint`).toBe(registered!.mapFingerprint);
      expect(identity.mapVersion, `${track.id} mapVersion`).toBe(registered!.mapVersion);
      expect(identity.movementVersion, `${track.id} movementVersion`).toBe(
        registered!.movementVersion
      );
      row.identity = 'PASS';

      // 3 + 4. Deterministic fixture for THIS map identity -> GhostRaceSource.
      const replay = buildRouteFixture(level.track, identity);
      const payload = encodePovReplay(replay);
      const built = buildGhostRaceRun({
        kind: 'PB',
        label: 'PB GHOST',
        replay,
        expectedIdentity: identity,
        payload,
        expectedHash: replay.hash
      });
      if (!built.ok) {
        fail(`ghost load rejected: ${built.reason} ${built.detail}`);
        return;
      }
      const run = built.run;
      row.ghostLoad = 'PASS';

      // 5 + 6. Controller arms, starts, and t=0 lands on the canonical origin.
      const scene = new THREE.Scene();
      const controller = new GhostRaceController(scene);
      controller.load(run);
      expect(controller.isActive(), `${track.id} active`).toBe(true);
      expect(
        scene.children.filter((c) => c.name === 'GhostRaceRecorded').length,
        `${track.id} one ghost`
      ).toBe(1);

      controller.start();
      const visual = (controller as unknown as { visual: { group: THREE.Group } }).visual;
      const origin = level.track.route[0];

      // t=0 must show the RECORDED origin exactly.
      const atZero = sampleGhost(run, 0);
      expect(
        Number.isFinite(atZero.x) && Number.isFinite(atZero.y) && Number.isFinite(atZero.z),
        `${track.id} origin finite`
      ).toBe(true);
      expect(Number.isFinite(atZero.yaw), `${track.id} origin yaw finite`).toBe(true);
      expect(visual.group.position.x, `${track.id} t=0 x`).toBeCloseTo(atZero.x, 6);
      expect(visual.group.position.y, `${track.id} t=0 y`).toBeCloseTo(atZero.y, 6);
      expect(visual.group.position.z, `${track.id} t=0 z`).toBeCloseTo(atZero.z, 6);

      // ...and that origin must sit ON the canonical level. The route has a
      // zero-length lead-in (two nodes share time 0), so the recorded origin is
      // the first node whose time advances; assert it is within one lead-in
      // segment of the route start rather than exactly on node 0.
      const leadIn = Math.hypot(
        level.track.route[1].position.x - origin.position.x,
        level.track.route[1].position.z - origin.position.z
      );
      const originOffset = Math.hypot(
        atZero.x - origin.position.x,
        atZero.z - origin.position.z
      );
      expect(
        originOffset,
        `${track.id} recorded origin must be on the route`
      ).toBeLessThanOrEqual(leadIn + 0.001);

      // 7. Mid-run interpolation: finite, and inside the route's bounds.
      const bounds = routeBounds(level.track);
      const farFrom = new THREE.Vector3(0, 0, 0);
      for (const frac of [0.25, 0.5, 0.75]) {
        const tSec = (run.replay.durationMs / 1000) * frac;
        const sample = sampleGhost(run, tSec * 1000);
        expect(
          Number.isFinite(sample.x) && Number.isFinite(sample.y) && Number.isFinite(sample.z),
          `${track.id} finite at ${frac}`
        ).toBe(true);
        expect(Number.isFinite(sample.yaw), `${track.id} finite yaw at ${frac}`).toBe(true);
        expect(sample.x, `${track.id} x in bounds at ${frac}`).toBeGreaterThanOrEqual(bounds.minX - 1);
        expect(sample.x, `${track.id} x in bounds at ${frac}`).toBeLessThanOrEqual(bounds.maxX + 1);
        expect(sample.z, `${track.id} z in bounds at ${frac}`).toBeGreaterThanOrEqual(bounds.minZ - 1);
        expect(sample.z, `${track.id} z in bounds at ${frac}`).toBeLessThanOrEqual(bounds.maxZ + 1);

        // And the controller drives the visual to the same finite transform.
        farFrom.set(sample.x, sample.y + 500, sample.z);
        controller.update(tSec, farFrom);
        expect(
          Number.isFinite(visual.group.position.x) &&
            Number.isFinite(visual.group.position.y) &&
            Number.isFinite(visual.group.position.z),
          `${track.id} controller finite at ${frac}`
        ).toBe(true);
        expect(
          visual.group.position.x,
          `${track.id} controller matches sample at ${frac}`
        ).toBeCloseTo(sample.x, 6);
      }
      row.midRun = 'PASS';

      // 8. Full restart returns the ghost to start.
      const movedX = visual.group.position.x;
      expect(
        Math.hypot(movedX - atZero.x, visual.group.position.z - atZero.z),
        `${track.id} moved mid-run`
      ).toBeGreaterThan(0.001);
      controller.start();
      expect(visual.group.position.x, `${track.id} reset x`).toBeCloseTo(atZero.x, 6);
      expect(visual.group.position.y, `${track.id} reset y`).toBeCloseTo(atZero.y, 6);
      expect(visual.group.position.z, `${track.id} reset z`).toBeCloseTo(atZero.z, 6);
      row.reset = 'PASS';

      // 9. Finish delta uses raw integer microseconds.
      const playerFinish = run.finishTimeUs + 123_456;
      const comparison = ghostFinishDelta(run, playerFinish);
      expect(comparison.deltaUs, `${track.id} exact delta`).toBe(123_456);
      expect(comparison.ghostTimeUs, `${track.id} ghost time`).toBe(run.finishTimeUs);
      expect(Number.isInteger(comparison.deltaUs), `${track.id} integer delta`).toBe(true);
      row.finishDelta = 'PASS';

      // Checkpoint splits exist for every recorded checkpoint.
      for (const [index, ghostMs] of run.checkpointTimesMs) {
        const split = ghostSplitAt(run, index, ghostMs / 1000 + 0.25);
        expect(split, `${track.id} split ${index}`).not.toBeNull();
        expect(split!.deltaSeconds, `${track.id} split ${index} delta`).toBeCloseTo(0.25, 6);
        expect(split!.isAhead, `${track.id} split ${index} behind`).toBe(false);
      }

      // 10 + 11. The correct identity is accepted; a DIFFERENT official map is
      // rejected. Both directions are checked for every track.
      const other = OFFICIAL_MAP_REGISTRY.find((e) => e.trackId !== track.id)!;
      const otherIdentity = expectedIdentityFor(other.trackId);
      const crossCheck = buildGhostRaceRun({
        kind: 'WORLD',
        label: 'WORLD #1 // RUNNER',
        replay,
        expectedIdentity: otherIdentity,
        payload,
        expectedHash: replay.hash
      });
      expect(crossCheck.ok, `${track.id} accepted on ${other.trackId}`).toBe(false);
      if (!crossCheck.ok) {
        expect(
          [
            'TRACK_MISMATCH',
            'MAP_VERSION_MISMATCH',
            'MAP_FINGERPRINT_MISMATCH',
            'MOVEMENT_VERSION_MISMATCH'
          ],
          `${track.id} rejection reason`
        ).toContain(crossCheck.reason);
      }
      row.wrongMap = 'PASS';

      controller.dispose();
      expect(scene.children.length, `${track.id} disposed`).toBe(0);
    });
  }

  it('every official track passed every sweep column', () => {
    expect(rows.length).toBe(14);
    const report = rows
      .map(
        (r) =>
          `${r.trackId.padEnd(34)} ${r.identity}  ${r.ghostLoad}  ${r.midRun}  ${r.reset}  ${r.finishDelta}  ${r.wrongMap}`
      )
      .join('\n');
    // Printed so a failing run shows exactly which column broke.
    console.log(`\n${report}\n`);
    expect(failures, `sweep failures:\n${failures.join('\n')}`).toEqual([]);
    for (const r of rows) {
      expect(r.identity, `${r.trackId} identity`).toBe('PASS');
      expect(r.ghostLoad, `${r.trackId} ghost load`).toBe('PASS');
      expect(r.midRun, `${r.trackId} mid-run`).toBe('PASS');
      expect(r.reset, `${r.trackId} reset`).toBe('PASS');
      expect(r.finishDelta, `${r.trackId} finish delta`).toBe('PASS');
      expect(r.wrongMap, `${r.trackId} wrong-map rejection`).toBe('PASS');
    }
  });
});

function routeBounds(track: GeneratedTrack): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const visit = (nodes: RouteNode[]): void => {
    for (const n of nodes) {
      minX = Math.min(minX, n.position.x);
      maxX = Math.max(maxX, n.position.x);
      minZ = Math.min(minZ, n.position.z);
      maxZ = Math.max(maxZ, n.position.z);
    }
  };
  visit(track.route);
  if (track.optionalRamps) visit(track.optionalRamps);
  return { minX, maxX, minZ, maxZ };
}

// ---------------------------------------------------------------------------
// 12 + 13. Presentation isolation and normal PLAY, checked once (not per track)
// ---------------------------------------------------------------------------

describe('Ghost racing — sweep-wide invariants', () => {
  it('ghost presentation has no collision or gameplay references', () => {
    for (const file of [
      'src/replay/GhostRaceSource.ts',
      'src/replay/GhostRaceController.ts',
      'src/replay/GhostVisual.ts'
    ]) {
      const src = read(file);
      const imports = src.match(/^import[\s\S]*?from\s+'[^']+';/gm) ?? [];
      for (const line of imports) {
        expect(line, `${file}: ${line}`).not.toMatch(/physics|player\/|generation\//);
      }
      // No collision primitives, no movement constants, no scoring.
      expect(src, file).not.toMatch(/Collider|Raycaster|Box3|PLAYHEAD_MOVEMENT_V1/);
      expect(src, file).not.toMatch(/PlayerStats|computeResults|restoreToCheckpoint|PhysicsWorld/);
      // The ghost never writes to a player or physics object.
      expect(src, file).not.toMatch(/playerController\.|\.setPosition\(|\.applyImpulse\(/);
    }
  });

  it('normal PLAY is unaffected: the ghost is only read inside the ghost paths', () => {
    const game = read('src/core/Game.ts');
    // The controller is updated once, in the PLAYING branch, and never gates
    // movement, collision or timing.
    expect((game.match(/this\.ghostRace\.update\(/g) ?? []).length).toBe(1);
    expect(game).toMatch(/this\.ghostRace\.onPlayerCheckpoint\(/);
    expect(game).toMatch(/this\.ghostRace\.finishComparison\(/);
    // No ghost read in any movement, collision or restore path.
    for (const forbidden of [
      'playerController.move',
      'physics.step',
      'restoreToCheckpoint'
    ]) {
      const idx = game.indexOf(forbidden);
      if (idx < 0) continue;
      const window = game.slice(Math.max(0, idx - 400), idx + 400);
      expect(window, `${forbidden} must not consult the ghost`).not.toMatch(/ghostRace/);
    }
  });

  it('the ghost-race entry points are catalog-generic (no hardcoded track)', () => {
    const game = read('src/core/Game.ts');
    const importScreen = read('src/ui/ImportScreen.ts');
    const leaderboard = read('src/ui/LeaderboardPanel.ts');

    // Entry points take a trackId / runId from the UI, never a literal.
    expect(game).toMatch(/public async racePbGhost\(trackId: string\)/);
    expect(game).toMatch(/public async raceLeaderboardGhost\(runId: string\)/);
    expect(game).toMatch(/refreshPbGhostAvailability\(trackId: string\)/);
    expect(game).toMatch(/this\.ui\.importScreen\.getCatalogEntry\(trackId\)/);

    for (const [name, src] of [
      ['Game', game],
      ['ImportScreen', importScreen],
      ['LeaderboardPanel', leaderboard]
    ] as const) {
      expect(src, name).not.toMatch(/track_1[0-4]_|track_[1-9]_|kz_ascent|gravity_line/);
    }

    // The PB-ghost button is driven by a single generic setter.
    expect(importScreen).toMatch(/public setPbGhostAvailability\(state:/);
    expect(importScreen).toMatch(/this\.setPbGhostAvailability\(\{ available: false, pbTimeSeconds: summary\.pbTime \}\)/);
    // The RACE action is rendered only when the entry actually has a replay.
    expect(leaderboard).toMatch(/e\.replayVersion !== null/);
    expect(leaderboard).toMatch(/online-lb-race-btn/);
  });

  it('every official catalog entry can drive the showcase PB-ghost state', () => {
    // The availability setter is track-agnostic: the only input is the PB record
    // for whatever track is currently selected.
    const importScreen = read('src/ui/ImportScreen.ts');
    const updateFn = importScreen.slice(
      importScreen.indexOf('private updateShowcaseCard'),
      importScreen.indexOf('private renderFingerprint')
    );
    expect(updateFn).toMatch(/getRecordSummary\(t\.id\)/);
    expect(updateFn).toMatch(/setPbGhostAvailability/);

    // And Game refreshes it for the track that was just selected.
    const game = read('src/core/Game.ts');
    const enterFn = game.slice(
      game.indexOf('private async handleCatalogTrackSelected'),
      game.indexOf('private async handleCatalogTrackSelected') + 6000
    );
    expect(enterFn).toMatch(/this\.refreshPbGhostAvailability\(trackEntry\.id\)/);
  });
});
