/**
 * CLOUD PROGRESSION — durable progression with offline-first reconciliation.
 *
 * Design constraints from the milestone:
 * - PLAYHEAD must remain fully playable offline. Every method here degrades to
 *   a local no-op and queues work instead of throwing.
 * - Never lose or duplicate a reward. The server owns the award LEDGER and the
 *   spend LEDGER; pending drops are DERIVED as `awarded - spent`. That is
 *   event-aware, so a refresh / new tab / offline-online toggle cannot farm
 *   drops, and a merge can never mint a duplicate.
 * - PB: lower valid time wins. Rank: higher wins. Cosmetics: set union.
 * - DEV/test progression must NEVER reach production. Dev-granted pending drops
 *   live in the same local blob as real ones with no provenance marker, so the
 *   migrator deliberately does not push a raw pending COUNT as authority — it
 *   pushes the award LEDGER, which DEV grants do not touch.
 * - Local state is the fast cache; cloud is the durable source of truth once
 *   migrated. Local data is backed up before the first migration and never
 *   cleared immediately.
 */

import { OnlineClient, online } from './supabaseClient';
import { AuthService, authService } from './AuthService';
import { KarambitSkinSystem } from '../viewmodel/KarambitSkinSystem';
import { MasteryGloveSystem } from '../mastery/MasteryGloveSystem';
import { LeaderboardManager } from '../leaderboard/LeaderboardManager';
import { CustomAudioRewardService } from '../audio/CustomAudioRewardService';
import { RunRank } from '../player/PlayerStats';

const MIGRATION_FLAG_KEY = 'playhead_cloud_migrated_v1';
const BACKUP_KEY = 'playhead_cloud_pre_migration_backup_v1';
const QUEUE_KEY = 'playhead_cloud_queue_v1';

export interface LocalProgressionSnapshot {
  equippedSkinId: string;
  /**
   * Equipped mastery glove. Captured in the snapshot (and therefore in the
   * pre-migration backup) and synced through `p_equipped_glove`.
   */
  equippedGloveId: string;
  awardedRankKeys: string[];
  pendingDropRanks: RunRank[];
  rewardOwnedSkinIds: string[];
  trackRecords: Record<string, RunRank>;
  officialRecords: Array<{
    trackId: string;
    bestRank: RunRank;
    pbTime: number;
    pbScore: number;
    localFirstTime: number;
    localFirstScore: number;
  }>;
  customClaimFingerprints: string[];
}

export interface CloudProgressionRow {
  equipped_knife: string | null;
  progression_version: number | null;
  awarded_rank_keys: string[] | null;
  spent_drop_keys: string[] | null;
  pending_drop_ranks: string[] | null;
  reward_owned_skin_ids: string[] | null;
  /**
   * Equipped mastery glove.
   *
   * Added by `20260925000000_mastery_equipped_glove.sql`. Kept optional so the
   * client degrades gracefully against a backend that has not been migrated yet:
   * local persistence works either way, and cloud carry-over activates once the
   * column and the RPC parameter exist.
   */
  equipped_glove?: string | null;
}

/** A queued offline mutation, replayed idempotently on reconnect. */
export type QueuedOperation =
  | { kind: 'award_rank_key'; key: string; rank: RunRank; at: number }
  | { kind: 'spend_drop_key'; key: string; at: number }
  | { kind: 'own_cosmetic'; cosmeticId: string; source: string; at: number }
  | { kind: 'equip_knife'; cosmeticId: string; at: number }
  | { kind: 'custom_claim'; fingerprint: string; at: number }
  | { kind: 'track_pb'; trackId: string; mapVersion: number; mapFingerprint: string; bestTimeUs: number; bestRank: string; at: number };

export class CloudProgression {
  private queue: QueuedOperation[] = [];
  private lastSyncAt = 0;
  private syncing = false;

  constructor(
    private readonly onlineClient: OnlineClient = online,
    private readonly auth: AuthService = authService
  ) {
    this.loadQueue();
  }

  // -- local queue ---------------------------------------------------------

  private loadQueue(): void {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      this.queue = raw ? (JSON.parse(raw) as QueuedOperation[]) : [];
    } catch {
      this.queue = [];
    }
  }

  private saveQueue(): void {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(this.queue));
    } catch {
      /* quota / private mode: queue stays in memory for this session */
    }
  }

  public enqueue(op: QueuedOperation): void {
    // Idempotent by (kind, key) so a double-fire cannot duplicate an award.
    const key = CloudProgression.opKey(op);
    if (this.queue.some((q) => CloudProgression.opKey(q) === key)) return;
    this.queue.push(op);
    this.saveQueue();
  }

  private static opKey(op: QueuedOperation): string {
    switch (op.kind) {
      case 'award_rank_key': return `award:${op.key}`;
      case 'spend_drop_key': return `spend:${op.key}`;
      case 'own_cosmetic': return `own:${op.cosmeticId}`;
      case 'equip_knife': return 'equip';
      case 'custom_claim': return `claim:${op.fingerprint}`;
      case 'track_pb': return `pb:${op.trackId}:${op.mapVersion}:${op.mapFingerprint}`;
    }
  }

  public getQueue(): readonly QueuedOperation[] {
    return this.queue;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public getLastSyncAt(): number {
    return this.lastSyncAt;
  }

  public isSyncing(): boolean {
    return this.syncing;
  }

  // -- local snapshot ------------------------------------------------------

  /** Reads the current device progression without mutating anything. */
  public snapshotLocal(): LocalProgressionSnapshot {
    const skins = KarambitSkinSystem.getInstance();
    const leaderboard = LeaderboardManager.getInstance();
    const records = leaderboard.getQueuedSubmissions();

    return {
      equippedSkinId: skins.getEquippedSkinId(),
      equippedGloveId: MasteryGloveSystem.getInstance().getEquippedGloveId(),
      awardedRankKeys: [...skins.getAwardedRankKeys()],
      pendingDropRanks: [...skins.getPendingDropRanks()],
      rewardOwnedSkinIds: [...skins.getRewardOwnedSkinIds()],
      trackRecords: { ...skins.getTrackRecords() },
      officialRecords: records.map((r) => ({
        trackId: r.trackId,
        bestRank: r.rank === 'UNRANKED' ? 'BRONZE' : r.rank,
        pbTime: r.completionTime,
        pbScore: r.score,
        localFirstTime: r.completionTime,
        localFirstScore: r.score
      })),
      customClaimFingerprints: CustomAudioRewardService.getInstance().getClaimedFingerprints()
    };
  }

  /** Snapshot before the first cloud migration; never cleared. */
  private writePreMigrationBackup(snapshot: LocalProgressionSnapshot): void {
    try {
      if (localStorage.getItem(BACKUP_KEY)) return;
      localStorage.setItem(
        BACKUP_KEY,
        JSON.stringify({ version: 1, at: Date.now(), snapshot })
      );
    } catch {
      /* best effort; migration still proceeds with the live snapshot */
    }
  }

  public hasPreMigrationBackup(): boolean {
    try {
      return localStorage.getItem(BACKUP_KEY) !== null;
    } catch {
      return false;
    }
  }

  public hasMigrated(): boolean {
    try {
      return localStorage.getItem(MIGRATION_FLAG_KEY) === '1';
    } catch {
      return false;
    }
  }

  private markMigrated(): void {
    try {
      localStorage.setItem(MIGRATION_FLAG_KEY, '1');
    } catch {
      /* ignore */
    }
  }

  // -- sync ----------------------------------------------------------------

  /**
   * Reconciles local progression with the cloud.
   *
   * First run with an empty cloud row migrates the local progression ONCE.
   * Afterwards the cloud ledgers are authoritative and the local state is
   * hydrated from the merged result.
   *
   * Returns a status string for the UI; never throws.
   */
  public async sync(): Promise<'SYNCED' | 'MIGRATED' | 'OFFLINE' | 'ERROR'> {
    const client = this.onlineClient.getClient();
    const userId = this.auth.getUserId();
    if (!client || !userId) return 'OFFLINE';
    if (this.syncing) return 'ERROR';

    this.syncing = true;
    try {
      const snapshot = this.snapshotLocal();
      const firstMigration = !this.hasMigrated();
      if (firstMigration) this.writePreMigrationBackup(snapshot);

      // The server performs the merge atomically; the client never does
      // read-modify-write on progression.
      const { data, error } = await client.rpc('sync_progression', {
        p_equipped_knife: snapshot.equippedSkinId,
        p_awarded_rank_keys: snapshot.awardedRankKeys,
        p_pending_drop_ranks: firstMigration ? snapshot.pendingDropRanks : [],
        p_reward_owned_skin_ids: snapshot.rewardOwnedSkinIds,
        p_custom_claims: snapshot.customClaimFingerprints,
        p_first_migration: firstMigration,
        // MASTERY: the equipped glove is the ONLY mastery value that persists.
        // Ownership is derived client-side, so there is nothing else to sync and
        // nothing to duplicate on reconnect.
        p_equipped_glove: snapshot.equippedGloveId
      });

      if (error) {
        this.onlineClient.setStatus('ERROR', error.message);
        return 'ERROR';
      }

      const row = (Array.isArray(data) ? data[0] : data) as CloudProgressionRow | null;
      if (row) this.hydrateLocalFromCloud(row);

      await this.flushQueue();

      if (firstMigration) this.markMigrated();
      this.lastSyncAt = Date.now();
      this.onlineClient.setStatus('ONLINE');
      return firstMigration ? 'MIGRATED' : 'SYNCED';
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.onlineClient.setStatus('ERROR', detail);
      return 'ERROR';
    } finally {
      this.syncing = false;
    }
  }

  /** Replays queued offline mutations. Safe to call repeatedly. */
  public async flushQueue(): Promise<number> {
    const client = this.onlineClient.getClient();
    const userId = this.auth.getUserId();
    if (!client || !userId || this.queue.length === 0) return 0;

    const pending = [...this.queue];
    let applied = 0;

    for (const op of pending) {
      try {
        if (op.kind === 'award_rank_key' || op.kind === 'own_cosmetic' || op.kind === 'custom_claim') {
          // Ledger unions are idempotent server-side.
          await client.rpc('grant_progression_events', {
            p_events: [{ kind: op.kind, key: CloudProgression.opKey(op), at: op.at }]
          });
        } else if (op.kind === 'track_pb') {
          await client.rpc('upsert_track_progress', {
            p_track_id: op.trackId,
            p_map_version: op.mapVersion,
            p_map_fingerprint: op.mapFingerprint,
            p_best_time_us: op.bestTimeUs,
            p_best_rank: op.bestRank
          });
        } else if (op.kind === 'equip_knife') {
          await client
            .from('player_progress')
            .update({ equipped_knife: op.cosmeticId, updated_at: new Date().toISOString() })
            .eq('user_id', userId);
        } else if (op.kind === 'spend_drop_key') {
          await client.rpc('spend_drop', { p_key: op.key });
        }
        applied++;
      } catch {
        // Stop at the first failure: order matters, and the queue is idempotent.
        break;
      }
    }

    if (applied > 0) {
      this.queue = this.queue.slice(applied);
      this.saveQueue();
    }
    return applied;
  }

  /** Applies the server's merged progression back into the local singletons. */
  private hydrateLocalFromCloud(row: CloudProgressionRow): void {
    const skins = KarambitSkinSystem.getInstance();
    const awarded = (row.awarded_rank_keys ?? []).filter((k) => typeof k === 'string');
    const owned = (row.reward_owned_skin_ids ?? []).filter((k) => typeof k === 'string');
    const pending = (row.pending_drop_ranks ?? []).filter((r): r is RunRank =>
      r === 'BRONZE' || r === 'SILVER' || r === 'GOLD' || r === 'DIAMOND'
    );

    skins.applyCloudProgression({
      awardedRankKeys: awarded,
      rewardOwnedSkinIds: owned,
      pendingDropRanks: pending,
      equippedSkinId: row.equipped_knife ?? undefined
    });

    // Mastery gloves: eligibility is DERIVED, so only the equipped id can ever
    // need reconciling. Applied only when it is still genuinely satisfied, which
    // also means a reconnect can never duplicate or invent an achievement.
    MasteryGloveSystem.getInstance().applyCloudEquippedGlove(row.equipped_glove ?? undefined);
  }

  /** DEV-only reset of the migration marker (never touches the backup). */
  public resetMigrationFlagForDev(): void {
    try {
      localStorage.removeItem(MIGRATION_FLAG_KEY);
    } catch {
      /* ignore */
    }
  }
}

export const cloudProgression = new CloudProgression();
