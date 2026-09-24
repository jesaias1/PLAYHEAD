/**
 * GHOST VISUAL — the shared ghost representation.
 *
 * ONE visual language for both a live multiplayer rival and a recorded replay
 * ghost, so the two can never drift apart. The SOURCES stay separate:
 *
 *   RemoteGhostRenderer   live 12 Hz network samples   -> GhostVisual
 *   GhostRaceController   recorded replay samples      -> GhostVisual
 *
 * READABILITY CONTRACT (unchanged from the multiplayer calibration):
 *   - visible enough to feel like another runner is in the level
 *   - never opaque enough to hide the route behind it
 *   - never bright enough to blind, and no wide glow halo
 *   - visually distinct from gameplay geometry
 *
 * The BODY is normal-blended and translucent, so it can only ever occlude a
 * little of what is behind it — it cannot ADD light and therefore cannot blow
 * out a bright section. Only the thin wireframe TRACE is additive, and at low
 * opacity, which keeps the silhouette legible at distance without a halo.
 *
 * Presentation only. Never part of world-safety or gameplay validation.
 */

import * as THREE from 'three';

/** Translucent body — reads as a signal body, cannot add light. */
export const GHOST_BODY_OPACITY = 0.40;
/** Thin additive trace — the silhouette cue, deliberately faint. */
export const GHOST_TRACE_OPACITY = 0.22;

export interface GhostVisualOptions {
  color: number;
  bodyOpacity?: number;
  traceOpacity?: number;
}

export class GhostVisual {
  public readonly group: THREE.Group;

  private readonly body: THREE.Mesh;
  private readonly trace: THREE.Mesh;
  private readonly bodyMaterial: THREE.MeshBasicMaterial;
  private readonly traceMaterial: THREE.MeshBasicMaterial;
  private readonly baseBodyOpacity: number;
  private readonly baseTraceOpacity: number;

  constructor(scene: THREE.Scene, options: GhostVisualOptions) {
    this.baseBodyOpacity = options.bodyOpacity ?? GHOST_BODY_OPACITY;
    this.baseTraceOpacity = options.traceOpacity ?? GHOST_TRACE_OPACITY;

    this.group = new THREE.Group();
    this.group.visible = false;
    // Presentation only: never part of world-safety or gameplay validation.
    this.group.userData.worldSafetyExempt = true;
    this.group.userData.devHelper = true;

    // Inner core: a slim vertical capsule read as a translucent signal body.
    this.bodyMaterial = new THREE.MeshBasicMaterial({
      color: options.color,
      transparent: true,
      opacity: this.baseBodyOpacity,
      // Normal blending on purpose: the body must never ADD light, so it can
      // never blind the player or wash out a bright section.
      blending: THREE.NormalBlending,
      depthWrite: false
    });
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 1.1, 4, 8), this.bodyMaterial);
    this.body.position.y = 0.9;
    this.group.add(this.body);

    // Outer shell: a faint additive wireframe trace for silhouette readability.
    this.traceMaterial = new THREE.MeshBasicMaterial({
      color: options.color,
      transparent: true,
      opacity: this.baseTraceOpacity,
      wireframe: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.trace = new THREE.Mesh(new THREE.CapsuleGeometry(0.46, 1.3, 4, 10), this.traceMaterial);
    this.trace.position.y = 0.9;
    this.group.add(this.trace);

    scene.add(this.group);
  }

  public setColor(color: number): void {
    this.bodyMaterial.color.setHex(color);
    this.traceMaterial.color.setHex(color);
  }

  /**
   * Presentation-only effect-intensity scale. Applied to both opacities, never
   * to position, orientation or timing. Clamped so the ghost can become subtler
   * but never fully invisible.
   */
  public setOpacityScale(scale: number): void {
    if (!Number.isFinite(scale) || scale <= 0) return;
    this.bodyMaterial.opacity = Math.min(0.75, Math.max(0.16, this.baseBodyOpacity * scale));
    this.traceMaterial.opacity = Math.min(0.5, Math.max(0.08, this.baseTraceOpacity * scale));
  }

  public setTransform(x: number, y: number, z: number, yaw: number): void {
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
  }

  public setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  public dispose(): void {
    this.body.geometry.dispose();
    this.trace.geometry.dispose();
    this.bodyMaterial.dispose();
    this.traceMaterial.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
