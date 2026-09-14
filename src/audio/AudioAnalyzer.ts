/**
 * DSP Audio Analyzer for TRACK//RUN
 * Performs real client-side PCM analysis, FFT, spectral flux,
 * onset detection, tempo autocorrelation, and section segmentation.
 */

import { AnalysisFrame, AnalysisSection, OnsetEvent, SectionTheme, TrackAnalysis, VisualAccent } from './AudioFeatures';
import { hashAudioBuffer } from '../utils/hash';
import { clamp } from '../utils/math';

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
    onProgress?: (stage: string, progress: number) => void
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

    const { bpm, confidence: bpmConfidence } = estimateBPM(normFlux, windowSec);

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
    const globalEnergy = globalEnergySum / numFrames;

    // 9. Section Boundary Detection (4-10 coherent sections)
    onProgress?.('FINDING SECTIONS', 0.92);
    await yieldThread();

    const sections = detectSections(frames, duration);

    // 10. Deterministic seed & curated accent color
    const seed = hashAudioBuffer(buffer, filename);
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
      visualAccent
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

function yieldThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
