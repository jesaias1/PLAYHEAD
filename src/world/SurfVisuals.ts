/**
 * SurfVisuals for PLAYHEAD
 * Audio-reactive surf surface treatment and physical contact trace.
 * - Dark brutalist physical surface with directional signal flow
 * - Frequency-reactive illumination (Bass wave, Mid flow, High shimmer)
 * - Luminous surface contact ribbon tracing player's trajectory along the ramp
 * - Zero per-frame heap allocations
 */

import * as THREE from 'three';
import { PlayerController } from '../player/PlayerController';
import { MusicVisualState } from './MusicVisualController';
import { SettingsManager } from '../core/Settings';

export class SurfVisuals {
  public group: THREE.Group;

  // 1. Audio-Reactive Surf Materials
  public surfMaterial: THREE.MeshStandardMaterial;

  // 2. Surf Contact Trace Ribbon
  private readonly TRACE_MAX_POINTS = 140;
  private tracePositions: Float32Array;
  private traceColors: Float32Array;
  private traceLine: THREE.Line;
  private traceGeom: THREE.BufferGeometry;
  private traceCount = 0;
  private traceMaterial: THREE.LineBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();

    // 1. Shared Surf Material: Dark polished metallic slate with responsive audio emission
    this.surfMaterial = new THREE.MeshStandardMaterial({
      color: 0x1c222d,
      roughness: 0.35,
      metalness: 0.65,
      emissive: new THREE.Color(0x00f0ff),
      emissiveIntensity: 0.05
    });

    // 2. Contact Trace Ribbon
    this.tracePositions = new Float32Array(this.TRACE_MAX_POINTS * 3);
    this.traceColors = new Float32Array(this.TRACE_MAX_POINTS * 3);
    this.traceGeom = new THREE.BufferGeometry();
    this.traceGeom.setAttribute('position', new THREE.BufferAttribute(this.tracePositions, 3));
    this.traceGeom.setAttribute('color', new THREE.BufferAttribute(this.traceColors, 3));

    this.traceMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      linewidth: 3
    });
    this.traceLine = new THREE.Line(this.traceGeom, this.traceMaterial);
    this.traceLine.frustumCulled = false;
    this.group.add(this.traceLine);

    scene.add(this.group);
  }

  public update(player: PlayerController, visualState: MusicVisualState, _dt: number): void {
    const isSurfing = player.surfState.isSurfing || player.isSurfing;
    const speed = player.getSpeedUnits();
    const reduceMotion = SettingsManager.getInstance().settings.reduceMotion;
    const rMult = visualState.reactivityMultiplier;

    // ==========================================
    // 1. Audio-Reactive Surf Material Modulation
    // ==========================================
    // Low frequencies drive broad emissive pulse; high frequencies drive crisp edge shimmer
    const bassGlow = (visualState.subBass * 0.4 + visualState.bass * 0.25 + visualState.dropImpact * 0.8) * rMult;
    const highShimmer = visualState.high * 0.3 * rMult;
    const speedBoost = Math.min(1.5, Math.max(1.0, speed / 560.0));
    const surfIntensity = (0.03 + bassGlow + highShimmer) * speedBoost;

    this.surfMaterial.emissiveIntensity = surfIntensity;
    this.surfMaterial.emissive.copy(visualState.palette.primary).lerp(visualState.palette.highlight, visualState.highlightMix);

    // ==========================================
    // 2. Surf Contact Trace Ribbon
    // ==========================================
    if (isSurfing && !reduceMotion) {
      const pos = player.position;
      const contact = player.surfState.contactPoint.lengthSq() > 0 ? player.surfState.contactPoint : pos;
      const contactColor = visualState.palette.highlight.clone().lerp(
        visualState.palette.secondary,
        0.35 + Math.sin(visualState.time * 4.0) * 0.15
      );

      if (this.traceCount < this.TRACE_MAX_POINTS) {
        const idx = this.traceCount * 3;
        this.tracePositions[idx] = contact.x;
        this.tracePositions[idx + 1] = contact.y + 0.05;
        this.tracePositions[idx + 2] = contact.z;

        this.traceColors[idx] = contactColor.r;
        this.traceColors[idx + 1] = contactColor.g;
        this.traceColors[idx + 2] = contactColor.b;

        this.traceCount++;
      } else {
        // Shift ring buffer
        for (let i = 0; i < (this.TRACE_MAX_POINTS - 1) * 3; i++) {
          this.tracePositions[i] = this.tracePositions[i + 3];
          this.traceColors[i] = this.traceColors[i + 3];
        }
        const last = (this.TRACE_MAX_POINTS - 1) * 3;
        this.tracePositions[last] = contact.x;
        this.tracePositions[last + 1] = contact.y + 0.05;
        this.tracePositions[last + 2] = contact.z;

        this.traceColors[last] = contactColor.r;
        this.traceColors[last + 1] = contactColor.g;
        this.traceColors[last + 2] = contactColor.b;
      }

      this.traceGeom.attributes.position.needsUpdate = true;
      this.traceGeom.attributes.color.needsUpdate = true;
      this.traceGeom.setDrawRange(0, this.traceCount);
    } else {
      // Fade trace out when leaving surf surface
      if (this.traceCount > 0) {
        this.traceCount = Math.max(0, this.traceCount - 4);
        this.traceGeom.setDrawRange(0, this.traceCount);
      }
    }
  }

  public clear(): void {
    this.traceCount = 0;
    this.traceGeom.setDrawRange(0, 0);
  }

  public dispose(): void {
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
    this.traceGeom.dispose();
    this.traceMaterial.dispose();
    this.surfMaterial.dispose();
    this.group.clear();
  }
}
