import { describe, it, expect } from 'vitest';
import { SpectaclePlanner, SpectacleType } from '../src/world/SpectaclePlanner';
import { TrackAnalysis } from '../src/audio/AudioFeatures';
import { GeneratedTrack, RouteNodeType } from '../src/generation/GenerationTypes';

describe('SpectaclePlanner Verification', () => {
  function createMockTrackAndAnalysis(duration = 120): { analysis: TrackAnalysis; track: GeneratedTrack } {
    const analysis: TrackAnalysis = {
      filename: 'TEST_TRACK.wav',
      duration,
      bpm: 128,
      bpmConfidence: 0.95,
      globalEnergy: 0.65,
      frames: [],
      onsets: [
        { time: 15.0, strength: 0.9, bass: 0.8, mids: 0.5, highs: 0.4 },
        { time: 45.0, strength: 0.95, bass: 0.9, mids: 0.6, highs: 0.5 },
        { time: 80.0, strength: 0.85, bass: 0.7, mids: 0.6, highs: 0.6 }
      ],
      sections: [
        { index: 0, start: 0, end: 30, duration: 30, intensity: 0.4, rhythmicDensity: 0.5, brightness: 0.5, theme: 'FLOW' },
        { index: 1, start: 30, end: 55, duration: 25, intensity: 0.7, rhythmicDensity: 0.7, brightness: 0.6, theme: 'BUILDUP' },
        { index: 2, start: 55, end: 85, duration: 30, intensity: 0.95, rhythmicDensity: 0.9, brightness: 0.8, theme: 'DROP' },
        { index: 3, start: 85, end: 120, duration: 35, intensity: 0.5, rhythmicDensity: 0.4, brightness: 0.4, theme: 'BREATH' }
      ],
      waveform: new Float32Array(512),
      seed: 424242,
      visualAccent: { hex: '#00f0ff', rgb: [0, 240, 255], name: 'CYAN' }
    };

    const route = [];
    for (let i = 0; i < 50; i++) {
      route.push({
        id: i,
        time: (i / 49) * duration,
        position: { x: 0, y: i > 20 && i < 30 ? 15 : 0, z: i * 20 },
        dimensions: { x: 10, y: 2, z: 20 },
        yaw: 0,
        pitch: 0,
        roll: 0,
        type: i === 49 ? RouteNodeType.FINISH : (i === 25 ? RouteNodeType.CHECKPOINT : RouteNodeType.RUNWAY),
        intensity: 0.5,
        sectionIndex: Math.floor(i / 13),
        arcLength: i * 20,
        isSurf: i >= 20 && i <= 28,
        isBoost: false
      });
    }

    const track: GeneratedTrack = {
      seed: 424242,
      route,
      checkpoints: [
        { id: 1, routeNodeId: 25, time: 60, position: { x: 0, y: 15, z: 500 }, yaw: 0, sectionIndex: 2 }
      ],
      finish: { routeNodeId: 49, time: duration, position: { x: 0, y: 0, z: 980 }, yaw: 0 },
      totalDistance: 980,
      targetDuration: duration,
      repairedJumpsCount: 0
    };

    return { analysis, track };
  }

  it('plans between 3 and 6 memorable events for standard duration track', () => {
    const planner = new SpectaclePlanner();
    const { analysis, track } = createMockTrackAndAnalysis(120);

    planner.plan(analysis, track);

    expect(planner.events.length).toBeGreaterThanOrEqual(3);
    expect(planner.events.length).toBeLessThanOrEqual(6);
  });

  it('enforces minimum cooldown between scheduled spectacle events', () => {
    const planner = new SpectaclePlanner();
    const { analysis, track } = createMockTrackAndAnalysis(150);

    planner.plan(analysis, track);

    for (let i = 0; i < planner.events.length - 1; i++) {
      const dt = planner.events[i + 1].triggerTime - planner.events[i].triggerTime;
      expect(dt).toBeGreaterThanOrEqual(20.0 - 0.001);
    }
  });

  it('designates exactly one SIGNATURE_EVENT with peak duration and weight', () => {
    const planner = new SpectaclePlanner();
    const { analysis, track } = createMockTrackAndAnalysis(120);

    planner.plan(analysis, track);

    const signatureEvents = planner.events.filter(e => e.isSignature);
    expect(signatureEvents.length).toBe(1);
    expect(planner.signatureEvent).not.toBeNull();
    expect(planner.signatureEvent?.isSignature).toBe(true);
    expect(planner.signatureEvent?.duration).toBe(7.5);
  });

  it('enforces event diversity: consecutive events never have the same spectacle type', () => {
    const planner = new SpectaclePlanner();
    const { analysis, track } = createMockTrackAndAnalysis(180);

    planner.plan(analysis, track);

    for (let i = 0; i < planner.events.length - 1; i++) {
      expect(planner.events[i].type).not.toBe(planner.events[i + 1].type);
    }
  });

  it('only utilizes the 6 approved spectacle families', () => {
    const planner = new SpectaclePlanner();
    const { analysis, track } = createMockTrackAndAnalysis(140);

    planner.plan(analysis, track);

    const validFamilies: SpectacleType[] = [
      'MONOLITH_SPLIT',
      'VOID_REVEAL',
      'CATHEDRAL_IGNITION',
      'STARFIELD_BLOOM',
      'WORLD_POWER_DOWN',
      'SURF_CANYON_RELEASE'
    ];

    for (const evt of planner.events) {
      expect(validFamilies).toContain(evt.type);
    }
  });
});
