/**
 * OFFICIAL TRACK AUTHORING PROFILE
 *
 * The data-driven layer that lets an official Signal Pack track be deliberately
 * curated WITHOUT scattering `if (trackId === ...)` through the generator.
 *
 * DIVISION OF RESPONSIBILITY
 *
 *   Custom Audio  : analysis -> procedural generation -> validation
 *   Signal Pack   : analysis -> procedural foundation -> AUTHORED PROFILE
 *                   -> validation -> precompute
 *
 * The procedural pipeline stays the foundation. A profile expresses INTENT at a
 * high level (movement archetype, density, spectacle) rather than thousands of
 * hand-placed coordinates, so the route builder keeps doing the geometry work.
 *
 * INTENTION IS NOT RENDERING
 *
 * A spectacle says `CELESTIAL_REVEAL`, not "set material brightness to 3.728".
 * That separation is deliberate: a future visual pass can amplify these events
 * without touching authoring data, and this pass can describe WHAT the world
 * should show without deciding HOW the renderer pushes it.
 *
 * Pure: no THREE, no DOM, no storage. Route geometry is only ever READ.
 */

import type { GeneratedTrack, RouteNode } from './GenerationTypes';

// ---------------------------------------------------------------------------
// Content versioning
// ---------------------------------------------------------------------------

/**
 * Version of the authored official content.
 *
 * Bump when an authored profile changes in a way that alters the shipped level
 * (route-affecting fields, rank targets, checkpoint plan). Purely cosmetic
 * metadata changes do not require a bump.
 *
 * This is NOT the app version and NOT `ROUTE_GENERATION_VERSION`. It answers one
 * question: "is the precomputed preset still describing what the profile says?"
 */
export const SIGNAL_PACK_CONTENT_VERSION = 1;

/** Per-profile version. Bumped when that track's authored intent changes. */
export const OFFICIAL_PROFILE_VERSION = 1;

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * A track's movement point of view. §19 is explicit that a track should NOT
 * contain equal quantities of every mechanic — it needs an identity.
 */
export type MovementIdentity =
  | 'FLOW'
  | 'ASCENT'
  | 'AIR'
  | 'SURF'
  | 'PRECISION'
  | 'SPEED'
  | 'RHYTHM'
  | 'VERTICAL'
  | 'TRANSFER'
  | 'HYBRID';

/** Movement phrase vocabulary. Mirrors what the route builder can actually build. */
export type MovementPhrase =
  | 'RUN'
  | 'RHYTHM_HOPS'
  | 'AIR_STRAFE'
  | 'BHOP_CHAIN'
  | 'ASCENT'
  | 'DESCENT'
  | 'LONG_GAP'
  | 'PRECISION_FLOW'
  | 'SURF_ENTRY'
  | 'SURF_BODY'
  | 'SURF_RELEASE'
  | 'SURF_CHAIN'
  | 'SURF_TRANSFER'
  | 'SURF_CANYON'
  | 'RECOVERY'
  | 'BREATHER'
  | 'SPECTACLE_TRAVERSE'
  | 'FINAL_RUN';

/** Primary mechanic a phrase asks the player to use. */
export type PrimaryMechanic = 'RUN' | 'JUMP' | 'AIR_STRAFE' | 'BHOP' | 'SURF' | 'DROP' | 'PRECISION';

export type PhraseDensity = 'SPARSE' | 'MEDIUM' | 'DENSE';

/**
 * Spectacle INTENT. Never a renderer instruction.
 * A later visual phase maps these onto concrete effects.
 */
export type SpectacleIntent =
  | 'CELESTIAL_REVEAL'
  | 'MONOLITH_WAKE'
  | 'ARCH_TRAVERSAL'
  | 'TOWER_ASCENT'
  | 'VOID_OPENING'
  | 'SIGNAL_BURST'
  | 'FOG_LIFT'
  | 'FINAL_BEACON';

/** Architectural motif families. A track uses 1-3, never all of them (§195). */
export type VisualMotif =
  | 'ARCHES'
  | 'BLACK_SLABS'
  | 'RUINED_PILLARS'
  | 'SIGNAL_ANTENNAE'
  | 'FLOATING_ROCK'
  | 'VERTICAL_FRAMES'
  | 'MONOLITHS'
  | 'SUSPENDED_SLABS';

/** How much of the route is surf, and whether it is required. */
export type SurfPolicy = 'NONE' | 'OPTIONAL' | 'MANDATORY' | 'SIGNATURE';

/** Where a checkpoint is allowed to sit, relative to the music. */
export interface CheckpointIntent {
  /** Target spacing in seconds of SONG TIME, not metres. */
  targetSpacingSeconds: number;
  /** Checkpoints should land on these phrase kinds where possible. */
  preferAfterPhrases: readonly MovementPhrase[];
}

/**
 * Rank calibration for one track.
 *
 * These are DERIVED from the real route geometry and the real movement model,
 * then human-confirmed. They are deliberately expressed as absolute seconds so
 * the results path can use them directly instead of anchoring every track to the
 * raw song duration.
 *
 * `enabled: false` means the track keeps the current global behaviour. This is
 * the safety switch: authored targets only take effect once a human has
 * confirmed them, so authoring can never silently make Diamond unreachable.
 */
export interface RankTargets {
  enabled: boolean;
  /** Intended clean completion time, in seconds. */
  targetTimeSeconds: number;
  /** Where the values came from, so a future reader can judge them. */
  basis: 'GEOMETRIC_ESTIMATE' | 'HUMAN_PLAYTEST' | 'RECORDED_RUNS';
  /** Human-readable note. Required when basis is not GEOMETRIC_ESTIMATE. */
  note?: string;
}

/** A single authored intent for one musical section. */
export interface SectionPhraseIntent {
  /** Index into the analysis macro sections. */
  sectionIndex: number;
  phrase: MovementPhrase;
  density: PhraseDensity;
  primary: PrimaryMechanic;
  secondary?: PrimaryMechanic;
  /** Optional spectacle tied to this section. */
  spectacle?: SpectacleIntent;
  /** True when this section carries an optional side-surf line. */
  optionalSideSurf?: boolean;
  /** Short author note. Developer-facing only. */
  note?: string;
}

/** A spectacle moment, tied to real song time. */
export interface SpectacleMoment {
  /** Song time in seconds. */
  atSeconds: number;
  intent: SpectacleIntent;
  /** True when the front-of-camera space should stay clear (§184). */
  screenClear?: boolean;
  /** Marked as a strong candidate for future trailer capture (§183). */
  trailerCandidate?: boolean;
  note?: string;
}

/** Curated visual identity for one track. Deterministic; never randomized. */
export interface TrackDreamProfile {
  /** Palette key already used by the shipped visual system. */
  paletteKey: 'ICE' | 'EMBER' | 'SIGNAL_RED' | 'ACID' | 'ULTRAVIOLET' | 'GLACIER';
  /** 1-3 motifs. More than three dilutes the identity. */
  motifs: readonly VisualMotif[];
  /** Relative signage density. */
  signageDensity: PhraseDensity;
  /** Relative star density, including hero stars. */
  starDensity: PhraseDensity;
  /** Fog character, expressed as intent. */
  fog: 'NONE' | 'HAZE' | 'MIST' | 'VOID';
  /** True when this track should NOT spawn a celestial body. */
  noCelestial?: boolean;
}

/**
 * THE AUTHORING PROFILE.
 *
 * Every field except `trackId` and `intent` is optional: a track that has not
 * been curated yet simply keeps procedural behaviour.
 */
export interface OfficialTrackProfile {
  trackId: string;
  /** §136: if this cannot be written distinctly, the design is not distinct. */
  intent: string;
  movementIdentity: MovementIdentity;
  /** Optional authored phrase plan, by musical section. */
  sectionPhrases?: readonly SectionPhraseIntent[];
  spectacle?: readonly SpectacleMoment[];
  dream: TrackDreamProfile;
  surfPolicy: SurfPolicy;
  checkpoint?: CheckpointIntent;
  rankTargets?: RankTargets;
  /** Difficulty band shown to the player. */
  band: 'ENTRY' | 'FLOW' | 'INTERMEDIATE' | 'ADVANCED' | 'EXPERT';
  /** One-line movement tag for the Signal Pack inspector (§135). */
  tagline: string;
  profileVersion: number;
}

// ---------------------------------------------------------------------------
// Profile validation
// ---------------------------------------------------------------------------

export interface ProfileIssue {
  trackId: string;
  field: string;
  detail: string;
}

/**
 * Validates an authored profile against the REAL track it describes.
 *
 * Catches the mistakes that would otherwise ship silently: a section index that
 * does not exist, a spectacle outside the song, more than three motifs, an
 * enabled rank target with no basis, or a `SURF` identity on a route with no surf.
 */
export function validateOfficialProfile(
  profile: OfficialTrackProfile,
  track: GeneratedTrack,
  songDurationSeconds: number,
  sectionCount: number
): ProfileIssue[] {
  const issues: ProfileIssue[] = [];
  const add = (field: string, detail: string) => issues.push({ trackId: profile.trackId, field, detail });

  if (!profile.intent || profile.intent.trim().length < 12) {
    add('intent', 'design intent is missing or too short to be meaningful');
  }
  if (profile.profileVersion !== OFFICIAL_PROFILE_VERSION) {
    add('profileVersion', `expected ${OFFICIAL_PROFILE_VERSION}, got ${profile.profileVersion}`);
  }

  for (const p of profile.sectionPhrases ?? []) {
    if (p.sectionIndex < 0 || p.sectionIndex >= sectionCount) {
      add('sectionPhrases', `sectionIndex ${p.sectionIndex} is outside 0..${sectionCount - 1}`);
    }
  }

  const seenSections = new Set<number>();
  for (const p of profile.sectionPhrases ?? []) {
    if (seenSections.has(p.sectionIndex)) {
      add('sectionPhrases', `section ${p.sectionIndex} is authored twice`);
    }
    seenSections.add(p.sectionIndex);
  }

  for (const s of profile.spectacle ?? []) {
    if (!Number.isFinite(s.atSeconds) || s.atSeconds < 0 || s.atSeconds > songDurationSeconds) {
      add('spectacle', `moment at ${s.atSeconds}s is outside the song (0..${songDurationSeconds.toFixed(1)}s)`);
    }
  }

  if (profile.dream.motifs.length === 0) add('dream.motifs', 'no motif: the track will have no visual identity');
  if (profile.dream.motifs.length > 3) {
    add('dream.motifs', `${profile.dream.motifs.length} motifs dilutes identity; use 1-3`);
  }

  const surfNodes = track.route.filter((n) => n.isSurf).length;
  if (profile.surfPolicy === 'MANDATORY' || profile.surfPolicy === 'SIGNATURE') {
    if (surfNodes === 0) add('surfPolicy', `${profile.surfPolicy} but the route contains no surf`);
  }
  if (profile.movementIdentity === 'SURF' && surfNodes === 0) {
    add('movementIdentity', 'SURF identity but the route contains no surf');
  }

  const rt = profile.rankTargets;
  if (rt) {
    // A DISABLED target is inert: it is a placeholder awaiting human evidence,
    // so it is allowed to be zero. Only an ENABLED target must be real.
    if (rt.enabled && (!Number.isFinite(rt.targetTimeSeconds) || rt.targetTimeSeconds <= 0)) {
      add('rankTargets.targetTimeSeconds', 'an ENABLED rank target must be a positive number of seconds');
    }
    if (!rt.enabled && rt.targetTimeSeconds < 0) {
      add('rankTargets.targetTimeSeconds', 'must not be negative');
    }
    if (rt.enabled && rt.basis !== 'HUMAN_PLAYTEST' && rt.basis !== 'RECORDED_RUNS') {
      // Authoring must never silently make a rank unreachable from a formula.
      add('rankTargets.basis', 'an ENABLED rank target requires HUMAN_PLAYTEST or RECORDED_RUNS evidence');
    }
    if (rt.basis !== 'GEOMETRIC_ESTIMATE' && !rt.note) {
      add('rankTargets.note', 'a non-estimate basis must record where the numbers came from');
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Geometric rank-target estimation
// ---------------------------------------------------------------------------

/** Reference speeds used by the estimator, in metres per second. */
export const ESTIMATOR = {
  /** maxGroundWishSpeed from PLAYHEAD_MOVEMENT_V1. Never modified here. */
  groundWishSpeed: 14.0,
  /** A realistic sustained fraction of wish speed on a clean line. */
  sustainedGroundFraction: 0.82,
  /** Surf carries more speed than ground running. */
  surfFraction: 0.95,
  /** Time lost per direction change / landing, in seconds. */
  perNodeOverheadSeconds: 0.16,
  /** Surf nodes are traversed faster and with less overhead. */
  perSurfNodeOverheadSeconds: 0.05
} as const;

export interface RankEstimate {
  /** Straight-line travel time at sustained speed, ignoring overheads. */
  travelSeconds: number;
  /** Travel plus per-node overheads. A first-order achievable time. */
  estimateSeconds: number;
  /** Route length used, in metres. */
  distanceMeters: number;
  surfNodes: number;
}

/**
 * First-order achievable-time estimate from REAL route geometry.
 *
 * This is deliberately PHYSICS-DERIVED, not a path-length heuristic: it uses the
 * frozen movement's own `maxGroundWishSpeed` and a sustained fraction of it,
 * plus a per-node overhead for landings and direction changes.
 *
 * It is an ESTIMATE and is labelled as such. §73 is explicit that official rank
 * targets must not be calibrated from formulas alone, which is why
 * `validateOfficialProfile` refuses to accept an ENABLED rank target whose basis
 * is only this estimate.
 */
export function estimateRankTargets(track: GeneratedTrack): RankEstimate {
  const route: readonly RouteNode[] = track.route;
  let groundDistance = 0;
  let surfDistance = 0;
  let surfNodes = 0;

  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const segment = Math.hypot(
      b.position.x - a.position.x,
      b.position.y - a.position.y,
      b.position.z - a.position.z
    );
    // A segment is surf if EITHER end is a surf node: the player is on the face
    // for the whole traversal into or out of it.
    if (a.isSurf || b.isSurf) surfDistance += segment;
    else groundDistance += segment;
    if (b.isSurf) surfNodes++;
  }

  const groundNodes = Math.max(0, route.length - surfNodes);
  const groundSpeed = ESTIMATOR.groundWishSpeed * ESTIMATOR.sustainedGroundFraction;
  const surfSpeed = ESTIMATOR.groundWishSpeed * ESTIMATOR.surfFraction;
  const travelSeconds = groundDistance / groundSpeed + surfDistance / surfSpeed;
  const overhead =
    groundNodes * ESTIMATOR.perNodeOverheadSeconds + surfNodes * ESTIMATOR.perSurfNodeOverheadSeconds;

  return {
    travelSeconds,
    estimateSeconds: travelSeconds + overhead,
    distanceMeters: groundDistance + surfDistance,
    surfNodes
  };
}

/**
 * Rank multipliers. Mirrors the shipped global bands so an authored target
 * produces the SAME rank difficulty curve, just anchored to an achievable time
 * instead of the raw song duration.
 */
export const RANK_TIME_BANDS = {
  DIAMOND: 1.04,
  GOLD: 1.18,
  SILVER: 1.4,
  BRONZE: 1.85
} as const;

/** Absolute rank times for an authored target, in seconds. */
export function rankTimesFor(targetTimeSeconds: number): Record<keyof typeof RANK_TIME_BANDS, number> {
  return {
    DIAMOND: targetTimeSeconds * RANK_TIME_BANDS.DIAMOND,
    GOLD: targetTimeSeconds * RANK_TIME_BANDS.GOLD,
    SILVER: targetTimeSeconds * RANK_TIME_BANDS.SILVER,
    BRONZE: targetTimeSeconds * RANK_TIME_BANDS.BRONZE
  };
}

/**
 * Whether a competent intended-route run finishes before the music ends.
 *
 * §72: official levels must leave audio margin. A target at or beyond the song
 * duration guarantees overtime for a clean run, which makes the top rank
 * unreachable in practice.
 */
export function audioMarginSeconds(targetTimeSeconds: number, songDurationSeconds: number): number {
  return songDurationSeconds - targetTimeSeconds;
}
