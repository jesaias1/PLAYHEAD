/**
 * POV REPLAY FORMAT — versioned, compact, deterministic.
 *
 * A replay is a small data file, never video. It stores enough to reconstruct
 * exactly what the runner saw, and nothing that can drift:
 *
 *   - fixed-frequency camera/transform samples (30 Hz) with interpolation
 *   - a sparse event stream (jump / land / surf / checkpoint / gate / finish)
 *   - the authoritative finish time in integer microseconds
 *   - the canonical map identity it was recorded against
 *
 * Playback interpolates RECORDED samples. It never re-simulates input, so a
 * different browser or device cannot make a replay drift.
 *
 * Layout is parallel flat arrays (not an array of objects) so recording costs no
 * per-frame allocations and the JSON stays small.
 */

import { murmurHash3, seedToHex } from '../../utils/hash';

/** Bumped only when the payload shape changes incompatibly. */
export const POV_REPLAY_VERSION = 1;

/** Samples per second. 30 Hz interpolates smoothly for a camera. */
export const POV_REPLAY_SAMPLE_HZ = 30;

/** Numbers stored per sample: t, px, py, pz, vx, vy, vz, yaw, pitch, state. */
export const POV_SAMPLE_STRIDE = 10;

export type PovReplayEventType =
  | 'JUMP'
  | 'LAND'
  | 'SURF_ENTER'
  | 'SURF_EXIT'
  | 'CHECKPOINT'
  | 'SIGNAL_GATE'
  | 'VIEWMODEL_ACTION'
  | 'FULL_RESTART'
  | 'FINISH';

export interface PovReplayEvent {
  /** Milliseconds from run start. */
  t: number;
  type: PovReplayEventType;
  /** Optional payload: checkpoint index, gate index, action id. */
  d?: number;
}

export interface PovReplayIdentity {
  trackId: string;
  mapVersion: number;
  mapFingerprint: string;
  movementVersion: string;
}

export interface PovReplayCosmetic {
  /** Cosmetic id (stable identifier, not a display name). */
  skinId: string;
}

export interface PovReplay {
  replayVersion: number;
  identity: PovReplayIdentity;
  /** Authoritative completion time in integer microseconds. */
  finishTimeUs: number;
  /** Total recorded duration in integer milliseconds. */
  durationMs: number;
  sampleHz: number;
  /** Base camera FOV the run was played at (degrees). */
  fov: number;
  /**
   * Song time (ms) the run started at. Song time advances 1:1 with run time,
   * so playback derives `songTime = startSongTimeMs + t` for exact audio sync.
   */
  startSongTimeMs: number;
  /** Flat samples, POV_SAMPLE_STRIDE numbers each. */
  s: number[];
  events: PovReplayEvent[];
  cosmetic: PovReplayCosmetic;
  /** Hash of the encoded payload (excludes this field). */
  hash: string;
}

export interface PovSample {
  t: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  grounded: boolean;
  surfing: boolean;
  surfSide: number;
}

// ---------------------------------------------------------------------------
// Sample state bitfield
// ---------------------------------------------------------------------------

const BIT_GROUNDED = 1;
const BIT_SURFING = 2;
const BIT_SURF_SIDE = 4;

export function encodeState(grounded: boolean, surfing: boolean, surfSide: number): number {
  let v = 0;
  if (grounded) v |= BIT_GROUNDED;
  if (surfing) v |= BIT_SURFING;
  if (surfSide > 0) v |= BIT_SURF_SIDE;
  return v;
}

export function decodeState(v: number): { grounded: boolean; surfing: boolean; surfSide: number } {
  return {
    grounded: (v & BIT_GROUNDED) !== 0,
    surfing: (v & BIT_SURFING) !== 0,
    surfSide: (v & BIT_SURF_SIDE) !== 0 ? 1 : 0
  };
}

// ---------------------------------------------------------------------------
// Quantisation (keeps payloads small; also makes hashes stable across engines)
// ---------------------------------------------------------------------------

const round = (v: number, dp: number): number => {
  if (!Number.isFinite(v)) return 0;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

// ---------------------------------------------------------------------------
// Encode / decode
// ---------------------------------------------------------------------------

/**
 * Deterministic encoding. Key order is explicit, so the same replay always
 * produces byte-identical output (and therefore the same hash).
 */
export function encodePovReplay(replay: PovReplay): string {
  const payload = {
    replayVersion: replay.replayVersion,
    identity: {
      trackId: replay.identity.trackId,
      mapVersion: replay.identity.mapVersion,
      mapFingerprint: replay.identity.mapFingerprint,
      movementVersion: replay.identity.movementVersion
    },
    finishTimeUs: replay.finishTimeUs,
    durationMs: replay.durationMs,
    sampleHz: replay.sampleHz,
    fov: replay.fov,
    startSongTimeMs: replay.startSongTimeMs,
    s: replay.s,
    events: replay.events.map((e) => (e.d === undefined ? { t: e.t, type: e.type } : { t: e.t, type: e.type, d: e.d })),
    cosmetic: { skinId: replay.cosmetic.skinId }
  };
  return JSON.stringify(payload);
}

export function computeReplayHash(payload: string): string {
  const h1 = murmurHash3(payload, 0x52504c31);
  const h2 = murmurHash3(payload, 0x52504c32);
  return `rph_v${POV_REPLAY_VERSION}_${seedToHex(h1)}${seedToHex(h2)}`;
}

export type DecodeResult =
  | { ok: true; replay: PovReplay }
  | { ok: false; reason: string };

/** Structural validation only. Identity/time checks live in validatePovReplay. */
export function decodePovReplay(payload: string): DecodeResult {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return { ok: false, reason: 'payload is not valid JSON' };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'payload is not an object' };
  const r = raw as Record<string, unknown>;

  const version = Number(r.replayVersion);
  if (!Number.isInteger(version) || version <= 0) {
    return { ok: false, reason: 'missing or invalid replayVersion' };
  }
  if (version > POV_REPLAY_VERSION) {
    return { ok: false, reason: `unsupported replay version ${version}` };
  }

  const identity = r.identity as Record<string, unknown> | undefined;
  if (
    !identity ||
    typeof identity.trackId !== 'string' ||
    !Number.isInteger(Number(identity.mapVersion)) ||
    typeof identity.mapFingerprint !== 'string' ||
    typeof identity.movementVersion !== 'string'
  ) {
    return { ok: false, reason: 'missing or malformed map identity' };
  }

  const finishTimeUs = Number(r.finishTimeUs);
  if (!Number.isFinite(finishTimeUs) || finishTimeUs <= 0) {
    return { ok: false, reason: 'invalid finishTimeUs' };
  }

  const durationMs = Number(r.durationMs);
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return { ok: false, reason: 'invalid durationMs' };
  }

  const sampleHz = Number(r.sampleHz);
  if (!Number.isFinite(sampleHz) || sampleHz <= 0 || sampleHz > 240) {
    return { ok: false, reason: 'invalid sampleHz' };
  }

  // FOV is optional for forward compatibility; fall back to the engine default.
  const rawFov = Number(r.fov);
  const fov = Number.isFinite(rawFov) && rawFov > 10 && rawFov < 170 ? rawFov : 75;

  const rawStart = Number(r.startSongTimeMs);
  const startSongTimeMs = Number.isFinite(rawStart) && rawStart >= 0 ? rawStart : 0;

  const s = r.s;
  if (!Array.isArray(s) || s.length === 0 || s.length % POV_SAMPLE_STRIDE !== 0) {
    return { ok: false, reason: 'samples array is missing or not a multiple of the stride' };
  }
  for (let i = 0; i < s.length; i++) {
    if (typeof s[i] !== 'number' || !Number.isFinite(s[i] as number)) {
      return { ok: false, reason: `non-finite sample value at index ${i}` };
    }
  }

  const rawEvents = r.events;
  if (rawEvents !== undefined && !Array.isArray(rawEvents)) {
    return { ok: false, reason: 'events must be an array' };
  }
  const events: PovReplayEvent[] = [];
  for (const e of (rawEvents as Array<Record<string, unknown>> | undefined) ?? []) {
    if (!e || typeof e.type !== 'string' || !Number.isFinite(Number(e.t))) {
      return { ok: false, reason: 'malformed event entry' };
    }
    events.push({
      t: Number(e.t),
      type: e.type as PovReplayEventType,
      d: e.d === undefined ? undefined : Number(e.d)
    });
  }

  const cosmetic = r.cosmetic as Record<string, unknown> | undefined;

  const replay: PovReplay = {
    replayVersion: version,
    identity: {
      trackId: identity.trackId as string,
      mapVersion: Number(identity.mapVersion),
      mapFingerprint: identity.mapFingerprint as string,
      movementVersion: identity.movementVersion as string
    },
    finishTimeUs: Math.round(finishTimeUs),
    durationMs: Math.round(durationMs),
    sampleHz,
    fov,
    startSongTimeMs,
    s: s as number[],
    events,
    cosmetic: { skinId: (cosmetic?.skinId as string) ?? '' },
    // Deliberately NOT computed here: the hash is an EXTERNAL expected value
    // (leaderboard_runs.replay_hash). Computing it from the bytes being
    // validated would make the check vacuous.
    hash: ''
  };

  return { ok: true, replay };
}

// ---------------------------------------------------------------------------
// Interpolation (pure; the heart of drift-free playback)
// ---------------------------------------------------------------------------

function readSample(s: number[], index: number): PovSample {
  const o = index * POV_SAMPLE_STRIDE;
  const state = decodeState(s[o + 9]);
  return {
    t: s[o],
    x: s[o + 1],
    y: s[o + 2],
    z: s[o + 3],
    vx: s[o + 4],
    vy: s[o + 5],
    vz: s[o + 6],
    yaw: s[o + 7],
    pitch: s[o + 8],
    grounded: state.grounded,
    surfing: state.surfing,
    surfSide: state.surfSide
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shortest-arc angular interpolation so yaw never spins the long way round. */
export function lerpAngle(a: number, b: number, t: number): number {
  let delta = b - a;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}

export function getSampleCount(replay: PovReplay): number {
  return Math.floor(replay.s.length / POV_SAMPLE_STRIDE);
}

/**
 * Samples the replay at an arbitrary time, interpolating between recorded
 * states. Clamps outside the recorded range.
 */
export function samplePovReplay(replay: PovReplay, timeMs: number): PovSample {
  const count = getSampleCount(replay);
  if (count === 0) {
    return {
      t: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      yaw: 0, pitch: 0, grounded: true, surfing: false, surfSide: 0
    };
  }

  const s = replay.s;
  const first = readSample(s, 0);
  const last = readSample(s, count - 1);
  if (timeMs <= first.t) return first;
  if (timeMs >= last.t) return last;

  // Binary search for the bracketing pair.
  let lo = 0;
  let hi = count - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid * POV_SAMPLE_STRIDE] <= timeMs) lo = mid;
    else hi = mid;
  }

  const a = readSample(s, lo);
  const b = readSample(s, hi);
  const span = b.t - a.t;
  const t = span > 0 ? (timeMs - a.t) / span : 0;

  return {
    t: timeMs,
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
    vx: lerp(a.vx, b.vx, t),
    vy: lerp(a.vy, b.vy, t),
    vz: lerp(a.vz, b.vz, t),
    yaw: lerpAngle(a.yaw, b.yaw, t),
    pitch: lerp(a.pitch, b.pitch, t),
    // Discrete state comes from the EARLIER sample so a transition reads at the
    // exact recorded instant rather than half a frame early.
    grounded: a.grounded,
    surfing: a.surfing,
    surfSide: a.surfSide
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ReplayValidation =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'UNSUPPORTED_VERSION'
        | 'TRACK_MISMATCH'
        | 'MAP_VERSION_MISMATCH'
        | 'MAP_FINGERPRINT_MISMATCH'
        | 'MOVEMENT_VERSION_MISMATCH'
        | 'DURATION_INSENSIBLE'
        | 'FINISH_TIME_MISMATCH'
        | 'HASH_MISMATCH';
      detail: string;
    };

/**
 * Validates a decoded replay against the canonical map it claims to be for, and
 * against the leaderboard time it is attached to.
 *
 * This is integrity checking, not anti-cheat. A browser client can always forge
 * a self-consistent replay; stronger verification is a later milestone.
 */
export function validatePovReplay(
  replay: PovReplay,
  expected: {
    identity: PovReplayIdentity;
    finishTimeUs?: number;
    /** Raw bytes as downloaded, used to recompute the integrity hash. */
    payload?: string;
    /** The hash recorded server-side for this run. */
    expectedHash?: string;
  }
): ReplayValidation {
  if (replay.replayVersion > POV_REPLAY_VERSION) {
    return { ok: false, reason: 'UNSUPPORTED_VERSION', detail: `v${replay.replayVersion}` };
  }

  const a = replay.identity;
  const b = expected.identity;
  if (a.trackId !== b.trackId) {
    return { ok: false, reason: 'TRACK_MISMATCH', detail: `${a.trackId} vs ${b.trackId}` };
  }
  if (a.mapVersion !== b.mapVersion) {
    return { ok: false, reason: 'MAP_VERSION_MISMATCH', detail: `${a.mapVersion} vs ${b.mapVersion}` };
  }
  if (a.mapFingerprint !== b.mapFingerprint) {
    return {
      ok: false,
      reason: 'MAP_FINGERPRINT_MISMATCH',
      detail: `${a.mapFingerprint} vs ${b.mapFingerprint}`
    };
  }
  if (a.movementVersion !== b.movementVersion) {
    return {
      ok: false,
      reason: 'MOVEMENT_VERSION_MISMATCH',
      detail: `${a.movementVersion} vs ${b.movementVersion}`
    };
  }

  const count = getSampleCount(replay);
  if (count < 2 || replay.durationMs <= 0 || replay.durationMs > 60 * 60 * 1000) {
    return {
      ok: false,
      reason: 'DURATION_INSENSIBLE',
      detail: `samples=${count} durationMs=${replay.durationMs}`
    };
  }

  // The recorded finish time must agree EXACTLY with the submitted time: both
  // are integer microseconds from the same authoritative timer.
  if (expected.finishTimeUs !== undefined && replay.finishTimeUs !== expected.finishTimeUs) {
    return {
      ok: false,
      reason: 'FINISH_TIME_MISMATCH',
      detail: `${replay.finishTimeUs} vs ${expected.finishTimeUs}`
    };
  }

  if (expected.payload !== undefined && expected.expectedHash) {
    const actual = computeReplayHash(expected.payload);
    if (actual !== expected.expectedHash) {
      return {
        ok: false,
        reason: 'HASH_MISMATCH',
        detail: 'replay bytes do not match the hash recorded for this run'
      };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

/** Speed in m/s from a sample's velocity. */
export function sampleSpeed(sample: PovSample): number {
  return Math.hypot(sample.vx, sample.vy, sample.vz);
}

/** Human-readable size estimate for a replay payload. */
export function estimateReplayBytes(durationMs: number, sampleHz = POV_REPLAY_SAMPLE_HZ): number {
  const samples = Math.ceil((durationMs / 1000) * sampleHz);
  // Measured average for the quantised stride below.
  return Math.round(samples * 66 + 400);
}

/** Quantises one sample into the flat array (used by the recorder). */
export function writeSample(
  out: number[],
  tMs: number,
  pos: { x: number; y: number; z: number },
  vel: { x: number; y: number; z: number },
  yaw: number,
  pitch: number,
  grounded: boolean,
  surfing: boolean,
  surfSide: number
): void {
  out.push(
    Math.round(tMs),
    round(pos.x, 3),
    round(pos.y, 3),
    round(pos.z, 3),
    round(vel.x, 2),
    round(vel.y, 2),
    round(vel.z, 2),
    round(yaw, 4),
    round(pitch, 4),
    encodeState(grounded, surfing, surfSide)
  );
}