import { describe, it, expect } from 'vitest';
import { SurfCourseGenerator } from '../src/generation/SurfCourseGenerator';
import { SurfCourseValidator } from '../src/generation/SurfCourseValidator';
import { ribbonSurfaceCorners } from '../src/generation/SurfRibbon';
import { TrackAnalysis, AnalysisSection, SectionTheme } from '../src/audio/AudioFeatures';

function mock(seed: number, duration: number, bpm: number, themes: SectionTheme[], intensityAt?: (t: SectionTheme, i: number) => number): TrackAnalysis {
  const count = themes.length, step = duration / count;
  const sections: AnalysisSection[] = themes.map((t, i) => ({
    index: i, start: i * step, end: (i + 1) * step, duration: step,
    intensity: intensityAt ? intensityAt(t, i) : (t === 'DROP' ? 0.95 : t === 'BREATH' ? 0.25 : 0.6),
    rhythmicDensity: 0.7, brightness: 0.6, theme: t
  }));
  return { filename: `s_${seed}`, duration, bpm, bpmConfidence: 0.85, globalEnergy: 0.65, frames: [], onsets: [], sections, waveform: new Float32Array(512), seed, visualAccent: { name: 'x', hex: '#00f0ff', rgb: [0,240,255] } };
}
const ENERGETIC: SectionTheme[] = ['FLOW','BUILDUP','DROP','SPEED','DROP','PRECISION','DESCENT','ASCENT','DROP','FLOW'];
const SUSTAINED: SectionTheme[] = ['FLOW','BREATH','FLOW','BREATH','SURF','BREATH','FLOW'];

describe('probe', () => {
  it('dumps energetic', () => {
    const track = SurfCourseGenerator.generate(mock(0x12345, 180, 128, ENERGETIC), 'SURF');
    const v = SurfCourseValidator.validate(track);
    console.log('ENERGETIC nodes', track.route.length, 'surfFrac', v.surfFraction.toFixed(3), 'valid', v.isValid, 'issues', JSON.stringify(v.issues.map(i=>i.kind)));
    const byR = new Map<number, typeof track.route>();
    for (const n of track.route) { if (n.ribbonId===undefined) continue; const l = byR.get(n.ribbonId) ?? []; l.push(n); byR.set(n.ribbonId, l); }
    for (const [id, l] of byR) {
      l.sort((a,b)=>(a.ribbonStationIndex??0)-(b.ribbonStationIndex??0));
      const a = l[0].ribbon!.stations[0]; const b = l[l.length-1].ribbon!.stations[1];
      const len = Math.hypot(b.center.x-a.center.x, b.center.z-a.center.z);
      const dy = b.center.y-a.center.y;
      const df = Math.hypot(l[l.length-1].position.x-l[0].position.x, l[l.length-1].position.z-l[0].position.z);
      console.log(`ribbon ${id} kind ${l[0].ribbon!.kind} segs ${l.length} len ${len.toFixed(1)} yawSpan ${(l[l.length-1].yaw-l[0].yaw).toFixed(2)} dy ${dy.toFixed(1)} chordSpan ${df.toFixed(1)} hw ${a.halfWidth}->${b.halfWidth}`);
    }
    // adversarials
    for (let i=0;i<track.route.length-1;i++){
      const a=track.route[i], b=track.route[i+1];
      if (a.ribbonId!==undefined && a.ribbonId===b.ribbonId) continue;
      if (!a.ribbon && !b.ribbon) continue;
      const ca = a.ribbon? ribbonSurfaceCorners(a):null; const cb = b.ribbon? ribbonSurfaceCorners(b):null;
      const na = ca? ca[2].clone().add(ca[3]).multiplyScalar(0.5): null;
      const nb = cb? cb[1].clone().add(cb[0]).multiplyScalar(0.5): null;
      const gap = na&&nb? Math.hypot(nb.x-na.x, nb.z-na.z): (Math.hypot(b.position.x-a.position.x,b.position.z-a.position.z));
      console.log(`edge ${i} ${a.id}(${a.ribbon?'rib':'plat'})->${b.id}(${b.ribbon?'rib':'plat'}) gap ${gap.toFixed(2)} aYaw ${a.yaw.toFixed(2)} aPitch ${a.pitch.toFixed(2)} aY ${a.position.y.toFixed(1)} bY ${b.position.y.toFixed(1)}`);
    }
    expect(true).toBe(true);
  });
  it('dumps sustained', () => {
    const track = SurfCourseGenerator.generate(mock(0xABCDE, 220, 92, SUSTAINED, () => 0.35), 'SURF');
    const v = SurfCourseValidator.validate(track);
    console.log('SUSTAINED nodes', track.route.length, 'surfFrac', v.surfFraction.toFixed(3), 'valid', v.isValid, 'issues', JSON.stringify(v.issues.map(i=>i.kind)));
    const counts: Record<string, number> = {};
    for (const n of track.route) counts[n.ribbon? n.ribbon.kind : 'PLATFORM_' + n.type] = (counts[n.ribbon? n.ribbon.kind : 'PLATFORM_' + n.type]||0)+1;
    console.log(JSON.stringify(counts));
    expect(true).toBe(true);
  });
});
