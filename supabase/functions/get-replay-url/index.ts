// =============================================================================
// get-replay-url — authorized retrieval of a leaderboard replay.
//
// The `run-replays` bucket is PRIVATE. This function is the only way another
// player can watch someone else's run, and it only ever issues a short-lived
// signed URL for an ACCEPTED public leaderboard run.
//
// Rules enforced here:
//   - the caller must be authenticated
//   - the run must exist
//   - the run must be verification_state = 'accepted' AND have a replay_path
//     UNLESS the caller owns the run (an owner may always read their own replay)
//   - the signed URL is short-lived (default 120 s)
//
// Explicitly NOT possible: listing the bucket, reading another user's private or
// non-leaderboard replay, or obtaining a permanent public URL.
//
// Deploy:  supabase functions deploy get-replay-url
// Secrets: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by the runtime.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BUCKET = 'run-replays';
const SIGNED_URL_TTL_SECONDS = 120;

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

function deny(reason: string, detail: string, status = 200): Response {
  return json({ ok: false, reason, detail }, status);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return deny('METHOD_NOT_ALLOWED', 'POST only', 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return deny('SERVER_MISCONFIGURED', 'service credentials unavailable', 500);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return deny('NOT_AUTHENTICATED', 'missing bearer token', 401);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: userData, error: userError } = await admin.auth.getUser(
    authHeader.replace('Bearer ', '')
  );
  if (userError || !userData?.user) {
    return deny('NOT_AUTHENTICATED', userError?.message ?? 'invalid token', 401);
  }
  const callerId = userData.user.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return deny('BAD_REQUEST', 'body is not JSON', 400);
  }

  const runId = typeof body.run_id === 'string' ? body.run_id : '';
  if (!runId) return deny('MISSING_METADATA', 'run_id required');

  const { data: run, error: runError } = await admin
    .from('leaderboard_runs')
    .select('id, user_id, verification_state, replay_path, replay_hash, replay_version')
    .eq('id', runId)
    .maybeSingle();

  if (runError) return deny('LOOKUP_FAILED', runError.message, 500);
  if (!run) return deny('NOT_FOUND', 'run does not exist');

  const isOwner = run.user_id === callerId;
  const isPublicAccepted = run.verification_state === 'accepted';

  // The owner may read their own replay regardless of state; everyone else only
  // for an accepted public leaderboard run.
  if (!isOwner && !isPublicAccepted) {
    return deny('NOT_PUBLIC', 'only accepted leaderboard runs are publicly watchable');
  }

  const path = run.replay_path as string | null;
  if (!path) return deny('NO_REPLAY', 'this run has no replay attached');

  // Defence in depth: the path must live under the run owner's folder. This
  // prevents a malformed row from pointing at someone else's object.
  const ownerPrefix = `${run.user_id}/`;
  if (!path.startsWith(ownerPrefix)) {
    return deny('INVALID_PATH', 'replay path is not owned by the run owner');
  }

  const { data: signed, error: signError } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (signError || !signed?.signedUrl) {
    return deny('SIGN_FAILED', signError?.message ?? 'could not sign the replay URL', 500);
  }

  return json({
    ok: true,
    url: signed.signedUrl,
    expiresIn: SIGNED_URL_TTL_SECONDS,
    replayVersion: run.replay_version ?? null,
    replayHash: run.replay_hash ?? null
  });
});
