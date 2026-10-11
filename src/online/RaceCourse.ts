import { PresetLevelCache } from '../audio/PresetLevelCache';
import { SignalPackCatalog } from '../audio/SignalPackCatalog';
import { TrackGenerator } from '../generation/TrackGenerator';
import { computeMapIdentity } from './MapIdentity';
import { computeSurfMapIdentity } from './SurfMapIdentity';
export type RaceMode = 'NORMAL' | 'SURF';
export function raceBaseTrackId(id: string): string { return id.startsWith('surf:') ? id.split(':')[1] ?? '' : id; }
export function raceMode(id: string): RaceMode { return id.startsWith('surf:') ? 'SURF' : 'NORMAL'; }
export function nextRaceTrackId(id: string): string | null {
  const tracks = SignalPackCatalog.getTracks();
  const index = tracks.findIndex(t => t.id === raceBaseTrackId(id));
  return index < 0 || !tracks.length ? null : tracks[(index + 1) % tracks.length].id;
}
/** One canonical loader for host, guest, lobby verification and race world. */
export async function loadRaceCourse(id: string, mode: RaceMode = raceMode(id)) {
  const baseId = raceBaseTrackId(id);
  if (!SignalPackCatalog.getTrackById(baseId)) return null;
  const level = await PresetLevelCache.loadPreset(baseId);
  if (!level) return null;
  const track = mode === 'SURF' ? TrackGenerator.generate(level.analysis, 'SURF') : level.track;
  const identity = mode === 'SURF' ? computeSurfMapIdentity(baseId, track, level.analysis) : computeMapIdentity(baseId, track, level.analysis);
  if (id.startsWith('surf:') && id !== identity.trackId) return null;
  return { ...level, track, identity, baseId, mode, title: (SignalPackCatalog.getTrackById(baseId)?.title ?? baseId) + (mode === 'SURF' ? ' // SURF' : '') };
}
