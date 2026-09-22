/**
 * ONLINE PANEL — the player-facing online experience (main menu tab 05).
 *
 * Two restrained sections:
 *   WORLD LEADERBOARDS  — public boards for the 14 official Signal Pack tracks
 *   RACE WITH FRIENDS   — shared BEST-TIME SESSION lobby, invite link, results
 *
 * This module is UI only. All behaviour lives in the already-implemented
 * services under src/online/ (auth, progression, leaderboard, race rooms).
 */

import { RacePlayer, RaceRoom, RaceResultRow } from '../online/RaceRoomService';
import type { LeaderboardView } from '../online/LeaderboardService';
import { formatRaceTime } from './RaceHud';

export interface OnlineCatalogEntry {
  id: string;
  title: string;
  bpm: number;
  difficultyLabel: string;
}

export interface OnlinePanelCallbacks {
  onPlayTrack: (trackId: string) => void;
  onRequestLeaderboard: (trackId: string) => void;
  onCreateRoom: (trackId: string) => void;
  onJoinRoom: (code: string) => void;
  onSetReady: (ready: boolean) => void;
  onStartSession: () => void;
  onLeaveRoom: () => void;
  onRetryConnection: () => void;
}

export class OnlinePanel {
  public element: HTMLElement;

  private callbacks: OnlinePanelCallbacks | null = null;

  private statusElem: HTMLElement;
  private statusDetailElem: HTMLElement;

  // Leaderboard section
  private lbSelect: HTMLSelectElement;
  private lbStatusElem: HTMLElement;
  private lbTableElem: HTMLElement;
  private lbYouElem: HTMLElement;
  private lbPlayBtn: HTMLButtonElement;

  // Race section
  private raceSelect: HTMLSelectElement;
  private raceJoinInput: HTMLInputElement;
  private raceErrorElem: HTMLElement;
  private raceSelectView: HTMLElement;
  private raceLobbyView: HTMLElement;
  private raceResultsView: HTMLElement;

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
    this.element.className = 'showcase-container showcase-panel online-panel';
    this.element.id = 'panel-online';
    this.element.setAttribute('role', 'tabpanel');
    this.element.setAttribute('aria-labelledby', 'tab-btn-online');
    this.element.setAttribute('aria-hidden', 'true');

    this.element.innerHTML = `
      <div class="online-status-bar">
        <span class="online-status-tag" id="online-status-tag">[OFFLINE]</span>
        <span class="online-status-detail" id="online-status-detail">not connected</span>
        <button class="terminal-btn-subtle online-retry" id="online-retry" type="button">RETRY SYNC</button>
      </div>

      <!-- ============================ WORLD LEADERBOARDS ============================ -->
      <section class="online-section" aria-labelledby="online-lb-heading">
        <div class="terminal-panel-header" id="online-lb-heading">// WORLD LEADERBOARDS</div>

        <div class="online-row">
          <label class="online-label" for="online-lb-select">SIGNAL</label>
          <select class="online-select" id="online-lb-select"></select>
          <button class="btn-hero btn-terminal-exec online-play" id="online-lb-play" type="button">> PLAY</button>
        </div>

        <div class="online-lb-status" id="online-lb-status">SELECT A SIGNAL</div>
        <div class="online-lb-table" id="online-lb-table"></div>
        <div class="online-lb-you" id="online-lb-you"></div>
      </section>

      <!-- ============================ RACE WITH FRIENDS ============================ -->
      <section class="online-section" aria-labelledby="online-race-heading">
        <div class="terminal-panel-header" id="online-race-heading">// RACE WITH FRIENDS</div>

        <div class="online-race-error hidden" id="online-race-error"></div>

        <!-- View: select -->
        <div id="online-race-select-view">
          <div class="online-row">
            <label class="online-label" for="online-race-select">SIGNAL</label>
            <select class="online-select" id="online-race-select"></select>
            <button class="btn-hero btn-terminal-exec" id="online-create-room" type="button">> CREATE ROOM</button>
          </div>
          <div class="online-hint">
            Shared 5:00 BEST-TIME SESSION. Both players run the same canonical map and
            attempt it as many times as they want. Lowest session best wins.
          </div>

          <div class="online-row online-join-row">
            <label class="online-label" for="online-join-input">JOIN</label>
            <input class="online-input" id="online-join-input" type="text" maxlength="6"
                   placeholder="INVITE CODE" autocomplete="off" spellcheck="false" />
            <button class="terminal-btn-subtle" id="online-join-btn" type="button">JOIN ROOM</button>
          </div>
        </div>

        <!-- View: lobby -->
        <div id="online-race-lobby-view" class="hidden">
          <div class="online-lobby-head">
            <div class="online-lobby-code">ROOM // <span id="online-lobby-code">------</span></div>
            <div class="online-lobby-title" id="online-lobby-title">SIGNAL</div>
            <div class="online-lobby-clock">SESSION LENGTH <b id="online-lobby-clock">05:00</b></div>
          </div>

          <div class="online-invite-row">
            <input class="online-input online-invite-input" id="online-invite-input" readonly />
            <button class="terminal-btn-subtle" id="online-copy-invite" type="button">COPY INVITE LINK</button>
          </div>

          <div class="online-players" id="online-lobby-players"></div>

          <div class="online-lobby-actions">
            <button class="btn-hero btn-terminal-exec" id="online-ready-btn" type="button">> READY</button>
            <button class="btn-hero btn-terminal-exec hidden" id="online-start-btn" type="button">> START SESSION</button>
            <button class="terminal-btn-subtle" id="online-leave-btn" type="button">LEAVE ROOM</button>
          </div>
          <div class="online-lobby-status" id="online-lobby-status"></div>
        </div>

        <!-- View: results -->
        <div id="online-race-results-view" class="hidden">
          <div class="online-results-title" id="online-results-title">RACE COMPLETE</div>
          <div class="online-results" id="online-results"></div>
          <div class="online-lobby-actions">
            <button class="btn-hero btn-terminal-exec" id="online-results-again" type="button">> BACK TO RACE</button>
          </div>
        </div>
      </section>
    `;

    this.statusElem = this.q('#online-status-tag');
    this.statusDetailElem = this.q('#online-status-detail');

    this.lbSelect = this.q<HTMLSelectElement>('#online-lb-select');
    this.lbStatusElem = this.q('#online-lb-status');
    this.lbTableElem = this.q('#online-lb-table');
    this.lbYouElem = this.q('#online-lb-you');
    this.lbPlayBtn = this.q<HTMLButtonElement>('#online-lb-play');

    this.raceSelect = this.q<HTMLSelectElement>('#online-race-select');
    this.raceJoinInput = this.q<HTMLInputElement>('#online-join-input');
    this.raceErrorElem = this.q('#online-race-error');
    this.raceSelectView = this.q('#online-race-select-view');
    this.raceLobbyView = this.q('#online-race-lobby-view');
    this.raceResultsView = this.q('#online-race-results-view');

    this.lobbyCodeElem = this.q('#online-lobby-code');
    this.lobbyTitleElem = this.q('#online-lobby-title');
    this.lobbyPlayersElem = this.q('#online-lobby-players');
    this.lobbyInviteInput = this.q<HTMLInputElement>('#online-invite-input');
    this.lobbyReadyBtn = this.q<HTMLButtonElement>('#online-ready-btn');
    this.lobbyStartBtn = this.q<HTMLButtonElement>('#online-start-btn');
    this.lobbyStatusElem = this.q('#online-lobby-status');
    this.lobbyClockElem = this.q('#online-lobby-clock');

    this.resultsElem = this.q('#online-results');
    this.resultsTitleElem = this.q('#online-results-title');

    this.initEvents();
  }

  private q<T extends HTMLElement = HTMLElement>(selector: string): T {
    return this.element.querySelector(selector) as T;
  }

  public setCallbacks(callbacks: OnlinePanelCallbacks): void {
    this.callbacks = callbacks;
  }

  public setCatalog(entries: OnlineCatalogEntry[]): void {
    const options = entries
      .map(
        (t, i) =>
          `<option value="${t.id}">[${(i + 1).toString().padStart(2, '0')}] ${t.title} ` +
          `(${t.bpm} BPM // ${t.difficultyLabel})</option>`
      )
      .join('');
    this.lbSelect.innerHTML = options;
    this.raceSelect.innerHTML = options;
  }

  public getSelectedLeaderboardTrack(): string {
    return this.lbSelect.value;
  }

  public getSelectedRaceTrack(): string {
    return this.raceSelect.value;
  }

  private initEvents(): void {
    this.lbSelect.addEventListener('change', () => {
      this.callbacks?.onRequestLeaderboard(this.lbSelect.value);
    });
    this.lbPlayBtn.addEventListener('click', () => {
      this.callbacks?.onPlayTrack(this.lbSelect.value);
    });

    this.q('#online-create-room').addEventListener('click', () => {
      this.callbacks?.onCreateRoom(this.raceSelect.value);
    });
    this.q('#online-join-btn').addEventListener('click', () => {
      const code = this.raceJoinInput.value.trim().toUpperCase();
      if (code.length < 4) {
        this.showRaceError('ENTER A VALID INVITE CODE');
        return;
      }
      this.callbacks?.onJoinRoom(code);
    });
    this.raceJoinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.q<HTMLButtonElement>('#online-join-btn').click();
    });

    this.lobbyReadyBtn.addEventListener('click', () => {
      this.readyState = !this.readyState;
      this.callbacks?.onSetReady(this.readyState);
      this.renderReadyButton();
    });
    this.lobbyStartBtn.addEventListener('click', () => this.callbacks?.onStartSession());
    this.q('#online-leave-btn').addEventListener('click', () => this.callbacks?.onLeaveRoom());
    this.q('#online-results-again').addEventListener('click', () => this.showRaceSelect());

    this.q('#online-copy-invite').addEventListener('click', () => {
      this.lobbyInviteInput.select();
      void navigator.clipboard?.writeText(this.lobbyInviteInput.value).catch(() => {
        /* clipboard may be unavailable; the field is selectable as a fallback */
      });
      const btn = this.q<HTMLButtonElement>('#online-copy-invite');
      const original = btn.textContent;
      btn.textContent = 'COPIED';
      window.setTimeout(() => {
        btn.textContent = original;
      }, 1400);
    });

    this.q('#online-retry').addEventListener('click', () => this.callbacks?.onRetryConnection());
  }

  // -- status ---------------------------------------------------------------

  public setStatus(tag: string, detail: string): void {
    this.statusElem.textContent = tag;
    this.statusDetailElem.textContent = detail;
    const offline = tag.includes('OFFLINE') || tag.includes('PENDING');
    this.statusElem.classList.toggle('online-status-offline', offline);
  }

  // -- views ----------------------------------------------------------------

  public showRaceSelect(): void {
    this.raceSelectView.classList.remove('hidden');
    this.raceLobbyView.classList.add('hidden');
    this.raceResultsView.classList.add('hidden');
    this.clearRaceError();
  }

  public showLobby(): void {
    this.raceSelectView.classList.add('hidden');
    this.raceLobbyView.classList.remove('hidden');
    this.raceResultsView.classList.add('hidden');
  }

  public showResults(): void {
    this.raceSelectView.classList.add('hidden');
    this.raceLobbyView.classList.add('hidden');
    this.raceResultsView.classList.remove('hidden');
  }

  public showRaceError(message: string): void {
    this.raceErrorElem.textContent = message;
    this.raceErrorElem.classList.remove('hidden');
  }

  public clearRaceError(): void {
    this.raceErrorElem.classList.add('hidden');
    this.raceErrorElem.textContent = '';
  }

  // -- lobby ----------------------------------------------------------------

  public renderLobby(room: RaceRoom, players: readonly RacePlayer[], inviteUrl: string, myUserId: string | null): void {
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
        const disconnected = !player.connected;
        row.classList.toggle('online-player-disconnected', disconnected);
        row.innerHTML =
          `<span class="online-player-index">PLAYER ${i + 1}</span>` +
          `<span class="online-player-name">${this.escape(player.displayName)}${isMe ? ' (YOU)' : ''}</span>` +
          `<span class="online-player-state">${
            disconnected ? 'DISCONNECTED' : player.ready ? 'READY' : 'NOT READY'
          }</span>`;
      }
      this.lobbyPlayersElem.appendChild(row);
    }

    const me = players.find((p) => p.userId === myUserId);
    this.readyState = me?.ready ?? false;
    this.renderReadyButton();

    // Host-only start, gated on all connected players being ready.
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

  public setHost(isHost: boolean): void {
    this.isHost = isHost;
    this.lobbyStartBtn.classList.toggle('hidden', !isHost);
  }

  private renderReadyButton(): void {
    this.lobbyReadyBtn.textContent = this.readyState ? '> READY ✓' : '> READY';
    this.lobbyReadyBtn.classList.toggle('online-ready-active', this.readyState);
  }

  // -- results --------------------------------------------------------------

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
      const outcome =
        row.outcome === 'TIE' ? 'TIE' : row.outcome === 'NO_FINISH' ? '' : row.outcome;
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

    const attempts = rows
      .map((r) => `${this.escape(r.displayName)}: ${r.finishCount}/${r.attemptCount} FINISHED`)
      .join('  |  ');
    const meta = document.createElement('div');
    meta.className = 'online-result-attempts';
    meta.textContent = attempts;
    this.resultsElem.appendChild(meta);
  }

  // -- leaderboard ----------------------------------------------------------

  public setLeaderboardLoading(trackTitle: string): void {
    this.lbStatusElem.textContent = `LOADING // ${trackTitle}`;
    this.lbTableElem.innerHTML = '';
    this.lbYouElem.innerHTML = '';
  }

  public renderLeaderboard(view: LeaderboardView, trackTitle: string): void {
    if (view.offline) {
      this.lbStatusElem.textContent = 'WORLD // OFFLINE — LOCAL RESULTS ONLY';
      this.lbTableElem.innerHTML = '';
      this.lbYouElem.innerHTML =
        `<div class="online-lb-empty">[LOCAL // SYNC PENDING]</div>`;
      return;
    }

    this.lbStatusElem.textContent = `WORLD // ${trackTitle.toUpperCase()}`;

    if (view.entries.length === 0) {
      this.lbTableElem.innerHTML =
        `<div class="online-lb-empty">NO ACCEPTED RUNS ON THIS CANONICAL MAP YET</div>`;
    } else {
      const rows = view.entries
        .map(
          (e) =>
            `<div class="online-lb-row${view.you && e.userId === view.you.displayName ? '' : ''}">` +
            `<span class="online-lb-rank">${e.rankPosition}</span>` +
            `<span class="online-lb-name">${this.escape(e.displayName)}</span>` +
            `<span class="online-lb-time">${formatRaceTime(e.timeUs)}</span>` +
            `</div>`
        )
        .join('');
      this.lbTableElem.innerHTML =
        `<div class="online-lb-row online-lb-head">` +
        `<span class="online-lb-rank">#</span>` +
        `<span class="online-lb-name">PLAYER</span>` +
        `<span class="online-lb-time">TIME</span>` +
        `</div>${rows}`;
    }

    if (view.you) {
      this.lbYouElem.innerHTML =
        `<div class="online-lb-you-block">` +
        `<div class="online-lb-you-label">YOUR PB</div>` +
        `<div class="online-lb-you-time">${formatRaceTime(view.you.timeUs)}</div>` +
        `<div class="online-lb-you-label">WORLD POSITION</div>` +
        `<div class="online-lb-you-pos">${view.you.position === null ? 'UNRANKED' : '#' + view.you.position}</div>` +
        `</div>`;
    } else {
      this.lbYouElem.innerHTML = `<div class="online-lb-you-block online-lb-empty">NO PERSONAL BEST ON THIS MAP</div>`;
    }
  }

  private escape(value: string): string {
    return value.replace(/[&<>"']/g, (c) =>
      c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
    );
  }
}
