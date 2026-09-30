import { it, expect, vi } from 'vitest';
import { AuthService } from '../src/online/AuthService';
import { OnlineClient } from '../src/online/supabaseClient';

it('does not apply an old anonymous identity response to a newly signed-in account', async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise(r => { resolve = r; });
  const client = OnlineClient.__createWithClientForTests({
    functions: { invoke: () => pending }
  } as never);
  const auth = new AuthService(client);
  const internal = auth as unknown as { currentProfile: { id: string; displayName: string } };
  internal.currentProfile = { id: 'anonymous', displayName: 'PLAYER' };
  const getUsername = vi.spyOn(auth, 'getUsername').mockReturnValue('ACCOUNT_B');
  const cache = vi.spyOn(auth as never, 'cacheUsername' as never);
  const refresh = auth.refreshAccountIdentity();
  internal.currentProfile = { id: 'account-B', displayName: 'ACCOUNT_B' };
  resolve({ data: { ok: true, username: '' }, error: null });
  expect(await refresh).toBe('ACCOUNT_B');
  expect(cache).not.toHaveBeenCalled();
  getUsername.mockRestore();
  cache.mockRestore();
});
