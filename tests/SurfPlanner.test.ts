import { describe, it, expect } from 'vitest';
import { SurfPlanner } from '../src/generation/SurfPlanner';
import { SurfPhraseGenerator } from '../src/generation/SurfPhraseGenerator';
import { SurfValidator } from '../src/generation/SurfValidator';
import { SeededRandom } from '../src/generation/SeededRandom';
import { TrackAnalysis } from '../src/audio/AudioFeatures';

describe('SurfPlanner & SurfPhraseGenerator', () => {
  const dummyAnalysis: TrackAnalysis = {
    bpm: 128,
    duration: 120.0,
    waveform: new Float32Array(100),
    frames: [],
    segments: [],
    onsets: [],
    sections: [
      { id: 0, start: 0, duration: 15.0, theme: 'INTRO', intensity: 0.3, energyProfile: 'BUILDING' },
      { id: 1, start: 15.0, duration: 15.0, theme: 'BUILDUP', intensity: 0.7, energyProfile: 'BUILDING' },
      { id: 2, start: 30.0, duration: 25.0, theme: 'DROP', intensity: 0.95, energyProfile: 'SUSTAINED' },
      { id: 3, start: 55.0, duration: 20.0, theme: 'BREAKDOWN', intensity: 0.4, energyProfile: 'DECAYING' },
      { id: 4, start: 75.0, duration: 30.0, theme: 'DROP', intensity: 0.9, energyProfile: 'SUSTAINED' },
      { id: 5, start: 105.0, duration: 15.0, theme: 'OUTRO', intensity: 0.2, energyProfile: 'DECAYING' }
    ],
    summary: {
      averageEnergy: 0.6,
      maxEnergy: 1.0,
      bassDominance: 0.7,
      highDominance: 0.5,
      tempoVariance: 0.02
    },
    visualAccent: {
      primary: '#00f0ff',
      secondary: '#ff0077',
      highlight: '#ffffff',
      hex: 0x00f0ff
    },
    filename: 'test_drop.mp3',
    seed: 0x1234
  };

  it('schedules musically appropriate surf events and designates a signature surf', () => {
    const events = SurfPlanner.plan(dummyAnalysis);

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.length).toBeLessThanOrEqual(3);

    // No surf in first 18 seconds (onboarding safe zone)
    for (const evt of events) {
      expect(evt.startTime).toBeGreaterThanOrEqual(18.0);
      expect(evt.endTime).toBeLessThanOrEqual(dummyAnalysis.duration - 12.0);
    }

    // Exactly one signature surf
    const signatureEvents = events.filter(e => e.isSignature);
    expect(signatureEvents.length).toBe(1);
    expect(signatureEvents[0].type).toBe('SURF_DROP');
  });

  it('generates and validates a complete SURF_DROP phrase', () => {
    const rng = new SeededRandom(42);
    const event = {
      id: 1,
      sectionIndex: 2,
      startTime: 30.0,
      endTime: 45.0,
      duration: 15.0,
      type: 'SURF_DROP' as const,
      intensity: 0.95,
      suitability: 0.95,
      entrySpeedTarget: 22.0,
      isSignature: true
    };

    const phrase = SurfPhraseGenerator.generate(
      event,
      { x: 0, y: 0, z: 100 },
      0,
      100,
      10,
      rng
    );

    // Validation must pass
    const valRes = SurfValidator.validate(phrase);
    expect(valRes.isValid).toBe(true);

    // Must have registered approach checkpoint for instant retry on signature surf
    expect(phrase.checkpoint).toBeDefined();
    expect(phrase.checkpoint?.routeNodeId).toBeDefined();

    // Must contain a surf ramp
    const ramps = phrase.nodes.filter(n => n.isSurf);
    expect(ramps.length).toBe(1);
    expect(ramps[0].surfNormal).toBeDefined();

    // Slope must be surfable
    const slopeDeg = (Math.abs(ramps[0].roll) * 180) / Math.PI;
    expect(slopeDeg).toBeGreaterThanOrEqual(50);
    expect(slopeDeg).toBeLessThanOrEqual(65);

    // Must end with wide landing deck
    const landing = phrase.nodes[phrase.nodes.length - 1];
    expect(landing.type).toBe('LANDING');
    expect(landing.dimensions.x).toBeGreaterThanOrEqual(20.0);
  });

  it('generates and validates a SURF_TRANSFER phrase', () => {
    const rng = new SeededRandom(99);
    const event = {
      id: 2,
      sectionIndex: 4,
      startTime: 75.0,
      endTime: 90.0,
      duration: 15.0,
      type: 'SURF_TRANSFER' as const,
      intensity: 0.85,
      suitability: 0.85,
      entrySpeedTarget: 20.0,
      isSignature: false
    };

    const phrase = SurfPhraseGenerator.generate(
      event,
      { x: 0, y: 0, z: 300 },
      0,
      300,
      50,
      rng
    );

    const valRes = SurfValidator.validate(phrase);
    expect(valRes.isValid).toBe(true);

    // Must contain two opposing surf ramps
    const ramps = phrase.nodes.filter(n => n.isSurf);
    expect(ramps.length).toBe(2);
    // Opposing bank rolls (one positive, one negative)
    expect(ramps[0].roll * ramps[1].roll).toBeLessThan(0);
  });
});
