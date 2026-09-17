/**
 * FINAL SAFETY PASS IMPACT
 * Runs the authoritative final decoration validation and reports how many
 * decorative elements are rejected per system, plus how many survive — so the
 * safety pass cannot silently gut the world.
 */
import * as THREE from 'three';
import { TrackGenerator } from '../src/generation/TrackGenerator.ts';
import { GeometryBuilder } from '../src/world/GeometryBuilder.ts';
import { SkylineArchitecture } from '../src/world/SkylineArchitecture.ts';
import { SpectralArchitecture } from '../src/world/SpectralArchitecture.ts';
import { DropSetpiece } from '../src/world/DropSetpiece.ts';
import { CelestialLandmarks } from '../src/world/CelestialLandmarks.ts';
import { RouteExclusionCorridor } from '../src/world/RouteExclusionCorridor.ts';
import { PaletteSelector } from '../src/audio/TrackPalettes.ts';

function analysisStub(seed) {
  const frames = [];
  for (let i = 0; i < 1200; i++) {
    frames.push({
      time: i * 0.05,
      rms: 0.3 + 0.3 * Math.sin(i * 0.05),
      bass: 0.4 + 0.3 * Math.sin(i * 0.03),
      lowMid: 0.35, mid: 0.3,
      high: 0.25 + 0.2 * Math.sin(i * 0.11),
      centroid: 0.5, flux: 0.2
    });
  }
  const sections = [];
  for (let i = 0; i < 8; i++) {
    sections.push({
      index: i, start: i * 7.5, end: (i + 1) * 7.5, duration: 7.5,
      intensity: 0.3 + (i % 4) * 0.2, rhythmicDensity: 0.5, brightness: 0.5,
      theme: ['FLOW', 'BUILDUP', 'DROP', 'SURF', 'ASCENT', 'PRECISION', 'SPEED', 'FLOW'][i]
    });
  }
  return {
    seed, duration: 60, globalEnergy: 0.6, frames, sections, onsets: [],
    waveform: new Array(1024).fill(0).map((_, i) => 0.3 + 0.3 * Math.sin(i * 0.1)),
    visualAccent: { name: 'TEST', hex: '#a855f7', rgb: [168, 85, 247] }
  };
}

function countMeshes(root) {
  let meshes = 0, instances = 0;
  root.traverse((o) => {
    if (o.isInstancedMesh) instances += o.count;
    else if (o.isMesh) meshes++;
  });
  return { meshes, instances };
}

console.log('=== FINAL SAFETY PASS IMPACT ===');
let grandRejected = 0;
let grandTotal = 0;

for (const seed of [12345, 777, 4242, 99991, 31337]) {
  const analysis = analysisStub(seed);
  const palette = PaletteSelector.selectPalette(seed, 0.5, 0.6);
  const track = TrackGenerator.generate(analysis, palette);
  const scene = new THREE.Scene();

  const built = GeometryBuilder.buildWorld(track, palette);
  const skyline = new SkylineArchitecture(scene, analysis, track);
  const spectral = new SpectralArchitecture(scene, analysis, track);
  const drop = new DropSetpiece(scene, analysis, track);
  const celestial = new CelestialLandmarks(scene, analysis, track, palette);

  const systems = {
    GeometryBuilder: built.decorativeGroup,
    Skyline: skyline.group,
    Spectral: spectral.group,
    DropSetpiece: drop.group,
    Celestial: celestial.group
  };

  const before = {};
  for (const [k, g] of Object.entries(systems)) before[k] = countMeshes(g);

  const allNodes = [...track.route, ...(track.optionalRamps || []), ...(track.recoveryShelves || [])];
  const corridor = new RouteExclusionCorridor(allNodes);

  const roots = Object.values(systems);
  const report = corridor.validateDecorations(roots);

  // Attribute rejections by system prefix
  const bySystem = {};
  for (const r of report.rejected) {
    // names are mesh names; we attribute by re-counting instead
    bySystem[r.name] = (bySystem[r.name] || 0) + 1;
  }

  const after = {};
  for (const [k, g] of Object.entries(systems)) after[k] = countMeshes(g);

  console.log(`\nseed=${seed}  routeNodes=${track.route.length}  rejected=${report.total}`);
  for (const k of Object.keys(systems)) {
    const b = before[k].meshes + before[k].instances;
    const a = after[k].meshes + after[k].instances;
    const removed = b - a;
    const pct = b > 0 ? ((removed / b) * 100).toFixed(1) : '0.0';
    console.log(`  ${k.padEnd(16)} before=${String(b).padStart(4)} after=${String(a).padStart(4)} removed=${String(removed).padStart(3)} (${pct}%)`);
    grandTotal += b;
    grandRejected += removed;
  }
}

console.log(`\nTOTAL decorative elements: ${grandTotal}`);
console.log(`TOTAL rejected by final safety pass: ${grandRejected} (${((grandRejected / grandTotal) * 100).toFixed(1)}%)`);