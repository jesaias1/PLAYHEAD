/**
 * OFFICIAL MAP REGISTRY — canonical competitive identity for official tracks.
 *
 * ⚠️ REGISTRY_READY IS FALSE. TRUSTED PUBLIC LEADERBOARD SUBMISSION IS DISABLED.
 *
 * WHY (this is a hard prerequisite, not a TODO):
 *
 * A public leaderboard is only valid if every player runs the SAME map. The
 * fingerprint machinery in `MapIdentity.ts` is implemented and deterministic,
 * but the OFFICIAL ANALYSIS SOURCE is not yet canonical:
 *
 *   - `public/music/presets/*.json` currently ship with a STALE numbering that
 *     does not match the live Signal Pack catalog ids
 *     (e.g. the catalog id `track_5_gravity_line` looks for
 *     `track_5_gravity_line.json`, but the file on disk is
 *     `track_4_gravity_line.json`).
 *   - `PresetLevelCache.loadPreset()` therefore 404s and `Game` falls back to
 *     `processBuffer()` -> a full RUNTIME FFT ANALYSIS of the decoded audio.
 *   - That analysis feeds `RouteGenerator.generate()`. Audio decoding and FFT
 *     are float pipelines, so the resulting route (and therefore the map) can
 *     differ between browsers/decoders for the "same" official track.
 *
 * Publishing scores computed on maps that are not provably identical across
 * clients would be publishing competitive scores from DIFFERENT MAPS. So
 * submission stays off until this registry is generated for real.
 *
 * TO ENABLE (see SUPABASE_SETUP.md, step 8):
 *   1. `npm run precompute-presets` (writes presets keyed by catalog id, with a
 *      canonical `analysis` + fully generated `track` including forks/spines/
 *      obstacles and `generationVersion`).
 *   2. Run the registry generator to populate `OFFICIAL_MAP_REGISTRY` below.
 *   3. Flip REGISTRY_READY to true and re-deploy the submit-run function with
 *      the same accepted fingerprints.
 *
 * Local play, local PBs, progression, cloud sync and friend sessions all work
 * with REGISTRY_READY === false. Only PUBLIC RANKING is withheld.
 */

import type { RegistryEntry } from './MapIdentity';

/**
 * False until the canonical presets are regenerated and this table is built
 * from them. While false, `verifyAgainstRegistry` cannot succeed, so the
 * leaderboard service refuses to submit and says why.
 */
export const REGISTRY_READY = false;

/**
 * Canonical identity per official track.
 *
 * Empty on purpose — see the header. Populate via the registry generator after
 * regenerating presets; each entry must be produced by the SAME pipeline the
 * client runs, so the fingerprint matches exactly.
 */
export const OFFICIAL_MAP_REGISTRY: readonly RegistryEntry[] = [];

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
export function getAcceptedFingerprints(): Record<string, { mapVersion: number; mapFingerprint: string; movementVersion: string }> {
  const out: Record<string, { mapVersion: number; mapFingerprint: string; movementVersion: string }> = {};
  for (const entry of OFFICIAL_MAP_REGISTRY) {
    out[entry.trackId] = {
      mapVersion: entry.mapVersion,
      mapFingerprint: entry.mapFingerprint,
      movementVersion: entry.movementVersion
    };
  }
  return out;
}
