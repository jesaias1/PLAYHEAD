/**
 * SIGNAL GATES — optional high-speed movement-mastery lines.
 *
 * A Signal Gate is a floating brutalist frame on a natural high-speed line.
 * The player activates it by MOVING THROUGH IT. Passing or missing a gate
 * never changes physics, timing, ranks, rewards or the route.
 *
 * This module is pure and testable: swept crossing detection and sequence
 * state only. Rendering and presentation live in SignalGateRenderer /
 * SignalGateSystem.
 */

import { Vector3Like } from '../generation/GenerationTypes';

export type GateState = 'PENDING' | 'PASSED' | 'MISSED';

export interface SignalGateDefinition {
  id: string;
  /** Aperture centre in world space. */
  position: Vector3Like;
  /** Gate facing yaw. Intended travel direction is the gate's forward axis. */
  yaw: number;
  /** Aperture width (across the intended direction). */
  width: number;
  /** Aperture height. */
  height: number;
  /** Order within its sequence (0-based). */
  sequenceIndex: number;
}

export interface SignalGateRuntime extends SignalGateDefinition {
  state: GateState;
  /** Intended travel direction (unit, horizontal). */
  forwardX: number;
  forwardZ: number;
  /** Lateral axis of the aperture (unit, horizontal). */
  rightX: number;
  rightZ: number;
  /** 0..1 presentation collapse progress after a pass. */
  collapse: number;
  /** 0..1 presentation flash (decays). */
  flash: number;
}

export interface GateCrossingResult {
  kind: 'PASS' | 'MISS';
  /** Fraction along the swept segment where the gate plane was crossed. */
  t: number;
  /** Aperture-local offset at the crossing point (metres). */
  localX: number;
  localY: number;
  /** Horizontal speed through the gate, display units. */
  speedUnits: number;
  /** Trajectory alignment with the intended direction, 0..1. */
  alignment: number;
  /** Normalised centre error, 0 (dead centre) .. 1 (edge). */
  centerError: number;
}

export interface GateCrossingInput {
  prevX: number;
  prevY: number;
  prevZ: number;
  curX: number;
  curY: number;
  curZ: number;
  /** Horizontal speed in display units (m/s * speedUnitScale). */
  speedUnits: number;
}

/** Build the runtime orientation axes for a definition. */
export function makeGateRuntime(def: SignalGateDefinition): SignalGateRuntime {
  const forwardX = Math.sin(def.yaw);
  const forwardZ = Math.cos(def.yaw);
  return {
    ...def,
    state: 'PENDING',
    forwardX,
    forwardZ,
    // Camera-style right vector for this yaw.
    rightX: Math.cos(def.yaw),
    rightZ: -Math.sin(def.yaw),
    collapse: 0,
    flash: 0
  };
}

/**
 * Swept gate-plane crossing.
 *
 * Uses the fixed-step PREVIOUS -> CURRENT player segment, so a player moving
 * fast enough to jump the entire aperture between two samples still registers
 * correctly. Returns null (without allocating) when there is no forward plane
 * crossing.
 */
export function detectGateCrossing(
  gate: SignalGateRuntime,
  input: GateCrossingInput
): GateCrossingResult | null {
  const px = input.prevX - gate.position.x;
  const pz = input.prevZ - gate.position.z;
  const cx = input.curX - gate.position.x;
  const cz = input.curZ - gate.position.z;

  // Signed distance along the intended travel direction.
  const d0 = px * gate.forwardX + pz * gate.forwardZ;
  const d1 = cx * gate.forwardX + cz * gate.forwardZ;

  // Must cross the plane in the INTENDED direction. A backwards approach
  // (d0 > 0, d1 < 0) never triggers.
  if (d0 > 0.0001 || d1 <= 0) return null;

  const denom = d0 - d1;
  const t = Math.abs(denom) > 1e-9 ? Math.max(0, Math.min(1, d0 / denom)) : 0;

  const hitX = input.prevX + (input.curX - input.prevX) * t;
  const hitY = input.prevY + (input.curY - input.prevY) * t;
  const hitZ = input.prevZ + (input.curZ - input.prevZ) * t;

  const localX = (hitX - gate.position.x) * gate.rightX + (hitZ - gate.position.z) * gate.rightZ;
  const localY = hitY - gate.position.y;

  const halfW = gate.width * 0.5;
  const halfH = gate.height * 0.5;
  const inAperture = Math.abs(localX) <= halfW && Math.abs(localY) <= halfH;

  // Horizontal trajectory alignment with the intended direction.
  const vx = input.curX - input.prevX;
  const vz = input.curZ - input.prevZ;
  const vLen = Math.hypot(vx, vz);
  const alignment = vLen > 1e-6
    ? Math.max(0, Math.min(1, (vx * gate.forwardX + vz * gate.forwardZ) / vLen))
    : 0;

  const centerError = Math.min(1, Math.max(
    Math.abs(localX) / Math.max(0.001, halfW),
    Math.abs(localY) / Math.max(0.001, halfH)
  ));

  return {
    kind: inAperture ? 'PASS' : 'MISS',
    t,
    localX,
    localY,
    speedUnits: input.speedUnits,
    alignment,
    centerError
  };
}

/**
 * Ordered mastery chain. Passing advances the sequence; missing marks the
 * chain incomplete without punishing the run.
 */
export class SignalGateSequence {
  public gates: SignalGateRuntime[];
  public nextIndex = 0;
  public incomplete = false;
  public complete = false;
  public lastResult: { gateIndex: number; result: GateCrossingResult } | null = null;

  public onCrossing?: (gateIndex: number, total: number, result: GateCrossingResult) => void;
  public onComplete?: (total: number) => void;

  constructor(definitions: SignalGateDefinition[]) {
    this.gates = definitions
      .slice()
      .sort((a, b) => a.sequenceIndex - b.sequenceIndex)
      .map(makeGateRuntime);
  }

  public reset(): void {
    this.nextIndex = 0;
    this.incomplete = false;
    this.complete = false;
    this.lastResult = null;
    for (const gate of this.gates) {
      gate.state = 'PENDING';
      gate.collapse = 0;
      gate.flash = 0;
    }
  }

  public get passedCount(): number {
    let n = 0;
    for (const gate of this.gates) {
      if (gate.state === 'PASSED') n++;
    }
    return n;
  }

  /**
   * Advances the chain for one fixed step. `prevY`/`curY` should be the player
   * capsule CENTRE so the aperture is measured around the body.
   */
  public update(input: GateCrossingInput): void {
    for (let i = 0; i < this.gates.length; i++) {
      const gate = this.gates[i];
      if (gate.state !== 'PENDING') continue;

      const result = detectGateCrossing(gate, input);
      if (!result) continue;

      this.lastResult = { gateIndex: i, result };

      if (result.kind === 'MISS') {
        gate.state = 'MISSED';
        this.incomplete = true;
        continue;
      }

      gate.state = 'PASSED';
      gate.flash = 1;
      if (i === this.nextIndex) {
        this.nextIndex++;
      } else {
        // Passed out of order: the chain is incomplete, but nothing is punished.
        this.incomplete = true;
      }
      this.onCrossing?.(i, this.gates.length, result);

      if (!this.complete && !this.incomplete && this.nextIndex >= this.gates.length) {
        this.complete = true;
        this.onComplete?.(this.gates.length);
      }
    }
  }
}
