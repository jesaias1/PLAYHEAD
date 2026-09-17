/**
 * Movement & Strafe Visualization for PLAYHEAD SIGNAL RENDER
 * "Cosmic Pixel Brutalism" signal trail and peripheral pixel dust.
 *
 * Implements "carving a signal through the world":
 * - Stepped gradient ribbon (highlight -> primary -> secondary -> void)
 * - Dithered particle breakup near the tail
 * - Square pixel shards streaking through peripheral vision at high speeds
 * - Zero per-frame garbage collection
 */

import * as THREE from 'three';
import { PlayerController } from './PlayerController';
import { MusicVisualState } from '../world/MusicVisualController';
import { SettingsManager } from '../core/Settings';

export class StrafeVisualizer {
  public group: THREE.Group;

  // 1. Playhead Signal Trail
  private readonly TRAIL_MAX_POINTS = 160;
  private trailPositions: Float32Array;
  private trailColors: Float32Array;
  private trailLine: THREE.Line;
  private trailGeom: THREE.BufferGeometry;
  private trailCount = 0;

  // 2. Air Strafe Curved Ribbon
  private readonly STRAFE_MAX_POINTS = 100;
  private strafePositions: Float32Array;
  private strafeLine: THREE.Line;
  private strafeGeom: THREE.BufferGeometry;
  private strafeCount = 0;
  private strafeMaterial: THREE.LineBasicMaterial;

  // 3. Near-Field Square Pixel Dust & Speed Fragments
  private readonly PARTICLE_COUNT = 70;
  private particlePositions: Float32Array;
  private particlePoints: THREE.Points;
  private particleMaterial: THREE.PointsMaterial;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();

    // 1. Trail Setup
    this.trailPositions = new Float32Array(this.TRAIL_MAX_POINTS * 3);
    this.trailColors = new Float32Array(this.TRAIL_MAX_POINTS * 3);
    this.trailGeom = new THREE.BufferGeometry();
    this.trailGeom.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    this.trailGeom.setAttribute('color', new THREE.BufferAttribute(this.trailColors, 3));

    const trailMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.88,
      linewidth: 2
    });
    this.trailLine = new THREE.Line(this.trailGeom, trailMat);
    this.trailLine.frustumCulled = false;
    this.group.add(this.trailLine);

    // 2. Air Strafe Ribbon Setup
    this.strafePositions = new Float32Array(this.STRAFE_MAX_POINTS * 3);
    this.strafeGeom = new THREE.BufferGeometry();
    this.strafeGeom.setAttribute('position', new THREE.BufferAttribute(this.strafePositions, 3));

    this.strafeMaterial = new THREE.LineBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.92,
      linewidth: 3
    });
    this.strafeLine = new THREE.Line(this.strafeGeom, this.strafeMaterial);
    this.strafeLine.frustumCulled = false;
    this.group.add(this.strafeLine);

    // 3. Square Pixel Dust Particles
    this.particlePositions = new Float32Array(this.PARTICLE_COUNT * 3);
    for (let i = 0; i < this.PARTICLE_COUNT; i++) {
      this.resetParticle(i, new THREE.Vector3());
    }
    const partGeom = new THREE.BufferGeometry();
    partGeom.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));

    // Create square pixel point texture
    const squareTex = createSquarePixelTexture();

    this.particleMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.28,
      map: squareTex,
      transparent: true,
      opacity: 0.75,
      depthWrite: false
    });
    this.particlePoints = new THREE.Points(partGeom, this.particleMaterial);
    this.particlePoints.frustumCulled = false;
    this.group.add(this.particlePoints);

    scene.add(this.group);
  }

  private resetParticle(idx: number, origin: THREE.Vector3): void {
    const pIdx = idx * 3;
    this.particlePositions[pIdx] = origin.x + (Math.random() - 0.5) * 18.0;
    this.particlePositions[pIdx + 1] = origin.y + (Math.random() - 0.5) * 8.0 + 1.2;
    this.particlePositions[pIdx + 2] = origin.z + (Math.random() - 0.5) * 18.0;
  }

  public update(player: PlayerController, visualState: MusicVisualState, dt: number): void {
    const speed = player.getSpeedUnits();
    const isAirborne = !player.isGrounded;
    const isSurfing = player.surfState.isSurfing || player.isSurfing;
    const reduceMotion = SettingsManager.getInstance().settings.reduceMotion;

    if (reduceMotion) {
      this.trailLine.visible = false;
      this.strafeLine.visible = false;
      this.particlePoints.visible = false;
      return;
    }

    this.trailLine.visible = true;
    this.strafeLine.visible = true;
    this.particlePoints.visible = true;

    // Palette Colors
    const hiCol = visualState.palette.highlight || new THREE.Color(0xffffff);
    const primCol = visualState.palette.primary;
    const secCol = visualState.palette.secondary;

    // 1. Playhead Signal Trail
    const pos = player.position;
    if (speed > 120.0 || isAirborne) {
      if (this.trailCount < this.TRAIL_MAX_POINTS) {
        const idx = this.trailCount * 3;
        this.trailPositions[idx] = pos.x;
        this.trailPositions[idx + 1] = pos.y + 0.15;
        this.trailPositions[idx + 2] = pos.z;

        // Color gradient along trail life: Highlight -> Primary -> Secondary
        const trailT = this.trailCount / this.TRAIL_MAX_POINTS;
        const col = hiCol.clone().lerp(primCol, trailT * 0.7).lerp(secCol, trailT);

        this.trailColors[idx] = col.r;
        this.trailColors[idx + 1] = col.g;
        this.trailColors[idx + 2] = col.b;

        this.trailCount++;
      } else {
        // Shift buffer left by 1 point
        for (let i = 0; i < (this.TRAIL_MAX_POINTS - 1) * 3; i++) {
          this.trailPositions[i] = this.trailPositions[i + 3];
          this.trailColors[i] = this.trailColors[i + 3];
        }
        const last = (this.TRAIL_MAX_POINTS - 1) * 3;
        this.trailPositions[last] = pos.x;
        this.trailPositions[last + 1] = pos.y + 0.15;
        this.trailPositions[last + 2] = pos.z;

        this.trailColors[last] = hiCol.r;
        this.trailColors[last + 1] = hiCol.g;
        this.trailColors[last + 2] = hiCol.b;
      }
      this.trailGeom.attributes.position.needsUpdate = true;
      this.trailGeom.attributes.color.needsUpdate = true;
      this.trailGeom.setDrawRange(0, this.trailCount);
    }

    // 2. Air Strafe Ribbon
    if (isAirborne && !isSurfing && speed > 220.0) {
      this.strafeMaterial.color.copy(primCol);
      if (this.strafeCount < this.STRAFE_MAX_POINTS) {
        const sIdx = this.strafeCount * 3;
        this.strafePositions[sIdx] = pos.x;
        this.strafePositions[sIdx + 1] = pos.y + 0.4;
        this.strafePositions[sIdx + 2] = pos.z;
        this.strafeCount++;
      } else {
        for (let i = 0; i < (this.STRAFE_MAX_POINTS - 1) * 3; i++) {
          this.strafePositions[i] = this.strafePositions[i + 3];
        }
        const sLast = (this.STRAFE_MAX_POINTS - 1) * 3;
        this.strafePositions[sLast] = pos.x;
        this.strafePositions[sLast + 1] = pos.y + 0.4;
        this.strafePositions[sLast + 2] = pos.z;
      }
      this.strafeGeom.attributes.position.needsUpdate = true;
      this.strafeGeom.setDrawRange(0, this.strafeCount);
    } else {
      if (this.strafeCount > 0) {
        this.strafeCount = Math.max(0, this.strafeCount - 3);
        this.strafeGeom.setDrawRange(0, this.strafeCount);
      }
    }

    // 3. Near-Field Square Pixel Particles (Streaking during high velocity)
    const vel = player.velocity;
    const speedFactor = Math.min(2.0, Math.max(0.2, speed / 400.0));
    this.particleMaterial.color.copy(hiCol);
    this.particleMaterial.size = 0.22 * speedFactor;

    for (let i = 0; i < this.PARTICLE_COUNT; i++) {
      const pIdx = i * 3;
      // Drift backwards relative to velocity
      this.particlePositions[pIdx] -= vel.x * dt * 0.4;
      this.particlePositions[pIdx + 1] -= vel.y * dt * 0.4;
      this.particlePositions[pIdx + 2] -= vel.z * dt * 0.4;

      // Wrap particles around player
      const dx = this.particlePositions[pIdx] - pos.x;
      const dy = this.particlePositions[pIdx + 1] - pos.y;
      const dz = this.particlePositions[pIdx + 2] - pos.z;

      if (dx * dx + dy * dy + dz * dz > 22.0 * 22.0) {
        this.resetParticle(i, pos);
      }
    }
    this.particlePoints.geometry.attributes.position.needsUpdate = true;
  }

  public clear(): void {
    this.trailCount = 0;
    this.strafeCount = 0;
    this.trailGeom.setDrawRange(0, 0);
    this.strafeGeom.setDrawRange(0, 0);
  }

  public dispose(): void {
    this.trailGeom.dispose();
    this.strafeGeom.dispose();
    this.particlePoints.geometry.dispose();
    this.trailLine.material instanceof THREE.Material && this.trailLine.material.dispose();
    this.strafeMaterial.dispose();
    this.particleMaterial.dispose();
  }
}

/**
 * Creates a crisp square pixel texture for retro pixel particle points.
 */
function createSquarePixelTexture(): THREE.CanvasTexture {
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
