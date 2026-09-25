/**
 * RACE ROOM SERVICE — shared BEST-TIME SESSION with a friend.
 *
 * NOT first-to-finish. This is a CS-surf/KZ style shared session:
 *
 *   - Both players start the SAME canonical official map at the same
 *     synchronized session start.
 *   - There are TWO clocks:
 *       1. SESSION CLOCK  — shared, starts at synchronized GO, default 5:00,
 *                           NEVER resets when a player restarts.
 *       2. PERSONAL RUN TIMER — the existing authoritative PLAYHEAD run timer.
 *                           hold-R abandons the attempt and starts a fresh run;
 *                           tap-R checkpoint restore behaves exactly as normal
 *                           PLAYHEAD and does not reset run time.
 *   - Players are independent: A resetting or finishing never affects B.
 *   - Each attempt that completes records a SESSION BEST if faster.
 *   - At the end, LOWEST BEST VALID COMPLETION TIME wins. One finisher wins.
 *     Nobody finishing = NO FINISH. Exact equal microseconds = TIE.
 *
 * Comparison always uses raw microsecond timer values, never formatted strings.
 *
 * AUTHORITY: Supabase handles presence, lobby, countdown, ghost presentation and
 * results communication ONLY. It never controls movement, collision, surf
 * physics, checkpoints or finish detection — the local 120 Hz simulation stays
 * authoritative for the local run.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { OnlineClient, online } from './supabaseClient';
import { AuthService, authService } from './AuthService';
import { MapIdentity, computeMapIdentity } from './MapIdentity';
import { GeneratedTrack } from '../generation/GenerationTypes';

/** Default shared session length, in seconds. */
export const DEFAULT_SESSION_SECONDS = 300;
/** How far ahead the synchronized GO is scheduled, in ms. */
export const COUNTDOWN_LEAD_MS = 3800;
/** Remote ghost broadcast rate (Hz). Never 120 Hz — this is not a game server. */
export const GHOST_BROADCAST_HZ = 12;

export type RoomState = 'LOBBY' | 'COUNTDOWN' | 'RUNNING' | 'FINISHED' | 'EXPIRED';

export interface RaceRoom {
  id: string;
  inviteCode: string;
  hostUserId: string;
  trackId: string;
  trackTitle: string;
  mapVersion: number;
  mapFingerprint: string;
  state: RoomState;
  sessionSeconds: number;
  /** Epoch ms of the synchronized GO. All clients count down to this. */
  startAtMs: number | null;
  finishedAtMs: number | null;
  expiresAtMs: number;
}

export interface RacePlayer {
  userId: string;
  displayName: string;
  ready: boolean;
  connected: boolean;
  /** Attempts started in this session. */
  attemptCount: number;
  /** Completions in this session. */
  finishCount: number;
  /** Best VALID completion time in this session, in microseconds. */
  sessionBestUs: number | null;
  /** The attempt currently being run, in microseconds (live display only). */
  currentRunUs: number;
  joinedAt: number;
  lastSeenAt: number;
}

/** Presentation-only remote ghost sample. Never collision, never authority. */
export interface GhostSample {
  userId: string;
  /** Local session clock time when the sample was produced (ms). */
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vy: number;
  vz: number;
  /** Whether the remote player is mid-attempt or has reset to spawn. */
  running: boolean;
  attempt: number;
}

export interface ReadyUpdateResult {
  at: number;
  requested: boolean;
  ok: boolean;
  rows: number;
  detail: string;
}

export type RaceOutcome = 'WIN' | 'LOSS' | 'TIE' | 'NO_FINISH';

export interface RaceResultRow {
  userId: string;
  displayName: string;
  sessionBestUs: number | null;
  attemptCount: number;
  finishCount: number;
  outcome: RaceOutcome;
  /** Difference from the winner, in microseconds (null when no finish). */
  gapUs: number | null;
}

/**
 * Whether the lobby is actually startable.
 *
 * The host may start ONLY when two room-player rows exist, both are connected,
 * and both are ready. Pure so the rule is unit-testable and cannot drift from
 * the UI that renders it.
 *
 * Canonical MAP IDENTITY is deliberately a SEPARATE gate, checked before this
 * one: a player blocked by map verification is not "not ready", and the lobby
 * must say MAP VERIFYING / MAP MISMATCH rather than implying they never clicked.
 */
export function computeBothReady(players: readonly RacePlayer[]): boolean {
  const connected = players.filter((p) => p.connected);
  return connected.length >= 2 && connected.every((p) => p.ready);
}

/**
 * Ranks a finished session by BEST VALID COMPLETION TIME.
 * Pure function so it is unit-testable without any network.
 */
export function computeSessionResults(players: readonly RacePlayer[]): RaceResultRow[] {
  const finishers = players.filter((p) => p.sessionBestUs !== null && p.sessionBestUs > 0);
  const best = finishers.length > 0 ? Math.min(...finishers.map((p) => p.sessionBestUs!)) : null;
  const winners = best === null ? [] : finishers.filter((p) => p.sessionBestUs === best);

  const rows: RaceResultRow[] = players.map((p) => {
    let outcome: RaceOutcome;
    if (best === null) {
      outcome = 'NO_FINISH';
    } else if (p.sessionBestUs === null || p.sessionBestUs <= 0) {
      outcome = 'LOSS';
    } else if (winners.length > 1) {
      outcome = 'TIE';
    } else if (p.sessionBestUs === best) {
      outcome = 'WIN';
    } else {
      outcome = 'LOSS';
    }
    return {
      userId: p.userId,
      displayName: p.displayName,
      sessionBestUs: p.sessionBestUs,
      attemptCount: p.attemptCount,
      finishCount: p.finishCount,
      outcome,
      gapUs: best !== null && p.sessionBestUs !== null ? p.sessionBestUs - best : null
    };
  });

  // Ascending by best time; non-finishers last, ordered by attempt count.
  rows.sort((a, b) => {
    if (a.sessionBestUs === null && b.sessionBestUs === null) return b.attemptCount - a.attemptCount;
    if (a.sessionBestUs === null) return 1;
    if (b.sessionBestUs === null) return -1;
    return a.sessionBestUs - b.sessionBestUs;
  });
  return rows;
}

/** Remaining session time in ms. Never negative; never resets on restart. */
export function sessionRemainingMs(room: RaceRoom, nowMs: number): number {
  if (room.startAtMs === null) return room.sessionSeconds * 1000;
  const end = room.startAtMs + room.sessionSeconds * 1000;
  return Math.max(0, end - nowMs);
}

export interface RaceRoomCallbacks {
  onRoomUpdate?: (room: RaceRoom, players: RacePlayer[]) => void;
  onGhost?: (sample: GhostSample) => void;
  onPlayerJoined?: (player: RacePlayer) => void;
  onPlayerLeft?: (userId: string) => void;
  onFinished?: (results: RaceResultRow[]) => void;
  onError?: (detail: string) => void;
}

/**
 * Whether an inbound ghost packet may drive the remote opponent ghost.
 *
 * Three rules, all load-bearing:
 *   1. The local player's OWN transform must never be rendered as a remote
 *      ghost. `broadcast: { self: false }` already prevents the echo, and this
 *      is the second, independent guard.
 *   2. Stale packets are dropped: a frozen ghost is worse than none.
 *   3. A sample with no local identity cannot be attributed, so it is refused.
 *
 * Pure, so the rule is unit-testable without a live Realtime channel.
 */
export function shouldAcceptRemoteGhost(
  sample: GhostSample | undefined,
  localUserId: string | null,
  nowMs: number = Date.now()
): boolean {
  if (!sample) return false;
  if (!localUserId) return false;
  if (sample.userId === localUserId) return false;
  if (!Number.isFinite(sample.t)) return false;
  if (Math.abs(nowMs - sample.t) > 1000) return false;
  return true;
}

export class RaceRoomService {
  private channel: RealtimeChannel | null = null;
  private room: RaceRoom | null = null;
  private players: RacePlayer[] = [];
  private callbacks: RaceRoomCallbacks = {};
  private ghostTimer: number | null = null;
  /**
   * LATEST LOCAL PRESENTATION TRANSFORM — deliberately NOT a packet.
   *
   * The game loop stores the current transform here every active frame. The
   * BROADCAST CADENCE owns the packet: it stamps `t = Date.now()` at send time.
   *
   * This separation is what makes background throttling survivable. Previously
   * the timestamp was stamped inside the rAF-driven game update, so when a
   * background tab stopped animating its `t` froze and every re-sent packet was
   * rejected as stale by the receiver — the opponent vanished even though the
   * network was fine.
   */
  private myTransform: Omit<GhostSample, 'userId' | 't' | 'attempt'> | null = null;
  /** Locally tracked attempt index, used to reset the remote ghost to spawn. */
  private attemptIndex = 0;
  /** DEV lobby diagnostics. */
  private lobbySyncTimer: number | null = null;
  private realtimePlayerEvents = 0;
  private lastReadyUpdate: ReadyUpdateResult | null = null;
  /** DEV ghost-pipeline diagnostics (presentation only). */
  private ghostTxCount = 0;
  private ghostTxAt = 0;
  private ghostTxBackgroundCount = 0;
  private ghostRxCount = 0;
  private ghostRxAt = 0;
  private ghostRxUserId: string | null = null;
  /** DEV visibility diagnostics. */
  private lastVisibilityChangeAt = 0;
  private windowFocused = true;
  private visibilityListenersAttached = false;

  constructor(
    private readonly onlineClient: OnlineClient = online,
    private readonly auth: AuthService = authService
  ) {}

  public getRoom(): RaceRoom | null {
    return this.room;
  }

  public getPlayers(): readonly RacePlayer[] {
    return this.players;
  }

  public getInviteUrl(): string | null {
    if (!this.room) return null;
    // Never hardcode a production domain: use the current app origin.
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/?room=${this.room.inviteCode}`;
  }

  public setCallbacks(callbacks: RaceRoomCallbacks): void {
    this.callbacks = callbacks;
  }

  /** Reads ?room=CODE from the current URL. */
  public static readInviteCodeFromUrl(url?: string): string | null {
    const target = url ?? (typeof window !== 'undefined' ? window.location.href : '');
    if (!target) return null;
    try {
      const parsed = new URL(target, 'http://localhost');
      const code = parsed.searchParams.get('room');
      return code ? code.trim().toUpperCase() : null;
    } catch {
      return null;
    }
  }

  // -- room lifecycle ------------------------------------------------------

  /** Host: creates a room for an official track. */
  public async createRoom(params: {
    trackId: string;
    trackTitle: string;
    identity: MapIdentity;
    sessionSeconds?: number;
  }): Promise<{ ok: true; room: RaceRoom } | { ok: false; detail: string }> {
    const client = this.onlineClient.getClient();
    const userId = this.auth.getUserId();
    if (!client || !userId) return { ok: false, detail: 'not connected / not signed in' };

    const inviteCode = RaceRoomService.generateInviteCode();
    const sessionSeconds = params.sessionSeconds ?? DEFAULT_SESSION_SECONDS;

    const { data, error } = await client
      .from('race_rooms')
      .insert({
        invite_code: inviteCode,
        host_user_id: userId,
        track_id: params.trackId,
        track_title: params.trackTitle,
        map_version: params.identity.mapVersion,
        map_fingerprint: params.identity.mapFingerprint,
        state: 'LOBBY',
        session_seconds: sessionSeconds,
        expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
      })
      .select('*')
      .single();

    if (error || !data) return { ok: false, detail: error?.message ?? 'room insert failed' };

    this.room = RaceRoomService.rowToRoom(data);
    await this.joinRoomRow(this.room, true);
    return { ok: true, room: this.room };
  }

  /** Guest: resolves an invite code to a room and joins it. */
  public async joinByInviteCode(
    inviteCode: string
  ): Promise<{ ok: true; room: RaceRoom } | { ok: false; detail: string }> {
    const client = this.onlineClient.getClient();
    const userId = this.auth.getUserId();
    if (!client || !userId) return { ok: false, detail: 'not connected / not signed in' };

    const { data, error } = await client
      .from('race_rooms')
      .select('*')
      .eq('invite_code', inviteCode.toUpperCase())
      .maybeSingle();

    if (error) return { ok: false, detail: error.message };
    if (!data) return { ok: false, detail: 'room not found' };

    const room = RaceRoomService.rowToRoom(data);
    if (room.expiresAtMs < Date.now()) return { ok: false, detail: 'room expired' };

    this.room = room;
    await this.joinRoomRow(room, false);
    return { ok: true, room };
  }

  /**
   * Verifies the local map matches the room before a session may start.
   * A fingerprint mismatch MUST block the race: two different maps cannot be
   * compared competitively.
   */
  public verifyLocalMap(track: GeneratedTrack): { ok: boolean; detail: string } {
    if (!this.room) return { ok: false, detail: 'no room' };
    const local = computeMapIdentity(this.room.trackId, track);
    if (local.mapVersion !== this.room.mapVersion) {
      return {
        ok: false,
        detail: `MAP VERSION MISMATCH // room ${this.room.mapVersion} vs local ${local.mapVersion}`
      };
    }
    if (local.mapFingerprint !== this.room.mapFingerprint) {
      return {
        ok: false,
        detail:
          `MAP VERSION MISMATCH // fingerprint\n` +
          `room  ${this.room.mapFingerprint}\nlocal ${local.mapFingerprint}`
      };
    }
    return { ok: true, detail: 'map identity matches' };
  }

  private async joinRoomRow(room: RaceRoom, isHost: boolean): Promise<void> {
    const client = this.onlineClient.getClient();
    const userId = this.auth.getUserId();
    if (!client || !userId) return;

    const profile = this.auth.getProfile();
    await client.from('race_room_players').upsert(
      {
        room_id: room.id,
        user_id: userId,
        display_name: profile?.displayName ?? 'PLAYER',
        ready: isHost,
        connected: true,
        attempt_count: 0,
        finish_count: 0,
        session_best_us: null,
        current_run_us: 0,
        last_seen_at: new Date().toISOString()
      },
      { onConflict: 'room_id,user_id' }
    );

    await this.subscribe(room);
    await this.refreshPlayers();
  }

  /**
   * Sets the local player's ready flag.
   *
   * This deliberately VERIFIES the write. A PostgREST UPDATE that is blocked by
   * RLS, or whose filter matches nothing, returns 200 with an empty body and NO
   * error — which is exactly how "clicking READY does nothing" presented. So we
   * ask for the affected row back and treat zero rows as a failure.
   */
  public async setReady(ready: boolean): Promise<{ ok: boolean; detail: string }> {
    const client = this.onlineClient.getClient();
    const userId = this.auth.getUserId();
    if (!client) return this.failReady(ready, 'not connected');
    if (!userId) return this.failReady(ready, 'not signed in');
    if (!this.room) return this.failReady(ready, 'not in a room');

    try {
      const { data, error, status } = await client
        .from('race_room_players')
        .update({ ready, last_seen_at: new Date().toISOString() })
        .eq('room_id', this.room.id)
        .eq('user_id', userId)
        .select('room_id, user_id, ready');

      this.lastReadyUpdate = {
        at: Date.now(),
        requested: ready,
        ok: false,
        rows: 0,
        detail: ''
      };

      if (error) {
        this.lastReadyUpdate.detail = `${error.code ?? status}: ${error.message}`;
        await this.refreshPlayers();
        return { ok: false, detail: `READY FAILED // ${error.message}` };
      }

      const rows = data?.length ?? 0;
      this.lastReadyUpdate.rows = rows;
      if (rows === 0) {
        // Zero rows means the filter matched nothing: wrong room id, wrong user
        // id, or RLS blocked it. Treat as an error instead of silently failing.
        this.lastReadyUpdate.detail = 'zero rows updated (filter/RLS mismatch)';
        await this.refreshPlayers();
        return {
          ok: false,
          detail: 'READY FAILED // NO ROW UPDATED (SESSION OR RLS MISMATCH)'
        };
      }

      this.lastReadyUpdate.ok = true;
      this.lastReadyUpdate.detail = `updated ${rows} row`;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.lastReadyUpdate = {
        at: Date.now(),
        requested: ready,
        ok: false,
        rows: 0,
        detail
      };
      await this.refreshPlayers();
      return { ok: false, detail: `READY FAILED // ${detail}` };
    }

    // Always reconcile from the database. On success this confirms the write; on
    // failure it restores the true state instead of leaving our optimism on
    // screen. This is the same path Realtime uses, so there is one truth.
    await this.refreshPlayers();
    return { ok: true, detail: 'READY' };
  }

  /** Records a pre-flight READY failure so DEV diagnostics can show why. */
  private failReady(ready: boolean, detail: string): { ok: false; detail: string } {
    this.lastReadyUpdate = {
      at: Date.now(),
      requested: ready,
      ok: false,
      rows: 0,
      detail
    };
    return { ok: false, detail };
  }

  /** DEV diagnostics for the lobby. */
  public getLobbyDiagnostics(): {
    userIdSuffix: string;
    roomId: string;
    rowFound: boolean;
    readyLocal: boolean;
    readyDatabase: boolean | null;
    connected: boolean;
    realtimePlayerEvents: number;
    lastReadyUpdate: ReadyUpdateResult | null;
    lobbySyncActive: boolean;
  } {
    const userId = this.auth.getUserId() ?? '';
    const mine = this.players.find((p) => p.userId === userId);
    return {
      userIdSuffix: userId ? userId.slice(-6) : 'none',
      roomId: this.room ? this.room.id.slice(0, 8) : 'none',
      rowFound: !!mine,
      readyLocal: mine?.ready ?? false,
      readyDatabase: mine ? mine.ready : null,
      connected: mine?.connected ?? false,
      realtimePlayerEvents: this.realtimePlayerEvents,
      lastReadyUpdate: this.lastReadyUpdate,
      lobbySyncActive: this.lobbySyncTimer !== null
    };
  }

  /**
   * Polling fallback for the lobby.
   *
   * Realtime `postgres_changes` is the primary path, but it depends on the table
   * being in the `supabase_realtime` publication. If that is ever missing or the
   * socket drops, the lobby would silently stop converging. A light poll while
   * the room is still in LOBBY keeps both clients correct regardless; it stops
   * polling once the session starts, and is cleared on leave/disconnect.
   */
  public startLobbySync(intervalMs = 2000): void {
    if (typeof window === 'undefined') return;
    this.stopLobbySync();
    this.lobbySyncTimer = window.setInterval(() => {
      if (this.room && this.room.state === 'LOBBY') void this.refreshPlayers();
    }, intervalMs);
  }

  public stopLobbySync(): void {
    if (this.lobbySyncTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(this.lobbySyncTimer);
    }
    this.lobbySyncTimer = null;
  }

  public isHost(): boolean {
    return !!this.room && this.room.hostUserId === this.auth.getUserId();
  }

  /**
   * Host starts the session. The GO is scheduled at a server-side timestamp
   * sufficiently ahead of now that every client can align to it — we never send
   * "GO NOW" and hope packet arrival timing is fair.
   */
  public async startSession(): Promise<{ ok: boolean; detail: string; startAtMs?: number }> {
    const client = this.onlineClient.getClient();
    if (!client || !this.room) return { ok: false, detail: 'no room' };
    if (!this.isHost()) return { ok: false, detail: 'host only' };

    const everyoneReady = this.players.length >= 2 && this.players.every((p) => p.ready || !p.connected);
    if (!everyoneReady) return { ok: false, detail: 'not all players ready' };

    const startAtMs = Date.now() + COUNTDOWN_LEAD_MS;
    const { error } = await client
      .from('race_rooms')
      .update({
        state: 'COUNTDOWN',
        started_at: new Date(startAtMs).toISOString(),
        start_at_ms: startAtMs
      })
      .eq('id', this.room.id);

    if (error) return { ok: false, detail: error.message };
    return { ok: true, detail: 'countdown scheduled', startAtMs };
  }

  // -- per-attempt reporting ----------------------------------------------

  /**
   * Local player started (or restarted) an attempt.
   * Increments the attempt counter and resets the remote ghost to spawn.
   */
  public async reportAttemptStart(): Promise<void> {
    const client = this.onlineClient.getClient();
    const userId = this.auth.getUserId();
    if (!client || !userId || !this.room) return;

    this.attemptIndex++;
    // Full restart: the next published transform is the new spawn pose. The
    // transform itself is refreshed by the game loop on the very next frame, so
    // clearing it here can never leave the opponent without a position.
    this.myTransform = null;

    await client.rpc('race_report_attempt_start', {
      p_room_id: this.room.id,
      p_attempt_count: this.attemptIndex
    });
  }

  /**
   * Local player completed the map. Records a session best if faster.
   * Uses the RAW microsecond timer value; never a formatted string.
   */
  public async reportFinish(timeUs: number): Promise<void> {
    const client = this.onlineClient.getClient();
    const userId = this.auth.getUserId();
    if (!client || !userId || !this.room) return;
    if (!Number.isFinite(timeUs) || timeUs <= 0) return;

    await client.rpc('race_report_finish', {
      p_room_id: this.room.id,
      p_time_us: Math.round(timeUs)
    });
  }

  /** Low-frequency live attempt time for the opponent's HUD. */
  public async reportCurrentRun(timeUs: number): Promise<void> {
    const client = this.onlineClient.getClient();
    const userId = this.auth.getUserId();
    if (!client || !userId || !this.room) return;
    await client
      .from('race_room_players')
      .update({ current_run_us: Math.round(Math.max(0, timeUs)), last_seen_at: new Date().toISOString() })
      .eq('room_id', this.room.id)
      .eq('user_id', userId);
  }

  /** Ends the session and produces the shared result table. */
  public async finishSession(): Promise<RaceResultRow[]> {
    const client = this.onlineClient.getClient();
    const results = computeSessionResults(this.players);
    if (client && this.room && this.isHost()) {
      await client
        .from('race_rooms')
        .update({ state: 'FINISHED', finished_at: new Date().toISOString() })
        .eq('id', this.room.id);
    }
    this.callbacks.onFinished?.(results);
    return results;
  }

  // -- realtime ------------------------------------------------------------

  private async subscribe(room: RaceRoom): Promise<void> {
    const client = this.onlineClient.getClient();
    if (!client) return;
    await this.unsubscribe();

    const channel = client.channel(`race:${room.id}`, {
      config: { broadcast: { self: false } }
    });

    channel.on('broadcast', { event: 'ghost' }, (payload) => {
      const sample = payload?.payload as GhostSample | undefined;
      // Never render our own transform; drop stale packets. Presentation only.
      if (!sample) return;
      if (!shouldAcceptRemoteGhost(sample, this.auth.getUserId())) return;
      this.ghostRxCount++;
      this.ghostRxAt = Date.now();
      this.ghostRxUserId = sample.userId;
      this.callbacks.onGhost?.(sample);
    });

    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'race_room_players', filter: `room_id=eq.${room.id}` }, () => {
      this.realtimePlayerEvents++;
      void this.refreshPlayers();
    });
    channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'race_rooms', filter: `id=eq.${room.id}` }, (payload) => {
      const updated = payload?.new as Record<string, unknown> | undefined;
      if (!updated) return;
      this.room = RaceRoomService.rowToRoom(updated);
      this.callbacks.onRoomUpdate?.(this.room, this.players);
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        this.onlineClient.setStatus('ONLINE');
        // Resync on (re)connect: Realtime may have missed events while down.
        void this.refreshPlayers();
        this.startLobbySync();
      }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        this.onlineClient.setStatus('ERROR', `realtime ${status}`);
      }
    });

    this.channel = channel;
    // Fresh session: ghost pipeline counters start clean.
    this.ghostTxCount = 0;
    this.ghostTxAt = 0;
    this.ghostTxBackgroundCount = 0;
    this.ghostRxCount = 0;
    this.ghostRxAt = 0;
    this.ghostRxUserId = null;
    this.lastVisibilityChangeAt = 0;
    this.windowFocused = typeof document === 'undefined' || document.hasFocus();
    this.attachVisibilityListeners();
    this.startGhostBroadcast();
  }

  /**
   * The broadcast cadence is INDEPENDENT of requestAnimationFrame.
   *
   * A background tab throttles rAF to zero and timers to roughly 1 Hz, so this
   * interval may fire far less often than 12 Hz while hidden. That is expected
   * and acceptable: each tick still carries a FRESH timestamp and the last known
   * transform, so the opponent holds position instead of disappearing.
   */
  private startGhostBroadcast(): void {
    if (typeof window === 'undefined') return;
    this.stopGhostBroadcast();
    const intervalMs = Math.round(1000 / GHOST_BROADCAST_HZ);
    this.ghostTimer = window.setInterval(() => {
      this.publishNow();
    }, intervalMs);
  }

  private stopGhostBroadcast(): void {
    if (this.ghostTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(this.ghostTimer);
    }
    this.ghostTimer = null;
  }

  /**
   * Publishes the latest local transform immediately.
   *
   * Safe to call at any time: it no-ops without a channel or a stored transform.
   * Used by the 12 Hz tick and by every visibility / focus transition, so a tab
   * returning to the foreground never waits up to a full interval to reappear.
   */
  public publishNow(): void {
    if (!this.channel || !this.myTransform) return;
    const userId = this.auth.getUserId();
    if (!userId) return;
    const hidden = typeof document !== 'undefined' && document.hidden === true;
    const payload: GhostSample = {
      ...this.myTransform,
      userId,
      t: Date.now(),
      attempt: this.attemptIndex
    };
    this.ghostTxCount++;
    this.ghostTxAt = Date.now();
    if (hidden) this.ghostTxBackgroundCount++;
    // Broadcast only — no DB row per movement packet.
    void this.channel.send({ type: 'broadcast', event: 'ghost', payload });
  }

  /**
   * Stores the latest local presentation transform.
   *
   * Called every active game frame. Presentation only; the local simulation
   * stays authoritative and nothing here is ever fed back into physics.
   *
   * The stored object is MUTATED rather than replaced, so the hot path performs
   * no allocation. The broadcast tick only ever reads it.
   */
  public setLocalTransform(
    sample: Omit<GhostSample, 'userId' | 't' | 'attempt'>
  ): void {
    if (!this.auth.getUserId()) return;
    if (this.myTransform) {
      Object.assign(this.myTransform, sample);
      return;
    }
    this.myTransform = { ...sample };
  }

  /**
   * Foreground resync after a background pause or a focus change.
   *
   * Publishes immediately, then reconciles room membership so a socket that
   * dropped while hidden cannot leave a phantom opponent. It never touches the
   * session clock, the attempt timer, audio, the map or physics.
   */
  public resyncRacePresence(): void {
    this.publishNow();
    if (!this.room) return;
    void this.refreshPlayers();
  }

  private attachVisibilityListeners(): void {
    if (typeof window === 'undefined' || this.visibilityListenersAttached) return;
    this.visibilityListenersAttached = true;

    document.addEventListener('visibilitychange', () => {
      this.lastVisibilityChangeAt = Date.now();
      if (document.hidden) {
        // Going hidden: one final transform while timers are still allowed.
        this.publishNow();
        return;
      }
      // Coming back: publish at once and reconcile presence.
      this.resyncRacePresence();
    });

    window.addEventListener('focus', () => {
      this.windowFocused = true;
      this.resyncRacePresence();
    });
    window.addEventListener('blur', () => {
      this.windowFocused = false;
    });

    // Page Lifecycle: a frozen tab resumes with a full resync.
    document.addEventListener('resume', () => {
      this.lastVisibilityChangeAt = Date.now();
      this.resyncRacePresence();
    });
  }

  /**
   * DEV diagnostics for the live ghost pipeline.
   *
   * Reports BOTH directions, because "the opponent is invisible" has two very
   * different causes: nothing is being published, or nothing is being received.
   * Also reports the visibility/focus state, because background throttling is
   * the third cause and is invisible without it.
   * Presentation only — never used by gameplay.
   */
  public getGhostDiagnostics(): {
    txCount: number;
    txAgeMs: number;
    txBackgroundCount: number;
    rxCount: number;
    rxAgeMs: number;
    rxUserId: string | null;
    hasLocalSample: boolean;
    roomState: RoomState | null;
    documentVisible: boolean;
    windowFocused: boolean;
    lastVisibilityChangeAt: number;
  } {
    const now = Date.now();
    return {
      txCount: this.ghostTxCount,
      txAgeMs: this.ghostTxAt > 0 ? now - this.ghostTxAt : -1,
      txBackgroundCount: this.ghostTxBackgroundCount,
      rxCount: this.ghostRxCount,
      rxAgeMs: this.ghostRxAt > 0 ? now - this.ghostRxAt : -1,
      rxUserId: this.ghostRxUserId,
      hasLocalSample: this.myTransform !== null,
      roomState: this.room?.state ?? null,
      documentVisible: typeof document === 'undefined' || document.hidden !== true,
      windowFocused: this.windowFocused,
      lastVisibilityChangeAt: this.lastVisibilityChangeAt
    };
  }

  private async refreshPlayers(): Promise<void> {
    const client = this.onlineClient.getClient();
    if (!client || !this.room) return;
    const { data } = await client
      .from('race_room_players')
      .select('*')
      .eq('room_id', this.room.id);

    const previous = new Map(this.players.map((p) => [p.userId, p]));
    this.players = (data ?? []).map((row) => RaceRoomService.rowToPlayer(row));

    for (const player of this.players) {
      if (!previous.has(player.userId)) this.callbacks.onPlayerJoined?.(player);
    }
    for (const [userId] of previous) {
      if (!this.players.some((p) => p.userId === userId)) this.callbacks.onPlayerLeft?.(userId);
    }
    this.callbacks.onRoomUpdate?.(this.room, this.players);
  }

  /** Leaves the room and disposes every realtime resource. */
  public async leaveRoom(): Promise<void> {
    const client = this.onlineClient.getClient();
    const userId = this.auth.getUserId();
    if (client && this.room && userId) {
      await client
        .from('race_room_players')
        .update({ connected: false, last_seen_at: new Date().toISOString() })
        .eq('room_id', this.room.id)
        .eq('user_id', userId);
    }
    await this.unsubscribe();
    this.room = null;
    this.players = [];
    this.myTransform = null;
    this.attemptIndex = 0;
    this.realtimePlayerEvents = 0;
    this.lastReadyUpdate = null;
  }

  public async unsubscribe(): Promise<void> {
    this.stopGhostBroadcast();
    this.stopLobbySync();
    if (this.channel) {
      const client = this.onlineClient.getClient();
      if (client) await client.removeChannel(this.channel);
      this.channel = null;
    }
  }

  // -- helpers -------------------------------------------------------------

  private static generateInviteCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return code;
  }

  private static rowToRoom(row: Record<string, unknown>): RaceRoom {
    return {
      id: row.id as string,
      inviteCode: row.invite_code as string,
      hostUserId: row.host_user_id as string,
      trackId: row.track_id as string,
      trackTitle: (row.track_title as string) ?? '',
      mapVersion: Number(row.map_version ?? 0),
      mapFingerprint: (row.map_fingerprint as string) ?? '',
      state: (row.state as RoomState) ?? 'LOBBY',
      sessionSeconds: Number(row.session_seconds ?? DEFAULT_SESSION_SECONDS),
      startAtMs: row.start_at_ms === null || row.start_at_ms === undefined ? null : Number(row.start_at_ms),
      finishedAtMs: row.finished_at ? new Date(row.finished_at as string).getTime() : null,
      expiresAtMs: row.expires_at ? new Date(row.expires_at as string).getTime() : Number.MAX_SAFE_INTEGER
    };
  }

  private static rowToPlayer(row: Record<string, unknown>): RacePlayer {
    return {
      userId: row.user_id as string,
      displayName: (row.display_name as string) ?? 'PLAYER',
      ready: row.ready === true,
      connected: row.connected !== false,
      attemptCount: Number(row.attempt_count ?? 0),
      finishCount: Number(row.finish_count ?? 0),
      sessionBestUs: row.session_best_us === null || row.session_best_us === undefined
        ? null
        : Number(row.session_best_us),
      currentRunUs: Number(row.current_run_us ?? 0),
      joinedAt: row.joined_at ? new Date(row.joined_at as string).getTime() : 0,
      lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at as string).getTime() : 0
    };
  }
}

export const raceRoomService = new RaceRoomService();
