import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackAnalysis } from '../src/audio/AudioFeatures';
import { PresetLevelCache } from '../src/audio/PresetLevelCache';
import { ROUTE_GENERATION_VERSION } from '../src/generation/RouteGenerator';

function analysis(): TrackAnalysis {
  return {
    filename: 'stale-official-preset',
    duration: 120,
    bpm: 136,
    bpmConfidence: 0.9,
    globalEnergy: 0.78,
    frames: [],
    onsets: [],
    sections: [{
      index: 0,
      start: 0,
      end: 120,
      duration: 120,
      intensity: 0.8,
      rhythmicDensity: 0.82,
      brightness: 0.65,
      theme: 'FLOW'
    }],
    waveform: new Float32Array(128),
    seed: 0x13572468,
    visualAccent: { name: 'Cyan', hex: '#00f0ff', rgb: [0, 240, 255] }
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('official preset route-version migration', () => {
  it('regenerates stale cached geometry and supplies deterministic challenges', async () => {
    const staleAnalysis = analysis();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        trackId: 'test_stale_route_v1',
        analysis: { ...staleAnalysis, waveform: [...staleAnalysis.waveform] },
        track: {
          seed: staleAnalysis.seed,
          route: [],
          checkpoints: [],
          finish: { routeNodeId: 0, time: 120, position: { x: 0, y: 0, z: 0 }, yaw: 0 },
          totalDistance: 0,
          targetDuration: 120,
          repairedJumpsCount: 0
        }
      })
    })));

    const loaded = await PresetLevelCache.loadPreset('test_stale_route_v1');
    expect(loaded).not.toBeNull();
    expect(loaded!.track.generationVersion).toBe(ROUTE_GENERATION_VERSION);
    expect(loaded!.track.route.length).toBeGreaterThan(0);
    expect(loaded!.track.obstacles).toBeDefined();
    expect((loaded!.track.obstacles ?? []).length).toBeGreaterThan(0);
  });
});
