import { describe, expect, it } from 'vitest';
import { LeaderboardPanel } from '../src/ui/LeaderboardPanel';
import type { LeaderboardEntry } from '../src/online/LeaderboardService';

function harness() {
  const panel = Object.create(LeaderboardPanel.prototype) as any;
  Object.assign(panel, {
    currentEntries: [], statusElem: { textContent: '' },
    tableElem: { innerHTML: '', scrollTop: 120, querySelectorAll: () => [] },
    youElem: { innerHTML: '', querySelectorAll: () => [] },
  });
  const entry = { runId: 'old-run', displayName: 'Player', timeUs: 40000000 } as LeaderboardEntry;
  panel.setEntries([entry]);
  return { panel: panel as LeaderboardPanel, entry, table: panel.tableElem };
}

describe('leaderboard replay cache lifecycle', () => {
  it('retains entries primed by the results screen until a new board loads', () => {
    const { panel, entry, table } = harness();
    expect(panel.getEntryByRunId('old-run')).toBe(entry);
    panel.setLoading('Another signal');
    expect(panel.getEntryByRunId('old-run')).toBeUndefined();
    expect(table.scrollTop).toBe(0);
  });
  it('drops stale replay entries on an offline response', () => {
    const { panel } = harness();
    panel.render({ trackId: 'track', entries: [], you: null, nextAbove: null, offline: true }, 'Track');
    expect(panel.getEntryByRunId('old-run')).toBeUndefined();
  });
  it('replaces cached entries when an empty online board arrives', () => {
    const { panel } = harness();
    panel.render({ trackId: 'track', entries: [], you: null, nextAbove: null, offline: false }, 'Track');
    expect(panel.getEntryByRunId('old-run')).toBeUndefined();
  });
});
