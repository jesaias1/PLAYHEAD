import { PLAYHEAD_MOVEMENT_V1 } from '../player/MovementConfig';
import { AscentVariant } from './GenerationTypes';

export interface AscentLandingEnvelope {
  expectedSpeed: number;
  width: number;
  depth: number;
  exitWidth: number;
  exitLateralOffset: number;
  minimumApproach: number;
  postLandingRunway: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/**
 * Conservative geometry envelope derived from the frozen jump impulse, gravity,
 * player radius, and representative 800–1280 u/s ascent entry speeds.
 */
export function deriveAscentLandingEnvelope(
  estimatedSpeed: number,
  minimumExpectedSpeed: number,
  rise: number,
  isCatch: boolean,
  variant: AscentVariant,
  curveDirection: -1 | 1
): AscentLandingEnvelope {
  const expectedSpeed = clamp(Math.max(estimatedSpeed, minimumExpectedSpeed), 20, 32);
  const movement = PLAYHEAD_MOVEMENT_V1;
  const clearanceHeight = Math.max(0, rise) + movement.playerRadius * 0.7;
  const discriminant = Math.max(
    0,
    movement.jumpVelocity * movement.jumpVelocity - 2 * movement.gravity * clearanceHeight
  );
  const timeToClear = (movement.jumpVelocity - Math.sqrt(discriminant)) / movement.gravity;
  const minimumApproach = clamp(
    expectedSpeed * timeToClear + movement.playerRadius * 2 + 1.5,
    5.0,
    14.0
  );

  const speedSurplus = expectedSpeed - 20;
  // Keep each step visibly distinct. Speed expands the useful landing envelope,
  // but the outside wing carries most of that extra catch area instead of the
  // entire platform becoming a huge rectangle.
  const width = 13.0 + speedSurplus * 0.18 + (isCatch ? 3.5 : 0);
  const depth = 16.0 + expectedSpeed * 0.36 + (isCatch ? 6.0 + expectedSpeed * 0.06 : 0);
  const flareRatio = variant === 'FLARED_ASCENT'
    ? 1.46
    : variant === 'OFFSET_ASCENT'
      ? 1.4
      : 1.36;
  const exitWidth = width * flareRatio;
  const exitLateralOffset = curveDirection * (exitWidth - width) * 0.42;
  const postLandingRunway = depth * (isCatch ? 0.68 : 0.58);

  return {
    expectedSpeed,
    width,
    depth,
    exitWidth,
    exitLateralOffset,
    minimumApproach,
    postLandingRunway
  };
}

export function getAscentTurnRadians(
  variant: AscentVariant,
  stepIndex: number,
  stepCount: number
): number {
  const base = variant === 'OFFSET_ASCENT'
    ? 0.21
    : variant === 'FLOW_STAIR'
      ? 0.18
      : variant === 'FLARED_ASCENT'
        ? 0.16
        : 0.145;
  if (stepIndex === stepCount - 1) return base * 0.58;
  if (stepIndex === 0) return base * 0.84;
  return base;
}
