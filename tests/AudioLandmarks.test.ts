/**
 * AUDIO LANDMARKS — placement and batching guarantees.
 *
 * The reactive mass in PLAYHEAD was historically placed PERPENDICULAR to travel
 * (175-210m to the side), which put it outside the forward field of view for
 * most of a run. These tests pin the two properties that fix that:
 *   1. landmarks are placed AHEAD of the route, so they are actually visible
 *   2. the whole landmark field stays batched (a handful of draw calls, never
 *      one per landmark)
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RouteGenerator } from '../src/generation/RouteGenerator';
import { SignalLandmarks } from '../src/world/SignalLandmarks';
import { RouteSignalPackets } from '../src/world/RouteSignalPackets';
import { RouteExclusionCorridor } from '../src/world/RouteExclusionCorridor';
import { AnalysisSection, SectionTheme, TrackAnalysis } from '../src/audio/AudioFeatures';
import { PaletteSelector } from '../src/audio/TrackPalettes';
import { MusicVisualController } from '../src/world/MusicVisualController';

function makeAnalysis(seed: number, duration: number, themes: SectionTheme[]): TrackAnalysis {
  const sections: AnalysisSection[] = [];
  const step = duration / themes.length;
  for (let i = 0; i < themes.length; i++) {
    sections.push({
      index: i,
      start: i * step,
      end: (i + 1) * step,
      duration: step,
      intensity: 0.6,
      rhythmicDensity: 0.6,
      brightness: 0.6,
      theme: themes[i]
    });
  }
  return {
    filename: `landmark_${seed}.wav`,
    duration,
    bpm: 128,
    bpmConfidence: 0.9,
    globalEnergy: 0.6,
    frames: [],
    onsets: [],
    sections,
    waveform: new Float32Array(512).fill(0.4),
    seed,
    visualAccent: { name: 'Cyan', hex: '#00f0ff', rgb: [0, 240, 255] }
  };
}

const THEMES: SectionTheme[] = ['FLOW', 'SPEED', 'FLOW', 'PRECISION', 'SPEED', 'FLOW'];

describe('Audio landmarks — placement', () => {
  it('places landmarks on real courses', () => {
    let total = 0;
    let coursesWithLandmarks = 0;
    for (let i = 0; i < 12; i++) {
      const analysis = makeAnalysis(0x30000000 + i * 7919, 90, THEMES);
      const track = RouteGenerator.generate(analysis);
      const palette = PaletteSelector.selectPalette(analysis.seed, 0.5, 0.6);
      const landmarks = new SignalLandmarks(analysis, track, palette, 1.0);
      const count = landmarks.getVisibleCount();
      total += count;
      if (count > 0) coursesWithLandmarks++;
      landmarks.dispose();
    }
    expect(coursesWithLandmarks).toBeGreaterThan(8);
    expect(total).toBeGreaterThan(20);
  });

  it('never crowds gameplay geometry', () => {
    const analysis = makeAnalysis(0x31000000, 90, THEMES);
    const track = RouteGenerator.generate(analysis);
    const palette = PaletteSelector.selectPalette(analysis.seed, 0.5, 0.6);
    const landmarks = new SignalLandmarks(analysis, track, palette, 1.0);

    const placements = landmarks.getPlacements();
    expect(placements.length).toBeGreaterThan(0);

    for (const placement of placements) {
      for (const node of track.route) {
        const dx = placement.position.x - node.position.x;
        const dz = placement.position.z - node.position.z;
        // Comfortably clear of every gameplay platform.
        expect(Math.hypot(dx, dz)).toBeGreaterThan(80);
      }
    }
    landmarks.dispose();
  });

  it('places landmarks where the player will see them ahead', () => {
    const analysis = makeAnalysis(0x32000000, 90, THEMES);
    const track = RouteGenerator.generate(analysis);
    const palette = PaletteSelector.selectPalette(analysis.seed, 0.5, 0.6);
    const landmarks = new SignalLandmarks(analysis, track, palette, 1.0);
    const placements = landmarks.getPlacements();
    expect(placements.length).toBeGreaterThan(0);

    // A landmark is "visible ahead" if some route node has it in its forward
    // hemisphere at a plausible viewing distance. A structure placed purely
    // perpendicular to travel fails this, which is the failure this pass fixes.
    let visibleAhead = 0;
    for (const placement of placements) {
      const found = track.route.some((node) => {
        const dx = placement.position.x - node.position.x;
        const dz = placement.position.z - node.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 90 || dist > 700) return false;
        const fwdX = Math.sin(node.yaw);
        const fwdZ = Math.cos(node.yaw);
        const dot = (dx / dist) * fwdX + (dz / dist) * fwdZ;
        return dot > 0.15;
      });
      if (found) visibleAhead++;
    }

    expect(visibleAhead / placements.length).toBeGreaterThan(0.7);
    landmarks.dispose();
  });
});

describe('Audio landmarks — batching', () => {
  it('costs a constant handful of draw calls regardless of instance count', () => {
    const analysis = makeAnalysis(0x33000000, 120, THEMES);
    const track = RouteGenerator.generate(analysis);
    const palette = PaletteSelector.selectPalette(analysis.seed, 0.5, 0.6);

    const full = new SignalLandmarks(analysis, track, palette, 1.0);
    const reduced = new SignalLandmarks(analysis, track, palette, 0.35);

    expect(full.getVisibleCount()).toBeGreaterThan(reduced.getVisibleCount());
    // Draw cost is per ARCHETYPE, not per landmark.
    expect(full.getDrawCallCount()).toBeLessThanOrEqual(4);
    expect(reduced.getDrawCallCount()).toBeLessThanOrEqual(4);

    full.dispose();
    reduced.dispose();
  });

  it('keeps landmarks out of the authoritative protection corridor', () => {
    const analysis = makeAnalysis(0x34000000, 90, THEMES);
    const track = RouteGenerator.generate(analysis);
    const palette = PaletteSelector.selectPalette(analysis.seed, 0.5, 0.6);
    const landmarks = new SignalLandmarks(analysis, track, palette, 1.0);

    const corridor = new RouteExclusionCorridor(RouteExclusionCorridor.collectGameplayNodes(track));
    const box = new THREE.Box3();
    const placements = landmarks.getPlacements();
    expect(placements.length).toBeGreaterThan(0);

    // Re-run the SAME validation the builder used, with each landmark's real
    // footprint, so the guarantee is verified rather than assumed.
    for (const placement of placements) {
      box.setFromCenterAndSize(
        placement.position,
        new THREE.Vector3(placement.size.x, placement.size.y, placement.size.z)
      );
      expect(corridor.isBoxInsideCorridor(box)).toBe(false);
    }
    landmarks.dispose();
  });
});

describe('Route signal packets', () => {
  it('is a single batched instanced mesh', () => {
    const analysis = makeAnalysis(0x35000000, 90, THEMES);
    const track = RouteGenerator.generate(analysis);
    const palette = PaletteSelector.selectPalette(analysis.seed, 0.5, 0.6);
    const packets = new RouteSignalPackets(track, palette, 32);

    let instanced = 0;
    packets.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) instanced++;
    });
    expect(instanced).toBe(1);
    packets.dispose();
  });

  it('emits on transients and never floods the pool', () => {
    const analysis = makeAnalysis(0x36000000, 90, THEMES);
    const track = RouteGenerator.generate(analysis);
    const palette = PaletteSelector.selectPalette(analysis.seed, 0.5, 0.6);
    const packets = new RouteSignalPackets(track, palette, 12);

    const controller = new MusicVisualController();
    controller.init(analysis, track);
    controller.setChannelIsolation('FULL');

    const state = controller.state;
    // Drive the controller with a synthetic transient train and confirm packets
    // activate but stay inside the pool.
    let maxActive = 0;
    for (let i = 0; i < 200; i++) {
      state.channels.transient = i % 5 === 0 ? 0.9 : 0.02;
      state.channels.bassMass = 0.6;
      state.channels.sectionEnergy = 0.6;
      state.time = i * 0.016;
      packets.update(state, 200, 0.016, false);
      maxActive = Math.max(maxActive, packets.getActiveCount());
    }
    expect(maxActive).toBeGreaterThan(0);
    expect(maxActive).toBeLessThanOrEqual(12);
    packets.dispose();
  });
});
