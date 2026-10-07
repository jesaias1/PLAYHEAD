/**
 * Course type identity for PLAYHEAD.
 *
 * PLAYHEAD (default) is the existing mixed-movement experience. SURF is a
 * distinct, surf-dominant course style. The type is an explicit property of a
 * run's identity so cached routes, personal-best ghosts and replay metadata can
 * never mix the two.
 *
 * The PLAYHEAD value is the legacy/default identity: every pre-existing key,
 * fingerprint and stored record stays exactly as it was.
 */

export type CourseType = 'PLAYHEAD' | 'SURF';

export const DEFAULT_COURSE_TYPE: CourseType = 'PLAYHEAD';

export const COURSE_TYPE_LABEL: Record<CourseType, string> = {
  PLAYHEAD: 'PLAYHEAD',
  SURF: 'SURF'
};

/** Bounded, total normalisation: anything that is not explicitly SURF is PLAYHEAD. */
export function normalizeCourseType(value: unknown): CourseType {
  return value === 'SURF' ? 'SURF' : 'PLAYHEAD';
}

export function isSurfCourse(value: unknown): boolean {
  return normalizeCourseType(value) === 'SURF';
}

/**
 * Cache/PB key fragment. PLAYHEAD returns the empty string so all legacy keys
 * are byte-identical; SURF is namespaced so it can never collide with a normal
 * course of the same audio.
 */
export function courseTypeKeySuffix(courseType: CourseType): string {
  return courseType === 'SURF' ? 'surf:' : '';
}

/** Independent identity for the sampled SURF course format. */
/**
 * Independent identity for the sampled SURF course format.
 *
 * 1002: song-length-budgeted multi-phrase surf body (long cruises, trait-driven
 * flick/release transfers), and the menu surf variant entry.
 * 1003: SURF GEOMETRY ONLY — smoother tangent/bank/width continuity (smoothstep
 * cruise/S-curve easing, gentler heading), longer continuous cruises, and
 * forgiving catch decks (short release gap + wider deck) so many-catch courses
 * no longer drop through shallow gaps. No movement, collision or surf equation
 * changed. Bumping this invalidates every older SURF cache entry, PB ghost and
 * replay identity; the normal PLAYHEAD identity is byte-compatible and never
 * changes.
 */
export const SURF_GENERATION_VERSION = 1004;
