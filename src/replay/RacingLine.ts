/**
 * RACING LINE: a faint line along your personal-best path, shown only for the
 * stretch just ahead of you so it guides without cluttering the view.
 * Purely visual: it never reads or changes movement.
 */

import * as THREE from 'three';
import type { ReplayFrame } from './ReplayRecorder';

const AHEAD_METRES = 70;
const BEHIND_METRES = 6;
const MAX_POINTS = 90;

export class RacingLine {
  private readonly line: THREE.Line;
  private readonly positions = new Float32Array(MAX_POINTS * 3);
  private readonly colors = new Float32Array(MAX_POINTS * 3);
  private frames: ReplayFrame[] | null = null;
  private cursor = 0;
  private readonly color = new THREE.Color(0xfbbf24);

  constructor(private readonly scene: THREE.Scene) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      })
    );
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.line.name = 'RacingLine';
    scene.add(this.line);
  }

  public setFrames(frames: ReplayFrame[] | null): void {
    if (frames === this.frames) return;
    this.frames = frames && frames.length > 1 ? frames : null;
    this.cursor = 0;
    this.line.visible = false;
  }

  public hasFrames(): boolean {
    return this.frames !== null;
  }

  public update(position: { x: number; y: number; z: number }, enabled: boolean): void {
    const frames = this.frames;
    if (!enabled || !frames) {
      this.line.visible = false;
      return;
    }
    // Nearest recorded point, searched near the last one (a run only moves forward;
    // after a restore it may jump back, so widen the search if the match is poor).
    let best = this.cursor;
    let bestD = Infinity;
    const scan = (from: number, to: number): void => {
      for (let i = Math.max(0, from); i < Math.min(frames.length, to); i++) {
        const f = frames[i];
        const d = (f.px - position.x) ** 2 + (f.py - position.y) ** 2 + (f.pz - position.z) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
    };
    scan(this.cursor - 60, this.cursor + 120);
    if (bestD > 30 * 30) scan(0, frames.length);
    this.cursor = best;

    // Only show the line while you are reasonably near it.
    if (bestD > 40 * 40) {
      this.line.visible = false;
      return;
    }

    let start = best;
    let walked = 0;
    while (start > 0 && walked < BEHIND_METRES) {
      walked += Math.hypot(frames[start].px - frames[start - 1].px, frames[start].pz - frames[start - 1].pz);
      start--;
    }
    let n = 0;
    let ahead = 0;
    for (let i = start; i < frames.length && n < MAX_POINTS; i++) {
      const f = frames[i];
      if (i > start) ahead += Math.hypot(f.px - frames[i - 1].px, f.py - frames[i - 1].py, f.pz - frames[i - 1].pz);
      if (i > best && ahead > AHEAD_METRES) break;
      // A little below eye level, so it reads as a path on the surface.
      this.positions[n * 3] = f.px;
      this.positions[n * 3 + 1] = f.py - 0.8;
      this.positions[n * 3 + 2] = f.pz;
      const fade = i < best ? 0.4 * (1 - (best - i) / 12) : Math.max(0, 1 - ahead / AHEAD_METRES);
      const k = Math.max(0, Math.min(1, fade)) * 0.5;
      this.colors[n * 3] = this.color.r * k;
      this.colors[n * 3 + 1] = this.color.g * k;
      this.colors[n * 3 + 2] = this.color.b * k;
      n++;
    }
    const geo = this.line.geometry;
    geo.getAttribute('position').needsUpdate = true;
    geo.getAttribute('color').needsUpdate = true;
    geo.setDrawRange(0, n);
    this.line.visible = n > 1;
  }

  public dispose(): void {
    this.scene.remove(this.line);
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
  }
}
