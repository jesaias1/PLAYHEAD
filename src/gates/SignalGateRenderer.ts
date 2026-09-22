/**
 * SIGNAL GATE RENDERING — COSMIC PIXEL BRUTALISM / SIGNAL RENDER.
 *
 * A gate is a fragmented brutalist frame: dark structural slabs around the
 * aperture, a thin emissive inner trim, a few asymmetrical signal fragments,
 * and a small waveform glyph cluster that doubles as the directional read.
 *
 * Deliberately NOT a glowing sci-fi hoop / racing checkpoint ring.
 *
 * Rendering never defines gameplay: the mesh group uses the exact same
 * position/orientation as the gameplay definition.
 */

import * as THREE from 'three';
import { SignalGateRuntime } from './SignalGate';

/** Minimal music input the gates need (kept narrow so it is cheap to build). */
export interface GateMusicState {
  energy: number;
  bass: number;
  onsetPulse: number;
  reactivityMultiplier: number;
}

export const SILENT_GATE_MUSIC: GateMusicState = {
  energy: 0,
  bass: 0,
  onsetPulse: 0,
  reactivityMultiplier: 0.7
};

const FRAME_THICKNESS = 0.5;
const FRAME_DEPTH = 0.7;

interface GateVisual {
  group: THREE.Group;
  bodyMaterial: THREE.MeshStandardMaterial;
  trimMaterial: THREE.MeshStandardMaterial;
}

export class SignalGateRenderer {
  public group: THREE.Group;

  private visuals: GateVisual[] = [];
  private bodyGeometry = new THREE.BoxGeometry(1, 1, 1);

  // Single shared crossing ripple (prototype: one at a time).
  private rippleMesh: THREE.Mesh;
  private rippleMaterial: THREE.MeshBasicMaterial;
  private rippleTime = -1;

  /** Short-lived transient accent, kept separate from the readable idle term. */
  private accent = 0;

  // DEV-only helpers: aperture bounds + intended direction.
  private debugGroup: THREE.Group;
  private debugMaterials: THREE.Material[] = [];
  private debugGeometries: THREE.BufferGeometry[] = [];

  constructor(gates: SignalGateRuntime[], palette: { primary: THREE.Color; secondary: THREE.Color }) {
    this.group = new THREE.Group();
    this.group.name = 'SignalGates';

    for (const gate of gates) {
      const visual = this.buildGateVisual(gate, palette);
      this.visuals.push(visual);
      this.group.add(visual.group);
    }

    const rippleGeom = new THREE.RingGeometry(0.85, 1.0, 20);
    this.rippleMaterial = new THREE.MeshBasicMaterial({
      color: palette.primary,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    this.rippleMesh = new THREE.Mesh(rippleGeom, this.rippleMaterial);
    this.rippleMesh.visible = false;
    this.group.add(this.rippleMesh);

    // DEV-only: aperture bounds + intended direction (hidden by default).
    this.debugGroup = new THREE.Group();
    this.debugGroup.name = 'SignalGateDebug';
    this.debugGroup.visible = false;
    for (const gate of gates) {
      const box = new THREE.BoxGeometry(gate.width, gate.height, 0.12);
      const edges = new THREE.EdgesGeometry(box);
      box.dispose();
      const mat = new THREE.LineBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.9 });
      const lines = new THREE.LineSegments(edges, mat);
      lines.position.set(gate.position.x, gate.position.y, gate.position.z);
      lines.rotation.set(0, gate.yaw, 0);
      this.debugGroup.add(lines);
      this.debugMaterials.push(mat);
      this.debugGeometries.push(edges);

      const dirGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(gate.position.x, gate.position.y, gate.position.z),
        new THREE.Vector3(
          gate.position.x + gate.forwardX * 8,
          gate.position.y,
          gate.position.z + gate.forwardZ * 8
        )
      ]);
      const dirMat = new THREE.LineBasicMaterial({ color: 0xffee00, transparent: true, opacity: 0.9 });
      this.debugGroup.add(new THREE.Line(dirGeom, dirMat));
      this.debugMaterials.push(dirMat);
      this.debugGeometries.push(dirGeom);
    }
    this.group.add(this.debugGroup);
  }

  /** DEV only: show aperture bounds and intended travel direction. */
  public setDebugVisible(visible: boolean): void {
    this.debugGroup.visible = visible;
  }

  private buildGateVisual(
    gate: SignalGateRuntime,
    palette: { primary: THREE.Color; secondary: THREE.Color }
  ): GateVisual {
    const group = new THREE.Group();
    group.name = `SignalGate:${gate.id}`;
    group.position.set(gate.position.x, gate.position.y, gate.position.z);
    group.rotation.set(0, gate.yaw, 0);

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x141b26,
      emissive: palette.secondary,
      emissiveIntensity: 0.14,
      roughness: 0.72,
      metalness: 0.24,
      transparent: true,
      opacity: 1.0
    });
    const trimMaterial = new THREE.MeshStandardMaterial({
      color: 0x12202f,
      emissive: palette.primary,
      emissiveIntensity: 1.0,
      roughness: 0.3,
      metalness: 0.5,
      transparent: true,
      opacity: 1.0
    });

    const halfW = gate.width * 0.5;
    const halfH = gate.height * 0.5;
    const th = FRAME_THICKNESS;

    const slab = (
      mat: THREE.Material,
      x: number, y: number, z: number,
      sx: number, sy: number, sz: number,
      rotZ = 0
    ) => {
      const mesh = new THREE.Mesh(this.bodyGeometry, mat);
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      if (rotZ !== 0) mesh.rotation.z = rotZ;
      group.add(mesh);
    };

    // Brutalist outer frame.
    slab(bodyMaterial, -(halfW + th * 0.5), 0, 0, th, gate.height + th * 2, FRAME_DEPTH);
    slab(bodyMaterial, halfW + th * 0.5, 0, 0, th, gate.height + th * 2, FRAME_DEPTH);
    slab(bodyMaterial, 0, halfH + th * 0.5, 0, gate.width, th, FRAME_DEPTH);
    slab(bodyMaterial, 0, -(halfH + th * 0.5), 0, gate.width, th, FRAME_DEPTH);

    // Thin emissive inner aperture trim.
    slab(trimMaterial, -(halfW - 0.09), 0, 0.05, 0.16, gate.height - 0.1, FRAME_DEPTH * 0.6);
    slab(trimMaterial, halfW - 0.09, 0, 0.05, 0.16, gate.height - 0.1, FRAME_DEPTH * 0.6);
    slab(trimMaterial, 0, halfH - 0.09, 0.05, gate.width - 0.1, 0.16, FRAME_DEPTH * 0.6);
    slab(trimMaterial, 0, -(halfH - 0.09), 0.05, gate.width - 0.1, 0.16, FRAME_DEPTH * 0.6);

    // Asymmetrical signal fragments (read as broken panel shards).
    slab(trimMaterial, -(halfW + 1.15), halfH * 0.4, 0.25, 0.5, 0.5, 0.5);
    slab(trimMaterial, halfW + 0.95, -halfH * 0.55, -0.2, 0.36, 0.72, 0.4);
    slab(trimMaterial, 0, halfH + 1.05, 0.2, 1.25, 0.26, 0.32);
    slab(bodyMaterial, -(halfW + 0.8), -halfH - 0.7, 0, 0.6, 1.1, 0.5);

    // Waveform glyph cluster below the aperture: doubles as the directional
    // read (the tall bar points along the intended travel direction).
    const glyphY = -(halfH + 1.35);
    const heights = [0.30, 0.62, 1.05, 0.5, 0.28];
    for (let i = 0; i < heights.length; i++) {
      slab(trimMaterial, (i - 2) * 0.42, glyphY + heights[i] * 0.5 - 0.25, 0.15, 0.22, heights[i], 0.22);
    }

    return { group, bodyMaterial, trimMaterial };
  }

  /** Kicks the local crossing ripple at a gate. */
  public pulseRipple(gate: SignalGateRuntime, reduceMotion: boolean): void {
    if (reduceMotion) return;
    this.rippleMesh.position.set(gate.position.x, gate.position.y, gate.position.z);
    this.rippleMesh.rotation.set(0, gate.yaw, 0);
    this.rippleMesh.visible = true;
    this.rippleTime = 0;
  }

  public update(gates: SignalGateRuntime[], dt: number, visualState: GateMusicState, reduceMotion: boolean): void {
    const react = visualState.reactivityMultiplier;

    // Restrained music-driven baseline: the aperture must stay readable, but a
    // mastery target has to be legible from the approach.
    //
    // The sustained idle term deliberately carries only a SMALL onset weight —
    // a constant beat pulse on the frame would fight the gate's readability.
    // Transients instead drive a separate short-lived accent that decays away,
    // so the gate belongs to the same world as the rest of the city without
    // ever flickering over the aperture.
    const idle = (0.85 + visualState.energy * 0.25 + visualState.bass * 0.40) * react;
    this.accent = Math.max(0, this.accent - dt * 4.5);
    this.accent = Math.max(this.accent, visualState.onsetPulse);
    const accent = this.accent * 0.85;

    for (let i = 0; i < this.visuals.length && i < gates.length; i++) {
      const gate = gates[i];
      const visual = this.visuals[i];

      if (gate.flash > 0) gate.flash = Math.max(0, gate.flash - dt * 2.6);
      if (gate.state === 'PASSED' && gate.collapse < 1) {
        gate.collapse = Math.min(1, gate.collapse + dt * (reduceMotion ? 6.0 : 2.8));
      }

      if (gate.state === 'PASSED' && gate.collapse >= 1) {
        visual.group.visible = false;
        continue;
      }
      visual.group.visible = true;

      if (gate.state === 'MISSED') {
        // Quietly dims. No failure screen, no buzzer.
        visual.trimMaterial.emissiveIntensity = 0.06;
        visual.trimMaterial.opacity = 0.35;
        visual.bodyMaterial.opacity = 0.5;
        continue;
      }

      if (gate.state === 'PASSED') {
        const fade = 1 - gate.collapse;
        // Player action overrides music momentarily on success.
        visual.trimMaterial.emissiveIntensity = idle + accent + gate.flash * 3.2;
        visual.trimMaterial.opacity = fade;
        visual.bodyMaterial.opacity = fade;
        const s = reduceMotion ? 1 : 1 - gate.collapse * 0.75;
        visual.group.scale.set(s, s, s);
      } else {
        visual.trimMaterial.emissiveIntensity = idle + accent + gate.flash * 2.0;
        visual.trimMaterial.opacity = 1;
        visual.bodyMaterial.opacity = 1;
        visual.group.scale.set(1, 1, 1);
      }
    }

    // Shared crossing ripple.
    if (this.rippleTime >= 0) {
      this.rippleTime += dt;
      const life = 0.5;
      if (this.rippleTime >= life) {
        this.rippleTime = -1;
        this.rippleMesh.visible = false;
        this.rippleMaterial.opacity = 0;
      } else {
        const p = this.rippleTime / life;
        const s = 1 + p * 9;
        this.rippleMesh.scale.set(s, s, s);
        this.rippleMaterial.opacity = (1 - p) * 0.5;
      }
    }
  }

  public dispose(): void {
    this.bodyGeometry.dispose();
    for (const visual of this.visuals) {
      visual.bodyMaterial.dispose();
      visual.trimMaterial.dispose();
    }
    this.visuals = [];
    this.rippleMesh.geometry.dispose();
    this.rippleMaterial.dispose();
    for (const m of this.debugMaterials) m.dispose();
    for (const g of this.debugGeometries) g.dispose();
    this.debugMaterials = [];
    this.debugGeometries = [];
  }
}
