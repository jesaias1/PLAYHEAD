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
