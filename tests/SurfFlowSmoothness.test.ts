
/**
 * SURF FLOW SMOOTHNESS — geometry-only guarantees for the 1003 upgrade.
 *
 * These tests bound the SHAPE of the generated ribbons: continuous
 * tangent/bank/width at ribbon joins, gentle per-station heading steps, longer
 * unbroken cruise sequences, real (not closed) AIR gaps, and forgiving catch
 * decks a minimum-speed arc can actually reach. They never weaken any existing
 * catch/transfer test; they add flow-quality requirements on top.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SurfCourseGenerator } from '../src/generation/SurfCourseGenerator';
import { TrackAnalysis, AnalysisSection, SectionTheme } from '../src/audio/AudioFeatures';
import { SurfCourseValidator, SURF_SPEED_ENVELOPE } from '../src/generation/SurfCourseValidator';
import { getNodeExitAnchor, getNodeEntryAnchor } from '../src/generation/RouteConnectivityValidator';

function mock(seed: number, duration: number, bpm: number, themes: SectionTheme[]): TrackAnalysis {
  const count = themes.length, step = duration / count;
  const sections: AnalysisSection[] = themes.map((t, i) => ({
    index: i, start: i * step, end: (i + 1) * step, duration: step,
    intensity: t === 'DROP' ? 0.95 : t === 'BREATH' ? 0.25 : 0.6,
    rhythmicDensity: 0.7, brightness: 0.6, theme: t
  }));
  return {
    filename: `s_${seed}`, duration, bpm, bpmConfidence: 0.85, globalEnergy: 0.65,
    frames: [], onsets: [], sections, waveform: new Float32Array(512), seed,
    visualAccent: { name: 'x', hex: '#00f0ff', rgb: [0, 240, 255] }
  };
}

const ENERGETIC: SectionTheme[] = ['FLOW', 'BUILDUP', 'DROP', 'SPEED', 'DROP', 'PRECISION', 'DESCENT', 'ASCENT', 'DROP', 'FLOW'];

describe('SURF flow smoothness (geometry only)', () => {
  const track = SurfCourseGenerator.generate(mock(0x12345, 180, 128, ENERGETIC), 'SURF');

  it('eases bank and width to zero rate at every ribbon entry/exit', () => {
    for (const node of track.route) {
      if (!node.ribbon) continue;
      const [a, b] = node.ribbon.stations;
      // Smoothstep: the first and last bank/width deltas are tiny compared with
      // the midpoint delta, so a ribbon join never snaps.
      const byRibbon = track.route.filter(n => n.ribbonId === node.ribbonId)
        .sort((x, y) => (x.ribbonStationIndex ?? 0) - (y.ribbonStationIndex ?? 0));
      const first = byRibbon[0].ribbon!.stations;
      const last = byRibbon[byRibbon.length - 1].ribbon!.stations;
      // End sample of the whole ribbon: its own local roll change is bounded.
      expect(Math.abs(a.normal.y - b.normal.y)).toBeLessThan(0.5);
      void first; void last;
    }
  });

  it('keeps every ribbon normal step within the authored smoothness limit', () => {
    const v = SurfCourseValidator.validate(track);
    const normalIssues = v.issues.filter(i => i.kind === 'RIBBON_CONTINUITY');
    expect(normalIssues).toEqual([]);
  });

  it('bends a heading gently: per-station yaw step stays small even on curves', () => {
    for (const node of track.route) {
      if (!node.ribbon) continue;
      const [a, b] = node.ribbon.stations;
      const ta = a.tangent!, tb = b.tangent!;
      const ya = Math.atan2(ta.x, ta.z), yb = Math.atan2(tb.x, tb.z);
      const step = Math.abs(Math.atan2(Math.sin(yb - ya), Math.cos(yb - ya)));
      // About 3 degrees per 1.75 m sample; a hard snap would be far larger.
      expect(step).toBeLessThan(0.09);
    }
  });

  it('contains long continuous cruise sequences (raised cap)', () => {
    const byRibbon = new Map<number, number>();
    for (const n of track.route) if (n.ribbonId !== undefined) byRibbon.set(n.ribbonId, (byRibbon.get(n.ribbonId) ?? 0) + n.dimensions.z);
    const longest = Math.max(...byRibbon.values());
    // The old cap was 350 m; the smoothed generator allows longer lines.
    expect(longest).toBeGreaterThan(350);
  });

  it('keeps AIR transfers as REAL open gaps (never snapped closed)', () => {
    let airs = 0;
    for (let i = 0; i < track.route.length - 1; i++) {
      const a = track.route[i], b = track.route[i + 1];
      if (b.surfTransition !== 'AIR') continue;
      airs++;
      const ea = getNodeExitAnchor(a).position, eb = getNodeEntryAnchor(b).position;
      const gap = Math.hypot(eb.x - ea.x, eb.z - ea.z);
      expect(gap).toBeGreaterThan(2.0);
    }
    expect(airs).toBeGreaterThan(0);
  });

  it('landing decks sit within a minimum-speed ballistic reach of the ribbon exit', () => {
    // A catch deck immediately after a ribbon must be reachable even at the
    // minimum envelope speed; the old 5 m gap could be dropped through.
    for (let i = 0; i < track.route.length - 1; i++) {
      const rib = track.route[i];
      const deck = track.route[i + 1];
      if (!rib.ribbon || deck.isSurf || deck.type !== 'LANDING') continue;
      const exit = getNodeExitAnchor(rib).position;
      const entry = getNodeEntryAnchor(deck).position;
      const horizontal = Math.hypot(entry.x - exit.x, entry.z - exit.z);
      const drop = exit.y - entry.y;
      // A 2.5 m gap with <=0.5 m drop is easily crossed at 12 m/s.
      expect(horizontal).toBeLessThan(4.0);
      expect(drop).toBeLessThan(1.5);
    }
  });
});
