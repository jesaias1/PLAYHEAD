import { SURF_GENERATION_VERSION } from '../generation/CourseType';
/**
 * GhostStorage: Compact serialization and localStorage persistence for personal best ghost runs
 */

import { ReplayFrame } from './ReplayRecorder';
import { seedToHex } from '../utils/hash';
import { CourseType, normalizeCourseType } from '../generation/CourseType';

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
  /**
   * Course style. Optional and ADDITIVE: a legacy record with no value is
   * treated as PLAYHEAD. The storage key is already namespaced per course type,
   * and this is a second guard against ever mixing the two.
   */
  courseType?: CourseType;
  courseIdentity?: string;
  generationVersion?: number;
}

const STORAGE_PREFIX = 'trackrun_ghost_pb_';

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

export class GhostStorage {
  /**
   * PB storage key. PLAYHEAD returns the legacy key byte-for-byte so every
   * existing stored PB is still found; SURF is namespaced so a surf PB can
   * never be read as (or overwrite) a normal PLAYHEAD PB of the same audio.
   */
  private static getKey(seed: number, courseType: CourseType = 'PLAYHEAD', courseIdentity?: string): string {
    const suffix = normalizeCourseType(courseType) === 'SURF' ? `surf_v${SURF_GENERATION_VERSION}_${courseIdentity ?? 'unbound'}_` : '';
    return `${STORAGE_PREFIX}${suffix}${seedToHex(seed)}`;
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
  public static hasPB(seed: number, courseType: CourseType = 'PLAYHEAD', courseIdentity?: string): boolean {
    try {
      if (typeof localStorage === 'undefined') return false;
      return this.loadPB(seed, courseType, courseIdentity) !== null;
    } catch {
      return false;
    }
  }

  /**
   * Loads saved PB ghost data for a track seed
   */
  public static loadPB(seed: number, courseType: CourseType = 'PLAYHEAD', courseIdentity?: string): SavedGhostRun | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(this.getKey(seed, courseType, courseIdentity));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SavedGhostRun;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.frames) && parsed.frames.length > 0) {
        // Identity guard: an explicit course type must match. A legacy record
        // (absent) is PLAYHEAD and is only ever returned for PLAYHEAD.
        if (normalizeCourseType(parsed.courseType) !== normalizeCourseType(courseType)) return null;
        if (courseType === 'SURF' && (!courseIdentity || parsed.courseIdentity !== courseIdentity || parsed.generationVersion !== SURF_GENERATION_VERSION)) return null;
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
    checkpointTimes: number[],
    courseType: CourseType = 'PLAYHEAD',
    courseIdentity?: string
  ): boolean {
    try {
      if (typeof localStorage === 'undefined') return false;
      if (rawFrames.length < 10) return false;
      if (courseType === 'SURF' && !courseIdentity) return false;

      const existing = this.loadPB(seed, courseType, courseIdentity);
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
        completionTime: completionTime,
        score: Math.round(score),
        date: Date.now(),
        frames: this.compressFrames(rawFrames),
        checkpointTimes: checkpointTimes.map(round2),
        courseType: normalizeCourseType(courseType),
        courseIdentity,
        generationVersion: courseType === 'SURF' ? SURF_GENERATION_VERSION : undefined
      };

      const serialized = JSON.stringify(ghostData);
      localStorage.setItem(this.getKey(seed, courseType, courseIdentity), serialized);
      return true;
    } catch (e) {
      console.warn('[GhostStorage] Failed to save PB ghost (quota or storage error):', e);
      return false;
    }
  }

  /**
   * Clears saved PB ghost for a given seed
   */
  public static clearPB(seed: number, courseType: CourseType = 'PLAYHEAD', courseIdentity?: string): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(this.getKey(seed, courseType, courseIdentity));
      }
    } catch {
      // Ignore
    }
  }
}
