/**
 * Movement & Strafe Visualization for PLAYHEAD
 * Renders curved air-strafe ribbons, playhead path trace, and speed streaks
 * without impacting movement physics or allocating heap memory per frame.
 */

import * as THREE from 'three';
import { PlayerController } from './PlayerController';
import { MusicVisualState } from '../world/MusicVisualController';
import { SettingsManager } from '../core/Settings';

export class StrafeVisualizer {
  public group: THREE.Group;

  // 1. Playhead Path Trail (fading geometric line behind player)
  private readonly TRAIL_MAX_POINTS = 180;
  private trailPositions: Float32Array;
  private trailColors: Float32Array;
  private trailLine: THREE.Line;
  private trailGeom: THREE.BufferGeometry;
  private trailCount = 0;

  // 2. Air Strafe Curved Ribbons
  private readonly STRAFE_MAX_POINTS = 120;
  private strafePositions: Float32Array;
  private strafeLine: THREE.Line;
  private strafeGeom: THREE.BufferGeometry;
  private strafeCount = 0;
  private strafeMaterial: THREE.LineBasicMaterial;

  // 3. Near-Field Speed Particles
  private readonly PARTICLE_COUNT = 60;
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
      opacity: 0.75,
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
      opacity: 0.9,
      linewidth: 3
    });
    this.strafeLine = new THREE.Line(this.strafeGeom, this.strafeMaterial);
    this.strafeLine.frustumCulled = false;
    this.group.add(this.strafeLine);

    // 3. Speed Particles
    this.particlePositions = new Float32Array(this.PARTICLE_COUNT * 3);
    for (let i = 0; i < this.PARTICLE_COUNT; i++) {
      this.resetParticle(i, new THREE.Vector3());
    }
    const partGeom = new THREE.BufferGeometry();
    partGeom.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));

    this.particleMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.18,
      transparent: true,
      opacity: 0.5
    });
    this.particlePoints = new THREE.Points(partGeom, this.particleMaterial);
    this.particlePoints.frustumCulled = false;
    this.group.add(this.particlePoints);

    scene.add(this.group);
  }

  private resetParticle(idx: number, origin: THREE.Vector3): void {
    const pIdx = idx * 3;
    this.particlePositions[pIdx] = origin.x + (Math.random() - 0.5) * 16.0;
    this.particlePositions[pIdx + 1] = origin.y + (Math.random() - 0.5) * 6.0 + 1.2;
    this.particlePositions[pIdx + 2] = origin.z + (Math.random() - 0.5) * 16.0;
  }

  public update(player: PlayerController, visualState: MusicVisualState, dt: number): void {
    const pos = player.position;
    const vel = player.velocity;
    const speed = player.getSpeedUnits();
    const horizSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    const reduceMotion = SettingsManager.getInstance().settings.reduceMotion;

    // Palette sync: strafe ribbon blends primary and secondary based on frequency balance;
    // brightness driven by speed * strafeEfficiency * musicEnergy
    const freqBalance = Math.max(0, Math.min(1, visualState.mid / Math.max(0.1, visualState.bass + visualState.mid)));
    this.strafeMaterial.color.copy(visualState.palette.primary).lerp(visualState.palette.secondary, freqBalance);
    const strafeBrightness = Math.min(1.0, 0.35 + (speed / 1000.0) * player.currentStrafeEfficiency * (0.5 + visualState.energy * 0.7));
    this.strafeMaterial.opacity = Math.min(1.0, 0.5 + strafeBrightness * 0.5);

    this.particleMaterial.color.copy(visualState.palette.highlight);

    // ==========================================
    // 1. Playhead Trail (Sample every ~2 ticks)
    // ==========================================
    const trailCol = visualState.palette.primary.clone().lerp(
      visualState.palette.highlight,
      player.currentStrafeEfficiency * 0.5
    );

    if (this.trailCount < this.TRAIL_MAX_POINTS) {
      const idx = this.trailCount * 3;
      this.trailPositions[idx] = pos.x;
      this.trailPositions[idx + 1] = pos.y + 0.15;
      this.trailPositions[idx + 2] = pos.z;

      this.trailColors[idx] = trailCol.r;
      this.trailColors[idx + 1] = trailCol.g;
      this.trailColors[idx + 2] = trailCol.b;

      this.trailCount++;
    } else {
      // Shift ring buffer
      for (let i = 0; i < (this.TRAIL_MAX_POINTS - 1) * 3; i++) {
        this.trailPositions[i] = this.trailPositions[i + 3];
        this.trailColors[i] = this.trailColors[i + 3];
      }
      const last = (this.TRAIL_MAX_POINTS - 1) * 3;
      this.trailPositions[last] = pos.x;
      this.trailPositions[last + 1] = pos.y + 0.15;
      this.trailPositions[last + 2] = pos.z;

      this.trailColors[last] = trailCol.r;
      this.trailColors[last + 1] = trailCol.g;
      this.trailColors[last + 2] = trailCol.b;
    }

    this.trailGeom.attributes.position.needsUpdate = true;
    this.trailGeom.attributes.color.needsUpdate = true;
    this.trailGeom.setDrawRange(0, this.trailCount);

    // ==========================================
    // 2. Air Strafe Ribbon
    // Active only when airborne and moving at speed with lateral keys
    // ==========================================
    const isStrafing = !player.isGrounded && horizSpeed > 8.0 && (player.keysState.left || player.keysState.right);

    if (isStrafing && !reduceMotion) {
      if (this.strafeCount < this.STRAFE_MAX_POINTS) {
        const idx = this.strafeCount * 3;
        this.strafePositions[idx] = pos.x;
        this.strafePositions[idx + 1] = pos.y + 0.6;
        this.strafePositions[idx + 2] = pos.z;
        this.strafeCount++;
      } else {
        for (let i = 0; i < (this.STRAFE_MAX_POINTS - 1) * 3; i++) {
          this.strafePositions[i] = this.strafePositions[i + 3];
        }
        const last = (this.STRAFE_MAX_POINTS - 1) * 3;
        this.strafePositions[last] = pos.x;
        this.strafePositions[last + 1] = pos.y + 0.6;
        this.strafePositions[last + 2] = pos.z;
      }
      this.strafeGeom.attributes.position.needsUpdate = true;
      this.strafeGeom.setDrawRange(0, this.strafeCount);
    } else {
      // Fade out strafe line quickly when grounded
      if (this.strafeCount > 0) {
        this.strafeCount = Math.max(0, this.strafeCount - 3);
        this.strafeGeom.setDrawRange(0, this.strafeCount);
      }
    }

    // ==========================================
    // 3. Near-Field Speed Particles
    // ==========================================
    if (speed > 600 && !reduceMotion) {
      this.particleMaterial.opacity = Math.min(0.8, (speed - 600) / 400);
      const posAttr = this.particlePoints.geometry.attributes.position;
      const array = posAttr.array as Float32Array;

      for (let i = 0; i < this.PARTICLE_COUNT; i++) {
        const pIdx = i * 3;
        // Streak backwards relative to velocity
        array[pIdx] -= vel.x * dt * 0.4;
        array[pIdx + 1] -= vel.y * dt * 0.4;
        array[pIdx + 2] -= vel.z * dt * 0.4;

        // Respawn if too far from player
        const dx = array[pIdx] - pos.x;
        const dy = array[pIdx + 1] - pos.y;
        const dz = array[pIdx + 2] - pos.z;
        if (dx * dx + dy * dy + dz * dz > 18.0 * 18.0) {
          this.resetParticle(i, pos);
        }
      }
      posAttr.needsUpdate = true;
    } else {
      this.particleMaterial.opacity = 0;
    }
  }

  public clear(): void {
    this.trailCount = 0;
    this.strafeCount = 0;
    this.trailGeom.setDrawRange(0, 0);
    this.strafeGeom.setDrawRange(0, 0);
  }

  public dispose(): void {
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
    this.trailGeom.dispose();
    this.strafeGeom.dispose();
    this.strafeMaterial.dispose();
    this.particlePoints.geometry.dispose();
    this.particleMaterial.dispose();
    this.group.clear();
  }
}
