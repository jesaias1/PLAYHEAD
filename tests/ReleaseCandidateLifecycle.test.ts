/**
 * RELEASE CANDIDATE LIFECYCLE REGRESSIONS.
 *
 * Three concrete retry/replay lifecycle bugs, each pinned by a focused test:
 *
 *  1. FINISHED -> PLAYING must be a valid RETRY transition (the finish pipeline
 *     that produced the report must NOT re-run).
 *  2. A RETRY must begin a FRESH POV recording: the PLAYING transition skips
 *     recording while isQuickRestarting is set, so restartTrack() owns it. It
 *     must also clear the previous attempt's finalized replay so a stale WATCH
 *     payload is never advertised or attached to the new submission.
 *  3. WATCH REPLAY exits must return to the SAME report and must never re-run
 *     the finish pipeline (no duplicate PB / drop / world submission).
 *
 * These use a real Game prototype host with only the collaborators each method
 * touches, mirroring tests/ReplayProductionEntry.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { GameState, StateMachine } from '../src/core/StateMachine';
import { Game } from '../src/core/Game';
import { OnlineStatusBar } from '../src/ui/OnlineStatusBar';
import { ResultsScreen } from '../src/ui/ResultsScreen';
import { PovReplayRecorder } from '../src/replay/pov/PovReplayRecorder';
import { PovReplay, PovReplayIdentity } from '../src/replay/pov/PovReplayFormat';

const IDENTITY: PovReplayIdentity = {
  trackId: 'track_1_signal_drift',
  mapVersion: 1,
  mapFingerprint: 'mfp_v1_TESTFINGERPRINT',
  movementVersion: 'phmv1_TEST'
};

function fakeReplay(): PovReplay {
  return {
    replayVersion: 1,
    identity: { ...IDENTITY },
    finishTimeUs: 1_000_000,
    durationMs: 1_000,
    sampleHz: 60,
    fov: 90,
    startSongTimeMs: 0,
    s: [],
    events: [],
    cosmetic: { skinId: 'SIGNAL_CYAN' },
    hash: 'h'
  } as unknown as PovReplay;
}

describe('RETRY — state machine accepts a fresh attempt', () => {
  it('accepts FINISHED -> PLAYING', () => {
    const sm = new StateMachine(GameState.FINISHED);
    expect(sm.transitionTo(GameState.PLAYING)).toBe(true);
    expect(sm.getState()).toBe(GameState.PLAYING);
  });

  it('still accepts FINISHED -> REPLAY and PLAYING -> FINISHED', () => {
    expect(new StateMachine(GameState.FINISHED).transitionTo(GameState.REPLAY)).toBe(true);
    expect(new StateMachine(GameState.PLAYING).transitionTo(GameState.FINISHED)).toBe(true);
  });
});

/** A Game prototype host with only the collaborators startPovRecording touches. */
function makeRecordingHost() {
  const game = Object.create(Game.prototype) as any;
  game.environment = { camera: { fov: 90 } };
  game.audioEngine = { getCurrentTime: () => 0 };
  game.povRecorder = new PovReplayRecorder();
  game.pendingReplayUpload = Promise.resolve({ ok: true });
  game.lastFinalizedReplay = fakeReplay();
  game.currentMapIdentity = () => ({ ...IDENTITY });
  return game;
}

describe('RETRY — fresh POV recording', () => {
  it('startPovRecording clears the previous attempt\'s finalized replay and upload', () => {
    const game = makeRecordingHost();
    game.startPovRecording();
    expect(game.povRecorder.isRecording()).toBe(true);
    expect(game.lastFinalizedReplay).toBeNull();
    expect(game.pendingReplayUpload).toBeNull();
  });

  it('startPovRecording also clears the stale replay on a non-canonical map', () => {
    const game = makeRecordingHost();
    game.currentMapIdentity = () => null;
    game.startPovRecording();
    expect(game.povRecorder.isRecording()).toBe(false);
    expect(game.lastFinalizedReplay).toBeNull();
  });

  it('restartTrack starts a fresh recorder, clears stale replay and reaches PLAYING', () => {
    const game = Object.create(Game.prototype) as any;
    game.stateMachine = new StateMachine(GameState.FINISHED);
    game.currentTrack = { route: [{}], seed: 1 } as any;
    game.currentAnalysis = { filename: 't', duration: 10 } as any;
    game.currentOfficialTrackId = IDENTITY.trackId;
    game.currentTrackCanonical = true;
    game.currentMapIdentity = () => ({ ...IDENTITY });
    game.environment = { camera: { fov: 90 } };
  game.audioEngine = { getCurrentTime: () => 0 };
  game.povRecorder = new PovReplayRecorder();
    game.lastFinalizedReplay = fakeReplay();
    game.pendingReplayUpload = Promise.resolve({ ok: true });
    game.isQuickRestarting = false;
    game.audioEngine = { stop() {}, play() {}, getCurrentTime: () => 0 };
    game.prepareTrackForRun = () => {};
    game.ui = {
      hideAllScreens() {},
      countdownScreen: { cancel() {} },
      pauseScreen: { hide() {} },
      settingsModal: { hide() {} },
      armoryModal: { hide() {} },
      resultsScreen: { hide() {}, setCompetitionContext() {} },
      hud: { show() {}, setRestartHoldProgress() {} }
    };
    game.replayRecorder = { start() {} };
    game.ghostManager = { start() {} };
    game.cameraController = { lock() {} };
    game.playerController = { lockInput() {}, resetKeys() {}, position: { set() {} } };

    game.restartTrack();

    expect(game.stateMachine.getState()).toBe(GameState.PLAYING);
    expect(game.povRecorder.isRecording()).toBe(true);
    expect(game.lastFinalizedReplay).toBeNull();
    expect(game.pendingReplayUpload).toBeNull();
  });
});

/** A Game prototype host with only the collaborators exitPovReplay touches. */
function makeReplayHost(returnState: GameState) {
  const game = Object.create(Game.prototype) as any;
  game.stateMachine = new StateMachine(GameState.REPLAY);
  game.replayMode = 'POV';
  game.replayReturnState = returnState;
  game.currentAnalysis = { filename: 't' };
  game.currentTrack = { seed: 1 };
  game.audioEngine = { stop() {} };
  game.replayPlayer = { stop() {} };
  game.povPlayer = { unload() {} };
  game.clearGhostRace = () => {};
  game.replayGlovePreviewId = null;
  game.ui = { replayOverlay: { hide() {} }, resultsScreen: { show: () => {} } };
  return game;
}

describe('WATCH REPLAY — exit preserves the existing report', () => {
  it('returns to the SAME report without re-running the finish pipeline', () => {
    const game = makeReplayHost(GameState.FINISHED);
    const showCount = { n: 0 };
    game.ui.resultsScreen.show = () => { showCount.n++; };
    const pipeline = () => { throw new Error('finish pipeline must not re-run'); };
    game.finishPovRecording = pipeline;
    game.replayRecorder = { stop: pipeline };
    game.cameraController = { unlock: pipeline };
    // Mirror the real FINISHED listener contract for a REPLAY-origin arrival.
    game.stateMachine.onTransition((next: GameState, prev: GameState) => {
      if (next === GameState.FINISHED && prev === GameState.REPLAY) {
        (game as { returnFromReplayToReport: () => void }).returnFromReplayToReport();
      }
    });

    game.exitPovReplay();

    expect(game.stateMachine.getState()).toBe(GameState.FINISHED);
    expect(showCount.n).toBe(1);
  });

  it('exits a leaderboard-style replay to IMPORT (no report to restore)', () => {
    const game = makeReplayHost(GameState.IMPORT);
    game.exitPovReplay();
    expect(game.stateMachine.getState()).toBe(GameState.IMPORT);
  });

  it('returnFromReplayToReport falls back to IMPORT when run data is gone', () => {
    const game = makeReplayHost(GameState.FINISHED);
    game.currentTrack = null;
    game.currentAnalysis = null;
    (game as { returnFromReplayToReport: () => void }).returnFromReplayToReport();
    expect(game.stateMachine.getState()).toBe(GameState.IMPORT);
  });
});

describe('WATCH REPLAY — unavailable action is hidden', () => {
  it('setReplayAvailable(false) hides the button', () => {
    const toggle = { calls: [] as unknown[][] };
    const screen = Object.create(ResultsScreen.prototype) as any;
    screen.replayBtn = { classList: { toggle: (...args: unknown[]) => toggle.calls.push(args) } };
    screen.setReplayAvailable(false);
    expect(toggle.calls).toEqual([['hidden', true]]);
    screen.setReplayAvailable(true);
    expect(toggle.calls).toEqual([['hidden', true], ['hidden', false]]);
  });

  it('hasLocalReplay() is false once the stale replay is cleared', () => {
    const game = Object.create(Game.prototype) as any;
    game.currentMapIdentity = () => ({ ...IDENTITY });
    game.lastFinalizedReplay = null;
    expect(game.hasLocalReplay()).toBe(false);
  });
});


describe('Connection errors � concise recovery without backend details', () => {
  it.each(['[ERROR]', '[OFFLINE]', '[LOCAL // SYNC PENDING]'])('offers retry for %s without exposing raw errors', (tag) => {
    const bar = Object.create(OnlineStatusBar.prototype) as any;
    let retryHidden = true;
    bar.element = { title: '' };
    bar.tagElem = { textContent: '', classList: { toggle() {} } };
    bar.retryBtn = { classList: { toggle: (_name: string, hidden: boolean) => { retryHidden = hidden; } } };
    bar.setStatus(tag, 'raw backend error: secret table / stack trace');
    expect(bar.tagElem.textContent).toBe(tag);
    expect(bar.element.title).not.toContain('raw backend');
    expect(bar.element.title).toContain('RETRY');
    expect(retryHidden).toBe(false);
  });
});
