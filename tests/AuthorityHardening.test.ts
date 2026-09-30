import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const sql = read('supabase/migrations/20260930000003_authority_and_isolation.sql');
const race = read('src/online/RaceRoomService.ts');
const ghost = read('src/online/RemoteGhostRenderer.ts');
const game = read('src/core/Game.ts');
const panel = read('src/ui/RacePanel.ts');

function between(text: string, start: string, end: string): string {
  // Use the LAST occurrence: the surgical override block repeats earlier
  // definitions on purpose, and the deployed definition is the final one.
  const i = text.lastIndexOf(start);
  const j = text.indexOf(end, i + start.length);
  return text.slice(i, j === -1 ? undefined : j);
}

describe('A. Reserved-reward bypass is closed', () => {
  it('the client-driven sync_progression wrapper no longer sets the authorized flags', () => {
    const wrapper = between(
      sql,
      'create or replace function public.sync_progression(',
      'grant execute on function public.sync_progression('
    );
    expect(wrapper).not.toContain("authorized_progress_write");
    expect(wrapper).not.toContain("authorized_cosmetic_write");
    expect(wrapper).toContain('sync_progression_impl');
  });

  it('the client-driven grant_progression_events wrapper no longer sets the authorized flag', () => {
    const wrapper = between(
      sql,
      'create or replace function public.grant_progression_events(',
      'grant execute on function public.grant_progression_events('
    );
    expect(wrapper).not.toContain('authorized_progress_write');
    expect(wrapper).toContain('grant_progression_events_impl');
  });

  it('claim_world_record_award keeps the flags but resets them on every exit', () => {
    const claim = between(
      sql,
      'create or replace function public.claim_world_record_award(',
      'grant execute on function public.claim_world_record_award('
    );
    expect(claim).toContain("set_config('playhead.authorized_cosmetic_write', '1'");
    expect(claim).toContain("set_config('playhead.authorized_cosmetic_write', '0'");
    expect(claim).toContain('exception when others then');
    expect(claim).toContain('raise;');
  });

  it('cosmetic_ownership_guard allows only historical OR already-claimed reserved ids', () => {
    const guard = between(
      sql,
      'create or replace function public.cosmetic_ownership_guard()',
      'drop trigger if exists cosmetic_ownership_guard'
    );
    expect(guard).toContain('has_historical_reserved_ownership');
    expect(guard).toContain('from public.player_world_records');
  });

  it('both _impl bodies filter reserved input and are revoked from clients', () => {
    const syncImpl = between(sql, 'create or replace function public.sync_progression_impl(', 'grant_progression_events(p_events');
    expect(syncImpl).toContain('is_reserved_cosmetic');
    expect(syncImpl).toContain('has_historical_reserved_ownership');
    expect(syncImpl).toContain('from public.player_world_records');
    expect(sql).toMatch(
      /revoke all on function public\.sync_progression_impl\(text, text\[\], text\[\], text\[\], text\[\], boolean, text\) from public, anon, authenticated/
    );
    expect(sql).toMatch(
      /revoke all on function public\.grant_progression_events_impl\(jsonb\) from public, anon, authenticated/
    );
  });

  it('the queued cloud event key carries the raw cosmetic id, never an opKey prefix', () => {
    const flush = between(read('src/online/CloudProgression.ts'), 'public async flushQueue', 'public getQueue');
    expect(flush).toContain("CloudProgression.eventKey(op)");
    expect(flush).not.toContain("key: CloudProgression.opKey(op)");
  });
});

describe('C. Race provenance hardening', () => {
  it('adds a loadout column and locks it after the lobby', () => {
    expect(sql).toMatch(/alter table public\.race_room_players\s+add column if not exists loadout jsonb/);
    expect(sql).toContain('race loadout is locked once the room leaves the lobby');
  });

  it('direct readiness may only raise in_game_ready during IN_GAME and after loaded', () => {
    expect(sql).toContain('cannot mark in-game ready before the in-game stage');
    expect(sql).toContain('cannot mark in-game ready before reporting loaded');
  });

  it('COUNTDOWN requires both loaded AND in-game-ready for ALL connected members', () => {
    expect(sql).toContain('v_ingame >= 2 and v_ingame = v_connected');
    expect(sql).toContain('and v_loaded = v_connected');
  });

  it('race_set_in_game_ready refuses true outside IN_GAME', () => {
    expect(sql).toContain('in-game ready is only accepted during the in-game stage');
  });

  it('stale-player expiry requires membership and clamps the grace window', () => {
    expect(sql).toContain('least(60, greatest(20');
    const exp = between(sql, 'create or replace function public.race_expire_stale_players(', 'grant execute on function public.race_expire_stale_players');
    expect(exp).toContain('not a member of this room');
  });

  it('race_report_finish is RUNNING-only, server-derived and idempotent', () => {
    const fin = between(sql, 'create or replace function public.race_report_finish(', 'grant execute on function public.race_report_finish');
    expect(fin).toContain("v_state <> 'RUNNING'");
    expect(fin).toContain('v_time := v_epoch_us');
    expect(fin).toContain('if v_row.session_best_us is not null and v_row.session_best_us = v_time then');
    expect(fin).not.toContain('v_time := p_time_us');
  });

  it('race_report_attempt_start is RUNNING-only', () => {
    const att = between(sql, 'create or replace function public.race_report_attempt_start(', 'grant execute on function public.race_report_attempt_start');
    expect(att).toContain("v_state <> 'RUNNING'");
  });

  it('the client keeps a loadout on the room row and reads it back', () => {
    expect(race).toContain('loadout,');
    expect(race).toContain('rowToPlayer');
    expect(race).toMatch(/rawLoadout\.knifeId|rawLoadout\.gloveId/);
  });

  it('the remote ghost supports a deterministic competitive staging offset', () => {
    expect(ghost).toContain('setStagingOffset');
    expect(ghost).toContain('STAGING_LATERAL_OFFSET');
    expect(game).toContain('setStagingOffset(true)');
  });

  it('Game arms the shared start on RUNNING and retries a failed load report', () => {
    expect(game).toContain('MISSING-COUNTDOWN SAFETY');
    expect(game).toContain('this.armRaceGo(room.startAtMs)');
    expect(game).toContain('LOAD REPORT RETRY');
  });

  it('the in-game manual restore is gated until the race is RACING', () => {
    expect(game).toContain('WAITING FOR SHARED START');
  });

  it('the obsolete host START button is always hidden', () => {
    expect(panel).toContain('this.lobbyStartBtn.classList.add');
    expect(panel).toContain('ALWAYS hidden');
  });
});

describe('B. CloudProgression authority', () => {
  it('fetches authoritative cloud state before the initial sync write', () => {
    const cloud = read('src/online/CloudProgression.ts');
    expect(cloud).toContain('hydrateFromCloudAuthoritative');
    const sync = between(cloud, 'public async sync()', 'private async hydrateFromCloudAuthoritative');
    expect(sync).toContain('await this.hydrateFromCloudAuthoritative(userId)');
    const idx = sync.indexOf('hydrateFromCloudAuthoritative');
    const rpc = sync.indexOf("client.rpc('sync_progression'");
    expect(idx).toBeGreaterThan(-1);
    expect(rpc).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(rpc);
  });

  it('OnlineBootstrap refreshes account identity before syncing', () => {
    const boot = read('src/online/OnlineBootstrap.ts');
    const idIdx = boot.indexOf('await authService.refreshAccountIdentity()');
    const syncIdx = boot.indexOf('const result = await cloudProgression.sync()');
    expect(idIdx).toBeGreaterThan(-1);
    expect(syncIdx).toBeGreaterThan(-1);
    expect(idIdx).toBeLessThan(syncIdx);
  });
});
