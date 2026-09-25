/**
 * MASTERY CLOUD PERSISTENCE — equipped glove only.
 *
 * Mastery V1 stores NO glove ownership. Eligibility is derived on the client from
 * canonical official progress, so the ONLY thing that needs to survive a device
 * change is which glove the player is wearing.
 *
 * This covers:
 *   - the migration is additive and non-destructive
 *   - the old RPC signature is dropped (no ambiguous overload)
 *   - RLS policies are untouched
 *   - the client actually sends `p_equipped_glove`
 *   - hydration restores it, and rejects unknown / unearned values
 *   - existing progression parameters are unchanged
 *   - offline behaviour is unchanged
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { CloudProgression, LocalProgressionSnapshot } from '../src/online/CloudProgression';
import { OnlineClient } from '../src/online/supabaseClient';
import { AuthService } from '../src/online/AuthService';
import { MasteryGloveSystem } from '../src/mastery/MasteryGloveSystem';
import { DEFAULT_MASTERY_GLOVE_ID } from '../src/mastery/MasteryLadder';
import { SignalPackCatalog } from '../src/audio/SignalPackCatalog';

const repoRoot = path.resolve(__dirname, '..');
const MIGRATIONS = path.join(repoRoot, 'supabase', 'migrations');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const migrationName = '20260925000000_mastery_equipped_glove.sql';
const migrationWithComments = read(`supabase/migrations/${migrationName}`);

/**
 * The migration MINUS its comments, so structural assertions inspect real SQL
 * statements rather than the prose that documents them.
 */
const migration = migrationWithComments
  .split('\n')
  .map((line) => {
    const idx = line.indexOf('--');
    return idx >= 0 ? line.slice(0, idx) : line;
  })
  .join('\n');

// ---------------------------------------------------------------------------
// 1. The migration itself
// ---------------------------------------------------------------------------

describe('Mastery cloud migration — shape', () => {
  it('is a new, ordered migration file', () => {
    const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
    expect(files).toContain(migrationName);
    expect(files[files.length - 1]).toBe(migrationName);
  });

  it('adds the column additively with a safe default', () => {
    expect(migration).toMatch(
      /alter table public\.player_progress\s+add column if not exists equipped_glove text not null default 'STANDARD_ISSUE'/
    );
  });

  it('is non-destructive: nothing is dropped, truncated or rewritten', () => {
    expect(migration).not.toMatch(/drop column/i);
    expect(migration).not.toMatch(/drop table/i);
    expect(migration).not.toMatch(/truncate/i);
    expect(migration).not.toMatch(/delete from/i);
    // The ONLY drop is the superseded RPC signature.
    const drops = migration.match(/drop\s+\w+/gi) ?? [];
    expect(drops.map((d) => d.toLowerCase())).toEqual(['drop function']);
  });

  it('preserves every existing progression column and ledger', () => {
    // The rewritten RPC must still carry every ledger it carried before.
    for (const param of [
      'p_equipped_knife',
      'p_awarded_rank_keys',
      'p_pending_drop_ranks',
      'p_reward_owned_skin_ids',
      'p_custom_claims',
      'p_first_migration'
    ]) {
      expect(migration, param).toContain(param);
    }
    for (const column of [
      'equipped_knife',
      'awarded_rank_keys',
      'spent_drop_keys',
      'reward_owned_skin_ids',
      'progression_version',
      'migration_completed_at',
      'updated_at'
    ]) {
      expect(migration, column).toContain(column);
    }
  });

  it('stores NO glove ownership and NO eligibility', () => {
    // Only a single selection column may exist. No ownership array, no booleans.
    expect(migration).not.toMatch(/glove_owned|owned_glove|unlocked_glove|glove_unlocks/i);
    expect(migration).not.toMatch(/glove_ownership/i);
    // No NEW column of any other kind is introduced.
    const addColumns = migration.match(/add column[^;]*/gi) ?? [];
    expect(addColumns).toHaveLength(1);
    expect(addColumns[0]).toMatch(/equipped_glove text not null default 'STANDARD_ISSUE'/);
    expect(addColumns[0]).not.toMatch(/boolean/i);
  });

  it('drops the superseded RPC signature so no ambiguous overload remains', () => {
    expect(migration).toMatch(
      /drop function if exists public\.sync_progression\(text, text\[\], text\[\], text\[\], text\[\], boolean\)/
    );
    // ...and then recreates it with the glove parameter.
    expect(migration).toMatch(/create or replace function public\.sync_progression\(/);
    expect(migration).toMatch(/p_equipped_glove\s+text default null/);
  });

  it('leaves RLS correct: no policy is changed, added or removed', () => {
    expect(migration).not.toMatch(/create policy/i);
    expect(migration).not.toMatch(/drop policy/i);
    expect(migration).not.toMatch(/alter policy/i);
    expect(migration).not.toMatch(/disable row level security/i);
    // The migration documents that the existing owner-scoped policies still cover it.
    expect(migrationWithComments).toMatch(/progress_update_self/);
  });

  it('keeps the RPC SECURITY DEFINER with a pinned search_path', () => {
    expect(migration).toMatch(/security definer/);
    expect(migration).toMatch(/set search_path = public/);
  });

  it('sanitises the glove value and never lets it grant anything', () => {
    expect(migration).toMatch(/v_glove\s*:= case/);
    expect(migration).toMatch(/length\(p_equipped_glove\) > 64/);
    // Merged exactly like the knife: an empty value never clears the stored one.
    expect(migration).toMatch(
      /equipped_glove\s+= coalesce\(v_glove, v_row\.equipped_glove\)/
    );
  });

  it('mirrors the existing equipped_knife handling exactly', () => {
    const base = read('supabase/migrations/20260922000000_online_v1.sql');
    const knifeMerge = /equipped_knife\s+= coalesce\(nullif\(p_equipped_knife, ''\), v_row\.equipped_knife\)/;
    expect(base).toMatch(knifeMerge);
    // Same shape, with the sanitised value.
    expect(migration).toMatch(/equipped_knife\s+= coalesce\(nullif\(p_equipped_knife, ''\), v_row\.equipped_knife\)/);
  });
});

// ---------------------------------------------------------------------------
// 2. The client actually sends and restores it
// ---------------------------------------------------------------------------

interface CapturedRpc {
  fn: string;
  params: Record<string, unknown>;
}

function makeProgression(options: {
  row?: Record<string, unknown> | null;
  error?: { message: string } | null;
  offline?: boolean;
}): { progression: CloudProgression; captured: CapturedRpc[] } {
  const captured: CapturedRpc[] = [];
  const client = {
    rpc: async (fn: string, params: Record<string, unknown>) => {
      captured.push({ fn, params });
      return { data: options.row ?? null, error: options.error ?? null };
    },
    functions: { invoke: async () => ({ data: null, error: null }) }
  };
  const onlineClient = OnlineClient.__createWithClientForTests(
    (options.offline ? null : client) as never
  );
  const auth = new AuthService(onlineClient);
  (auth as unknown as { currentProfile: { id: string; displayName: string } }).currentProfile = {
    id: 'user-1',
    displayName: 'PLAYER-A7F2'
  };
  return { progression: new CloudProgression(onlineClient, auth), captured };
}

describe('Mastery cloud persistence — client', () => {
  const CATALOG_IDS = SignalPackCatalog.getTracks().map((t) => t.id);

  beforeEach(() => {
    const system = MasteryGloveSystem.getInstance();
    system.resetForTests();
    // Give the player a genuinely earned glove so persistence is meaningful.
    (system as unknown as { getProgress: () => unknown }).getProgress = () => ({
      trackIds: CATALOG_IDS,
      ranks: Object.fromEntries(CATALOG_IDS.map((id) => [id, 'GOLD']))
    });
  });

  afterEach(() => {
    const system = MasteryGloveSystem.getInstance();
    system.resetForTests();
  });

  it('sends the equipped glove alongside the existing parameters', async () => {
    const system = MasteryGloveSystem.getInstance();
    expect(system.equipGlove('GOLDLINE')).toBe(true);

    const { progression, captured } = makeProgression({ row: null });
    await progression.sync();

    expect(captured).toHaveLength(1);
    expect(captured[0].fn).toBe('sync_progression');
    expect(captured[0].params.p_equipped_glove).toBe('GOLDLINE');
  });

  it('keeps every pre-existing parameter unchanged', async () => {
    const { progression, captured } = makeProgression({ row: null });
    await progression.sync();

    const params = captured[0].params;
    for (const key of [
      'p_equipped_knife',
      'p_awarded_rank_keys',
      'p_pending_drop_ranks',
      'p_reward_owned_skin_ids',
      'p_custom_claims',
      'p_first_migration'
    ]) {
      expect(params, key).toHaveProperty(key);
    }
    expect(Array.isArray(params.p_awarded_rank_keys)).toBe(true);
    expect(Array.isArray(params.p_reward_owned_skin_ids)).toBe(true);
  });

  it('the snapshot carries the equipped glove', () => {
    const system = MasteryGloveSystem.getInstance();
    system.equipGlove('GOLDLINE');
    const { progression } = makeProgression({ row: null });
    const snapshot: LocalProgressionSnapshot = progression.snapshotLocal();
    expect(snapshot.equippedGloveId).toBe('GOLDLINE');
  });

  it('restores the equipped glove from the cloud row', async () => {
    // A different device starts on the default glove.
    expect(MasteryGloveSystem.getInstance().getEquippedGloveId()).toBe(DEFAULT_MASTERY_GLOVE_ID);

    const { progression } = makeProgression({ row: { equipped_glove: 'GOLDLINE' } });
    await progression.sync();

    expect(MasteryGloveSystem.getInstance().getEquippedGloveId()).toBe('GOLDLINE');
  });

  it('rejects an unknown glove from the cloud and falls back safely', async () => {
    const { progression } = makeProgression({ row: { equipped_glove: 'TOTALLY_MADE_UP' } });
    await progression.sync();
    expect(MasteryGloveSystem.getInstance().getEquippedGloveId()).toBe(DEFAULT_MASTERY_GLOVE_ID);
  });

  it('rejects a glove the player has NOT earned', async () => {
    // Fresh player with no progress at all.
    const system = MasteryGloveSystem.getInstance();
    system.resetForTests();
    (system as unknown as { getProgress: () => unknown }).getProgress = () => ({
      trackIds: CATALOG_IDS,
      ranks: {}
    });

    const { progression } = makeProgression({ row: { equipped_glove: 'SIGNAL_MASTER' } });
    await progression.sync();

    // A cloud value can never invent an achievement.
    expect(system.getEquippedGloveId()).toBe(DEFAULT_MASTERY_GLOVE_ID);
    expect(system.isSatisfied('SIGNAL_MASTER')).toBe(false);
  });

  it('a missing cloud field leaves the local glove alone', async () => {
    MasteryGloveSystem.getInstance().equipGlove('GOLDLINE');
    const { progression } = makeProgression({ row: { equipped_knife: 'ASTRAL' } });
    await progression.sync();
    expect(MasteryGloveSystem.getInstance().getEquippedGloveId()).toBe('GOLDLINE');
  });

  it('reconnecting does not duplicate or lose anything', async () => {
    MasteryGloveSystem.getInstance().equipGlove('GOLDLINE');
    const { progression } = makeProgression({ row: { equipped_glove: 'GOLDLINE' } });
    await progression.sync();
    await progression.sync();
    await progression.sync();
    expect(MasteryGloveSystem.getInstance().getEquippedGloveId()).toBe('GOLDLINE');
  });

  it('offline behaviour is unchanged: no RPC, no crash, local glove intact', async () => {
    MasteryGloveSystem.getInstance().equipGlove('GOLDLINE');
    const { progression, captured } = makeProgression({ offline: true });
    const result = await progression.sync();
    expect(result).toBe('OFFLINE');
    expect(captured).toHaveLength(0);
    // Local persistence is untouched by being offline.
    expect(MasteryGloveSystem.getInstance().getEquippedGloveId()).toBe('GOLDLINE');
  });

  it('an RPC error does not change the local glove', async () => {
    MasteryGloveSystem.getInstance().equipGlove('GOLDLINE');
    const { progression } = makeProgression({ error: { message: 'boom' } });
    const result = await progression.sync();
    expect(result).toBe('ERROR');
    expect(MasteryGloveSystem.getInstance().getEquippedGloveId()).toBe('GOLDLINE');
  });
});
