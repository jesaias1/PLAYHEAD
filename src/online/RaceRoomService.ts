/**
 * RACE ROOM SERVICE — ONLINE RACE 2.0, a FIRST-TO-FINISH multiplayer race.
 *
 * This is NOT the old best-time session. A room holds 2-8 simultaneous racers:
 *
 *   - The room is created against an OFFICIAL Signal Pack track (host picks it).
 *   - LOBBY READY      -> every connected member ready  -> LOADING (server lock)
 *   - LOADING          -> every member reports CLIENT_LOADED -> IN_GAME
 *   - IN_GAME          -> every member presses IN-GAME READY -> COUNTDOWN
 *   - COUNTDOWN        -> server forges ONE shared start_at_ms epoch -> RUNNING
 *   - RUNNING          -> every client derives raceElapsed = serverNow - start_at_ms
 *   - FINISHED         -> standings (finish order first, DNF last), rematch
 *
 * The FIRST participant whose run reaches the finish gate wins. Players who
 * finish keep spectating while the rest race. A single unified ROOM CLOCK is
 * used for the start and the race timer, so a late packet can never give one
 * player a permanent head start.
 *
 * AUTHORITY: Supabase (SECURITY DEFINER functions + triggers) owns membership,
 * phase, readiness, selected track, the shared start timestamp and the
 * server-derived finish elapsed. The room is locked once LOADING begins, so no
 * one can join a race mid-load. Every race message carries the room race_id;
 * packets from a previous race instance are rejected.
 *
 * CLIENT: the local 120 Hz simulation stays authoritative for this client's
 * movement, collision, surf physics, checkpoints and finish detection. The
 * service only communicates race state and broadcasts presentation transforms.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { OnlineClient, online } from './supabaseClient';
import { AuthService, authService } from './AuthService';
import { MapIdentity, computeMapIdentity } from './MapIdentity';
import { GeneratedTrack } from '../generation/GenerationTypes';
import { KarambitSkinSystem } from '../viewmodel/KarambitSkinSystem';
import { MasteryGloveSystem } from '../mastery/MasteryGloveSystem';

/** Legacy session length kept only so a pre-2.0 room row still parses. */
export const DEFAULT_SESSION_SECONDS = 300;
/** How far ahead the synchronized GO is scheduled, in ms. */
export const COUNTDOWN_LEAD_MS = 3800;
/** Remote ghost broadcast rate (Hz). Never 120 Hz — this is not a game server. */
export const GHOST_BROADCAST_HZ = 12;
/** Unambiguous room-code alphabet: no 0/O/1/I/L to misread over voice. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Default room code length. */
export const ROOM_CODE_LENGTH = 6;
/** Selectable room sizes; 4 is the recommended default. */
export const RACE_CAPACITIES = [2, 3, 4, 6, 8] as const;
export const DEFAULT_RACE_CAPACITY = 4;
export const MIN_RACE_PLAYERS = 2;

export type RoomState =
  | 'LOBBY'
  | 'LOADING'
  | 'IN_GAME'
  | 'COUNTDOWN'
  | 'RUNNING'
  | 'FINISHED'
  | 'EXPIRED';

/** True once the room has locked the race setup and clients are auto-loading. */
export function isRaceStarted(state: RoomState): boolean {
  return state === 'LOADING' || state === 'IN_GAME' || state === 'COUNTDOWN' || state === 'RUNNING';
}

export interface RaceRoom {
  id: string;
  inviteCode: string;
  hostUserId: string;
  trackId: string;
  trackTitle: string;
  mapVersion: number;
  mapFingerprint: string;
  state: RoomState;
  /** Maximum simultaneous racers (2/3/4/6/8). */
  capacity: number;
  /**
   * Race instance. Recomputed on every rematch so stale messages from a
   * previous race can never touch the new one.
   */
  raceId: string;
  /** Epoch ms of the synchronized GO. All clients count down to this. */
  startAtMs: number | null;
  finishedAtMs: number | null;
  expiresAtMs: number;
}

export interface RacePlayer {
  userId: string;
  displayName: string;
  /**
   * IMMUTABLE loadout metadata captured at join time from the authoritative
   * cosmetic systems. Presentation metadata only: the remote capsule never
   * renders a knife/glove, but the metadata must survive the whole race so the
   * lobby/results can identify players without re-reading live state.
   */
  loadout: { knifeId: string; gloveId: string } | null;
  /** LOBBY READY: ready to load the race. */
  ready: boolean;
  /** IN-GAME READY: the player has loaded AND pressed ready in-game. */
  inGameReady: boolean;
  /** CLIENT_LOADED: the player is inside the gameplay scene and initialised. */
  loaded: boolean;
  connected: boolean;
  /** Authoritative finish elapsed in microseconds; null until finished / DNF. */
  finishUs: number | null;
  /** True once the player has crossed the finish gate in this race. */
  finished: boolean;
  /** True when a disconnect / leave removed the player from the active race. */
  dnf: boolean;
  /** Stable per-race accent index (0..7). Assigned at join, frozen for the race. */
  colorIndex: number;
  joinedAt: number;
  lastSeenAt: number;
  /** Last checkpoint index this racer reported (placement + HUD only). */
  progress: number;
  /** Total checkpoints on the room's track, if the racer reported it. */
  checkpointTotal: number;
}

/** Presentation-only remote racer sample. Never collision, never authority. */
export interface GhostSample {
  sequence?: number;
  teleportId?: number;
  userId: string;
  /** Race instance this sample belongs to. Stale-race packets are rejected. */
  raceId: string;
  /** Stable per-race accent index (0..7). */
  colorIndex: number;
  /** Local wall-clock time when the sample was produced (ms). */
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vy: number;
  vz: number;
  /** Route/checkpoint progress for placement and the HUD. */
  checkpointIndex: number;
  checkpointTotal: number;
  /** False once the racer has finished (or DNF). */
  running: boolean;
}

export interface ReadyUpdateResult {
  at: number;
  requested: boolean;
  ok: boolean;
  rows: number;
  detail: string;
}

/** Per-player result row. Order is authoritative: finish times first, DNF last. */
export interface RaceResultRow {
  userId: string;
  displayName: string;
  /** Authoritative finish elapsed in microseconds; null for DNF / no finish. */
  finishTimeUs: number | null;
  dnf: boolean;
  /** 1-based placement among finishers; null for DNF. */
  place: number | null;
  /** Difference to the winner in microseconds; null for DNF. */
  gapUs: number | null;
}

/**
 * Whether the lobby is startable: at least MIN_RACE_PLAYERS connected members,
 * all of them ready. Pure so the rule is unit-testable and cannot drift from
 * the UI that renders it. Never requires the room to be FULL.
 */
export function computeAllReady(players: readonly RacePlayer[]): boolean {
  const connected = players.filter((p) => p.connected);
  return connected.length >= MIN_RACE_PLAYERS && connected.every((p) => p.ready);
}

/**
 * Whether the in-game stage is startable: at least MIN_RACE_PLAYERS connected
 * members, all of them loaded AND in-game ready.
 */
export function computeInGameReady(players: readonly RacePlayer[]): boolean {
  const connected = players.filter((p) => p.connected);
  return connected.length >= MIN_RACE_PLAYERS && connected.every((p) => p.loaded && p.inGameReady);
}

/**
 * Ranks a race by FINISH ORDER (shared authoritative elapsed), with
 * disconnects / DNF last. Pure function so it is unit-testable without network.
 *
 * Immutability rule: once a finisher's time is recorded it is never recomputed.
 * The input already carries that frozen time.
 */
export function computeRaceResults(players: readonly RacePlayer[]): RaceResultRow[] {
  const finishers = players
    .filter((p) => !p.dnf && p.finishUs !== null && p.finishUs > 0)
    .sort((a, b) => {
      if (a.finishUs! !== b.finishUs!) return a.finishUs! - b.finishUs!;
      return a.joinedAt - b.joinedAt;
    });
  const winner = finishers.length > 0 ? finishers[0].finishUs! : null;

  const finisherRows: RaceResultRow[] = finishers.map((p, index) => ({
    userId: p.userId,
    displayName: p.displayName,
    finishTimeUs: p.finishUs,
    dnf: false,
    place: index + 1,
    gapUs: winner !== null && p.finishUs !== null ? p.finishUs - winner : null
  }));

  // DNF LAST: explicit DNF/disconnect first, then players who simply never
  // finished, ordered by join time for stability.
  const nonFinishers = players
    .filter((p) => p.dnf || p.finishUs === null || p.finishUs <= 0)
    .sort((a, b) => {
      if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
      return a.joinedAt - b.joinedAt;
    });

  const dnfRows: RaceResultRow[] = nonFinishers.map((p) => ({
    userId: p.userId,
    displayName: p.displayName,
    finishTimeUs: null,
    dnf: p.dnf || !p.connected,
    place: null,
    gapUs: null
  }));

  return [...finisherRows, ...dnfRows];
}

/** True once every active racer has finished or DNF'd. */
export function isRaceComplete(players: readonly RacePlayer[]): boolean {
  const active = players.filter((p) => p.connected && !p.dnf);
  if (active.length === 0) return players.length > 0;
  return active.every((p) => p.finished || p.finishUs !== null);
}

/** How many active racers are still running (not finished, not DNF). */
export function activeRacerCount(players: readonly RacePlayer[]): number {
  return players.filter((p) => p.connected && !p.dnf && !p.finished && p.finishUs === null).length;
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
 * Whether an inbound ghost packet may drive a remote racer ghost.
 *
 * Rules, all load-bearing:
 *   1. The local player's OWN transform is never rendered as a remote ghost.
 *   2. A sample from a PREVIOUS race instance is rejected (raceId mismatch).
 *   3. Genuinely stale packets are dropped: a frozen ghost is worse than none.
 *   4. A sample with no local identity / race cannot be attributed, so it is
 *      refused.
 *
 * Pure, so the rule is unit-testable without a live Realtime channel.
 */
export function shouldAcceptRemoteGhost(
  sample: GhostSample | undefined,
  localUserId: string | null,
  currentRaceId: string | null,
  nowMs: number = Date.now()
): boolean {
  if (!sample) return false;
  if (!localUserId) return false;
  if (sample.userId === localUserId) return false;
  if (currentRaceId !== null && sample.raceId !== currentRaceId) return false;
  if (!Number.isFinite(sample.t)) return false;
  for (const value of [sample.x, sample.y, sample.z, sample.yaw, sample.pitch, sample.vx, sample.vy, sample.vz]) {
    if (!Number.isFinite(value) || Math.abs(value) > 10_000_000) return false;
  }
  if (sample.sequence !== undefined && (!Number.isSafeInteger(sample.sequence) || sample.sequence < 0)) return false;
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
   * That separation is what makes background throttling survivable.
   */
  private myTransform: Omit<GhostSample, 'userId' | 't' | 'raceId' | 'colorIndex'> | null = null;
  /** Locally tracked finish state for the broadcast payload. */
  private localRunning = true;
  /** My assigned accent index for the current race. */
  private myColorIndex = 0;
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
  /** Recently seen remote user ids, for per-player ghost presence. */
  private readonly remoteSeenAt = new Map<string, number>();
  /**
   * Offset from this browser's Date.now() to the AUTHORITATIVE server clock (ms).
   * Adopted from race_server_now() so every shared timestamp — countdown,
   * start, race elapsed, song position, finish — uses ONE authoritative timeline.
   */
  private serverOffsetMs = 0;
  private serverOffsetAt = 0;
  private clockSyncing = false;
  private adoptRoom(row: Record<string, unknown>): void {
    const next = RaceRoomService.rowToRoom(row);
    if (this.room && this.room.raceId !== next.raceId) {
      this.localRunning = true;
      this.remoteSeenAt.clear();
      this.myTransform = null;
    }
    this.room = next;
  }
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

  /** Authoritative server-clock offset in ms (server now minus local now). */
  public getServerClockOffsetMs(): number {
    return this.serverOffsetMs;
  }

  /** Authoritative "now" on the shared server timeline. */
  public getAuthoritativeNowMs(nowMs: number = Date.now()): number {
    return nowMs + this.serverOffsetMs;
  }

  /**
   * Shared race elapsed in microseconds, derived ONLY from the authoritative
   * start timestamp. Zero before GO. Never a local wall-clock stopwatch.
   */
  public getRaceElapsedUs(nowMs: number = Date.now()): number {
    if (!this.room || this.room.startAtMs === null) return 0;
    return Math.max(0, Math.round((this.getAuthoritativeNowMs(nowMs) - this.room.startAtMs) * 1000));
  }

  /** Adopts the server clock. Cheap and idempotent; safe to call often. */
  private async adoptServerClock(): Promise<void> {
    if (this.clockSyncing || (this.serverOffsetAt > 0 && Date.now() - this.serverOffsetAt < 10000)) return;
    const client = this.onlineClient.getClient();
    if (!client) return;
    this.clockSyncing = true;
    try {
      let bestRtt = Infinity, offset = this.serverOffsetMs;
      for (let i = 0; i < (this.serverOffsetAt === 0 ? 3 : 1); i++) {
        const sent = Date.now();
        const { data, error } = await client.rpc('race_server_now');
        const received = Date.now(), ms = Number(data);
        if (!error && Number.isFinite(ms) && ms > 0 && received - sent < bestRtt) {
          bestRtt = received - sent;
          offset = ms - (sent + received) / 2;
        }
      }
      if (Number.isFinite(bestRtt)) {
        this.serverOffsetMs = offset;
        this.serverOffsetAt = Date.now();
      }
    } catch {
      /* clock adoption is best-effort; a local fallback still works */
    } finally {
      this.clockSyncing = false;
    }
  }

  public getServerOffsetAgeMs(): number {
    return this.serverOffsetAt > 0 ? Date.now() - this.serverOffsetAt : -1;
  }

  public getPlayers(): readonly RacePlayer[] {
    return this.players;
  }

  public getCapacity(): number {
    return this.room?.capacity ?? DEFAULT_RACE_CAPACITY;
  }

  public getRaceId(): string | null {
    return this.room?.raceId ?? null;
  }

  public getInviteCode(): string | null {
    return this.room?.inviteCode ?? null;
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
      return code ? RaceRoomService.normalizeCode(code) : null;
    } catch {
      return null;
    }
  }

  /** Uppercases, strips whitespace and maps common ambiguous characters. */
  public static normalizeCode(raw: string): string {
    return raw
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .replace(/O/g, '0')
      .replace(/[IL]/g, '1');
  }

  /** Generates a shareable room code from the unambiguous alphabet. */
  public static generateInviteCode(length = ROOM_CODE_LENGTH): string {
    let code = '';
    for (let i = 0; i < length; i++) {
      code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    }
    return code;
  }

  // -- room lifecycle ------------------------------------------------------

  /**
   * Host: creates a room for an official track.
   *
   * The invitation code is generated CLIENT-SIDE from the unambiguous alphabet
   * so it is always an unambiguous uppercase string; the race_rooms.code CHECK
   * enforces the invariant in the database. A collision is retried.
   */
  public async createRoom(params: {
    trackId: string;
    trackTitle: string;
    identity: MapIdentity;
    capacity?: number;
  }): Promise<{ ok: true; room: RaceRoom } | { ok: false; detail: string }> {
    const client = this.onlineClient.getClient();
    const userId = this.auth.getUserId();
    if (!client || !userId) return { ok: false, detail: 'not connected / not signed in' };

    const requested = Number(params.capacity ?? DEFAULT_RACE_CAPACITY);
    const capacity = (RACE_CAPACITIES as readonly number[]).includes(requested)
      ? requested
      : DEFAULT_RACE_CAPACITY;

    for (let attempt = 0; attempt < 6; attempt++) {
      const inviteCode = RaceRoomService.generateInviteCode();
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
          capacity,
          expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
        })
        .select('*')
        .single();

      if (error) {
        // 23505 = unique_violation: retry with a fresh code.
        if ((error as { code?: string }).code === '23505') continue;
        return { ok: false, detail: error.message };
      }
      if (!data) return { ok: false, detail: 'room insert returned no row' };

      this.room = RaceRoomService.rowToRoom(data as Record<string, unknown>);
      const joined = await this.joinRoomRow(this.room, true);
      if (!joined.ok) {
        await this.unsubscribe();
        this.room = null;
        return { ok: false, detail: joined.detail };
      }
      return { ok: true, room: this.room };
    }
    return { ok: false, detail: 'could not allocate a unique room code' };
  }

  /** Guest: resolves a code to a room and joins it. */
  public async joinByInviteCode(
    inviteCode: string
  ): Promise<{ ok: true; room: RaceRoom } | { ok: false; detail: string }> {
    const client = this.onlineClient.getClient();
    const userId = this.auth.getUserId();
    if (!client || !userId) return { ok: false, detail: 'not connected / not signed in' };

    const code = RaceRoomService.normalizeCode(inviteCode);
    if (code.length < 4) return { ok: false, detail: 'invalid room code' };

    const { data, error } = await client.rpc('race_find_room_v2', { p_invite_code: code });

    if (error) return { ok: false, detail: error.message };
    if (!data) return { ok: false, detail: 'room not found' };

    const room = RaceRoomService.rowToRoom(data as Record<string, unknown>);
    if (room.expiresAtMs < Date.now()) return { ok: false, detail: 'room expired' };
    if (isRaceStarted(room.state) || room.state === 'FINISHED') {
      return { ok: false, detail: 'race already in progress' };
    }

    this.room = room;
    // ATOMIC join: the RPC takes a row lock, re-checks capacity and the phase,
    // and rejects the join if the room filled or locked between read and now.
    const joined = await this.joinRoomRow(room, false);
    if (!joined.ok) {
      this.room = null;
      return { ok: false, detail: joined.detail };
    }
    return { ok: true, room };
  }

  /**
   * Verifies the local map matches the room before a race may start.
   * A fingerprint mismatch MUST block the race: two different maps cannot be
   * raced competitively.
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
          `TRACK VERSION MISMATCH // fingerprint\n` +
          `room  ${this.room.mapFingerprint}\nlocal ${local.mapFingerprint}`
      };
    }
    return { ok: true, detail: 'map identity matches' };
  }

  /** Joins (or re-joins) the local account via the atomic membership RPC. */
  private async joinRoomRow(
    room: RaceRoom,
    _isHost: boolean
  ): Promise<{ ok: boolean; detail: string }> {
    const client = this.onlineClient.getClient();
    const userId = this.auth.getUserId();
    if (!client || !userId) return { ok: false, detail: 'not connected / not signed in' };

    const profile = this.auth.getProfile();
    // LOADOUT METADATA: captured ONCE, here, from the authoritative cosmetic
    // systems. It is locked by the DB guard after the lobby, so it can never
    // drift mid-race and never has to be re-read from live state.
    const loadout = {
      knifeId: KarambitSkinSystem.getInstance().getEquippedSkinId(),
      gloveId: String(MasteryGloveSystem.getInstance().getEquippedGloveId())
    };

    let rpcError = '';
    try {
      const { error } = await client.rpc('race_join_room', {
        p_room_id: room.id,
        p_display_name: profile?.displayName ?? 'PLAYER',
        p_loadout: loadout
      });
      if (error) rpcError = error.message;
    } catch (err) {
      rpcError = err instanceof Error ? err.message : String(err);
    }

    await this.adoptServerClock();
    await this.subscribe(room);
    await this.refreshPlayers();

    const joined = this.players.some((p) => p.userId === userId);
    if (joined) return { ok: true, detail: 'joined' };

    // NO DIRECT-UPSERT FALLBACK: a membership row may only be created by the
    // atomic, capacity-checked race_join_room RPC. A raw insert could otherwise
    // bypass the room lock and the capacity limit entirely.
    return { ok: false, detail: rpcError || 'join did not create a membership row' };
  }

  public isFull(): boolean {
    return (
      this.room !== null && this.players.filter((p) => p.connected).length >= this.room.capacity
    );
  }

  /**
   * Sets the local player's LOBBY ready flag.
   *
   * This deliberately VERIFIES the write: a PostgREST UPDATE blocked by RLS or
   * matching no row returns 200 with no rows, which is exactly how "clicking
   * READY does nothing" presented. Zero affected rows is treated as a failure.
   */
  public async setReady(ready: boolean): Promise<{ ok: boolean; detail: string }> {
    const client = this.onlineClient.getClient();
    const userId = this.auth.getUserId();
    if (!client) return this.failReady(ready, 'not connected');
    if (!userId) return this.failReady(ready, 'not signed in');
    if (!this.room) return this.failReady(ready, 'not in a room');

    try {
      const { error, status } = await client.rpc('race_set_ready_v2', {
        p_room_id: this.room.id,
        p_race_id: this.room.raceId,
        p_ready: ready
      });

      this.lastReadyUpdate = { at: Date.now(), requested: ready, ok: false, rows: 0, detail: '' };

      if (error) {
        this.lastReadyUpdate.detail = `${error.code ?? status}: ${error.message}`;
        await this.refreshPlayers();
        return { ok: false, detail: `READY FAILED // ${error.message}` };
      }

      this.lastReadyUpdate.rows = 1;
      this.lastReadyUpdate.ok = true;
      this.lastReadyUpdate.detail = 'updated 1 row';
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.lastReadyUpdate = { at: Date.now(), requested: ready, ok: false, rows: 0, detail };
      await this.refreshPlayers();
      return { ok: false, detail: `READY FAILED // ${detail}` };
    }

    await this.refreshPlayers();
    return { ok: true, detail: 'READY' };
  }

  /**
   * CLIENT_LOADED: reports that this client is actually inside the gameplay
   * scene and fully initialised. Server-authoritative; a client can only ever
   * mark itself. Never advances the countdown on its own.
   */
  public async reportLoaded(loaded = true): Promise<{ ok: boolean; detail: string }> {
    const client = this.onlineClient.getClient();
    const userId = this.auth.getUserId();
    if (!client) return { ok: false, detail: 'not connected' };
    if (!userId) return { ok: false, detail: 'not signed in' };
    if (!this.room) return { ok: false, detail: 'not in a room' };
    try {
      const { error } = await client.rpc('race_report_loaded_v2', {
        p_room_id: this.room.id,
        p_race_id: this.room.raceId,
        p_loaded: loaded
      });
      if (error) {
        await this.refreshPlayers();
        return { ok: false, detail: error.message };
      }
    } catch (err) {
      await this.refreshPlayers();
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
    await this.refreshPlayers();
    this.callbacks.onRoomUpdate?.(this.room, this.players);
    return { ok: true, detail: 'LOADED' };
  }

  /** IN-GAME READY (the SECOND ready stage). Server enforces the IN_GAME phase. */
  public async setInGameReady(ready: boolean): Promise<{ ok: boolean; detail: string }> {
    const client = this.onlineClient.getClient();
    const userId = this.auth.getUserId();
    if (!client) return { ok: false, detail: 'not connected' };
    if (!userId) return { ok: false, detail: 'not signed in' };
    if (!this.room) return { ok: false, detail: 'not in a room' };

    try {
      const { error } = await client.rpc('race_set_in_game_ready_v2', {
        p_room_id: this.room.id,
        p_race_id: this.room.raceId,
        p_ready: ready
      });
      if (error) {
        await this.refreshPlayers();
        return { ok: false, detail: 'IN-GAME READY FAILED // ' + error.message };
      }
    } catch (err) {
      await this.refreshPlayers();
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }

    await this.refreshPlayers();
    this.callbacks.onRoomUpdate?.(this.room, this.players);
    return { ok: true, detail: 'READY' };
  }

  /**
   * Marks the race live once this client actually reaches GO (idempotent).
   * The RPC flips COUNTDOWN -> RUNNING only after the authoritative instant.
   */
  public async markRunning(): Promise<{ ok: boolean; detail: string }> {
    const client = this.onlineClient.getClient();
    if (!client || !this.room) return { ok: false, detail: 'no room' };
    try {
      const { error } = await client.rpc('race_mark_running_v2', { p_room_id: this.room.id, p_race_id: this.room.raceId });
      if (error) return { ok: false, detail: error.message };
      return { ok: true, detail: 'RUNNING' };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Presence heartbeat: keeps a live tab from being expired server-side. */
  public async heartbeat(): Promise<void> {
    const client = this.onlineClient.getClient();
    if (!client || !this.room) return;
    try {
      await client.rpc('race_heartbeat_v2', { p_room_id: this.room.id, p_race_id: this.room.raceId });
    } catch {
      /* best effort: presence only */
    }
  }

  /** Marks this client disconnected so a closed tab stops counting as present. */
  public async markDisconnected(): Promise<void> {
    const client = this.onlineClient.getClient();
    if (!client || !this.room) return;
    try {
      await client.rpc('race_mark_disconnected_v2', { p_room_id: this.room.id, p_race_id: this.room.raceId });
    } catch {
      /* best effort: presence only */
    }
  }

  /**
   * Expires players whose heartbeat has stopped (a closed tab keeps no socket,
   * so the survivor's poll is what notices). Legitimate 20 s grace.
   */
  public async expireStalePlayers(): Promise<void> {
    const client = this.onlineClient.getClient();
    if (!client || !this.room) return;
    try {
      await client.rpc('race_expire_stale_players_v2', {
        p_room_id: this.room.id,
        p_race_id: this.room.raceId,
        p_grace_seconds: 20
      });
    } catch {
      /* best effort: presence only */
    }
  }

  /** Marks the room EXPIRED / abandons the current race for this member. */
  public async abandonSession(reason: string): Promise<{ ok: boolean; detail: string }> {
    const client = this.onlineClient.getClient();
    if (!client || !this.room) return { ok: false, detail: 'no room' };
    try {
      const { error } = await client.rpc('race_abandon_session_v2', {
        p_room_id: this.room.id,
        p_race_id: this.room.raceId,
        p_reason: reason
      });
      if (error) return { ok: false, detail: error.message };
      return { ok: true, detail: reason };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
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
   * Polling fallback for the lobby and the race. Realtime `postgres_changes` is
   * the primary path, but it depends on the table being in the
   * `supabase_realtime` publication. A light poll keeps every client correct
   * regardless; it is cleared on leave/disconnect.
   */
  public startLobbySync(intervalMs = 2000): void {
    if (typeof window === 'undefined') return;
    this.stopLobbySync();
    this.lobbySyncTimer = window.setInterval(() => {
      if (!this.room) return;
      // Presence: keep this client alive, and expire players whose heartbeat
      // stopped (a closed tab keeps no socket, so the survivor's poll notices).
      void this.heartbeat();
      void this.expireStalePlayers();
      // Poll EVERY active phase, not just LOBBY.
      if (
        isRaceStarted(this.room.state) ||
        this.room.state === 'LOBBY' ||
        this.room.state === 'FINISHED'
      ) {
        void this.refreshRoomAndPlayers();
      }
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
   * Host: picks the OFFICIAL track before the room locks. Rejected once the
   * race has started, both here and by the server guard.
   */
  public async selectTrack(
    trackId: string,
    trackTitle: string,
    identity: MapIdentity
  ): Promise<{ ok: boolean; detail: string }> {
    const client = this.onlineClient.getClient();
    if (!client || !this.room) return { ok: false, detail: 'no room' };
    if (!this.isHost()) return { ok: false, detail: 'host only' };
    if (this.room.state !== 'LOBBY') return { ok: false, detail: 'track is locked' };
    try {
      const { error } = await client.rpc('race_select_track_v2', {
        p_room_id: this.room.id,
        p_race_id: this.room.raceId,
        p_track_id: trackId,
        p_track_title: trackTitle,
        p_map_version: identity.mapVersion,
        p_map_fingerprint: identity.mapFingerprint
      });
      if (error) return { ok: false, detail: error.message };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
    await this.refreshRoomAndPlayers();
    return { ok: true, detail: 'track selected' };
  }

  /**
   * Records that this racer crossed the finish gate. The SERVER derives the
   * authoritative elapsed from the shared start epoch; the client value is a
   * fallback only, so a client can never declare its own winner or time.
   */
  public async reportFinish(progress?: {
    checkpointIndex?: number;
    checkpointTotal?: number;
  }): Promise<{ ok: boolean; detail: string }> {
    const client = this.onlineClient.getClient();
    const userId = this.auth.getUserId();
    if (!client || !userId || !this.room) return { ok: false, detail: 'no room' };
    if (this.room.state !== 'RUNNING') return { ok: false, detail: 'race is not running' };
    try {
      const { error } = await client.rpc('race_report_finish_v2', {
        p_room_id: this.room.id,
        p_race_id: this.room.raceId,
        p_progress: progress?.checkpointIndex ?? null
      });
      if (error) return { ok: false, detail: error.message };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
    this.localRunning = false;
    await this.refreshPlayers();
    return { ok: true, detail: 'FINISHED' };
  }

  /**
   * Checkpoint progress broadcast (~2 Hz, race-instance locked). Presentation
   * and placement only; it is never a scoring or finish input. Fire-and-forget
   * so a dropped progress packet can never affect movement or the race clock.
   */
  public async reportProgress(checkpointIndex: number, checkpointTotal: number): Promise<void> {
    const client = this.onlineClient.getClient();
    if (!client || !this.room) return;
    if (this.room.state !== 'RUNNING') return;
    try {
      await client.rpc('race_report_progress_v2', {
        p_room_id: this.room.id,
        p_race_id: this.room.raceId,
        p_checkpoint: checkpointIndex,
        p_total: checkpointTotal
      });
    } catch {
      /* best effort: placement only */
    }
  }

  /**
   * Records this member's explicit mid-race DNF (leave / abandon). The server
   * freezes a DNF flag; others keep racing.
   */
  public async reportDnf(): Promise<{ ok: boolean; detail: string }> {
    const client = this.onlineClient.getClient();
    if (!client || !this.room) return { ok: false, detail: 'no room' };
    try {
      const { error } = await client.rpc('race_report_dnf_v2', { p_room_id: this.room.id, p_race_id: this.room.raceId });
      if (error) return { ok: false, detail: error.message };
      return { ok: true, detail: 'DNF' };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  /** All remaining members reset the room for another race (rematch). */
  public async requestRematch(): Promise<{ ok: boolean; detail: string }> {
    const client = this.onlineClient.getClient();
    if (!client || !this.room) return { ok: false, detail: 'no room' };
    if (this.room.state !== 'FINISHED') return { ok: false, detail: 'race is not finished' };
    try {
      const { error } = await client.rpc('race_request_rematch_v2', { p_room_id: this.room.id, p_race_id: this.room.raceId });
      if (error) return { ok: false, detail: error.message };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
    this.localRunning = true;
    await this.refreshRoomAndPlayers();
    return { ok: true, detail: 'REMATCH' };
  }

  public async returnToLobby(): Promise<{ ok: boolean; detail: string }> {
    const client = this.onlineClient.getClient();
    if (!client || !this.room) return { ok: false, detail: 'no room' };
    const { error } = await client.rpc('race_return_lobby_v2', { p_room_id: this.room.id, p_race_id: this.room.raceId });
    if (error) return { ok: false, detail: error.message };
    await this.refreshRoomAndPlayers();
    return { ok: true, detail: 'LOBBY' };
  }

  /** True once every active racer has finished or DNF'd. */
  public isComplete(): boolean {
    return isRaceComplete(this.players);
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
      // Never render our own transform; drop stale / previous-race packets.
      if (!shouldAcceptRemoteGhost(sample, this.auth.getUserId(), this.room?.raceId ?? room.raceId, this.getAuthoritativeNowMs())) {
        return;
      }
      const member = this.players.find(p => p.userId === sample!.userId && p.connected && !p.dnf);
      if (!member) return;
      sample!.colorIndex = member.colorIndex;
      sample!.t = Date.now();
      const now = Date.now();
      this.ghostRxCount++;
      this.ghostRxAt = now;
      this.ghostRxUserId = sample!.userId;
      this.remoteSeenAt.set(sample!.userId, now);
      this.callbacks.onGhost?.(sample!);
    });

    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'race_room_players', filter: `room_id=eq.${room.id}` },
      () => {
        this.realtimePlayerEvents++;
        void this.refreshPlayers();
      }
    );
    channel.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'race_rooms', filter: `id=eq.${room.id}` },
      (payload) => {
        const updated = payload?.new as Record<string, unknown> | undefined;
        if (!updated) return;
        this.adoptRoom(updated);
        if (this.room) this.callbacks.onRoomUpdate?.(this.room, this.players);
      }
    );

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        this.onlineClient.setStatus('ONLINE');
        // Resync on (re)connect: Realtime may have missed events while down.
        void this.refreshPlayers();
        this.startLobbySync();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
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
    this.remoteSeenAt.clear();
    this.lastVisibilityChangeAt = 0;
    this.windowFocused = typeof document === 'undefined' || document.hasFocus();
    this.attachVisibilityListeners();
    this.startGhostBroadcast();
  }

  /**
   * The broadcast cadence is INDEPENDENT of requestAnimationFrame.
   *
   * A background tab throttles rAF to zero and timers to roughly 1 Hz, so this
   * interval may fire far less often than 12 Hz while hidden. That is expected:
   * each tick still carries a FRESH timestamp and the last known transform, so
   * other racers hold position instead of vanishing.
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
   * Publishes the latest local transform immediately. Safe to call any time: it
   * no-ops without a channel or a stored transform. Used by the 12 Hz tick and
   * by every visibility / focus transition.
   */
  public publishNow(): void {
    if (!this.channel || !this.myTransform || !this.room) return;
    const userId = this.auth.getUserId();
    if (!userId) return;
    const hidden = typeof document !== 'undefined' && document.hidden === true;
    const payload: GhostSample = {
      ...this.myTransform,
      sequence: this.ghostTxCount + 1,
      userId,
      raceId: this.room.raceId,
      colorIndex: this.myColorIndex,
      t: this.getAuthoritativeNowMs(),
      running: this.myTransform.running && this.localRunning
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
    sample: Omit<GhostSample, 'userId' | 't' | 'raceId' | 'colorIndex'>
  ): void {
    if (!this.auth.getUserId()) return;
    if (this.myTransform) {
      Object.assign(this.myTransform, sample);
      return;
    }
    this.myTransform = { ...sample };
  }

  /** My per-race accent index (0..7). */
  public getMyColorIndex(): number {
    return this.myColorIndex;
  }

  public isLocalRunning(): boolean {
    return this.localRunning;
  }

  /**
   * Foreground resync after a background pause or a focus change.
   *
   * Publishes immediately, then reconciles room membership so a socket that
   * dropped while hidden cannot leave a phantom racer. It never touches the
   * race clock, the timer, audio, the map or physics.
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
      this.resyncRacePresence();
    });

    window.addEventListener('focus', () => {
      this.windowFocused = true;
      this.resyncRacePresence();
    });
    window.addEventListener('blur', () => {
      this.windowFocused = false;
    });

    document.addEventListener('resume', () => {
      this.lastVisibilityChangeAt = Date.now();
      this.resyncRacePresence();
    });
  }

  /**
   * DEV diagnostics for the live ghost pipeline. Reports BOTH directions,
   * because "the racer is invisible" has two very different causes: nothing is
   * being published, or nothing is being received.
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

  /** Per-player ghost RX age (ms) — used to gate the in-game READY on evidence. */
  public getRemoteRxAgeMs(userId: string, now = Date.now()): number {
    const at = this.remoteSeenAt.get(userId);
    return at === undefined ? -1 : now - at;
  }

  /**
   * Poll fallback for BOTH room state and membership. Realtime can miss a room
   * UPDATE while a tab is throttled or a socket dropped; without this the
   * clients could disagree about the phase and stall.
   */
  public async refreshRoomAndPlayers(): Promise<void> {
    const client = this.onlineClient.getClient();
    if (!client || !this.room) return;
    try {
      const { data } = await client
        .from('race_rooms')
        .select('*')
        .eq('id', this.room.id)
        .maybeSingle();
      if (data) {
        this.adoptRoom(data as Record<string, unknown>);
        this.callbacks.onRoomUpdate?.(this.room, this.players);
      }
    } catch {
      /* keep the last known room on a transient failure */
    }
    await this.refreshPlayers();
  }

  private async refreshPlayers(): Promise<void> {
    const client = this.onlineClient.getClient();
    if (!client || !this.room) return;
    // Adopt the authoritative clock alongside the membership read so every
    // caller of onRoomPhase sees a fresh offset.
    void this.adoptServerClock();
    const { data } = await client
      .from('race_room_players')
      .select('*')
      .eq('room_id', this.room.id);

    const previous = new Map(this.players.map((p) => [p.userId, p]));
    this.players = (data ?? []).map((row) => RaceRoomService.rowToPlayer(row));

    // Stable accent assignment: derive my index from my own persisted row.
    const mine = this.players.find((p) => p.userId === this.auth.getUserId());
    if (mine) this.myColorIndex = mine.colorIndex;

    for (const player of this.players) {
      if (!previous.has(player.userId)) this.callbacks.onPlayerJoined?.(player);
    }
    for (const [userId] of previous) {
      if (!this.players.some((p) => p.userId === userId)) {
        this.remoteSeenAt.delete(userId);
        this.callbacks.onPlayerLeft?.(userId);
      }
    }
    this.callbacks.onRoomUpdate?.(this.room, this.players);
  }

  /** Leaves the room and disposes every realtime resource. */
  public async leaveRoom(): Promise<void> {
    const client = this.onlineClient.getClient();
    const userId = this.auth.getUserId();
    if (client && this.room && userId) {
      // Clear BOTH readiness flags as well as connected: a stale READY on a
      // re-join (or a reload) must never count toward the next race's gate.
      await this.markDisconnected();
    }
    await this.unsubscribe();
    this.room = null;
    this.players = [];
    this.myTransform = null;
    this.localRunning = true;
    this.myColorIndex = 0;
    this.realtimePlayerEvents = 0;
    this.lastReadyUpdate = null;
    this.remoteSeenAt.clear();
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

  private failReady(ready: boolean, detail: string): { ok: false; detail: string } {
    this.lastReadyUpdate = { at: Date.now(), requested: ready, ok: false, rows: 0, detail };
    return { ok: false, detail };
  }

  private static rowToRoom(row: Record<string, unknown>): RaceRoom {
    return {
      id: row.id as string,
      inviteCode: (row.invite_code as string) ?? '',
      hostUserId: row.host_user_id as string,
      trackId: (row.track_id as string) ?? '',
      trackTitle: (row.track_title as string) ?? '',
      mapVersion: Number(row.map_version ?? 0),
      mapFingerprint: (row.map_fingerprint as string) ?? '',
      state: (row.state as RoomState) ?? 'LOBBY',
      capacity: Number(row.capacity ?? DEFAULT_RACE_CAPACITY),
      raceId: (row.race_id as string) ?? 'race-1',
      startAtMs:
        row.start_at_ms === null || row.start_at_ms === undefined ? null : Number(row.start_at_ms),
      finishedAtMs: row.finished_at ? new Date(row.finished_at as string).getTime() : null,
      expiresAtMs: row.expires_at
        ? new Date(row.expires_at as string).getTime()
        : Number.MAX_SAFE_INTEGER
    };
  }

  private static rowToPlayer(row: Record<string, unknown>): RacePlayer {
    const rawLoadout = row.loadout as { knifeId?: unknown; gloveId?: unknown } | null | undefined;
    const loadout =
      rawLoadout && typeof rawLoadout === 'object'
        ? {
            knifeId: String(rawLoadout.knifeId ?? 'STANDARD_ISSUE'),
            gloveId: String(rawLoadout.gloveId ?? 'STANDARD_ISSUE')
          }
        : null;
    const finishUs =
      row.finish_us === null || row.finish_us === undefined ? null : Number(row.finish_us);
    return {
      userId: row.user_id as string,
      displayName: (row.display_name as string) ?? 'PLAYER',
      loadout,
      ready: row.ready === true,
      inGameReady: row.in_game_ready === true,
      loaded: row.loaded === true,
      connected: row.connected !== false,
      finishUs,
      finished: finishUs !== null || row.finished === true,
      dnf: row.dnf === true,
      colorIndex: Number(row.color_index ?? 0),
      joinedAt: row.joined_at ? new Date(row.joined_at as string).getTime() : 0,
      lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at as string).getTime() : 0,
      progress: Number(row.progress ?? 0),
      checkpointTotal: Number(row.checkpoint_total ?? 0)
    };
  }
}

export const raceRoomService = new RaceRoomService();
