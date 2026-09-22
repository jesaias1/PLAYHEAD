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

import { RacePlayer, RaceRoom, RaceResultRow } from '../online/RaceRoomService';
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
  onRetryConnection: () => void;
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
          <input class="online-input online-invite-input" id="race-invite-input" readonly />
          <button class="terminal-btn-subtle" id="race-copy-invite" type="button">COPY INVITE LINK</button>
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
      this.readyState = !this.readyState;
      this.callbacks?.onSetReady(this.readyState);
      this.renderReadyButton();
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
    myUserId: string | null
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
        row.innerHTML =
          `<span class="online-player-index">PLAYER ${i + 1}</span>` +
          `<span class="online-player-name">${this.escape(player.displayName)}${isMe ? ' (YOU)' : ''}</span>` +
          `<span class="online-player-state">${
            !player.connected ? 'DISCONNECTED' : player.ready ? 'READY' : 'NOT READY'
          }</span>`;
      }
      this.lobbyPlayersElem.appendChild(row);
    }

    const me = players.find((p) => p.userId === myUserId);
    this.readyState = me?.ready ?? false;
    this.renderReadyButton();

    const connected = players.filter((p) => p.connected);
    const allReady = connected.length >= 2 && connected.every((p) => p.ready);
    this.lobbyStartBtn.classList.toggle('hidden', !this.isHost);
    this.lobbyStartBtn.disabled = !allReady;
    this.lobbyStartBtn.textContent = allReady ? '> START SESSION' : '> WAITING FOR PLAYERS';

    if (room.state === 'COUNTDOWN' && room.startAtMs !== null) {
      const seconds = Math.max(0, Math.ceil((room.startAtMs - Date.now()) / 1000));
      this.lobbyStatusElem.textContent = `STARTING IN ${seconds}...`;
    } else if (connected.length < 2) {
      this.lobbyStatusElem.textContent = 'SHARE THE INVITE LINK TO BRING IN YOUR RIVAL';
    } else if (!allReady) {
      this.lobbyStatusElem.textContent = 'BOTH PLAYERS MUST BE READY';
    } else {
      this.lobbyStatusElem.textContent = 'READY TO START';
    }
  }

  private renderReadyButton(): void {
    this.lobbyReadyBtn.textContent = this.readyState ? '> READY ✓' : '> READY';
    this.lobbyReadyBtn.classList.toggle('online-ready-active', this.readyState);
  }

  public renderResults(rows: readonly RaceResultRow[], myUserId: string | null): void {
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

      line.innerHTML =
        `<span class="online-result-place">${place}</span>` +
        `<span class="online-result-name">${this.escape(row.displayName)}${isMe ? ' (YOU)' : ''}</span>` +
        `<span class="online-result-time">${formatRaceTime(row.sessionBestUs)}</span>` +
        `<span class="online-result-meta">${outcome}${gap ? ' // ' + gap : ''}</span>`;
      this.resultsElem.appendChild(line);
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
