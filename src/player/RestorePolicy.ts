/**
 * PLAYHEAD — Restore / death decision policy
 *
 * A single, authoritative, side-effect-free decision function that answers:
 * "should the player be restored right now, and for what reason?"
 *
 * DESIGN RULES (these are gameplay rules, not tuning knobs):
 *
 * 1. NORMAL void death is ONLY a world-boundary crossing: `y < VOID_DEATH_Y`.
 *    Nothing else may kill the player. In particular NONE of the following may
 *    ever trigger a restore on their own:
 *      - being airborne for a long time
 *      - travelling very fast or very far horizontally
 *      - being far from the nearest platform
 *      - skipping platforms / being ahead of route progression
 *      - missing ground contact
 *      - being above open void
 *      - being below the CURRENT platform while still above the true void plane
 *      - making a jump much longer than the generator expected
 *    Expert players must be able to make absurdly long high-speed transfers.
 *
 * 2. EMERGENCY recovery is a SEPARATE concern and only handles numerically
 *    broken state (NaN / infinite / absurd coordinates). It must never act as
 *    a gameplay kill zone.
 *
 * Keeping this pure means the rules can be tested directly against real
 * decision logic rather than against constants.
 */

export enum RestoreReason {
  /** Player fell below the authoritative world void boundary. */
  NORMAL_VOID = 'NORMAL_VOID',
  /** Position/velocity became numerically invalid (NaN, infinite, absurd). */
  INVALID_NUMERIC_STATE = 'INVALID_NUMERIC_STATE',
  /** Displacement beyond any plausible world bounds — corrupt physics state. */
  EMERGENCY_OUT_OF_BOUNDS = 'EMERGENCY_OUT_OF_BOUNDS',
  /** Player-initiated restore. */
  MANUAL_RESTORE = 'MANUAL_RESTORE',
  /** Diagnostics only — never produced by the policy itself. */
  OTHER = 'OTHER'
}

export interface PlayerNumericState {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
}

/**
 * Absolute plausibility bound, in metres, for a single coordinate.
 *
 * Deliberately enormous: it exists to catch corrupted numeric state, not to
 * restrain gameplay. Long routes and extreme high-speed flight stay far inside
 * this, so a legitimate absurd transfer can never reach it.
 */
export const EMERGENCY_COORD_LIMIT = 1_000_000;

export const isFiniteVec3 = (v: { x: number; y: number; z: number }): boolean =>
  Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/**
 * True when the numeric state is broken and should route to emergency recovery.
 */
export function hasInvalidNumericState(state: PlayerNumericState): boolean {
  if (!isFiniteVec3(state.position) || !isFiniteVec3(state.velocity)) return true;

  const { x, y, z } = state.position;
  if (
    Math.abs(x) > EMERGENCY_COORD_LIMIT ||
    Math.abs(y) > EMERGENCY_COORD_LIMIT ||
    Math.abs(z) > EMERGENCY_COORD_LIMIT
  ) {
    return true;
  }

  const { x: vx, y: vy, z: vz } = state.velocity;
  if (
    Math.abs(vx) > EMERGENCY_COORD_LIMIT ||
    Math.abs(vy) > EMERGENCY_COORD_LIMIT ||
    Math.abs(vz) > EMERGENCY_COORD_LIMIT
  ) {
    return true;
  }

  return false;
}

/**
 * THE authoritative restore decision.
 *
 * @param state       current numeric player state
 * @param voidDeathY  authoritative world void boundary (final geometry − margin).
 *                    Pass `null` only when no route geometry exists yet.
 * @returns the reason to restore, or `null` to let the player keep playing.
 *
 * Precedence: numeric corruption outranks the boundary check, because a NaN
 * position cannot be meaningfully compared against a boundary.
 */
export function decideRestore(
  state: PlayerNumericState,
  voidDeathY: number | null
): RestoreReason | null {
  if (hasInvalidNumericState(state)) {
    if (
      Number.isFinite(state.position.x) &&
      Number.isFinite(state.position.y) &&
      Number.isFinite(state.position.z) &&
      (Math.abs(state.position.x) > EMERGENCY_COORD_LIMIT ||
        Math.abs(state.position.y) > EMERGENCY_COORD_LIMIT ||
        Math.abs(state.position.z) > EMERGENCY_COORD_LIMIT)
    ) {
      return RestoreReason.EMERGENCY_OUT_OF_BOUNDS;
    }
    return RestoreReason.INVALID_NUMERIC_STATE;
  }

  if (voidDeathY !== null && Number.isFinite(voidDeathY) && state.position.y < voidDeathY) {
    return RestoreReason.NORMAL_VOID;
  }

  return null;
}

/** True for the reasons that represent a genuine world-boundary fall. */
export const isNormalVoidReason = (reason: RestoreReason | null): boolean =>
  reason === RestoreReason.NORMAL_VOID;

/** True for reasons that represent broken state rather than gameplay failure. */
export const isEmergencyReason = (reason: RestoreReason | null): boolean =>
  reason === RestoreReason.INVALID_NUMERIC_STATE ||
  reason === RestoreReason.EMERGENCY_OUT_OF_BOUNDS;