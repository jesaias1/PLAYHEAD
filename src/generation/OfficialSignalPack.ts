/**
 * THE OFFICIAL SIGNAL PACK — authored profiles.
 *
 * One entry per shipped official track. Every track states, in one sentence,
 * what it is ABOUT. §136 is explicit: if that sentence cannot be written
 * distinctly, the level's design is not distinct enough yet.
 *
 * WHAT THIS FILE IS NOT
 *
 * It is not a route. It does not contain coordinates, and it does not override
 * the procedural builder's geometry. It states intent — movement identity,
 * phrase plan, spectacle, motifs, surf policy — and the builder does the work.
 * Manual geometry is reserved for a hero sequence that genuinely needs it, and
 * none currently does.
 *
 * WHAT IS AUTHORED HERE IS DESCRIPTIVE, NOT BEHAVIOURAL
 *
 * `rankTargets` is present but DISABLED on every track. An enabled target would
 * change what Diamond means, and §73 forbids calibrating that from a formula.
 * The estimator below produces the number a human then confirms; until a human
 * confirms it, the shipped rank behaviour is untouched.
 */

import {
  OFFICIAL_PROFILE_VERSION,
  OfficialTrackProfile
} from './OfficialTrackProfile';

/** Difficulty bands, in the order the Signal Pack presents them. */
export const SIGNAL_PACK_BANDS = ['ENTRY', 'FLOW', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'] as const;

export const OFFICIAL_TRACK_PROFILES: readonly OfficialTrackProfile[] = [
  // -------------------------------------------------------------------------
  // 01 — THE BENCHMARK
  // -------------------------------------------------------------------------
  {
    trackId: 'track_1_signal_drift',
    intent:
      'The first impression: wide, forgiving platforms that let a new player feel PLAYHEAD momentum immediately, with surf offered rather than demanded.',
    movementIdentity: 'FLOW',
    band: 'ENTRY',
    tagline: 'FLOW / AIR',
    surfPolicy: 'OPTIONAL',
    profileVersion: OFFICIAL_PROFILE_VERSION,
    dream: {
      paletteKey: 'ACID',
      motifs: ['ARCHES', 'FLOATING_ROCK'],
      signageDensity: 'SPARSE',
      starDensity: 'MEDIUM',
      fog: 'HAZE'
    },
    sectionPhrases: [
      { sectionIndex: 0, phrase: 'RUN', density: 'SPARSE', primary: 'RUN', note: 'Read the world before being asked to move.' },
      { sectionIndex: 1, phrase: 'RHYTHM_HOPS', density: 'MEDIUM', primary: 'JUMP', secondary: 'BHOP', optionalSideSurf: true },
      { sectionIndex: 2, phrase: 'SPECTACLE_TRAVERSE', density: 'MEDIUM', primary: 'JUMP', spectacle: 'ARCH_TRAVERSAL', note: 'The benchmark arch: readable from the previous landing.' },
      { sectionIndex: 3, phrase: 'FINAL_RUN', density: 'MEDIUM', primary: 'JUMP', spectacle: 'FINAL_BEACON' }
    ],
    spectacle: [
      { atSeconds: 38, intent: 'CELESTIAL_REVEAL', screenClear: true, trailerCandidate: true, note: 'Crest into open sky.' },
      { atSeconds: 74, intent: 'ARCH_TRAVERSAL', screenClear: true, trailerCandidate: true },
      { atSeconds: 104, intent: 'FINAL_BEACON' }
    ],
    checkpoint: { targetSpacingSeconds: 26, preferAfterPhrases: ['RHYTHM_HOPS', 'SPECTACLE_TRAVERSE'] },
    rankTargets: { enabled: false, targetTimeSeconds: 0, basis: 'GEOMETRIC_ESTIMATE', note: 'Awaiting human playtest.' }
  },

  // -------------------------------------------------------------------------
  // 02
  // -------------------------------------------------------------------------
  {
    trackId: 'track_2_flow_state',
    intent:
      'A long unbroken rhythm-hop cadence: the player is never forced to stop, only to keep re-reading the same groove at speed.',
    movementIdentity: 'RHYTHM',
    band: 'FLOW',
    tagline: 'RHYTHM / BHOP',
    surfPolicy: 'OPTIONAL',
    profileVersion: OFFICIAL_PROFILE_VERSION,
    dream: {
      paletteKey: 'ACID',
      motifs: ['SUSPENDED_SLABS', 'VERTICAL_FRAMES'],
      signageDensity: 'MEDIUM',
      starDensity: 'SPARSE',
      fog: 'HAZE'
    },
    sectionPhrases: [
      { sectionIndex: 0, phrase: 'RUN', density: 'SPARSE', primary: 'RUN' },
      { sectionIndex: 1, phrase: 'BHOP_CHAIN', density: 'DENSE', primary: 'BHOP', secondary: 'JUMP', optionalSideSurf: true },
      { sectionIndex: 2, phrase: 'RHYTHM_HOPS', density: 'DENSE', primary: 'JUMP', secondary: 'BHOP' },
      { sectionIndex: 3, phrase: 'BHOP_CHAIN', density: 'DENSE', primary: 'BHOP' },
      { sectionIndex: 4, phrase: 'FINAL_RUN', density: 'MEDIUM', primary: 'JUMP', spectacle: 'SIGNAL_BURST' }
    ],
    spectacle: [
      { atSeconds: 70, intent: 'SIGNAL_BURST', screenClear: true },
      { atSeconds: 190, intent: 'MONOLITH_WAKE', trailerCandidate: true },
      { atSeconds: 238, intent: 'FINAL_BEACON' }
    ],
    checkpoint: { targetSpacingSeconds: 34, preferAfterPhrases: ['BHOP_CHAIN', 'RHYTHM_HOPS'] },
    rankTargets: { enabled: false, targetTimeSeconds: 0, basis: 'GEOMETRIC_ESTIMATE', note: 'Awaiting human playtest.' }
  },

  // -------------------------------------------------------------------------
  // 03
  // -------------------------------------------------------------------------
  {
    trackId: 'track_3_surf_the_void',
    intent:
      'The surf statement: long, shallow, committed surf bodies over open void, where leaving the ramp early is the only real mistake.',
    movementIdentity: 'SURF',
    band: 'INTERMEDIATE',
    tagline: 'SURF / LONG',
    surfPolicy: 'SIGNATURE',
    profileVersion: OFFICIAL_PROFILE_VERSION,
    dream: {
      paletteKey: 'ICE',
      motifs: ['FLOATING_ROCK', 'RUINED_PILLARS'],
      signageDensity: 'SPARSE',
      starDensity: 'MEDIUM',
      fog: 'VOID'
    },
    sectionPhrases: [
      { sectionIndex: 0, phrase: 'RUN', density: 'SPARSE', primary: 'RUN' },
      { sectionIndex: 1, phrase: 'SURF_ENTRY', density: 'MEDIUM', primary: 'SURF' },
      { sectionIndex: 2, phrase: 'SURF_BODY', density: 'MEDIUM', primary: 'SURF', spectacle: 'VOID_OPENING', note: 'The signature: nothing below, nothing above, only the face.' },
      { sectionIndex: 3, phrase: 'SURF_RELEASE', density: 'MEDIUM', primary: 'SURF', secondary: 'AIR_STRAFE' },
      { sectionIndex: 4, phrase: 'FINAL_RUN', density: 'MEDIUM', primary: 'JUMP', spectacle: 'FINAL_BEACON' }
    ],
    spectacle: [
      { atSeconds: 60, intent: 'VOID_OPENING', screenClear: true, trailerCandidate: true },
      { atSeconds: 132, intent: 'CELESTIAL_REVEAL', screenClear: true },
      { atSeconds: 170, intent: 'FINAL_BEACON' }
    ],
    checkpoint: { targetSpacingSeconds: 30, preferAfterPhrases: ['SURF_ENTRY', 'SURF_RELEASE'] },
    rankTargets: { enabled: false, targetTimeSeconds: 0, basis: 'GEOMETRIC_ESTIMATE', note: 'Awaiting human playtest.' }
  },

  // -------------------------------------------------------------------------
  // 04
  // -------------------------------------------------------------------------
  {
    trackId: 'track_4_airwave_theory',
    intent:
      'Air-strafe theory: gaps are crossed by holding an arc, not by finding a platform in the middle, so the player commits before leaving the edge.',
    movementIdentity: 'AIR',
    band: 'INTERMEDIATE',
    tagline: 'AIR / STRAFE',
    surfPolicy: 'OPTIONAL',
    profileVersion: OFFICIAL_PROFILE_VERSION,
    dream: {
      paletteKey: 'GLACIER',
      motifs: ['VERTICAL_FRAMES', 'SIGNAL_ANTENNAE'],
      signageDensity: 'MEDIUM',
      starDensity: 'MEDIUM',
      fog: 'MIST'
    },
    sectionPhrases: [
      { sectionIndex: 0, phrase: 'RUN', density: 'SPARSE', primary: 'RUN' },
      { sectionIndex: 1, phrase: 'AIR_STRAFE', density: 'MEDIUM', primary: 'AIR_STRAFE', optionalSideSurf: true },
      { sectionIndex: 2, phrase: 'LONG_GAP', density: 'MEDIUM', primary: 'AIR_STRAFE', secondary: 'JUMP', spectacle: 'VOID_OPENING' },
      { sectionIndex: 3, phrase: 'AIR_STRAFE', density: 'DENSE', primary: 'AIR_STRAFE' },
      { sectionIndex: 4, phrase: 'FINAL_RUN', density: 'MEDIUM', primary: 'JUMP', spectacle: 'FINAL_BEACON' }
    ],
    spectacle: [
      { atSeconds: 66, intent: 'VOID_OPENING', screenClear: true, trailerCandidate: true },
      { atSeconds: 128, intent: 'MONOLITH_WAKE' },
      { atSeconds: 158, intent: 'FINAL_BEACON' }
    ],
    checkpoint: { targetSpacingSeconds: 28, preferAfterPhrases: ['AIR_STRAFE', 'LONG_GAP'] },
    rankTargets: { enabled: false, targetTimeSeconds: 0, basis: 'GEOMETRIC_ESTIMATE', note: 'Awaiting human playtest.' }
  },

  // -------------------------------------------------------------------------
  // 05
  // -------------------------------------------------------------------------
  {
    trackId: 'track_5_gravity_line',
    intent:
      'A narrow line held at speed: the route rewards a single clean read and punishes correction, without ever demanding a blind jump.',
    movementIdentity: 'PRECISION',
    band: 'INTERMEDIATE',
    tagline: 'PRECISION / LINE',
    surfPolicy: 'OPTIONAL',
    profileVersion: OFFICIAL_PROFILE_VERSION,
    dream: {
      paletteKey: 'ULTRAVIOLET',
      motifs: ['MONOLITHS', 'BLACK_SLABS'],
      signageDensity: 'SPARSE',
      starDensity: 'SPARSE',
      fog: 'HAZE'
    },
    sectionPhrases: [
      { sectionIndex: 0, phrase: 'RUN', density: 'SPARSE', primary: 'RUN' },
      { sectionIndex: 1, phrase: 'PRECISION_FLOW', density: 'MEDIUM', primary: 'PRECISION', secondary: 'JUMP' },
      { sectionIndex: 2, phrase: 'PRECISION_FLOW', density: 'DENSE', primary: 'PRECISION', optionalSideSurf: true, spectacle: 'MONOLITH_WAKE' },
      { sectionIndex: 3, phrase: 'FINAL_RUN', density: 'MEDIUM', primary: 'PRECISION', spectacle: 'FINAL_BEACON' }
    ],
    spectacle: [
      { atSeconds: 52, intent: 'MONOLITH_WAKE', screenClear: true, trailerCandidate: true },
      { atSeconds: 108, intent: 'SIGNAL_BURST' },
      { atSeconds: 124, intent: 'FINAL_BEACON' }
    ],
    checkpoint: { targetSpacingSeconds: 30, preferAfterPhrases: ['PRECISION_FLOW'] },
    rankTargets: { enabled: false, targetTimeSeconds: 0, basis: 'GEOMETRIC_ESTIMATE', note: 'Awaiting human playtest.' }
  },

  // -------------------------------------------------------------------------
  // 06
  // -------------------------------------------------------------------------
  {
    trackId: 'track_6_over_the_edge',
    intent:
      'Transfer between separated structures: progress comes from reading which far shape is reachable, not from ground speed on any one of them.',
    movementIdentity: 'TRANSFER',
    band: 'ADVANCED',
    tagline: 'TRANSFER / AIR',
    surfPolicy: 'OPTIONAL',
    profileVersion: OFFICIAL_PROFILE_VERSION,
    dream: {
      paletteKey: 'EMBER',
      motifs: ['SUSPENDED_SLABS', 'MONOLITHS'],
      signageDensity: 'MEDIUM',
      starDensity: 'MEDIUM',
      fog: 'MIST'
    },
    sectionPhrases: [
      { sectionIndex: 0, phrase: 'RUN', density: 'SPARSE', primary: 'RUN' },
      { sectionIndex: 1, phrase: 'LONG_GAP', density: 'MEDIUM', primary: 'AIR_STRAFE', secondary: 'JUMP', spectacle: 'ARCH_TRAVERSAL' },
      { sectionIndex: 2, phrase: 'SPECTACLE_TRAVERSE', density: 'MEDIUM', primary: 'AIR_STRAFE', optionalSideSurf: true, spectacle: 'CELESTIAL_REVEAL' },
      { sectionIndex: 3, phrase: 'LONG_GAP', density: 'DENSE', primary: 'AIR_STRAFE' },
      { sectionIndex: 4, phrase: 'FINAL_RUN', density: 'MEDIUM', primary: 'JUMP', spectacle: 'FINAL_BEACON' }
    ],
    spectacle: [
      { atSeconds: 58, intent: 'ARCH_TRAVERSAL', screenClear: true, trailerCandidate: true },
      { atSeconds: 118, intent: 'CELESTIAL_REVEAL', screenClear: true, trailerCandidate: true },
      { atSeconds: 154, intent: 'FINAL_BEACON' }
    ],
    checkpoint: { targetSpacingSeconds: 28, preferAfterPhrases: ['LONG_GAP', 'SPECTACLE_TRAVERSE'] },
    rankTargets: { enabled: false, targetTimeSeconds: 0, basis: 'GEOMETRIC_ESTIMATE', note: 'Awaiting human playtest.' }
  },

  // -------------------------------------------------------------------------
  // 07
  // -------------------------------------------------------------------------
  {
    trackId: 'track_7_drop_zone_surfer',
    intent:
      'Falling with intent: the drop is the route, and the skill is converting the fall into forward speed instead of absorbing it.',
    movementIdentity: 'VERTICAL',
    band: 'ADVANCED',
    tagline: 'VERTICAL / SURF',
    surfPolicy: 'MANDATORY',
    profileVersion: OFFICIAL_PROFILE_VERSION,
    dream: {
      paletteKey: 'SIGNAL_RED',
      motifs: ['MONOLITHS', 'RUINED_PILLARS'],
      signageDensity: 'MEDIUM',
      starDensity: 'SPARSE',
      fog: 'MIST'
    },
    sectionPhrases: [
      { sectionIndex: 0, phrase: 'RUN', density: 'SPARSE', primary: 'RUN' },
      { sectionIndex: 1, phrase: 'ASCENT', density: 'MEDIUM', primary: 'JUMP', note: 'Earn the height that makes the drop matter.' },
      { sectionIndex: 2, phrase: 'DESCENT', density: 'MEDIUM', primary: 'DROP', spectacle: 'VOID_OPENING' },
      { sectionIndex: 3, phrase: 'SURF_RELEASE', density: 'MEDIUM', primary: 'SURF' },
      { sectionIndex: 4, phrase: 'SURF_CHAIN', density: 'MEDIUM', primary: 'SURF' },
      { sectionIndex: 5, phrase: 'FINAL_RUN', density: 'MEDIUM', primary: 'JUMP', spectacle: 'FINAL_BEACON' }
    ],
    spectacle: [
      { atSeconds: 62, intent: 'VOID_OPENING', screenClear: true, trailerCandidate: true },
      { atSeconds: 138, intent: 'SIGNAL_BURST' },
      { atSeconds: 184, intent: 'FINAL_BEACON' }
    ],
    checkpoint: { targetSpacingSeconds: 30, preferAfterPhrases: ['ASCENT', 'SURF_RELEASE', 'SURF_CHAIN'] },
    rankTargets: { enabled: false, targetTimeSeconds: 0, basis: 'GEOMETRIC_ESTIMATE', note: 'Awaiting human playtest.' }
  },

  // -------------------------------------------------------------------------
  // 08
  // -------------------------------------------------------------------------
  {
    trackId: 'track_8_wave_surfing',
    intent:
      'Carrying maximum speed through chained surf releases, where the reward for a clean exit is arriving at the next entry already fast.',
    movementIdentity: 'SURF',
    band: 'ADVANCED',
    tagline: 'SURF / CHAIN',
    surfPolicy: 'MANDATORY',
    profileVersion: OFFICIAL_PROFILE_VERSION,
    dream: {
      paletteKey: 'ULTRAVIOLET',
      motifs: ['FLOATING_ROCK', 'ARCHES'],
      signageDensity: 'SPARSE',
      starDensity: 'MEDIUM',
      fog: 'VOID'
    },
    sectionPhrases: [
      { sectionIndex: 0, phrase: 'RUN', density: 'SPARSE', primary: 'RUN' },
      { sectionIndex: 1, phrase: 'SURF_ENTRY', density: 'MEDIUM', primary: 'SURF' },
      { sectionIndex: 2, phrase: 'SURF_CHAIN', density: 'DENSE', primary: 'SURF', secondary: 'AIR_STRAFE', spectacle: 'VOID_OPENING' },
      { sectionIndex: 3, phrase: 'SURF_TRANSFER', density: 'MEDIUM', primary: 'SURF', secondary: 'AIR_STRAFE', spectacle: 'ARCH_TRAVERSAL' },
      { sectionIndex: 4, phrase: 'SURF_RELEASE', density: 'MEDIUM', primary: 'SURF' },
      { sectionIndex: 5, phrase: 'FINAL_RUN', density: 'MEDIUM', primary: 'JUMP', spectacle: 'FINAL_BEACON' }
    ],
    spectacle: [
      { atSeconds: 54, intent: 'VOID_OPENING', screenClear: true, trailerCandidate: true },
      { atSeconds: 120, intent: 'ARCH_TRAVERSAL', screenClear: true, trailerCandidate: true },
      { atSeconds: 160, intent: 'FINAL_BEACON' }
    ],
    checkpoint: { targetSpacingSeconds: 28, preferAfterPhrases: ['SURF_CHAIN', 'SURF_TRANSFER'] },
    rankTargets: { enabled: false, targetTimeSeconds: 0, basis: 'GEOMETRIC_ESTIMATE', note: 'Awaiting human playtest.' }
  },

  // -------------------------------------------------------------------------
  // 09
  // -------------------------------------------------------------------------
  {
    trackId: 'track_9_neon_abyss',
    intent:
      'Surf and precision share one short route: the abyss is close on every side, so a clean line matters more than raw speed.',
    movementIdentity: 'HYBRID',
    band: 'ADVANCED',
    tagline: 'HYBRID / VOID',
    surfPolicy: 'OPTIONAL',
    profileVersion: OFFICIAL_PROFILE_VERSION,
    dream: {
      paletteKey: 'ULTRAVIOLET',
      motifs: ['BLACK_SLABS', 'SIGNAL_ANTENNAE'],
      signageDensity: 'DENSE',
      starDensity: 'SPARSE',
      fog: 'VOID'
    },
    sectionPhrases: [
      { sectionIndex: 0, phrase: 'RUN', density: 'SPARSE', primary: 'RUN' },
      { sectionIndex: 1, phrase: 'PRECISION_FLOW', density: 'DENSE', primary: 'PRECISION', optionalSideSurf: true, spectacle: 'VOID_OPENING' },
      { sectionIndex: 2, phrase: 'SURF_BODY', density: 'MEDIUM', primary: 'SURF' },
      { sectionIndex: 3, phrase: 'FINAL_RUN', density: 'MEDIUM', primary: 'PRECISION', spectacle: 'FINAL_BEACON' }
    ],
    spectacle: [
      { atSeconds: 36, intent: 'VOID_OPENING', screenClear: true, trailerCandidate: true },
      { atSeconds: 78, intent: 'SIGNAL_BURST' },
      { atSeconds: 102, intent: 'FINAL_BEACON' }
    ],
    checkpoint: { targetSpacingSeconds: 26, preferAfterPhrases: ['PRECISION_FLOW', 'SURF_BODY'] },
    rankTargets: { enabled: false, targetTimeSeconds: 0, basis: 'GEOMETRIC_ESTIMATE', note: 'Awaiting human playtest.' }
  },

  // -------------------------------------------------------------------------
  // 10
  // -------------------------------------------------------------------------
  {
    trackId: 'track_10_neon_slipstream',
    intent:
      'A short, fast slipstream: the highest tempo in the pack asks for immediate commitment and gives very little runway to think.',
    movementIdentity: 'SPEED',
    band: 'EXPERT',
    tagline: 'SPEED / SLIPSTREAM',
    surfPolicy: 'OPTIONAL',
    profileVersion: OFFICIAL_PROFILE_VERSION,
    dream: {
      paletteKey: 'ICE',
      motifs: ['VERTICAL_FRAMES', 'SIGNAL_ANTENNAE'],
      signageDensity: 'DENSE',
      starDensity: 'SPARSE',
      fog: 'HAZE'
    },
    sectionPhrases: [
      { sectionIndex: 0, phrase: 'RUN', density: 'SPARSE', primary: 'RUN' },
      { sectionIndex: 1, phrase: 'BHOP_CHAIN', density: 'DENSE', primary: 'BHOP', secondary: 'JUMP', optionalSideSurf: true },
      { sectionIndex: 2, phrase: 'AIR_STRAFE', density: 'DENSE', primary: 'AIR_STRAFE', spectacle: 'SIGNAL_BURST' },
      { sectionIndex: 3, phrase: 'FINAL_RUN', density: 'DENSE', primary: 'JUMP', spectacle: 'FINAL_BEACON' }
    ],
    spectacle: [
      { atSeconds: 40, intent: 'SIGNAL_BURST', screenClear: true },
      { atSeconds: 82, intent: 'MONOLITH_WAKE', trailerCandidate: true },
      { atSeconds: 104, intent: 'FINAL_BEACON' }
    ],
    checkpoint: { targetSpacingSeconds: 24, preferAfterPhrases: ['BHOP_CHAIN', 'AIR_STRAFE'] },
    rankTargets: { enabled: false, targetTimeSeconds: 0, basis: 'GEOMETRIC_ESTIMATE', note: 'Awaiting human playtest.' }
  },

  // -------------------------------------------------------------------------
  // 11
  // -------------------------------------------------------------------------
  {
    trackId: 'track_11_ex_gravity',
    intent:
      'Precision under a heavy, fast pulse: arcs are long, landings are small, and the route never asks for a blind jump.',
    movementIdentity: 'PRECISION',
    band: 'EXPERT',
    tagline: 'PRECISION / AIR',
    surfPolicy: 'OPTIONAL',
    profileVersion: OFFICIAL_PROFILE_VERSION,
    dream: {
      paletteKey: 'EMBER',
      motifs: ['MONOLITHS', 'SUSPENDED_SLABS'],
      signageDensity: 'MEDIUM',
      starDensity: 'MEDIUM',
      fog: 'MIST'
    },
    sectionPhrases: [
      { sectionIndex: 0, phrase: 'RUN', density: 'SPARSE', primary: 'RUN' },
      { sectionIndex: 1, phrase: 'AIR_STRAFE', density: 'DENSE', primary: 'AIR_STRAFE', secondary: 'JUMP', optionalSideSurf: true },
      { sectionIndex: 2, phrase: 'PRECISION_FLOW', density: 'DENSE', primary: 'PRECISION', spectacle: 'MONOLITH_WAKE' },
      { sectionIndex: 3, phrase: 'LONG_GAP', density: 'MEDIUM', primary: 'AIR_STRAFE' },
      { sectionIndex: 4, phrase: 'FINAL_RUN', density: 'MEDIUM', primary: 'JUMP', spectacle: 'FINAL_BEACON' }
    ],
    spectacle: [
      { atSeconds: 56, intent: 'MONOLITH_WAKE', screenClear: true, trailerCandidate: true },
      { atSeconds: 116, intent: 'CELESTIAL_REVEAL', screenClear: true },
      { atSeconds: 140, intent: 'FINAL_BEACON' }
    ],
    checkpoint: { targetSpacingSeconds: 28, preferAfterPhrases: ['AIR_STRAFE', 'PRECISION_FLOW'] },
    rankTargets: { enabled: false, targetTimeSeconds: 0, basis: 'GEOMETRIC_ESTIMATE', note: 'Awaiting human playtest.' }
  },

  // -------------------------------------------------------------------------
  // 12
  // -------------------------------------------------------------------------
  {
    trackId: 'track_12_shadows_over_the_circuit',
    intent:
      'The shortest route in the pack, built as one dense rhythm: almost no travel between decisions, and a hard read from the first second.',
    movementIdentity: 'RHYTHM',
    band: 'EXPERT',
    tagline: 'RHYTHM / DENSE',
    surfPolicy: 'NONE',
    profileVersion: OFFICIAL_PROFILE_VERSION,
    dream: {
      paletteKey: 'GLACIER',
      motifs: ['BLACK_SLABS', 'VERTICAL_FRAMES'],
      signageDensity: 'DENSE',
      starDensity: 'SPARSE',
      fog: 'MIST'
    },
    sectionPhrases: [
      { sectionIndex: 0, phrase: 'RUN', density: 'MEDIUM', primary: 'RUN' },
      { sectionIndex: 1, phrase: 'RHYTHM_HOPS', density: 'DENSE', primary: 'JUMP', secondary: 'BHOP' },
      { sectionIndex: 2, phrase: 'BHOP_CHAIN', density: 'DENSE', primary: 'BHOP', spectacle: 'SIGNAL_BURST' },
      { sectionIndex: 3, phrase: 'FINAL_RUN', density: 'DENSE', primary: 'JUMP', spectacle: 'FINAL_BEACON' }
    ],
    spectacle: [
      { atSeconds: 24, intent: 'SIGNAL_BURST', screenClear: true },
      { atSeconds: 56, intent: 'MONOLITH_WAKE' },
      { atSeconds: 78, intent: 'FINAL_BEACON' }
    ],
    checkpoint: { targetSpacingSeconds: 22, preferAfterPhrases: ['RHYTHM_HOPS', 'BHOP_CHAIN'] },
    rankTargets: { enabled: false, targetTimeSeconds: 0, basis: 'GEOMETRIC_ESTIMATE', note: 'Awaiting human playtest.' }
  },

  // -------------------------------------------------------------------------
  // 13
  // -------------------------------------------------------------------------
  {
    trackId: 'track_13_waveform_descent',
    intent:
      'A slow, long descent: the lowest tempo in the pack turns verticality into the whole route, with landings that stay readable at speed.',
    movementIdentity: 'VERTICAL',
    band: 'EXPERT',
    tagline: 'VERTICAL / DESCENT',
    surfPolicy: 'OPTIONAL',
    profileVersion: OFFICIAL_PROFILE_VERSION,
    dream: {
      paletteKey: 'ULTRAVIOLET',
      motifs: ['RUINED_PILLARS', 'FLOATING_ROCK'],
      signageDensity: 'SPARSE',
      starDensity: 'DENSE',
      fog: 'VOID'
    },
    sectionPhrases: [
      { sectionIndex: 0, phrase: 'RUN', density: 'SPARSE', primary: 'RUN' },
      { sectionIndex: 1, phrase: 'ASCENT', density: 'SPARSE', primary: 'JUMP', note: 'Earn a crest worth descending from.' },
      { sectionIndex: 2, phrase: 'DESCENT', density: 'MEDIUM', primary: 'DROP', spectacle: 'VOID_OPENING' },
      { sectionIndex: 3, phrase: 'DESCENT', density: 'MEDIUM', primary: 'DROP', optionalSideSurf: true },
      { sectionIndex: 4, phrase: 'DESCENT', density: 'MEDIUM', primary: 'DROP', spectacle: 'CELESTIAL_REVEAL' },
      { sectionIndex: 5, phrase: 'FINAL_RUN', density: 'MEDIUM', primary: 'JUMP', spectacle: 'FINAL_BEACON' }
    ],
    spectacle: [
      { atSeconds: 58, intent: 'VOID_OPENING', screenClear: true, trailerCandidate: true },
      { atSeconds: 136, intent: 'CELESTIAL_REVEAL', screenClear: true, trailerCandidate: true },
      { atSeconds: 174, intent: 'FINAL_BEACON' }
    ],
    checkpoint: { targetSpacingSeconds: 30, preferAfterPhrases: ['ASCENT', 'DESCENT'] },
    rankTargets: { enabled: false, targetTimeSeconds: 0, basis: 'GEOMETRIC_ESTIMATE', note: 'Awaiting human playtest.' }
  },

  // -------------------------------------------------------------------------
  // 14
  // -------------------------------------------------------------------------
  {
    trackId: 'track_14_kz_ascent',
    intent:
      'One continuous climb: the route keeps finding another storey, and the reward for holding momentum is reaching the world above the route.',
    movementIdentity: 'ASCENT',
    band: 'EXPERT',
    tagline: 'ASCENT / CHAIN',
    surfPolicy: 'OPTIONAL',
    profileVersion: OFFICIAL_PROFILE_VERSION,
    dream: {
      paletteKey: 'SIGNAL_RED',
      motifs: ['MONOLITHS', 'VERTICAL_FRAMES'],
      signageDensity: 'MEDIUM',
      starDensity: 'SPARSE',
      fog: 'MIST'
    },
    sectionPhrases: [
      { sectionIndex: 0, phrase: 'RUN', density: 'SPARSE', primary: 'RUN' },
      { sectionIndex: 1, phrase: 'ASCENT', density: 'MEDIUM', primary: 'JUMP', secondary: 'BHOP' },
      { sectionIndex: 2, phrase: 'ASCENT', density: 'DENSE', primary: 'JUMP', secondary: 'BHOP', optionalSideSurf: true, spectacle: 'TOWER_ASCENT' },
      { sectionIndex: 3, phrase: 'ASCENT', density: 'DENSE', primary: 'JUMP', spectacle: 'MONOLITH_WAKE' },
      { sectionIndex: 4, phrase: 'FINAL_RUN', density: 'MEDIUM', primary: 'JUMP', spectacle: 'FINAL_BEACON' }
    ],
    spectacle: [
      { atSeconds: 62, intent: 'TOWER_ASCENT', screenClear: true, trailerCandidate: true },
      { atSeconds: 118, intent: 'MONOLITH_WAKE', screenClear: true, trailerCandidate: true },
      { atSeconds: 144, intent: 'FINAL_BEACON' }
    ],
    checkpoint: { targetSpacingSeconds: 30, preferAfterPhrases: ['ASCENT'] },
    rankTargets: { enabled: false, targetTimeSeconds: 0, basis: 'GEOMETRIC_ESTIMATE', note: 'Awaiting human playtest.' }
  }
];

/** Lookup. Returns null for a non-official or unknown id. */
export function getOfficialProfile(trackId: string): OfficialTrackProfile | null {
  return OFFICIAL_TRACK_PROFILES.find((p) => p.trackId === trackId) ?? null;
}
