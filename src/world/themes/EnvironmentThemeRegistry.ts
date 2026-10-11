/**
 * Which official tracks use a non-city environment.
 *
 * Assignment is EXPLICIT and keyed by the trusted catalog id only. Every track
 * not listed here — and all custom audio, the tutorial and the lab — resolves
 * to null, which means "the existing city, exactly as before".
 *
 * To add an environment: implement EnvironmentThemeDefinition, then list the
 * track ids that use it here. Nothing else in the game needs to know.
 */

import { EnvironmentThemeDefinition } from './EnvironmentTheme';
import { MIDNIGHT_MOUNTAINS_THEME } from './midnight/MidnightMountainsTheme';

const THEME_BY_TRACK_ID: Record<string, EnvironmentThemeDefinition> = {
  // GRAVITY LINE: quiet low opening, one sustained bass-heavy peak, a long
  // falling breakdown and a fade — the shape of a night crossing.
  track_5_gravity_line: MIDNIGHT_MOUNTAINS_THEME
};

export function resolveEnvironmentTheme(
  officialTrackId: string | null | undefined
): EnvironmentThemeDefinition | null {
  if (!officialTrackId) return null;
  return Object.prototype.hasOwnProperty.call(THEME_BY_TRACK_ID, officialTrackId)
    ? THEME_BY_TRACK_ID[officialTrackId]
    : null;
}

export function themedTrackIds(): string[] {
  return Object.keys(THEME_BY_TRACK_ID);
}
