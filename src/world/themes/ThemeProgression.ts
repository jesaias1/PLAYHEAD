/**
 * THEME PROGRESSION — maps a song's analysed sections onto the route so a theme
 * can arrange scenery as a journey instead of scattering it.
 *
 * Pure data: no rendering, no randomness. Everything is derived from the same
 * precomputed section list and route node times the rest of the game uses, so a
 * NORMAL and a SURF course of the same song get the same musical arc laid over
 * their own (different) geometry.
 */

import * as THREE from 'three';
import { TrackAnalysis } from '../../audio/AudioFeatures';
import { GeneratedTrack, RouteNode } from '../../generation/GenerationTypes';

/** The dramatic job a section does in the journey. */
export type ProgressionRole = 'OPENING' | 'BUILD' | 'PEAK' | 'BREAKDOWN' | 'FINALE';

export interface ProgressionSpan {
  role: ProgressionRole;
  sectionIndex: number;
  /** Route fraction (0..1 by arc length) where the section starts / ends. */
  start: number;
  end: number;
}

export type ProgressionValues = Record<ProgressionRole, number>;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

/**
 * A smoothed, arc-length parameterised view of the main route.
 *
 * `u` is the same 0..1 route fraction the World reports as progressRatio
 * (node.arcLength / track.totalDistance). Values outside 0..1 extrapolate along
 * the end tangents, which is how scenery is placed behind the start and beyond
 * the finish.
 */
export class RouteFrame {
  public readonly total: number;
  private readonly arcs: number[] = [];
  private readonly points: THREE.Vector3[] = [];
  private readonly times: number[] = [];

  constructor(route: RouteNode[], totalDistance: number) {
    let last = -Infinity;
    for (const node of route) {
      // Arc lengths are authored monotonic; guard anyway so interpolation can
      // never divide by zero or run backwards.
      const arc = Math.max(node.arcLength ?? 0, last + 0.001);
      last = arc;
      this.arcs.push(arc);
      this.points.push(new THREE.Vector3(node.position.x, node.position.y, node.position.z));
      this.times.push(node.time ?? 0);
    }
    const end = this.arcs.length > 0 ? this.arcs[this.arcs.length - 1] : 1;
    this.total = Math.max(1, totalDistance > 0 ? Math.max(totalDistance, end) : end);
  }

  public get isEmpty(): boolean {
    return this.points.length < 2;
  }

  private pointAtArc(arc: number, out: THREE.Vector3): THREE.Vector3 {
    const n = this.points.length;
    if (n === 0) return out.set(0, 0, 0);
    if (n === 1) return out.copy(this.points[0]);
    if (arc <= this.arcs[0]) {
      const dir = this.points[1].clone().sub(this.points[0]).setY(0);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
      return out.copy(this.points[0]).addScaledVector(dir.normalize(), arc - this.arcs[0]);
    }
    if (arc >= this.arcs[n - 1]) {
      const back = Math.max(0, n - 4);
      const dir = this.points[n - 1].clone().sub(this.points[back]).setY(0);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
      return out.copy(this.points[n - 1]).addScaledVector(dir.normalize(), arc - this.arcs[n - 1]);
    }
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.arcs[mid] <= arc) lo = mid;
      else hi = mid;
    }
    const t = (arc - this.arcs[lo]) / (this.arcs[hi] - this.arcs[lo]);
    return out.copy(this.points[lo]).lerp(this.points[hi], t);
  }

  /**
   * Position plus a horizontal frame at route fraction `u`. The tangent is
   * measured over a long baseline so single jumps and banked ribbons do not
   * make neighbouring scenery swing around.
   */
  public sample(u: number, baseline = 90): { position: THREE.Vector3; forward: THREE.Vector3; right: THREE.Vector3 } {
    const arc = u * this.total;
    const position = this.pointAtArc(arc, new THREE.Vector3());
    const a = this.pointAtArc(arc - baseline, new THREE.Vector3());
    const b = this.pointAtArc(arc + baseline, new THREE.Vector3());
    const forward = b.sub(a).setY(0);
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
    forward.normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    return { position, forward, right };
  }

  /** Route fraction the song reaches at `time` seconds (by node times). */
  public fractionAtTime(time: number): number {
    const n = this.times.length;
    if (n === 0) return 0;
    if (time <= this.times[0]) return clamp01(this.arcs[0] / this.total);
    for (let i = 1; i < n; i++) {
      if (this.times[i] >= time) {
        const span = this.times[i] - this.times[i - 1];
        const t = span > 1e-6 ? (time - this.times[i - 1]) / span : 0;
        return clamp01((this.arcs[i - 1] + (this.arcs[i] - this.arcs[i - 1]) * t) / this.total);
      }
    }
    return 1;
  }

  /** Lowest and highest route altitude, for placing backdrop relative to it. */
  public altitudeRange(): { min: number; max: number } {
    let min = Infinity;
    let max = -Infinity;
    for (const p of this.points) {
      if (p.y < min) min = p.y;
      if (p.y > max) max = p.y;
    }
    if (!isFinite(min)) return { min: 0, max: 0 };
    return { min, max };
  }
}

/**
 * Assigns a dramatic role to every analysed section.
 *
 * The first section opens, the last one closes, and the most intense section
 * in between is the peak, together with any section that holds nearly its
 * intensity. Weaker sections build before the peak first arrives and are a
 * breakdown after it. Short songs degrade gracefully.
 */
export function deriveProgression(analysis: TrackAnalysis, track: GeneratedTrack): ProgressionSpan[] {
  const frame = new RouteFrame(track.route, track.totalDistance);
  const sections = analysis.sections ?? [];
  if (sections.length === 0) {
    return [{ role: 'PEAK', sectionIndex: 0, start: 0, end: 1 }];
  }

  const n = sections.length;
  const roles: ProgressionRole[] = new Array(n).fill('BUILD');
  let peak = -1;
  if (n >= 3) {
    for (let i = 1; i < n - 1; i++) {
      if (peak < 0 || sections[i].intensity > sections[peak].intensity) peak = i;
    }
  }
  const peakIntensity = peak >= 0 ? sections[peak].intensity : 0;
  // A song may hold its peak across several sections (a plateau) and dip in
  // the middle of it: anything within a few percent of the strongest section
  // is peak too, and a weaker section AFTER the peak has arrived is a
  // breakdown, even if the peak then returns.
  let peakReached = false;
  for (let i = 0; i < n; i++) {
    if (i === 0) roles[i] = 'OPENING';
    else if (i === n - 1) roles[i] = 'FINALE';
    else if (i === peak || sections[i].intensity >= peakIntensity * 0.92) {
      roles[i] = 'PEAK';
      peakReached = true;
    } else roles[i] = peakReached ? 'BREAKDOWN' : 'BUILD';
  }

  const spans: ProgressionSpan[] = [];
  let previousEnd = 0;
  for (let i = 0; i < n; i++) {
    const end = i === n - 1 ? 1 : Math.max(previousEnd, frame.fractionAtTime(sections[i].end));
    spans.push({ role: roles[i], sectionIndex: i, start: previousEnd, end });
    previousEnd = end;
  }
  return spans;
}

/**
 * Samples a per-role value along the route with smooth crossfades at section
 * boundaries, so nothing a theme derives from it can change abruptly.
 */
export function sampleProgression(
  spans: ProgressionSpan[],
  values: ProgressionValues,
  u: number,
  blendWidth = 0.06
): number {
  if (spans.length === 0) return values.PEAK;
  const x = clamp01(u);
  let index = spans.length - 1;
  for (let i = 0; i < spans.length; i++) {
    if (x < spans[i].end) {
      index = i;
      break;
    }
  }
  const span = spans[index];
  const here = values[span.role];
  const length = Math.max(1e-4, span.end - span.start);

  if (index > 0) {
    const prev = spans[index - 1];
    const w = Math.min(blendWidth, 0.5 * Math.min(length, Math.max(1e-4, prev.end - prev.start)));
    if (x < span.start + w) {
      const t = smooth((x - (span.start - w)) / (2 * w));
      return values[prev.role] + (here - values[prev.role]) * t;
    }
  }
  if (index < spans.length - 1) {
    const next = spans[index + 1];
    const w = Math.min(blendWidth, 0.5 * Math.min(length, Math.max(1e-4, next.end - next.start)));
    if (x > span.end - w) {
      const t = smooth((x - (span.end - w)) / (2 * w));
      return here + (values[next.role] - here) * t;
    }
  }
  return here;
}

/** Route fraction at the middle of the first span with the given role. */
export function roleCentre(spans: ProgressionSpan[], role: ProgressionRole, fallback: number): number {
  const span = spans.find((s) => s.role === role);
  return span ? (span.start + span.end) * 0.5 : fallback;
}

/** First span with the given role, if the song has one. */
export function roleSpan(spans: ProgressionSpan[], role: ProgressionRole): ProgressionSpan | null {
  return spans.find((s) => s.role === role) ?? null;
}
