/**
 * PLAYER PROFILE SERVICE — identity for the local player and for others.
 *
 * TWO DELIBERATELY DIFFERENT SOURCES:
 *
 *   LOCAL   the player's own authoritative local progression. Works offline.
 *   PUBLIC  a narrow projection: `public_profiles` for equipped identity, plus
 *           `leaderboard_runs` (already world-readable) for the PUBLIC record.
 *
 * There is NO second source of truth and NO relaxed RLS. A public profile can
 * never read another player's ledgers, drop history, offline queue, auth
 * metadata or private storage paths, because the projection does not return them
 * and the underlying tables remain owner-scoped.
 *
 * Mastery is computed by the SAME `MasteryLadder` the Armory, Signal Pack and
 * Results screens use. Nothing is recalculated with different rules.
 */

import { SignalPackCatalog } from '../audio/SignalPackCatalog';
import { OFFICIAL_MAP_REGISTRY } from './OfficialMapRegistry';
import { OnlineClient, online } from './supabaseClient';
import { AuthService, authService } from './AuthService';
import { LeaderboardManager } from '../leaderboard/LeaderboardManager';
import { KarambitSkinSystem } from '../viewmodel/KarambitSkinSystem';
import { masteryGloveSystem, MasteryGloveSystem } from '../mastery/MasteryGloveSystem';
import { getDropGlove, isDropGloveId } from '../viewmodel/DropGloveCatalog';
import {
  MasterySummary,
  computeMasterySummary,
  getMasteryGlove
} from '../mastery/MasteryLadder';
import { replayStorageService } from './ReplayStorageService';
import type { RunRank } from '../player/PlayerStats';

/** Intentionally public identity fields. */
export interface PublicIdentity {
  /** Internal join key. NEVER rendered in UI. */
  userId: string;
  displayName: string;
  equippedKnifeId: string;
  equippedGloveId: string;
}

export interface ProfileTrackRow {
  trackId: string;
  title: string;
  rank: RunRank | null;
  /** Integer microseconds, or null when no current-canonical PB exists. */
  timeUs: number | null;
  /** Present only when the run has an accepted public replay. */
  runId: string | null;
  replayHash: string | null;
  hasReplay: boolean;
}

export interface PlayerProfileView {
  /** True for the local player's own profile. */
  isLocal: boolean;
  displayName: string;
  equippedKnifeId: string;
  equippedGloveId: string;
  gloveName: string;
  /**
   * Where the glove came from. A Signal Drop glove must NEVER be described as an
   * achievement.
   */
  gloveSource: 'MASTERY' | 'DROP' | 'NONE';
  /**
   * MASTERY: the achievement requirement.
   * DROP:    its source and rarity, never an achievement claim.
   */
  gloveRequirement: string;
  /** Canonical mastery counts, from the SAME ladder the rest of the game uses. */
  mastery: MasterySummary;
  tracks: ProfileTrackRow[];
  /** Only set when a real accepted leaderboard query returned it. */
  worldPosition: number | null;
  /** True when a remote profile could not be fetched. */
  offline: boolean;
}

/** Current canonical fingerprint per track, from the shipped registry. */
function canonicalFingerprintFor(trackId: string): string | null {
  return OFFICIAL_MAP_REGISTRY.find((e) => e.trackId === trackId)?.mapFingerprint ?? null;
}

/** Every canonical official track, in catalog order. */
function canonicalTrackIds(): string[] {
  return SignalPackCatalog.getTracks().map((t) => t.id);
}

function titleFor(trackId: string): string {
  return SignalPackCatalog.getTrackById(trackId)?.title ?? trackId;
}

function isRunRank(value: unknown): value is RunRank {
  return value === 'BRONZE' || value === 'SILVER' || value === 'GOLD' || value === 'DIAMOND';
}

/**
 * Honest glove description.
 *
 * A MASTERY glove is described by the achievement it required. A SIGNAL DROP
 * glove is described by its SOURCE and rarity - never as an achievement, because
 * it was rolled, not earned.
 */
export function describeGloveSource(gloveId: string, masteryRequirement: string): string {
  if (isDropGloveId(gloveId)) {
    const drop = getDropGlove(gloveId);
    return drop ? `SIGNAL DROP // ${drop.rarity}` : 'SIGNAL DROP';
  }
  return masteryRequirement;
}

function normalizeGloveSource(value: 'MASTERY' | 'DROP' | 'UNKNOWN'): 'MASTERY' | 'DROP' | 'NONE' {
  return value === 'UNKNOWN' ? 'NONE' : value;
}

export class PlayerProfileService {
  constructor(
    private readonly onlineClient: OnlineClient = online,
    private readonly auth: AuthService = authService
  ) {}

  // -- public identity ------------------------------------------------------

  /**
   * Narrow public identity for one or more players.
   *
   * Returns an empty map when offline or unavailable: the caller must NOT
   * fabricate identity data.
   */
  public async fetchPublicIdentities(userIds: readonly string[]): Promise<Map<string, PublicIdentity>> {
    const out = new Map<string, PublicIdentity>();
    const ids = [...new Set(userIds.filter((id) => typeof id === 'string' && id.length > 0))];
    if (ids.length === 0) return out;

    const client = this.onlineClient.getClient();
    if (!client) return out;

    try {
      const { data, error } = await client.rpc('public_profiles', { p_user_ids: ids });
      if (error || !data) return out;

      for (const row of data as Array<Record<string, unknown>>) {
        const id = typeof row.user_id === 'string' ? row.user_id : null;
        if (!id) continue;
        out.set(id, {
          userId: id,
          displayName: (row.display_name as string) || 'PLAYER',
          equippedKnifeId: (row.equipped_knife as string) || 'SIGNAL_CYAN',
          equippedGloveId: (row.equipped_glove as string) || 'STANDARD_ISSUE'
        });
      }
    } catch {
      /* identity is presentation only; never throw into the UI */
    }
    return out;
  }

  // -- own profile ----------------------------------------------------------

  /**
   * The local player's own profile.
   *
   * Built entirely from local authoritative state, so it opens offline.
   */
  public buildLocalProfile(): PlayerProfileView {
    const skins = KarambitSkinSystem.getInstance();
    const manager = LeaderboardManager.getInstance();
    const mastery = masteryGloveSystem.evaluate();
    const gloveId = masteryGloveSystem.getEquippedGloveId();
    const glove = getMasteryGlove(gloveId);

    const tracks: ProfileTrackRow[] = canonicalTrackIds().map((trackId) => {
      const record = manager.getRecord(trackId);
      const summary = manager.getRecordSummary(trackId);
      const pbTimeUs =
        summary.pbTime !== null ? Math.round(summary.pbTime * 1_000_000) : null;
      // A local replay is only offered when one genuinely exists.
      const localReplay = pbTimeUs !== null ? replayStorageService.getLocal(trackId, pbTimeUs) : null;
      const ref = manager.getGhostReplayRef(trackId);
      const fingerprint = canonicalFingerprintFor(trackId);
      const refUsable = !!ref && !!fingerprint && ref.mapFingerprint === fingerprint;

      return {
        trackId,
        title: titleFor(trackId),
        rank: (record?.bestRank as RunRank | undefined) ?? null,
        timeUs: pbTimeUs,
        runId: null,
        replayHash: refUsable ? ref!.hash : null,
        hasReplay: localReplay !== null || refUsable
      };
    });

    return {
      isLocal: true,
      displayName: this.auth.getProfile()?.displayName ?? 'PLAYER',
      equippedKnifeId: skins.getEquippedSkinId(),
      equippedGloveId: gloveId,
      gloveName: glove.name,
      gloveSource: normalizeGloveSource(MasteryGloveSystem.gloveSource(gloveId)),
      gloveRequirement: describeGloveSource(gloveId, glove.requirementLabel),
      mastery: mastery.summary,
      tracks,
      worldPosition: null,
      offline: false
    };
  }

  // -- public profile -------------------------------------------------------

  /**
   * Another player's PUBLIC profile.
   *
   * Identity comes from the narrow projection; the public record comes from
   * `leaderboard_runs`, which is already world-readable and already carries the
   * accepted canonical runs. No private table is read.
   *
   * Returns `null` when nothing could be fetched, so the UI can show
   * `PROFILE // OFFLINE` instead of inventing data.
   */
  public async fetchPublicProfile(userId: string): Promise<PlayerProfileView | null> {
    const client = this.onlineClient.getClient();
    if (!client) return null;

    const identities = await this.fetchPublicIdentities([userId]);
    const identity = identities.get(userId);
    if (!identity) return null;

    let runs: Array<Record<string, unknown>> = [];
    try {
      const { data, error } = await client
        .from('leaderboard_runs')
        .select('id, track_id, map_fingerprint, time_us, rank, replay_hash, replay_version')
        .eq('user_id', userId)
        .eq('verification_state', 'accepted')
        .order('time_us', { ascending: true })
        .limit(500);
      if (error) return null;
      runs = (data as Array<Record<string, unknown>>) ?? [];
    } catch {
      return null;
    }

    // Keep only CURRENT canonical-map runs, and keep the fastest per track.
    const bestByTrack = new Map<string, Record<string, unknown>>();
    for (const run of runs) {
      const trackId = run.track_id as string;
      const fingerprint = canonicalFingerprintFor(trackId);
      if (!fingerprint || run.map_fingerprint !== fingerprint) continue;
      const existing = bestByTrack.get(trackId);
      if (!existing || Number(run.time_us) < Number(existing.time_us)) {
        bestByTrack.set(trackId, run);
      }
    }

    const tracks: ProfileTrackRow[] = canonicalTrackIds().map((trackId) => {
      const run = bestByTrack.get(trackId);
      if (!run) {
        return { trackId, title: titleFor(trackId), rank: null, timeUs: null, runId: null, replayHash: null, hasReplay: false };
      }
      return {
        trackId,
        title: titleFor(trackId),
        rank: isRunRank(run.rank) ? run.rank : null,
        timeUs: Number(run.time_us),
        runId: (run.id as string) ?? null,
        replayHash: (run.replay_hash as string | null) ?? null,
        hasReplay: run.replay_version !== null && run.replay_version !== undefined
      };
    });

    // PUBLIC mastery: the same ladder, fed from the accepted public record.
    const ranks: Record<string, RunRank> = {};
    for (const row of tracks) {
      if (row.rank) ranks[row.trackId] = row.rank;
    }
    const mastery = computeMasterySummary({ trackIds: canonicalTrackIds(), ranks });

    const glove = getMasteryGlove(identity.equippedGloveId);

    return {
      isLocal: false,
      displayName: identity.displayName,
      equippedKnifeId: identity.equippedKnifeId,
      equippedGloveId: identity.equippedGloveId,
      gloveName: glove.name,
      gloveSource: normalizeGloveSource(MasteryGloveSystem.gloveSource(identity.equippedGloveId)),
      gloveRequirement: describeGloveSource(identity.equippedGloveId, glove.requirementLabel),
      mastery,
      tracks,
      worldPosition: null,
      offline: false
    };
  }

  /**
   * Real WORLD position for the local player on one track, when an accepted
   * leaderboard query actually provides it. Never fabricated.
   */
  public setWorldPosition(view: PlayerProfileView, position: number | null): PlayerProfileView {
    return { ...view, worldPosition: position };
  }

  /** Offline placeholder for a remote profile. Carries NO fabricated data. */
  public offlineProfile(fallbackName: string): PlayerProfileView {
    return {
      isLocal: false,
      displayName: fallbackName,
      equippedKnifeId: '',
      equippedGloveId: '',
      gloveName: '',
      gloveSource: 'NONE',
      gloveRequirement: '',
      mastery: { total: canonicalTrackIds().length, cleared: 0, bronzePlus: 0, silverPlus: 0, goldPlus: 0, diamond: 0 },
      tracks: [],
      worldPosition: null,
      offline: true
    };
  }
}

export const playerProfileService = new PlayerProfileService();
