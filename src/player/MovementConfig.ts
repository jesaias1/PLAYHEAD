/**
 * Movement configuration parameters tuned for Quake/Source-style air-strafing and surfing
 */

export interface MovementConfig {
  gravity: number;             // m/s^2
  jumpVelocity: number;        // Initial vertical jump impulse (m/s)

  groundAcceleration: number;  // Ground acceleration rate (s^-1)
  airAcceleration: number;     // Air strafe acceleration rate (Source/Quake style)

  maxGroundWishSpeed: number;  // Normal running speed cap (m/s)
  maxAirWishSpeed: number;     // Air wish speed limit (m/s)
  supplementalAirSteer: number;// Rate of horizontal velocity redirection toward wishDir (rad/s, preserves speed)

  friction: number;            // Ground friction coefficient (s^-1)
  stopSpeed: number;           // Velocity threshold below which friction acts strongly

  coyoteTime: number;          // Seconds after leaving edge where jump is still permitted
  jumpBufferTime: number;      // Seconds before landing where jump input is queued

  playerHeight: number;        // Collider total height (m)
  playerRadius: number;        // Collider radius (m)
  eyeHeight: number;           // Camera height offset from player base (m)

  speedUnitScale: number;      // Multiplier to convert m/s to game display units (u/s)
}

/**
 * Human-approved movement baseline.
 * Do not retune without explicit request.
 */
export const PLAYHEAD_MOVEMENT_V1: MovementConfig = {
  gravity: 24.0,
  jumpVelocity: 8.8,
  groundAcceleration: 10.0,
  airAcceleration: 90.0,
  maxGroundWishSpeed: 14.0,
  maxAirWishSpeed: 3.0,
  supplementalAirSteer: 3.5,
  friction: 4.5,
  stopSpeed: 3.0,
  coyoteTime: 0.12,
  jumpBufferTime: 0.15,
  playerHeight: 1.8,
  playerRadius: 0.5,
  eyeHeight: 1.62,
  speedUnitScale: 40.0
};

/**
 * Archived experimental movement from September 2026 pass.
 * Retained for reference/comparison only. Never used as default.
 */
export const PLAYHEAD_EXPERIMENTAL_2026_09: MovementConfig = {
  gravity: 24.0,
  jumpVelocity: 8.8,
  groundAcceleration: 16.0,
  airAcceleration: 75.0,
  maxGroundWishSpeed: 14.0,
  maxAirWishSpeed: 3.2,
  supplementalAirSteer: 2.75,
  friction: 5.5,
  stopSpeed: 3.0,
  coyoteTime: 0.12,
  jumpBufferTime: 0.15,
  playerHeight: 1.8,
  playerRadius: 0.5,
  eyeHeight: 1.62,
  speedUnitScale: 40.0
};

export type MovementPresetName = 'CURRENT' | 'SOURCE' | 'PLAYHEAD' | 'TRACK_RUN';

export const MOVEMENT_PRESETS: Record<MovementPresetName, MovementConfig> = {
  CURRENT: { ...PLAYHEAD_MOVEMENT_V1 },
  SOURCE: {
    // Pure classic Source engine values preserved as human reference
    gravity: 24.0,
    jumpVelocity: 8.8,
    groundAcceleration: 14.0,
    airAcceleration: 120.0,
    maxGroundWishSpeed: 14.0,
    maxAirWishSpeed: 2.5,
    supplementalAirSteer: 0.0,
    friction: 5.5,
    stopSpeed: 3.0,
    coyoteTime: 0.12,
    jumpBufferTime: 0.15,
    playerHeight: 1.8,
    playerRadius: 0.5,
    eyeHeight: 1.62,
    speedUnitScale: 40.0
  },
  PLAYHEAD: { ...PLAYHEAD_MOVEMENT_V1 },
  TRACK_RUN: { ...PLAYHEAD_MOVEMENT_V1 }
};

export const DEFAULT_MOVEMENT_CONFIG: MovementConfig = PLAYHEAD_MOVEMENT_V1;
