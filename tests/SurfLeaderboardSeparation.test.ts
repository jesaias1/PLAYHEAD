
/**
 * SURF LEADERBOARD SEPARATION — a surf record can never mix with a normal one.
 *
 * Verifies that the SURF registry and the NORMAL registry are DISJOINT, that a
 * surf identity only verifies against the SURF registry, and that the board id
 * is namespaced and reproducible from the same deterministic inputs.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

import { SignalPackCatalog } from '../src/audio/SignalPackCatalog';
import { PresetLevelCache } from '../src/audio/PresetLevelCache';
import { TrackGenerator } from '../src/generation/TrackGenerator';
import { computeMapIdentity, verifyAgainstRegistry } from '../src/online/MapIdentity';
import { OFFICIAL_MAP_REGISTRY } from '../src/online/OfficialMapRegistry';
import { Game } from '../src/core/Game';
import { leaderboardService } from '../src/online/LeaderboardService';
import { ACCEPTED_SURF_MAPS } from '../supabase/functions/submit-run/accepted-surf-maps';
import {
  computeSurfMapIdentity,
  surfBoardTrackId,
  SURF_MAP_REGISTRY
} from '../src/online/SurfMapIdentity';

const PRESET_DIR = path.resolve(__dirname, '../public/music/presets');

function loadFresh(trackId: string) {
  const raw = readFileSync(path.join(PRESET_DIR, `${trackId}.json`), 'utf8');
  return PresetLevelCache.buildLevelData(JSON.parse(raw) as Record<string, unknown>);
}

describe('SURF leaderboard separation', () => {
  it('ships identical canonical identities to the client and submission server', () => {
    expect(ACCEPTED_SURF_MAPS).toEqual(SURF_MAP_REGISTRY.map(({ trackId, mapVersion, mapFingerprint, movementVersion }) => ({ trackId, mapVersion, mapFingerprint, movementVersion })));
  });
  it('loads a Surf board independently of the loaded audio and discards a late Normal view', async () => {
    const trackId = SignalPackCatalog.getTracks()[0].id;
    const level = loadFresh(trackId);
    const preset = vi.spyOn(PresetLevelCache, 'loadPreset').mockResolvedValue(level);
    const view = { trackId: '', entries: [], you: null, nextAbove: null, offline: false };
    const fetch = vi.spyOn(leaderboardService, 'fetchLeaderboard').mockResolvedValue(view);
    let kind = 'SURF';
    const panel = { getSelectedTrack: () => trackId, getBoardKind: () => kind, setLoading: vi.fn(), render: vi.fn() };
    const host = Object.assign(Object.create(Game.prototype), {
      ui: { importScreen: { leaderboardPanel: panel } },
      audioEngine: { getBuffer: () => ({ duration: 1 }) }
    });
    try {
      await host.refreshLeaderboard(trackId, 'SURF');
      expect(fetch.mock.calls[0][0]).toMatch(/^surf:/);
      expect(panel.render).toHaveBeenCalledWith(view, expect.stringContaining('SURF'));
      panel.render.mockClear();
      kind = 'NORMAL';
      let release!: (value: typeof view) => void;
      fetch.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
      const pending = host.refreshLeaderboard(trackId, 'NORMAL');
      await Promise.resolve();
      kind = 'SURF';
      release(view);
      await pending;
      expect(panel.render).not.toHaveBeenCalled();
    } finally { preset.mockRestore(); fetch.mockRestore(); }
  });
  it('uses namespaced surf ids disjoint from the normal registry', () => {
    const normalIds = new Set(OFFICIAL_MAP_REGISTRY.map((e) => e.trackId));
    for (const entry of SURF_MAP_REGISTRY) {
      expect(entry.trackId.startsWith('surf:')).toBe(true);
      expect(normalIds.has(entry.trackId)).toBe(false);
    }
    // A bare official id is never a surf board id.
    for (const id of normalIds) expect(id.startsWith('surf:')).toBe(false);
  });

  it('a surf identity only verifies against the surf registry', () => {
    const trackId = SignalPackCatalog.getTracks()[0].id;
    const level = loadFresh(trackId);
    const surfTrack = TrackGenerator.generate(level.analysis, 'SURF');
    const surfIdentity = computeSurfMapIdentity(trackId, surfTrack, level.analysis);

    // Namespaced board id and namespaced registry verify.
    const surfVerdict = verifyAgainstRegistry(surfIdentity, SURF_MAP_REGISTRY);
    expect(surfVerdict.ok).toBe(true);

    // The surf identity must NEVER verify as a normal map.
    const normalVerdict = verifyAgainstRegistry(surfIdentity, OFFICIAL_MAP_REGISTRY);
    expect(normalVerdict.ok).toBe(false);
  });

  it('a normal identity does not verify against the surf registry', () => {
    const trackId = SignalPackCatalog.getTracks()[0].id;
    const level = loadFresh(trackId);
    const normalIdentity = computeMapIdentity(trackId, level.track, level.analysis);
    expect(verifyAgainstRegistry(normalIdentity, SURF_MAP_REGISTRY).ok).toBe(false);
  });

  it('board id is deterministic and embeds the fingerprint', () => {
    const trackId = SignalPackCatalog.getTracks()[0].id;
    const level = loadFresh(trackId);
    const surfTrack = TrackGenerator.generate(level.analysis, 'SURF');
    const a = computeSurfMapIdentity(trackId, surfTrack, level.analysis);
    const b = computeSurfMapIdentity(trackId, surfTrack, level.analysis);
    expect(a.trackId).toBe(b.trackId);
    expect(a.trackId).toBe(surfBoardTrackId(trackId, a.mapFingerprint));
    expect(a.trackId).toContain(a.mapFingerprint);
  });
});
