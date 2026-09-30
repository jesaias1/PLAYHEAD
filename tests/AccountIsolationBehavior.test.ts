import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CloudProgression } from '../src/online/CloudProgression';
import { OnlineClient } from '../src/online/supabaseClient';
import { AuthService } from '../src/online/AuthService';
import { KarambitSkinSystem } from '../src/viewmodel/KarambitSkinSystem';
import { MasteryGloveSystem } from '../src/mastery/MasteryGloveSystem';

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

interface RpcCall { fn: string; params: Record<string, unknown>; }

/**
 * Minimal Supabase-style read query. The authoritative loadout hydration does
 * `from(table).select(...).eq(...)` (awaited for list reads) and
 * `.maybeSingle()` for player_progress, so the mock must be BOTH thenable and
 * expose maybeSingle — otherwise hydration throws and the whole sync aborts.
 */
function makeReadQuery() {
  const result = Promise.resolve({ data: [] as unknown[], error: null });
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: null, error: null }),
    then: (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      result.then(onFulfilled, onRejected),
    catch: (onRejected: (e: unknown) => unknown) => result.catch(onRejected),
    finally: (onFinally: () => void) => result.finally(onFinally)
  };
  return query;
}

function makeCloud(opts: { uid: string | null; registered?: boolean; failFn?: string }) {
  const calls: RpcCall[] = [];
  const client = {
    rpc: async (fn: string, params: Record<string, unknown>) => {
      calls.push({ fn, params });
      if (opts.failFn && fn === opts.failFn) return { data: null, error: { message: 'boom' } };
      return { data: null, error: null };
    },
    from: () => makeReadQuery(),
    functions: { invoke: async () => ({ data: null, error: null }) }
  };
  const onlineClient = OnlineClient.__createWithClientForTests(client as never);
  const auth = new AuthService(onlineClient);
  if (opts.uid) {
    (auth as unknown as { currentProfile: { id: string; displayName: string } }).currentProfile = { id: opts.uid, displayName: 'P' };
  }
  if (opts.registered) {
    vi.spyOn(auth, 'isRegisteredAccount').mockReturnValue(true);
  } else {
    vi.spyOn(auth, 'isRegisteredAccount').mockReturnValue(false);
  }
  const cloud = new CloudProgression(onlineClient, auth);
  return { cloud, auth, calls };
}

describe('Account isolation (per-uid)', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: createLocalStorageMock(), configurable: true, writable: true });
    (KarambitSkinSystem as any).instance = null;
  });
  afterEach(() => {
    (KarambitSkinSystem as any).instance = null;
    vi.restoreAllMocks();
  });

  it('scopes the migration marker per uid (account A does not mark B)', async () => {
    const a = makeCloud({ uid: 'uid-A', registered: true });
    await a.cloud.sync();
    expect(a.cloud.hasMigrated()).toBe(true);
    const b = makeCloud({ uid: 'uid-B', registered: true });
    expect(b.cloud.hasMigrated()).toBe(false);
  });

  it('keys the offline queue per uid', () => {
    const a = makeCloud({ uid: 'uid-A', registered: true });
    a.cloud.enqueue({ kind: 'custom_claim', fingerprint: 'fp-A', at: 1 });
    expect(a.cloud.getQueueLength()).toBe(1);
    const b = makeCloud({ uid: 'uid-B', registered: true });
    expect(b.cloud.getQueueLength()).toBe(0);
  });

  it('retains a failed queue operation instead of discarding it', async () => {
    const a = makeCloud({ uid: 'uid-A', registered: true, failFn: 'grant_progression_events' });
    a.cloud.enqueue({ kind: 'custom_claim', fingerprint: 'fp-ready', at: 1 });
    const applied = await a.cloud.flushQueue();
    expect(applied).toBe(0);
    expect(a.cloud.getQueueLength()).toBe(1);
  });

  it('dequeues a successful operation', async () => {
    const a = makeCloud({ uid: 'uid-A', registered: true });
    a.cloud.enqueue({ kind: 'custom_claim', fingerprint: 'fp-ok', at: 1 });
    const applied = await a.cloud.flushQueue();
    expect(applied).toBe(1);
    expect(a.cloud.getQueueLength()).toBe(0);
  });

  it('a second registered account does NOT inherit the first account progression', async () => {
    const a = makeCloud({ uid: 'uid-A', registered: true });
    KarambitSkinSystem.getInstance().applyCloudProgression({ rewardOwnedSkinIds: ['ASTRAL'] });
    await a.cloud.sync();
    expect(KarambitSkinSystem.getInstance().isSkinRewardOwned('ASTRAL')).toBe(true);
    // Switch to a DIFFERENT registered account.
    const b = makeCloud({ uid: 'uid-B', registered: true });
    await b.cloud.sync();
    expect(KarambitSkinSystem.getInstance().isSkinRewardOwned('ASTRAL')).toBe(false);
  });

  it('merges pre-account guest data into the FIRST account only', async () => {
    const guest = makeCloud({ uid: null, registered: false });
    KarambitSkinSystem.getInstance().applyCloudProgression({ rewardOwnedSkinIds: ['ASTRAL'] });
    guest.cloud.captureGuestStateIfNeeded();
    expect(guest.cloud.hasGuestBackup()).toBe(true);
    const a = makeCloud({ uid: 'uid-A', registered: true });
    await a.cloud.sync();
    expect(KarambitSkinSystem.getInstance().isSkinRewardOwned('ASTRAL')).toBe(true);
    const b = makeCloud({ uid: 'uid-B', registered: true });
    await b.cloud.sync();
    expect(KarambitSkinSystem.getInstance().isSkinRewardOwned('ASTRAL')).toBe(false);
  });

  it('signOutLocalState restores the guest baseline', async () => {
    const guest = makeCloud({ uid: null, registered: false });
    KarambitSkinSystem.getInstance().applyCloudProgression({ rewardOwnedSkinIds: ['ASTRAL'] });
    guest.cloud.captureGuestStateIfNeeded();
    const a = makeCloud({ uid: 'uid-A', registered: true });
    await a.cloud.sync();
    KarambitSkinSystem.getInstance().applyCloudProgression({ rewardOwnedSkinIds: ['SIGNAL_VIOLET'] });
    a.cloud.signOutLocalState();
    expect(KarambitSkinSystem.getInstance().isSkinRewardOwned('SIGNAL_VIOLET')).toBe(false);
    expect(KarambitSkinSystem.getInstance().isSkinRewardOwned('ASTRAL')).toBe(true);
  });

  it('preserves equipment selected while a cloud save is in flight', async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise(r => { resolve = r; });
    const client = OnlineClient.__createWithClientForTests({ rpc: () => pending } as never);
    const auth = new AuthService(client);
    (auth as unknown as { currentProfile: { id: string; displayName: string } }).currentProfile = {
      id: 'uid-A', displayName: 'P'
    };
    vi.spyOn(auth, 'isRegisteredAccount').mockReturnValue(false);
    const cloud = new CloudProgression(client, auth);
    const saving = cloud.sync();
    const skins = KarambitSkinSystem.getInstance();
    skins.applyCloudProgression({ rewardOwnedSkinIds: ['ASTRAL'] });
    expect(skins.equipSkin('ASTRAL')).toBe(true);
    resolve({ data: { equipped_knife: 'SIGNAL_CYAN', equipped_glove: 'STANDARD_ISSUE',
      reward_owned_skin_ids: ['ASTRAL'], awarded_rank_keys: [], pending_drop_ranks: [] }, error: null });
    await saving;
    expect(skins.getEquippedSkinId()).toBe('ASTRAL');
  });
});
