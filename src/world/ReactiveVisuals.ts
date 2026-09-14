/**
 * Real-time audio reactive controller updating materials and environment
 */

import * as THREE from 'three';
import { AnalysisFrame, TrackAnalysis } from '../audio/AudioFeatures';

export class ReactiveVisuals {
  private materials: THREE.MeshStandardMaterial[] = [];
  private edgeLines: THREE.LineSegments[] = [];
  private baseEmissives: number[] = [];
  private analysis: TrackAnalysis | null = null;
  private currentFrame: AnalysisFrame | null = null;

  public init(materials: THREE.MeshStandardMaterial[], edgeLines: THREE.LineSegments[], analysis: TrackAnalysis): void {
    this.materials = materials;
    this.edgeLines = edgeLines;
    this.baseEmissives = materials.map(m => m.emissiveIntensity);
    this.analysis = analysis;
  }

  public update(songTime: number): void {
    if (!this.analysis || this.materials.length === 0) return;

    // Binary search or direct index for current analysis frame
    const frames = this.analysis.frames;
    if (frames.length === 0) return;

    const frameDuration = frames.length > 1 ? frames[1].time - frames[0].time : 0.01;
    const frameIdx = Math.max(0, Math.min(frames.length - 1, Math.floor(songTime / frameDuration)));
    this.currentFrame = frames[frameIdx];

    const bass = this.currentFrame.bass;
    const flux = this.currentFrame.flux;
    const high = this.currentFrame.high;

    // Reactively pulse materials
    for (let i = 0; i < this.materials.length; i++) {
      const mat = this.materials[i];
      const base = this.baseEmissives[i] || 1.0;
      // Heavy bass and transient flux boost emissive glow
      mat.emissiveIntensity = base + bass * 0.8 + flux * 0.6;
    }

    // Reactively shimmer edge lines on high frequency
    const lineOpacity = 0.35 + high * 0.45;
    for (let i = 0; i < this.edgeLines.length; i++) {
      const line = this.edgeLines[i];
      const mat = line.material as THREE.LineBasicMaterial;
      mat.opacity = lineOpacity;
    }
  }

  public getCurrentFrame(): AnalysisFrame | null {
    return this.currentFrame;
  }

  public dispose(): void {
    this.materials = [];
    this.edgeLines = [];
    this.baseEmissives = [];
    this.analysis = null;
    this.currentFrame = null;
  }
}
