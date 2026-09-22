/**
 * ACCEPTED CANONICAL MAPS — the server's copy of the official map registry.
 *
 * ⚠️ GENERATED FILE. DO NOT EDIT BY HAND.
 *
 * Regenerate with:
 *   npm run precompute-presets
 *   WRITE_REGISTRY=1 npx vitest run tests/CanonicalOfficialMaps.test.ts
 *
 * It is emitted from the SAME computation that produces
 * `src/online/OfficialMapRegistry.ts`, so the client and the server can never
 * disagree about which maps are canonical.
 *
 * The submit-run function accepts a run ONLY when its track_id, map_version,
 * map_fingerprint and movement_version all match an entry here.
 */

export interface AcceptedMap {
  trackId: string;
  mapVersion: number;
  mapFingerprint: string;
  movementVersion: string;
}

export const ACCEPTED_MAPS: AcceptedMap[] = [
  {
    trackId: 'track_1_signal_drift',
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_2AC7467E29419C32_40eb',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_2_flow_state',
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_B1EEF8A8434DD30E_b8eb',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_3_surf_the_void',
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_5E0500352418B06D_7a0e',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_4_airwave_theory',
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_A62A03D1A5DE1F81_766c',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_5_gravity_line',
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_1CB4B484B698E2E2_6515',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_6_over_the_edge',
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_B6AC926A38515910_6f75',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_7_drop_zone_surfer',
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_02C4103B70DC8E14_8fa6',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_8_wave_surfing',
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_48CC984100DD6740_739a',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_9_neon_abyss',
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_0D8A10180466F0B4_4540',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_10_neon_slipstream',
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_F84D156F59CB8DB4_42c8',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_11_ex_gravity',
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_4CB7847FD5BDF154_6569',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_12_shadows_over_the_circuit',
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_16C61C7F26179A9C_3ce5',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_13_waveform_descent',
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_F9C6BB2864A7C47E_8834',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_14_kz_ascent',
    mapVersion: 5,
    mapFingerprint: 'mfp_v1_C95B69E61B60700F_7859',
    movementVersion: 'phmv1_2865D271'
  }
];
