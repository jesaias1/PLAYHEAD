import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = path.resolve(__dirname, '..');
function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

describe('World record reward is server-authoritative', () => {
  it('the client can only CLAIM an award, never create one', () => {
    const cloud = read('src/online/CloudProgression.ts');
    expect(cloud).toMatch(/claim_world_record_award/);
    // The client never inserts into player_world_records.
    expect(cloud).not.toMatch(/from\('player_world_records'\)[\s\S]{0,40}insert/);
  });

  it('the submit-run function delegates the record to the atomic server RPC', () => {
    const fn = read('supabase/functions/submit-run/index.ts');
    // The client-facing function no longer decides anything: it calls the
    // service-role RPC that owns the insert, the strict-time WR decision and the
    // PB upsert inside one serialized transaction.
    expect(fn).toMatch(/accept_leaderboard_run/);
    // It reports the server verdict verbatim, never a client flag.
    expect(fn).toMatch(/is_world_record/);
    expect(fn).not.toMatch(/\.from\('player_world_records'\)/);
    expect(fn).not.toMatch(/\.from\('leaderboard_runs'\)[\s\S]{0,200}insert/);
  });

  it('the atomic accept RPC owns the world record and the PB', () => {
    const sql = read('supabase/migrations/20260930000003_authority_and_isolation.sql');
    expect(sql).toMatch(/player_world_records/);
    expect(sql).toMatch(/BLACKSTAR/);
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sql).toMatch(/p_time_us < v_prev_best/);
    expect(sql).toMatch(/function public\.accept_leaderboard_run/);
  });

  it('the migration makes the award table client-write-free', () => {
    const sql = read('supabase/migrations/20260930000001_world_record_reward.sql');
    // RLS enabled with only a SELECT policy, and no insert/update/delete policy.
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toMatch(/for select using \(auth\.uid\(\) = user_id\)/i);
    // Exactly ONE policy: a self-only SELECT. No client write policy exists.
    const policyCount = (sql.match(/create policy/gi) ?? []).length;
    expect(policyCount).toBe(1);
    expect(sql).not.toMatch(/create policy[\s\S]{0,80}for insert/i);
  });

  it('BLACKSTAR is documented as the reserved prestige reward', () => {
    const skins = read('src/viewmodel/KarambitSkinSystem.ts');
    expect(skins).toMatch(/WORLD RECORD/);
  });
});

describe('Replay cosmetics preview without mutating the viewer loadout', () => {
  it('the viewmodel renders the replay preview, not the equipped skin', () => {
    const vm = read('src/viewmodel/ViewmodelController.ts');
    expect(vm).toMatch(/refreshRenderedSkin/);
    expect(vm).toMatch(/getRenderSkinId\(\)/);
  });

  it('Game previews the recorded skin/glove instead of equipping them', () => {
    const game = read('src/core/Game.ts');
    expect(game).toMatch(/setReplaySkinPreview/);
    expect(game).toMatch(/getGloveId\(\) \|\| null/);
    // The old live-equip during playback must be gone.
    expect(game).not.toMatch(/skin\.equipSkin\(skinId\)/);
  });
});

describe('Username accounts (no email)', () => {
  it('the account-auth function hashes passwords via Supabase Auth', () => {
    const fn = read('supabase/functions/account-auth/index.ts');
    expect(fn).toMatch(/createUser/);
    expect(fn).toMatch(/signInWithPassword/);
    // The function never hashes or stores a password itself: GoTrue owns it.
    expect(fn).not.toMatch(/password_hash/);
    expect(fn).not.toMatch(/bcrypt\.hash|createHash\(/);
  });

  it('AuthService exposes register/login/logout and account cache', () => {
    const auth = read('src/online/AuthService.ts');
    expect(auth).toMatch(/registerAccount/);
    expect(auth).toMatch(/loginAccount/);
    expect(auth).toMatch(/logoutAccount/);
    expect(auth).toMatch(/account-auth/);
  });

  it('the accounts migration enforces unique normalized usernames', () => {
    const sql = read('supabase/migrations/20260930000002_accounts.sql');
    expect(sql).toMatch(/username_norm\s+text not null unique/i);
    expect(sql).toMatch(/enable row level security/i);
    // No client policies: only the service-role function writes accounts.
    expect(sql).not.toMatch(/create policy/i);
  });
});

describe('Race state machine is server-authoritative', () => {
  const sql = read('supabase/migrations/20260930000000_race_state_machine.sql');

  it('requires ALL connected players loaded and ready, not just a count of two', () => {
    expect(sql).toMatch(/v_ready = v_connected/);
    expect(sql).toMatch(/v_loaded = v_connected/);
    expect(sql).toMatch(/v_ingame = v_connected/);
  });

  it('resets stale ready flags on abort and reacts to disconnect/delete', () => {
    expect(sql).toMatch(/after insert or update or delete/i);
    expect(sql).toMatch(/set loaded = false, in_game_ready = false/);
  });

  it('blocks arbitrary host writes to state and start_at_ms', () => {
    expect(sql).toMatch(/race_rooms_guard/);
    expect(sql).toMatch(/start_at_ms is server-authoritative/);
    expect(sql).toMatch(/race state is server-authoritative/);
  });

  it('guards report RPCs on membership and phase', () => {
    expect(sql).toMatch(/not a member of this room/);
    expect(sql).toMatch(/too late to report loaded/);
    expect(sql).toMatch(/too late to change in-game ready/);
  });

  it('forges the shared GO instant from the server clock', () => {
    expect(sql).toMatch(/race_server_now\(\)/);
    expect(sql).toMatch(/race_server_now\(\) \+ public\.race_countdown_lead_ms\(\)/);
  });
});
