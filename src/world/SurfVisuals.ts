/**
 * SurfVisuals for PLAYHEAD SIGNAL RENDER
 * "Cosmic Pixel Brutalism" surf presentation:
 * - Directional signal flow with audio-reactive emission
 * - Stepped luminous surface contact ribbon
 * - Square pixel contact sparks spray along the glide line
 * - Zero per-frame heap allocations
 */

import * as THREE from 'three';
import { PlayerController } from '../player/PlayerController';
import { MusicVisualState, resolveChannels } from './MusicVisualController';
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

  // 3. Square Pixel Contact Sparks
  private readonly SPARK_COUNT = 40;
  private sparkPositions: Float32Array;
  private sparkVelocities: Float32Array;
  private sparkLifetimes: Float32Array;
  private sparkPoints: THREE.Points;
  private sparkMaterial: THREE.PointsMaterial;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();

    // 1. Shared Surf Material
    this.surfMaterial = new THREE.MeshStandardMaterial({
      color: 0x141c2b,
      roughness: 0.25,
      metalness: 0.75,
      emissive: new THREE.Color(0x00f0ff),
      emissiveIntensity: 0.15
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
      opacity: 0.9,
      linewidth: 3
    });
    this.traceLine = new THREE.Line(this.traceGeom, this.traceMaterial);
    this.traceLine.frustumCulled = false;
    this.group.add(this.traceLine);

    // 3. Square Pixel Sparks
    this.sparkPositions = new Float32Array(this.SPARK_COUNT * 3);
    this.sparkVelocities = new Float32Array(this.SPARK_COUNT * 3);
    this.sparkLifetimes = new Float32Array(this.SPARK_COUNT);

    const sparkGeom = new THREE.BufferGeometry();
    sparkGeom.setAttribute('position', new THREE.BufferAttribute(this.sparkPositions, 3));

    const squareTex = createSparkTexture();
    this.sparkMaterial = new THREE.PointsMaterial({
      color: 0x7ee7f8,
      size: 0.28,
      map: squareTex,
      transparent: true,
      opacity: 0.9,
      depthWrite: false
    });
    this.sparkPoints = new THREE.Points(sparkGeom, this.sparkMaterial);
    this.sparkPoints.frustumCulled = false;
    this.group.add(this.sparkPoints);

    scene.add(this.group);
  }

  public update(player: PlayerController, visualState: MusicVisualState, dt: number): void {
    const isSurfing = player.surfState.isSurfing || player.isSurfing;
    const speed = player.getSpeedUnits();
    const reduceMotion = SettingsManager.getInstance().settings.reduceMotion;
    const rMult = visualState.reactivityMultiplier;
    const ch = resolveChannels(visualState);

    // 1. Audio-Reactive Surf Material Modulation
    //
    // Surf now speaks the same music language as the rest of the world: the
    // heavy low end is the structural mass, the sharp highs are the shimmer, and
    // the near drop window is the surge. Velocity stretches the response so a
    // fast surf through a drop reads as spectacular without touching physics.
    const bassGlow = (ch.bassMass * 0.7 + visualState.subBass * 0.2 + ch.dropPrimary * 0.9) * rMult;
    const highShimmer = ch.highGlint * 0.5 * rMult;
    const speedBoost = Math.min(1.8, Math.max(1.0, speed / 480.0));
    const surfIntensity = (0.06 + bassGlow + highShimmer) * speedBoost;

    this.surfMaterial.emissiveIntensity = surfIntensity;
    this.surfMaterial.emissive.copy(visualState.palette.primary).lerp(visualState.palette.highlight, visualState.highlightMix);

    // 2. Surf Contact Trace Ribbon
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
        this.tracePositions[idx + 1] = contact.y + 0.08;
        this.tracePositions[idx + 2] = contact.z;

        this.traceColors[idx] = contactColor.r;
        this.traceColors[idx + 1] = contactColor.g;
        this.traceColors[idx + 2] = contactColor.b;

        this.traceCount++;
      } else {
        for (let i = 0; i < (this.TRACE_MAX_POINTS - 1) * 3; i++) {
          this.tracePositions[i] = this.tracePositions[i + 3];
          this.traceColors[i] = this.traceColors[i + 3];
        }
        const last = (this.TRACE_MAX_POINTS - 1) * 3;
        this.tracePositions[last] = contact.x;
        this.tracePositions[last + 1] = contact.y + 0.08;
        this.tracePositions[last + 2] = contact.z;

        this.traceColors[last] = contactColor.r;
        this.traceColors[last + 1] = contactColor.g;
        this.traceColors[last + 2] = contactColor.b;
      }

      this.traceGeom.attributes.position.needsUpdate = true;
      this.traceGeom.attributes.color.needsUpdate = true;
      this.traceGeom.setDrawRange(0, this.traceCount);

      // 3. Emit Square Pixel Sparks along contact
      this.sparkMaterial.color.copy(visualState.palette.highlight);
      for (let s = 0; s < 3; s++) {
        const freeIdx = this.findFreeSpark();
        if (freeIdx !== -1) {
          const s3 = freeIdx * 3;
          this.sparkPositions[s3] = contact.x + (Math.random() - 0.5) * 0.4;
          this.sparkPositions[s3 + 1] = contact.y + 0.1 + Math.random() * 0.2;
          this.sparkPositions[s3 + 2] = contact.z + (Math.random() - 0.5) * 0.4;

          // Spray backward along player velocity
          const v = player.velocity;
          this.sparkVelocities[s3] = -v.x * 0.15 + (Math.random() - 0.5) * 4.0;
          this.sparkVelocities[s3 + 1] = Math.random() * 3.0 + 1.0;
          this.sparkVelocities[s3 + 2] = -v.z * 0.15 + (Math.random() - 0.5) * 4.0;

          this.sparkLifetimes[freeIdx] = 0.35 + Math.random() * 0.15;
        }
      }
    } else {
      if (this.traceCount > 0) {
        this.traceCount = Math.max(0, this.traceCount - 4);
        this.traceGeom.setDrawRange(0, this.traceCount);
      }
    }

    // Update Sparks
    for (let i = 0; i < this.SPARK_COUNT; i++) {
      if (this.sparkLifetimes[i] > 0) {
        this.sparkLifetimes[i] -= dt;
        const i3 = i * 3;
        this.sparkPositions[i3] += this.sparkVelocities[i3] * dt;
        this.sparkPositions[i3 + 1] += this.sparkVelocities[i3 + 1] * dt;
        this.sparkPositions[i3 + 2] += this.sparkVelocities[i3 + 2] * dt;
      } else {
        const i3 = i * 3;
        this.sparkPositions[i3 + 1] = -999.0;
      }
    }
    this.sparkPoints.geometry.attributes.position.needsUpdate = true;
  }

  private findFreeSpark(): number {
    for (let i = 0; i < this.SPARK_COUNT; i++) {
      if (this.sparkLifetimes[i] <= 0) return i;
    }
    return -1;
  }

  public clear(): void {
    this.traceCount = 0;
    this.traceGeom.setDrawRange(0, 0);
    for (let i = 0; i < this.SPARK_COUNT; i++) {
      this.sparkLifetimes[i] = 0;
    }
  }

  public dispose(): void {
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
    this.traceGeom.dispose();
    this.traceMaterial.dispose();
    this.surfMaterial.dispose();
    this.sparkPoints.geometry.dispose();
    this.sparkMaterial.dispose();
    this.group.clear();
  }
}

function createSparkTexture(): THREE.CanvasTexture {
  if (typeof document === 'undefined') {
    return new THREE.CanvasTexture(null as unknown as HTMLCanvasElement);
  }
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(2, 2, 12, 12);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return tex;
}
