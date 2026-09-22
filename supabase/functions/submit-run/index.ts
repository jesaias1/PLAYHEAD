// =============================================================================
// submit-run — the ONLY path that can create a trusted leaderboard row.
//
// The client has no INSERT policy on `leaderboard_runs`, so a browser cannot
// mint a world record. This function re-validates everything the client claims,
// using the service role (a SERVER-ONLY secret that is never shipped to the
// browser bundle).
//
// Deploy:  supabase functions deploy submit-run
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically
//          by the Supabase runtime. Do NOT add a service key to any VITE_ var.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// -----------------------------------------------------------------------------
// ACCEPTED CANONICAL MAPS
//
// GENERATED from the same computation as src/online/OfficialMapRegistry.ts.
// Regenerate with:
//   npm run precompute-presets
//   WRITE_REGISTRY=1 npx vitest run tests/CanonicalOfficialMaps.test.ts
// -----------------------------------------------------------------------------
import { ACCEPTED_MAPS } from './accepted-maps.ts';

const MIN_PLAUSIBLE_TIME_US = 8_000_000;        // 8 s
const MAX_PLAUSIBLE_TIME_US = 30 * 60_000_000;  // 30 min
const MAX_CHECKPOINTS = 512;
const MAX_RESETS = 100_000;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

function reject(reason: string, detail: string, status = 200): Response {
  return json({ accepted: false, verification_state: 'rejected', reason, detail }, status);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return reject('METHOD_NOT_ALLOWED', 'POST only', 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return reject('SERVER_MISCONFIGURED', 'service credentials unavailable', 500);
  }

  // Authenticate the CALLER (never trust a user id in the body).
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return reject('NOT_AUTHENTICATED', 'missing bearer token', 401);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: userData, error: userError } = await admin.auth.getUser(
    authHeader.replace('Bearer ', '')
  );
  if (userError || !userData?.user) {
    return reject('NOT_AUTHENTICATED', userError?.message ?? 'invalid token', 401);
  }
  const userId = userData.user.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reject('BAD_REQUEST', 'body is not JSON', 400);
  }

  const trackId = typeof body.track_id === 'string' ? body.track_id : '';
  const mapVersion = Number(body.map_version);
  const mapFingerprint = typeof body.map_fingerprint === 'string' ? body.map_fingerprint : '';
  const movementVersion = typeof body.movement_version === 'string' ? body.movement_version : '';
  const generatorVersion = typeof body.generator_version === 'string' ? body.generator_version : '';
  const buildVersion = typeof body.build_version === 'string' ? body.build_version : 'DEV';
  const rank = typeof body.rank === 'string' ? body.rank : 'UNRANKED';
  const timeUs = Number(body.time_us);
  const checkpointCount = Number(body.checkpoint_count ?? 0);
  const resetCount = Number(body.reset_count ?? 0);
  const dev = body.dev === true;
  const replayVersion = body.replay_version === null || body.replay_version === undefined
    ? null : Number(body.replay_version);
  const replayHash = typeof body.replay_hash === 'string' ? body.replay_hash : null;
  const replayPath = typeof body.replay_path === 'string' ? body.replay_path : null;

  // --- validation -----------------------------------------------------------

  if (dev) {
    // DEV/test progression and DEV runs must never reach production.
    return reject('DEV_RUN', 'DEV runs are never accepted on the public board');
  }

  if (!trackId) return reject('MISSING_METADATA', 'track_id required');
  if (!Number.isInteger(mapVersion) || mapVersion <= 0) {
    return reject('MISSING_METADATA', 'map_version must be a positive integer');
  }
  if (!mapFingerprint) return reject('MISSING_METADATA', 'map_fingerprint required');
  if (!movementVersion) return reject('MISSING_METADATA', 'movement_version required');
  if (!generatorVersion) return reject('MISSING_METADATA', 'generator_version required');

  if (!Number.isFinite(timeUs) || timeUs <= 0) {
    return reject('INVALID_TIME', 'time must be finite and positive');
  }
  if (!Number.isInteger(timeUs)) {
    return reject('INVALID_TIME', 'time must be integer microseconds');
  }
  if (timeUs < MIN_PLAUSIBLE_TIME_US || timeUs > MAX_PLAUSIBLE_TIME_US) {
    return reject('IMPLAUSIBLE_TIME', `time outside ${MIN_PLAUSIBLE_TIME_US}..${MAX_PLAUSIBLE_TIME_US} us`);
  }

  if (!Number.isInteger(checkpointCount) || checkpointCount < 0 || checkpointCount > MAX_CHECKPOINTS) {
    return reject('MALFORMED_CHECKPOINTS', 'checkpoint_count out of range');
  }
  if (!Number.isInteger(resetCount) || resetCount < 0 || resetCount > MAX_RESETS) {
    return reject('MALFORMED_RESETS', 'reset_count out of range');
  }

  // Canonical map identity: the submitted fingerprint must be one this server
  // recognises for that track + version. This is what stops scores from
  // different maps being mixed onto one board.
  const accepted = ACCEPTED_MAPS.find((m) => m.trackId === trackId);
  if (!accepted) {
    return reject(
      'REGISTRY_NOT_READY',
      'no canonical map registered for this track yet; competitive submission is disabled'
    );
  }
  if (accepted.mapVersion !== mapVersion) {
    return reject('WRONG_MAP_VERSION', `expected ${accepted.mapVersion}, got ${mapVersion}`);
  }
  if (accepted.mapFingerprint !== mapFingerprint) {
    return reject('WRONG_MAP_FINGERPRINT', 'map fingerprint does not match the canonical map');
  }
  if (accepted.movementVersion !== movementVersion) {
    return reject('WRONG_MOVEMENT_VERSION', `expected ${accepted.movementVersion}`);
  }

  // --- duplicate request replay guard --------------------------------------
  // Same user + track + identity + exact time within a short window = a replay
  // of the same submission, not a new run.
  const since = new Date(Date.now() - 60_000).toISOString();
  const { data: recent } = await admin
    .from('leaderboard_runs')
    .select('id')
    .eq('user_id', userId)
    .eq('track_id', trackId)
    .eq('map_fingerprint', mapFingerprint)
    .eq('time_us', timeUs)
    .gte('created_at', since)
    .limit(1)
    .maybeSingle();

  if (recent) {
    return json({
      accepted: true,
      verification_state: 'accepted',
      run_id: recent.id,
      is_personal_best: false,
      detail: 'duplicate submission ignored'
    });
  }

  // --- write ----------------------------------------------------------------
  const { data: profile } = await admin
    .from('profiles')
    .select('display_name')
    .eq('id', userId)
    .maybeSingle();

  const { data: inserted, error: insertError } = await admin
    .from('leaderboard_runs')
    .insert({
      user_id: userId,
      display_name: profile?.display_name ?? 'PLAYER',
      track_id: trackId,
      map_version: mapVersion,
      map_fingerprint: mapFingerprint,
      time_us: timeUs,
      rank,
      movement_version: movementVersion,
      generator_version: generatorVersion,
      build_version: buildVersion,
      replay_version: replayVersion,
      replay_hash: replayHash,
      replay_path: replayPath,
      checkpoint_count: checkpointCount,
      reset_count: resetCount,
      verification_state: 'accepted'
    })
    .select('id')
    .single();

  if (insertError || !inserted) {
    return reject('INSERT_FAILED', insertError?.message ?? 'unknown insert error', 500);
  }

  // Atomic PB upsert: the DATABASE decides whether this is a personal best, so
  // two tabs / two devices cannot race a read-modify-write.
  const { data: before } = await admin
    .from('track_progress')
    .select('best_time_us')
    .eq('user_id', userId)
    .eq('track_id', trackId)
    .eq('map_version', mapVersion)
    .eq('map_fingerprint', mapFingerprint)
    .maybeSingle();

  const { error: pbError } = await admin.rpc('upsert_track_progress', {
    p_track_id: trackId,
    p_map_version: mapVersion,
    p_map_fingerprint: mapFingerprint,
    p_best_time_us: timeUs,
    p_best_rank: rank
  });

  const previousBest = before?.best_time_us ?? null;
  const isPersonalBest = pbError === null && (previousBest === null || timeUs < Number(previousBest));

  return json({
    accepted: true,
    verification_state: 'accepted',
    run_id: inserted.id,
    is_personal_best: isPersonalBest
  });
});
