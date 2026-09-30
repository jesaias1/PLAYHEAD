/**
 * PRODUCTION WATCH REGRESSION.
 *
 * The deployed build hit [StateMachine] Invalid transition IMPORT -> REPLAY and
 * WATCH only loaded preset JSON (no world/audio). These tests pin the two
 * halves of the fix:
 *
 *  1. The state machine must accept the transition that canonical playback
 *     preparation actually produces (READY -> REPLAY), while FINISHED -> REPLAY
 *     stays valid for local results.
 *  2. enterPovReplay must prepare canonical playback, verify the recorded map
 *     identity against the loaded one, and NEVER report success unless the
 *     machine really entered REPLAY.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { GameState, StateMachine } from '../src/core/StateMachine';
import { Game } from '../src/core/Game';
import { PresetLevelCache } from '../src/audio/PresetLevelCache';
import { PovReplayPlayer } from '../src/replay/pov/PovReplayPlayer';
import {
  POV_REPLAY_SAMPLE_HZ,
  POV_REPLAY_VERSION,
  PovReplay,
  PovReplayIdentity,
  computeReplayHash,
  encodePovReplay,
  writeSample
} from '../src/replay/pov/PovReplayFormat';

const IDENTITY: PovReplayIdentity = {
  trackId: 'track_14_kz_ascent',
  mapVersion: 5,
  mapFingerprint: 'mfp_v1_C95B69E61B60700F_7859',
  movementVersion: 'phmv1_2865D271'
};

function buildReplay(): PovReplay {
  const samples: number[] = [];
  const count = Math.round(12 * POV_REPLAY_SAMPLE_HZ);
  for (let i = 0; i < count; i++) {
    const s = i / POV_REPLAY_SAMPLE_HZ;
    writeSample(
      samples,
      s * 1000,
      { x: s * 12, y: 0, z: s * 4 },
      { x: 12, y: 0, z: 4 },
      s * 1.2,
      Math.sin(s) * 0.4,
      true,
      false,
      0
    );
  }
  const draft: PovReplay = {
    replayVersion: POV_REPLAY_VERSION,
    identity: IDENTITY,
    finishTimeUs: 12_000_000,
    durationMs: 12_000,
    sampleHz: POV_REPLAY_SAMPLE_HZ,
    fov: 100,
    startSongTimeMs: 0,
    s: samples,
    events: [{ t: 12000, type: 'FINISH' }],
    cosmetic: { skinId: 'SIGNAL_CYAN' },
    hash: ''
  };
  draft.hash = computeReplayHash(encodePovReplay(draft));
  return draft;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WATCH — state machine entry transitions', () => {
  it('accepts READY -> REPLAY (canonical preparation finishes in READY)', () => {
    const sm = new StateMachine(GameState.READY);
    expect(sm.transitionTo(GameState.REPLAY)).toBe(true);
    expect(sm.getState()).toBe(GameState.REPLAY);
  });

  it('accepts FINISHED -> REPLAY (local results replay)', () => {
    const sm = new StateMachine(GameState.FINISHED);
    expect(sm.transitionTo(GameState.REPLAY)).toBe(true);
    expect(sm.getState()).toBe(GameState.REPLAY);
  });

  it('still refuses an unprepared IMPORT -> REPLAY jump', () => {
    const sm = new StateMachine(GameState.IMPORT);
    expect(sm.transitionTo(GameState.REPLAY)).toBe(false);
    expect(sm.getState()).toBe(GameState.IMPORT);
  });

  it('a rejected transition reports failure instead of changing state', () => {
    const sm = new StateMachine(GameState.COUNTDOWN);
    expect(sm.transitionTo(GameState.REPLAY)).toBe(false);
    expect(sm.getState()).toBe(GameState.COUNTDOWN);
  });
});

/** A Game instance with only the collaborators enterPovReplay touches. */
function makeReplayHost(state: GameState) {
  const game = Object.create(Game.prototype) as any;
  game.stateMachine = new StateMachine(state);
  game.povPlayer = new PovReplayPlayer();
  game.replayMode = 'NONE';
  return game;
}

describe('WATCH — enterPovReplay prepares canonical playback', () => {
  it('prepares again after EXIT returns a previously loaded map to IMPORT', async () => {
    const game = makeReplayHost(GameState.IMPORT);
    game.currentOfficialTrackId = IDENTITY.trackId;
    game.currentTrackCanonical = true;
    game.currentMapIdentity = () => ({ ...IDENTITY });
    game.handleCatalogTrackSelected = vi.fn(async () => {
      game.stateMachine.transitionTo(GameState.ANALYSING);
      game.stateMachine.transitionTo(GameState.READY);
    });
    expect(await game.prepareCanonicalPlayback(IDENTITY.trackId)).toBe(true);
    expect(game.handleCatalogTrackSelected).toHaveBeenCalledOnce();
    expect(game.stateMachine.getState()).toBe(GameState.READY);
  });

  it('prepares, verifies identity and enters REPLAY only when accepted', async () => {
    vi.spyOn(PresetLevelCache, 'loadPreset').mockResolvedValue({ track: {}, analysis: {} } as any);
    const game = makeReplayHost(GameState.IMPORT);
    let preparedFor: string | null = null;
    game.prepareCanonicalPlayback = async (trackId: string) => {
      preparedFor = trackId;
      // Real canonical preparation walks IMPORT -> ANALYSING -> READY through
      // the existing official-track load path.
      game.stateMachine.transitionTo(GameState.ANALYSING);
      game.stateMachine.transitionTo(GameState.READY);
      return true;
    };
    game.currentMapIdentity = () => ({ ...IDENTITY });

    const result = await game.enterPovReplay(
      encodePovReplay(buildReplay()),
      IDENTITY,
      IDENTITY.trackId,
      12_000_000
    );

    expect(preparedFor).toBe(IDENTITY.trackId);
    expect(result.ok).toBe(true);
    expect(result.detail).toBe('PLAYING');
    expect(game.stateMachine.getState()).toBe(GameState.REPLAY);
    expect(game.replayMode).toBe('POV');
    expect(game.povPlayer.hasReplay()).toBe(true);
  });

  it('never reports success when the machine did not actually reach REPLAY', async () => {
    // Preparation claims success but leaves the machine in IMPORT (the exact
    // production symptom). The checked transition must surface the failure.
    vi.spyOn(PresetLevelCache, 'loadPreset').mockResolvedValue({ track: {}, analysis: {} } as any);
    const game = makeReplayHost(GameState.IMPORT);
    game.prepareCanonicalPlayback = async () => true;
    game.currentMapIdentity = () => ({ ...IDENTITY });

    const result = await game.enterPovReplay(
      encodePovReplay(buildReplay()),
      IDENTITY,
      IDENTITY.trackId
    );

    expect(result.ok).toBe(false);
    expect(result.detail).toBe('REPLAY ENTRY REJECTED');
    expect(game.stateMachine.getState()).toBe(GameState.IMPORT);
    expect(game.replayMode).toBe('NONE');
    expect(game.povPlayer.hasReplay()).toBe(false);
  });

  it('refuses when the loaded map identity does not match the recording', async () => {
    vi.spyOn(PresetLevelCache, 'loadPreset').mockResolvedValue({ track: {}, analysis: {} } as any);
    const game = makeReplayHost(GameState.READY);
    game.prepareCanonicalPlayback = async () => true;
    game.currentMapIdentity = () => ({ ...IDENTITY, mapFingerprint: 'mfp_v1_0000000000000000_dead' });

    const result = await game.enterPovReplay(
      encodePovReplay(buildReplay()),
      IDENTITY,
      IDENTITY.trackId
    );

    expect(result.ok).toBe(false);
    expect(result.detail).toBe('REPLAY MAP IDENTITY MISMATCH');
    expect(game.stateMachine.getState()).toBe(GameState.READY);
    expect(game.replayMode).toBe('NONE');
  });

  it('refuses when canonical preparation fails', async () => {
    vi.spyOn(PresetLevelCache, 'loadPreset').mockResolvedValue({ track: {}, analysis: {} } as any);
    const game = makeReplayHost(GameState.IMPORT);
    game.prepareCanonicalPlayback = async () => false;
    game.currentMapIdentity = () => ({ ...IDENTITY });

    const result = await game.enterPovReplay(
      encodePovReplay(buildReplay()),
      IDENTITY,
      IDENTITY.trackId
    );

    expect(result.ok).toBe(false);
    expect(result.detail).toBe('CANONICAL PLAYBACK PREPARATION FAILED');
    expect(game.replayMode).toBe('NONE');
  });
});
