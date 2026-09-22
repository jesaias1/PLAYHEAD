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
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_2AC7467E29419C32_40eb',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_5',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_0FECC3F530E85242'
  },
  {
    trackId: 'track_2_flow_state',
    seed: 4185580859,
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_B1EEF8A8434DD30E_b8eb',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_5',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_2111C10AC5F43134'
  },
  {
    trackId: 'track_3_surf_the_void',
    seed: 368595459,
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_5E0500352418B06D_7a0e',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_5',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_00060E570B0513A3'
  },
  {
    trackId: 'track_4_airwave_theory',
    seed: 1958591327,
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_A62A03D1A5DE1F81_766c',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_5',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_99AA2FE5F6B0A7E2'
  },
  {
    trackId: 'track_5_gravity_line',
    seed: 974726252,
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_1CB4B484B698E2E2_6515',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_5',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_FB088A54EDA2FA29'
  },
  {
    trackId: 'track_6_over_the_edge',
    seed: 1739395704,
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_B6AC926A38515910_6f75',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_5',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_F2BD7F721D1A7BBA'
  },
  {
    trackId: 'track_7_drop_zone_surfer',
    seed: 4283440201,
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_02C4103B70DC8E14_8fa6',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_5',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_E990D0B35C179694'
  },
  {
    trackId: 'track_8_wave_surfing',
    seed: 888972499,
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_48CC984100DD6740_739a',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_5',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_49ECF2186778D318'
  },
  {
    trackId: 'track_9_neon_abyss',
    seed: 3849677256,
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_0D8A10180466F0B4_4540',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_5',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_20747FA912E066A6'
  },
  {
    trackId: 'track_10_neon_slipstream',
    seed: 1066361113,
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_F84D156F59CB8DB4_42c8',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_5',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_5AC224E5DB296EA7'
  },
  {
    trackId: 'track_11_ex_gravity',
    seed: 294257616,
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_4CB7847FD5BDF154_6569',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_5',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_E1987AC6947525FC'
  },
  {
    trackId: 'track_12_shadows_over_the_circuit',
    seed: 735235928,
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_16C61C7F26179A9C_3ce5',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_5',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_67DD4774BF859EDA'
  },
  {
    trackId: 'track_13_waveform_descent',
    seed: 1306015387,
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_F9C6BB2864A7C47E_8834',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_5',
    analysisVersion: 1,
    analysisFingerprint: 'anfp_v1_E0CA9EF8EAB73ACB'
  },
  {
    trackId: 'track_14_kz_ascent',
    seed: 2349050799,
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_C95B69E61B60700F_7859',
    movementVersion: 'phmv1_2865D271',
    generatorVersion: 'gen_5',
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
