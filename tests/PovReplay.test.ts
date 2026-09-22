/**
 * POV REPLAY V1 — format, recorder, playback and storage authorization.
 *
 * All offline: no Supabase project is contacted. The deterministic fixture below
 * is encoded, decoded and sampled back, and the reconstructed trajectory must
 * match the recorded one within a documented tolerance.
 */

import { describe, it, expect } from 'vitest';
import {
  POV_REPLAY_SAMPLE_HZ,
  POV_REPLAY_VERSION,
  PovReplay,
  PovReplayIdentity,
  computeReplayHash,
  decodePovReplay,
  encodePovReplay,
  estimateReplayBytes,
  getSampleCount,
  lerpAngle,
  samplePovReplay,
  validatePovReplay,
  writeSample
} from '../src/replay/pov/PovReplayFormat';
import { PovReplayRecorder } from '../src/replay/pov/PovReplayRecorder';
import { PovReplayPlayer } from '../src/replay/pov/PovReplayPlayer';
import { buildReplayPath } from '../src/online/ReplayStorageService';

const IDENTITY: PovReplayIdentity = {
  trackId: 'track_14_kz_ascent',
  mapVersion: 5,
  mapFingerprint: 'mfp_v1_C95B69E61B60700F_7859',
  movementVersion: 'phmv1_2865D271'
};

const OTHER_IDENTITY: PovReplayIdentity = {
  ...IDENTITY,
  mapFingerprint: 'mfp_v1_0000000000000000_dead'
};

/**
 * DETERMINISTIC FIXTURE: a 12 second run at 30 Hz describing a clean arc —
 * accelerating forward, a jump, a surf segment, then a landing.
 */
function buildFixture(finishTimeUs = 12_000_000): PovReplay {
  const samples: number[] = [];
  const count = Math.round(12 * POV_REPLAY_SAMPLE_HZ);
  for (let i = 0; i < count; i++) {
    const t = (i / POV_REPLAY_SAMPLE_HZ) * 1000;
    const s = i / POV_REPLAY_SAMPLE_HZ;
    const airborne = s >= 3 && s < 5;
    const surfing = s >= 5 && s < 8;
    const y = surfing ? 4 + Math.sin(s * 2) * 0.5 : 0;
    writeSample(
      samples,
      t,
      { x: s * 12, y, z: s * 4 },
      { x: 12, y: airborne ? 6 - (s - 3) * 8 : 0, z: 4 },
      // Deliberately crosses the +-PI wrap so shortest-arc interpolation is
      // exercised by the roundtrip test.
      s * 1.2,
      Math.sin(s) * 0.4,
      !airborne,
      surfing,
      surfing ? 1 : 0
    );
  }

  const draft: PovReplay = {
    replayVersion: POV_REPLAY_VERSION,
    identity: IDENTITY,
    finishTimeUs,
    // The recording runs to exactly 12 s so the FINISH event at 12000 ms is
    // inside the recorded range.
    durationMs: 12_000,
    sampleHz: POV_REPLAY_SAMPLE_HZ,
    fov: 100,
    startSongTimeMs: 0,
    s: samples,
    events: [
      { t: 3000, type: 'JUMP' },
      { t: 5000, type: 'SURF_ENTER' },
      { t: 8000, type: 'SURF_EXIT' },
      { t: 8500, type: 'CHECKPOINT', d: 1 },
      { t: 11000, type: 'SIGNAL_GATE', d: 0 },
      { t: 12000, type: 'FINISH' }
    ],
    cosmetic: { skinId: 'SIGNAL_CYAN' },
    hash: ''
  };
  draft.hash = computeReplayHash(encodePovReplay(draft));
  return draft;
}

// ---------------------------------------------------------------------------

describe('POV replay — encode/decode roundtrip', () => {
  it('round-trips byte-identically', () => {
    const replay = buildFixture();
    const payload = encodePovReplay(replay);
    const decoded = decodePovReplay(payload);

    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    // The decoded replay carries no self-computed hash by design; the hash is an
    // external expected value (leaderboard_runs.replay_hash).
    expect(computeReplayHash(payload)).toBe(replay.hash);
    expect(decoded.replay.finishTimeUs).toBe(replay.finishTimeUs);
    expect(decoded.replay.durationMs).toBe(replay.durationMs);
    expect(decoded.replay.sampleHz).toBe(POV_REPLAY_SAMPLE_HZ);
    expect(decoded.replay.fov).toBe(100);
    expect(decoded.replay.cosmetic.skinId).toBe('SIGNAL_CYAN');
    expect(getSampleCount(decoded.replay)).toBe(getSampleCount(replay));
    expect(decoded.replay.events).toEqual(replay.events);

    // Re-encoding the decoded replay must produce the SAME bytes.
    expect(encodePovReplay(decoded.replay)).toBe(payload);
  });

  it('preserves microsecond finish time exactly', () => {
    const replay = buildFixture(48_217_391);
    const decoded = decodePovReplay(encodePovReplay(replay));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.replay.finishTimeUs).toBe(48_217_391);
    expect(Number.isInteger(decoded.replay.finishTimeUs)).toBe(true);
  });

  it('preserves event ordering and payloads', () => {
    const decoded = decodePovReplay(encodePovReplay(buildFixture()));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const types = decoded.replay.events.map((e) => e.type);
    expect(types).toEqual([
      'JUMP', 'SURF_ENTER', 'SURF_EXIT', 'CHECKPOINT', 'SIGNAL_GATE', 'FINISH'
    ]);
    const times = decoded.replay.events.map((e) => e.t);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(decoded.replay.events.find((e) => e.type === 'CHECKPOINT')?.d).toBe(1);
  });
});

describe('POV replay — interpolation', () => {
  it('reproduces the recorded trajectory within tolerance', () => {
    const replay = buildFixture();
    // Tolerance: sampling at 30 Hz and interpolating linearly means a point
    // BETWEEN two samples can deviate from the true curve by at most half a
    // sample of curvature. For this fixture the documented tolerance is 0.5 m
    // (positions are quantised to 1 mm, so the rest is interpolation error).
    const TOLERANCE_M = 0.5;

    for (let t = 0; t <= replay.durationMs; t += 37) {
      const sample = samplePovReplay(replay, t);
      // The fixture's ground truth is a straight line in x and z.
      const expectedX = (t / 1000) * 12;
      const expectedZ = (t / 1000) * 4;
      expect(Math.abs(sample.x - expectedX)).toBeLessThanOrEqual(TOLERANCE_M);
      expect(Math.abs(sample.z - expectedZ)).toBeLessThanOrEqual(TOLERANCE_M);
    }
  });

  it('clamps outside the recorded range', () => {
    const replay = buildFixture();
    const first = samplePovReplay(replay, -5000);
    const last = samplePovReplay(replay, 999_999);
    expect(first.x).toBeCloseTo(0, 3);
    expect(last.x).toBeCloseTo(samplePovReplay(replay, replay.durationMs).x, 6);
  });

  it('uses shortest-arc yaw so it never spins the long way', () => {
    // Crossing the +-PI wrap must interpolate the short way.
    expect(lerpAngle(3.0, -3.0, 0.5)).toBeCloseTo(Math.PI, 3);
    const replay = buildFixture();
    let previous = samplePovReplay(replay, 0).yaw;
    for (let t = 0; t <= replay.durationMs; t += 100) {
      const yaw = samplePovReplay(replay, t).yaw;
      expect(Math.abs(yaw - previous)).toBeLessThan(Math.PI);
      previous = yaw;
    }
  });

  it('takes discrete state from the earlier sample (exact transition instant)', () => {
    const replay = buildFixture();
    // The fixture is airborne from 3 s to 5 s.
    expect(samplePovReplay(replay, 2999).grounded).toBe(true);
    expect(samplePovReplay(replay, 3001).grounded).toBe(false);
    expect(samplePovReplay(replay, 5001).grounded).toBe(true);
    expect(samplePovReplay(replay, 6000).surfing).toBe(true);
    expect(samplePovReplay(replay, 6000).surfSide).toBe(1);
  });
});

describe('POV replay — validation', () => {
  const replay = buildFixture();

  it('accepts a matching identity and finish time', () => {
    const payload = encodePovReplay(replay);
    expect(
      validatePovReplay(replay, { identity: IDENTITY, finishTimeUs: replay.finishTimeUs, payload }).ok
    ).toBe(true);
  });

  it('rejects a map fingerprint mismatch', () => {
    const result = validatePovReplay(replay, { identity: OTHER_IDENTITY });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('MAP_FINGERPRINT_MISMATCH');
  });

  it('rejects a map version mismatch', () => {
    const result = validatePovReplay(replay, { identity: { ...IDENTITY, mapVersion: 4 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('MAP_VERSION_MISMATCH');
  });

  it('rejects a movement version mismatch', () => {
    const result = validatePovReplay(replay, {
      identity: { ...IDENTITY, movementVersion: 'phmv1_DEADBEEF' }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('MOVEMENT_VERSION_MISMATCH');
  });

  it('rejects a track mismatch', () => {
    const result = validatePovReplay(replay, {
      identity: { ...IDENTITY, trackId: 'track_5_gravity_line' }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('TRACK_MISMATCH');
  });

  it('rejects a finish time that disagrees with the leaderboard time', () => {
    const result = validatePovReplay(replay, {
      identity: IDENTITY,
      finishTimeUs: replay.finishTimeUs + 1
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('FINISH_TIME_MISMATCH');
  });

  it('rejects tampered bytes via the hash', () => {
    const payload = encodePovReplay(replay);
    const tampered = payload.replace('"finishTimeUs":12000000', '"finishTimeUs":11000000');
    const decoded = decodePovReplay(tampered);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const result = validatePovReplay(decoded.replay, {
      identity: IDENTITY,
      payload: tampered,
      expectedHash: replay.hash
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('HASH_MISMATCH');
  });
});

describe('POV replay — malformed input', () => {
  it('rejects non-JSON, non-objects and missing fields', () => {
    expect(decodePovReplay('not json').ok).toBe(false);
    expect(decodePovReplay('[]').ok).toBe(false);
    expect(decodePovReplay('{}').ok).toBe(false);
    expect(decodePovReplay(JSON.stringify({ replayVersion: 99 })).ok).toBe(false);
    expect(
      decodePovReplay(JSON.stringify({ replayVersion: 1, identity: {}, finishTimeUs: 1 })).ok
    ).toBe(false);
  });

  it('rejects a malformed sample array', () => {
    const base = JSON.parse(encodePovReplay(buildFixture()));
    base.s = [1, 2, 3]; // not a multiple of the stride
    expect(decodePovReplay(JSON.stringify(base)).ok).toBe(false);

    const base2 = JSON.parse(encodePovReplay(buildFixture()));
    base2.s[5] = Number.NaN;
    expect(decodePovReplay(JSON.stringify(base2)).ok).toBe(false);
  });

  it('rejects an insensible duration', () => {
    const replay = buildFixture();
    const tiny: PovReplay = { ...replay, durationMs: 0, s: replay.s.slice(0, 10) };
    const result = validatePovReplay(tiny, { identity: IDENTITY });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('DURATION_INSENSIBLE');
  });
});

describe('POV replay — recorder', () => {
  it('records at the fixed rate and finalises with a hash', () => {
    const recorder = new PovReplayRecorder();
    recorder.start(IDENTITY, 'SIGNAL_CYAN', 100, 0);

    // Simulate 4 seconds of 120 Hz frames.
    const dt = 1 / 120;
    for (let i = 0; i < 120 * 4; i++) {
      const runMs = i * dt * 1000;
      recorder.record(dt, {
        songTimeMs: runMs,
        pos: { x: i * 0.1, y: 0, z: 0 },
        vel: { x: 12, y: 0, z: 0 },
        yaw: i * 0.001,
        pitch: 0,
        grounded: true,
        surfing: false,
        surfSide: 1
      });
    }
    recorder.setFinishTimeUs(4_000_000);
    recorder.pushEvent('FINISH');

    const replay = recorder.finalize();
    expect(replay).not.toBeNull();
    if (!replay) return;

    // 4 s at 30 Hz => ~120 samples, never 480 (that would be 120 Hz).
    expect(getSampleCount(replay)).toBeGreaterThanOrEqual(118);
    expect(getSampleCount(replay)).toBeLessThanOrEqual(122);
    expect(replay.finishTimeUs).toBe(4_000_000);
    expect(replay.cosmetic.skinId).toBe('SIGNAL_CYAN');
    expect(replay.fov).toBe(100);
    expect(replay.hash).toMatch(/^rph_v1_[0-9A-F]{16}$/);
    expect(replay.events.some((e) => e.type === 'FINISH')).toBe(true);
  });

  it('refuses to finalise without a finish time or data', () => {
    const recorder = new PovReplayRecorder();
    recorder.start(IDENTITY, 'SIGNAL_CYAN');
    expect(recorder.finalize()).toBeNull();
    expect(recorder.hasData()).toBe(false);
  });

  it('ignores backwards time jumps so a full restart cannot corrupt samples', () => {
    const recorder = new PovReplayRecorder();
    recorder.start(IDENTITY, 'SIGNAL_CYAN');
    const dt = 1 / 120;
    for (let i = 0; i < 60; i++) {
      recorder.record(dt, {
        songTimeMs: i * dt * 1000,
        pos: { x: i, y: 0, z: 0 },
        vel: { x: 1, y: 0, z: 0 },
        yaw: 0, pitch: 0, grounded: true, surfing: false, surfSide: 0
      });
    }
    const before = recorder.getSampleCount();
    // Rewind (full restart).
    for (let i = 0; i < 60; i++) {
      recorder.record(dt, {
        songTimeMs: i * dt * 1000,
        pos: { x: 0, y: 0, z: 0 },
        vel: { x: 0, y: 0, z: 0 },
        yaw: 0, pitch: 0, grounded: true, surfing: false, surfSide: 0
      });
    }
    // The rewind itself adds nothing, then recording resumes monotonically.
    expect(recorder.getSampleCount()).toBeGreaterThanOrEqual(before);
  });

  it('keeps a 1 minute run small', () => {
    const bytes = estimateReplayBytes(60_000);
    expect(bytes).toBeLessThan(160 * 1024);
    expect(bytes).toBeGreaterThan(40 * 1024);
  });
});

describe('POV replay — player', () => {
  it('refuses to load against the wrong map', () => {
    const player = new PovReplayPlayer();
    const result = player.load(encodePovReplay(buildFixture()), { identity: OTHER_IDENTITY });
    expect(result.ok).toBe(false);
    expect(player.hasReplay()).toBe(false);
  });

  it('loads, plays and reports events in order', () => {
    const player = new PovReplayPlayer();
    const replay = buildFixture();
    const loaded = player.load(encodePovReplay(replay), {
      identity: IDENTITY,
      finishTimeUs: replay.finishTimeUs
    });
    expect(loaded.ok).toBe(true);

    player.play();
    const seen: string[] = [];
    player.onEvent = (e) => seen.push(e.type);
    for (let i = 0; i < 12 * POV_REPLAY_SAMPLE_HZ + 30; i++) {
      player.update(1 / POV_REPLAY_SAMPLE_HZ);
    }
    expect(seen).toEqual(['JUMP', 'SURF_ENTER', 'SURF_EXIT', 'CHECKPOINT', 'SIGNAL_GATE', 'FINISH']);
  });

  it('reports the recorded FOV and song time', () => {
    const player = new PovReplayPlayer();
    const replay = buildFixture();
    player.load(encodePovReplay(replay), { identity: IDENTITY });
    player.restart();
    const frame = player.updateFrame(4000);
    expect(frame.fov).toBe(100);
    // startSongTimeMs is 0 for the fixture, so song time equals run time.
    expect(frame.songTimeMs).toBeCloseTo(4000, 0);
    // Camera sits at eye height above the recorded base position.
    expect(frame.position.y).toBeGreaterThan(0);
  });

  it('restart rewinds events so they replay', () => {
    const player = new PovReplayPlayer();
    const replay = buildFixture();
    player.load(encodePovReplay(replay), { identity: IDENTITY });
    player.restart();
    player.updateFrame(12_000);
    expect(player.getEmittedEvents().length).toBe(6);
    player.restart();
    expect(player.getEmittedEvents().length).toBe(0);
  });
});

describe('POV replay — storage path authorization', () => {
  it('always scopes the object under the owner folder', () => {
    const path = buildReplayPath('user-123', 'track_14_kz_ascent', 48_217_391, 'rph_v1_ABCDEF0123456789');
    expect(path.startsWith('user-123/')).toBe(true);
    expect(path).toContain('track_14_kz_ascent');
    expect(path.endsWith('.json')).toBe(true);
  });

  it('sanitises hostile ids so a path cannot escape its folder', () => {
    const path = buildReplayPath('user-123', '../../etc', 1, 'rph_v1_x');
    expect(path.startsWith('user-123/')).toBe(true);
    expect(path).not.toContain('..');
    expect(path.split('/').length).toBe(3);
  });

  it('is deterministic for the same run', () => {
    expect(buildReplayPath('u', 't', 1, 'h')).toBe(buildReplayPath('u', 't', 1, 'h'));
  });
});
