/**
 * SUPABASE CLIENT — the single online entry point for PLAYHEAD.
 *
 * Rules this module enforces:
 * - The browser bundle may contain ONLY the publishable key. Never a
 *   service_role / secret key, never a database password, never a JWT secret.
 * - Missing configuration is a normal state, not an error. PLAYHEAD must launch
 *   and be fully playable offline; nothing here may throw into the game loop.
 * - Clean status is exposed so the UI can show ONLINE / OFFLINE / CONNECTING /
 *   ERROR without guessing.
 *
 * Vite env (NOT NEXT_PUBLIC_*):
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_PUBLISHABLE_KEY
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type OnlineStatus = 'OFFLINE' | 'CONNECTING' | 'ONLINE' | 'ERROR';

export interface OnlineConfig {
  url: string;
  publishableKey: string;
}

function readEnv(): OnlineConfig | null {
  // import.meta.env is statically replaced by Vite; guard for non-Vite runtimes
  // (tests, node scripts) where it may be absent.
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  if (!env) return null;
  const url = env.VITE_SUPABASE_URL;
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;
  // Defensive: refuse anything that looks like a privileged credential.
  if (/service_role|sb_secret_|secret/i.test(publishableKey)) {
    console.error(
      '[ONLINE] Refusing to initialise: the configured key looks like a privileged ' +
      'credential. Only the publishable key may ship in the browser bundle.'
    );
    return null;
  }
  return { url, publishableKey };
}

type StatusListener = (status: OnlineStatus) => void;

export class OnlineClient {
  private static instance: OnlineClient | null = null;

  private client: SupabaseClient | null = null;
  private status: OnlineStatus = 'OFFLINE';
  private lastError: string | null = null;
  private listeners = new Set<StatusListener>();

  private constructor() {
    const config = readEnv();
    if (!config) {
      this.status = 'OFFLINE';
      return;
    }
    try {
      this.client = createClient(config.url, config.publishableKey, {
        auth: {
          // Anonymous-first: no signup wall, session persisted by the SDK.
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        },
        realtime: {
          // Realtime is presentation only; keep the connection lazy and cheap.
          params: { eventsPerSecond: 12 }
        }
      });
      this.status = 'CONNECTING';
    } catch (err) {
      this.status = 'ERROR';
      this.lastError = err instanceof Error ? err.message : String(err);
      console.warn('[ONLINE] Supabase client init failed; running offline.', this.lastError);
    }
  }

  public static getInstance(): OnlineClient {
    if (!OnlineClient.instance) OnlineClient.instance = new OnlineClient();
    return OnlineClient.instance;
  }

  /** Test seam: replace the singleton with a mocked instance. */
  public static __setInstanceForTests(instance: OnlineClient | null): void {
    OnlineClient.instance = instance;
  }

  /** Test seam: build a client around an injected Supabase client. */
  public static __createWithClientForTests(client: SupabaseClient | null): OnlineClient {
    const online = Object.create(OnlineClient.prototype) as OnlineClient;
    (online as unknown as { client: SupabaseClient | null }).client = client;
    (online as unknown as { status: OnlineStatus }).status = client ? 'ONLINE' : 'OFFLINE';
    (online as unknown as { listeners: Set<StatusListener> }).listeners = new Set();
    (online as unknown as { lastError: string | null }).lastError = null;
    return online;
  }

  public isConfigured(): boolean {
    return this.client !== null;
  }

  public getStatus(): OnlineStatus {
    return this.status;
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  /** Raw client, or null when unconfigured. Callers must handle null. */
  public getClient(): SupabaseClient | null {
    return this.client;
  }

  public setStatus(status: OnlineStatus, error?: string): void {
    this.status = status;
    this.lastError = error ?? null;
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch {
        /* listener errors must never propagate into the game loop */
      }
    }
  }

  public subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    // The initial call is guarded for the same reason as setStatus: a listener
    // must never be able to throw into the game loop.
    try {
      listener(this.status);
    } catch {
      /* ignore */
    }
    return () => this.listeners.delete(listener);
  }

  /** Human-facing short tag for the HUD / settings panel. */
  public getStatusLabel(): string {
    switch (this.status) {
      case 'ONLINE':
        return '[ONLINE]';
      case 'CONNECTING':
        return '[CONNECTING]';
      case 'ERROR':
        return '[LOCAL // SYNC PENDING]';
      default:
        return '[OFFLINE]';
    }
  }
}

export const online = OnlineClient.getInstance();
