// =============================================================================
// account-auth — no-email USERNAME + PASSWORD accounts.
//
// The player creates an account with a username and a password and NO email.
// Passwords are hashed and verified by Supabase Auth (GoTrue, bcrypt); this
// function never sees or stores a password beyond the single call it forwards to
// GoTrue. The username maps 1:1 to a deterministic internal address
// `<username_norm>@players.playhead.local` so GoTrue owns hashing, the session
// and the JWT, while the durable identity stays `auth.users.id` — the same key
// every existing progression, PB, replay and RLS policy already uses.
//
// The service role lives only here. The browser never holds it.
//
// Deploy:  supabase functions deploy account-auth
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,20}$/;
const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 200;
const INTERNAL_DOMAIN = 'players.playhead.local';

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

function fail(reason: string, detail: string, status = 200): Response {
  return json({ ok: false, reason, detail }, status);
}

function internalEmail(usernameNorm: string): string {
  return `${usernameNorm}@${INTERNAL_DOMAIN}`;
}

interface SessionPayload {
  ok: true;
  user_id: string;
  username: string;
  display_name: string;
  access_token: string;
  refresh_token: string;
  expires_at: number | null;
}

function sessionPayload(
  userId: string,
  username: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: number | null
): SessionPayload {
  return {
    ok: true,
    user_id: userId,
    username,
    display_name: username,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'POST only', 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return fail('SERVER_MISCONFIGURED', 'credentials unavailable', 500);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail('BAD_REQUEST', 'body is not JSON', 400);
  }

  const action = typeof body.action === 'string' ? body.action : '';
  const rawUsername = typeof body.username === 'string' ? body.username.trim() : '';
  const usernameNorm = rawUsername.toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';

  // ---- session: resolve the CURRENT authenticated identity -------------------
  if (action === 'session') {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return fail('NOT_AUTHENTICATED', 'no token', 401);
    const { data, error } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (error || !data?.user) return fail('NOT_AUTHENTICATED', error?.message ?? 'invalid', 401);
    const { data: acct } = await admin
      .from('accounts')
      .select('username')
      .eq('user_id', data.user.id)
      .maybeSingle();
    const username = (acct?.username as string | undefined) ?? '';
    return json({ ok: true, user_id: data.user.id, username, display_name: username });
  }

  if (action !== 'register' && action !== 'login') {
    return fail('BAD_REQUEST', 'unknown action');
  }

  // ---- shared validation -----------------------------------------------------
  if (!USERNAME_RE.test(rawUsername)) {
    return fail('INVALID_USERNAME', 'use 3-20 letters, numbers, _ . or -');
  }
  if (password.length < MIN_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN) {
    return fail('INVALID_PASSWORD', `password must be ${MIN_PASSWORD_LEN}-${MAX_PASSWORD_LEN} characters`);
  }
  const email = internalEmail(usernameNorm);

  // A client that has already linked an email to this account (a later feature)
  // still logs in with username + password; we never surface the internal email.

  if (action === 'register') {
    // UNIQUE USERNAME: the table's unique index is the authority; this check is a
    // friendly pre-flight, and the insert below still guards the race.
    const { data: taken } = await admin
      .from('accounts')
      .select('user_id')
      .eq('username_norm', usernameNorm)
      .maybeSingle();
    if (taken) return fail('USERNAME_TAKEN', 'that username is already in use');

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: rawUsername }
    });
    if (createError || !created?.user) {
      // A concurrent registration can win the unique constraint.
      const msg = createError?.message ?? 'account creation failed';
      if (/already|exists|duplicate/i.test(msg)) {
        return fail('USERNAME_TAKEN', 'that username is already in use');
      }
      return fail('REGISTER_FAILED', msg, 500);
    }

    const userId = created.user.id;
    const { error: acctError } = await admin
      .from('accounts')
      .insert({ user_id: userId, username: rawUsername, username_norm: usernameNorm });
    if (acctError) {
      // Roll the orphan auth user back so a retry can succeed cleanly.
      await admin.auth.admin.deleteUser(userId);
      if (/duplicate|unique/i.test(acctError.message)) {
        return fail('USERNAME_TAKEN', 'that username is already in use');
      }
      return fail('REGISTER_FAILED', acctError.message, 500);
    }

    // The leaderboard reads profiles.display_name; mirror the username there.
    // update-then-insert so a pre-existing anonymous profile row is adopted.
    const { error: profError } = await admin
      .from('profiles')
      .upsert(
        { id: userId, display_name: rawUsername, updated_at: new Date().toISOString() },
        { onConflict: 'id' }
      );
    if (profError) return fail('REGISTER_FAILED', profError.message, 500);

    // Sign the new account in so the caller receives a real session immediately.
    const { data: signIn, error: signInError } = await admin.auth.signInWithPassword({
      email,
      password
    });
    if (signInError || !signIn?.session || !signIn.user) {
      return fail('REGISTER_FAILED', signInError?.message ?? 'sign-in after register failed', 500);
    }
    return json(
      sessionPayload(
        signIn.user.id,
        rawUsername,
        signIn.session.access_token,
        signIn.session.refresh_token,
        signIn.session.expires_at ?? null
      )
    );
  }

  // ---- login -----------------------------------------------------------------
  const { data: acct, error: acctError } = await admin
    .from('accounts')
    .select('user_id, username')
    .eq('username_norm', usernameNorm)
    .maybeSingle();
  if (acctError) return fail('LOGIN_FAILED', acctError.message, 500);
  if (!acct) return fail('BAD_CREDENTIALS', 'unknown username or password');

  const { data: signIn, error: signInError } = await admin.auth.signInWithPassword({
    email,
    password
  });
  if (signInError || !signIn?.session || !signIn.user) {
    return fail('BAD_CREDENTIALS', 'unknown username or password');
  }
  return json(
    sessionPayload(
      signIn.user.id,
      (acct.username as string) ?? rawUsername,
      signIn.session.access_token,
      signIn.session.refresh_token,
      signIn.session.expires_at ?? null
    )
  );
});
