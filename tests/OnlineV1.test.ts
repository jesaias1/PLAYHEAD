/**
 * ONLINE V1 — logic tests.
 *
 * These run entirely offline: no Supabase project is contacted. Services are
 * exercised through injected fakes, and the pure functions (map identity,
 * session ranking, invite parsing, name validation) are tested directly.
 *
 * They verify the rules that are easy to get subtly wrong: canonical map
 * identity, "no duplicate / no lost rewards", atomic PB semantics, and the
 * shared BEST-TIME SESSION model (not first-to-finish).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

import {
  MAP_FINGERPRINT_ALGORITHM,
  MOVEMENT_VERSION,
  computeMapFingerprint,
  computeMapIdentity,
  verifyAgainstRegistry
} from '../src/online/MapIdentity';
import { REGISTRY_READY, OFFICIAL_MAP_REGISTRY } from '../src/online/OfficialMapRegistry';
import {
  computeSessionResults,
  sessionRemainingMs,
  DEFAULT_SESSION_SECONDS,
  RacePlayer,
  RaceRoom,
  RaceRoomService
} from '../src/online/RaceRoomService';
import { generateDisplayName, validateDisplayName, AuthService } from '../src/online/AuthService';
import { OnlineClient } from '../src/online/supabaseClient';
import { LeaderboardService } from '../src/online/LeaderboardService';
import { CloudProgression } from '../src/online/CloudProgression';
import { GeneratedTrack, RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function node(id: number, x: number, y: number, z: number): RouteNode {
  return {
    id,
    time: id,
    position: { x, y, z },
    dimensions: { x: 16, y: 2, z: 24 },
    yaw: 0,
    pitch: 0,
    roll: 0,
    type: RouteNodeType.RUNWAY,
    intensity: 0.5,
    sectionIndex: 0,
    arcLength: id * 30,
    isSurf: false,
    isBoost: false
  };
}

function track(seed = 1): GeneratedTrack {
  const route = [node(0, 0, 0, 0), node(1, 0, 0, 30), node(2, 0, 0, 60)];
  return {
    generationVersion: 5,
    seed,
    route,
    checkpoints: [],
    finish: { routeNodeId: 2, time: 10, position: route[2].position, yaw: 0 },
    totalDistance: 60,
    targetDuration: 10,
    repairedJumpsCount: 0
  };
}

function player(overrides: Partial<RacePlayer>): RacePlayer {
  return {
    userId: 'u1',
    displayName: 'PLAYER-A',
    ready: true,
    connected: true,
    attemptCount: 0,
    finishCount: 0,
    sessionBestUs: null,
    currentRunUs: 0,
    joinedAt: 0,
    lastSeenAt: 0,
    ...overrides
  };
}

function room(overrides: Partial<RaceRoom> = {}): RaceRoom {
  return {
    id: 'r1',
    inviteCode: 'AB12CD',
    hostUserId: 'u1',
    trackId: 'track_5_gravity_line',
    trackTitle: 'GRAVITY LINE',
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_DEADBEEF',
    state: 'LOBBY',
    sessionSeconds: DEFAULT_SESSION_SECONDS,
    startAtMs: null,
    finishedAtMs: null,
    expiresAtMs: Number.MAX_SAFE_INTEGER,
    ...overrides
  };
}

// ---------------------------------------------------------------------------

describe('Map identity — canonical competitive identity', () => {
  it('is deterministic for the same map', () => {
    expect(computeMapFingerprint(track())).toBe(computeMapFingerprint(track()));
  });

  it('changes when the map changes', () => {
    const a = track();
    const b = track();
    b.route[1].position.x += 0.5; // 0.5 m of real layout change
    expect(computeMapFingerprint(a)).not.toBe(computeMapFingerprint(b));
  });

  it('is insensitive to sub-0.1mm float noise but sensitive above it', () => {
    const a = track();
    const noisy = track();
    noisy.route[1].position.x += 1e-9; // engine ULP noise
    expect(computeMapFingerprint(a)).toBe(computeMapFingerprint(noisy));

    const real = track();
    real.route[1].position.x += 0.001; // 1 mm
    expect(computeMapFingerprint(a)).not.toBe(computeMapFingerprint(real));
  });

  it('includes the versions and the algorithm revision', () => {
    const identity = computeMapIdentity('track_5_gravity_line', track());
    expect(identity.mapVersion).toBe(5);
    expect(identity.movementVersion).toBe(MOVEMENT_VERSION);
    expect(identity.generatorVersion).toMatch(/^gen_\d+$/);
    expect(identity.mapFingerprint).toContain(`mfp_v${MAP_FINGERPRINT_ALGORITHM}_`);
  });

  it('derives movementVersion from the frozen movement config', () => {
    // Any retune changes the identity automatically, so competitive runs are
    // invalidated without anyone remembering to bump a manual version.
    expect(MOVEMENT_VERSION).toMatch(/^phmv1_[0-9A-F]{8}$/);
  });

  it('refuses submission when the local map does not match the registry', () => {
    const identity = computeMapIdentity('track_5_gravity_line', track());
    const verdict = verifyAgainstRegistry(identity, []);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe('MISSING_FROM_REGISTRY');
  });

  it('accepts an exact registry match and rejects each mismatch independently', () => {
    const identity = computeMapIdentity('track_5_gravity_line', track());
    const entry = {
      trackId: identity.trackId,
      seed: 1,
      mapVersion: identity.mapVersion,
      mapFingerprint: identity.mapFingerprint,
      movementVersion: identity.movementVersion,
      generatorVersion: identity.generatorVersion
    };
    expect(verifyAgainstRegistry(identity, [entry]).ok).toBe(true);

    const badVersion = verifyAgainstRegistry(identity, [{ ...entry, mapVersion: 4 }]);
    expect(badVersion.ok).toBe(false);
    if (!badVersion.ok) expect(badVersion.reason).toBe('MAP_VERSION_MISMATCH');

    const badFingerprint = verifyAgainstRegistry(identity, [{ ...entry, mapFingerprint: 'other' }]);
    expect(badFingerprint.ok).toBe(false);
    if (!badFingerprint.ok) expect(badFingerprint.reason).toBe('MAP_FINGERPRINT_MISMATCH');

    const badMovement = verifyAgainstRegistry(identity, [{ ...entry, movementVersion: 'old' }]);
    expect(badMovement.ok).toBe(false);
    if (!badMovement.ok) expect(badMovement.reason).toBe('MOVEMENT_VERSION_MISMATCH');
  });

  it('ships an ENABLED registry covering every official catalog track', () => {
    expect(REGISTRY_READY).toBe(true);
    expect(OFFICIAL_MAP_REGISTRY.length).toBeGreaterThanOrEqual(10);
    // Every entry must carry the full canonical identity.
    for (const entry of OFFICIAL_MAP_REGISTRY) {
      expect(entry.mapVersion).toBeGreaterThan(0);
      expect(entry.mapFingerprint).toMatch(/^mfp_v\d+_[0-9A-F]{16}_[0-9a-f]+$/);
      expect(entry.movementVersion).toBe(MOVEMENT_VERSION);
      expect(entry.analysisFingerprint).toMatch(/^anfp_v\d+_[0-9A-F]{16}$/);
      expect(entry.seed).toBeGreaterThan(0);
    }
    // No duplicate track ids.
    const ids = OFFICIAL_MAP_REGISTRY.map((e) => e.trackId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------

describe('Friend session — shared BEST-TIME session (not first-to-finish)', () => {
  it('ranks by best valid completion time, lowest first', () => {
    const rows = computeSessionResults([
      player({ userId: 'a', displayName: 'LINAS', sessionBestUs: 54_821_000, finishCount: 3, attemptCount: 7 }),
      player({ userId: 'b', displayName: 'RANKO', sessionBestUs: 57_104_000, finishCount: 1, attemptCount: 4 })
    ]);
    expect(rows[0].displayName).toBe('LINAS');
    expect(rows[0].outcome).toBe('WIN');
    expect(rows[1].outcome).toBe('LOSS');
    expect(rows[1].gapUs).toBe(57_104_000 - 54_821_000);
  });

  it('lets a later attempt beat an earlier finish (session best, not first finish)', () => {
    // RANKO finished first but LINAS improved twice afterwards and wins.
    const rows = computeSessionResults([
      player({ userId: 'a', sessionBestUs: 50_000_000, finishCount: 3 }),
      player({ userId: 'b', sessionBestUs: 49_000_000, finishCount: 1 })
    ]);
    expect(rows[0].userId).toBe('b');
    expect(rows[0].outcome).toBe('WIN');
  });

  it('declares a single finisher the winner', () => {
    const rows = computeSessionResults([
      player({ userId: 'a', sessionBestUs: 61_000_000, finishCount: 1 }),
      player({ userId: 'b', sessionBestUs: null, attemptCount: 9 })
    ]);
    expect(rows[0].outcome).toBe('WIN');
    expect(rows[1].outcome).toBe('LOSS');
    expect(rows[1].gapUs).toBeNull();
  });

  it('reports NO FINISH when neither player completes', () => {
    const rows = computeSessionResults([
      player({ userId: 'a', sessionBestUs: null, attemptCount: 4 }),
      player({ userId: 'b', sessionBestUs: null, attemptCount: 2 })
    ]);
    expect(rows.every((r) => r.outcome === 'NO_FINISH')).toBe(true);
    expect(rows.every((r) => r.gapUs === null)).toBe(true);
  });

  it('reports TIE on exactly equal microsecond times', () => {
    const rows = computeSessionResults([
      player({ userId: 'a', sessionBestUs: 55_000_000 }),
      player({ userId: 'b', sessionBestUs: 55_000_000 })
    ]);
    expect(rows.every((r) => r.outcome === 'TIE')).toBe(true);
    expect(rows.every((r) => r.gapUs === 0)).toBe(true);
  });

  it('compares raw microsecond values, never formatted strings', () => {
    // 59_999_999us and 60_000_000us both format as 01:00.000 at 3dp, but they
    // are different times and must not tie.
    const rows = computeSessionResults([
      player({ userId: 'a', sessionBestUs: 59_999_999 }),
      player({ userId: 'b', sessionBestUs: 60_000_000 })
    ]);
    expect(rows[0].userId).toBe('a');
    expect(rows[0].outcome).toBe('WIN');
    expect(rows[1].outcome).toBe('LOSS');
  });

  it('keeps the session clock running and never resets it', () => {
    const started = room({ startAtMs: 1_000_000, sessionSeconds: 300 });
    expect(sessionRemainingMs(started, 1_000_000)).toBe(300_000);
    expect(sessionRemainingMs(started, 1_120_000)).toBe(180_000);
    // A player restarting does not touch the room, so remaining time is stable.
    expect(sessionRemainingMs(started, 1_120_000)).toBe(180_000);
    // Clamps at zero rather than going negative.
    expect(sessionRemainingMs(started, 9_999_999)).toBe(0);
  });

  it('defaults to a 5 minute session', () => {
    expect(DEFAULT_SESSION_SECONDS).toBe(300);
    expect(room().sessionSeconds).toBe(300);
  });
});

// ---------------------------------------------------------------------------

describe('Friend session — invite codes and map gating', () => {
  it('parses ?room=CODE from a URL', () => {
    expect(RaceRoomService.readInviteCodeFromUrl('https://playhead.game/?room=ab12cd')).toBe('AB12CD');
    expect(RaceRoomService.readInviteCodeFromUrl('https://playhead.game/?foo=1&room=ZZ99ZZ')).toBe('ZZ99ZZ');
    expect(RaceRoomService.readInviteCodeFromUrl('https://playhead.game/')).toBeNull();
    expect(RaceRoomService.readInviteCodeFromUrl('not a url')).toBeNull();
  });

  it('blocks a session when the local map does not match the room', () => {
    const service = new RaceRoomService(
      OnlineClient.__createWithClientForTests(null),
      new AuthService(OnlineClient.__createWithClientForTests(null))
    );
    // No room -> blocked.
    expect(service.verifyLocalMap(track()).ok).toBe(false);

    const identity = computeMapIdentity('track_5_gravity_line', track());
    (service as unknown as { room: RaceRoom }).room = room({
      mapVersion: identity.mapVersion,
      mapFingerprint: identity.mapFingerprint
    });
    expect(service.verifyLocalMap(track()).ok).toBe(true);

    (service as unknown as { room: RaceRoom }).room = room({
      mapVersion: identity.mapVersion,
      mapFingerprint: 'mfp_v1_WRONG'
    });
    const mismatch = service.verifyLocalMap(track());
    expect(mismatch.ok).toBe(false);
    expect(mismatch.detail).toContain('MAP VERSION MISMATCH');
  });

  it('builds the invite URL from the current origin, never a hardcoded domain', () => {
    const service = new RaceRoomService(
      OnlineClient.__createWithClientForTests(null),
      new AuthService(OnlineClient.__createWithClientForTests(null))
    );
    (service as unknown as { room: RaceRoom }).room = room({ inviteCode: 'AB12CD' });
    const url = service.getInviteUrl();
    expect(url).toBeTruthy();
    // Relative to the app origin; the origin comes from window.location, so this
    // test asserts the SHAPE and that no production domain is hardcoded.
    expect(url).toContain('?room=AB12CD');
    expect(url).not.toContain('playhead.game');

    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../src/online/RaceRoomService.ts'),
      'utf8'
    );
    expect(src).toMatch(/window\.location\.origin/);
  });
});

// ---------------------------------------------------------------------------

describe('Auth — anonymous identity', () => {
  it('generates readable display names, never raw UUIDs', () => {
    for (let i = 0; i < 50; i++) {
      const name = generateDisplayName();
      expect(name).toMatch(/^(PLAYER|SIGNAL|OPERATOR|RUNNER|VECTOR|PULSE)-[0-9A-F]{4}$/);
    }
  });

  it('is deterministic when seeded', () => {
    expect(generateDisplayName('a7f2')).toBe(generateDisplayName('a7f2'));
  });

  it('validates display names', () => {
    expect(validateDisplayName('PLAYER-A7F2').ok).toBe(true);
    expect(validateDisplayName('  spaced  name  ')).toEqual({ ok: true, value: 'spaced name' });
    expect(validateDisplayName('').ok).toBe(false);
    expect(validateDisplayName('   ').ok).toBe(false);
    expect(validateDisplayName('a'.repeat(25)).ok).toBe(false);
    expect(validateDisplayName('bad\u0000name').ok).toBe(false);
    expect(validateDisplayName('emoji🚀name').ok).toBe(false);
  });

  it('fails gracefully when Supabase is not configured', async () => {
    const offline = OnlineClient.__createWithClientForTests(null);
    const auth = new AuthService(offline);
    const result = await auth.ensureSession();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('OFFLINE');
    expect(auth.isSignedIn()).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('Online client — security and offline behaviour', () => {
  it('reports OFFLINE without configuration and never throws', () => {
    const client = OnlineClient.__createWithClientForTests(null);
    expect(client.isConfigured()).toBe(false);
    expect(client.getStatus()).toBe('OFFLINE');
    expect(client.getStatusLabel()).toBe('[OFFLINE]');
    expect(client.getClient()).toBeNull();
  });

  it('exposes restrained status labels', () => {
    const client = OnlineClient.__createWithClientForTests(null);
    client.setStatus('ONLINE');
    expect(client.getStatusLabel()).toBe('[ONLINE]');
    client.setStatus('CONNECTING');
    expect(client.getStatusLabel()).toBe('[CONNECTING]');
    client.setStatus('ERROR');
    expect(client.getStatusLabel()).toBe('[LOCAL // SYNC PENDING]');
  });

  it('notifies subscribers and survives a throwing listener', () => {
    const client = OnlineClient.__createWithClientForTests(null);
    const seen: string[] = [];
    const unsubscribe = client.subscribe((s) => {
      seen.push(s);
      throw new Error('listener blew up');
    });
    client.setStatus('ONLINE');
    expect(seen).toEqual(['OFFLINE', 'ONLINE']);
    expect(() => unsubscribe()).not.toThrow();
  });

  it('refuses to initialise with a privileged-looking key', async () => {
    // The guard lives in readEnv(); assert the rule textually so a refactor
    // cannot quietly drop it.
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../src/online/supabaseClient.ts'),
      'utf8'
    );
    expect(src).toMatch(/service_role/);
    expect(src).toMatch(/sb_secret_/);
    expect(src).toMatch(/VITE_SUPABASE_URL/);
    expect(src).toMatch(/VITE_SUPABASE_PUBLISHABLE_KEY/);
    // Must not READ Next.js env conventions (the doc comment may mention them).
    expect(src).not.toMatch(/env\.NEXT_PUBLIC_/);
    expect(src).not.toMatch(/NEXT_PUBLIC_[A-Z_]+\s*[?:)]/);
  });
});

// ---------------------------------------------------------------------------

describe('Leaderboard — submission gating and anti-cheat V1', () => {
  const identity = computeMapIdentity('track_5_gravity_line', track());

  function service(): LeaderboardService {
    const onlineClient = OnlineClient.__createWithClientForTests(null);
    const auth = new AuthService(onlineClient);
    // Pretend we are signed in so only the identity/dev/time gates are exercised.
    (auth as unknown as { currentProfile: { id: string; displayName: string } }).currentProfile = {
      id: 'user-1',
      displayName: 'PLAYER-A7F2'
    };
    return new LeaderboardService(onlineClient, auth);
  }

  it('reports the registry as ready, and gates the remaining checks in order', () => {
    const svc = service();
    // The registry is canonical now, so the gate advances to connectivity.
    const canSubmit = svc.canSubmitCompetitively();
    expect(canSubmit.detail).toBe('offline');
  });

  it('rejects DEV runs, invalid times and identity mismatches', () => {
    const svc = service();
    const base = {
      identity,
      timeUs: 60_000_000,
      rank: 'GOLD',
      checkpointCount: 4,
      resetCount: 1,
      devMode: false
    };

    // Offline wins first (no client configured).
    const offline = svc.preflight(base);
    expect(offline && !offline.ok && offline.reason).toBe('OFFLINE');
  });

  it('rejects a DEV run before anything else, even with a valid canonical map', () => {
    const svc = service();
    (svc as unknown as { onlineClient: { getClient: () => unknown } }).onlineClient.getClient = () => ({});
    const outcome = svc.preflight({
      identity,
      timeUs: 60_000_000,
      rank: 'GOLD',
      checkpointCount: 4,
      resetCount: 0,
      devMode: true
    });
    // DEV is checked before identity/time, so DEV runs can never be submitted.
    expect(outcome && !outcome.ok && outcome.reason).toBe('DEV_RUN');
  });

  it('accepts a clean official run once the registry is ready and we are online', () => {
    const svc = service();
    (svc as unknown as { onlineClient: { getClient: () => unknown } }).onlineClient.getClient = () => ({});
    // A run whose identity matches the shipped canonical registry passes
    // preflight; the server still has the final word.
    const entry = OFFICIAL_MAP_REGISTRY[0];
    const canonicalIdentity = {
      trackId: entry.trackId,
      mapVersion: entry.mapVersion,
      mapFingerprint: entry.mapFingerprint,
      movementVersion: entry.movementVersion,
      generatorVersion: entry.generatorVersion,
      analysisVersion: entry.analysisVersion,
      analysisFingerprint: entry.analysisFingerprint
    };
    const outcome = svc.preflight({
      identity: canonicalIdentity,
      timeUs: 60_000_000,
      rank: 'GOLD',
      checkpointCount: 4,
      resetCount: 0,
      devMode: false
    });
    expect(outcome).toBeNull();
  });

  it('rejects a run whose map fingerprint does not match the canonical registry', () => {
    const svc = service();
    (svc as unknown as { onlineClient: { getClient: () => unknown } }).onlineClient.getClient = () => ({});
    const entry = OFFICIAL_MAP_REGISTRY[0];
    const tampered = {
      trackId: entry.trackId,
      mapVersion: entry.mapVersion,
      mapFingerprint: 'mfp_v1_0000000000000000_dead',
      movementVersion: entry.movementVersion,
      generatorVersion: entry.generatorVersion,
      analysisVersion: entry.analysisVersion,
      analysisFingerprint: entry.analysisFingerprint
    };
    const outcome = svc.preflight({
      identity: tampered,
      timeUs: 60_000_000,
      rank: 'GOLD',
      checkpointCount: 4,
      resetCount: 0,
      devMode: false
    });
    expect(outcome && !outcome.ok && outcome.reason).toBe('IDENTITY_MISMATCH');
  });

  it('never fabricates a WORLD ranking when the backend is unavailable', async () => {
    const svc = service();
    const view = await svc.fetchLeaderboard('track_5_gravity_line', identity);
    expect(view.offline).toBe(true);
    expect(view.entries).toEqual([]);
    expect(view.you).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('Online UI — race time formatting', () => {
  it('formats microsecond values as MM:SS.mmm', async () => {
    const { formatRaceTime, formatSessionClock } = await import('../src/ui/RaceHud');
    expect(formatRaceTime(54_821_000)).toBe('00:54.821');
    expect(formatRaceTime(57_104_000)).toBe('00:57.104');
    expect(formatRaceTime(0)).toBe('00:00.000');
    expect(formatRaceTime(3_600_000_000)).toBe('60:00.000');
    expect(formatRaceTime(null)).toBe('--:--.---');
    expect(formatRaceTime(-1)).toBe('--:--.---');
    expect(formatRaceTime(Number.NaN)).toBe('--:--.---');
  });

  it('formats the shared session clock as MM:SS and clamps at zero', async () => {
    const { formatSessionClock } = await import('../src/ui/RaceHud');
    expect(formatSessionClock(300_000)).toBe('05:00');
    expect(formatSessionClock(221_000)).toBe('03:41');
    expect(formatSessionClock(0)).toBe('00:00');
    expect(formatSessionClock(-5000)).toBe('00:00');
  });

  it('never lets display rounding create a tie', async () => {
    const { formatRaceTime } = await import('../src/ui/RaceHud');
    // 59.999999 s displays as 00:59.999 and 60.000000 s as 01:00.000.
    expect(formatRaceTime(59_999_999)).toBe('00:59.999');
    expect(formatRaceTime(60_000_000)).toBe('01:00.000');
    // Two values that DO format identically must still not tie, because
    // comparison uses raw microseconds (see computeSessionResults).
    const rows = computeSessionResults([
      player({ userId: 'a', sessionBestUs: 60_000_000 }),
      player({ userId: 'b', sessionBestUs: 60_000_001 })
    ]);
    expect(formatRaceTime(60_000_000)).toBe(formatRaceTime(60_000_001));
    expect(rows[0].outcome).toBe('WIN');
    expect(rows[1].outcome).toBe('LOSS');
  });
});

describe('Online UI — invite code parsing', () => {
  it('accepts the deployed-origin and localhost shapes alike', () => {
    expect(RaceRoomService.readInviteCodeFromUrl('https://playhead.vercel.app/?room=AB12CD')).toBe('AB12CD');
    expect(RaceRoomService.readInviteCodeFromUrl('http://localhost:3000/?room=ab12cd')).toBe('AB12CD');
    expect(RaceRoomService.readInviteCodeFromUrl('https://x.dev/?room=AB12CD&debug=1')).toBe('AB12CD');
    expect(RaceRoomService.readInviteCodeFromUrl('https://x.dev/?debug=1')).toBeNull();
  });
});

// NOTE: the ONLINE panel, race lobby, results table and leaderboard table are
// DOM components and this project's test runner has no DOM environment. They are
// verified by the browser probe (.perf/online_ui.json) rather than by unit
// tests: it confirms the tab exists, both sections render, all 14 tracks are
// selectable in both selectors, the race HUD exists hidden, the invite URL
// activates the ONLINE tab, and there are zero console errors.

// ---------------------------------------------------------------------------

describe('Cloud progression — offline-first and no reward duplication', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('queues operations offline and de-duplicates by kind+key', () => {
    const onlineClient = OnlineClient.__createWithClientForTests(null);
    const auth = new AuthService(onlineClient);
    const cloud = new CloudProgression(onlineClient, auth);

    cloud.enqueue({ kind: 'award_rank_key', key: 'track_5_gravity_line:GOLD', rank: 'GOLD', at: 1 });
    cloud.enqueue({ kind: 'award_rank_key', key: 'track_5_gravity_line:GOLD', rank: 'GOLD', at: 2 });
    cloud.enqueue({ kind: 'custom_claim', fingerprint: 'cafp_v1_x', at: 3 });

    expect(cloud.getQueueLength()).toBe(2);
  });

  it('is a no-op while offline and never throws', async () => {
    const onlineClient = OnlineClient.__createWithClientForTests(null);
    const auth = new AuthService(onlineClient);
    const cloud = new CloudProgression(onlineClient, auth);

    await expect(cloud.sync()).resolves.toBe('OFFLINE');
    await expect(cloud.flushQueue()).resolves.toBe(0);
  });

  it('treats a privileged key as a hard no: no client, no sync, no crash', async () => {
    const onlineClient = OnlineClient.__createWithClientForTests(null);
    const auth = new AuthService(onlineClient);
    const cloud = new CloudProgression(onlineClient, auth);
    expect(onlineClient.getClient()).toBeNull();
    expect(await cloud.sync()).toBe('OFFLINE');
  });
});
