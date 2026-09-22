/**
 * ONLINE BOOTSTRAP — non-blocking online startup.
 *
 * Called once when the game is ready. Everything here is fire-and-forget:
 *
 * - It must NEVER block or delay gameplay.
 * - It must NEVER throw into the game loop.
 * - If Supabase is unconfigured or unreachable, PLAYHEAD plays exactly as before
 *   and progression stays local.
 *
 * The only work done eagerly is: check for a `?room=` invite, ensure an
 * anonymous session, then reconcile progression.
 */

import { OnlineClient, online } from './supabaseClient';
import { authService } from './AuthService';
import { cloudProgression } from './CloudProgression';
import { RaceRoomService } from './RaceRoomService';

export type OnlineSyncState =
  | 'DISABLED'
  | 'SIGNED_OUT'
  | 'SIGNING_IN'
  | 'SYNCING'
  | 'SYNCED'
  | 'MIGRATED'
  | 'ERROR';

export interface OnlineBootstrapStatus {
  state: OnlineSyncState;
  detail: string;
  pendingOperations: number;
  lastSyncAt: number;
}

class OnlineBootstrap {
  private status: OnlineBootstrapStatus = {
    state: 'DISABLED',
    detail: 'not started',
    pendingOperations: 0,
    lastSyncAt: 0
  };
  private started = false;
  private listeners = new Set<(status: OnlineBootstrapStatus) => void>();

  public getStatus(): OnlineBootstrapStatus {
    return { ...this.status, pendingOperations: cloudProgression.getQueueLength() };
  }

  public subscribe(listener: (status: OnlineBootstrapStatus) => void): () => void {
    this.listeners.add(listener);
    try {
      listener(this.getStatus());
    } catch {
      /* ignore */
    }
    return () => this.listeners.delete(listener);
  }

  private setStatus(state: OnlineSyncState, detail: string): void {
    this.status = {
      state,
      detail,
      pendingOperations: cloudProgression.getQueueLength(),
      lastSyncAt: cloudProgression.getLastSyncAt()
    };
    for (const listener of this.listeners) {
      try {
        listener(this.getStatus());
      } catch {
        /* ignore */
      }
    }
  }

  /** Invite code present in the current URL, if any. */
  public getPendingInviteCode(): string | null {
    return RaceRoomService.readInviteCodeFromUrl();
  }

  /**
   * Idempotent. Returns immediately; all work happens in the background.
   */
  public start(): void {
    if (this.started) return;
    this.started = true;

    if (!online.isConfigured()) {
      this.setStatus('DISABLED', 'Supabase not configured; running local-only');
      return;
    }

    this.setStatus('SIGNING_IN', 'ensuring anonymous session');
    void this.run().catch((err) => {
      this.setStatus('ERROR', err instanceof Error ? err.message : String(err));
    });
  }

  private async run(): Promise<void> {
    const session = await authService.ensureSession();
    if (!session.ok) {
      this.setStatus('SIGNED_OUT', session.detail);
      return;
    }

    this.setStatus('SYNCING', 'reconciling progression');
    const result = await cloudProgression.sync();
    if (result === 'MIGRATED') {
      this.setStatus('MIGRATED', 'local progression migrated to cloud');
    } else if (result === 'SYNCED') {
      this.setStatus('SYNCED', 'progression in sync');
    } else if (result === 'OFFLINE') {
      this.setStatus('DISABLED', 'offline; local progression preserved');
    } else {
      this.setStatus('ERROR', 'progression sync failed; local preserved');
    }
  }

  /** Retry entry point for the UI (e.g. after reconnecting). */
  public retry(): void {
    if (!online.isConfigured()) return;
    this.setStatus('SYNCING', 'retrying');
    void this.run().catch((err) => {
      this.setStatus('ERROR', err instanceof Error ? err.message : String(err));
    });
  }

  public getClient(): OnlineClient {
    return online;
  }
}

export const onlineBootstrap = new OnlineBootstrap();
