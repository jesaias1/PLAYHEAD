import { describe, it, expect } from 'vitest';
import { RouteGenerator } from '../src/generation/RouteGenerator';
import { TrackAnalysis } from '../src/audio/AudioFeatures';

describe('RouteGenerator Determinism', () => {
  const dummyAnalysis: TrackAnalysis = {
    filename: 'test_track',
    duration: 60.0,
    bpm: 128,
    bpmConfidence: 0.85,
    globalEnergy: 0.6,
    frames: [],
    onsets: [],
    sections: [
      { index: 0, start: 0, end: 20, duration: 20, intensity: 0.4, rhythmicDensity: 0.3, brightness: 0.5, theme: 'FLOW' },
      { index: 1, start: 20, end: 40, duration: 20, intensity: 0.7, rhythmicDensity: 0.6, brightness: 0.7, theme: 'SURF' },
      { index: 2, start: 40, end: 60, duration: 20, intensity: 0.9, rhythmicDensity: 0.8, brightness: 0.8, theme: 'SPEED' }
    ],
    waveform: new Float32Array(512),
    seed: 0x4A8F2B19,
    visualAccent: { name: 'Icy Cyan', hex: '#00f0ff', rgb: [0, 240, 255] }
  };

  it('generates identical route nodes for the same seed and analysis', () => {
    const track1 = RouteGenerator.generate(dummyAnalysis);
    const track2 = RouteGenerator.generate(dummyAnalysis);

    expect(track1.route.length).toEqual(track2.route.length);
    expect(track1.checkpoints.length).toEqual(track2.checkpoints.length);
    expect(track1.totalDistance).toBeCloseTo(track2.totalDistance, 4);

    for (let i = 0; i < track1.route.length; i++) {
      const n1 = track1.route[i];
      const n2 = track2.route[i];
      expect(n1.type).toEqual(n2.type);
      expect(n1.position.x).toBeCloseTo(n2.position.x, 4);
      expect(n1.position.y).toBeCloseTo(n2.position.y, 4);
      expect(n1.position.z).toBeCloseTo(n2.position.z, 4);
      expect(n1.dimensions.x).toBeCloseTo(n2.dimensions.x, 4);
      expect(n1.dimensions.z).toBeCloseTo(n2.dimensions.z, 4);
      expect(n1.yaw).toBeCloseTo(n2.yaw, 4);
    }
  });

  it('generates a different course for a different seed', () => {
    const analysisDiff = { ...dummyAnalysis, seed: 0x99887766 };
    const track1 = RouteGenerator.generate(dummyAnalysis);
    const track2 = RouteGenerator.generate(analysisDiff);

    // Positions should differ
    expect(track1.route[5].position).not.toEqual(track2.route[5].position);
  });
});
