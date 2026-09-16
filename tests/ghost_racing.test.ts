import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { GhostStorage, SavedGhostRun } from '../src/replay/GhostStorage';
import { ReplayFrame } from '../src/replay/ReplayRecorder';
import { AuthorGhostGenerator } from '../src/replay/AuthorGhostGenerator';
import { GhostManager } from '../src/replay/GhostManager';
import { GeneratedTrack, RouteNodeType } from '../src/generation/GenerationTypes';
import { SettingsManager } from '../src/core/Settings';

describe('Ghost Racing & Temporal Rival ("The Echo")', () => {
  // Mock mock localStorage in memory
  const memoryStore = new Map<string, string>();

  beforeEach(() => {
    memoryStore.clear();
    const mockStorage = {
      getItem: (key: string) => memoryStore.get(key) ?? null,
      setItem: (key: string, val: string) => memoryStore.set(key, val),
      removeItem: (key: string) => memoryStore.delete(key),
      clear: () => memoryStore.clear()
    };
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockStorage,
      writable: true,
      configurable: true
    });
  });

  describe('GhostStorage', () => {
    const sampleFrames: ReplayFrame[] = [
      { time: 0.0, px: 0, py: 1.5, pz: 0, yaw: 0, pitch: 0, speed: 15.0 },
      { time: 0.04, px: 0.5, py: 1.52, pz: 1.2, yaw: 0.02, pitch: -0.01, speed: 16.4 },
      { time: 0.08, px: 1.0, py: 1.55, pz: 2.5, yaw: 0.03, pitch: -0.01, speed: 17.8 },
      { time: 0.12, px: 1.6, py: 1.51, pz: 3.8, yaw: 0.04, pitch: 0.0, speed: 19.1 },
      { time: 0.16, px: 2.2, py: 1.50, pz: 5.2, yaw: 0.05, pitch: 0.0, speed: 20.0 },
      { time: 0.20, px: 2.9, py: 1.50, pz: 6.7, yaw: 0.05, pitch: 0.0, speed: 20.5 },
      { time: 0.24, px: 3.6, py: 1.50, pz: 8.2, yaw: 0.05, pitch: 0.0, speed: 21.0 },
      { time: 0.28, px: 4.4, py: 1.50, pz: 9.8, yaw: 0.05, pitch: 0.0, speed: 21.5 },
      { time: 0.32, px: 5.2, py: 1.50, pz: 11.4, yaw: 0.05, pitch: 0.0, speed: 22.0 },
      { time: 0.36, px: 6.0, py: 1.50, pz: 13.0, yaw: 0.05, pitch: 0.0, speed: 22.5 },
      { time: 0.40, px: 6.9, py: 1.50, pz: 14.7, yaw: 0.05, pitch: 0.0, speed: 23.0 }
    ];

    it('compresses and decompresses replay frames within tolerance', () => {
      const compact = GhostStorage.compressFrames(sampleFrames);
      expect(compact.length).toBe(sampleFrames.length);
      expect(compact[0]).toEqual([0, 0, 1.5, 0, 0, 0, 15]);

      const restored = GhostStorage.decompressFrames(compact);
      expect(restored.length).toBe(sampleFrames.length);
      expect(restored[1].px).toBeCloseTo(sampleFrames[1].px, 1);
      expect(restored[1].speed).toBeCloseTo(sampleFrames[1].speed, 1);
    });

    it('saves and loads personal best ghost from localStorage', () => {
      const seed = 0x12345678;
      expect(GhostStorage.hasPB(seed)).toBe(false);

      const saved = GhostStorage.savePB(seed, 'TEST TRACK', 32.5, 85000, sampleFrames, [10.2, 21.4]);
      expect(saved).toBe(true);
      expect(GhostStorage.hasPB(seed)).toBe(true);

      const loaded = GhostStorage.loadPB(seed);
      expect(loaded).not.toBeNull();
      expect(loaded?.seed).toBe(seed);
      expect(loaded?.trackTitle).toBe('TEST TRACK');
      expect(loaded?.completionTime).toBe(32.5);
      expect(loaded?.score).toBe(85000);
      expect(loaded?.checkpointTimes).toEqual([10.2, 21.4]);
      expect(loaded?.frames.length).toBe(sampleFrames.length);
    });

    it('only replaces existing PB if the new run is better', () => {
      const seed = 0xaabbccdd;
      GhostStorage.savePB(seed, 'TRACK A', 30.0, 90000, sampleFrames, [10.0]);

      // Worse run: slower time and lower score
      const worse = GhostStorage.savePB(seed, 'TRACK A', 35.0, 75000, sampleFrames, [12.0]);
      expect(worse).toBe(false);

      // Better run: faster time and comparable score
      const better = GhostStorage.savePB(seed, 'TRACK A', 28.0, 95000, sampleFrames, [9.0]);
      expect(better).toBe(true);

      const loaded = GhostStorage.loadPB(seed);
      expect(loaded?.completionTime).toBe(28.0);
      expect(loaded?.score).toBe(95000);
    });
  });

  describe('AuthorGhostGenerator', () => {
    const mockTrack: GeneratedTrack = {
      seed: 0x42f00d,
      route: [
        {
          id: 0,
          time: 0.0,
          position: { x: 0, y: 0, z: 0 },
          dimensions: { x: 8, y: 1, z: 30 },
          yaw: 0,
          pitch: 0,
          roll: 0,
          type: RouteNodeType.RUNWAY,
          intensity: 0.5,
          sectionIndex: 0,
          arcLength: 0,
          isSurf: false,
          isBoost: false
        },
        {
          id: 1,
          time: 3.0,
          position: { x: 0, y: 0, z: 60 },
          dimensions: { x: 8, y: 1, z: 30 },
          yaw: 0,
          pitch: 0,
          roll: 0,
          type: RouteNodeType.CHECKPOINT,
          intensity: 0.7,
          sectionIndex: 0,
          arcLength: 60,
          isSurf: false,
          isBoost: false
        },
        {
          id: 2,
          time: 6.0,
          position: { x: 5, y: -4, z: 120 },
          dimensions: { x: 6, y: 1, z: 40 },
          yaw: 0.1,
          pitch: -0.15,
          roll: 0.9,
          type: RouteNodeType.SURF_RAMP,
          intensity: 0.9,
          sectionIndex: 1,
          arcLength: 125,
          isSurf: true,
          isBoost: false
        },
        {
          id: 3,
          time: 9.0,
          position: { x: 0, y: -6, z: 180 },
          dimensions: { x: 10, y: 1, z: 25 },
          yaw: 0,
          pitch: 0,
          roll: 0,
          type: RouteNodeType.FINISH,
          intensity: 0.8,
          sectionIndex: 1,
          arcLength: 190,
          isSurf: false,
          isBoost: false
        }
      ],
      checkpoints: [
        {
          id: 0,
          routeNodeId: 1,
          time: 3.0,
          position: { x: 0, y: 0, z: 60 },
          yaw: 0,
          sectionIndex: 0
        }
      ],
      finish: {
        routeNodeId: 3,
        time: 9.0,
        position: { x: 0, y: -6, z: 180 },
        yaw: 0
      },
      totalDistance: 190,
      targetDuration: 9.0,
      repairedJumpsCount: 0
    };

    it('generates deterministic benchmark frames for a track', () => {
      const run1 = AuthorGhostGenerator.generate(mockTrack);
      const run2 = AuthorGhostGenerator.generate(mockTrack);

      expect(run1.frames.length).toBeGreaterThan(50);
      expect(run1.frames.length).toBe(run2.frames.length);
      expect(run1.completionTime).toBeCloseTo(run2.completionTime, 4);

      // Verify determinism frame-by-frame
      for (let i = 0; i < run1.frames.length; i++) {
        expect(run1.frames[i].px).toBe(run2.frames[i].px);
        expect(run1.frames[i].py).toBe(run2.frames[i].py);
        expect(run1.frames[i].pz).toBe(run2.frames[i].pz);
        expect(run1.frames[i].speed).toBe(run2.frames[i].speed);
      }
    });

    it('generates valid non-NaN positions with forward progression', () => {
      const run = AuthorGhostGenerator.generate(mockTrack);
      for (const f of run.frames) {
        expect(Number.isFinite(f.px)).toBe(true);
        expect(Number.isFinite(f.py)).toBe(true);
        expect(Number.isFinite(f.pz)).toBe(true);
        expect(Number.isFinite(f.yaw)).toBe(true);
        expect(Number.isFinite(f.speed)).toBe(true);
        expect(f.speed).toBeGreaterThan(10);
      }

      // Final position reaches near the finish
      const lastFrame = run.frames[run.frames.length - 1];
      expect(lastFrame.pz).toBeGreaterThanOrEqual(175);
    });

    it('records checkpoint times deterministically', () => {
      const run = AuthorGhostGenerator.generate(mockTrack);
      expect(run.checkpointTimes.length).toBe(1);
      expect(run.checkpointTimes[0]).toBeGreaterThan(0);
      expect(run.checkpointTimes[0]).toBeLessThan(run.completionTime);
    });
  });

  describe('GhostManager', () => {
    it('calculates checkpoint splits accurately against PB and Rival', () => {
      const scene = new THREE.Scene();
      const manager = new GhostManager(scene);

      const track: GeneratedTrack = {
        seed: 0x9999,
        route: [
          {
            id: 0,
            time: 0,
            position: { x: 0, y: 0, z: 0 },
            dimensions: { x: 8, y: 1, z: 20 },
            yaw: 0,
            pitch: 0,
            roll: 0,
            type: RouteNodeType.RUNWAY,
            intensity: 0.5,
            sectionIndex: 0,
            arcLength: 0,
            isSurf: false,
            isBoost: false
          },
          {
            id: 1,
            time: 5,
            position: { x: 0, y: 0, z: 80 },
            dimensions: { x: 8, y: 1, z: 20 },
            yaw: 0,
            pitch: 0,
            roll: 0,
            type: RouteNodeType.FINISH,
            intensity: 0.5,
            sectionIndex: 0,
            arcLength: 80,
            isSurf: false,
            isBoost: false
          }
        ],
        checkpoints: [
          {
            id: 0,
            routeNodeId: 1,
            time: 4.0,
            position: { x: 0, y: 0, z: 40 },
            yaw: 0,
            sectionIndex: 0
          }
        ],
        finish: {
          routeNodeId: 1,
          time: 5.0,
          position: { x: 0, y: 0, z: 80 },
          yaw: 0
        },
        totalDistance: 80,
        targetDuration: 5.0,
        repairedJumpsCount: 0
      };

      manager.prepareTrack(track, 'TEST SPLIT TRACK');
      manager.start();

      // Ahead of Echo Rival
      const aheadSplit = manager.onPlayerReachCheckpoint(0, 1.5);
      expect(aheadSplit).not.toBeNull();
      expect(aheadSplit?.target).toBe('ECHO');
      expect(aheadSplit?.isAhead).toBe(true);
      expect(aheadSplit?.deltaSeconds).toBeLessThan(0);

      // Save a PB and test split against PB
      const frames: ReplayFrame[] = [
        { time: 0, px: 0, py: 0, z: 0 } as any,
        { time: 1, px: 0, py: 0, z: 10 } as any,
        { time: 2, px: 0, py: 0, z: 20 } as any,
        { time: 3, px: 0, py: 0, z: 30 } as any,
        { time: 4, px: 0, py: 0, z: 40 } as any,
        { time: 5, px: 0, py: 0, z: 50 } as any,
        { time: 6, px: 0, py: 0, z: 60 } as any,
        { time: 7, px: 0, py: 0, z: 70 } as any,
        { time: 8, px: 0, py: 0, z: 80 } as any,
        { time: 9, px: 0, py: 0, z: 90 } as any,
        { time: 10, px: 0, py: 0, z: 100 } as any
      ];
      manager.playerCheckpointTimes = [3.2];
      manager.saveIfPersonalBest(track.seed, 'TEST SPLIT TRACK', 4.8, 100000, frames);

      // Re-prepare track so PB is loaded
      manager.prepareTrack(track, 'TEST SPLIT TRACK');
      expect(manager.hasPB()).toBe(true);

      // Slower than PB
      const behindSplit = manager.onPlayerReachCheckpoint(0, 3.8);
      expect(behindSplit).not.toBeNull();
      expect(behindSplit?.target).toBe('PB');
      expect(behindSplit?.isAhead).toBe(false);
      expect(behindSplit?.deltaSeconds).toBeCloseTo(0.6, 1);

      manager.dispose();
    });
  });
});
