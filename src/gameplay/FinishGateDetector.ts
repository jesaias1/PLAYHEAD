import { Vector3Like } from '../generation/GenerationTypes';

export const FINISH_GATE_HEIGHT = 24;

export interface FinishGateVolume {
  position: Vector3Like;
  yaw: number;
  width: number;
  height?: number;
}

export interface FinishGateCrossing {
  hit: boolean;
  /** Exact intersection fraction along the swept segment, in [0, 1]. */
  t: number;
  /** World-space contact position at fraction t. */
  contactPosition: Vector3Like;
}

/** Continuous segment/plane finish detection, latched after the first hit. */
export class FinishGateDetector {
  private previous: Vector3Like | null = null;
  private completed = false;
  private lastCrossing: FinishGateCrossing | null = null;

  public reset(position?: Vector3Like): void {
    this.previous = position ? { ...position } : null;
    this.completed = false;
    this.lastCrossing = null;
  }

  /** Re-seed motion history after an authoritative teleport without re-arming. */
  public resetMotion(position: Vector3Like): void {
    this.previous = { ...position };
  }

  public getLastCrossing(): FinishGateCrossing | null {
    return this.lastCrossing;
  }

  public sampleDetailed(
    position: Vector3Like,
    gate: FinishGateVolume,
    playerHeight: number,
    playerRadius = 0.0
  ): FinishGateCrossing | null {
    if (this.completed) return null;
    if (!this.previous) {
      this.previous = { ...position };
      return null;
    }

    const crossing = getSegmentFinishGateCrossing(
      this.previous,
      position,
      gate,
      playerHeight,
      playerRadius
    );
    this.previous = { ...position };
    if (crossing && crossing.hit) {
      this.completed = true;
      this.lastCrossing = crossing;
      return crossing;
    }
    return null;
  }

  public sample(
    position: Vector3Like,
    gate: FinishGateVolume,
    playerHeight: number,
    playerRadius = 0.0
  ): boolean {
    return this.sampleDetailed(position, gate, playerHeight, playerRadius) !== null;
  }
}

export function segmentCrossesFinishGate(
  previous: Vector3Like,
  current: Vector3Like,
  gate: FinishGateVolume,
  playerHeight: number,
  playerRadius = 0.0
): boolean {
  const crossing = getSegmentFinishGateCrossing(previous, current, gate, playerHeight, playerRadius);
  return crossing !== null && crossing.hit;
}

export function getSegmentFinishGateCrossing(
  previous: Vector3Like,
  current: Vector3Like,
  gate: FinishGateVolume,
  playerHeight: number,
  playerRadius = 0.0
): FinishGateCrossing | null {
  const a = toGateLocal(previous, gate);
  const b = toGateLocal(current, gate);
  const dz = b.z - a.z;
  const dx = b.x - a.x;
  const dy = current.y - previous.y;

  const halfWidth = gate.width * 0.5 + playerRadius;
  const gateMinY = gate.position.y - (playerRadius > 0 ? 0.4 : 0);
  const gateMaxY = gate.position.y + (gate.height ?? FINISH_GATE_HEIGHT) + (playerRadius > 0 ? 0.4 : 0);

  // Slab intersection along Z
  let tMinZ: number;
  let tMaxZ: number;
  if (Math.abs(dz) < 1e-8) {
    const zTol = Math.max(0.08, playerRadius);
    if (Math.abs(a.z) > zTol) return null;
    tMinZ = 0;
    tMaxZ = 1;
  } else if (playerRadius <= 0) {
    // Exact zero-thickness plane crossing for point particle
    const tPlane = -a.z / dz;
    if (tPlane < 0 || tPlane > 1) return null;
    tMinZ = tPlane;
    tMaxZ = tPlane;
  } else {
    // First contact when player bounding volume touches gate plane
    const t1 = (-playerRadius - a.z) / dz;
    const t2 = (playerRadius - a.z) / dz;
    tMinZ = Math.min(t1, t2);
    tMaxZ = Math.max(t1, t2);
  }

  // Slab intersection along X
  let tMinX: number;
  let tMaxX: number;
  if (Math.abs(dx) < 1e-8) {
    if (Math.abs(a.x) > halfWidth) return null;
    tMinX = 0;
    tMaxX = 1;
  } else {
    const t1 = (-halfWidth - a.x) / dx;
    const t2 = (halfWidth - a.x) / dx;
    tMinX = Math.min(t1, t2);
    tMaxX = Math.max(t1, t2);
  }

  // Slab intersection along Y
  const minY = gateMinY - playerHeight;
  const maxY = gateMaxY;
  let tMinY: number;
  let tMaxY: number;
  if (Math.abs(dy) < 1e-8) {
    if (previous.y < minY || previous.y > maxY) return null;
    tMinY = 0;
    tMaxY = 1;
  } else {
    const t1 = (minY - previous.y) / dy;
    const t2 = (maxY - previous.y) / dy;
    tMinY = Math.min(t1, t2);
    tMaxY = Math.max(t1, t2);
  }

  const enter = Math.max(0, tMinZ, tMinX, tMinY);
  const leave = Math.min(1, tMaxZ, tMaxX, tMaxY);

  if (enter > leave) return null;

  const t = Math.max(0, Math.min(1, enter));
  const contactPosition: Vector3Like = {
    x: previous.x + (current.x - previous.x) * t,
    y: previous.y + (current.y - previous.y) * t,
    z: previous.z + (current.z - previous.z) * t
  };

  return {
    hit: true,
    t,
    contactPosition
  };
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
