import { afterEach, expect, it, vi } from 'vitest';
import { readMenuPreferences, saveMenuPreferences, matchesTrackFilter } from '../src/ui/MenuPreferences';
import { readLoadouts, writeLoadouts, validateLoadout } from '../src/ui/LoadoutPresets';
import type { ArmoryItem } from '../src/ui/ArmoryInventory';
afterEach(() => vi.unstubAllGlobals());
function storage(value = '{}') {
  const map = new Map([['playhead.menu.v1', value]]);
  vi.stubGlobal('localStorage', { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => map.set(k, v) });
  return map;
}
it('merges stored settings without losing the song or inventory filter', () => {
  storage(); saveMenuPreferences({ trackId: 'signal', ownership: 'owned' }); saveMenuPreferences({ mode: 'SURF' });
  expect(readMenuPreferences()).toMatchObject({ trackId: 'signal', ownership: 'owned', mode: 'SURF' });
});
it.each(['null', '[]', 'broken', '{"mode":"INVALID","slot":"knife","sort":7}'])('rejects malformed preference %s', value => {
  storage(value); expect(readMenuPreferences()).toMatchObject({ mode: 'SURF', slot: 'karambit', sort: 'rarity' });
});
it('keeps menus usable with blocked storage', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw Error(); }, setItem: () => { throw Error(); } });
  expect(() => saveMenuPreferences({ mode: 'SURF' })).not.toThrow();
  expect(readMenuPreferences().mode).toBe('SURF'); expect(readLoadouts()).toEqual([]);
  expect(writeLoadouts([])).toBe(false);
});
it('combines case insensitive search with tier and exact duration boundaries', () => {
  const track = { title: 'Signal Drift', artist: 'Artist', genre: 'Ambient', difficulty: 2, duration: 120 };
  expect(matchesTrackFilter(track, { search: ' AMBIENT ', difficulty: '2', duration: 'short' })).toBe(true);
  expect(matchesTrackFilter(track, { search: '', difficulty: '1', duration: '' })).toBe(false);
  expect(matchesTrackFilter(track, { search: 'missing', difficulty: '', duration: '' })).toBe(false);
  expect(matchesTrackFilter(track, { search: '', difficulty: '', duration: 'medium' })).toBe(false);
  expect(matchesTrackFilter({ ...track, duration: 180 }, { search: '', difficulty: '', duration: 'medium' })).toBe(true);
  expect(matchesTrackFilter({ ...track, duration: 181 }, { search: '', difficulty: '', duration: 'long' })).toBe(true);
});
it('bounds presets and refuses unowned or incorrect-slot cosmetics', () => {
  const map = storage();
  map.set('playhead.loadouts.v1', JSON.stringify([null, {}, { name: 'x'.repeat(33), knifeId: 'a', gloveId: 'b' }]));
  expect(readLoadouts()).toEqual([]);
  const preset = { name: 'Snow', knifeId: 'a', gloveId: 'b' };
  expect(writeLoadouts(Array.from({ length: 12 }, () => preset))).toBe(true);
  expect(readLoadouts()).toHaveLength(10);
  const items = [{ id: 'a', slot: 'karambit', owned: true }, { id: 'b', slot: 'gloves', owned: false }] as ArmoryItem[];
  expect(validateLoadout(preset, items)).toBe(false);
  items[1].owned = true; expect(validateLoadout(preset, items)).toBe(true);
  items[1].slot = 'karambit'; expect(validateLoadout(preset, items)).toBe(false);
});
