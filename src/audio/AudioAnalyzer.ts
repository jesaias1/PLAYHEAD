/**
 * DSP Audio Analyzer for TRACK//RUN
 * Performs real client-side PCM analysis, FFT, spectral flux,
 * onset detection, tempo autocorrelation, and section segmentation.
 */

import { AnalysisFrame, AnalysisSection, CustomAggregate, CustomSourceMeta, OnsetEvent, SectionConfidence, SectionTheme, TrackAnalysis, VisualAccent } from './AudioFeatures';
import { computeCustomContentIdentity, CustomContentIdentity, hashAudioBuffer } from '../utils/hash';
import { clamp } from '../utils/math';

export interface AnalyzeOptions {
  /**
   * Marks this buffer as player-supplied custom audio. Only the custom path
   * receives content-derived provenance and the custom macro section model;
   * official precomputed presets call analyze() without it.
   */
  custom?: {
    source: CustomSourceMeta['source'];
    encodedBytes?: ArrayBuffer | null;
  };
  /**
   * Precomputed content identity (shared with Game's cache lookup) so the
   * analyzer never hashes the same bytes twice. When absent the analyzer
   * derives it from the buffer / encoded bytes itself.
   */
  contentIdentity?: CustomContentIdentity;
}

const CURATED_ACCENTS: VisualAccent[] = [
  { name: 'Icy Cyan', hex: '#00f0ff', rgb: [0, 240, 255] },
  { name: 'Electric Blue', hex: '#0077ff', rgb: [0, 119, 255] },
  { name: 'Acid Green', hex: '#39ff14', rgb: [57, 255, 20] },
  { name: 'Amber Gold', hex: '#ffb703', rgb: [255, 183, 3] },
  { name: 'Crimson Edge', hex: '#ff0055', rgb: [255, 0, 85] },
  { name: 'Ultraviolet', hex: '#bd00ff', rgb: [189, 0, 255] },
  { name: 'Cold White', hex: '#e2e8f0', rgb: [226, 232, 240] }
];

export class AudioAnalyzer {
  public static async analyze(
    buffer: AudioBuffer,
    filename: string,
    onProgress?: (stage: string, progress: number) => void,
    options?: AnalyzeOptions
  ): Promise<TrackAnalysis> {
    const duration = buffer.duration;
    if (duration < 1) {
      throw new Error('Audio file too short (minimum 1 second required)');
    }

    onProgress?.('DECODING SIGNAL', 0.1);
    await yieldThread();

    // 1. Mono downmix and optional downsampling
    const sampleRate = buffer.sampleRate;
    const channel0 = buffer.getChannelData(0);
    const hasChannel1 = buffer.numberOfChannels > 1;
    const channel1 = hasChannel1 ? buffer.getChannelData(1) : null;
    const totalSamples = buffer.length;

    const monoData = new Float32Array(totalSamples);
    if (channel1) {
      for (let i = 0; i < totalSamples; i++) {
        monoData[i] = (channel0[i] + channel1[i]) * 0.5;
      }
    } else {
      monoData.set(channel0);
    }

    // 2. Waveform summary for UI (512 peak-envelope points)
    const waveform = computeWaveformEnvelope(monoData, 512);

    // 3. FFT Windowing parameters
    // Frame size 2048 at ~44.1kHz gives ~46ms resolution; hop size 512 gives ~11.6ms hop (~86 fps)
    const fftSize = 2048;
    const hopSize = 512;
    const numFrames = Math.floor((totalSamples - fftSize) / hopSize);

    if (numFrames <= 0) {
      throw new Error('Audio file too short for analysis window');
    }

    onProgress?.('ANALYSING TRANSIENTS', 0.25);
    await yieldThread();

    // Precompute Hann window
    const hann = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
    }

    // Frequency bin boundaries (Hz to bin index)
    const binFreq = sampleRate / fftSize;
    const bassEndBin = Math.min(Math.floor(250 / binFreq), fftSize / 2);
    const lowMidEndBin = Math.min(Math.floor(800 / binFreq), fftSize / 2);
    const midEndBin = Math.min(Math.floor(2500 / binFreq), fftSize / 2);
    const highEndBin = Math.floor(fftSize / 2);

    const rawRms = new Float32Array(numFrames);
    const rawBass = new Float32Array(numFrames);
    const rawLowMid = new Float32Array(numFrames);
    const rawMid = new Float32Array(numFrames);
    const rawHigh = new Float32Array(numFrames);
    const rawCentroid = new Float32Array(numFrames);
    const rawFlux = new Float32Array(numFrames);

    const real = new Float32Array(fftSize);
    const imag = new Float32Array(fftSize);
    const prevMag = new Float32Array(fftSize / 2);
    const currentMag = new Float32Array(fftSize / 2);

    for (let f = 0; f < numFrames; f++) {
      const offset = f * hopSize;

      // Extract windowed frame & calculate RMS
      let sumSq = 0;
      for (let i = 0; i < fftSize; i++) {
        const val = monoData[offset + i] * hann[i];
        real[i] = val;
        imag[i] = 0;
        sumSq += val * val;
      }
      rawRms[f] = Math.sqrt(sumSq / fftSize);

      // In-place Radix-2 FFT
      computeFFT(real, imag);

      // Half-spectrum magnitudes
      let centroidNum = 0;
      let centroidDenom = 0;
      let frameFlux = 0;
      let bassSum = 0;
      let lowMidSum = 0;
      let midSum = 0;
      let highSum = 0;

      const half = fftSize / 2;
      for (let i = 0; i < half; i++) {
        const mag = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
        currentMag[i] = mag;

        // Spectral flux (half-wave rectified difference)
        const diff = mag - prevMag[i];
        if (diff > 0) frameFlux += diff;

        // Centroid
        centroidNum += i * binFreq * mag;
        centroidDenom += mag;

        // Bands
        if (i < bassEndBin) {
          bassSum += mag;
        } else if (i < lowMidEndBin) {
          lowMidSum += mag;
        } else if (i < midEndBin) {
          midSum += mag;
        } else if (i < highEndBin) {
          highSum += mag;
        }
      }

      rawFlux[f] = frameFlux;
      rawCentroid[f] = centroidDenom > 0 ? centroidNum / centroidDenom : 0;
      rawBass[f] = bassSum;
      rawLowMid[f] = lowMidSum;
      rawMid[f] = midSum;
      rawHigh[f] = highSum;

      prevMag.set(currentMag);

      if (f % 500 === 0 && f > 0) {
        onProgress?.('ANALYSING TRANSIENTS', 0.25 + (f / numFrames) * 0.25);
        await yieldThread();
      }
    }

    onProgress?.('MAPPING ENERGY', 0.55);
    await yieldThread();

    // 4. Robust track-relative normalization using 95th percentile
    const normRms = normalizePercentile(rawRms, 0.95);
    const normBass = normalizePercentile(rawBass, 0.95);
    const normLowMid = normalizePercentile(rawLowMid, 0.95);
    const normMid = normalizePercentile(rawMid, 0.95);
    const normHigh = normalizePercentile(rawHigh, 0.95);
    const normCentroid = normalizePercentile(rawCentroid, 0.95);
    const normFlux = normalizePercentile(rawFlux, 0.95);
    if (options?.custom) {
      // Relative spectral change rejects FFT leakage from sustained tones;
      // percentile normalization alone amplifies tiny fluctuations into beats.
      for (let f = 0; f < numFrames; f++) {
        const spectralMass = rawBass[f] + rawLowMid[f] + rawMid[f] + rawHigh[f];
        normFlux[f] = clamp(rawFlux[f] / Math.max(1e-6, spectralMass) * 4, 0, 1);
        normCentroid[f] = clamp(rawCentroid[f] / 4000, 0, 1);
      }
    }

    // 5. Onset Peak-Picking
    onProgress?.('FINDING ONSETS', 0.7);
    await yieldThread();

    const onsets: OnsetEvent[] = [];
    const windowSec = hopSize / sampleRate;
    const thresholdWindow = Math.floor(0.2 / windowSec); // ~200ms moving window for dynamic threshold

    for (let f = 2; f < numFrames - 2; f++) {
      const val = normFlux[f];
      if (val < 0.15) continue; // Noise floor

      // Local peak test
      if (val > normFlux[f - 1] && val > normFlux[f - 2] &&
          val >= normFlux[f + 1] && val >= normFlux[f + 2]) {

        // Compare against local moving average
        let localSum = 0;
        let count = 0;
        const start = Math.max(0, f - thresholdWindow);
        const end = Math.min(numFrames, f + thresholdWindow);
        for (let j = start; j < end; j++) {
          localSum += normFlux[j];
          count++;
        }
        const localAvg = localSum / count;

        if (val > localAvg * 1.35) {
          const time = f * windowSec;
          onsets.push({
            time,
            strength: val,
            bass: normBass[f],
            mids: normMid[f],
            highs: normHigh[f]
          });
        }
      }
    }

    // 6. Rhythmic density curve (onsets per second in a 2.0s sliding window)
    const density = new Float32Array(numFrames);
    let onsetPtrStart = 0;
    let onsetPtrEnd = 0;

    for (let f = 0; f < numFrames; f++) {
      const t = f * windowSec;
      while (onsetPtrStart < onsets.length && onsets[onsetPtrStart].time < t - 1.0) {
        onsetPtrStart++;
      }
      while (onsetPtrEnd < onsets.length && onsets[onsetPtrEnd].time <= t + 1.0) {
        onsetPtrEnd++;
      }
      const count = onsetPtrEnd - onsetPtrStart;
      density[f] = clamp(count / 10, 0, 1); // 10 onsets/2s = 5/s = high density
    }

    // 7. Tempo / BPM Estimation via Autocorrelation
    onProgress?.('ESTIMATING TEMPO', 0.82);
    await yieldThread();

    const tempo = estimateBPM(normFlux, windowSec);
    const bpm = tempo.bpm;
    const bpmConfidence = options?.custom && onsets.length < Math.max(4, duration * 0.1)
      ? Math.min(0.2, tempo.confidence)
      : tempo.confidence;

    // 8. Assemble Analysis Frames
    const frames: AnalysisFrame[] = new Array(numFrames);
    let globalEnergySum = 0;
    for (let f = 0; f < numFrames; f++) {
      frames[f] = {
        time: f * windowSec,
        rms: normRms[f],
        bass: normBass[f],
        lowMid: normLowMid[f],
        mid: normMid[f],
        high: normHigh[f],
        centroid: normCentroid[f],
        flux: normFlux[f],
        density: density[f]
      };
      globalEnergySum += normRms[f];
    }
    const relativeEnergy = globalEnergySum / numFrames;
    const globalEnergy = options?.custom
      ? clamp(relativeEnergy * 0.45 + mean(density) * 0.35 + mean(normFlux) * 0.2, 0, 1)
      : relativeEnergy;

    // 9. Section Boundary Detection (4-10 coherent sections)
    onProgress?.('FINDING SECTIONS', 0.92);
    await yieldThread();

    const isCustom = options?.custom != null;
    const sections = isCustom
      ? detectCustomSections(frames, duration, normBass)
      : detectSections(frames, duration);

    // 10. Deterministic seed & curated accent color.
    // The custom path derives identity from CONTENT (encoded bytes when
    // available, otherwise decoded PCM), never from the filename, so renaming
    // a file cannot change its geometry. Official presets keep the legacy
    // hashAudioBuffer contract.
    let customSource: CustomSourceMeta | undefined;
    let customAggregate: CustomAggregate | undefined;
    let seed: number;
    if (isCustom && options?.custom) {
      const identity = options.contentIdentity ?? (await computeCustomContentIdentity(buffer, options.custom.encodedBytes));
      seed = identity.seed;
      customSource = {
        source: options.custom.source,
        displayName: filename,
        contentHash: identity.contentHash,
        byteLength: identity.byteLength,
        hashSource: identity.hashSource
      };
      customAggregate = computeCustomAggregate(frames, normBass, normHigh);
    } else {
      seed = hashAudioBuffer(buffer, filename);
    }
    const accentIndex = Math.abs(seed) % CURATED_ACCENTS.length;
    const visualAccent = CURATED_ACCENTS[accentIndex];

    onProgress?.('ANALYSIS COMPLETE', 1.0);
    await yieldThread();

    return {
      filename,
      duration,
      bpm,
      bpmConfidence,
      globalEnergy,
      frames,
      onsets,
      sections,
      waveform,
      seed,
      visualAccent,
      ...(customAggregate ? { customAggregate } : {}),
      ...(customSource ? { customSource } : {})
    };
  }
}

/**
 * Radix-2 In-Place Cooley-Tukey FFT
 */
function computeFFT(real: Float32Array, imag: Float32Array): void {
  const n = real.length;

  // Bit reversal permutation
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const tr = real[i];
      real[i] = real[j];
      real[j] = tr;

      const ti = imag[i];
      imag[i] = imag[j];
      imag[j] = ti;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  // Butterfly computation
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wStepR = Math.cos(angle);
    const wStepI = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      for (let k = 0; k < half; k++) {
        const idxEven = i + k;
        const idxOdd = idxEven + half;

        const tr = wr * real[idxOdd] - wi * imag[idxOdd];
        const ti = wr * imag[idxOdd] + wi * real[idxOdd];

        real[idxOdd] = real[idxEven] - tr;
        imag[idxOdd] = imag[idxEven] - ti;
        real[idxEven] += tr;
        imag[idxEven] += ti;

        const nextWr = wr * wStepR - wi * wStepI;
        wi = wr * wStepI + wi * wStepR;
        wr = nextWr;
      }
    }
  }
}

/**
 * Percentile-based normalization (robust against outlier transients)
 */
function normalizePercentile(array: Float32Array, percentile: number): Float32Array {
  const sorted = new Float32Array(array).sort();
  const pIdx = Math.min(sorted.length - 1, Math.floor(sorted.length * percentile));
  const maxVal = Math.max(1e-5, sorted[pIdx]);

  const result = new Float32Array(array.length);
  for (let i = 0; i < array.length; i++) {
    result[i] = clamp(array[i] / maxVal, 0, 1);
  }
  return result;
}

/**
 * Compute waveform peak envelope for UI
 */
function computeWaveformEnvelope(monoData: Float32Array, buckets: number): Float32Array {
  const env = new Float32Array(buckets);
  const step = Math.floor(monoData.length / buckets);
  let maxPeak = 1e-4;

  for (let b = 0; b < buckets; b++) {
    let peak = 0;
    const start = b * step;
    const end = Math.min(monoData.length, start + step);
    for (let i = start; i < end; i++) {
      const abs = Math.abs(monoData[i]);
      if (abs > peak) peak = abs;
    }
    env[b] = peak;
    if (peak > maxPeak) maxPeak = peak;
  }

  // Normalize
  for (let b = 0; b < buckets; b++) {
    env[b] = clamp(env[b] / maxPeak, 0, 1);
  }
  return env;
}

/**
 * Estimate BPM using autocorrelation of the onset/flux envelope
 */
function estimateBPM(flux: Float32Array, windowSec: number): { bpm: number; confidence: number } {
  // Clamp search to 65 .. 190 BPM
  const minLag = Math.floor(60 / (190 * windowSec));
  const maxLag = Math.floor(60 / (65 * windowSec));

  const maxOffset = Math.min(flux.length - maxLag, Math.floor(60 / windowSec)); // Examine up to ~60s
  if (maxOffset <= 0) {
    return { bpm: 120, confidence: 0.1 };
  }

  let bestLag = minLag;
  let bestScore = -1;
  const scores = new Float32Array(maxLag - minLag + 1);

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < maxOffset; i++) {
      sum += flux[i] * flux[i + lag];
    }
    const idx = lag - minLag;
    scores[idx] = sum;
    if (sum > bestScore) {
      bestScore = sum;
      bestLag = lag;
    }
  }

  const detectedBpm = Math.round(60 / (bestLag * windowSec));

  // Compute confidence relative to mean autocorrelation
  let meanScore = 0;
  for (let i = 0; i < scores.length; i++) meanScore += scores[i];
  meanScore /= scores.length;

  const confidence = clamp(bestScore / (meanScore * 2 + 1e-5), 0, 1);

  // Normalize to standard tempo range if half/double
  let finalBpm = detectedBpm;
  if (finalBpm < 75 && finalBpm * 2 <= 190) finalBpm *= 2;
  if (finalBpm > 170 && finalBpm / 2 >= 65) finalBpm = Math.round(finalBpm / 2);

  return { bpm: finalBpm, confidence };
}

/**
 * Segment track into 4-10 coherent macro sections
 */
function detectSections(frames: AnalysisFrame[], duration: number): AnalysisSection[] {
  // 1. Calculate moving average energy across track (4-second window)
  const windowFrames = Math.max(1, Math.floor(frames.length * (4.0 / Math.max(1, duration))));
  const smoothedEnergy = new Float32Array(frames.length);

  for (let i = 0; i < frames.length; i++) {
    let sum = 0;
    let count = 0;
    const start = Math.max(0, i - windowFrames);
    const end = Math.min(frames.length, i + windowFrames);
    for (let j = start; j < end; j++) {
      sum += frames[j].rms;
      count++;
    }
    smoothedEnergy[i] = count > 0 ? sum / count : 0.5;
  }

  // 2. Find points of significant energy change (derivatives)
  const candidateTimes: number[] = [0];
  const minSectionDuration = 14.0; // Minimum 14s between major section boundaries

  for (let i = windowFrames; i < frames.length - windowFrames; i += Math.floor(windowFrames * 0.5)) {
    const prevE = smoothedEnergy[i - Math.floor(windowFrames * 0.5)];
    const currE = smoothedEnergy[i];
    const diff = Math.abs(currE - prevE);
    const currentTime = frames[i].time;

    // Significant energy delta (>0.2) and spaced far enough from last boundary
    if (diff > 0.22 && (currentTime - candidateTimes[candidateTimes.length - 1]) >= minSectionDuration) {
      if (duration - currentTime >= minSectionDuration) {
        candidateTimes.push(currentTime);
      }
    }
  }

  // Fallback: If track has uniform energy, subdivide evenly
  if (candidateTimes.length < 3) {
    const targetCount = clamp(Math.round(duration / 25), 4, 8);
    candidateTimes.length = 0;
    for (let i = 0; i < targetCount; i++) {
      candidateTimes.push(i * (duration / targetCount));
    }
  }

  candidateTimes.push(duration);

  // 3. Build section objects with musical metrics
  const sections: AnalysisSection[] = [];

  for (let i = 0; i < candidateTimes.length - 1; i++) {
    const start = candidateTimes[i];
    const end = candidateTimes[i + 1];
    const dur = end - start;

    let intensitySum = 0;
    let densitySum = 0;
    let brightnessSum = 0;
    let count = 0;

    for (let f = 0; f < frames.length; f++) {
      const t = frames[f].time;
      if (t >= start && t <= end) {
        intensitySum += frames[f].rms;
        densitySum += frames[f].density;
        brightnessSum += frames[f].centroid;
        count++;
      }
    }

    const intensity = count > 0 ? intensitySum / count : 0.5;
    const rhythmicDensity = count > 0 ? densitySum / count : 0.5;
    const brightness = count > 0 ? brightnessSum / count : 0.5;

    // Check energy change from previous section
    const prevIntensity = i > 0 ? sections[i - 1].intensity : intensity;
    const intensityDelta = intensity - prevIntensity;

    let theme: SectionTheme = 'FLOW';
    if (i === 0) {
      theme = 'FLOW'; // Always start with safe readable flow
    } else if (intensityDelta > 0.35 && intensity > 0.65) {
      theme = 'DROP'; // Explosive drop!
    } else if (i < candidateTimes.length - 2 && (smoothedEnergy[Math.min(frames.length - 1, Math.floor((end + 4) * (frames.length / duration)))] - intensity) > 0.3) {
      theme = 'BUILDUP'; // Leading into a drop
    } else if (intensity < 0.28) {
      theme = 'BREATH';
    } else if (intensity > 0.72) {
      theme = 'SPEED';
    } else if (brightness > 0.65) {
      theme = 'SURF';
    } else if (i % 2 === 1) {
      theme = 'ASCENT';
    } else {
      theme = 'PRECISION';
    }

    sections.push({
      index: i,
      start,
      end,
      duration: dur,
      intensity,
      rhythmicDensity,
      brightness,
      theme
    });
  }

  return sections;
}

/**
 * Aggregate motion summary used by the custom visual profile. Bounded O(n) —
 * a single pass over frames, plus a percentile pass over a copy of rms.
 */
function computeCustomAggregate(
  frames: AnalysisFrame[],
  bass: Float32Array,
  high: Float32Array
): CustomAggregate {
  const n = frames.length;
  if (n === 0) {
    return { bass: 0.4, brightness: 0.5, density: 0.25, dynamics: 0.25, contrast: 0.4 };
  }

  let rmsSum = 0;
  let centroidSum = 0;
  let densitySum = 0;
  let bassSum = 0;
  let highSum = 0;
  for (let i = 0; i < n; i++) {
    rmsSum += frames[i].rms;
    centroidSum += frames[i].centroid;
    densitySum += frames[i].density;
  }

  const rmsValues = new Float32Array(n);
  for (let i = 0; i < n; i++) rmsValues[i] = frames[i].rms;
  rmsValues.sort();
  const p10 = rmsValues[Math.floor(n * 0.1)];
  const p90 = rmsValues[Math.floor(n * 0.9)];

  for (let i = 0; i < bass.length; i++) bassSum += bass[i];
  for (let i = 0; i < high.length; i++) highSum += high[i];

  return {
    bass: clamp(bassSum / bass.length, 0, 1),
    brightness: clamp(centroidSum / n, 0, 1),
    density: clamp(densitySum / n, 0, 1),
    dynamics: clamp(p90 - p10, 0, 1),
    contrast: clamp(Math.abs(highSum / high.length - bassSum / bass.length), 0, 1)
  };
}

/**
 * CUSTOM section model: bounded O(n) macro descriptors with honest, data-driven
 * intensity/brightness/density/energy-trend scoring. Unlike the official
 * detector it never fabricates evenly-spaced "pop" sections, never assigns
 * arbitrary alternating ASCENT/PRECISION indices, and collapses constant /
 * ambient input to a broad, safe BREATH/FLOW shape.
 */
function detectCustomSections(
  frames: AnalysisFrame[],
  duration: number,
  bass: Float32Array
): AnalysisSection[] {
  if (frames.length === 0 || duration <= 0) {
    return [{
      index: 0,
      start: 0,
      end: Math.max(1, duration),
      duration: Math.max(1, duration),
      intensity: 0.4,
      rhythmicDensity: 0.2,
      brightness: 0.5,
      theme: 'FLOW'
    }];
  }

  const windowSec = 3.0;
  const windowFrames = Math.max(1, Math.round(windowSec / Math.max(1e-3, frames[1] ? frames[1].time - frames[0].time : 0.02)));
  const minSection = Math.min(Math.max(6.0, duration * 0.08), 24.0);
  const targetSections = clamp(Math.round(duration / 24), 3, 9);

  // Local descriptor windows.
  const windowCount = Math.max(1, Math.ceil(frames.length / windowFrames));
  const winRms = new Float32Array(windowCount);
  const winBass = new Float32Array(windowCount);
  const winBright = new Float32Array(windowCount);
  const winFlux = new Float32Array(windowCount);
  const winDensity = new Float32Array(windowCount);
  const winStart = new Float32Array(windowCount);

  for (let w = 0; w < windowCount; w++) {
    const start = w * windowFrames;
    const end = Math.min(frames.length, start + windowFrames);
    let rmsSum = 0, brightSum = 0, fluxSum = 0, denSum = 0, bassSum = 0, count = 0;
    for (let i = start; i < end; i++) {
      rmsSum += frames[i].rms;
      brightSum += frames[i].centroid;
      fluxSum += frames[i].flux;
      denSum += frames[i].density;
      if (i < bass.length) bassSum += bass[i];
      count++;
    }
    const inv = count > 0 ? 1 / count : 0;
    winRms[w] = rmsSum * inv;
    winBright[w] = brightSum * inv;
    winFlux[w] = fluxSum * inv;
    winDensity[w] = denSum * inv;
    winBass[w] = bassSum * inv;
    winStart[w] = frames[Math.min(frames.length - 1, start)].time;
  }

  const globalRms = mean(winRms);
  const rmsSpread = Math.sqrt(variance(winRms, globalRms));
  const fluxMean = mean(winFlux);
  const densityMean = mean(winDensity);
  const brightMean = mean(winBright);
  const broadAggregate = {
    intensity: clamp(globalRms, 0, 1),
    density: clamp(densityMean, 0, 1),
    brightness: clamp(brightMean, 0, 1),
    dynamics: clamp(Math.min(1, rmsSpread * 6), 0, 1)
  };

  // Constantness test: flat energy, low dynamics and negligible flux => broad safe shape.
  const flatEnergy = rmsSpread < 0.035;
  const lowFlux = fluxMean < 0.05;
  const lowDensity = densityMean < 0.12;
  if (flatEnergy && lowFlux && lowDensity) {
    return broadSafeSections(duration, broadAggregate);
  }

  // ---- Boundary ranking --------------------------------------------------
  // Score every plausible boundary by the macro contrast between the windows
  // immediately before and after it, then rank ALL supported candidates and
  // greedily select a spaced chronological subset. This preserves early
  // build/drop/release transitions instead of letting a single late change
  // dominate a greedy earliest-first scan.
  const minSectionFrames = Math.max(1, Math.round(minSection / windowSec));
  const halfWindow = Math.max(1, Math.round(minSectionFrames / 2));
  const maxSections = Math.max(2, targetSections);

  interface BoundaryCandidate { index: number; score: number; }
  const boundaryCandidates: BoundaryCandidate[] = [];
  for (let w = halfWindow + 1; w < windowCount - halfWindow; w++) {
    const beforeRms = averageWindowRange(winRms, w - halfWindow, w);
    const afterRms = averageWindowRange(winRms, w, w + halfWindow);
    const energyDelta = Math.abs(afterRms - beforeRms) / Math.max(0.05, globalRms);
    const bassDelta = Math.abs(
      averageWindowRange(winBass, w, w + halfWindow) - averageWindowRange(winBass, w - halfWindow, w)
    );
    const brightDelta = Math.abs(
      averageWindowRange(winBright, w, w + halfWindow) - averageWindowRange(winBright, w - halfWindow, w)
    );
    const densityDelta = Math.abs(
      averageWindowRange(winDensity, w, w + halfWindow) - averageWindowRange(winDensity, w - halfWindow, w)
    );
    const score = energyDelta * 1.6 + bassDelta * 0.7 + brightDelta * 0.5 + densityDelta * 0.6;
    // A boundary needs a real energy step or a strong combined change; tiny
    // spectral wobble must not manufacture fake precision.
    if (score >= 0.18 && energyDelta >= 0.1) {
      boundaryCandidates.push({ index: w, score });
    }
  }
  boundaryCandidates.sort((a, b) => b.score - a.score);

  const boundaryWindows: number[] = [];
  for (const cand of boundaryCandidates) {
    if (boundaryWindows.length >= maxSections - 1) break;
    const tooClose = boundaryWindows.some((b) => Math.abs(b - cand.index) < minSectionFrames);
    if (!tooClose) boundaryWindows.push(cand.index);
  }
  boundaryWindows.sort((a, b) => a - b);

  const scoreForWindow = (w: number): number => {
    const match = boundaryCandidates.find((c) => c.index === w);
    return match ? match.score : 0;
  };

  // ---- Segment aggregates from real windows ------------------------------
  const segmentRanges: { startW: number; endW: number }[] = [];
  let prevBoundary = 0;
  for (const b of boundaryWindows) {
    if (b > prevBoundary) segmentRanges.push({ startW: prevBoundary, endW: b });
    prevBoundary = b;
  }
  segmentRanges.push({ startW: prevBoundary, endW: windowCount });

  const aggregates = segmentRanges.map(({ startW, endW }) => {
    let intensity = 0, brightness = 0, density = 0, bassAvg = 0;
    for (let w = startW; w < endW; w++) {
      intensity += winRms[w];
      brightness += winBright[w];
      density += winDensity[w];
      bassAvg += winBass[w];
    }
    const invW = endW > startW ? 1 / (endW - startW) : 0;
    return {
      startW,
      endW,
      intensity: clamp(intensity * invW, 0, 1),
      brightness: clamp(brightness * invW, 0, 1),
      density: clamp(density * invW, 0, 1),
      bassAvg: clamp(bassAvg * invW, 0, 1)
    };
  });

  // ---- Honest themes -----------------------------------------------------
  // A final high-energy portion is a traversal intent, not a forced calm BREATH.
  // BREATH is only assigned when the segment is genuinely quiet.
  const quietThreshold = Math.max(0.18, globalRms * 0.55);
  const sections: AnalysisSection[] = [];
  for (let i = 0; i < aggregates.length; i++) {
    const agg = aggregates[i];
    const start = i === 0 ? 0 : winStart[agg.startW];
    const end = agg.endW >= windowCount ? duration : winStart[agg.endW];
    const dur = Math.max(0.5, end - start);

    const isFirst = i === 0;
    const isLast = i === aggregates.length - 1;
    const prevIntensity = i > 0 ? aggregates[i - 1].intensity : agg.intensity;
    const trend = agg.intensity - prevIntensity;
    // The next segment's OWN average over its whole window range (never a
    // single boundary window).
    const nextIntensity = !isLast ? aggregates[i + 1].intensity : agg.intensity;

    let theme: SectionTheme;
    if (isFirst) theme = 'FLOW';
    else if (agg.intensity < quietThreshold && agg.density < 0.3) theme = 'BREATH';
    else if (trend > 0.06 && nextIntensity > agg.intensity + 0.02 && agg.intensity > 0.5) theme = 'BUILDUP';
    else if (trend > 0.12 && agg.intensity > 0.7) theme = 'DROP';
    else if (agg.bassAvg > 0.6 && agg.density > 0.4) theme = 'SPEED';
    else if (agg.brightness > 0.62 && agg.density >= 0.16) theme = 'SURF';
    else if (agg.density > 0.45 || isLast) theme = 'FLOW';
    else theme = 'PRECISION';

    const boundaryScore = isFirst ? 0 : scoreForWindow(agg.startW);
    const separation =
      Math.abs(agg.intensity - globalRms) / Math.max(0.05, globalRms) +
      Math.abs(agg.density - densityMean) +
      Math.abs(agg.brightness - brightMean);
    const confidence: SectionConfidence = {
      boundary: clamp(boundaryScore / 0.4, 0, 1),
      descriptor: clamp(0.2 + separation * 0.8 + rmsSpread * 4, 0, 1)
    };

    sections.push({
      index: i,
      start,
      end,
      duration: dur,
      intensity: agg.intensity,
      rhythmicDensity: agg.density,
      brightness: agg.brightness,
      theme,
      confidence
    });
  }

  if (sections.length === 0) return broadSafeSections(duration, broadAggregate);
  return sections;
}

/**
 * Broad low-information fallback for flat / ambient / constant input. It
 * deliberately reuses the REAL aggregate descriptors instead of inventing
 * precision, always opens with a safe onboarding FLOW window, and marks every
 * segment as low-confidence so downstream code can treat it honestly.
 */
function broadSafeSections(
  duration: number,
  aggregate: { intensity: number; density: number; brightness: number; dynamics: number } = {
    intensity: 0.35,
    density: 0.12,
    brightness: 0.5,
    dynamics: 0.05
  }
): AnalysisSection[] {
  const count = clamp(Math.round(duration / 40), 2, 4);
  const sections: AnalysisSection[] = [];
  for (let i = 0; i < count; i++) {
    const start = (i / count) * duration;
    const end = ((i + 1) / count) * duration;
    sections.push({
      index: i,
      start,
      end,
      duration: end - start,
      intensity: aggregate.intensity,
      rhythmicDensity: aggregate.density,
      brightness: aggregate.brightness,
      theme: i === 0 ? 'FLOW' : 'BREATH',
      confidence: { boundary: 0, descriptor: clamp(0.35 - aggregate.dynamics * 2, 0, 0.5) }
    });
  }
  return sections;
}

function clampWindow(index: number, count: number): number {
  return index < 0 ? 0 : index >= count ? count - 1 : index;
}

function averageWindowRange(values: Float32Array, from: number, to: number): number {
  if (to <= from) return values[clampWindow(from, values.length)];
  let sum = 0;
  for (let i = from; i < to && i < values.length; i++) sum += values[i];
  return sum / (to - from);
}

function mean(values: Float32Array): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum / values.length;
}

function variance(values: Float32Array, avg: number): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - avg;
    sum += d * d;
  }
  return sum / values.length;
}

function yieldThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
