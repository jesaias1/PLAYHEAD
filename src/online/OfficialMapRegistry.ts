/**
 * OFFICIAL MAP REGISTRY — canonical competitive identity for official tracks.
 *
 * ⚠️ GENERATED FILE. DO NOT EDIT BY HAND.
 *
 * Regenerate with:
 *   npm run precompute-presets          # rebuild canonical presets first
 *   WRITE_REGISTRY=1 npx vitest run tests/CanonicalOfficialMaps.test.ts
 *
 * Then mirror the same identities into ACCEPTED_MAPS in
 * supabase/functions/submit-run/index.ts and redeploy that function.
 *
 * Every entry is produced by `PresetLevelCache.buildLevelData` — the exact
 * function the browser uses — so this table cannot disagree with what a client
 * builds. A run whose locally computed identity does not match its entry is not
 * eligible for public leaderboard submission.
 */

import type { RegistryEntry } from './MapIdentity';

/**
 * True: every official track has a canonical, versioned, deterministic map with
 * FINAL UNSAFE DECORATION = 0, verified by tests/CanonicalOfficialMaps.test.ts.
 */
export const REGISTRY_READY = true;

/** Canonical identity per official track. */
export const OFFICIAL_MAP_REGISTRY: readonly RegistryEntry[] = [
  {
    trackId: 'track_1_signal_drift',
    seed: 2554627371,
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_353746C55C006F8F_40eb',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_6',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_0FECC3F530E85242'
  },
  {
    trackId: 'track_2_flow_state',
    seed: 4185580859,
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_91E6F2193CAC2575_9fb5',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_6',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_2111C10AC5F43134'
  },
  {
    trackId: 'track_3_surf_the_void',
    seed: 368595459,
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_5BD5BC95441CADE0_76bd',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_6',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_00060E570B0513A3'
  },
  {
    trackId: 'track_4_airwave_theory',
    seed: 1958591327,
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_E36816C6E32910F9_6c74',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_6',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_99AA2FE5F6B0A7E2'
  },
  {
    trackId: 'track_5_gravity_line',
    seed: 974726252,
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_6F6D8F838F7A0B2B_5f58',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_6',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_FB088A54EDA2FA29'
  },
  {
    trackId: 'track_6_over_the_edge',
    seed: 1739395704,
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_90C1235B38E216DA_6d54',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_6',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_F2BD7F721D1A7BBA'
  },
  {
    trackId: 'track_7_drop_zone_surfer',
    seed: 4283440201,
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_279625215A8CEC6E_7ef3',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_6',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_E990D0B35C179694'
  },
  {
    trackId: 'track_8_wave_surfing',
    seed: 888972499,
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_293E4C7E5F4974B6_6c44',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_6',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_49ECF2186778D318'
  },
  {
    trackId: 'track_9_neon_abyss',
    seed: 3849677256,
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_42ED0370C2115403_4065',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_6',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_20747FA912E066A6'
  },
  {
    trackId: 'track_10_neon_slipstream',
    seed: 1066361113,
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_C24426E7E32ED2F1_4231',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_6',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_5AC224E5DB296EA7'
  },
  {
    trackId: 'track_11_ex_gravity',
    seed: 294257616,
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_5BDCB2F04EE51DE8_519b',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_6',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_E1987AC6947525FC'
  },
  {
    trackId: 'track_12_shadows_over_the_circuit',
    seed: 735235928,
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_1F65CF72467D0E3A_3c89',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_6',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_67DD4774BF859EDA'
  },
  {
    trackId: 'track_13_waveform_descent',
    seed: 1306015387,
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_1CE0F554D66FC35D_7b6e',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_6',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_E0CA9EF8EAB73ACB'
  },
  {
    trackId: 'track_14_kz_ascent',
    seed: 2349050799,
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_81D43071B9661612_7340',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_6',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_0C066A2929007804'
  }
];

/** Human-facing reason shown when a run cannot be submitted competitively. */
export const REGISTRY_BLOCKED_REASON =
  'CANONICAL MAP IDENTITY PENDING // official presets must be regenerated ' +
  'before competitive submission is enabled';

export function getRegistryEntry(trackId: string): RegistryEntry | undefined {
  return OFFICIAL_MAP_REGISTRY.find((e) => e.trackId === trackId);
}

/**
 * Serialisable form of the registry for the submit-run Edge Function, so the
 * server accepts exactly the fingerprints this client can produce.
 */
export function getAcceptedFingerprints(): Record<
  string,
  { mapVersion: number; mapFingerprint: string; movementVersion: string }
> {
  const out: Record<
    string,
    { mapVersion: number; mapFingerprint: string; movementVersion: string }
  > = {};
  for (const entry of OFFICIAL_MAP_REGISTRY) {
    out[entry.trackId] = {
      mapVersion: entry.mapVersion,
      mapFingerprint: entry.mapFingerprint,
      movementVersion: entry.movementVersion
    };
  }
  return out;
}
