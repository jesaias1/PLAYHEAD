import { describe, it, expect } from 'vitest';
import { RouteGenerator } from '../src/generation/RouteGenerator';
import { TrackAnalysis, AnalysisSection, SectionTheme } from '../src/audio/AudioFeatures';
import { RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';

function createMockAnalysis(params: {
  seed: number;
  duration: number;
  bpm: number;
  genre: 'ELECTRONIC_DROP' | 'AMBIENT_SPARSE' | 'BREAKBEAT_DNB' | 'NEAR_SILENT';
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
  } else {
    const count = 3;
    const sLen = duration / count;
    for (let i = 0; i < count; i++) {
      sections.push({
        index: i,
        start: i * sLen,
        end: (i + 1) * sLen,
        duration: sLen,
        intensity: 0.05,
        rhythmicDensity: 0.02,
        brightness: 0.2,
        theme: i === 0 ? 'FLOW' : 'BREATH'
      });
    }
  }

  return {
    filename: `test_${genre}_${seed}.wav`,
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

function checkEdgeDistance(current: RouteNode, next: RouteNode) {
  // Current exit edge
  const halfLenCurrent = current.dimensions.z * 0.5;
  const currentEnd = {
    x: current.position.x + Math.sin(current.yaw) * halfLenCurrent,
    y: current.position.y + (current.pitch ? Math.sin(current.pitch) * halfLenCurrent : 0),
    z: current.position.z + Math.cos(current.yaw) * halfLenCurrent
  };

  // Next entry edge
  const halfLenNext = next.dimensions.z * 0.5;
  const nextStart = {
    x: next.position.x - Math.sin(next.yaw) * halfLenNext,
    y: next.position.y - (next.pitch ? Math.sin(next.pitch) * halfLenNext : 0),
    z: next.position.z - Math.cos(next.yaw) * halfLenNext
  };

  const dx = nextStart.x - currentEnd.x;
  const dy = nextStart.y - currentEnd.y;
  const dz = nextStart.z - currentEnd.z;
  const horizontalDist = Math.sqrt(dx * dx + dz * dz);
  const totalDist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  return {
    currentEnd,
    nextStart,
    dx,
    dy,
    dz,
    horizontalDist,
    totalDist
  };
}

describe('Route Continuity Diagnostic', () => {
  const genres = ['ELECTRONIC_DROP', 'BREAKBEAT_DNB', 'AMBIENT_SPARSE', 'NEAR_SILENT'] as const;

  for (const genre of genres) {
    it(`diagnoses connectivity for preset ${genre} across 50 seeds`, () => {
      let totalBrokenEdges = 0;
      const brokenDetails: any[] = [];

      for (let s = 0; s < 50; s++) {
        const seed = 0x12345678 + s * 99991;
        const analysis = createMockAnalysis({
          seed,
          duration: genre === 'ELECTRONIC_DROP' ? 75 : 60,
          bpm: genre === 'BREAKBEAT_DNB' ? 174 : genre === 'AMBIENT_SPARSE' ? 70 : 128,
          genre
        });
        const track = RouteGenerator.generate(analysis);

        for (let i = 0; i < track.route.length - 1; i++) {
          const curr = track.route[i];
          const next = track.route[i + 1];
          const edge = checkEdgeDistance(curr, next);

          // We check:
          // 1. Normal platform to normal platform gap > 12m
          // 2. Normal to surf approach gap > 12m
          // 3. Surf approach to surf ramp gap > 10m
          // 4. Surf ramp to surf ramp gap > 15m
          // 5. Surf ramp to landing gap > 15m
          // 6. Landing to next platform gap > 12m
          let maxAllowedGap = 12.0;
          if (curr.isSurf && next.isSurf) maxAllowedGap = 15.0;
          else if (curr.isSurf || next.isSurf) maxAllowedGap = 14.0;
          else if (curr.type === RouteNodeType.SURF_APPROACH || next.type === RouteNodeType.SURF_APPROACH) maxAllowedGap = 12.0;
          else if (curr.type === RouteNodeType.LANDING || next.type === RouteNodeType.LANDING) maxAllowedGap = 12.0;

          if (edge.horizontalDist > maxAllowedGap || edge.totalDist > 25.0) {
            totalBrokenEdges++;
            brokenDetails.push({
              seed,
              edgeIndex: i,
              from: { id: curr.id, type: curr.type, isSurf: curr.isSurf, pos: curr.position },
              to: { id: next.id, type: next.type, isSurf: next.isSurf, pos: next.position },
              horizontalDist: edge.horizontalDist,
              verticalDelta: edge.dy,
              totalDist: edge.totalDist
            });
          }
        }
      }

      console.log(`\n========================================`);
      console.log(`PRESET: ${genre} (50 seeds tested)`);
      console.log(`Total broken edges: ${totalBrokenEdges}`);
      if (brokenDetails.length > 0) {
        console.log(`Sample broken edges (first 5):`, JSON.stringify(brokenDetails.slice(0, 5), null, 2));
      }
    });
  }
});
