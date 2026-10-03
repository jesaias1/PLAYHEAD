/**
 * ONLINE RACE 2.0 — FIRST-TO-FINISH lifecycle, readiness, capacity and the
 * race-instance (raceId) guards. Pure/static only: no Supabase project is
 * contacted. The SQL assertions are STATIC text checks over the migration.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  computeRaceResults,
  computeAllReady,
  computeInGameReady,
  isRaceComplete,
  activeRacerCount,
  MIN_RACE_PLAYERS,
  shouldAcceptRemoteGhost,
  RACE_CAPACITIES,
  DEFAULT_RACE_CAPACITY,
  RacePlayer,
  RaceRoom
} from '../src/online/RaceRoomService';

const repoRoot = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const sql = read('supabase/migrations/20261002000000_online_race_2.sql');
const race = read('src/online/RaceRoomService.ts');

function player(overrides: Partial<RacePlayer>): RacePlayer {
  return {
    userId: 'u1',
    displayName: 'P',
    loadout: null,
    ready: false,
    inGameReady: false,
    loaded: false,
    connected: true,
    finishUs: null,
    finished: false,
    dnf: false,
    colorIndex: 0,
    joinedAt: 0,
    lastSeenAt: 0,
    progress: 0,
    checkpointTotal: 0,
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
    mapFingerprint: 'mfp',
    state: 'LOBBY',
    capacity: 4,
    raceId: 'race-1',
    startAtMs: null,
    finishedAtMs: null,
    expiresAtMs: Number.MAX_SAFE_INTEGER,
    ...overrides
  };
}

describe('first-to-finish results', () => {
  it('orders finishers by authoritative elapsed and DNF last', () => {
    const rows = computeRaceResults([
      player({ userId: 'c', dnf: true, connected: false }),
      player({ userId: 'a', finishUs: 30_000_000, finished: true }),
      player({ userId: 'b', finishUs: 20_000_000, finished: true })
    ]);
    expect(rows.map((r) => r.userId)).toEqual(['b', 'a', 'c']);
    expect(rows[0].place).toBe(1);
    expect(rows[1].place).toBe(2);
    expect(rows[2].dnf).toBe(true);
  });

  it('a finisher is never reported as DNF', () => {
    const rows = computeRaceResults([player({ userId: 'a', finishUs: 1, finished: true })]);
    expect(rows[0].dnf).toBe(false);
  });

  it('counts only still-running active racers', () => {
    expect(activeRacerCount([
      player({ userId: 'a', finishUs: 1, finished: true }),
      player({ userId: 'b' }),
      player({ userId: 'c', dnf: true, connected: false })
    ])).toBe(1);
  });

  it('completes only when everyone finished or DNF\'d', () => {
    expect(isRaceComplete([player({ userId: 'a' }), player({ userId: 'b', finishUs: 1, finished: true })])).toBe(false);
    expect(isRaceComplete([player({ userId: 'a', finishUs: 1, finished: true }), player({ userId: 'b', dnf: true, connected: false })])).toBe(true);
  });
});

describe('readiness + capacity', () => {
  it('ships 2..8 capacities with a default of 4', () => {
    expect([...RACE_CAPACITIES]).toEqual([2, 3, 4, 6, 8]);
    expect(DEFAULT_RACE_CAPACITY).toBe(4);
  });

  it('lobby gate needs ALL connected ready and >= 2', () => {
    expect(MIN_RACE_PLAYERS).toBe(2);
    expect(computeAllReady([player({ ready: true })])).toBe(false);
    expect(computeAllReady([player({ userId: 'a', ready: true }), player({ userId: 'b', ready: true })])).toBe(true);
    expect(computeAllReady([player({ userId: 'a', ready: true }), player({ userId: 'b' })])).toBe(false);
  });

  it('in-game gate needs loaded AND ready', () => {
    expect(computeInGameReady([player({ userId: 'a', loaded: true, inGameReady: true }), player({ userId: 'b', loaded: true })])).toBe(false);
    expect(computeInGameReady([player({ userId: 'a', loaded: true, inGameReady: true }), player({ userId: 'b', loaded: true, inGameReady: true })])).toBe(true);
  });
});

describe('race instance (raceId) guards', () => {
  it('rejects a ghost sample from a previous race instance', () => {
    const sample = { userId: 'b', raceId: 'race-1', colorIndex: 0, t: 1, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, checkpointIndex: 0, checkpointTotal: 0, running: true };
    expect(shouldAcceptRemoteGhost({ ...sample, t: Date.now() }, 'a', 'race-1')).toBe(true);
    expect(shouldAcceptRemoteGhost({ ...sample, t: Date.now() }, 'a', 'race-2')).toBe(false);
  });

  it('the client carries raceId on every mutating RPC', () => {
    for (const name of [
      'race_set_ready_v2',
      'race_report_loaded_v2',
      'race_set_in_game_ready_v2',
      'race_mark_running_v2',
      'race_report_finish_v2',
      'race_report_progress_v2',
      'race_report_dnf_v2',
      'race_heartbeat_v2',
      'race_mark_disconnected_v2',
      'race_expire_stale_players_v2',
      'race_abandon_session_v2',
      'race_request_rematch_v2'
    ]) {
      expect(race, name).toContain(name);
    }
    expect(race).toContain('p_race_id: this.room.raceId');
  });
});

describe('SQL guards (static)', () => {
  it('every v2 definition verifies the race instance', () => {
    expect((sql.match(/race_id is distinct from p_race_id/g) ?? []).length).toBeGreaterThanOrEqual(10);
  });

  it('revokes the retired v1 overloads from clients', () => {
    expect(sql).toContain('revoke execute on function public.race_report_finish(uuid, bigint)');
    expect(sql).toContain('revoke execute on function public.race_report_attempt_start(uuid, integer)');
  });

  it('RUNNING completes to FINISHED only when everyone finished or DNF\'d', () => {
    expect(sql).toContain('v_finishers >= v_connected');
    expect(sql).toContain("set state = 'FINISHED', finished_at = now()");
  });

  it('protects every authority field from direct writes', () => {
    for (const token of ['new.finish_us', 'new.finished', 'new.dnf', 'new.progress', 'new.color_index', 'new.loaded', 'new.in_game_ready', 'new.connected']) {
      expect(sql, token).toContain(token);
    }
    expect(sql).toContain('race player authority fields are server-owned');
  });

  it('never allows a host to force a FINISHED/LOBBY state directly', () => {
    expect(sql).toContain('race state is server-authoritative');
    expect(sql).not.toContain("new.state in ('FINISHED','LOBBY')");
  });

  it('does not add a validating room-code CHECK over legacy rows', () => {
    expect(sql).not.toContain('race_code_valid check');
    expect(sql).not.toContain("invite_code ~");
  });

  it('adds the checkpoint_total column additively', () => {
    expect(sql).toContain('add column if not exists checkpoint_total integer not null default 0;');
  });
});

describe('no client-time finish', () => {
  it('the finish RPC never sends a client time', () => {
    expect(race).not.toContain('p_time_us');
  });
});
