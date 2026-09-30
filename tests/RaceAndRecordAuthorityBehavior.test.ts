import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const sql = read('supabase/migrations/20260930000003_authority_and_isolation.sql');
const submit = read('supabase/functions/submit-run/index.ts');
const race = read('src/online/RaceRoomService.ts');
const game = read('src/core/Game.ts');
const panel = read('src/ui/RacePanel.ts');

describe('Race RPC guard is not self-blocking', () => {
  it('race_mark_running sets the authorized-write flag itself', () => {
    const fn = sql.slice(sql.indexOf('function public.race_mark_running'));
    expect(fn).toMatch(/set_config\('playhead\.authorized_race_write', '1', true\)/);
    expect(fn).toMatch(/set_config\('playhead\.authorized_race_write', '0', true\)/);
    expect(fn).toMatch(/state = 'RUNNING'/);
    expect(fn).toMatch(/extract\(epoch from now\(\)\)/);
  });

  it('in-game ready is refused outside IN_GAME and before loaded', () => {
    const fn = sql.slice(sql.indexOf('function public.race_set_in_game_ready'));
    expect(fn).toMatch(/cannot ready before reporting loaded/);
    expect(fn).toMatch(/'LOBBY'/);
  });

  it('the state machine requires ALL connected loaded AND in-game-ready', () => {
    expect(sql).toMatch(/v_ingame >= 2 and v_ingame = v_connected/);
    expect(sql).toMatch(/v_loaded >= 2 and v_loaded = v_connected/);
  });

  it('the room guard locks setup after the lobby', () => {
    expect(sql).toMatch(/race setup is locked after the lobby/);
  });

  it('there is a heartbeat and a stale-player expiry with a real grace', () => {
    expect(sql).toMatch(/function public\.race_heartbeat/);
    expect(sql).toMatch(/function public\.race_expire_stale_players/);
    expect(sql).toMatch(/p_grace_seconds integer default 20/);
    expect(race).toMatch(/void this\.heartbeat\(\)/);
    expect(race).toMatch(/void this\.expireStalePlayers\(\)/);
  });

  it('the client never writes readiness flags directly (uses server RPCs)', () => {
    expect(race).toMatch(/race_set_in_game_ready/);
    expect(race).not.toMatch(/update\(\{ in_game_ready/);
  });

  it('the obsolete manual START SESSION button is removed from the lobby', () => {
    expect(panel).not.toMatch(/onStartSession\(\)/);
    expect(game).toMatch(/Obsolete manual START SESSION path/);
  });

  it('abort actually leaves the gameplay scene, not just the UI', () => {
    expect(game).toMatch(/raceLoadGeneration\+\+/);
    expect(game).toMatch(/transitionTo\(GameState\.IMPORT\)/);
  });
});

describe('World record is atomic and once-per-account', () => {
  it('serializes the board with an advisory lock before the decision', () => {
    const fn = sql.slice(sql.indexOf('function public.accept_leaderboard_run'));
    expect(fn).toMatch(/pg_advisory_xact_lock/);
    expect(fn).toMatch(/p_time_us < v_prev_best/);
    expect(fn).toMatch(/verification_state = 'accepted'/);
  });

  it('awards exactly one row per account+board via the primary key', () => {
    const fn = sql.slice(sql.indexOf('function public.accept_leaderboard_run'));
    expect(fn).toMatch(/on conflict \(user_id, award_id\) do nothing/);
    expect(fn).toMatch(/'BLACKSTAR'/);
  });

  it('BLACKSTAR / WORLD_RECORD cannot be directly inserted by a client', () => {
    expect(sql).toMatch(/function public\.cosmetic_ownership_guard/);
    expect(sql).toMatch(/WORLD_RECORD provenance is server-authoritative/);
    expect(sql).toMatch(/function public\.player_progress_guard/);
    expect(sql).toMatch(/cannot be written directly/);
  });

  it('preserves legitimate HISTORICAL reserved ownership via the snapshot', () => {
    expect(sql).toMatch(/pre_migration_cosmetic_snapshot/);
    expect(sql).toMatch(/has_historical_reserved_ownership/);
  });

  it('the PB persistence works with an explicit user id (no auth.uid dependency)', () => {
    const fn = sql.slice(sql.indexOf('function public.accept_leaderboard_run'));
    expect(fn).toMatch(/insert into public\.track_progress/);
    expect(fn).toMatch(/p_user_id/);
  });

  it('submit-run consumes the DB outcome and takes no privileged client flag', () => {
    expect(submit).toMatch(/accept_leaderboard_run/);
    expect(submit).toMatch(/verdict\.is_world_record/);
    expect(submit).not.toMatch(/body\.is_world_record/);
  });
});

describe('Registered username authority', () => {
  it('profiles.display_name cannot be changed by a registered client', () => {
    expect(sql).toMatch(/function public\.profiles_guard/);
    expect(sql).toMatch(/registered usernames are server-authoritative/);
    const auth = read('src/online/AuthService.ts');
    expect(auth).toMatch(/if \(this\.isRegisteredAccount\(\)\)/);
  });
});
