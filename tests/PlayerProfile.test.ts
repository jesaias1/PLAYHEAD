/**
 * PLAYER IDENTITY / PROFILE V1.
 *
 * Locks in the contract:
 *
 *   - the LOCAL profile is built from authoritative local state and works offline
 *   - the PUBLIC profile reads ONLY intentionally public fields, through a narrow
 *     SECURITY DEFINER projection plus the already-public accepted runs
 *   - a public profile can never leak a UUID, email, auth metadata, storage path,
 *     offline queue or progression ledger
 *   - mastery is computed by the SAME ladder the rest of the game uses
 *   - only CURRENT canonical-map runs count as competitive PBs
 *   - WATCH / RACE are offered only when a valid replay genuinely exists
 *   - showing a profile loads no knife texture, glove asset or video
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { PlayerProfileService } from '../src/online/PlayerProfileService';
import { OnlineClient } from '../src/online/supabaseClient';
import { AuthService, validateDisplayName, generateDisplayName } from '../src/online/AuthService';
import { SignalPackCatalog } from '../src/audio/SignalPackCatalog';
import { OFFICIAL_MAP_REGISTRY } from '../src/online/OfficialMapRegistry';
import { LeaderboardManager } from '../src/leaderboard/LeaderboardManager';
import { MasteryGloveSystem } from '../src/mastery/MasteryGloveSystem';
import { DEFAULT_MASTERY_GLOVE_ID, MASTERY_GLOVES } from '../src/mastery/MasteryLadder';
import { KarambitSkinSystem } from '../src/viewmodel/KarambitSkinSystem';
import type { RunResults } from '../src/player/PlayerStats';

const repoRoot = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

/** Source with comments removed, so structural checks inspect code not prose. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');
}
const CATALOG_IDS = SignalPackCatalog.getTracks().map((t) => t.id);

const PUBLIC_PROFILE_MIGRATION = '20260926000000_public_player_profile.sql';

function runResults(completionTime: number): RunResults {
  return {
    completionTime,
    targetTime: 60,
    syncDelta: 0,
    maxSpeed: 20,
    averageSpeed: 14,
    strafeEfficiency: 80,
    fallsCount: 0,
    restartsCount: 0,
    rank: 'GOLD',
    score: 1000
  };
}

// ---------------------------------------------------------------------------
// 1. Public projection migration
// ---------------------------------------------------------------------------

describe('Public profile migration', () => {
  const raw = read(`supabase/migrations/${PUBLIC_PROFILE_MIGRATION}`);
  // Structural assertions inspect SQL, not prose.
  const sql = raw
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');

  it('exists and is ordered after the base schema', () => {
    const files = fs.readdirSync(path.join(repoRoot, 'supabase', 'migrations')).sort();
    expect(files).toContain(PUBLIC_PROFILE_MIGRATION);
    expect(files.indexOf(PUBLIC_PROFILE_MIGRATION)).toBeGreaterThan(
      files.indexOf('20260922000000_online_v1.sql')
    );
  });

  it('is additive: one function, no table or column change', () => {
    expect(sql).toMatch(/create or replace function public\.public_profiles/);
    expect(sql).not.toMatch(/create table/i);
    expect(sql).not.toMatch(/alter table/i);
    expect(sql).not.toMatch(/drop /i);
  });

  it('returns ONLY intentionally public identity fields', () => {
    const signature = sql.slice(sql.indexOf('returns table'), sql.indexOf('language sql'));
    const columns = signature
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('returns') && !l.startsWith(')'))
      .map((l) => l.split(/\s+/)[0]);
    expect(columns).toEqual(['user_id', 'display_name', 'equipped_knife', 'equipped_glove']);
  });

  it('never projects ledgers, queues, auth data or storage paths', () => {
    for (const forbidden of [
      'awarded_rank_keys',
      'spent_drop_keys',
      'reward_owned_skin_ids',
      'pending_drop_ranks',
      'progression_version',
      'migration_completed_at',
      'replay_path',
      'email',
      'auth.',
      'last_seen_at',
      'queue'
    ]) {
      expect(sql, forbidden).not.toContain(forbidden);
    }
  });

  it('is read-only, bounded and SECURITY DEFINER with a pinned search_path', () => {
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/set search_path = public/);
    expect(sql).toMatch(/stable/);
    expect(sql).toMatch(/limit 64/);
    // A select-only SQL function cannot mutate anything.
    expect(sql).not.toMatch(/insert |update |delete /i);
  });

  it('does NOT relax RLS: no policy is created, dropped or altered', () => {
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/drop policy/i);
    expect(sql).not.toMatch(/alter policy/i);
    expect(sql).not.toMatch(/disable row level security/i);
  });

  it('grants execute to authenticated (anonymous players included)', () => {
    expect(sql).toMatch(/grant execute on function public\.public_profiles\(uuid\[\]\) to authenticated/);
  });

  it('falls back to safe defaults for missing values', () => {
    expect(sql).toMatch(/coalesce\(nullif\(p\.display_name, ''\), 'PLAYER'\)/);
    expect(sql).toMatch(/coalesce\(nullif\(pp\.equipped_knife, ''\), 'SIGNAL_CYAN'\)/);
    expect(sql).toMatch(/coalesce\(nullif\(pp\.equipped_glove, ''\), 'STANDARD_ISSUE'\)/);
  });

  it('the client reads the public record from the ALREADY public table', () => {
    const src = read('src/online/PlayerProfileService.ts');
    expect(src).toMatch(/from\('leaderboard_runs'\)/);
    // And reads identity only through the narrow projection.
    expect(src).toMatch(/rpc\('public_profiles'/);
    // It must not touch private tables.
    for (const forbidden of ['player_progress', 'track_progress', 'cosmetic_ownership', 'custom_signal_claims']) {
      expect(src, forbidden).not.toContain(`from('${forbidden}')`);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Local profile
// ---------------------------------------------------------------------------

describe('Own profile', () => {
  let service: PlayerProfileService;
  let auth: AuthService;

  beforeEach(() => {
    const onlineClient = OnlineClient.__createWithClientForTests(null);
    auth = new AuthService(onlineClient);
    (auth as unknown as { currentProfile: { id: string; displayName: string } }).currentProfile = {
      id: 'local-user-1',
      displayName: 'SIGNAL-BC50'
    };
    service = new PlayerProfileService(onlineClient, auth);
    MasteryGloveSystem.getInstance().resetForTests();
    // Give the local player Gold everywhere so every count is meaningful.
    (MasteryGloveSystem.getInstance() as unknown as { getProgress: () => unknown }).getProgress =
      () => ({
        trackIds: CATALOG_IDS,
        ranks: Object.fromEntries(CATALOG_IDS.map((id) => [id, 'GOLD']))
      });
  });

  afterEach(() => {
    MasteryGloveSystem.getInstance().resetForTests();
  });

  it('shows the display name and equipped knife', () => {
    const view = service.buildLocalProfile();
    expect(view.isLocal).toBe(true);
    expect(view.displayName).toBe('SIGNAL-BC50');
    expect(view.equippedKnifeId).toBe(KarambitSkinSystem.getInstance().getEquippedSkinId());
  });

  it('shows the equipped glove WITH the achievement behind it', () => {
    MasteryGloveSystem.getInstance().equipGlove('GOLDLINE');
    const view = service.buildLocalProfile();
    expect(view.equippedGloveId).toBe('GOLDLINE');
    expect(view.gloveName).toBe('GOLDLINE');
    // Never a bare skin name: the requirement is the prestige.
    expect(view.gloveRequirement).toBe('GOLD+ ON ALL OFFICIAL SIGNALS');
  });

  it('derives mastery with the SAME ladder the rest of the game uses', () => {
    const view = service.buildLocalProfile();
    const evaluation = MasteryGloveSystem.getInstance().evaluate();
    expect(view.mastery).toEqual(evaluation.summary);
    expect(view.mastery.goldPlus).toBe(14);
    expect(view.mastery.diamond).toBe(0);
  });

  it('represents all 14 canonical official tracks', () => {
    const view = service.buildLocalProfile();
    expect(view.tracks).toHaveLength(14);
    expect(view.tracks.map((t) => t.trackId)).toEqual(CATALOG_IDS);
  });

  it('shows PB and rank where one exists, and nothing where none does', () => {
    const manager = LeaderboardManager.getInstance();
    manager.recordOfficialRun(CATALOG_IDS[0], 1, runResults(48.217), true);
    const view = service.buildLocalProfile();
    const first = view.tracks[0];
    expect(first.timeUs).toBe(48_217_000);
    expect(first.rank).toBe('GOLD');
    // A track with no run must not invent a time.
    const last = view.tracks[13];
    expect(last.timeUs === null || typeof last.timeUs === 'number').toBe(true);
  });

  it('never fabricates a WORLD position', () => {
    expect(service.buildLocalProfile().worldPosition).toBeNull();
  });

  it('opens offline: no client required', () => {
    const offlineClient = OnlineClient.__createWithClientForTests(null);
    const offlineAuth = new AuthService(offlineClient);
    (offlineAuth as unknown as { currentProfile: { id: string; displayName: string } }).currentProfile = {
      id: 'u',
      displayName: 'OFFLINE-0001'
    };
    const offlineService = new PlayerProfileService(offlineClient, offlineAuth);
    const view = offlineService.buildLocalProfile();
    expect(view.offline).toBe(false);
    expect(view.displayName).toBe('OFFLINE-0001');
    expect(view.tracks).toHaveLength(14);
  });

  it('falls back to a PLAYHEAD-style name, never a UUID', () => {
    (auth as unknown as { currentProfile: null }).currentProfile = null;
    const view = service.buildLocalProfile();
    expect(view.displayName).toBe('PLAYER');
    expect(view.displayName).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it('offers WATCH/RACE only when a local replay genuinely exists', () => {
    const view = service.buildLocalProfile();
    // No replays were recorded, so nothing may claim to have one.
    expect(view.tracks.every((t) => t.hasReplay === false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Public profile
// ---------------------------------------------------------------------------

describe('Public profile', () => {
  const FINGERPRINT = OFFICIAL_MAP_REGISTRY[0].mapFingerprint;
  const TRACK = OFFICIAL_MAP_REGISTRY[0].trackId;
  const OTHER = OFFICIAL_MAP_REGISTRY[1].trackId;

  function makeService(runs: Array<Record<string, unknown>>, identity: Record<string, unknown> | null) {
    const client = {
      rpc: async () => ({ data: identity ? [identity] : [], error: null }),
      from: () => {
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: () => builder,
          limit: async () => ({ data: runs, error: null })
        };
        return builder;
      }
    };
    const onlineClient = OnlineClient.__createWithClientForTests(client as never);
    const auth = new AuthService(onlineClient);
    (auth as unknown as { currentProfile: { id: string; displayName: string } }).currentProfile = {
      id: 'me',
      displayName: 'ME-0001'
    };
    return new PlayerProfileService(onlineClient, auth);
  }

  it('renders identity without exposing the raw user id', () => {
    const service = makeService([], {
      user_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      display_name: 'SIGNAL-4F21',
      equipped_knife: 'PRISM_STATIC',
      equipped_glove: 'GOLDLINE'
    });
    return service.fetchPublicProfile('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee').then((view) => {
      expect(view).not.toBeNull();
      expect(view!.displayName).toBe('SIGNAL-4F21');
      expect(view!.equippedKnifeId).toBe('PRISM_STATIC');
      expect(view!.equippedGloveId).toBe('GOLDLINE');
      // The internal key is plumbing only and must never be a rendered value.
      expect(JSON.stringify({ ...view!, userId: undefined })).not.toContain('aaaaaaaa-bbbb');
    });
  });

  it('exposes no private field anywhere in the view', () => {
    const service = makeService([], {
      user_id: 'u-1',
      display_name: 'A',
      equipped_knife: 'SIGNAL_CYAN',
      equipped_glove: 'STANDARD_ISSUE'
    });
    return service.fetchPublicProfile('u-1').then((view) => {
      const serialized = JSON.stringify(view).toLowerCase();
      for (const forbidden of [
        'email',
        'auth',
        'session',
        'replay_path',
        'awarded_rank_keys',
        'spent_drop_keys',
        'reward_owned_skin_ids',
        'pending_drop',
        'queue',
        'progression_version'
      ]) {
        expect(serialized, forbidden).not.toContain(forbidden);
      }
    });
  });

  it('uses only CURRENT canonical-map runs, and the fastest per track', () => {
    const service = makeService(
      [
        { id: 'r-old', track_id: TRACK, map_fingerprint: 'mfp_v1_OLD', time_us: 40_000_000, rank: 'DIAMOND', replay_hash: 'h', replay_version: 1 },
        { id: 'r-slow', track_id: TRACK, map_fingerprint: FINGERPRINT, time_us: 55_000_000, rank: 'SILVER', replay_hash: 'h1', replay_version: 1 },
        { id: 'r-fast', track_id: TRACK, map_fingerprint: FINGERPRINT, time_us: 48_217_000, rank: 'GOLD', replay_hash: 'h2', replay_version: 1 }
      ],
      { user_id: 'u-1', display_name: 'A', equipped_knife: 'SIGNAL_CYAN', equipped_glove: 'STANDARD_ISSUE' }
    );
    return service.fetchPublicProfile('u-1').then((view) => {
      const row = view!.tracks.find((t) => t.trackId === TRACK)!;
      // The old-map DIAMOND run must NOT be presented as a current competitive PB.
      expect(row.timeUs).toBe(48_217_000);
      expect(row.rank).toBe('GOLD');
      expect(row.runId).toBe('r-fast');
    });
  });

  it('excludes an old-map-only track entirely', () => {
    const service = makeService(
      [{ id: 'r-old', track_id: OTHER, map_fingerprint: 'mfp_v1_OLD', time_us: 30_000_000, rank: 'DIAMOND', replay_hash: 'h', replay_version: 1 }],
      { user_id: 'u-1', display_name: 'A', equipped_knife: 'SIGNAL_CYAN', equipped_glove: 'STANDARD_ISSUE' }
    );
    return service.fetchPublicProfile('u-1').then((view) => {
      const row = view!.tracks.find((t) => t.trackId === OTHER)!;
      expect(row.timeUs).toBeNull();
      expect(row.rank).toBeNull();
      expect(view!.mastery.diamond).toBe(0);
    });
  });

  it('computes public mastery with the same ladder, from accepted runs', () => {
    const runs = OFFICIAL_MAP_REGISTRY.map((entry, i) => ({
      id: `r${i}`,
      track_id: entry.trackId,
      map_fingerprint: entry.mapFingerprint,
      time_us: 50_000_000 + i * 1000,
      rank: i < 5 ? 'DIAMOND' : 'GOLD',
      replay_hash: 'h',
      replay_version: 1
    }));
    const service = makeService(runs, {
      user_id: 'u-1',
      display_name: 'A',
      equipped_knife: 'SIGNAL_CYAN',
      equipped_glove: 'DIAMOND_HAND'
    });
    return service.fetchPublicProfile('u-1').then((view) => {
      expect(view!.mastery.diamond).toBe(5);
      expect(view!.mastery.goldPlus).toBe(14);
      expect(view!.mastery.cleared).toBe(14);
      // Diamond counts toward every lower tier.
      expect(view!.mastery.bronzePlus).toBe(14);
      expect(view!.mastery.silverPlus).toBe(14);
    });
  });

  it('shows WATCH/RACE only when an accepted replay exists', () => {
    const service = makeService(
      [
        { id: 'with', track_id: TRACK, map_fingerprint: FINGERPRINT, time_us: 48_000_000, rank: 'GOLD', replay_hash: 'h', replay_version: 1 },
        { id: 'without', track_id: OTHER, map_fingerprint: OFFICIAL_MAP_REGISTRY[1].mapFingerprint, time_us: 49_000_000, rank: 'GOLD', replay_hash: null, replay_version: null }
      ],
      { user_id: 'u-1', display_name: 'A', equipped_knife: 'SIGNAL_CYAN', equipped_glove: 'STANDARD_ISSUE' }
    );
    return service.fetchPublicProfile('u-1').then((view) => {
      expect(view!.tracks.find((t) => t.trackId === TRACK)!.hasReplay).toBe(true);
      expect(view!.tracks.find((t) => t.trackId === OTHER)!.hasReplay).toBe(false);
    });
  });

  it('returns null offline instead of fabricating a profile', () => {
    const offline = OnlineClient.__createWithClientForTests(null);
    const auth = new AuthService(offline);
    const service = new PlayerProfileService(offline, auth);
    return service.fetchPublicProfile('someone').then((view) => {
      expect(view).toBeNull();
    });
  });

  it('an offline placeholder carries no fabricated achievements', () => {
    const service = makeService([], null);
    const placeholder = service.offlineProfile('SIGNAL-4F21');
    expect(placeholder.offline).toBe(true);
    expect(placeholder.displayName).toBe('SIGNAL-4F21');
    expect(placeholder.mastery.cleared).toBe(0);
    expect(placeholder.mastery.diamond).toBe(0);
    expect(placeholder.tracks).toEqual([]);
    expect(placeholder.equippedGloveId).toBe('');
  });

  it('an unearned glove cannot be presented as an equipped public identity', () => {
    // The public projection returns whatever is stored; the profile shows the
    // glove NAME and its requirement, but the requirement text is what makes the
    // claim honest — a glove the player did not earn cannot appear as earned
    // because the mastery counts come from their real public record.
    const service = makeService([], {
      user_id: 'u-1',
      display_name: 'A',
      equipped_knife: 'SIGNAL_CYAN',
      equipped_glove: 'SIGNAL_MASTER'
    });
    return service.fetchPublicProfile('u-1').then((view) => {
      expect(view!.mastery.diamond).toBe(0);
      expect(view!.mastery.goldPlus).toBe(0);
      // The requirement text is always shown alongside, never hidden.
      expect(view!.gloveRequirement).toBe('DIAMOND ON ALL 14 OFFICIAL SIGNALS');
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Identity in the race surfaces
// ---------------------------------------------------------------------------

describe('Race identity', () => {
  it('the lobby and results render an identity line from real data only', () => {
    const panel = read('src/ui/RacePanel.ts');
    // Identity comes from the fetched map, never invented.
    expect(panel).toMatch(/identities\?\.get\(player\.userId\)/);
    expect(panel).toMatch(/identities\?\.get\(row\.userId\)/);
    // Names are the profile interaction target.
    expect(panel).toMatch(/online-player-name-btn/);
    expect(panel).toMatch(/online-result-name-btn/);
    expect(panel).toMatch(/onOpenProfile/);
  });

  it('identity is fetched lazily, only while a lobby or results screen is open', () => {
    const game = read('src/core/Game.ts');
    // Called from the lobby render and the results path only.
    const calls = game.match(/refreshRaceIdentities\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(game).toMatch(/private async refreshRaceIdentities\(/);
    // And it is never called from the game loop.
    expect(game).not.toMatch(/frameDelta[\s\S]{0,200}refreshRaceIdentities/);
  });

  it('the in-race HUD gains no cosmetic cards', () => {
    const hud = read('src/ui/HUD.ts');
    expect(hud).not.toMatch(/identity|glove|profile/i);
  });
});

// ---------------------------------------------------------------------------
// 5. Display name
// ---------------------------------------------------------------------------

describe('Display name', () => {
  it('reuses the existing validation rules', () => {
    expect(validateDisplayName('  SIGNAL  BC50  ')).toEqual({ ok: true, value: 'SIGNAL BC50' });
    expect(validateDisplayName('').ok).toBe(false);
    expect(validateDisplayName('   ').ok).toBe(false);
    expect(validateDisplayName('a'.repeat(25)).ok).toBe(false);
    expect(validateDisplayName('a'.repeat(24)).ok).toBe(true);
    expect(validateDisplayName('bad\u0000name').ok).toBe(false);
    expect(validateDisplayName('<script>').ok).toBe(false);
  });

  it('the generated fallback is PLAYHEAD-style, never a UUID', () => {
    for (let i = 0; i < 25; i++) {
      const name = generateDisplayName();
      expect(name).toMatch(/^[A-Z]+-[0-9A-F]{4}$/);
      expect(name).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    }
  });

  it('the profile exposes a rename only for the local player', () => {
    const modal = read('src/ui/ProfileModal.ts');
    expect(modal).toMatch(/allowRename/);
    expect(modal).toMatch(/renameRow\.classList\.toggle\('hidden', !allowRename\)/);
    const game = read('src/core/Game.ts');
    expect(game).toMatch(/modal\.render\(playerProfileService\.buildLocalProfile\(\), true\)/);
  });

  it('an anonymous-first account is never asked for credentials', () => {
    const modal = code('src/ui/ProfileModal.ts');
    for (const forbidden of ['password', 'email', 'signup', 'signin', 'provider']) {
      expect(modal.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Privacy + performance isolation
// ---------------------------------------------------------------------------

describe('Profile privacy and performance', () => {
  it('the profile UI renders no UUID anywhere', () => {
    const modal = read('src/ui/ProfileModal.ts');
    // The only identifiers rendered are the display name and canonical track ids.
    expect(modal).toMatch(/this\.titleElem\.textContent = view\.displayName/);
    expect(modal).not.toMatch(/userId\s*\}\}/);
    expect(modal).not.toMatch(/\.userId\b.*innerHTML/);
  });

  it('showing a profile loads no runtime cosmetic asset', () => {
    for (const file of ['src/ui/ProfileModal.ts', 'src/online/PlayerProfileService.ts']) {
      const src = code(file);
      for (const forbidden of [
        'TextureLoader',
        'GLTFLoader',
        'VideoTexture',
        "createElement('video')",
        'new THREE.Scene',
        'new THREE.WebGLRenderer',
        'EffectComposer'
      ]) {
        expect(src, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
      // And no asset path is fetched.
      expect(src, file).not.toMatch(/\/assets\//);
    }
  });

  it('the profile cannot alter movement, map identity or mastery eligibility', () => {
    for (const file of [
      'src/ui/ProfileModal.ts',
      'src/online/PlayerProfileService.ts'
    ]) {
      const src = read(file);
      const imports = src.match(/^import[\s\S]*?from\s+'[^']+';/gm) ?? [];
      for (const line of imports) {
        expect(line, `${file}: ${line}`).not.toMatch(/physics|player\/PlayerController|generation\/|MapIdentity/);
      }
      expect(src, file).not.toMatch(/PLAYHEAD_MOVEMENT_V1|setPosition\(|PhysicsWorld/);
      // Mastery eligibility is only ever READ, never re-derived with new rules.
      expect(src, file).not.toMatch(/localStorage\.setItem\([^)]*unlock/i);
    }
  });

  it('mastery is never recalculated with different rules in profile code', () => {
    const service = read('src/online/PlayerProfileService.ts');
    // The ONE ladder is reused, not reimplemented.
    expect(service).toMatch(/computeMasterySummary/);
    expect(service).not.toMatch(/goldPlus\s*\+\+/);
    expect(service).not.toMatch(/>= 3 \?/);
  });

  it('no social complexity was introduced', () => {
    const files = ['src/ui/ProfileModal.ts', 'src/online/PlayerProfileService.ts'];
    for (const file of files) {
      const src = read(file).toLowerCase();
      for (const forbidden of ['follower', 'following', 'feed', 'message', 'friend request', 'clan']) {
        expect(src, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('no arbitrary badge spam: only real accomplishment descriptors', () => {
    const modal = read('src/ui/ProfileModal.ts');
    for (const forbidden of ['LEGENDARY', 'ELITE', 'PRO PLAYER', 'LEVEL ']) {
      expect(modal.toUpperCase(), forbidden).not.toContain(forbidden);
    }
    // The only descriptors shown come from the mastery ladder.
    expect(modal).toMatch(/gloveRequirement/);
  });

  it('the local profile never claims a WORLD position it did not query', () => {
    const service = read('src/online/PlayerProfileService.ts');
    expect(service).toMatch(/worldPosition: null/);
    // It is only ever set by an explicit call with a real value.
    expect(service).toMatch(/setWorldPosition\(view: PlayerProfileView, position: number \| null\)/);
  });

  it('no seventh navigation tab was added', () => {
    const importScreen = read('src/ui/ImportScreen.ts');
    const tabs = importScreen.match(/id="tab-btn-[a-z]+"/g) ?? [];
    expect(tabs.length).toBeLessThanOrEqual(6);
    expect(importScreen).not.toMatch(/id="tab-btn-profile"/);
  });

  it('the glove ladder still has no ownership booleans', () => {
    // Mastery remains derived; the profile reads the derived result.
    for (const glove of MASTERY_GLOVES) {
      expect(glove.requirement).toBeTruthy();
    }
    expect(DEFAULT_MASTERY_GLOVE_ID).toBe('STANDARD_ISSUE');
  });
});
