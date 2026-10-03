/**
 * 05 // ONLINE RACE — the PLAYHEAD multiplayer race hub.
 *
 * Presentation only: every rule lives in RaceRoomService / the database state
 * machine. This module renders:
 *   - the CREATE / JOIN hub (official track, room size, room code)
 *   - the lobby (code, members, readiness, host track picker)
 *   - the results (finish order, times, DNF, rematch)
 *
 * Flow: pick an OFFICIAL signal -> CREATE ROOM (host) or JOIN CODE ->
 * lobby READY -> auto LOAD -> in-game READY -> shared countdown -> race ->
 * results -> REMATCH / LEAVE.
 */

import {
  RacePlayer,
  RaceRoom,
  RaceResultRow,
  computeAllReady,
  DEFAULT_RACE_CAPACITY
} from '../online/RaceRoomService';
import { formatRaceTime } from './RaceHud';
import { accentColorFor } from '../online/RemoteGhostRenderer';

export interface RaceCatalogEntry {
  id: string;
  title: string;
  bpm: number;
  difficultyLabel: string;
}

export interface RacePanelCallbacks {
  onCreateRoom: (trackId: string, capacity: number) => void;
  onJoinRoom: (code: string) => void;
  onSetReady: (ready: boolean) => void;
  onLeaveRoom: () => void;
  onRematch: () => void;
  onReturnToLobby: () => void;
  /** Host changes the official track before the room locks. */
  onHostPickTrack: (trackId: string) => void;
  /** The player NAME is the interaction target for opening a profile. */
  onOpenProfile: (userId: string, displayName: string) => void;
}

export class RacePanel {
  public element: HTMLElement;

  private callbacks: RacePanelCallbacks | null = null;

  private selectElem: HTMLSelectElement;
  private capacityElem: HTMLSelectElement;
  private joinInput: HTMLInputElement;
  private errorElem: HTMLElement;

  private selectView: HTMLElement;
  private lobbyView: HTMLElement;
  private resultsView: HTMLElement;

  private lobbyCodeElem: HTMLElement;
  private lobbyTitleElem: HTMLElement;
  private lobbyCapacityElem: HTMLElement;
  private lobbyPlayersElem: HTMLElement;
  private lobbyHostTrackElem: HTMLSelectElement;
  private lobbyInviteInput: HTMLInputElement;
  private lobbyReadyBtn: HTMLButtonElement;
  private lobbyStartBtn: HTMLButtonElement;
  private lobbyStatusElem: HTMLElement;
  private resultsElem: HTMLElement;
  private resultsTitleElem: HTMLElement;
  private rematchNoteElem: HTMLElement;

  private readyState = false;
  private isHost = false;
  private pendingReady = false;
  private pendingFromReady = false;
  private mapState: 'UNKNOWN' | 'VERIFYING' | 'OK' | 'MISMATCH' = 'UNKNOWN';
  private readyError = '';
  /** Most recent room, so the host track picker can be rebuilt in place. */
  private lastRoom: RaceRoom | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'showcase-container showcase-panel race-panel hidden';
    this.element.id = 'panel-race';
    this.element.setAttribute('role', 'tabpanel');
    this.element.setAttribute('aria-labelledby', 'tab-btn-race');
    this.element.setAttribute('aria-hidden', 'true');

    this.element.innerHTML = `
      <div class="race-error hidden" id="race-error"></div>

      <!-- View: CREATE / JOIN hub -->
      <div id="race-select-view">
        <div class="online-hub-title">ONLINE RACE</div>
        <div class="online-hub-actions">
          <div class="online-hub-card">
            <div class="online-hub-card-label">CREATE ROOM</div>
            <div class="online-row">
              <label class="online-label" for="race-track-select">SIGNAL</label>
              <select class="online-select" id="race-track-select"></select>
            </div>
            <div class="online-row">
              <label class="online-label" for="race-capacity-select">RACERS</label>
              <select class="online-select online-capacity-select" id="race-capacity-select">
                <option value="2">2 RACERS</option>
                <option value="3">3 RACERS</option>
                <option value="4" selected>4 RACERS // RECOMMENDED</option>
                <option value="6">6 RACERS</option>
                <option value="8">8 RACERS</option>
              </select>
            </div>
            <button class="btn-hero btn-terminal-exec" id="race-create-room" type="button">> CREATE ROOM</button>
          </div>

          <div class="online-hub-card">
            <div class="online-hub-card-label">JOIN CODE</div>
            <div class="online-row">
              <label class="online-label" for="race-join-input">CODE</label>
              <input class="online-input" id="race-join-input" type="text" maxlength="8"
                     placeholder="ROOM CODE" autocomplete="off" spellcheck="false" />
            </div>
            <button class="btn-hero btn-terminal-exec" id="race-join-btn" type="button">> JOIN ROOM</button>
          </div>
        </div>
        <div class="online-hint">
          First to the finish wins. 2-8 racers, official Signal Pack tracks only.
          Everyone starts on one synchronized clock.
        </div>
      </div>

      <!-- View: lobby -->
      <div id="race-lobby-view" class="hidden">
        <div class="online-lobby-head">
          <div class="online-lobby-code">ROOM // <span id="race-lobby-code">------</span></div>
          <div class="online-lobby-title" id="race-lobby-title">SIGNAL</div>
          <div class="online-lobby-clock">CAPACITY <b id="race-lobby-capacity">4</b></div>
        </div>

        <div class="online-invite-row">
          <span class="online-invite-label">INVITE LINK</span>
          <input class="online-input online-invite-input" id="race-invite-input" readonly />
          <button class="terminal-btn-subtle" id="race-copy-invite" type="button">COPY</button>
        </div>

        <div class="online-host-track hidden" id="race-host-track-row">
          <span class="online-invite-label">TRACK</span>
          <select class="online-select" id="race-host-track-select"></select>
        </div>

        <div class="online-players" id="race-lobby-players"></div>

        <div class="online-lobby-actions">
          <button class="btn-hero btn-terminal-exec" id="race-ready-btn" type="button">> READY</button>
          <button class="btn-hero btn-terminal-exec hidden" id="race-start-btn" type="button">> START RACE</button>
          <button class="terminal-btn-subtle" id="race-leave-btn" type="button">LEAVE ROOM</button>
        </div>
        <div class="online-lobby-status" id="race-lobby-status"></div>
      </div>

      <!-- View: results -->
      <div id="race-results-view" class="hidden">
        <div class="online-results-title" id="race-results-title">RACE COMPLETE</div>
        <div class="online-results" id="race-results"></div>
        <div class="online-lobby-status" id="race-rematch-note"></div>
        <div class="online-lobby-actions">
          <button class="btn-hero btn-terminal-exec" id="race-results-rematch" type="button">> REMATCH</button>
          <button class="terminal-btn-subtle" id="race-results-lobby" type="button">RETURN TO LOBBY</button>
          <button class="terminal-btn-subtle" id="race-results-leave" type="button">LEAVE ROOM</button>
        </div>
      </div>
    `;

    this.selectElem = this.element.querySelector('#race-track-select') as HTMLSelectElement;
    this.capacityElem = this.element.querySelector('#race-capacity-select') as HTMLSelectElement;
    this.joinInput = this.element.querySelector('#race-join-input') as HTMLInputElement;
    this.errorElem = this.element.querySelector('#race-error') as HTMLElement;

    this.selectView = this.element.querySelector('#race-select-view') as HTMLElement;
    this.lobbyView = this.element.querySelector('#race-lobby-view') as HTMLElement;
    this.resultsView = this.element.querySelector('#race-results-view') as HTMLElement;

    this.lobbyCodeElem = this.element.querySelector('#race-lobby-code') as HTMLElement;
    this.lobbyTitleElem = this.element.querySelector('#race-lobby-title') as HTMLElement;
    this.lobbyCapacityElem = this.element.querySelector('#race-lobby-capacity') as HTMLElement;
    this.lobbyPlayersElem = this.element.querySelector('#race-lobby-players') as HTMLElement;
    this.lobbyHostTrackElem = this.element.querySelector(
      '#race-host-track-select'
    ) as HTMLSelectElement;
    this.lobbyInviteInput = this.element.querySelector('#race-invite-input') as HTMLInputElement;
    this.lobbyReadyBtn = this.element.querySelector('#race-ready-btn') as HTMLButtonElement;
    this.lobbyStartBtn = this.element.querySelector('#race-start-btn') as HTMLButtonElement;
    this.lobbyStatusElem = this.element.querySelector('#race-lobby-status') as HTMLElement;
    this.resultsElem = this.element.querySelector('#race-results') as HTMLElement;
    this.resultsTitleElem = this.element.querySelector('#race-results-title') as HTMLElement;
    this.rematchNoteElem = this.element.querySelector('#race-rematch-note') as HTMLElement;

    this.initEvents();
  }

  private initEvents(): void {
    (this.element.querySelector('#race-create-room') as HTMLButtonElement).addEventListener(
      'click',
      () => {
        const capacity = Number(this.capacityElem.value) || DEFAULT_RACE_CAPACITY;
        this.callbacks?.onCreateRoom(this.selectElem.value, capacity);
      }
    );
    (this.element.querySelector('#race-join-btn') as HTMLButtonElement).addEventListener(
      'click',
      () => {
        const code = this.joinInput.value.trim().toUpperCase();
        if (code.length < 4) {
          this.showError('ENTER A VALID ROOM CODE');
          return;
        }
        this.callbacks?.onJoinRoom(code);
      }
    );
    this.joinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        (this.element.querySelector('#race-join-btn') as HTMLButtonElement).click();
      }
    });
    this.lobbyHostTrackElem.addEventListener('change', () => {
      this.callbacks?.onHostPickTrack(this.lobbyHostTrackElem.value);
    });

    this.lobbyReadyBtn.addEventListener('click', () => {
      if (this.pendingReady) return;
      const next = !this.readyState;
      // Pending is shown until the server confirms; we never pretend a write
      // succeeded. The service re-reads the row and reports the result.
      this.pendingReady = true;
      this.pendingFromReady = this.readyState;
      this.readyError = '';
      this.readyState = next;
      this.renderReadyButton();
      this.callbacks?.onSetReady(next);
    });

    // The server state machine owns the start (LOBBY READY -> LOADING). It is ALWAYS hidden. The
    // legacy START SESSION button stays hidden; the guard rejects direct start
    // writes anyway, so there is no client start path to click.
    this.lobbyStartBtn.classList.add('hidden');

    (this.element.querySelector('#race-leave-btn') as HTMLButtonElement).addEventListener('click', () =>
      this.callbacks?.onLeaveRoom()
    );

    (this.element.querySelector('#race-results-rematch') as HTMLButtonElement).addEventListener(
      'click',
      () => this.callbacks?.onRematch()
    );
    (this.element.querySelector('#race-results-lobby') as HTMLButtonElement).addEventListener(
      'click',
      () => this.callbacks?.onReturnToLobby()
    );
    (this.element.querySelector('#race-results-leave') as HTMLButtonElement).addEventListener(
      'click',
      () => this.callbacks?.onLeaveRoom()
    );

    (this.element.querySelector('#race-copy-invite') as HTMLButtonElement).addEventListener(
      'click',
      () => {
        const code = this.lastRoom?.inviteCode ?? '';
        // Copy the CODE, not the link: it is what a friend can read back.
        const copy = this.lobbyInviteInput.select();
        void copy;
        void navigator.clipboard?.writeText(code || this.lobbyInviteInput.value).catch(() => {
          /* clipboard may be unavailable; the field is selectable as a fallback */
        });
        const btn = this.element.querySelector('#race-copy-invite') as HTMLButtonElement;
        const original = btn.textContent;
        btn.textContent = 'COPIED';
        window.setTimeout(() => {
          btn.textContent = original;
        }, 1400);
      }
    );
  }

  public setCallbacks(callbacks: RacePanelCallbacks): void {
    this.callbacks = callbacks;
  }

  public setCatalog(entries: RaceCatalogEntry[]): void {
    const options = entries
      .map(
        (t, i) =>
          `<option value="${t.id}">[${(i + 1).toString().padStart(2, '0')}] ${t.title} ` +
          `(${t.bpm} BPM // ${t.difficultyLabel})</option>`
      )
      .join('');
    this.selectElem.innerHTML = options;
    this.lobbyHostTrackElem.innerHTML = options;
  }

  public getSelectedTrack(): string {
    return this.selectElem.value;
  }

  public showSelect(): void {
    this.selectView.classList.remove('hidden');
    this.lobbyView.classList.add('hidden');
    this.resultsView.classList.add('hidden');
    // Leaving the lobby resets every lobby-scoped axis: readiness, the pending
    // write, and map verification must not leak into the next room.
    this.readyState = false;
    this.pendingReady = false;
    this.pendingFromReady = false;
    this.readyError = '';
    this.mapState = 'UNKNOWN';
    this.lastRoom = null;
    this.renderReadyButton();
    this.clearError();
  }

  public showLobby(): void {
    this.selectView.classList.add('hidden');
    this.lobbyView.classList.remove('hidden');
    this.resultsView.classList.add('hidden');
  }

  public showResults(): void {
    this.selectView.classList.add('hidden');
    this.lobbyView.classList.add('hidden');
    this.resultsView.classList.remove('hidden');
    this.rematchNoteElem.textContent = '';
  }

  public showError(message: string): void {
    this.errorElem.textContent = message;
    this.errorElem.classList.remove('hidden');
  }

  public clearError(): void {
    this.errorElem.classList.add('hidden');
    this.errorElem.textContent = '';
  }

  public setHost(isHost: boolean): void {
    this.isHost = isHost;
    this.lobbyStartBtn.classList.add('hidden');
    (this.element.querySelector('#race-results-rematch') as HTMLButtonElement).disabled = !isHost;
    (this.element.querySelector('#race-results-lobby') as HTMLButtonElement).disabled = !isHost;
    if (!isHost && !this.resultsView.classList.contains('hidden')) this.rematchNoteElem.textContent = 'WAITING FOR HOST // REMATCH OR LOBBY';
    // Only the host sees the track picker, and only while the room is unlocked.
    const canPick = isHost && (this.lastRoom?.state ?? 'LOBBY') === 'LOBBY';
    (this.element.querySelector('#race-host-track-row') as HTMLElement).classList.toggle(
      'hidden',
      !canPick
    );
  }

  public renderLobby(
    room: RaceRoom,
    players: readonly RacePlayer[],
    inviteUrl: string,
    myUserId: string | null,
    identities?: Map<string, { gloveName: string; knifeName: string }>
  ): void {
    this.lastRoom = room;

    this.lobbyCodeElem.textContent = room.inviteCode;
    this.lobbyTitleElem.textContent = room.trackTitle || room.trackId;
    this.lobbyCapacityElem.textContent = String(room.capacity);
    this.lobbyInviteInput.value = inviteUrl;
    this.joinInput.value = room.inviteCode;

    // Host track picker: only visible, unlocked, host-only.
    (this.element.querySelector('#race-host-track-row') as HTMLElement).classList.toggle(
      'hidden',
      !(this.isHost && room.state === 'LOBBY')
    );
    if (room.state === 'LOBBY' && this.lobbyHostTrackElem.value !== room.trackId) {
      this.lobbyHostTrackElem.value = room.trackId;
    }
    this.lobbyHostTrackElem.disabled = !this.isHost || room.state !== 'LOBBY';

    this.renderPlayerRows(room, players, myUserId, identities);

    const me = players.find((p) => p.userId === myUserId);
    this.readyState = me?.ready ?? false;
    this.renderReadyButton();

    const connected = players.filter((p) => p.connected);
    (this.element.querySelector('#race-results-rematch') as HTMLButtonElement).disabled = !this.isHost || connected.length < 2;
    const allReady = computeAllReady(players);

    let status: string;
    if (room.state === 'LOADING') {
      status = 'LOADING TRACK // RACE LOCKED';
    } else if (room.state === 'IN_GAME') {
      status = 'ALL RACERS IN GAME // READY UP';
    } else if (room.state === 'COUNTDOWN') {
      status = 'ALL SIGNALS ONLINE // STARTING';
    } else if (connected.length < 2) {
      status = 'SHARE THE ROOM CODE // NEED 2+ RACERS';
    } else if (!allReady) {
      status = `${connected.filter((p) => p.ready).length} / ${connected.length} READY`;
    } else {
      status = 'ALL SIGNALS ONLINE // LOADING';
    }
    this.lobbyStatusElem.textContent = status;
    this.lobbyStatusElem.classList.toggle(
      'online-lobby-status-warn',
      this.mapState === 'MISMATCH' || !!this.readyError
    );

    // The READY button is disabled only while the room has locked.
    this.lobbyReadyBtn.disabled = this.mapState !== 'OK' || room.state !== 'LOBBY';
  }

  private renderPlayerRows(
    room: RaceRoom,
    players: readonly RacePlayer[],
    myUserId: string | null,
    identities?: Map<string, { gloveName: string; knifeName: string }>
  ): void {
    this.lobbyPlayersElem.innerHTML = '';
    const slots = Math.max(room.capacity, players.length);
    for (let i = 0; i < slots; i++) {
      const player = players[i];
      const row = document.createElement('div');
      row.className = 'online-player-row';
      const indexLabel = (i + 1).toString().padStart(2, '0');
      if (!player) {
        row.classList.add('online-player-empty');
        row.innerHTML =
          `<span class="online-player-index">${indexLabel}</span>` +
          `<span class="online-player-name">WAITING FOR SIGNAL...</span>` +
          `<span class="online-player-state">--</span>`;
      } else {
        const isMe = player.userId === myUserId;
        row.style.borderLeft = `2px solid #${accentColorFor(player.colorIndex).toString(16).padStart(6, '0')}`;
        row.classList.toggle('online-player-disconnected', !player.connected);

        let state: string;
        let stateClass: string;
        if (player.dnf) {
          state = 'DNF';
          stateClass = 'online-player-state-warn';
        } else if (player.finishUs !== null || player.finished) {
          state = `FINISHED ${formatRaceTime(player.finishUs)}`;
          stateClass = 'online-player-state-ready';
        } else if (!player.connected) {
          state = 'DISCONNECTED';
          stateClass = 'online-player-state-warn';
        } else if (isMe && this.mapState === 'MISMATCH') {
          state = 'TRACK MISMATCH';
          stateClass = 'online-player-state-warn';
        } else if (isMe && this.mapState === 'VERIFYING') {
          state = 'VERIFYING';
          stateClass = 'online-player-state-pending';
        } else if (isMe && this.pendingReady) {
          state = 'SETTING READY...';
          stateClass = 'online-player-state-pending';
        } else if (room.state === 'IN_GAME' || room.state === 'COUNTDOWN') {
          state = player.inGameReady ? 'READY' : player.loaded ? 'IN GAME' : 'LOADING';
          stateClass = player.inGameReady
            ? 'online-player-state-ready'
            : 'online-player-state-pending';
        } else if (room.state === 'LOADING') {
          state = player.loaded ? 'IN GAME' : 'LOADING';
          stateClass = 'online-player-state-pending';
        } else if (player.ready) {
          state = 'READY';
          stateClass = 'online-player-state-ready';
        } else {
          state = 'NOT READY';
          stateClass = 'online-player-state-notready';
        }

        const isHost = player.userId === room.hostUserId;
        const identity = identities?.get(player.userId);
        const identityLine = identity
          ? `<span class="online-player-identity">${this.escape(identity.gloveName)}</span>`
          : '';

        row.innerHTML =
          `<span class="online-player-index">${indexLabel}</span>` +
          `<span class="online-player-name">` +
          `<button class="online-player-name-btn" type="button"` +
          ` data-user-id="${this.escape(player.userId)}"` +
          ` data-display-name="${this.escape(player.displayName)}"` +
          ` title="Open player profile">${this.escape(player.displayName)}${isMe ? ' (YOU)' : ''}</button>` +
          (isHost ? `<span class="online-player-host">HOST</span>` : '') +
          identityLine +
          `</span>` +
          `<span class="online-player-state ${stateClass}">${state}</span>`;
      }
      this.lobbyPlayersElem.appendChild(row);
    }

    // Player names open a profile. READY / LEAVE are separate controls.
    this.lobbyPlayersElem.querySelectorAll<HTMLButtonElement>('.online-player-name-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const userId = btn.dataset.userId;
        const displayName = btn.dataset.displayName ?? 'PLAYER';
        if (userId) this.callbacks?.onOpenProfile(userId, displayName);
      });
    });
  }

  private renderReadyButton(): void {
    if (this.pendingReady) {
      this.lobbyReadyBtn.textContent = '> SETTING READY...';
      return;
    }
    this.lobbyReadyBtn.textContent = this.readyState ? '> READY \u2713' : '> READY';
    this.lobbyReadyBtn.classList.toggle('online-ready-active', this.readyState);
  }

  /**
   * Called with the VERIFIED result of a READY write. Never assumed to succeed.
   * On failure the optimistic toggle is rolled back to the pre-click value.
   */
  public setReadyResult(ok: boolean, detail: string): void {
    this.pendingReady = false;
    if (ok) {
      this.readyError = '';
    } else {
      this.readyState = this.pendingFromReady;
      this.readyError = detail;
    }
    this.renderReadyButton();
    if (!ok && this.readyError) this.lobbyStatusElem.textContent = this.readyError;
  }

  /** Track verification is a separate axis from readiness. */
  public setMapState(state: 'UNKNOWN' | 'VERIFYING' | 'OK' | 'MISMATCH', detail = ''): void {
    this.mapState = state;
    this.renderReadyButton();
    if (state === 'MISMATCH' && detail) this.showError(detail);
  }

  public setRematchNote(text: string): void {
    this.rematchNoteElem.textContent = text;
  }

  public renderResults(
    rows: readonly RaceResultRow[],
    myUserId: string | null,
    identities?: Map<string, { gloveName: string; knifeName: string }>
  ): void {
    const finishers = rows.filter((r) => r.finishTimeUs !== null && !r.dnf);
    this.resultsTitleElem.textContent = finishers.length === 0 ? 'RACE COMPLETE // NO FINISH' : 'RACE COMPLETE';

    this.resultsElem.innerHTML = '';
    rows.forEach((row) => {
      const isMe = row.userId === myUserId;
      const line = document.createElement('div');
      line.className = 'online-result-row';
      line.classList.toggle('online-result-me', isMe);
      line.classList.toggle('online-result-dnf', row.dnf);

      const place = row.place === null ? '--' : String(row.place);
      const outcome = row.dnf ? 'DNF' : row.finishTimeUs === null ? 'NO FINISH' : '';
      const gap =
        row.gapUs === null || row.gapUs === 0
          ? ''
          : `+${formatRaceTime(Math.abs(row.gapUs))}`;

      const identity = identities?.get(row.userId);
      const identityLine = identity?.gloveName
        ? `<span class="online-result-identity">${this.escape(identity.gloveName)}</span>`
        : '';

      line.innerHTML =
        `<span class="online-result-place">${place}</span>` +
        `<span class="online-result-name">` +
        `<button class="online-result-name-btn" type="button"` +
        ` data-user-id="${this.escape(row.userId)}"` +
        ` data-display-name="${this.escape(row.displayName)}"` +
        ` title="Open player profile">${this.escape(row.displayName)}${isMe ? ' (YOU)' : ''}</button>` +
        identityLine +
        `</span>` +
        `<span class="online-result-time">${formatRaceTime(row.finishTimeUs)}</span>` +
        `<span class="online-result-meta">${outcome}${gap ? ' // ' + gap : ''}</span>`;
      this.resultsElem.appendChild(line);
    });

    this.resultsElem.querySelectorAll<HTMLButtonElement>('.online-result-name-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const userId = btn.dataset.userId;
        const displayName = btn.dataset.displayName ?? 'PLAYER';
        if (userId) this.callbacks?.onOpenProfile(userId, displayName);
      });
    });
  }

  private escape(value: string): string {
    return value.replace(/[&<>"']/g, (c) =>
      c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
    );
  }
}
