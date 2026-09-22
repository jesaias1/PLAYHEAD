/**
 * REPLAY STORAGE — private bucket, authorized retrieval only.
 *
 * The `run-replays` bucket stays PRIVATE. There is no public URL and no bucket
 * listing. Retrieval rules:
 *
 *   - a player may read their OWN replay directly (owner-scoped Storage policy)
 *   - ANY authenticated player may read the replay of an ACCEPTED public
 *     leaderboard run, but only through the `get-replay-url` Edge Function,
 *     which verifies the run is accepted and then issues a short-lived signed
 *     URL
 *   - nothing else is retrievable: no arbitrary browsing, no other user's
 *     private/non-leaderboard files
 *
 * The browser never holds a privileged key; the service role lives only in the
 * Edge Function runtime.
 */

import { OnlineClient, online } from './supabaseClient';
import { AuthService, authService } from './AuthService';
import { PovReplay, computeReplayHash, encodePovReplay } from '../replay/pov/PovReplayFormat';

export const REPLAY_BUCKET = 'run-replays';

export interface ReplayUploadResult {
  ok: boolean;
  path?: string;
  hash?: string;
  detail?: string;
}

export interface ReplayFetchResult {
  ok: boolean;
  payload?: string;
  detail?: string;
}

/** Storage path for one replay: owner-scoped, deterministic and collision-free. */
export function buildReplayPath(
  userId: string,
  trackId: string,
  finishTimeUs: number,
  hash: string
): string {
  // The first path segment MUST be the user id: the Storage policy authorises
  // uploads by (storage.foldername(name))[1] = auth.uid().
  const safeTrack = trackId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const shortHash = hash.replace(/[^a-zA-Z0-9_]/g, '_');
  return `${userId}/${safeTrack}/${finishTimeUs}-${shortHash}.json`;
}

export class ReplayStorageService {
  /** Locally finalised replays, so WATCH works instantly after a run. */
  private localCache = new Map<string, string>();

  constructor(
    private readonly onlineClient: OnlineClient = online,
    private readonly auth: AuthService = authService
  ) {}

  private cacheKey(trackId: string, finishTimeUs: number): string {
    return `${trackId}:${finishTimeUs}`;
  }

  /** Keeps a finished replay available locally without any round trip. */
  public rememberLocally(replay: PovReplay): void {
    try {
      const payload = encodePovReplay(replay);
      // Bounded cache: keep only the most recent few.
      if (this.localCache.size >= 6) {
        const first = this.localCache.keys().next().value;
        if (first !== undefined) this.localCache.delete(first);
      }
      this.localCache.set(this.cacheKey(replay.identity.trackId, replay.finishTimeUs), payload);
    } catch {
      /* cache is a convenience only */
    }
  }

  public getLocal(trackId: string, finishTimeUs: number): string | null {
    return this.localCache.get(this.cacheKey(trackId, finishTimeUs)) ?? null;
  }

  /**
   * Uploads a finalised replay. Returns the storage path + hash to attach to the
   * leaderboard submission.
   *
   * Failure is non-fatal by contract: the caller keeps the local PB and may
   * submit without a replay.
   */
  public async uploadReplay(replay: PovReplay): Promise<ReplayUploadResult> {
    const client = this.onlineClient.getClient();
    const userId = this.auth.getUserId();
    if (!client || !userId) return { ok: false, detail: 'not connected / not signed in' };

    try {
      const payload = encodePovReplay(replay);
      const hash = computeReplayHash(payload);
      const path = buildReplayPath(userId, replay.identity.trackId, replay.finishTimeUs, hash);

      const { error } = await client.storage
        .from(REPLAY_BUCKET)
        .upload(path, payload, {
          contentType: 'application/json',
          upsert: true
        });

      if (error) return { ok: false, detail: error.message };

      this.rememberLocally(replay);
      return { ok: true, path, hash };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Retrieves the replay attached to an ACCEPTED leaderboard run via a
   * short-lived signed URL issued by the Edge Function.
   */
  public async fetchReplayForRun(runId: string): Promise<ReplayFetchResult> {
    const client = this.onlineClient.getClient();
    if (!client) return { ok: false, detail: 'offline' };

    try {
      const { data, error } = await client.functions.invoke('get-replay-url', {
        body: { run_id: runId }
      });
      if (error) return { ok: false, detail: error.message };

      const payload = data as { url?: string; detail?: string } | null;
      if (!payload?.url) {
        return { ok: false, detail: payload?.detail ?? 'no replay available for this run' };
      }

      const response = await fetch(payload.url);
      if (!response.ok) {
        return { ok: false, detail: `replay download failed (${response.status})` };
      }
      return { ok: true, payload: await response.text() };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Owner-scoped direct download (no Edge Function round trip). */
  public async fetchOwnReplay(path: string): Promise<ReplayFetchResult> {
    const client = this.onlineClient.getClient();
    if (!client) return { ok: false, detail: 'offline' };
    try {
      const { data, error } = await client.storage.from(REPLAY_BUCKET).download(path);
      if (error || !data) return { ok: false, detail: error?.message ?? 'download failed' };
      return { ok: true, payload: await data.text() };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }
}

export const replayStorageService = new ReplayStorageService();
