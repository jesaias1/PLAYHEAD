import { Vector3Like } from '../generation/GenerationTypes';

export const FINISH_GATE_HEIGHT = 24;

export interface FinishGateVolume {
  position: Vector3Like;
  yaw: number;
  width: number;
  height?: number;
}

/** Continuous segment/plane finish detection, latched after the first hit. */
export class FinishGateDetector {
  private previous: Vector3Like | null = null;
  private completed = false;

  public reset(position?: Vector3Like): void {
    this.previous = position ? { ...position } : null;
    this.completed = false;
  }

  /** Re-seed motion history after an authoritative teleport without re-arming. */
  public resetMotion(position: Vector3Like): void {
    this.previous = { ...position };
  }

  public sample(
    position: Vector3Like,
    gate: FinishGateVolume,
    playerHeight: number,
    playerRadius = 0.0
  ): boolean {
    if (this.completed) return false;
    if (!this.previous) {
      this.previous = { ...position };
      return false;
    }

    const hit = segmentCrossesFinishGate(this.previous, position, gate, playerHeight, playerRadius);
    this.previous = { ...position };
    if (hit) this.completed = true;
    return hit;
  }
}

export function segmentCrossesFinishGate(
  previous: Vector3Like,
  current: Vector3Like,
  gate: FinishGateVolume,
  playerHeight: number,
  playerRadius = 0.0
): boolean {
  const a = toGateLocal(previous, gate);
  const b = toGateLocal(current, gate);
  const dz = b.z - a.z;
  const planeTolerance = Math.max(0.08, playerRadius * 0.35);

  let t: number;
  if (Math.abs(dz) < 1e-8) {
    if (Math.min(Math.abs(a.z), Math.abs(b.z)) > planeTolerance) return false;
    t = Math.abs(a.z) <= Math.abs(b.z) ? 0 : 1;
  } else {
    t = -a.z / dz;
    if (t < 0 || t > 1) return false;
  }

  const x = a.x + (b.x - a.x) * t;
  const halfWidth = gate.width * 0.5 + playerRadius;
  if (Math.abs(x) > halfWidth) return false;

  const feetY = previous.y + (current.y - previous.y) * t;
  const gateMinY = gate.position.y - (playerRadius > 0 ? 0.4 : 0);
  const gateMaxY = gate.position.y + (gate.height ?? FINISH_GATE_HEIGHT) + (playerRadius > 0 ? 0.4 : 0);
  return feetY <= gateMaxY && feetY + playerHeight >= gateMinY;
}

function toGateLocal(point: Vector3Like, gate: FinishGateVolume): { x: number; z: number } {
  const dx = point.x - gate.position.x;
  const dz = point.z - gate.position.z;
  const sin = Math.sin(gate.yaw);
  const cos = Math.cos(gate.yaw);
  return {
    x: cos * dx - sin * dz,
    z: sin * dx + cos * dz
  };
}
