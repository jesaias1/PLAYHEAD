/**
 * FRIEND RACE — READY FLOW tests.
 *
 * Regression cover for the production bug where clicking READY did nothing.
 *
 * Two defects were found by tracing the chain end-to-end:
 *
 *   1. `RaceRoomService.setReady()` discarded the PostgREST result entirely.
 *      A PostgREST UPDATE that is blocked by RLS, or whose filter matches no
 *      row, resolves with `data: null`, `error: null`, HTTP 200/204. So a
 *      silently-failing write was indistinguishable from success.
 *
 *   2. The lobby's ONLY path back to fresh player state was the Realtime
 *      `postgres_changes` subscription — and the migration never added
 *      `race_room_players` / `race_rooms` to the `supabase_realtime`
 *      publication, so those events were never delivered.
 *
 * These tests run fully offline against a PostgREST-shaped fake that reproduces
 * both behaviours, including row-level security.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import {
  RaceRoomService,
  RacePlayer,
  RaceRoom,
  computeBothReady
} from '../src/online/RaceRoomService';
import { AuthService } from '../src/online/AuthService';
import { OnlineClient } from '../src/online/supabaseClient';
import { computeMapIdentity } from '../src/online/MapIdentity';
import { GeneratedTrack, RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface FakeError {
  code?: string;
  message: string;
}

interface FakeResult {
  data: Row[] | null;
  error: FakeError | null;
  status: number;
}

/**
 * Minimal PostgREST-shaped fake.
 *
 * Deliberately mirrors the exact behaviours that hid this bug:
 *   - an UPDATE matching no row resolves with `data: []` and NO error;
 *   - RLS only lets the authenticated user touch their own row, and a blocked
 *     update also resolves without an error.
 */
class FakeClient {
  public rows: Row[] = [];
  public selectCount = 0;
  public updateCount = 0;
  public failUpdate: FakeError | null = null;

  constructor(public readonly uid: () => string | null) {}

  from(table: string): FakeQuery {
    if (table !== 'race_room_players') throw new Error(`unexpected table: ${table}`);
    return new FakeQuery(this);
  }
}

class FakeQuery {
  private filters: Array<[string, unknown]> = [];
  private op: 'select' | 'update' | 'upsert' = 'select';
  private payload: Row | null = null;
  private wantSelect = false;

  constructor(private readonly client: FakeClient) {}

  public select(_cols = '*'): this {
    this.wantSelect = true;
    return this;
  }

  public eq(col: string, value: unknown): this {
    this.filters.push([col, value]);
    return this;
  }

  public update(payload: Row): this {
    this.op = 'update';
    this.payload = payload;
    return this;
  }

  public upsert(payload: Row): this {
    this.op = 'upsert';
    this.payload = payload;
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every(([col, value]) => row[col] === value);
  }

  private run(): FakeResult {
    if (this.op === 'select') {
      this.client.selectCount++;
      const data = this.client.rows.filter((r) => this.matches(r)).map((r) => ({ ...r }));
      return { data, error: null, status: 200 };
    }

    this.client.updateCount++;
    if (this.client.failUpdate) {
      return { data: null, error: this.client.failUpdate, status: 403 };
    }

    // RLS: only the authenticated user's own row is updatable.
    const uid = this.client.uid();
    const affected = this.client.rows.filter((r) => this.matches(r) && r.user_id === uid);
    for (const row of affected) Object.assign(row, this.payload);

    // Without `.select()`, PostgREST returns no rows at all — the writer cannot
    // tell a successful update from a blocked one.
    return {
      data: this.wantSelect ? affected.map((r) => ({ ...r })) : null,
      error: null,
      status: this.wantSelect ? 200 : 204
    };
  }

  // Thenable, so `await client.from(...)...` works exactly like the real client.
  public then(
    onFulfilled: (value: FakeResult) => unknown,
    onRejected?: (reason: unknown) => unknown
  ): Promise<unknown> {
    return Promise.resolve(this.run()).then(onFulfilled, onRejected);
  }
}

function makeAuth(uid: string | null): AuthService {
  const auth = new AuthService(OnlineClient.__createWithClientForTests(null));
  if (uid) {
    (auth as unknown as { currentProfile: { id: string; displayName: string } }).currentProfile = {
      id: uid,
      displayName: 'PLAYER-A'
    };
  }
  return auth;
}

function makeService(uid: string | null, rows: Row[]): {
  service: RaceRoomService;
  fake: FakeClient;
} {
  const fake = new FakeClient(() => uid);
  fake.rows = rows;
  const onlineClient = OnlineClient.__createWithClientForTests(fake as never);
  const service = new RaceRoomService(onlineClient, makeAuth(uid));
  (service as unknown as { room: RaceRoom }).room = roomFixture();
  return { service, fake };
}

function playerRow(userId: string, ready: boolean, connected = true): Row {
  return {
    room_id: 'room-1',
    user_id: userId,
    display_name: `P-${userId}`,
    ready,
    connected,
    attempt_count: 0,
    finish_count: 0,
    session_best_us: null,
    current_run_us: 0,
    joined_at: '2026-01-01T00:00:00.000Z',
    last_seen_at: '2026-01-01T00:00:00.000Z'
  };
}

function roomFixture(overrides: Partial<RaceRoom> = {}): RaceRoom {
  return {
    id: 'room-1',
    inviteCode: 'AB12CD',
    hostUserId: 'u1',
    trackId: 'track_5_gravity_line',
    trackTitle: 'GRAVITY LINE',
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_test',
    state: 'LOBBY',
    sessionSeconds: 300,
    startAtMs: null,
    finishedAtMs: null,
    expiresAtMs: Number.MAX_SAFE_INTEGER,
    ...overrides
  };
}

function node(id: number, z: number): RouteNode {
  return {
    id,
    time: id,
    position: { x: 0, y: 0, z },
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

function trackFixture(seed = 1): GeneratedTrack {
  const route = [node(0, 0), node(1, 30), node(2, 60)];
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

function playerFixture(overrides: Partial<RacePlayer>): RacePlayer {
  return {
    userId: 'u1',
    displayName: 'P-A',
    ready: false,
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

/** Reach the private refresh path the Realtime handler invokes. */
function refresh(service: RaceRoomService): Promise<void> {
  return (service as unknown as { refreshPlayers: () => Promise<void> }).refreshPlayers();
}

const repoRoot = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// 1. The write itself
// ---------------------------------------------------------------------------

describe('READY — the write', () => {
  it('updates the CURRENT user\'s own row and verifies one row changed', async () => {
    const { service, fake } = makeService('u1', [
      playerRow('u1', false),
      playerRow('u2', false)
    ]);

    const result = await service.setReady(true);

    expect(result.ok).toBe(true);
    expect(fake.rows.find((r) => r.user_id === 'u1')!.ready).toBe(true);
    // The other player is untouched.
    expect(fake.rows.find((r) => r.user_id === 'u2')!.ready).toBe(false);

    const diag = service.getLobbyDiagnostics();
    expect(diag.lastReadyUpdate?.ok).toBe(true);
    expect(diag.lastReadyUpdate?.rows).toBe(1);
  });

  it('targets room_id AND user_id exactly', async () => {
    const { service } = makeService('u1', [playerRow('u1', false)]);

    await service.setReady(true);

    // The fake only applies the update when BOTH filters match; a wrong key
    // would leave ready=false.
    const diag = service.getLobbyDiagnostics();
    expect(diag.readyDatabase).toBe(true);
  });

  it('toggles back to NOT READY', async () => {
    const { service, fake } = makeService('u1', [playerRow('u1', true)]);

    const result = await service.setReady(false);

    expect(result.ok).toBe(true);
    expect(fake.rows[0].ready).toBe(false);
    expect(service.getLobbyDiagnostics().readyDatabase).toBe(false);
  });

  it('reports a ZERO-ROW update as a failure instead of silently succeeding', async () => {
    // The signed-in user has no row in this room (e.g. stale session or a
    // different user id than the one stored). PostgREST would return 200/204
    // with no error — which is exactly the silent failure that was shipped.
    const { service, fake } = makeService('u9', [playerRow('u1', false)]);

    const result = await service.setReady(true);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('NO ROW UPDATED');
    expect(fake.rows[0].ready).toBe(false);
    expect(service.getLobbyDiagnostics().lastReadyUpdate?.rows).toBe(0);
  });

  it('surfaces an RLS / PostgREST error verbatim', async () => {
    const { service, fake } = makeService('u1', [playerRow('u1', false)]);
    fake.failUpdate = {
      code: '42501',
      message: 'new row violates row-level security policy for table "race_room_players"'
    };

    const result = await service.setReady(true);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('row-level security');
    expect(service.getLobbyDiagnostics().lastReadyUpdate?.ok).toBe(false);
  });

  it('refuses to write when there is no room or no session', async () => {
    const noRoom = makeService('u1', [playerRow('u1', false)]).service;
    (noRoom as unknown as { room: null }).room = null;
    const roomless = await noRoom.setReady(true);
    expect(roomless.ok).toBe(false);
    expect(roomless.detail).toContain('not in a room');
    // Pre-flight failures are still recorded for DEV diagnostics.
    expect(noRoom.getLobbyDiagnostics().lastReadyUpdate?.detail).toBe('not in a room');

    const noAuth = makeService(null, [playerRow('u1', false)]).service;
    const signedOut = await noAuth.setReady(true);
    expect(signedOut.ok).toBe(false);
    expect(signedOut.detail).toContain('not signed in');
  });
});

// ---------------------------------------------------------------------------
// 2. RLS — a player may only mutate their OWN row
// ---------------------------------------------------------------------------

describe('READY — row-level security', () => {
  it('cannot update another player\'s ready state', async () => {
    const { service, fake } = makeService('u1', [
      playerRow('u1', false),
      playerRow('u2', false)
    ]);

    // Even if a malicious client constructs the query directly, the database
    // policy (mirrored by the fake) refuses: zero rows are affected.
    const direct = await (fake.from('race_room_players') as FakeQuery)
      .update({ ready: true })
      .eq('room_id', 'room-1')
      .eq('user_id', 'u2')
      .select('*');

    expect(direct.data).toHaveLength(0);
    expect(fake.rows.find((r) => r.user_id === 'u2')!.ready).toBe(false);

    // And the legitimate path never touches the rival.
    await service.setReady(true);
    expect(fake.rows.find((r) => r.user_id === 'u2')!.ready).toBe(false);
  });

  it('the shipped migration restricts UPDATE to the owner', () => {
    const migration = fs.readFileSync(
      path.join(repoRoot, 'supabase', 'migrations', '20260922000000_online_v1.sql'),
      'utf8'
    );
    expect(migration).toMatch(
      /create policy race_players_update_self on public\.race_room_players\s+for update using \(auth\.uid\(\) = user_id\) with check \(auth\.uid\(\) = user_id\)/
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Realtime publication — the actual root cause
// ---------------------------------------------------------------------------

describe('Realtime — the lobby tables must be published', () => {
  it('a later migration adds both lobby tables to supabase_realtime', () => {
    const dir = path.join(repoRoot, 'supabase', 'migrations');
    const all = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
      .join('\n');

    // Without this, `postgres_changes` delivers nothing and the lobby can never
    // learn about a remote READY change.
    expect(all).toMatch(/alter publication supabase_realtime add table public\.race_room_players/);
    expect(all).toMatch(/alter publication supabase_realtime add table public\.race_rooms/);
    expect(all).toMatch(/race_room_players replica identity full/);
    expect(all).toMatch(/race_rooms replica identity full/);
  });

  it('the player-change handler refreshes state and is counted for diagnostics', () => {
    const src = fs.readFileSync(
      path.join(repoRoot, 'src', 'online', 'RaceRoomService.ts'),
      'utf8'
    );
    // The subscription must actually reconcile state, and be observable.
    expect(src).toMatch(/table: 'race_room_players', filter: `room_id=eq\.\$\{room\.id\}`/);
    expect(src).toMatch(/this\.realtimePlayerEvents\+\+;\s*\n\s*void this\.refreshPlayers\(\);/);
  });

  it('re-syncs on (re)connect and starts the polling fallback', () => {
    const src = fs.readFileSync(
      path.join(repoRoot, 'src', 'online', 'RaceRoomService.ts'),
      'utf8'
    );
    expect(src).toMatch(/status === 'SUBSCRIBED'[\s\S]{0,200}refreshPlayers\(\)/);
    expect(src).toMatch(/status === 'SUBSCRIBED'[\s\S]{0,300}startLobbySync\(\)/);
  });

  it('the polling fallback is safe without a DOM and stops on leave', () => {
    const { service } = makeService('u1', [playerRow('u1', false)]);
    // Node test environment has no window: must be a no-op, never a crash.
    expect(() => service.startLobbySync(10)).not.toThrow();
    expect(service.getLobbyDiagnostics().lobbySyncActive).toBe(false);
    expect(() => service.stopLobbySync()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. State merge — DB is the truth, Realtime just triggers a re-read
// ---------------------------------------------------------------------------

describe('READY — state merge through refresh', () => {
  it('ready=true persists through a room refresh', async () => {
    const { service } = makeService('u1', [playerRow('u1', false)]);
    await service.setReady(true);

    await refresh(service);

    const mine = service.getPlayers().find((p) => p.userId === 'u1')!;
    expect(mine.ready).toBe(true);
    expect(service.getLobbyDiagnostics().readyDatabase).toBe(true);
  });

  it('a remote player\'s ready change is merged from the database', async () => {
    const { service, fake } = makeService('u1', [
      playerRow('u1', false),
      playerRow('u2', false)
    ]);

    const updates: RacePlayer[][] = [];
    service.setCallbacks({ onRoomUpdate: (_room, players) => updates.push(players.map((p) => ({ ...p }))) });

    // Player B clicks READY on the other client; the row changes in the DB.
    fake.rows.find((r) => r.user_id === 'u2')!.ready = true;

    // The Realtime handler's only job is to trigger this re-read.
    await refresh(service);

    const last = updates[updates.length - 1];
    expect(last.find((p) => p.userId === 'u2')!.ready).toBe(true);
    expect(service.getLobbyDiagnostics().readyDatabase).toBe(false); // still us
  });

  it('does NOT keep a stale optimistic READY when the DB disagrees', async () => {
    const { service } = makeService('u1', [playerRow('u1', false)]);

    // Pretend the UI optimistically flipped local state but the server never
    // persisted it. A refresh must reconcile to the DB, not to the optimism.
    (service as unknown as { players: RacePlayer[] }).players = [playerFixture({ userId: 'u1', ready: true })];

    await refresh(service);

    expect(service.getPlayers().find((p) => p.userId === 'u1')!.ready).toBe(false);
  });

  it('reconnect yields the correct CURRENT ready state, not a stale one', async () => {
    const { service, fake } = makeService('u1', [playerRow('u1', false)]);

    // Reconnected session finds the row already ready in the database.
    fake.rows[0].ready = true;
    await refresh(service);
    expect(service.getPlayers().find((p) => p.userId === 'u1')!.ready).toBe(true);

    // And a later refresh reflects a subsequent change too.
    fake.rows[0].ready = false;
    await refresh(service);
    expect(service.getPlayers().find((p) => p.userId === 'u1')!.ready).toBe(false);
  });

  it('a disconnected rival does NOT have their ready flag rewritten', async () => {
    const { service } = makeService('u1', [
      playerRow('u1', true),
      playerRow('u2', true, false) // connected = false, ready stays true
    ]);

    await refresh(service);

    const rival = service.getPlayers().find((p) => p.userId === 'u2')!;
    expect(rival.connected).toBe(false);
    expect(rival.ready).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. START condition — separate from map verification
// ---------------------------------------------------------------------------

describe('START condition', () => {
  it('requires two connected, ready players', () => {
    expect(computeBothReady([])).toBe(false);
    expect(computeBothReady([playerFixture({ userId: 'u1', ready: true })])).toBe(false);
    expect(
      computeBothReady([
        playerFixture({ userId: 'u1', ready: true }),
        playerFixture({ userId: 'u2', ready: false })
      ])
    ).toBe(false);
    expect(
      computeBothReady([
        playerFixture({ userId: 'u1', ready: true }),
        playerFixture({ userId: 'u2', ready: true })
      ])
    ).toBe(true);
  });

  it('ignores disconnected players and never counts them as ready', () => {
    // Two rows, but only one is connected: not startable.
    expect(
      computeBothReady([
        playerFixture({ userId: 'u1', ready: true }),
        playerFixture({ userId: 'u2', ready: true, connected: false })
      ])
    ).toBe(false);
  });

  it('transitions false -> true -> false as readiness changes', () => {
    const a = playerFixture({ userId: 'u1', ready: false });
    const b = playerFixture({ userId: 'u2', ready: false });
    expect(computeBothReady([a, b])).toBe(false);
    a.ready = true;
    expect(computeBothReady([a, b])).toBe(false);
    b.ready = true;
    expect(computeBothReady([a, b])).toBe(true);
    a.ready = false;
    expect(computeBothReady([a, b])).toBe(false);
  });

  it('map verification is a SEPARATE axis from readiness', () => {
    const { service } = makeService('u1', [
      playerRow('u1', true),
      playerRow('u2', true)
    ]);
    const identity = computeMapIdentity('track_5_gravity_line', trackFixture());

    // Verified map.
    (service as unknown as { room: RaceRoom }).room = roomFixture({
      mapVersion: identity.mapVersion,
      mapFingerprint: identity.mapFingerprint
    });
    expect(service.verifyLocalMap(trackFixture()).ok).toBe(true);

    // Mismatched map: the players' readiness is completely untouched.
    (service as unknown as { room: RaceRoom }).room = roomFixture({
      mapVersion: identity.mapVersion,
      mapFingerprint: 'mfp_v1_WRONG'
    });
    expect(service.verifyLocalMap(trackFixture()).ok).toBe(false);
    expect(service.getPlayers().every((p) => p.ready)).toBe(true);
  });

  it('a player blocked by map verification is reported as MAP state, not NOT READY', () => {
    // The UI contract: readiness, connectivity and map identity are distinct.
    const src = fs.readFileSync(path.join(repoRoot, 'src', 'ui', 'RacePanel.ts'), 'utf8');
    expect(src).toMatch(/MAP MISMATCH/);
    expect(src).toMatch(/MAP VERIFYING/);
    expect(src).toMatch(/SETTING READY/);
    // START is gated on map state as well as readiness.
    expect(src).toMatch(/this\.lobbyStartBtn\.disabled = !allReady \|\| this\.mapState === 'MISMATCH'/);
  });
});

// ---------------------------------------------------------------------------
// 6. UI contract — no permanent optimistic READY
// ---------------------------------------------------------------------------

describe('READY — UI contract', () => {
  it('shows a pending state, surfaces failures, and never fakes READY', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'src', 'ui', 'RacePanel.ts'), 'utf8');
    expect(src).toMatch(/SETTING READY\.\.\./);
    expect(src).toMatch(/setReadyResult\(ok: boolean, detail: string\)/);
    // The pending guard stops double-writes.
    expect(src).toMatch(/if \(this\.pendingReady\) return;/);
    // A failed write is surfaced in the status line rather than being swallowed.
    expect(src).toMatch(/this\.lobbyStatusElem\.textContent = this\.readyError;/);
    // A failed write rolls the optimistic toggle back to the pre-click value.
    expect(src).toMatch(/this\.readyState = this\.pendingFromReady;/);
    // READY is gated on map verification, which is a separate axis.
    expect(src).toMatch(/this\.lobbyReadyBtn\.disabled = this\.mapState !== 'OK';/);
  });

  it('Game wires the verified result back into the lobby and logs failures', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'src', 'core', 'Game.ts'), 'utf8');
    expect(src).toMatch(/raceRoomService\.setReady\(ready\)\.then\(\(result\) => \{/);
    expect(src).toMatch(/setReadyResult\(result\.ok, result\.detail\)/);
    expect(src).toMatch(/ready update failed/);
  });

  it('exposes DEV lobby diagnostics without leaking full UUIDs', () => {
    const { service } = makeService('11111111-2222-3333-4444-555555555555', [
      playerRow('11111111-2222-3333-4444-555555555555', true)
    ]);
    const diag = service.getLobbyDiagnostics();

    expect(diag.userIdSuffix).toBe('555555');
    expect(diag.userIdSuffix.length).toBeLessThan(12);
    expect(diag.roomId).toBe('room-1');
    expect(diag.rowFound).toBe(false); // players not loaded yet
    expect(diag.lobbySyncActive).toBe(false);

    const overlay = fs.readFileSync(path.join(repoRoot, 'src', 'ui', 'DevOverlay.ts'), 'utf8');
    expect(overlay).toMatch(/RACE LOBBY:/);
    expect(overlay).toMatch(/LAST READY:/);
  });
});
