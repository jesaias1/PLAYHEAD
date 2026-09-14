/**
 * Massive Route Connectivity Stress Test (400 Courses)
 * Verifies that across all presets, randomized genres, variable lengths, and hundreds of seeds:
 * 1. Final accepted invalid routes = EXACTLY 0.
 * 2. Every single mandatory traversal edge physically connects.
 * 3. Exact statistics are tracked and reported honestly.
 */

import { describe, it, expect } from 'vitest';
import { TrackGenerator } from '../src/generation/TrackGenerator';
import { RouteConnectivityValidator } from '../src/generation/RouteConnectivityValidator';
import { TrackAnalysis, AnalysisSection, SectionTheme } from '../src/audio/AudioFeatures';
import { RouteNodeType } from '../src/generation/GenerationTypes';

function createStressAnalysis(params: {
  seed: number;
  duration: number;
  bpm: number;
  genre: 'ELECTRONIC_DROP' | 'AMBIENT_SPARSE' | 'BREAKBEAT_DNB' | 'RANDOM_COMPLEX';
  sectionCount?: number;
}): TrackAnalysis {
  const { seed, duration, bpm, genre } = params;
  const sections: AnalysisSection[] = [];

  if (genre === 'ELECTRONIC_DROP') {
    const times = [0, 15, 30, 45, 55, 68, duration];
    const themes: SectionTheme[] = ['FLOW', 'SPEED', 'BREATH', 'BUILDUP', 'DROP', 'FLOW'];
    for (let i = 0; i < themes.length; i++) {
      const s = times[i];
      const e = times[i + 1] || duration;
      sections.push({
        index: i,
        start: s,
        end: e,
        duration: e - s,
        intensity: themes[i] === 'DROP' ? 0.95 : themes[i] === 'BREATH' ? 0.2 : 0.6,
        rhythmicDensity: themes[i] === 'DROP' ? 0.9 : 0.5,
        brightness: 0.6,
        theme: themes[i]
      });
    }
  } else if (genre === 'BREAKBEAT_DNB') {
    const count = 5;
    const sLen = duration / count;
    for (let i = 0; i < count; i++) {
      sections.push({
        index: i,
        start: i * sLen,
        end: (i + 1) * sLen,
        duration: sLen,
        intensity: 0.75 + (i % 3) * 0.1,
        rhythmicDensity: 0.85,
        brightness: 0.75,
        theme: i === 0 ? 'FLOW' : i === 1 ? 'SPEED' : i === 2 ? 'SURF' : i === 3 ? 'ASCENT' : 'SPEED'
      });
    }
  } else if (genre === 'AMBIENT_SPARSE') {
    const count = 4;
    const sLen = duration / count;
    for (let i = 0; i < count; i++) {
      sections.push({
        index: i,
        start: i * sLen,
        end: (i + 1) * sLen,
        duration: sLen,
        intensity: 0.15 + (i % 2) * 0.1,
        rhythmicDensity: 0.1,
        brightness: 0.4,
        theme: i === 0 ? 'FLOW' : i % 2 === 1 ? 'BREATH' : 'PRECISION'
      });
    }
  } else {
    // RANDOM_COMPLEX
    const count = params.sectionCount || Math.max(3, Math.floor(duration / 18));
    const step = duration / count;
    const availableThemes: SectionTheme[] = ['FLOW', 'ASCENT', 'DESCENT', 'SURF', 'SPEED', 'PRECISION', 'BREATH', 'BUILDUP', 'DROP'];
    for (let i = 0; i < count; i++) {
      const themeIdx = (seed + i * 7) % availableThemes.length;
      sections.push({
        index: i,
        start: i * step,
        end: (i + 1) * step,
        duration: step,
        intensity: ((seed * 13 + i * 17) % 100) / 100,
        rhythmicDensity: ((seed * 19 + i * 23) % 100) / 100,
        brightness: ((seed * 31 + i * 7) % 100) / 100,
        theme: i === 0 ? 'FLOW' : availableThemes[themeIdx]
      });
    }
  }

  return {
    filename: `stress_${genre}_${seed}.wav`,
    duration,
    bpm,
    bpmConfidence: 0.85,
    globalEnergy: 0.6,
    frames: [],
    onsets: [],
    sections,
    waveform: new Float32Array(512),
    seed,
    visualAccent: { name: 'Icy Cyan', hex: '#00f0ff', rgb: [0, 240, 255] }
  };
}

describe('Route Connectivity Stress Suite (400 Courses)', () => {
  const testCategories: Array<{
    name: string;
    genre: 'ELECTRONIC_DROP' | 'BREAKBEAT_DNB' | 'AMBIENT_SPARSE' | 'RANDOM_COMPLEX';
    duration: number;
    bpm: number;
    count: number;
  }> = [
    { name: 'ELECTRONIC_DROP (75s, Drop Surf)', genre: 'ELECTRONIC_DROP', duration: 75, bpm: 128, count: 100 },
    { name: 'BREAKBEAT_DNB (60s, High-Speed Surf)', genre: 'BREAKBEAT_DNB', duration: 60, bpm: 174, count: 100 },
    { name: 'AMBIENT_SPARSE (120s, Long Atmospheric)', genre: 'AMBIENT_SPARSE', duration: 120, bpm: 70, count: 100 },
    { name: 'RANDOM_COMPLEX (Random Durations/BPM/Themes)', genre: 'RANDOM_COMPLEX', duration: 90, bpm: 135, count: 100 }
  ];

  for (const cat of testCategories) {
    it(`generates and validates ${cat.count} courses for ${cat.name}`, () => {
      let validImmediately = 0;
      let repaired = 0;
      let regenerated = 0;
      let safeFallbacked = 0;
      let invalidCount = 0;
      let totalSurfRamps = 0;
      let maxGapOverall = 0;
      let maxStepOverall = 0;

      for (let i = 0; i < cat.count; i++) {
        const seed = (0x20000000 + i * 314159) >>> 0;
        const duration = cat.genre === 'RANDOM_COMPLEX' ? 30 + (i % 8) * 18 : cat.duration;
        const bpm = cat.genre === 'RANDOM_COMPLEX' ? 80 + (i % 24) * 4 : cat.bpm;
        const sectionCount = cat.genre === 'RANDOM_COMPLEX' ? 3 + (i % 7) : undefined;

        const analysis = createStressAnalysis({
          seed,
          duration,
          bpm,
          genre: cat.genre,
          sectionCount
        });

        const track = TrackGenerator.generate(analysis);
        const report = TrackGenerator.lastReport;
        const result = RouteConnectivityValidator.validate(track);

        if (!result.isValid) {
          invalidCount++;
        }

        if (report) {
          if (report.usedSafeFallback) {
            safeFallbacked++;
          } else if (report.wasRegenerated) {
            regenerated++;
          } else if (report.wasRepaired) {
            repaired++;
          } else {
            validImmediately++;
          }
        }

        totalSurfRamps += track.route.filter(n => n.isSurf).length;
        maxGapOverall = Math.max(maxGapOverall, result.maxObservedHorizontalGap);
        maxStepOverall = Math.max(maxStepOverall, result.maxObservedStepUp);

        // Assert all invariants per track
        expect(result.isValid).toBe(true);
        expect(track.route.length).toBeGreaterThanOrEqual(4);
        expect(track.route[0].type).toBe(RouteNodeType.RUNWAY);
        expect(track.route[track.route.length - 1].type).toBe(RouteNodeType.FINISH);

        for (const n of track.route) {
          expect(Number.isFinite(n.position.x)).toBe(true);
          expect(Number.isFinite(n.position.y)).toBe(true);
          expect(Number.isFinite(n.position.z)).toBe(true);
        }
      }

      console.log(`\n========================================`);
      console.log(`STRESS RESULTS: ${cat.name} (${cat.count} runs)`);
      console.log(`  Valid Immediately:  ${validImmediately}`);
      console.log(`  Repaired by Chain:  ${repaired}`);
      console.log(`  Regenerated:        ${regenerated}`);
      console.log(`  Safe Fallback:      ${safeFallbacked}`);
      console.log(`  FINAL INVALID:      ${invalidCount} (MUST BE 0)`);
      console.log(`  Total Surf Ramps:   ${totalSurfRamps}`);
      console.log(`  Max Horizontal Gap: ${maxGapOverall.toFixed(2)}m`);
      console.log(`  Max Step Up:        +${maxStepOverall.toFixed(2)}m`);

      expect(invalidCount).toBe(0);
    });
  }
});
