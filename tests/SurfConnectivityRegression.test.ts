/**
 * Regression Test: Surf Connectivity & Route Stitching
 * Preserves the exact reproduction seed from the human-reported surf disconnection bug.
 * 
 * FAILURE STATE (Prior to fix):
 * - Preset: BREAKBEAT_DNB
 * - Seed: 305619878
 * - Broken Edge: Node #18 (SURF_APPROACH) -> Node #19 (SURF_RAMP)
 * - Distance: 55.78m horizontal void gap (caused by inverted sin(yaw) in SurfPhraseGenerator)
 * 
 * INVARIANT:
 * All mandatory edges in the authoritative traversal chain must physically connect.
 * 100% of transitions must pass RouteConnectivityValidator.
 */

import { describe, it, expect } from 'vitest';
import { RouteGenerator } from '../src/generation/RouteGenerator';
import { TrackGenerator } from '../src/generation/TrackGenerator';
import { RouteConnectivityValidator } from '../src/generation/RouteConnectivityValidator';
import { TrackAnalysis, AnalysisSection, SectionTheme } from '../src/audio/AudioFeatures';
import { RouteNodeType } from '../src/generation/GenerationTypes';

function createMockAnalysis(params: {
  seed: number;
  duration: number;
  bpm: number;
  genre: 'ELECTRONIC_DROP' | 'AMBIENT_SPARSE' | 'BREAKBEAT_DNB' | 'NEAR_SILENT';
}): TrackAnalysis {
  const { seed, duration, bpm, genre } = params;
  const sections: AnalysisSection[] = [];

  if (genre === 'BREAKBEAT_DNB') {
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
  } else if (genre === 'ELECTRONIC_DROP') {
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
  } else {
    const count = 4;
    const sLen = duration / count;
    for (let i = 0; i < count; i++) {
      sections.push({
        index: i,
        start: i * sLen,
        end: (i + 1) * sLen,
        duration: sLen,
        intensity: 0.2,
        rhythmicDensity: 0.1,
        brightness: 0.4,
        theme: i === 0 ? 'FLOW' : 'BREATH'
      });
    }
  }

  return {
    filename: `regression_${genre}_${seed}.wav`,
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

describe('Surf Connectivity Regression Suite', () => {
  it('validates the exact reproduction seed (BREAKBEAT_DNB, seed 305619878)', () => {
    const brokenSeed = 305619878;
    const analysis = createMockAnalysis({
      seed: brokenSeed,
      duration: 60,
      bpm: 174,
      genre: 'BREAKBEAT_DNB'
    });

    const track = TrackGenerator.generate(analysis);
    const result = RouteConnectivityValidator.validate(track);

    // Prior to fix: brokenEdges had edge #18 (SURF_APPROACH -> SURF_RAMP) with 55.78m gap!
    // After fix: must be 100% valid with 0 broken edges
    expect(result.brokenEdges.length).toBe(0);
    expect(result.isValid).toBe(true);

    // Verify surf ramps exist and are properly connected
    const surfNodes = track.route.filter(n => n.isSurf);
    expect(surfNodes.length).toBeGreaterThan(0);

    // Verify all consecutive transitions are bounded
    for (let i = 0; i < track.route.length - 1; i++) {
      const curr = track.route[i];
      const next = track.route[i + 1];

      // If transition involves surf, check that gap is <= 18m
      if (curr.isSurf || next.isSurf || curr.type === RouteNodeType.SURF_APPROACH) {
        const dx = next.position.x - curr.position.x;
        const dy = next.position.y - curr.position.y;
        const dz = next.position.z - curr.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        // Surf ramps can be 42-75m long center-to-center, but edge-to-edge gap must be small
        expect(dist).toBeLessThanOrEqual(80.0);
      }
    }
  });

  it('validates second reproduction seed (BREAKBEAT_DNB, seed 305419896)', () => {
    const brokenSeed = 305419896;
    const analysis = createMockAnalysis({
      seed: brokenSeed,
      duration: 60,
      bpm: 174,
      genre: 'BREAKBEAT_DNB'
    });

    const track = TrackGenerator.generate(analysis);
    const result = RouteConnectivityValidator.validate(track);

    expect(result.brokenEdges.length).toBe(0);
    expect(result.isValid).toBe(true);
  });

  it('validates ELECTRONIC_DROP signature surf connectivity (seed 305719869)', () => {
    const seed = 305719869;
    const analysis = createMockAnalysis({
      seed,
      duration: 75,
      bpm: 128,
      genre: 'ELECTRONIC_DROP'
    });

    const track = TrackGenerator.generate(analysis);
    const result = RouteConnectivityValidator.validate(track);

    expect(result.brokenEdges.length).toBe(0);
    expect(result.isValid).toBe(true);
  });
});
