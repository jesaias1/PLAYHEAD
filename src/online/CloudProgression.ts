/**
 * CLOUD PROGRESSION — durable progression with offline-first reconciliation.
 *
 * PER-ACCOUNT ISOLATION (mandatory):
 * - The migration marker, the offline queue, the pre-migration backup and the
 *   world-record claim ledger are ALL keyed by the authenticated user id. Account
 *   A can never migrate, hydrate, dequeue or back up into account B's space.
 * - Leaving CLOUD storage keys alone (the armory's own local keys stay global, as
 *   they are the offline-first device cache) we additionally write a durable
 *   per-account LOCAL snapshot on switch-away, including cosmetic ownership,
 *   equips, mastery/medals/PBs and custom claims, so a real account switch can be
 *   restored verbatim instead of unioning two accounts together.
 * - A pre-account GUEST state (a device that had local data before its first
 *   account) is backed up ONCE, then unioned into the FIRST account only. It is
 *   never unioned into a SECOND registered account.
 * - Every async step re-reads the authenticated uid and refuses to hydrate, mark
 *   or dequeue if the account changed mid-flight.
 */

import { OnlineClient, online } from './supabaseClient';
import { AuthService, authService } from './AuthService';
import { KarambitSkinSystem } from '../viewmodel/KarambitSkinSystem';
import { MasteryGloveSystem } from '../mastery/MasteryGloveSystem';
import { LeaderboardManager } from '../leaderboard/LeaderboardManager';
import { CustomAudioRewardService } from '../audio/CustomAudioRewardService';
import { RunRank } from '../player/PlayerStats';

// Legacy (UNSCOPED) keys — read only to migrate a pre-isolation device forward.
const LEGACY_MIGRATION_FLAG_KEY = 'playhead_cloud_migrated_v1';
const LEGACY_BACKUP_KEY = 'playhead_cloud_pre_migration_backup_v1';
const LEGACY_QUEUE_KEY = 'playhead_cloud_queue_v1';

// Per-account key prefixes. The full key is `<prefix>:<uid>`.
const MIGRATION_FLAG_PREFIX = 'playhead_cloud_migrated_v2';
const BACKUP_PREFIX = 'playhead_cloud_backup_v2';
const QUEUE_PREFIX = 'playhead_cloud_queue_v2';
const WORLD_RECORD_CLAIMED_PREFIX = 'playhead_world_record_claimed_v2';
// Durable per-account LOCAL snapshot saved when switching AWAY from an account.
const ACCOUNT_SNAPSHOT_PREFIX = 'playhead_account_snapshot_v1';
// The device-level guest state captured before the FIRST account ever migrated.
const GUEST_BACKUP_KEY = 'playhead_guest_backup_v1';
// The first registered account that adopted the guest state (guest is merged once).
const GUEST_ADOPTED_BY_KEY = 'playhead_guest_adopted_by_v1';
// The uid whose local state is currently loaded into the armory singletons.
const ACTIVE_UID_KEY = 'playhead_active_uid_v1';
// The set of registered uids that have ever had a local session on this device.
const KNOWN_ACCOUNTS_KEY = 'playhead_known_accounts_v1';
// Set when the guest backup has been merged into a registered account.
const GUEST_MERGED_KEY = 'playhead_guest_merged_v1';
// Remembers the account whose loadout this device has adopted, so a device
// reload PRESERVES local equip changes instead of re-hydrating the cloud equip.
const LOADOUT_ADOPTED_UID_KEY = 'playhead_loadout_adopted_v1';
// Debounce for the automatic save fired by a real local progression change.
const AUTOSAVE_DEBOUNCE_MS = 800;

export interface LocalProgressionSnapshot {
  equippedSkinId: string;
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
  equipped_glove?: string | null;
}

export type QueuedOperation =
  | { kind: 'award_rank_key'; key: string; rank: RunRank; at: number }
  | { kind: 'spend_drop_key'; key: string; at: number }
  | { kind: 'own_cosmetic'; cosmeticId: string; source: string; at: number }
  | { kind: 'equip_knife'; cosmeticId: string; at: number }
  | { kind: 'equip_glove'; cosmeticId: string; at: number }
  | { kind: 'custom_claim'; fingerprint: string; at: number }
  | { kind: 'track_pb'; trackId: string; mapVersion: number; mapFingerprint: string; bestTimeUs: number; bestRank: string; at: number };

function safeGet(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    /* quota / private mode */
  }
}

function safeRemove(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export class CloudProgression {
  private queue: QueuedOperation[] = [];
  private lastSyncAt = 0;
  private syncing = false;
  /** The uid the in-memory queue currently belongs to (per-account scoping). */
  private loadedUid: string | null = null;
  /**
   * True once the CURRENT credential has completed a cloud-first loadout
   * hydration (initial sync, or adoption of a different account on this
   * session). Until then, sync() is adopting the account and must read the
   * authoritative cloud equip FIRST so a fresh device never overwrites it.
   * After that, a later sync() PRESERVES the player's local equip changes.
   */
  private loadoutHydratedUid: string | null = null;
  /** Debounced real-change auto-save handle (module-level timer is avoided). */
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  /** uid captured when the autosave was scheduled, to reject cross-uid saves. */
  private autosaveUid: string | null = null;
  /** True while sync() mutates local state, so mirror-listeners never auto-save. */

  constructor(
    private readonly onlineClient: OnlineClient = online,
    private readonly auth: AuthService = authService
  ) {
    this.loadQueue();
    this.installCommittedChangeHooks();
  }

  // -- scoped key helpers --------------------------------------------------

  private keyFor(prefix: string, uid: string | null): string {
    return uid ? `${prefix}:${uid}` : `${prefix}:anon`;
  }

  /** Trim an equip id; empty or missing collapses to null (absent, not a default). */
  private static normalizeEquipId(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private get activeUid(): string | null {
    return this.auth.getUserId();
  }

  // -- local queue (per uid) ----------------------------------------------

  private loadQueue(): void {
    const uid = this.activeUid;
    const raw = uid ? safeGet(this.keyFor(QUEUE_PREFIX, uid)) : safeGet(LEGACY_QUEUE_KEY);
    try {
      this.queue = raw ? (JSON.parse(raw) as QueuedOperation[]) : [];
    } catch {
      this.queue = [];
    }
    this.loadedUid = uid;
  }

  /** Rebinds the in-memory queue to the currently authenticated account. */
  private rebindQueueIfNeeded(): void {
    const uid = this.activeUid;
    if (uid === this.loadedUid) return;
    // Save the outgoing uid's queue under ITS OWN key before switching.
    this.saveQueue(this.loadedUid);
    this.loadedUid = uid;
    this.loadQueue();
  }

  private saveQueue(uid: string | null = this.loadedUid): void {
    if (!uid) return; // never persist an anonymous queue into an account's space
    try {
      safeSet(this.keyFor(QUEUE_PREFIX, uid), JSON.stringify(this.queue));
    } catch {
      /* quota: queue stays in memory for this session */
    }
  }

  public enqueue(op: QueuedOperation): void {
    this.rebindQueueIfNeeded();
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
      case 'equip_glove': return 'equip_glove';
      case 'custom_claim': return `claim:${op.fingerprint}`;
      case 'track_pb': return `pb:${op.trackId}:${op.mapVersion}:${op.mapFingerprint}`;
    }
  }

  /**
   * The RAW key the SERVER expects for a progression event (no local prefix).
   * opKey is only a local dedupe key and must never be sent to the server.
   */
  private static eventKey(op: QueuedOperation): string {
    switch (op.kind) {
      case 'award_rank_key': return op.key;
      case 'own_cosmetic': return op.cosmeticId;
      case 'custom_claim': return op.fingerprint;
      default: return CloudProgression.opKey(op);
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

  public snapshotLocal(): LocalProgressionSnapshot {
    const skins = KarambitSkinSystem.getInstance();
    const leaderboard = LeaderboardManager.getInstance();

    // The account's OFFICIAL RECORD LEDGER (PBs + local-first), not merely the
    // pending upload queue: the snapshot is the whole account state and must
    // restore the PBs verbatim on another device.
    const records = leaderboard.getAllRecords();

    return {
      equippedSkinId: skins.getEquippedSkinId(),
      equippedGloveId: MasteryGloveSystem.getInstance().getEquippedGloveId(),
      awardedRankKeys: [...skins.getAwardedRankKeys()],
      pendingDropRanks: [...skins.getPendingDropRanks()],
      rewardOwnedSkinIds: [...skins.getRewardOwnedSkinIds(), ...skins.getOwnedDropGloveIds()],
      trackRecords: { ...skins.getTrackRecords() },
      officialRecords: records.map((r) => ({
        trackId: r.trackId,
        bestRank: r.bestRank,
        pbTime: r.pbTime,
        pbScore: r.pbScore,
        localFirstTime: r.localFirstTime,
        localFirstScore: r.localFirstScore
      })),
      customClaimFingerprints: CustomAudioRewardService.getInstance().getClaimedFingerprints()
    };
  }

  /** Saves the CURRENT local state as this uid's durable per-account snapshot. */
  private writeAccountSnapshot(uid: string, snapshot: LocalProgressionSnapshot): void {
    safeSet(
      this.keyFor(ACCOUNT_SNAPSHOT_PREFIX, uid),
      JSON.stringify({ version: 1, at: Date.now(), snapshot })
    );
  }

  /** Restores a uid's local snapshot into the live singletons (device reload). */
  private restoreAccountSnapshot(uid: string): boolean {
    const raw = safeGet(this.keyFor(ACCOUNT_SNAPSHOT_PREFIX, uid));
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw) as { snapshot?: LocalProgressionSnapshot };
      if (!parsed?.snapshot) return false;
      this.applyLocalSnapshot(parsed.snapshot);
      return true;
    } catch {
      return false;
    }
  }

  private applyLocalSnapshot(snapshot: LocalProgressionSnapshot): void {
    // ACCOUNT REPLACEMENT: clear every account-bound local store FIRST so this is
    // a REPLACE, never a union with whatever account was loaded before. The
    // snapshot being restored is itself untouched (the backup stays on disk).
    this.clearAccountBoundLocalState();
    const skins = KarambitSkinSystem.getInstance();
    skins.applyCloudProgression({
      awardedRankKeys: snapshot.awardedRankKeys,
      rewardOwnedSkinIds: snapshot.rewardOwnedSkinIds,
      pendingDropRanks: snapshot.pendingDropRanks,
      equippedSkinId: snapshot.equippedSkinId
    });
    // Track records and official PBs are part of the account and must be restored
    // too, not silently dropped.
    skins.setTrackRecords(snapshot.trackRecords);
    MasteryGloveSystem.getInstance().applyCloudEquippedGlove(snapshot.equippedGloveId);
    CustomAudioRewardService.getInstance().mergeCloudClaims(snapshot.customClaimFingerprints);
    LeaderboardManager.getInstance().restoreLocalRecords(
      (snapshot.officialRecords ?? []).map((r) => ({
        trackId: r.trackId,
        bestRank: r.bestRank,
        pbTime: r.pbTime,
        pbScore: r.pbScore,
        localFirstTime: r.localFirstTime,
        localFirstScore: r.localFirstScore
      }))
    );
  }

  /** Clears account-bound local progression WITHOUT touching any backup. */
  private clearAccountBoundLocalState(): void {
    try {
      KarambitSkinSystem.getInstance().resetProgressionForAccountSwitch();
      MasteryGloveSystem.getInstance().applyCloudEquippedGlove('STANDARD_ISSUE');
      CustomAudioRewardService.getInstance().clearClaims();
      LeaderboardManager.getInstance().clearAllLocalState();
    } catch {
      /* best effort: a partial clear must never throw into the caller */
    }
  }

  /** Backs up the device's pre-account GUEST state exactly once. */
  private captureGuestBackupOnce(snapshot: LocalProgressionSnapshot): void {
    if (safeGet(GUEST_BACKUP_KEY) !== null) return;
    safeSet(GUEST_BACKUP_KEY, JSON.stringify({ version: 1, at: Date.now(), snapshot }));
  }

  public hasGuestBackup(): boolean {
    return safeGet(GUEST_BACKUP_KEY) !== null;
  }

  private guestAdoptedBy(): string | null {
    const raw = safeGet(GUEST_ADOPTED_BY_KEY);
    return raw && raw.length > 0 ? raw : null;
  }

  private readGuestSnapshot(): LocalProgressionSnapshot | null {
    const raw = safeGet(GUEST_BACKUP_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { snapshot?: LocalProgressionSnapshot };
      return parsed?.snapshot ?? null;
    } catch {
      return null;
    }
  }

  private readAccountSnapshot(uid: string): LocalProgressionSnapshot | null {
    const raw = safeGet(this.keyFor(ACCOUNT_SNAPSHOT_PREFIX, uid));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { snapshot?: LocalProgressionSnapshot };
      return parsed?.snapshot ?? null;
    } catch {
      return null;
    }
  }

  private knownAccounts(): string[] {
    try {
      const raw = safeGet(KNOWN_ACCOUNTS_KEY);
      const list = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  private rememberAccount(uid: string): void {
    const known = this.knownAccounts();
    if (!known.includes(uid)) {
      known.push(uid);
      safeSet(KNOWN_ACCOUNTS_KEY, JSON.stringify(known.slice(-16)));
    }
  }

  // -- migration markers (per uid) ----------------------------------------

  /**
   * True when THIS uid has completed its first cloud migration.
   *
   * A legacy device that already migrated under the old, unscoped marker is
   * treated as migrated for the uid that is actually on this device now, so an
   * upgrade does not re-run a first migration. Other uids on the same device
   * still get their own fresh migration.
   */
  public hasMigrated(): boolean {
    const uid = this.activeUid;
    if (!uid) return false;
    if (safeGet(this.keyFor(MIGRATION_FLAG_PREFIX, uid)) === '1') return true;
    // Legacy carry-over: only for the account currently bound to this device.
    if (safeGet(LEGACY_MIGRATION_FLAG_KEY) === '1' && safeGet(ACTIVE_UID_KEY) === uid) return true;
    return false;
  }

  private markMigrated(uid: string): void {
    if (!uid) return;
    safeSet(this.keyFor(MIGRATION_FLAG_PREFIX, uid), '1');
  }

  public hasPreMigrationBackup(): boolean {
    const uid = this.activeUid;
    if (!uid) return safeGet(LEGACY_BACKUP_KEY) !== null;
    return safeGet(this.keyFor(BACKUP_PREFIX, uid)) !== null;
  }

  /** Per-account pre-migration backup; never cleared. */
  private writePreMigrationBackup(uid: string, snapshot: LocalProgressionSnapshot): void {
    const key = this.keyFor(BACKUP_PREFIX, uid);
    if (safeGet(key) !== null) return;
    safeSet(key, JSON.stringify({ version: 1, at: Date.now(), uid, snapshot }));
  }

  // -- hygiene (per uid) ---------------------------------------------------

  public hasClaimedWorldRecordAward(awardId: string): boolean {
    const uid = this.activeUid;
    if (!uid) return false;
    try {
      const raw = safeGet(this.keyFor(WORLD_RECORD_CLAIMED_PREFIX, uid));
      const list = raw ? (JSON.parse(raw) as string[]) : [];
      return Array.isArray(list) && list.includes(awardId);
    } catch {
      return false;
    }
  }

  private markWorldRecordClaimed(awardId: string): void {
    const uid = this.activeUid;
    if (!uid) return;
    try {
      const key = this.keyFor(WORLD_RECORD_CLAIMED_PREFIX, uid);
      const raw = safeGet(key);
      const list = raw ? (JSON.parse(raw) as string[]) : [];
      const next = Array.isArray(list) ? list : [];
      if (!next.includes(awardId)) next.push(awardId);
      safeSet(key, JSON.stringify(next.slice(-64)));
    } catch {
      /* best effort */
    }
  }

  // -- sync ----------------------------------------------------------------

  /**
   * Reads THIS account's authoritative server state and folds it into the live
   * local singletons BEFORE any local state is uploaded.
   *
   * This is what stops a fresh device (or a reload that lost its local cache)
   * from writing the DEFAULT equipment over the account's real cloud loadout.
   * All three reads are best-effort and additive:
   *   - track_progress  -> local PB ledger (lower time wins)
   *   - custom_signal_claims -> claimed fingerprints
   *   - player_progress -> equipped knife/glove (authoritative equips)
   */
  private async hydrateFromCloudAuthoritative(userId: string): Promise<void> {
    const client = this.onlineClient.getClient();
    if (!client) return;
    // FRESH vs RETURNING. A device that has NEVER successfully adopted this
    // account's loadout must take the cloud equip (so a fresh device / account
    // switch cannot write the local default over the real cloud loadout). A
    // device that has already adopted it PRESERVES local equip changes.
    const freshLoadout = !this.hasAdoptedLoadout(userId);

    // 1. Track PBs.
    try {
      const { data, error } = await client
        .from('track_progress')
        .select('track_id, best_time_us, best_rank')
        .eq('user_id', userId);
      if (this.auth.getUserId() !== userId) return;
      if (!error && Array.isArray(data)) {
        LeaderboardManager.getInstance().mergeCloudPBs(
          (data as Record<string, unknown>[]).map((r) => ({
            trackId: String(r.track_id ?? ''),
            bestTimeUs: Number(r.best_time_us ?? 0),
            bestRank: String(r.best_rank ?? 'BRONZE')
          }))
        );
        const records = { ...KarambitSkinSystem.getInstance().getTrackRecords() };
        const ranks: RunRank[] = ['BRONZE', 'SILVER', 'GOLD', 'DIAMOND'];
        for (const row of data as Record<string, unknown>[]) {
          const rank = row.best_rank as RunRank;
          const track = String(row.track_id ?? '');
          if (track && ranks.includes(rank) && ranks.indexOf(rank) > ranks.indexOf(records[track])) records[track] = rank;
        }
        KarambitSkinSystem.getInstance().setTrackRecords(records);
      }
    } catch {
      /* best effort */
    }
    if (this.auth.getUserId() !== userId) return;

    // 2. Custom signal claims.
    try {
      const { data, error } = await client
        .from('custom_signal_claims')
        .select('audio_fingerprint')
        .eq('user_id', userId);
      if (this.auth.getUserId() !== userId) return;
      if (!error && Array.isArray(data)) {
        CustomAudioRewardService.getInstance().mergeCloudClaims(
          (data as Record<string, unknown>[])
            .map((r) => String(r.audio_fingerprint ?? ''))
            .filter((f) => f.length > 0)
        );
      }
    } catch {
      /* best effort */
    }
    if (this.auth.getUserId() !== userId) return;

    // 3. Equipped cosmetics (the authoritative loadout).
    try {
      const { data, error } = await client
        .from('player_progress')
        .select('equipped_knife, equipped_glove, reward_owned_skin_ids, awarded_rank_keys')
        .eq('user_id', userId)
        .maybeSingle();
      if (this.auth.getUserId() !== userId) return;
      if (error) throw new Error(error.message);
      if (data) {
        const row = data as Record<string, unknown>;
        const owned = Array.isArray(row.reward_owned_skin_ids)
          ? (row.reward_owned_skin_ids as unknown[]).filter((x): x is string => typeof x === 'string')
          : [];
        const awarded = Array.isArray(row.awarded_rank_keys)
          ? (row.awarded_rank_keys as unknown[]).filter((x): x is string => typeof x === 'string')
          : [];
        // OWNERSHIP FIRST: an equipped skin can only be applied once the account
        // is known to own it, otherwise the equip is silently rejected and the
        // fresh-device default would win. Ownership is additive on BOTH the
        // adopting and returning paths, so a downstream write can never drop an
        // unlock this account already has.
        if (owned.length > 0 || awarded.length > 0) {
          KarambitSkinSystem.getInstance().applyCloudProgression({
            rewardOwnedSkinIds: owned,
            awardedRankKeys: awarded
          });
        }
        const knife = CloudProgression.normalizeEquipId(row.equipped_knife);
        const glove = CloudProgression.normalizeEquipId(row.equipped_glove);
        if (freshLoadout) {
          // INITIAL / ACCOUNT-SWITCH ADOPTION: cloud wins for the loadout.
          if (knife) {
            KarambitSkinSystem.getInstance().applyCloudProgression({ equippedSkinId: knife });
          }
          if (glove) {
            MasteryGloveSystem.getInstance().applyCloudEquippedGlove(glove);
          }
        }
        // The authoritative loadout was read successfully: this device has now
        // adopted the account, so later sync() calls preserve local equip.
      }
      this.markLoadoutAdopted(userId);
    } catch {
      // Do not upload a fresh-device default when the authoritative loadout
      // could not be read. sync() retains the local state and retries later.
      throw new Error('Cloud loadout unavailable; save deferred');
    }
  }

  public async sync(): Promise<'SYNCED' | 'MIGRATED' | 'OFFLINE' | 'ERROR'> {
    const client = this.onlineClient.getClient();
    const userId = this.auth.getUserId();
    if (!client || !userId) return 'OFFLINE';
    if (this.syncing) return 'ERROR';

    this.syncing = true;
    try {
      // Capture the incoming device state BEFORE any hydration so that a device
      // with pre-account local data can back it up as the guest baseline.
      const incoming = this.snapshotLocal();

      // ACCOUNT ISOLATION applies to REGISTERED accounts only. An anonymous
      // session is the device's guest identity: it keeps the local/guest state
      // and must never trigger a per-account switch or reset.
      if (this.auth.isRegisteredAccount()) {
        // ACCOUNT-SWITCH ADOPTION: adopting a DIFFERENT account on this session
        // re-reads its cloud loadout. A same-account device reload is NOT a
        // switch and keeps the local equip changes made since the last save.
        if (this.loadoutHydratedUid !== null && this.loadoutHydratedUid !== userId) {
          this.clearLoadoutAdopted();
        }
        this.prepareLocalStateForAccount(userId, incoming);
        // CLOUD-FIRST HYDRATION: fetch THIS account's authoritative server state
        // (track PBs, custom signal claims and equipped cosmetics) BEFORE the
        // sync write, so a fresh device never overwrites the cloud equip with the
        // fresh-device default. Failures are tolerated: the sync write below is
        // still authoritative and additive, so a transient read failure cannot
        // corrupt anything.
        await this.hydrateFromCloudAuthoritative(userId);
        if (this.auth.getUserId() !== userId) return 'ERROR';
      }

      const snapshot = this.snapshotLocal();
      const firstMigration = !this.hasMigrated();
      if (firstMigration) this.writePreMigrationBackup(userId, snapshot);

      const { data, error } = await client.rpc('sync_progression', {
        p_equipped_knife: snapshot.equippedSkinId,
        p_awarded_rank_keys: snapshot.awardedRankKeys,
        p_pending_drop_ranks: firstMigration ? snapshot.pendingDropRanks : [],
        p_reward_owned_skin_ids: snapshot.rewardOwnedSkinIds,
        p_custom_claims: snapshot.customClaimFingerprints,
        p_first_migration: firstMigration,
        p_equipped_glove: snapshot.equippedGloveId
      });

      if (error) {
        this.onlineClient.setStatus('ERROR', error.message);
        return 'ERROR';
      }

      // ASYNC ISOLATION: if the account changed while the RPC was in flight,
      // refuse to hydrate or mark anything for the wrong uid.
      if (this.auth.getUserId() !== userId) return 'ERROR';

      const row = (Array.isArray(data) ? data[0] : data) as CloudProgressionRow | null;
      if (row) {
        const latest = this.snapshotLocal();
        this.hydrateLocalFromCloud(row,
          latest.equippedSkinId !== snapshot.equippedSkinId ||
          latest.equippedGloveId !== snapshot.equippedGloveId);
      }

      await this.flushQueue();

      if (this.auth.getUserId() !== userId) return 'ERROR';
      if (firstMigration) this.markMigrated(userId);
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

  /**
   * Prepares the live local state for a specific authenticated account.
   *
   * Rules (in order):
   *   1. Already the active account: nothing to do (resume).
   *   2. Account has a durable snapshot: restore it, and back up the outgoing
   *      state under its own uid so the switch is lossless.
   *   3. Brand new account: the device's CURRENT local state becomes that
   *      account's snapshot. Pre-account GUEST data is unioned into the FIRST
   *      registered account ONLY (never into a second registered account).
   */
  public prepareLocalStateForAccount(userId: string, incoming: LocalProgressionSnapshot): void {
    const previousUid = safeGet(ACTIVE_UID_KEY);
    if (previousUid === userId) return;

    // Persist the outgoing state under the account it actually belongs to.
    if (previousUid && previousUid !== userId && this.knownAccounts().includes(previousUid)) {
      this.writeAccountSnapshot(previousUid, incoming);
    }

    const hasSnapshot = this.readAccountSnapshot(userId) !== null;
    if (hasSnapshot) {
      this.restoreAccountSnapshot(userId);
    } else {
      const guest = this.readGuestSnapshot();
      const adoptedBy = this.guestAdoptedBy();
      // The pre-account GUEST baseline is merged EXACTLY ONCE on this device, and
      // only into the FIRST registered account that adopts it. Every later
      // account starts from a CLEAN slate and can never inherit or upload the
      // previous registered account's progression.
      const isFirstAdopter = guest !== null && adoptedBy === null;
      const isReenteringAdopter = guest !== null && adoptedBy === userId;
      if (isFirstAdopter) {
        this.applyLocalSnapshot(guest);
        safeSet(GUEST_ADOPTED_BY_KEY, userId);
        safeSet(GUEST_MERGED_KEY, '1');
      } else if (isReenteringAdopter) {
        this.applyLocalSnapshot(guest);
      } else if (previousUid !== null && previousUid !== userId && this.knownAccounts().includes(previousUid)) {
        // We are LEAVING a different registered account on the same device with
        // no snapshot of the new one: a clean slate so the previous account's
        // progression is never inherited or uploaded.
        this.resetLocalProgressToDefaults();
      } else if (guest !== null) {
        // The guest baseline was already adopted by a DIFFERENT account.
        this.resetLocalProgressToDefaults();
      }
      // With NO guest backup and NO previous registered account, the current
      // local state IS this brand-new account's own data: keep it untouched.
      this.writeAccountSnapshot(userId, this.snapshotLocal());
    }

    this.rememberAccount(userId);
    safeSet(ACTIVE_UID_KEY, userId);
  }

  /** Captures the pre-account GUEST baseline; called on boot before any login. */
  public captureGuestStateIfNeeded(): void {
    try {
      if (safeGet(GUEST_BACKUP_KEY) !== null) return;
      if (safeGet(ACTIVE_UID_KEY) !== null) return; // already bound to an account
      this.captureGuestBackupOnce(this.snapshotLocal());
    } catch {
      /* best effort */
    }
  }

  /** Clears local progression ledgers so a NEW account starts from zero. */
  private resetLocalProgressToDefaults(): void {
    try {
      const skins = KarambitSkinSystem.getInstance();
      skins.resetProgressionForAccountSwitch();
      MasteryGloveSystem.getInstance().applyCloudEquippedGlove('STANDARD_ISSUE');
      CustomAudioRewardService.getInstance().clearClaims();
      // Clear the WHOLE official ledger (records + queue), not just the queue:
      // a clean account must not inherit the previous account's PBs.
      LeaderboardManager.getInstance().clearAllLocalState();
    } catch {
      /* best effort */
    }
  }

  /**
   * Signs the local device out of its account and restores the GUEST baseline,
   * so the next registered account cannot inherit this account's progression.
   */
  public signOutLocalState(): void {
    const uid = safeGet(ACTIVE_UID_KEY);
    if (uid && this.knownAccounts().includes(uid)) {
      this.writeAccountSnapshot(uid, this.snapshotLocal());
    }
    // CLEAR FIRST: the account being signed out must leave no trace behind, so
    // the guest baseline is applied onto a genuinely empty local slate.
    this.clearAccountBoundLocalState();
    const guest = this.readGuestSnapshot();
    if (guest) this.applyLocalSnapshot(guest);
    else this.resetLocalProgressToDefaults();
    safeRemove(ACTIVE_UID_KEY);
    // The device has left the account: the next login must re-adopt its cloud
    // loadout rather than preserve the previous (now signed-out) local equip.
    this.clearLoadoutAdopted();
    if (this.autosaveTimer !== null) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = null;
    this.autosaveUid = null;
    this.saveQueue(this.loadedUid);
    this.loadedUid = null;
    this.queue = [];
  }

  // -- flush queue ---------------------------------------------------------

  /** Replays queued offline mutations. Retains every op that fails. */
  public async flushQueue(): Promise<number> {
    const client = this.onlineClient.getClient();
    const userId = this.auth.getUserId();
    if (!client || !userId || this.queue.length === 0) return 0;
    this.rebindQueueIfNeeded();

    const pending = [...this.queue];
    let applied = 0;

    for (const op of pending) {
      // Stop immediately if the account changed mid-flush.
      if (this.auth.getUserId() !== userId) break;
      let ok = false;
      try {
        if (op.kind === 'award_rank_key' || op.kind === 'own_cosmetic' || op.kind === 'custom_claim') {
          const { error } = await client.rpc('grant_progression_events', {
            // The SERVER key is the raw cosmetic id / fingerprint — NOT the local
            // dedupe opKey (which carries 'own:'/'award:'/'claim:' prefixes the
            // server does not understand). opKey is used only for local dedupe.
            p_events: [{ kind: op.kind, key: CloudProgression.eventKey(op), at: op.at }]
          });
          ok = !error;
        } else if (op.kind === 'track_pb') {
          const { error } = await client.rpc('upsert_track_progress', {
            p_track_id: op.trackId,
            p_map_version: op.mapVersion,
            p_map_fingerprint: op.mapFingerprint,
            p_best_time_us: op.bestTimeUs,
            p_best_rank: op.bestRank
          });
          ok = !error;
        } else if (op.kind === 'equip_knife') {
          const { error } = await client
            .from('player_progress')
            .update({ equipped_knife: op.cosmeticId, updated_at: new Date().toISOString() })
            .eq('user_id', userId);
          ok = !error;
        } else if (op.kind === 'equip_glove') {
          const { error } = await client
            .from('player_progress')
            .update({ equipped_glove: op.cosmeticId, updated_at: new Date().toISOString() })
            .eq('user_id', userId);
          ok = !error;
        } else if (op.kind === 'spend_drop_key') {
          const { error } = await client.rpc('spend_drop', { p_key: op.key });
          ok = !error;
        }
      } catch {
        ok = false;
      }
      // ASYNC ISOLATION (AFTER EVERY AWAIT): if the account changed while this
      // op was in flight, STOP. Continuing would apply the next op — or record
      // the applied index — against a DIFFERENT account's queue.
      if (this.auth.getUserId() !== userId) break;
      if (!ok) {
        // RETAIN the failed op (and everything after it) and stop: order matters.
        break;
      }
      applied++;
    }

    // Re-check before committing the dequeue: a mid-flush account change must not
    // write this account's remaining queue into the other account's storage.
    if (this.auth.getUserId() !== userId) return applied;
    if (applied > 0) {
      this.queue = this.queue.slice(applied);
      this.saveQueue();
    }
    return applied;
  }

  /** Applies the server's merged progression back into the local singletons. */
  private hydrateLocalFromCloud(row: CloudProgressionRow, preserveLoadout = false): void {
    const skins = KarambitSkinSystem.getInstance();
    const awarded = (row.awarded_rank_keys ?? []).filter((k) => typeof k === 'string');
    const owned = (row.reward_owned_skin_ids ?? []).filter((k) => typeof k === 'string');
    const pending = (row.pending_drop_ranks ?? []).filter((r): r is RunRank =>
      r === 'BRONZE' || r === 'SILVER' || r === 'GOLD' || r === 'DIAMOND'
    );
    const knife = CloudProgression.normalizeEquipId(row.equipped_knife);
    const glove = CloudProgression.normalizeEquipId(row.equipped_glove);

    skins.applyCloudProgression({
      awardedRankKeys: awarded,
      rewardOwnedSkinIds: owned,
      pendingDropRanks: pending,
      equippedSkinId: preserveLoadout ? undefined : knife ?? undefined
    });

    if (!preserveLoadout) MasteryGloveSystem.getInstance().applyCloudEquippedGlove(glove ?? undefined);
  }

  // -- loadout adoption (fresh device vs returning device) ----------------

  private hasAdoptedLoadout(userId: string): boolean {
    if (this.loadoutHydratedUid === userId) return true;
    // A device RELOAD keeps the local equip changes for an already-adopted
    // account; only a genuinely fresh device (no marker) re-adopts the cloud.
    if (safeGet(LOADOUT_ADOPTED_UID_KEY) === userId) {
      this.loadoutHydratedUid = userId;
      return true;
    }
    return false;
  }

  /**
   * Marks that THIS session has adopted the account's loadout. The global
   * ACTIVE_UID marker is also set so an adopted account is NOT re-hydrated (and
   * cannot re-adopt the cloud equip over a local change) after a device reload.
   */
  private markLoadoutAdopted(userId: string): void {
    this.loadoutHydratedUid = userId;
    safeSet(LOADOUT_ADOPTED_UID_KEY, userId);
  }

  /** Resets the adoption marker so the next sync re-adopts the cloud loadout. */
  private clearLoadoutAdopted(): void {
    this.loadoutHydratedUid = null;
    safeRemove(LOADOUT_ADOPTED_UID_KEY);
  }

  // -- automatic, account-safe, debounced save -----------------------------

  /**
   * Wires the REAL player-change signals to a debounced save. These listeners
   * deliberately do NOT fire on cloud hydration, replay preview, DEV preview or
   * account-switch resets, so a save can never be re-triggered by its own
   * hydration loop. Web-only: on a headless/test environment there is nothing
   * to subscribe to.
   */
  private installCommittedChangeHooks(): void {
    if (typeof window === 'undefined') return;
    const onChange = () => this.scheduleAutosave();
    KarambitSkinSystem.getInstance().addCommittedListener(onChange);
    MasteryGloveSystem.getInstance().addCommittedListener(onChange);
  }

  /** Debounced save. Captures the uid so a later account switch is rejected. */
  private scheduleAutosave(): void {
    this.autosaveUid = this.auth.getUserId();
    if (this.autosaveTimer !== null) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = null;
      void this.runScheduledAutosave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  private async runScheduledAutosave(): Promise<void> {
    const uid = this.autosaveUid;
    this.autosaveUid = null;
    // ACCOUNT OAUTH/ASYNC ISOLATION: refuse to write if the account changed
    // between scheduling and firing, or if no registered account owns this.
    if (!uid || this.auth.getUserId() !== uid) return;
    if (!this.auth.isRegisteredAccount()) return;
    if (this.syncing) {
      this.scheduleAutosave();
      return;
    }
    const client = this.onlineClient.getClient();
    if (!client) {
      // Offline: the local state is already durable; retry on the next change.
      return;
    }
    try {
      await this.sync();
    } catch {
      /* sync() reports its own status; a transient failure must never throw here */
    }
  }

  // -- world record prestige reward ---------------------------------------

  /**
   * Claims a server-created world-record award for THIS account.
   *
   * The client cannot create the award — only the submit-run Edge Function
   * (service role) may insert into player_world_records. This call may only
   * claim an award the server already made for the caller, and the server grants
   * the prestige cosmetic at most once per account.
   */
  public async claimWorldRecordReward(
    awardId: string
  ): Promise<{ ok: boolean; cosmeticId: string | null; detail: string }> {
    const client = this.onlineClient.getClient();
    if (!client) return { ok: false, cosmeticId: null, detail: 'offline' };
    if (!awardId) return { ok: false, cosmeticId: null, detail: 'no award id' };
    const userId = this.auth.getUserId();
    try {
      const { data, error } = await client.rpc('claim_world_record_award', {
        p_award_id: awardId
      });
      if (error) return { ok: false, cosmeticId: null, detail: error.message };
      // ASYNC ISOLATION: refuse to touch inventory or the claim ledger if the
      // account changed while the claim RPC was in flight.
      if (this.auth.getUserId() !== userId) {
        return { ok: false, cosmeticId: null, detail: 'account changed' };
      }
      const row = (Array.isArray(data) ? data[0] : data) as
        | { cosmetic_id?: string; granted?: boolean }
        | null;
      const cosmeticId = row?.cosmetic_id ?? null;
      if (cosmeticId) {
        KarambitSkinSystem.getInstance().applyCloudProgression({
          rewardOwnedSkinIds: [cosmeticId]
        });
      }
      this.markWorldRecordClaimed(awardId);
      return { ok: true, cosmeticId, detail: row?.granted ? 'granted' : 'already owned' };
    } catch (err) {
      return { ok: false, cosmeticId: null, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  /** DEV-only reset of the CURRENT account's migration marker (not the backup). */
  public resetMigrationFlagForDev(): void {
    const uid = this.activeUid;
    safeRemove(uid ? this.keyFor(MIGRATION_FLAG_PREFIX, uid) : LEGACY_MIGRATION_FLAG_KEY);
  }
}

export const cloudProgression = new CloudProgression();
