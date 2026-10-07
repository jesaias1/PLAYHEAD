import { computeMapFingerprint } from '../src/online/MapIdentity';
import { RouteExclusionCorridor } from '../src/world/RouteExclusionCorridor';
import { GhostStorage } from '../src/replay/GhostStorage';
/**
 * SURF MODE focused tests.
 *
 * Covers: energetic/sustained analysis, deterministic identity separation with
 * unchanged PLAYHEAD keys, ribbon shared-edge continuity + collision seam sweep
 * at high speed, actual transfer envelope including rejection, descent/climb,
 * checkpoint runway restore direction, and the natural finish.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { SurfCourseGenerator } from '../src/generation/SurfCourseGenerator';
import {
  SurfCourseValidator,
  SURF_SPEED_ENVELOPE,
  ballisticTransferCheck,
  snapPlatformChain
} from '../src/generation/SurfCourseValidator';
import { TrackGenerator } from '../src/generation/TrackGenerator';
import { RouteConnectivityValidator, getNodeExitAnchor, getNodeEntryAnchor } from '../src/generation/RouteConnectivityValidator';
import { RouteGenerator } from '../src/generation/RouteGenerator';
import { CustomAnalysisCache, CUSTOM_ANALYSIS_CACHE_VERSION } from '../src/audio/CustomAnalysisCache';
import { TrackAnalysis, AnalysisSection, SectionTheme } from '../src/audio/AudioFeatures';
import { RibbonSurfaceCollider } from '../src/physics/Collider';
import { ribbonSurfaceCorners, buildRibbonSurfaceMesh } from '../src/generation/SurfRibbon';
import { normalizeCourseType, courseTypeKeySuffix, SURF_GENERATION_VERSION } from '../src/generation/CourseType';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';

function mock(seed: number, duration: number, bpm: number, themes: SectionTheme[], intensityAt?: (t: SectionTheme, i: number) => number): TrackAnalysis {
  const count = themes.length, step = duration / count;
  const sections: AnalysisSection[] = themes.map((t, i) => ({
    index: i,
    start: i * step,
    end: (i + 1) * step,
    duration: step,
    intensity: intensityAt ? intensityAt(t, i) : (t === 'DROP' ? 0.95 : t === 'BREATH' ? 0.25 : 0.6),
    rhythmicDensity: 0.7,
    brightness: 0.6,
    theme: t
  }));
  return {
    filename: `s_${seed}`,
    duration,
    bpm,
    bpmConfidence: 0.85,
    globalEnergy: 0.65,
    frames: [],
    onsets: [],
    sections,
    waveform: new Float32Array(512),
    seed,
    visualAccent: { name: 'x', hex: '#00f0ff', rgb: [0, 240, 255] }
  };
}

const ENERGETIC: SectionTheme[] = ['FLOW', 'BUILDUP', 'DROP', 'SPEED', 'DROP', 'PRECISION', 'DESCENT', 'ASCENT', 'DROP', 'FLOW'];

describe('song-length SURF pacing', () => {
  for (const duration of [30, 90, 180, 300]) {
    for (const themes of [[], ['FLOW'], ENERGETIC] as SectionTheme[][]) {
      it(`spends the ${duration}s budget with ${themes.length} sections`, () => {
        const track = SurfCourseGenerator.generate(mock(42, duration, 128, themes));
        const seconds = track.totalDistance / 37;
        expect(seconds).toBeGreaterThan(duration * 0.85);
        expect(seconds).toBeLessThan(duration * 1.18);
        expect(track.route.every((node, i) => i === 0 || node.time >= track.route[i - 1].time)).toBe(true);
        const ribbons = new Map<number, number>();
        for (const node of track.route) if (node.ribbonId !== undefined) ribbons.set(node.ribbonId, (ribbons.get(node.ribbonId) ?? 0) + node.dimensions.z);
        expect(Math.max(...ribbons.values())).toBeGreaterThan(140);
        console.log('[SURF-PACING]', { duration, sections: themes.length, metres: Math.round(track.totalDistance), seconds: +seconds.toFixed(1), nodes: track.route.length });
      });
    }
  }
  it('keeps the safe fallback proportional to a long song', () => {
    const track = SurfCourseGenerator.generateSafeFallback(mock(42, 300, 128, ['FLOW']));
    expect(track.totalDistance / 37).toBeGreaterThan(300 * 0.85);
    expect(SurfCourseValidator.validate(track).isValid).toBe(true);
  });
});

describe('SURF generation across musical structures', () => {
  it('produces a valid, surf-dominant course for an energetic track', () => {
    const track = SurfCourseGenerator.generate(mock(0x12345, 180, 128, ENERGETIC), 'SURF');
    const v = SurfCourseValidator.validate(track);
    const c = RouteConnectivityValidator.validate(track);
    expect(c.isValid).toBe(true);
    expect(v.isValid).toBe(true);
    expect(track.courseType).toBe('SURF');
    // Surf-DOMINANT by traversal distance.
    expect(v.surfFraction).toBeGreaterThanOrEqual(0.7);
    expect(v.surfFraction).toBeLessThanOrEqual(0.95);
  });

  it('produces a valid course for a slower, sustained track', () => {
    const sustained: SectionTheme[] = ['FLOW', 'BREATH', 'FLOW', 'BREATH', 'SURF', 'BREATH', 'FLOW'];
    const track = SurfCourseGenerator.generate(
      mock(0xABCDE, 220, 92, sustained, () => 0.35),
      'SURF'
    );
    const v = SurfCourseValidator.validate(track);
    expect(v.isValid).toBe(true);
    expect(v.surfFraction).toBeGreaterThan(0.6);
  });

  it('keeps every generated representative course valid across seeds', () => {
    for (const seed of [0x12345, 0xABCDE, 0x98765, 1, 2, 3, 42, 999]) {
      const track = SurfCourseGenerator.generate(mock(seed, 180, 128, ENERGETIC), 'SURF');
      expect(RouteConnectivityValidator.validate(track).isValid, `seed ${seed} connectivity`).toBe(true);
      expect(SurfCourseValidator.validate(track).isValid, `seed ${seed} surf validation`).toBe(true);
    }
  });

  it('generates real curved / transfer / vertical content, not a straight fallback', () => {
    const track = SurfCourseGenerator.generate(mock(0x12345, 180, 128, ENERGETIC), 'SURF');
    const ribbons = new Map<number, number[]>(); // ribbonId -> yaw samples
    for (const n of track.route) {
      if (n.ribbonId === undefined) continue;
      const list = ribbons.get(n.ribbonId) ?? [];
      list.push(n.yaw);
      ribbons.set(n.ribbonId, list);
    }
    let curvedRibbons = 0;
    let bankedRibbons = 0;
    let risingRibbons = 0;
    let verticalSpan = 0;
    let minY = Infinity, maxY = -Infinity;
    for (const [, yaws] of ribbons) {
      const span = Math.max(...yaws) - Math.min(...yaws);
      if (span > 0.15) curvedRibbons++;
    }
    for (const n of track.route) {
      if (n.ribbon) {
        const rise = n.ribbon.stations[1].center.y - n.ribbon.stations[0].center.y;
        risingRibbons += Math.max(0, rise);
        if (Math.abs(n.roll) > 0.5) bankedRibbons++;
        minY = Math.min(minY, n.position.y);
        maxY = Math.max(maxY, n.position.y);
      }
    }
    verticalSpan = maxY - minY;
    expect(curvedRibbons).toBeGreaterThan(0);
    expect(bankedRibbons).toBeGreaterThan(0);
    expect(risingRibbons).toBeGreaterThan(1.5);
    expect(verticalSpan).toBeGreaterThan(20);
  });
});

describe('ribbon shared-edge continuity and collision seams', () => {
  const track = SurfCourseGenerator.generate(mock(0x12345, 180, 128, ENERGETIC), 'SURF');

  it('adjacent segments share exact world-space edge vertices', () => {
    const byRibbon = new Map<number, typeof track.route>();
    for (const n of track.route) {
      if (n.ribbonId === undefined) continue;
      const list = byRibbon.get(n.ribbonId) ?? [];
      list.push(n);
      byRibbon.set(n.ribbonId, list);
    }
    for (const [, list] of byRibbon) {
      list.sort((a, b) => (a.ribbonStationIndex ?? 0) - (b.ribbonStationIndex ?? 0));
      for (let i = 0; i < list.length - 1; i++) {
        const ca = ribbonSurfaceCorners(list[i])!;
        const cb = ribbonSurfaceCorners(list[i + 1])!;
        expect(ca[2].distanceTo(cb[1])).toBeLessThan(0.05);
        expect(ca[3].distanceTo(cb[0])).toBeLessThan(0.05);
      }
    }
  });

  it('builds exactly one collider per continuous ribbonId', () => {
    const world = new PhysicsWorld();
    world.buildFromRoute(track.route);
    const ribbonColliders = world.colliders.filter(c => c instanceof RibbonSurfaceCollider);
    const uniqueRibbons = new Set(
      track.route.filter(n => n.ribbonId !== undefined).map(n => n.ribbonId)
    );
    expect(ribbonColliders.length).toBeGreaterThan(0);
    // ONE finite collider per continuous ribbon, never one per segment.
    expect(ribbonColliders.length).toBe(uniqueRibbons.size);
  });

  it('never reports contact beyond the finite sampled surface', () => {
    const ribbonId = track.route.find(n => n.ribbon)!.ribbonId!;
    const segs = track.route.filter(n => n.ribbonId === ribbonId)
      .sort((x, y) => (x.ribbonStationIndex ?? 0) - (y.ribbonStationIndex ?? 0));
    const collider = new RibbonSurfaceCollider(segs);
    const first = segs[0].ribbon!.stations[0];
    const last = segs[segs.length - 1].ribbon!.stations[1];
    const n = new THREE.Vector3(first.normal.x, first.normal.y, first.normal.z).normalize();
    const tan = new THREE.Vector3(last.center.x - first.center.x, 0, last.center.z - first.center.z).normalize();
    const side = new THREE.Vector3().crossVectors(n, tan).normalize();

    // Exactly on the sampled top face -> contact with an OUTWARD normal.
    const on = collider.testSphere(new THREE.Vector3(first.center.x, first.center.y, first.center.z), 0.5);
    expect(on.hasContact).toBe(true);
    expect(on.normal.dot(n)).toBeGreaterThan(0.8);

    // 1.0m above the surface (radius is 0.5) -> no contact (no averaged plane).
    const above = collider.testSphere(new THREE.Vector3(
      first.center.x + n.x, first.center.y + n.y, first.center.z + n.z), 0.5);
    expect(above.hasContact).toBe(false);

    // 6m to the side, inside the broad bounding radius -> no contact.
    const off = collider.testSphere(new THREE.Vector3(
      first.center.x + side.x * 6, first.center.y, first.center.z + side.z * 6), 0.5);
    expect(off.hasContact).toBe(false);

    // 5m beyond the exit end -> no contact (finite end).
    const beyond = collider.testSphere(new THREE.Vector3(
      last.center.x + tan.x * 5, last.center.y, last.center.z + tan.z * 5), 0.5);
    expect(beyond.hasContact).toBe(false);
  });

  it('resolveCapsule gives ONE bounded correction at a shared seam', () => {
    const world = new PhysicsWorld();
    world.buildFromRoute(track.route);
    const ribbonId = [...new Set(track.route.filter(n => n.ribbonId !== undefined).map(n => n.ribbonId!))]
      .find(id => track.route.filter(n => n.ribbonId === id).length >= 2)!;
    const segs = track.route.filter(n => n.ribbonId === ribbonId)
      .sort((x, y) => (x.ribbonStationIndex ?? 0) - (y.ribbonStationIndex ?? 0));
    const seam = segs[0].ribbon!.stations[1];
    const n = new THREE.Vector3(seam.normal.x, seam.normal.y, seam.normal.z).normalize();
    const radius = 0.5;
    const height = 1.8;
    // Feet positioned so the capsule's BOTTOM SPHERE CENTRE sits exactly on the
    // shared seam of the top surface.
    const feet = new THREE.Vector3(seam.center.x, seam.center.y - radius, seam.center.z);
    const before = feet.clone();
    const res = world.resolveCapsule(feet, radius, height);
    const moved = res.adjustedPos.distanceTo(before);
    // A real correction, but exactly ONE surface radius: two overlapping per-
    // segment colliders would double this (~2*radius) or eject the player.
    expect(moved).toBeGreaterThan(radius * 0.5);
    expect(moved).toBeLessThan(radius + 0.1);
    expect(res.adjustedPos.y).toBeGreaterThan(before.y);
    expect(res.isSurfing).toBe(true);
  });

  it('keeps contact normals smooth along the actual sampled surface', () => {
    const ribbonIds = [...new Set(track.route.filter(n => n.ribbonId !== undefined).map(n => n.ribbonId!))];
    let worstDeg = 0;
    for (const ribbonId of ribbonIds) {
      const segs = track.route.filter(n => n.ribbonId === ribbonId)
        .sort((x, y) => (x.ribbonStationIndex ?? 0) - (y.ribbonStationIndex ?? 0));
      const collider = new RibbonSurfaceCollider(segs);
      let prev: THREE.Vector3 | null = null;
      for (const node of segs) {
        const a = node.ribbon!.stations[0];
        const b = node.ribbon!.stations[1];
        const up = new THREE.Vector3(
          a.normal.x + b.normal.x, a.normal.y + b.normal.y, a.normal.z + b.normal.z).normalize();
        for (let k = 0; k <= 8; k++) {
          const t = k / 8;
          // A real player contacts the TOP face from slightly above; probe the
          // surface offset a little along the local normal (penetrating contact),
          // never an exact corner tie with the underside.
          const p = new THREE.Vector3(
            a.center.x + (b.center.x - a.center.x) * t + up.x * 0.25,
            a.center.y + (b.center.y - a.center.y) * t + up.y * 0.25,
            a.center.z + (b.center.z - a.center.z) * t + up.z * 0.25);
          const r = collider.testSphere(p, 0.5);
          expect(r.hasContact).toBe(true);
          if (prev) {
            const dot = Math.max(-1, Math.min(1, r.normal.dot(prev)));
            worstDeg = Math.max(worstDeg, (Math.acos(dot) * 180) / Math.PI);
          }
          prev = r.normal.clone();
        }
      }
    }
    // No violent normal swing between adjacent samples at playable speed.
    expect(worstDeg).toBeLessThan(25);
  });

  it('is idempotent when snapped a second time', () => {
    const track2 = SurfCourseGenerator.generate(mock(0x12345, 180, 128, ENERGETIC), 'SURF');
    const before = track2.route.map(n => ({ ...n.position }));
    const resnap = snapPlatformChain(track2.route);
    expect(resnap.repairsCount).toBe(0);
    track2.route.forEach((n, i) => {
      expect(n.position.x).toBeCloseTo(before[i].x, 6);
      expect(n.position.z).toBeCloseTo(before[i].z, 6);
    });
  });
});

describe('transfer envelopes', () => {
  it('rejects a ballistic arc that cannot reach the target', () => {
    const launch = {
      id: 0, time: 0, position: { x: 0, y: 10, z: 0 },
      dimensions: { x: 10, y: 2, z: 10 }, yaw: 0, pitch: 0, roll: 0,
      type: 'SURF_RAMP' as never, intensity: 0.5, sectionIndex: 0, arcLength: 0,
      isSurf: true, isBoost: false
    };
    const far = {
      ...launch, id: 1, position: { x: 0, y: -80, z: 0 }
    };
    const check = ballisticTransferCheck(launch, far, SURF_SPEED_ENVELOPE.expected);
    expect(check.reachable).toBe(false);
  });

  it('preserves a REAL airborne transfer with gap>2m and alternating banks', () => {
    const track = SurfCourseGenerator.generate(mock(0x12345, 180, 128, ENERGETIC), 'SURF');
    const airIdx = track.route.findIndex(n => n.surfTransition === 'AIR');
    expect(airIdx).toBeGreaterThan(0);
    const target = track.route[airIdx];
    const launch = track.route[airIdx - 1];
    // The gap must SURVIVE final generation - not be snapped into a direct join.
    const gap = Math.hypot(
      getNodeEntryAnchor(target).position.x - getNodeExitAnchor(launch).position.x,
      getNodeEntryAnchor(target).position.z - getNodeExitAnchor(launch).position.z
    );
    expect(gap).toBeGreaterThan(2.0);
    // ...and it must be genuinely catchable at ALL three envelope speeds.
    for (const speed of [SURF_SPEED_ENVELOPE.minimum, SURF_SPEED_ENVELOPE.expected, SURF_SPEED_ENVELOPE.highSkill]) {
      const check = ballisticTransferCheck(launch, target, speed, track.route.filter(n => n.ribbonId === target.ribbonId));
      expect(check.reachable, `AIR transfer at ${speed}m/s`).toBe(true);
      expect(check.lateralWithinCatch).toBe(true);
    }
    // Alternating banks: the launch and target ribbons lean opposite ways.
    const launchBank = launch.ribbon!.stations[0].normal;
    const targetBank = target.ribbon!.stations[0].normal;
    expect(Math.sign(launchBank.x) * Math.sign(targetBank.x)).toBeLessThan(0.5);
  });

  it('rejects the same transfer when the target is pushed far away or behind', () => {
    const track = SurfCourseGenerator.generate(mock(0x12345, 180, 128, ENERGETIC), 'SURF');
    const airIdx = track.route.findIndex(n => n.surfTransition === 'AIR');
    const launch = track.route[airIdx - 1];
    const realTarget = track.route[airIdx];
    const farTarget = JSON.parse(JSON.stringify(realTarget));
    farTarget.position.x += 400;
    farTarget.ribbon.stations[0].center.x += 400;
    farTarget.ribbon.stations[1].center.x += 400;
    for (const speed of [SURF_SPEED_ENVELOPE.minimum, SURF_SPEED_ENVELOPE.expected, SURF_SPEED_ENVELOPE.highSkill]) {
      expect(ballisticTransferCheck(launch, farTarget, speed).reachable).toBe(false);
    }
    // A target BEHIND the launch tangent can never be a valid transfer.
    const behind = JSON.parse(JSON.stringify(realTarget));
    behind.position.z -= 60;
    behind.ribbon.stations[0].center.z -= 60;
    behind.ribbon.stations[1].center.z -= 60;
    expect(ballisticTransferCheck(launch, behind, SURF_SPEED_ENVELOPE.expected).reachable).toBe(false);
  });

  it('every airborne surf edge is caught across the full speed envelope', () => {
    const track = SurfCourseGenerator.generate(mock(0x12345, 180, 128, ENERGETIC), 'SURF');
    for (let i = 0; i < track.route.length - 1; i++) {
      const a = track.route[i], b = track.route[i + 1];
      if (!a.isSurf && !b.isSurf) continue;
      if (a.ribbonId !== undefined && a.ribbonId === b.ribbonId) continue;
      const gap = Math.hypot(getNodeEntryAnchor(b).position.x - getNodeExitAnchor(a).position.x, getNodeEntryAnchor(b).position.z - getNodeExitAnchor(a).position.z);
      if (gap < 1.5) continue;
      const anyReachable = [SURF_SPEED_ENVELOPE.minimum, SURF_SPEED_ENVELOPE.expected, SURF_SPEED_ENVELOPE.highSkill]
        .every((s) => ballisticTransferCheck(a, b, s, b.ribbon ? track.route.filter(n=>n.ribbonId===b.ribbonId) : [b]).reachable);
      expect(anyReachable, `edge ${a.id}->${b.id}`).toBe(true);
    }
  });
});

describe('descent and climb', () => {
  it('contains both meaningful descent and a feasible climb', () => {
    const track = SurfCourseGenerator.generate(mock(0x12345, 180, 128, ENERGETIC), 'SURF');
    const ribbonRise = new Map<number, number>();
    for (const n of track.route) {
      if (!n.ribbon || n.ribbonId === undefined) continue;
      if (!ribbonRise.has(n.ribbonId)) {
        ribbonRise.set(n.ribbonId, n.ribbon.stations[0].center.y);
      }
      ribbonRise.set(n.ribbonId + 0.5, n.ribbon.stations[1].center.y); // last via half-key
    }
    let descents = 0, climbs = 0;
    for (const n of track.route) {
      if (!n.ribbon) continue;
      const rise = n.ribbon.stations[1].center.y - n.ribbon.stations[0].center.y;
      if (rise < -0.5) descents++;
      climbs += Math.max(0, rise);
    }
    expect(descents).toBeGreaterThan(0);
    expect(climbs).toBeGreaterThan(1.5);
    expect(SurfCourseValidator.validate(track).isValid).toBe(true);
  });
});

describe('course-type identity and unchanged PLAYHEAD', () => {
  it('normalises unknown values to PLAYHEAD and namespaces SURF only', () => {
    expect(normalizeCourseType(undefined)).toBe('PLAYHEAD');
    expect(normalizeCourseType('nonsense')).toBe('PLAYHEAD');
    expect(normalizeCourseType('SURF')).toBe('SURF');
    expect(courseTypeKeySuffix('PLAYHEAD')).toBe('');
    expect(courseTypeKeySuffix('SURF')).toBe('surf:');
  });

  it('keeps legacy PLAYHEAD cache keys byte-identical and separates SURF', () => {
    const legacy = `${CUSTOM_ANALYSIS_CACHE_VERSION}:hash123`;
    expect(CustomAnalysisCache.buildKey('hash123')).toBe(legacy);
    expect(CustomAnalysisCache.buildKey('hash123', 'PLAYHEAD')).toBe(legacy);
    expect(CustomAnalysisCache.buildKey('hash123', 99)).toBe('99:hash123');
    expect(CustomAnalysisCache.buildKey('hash123', 'SURF')).toBe(`surf:${SURF_GENERATION_VERSION}:${legacy}`);
  });

  it('generates an unchanged PLAYHEAD normal course', () => {
    const analysis = mock(777, 120, 128, ['FLOW', 'DROP', 'FLOW', 'SPEED', 'FLOW']);
    const normal = RouteGenerator.generate(analysis);
    const viaTrackGenerator = TrackGenerator.generate(analysis, 'PLAYHEAD');
    expect(viaTrackGenerator.route.length).toBe(normal.route.length);
    expect(viaTrackGenerator.totalDistance).toBe(normal.totalDistance);
    expect(normalizeCourseType(viaTrackGenerator.courseType)).toBe('PLAYHEAD');
  });
});

describe('cache round-trip', () => {
  let store: Map<string, string>;
  let originalWindow: unknown;
  beforeEach(() => {
    store = new Map();
    originalWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear()
      }
    };
    CustomAnalysisCache.clear();
  });
  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
    CustomAnalysisCache.clear();
  });

  it('retains SURF course type through a save/load and never collides with PLAYHEAD', () => {
    const analysis = mock(4242, 160, 128, ENERGETIC);
    const surfTrack = SurfCourseGenerator.generate(analysis, 'SURF');
    expect(CustomAnalysisCache.save('c-hash', { analysis, track: surfTrack }, 'SURF')).toBe(true);
    const raw = store.get('playhead.customAnalysis.v4')!;
    CustomAnalysisCache.clear();
    store.set('playhead.customAnalysis.v4', raw);
    const loaded = CustomAnalysisCache.load('c-hash', 'SURF');
    expect(loaded).not.toBeNull();
    expect(normalizeCourseType(loaded!.track.courseType)).toBe('SURF');
    expect(computeMapFingerprint(loaded!.track, loaded!.analysis)).toBe(computeMapFingerprint(surfTrack, analysis));
    expect(loaded!.track.courseIdentity).toBe(surfTrack.courseIdentity);
    // PLAYHEAD lookup must MISS the surf entry.
    expect(CustomAnalysisCache.load('c-hash', 'PLAYHEAD')).toBeNull();
    // Warm metadata survives JSON round-trip.
    const persisted = JSON.parse(store.get('playhead.customAnalysis.v4')!);
    expect(persisted.entries[0].track.route.some((n: { ribbon?: unknown }) => n.ribbon != null)).toBe(true);
  });
});

describe('checkpoint runway and finish', () => {
  const track = SurfCourseGenerator.generate(mock(0x12345, 180, 128, ENERGETIC), 'SURF');

  it('opens on an acceleration platform toward its back and closes on a finish deck', () => {
    const start = track.route[0];
    expect(start.isSurf).toBe(false);
    expect(start.dimensions.z).toBeGreaterThanOrEqual(30);
    const last = track.route[track.route.length - 1];
    expect(last.type).toBe('FINISH');
    // The finish deck sits at or below the final surf exit so a fast player glides on.
    const previousSurfExit = getNodeExitAnchor(track.route[track.route.length - 2]).position;
    expect(last.position.y).toBeLessThanOrEqual(previousSurfExit.y + 0.5);
  });

  it('places checkpoints on platforms, never mid-surf', () => {
    for (const cp of track.checkpoints) {
      const node = track.route.find(n => n.id === cp.routeNodeId);
      expect(node).toBeTruthy();
      expect(node!.isSurf).toBe(false);
    }
  });

  it('preserves checkpoint runway direction after snapping', () => {
    // The checkpoint's spawn direction should point along the platform's forward
    // (toward the next node), not off the back.
    for (const cp of track.checkpoints) {
      const idx = track.route.findIndex(n => n.id === cp.routeNodeId);
      const node = track.route[idx];
      const nextNode = track.route[idx + 1] ?? node;
      const forwardDot = Math.sin(node.yaw) * (nextNode.position.x - node.position.x) + Math.cos(node.yaw) * (nextNode.position.z - node.position.z);
      expect(forwardDot).toBeGreaterThan(-1);
    }
  });
});




describe('SURF final geometry acceptance', () => {
  it('final pipeline preserves transfers, validates all speeds, and stays deterministic', () => {
    const analysis=mock(0x12345,180,128,ENERGETIC);
    const a=TrackGenerator.generate(analysis,'SURF');
    const b=TrackGenerator.generate(analysis,'SURF');
    expect(TrackGenerator.lastReport!.usedSafeFallback).toBe(false);
    expect(computeMapFingerprint(a,analysis)).toBe(computeMapFingerprint(b,analysis));
    expect(a.route.some(n=>n.surfTransition==='AIR')).toBe(true);
    expect(SurfCourseValidator.validate(a).isValid).toBe(true);
    const changed=JSON.parse(JSON.stringify(a));
    changed.route.find((n:any)=>n.ribbon).ribbon.stations[0].center.x+=0.1;
    expect(computeMapFingerprint(changed,analysis)).not.toBe(computeMapFingerprint(a,analysis));
    const normal=TrackGenerator.generate(analysis,'PLAYHEAD');
    expect(computeMapFingerprint(normal)).toBe(computeMapFingerprint({...normal,courseType:undefined}));
  });

  it('renders the exact outward collision triangles and retains bright/dark face roles', () => {
    const node=SurfCourseGenerator.generate(mock(42,120,128,ENERGETIC)).route.find(n=>n.ribbon)!;
    const mesh=buildRibbonSurfaceMesh(node)!;
    const visualTop: string[]=[];
    const key=(a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3)=>JSON.stringify([a.toArray(),b.toArray(),c.toArray()]);
    for(let j=0;j<mesh.indices.length;j+=3) {
      const ids=mesh.indices.slice(j,j+3);
      const [a,b,c]=ids.map(i=>new THREE.Vector3(...mesh.positions.slice(i*3,i*3+3) as [number,number,number]));
      const normal=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      const attribute=new THREE.Vector3(...mesh.normals.slice(ids[0]*3,ids[0]*3+3) as [number,number,number]);
      expect(normal.dot(attribute)).toBeGreaterThan(0.8);
      if(mesh.faceRoles[ids[0]]===0) visualTop.push(key(a,b,c));
    }
    expect(visualTop).toEqual(mesh.collisionTriangles.filter(t=>t.kind==='TOP').map(t=>key(t.a,t.b,t.c)));
    expect(mesh.faceRoles).toContain(2);
  });

  it.each([12,20,30,40])('bounds actual capsule corrections while sweeping curved seams at %sm/s',speed=>{
    const track=SurfCourseGenerator.generate(mock(42,120,128,ENERGETIC));
    const first=track.route.find(n=>n.ribbon?.kind==='S_CURVE_A') ?? track.route.find(n=>n.ribbon)!;
    const chain=track.route.filter(n=>n.ribbonId===first.ribbonId);
    const world=new PhysicsWorld();world.buildFromRoute(chain);
    for(const node of chain) {
      const [a,b]=node.ribbon!.stations;
      const length=new THREE.Vector3(b.center.x-a.center.x,b.center.y-a.center.y,b.center.z-a.center.z).length();
      const steps=Math.max(2,Math.ceil(length/(speed/120)));
      for(let j=1;j<steps;j++) {
        const t=j/steps;
        const up=new THREE.Vector3(a.normal.x,a.normal.y,a.normal.z).lerp(new THREE.Vector3(b.normal.x,b.normal.y,b.normal.z),t).normalize();
        const position=new THREE.Vector3(a.center.x,a.center.y,a.center.z).lerp(new THREE.Vector3(b.center.x,b.center.y,b.center.z),t).addScaledVector(up,0.25);
        position.y-=0.5;
        const response=world.resolveCapsule(position,0.5,1.8);
        expect(response.adjustedPos.distanceTo(position)).toBeLessThan(0.55);
        expect(response.isSurfing || response.isGrounded).toBe(true);
        expect(Number.isFinite(response.adjustedPos.y)).toBe(true);
      }
    }
  });

  it('protects the lowest banked edge and the actual transfer trajectory',()=>{
    const track=SurfCourseGenerator.generate(mock(0x12345,180,128,ENERGETIC));
    const node=track.route.find(n=>n.ribbon)!;
    const mesh=buildRibbonSurfaceMesh(node)!;
    const physics=new PhysicsWorld();physics.buildFromRoute([node]);
    expect(physics.lowestGameplayY).toBeCloseTo(mesh.minY,6);
    expect(physics.getVoidDeathY()).toBeLessThan(mesh.minY);
    const corridor=new RouteExclusionCorridor(track.route);
    const index=track.route.findIndex(n=>n.surfTransition==='AIR');
    const target=track.route[index];
    const check=ballisticTransferCheck(track.route[index-1],target,20,track.route.filter(n=>n.ribbonId===target.ribbonId));
    expect(check.trajectory).toBeTruthy();
    const arc=check.trajectory!, t=arc.duration/2;
    const position=new THREE.Vector3(arc.start.x+arc.velocity.x*t,arc.start.y+arc.velocity.y*t-12*t*t,arc.start.z+arc.velocity.z*t);
    expect(corridor.evaluateVolume(new THREE.Box3(position.clone().addScalar(-1),position.clone().addScalar(1)))).not.toBeNull();
  });
});

describe('versioned SURF PB metadata',()=>{
  const original=(globalThis as any).localStorage;
  let values:Map<string,string>;
  beforeEach(()=>{values=new Map();(globalThis as any).localStorage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)};});
  afterEach(()=>{(globalThis as any).localStorage=original;});
  it('keeps legacy normal PBs and rejects mismatched or outdated Surf ghosts',()=>{
    const frames=Array.from({length:20},(_,i)=>({time:i,px:0,py:0,pz:i,yaw:0,pitch:0,speed:20}));
    expect(GhostStorage.savePB(123,'normal',20,100,frames,[])).toBe(true);
    expect(GhostStorage.savePB(123,'surf',20,100,frames,[],'SURF','audio-A-map-A')).toBe(true);
    expect(GhostStorage.loadPB(123)?.courseType).toBe('PLAYHEAD');
    expect(GhostStorage.loadPB(123,'SURF','audio-A-map-A')?.courseType).toBe('SURF');
    expect(GhostStorage.loadPB(123,'SURF','audio-B-map-A')).toBeNull();
    const key=[...values.keys()].find(k=>k.includes('surf_v'))!;
    const record=JSON.parse(values.get(key)!);record.generationVersion--;
    values.set(key,JSON.stringify(record));
    expect(GhostStorage.loadPB(123,'SURF','audio-A-map-A')).toBeNull();
    expect(GhostStorage.hasPB(123)).toBe(true);
  });
});
