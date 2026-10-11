import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadRaceCourse, raceBaseTrackId, raceMode, nextRaceTrackId } from '../src/online/RaceCourse';
import { SignalPackCatalog } from '../src/audio/SignalPackCatalog';
import { PresetLevelCache } from '../src/audio/PresetLevelCache';
import { Game } from '../src/core/Game';
import { raceRoomService } from '../src/online/RaceRoomService';
afterEach(()=>vi.restoreAllMocks());
const tracks = SignalPackCatalog.getTracks();
function presets() { vi.spyOn(PresetLevelCache,'loadPreset').mockImplementation(async id=>PresetLevelCache.buildLevelData(JSON.parse(readFileSync(`public/music/presets/${id}.json`,'utf8')))); }
it('resolves the exact same official Surf course for host and guest and rejects stale identities',async()=>{
 presets(); const host=await loadRaceCourse(tracks[0].id,'SURF'); expect(host).not.toBeNull();
 const guest=await loadRaceCourse(host!.identity.trackId); expect(guest!.identity).toEqual(host!.identity);
 expect(host!.track.courseType).toBe('SURF'); expect(host!.baseId).toBe(tracks[0].id);
 expect(await loadRaceCourse(host!.identity.trackId+'stale')).toBeNull();
 const normal=await loadRaceCourse(tracks[0].id); expect(normal!.mode).toBe('NORMAL'); expect(normal!.identity.trackId).toBe(tracks[0].id);
 expect(normal!.identity.mapFingerprint).not.toBe(host!.identity.mapFingerprint);
});
it('next song follows catalog order and wraps, independently of variant',()=>{
 expect(nextRaceTrackId(tracks[0].id)).toBe(tracks[1].id);
 expect(nextRaceTrackId(`surf:${tracks.at(-1)!.id}:v1:fingerprint`)).toBe(tracks[0].id);
 expect(nextRaceTrackId('unknown')).toBeNull(); expect(raceMode('surf:x')).toBe('SURF'); expect(raceBaseTrackId('surf:x:v1:hash')).toBe('x');
});
function harness() {
 const panel={setRematchNote:vi.fn(),showError:vi.fn()};
 const game:any=Object.create(Game.prototype); Object.assign(game,{raceContinuationPending:false,ui:{importScreen:{racePanel:panel}},returnToRaceLobby:vi.fn()});
 return {game,panel};
}
it('keeps the room and Surf mode while resetting readiness through server rematch then selecting next song',async()=>{
 presets(); const course=await loadRaceCourse(tracks[0].id,'SURF');
 const old={id:'room',raceId:'old',state:'FINISHED',trackId:course!.identity.trackId}; const fresh={...old,raceId:'new',state:'LOBBY'};
 let current=old;vi.spyOn(raceRoomService,'getRoom').mockImplementation(()=>current as any);vi.spyOn(raceRoomService,'isHost').mockReturnValue(true);
 const reset=vi.spyOn(raceRoomService,'requestRematch').mockImplementation(async()=>{current=fresh;return {ok:true,detail:''};});
 const select=vi.spyOn(raceRoomService,'selectTrack').mockResolvedValue({ok:true,detail:''});const {game}=harness();
 await game.handleRaceNextSong();expect(reset).toHaveBeenCalledOnce();expect(select.mock.calls[0][0]).toContain(`surf:${tracks[1].id}:`);expect(game.returnToRaceLobby).toHaveBeenCalledOnce();expect(current.id).toBe(old.id);expect(game.raceContinuationPending).toBe(false);
});
it('guests and duplicate requests cannot advance the race',async()=>{
 vi.spyOn(raceRoomService,'getRoom').mockReturnValue({id:'room',raceId:'old',state:'FINISHED',trackId:tracks[0].id} as any);
 vi.spyOn(raceRoomService,'isHost').mockReturnValue(false);const reset=vi.spyOn(raceRoomService,'requestRematch');const {game}=harness();
 await game.handleRaceNextSong();expect(reset).not.toHaveBeenCalled();game.raceContinuationPending=true;await game.handleRaceNextSong();expect(reset).not.toHaveBeenCalled();
});
it('shows server reset failure and leaves the current track alone',async()=>{
 presets();vi.spyOn(raceRoomService,'getRoom').mockReturnValue({id:'room',raceId:'old',state:'FINISHED',trackId:tracks[0].id} as any);vi.spyOn(raceRoomService,'isHost').mockReturnValue(true);
 vi.spyOn(raceRoomService,'requestRematch').mockResolvedValue({ok:false,detail:'not enough players'});const select=vi.spyOn(raceRoomService,'selectTrack');const {game,panel}=harness();
 await game.handleRaceNextSong();expect(select).not.toHaveBeenCalled();expect(panel.showError).toHaveBeenCalledWith(expect.stringContaining('not enough players'));expect(game.raceContinuationPending).toBe(false);
});
