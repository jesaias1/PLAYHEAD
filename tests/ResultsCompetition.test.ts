import { afterEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../src/core/Game';
import { GameState, StateMachine } from '../src/core/StateMachine';
import { leaderboardService, type LeaderboardView } from '../src/online/LeaderboardService';
import { authService } from '../src/online/AuthService';
import { LeaderboardManager } from '../src/leaderboard/LeaderboardManager';

const trackId = 'track_1_signal_drift';
const identity = { trackId, mapVersion: 1, mapFingerprint: 'test', movementVersion: 'test' };
const board = (): LeaderboardView => ({
  trackId, offline: false, you: { position: 2, timeUs: 44_809_000, displayName: 'YOU' },
  entries: [], nextAbove: {
    trackId, rankPosition: 1, timeUs: 44_112_000, displayName: 'RANKO & CO',
    rank: 'DIAMOND', runId: 'accepted-run', userId: 'rival', createdAt: '',
    verificationState: 'accepted', replayVersion: 1, replayPath: 'replay', replayHash: 'hash'
  }
});
function host() {
  const game = Object.create(Game.prototype) as any;
  game.resultBoardToken = 0;
  game.currentOfficialTrackId = trackId;
  game.friendRaceWorld = false;
  game.stateMachine = new StateMachine(GameState.FINISHED);
  game.ui = { resultsScreen: { element: { classList: { contains: () => false } }, setCompetitionContext: vi.fn() },
    importScreen: { leaderboardPanel: { setEntries: vi.fn() } } };
  return game;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => vi.restoreAllMocks());

describe('results competition lifecycle', () => {
  it('submits the finished attempt snapshot and ignores its response after retry', async () => {
    const game = host(), upload = deferred<{ ok: boolean; path: string; hash: string }>();
    const recordGhost = vi.fn().mockReturnValue(false);
    vi.spyOn(LeaderboardManager, 'getInstance').mockReturnValue({ recordGhostReplay: recordGhost } as any);
    vi.spyOn(authService, 'getUserId').mockReturnValue('player');
    const submit = vi.spyOn(leaderboardService, 'submitRun').mockResolvedValue({
      ok: true, isPersonalBest: true,
    } as any);
    game.ui.resultsScreen.setSubmissionState = vi.fn();
    game.ui.resultsScreen.refreshSignalDropPanel = vi.fn();
    game.fullMapIdentity = () => identity;
    game.pendingReplayUpload = upload.promise;
    game.lastFinalizedReplay = { finishTimeUs: 10_000_000 };
    game.passedCheckpoints = new Set([1, 2]);
    game.movementLab = null;
    game.isOvertime = false;
    const pending = game.submitOfficialRun({ completionTime: 10, rank: 'BRONZE', restartsCount: 0 }, {});
    game.invalidateResultCompetition();
    game.passedCheckpoints.clear();
    game.lastFinalizedReplay = { finishTimeUs: 20_000_000 };
    game.movementLab = {};
    upload.resolve({ ok: true, path: 'finished-replay', hash: 'finished-hash' });
    await pending;
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ checkpointCount: 2, devMode: false }));
    expect(recordGhost).toHaveBeenCalledWith(trackId, 10_000_000, 'finished-replay', 'finished-hash', identity.mapFingerprint);
    expect(game.ui.resultsScreen.setSubmissionState.mock.calls).toEqual([['SUBMITTING', undefined]]);
    expect(game.ui.resultsScreen.refreshSignalDropPanel).toHaveBeenCalledTimes(1);
  });
  it('rejects an old same-track submission before fetching after a newer finish', async () => {
    const game = host(), submission = deferred<void>();
    const fetch = vi.spyOn(leaderboardService, 'fetchLeaderboard').mockResolvedValue(board());
    game.invalidateResultCompetition();
    const captured = game.resultBoardToken;
    const old = submission.promise.then(() => game.refreshResultCompetition(trackId, identity, captured));
    game.invalidateResultCompetition(); // retry
    game.invalidateResultCompetition(); // another finish on the SAME track
    submission.resolve();
    await old;
    expect(fetch).not.toHaveBeenCalled();
  });
  it('discards an old in-flight board after the newer same-track board is shown', async () => {
    const game = host(), delayed = deferred<LeaderboardView>();
    vi.spyOn(leaderboardService, 'fetchLeaderboard').mockReturnValueOnce(delayed.promise).mockResolvedValueOnce(board());
    game.invalidateResultCompetition();
    const old = game.refreshResultCompetition(trackId, identity, game.resultBoardToken);
    game.invalidateResultCompetition();
    await game.refreshResultCompetition(trackId, identity, game.resultBoardToken);
    const calls = game.ui.resultsScreen.setCompetitionContext.mock.calls.length;
    delayed.resolve({ ...board(), you: { position: 24, timeUs: 60_000_000, displayName: 'OLD' } });
    await old;
    expect(game.ui.resultsScreen.setCompetitionContext.mock.calls).toHaveLength(calls);
    expect(game.ui.resultsScreen.setCompetitionContext).toHaveBeenLastCalledWith(expect.objectContaining({ position: 2 }));
  });
  it.each(['hidden', 'race', 'custom', 'playing'])('does not fetch competition for %s', async mode => {
    const game = host();
    if (mode === 'hidden') game.ui.resultsScreen.element.classList.contains = () => true;
    if (mode === 'race') game.friendRaceWorld = true;
    if (mode === 'custom') game.currentOfficialTrackId = null;
    if (mode === 'playing') game.stateMachine = new StateMachine(GameState.PLAYING);
    const fetch = vi.spyOn(leaderboardService, 'fetchLeaderboard');
    await game.refreshResultCompetition(trackId, identity, 0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['offline', 'guest'])('hides unavailable %s context', async mode => {
    const game = host(), view = board();
    if (mode === 'offline') view.offline = true;
    else view.you = null;
    vi.spyOn(leaderboardService, 'fetchLeaderboard').mockResolvedValue(view);
    await game.refreshResultCompetition(trackId, identity, 0);
    expect(game.ui.resultsScreen.setCompetitionContext).toHaveBeenLastCalledWith(null);
  });
  it('supplies accepted board PB and target times with their real gap', async () => {
    const game = host();
    vi.spyOn(leaderboardService, 'fetchLeaderboard').mockResolvedValue(board());
    await game.refreshResultCompetition(trackId, identity, 0);
    expect(game.ui.resultsScreen.setCompetitionContext).toHaveBeenLastCalledWith({
      position: 2, timeUs: 44_809_000,
      nextAbove: { rankPosition: 1, displayName: 'RANKO & CO', timeUs: 44_112_000,
        gapUs: 697_000, runId: 'accepted-run', raceable: true }
    });
  });
  it.each([
    { replayVersion: null }, { replayVersion: 999 }, { replayPath: null },
    { replayHash: null }, { verificationState: 'pending' }, { runId: '' }
  ])('does not offer a broken ghost with metadata %j', async patch => {
    const game = host(), view = board();
    Object.assign(view.nextAbove!, patch);
    vi.spyOn(leaderboardService, 'fetchLeaderboard').mockResolvedValue(view);
    await game.refreshResultCompetition(trackId, identity, 0);
    expect(game.ui.resultsScreen.setCompetitionContext).toHaveBeenLastCalledWith(
      expect.objectContaining({ nextAbove: expect.objectContaining({ raceable: false }) }));
  });
  it('omits a target with an invalid time instead of displaying a fabricated zero gap', async () => {
    const game = host(), view = board();view.nextAbove!.timeUs = NaN;
    vi.spyOn(leaderboardService, 'fetchLeaderboard').mockResolvedValue(view);
    await game.refreshResultCompetition(trackId, identity, 0);
    expect(game.ui.resultsScreen.setCompetitionContext).toHaveBeenLastCalledWith(expect.objectContaining({ nextAbove: null }));
  });
  it('hides an invalid accepted PB and never arms a solo ghost during Online Race', async () => {
    const game = host(), view = board();view.you!.timeUs = NaN;
    vi.spyOn(leaderboardService, 'fetchLeaderboard').mockResolvedValue(view);
    await game.refreshResultCompetition(trackId, identity, 0);
    expect(game.ui.resultsScreen.setCompetitionContext).toHaveBeenLastCalledWith(null);
    game.friendRaceWorld = true;game.raceLeaderboardGhost = vi.fn();
    expect((await game.raceLeaderboardGhostAndPlay('target')).ok).toBe(false);
    expect(game.raceLeaderboardGhost).not.toHaveBeenCalled();
  });
  it('uses the existing world loader and enters countdown only on successful READY', async () => {
    const game = host();game.stateMachine = new StateMachine(GameState.READY);
    game.raceLeaderboardGhost = vi.fn().mockResolvedValueOnce({ ok: false, detail: 'REPLAY UNAVAILABLE' }).mockResolvedValueOnce({ ok: true, detail: 'VERIFIED' });
    expect((await game.raceLeaderboardGhostAndPlay('target')).ok).toBe(false);
    expect(game.stateMachine.getState()).toBe(GameState.READY);
    expect((await game.raceLeaderboardGhostAndPlay('target')).ok).toBe(true);
    expect(game.stateMachine.getState()).toBe(GameState.COUNTDOWN);
  });
});
