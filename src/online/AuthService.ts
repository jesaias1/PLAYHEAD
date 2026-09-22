/**
 * AUTH — anonymous-first identity for PLAYHEAD.
 *
 * The player must be playing within seconds, so the default account is Supabase
 * Anonymous Auth. No signup wall, no email.
 *
 * Anonymous accounts are device/browser identities. If browser storage is
 * cleared before an account is linked, the identity may be unrecoverable. This
 * module is therefore built around `auth.users.id` as the durable key so that
 * Google / email / Steam linking can later attach to the SAME user row without
 * a data migration.
 */

import type { Session, User } from '@supabase/supabase-js';
import { OnlineClient, online } from './supabaseClient';

export interface PlayerProfile {
  id: string;
  displayName: string;
  createdAt?: string;
}

export type AuthResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'OFFLINE' | 'AUTH_FAILED' | 'PROFILE_FAILED'; detail: string };

/** Readable generated names: PLAYER-A7F2, SIGNAL-3C91. */
export function generateDisplayName(seedHex?: string): string {
  const prefixes = ['PLAYER', 'SIGNAL', 'OPERATOR', 'RUNNER', 'VECTOR', 'PULSE'];
  let hex = seedHex;
  if (!hex) {
    const bytes = new Uint8Array(2);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      bytes[0] = Math.floor(Math.random() * 256);
      bytes[1] = Math.floor(Math.random() * 256);
    }
    hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }
  const prefix = prefixes[Math.abs(hashString(hex)) % prefixes.length];
  return `${prefix}-${hex.slice(0, 4).toUpperCase()}`;
}

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (Math.imul(h, 31) + value.charCodeAt(i)) | 0;
  }
  return h;
}

/** Display-name validation shared by client and server. */
export function validateDisplayName(raw: string): { ok: true; value: string } | { ok: false; detail: string } {
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value.length === 0) return { ok: false, detail: 'name is empty' };
  if (value.length > 24) return { ok: false, detail: 'name must be 24 characters or fewer' };
  // Printable ASCII only: keeps the terminal aesthetic and blocks control
  // characters / RTL spoofing in leaderboards.
  if (!/^[A-Za-z0-9 _.\-]+$/.test(value)) {
    return { ok: false, detail: 'name may only contain letters, numbers, space, _ . -' };
  }
  return { ok: true, value };
}

export class AuthService {
  private currentProfile: PlayerProfile | null = null;
  private initialized = false;

  constructor(private readonly onlineClient: OnlineClient = online) {}

  public getProfile(): PlayerProfile | null {
    return this.currentProfile;
  }

  public getUserId(): string | null {
    return this.currentProfile?.id ?? null;
  }

  public isSignedIn(): boolean {
    return this.currentProfile !== null;
  }

  /**
   * Idempotent: reuses an existing session when present, otherwise creates an
   * anonymous account. Returns a failure (never throws) when offline.
   */
  public async ensureSession(): Promise<AuthResult<PlayerProfile>> {
    const client = this.onlineClient.getClient();
    if (!client) {
      this.onlineClient.setStatus('OFFLINE');
      return { ok: false, reason: 'OFFLINE', detail: 'Supabase not configured' };
    }

    this.onlineClient.setStatus('CONNECTING');

    try {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;

      let session: Session | null = sessionData.session;

      if (!session) {
        const { data, error } = await client.auth.signInAnonymously();
        if (error) {
          this.onlineClient.setStatus('ERROR', error.message);
          return { ok: false, reason: 'AUTH_FAILED', detail: error.message };
        }
        session = data.session;
      }

      const user: User | null = session?.user ?? null;
      if (!user) {
        this.onlineClient.setStatus('ERROR', 'no user in session');
        return { ok: false, reason: 'AUTH_FAILED', detail: 'session contained no user' };
      }

      const profile = await this.ensureProfile(user);
      if (!profile.ok) {
        this.onlineClient.setStatus('ERROR', profile.detail);
        return profile;
      }

      this.currentProfile = profile.value;
      this.initialized = true;
      this.onlineClient.setStatus('ONLINE');
      return profile;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.onlineClient.setStatus('ERROR', detail);
      return { ok: false, reason: 'AUTH_FAILED', detail };
    }
  }

  /** Creates the profile row on first online launch; idempotent afterwards. */
  private async ensureProfile(user: User): Promise<AuthResult<PlayerProfile>> {
    const client = this.onlineClient.getClient();
    if (!client) return { ok: false, reason: 'OFFLINE', detail: 'no client' };

    const { data: existing, error: readError } = await client
      .from('profiles')
      .select('id, display_name, created_at')
      .eq('id', user.id)
      .maybeSingle();

    if (readError) {
      return { ok: false, reason: 'PROFILE_FAILED', detail: readError.message };
    }

    if (existing) {
      return {
        ok: true,
        value: {
          id: existing.id as string,
          displayName: (existing.display_name as string) ?? 'PLAYER',
          createdAt: existing.created_at as string | undefined
        }
      };
    }

    const displayName = generateDisplayName(user.id.replace(/-/g, '').slice(0, 8));
    const { data: created, error: createError } = await client
      .from('profiles')
      .insert({ id: user.id, display_name: displayName })
      .select('id, display_name, created_at')
      .single();

    if (createError || !created) {
      // A concurrent insert may have won the race; re-read rather than fail.
      const { data: retry } = await client
        .from('profiles')
        .select('id, display_name, created_at')
        .eq('id', user.id)
        .maybeSingle();
      if (retry) {
        return {
          ok: true,
          value: {
            id: retry.id as string,
            displayName: (retry.display_name as string) ?? displayName
          }
        };
      }
      return {
        ok: false,
        reason: 'PROFILE_FAILED',
        detail: createError?.message ?? 'profile insert failed'
      };
    }

    return {
      ok: true,
      value: {
        id: created.id as string,
        displayName: created.display_name as string,
        createdAt: created.created_at as string | undefined
      }
    };
  }

  /** Player-facing rename. Safe fields only; RLS restricts to own row. */
  public async setDisplayName(raw: string): Promise<AuthResult<string>> {
    const client = this.onlineClient.getClient();
    if (!client || !this.currentProfile) {
      return { ok: false, reason: 'OFFLINE', detail: 'not signed in' };
    }
    const validated = validateDisplayName(raw);
    if (!validated.ok) return { ok: false, reason: 'PROFILE_FAILED', detail: validated.detail };

    const { error } = await client
      .from('profiles')
      .update({ display_name: validated.value, updated_at: new Date().toISOString() })
      .eq('id', this.currentProfile.id);

    if (error) return { ok: false, reason: 'PROFILE_FAILED', detail: error.message };

    this.currentProfile = { ...this.currentProfile, displayName: validated.value };
    return { ok: true, value: validated.value };
  }

  public isInitialized(): boolean {
    return this.initialized;
  }

  public reset(): void {
    this.currentProfile = null;
    this.initialized = false;
  }
}

export const authService = new AuthService();
