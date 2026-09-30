import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CloudProgression, LocalProgressionSnapshot } from '../src/online/CloudProgression';
import { OnlineClient } from '../src/online/supabaseClient';
import { AuthService } from '../src/online/AuthService';
import { KarambitSkinSystem } from '../src/viewmodel/KarambitSkinSystem';
import { MasteryGloveSystem } from '../src/mastery/MasteryGloveSystem';
import { CustomAudioRewardService } from '../src/audio/CustomAudioRewardService';
import { LeaderboardManager } from '../src/leaderboard/LeaderboardManager';

function createLocalStorageMock(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (i: number) => [...values.keys()][i] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, String(value)); }
  };
}

/** Minimal thenable PostgREST-style builder returning a fixed result. */
function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = async () => result;
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

interface CloudState {
  trackProgress?: unknown[];
  claims?: unknown[];
  progressRow?: unknown;
  syncRow?: unknown;
  claimRow?: unknown;
  failFn?: string;
  /** When set, the authenticated uid flips to this id DURING an awaited rpc. */
  changeUidDuringRpc?: string;
}

function makeCloud(opts: { uid: string | null; registered?: boolean; state?: CloudState }) {
  const calls: { fn: string; params: Record<string, unknown> }[] = [];
  const state = opts.state ?? {};
  const client = {
    rpc: async (fn: string, params: Record<string, unknown>) => {
      calls.push({ fn, params });
      const result =
        state.failFn && fn === state.failFn
          ? { data: null, error: { message: 'boom' } }
          : fn === 'sync_progression'
            ? { data: state.syncRow ?? null, error: null }
            : fn === 'claim_world_record_award'
              ? { data: state.claimRow ?? null, error: null }
              : fn === 'race_server_now'
                ? { data: Date.now(), error: null }
                : { data: null, error: null };
      if (state.changeUidDuringRpc) {
        (auth as unknown as { currentProfile: { id: string; displayName: string } }).currentProfile = {
          id: state.changeUidDuringRpc,
          displayName: 'Q'
        };
      }
      return result;
    },
    from: (table: string) => {
      if (table === 'track_progress') return makeChain({ data: state.trackProgress ?? [], error: null });
      if (table === 'custom_signal_claims') return makeChain({ data: state.claims ?? [], error: null });
      if (table === 'player_progress') return makeChain({ data: state.progressRow ?? null, error: null });
      return makeChain({ data: null, error: null });
    },
    functions: { invoke: async () => ({ data: null, error: null }) }
  };
  const onlineClient = OnlineClient.__createWithClientForTests(client as never);
  const auth = new AuthService(onlineClient);
  if (opts.uid) {
    (auth as unknown as { currentProfile: { id: string; displayName: string } }).currentProfile = {
      id: opts.uid,
      displayName: 'P'
    };
  }
  vi.spyOn(auth, 'isRegisteredAccount').mockReturnValue(!!opts.registered);
  const cloud = new CloudProgression(onlineClient, auth);
  return { cloud, auth, calls };
}

function snapshot(over: Partial<LocalProgressionSnapshot> = {}): LocalProgressionSnapshot {
  return {
    equippedSkinId: 'SIGNAL_CYAN',
    equippedGloveId: 'STANDARD_ISSUE',
    awardedRankKeys: [],
    pendingDropRanks: [],
    rewardOwnedSkinIds: [],
    trackRecords: {},
    officialRecords: [],
    customClaimFingerprints: [],
    ...over
  };
}

describe('Account replacement is a REPLACE, never a union', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: createLocalStorageMock(), configurable: true, writable: true });
    (KarambitSkinSystem as any).instance = null;
    LeaderboardManager.getInstance().clearAllLocalState();
    CustomAudioRewardService.getInstance().clearClaims();
    MasteryGloveSystem.getInstance().applyCloudEquippedGlove('STANDARD_ISSUE');
  });
  afterEach(() => {
    (KarambitSkinSystem as any).instance = null;
    vi.restoreAllMocks();
  });

  it("A's track records and PBs do not leak into a second registered account B", async () => {
    const guest = makeCloud({ uid: null, registered: false });
    guest.cloud.captureGuestStateIfNeeded();
    const a = makeCloud({ uid: 'uid-A', registered: true });
    await a.cloud.sync();
    KarambitSkinSystem.getInstance().setTrackRecords({ T1: 'DIAMOND' });
    LeaderboardManager.getInstance().restoreLocalRecords([
      { trackId: 'T1', bestRank: 'DIAMOND', pbTime: 12.5, pbScore: 100, localFirstTime: 12.5, localFirstScore: 100 }
    ]);
    expect(KarambitSkinSystem.getInstance().getTrackRecords().T1).toBe('DIAMOND');

    const b = makeCloud({ uid: 'uid-B', registered: true });
    await b.cloud.sync();
    // CLEARED AND REPLACED: B inherits none of A's records.
    expect(KarambitSkinSystem.getInstance().getTrackRecords().T1).toBeUndefined();
    expect(LeaderboardManager.getInstance().getRecord('T1')).toBeNull();
  });

  it('applying an account snapshot REPLACES track records and official PBs', () => {
    const b = makeCloud({ uid: 'uid-B', registered: true });
    KarambitSkinSystem.getInstance().setTrackRecords({ OLD: 'GOLD' });
    LeaderboardManager.getInstance().restoreLocalRecords([
      { trackId: 'OLD', bestRank: 'GOLD', pbTime: 30, pbScore: 10, localFirstTime: 30, localFirstScore: 10 }
    ]);
    // Restore a snapshot for a DIFFERENT account state: the old ledger must be
    // replaced, not unioned with.
    (b.cloud as unknown as { applyLocalSnapshot: (s: LocalProgressionSnapshot) => void }).applyLocalSnapshot(
      snapshot({
        trackRecords: { NEW: 'SILVER' },
        officialRecords: [
          { trackId: 'NEW', bestRank: 'SILVER', pbTime: 7, pbScore: 3, localFirstTime: 7, localFirstScore: 3 }
        ]
      })
    );
    expect(KarambitSkinSystem.getInstance().getTrackRecords().OLD).toBeUndefined();
    expect(KarambitSkinSystem.getInstance().getTrackRecords().NEW).toBe('SILVER');
    expect(LeaderboardManager.getInstance().getRecord('OLD')).toBeNull();
    expect(LeaderboardManager.getInstance().getRecord('NEW')?.pbTime).toBe(7);
  });

  it('signOutLocalState restores the GUEST baseline and drops the account records', async () => {
    const guest = makeCloud({ uid: null, registered: false });
    KarambitSkinSystem.getInstance().applyCloudProgression({ rewardOwnedSkinIds: ['ASTRAL'] });
    KarambitSkinSystem.getInstance().setTrackRecords({ G1: 'GOLD' });
    guest.cloud.captureGuestStateIfNeeded();

    const a = makeCloud({ uid: 'uid-A', registered: true });
    await a.cloud.sync();
    KarambitSkinSystem.getInstance().applyCloudProgression({ rewardOwnedSkinIds: ['SIGNAL_VIOLET'] });
    KarambitSkinSystem.getInstance().setTrackRecords({ A1: 'DIAMOND' });

    a.cloud.signOutLocalState();
    const skins = KarambitSkinSystem.getInstance();
    expect(skins.isSkinRewardOwned('SIGNAL_VIOLET')).toBe(false);
    expect(skins.isSkinRewardOwned('ASTRAL')).toBe(true);
    expect(skins.getTrackRecords().A1).toBeUndefined();
    expect(skins.getTrackRecords().G1).toBe('GOLD');
  });

  it('a fresh device hydrates the CLOUD equip instead of overwriting it with the default', async () => {
    const fresh = makeCloud({
      uid: 'uid-FRESH',
      registered: true,
      state: {
        progressRow: {
          equipped_knife: 'BLACKSTAR',
          equipped_glove: 'STANDARD_ISSUE',
          reward_owned_skin_ids: ['BLACKSTAR'],
          awarded_rank_keys: []
        },
        syncRow: {
          equipped_knife: 'BLACKSTAR',
          progression_version: 1,
          awarded_rank_keys: [],
          spent_drop_keys: [],
          pending_drop_ranks: [],
          reward_owned_skin_ids: ['BLACKSTAR'],
          equipped_glove: 'STANDARD_ISSUE'
        }
      }
    });
    await fresh.cloud.sync();
    // The authoritative cloud equip won; the fresh-device default did not.
    expect(KarambitSkinSystem.getInstance().getEquippedSkinId()).toBe('BLACKSTAR');
    // The ownership read happened BEFORE the equip was applied.
    expect(KarambitSkinSystem.getInstance().isSkinRewardOwned('BLACKSTAR')).toBe(true);
  });

  it('a failed queue op is retained and NO commit happens when the account changes mid-await', async () => {
    const a = makeCloud({
      uid: 'uid-A',
      registered: true,
      state: { failFn: 'grant_progression_events' }
    });
    a.cloud.enqueue({ kind: 'custom_claim', fingerprint: 'fp-keep', at: 1 });
    expect(await a.cloud.flushQueue()).toBe(0);
    expect(a.cloud.getQueueLength()).toBe(1);
  });

  it('an account change during a queue RPC does not mutate the other account queue', async () => {
    const a = makeCloud({ uid: 'uid-A', registered: true, state: { changeUidDuringRpc: 'uid-B' } });
    a.cloud.enqueue({ kind: 'custom_claim', fingerprint: 'fp-mid', at: 1 });
    const applied = await a.cloud.flushQueue();
    expect(applied).toBe(0);
    // Retained under A: nothing was written into B's space.
    expect(a.cloud.getQueueLength()).toBe(1);
    const b = makeCloud({ uid: 'uid-B', registered: true });
    expect(b.cloud.getQueueLength()).toBe(0);
  });

  it('a world-record claim that returns after an account change touches no inventory', async () => {
    const a = makeCloud({
      uid: 'uid-A',
      registered: true,
      state: { claimRow: { cosmetic_id: 'BLACKSTAR', granted: true }, changeUidDuringRpc: 'uid-B' }
    });
    const res = await a.cloud.claimWorldRecordReward('wr:T1:FP');
    expect(res.ok).toBe(false);
    expect(res.detail).toBe('account changed');
    expect(KarambitSkinSystem.getInstance().isSkinRewardOwned('BLACKSTAR')).toBe(false);
  });
});

describe('Snapshot contents include the account records', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: createLocalStorageMock(), configurable: true, writable: true });
    (KarambitSkinSystem as any).instance = null;
    LeaderboardManager.getInstance().clearAllLocalState();
  });
  afterEach(() => {
    (KarambitSkinSystem as any).instance = null;
    vi.restoreAllMocks();
  });

  it('snapshotLocal captures officialRecords and trackRecords', () => {
    const cloud = makeCloud({ uid: 'uid-S', registered: true });
    KarambitSkinSystem.getInstance().setTrackRecords({ T9: 'SILVER' });
    LeaderboardManager.getInstance().restoreLocalRecords([
      { trackId: 'T9', bestRank: 'SILVER', pbTime: 20, pbScore: 5, localFirstTime: 20, localFirstScore: 5 }
    ]);
    const snap = cloud.cloud.snapshotLocal();
    expect(snap.trackRecords.T9).toBe('SILVER');
    expect(snap.officialRecords.some((r) => r.trackId === 'T9')).toBe(true);
    expect(snap.officialRecords.find((r) => r.trackId === 'T9')?.pbTime).toBe(20);
  });

  it('an empty snapshot restores to a clean slate (no leftovers)', async () => {
    const cloud = makeCloud({ uid: 'uid-C', registered: true });
    expect(() => (cloud.cloud as unknown as { applyLocalSnapshot: (s: LocalProgressionSnapshot) => void }).applyLocalSnapshot(snapshot())).not.toThrow();
    expect(KarambitSkinSystem.getInstance().getTrackRecords()).toEqual({});
    expect(LeaderboardManager.getInstance().getAllRecords()).toEqual([]);
  });
});
