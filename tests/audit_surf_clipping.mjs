/**
 * OPTIONAL SURF CLIPPING AUDIT
 *
 * Checks each optional side-surf ramp for real geometric intersection against:
 *   - main route platforms (including widened/flared trapezoid ascent steps)
 *   - mandatory surf ramps
 *   - other optional surf ramps
 *   - recovery shelves
 * using oriented bounding boxes (OBB) rather than axis-aligned proxies, so
 * rotated ramps are measured in their true final orientation.
 */
import * as THREE from 'three';
import { OBB } from 'three/examples/jsm/math/OBB.js';
import { RouteGenerator } from '../src/generation/RouteGenerator.ts';

function mock(duration, seed) {
  const count = Math.max(4, Math.floor(duration / 18));
  const step = duration / count;
  const themes = ['FLOW', 'BUILDUP', 'ASCENT', 'FLOW', 'DESCENT', 'SPEED'];
  const sections = [];
  for (let i = 0; i < count; i++) {
    sections.push({
      index: i, start: i * step, end: (i + 1) * step, duration: step,
      intensity: 0.5 + (i / count) * 0.4, rhythmicDensity: 0.6, brightness: 0.6,
      theme: themes[(i + (seed % themes.length)) % themes.length]
    });
  }
  return {
    filename: 't', duration, bpm: 128, bpmConfidence: 0.85, globalEnergy: 0.65,
    frames: [], onsets: [], sections, waveform: new Float32Array(512), seed,
    visualAccent: { name: 'N', hex: '#ff3366', rgb: [255, 51, 102] }
  };
}

/** Builds an OBB from a route node, honouring its trapezoid exit width. */
function nodeOBB(node, inflate = -0.05) {
  const maxHalfX = Math.max(node.dimensions.x, node.exitWidth ?? node.dimensions.x) * 0.5;
  const halfSize = new THREE.Vector3(
    maxHalfX + inflate,
    node.dimensions.y * 0.5 + inflate,
    node.dimensions.z * 0.5 + inflate
  );
  const euler = new THREE.Euler(node.pitch, node.yaw, node.roll, 'YXZ');
  const rot = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(euler));
  return new OBB(new THREE.Vector3(node.position.x, node.position.y, node.position.z), halfSize, rot);
}

console.log('=== OPTIONAL SURF CLIPPING AUDIT (true OBB intersection) ===');
console.log('seed     dur  route mandSurf optRamps  overlappingRamps  vsRoute vsMand vsOpt vsShelf');

let totalRamps = 0;
let totalOverlapping = 0;
const worst = [];

for (const seed of [0x1111, 0x2222, 0x3333, 0x4444, 0x5555, 0x12345, 0xABCDE, 0x98765, 0x54321, 777, 4242, 99991]) {
  for (const dur of [60, 90, 120]) {
    const track = RouteGenerator.generate(mock(dur, seed));
    const ramps = track.optionalRamps || [];
    const route = track.route;
    const shelves = track.recoveryShelves || [];
    const mandatorySurf = route.filter((n) => n.isSurf);

    let overlapping = 0;
    let vsRoute = 0, vsMand = 0, vsOpt = 0, vsShelf = 0;

    for (let i = 0; i < ramps.length; i++) {
      const ramp = ramps[i];
      const rampBox = nodeOBB(ramp);
      let hit = false;

      for (const n of route) {
        if (nodeOBB(n).intersectsOBB(rampBox)) { vsRoute++; hit = true; break; }
      }
      if (!hit) {
        for (const n of mandatorySurf) {
          if (nodeOBB(n).intersectsOBB(rampBox)) { vsMand++; hit = true; break; }
        }
      }
      if (!hit) {
        for (let j = 0; j < ramps.length; j++) {
          if (j === i) continue;
          if (nodeOBB(ramps[j]).intersectsOBB(rampBox)) { vsOpt++; hit = true; break; }
        }
      }
      if (!hit) {
        for (const s of shelves) {
          if (nodeOBB(s).intersectsOBB(rampBox)) { vsShelf++; hit = true; break; }
        }
      }
      if (hit) overlapping++;
    }

    totalRamps += ramps.length;
    totalOverlapping += overlapping;

    if (overlapping > 0) {
      console.log(
        `0x${seed.toString(16).padEnd(6)} ${String(dur).padStart(3)}  ${String(route.length).padStart(5)} ` +
        `${String(mandatorySurf.length).padStart(8)} ${String(ramps.length).padStart(8)}  ` +
        `${String(overlapping).padStart(16)}  ${String(vsRoute).padStart(7)} ${String(vsMand).padStart(6)} ` +
        `${String(vsOpt).padStart(5)} ${String(vsShelf).padStart(7)}`
      );
      worst.push({ seed, dur, overlapping, ramps: ramps.length });
    }
  }
}

console.log(`\nTOTAL optional ramps: ${totalRamps}`);
console.log(`TOTAL intersecting:   ${totalOverlapping} (${((totalOverlapping / totalRamps) * 100).toFixed(1)}%)`);
console.log(`Cases with clipping:  ${worst.length} / 36`);