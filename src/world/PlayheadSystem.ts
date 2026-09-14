/**
 * Playhead Temporality System for PLAYHEAD
 * Manages the Past / Present / Future spatial-temporal activation states
 * and now-line ignition relative to player position and audio timeline.
 */

import * as THREE from 'three';
import { MusicVisualState } from './MusicVisualController';

export interface PlayheadActivationMesh {
  mesh: THREE.Mesh | THREE.LineSegments;
  nodeArcLength: number;
  nodeTime: number;
  baseOpacity: number;
  baseEmissive?: number;
}

export class PlayheadSystem {
  private activeItems: PlayheadActivationMesh[] = [];

  // Playhead plane visualizer (subtle vertical accent line crossing the route at player position)
  private nowLineGroup: THREE.Group;
  private nowLineMaterial: THREE.LineBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.nowLineGroup = new THREE.Group();

    // A subtle horizontal line marker indicating the current playhead threshold
    const lineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-14, 0.15, 0),
      new THREE.Vector3(14, 0.15, 0)
    ]);
    this.nowLineMaterial = new THREE.LineBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.7,
      linewidth: 2
    });
    const line = new THREE.Line(lineGeom, this.nowLineMaterial);
    this.nowLineGroup.add(line);

    scene.add(this.nowLineGroup);
  }

  public registerItem(
    mesh: THREE.Mesh | THREE.LineSegments,
    arcLength: number,
    nodeTime: number,
    baseOpacity = 1.0,
    baseEmissive = 0.5
  ): void {
    this.activeItems.push({
      mesh,
      nodeArcLength: arcLength,
      nodeTime,
      baseOpacity,
      baseEmissive
    });
  }

  public update(
    playerPos: THREE.Vector3,
    playerArcProgress: number,
    playerYaw: number,
    visualState: MusicVisualState
  ): void {
    // 1. Position Now-Line marker at player location facing movement orientation
    this.nowLineGroup.position.set(playerPos.x, playerPos.y + 0.1, playerPos.z);
    this.nowLineGroup.rotation.y = playerYaw;
    this.nowLineMaterial.color.copy(visualState.palette.primary).lerp(visualState.palette.highlight, 0.35);
    this.nowLineMaterial.opacity = 0.5 + visualState.energy * 0.4 + visualState.dropImpact * 0.5;

    // 2. Process all registered items through Future / Present / Past states
    const songTime = visualState.time;
    const nowWindow = 65.0; // +/- 65 metres around player
    const reactMult = visualState.reactivityMultiplier;

    for (let i = 0; i < this.activeItems.length; i++) {
      const item = this.activeItems[i];
      const deltaArc = item.nodeArcLength - playerArcProgress;

      const mat = item.mesh.material as (THREE.MeshStandardMaterial | THREE.LineBasicMaterial);
      if (!mat) continue;

      // Forward-propagating traveling pulse wave along route edges
      const isLine = item.mesh instanceof THREE.LineSegments || mat instanceof THREE.LineBasicMaterial;
      let pulseWave = 0;
      if (deltaArc > 0) {
        const waveDist = (deltaArc - visualState.routePulsePhase * 28.0) % 55.0;
        const distFromCenter = Math.abs(waveDist - 27.5);
        pulseWave = Math.max(0, 1.0 - distFromCenter / 10.0) * visualState.subBass * reactMult;
      }

      if (deltaArc > nowWindow) {
        // ==========================================
        // FUTURE: Darker, cool, dormant, awaiting playhead
        // ==========================================
        const futureDist = deltaArc - nowWindow;
        const futureFactor = Math.max(0, 1.0 - futureDist / 120.0);

        if ('emissiveIntensity' in mat) {
          mat.emissiveIntensity = (item.baseEmissive || 0.5) * 0.15 * futureFactor;
          mat.emissive.copy(visualState.palette.void).lerp(visualState.palette.primary, 0.2);
        }
        if ('opacity' in mat) {
          mat.opacity = item.baseOpacity * (0.25 + 0.3 * futureFactor + pulseWave * 0.45);
        }
        if (isLine && 'color' in mat) {
          mat.color.copy(visualState.palette.surface).lerp(visualState.palette.primary, 0.2 + pulseWave * 0.7);
        }

      } else if (deltaArc < -25.0) {
        // ==========================================
        // PAST: Gradually dims, loses saturation, dissolves
        // ==========================================
        const pastDist = Math.abs(deltaArc) - 25.0;
        const pastFactor = Math.max(0.1, 1.0 - pastDist / 90.0);

        if ('emissiveIntensity' in mat) {
          mat.emissiveIntensity = (item.baseEmissive || 0.5) * 0.15 * pastFactor;
          mat.emissive.copy(visualState.palette.surface);
        }
        if ('opacity' in mat) {
          mat.opacity = item.baseOpacity * (0.15 + 0.45 * pastFactor);
        }
        if (isLine && 'color' in mat) {
          mat.color.copy(visualState.palette.void).lerp(visualState.palette.surface, pastFactor);
        }

      } else {
        // ==========================================
        // PRESENT: Audio-reactive ignition & high contrast
        // ==========================================
        // Check temporal synchronization
        const timeDiff = item.nodeTime - songTime;
        const isAhead = timeDiff > 0.6; // Player arrived before audio
        const isLate = timeDiff < -0.8;  // Player arrived after audio

        let presenceFactor = 1.0;
        if (isAhead) {
          presenceFactor = 0.5;
        } else if (isLate) {
          presenceFactor = 0.7;
        }

        const ignitionPulse = 1.0 - Math.abs(deltaArc) / nowWindow; // 1.0 right at playhead plane

        if ('emissiveIntensity' in mat) {
          const base = item.baseEmissive || 0.6;
          mat.emissiveIntensity = (base + visualState.bass * 0.8 + visualState.flux * 0.5 + visualState.dropImpact * 1.5) * presenceFactor * (1.0 + ignitionPulse * 0.5) * reactMult;
          mat.emissive.copy(visualState.palette.primary).lerp(visualState.palette.highlight, visualState.highlightMix);
        }
        if ('opacity' in mat) {
          mat.opacity = Math.min(1.0, item.baseOpacity * (0.75 + visualState.energy * 0.25 + ignitionPulse * 0.25));
        }
        if (isLine && 'color' in mat) {
          mat.color.copy(visualState.palette.primary).lerp(visualState.palette.highlight, 0.3 + ignitionPulse * 0.7);
        }
      }
    }
  }

  public clear(): void {
    this.activeItems = [];
  }

  public dispose(): void {
    this.clear();
    if (this.nowLineGroup.parent) {
      this.nowLineGroup.parent.remove(this.nowLineGroup);
    }
    this.nowLineMaterial.dispose();
  }
}
