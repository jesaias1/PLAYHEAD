/**
 * Deterministic hashing utilities for audio data and track seeds
 */

export function murmurHash3(key: string | Uint8Array, seed = 0): number {
  let h = seed >>> 0;

  if (typeof key === 'string') {
    const bytes = new TextEncoder().encode(key);
    return murmurHash3Bytes(bytes, h);
  } else {
    return murmurHash3Bytes(key, h);
  }
}

function murmurHash3Bytes(data: Uint8Array, seed: number): number {
  let h = seed >>> 0;
  const len = data.length;
  const nblocks = Math.floor(len / 4);

  for (let i = 0; i < nblocks; i++) {
    const idx = i * 4;
    let k = (data[idx]) |
            (data[idx + 1] << 8) |
            (data[idx + 2] << 16) |
            (data[idx + 3] << 24);

    k = Math.imul(k, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);

    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = Math.imul(h, 5) + 0xe6546b64;
  }

  const rem = len % 4;
  const idx = nblocks * 4;
  let k1 = 0;

  if (rem === 3) k1 ^= data[idx + 2] << 16;
  if (rem >= 2) k1 ^= data[idx + 1] << 8;
  if (rem >= 1) {
    k1 ^= data[idx];
    k1 = Math.imul(k1, 0xcc9e2d51);
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = Math.imul(k1, 0x1b873593);
    h ^= k1;
  }

  h ^= len;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;

  return h >>> 0;
}

export function seedToHex(seed: number): string {
  return (seed >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

/**
 * Robust content-derived hash of the decoded PCM buffer.
 *
 * This intentionally excludes filename, duration-derived metadata and any
 * mutable display field: the same audio bytes renamed must produce the same
 * seed. It walks the full channel-0 buffer in a bounded, cheap pass by hashing
 * a bounded number of sample windows, which makes it stable across decode
 * differences in metadata while remaining O(n) with a small constant.
 */
export function hashAudioContent(buffer: AudioBuffer): number {
  // Format + duration + channel count are part of identity: a constant 1 s clip
  // and a constant 60 s clip, or identical left channels with different right
  // channels, must never collide. ALL channels are sampled, each in its own
  // bounded set of windows, so a difference confined to one channel still
  // changes the fingerprint.
  const channels = Math.max(1, buffer.numberOfChannels | 0);
  const length = Math.max(0, buffer.length | 0);
  const windowsPerChannel = 2048;
  const bytesPerChannel = windowsPerChannel * 4;
  const headerBytes = 24;
  const bytes = new Uint8Array(headerBytes + channels * bytesPerChannel);

  const view = new DataView(bytes.buffer);
  view.setFloat64(0, buffer.duration || 0, true);
  view.setFloat64(8, buffer.sampleRate || 0, true);
  view.setUint32(16, length >>> 0, true);
  view.setUint32(20, channels >>> 0, true);

  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    const sampleCount = Math.min(windowsPerChannel, data.length);
    const stride = Math.max(1, Math.floor(data.length / Math.max(1, sampleCount)));
    const channelOffset = headerBytes + c * bytesPerChannel;
    for (let i = 0; i < sampleCount; i++) {
      const raw = data[i * stride];
      const val = Number.isFinite(raw) ? raw : 0;
      // Map -1..1 float to a 32-bit lane so tiny differences survive.
      const intVal = Math.floor((Math.max(-1, Math.min(1, val)) + 1.0) * 2147483647.5) >>> 0;
      const o = channelOffset + i * 4;
      bytes[o] = intVal & 0xff;
      bytes[o + 1] = (intVal >>> 8) & 0xff;
      bytes[o + 2] = (intVal >>> 16) & 0xff;
      bytes[o + 3] = (intVal >>> 24) & 0xff;
    }
  }

  return murmurHash3(bytes, 0x9e3779b9) >>> 0;
}

/**
 * Hex SHA-256 of encoded source bytes, when a WebCrypto digest is available.
 * Returns null when crypto.subtle is unavailable so callers can fall back to
 * the decoded-PCM content hash.
 */
export async function hashEncodedSha256(bytes: ArrayBuffer): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof subtle.digest !== 'function') return null;
    const digest = await subtle.digest('SHA-256', bytes);
    const view = new Uint8Array(digest);
    let out = '';
    for (let i = 0; i < view.length; i++) {
      out += view[i].toString(16).padStart(2, '0');
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Generate a deterministic seed from an AudioBuffer
 * Uses duration, sampleRate, number of channels, and a sparse sample of the PCM data
 */
export function hashAudioBuffer(buffer: AudioBuffer, filename = ''): number {
  const channelData = buffer.getChannelData(0);
  const sampleCount = Math.min(2048, channelData.length);
  const stride = Math.max(1, Math.floor(channelData.length / sampleCount));

  const sampleBytes = new Uint8Array(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    const val = channelData[i * stride];
    // Map -1..1 float to 0..65535 uint16
    const intVal = Math.floor((val + 1.0) * 32767.5);
    sampleBytes[i * 2] = intVal & 0xff;
    sampleBytes[i * 2 + 1] = (intVal >> 8) & 0xff;
  }

  // Combine audio samples with duration and filename
  let seed = murmurHash3(sampleBytes, 0x1337);
  const meta = `${filename}_${buffer.duration.toFixed(3)}_${buffer.sampleRate}_${buffer.numberOfChannels}`;
  seed = murmurHash3(meta, seed);

  return seed >>> 0;
}

/** Deterministic 32-bit seed from a hex hash string (FNV-1a). */
export function murmurSeedFromString(hex: string): number {
  let seed = 2166136261 >>> 0;
  for (let i = 0; i < hex.length; i++) {
    seed ^= hex.charCodeAt(i);
    seed = Math.imul(seed, 16777619) >>> 0;
  }
  return seed >>> 0;
}

export interface CustomContentIdentity {
  /** Filename-independent identity: SHA-256 of the encoded bytes when available, else the PCM fingerprint. */
  contentHash: string;
  /** Deterministic seed derived from the same identity. */
  seed: number;
  hashSource: 'ENCODED_SHA256' | 'PCM';
  byteLength: number;
}

/**
 * Single source of truth for custom-audio content identity, shared by Game
 * (pre-analysis cache lookup) and AudioAnalyzer (analysis-time provenance) so
 * the two can never disagree and the analyzer is never run twice for one file.
 */
export async function computeCustomContentIdentity(
  buffer: AudioBuffer,
  encodedBytes?: ArrayBuffer | null
): Promise<CustomContentIdentity> {
  const encodedSha = encodedBytes ? await hashEncodedSha256(encodedBytes) : null;
  const pcmHash = hashAudioContent(buffer) >>> 0;
  const contentHash = encodedSha ?? pcmHash.toString(16).padStart(8, '0');
  const seed = encodedSha ? murmurSeedFromString(encodedSha) >>> 0 : pcmHash;
  return {
    contentHash,
    seed,
    hashSource: encodedSha ? 'ENCODED_SHA256' : 'PCM',
    byteLength: encodedBytes?.byteLength ?? 0
  };
}
