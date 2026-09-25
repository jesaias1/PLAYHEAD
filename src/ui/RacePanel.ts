/**
 * 05 // RACE WITH FRIENDS — shared BEST-TIME SESSION with a friend.
 *
 * Multiplayer ONLY: no leaderboard browsing here. The page reads as
 * "start or join a multiplayer session".
 *
 * Flow: select an official signal -> CREATE ROOM (or join by invite code) ->
 * lobby with the room code, invite link, ready states and host-only start ->
 * the 5:00 best-time session (HUD + ghost live in-game) -> shared results.
 *
 * All behaviour lives in the already-implemented race service; this module is
 * presentation only.
 */

import { RacePlayer, RaceRoom, RaceResultRow, computeBothReady } from '../online/RaceRoomService';
import { formatRaceTime } from './RaceHud';

export interface RaceCatalogEntry {
  id: string;
  title: string;
  bpm: number;
  difficultyLabel: string;
}

export interface RacePanelCallbacks {
  onCreateRoom: (trackId: string) => void;
  onJoinRoom: (code: string) => void;
  onSetReady: (ready: boolean) => void;
  onStartSession: () => void;
  onLeaveRoom: () => void;
  /** The player NAME is the interaction target for opening a profile. */
  onOpenProfile: (userId: string, displayName: string) => void;
}

export class RacePanel {
  public element: HTMLElement;

  private callbacks: RacePanelCallbacks | null = null;

  private selectElem: HTMLSelectElement;
  private joinInput: HTMLInputElement;
  private errorElem: HTMLElement;

  private selectView: HTMLElement;
  private lobbyView: HTMLElement;
  private resultsView: HTMLElement;

  private lobbyCodeElem: HTMLElement;
  private lobbyTitleElem: HTMLElement;
  private lobbyPlayersElem: HTMLElement;
  private lobbyInviteInput: HTMLInputElement;
  private lobbyReadyBtn: HTMLButtonElement;
  private lobbyStartBtn: HTMLButtonElement;
  private lobbyStatusElem: HTMLElement;
  private lobbyClockElem: HTMLElement;
  private resultsElem: HTMLElement;
  private resultsTitleElem: HTMLElement;

  private readyState = false;
  private isHost = false;
  /** Local transient state while a READY write is in flight. */
  private pendingReady = false;
  /** readyState before the in-flight click, restored if the write fails. */
  private pendingFromReady = false;
  /**
   * Canonical map verification is a SEPARATE axis from readiness. A player who
   * cannot verify the map is not 'NOT READY' - they are blocked, and the lobby
   * must say so rather than implying they simply have not clicked.
   */
  private mapState: 'UNKNOWN' | 'VERIFYING' | 'OK' | 'MISMATCH' = 'UNKNOWN';
  private mapDetail = '';
  private readyError = '';

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'showcase-container showcase-panel race-panel hidden';
    this.element.id = 'panel-race';
    this.element.setAttribute('role', 'tabpanel');
    this.element.setAttribute('aria-labelledby', 'tab-btn-race');
    this.element.setAttribute('aria-hidden', 'true');

    this.element.innerHTML = `
      <div class="race-error hidden" id="race-error"></div>

      <!-- View: start / join -->
      <div id="race-select-view">
        <div class="online-row">
          <label class="online-label" for="race-track-select">SIGNAL</label>
          <select class="online-select" id="race-track-select"></select>
          <button class="btn-hero btn-terminal-exec" id="race-create-room" type="button">> CREATE ROOM</button>
        </div>
        <div class="online-hint">
          Shared 5:00 BEST-TIME SESSION. Both players run the same canonical map and
          attempt it as many times as they want. Lowest session best wins.
        </div>

        <div class="online-row online-join-row">
          <label class="online-label" for="race-join-input">JOIN</label>
          <input class="online-input" id="race-join-input" type="text" maxlength="6"
                 placeholder="INVITE CODE" autocomplete="off" spellcheck="false" />
          <button class="terminal-btn-subtle" id="race-join-btn" type="button">JOIN ROOM</button>
        </div>
      </div>

      <!-- View: lobby -->
      <div id="race-lobby-view" class="hidden">
        <div class="online-lobby-head">
          <div class="online-lobby-code">ROOM // <span id="race-lobby-code">------</span></div>
          <div class="online-lobby-title" id="race-lobby-title">SIGNAL</div>
          <div class="online-lobby-clock">SESSION LENGTH <b id="race-lobby-clock">05:00</b></div>
        </div>

        <div class="online-invite-row">
          <span class="online-invite-label">INVITE LINK</span>
          <input class="online-input online-invite-input" id="race-invite-input" readonly />
          <button class="terminal-btn-subtle" id="race-copy-invite" type="button">COPY</button>
        </div>

        <div class="online-players" id="race-lobby-players"></div>

        <div class="online-lobby-actions">
          <button class="btn-hero btn-terminal-exec" id="race-ready-btn" type="button">> READY</button>
          <button class="btn-hero btn-terminal-exec hidden" id="race-start-btn" type="button">> START SESSION</button>
          <button class="terminal-btn-subtle" id="race-leave-btn" type="button">LEAVE ROOM</button>
        </div>
        <div class="online-lobby-status" id="race-lobby-status"></div>
      </div>

      <!-- View: results -->
      <div id="race-results-view" class="hidden">
        <div class="online-results-title" id="race-results-title">RACE COMPLETE</div>
        <div class="online-results" id="race-results"></div>
        <div class="online-lobby-actions">
          <button class="btn-hero btn-terminal-exec" id="race-results-again" type="button">> BACK TO RACE</button>
        </div>
      </div>
    `;

    this.selectElem = this.element.querySelector('#race-track-select') as HTMLSelectElement;
    this.joinInput = this.element.querySelector('#race-join-input') as HTMLInputElement;
    this.errorElem = this.element.querySelector('#race-error') as HTMLElement;

    this.selectView = this.element.querySelector('#race-select-view') as HTMLElement;
    this.lobbyView = this.element.querySelector('#race-lobby-view') as HTMLElement;
    this.resultsView = this.element.querySelector('#race-results-view') as HTMLElement;

    this.lobbyCodeElem = this.element.querySelector('#race-lobby-code') as HTMLElement;
    this.lobbyTitleElem = this.element.querySelector('#race-lobby-title') as HTMLElement;
    this.lobbyPlayersElem = this.element.querySelector('#race-lobby-players') as HTMLElement;
    this.lobbyInviteInput = this.element.querySelector('#race-invite-input') as HTMLInputElement;
    this.lobbyReadyBtn = this.element.querySelector('#race-ready-btn') as HTMLButtonElement;
    this.lobbyStartBtn = this.element.querySelector('#race-start-btn') as HTMLButtonElement;
    this.lobbyStatusElem = this.element.querySelector('#race-lobby-status') as HTMLElement;
    this.lobbyClockElem = this.element.querySelector('#race-lobby-clock') as HTMLElement;
    this.resultsElem = this.element.querySelector('#race-results') as HTMLElement;
    this.resultsTitleElem = this.element.querySelector('#race-results-title') as HTMLElement;

    this.initEvents();
  }

  private initEvents(): void {
    (this.element.querySelector('#race-create-room') as HTMLButtonElement).addEventListener('click', () => {
      this.callbacks?.onCreateRoom(this.selectElem.value);
    });
    (this.element.querySelector('#race-join-btn') as HTMLButtonElement).addEventListener('click', () => {
      const code = this.joinInput.value.trim().toUpperCase();
      if (code.length < 4) {
        this.showError('ENTER A VALID INVITE CODE');
        return;
      }
      this.callbacks?.onJoinRoom(code);
    });
    this.joinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        (this.element.querySelector('#race-join-btn') as HTMLButtonElement).click();
      }
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
    this.lobbyStartBtn.addEventListener('click', () => this.callbacks?.onStartSession());
    (this.element.querySelector('#race-leave-btn') as HTMLButtonElement).addEventListener('click', () =>
      this.callbacks?.onLeaveRoom()
    );
    (this.element.querySelector('#race-results-again') as HTMLButtonElement).addEventListener('click', () =>
      this.showSelect()
    );

    (this.element.querySelector('#race-copy-invite') as HTMLButtonElement).addEventListener('click', () => {
      this.lobbyInviteInput.select();
      void navigator.clipboard?.writeText(this.lobbyInviteInput.value).catch(() => {
        /* clipboard may be unavailable; the field is selectable as a fallback */
      });
      const btn = this.element.querySelector('#race-copy-invite') as HTMLButtonElement;
      const original = btn.textContent;
      btn.textContent = 'COPIED';
      window.setTimeout(() => {
        btn.textContent = original;
      }, 1400);
    });
  }

  public setCallbacks(callbacks: RacePanelCallbacks): void {
    this.callbacks = callbacks;
  }

  public setCatalog(entries: RaceCatalogEntry[]): void {
    this.selectElem.innerHTML = entries
      .map(
        (t, i) =>
          `<option value="${t.id}">[${(i + 1).toString().padStart(2, '0')}] ${t.title} ` +
          `(${t.bpm} BPM // ${t.difficultyLabel})</option>`
      )
      .join('');
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
    this.mapDetail = '';
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
    this.lobbyStartBtn.classList.toggle('hidden', !isHost);
  }

  public renderLobby(
    room: RaceRoom,
    players: readonly RacePlayer[],
    inviteUrl: string,
    myUserId: string | null,
    identities?: Map<string, { gloveName: string; knifeName: string }>
  ): void {
    this.lobbyCodeElem.textContent = room.inviteCode;
    this.lobbyTitleElem.textContent = room.trackTitle || room.trackId;
    this.lobbyInviteInput.value = inviteUrl;
    this.lobbyClockElem.textContent = `${Math.floor(room.sessionSeconds / 60)
      .toString()
      .padStart(2, '0')}:${(room.sessionSeconds % 60).toString().padStart(2, '0')}`;

    this.lobbyPlayersElem.innerHTML = '';
    const slots = Math.max(2, players.length);
    for (let i = 0; i < slots; i++) {
      const player = players[i];
      const row = document.createElement('div');
      row.className = 'online-player-row';
      if (!player) {
        row.classList.add('online-player-empty');
        row.innerHTML =
          `<span class="online-player-index">PLAYER ${i + 1}</span>` +
          `<span class="online-player-name">WAITING FOR SIGNAL...</span>` +
          `<span class="online-player-state">--</span>`;
      } else {
        const isMe = player.userId === myUserId;
        row.classList.toggle('online-player-disconnected', !player.connected);
        // Map verification and readiness are separate axes, and the row must
        // say WHICH one is blocking. The state class carries the colour
        // semantics so a blocker never reads the same as a healthy READY.
        let state: string;
        let stateClass: string;
        if (!player.connected) {
          state = 'DISCONNECTED';
          stateClass = 'online-player-state-warn';
        } else if (isMe && this.mapState === 'MISMATCH') {
          state = 'MAP MISMATCH';
          stateClass = 'online-player-state-warn';
        } else if (isMe && this.mapState === 'VERIFYING') {
          state = 'MAP VERIFYING';
          stateClass = 'online-player-state-pending';
        } else if (isMe && this.pendingReady) {
          state = 'SETTING READY...';
          stateClass = 'online-player-state-pending';
        } else if (player.ready) {
          state = 'READY';
          stateClass = 'online-player-state-ready';
        } else {
          state = 'NOT READY';
          stateClass = 'online-player-state-notready';
        }

        const identity = identities?.get(player.userId);
        const identityLine = identity
          ? `<span class="online-player-identity">${this.escape(identity.gloveName)}${
              identity.knifeName ? ` // ${this.escape(identity.knifeName)}` : ''
            }</span>`
          : '';

        row.innerHTML =
          `<span class="online-player-index">PLAYER ${i + 1}</span>` +
          `<span class="online-player-name">` +
          `<button class="online-player-name-btn" type="button"` +
          ` data-user-id="${this.escape(player.userId)}"` +
          ` data-display-name="${this.escape(player.displayName)}"` +
          ` title="Open player profile">${this.escape(player.displayName)}${isMe ? ' (YOU)' : ''}</button>` +
          identityLine +
          `</span>` +
          `<span class="online-player-state ${stateClass}">${state}</span>`;
      }
      this.lobbyPlayersElem.appendChild(row);
    }

    // Player names open a profile. READY / START / LEAVE are separate controls.
    this.lobbyPlayersElem.querySelectorAll<HTMLButtonElement>('.online-player-name-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const userId = btn.dataset.userId;
        const displayName = btn.dataset.displayName ?? 'PLAYER';
        if (userId) this.callbacks?.onOpenProfile(userId, displayName);
      });
    });

    const me = players.find((p) => p.userId === myUserId);
    this.readyState = me?.ready ?? false;
    this.renderReadyButton();

    // START requires: two rows present, both connected, both ready, and both
    // verified on the same canonical map. These are deliberately separate checks.
    const connected = players.filter((p) => p.connected);
    const allReady = computeBothReady(players);
    this.lobbyStartBtn.classList.toggle('hidden', !this.isHost);
    this.lobbyStartBtn.disabled = !allReady || this.mapState === 'MISMATCH';
    this.lobbyStartBtn.textContent = allReady ? '> START SESSION' : '> WAITING FOR PLAYERS';

    // Readiness, map verification and connectivity are separate axes. The status
    // line must never imply "just click READY" when the real blocker is the map.
    if (this.mapState === 'MISMATCH') {
      this.lobbyStatusElem.textContent = `MAP MISMATCH // ${this.mapDetail}`;
    } else if (this.mapState === 'VERIFYING') {
      this.lobbyStatusElem.textContent = 'MAP VERIFYING...';
    } else if (this.readyError) {
      this.lobbyStatusElem.textContent = this.readyError;
    } else if (this.pendingReady) {
      this.lobbyStatusElem.textContent = 'SETTING READY...';
    } else if (room.state === 'COUNTDOWN' && room.startAtMs !== null) {
      const seconds = Math.max(0, Math.ceil((room.startAtMs - Date.now()) / 1000));
      this.lobbyStatusElem.textContent = `STARTING IN ${seconds}...`;
    } else if (connected.length < 2) {
      this.lobbyStatusElem.textContent = 'SHARE THE INVITE LINK TO BRING IN YOUR RIVAL';
    } else if (!allReady) {
      this.lobbyStatusElem.textContent = 'BOTH PLAYERS MUST BE READY';
    } else {
      this.lobbyStatusElem.textContent = this.isHost ? 'READY TO START' : 'WAITING FOR HOST TO START';
    }
    // A blocked or failed state is visually distinct from ordinary guidance.
    this.lobbyStatusElem.classList.toggle(
      'online-lobby-status-warn',
      this.mapState === 'MISMATCH' || !!this.readyError
    );
  }

  private renderReadyButton(): void {
    if (this.pendingReady) {
      this.lobbyReadyBtn.textContent = '> SETTING READY...';
      this.lobbyReadyBtn.disabled = true;
    } else {
      this.lobbyReadyBtn.textContent = this.readyState ? '> READY ✓' : '> READY';
      // READY is only meaningful once the canonical map is verified. A player
      // blocked by the map is not "not ready" - they are blocked.
      this.lobbyReadyBtn.disabled = this.mapState !== 'OK';
    }
    this.lobbyReadyBtn.classList.toggle('online-ready-active', this.readyState && !this.pendingReady);
  }

  /**
   * Called with the VERIFIED result of a READY write. Never assumed to succeed.
   *
   * On failure the optimistic toggle is rolled back to the pre-click value and
   * the error is surfaced. On success `readyState` is left alone: the service
   * always reconciles from the database before this runs, so `renderLobby` has
   * already installed the true value.
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

  /** Map verification is a separate axis from readiness. */
  public setMapState(state: 'UNKNOWN' | 'VERIFYING' | 'OK' | 'MISMATCH', detail = ''): void {
    this.mapState = state;
    this.mapDetail = detail;
    this.renderReadyButton();
  }

  public renderResults(
    rows: readonly RaceResultRow[],
    myUserId: string | null,
    identities?: Map<string, { gloveName: string; knifeName: string }>
  ): void {
    const finishers = rows.filter((r) => r.sessionBestUs !== null);
    this.resultsTitleElem.textContent = finishers.length === 0 ? 'NO FINISH' : 'RACE COMPLETE';

    this.resultsElem.innerHTML = '';
    rows.forEach((row, index) => {
      const isMe = row.userId === myUserId;
      const line = document.createElement('div');
      line.className = 'online-result-row';
      line.classList.toggle('online-result-me', isMe);

      const place = row.sessionBestUs === null ? '--' : String(index + 1);
      const outcome = row.outcome === 'TIE' ? 'TIE' : row.outcome === 'NO_FINISH' ? '' : row.outcome;
      const gap =
        row.gapUs === null || row.gapUs === 0
          ? ''
          : `GAP ${row.gapUs > 0 ? '+' : '-'}${formatRaceTime(Math.abs(row.gapUs))}`;

      // Identity line: the achievement behind the glove, not just a skin name.
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
        `<span class="online-result-time">${formatRaceTime(row.sessionBestUs)}</span>` +
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

    const meta = document.createElement('div');
    meta.className = 'online-result-attempts';
    meta.textContent = rows
      .map((r) => `${this.escape(r.displayName)}: ${r.finishCount}/${r.attemptCount} FINISHED`)
      .join('  |  ');
    this.resultsElem.appendChild(meta);
  }

  private escape(value: string): string {
    return value.replace(/[&<>"']/g, (c) =>
      c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
    );
  }
}
