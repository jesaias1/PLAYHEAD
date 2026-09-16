/**
 * GhostStorage: Compact serialization and localStorage persistence for personal best ghost runs
 */

import { ReplayFrame } from './ReplayRecorder';
import { seedToHex } from '../utils/hash';

export type CompactGhostFrame = [
  number, // 0: time (seconds)
  number, // 1: px
  number, // 2: py
  number, // 3: pz
  number, // 4: yaw
  number, // 5: pitch
  number  // 6: speed
];

export interface SavedGhostRun {
  version: 1;
  seed: number;
  trackTitle: string;
  completionTime: number;
  score: number;
  date: number;
  frames: CompactGhostFrame[];
  checkpointTimes: number[];
}

const STORAGE_PREFIX = 'trackrun_ghost_pb_';

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

export class GhostStorage {
  private static getKey(seed: number): string {
    return `${STORAGE_PREFIX}${seedToHex(seed)}`;
  }

  /**
   * Compresses ReplayFrame array into a compact numeric tuple array
   */
  public static compressFrames(frames: ReplayFrame[]): CompactGhostFrame[] {
    return frames.map((f) => [
      round2(f.time),
      round2(f.px),
      round2(f.py),
      round2(f.pz),
      round2(f.yaw),
      round2(f.pitch),
      round1(f.speed)
    ]);
  }

  /**
   * Decompresses compact numeric tuples back into full ReplayFrame objects
   */
  public static decompressFrames(compactFrames: CompactGhostFrame[]): ReplayFrame[] {
    return compactFrames.map((t) => ({
      time: t[0],
      px: t[1],
      py: t[2],
      pz: t[3],
      yaw: t[4],
      pitch: t[5],
      speed: t[6]
    }));
  }

  /**
   * Checks if a PB ghost exists for the given track seed
   */
  public static hasPB(seed: number): boolean {
    try {
      if (typeof localStorage === 'undefined') return false;
      return localStorage.getItem(this.getKey(seed)) !== null;
    } catch {
      return false;
    }
  }

  /**
   * Loads saved PB ghost data for a track seed
   */
  public static loadPB(seed: number): SavedGhostRun | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(this.getKey(seed));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SavedGhostRun;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.frames) && parsed.frames.length > 0) {
        return parsed;
      }
      return null;
    } catch (e) {
      console.warn('[GhostStorage] Failed to load PB ghost:', e);
      return null;
    }
  }

  /**
   * Saves a new PB ghost run if it improves on previous completion time or score.
   * Returns true if saved as a new personal best, false otherwise.
   */
  public static savePB(
    seed: number,
    trackTitle: string,
    completionTime: number,
    score: number,
    rawFrames: ReplayFrame[],
    checkpointTimes: number[]
  ): boolean {
    try {
      if (typeof localStorage === 'undefined') return false;
      if (rawFrames.length < 10) return false;

      const existing = this.loadPB(seed);
      if (existing) {
        // Only replace if new run has higher score or faster time
        const isBetter = score > existing.score || (completionTime < existing.completionTime && score >= existing.score * 0.9);
        if (!isBetter) {
          return false;
        }
      }

      const ghostData: SavedGhostRun = {
        version: 1,
        seed,
        trackTitle,
        completionTime: round2(completionTime),
        score: Math.round(score),
        date: Date.now(),
        frames: this.compressFrames(rawFrames),
        checkpointTimes: checkpointTimes.map(round2)
      };

      const serialized = JSON.stringify(ghostData);
      localStorage.setItem(this.getKey(seed), serialized);
      return true;
    } catch (e) {
      console.warn('[GhostStorage] Failed to save PB ghost (quota or storage error):', e);
      return false;
    }
  }

  /**
   * Clears saved PB ghost for a given seed
   */
  public static clearPB(seed: number): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(this.getKey(seed));
      }
    } catch {
      // Ignore
    }
  }
}
