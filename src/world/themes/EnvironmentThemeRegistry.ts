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
import { MIDNIGHT_HARBOUR_THEME } from './harbour/MidnightHarbourTheme';
import { ORBITAL_STATION_THEME } from './orbital/OrbitalStationTheme';

const THEME_BY_TRACK_ID: Record<string, EnvironmentThemeDefinition> = {
  // GRAVITY LINE: quiet low opening, one sustained bass-heavy peak, a long
  // falling breakdown and a fade — the shape of a night crossing.
  track_5_gravity_line: MIDNIGHT_MOUNTAINS_THEME,
  // SURF THE VOID: near-silence, then the beat arrives all at once and holds —
  // a sheltered bay that opens onto the whole planet.
  track_3_surf_the_void: ORBITAL_STATION_THEME,
  // KZ ASCENT: the pack's industrial track. Near-silent opening, a slow
  // mechanical build, one late peak and a quiet close: a night shift in port.
  track_14_kz_ascent: MIDNIGHT_HARBOUR_THEME
};

/** The default map: the city. Not a theme; it is what "no theme" means. */
export const CITY_MAP_KEY = 'CITY';

export interface EnvironmentMapEntry {
  /** CITY_MAP_KEY or an EnvironmentThemeId. */
  key: string;
  name: string;
  /** Thumbnail shown by the map picker (served from public/assets). */
  thumbnail: string;
  /** Wide image shown behind the run report. */
  backdrop: string;
}

/** Every map a player can choose for a run, in picker order. */
export const ENVIRONMENT_MAPS: EnvironmentMapEntry[] = [
  { key: CITY_MAP_KEY, name: 'SIGNAL CITY', thumbnail: '/assets/maps/signal-city.jpg', backdrop: '/assets/maps/signal-city-wide.jpg' },
  { key: MIDNIGHT_MOUNTAINS_THEME.id, name: MIDNIGHT_MOUNTAINS_THEME.displayName, thumbnail: '/assets/maps/midnight-mountains.jpg', backdrop: '/assets/maps/midnight-mountains-wide.jpg' },
  { key: ORBITAL_STATION_THEME.id, name: ORBITAL_STATION_THEME.displayName, thumbnail: '/assets/maps/orbital-station.jpg', backdrop: '/assets/maps/orbital-station-wide.jpg' },
  { key: MIDNIGHT_HARBOUR_THEME.id, name: MIDNIGHT_HARBOUR_THEME.displayName, thumbnail: '/assets/maps/midnight-harbour.jpg', backdrop: '/assets/maps/midnight-harbour-wide.jpg' }
];

const THEME_BY_MAP_KEY: Record<string, EnvironmentThemeDefinition> = {
  [MIDNIGHT_MOUNTAINS_THEME.id]: MIDNIGHT_MOUNTAINS_THEME,
  [ORBITAL_STATION_THEME.id]: ORBITAL_STATION_THEME,
  [MIDNIGHT_HARBOUR_THEME.id]: MIDNIGHT_HARBOUR_THEME
};

/**
 * Resolves an environment key to a theme, or null for the city.
 *
 * The key is either a trusted catalog track id (the song's own assignment) or
 * a map key from ENVIRONMENT_MAPS (the player's pick in the map picker). A map
 * is purely visual, so any map may be used with any course.
 */
export function resolveEnvironmentTheme(
  key: string | null | undefined
): EnvironmentThemeDefinition | null {
  if (!key || key === CITY_MAP_KEY) return null;
  if (Object.prototype.hasOwnProperty.call(THEME_BY_MAP_KEY, key)) return THEME_BY_MAP_KEY[key];
  return Object.prototype.hasOwnProperty.call(THEME_BY_TRACK_ID, key) ? THEME_BY_TRACK_ID[key] : null;
}

export function themedTrackIds(): string[] {
  return Object.keys(THEME_BY_TRACK_ID);
}
