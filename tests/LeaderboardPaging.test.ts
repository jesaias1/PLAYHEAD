import { expect, it, vi } from 'vitest';
import { LeaderboardService } from '../src/online/LeaderboardService';
import { OnlineClient } from '../src/online/supabaseClient';
import { AuthService } from '../src/online/AuthService';
import { LeaderboardPanel } from '../src/ui/LeaderboardPanel';
const identity = { trackId: 'signal', mapVersion: 5, mapFingerprint: 'fingerprint', movementVersion: 'movement' };
function backend(replies: unknown[]) {
  const calls: unknown[][] = [];
  const client = { from: (table: string) => {
    const response = replies.shift(); const q: any = {};
    for (const method of ['select', 'eq', 'order', 'range', 'limit', 'lt', 'maybeSingle']) q[method] = (...args: unknown[]) => { calls.push([table, method, ...args]); return q; };
    q.then = (resolve: any, reject: any) => Promise.resolve(response).then(resolve, reject); return q;
  } };
  const online = OnlineClient.__createWithClientForTests(client as any);
  const auth = new AuthService(online); vi.spyOn(auth, 'getUserId').mockReturnValue('me');
  return { service: new LeaderboardService(online, auth), calls };
}
it.each(['signal', 'surf:signal'])('pages %s with canonical filters and stable tie order, finding PB beyond page', async trackId => {
  const { service, calls } = backend([
    { data: [{ id: 'r26', time_us: 100, user_id: 'other' }], count: 53, error: null },
    { data: { id: 'my-pb', display_name: 'Me', time_us: 200 }, error: null },
    { count: 35, error: null }, { count: 1, error: null }
  ]);
  const view = await service.fetchLeaderboard(trackId, identity, 25, 25);
  expect(view).toMatchObject({ offline: false, page: 1, pageSize: 25, total: 53, you: { position: 37, runId: 'my-pb' } });
  expect(view.entries[0].rankPosition).toBe(26);
  expect(calls).toContainEqual(['leaderboard_runs', 'range', 25, 49]);
  expect(calls.filter(c => c[1] === 'eq' && c[2] === 'track_id')).toHaveLength(4);
  for (const c of calls.filter(c => c[1] === 'eq' && c[2] === 'track_id')) expect(c[3]).toBe(trackId);
  expect(calls).toContainEqual(['leaderboard_runs', 'eq', 'map_fingerprint', 'fingerprint']);
  expect(calls).toContainEqual(['leaderboard_runs', 'lt', 'id', 'my-pb']);
});
it('preserves the board when a rank count fails without inventing a position', async () => {
  const { service } = backend([{ data: [], count: 53 }, { data: { id: 'pb', time_us: 200 } }, { error: Error() }, { count: 1 }]);
  const view = await service.fetchLeaderboard('signal', identity);
  expect(view.offline).toBe(false); expect(view.you?.position).toBeNull();
});
it('settles a failed query into an unavailable board for retry', async () => {
  const { service } = backend([{ error: Error('offline') }]);
  expect(await service.fetchLeaderboard('signal', identity)).toMatchObject({ offline: true, entries: [] });
});
it('find-me requests the correct page before highlighting the best run', () => {
  const panel: any = Object.create(LeaderboardPanel.prototype), callback = vi.fn(), focus = vi.fn(), scrollIntoView = vi.fn();
  Object.assign(panel, { page: 0, view: { you: { position: 37 }, pageSize: 25 }, boardKind: 'SURF', selectElem: { value: 'signal' }, callbacks: { onSelectBoard: callback }, tableElem: { querySelector: () => ({ focus, scrollIntoView }) } });
  panel.findMe(); expect(panel.getPage()).toBe(1); expect(callback).toHaveBeenCalledWith('signal', 'SURF'); expect(focus).not.toHaveBeenCalled();
  panel.findMe(); expect(focus).toHaveBeenCalledWith({ preventScroll: true });
});
