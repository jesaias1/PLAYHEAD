import type { LessonId } from './MovementAcademyProgress';
export interface MoveSample {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number; yaw: number;
  grounded: boolean; airborne: boolean; surfing: boolean; speedUnits: number;
  keys: { forward: boolean; backward: boolean; left: boolean; right: boolean };
  surfControl?: boolean;
}
export interface Observation {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  yaw: number; grounded: boolean; surfing: boolean; voidCrossed: boolean;
  speedUnits: number; totalSpeedUnits: number; yawRate: number;
  keys: MoveSample['keys']; wasGrounded: boolean; wasAirborne: boolean; exitSpeedUnits: number;
}

/** Reads real fixed ticks only. Evidence is cleared by every retry/spawn. */
export class MovementAcademyObserver {
  private prevGrounded = true;
  private prevSurfing = false;
  private prevYaw = Number.NaN;
  private flight = false;
  private flightTicks = 0;
  private flightSpeed = 0;
  private coordinatedTicks = 0;
  private coordinatedTurn = 0;
  private pendingLandingSpeed = 0;
  private groundedTicks = 0;
  private surfTicks = 0;
  private surfControlTicks = 0;
  private surfContactProven = false;
  private jump = false;
  private strafe = false;
  private surfExit = false;
  private looked = false;
  private bhops = 0;

  reset(): void {
    this.prevGrounded = true; this.prevSurfing = false; this.prevYaw = Number.NaN;
    this.flight = false; this.flightTicks = 0; this.flightSpeed = 0;
    this.coordinatedTicks = 0; this.coordinatedTurn = 0;
    this.pendingLandingSpeed = 0; this.groundedTicks = 0; this.surfTicks = 0;
    this.surfControlTicks = 0;
    this.surfContactProven = false; this.jump = false; this.strafe = false;
    this.surfExit = false; this.looked = false; this.bhops = 0;
  }

  sample(s: MoveSample): void {
    const raw = Number.isNaN(this.prevYaw) ? 0 : s.yaw - this.prevYaw;
    const turn = Math.atan2(Math.sin(raw), Math.cos(raw));
    this.prevYaw = s.yaw;
    if (Math.abs(turn) >= 0.002) this.looked = true;

    // A jump requires an upward launch, never merely walking off an edge.
    if (!s.grounded && !s.surfing && this.prevGrounded && s.vy > 1) {
      if (this.pendingLandingSpeed > 80 && this.groundedTicks <= 12 &&
          s.speedUnits >= this.pendingLandingSpeed * 0.75) this.bhops++;
      this.pendingLandingSpeed = 0;
      this.flight = true; this.flightTicks = 0; this.flightSpeed = s.speedUnits;
      this.coordinatedTicks = 0; this.coordinatedTurn = 0;
    }
    if (this.flight && s.airborne) {
      this.flightTicks++;
      const smooth = Math.abs(turn) >= 0.001 && Math.abs(turn) <= 0.05;
      const matched = (turn > 0 && s.keys.left && !s.keys.right) ||
        (turn < 0 && s.keys.right && !s.keys.left);
      if (smooth && matched) {
        this.coordinatedTicks++;
        this.coordinatedTurn += Math.abs(turn);
      }
    }
    if (this.flight && (s.grounded || s.surfing)) {
      if (this.flightTicks >= 6) {
        this.jump = true;
        if (this.coordinatedTicks >= 3 && this.coordinatedTurn >= 0.1 &&
            s.speedUnits >= this.flightSpeed * 0.65) this.strafe = true;
        if (s.grounded) {
          this.pendingLandingSpeed = s.speedUnits;
          this.groundedTicks = 0;
        }
      }
      this.flight = false;
    }
    if (s.grounded) this.groundedTicks++;
    else if (!this.flight) this.pendingLandingSpeed = 0;

    if (s.surfing) {
      this.surfTicks++;
      if (s.surfControl) this.surfControlTicks++;
      if (this.surfTicks >= 10 && this.surfControlTicks >= 3) this.surfContactProven = true;
    } else {
      if (this.prevSurfing && this.surfContactProven && s.speedUnits >= 80) this.surfExit = true;
      this.surfTicks = 0;
      this.surfControlTicks = 0;
    }
    this.prevGrounded = s.grounded;
    this.prevSurfing = s.surfing;
  }

  get hasJump(): boolean { return this.jump; }
  get hasAirStrafe(): boolean { return this.strafe; }
  get hasBhop(): boolean { return this.bhops >= 2 && this.strafe; }
  get hasSurf(): boolean { return this.surfExit; }
  get hasFlow(): boolean { return this.hasBhop && this.hasSurf; }
  get bhopCount(): number { return this.bhops; }
  hasActionEvidence(id: LessonId): boolean {
    switch (id) {
      case 'MOVEMENT': return this.jump && this.looked;
      case 'AIR_STRAFE': return this.strafe;
      case 'BHOP': return this.hasBhop;
      case 'SURF': return this.hasSurf;
      case 'FLOW': return this.hasFlow;
    }
  }
  diagnose(): string {
    return `jump=${this.jump} look=${this.looked} strafe=${this.strafe} bhop=${this.bhops} surf=${this.surfExit} contact=${this.surfTicks}`;
  }
}

/** Spatial target is necessary but never sufficient without observed skills. */
export function evaluateLessonGoal(id: LessonId,
  anchor: { goalMinZ: number; reversed?: boolean; goalX?: number; goalRadius?: number; goalY?: number; minSpeedUnits: number },
  o: Observation, observer: MovementAcademyObserver): boolean {
  if (o.voidCrossed || !o.grounded || (anchor.goalY !== undefined && o.position.y <= anchor.goalY)) return false;
  if (anchor.reversed ? o.position.z > anchor.goalMinZ : o.position.z < anchor.goalMinZ) return false;
  if (anchor.goalX !== undefined && Math.abs(o.position.x - anchor.goalX) > (anchor.goalRadius ?? 8)) return false;
  return observer.hasActionEvidence(id) && o.speedUnits >= anchor.minSpeedUnits;
}
