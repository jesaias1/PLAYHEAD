import { SURF_GENERATION_VERSION } from '../generation/CourseType';
/**
 * CustomAnalysisCache: versioned, bounded, content-addressed cache of compact
 * custom-audio analysis + generated route. Keyed by the content hash (never the
 * filename), so renaming a file reuses the same geometry.
 *
 * The cache stores descriptors + the compact node graph only (no PCM). Every
 * entry is validated for schema, finiteness, generation version and real route
 * connectivity before it is trusted; a malformed / stale / non-connecting entry
 * is discarded as a clean miss. Both the in-memory Map and the persisted JSON
 * are bounded (count AND serialized bytes).
 */

import { AnalysisSection, AnalysisFrame, CustomSourceMeta, OnsetEvent, TrackAnalysis } from './AudioFeatures';
import { CheckpointDefinition, FinishDefinition, GeneratedTrack, RouteFork, RouteNode, SurfRibbonStation } from '../generation/GenerationTypes';
import { RouteConnectivityValidator } from '../generation/RouteConnectivityValidator';
import { ROUTE_GENERATION_VERSION } from '../generation/RouteGenerator';
import { SurfCourseValidator } from '../generation/SurfCourseValidator';
import { CourseType, normalizeCourseType } from '../generation/CourseType';

/**
 * Bumped whenever hashing, sectioning or cache encoding changes so a stale
 * persisted entry can never be mistaken for a current one.
 */
export const CUSTOM_ANALYSIS_CACHE_VERSION = 4;
const STORAGE_KEY = 'playhead.customAnalysis.v4';
const MAX_MEMORY_ENTRIES = 12;
const MAX_PERSISTED_ENTRIES = 12;
/** Hard bound on the serialized cache; older entries are evicted to fit. */
const MAX_PERSISTED_BYTES = 3_000_000;

interface CustomCacheEntry {
  hash: string;
  version: number;
  generationVersion: number;
  savedAt: number;
  analysis: TrackAnalysis;
  track: GeneratedTrack;
}

interface CustomCacheFile {
  version: number;
  entries: CustomCacheEntry[];
}

export interface CachedCustomLevel {
  analysis: TrackAnalysis;
  track: GeneratedTrack;
}

function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function serializeCache(file: CustomCacheFile): string {
  return JSON.stringify(file, (_key, value) => value instanceof Float32Array ? Array.from(value) : value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteVec3(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as { x?: unknown; y?: unknown; z?: unknown };
  return isFiniteNumber(v.x) && isFiniteNumber(v.y) && isFiniteNumber(v.z);
}

function validateAnalysis(analysis: unknown): analysis is TrackAnalysis {
  if (!analysis || typeof analysis !== 'object') return false;
  const a = analysis as Partial<TrackAnalysis>;
  if (![a.bpm, a.bpmConfidence, a.globalEnergy].every(isFiniteNumber)) return false;
  if (!a.visualAccent || !Array.isArray(a.visualAccent.rgb) || a.visualAccent.rgb.length !== 3) return false;
  if (!isFiniteNumber(a.duration) || a.duration <= 0) return false;
  if (!isFiniteNumber(a.seed)) return false;
  if (!Array.isArray(a.sections) || a.sections.length === 0) return false;

  for (const raw of a.sections as unknown[]) {
    if (!raw || typeof raw !== 'object') return false;
    const s = raw as Partial<AnalysisSection>;
    if (!isFiniteNumber(s.start) || !isFiniteNumber(s.end) || !isFiniteNumber(s.duration)) return false;
    if (!(s.end > s.start)) return false;
    if (!isFiniteNumber(s.intensity) || !isFiniteNumber(s.rhythmicDensity) || !isFiniteNumber(s.brightness)) return false;
    if (typeof s.theme !== 'string') return false;
  }

  if (!Array.isArray(a.frames)) return false;
  for (const raw of a.frames as unknown[]) {
    if (!raw || typeof raw !== 'object') return false;
    const f = raw as Partial<AnalysisFrame>;
    if (!isFiniteNumber(f.time) || !isFiniteNumber(f.rms) || !isFiniteNumber(f.centroid)) return false;
    if (![f.bass, f.lowMid, f.mid, f.high, f.flux, f.density].every(isFiniteNumber)) return false;
  }
  if (!Array.isArray(a.onsets)) return false;
  for (const raw of a.onsets as unknown[]) {
    const o = raw as Partial<OnsetEvent>;
    if (!o || !isFiniteNumber(o.time)) return false;
  }

  const waveform = a.waveform;
  if (!(waveform instanceof Float32Array) && !Array.isArray(waveform)) return false;
  const wf = waveform as ArrayLike<number>;
  if (wf.length < 1) return false;
  for (let i = 0; i < wf.length; i++) {
    if (!isFiniteNumber(wf[i])) return false;
  }

  if (a.customSource != null) {
    const cs = a.customSource as Partial<CustomSourceMeta>;
    if (typeof cs.contentHash !== 'string' || cs.contentHash.length === 0) return false;
  }
  return true;
}

function validateTrack(track: unknown): track is GeneratedTrack {
  if (!track || typeof track !== 'object') return false;
  const t = track as Partial<GeneratedTrack>;
  if (!isFiniteNumber(t.seed) || !isFiniteNumber(t.totalDistance) || !isFiniteNumber(t.targetDuration)) return false;
  if (t.courseType !== undefined && t.courseType !== 'PLAYHEAD' && t.courseType !== 'SURF') return false;
  if (t.generationVersion !== (t.courseType === 'SURF' ? SURF_GENERATION_VERSION : ROUTE_GENERATION_VERSION)) return false;
  if (!Array.isArray(t.route) || t.route.length < 2) return false;

  const lengths: number[] = [];
  for (const raw of t.route as unknown[]) {
    if (!raw || typeof raw !== 'object') return false;
    const n = raw as Partial<RouteNode>;
    if (!isFiniteNumber(n.time) || !isFiniteNumber(n.arcLength)) return false;
    if (!isFiniteVec3(n.position) || !isFiniteVec3(n.dimensions)) return false;
    if (![n.id, n.yaw, n.pitch, n.roll, n.sectionIndex].every(isFiniteNumber)) return false;
    if (t.courseType === 'SURF' && n.ribbon) {
      if (!Array.isArray(n.ribbon.stations) || n.ribbon.stations.length !== 2) return false;
      for (const station of n.ribbon.stations) {
        if (!isFiniteVec3(station.center) || !isFiniteVec3(station.normal) || !isFiniteVec3(station.right) || !isFiniteVec3(station.tangent) || !isFiniteNumber(station.halfWidth) || station.halfWidth <= 0) return false;
      }
    }
    lengths.push(n.arcLength as number);
  }
  // Arc length must be monotonically non-decreasing.
  for (let i = 1; i < lengths.length; i++) {
    if (lengths[i] < lengths[i - 1] - 1e-3) return false;
  }

  const finish = t.finish as Partial<FinishDefinition> | undefined;
  if (!finish || !isFiniteNumber(finish.time) || !isFiniteNumber(finish.routeNodeId) || !isFiniteVec3(finish.position)) return false;

  if (!Array.isArray(t.checkpoints)) return false;
  for (const raw of t.checkpoints as unknown[]) {
    const cp = raw as Partial<CheckpointDefinition>;
    if (!cp || !isFiniteNumber(cp.time) || !isFiniteNumber(cp.routeNodeId) || !isFiniteVec3(cp.position)) return false;
  }

  for (const arr of [t.optionalRamps, t.recoveryShelves, t.signalSpines, t.obstacles] as unknown[]) {
    if (arr == null) continue;
    if (!Array.isArray(arr)) return false;
    for (const raw of arr as unknown[]) {
      const n = raw as Partial<RouteNode>;
      if (!n || !isFiniteNumber(n.time) || !isFiniteNumber(n.arcLength) || !isFiniteVec3(n.position)) return false;
    }
  }
  if (t.forks != null && !Array.isArray(t.forks)) return false;

  // Final connectivity on the cached route; a route that does not connect is
  // never served from cache (regenerate instead).
  const connectivity = RouteConnectivityValidator.validate(track as GeneratedTrack);
  return connectivity.isValid;
}

function cloneSection(section: AnalysisSection): AnalysisSection {
  return {
    ...section,
    confidence: section.confidence ? { ...section.confidence } : undefined
  };
}

function cloneAnalysis(analysis: TrackAnalysis): TrackAnalysis {
  return {
    ...analysis,
    frames: analysis.frames.map((f) => ({ ...f })),
    onsets: analysis.onsets.map((o) => ({ ...o })),
    sections: analysis.sections.map(cloneSection),
    waveform: analysis.waveform instanceof Float32Array
      ? new Float32Array(analysis.waveform)
      : (analysis.waveform as unknown as Float32Array).slice(),
    visualAccent: { ...analysis.visualAccent, rgb: [...analysis.visualAccent.rgb] as [number, number, number] },
    customAggregate: analysis.customAggregate ? { ...analysis.customAggregate } : undefined,
    customSource: analysis.customSource ? { ...analysis.customSource } : undefined
  };
}

function cloneNode(node: RouteNode): RouteNode {
  return {
    ...node,
    position: { ...node.position },
    dimensions: { ...node.dimensions },
    surfNormal: node.surfNormal ? { ...node.surfNormal } : undefined,
    ribbon: node.ribbon
      ? {
          ribbonId: node.ribbon.ribbonId,
          kind: node.ribbon.kind,
          stations: [
            cloneStation(node.ribbon.stations[0]),
            cloneStation(node.ribbon.stations[1])
          ]
        }
      : undefined,
    signalSpineHostGap: node.signalSpineHostGap ? { ...node.signalSpineHostGap } : undefined,
    obstacleMotion: node.obstacleMotion ? { ...node.obstacleMotion } : undefined
  };
}

function cloneStation(station: SurfRibbonStation): SurfRibbonStation {
  return {
    center: { ...station.center },
    normal: { ...station.normal },
    halfWidth: station.halfWidth,
    right: station.right ? { ...station.right } : undefined,
    tangent: station.tangent ? { ...station.tangent } : undefined
  };
}

function cloneFork(fork: RouteFork): RouteFork {
  return { ...fork, masteryNodes: fork.masteryNodes.map(cloneNode) };
}

function cloneTrack(track: GeneratedTrack): GeneratedTrack {
  return {
    ...track,
    route: track.route.map(cloneNode),
    optionalRamps: track.optionalRamps?.map(cloneNode),
    recoveryShelves: track.recoveryShelves?.map(cloneNode),
    signalSpines: track.signalSpines?.map(cloneNode),
    obstacles: track.obstacles?.map(cloneNode),
    forks: track.forks?.map(cloneFork),
    checkpoints: track.checkpoints.map((cp) => ({ ...cp, position: { ...cp.position } })),
    finish: { ...track.finish, position: { ...track.finish.position } }
  };
}

function cloneLevel(level: CachedCustomLevel): CachedCustomLevel {
  return { analysis: cloneAnalysis(level.analysis), track: cloneTrack(level.track) };
}

export class CustomAnalysisCache {
  private static memory = new Map<string, CachedCustomLevel>();

  /**
   * Cache key. PLAYHEAD (the default) returns the legacy `<version>:<hash>`
   * unchanged, so every existing persisted entry is still found. SURF is
   * namespaced with a `surf:` prefix so it can never collide with a normal
   * course generated from the same audio.
   */
  public static buildKey(
    contentHash: string,
    courseTypeOrVersion: CourseType | number = 'PLAYHEAD',
    analysisVersion = CUSTOM_ANALYSIS_CACHE_VERSION
  ): string {
    const type = typeof courseTypeOrVersion === 'number' ? 'PLAYHEAD' : normalizeCourseType(courseTypeOrVersion);
    const version = typeof courseTypeOrVersion === 'number' ? courseTypeOrVersion : analysisVersion;
    return `${type === 'SURF' ? `surf:${SURF_GENERATION_VERSION}:` : ''}${version}:${contentHash}`;
  }

  public static load(contentHash: string, courseType: CourseType = 'PLAYHEAD'): CachedCustomLevel | null {
    try {
      return this.loadValidated(contentHash, courseType);
    } catch {
      return null;
    }
  }

  private static loadValidated(contentHash: string, courseType: CourseType): CachedCustomLevel | null {
    const key = this.buildKey(contentHash, courseType);
    const mem = this.memory.get(key);
    if (mem) return cloneLevel(mem);

    const storage = safeStorage();
    if (!storage) return null;

    let file: CustomCacheFile;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      file = JSON.parse(raw) as CustomCacheFile;
    } catch {
      return null;
    }
    if (!file || file.version !== CUSTOM_ANALYSIS_CACHE_VERSION || !Array.isArray(file.entries)) {
      return null;
    }

    const entry = file.entries.find(
      (e) =>
        e &&
        e.hash === key &&
        e.version === CUSTOM_ANALYSIS_CACHE_VERSION &&
        e.generationVersion === (courseType === 'SURF' ? SURF_GENERATION_VERSION : ROUTE_GENERATION_VERSION)
    );
    if (!entry) return null;
    if (!validateAnalysis(entry.analysis) || !validateTrack(entry.track)) return null;
    // Identity guard: a cached entry must belong to the SAME course type that
    // requested it (PLAYHEAD entries default to PLAYHEAD), so a normal course
    // can never be served as a SURF course or vice versa.
    if (normalizeCourseType(entry.track.courseType) !== courseType) return null;

    // Reconstruct the Float32Array waveform (JSON round-trip loses the type)
    // and re-validate the connectivity on the exact reconstructed route.
    const rebuilt: CachedCustomLevel = {
      analysis: {
        ...entry.analysis,
        waveform: new Float32Array(entry.analysis.waveform as unknown as ArrayLike<number>)
      },
      track: entry.track
    };
    if (!validateTrack(rebuilt.track) || !RouteConnectivityValidator.validate(rebuilt.track).isValid) return null;
    // SURF entries are validated by the SURF-specific validator on the exact
    // reconstructed geometry, not the normal platform validator.
    if (courseType === 'SURF' && !SurfCourseValidator.validate(rebuilt.track).isValid) return null;

    this.rememberEntries([{ key, level: rebuilt }]);
    return cloneLevel(rebuilt);
  }

  public static save(contentHash: string, level: CachedCustomLevel, courseType: CourseType = 'PLAYHEAD'): boolean {
    const key = this.buildKey(contentHash, courseType);
    if (normalizeCourseType(level.track.courseType) !== courseType || !validateTrack(level.track)) return false;
    const stored = cloneLevel(level);
    this.memory.set(key, stored);
    this.pruneMemory();

    const storage = safeStorage();
    if (!storage) return false;

    let file: CustomCacheFile = { version: CUSTOM_ANALYSIS_CACHE_VERSION, entries: [] };
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CustomCacheFile;
        if (parsed && parsed.version === CUSTOM_ANALYSIS_CACHE_VERSION && Array.isArray(parsed.entries)) {
          file = parsed;
        }
      }
    } catch {
      file = { version: CUSTOM_ANALYSIS_CACHE_VERSION, entries: [] };
    }

    const next: CustomCacheEntry[] = file.entries.filter(
      (e) =>
        e &&
        e.hash !== key &&
        e.version === CUSTOM_ANALYSIS_CACHE_VERSION &&
        !this.isExpiredOrInvalid(e)
    );
    next.unshift({
      hash: key,
      version: CUSTOM_ANALYSIS_CACHE_VERSION,
      generationVersion: stored.track.generationVersion ?? ROUTE_GENERATION_VERSION,
      savedAt: Date.now(),
      analysis: stored.analysis,
      track: stored.track
    });

    // Bounded by count AND serialized bytes; drop oldest until it fits.
    let bounded = next.slice(0, MAX_PERSISTED_ENTRIES);
    let serialized = serializeCache({ version: CUSTOM_ANALYSIS_CACHE_VERSION, entries: bounded });
    while (serialized.length > MAX_PERSISTED_BYTES && bounded.length > 1) {
      bounded = bounded.slice(0, bounded.length - 1);
      serialized = serializeCache({ version: CUSTOM_ANALYSIS_CACHE_VERSION, entries: bounded });
    }
    if (serialized.length > MAX_PERSISTED_BYTES) return false;

    try {
      storage.setItem(STORAGE_KEY, serialized);
      return true;
    } catch {
      // Quota or serialization failure: drop oldest persisted entries and retry once.
      try {
        const smallest = bounded.slice(0, Math.max(1, Math.floor(bounded.length / 2)));
        storage.setItem(
          STORAGE_KEY,
          serializeCache({ version: CUSTOM_ANALYSIS_CACHE_VERSION, entries: smallest })
        );
        return true;
      } catch {
        return false;
      }
    }
  }

  public static clear(): void {
    this.memory.clear();
    const storage = safeStorage();
    if (!storage) return;
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  private static pruneMemory(): void {
    while (this.memory.size > MAX_MEMORY_ENTRIES) {
      const oldest = this.memory.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.memory.delete(oldest);
    }
  }

  private static rememberEntries(entries: Array<{ key: string; level: CachedCustomLevel }>): void {
    for (const { key, level } of entries) {
      this.memory.set(key, level);
    }
    this.pruneMemory();
  }

  private static isExpiredOrInvalid(entry: CustomCacheEntry): boolean {
    try {
    if (entry.version !== CUSTOM_ANALYSIS_CACHE_VERSION) return true;
    if (entry.generationVersion !== (entry.track.courseType === 'SURF' ? SURF_GENERATION_VERSION : ROUTE_GENERATION_VERSION)) return true;
    if (!validateAnalysis(entry.analysis)) return true;
    if (!validateTrack(entry.track)) return true;
    return false;
    } catch {
      return true;
    }
  }
}
