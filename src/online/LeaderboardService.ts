/**
 * LEADERBOARD SERVICE — public global boards for official Signal Pack tracks.
 *
 * Only OFFICIAL tracks participate. There is deliberately no world board for
 * arbitrary imported audio: two players importing different songs are not
 * playing the same map, so a shared ranking would be meaningless.
 *
 * Submission rules:
 * - Competitive submission is gated on CANONICAL MAP IDENTITY. The locally
 *   computed identity must match the shipped registry, otherwise the run is
 *   kept locally and the player is told why. See OfficialMapRegistry.
 * - The client never writes a trusted row directly. It calls the `submit-run`
 *   Edge Function, which re-validates identity, bounds, DEV state and metadata
 *   server-side, then performs an atomic PB upsert.
 * - Reads are public and cheap: only display name, time, rank and the metadata
 *   needed to display/verify a run.
 */

import { OnlineClient, online } from './supabaseClient';
import { AuthService, authService } from './AuthService';
import { MapIdentity, verifyAgainstRegistry } from './MapIdentity';
import {
  OFFICIAL_MAP_REGISTRY,
  REGISTRY_READY,
  REGISTRY_BLOCKED_REASON
} from './OfficialMapRegistry';

export interface LeaderboardEntry {
  rankPosition: number;
  /** Canonical track this run belongs to. */
  trackId: string;
  displayName: string;
  timeUs: number;
  rank: string;
  userId: string;
  runId: string;
  verificationState: string;
  createdAt: string;
  replayVersion: number | null;
  replayPath: string | null;
  /** Integrity hash recorded for the replay bytes. */
  replayHash: string | null;
}

export interface LeaderboardView {
  trackId: string;
  entries: LeaderboardEntry[];
  /** The requesting player's own best, if any. */
  you: { timeUs: number; position: number | null; displayName: string } | null;
  /** True when the backend could not be reached; entries must not be faked. */
  offline: boolean;
}

export interface RunSubmission {
  identity: MapIdentity;
  timeUs: number;
  rank: string;
  checkpointCount: number;
  resetCount: number;
  devMode: boolean;
  replayVersion?: number;
  replayHash?: string;
  replayPath?: string;
}

export type SubmitOutcome =
  | { ok: true; verificationState: 'accepted' | 'flagged'; runId: string; isPersonalBest: boolean }
  | {
      ok: false;
      reason:
        | 'OFFLINE'
        | 'NOT_AUTHENTICATED'
        | 'REGISTRY_NOT_READY'
        | 'IDENTITY_MISMATCH'
        | 'DEV_RUN'
        | 'INVALID_TIME'
        | 'REJECTED'
        | 'ERROR';
      detail: string;
    };

/** Sanity bounds. Deliberately wide: this is V1 cheat *resistance*, not proof. */
export const MIN_PLAUSIBLE_TIME_US = 8_000_000;      // 8 s
export const MAX_PLAUSIBLE_TIME_US = 30 * 60_000_000; // 30 min

export class LeaderboardService {
  constructor(
    private readonly onlineClient: OnlineClient = online,
    private readonly auth: AuthService = authService
  ) {}

  /**
   * Reads the public board for one official track + map identity.
   * Returns `offline: true` with no entries when the backend is unavailable —
   * it never fabricates a WORLD ranking.
   */
  public async fetchLeaderboard(
    trackId: string,
    identity: MapIdentity,
    limit = 25
  ): Promise<LeaderboardView> {
    const client = this.onlineClient.getClient();
    const empty: LeaderboardView = { trackId, entries: [], you: null, offline: true };
    if (!client) return empty;

    try {
      const { data, error } = await client
        .from('leaderboard_runs')
        .select('id, user_id, display_name, time_us, rank, verification_state, created_at, replay_version, replay_path, replay_hash')
        .eq('track_id', trackId)
        .eq('map_version', identity.mapVersion)
        .eq('map_fingerprint', identity.mapFingerprint)
        .eq('verification_state', 'accepted')
        .order('time_us', { ascending: true })
        .limit(limit);

      if (error) throw error;

      const entries: LeaderboardEntry[] = (data ?? []).map((row, index) => ({
        rankPosition: index + 1,
        trackId,
        displayName: (row.display_name as string) ?? 'PLAYER',
        timeUs: Number(row.time_us),
        rank: (row.rank as string) ?? 'UNRANKED',
        userId: row.user_id as string,
        runId: row.id as string,
        verificationState: (row.verification_state as string) ?? 'accepted',
        createdAt: (row.created_at as string) ?? '',
        replayVersion: (row.replay_version as number | null) ?? null,
        replayPath: (row.replay_path as string | null) ?? null,
        replayHash: (row.replay_hash as string | null) ?? null
      }));

      const userId = this.auth.getUserId();
      let you: LeaderboardView['you'] = null;
      if (userId) {
        const own = entries.find((e) => e.userId === userId);
        if (own) {
          you = { timeUs: own.timeUs, position: own.rankPosition, displayName: own.displayName };
        } else {
          const { data: best } = await client
            .from('leaderboard_runs')
            .select('time_us, display_name')
            .eq('track_id', trackId)
            .eq('map_version', identity.mapVersion)
            .eq('map_fingerprint', identity.mapFingerprint)
            .eq('user_id', userId)
            .eq('verification_state', 'accepted')
            .order('time_us', { ascending: true })
            .limit(1)
            .maybeSingle();
          if (best) {
            you = {
              timeUs: Number(best.time_us),
              position: null,
              displayName: (best.display_name as string) ?? 'PLAYER'
            };
          }
        }
      }

      return { trackId, entries, you, offline: false };
    } catch {
      this.onlineClient.setStatus('ERROR');
      return empty;
    }
  }

  /**
   * Client-side pre-flight. Mirrors the server checks so the player gets an
   * immediate, honest reason instead of a silent drop.
   */
  public preflight(submission: RunSubmission): SubmitOutcome | null {
    if (!this.onlineClient.getClient() || !this.auth.isSignedIn()) {
      return { ok: false, reason: 'OFFLINE', detail: 'not connected / not signed in' };
    }
    if (!REGISTRY_READY) {
      return { ok: false, reason: 'REGISTRY_NOT_READY', detail: REGISTRY_BLOCKED_REASON };
    }
    if (submission.devMode) {
      return { ok: false, reason: 'DEV_RUN', detail: 'DEV runs never submit to the public board' };
    }
    if (!Number.isFinite(submission.timeUs) || submission.timeUs <= 0) {
      return { ok: false, reason: 'INVALID_TIME', detail: 'non-finite or non-positive time' };
    }
    if (submission.timeUs < MIN_PLAUSIBLE_TIME_US || submission.timeUs > MAX_PLAUSIBLE_TIME_US) {
      return {
        ok: false,
        reason: 'INVALID_TIME',
        detail: `outside plausible bounds (${MIN_PLAUSIBLE_TIME_US}..${MAX_PLAUSIBLE_TIME_US} us)`
      };
    }
    const verdict = verifyAgainstRegistry(submission.identity, OFFICIAL_MAP_REGISTRY);
    if (!verdict.ok) {
      return { ok: false, reason: 'IDENTITY_MISMATCH', detail: verdict.detail };
    }
    return null;
  }

  /** True when competitive submission is possible right now. */
  public canSubmitCompetitively(): { ok: boolean; detail: string } {
    if (!REGISTRY_READY) return { ok: false, detail: REGISTRY_BLOCKED_REASON };
    if (!this.onlineClient.getClient()) return { ok: false, detail: 'offline' };
    if (!this.auth.isSignedIn()) return { ok: false, detail: 'not signed in' };
    return { ok: true, detail: 'ready' };
  }

  /**
   * Submits an official run through the `submit-run` Edge Function.
   * The server is the authority; a client rejection here is advisory.
   */
  public async submitRun(submission: RunSubmission): Promise<SubmitOutcome> {
    const preflight = this.preflight(submission);
    if (preflight) return preflight;

    const client = this.onlineClient.getClient()!;
    try {
      const { data, error } = await client.functions.invoke('submit-run', {
        body: {
          track_id: submission.identity.trackId,
          map_version: submission.identity.mapVersion,
          map_fingerprint: submission.identity.mapFingerprint,
          movement_version: submission.identity.movementVersion,
          generator_version: submission.identity.generatorVersion,
          time_us: Math.round(submission.timeUs),
          rank: submission.rank,
          checkpoint_count: submission.checkpointCount,
          reset_count: submission.resetCount,
          dev: submission.devMode,
          replay_version: submission.replayVersion ?? null,
          replay_hash: submission.replayHash ?? null,
          replay_path: submission.replayPath ?? null
        }
      });

      if (error) {
        return { ok: false, reason: 'ERROR', detail: error.message };
      }

      const payload = data as {
        accepted?: boolean;
        verification_state?: 'accepted' | 'flagged' | 'rejected';
        run_id?: string;
        is_personal_best?: boolean;
        reason?: string;
      } | null;

      if (!payload || payload.accepted !== true) {
        return {
          ok: false,
          reason: 'REJECTED',
          detail: payload?.reason ?? 'server rejected the run'
        };
      }

      return {
        ok: true,
        verificationState: payload.verification_state === 'flagged' ? 'flagged' : 'accepted',
        runId: payload.run_id ?? '',
        isPersonalBest: payload.is_personal_best === true
      };
    } catch (err) {
      return { ok: false, reason: 'ERROR', detail: err instanceof Error ? err.message : String(err) };
    }
  }
}

export const leaderboardService = new LeaderboardService();
