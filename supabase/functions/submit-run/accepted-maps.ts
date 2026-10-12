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
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_353746C55C006F8F_40eb',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_2_flow_state',
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_91E6F2193CAC2575_9fb5',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_3_surf_the_void',
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_5BD5BC95441CADE0_76bd',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_4_airwave_theory',
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_E36816C6E32910F9_6c74',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_5_gravity_line',
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_6F6D8F838F7A0B2B_5f58',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_6_over_the_edge',
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_90C1235B38E216DA_6d54',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_7_drop_zone_surfer',
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_279625215A8CEC6E_7ef3',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_8_wave_surfing',
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_293E4C7E5F4974B6_6c44',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_9_neon_abyss',
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_42ED0370C2115403_4065',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_10_neon_slipstream',
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_C24426E7E32ED2F1_4231',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_11_ex_gravity',
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_5BDCB2F04EE51DE8_519b',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_12_shadows_over_the_circuit',
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_1F65CF72467D0E3A_3c89',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_13_waveform_descent',
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_1CE0F554D66FC35D_7b6e',
    movementVersion: 'phmv1_2865D271'
  },
  {
    trackId: 'track_14_kz_ascent',
    mapVersion: 6,
    mapFingerprint: 'mfp_v1_81D43071B9661612_7340',
    movementVersion: 'phmv1_2865D271'
  }
];
