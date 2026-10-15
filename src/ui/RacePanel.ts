import { ENVIRONMENT_MAPS } from '../world/themes/EnvironmentThemeRegistry';
import { readMenuPreferences, saveMenuPreferences } from './MenuPreferences';
import { raceBaseTrackId, raceMode, type RaceMode } from '../online/RaceCourse';
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
  DEFAULT_RACE_CAPACITY,
  RACE_CAPACITIES
} from '../online/RaceRoomService';
import { formatRaceTime } from './RaceHud';
import { accentColorFor } from '../online/RemoteGhostRenderer';
import { pbImprovement } from '../mastery/SignalPackMastery';
import type { RunResultRank } from '../player/PlayerStats';

export interface RaceRunFeedback {
  rank: RunResultRank;
  time: number;
  priorPbTime: number | null;
  isNewPb: boolean;
  diamondJustMastered: boolean;
}

export interface RaceCatalogEntry {
  id: string;
  title: string;
  bpm: number;
  difficultyLabel: string;
  /** Real track accent from the official catalogue (optional, presentation only). */
  accentColor?: string;
}

export interface RacePanelCallbacks {
  onCreateRoom: (trackId: string, capacity: number, mode?: RaceMode) => void;
  onJoinRoom: (code: string) => void;
  /** This racer voted for a map. */
  onMapVote?: (key: string) => void;
  /** Quick match: search the queue for another player. */
  onFindOpponent?: (trackId: string, mode: RaceMode, anySignal: boolean) => void;
  /** A non-host racer asks the host for a rematch. */
  onRematchRequest?: () => void;
  onCancelFind?: () => void;
  onSetReady: (ready: boolean) => void;
  onLeaveRoom: () => void;
  onRematch: () => void;
  onNextSong?: () => void;
  onReturnToLobby: () => void;
  /** Host changes the official track before the room locks. */
  onHostPickTrack: (trackId: string, mode?: RaceMode) => void;
  /** The player NAME is the interaction target for opening a profile. */
  onOpenProfile: (userId: string, displayName: string) => void;
}

export class RacePanel {
  public element: HTMLElement;

  private callbacks: RacePanelCallbacks | null = null;
  private runFeedback: RaceRunFeedback | null = null;

  private selectElem: HTMLSelectElement;
  private capacityElem: HTMLSelectElement;
  private capacitySegElem: HTMLElement;
  private createHeroElem: HTMLElement;
  private createTitleElem: HTMLElement;
  private createBpmElem: HTMLElement;
  private createDiffElem: HTMLElement;
  private joinInput: HTMLInputElement;
  private errorElem: HTMLElement;
  private catalog: RaceCatalogEntry[] = [];
  private selectedTrackId = '';

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

      <!-- View: CREATE / JOIN hub (race landing) -->
      <div id="race-select-view" class="race-landing">
        <div class="race-landing-grid" aria-hidden="true"></div>
        <div class="race-landing-head">
          <h1 class="race-landing-title">ONLINE RACE</h1>
          <p class="race-landing-tagline">PICK A SIGNAL, THEN RACE SOMEONE TO THE FINISH</p>
        </div>

        <div class="race-board">
          <section class="race-card race-card-signal" aria-label="Your signal">
            <div class="race-card-label"><span class="race-step-num">1</span> YOUR SIGNAL</div>
            <div class="race-hero" id="race-create-hero">
              <div class="race-hero-title" id="race-create-title">--</div>
              <div class="race-hero-meta">
                <span class="race-hero-bpm" id="race-create-bpm">-- BPM</span>
                <span class="race-hero-diff" id="race-create-diff">--</span>
              </div>
            </div>
            <label class="race-field-label" for="race-track-select">CHANGE SONG</label>
            <select class="online-select race-track-select" id="race-track-select" aria-label="Selected signal"></select>
            <span class="race-field-label" id="race-mode-label">COURSE</span>
            <div class="race-mode-seg" id="race-mode-seg" role="group" aria-labelledby="race-mode-label">
              <button type="button" class="race-mode-btn active" data-mode="SURF">SURF<small>flow &amp; ramps</small></button>
              <button type="button" class="race-mode-btn" data-mode="NORMAL">PLATFORMS<small>mixed movement</small></button>
            </div>
            <select id="race-mode" class="race-capacity-native" aria-label="Race mode" tabindex="-1"><option value="SURF">Surf</option><option value="NORMAL">Platforms</option></select>
          </section>

          <section class="race-card race-card-play" aria-label="Play">
            <div class="race-card-label"><span class="race-step-num">2</span> PLAY</div>
            <div class="race-quick-main" id="race-quick">
              <button class="btn-hero btn-terminal-exec race-cta race-find-btn" id="race-find-opponent" type="button">> FIND OPPONENT</button>
              <label class="race-any"><input type="checkbox" id="race-any-signal" /> I don't mind which signal (finds a match faster)</label>
              <div class="race-find-status" id="race-find-status" role="status" aria-live="polite">MATCHES YOU WITH ANOTHER PLAYER // IF YOU PICK DIFFERENT SIGNALS, ONE IS DRAWN AT RANDOM</div>
            </div>
            <div class="race-or"><span>OR PLAY WITH FRIENDS</span></div>
            <div class="race-friends">
              <div class="race-friend-box">
                <div class="race-option-title">CREATE A ROOM</div>
                <div class="race-option-desc">Get a code and send it to your friends. Up to 8 can join; you start when everyone is ready.</div>
                <div class="race-capacity race-capacity-hidden" id="race-capacity-seg" aria-hidden="true"></div>
                <select class="race-capacity-native" id="race-capacity-select" aria-label="Racer capacity" tabindex="-1">
                  <option value="8" selected>8 RACERS</option>
                </select>
                <button class="btn-hero btn-terminal-exec race-cta" id="race-create-room" type="button">> CREATE ROOM</button>
              </div>
              <div class="race-friend-box">
                <div class="race-option-title">JOIN WITH A CODE</div>
                <div class="race-option-desc">Got a code from a friend? Type it here.</div>
                <label class="race-field-label race-sr-only" for="race-join-input">Room code</label>
                <input class="race-code-input" id="race-join-input" type="text" maxlength="8"
                       inputmode="text" placeholder="ENTER CODE" autocomplete="off"
                       spellcheck="false" autocapitalize="characters" aria-label="Room code" />
                <button class="btn-hero btn-terminal-exec race-cta" id="race-join-btn" type="button">> JOIN ROOM</button>
              </div>
            </div>
          </section>
        </div>

        <div class="online-hint race-landing-hint">
          HOW IT WORKS: pick a signal, find an opponent or share a room code, vote for a map in the lobby, press READY. First to the finish wins.
        </div>
      </div>

      <!-- View: lobby -->
      <div id="race-lobby-view" class="race-lobby hidden">
        <div class="race-lobby-head">
          <div class="race-lobby-track">
            <h2 class="race-lobby-title" id="race-lobby-title">SIGNAL</h2>
            <div class="race-pick-note" id="race-pick-note"></div>
            <div class="race-lobby-meta">
              <span class="race-lobby-bpm" id="race-lobby-bpm">-- BPM</span>
              <span class="race-lobby-sep">//</span>
              <span class="race-lobby-diff" id="race-lobby-diff">--</span>
            </div>
          </div>
          <div class="race-lobby-code-block">
            <div class="online-invite-label race-lobby-code-label">ROOM //</div>
            <div class="race-lobby-code-line">
              <span class="online-lobby-code" id="race-lobby-code">------</span>
              <button class="race-copy-btn" id="race-copy-invite" type="button">COPY</button>
            </div>
            <input class="online-input online-invite-input" id="race-invite-input" readonly
                   aria-hidden="true" tabindex="-1" />
          </div>
          <div class="race-lobby-count">
            <span class="race-lobby-count-label">RACERS IN THE ROOM</span>
            <span class="race-lobby-count-val"><b id="race-lobby-connected">0</b><b id="race-lobby-capacity" hidden>4</b></span>
          </div>
        </div>

        <div class="race-map-vote" id="race-map-vote">
          <div class="race-map-vote-head">VOTE FOR THE MAP <span>if you pick different maps, one of them is drawn at random</span></div>
          <div class="race-map-grid" id="race-map-grid"></div>
          <div class="race-map-votes" id="race-map-votes" aria-live="polite"></div>
          <div class="race-lobby-guide">Vote for a map, then press READY. The race starts when everyone in the room is ready (2 or more racers).</div>
        </div>
        <div class="online-host-track hidden" id="race-host-track-row">
          <span class="online-invite-label">TRACK</span>
          <select class="online-select" id="race-host-track-select"></select>
          <select id="race-host-mode" aria-label="Lobby race mode"><option value="SURF">Surf</option><option value="NORMAL">Platforms</option></select>
        </div>

        <div class="online-players race-player-grid" id="race-lobby-players"></div>

        <div class="online-lobby-actions race-lobby-foot">
          <button class="btn-hero btn-terminal-exec race-ready-btn" id="race-ready-btn" type="button">> READY</button>
          <button class="btn-hero btn-terminal-exec hidden" id="race-start-btn" type="button">> START RACE</button>
          <button class="terminal-btn-subtle" id="race-leave-btn" type="button">LEAVE ROOM</button>
        </div>
        <div class="online-lobby-status" id="race-lobby-status"></div>
      </div>

      <!-- View: results -->
      <div id="race-results-view" class="race-results hidden">
        <div class="online-results-title" id="race-results-title">RACE COMPLETE</div>
        <div class="race-winner hidden" id="race-winner" role="status"></div>
        <div class="race-results-head" aria-hidden="true">
          <span>RANK</span><span>RACER</span><span>TIME</span><span>GAP</span>
        </div>
        <div class="online-results race-results-grid" id="race-results"></div>
        <div class="online-lobby-status" id="race-rematch-note"></div>
        <div class="online-lobby-actions race-results-actions">
          <button class="terminal-btn-subtle" id="race-results-next" type="button">PLAY NEXT SONG</button>
          <button class="btn-hero btn-terminal-exec" id="race-results-rematch" type="button">> REMATCH // NEW MAP VOTE</button>
          <button class="terminal-btn-subtle hidden" id="race-results-lobby" type="button">RETURN TO LOBBY</button>
          <button class="terminal-btn-subtle" id="race-results-leave" type="button">LEAVE ROOM</button>
        </div>
      </div>
    `;

    this.selectElem = this.element.querySelector('#race-track-select') as HTMLSelectElement;
    this.capacityElem = this.element.querySelector('#race-capacity-select') as HTMLSelectElement;
    this.capacitySegElem = this.element.querySelector('#race-capacity-seg') as HTMLElement;
    this.createHeroElem = this.element.querySelector('#race-create-hero') as HTMLElement;
    this.createTitleElem = this.element.querySelector('#race-create-title') as HTMLElement;
    this.createBpmElem = this.element.querySelector('#race-create-bpm') as HTMLElement;
    this.createDiffElem = this.element.querySelector('#race-create-diff') as HTMLElement;
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
    const modeSelect = this.element.querySelector('#race-mode') as HTMLSelectElement;
    const modeButtons = this.element.querySelectorAll<HTMLButtonElement>('.race-mode-btn');
    const syncModeButtons = (): void => {
      modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === modeSelect.value));
    };
    modeSelect.value = readMenuPreferences().raceMode;
    modeButtons.forEach((b) =>
      b.addEventListener('click', () => {
        modeSelect.value = b.dataset.mode ?? 'SURF';
        saveMenuPreferences({ raceMode: modeSelect.value === 'NORMAL' ? 'NORMAL' : 'SURF' });
        modeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        syncModeButtons();
      })
    );
    syncModeButtons();
    const findBtn = this.element.querySelector('#race-find-opponent') as HTMLButtonElement;
    findBtn.addEventListener('click', () => {
      if (this.searching) {
        this.callbacks?.onCancelFind?.();
        return;
      }
      const mode = (this.element.querySelector('#race-mode') as HTMLSelectElement).value as RaceMode;
      const any = (this.element.querySelector('#race-any-signal') as HTMLInputElement).checked;
      this.callbacks?.onFindOpponent?.(this.selectElem.value, mode, any);
    });
    (this.element.querySelector('#race-create-room') as HTMLButtonElement).addEventListener(
      'click',
      () => {
        const capacity = Number(this.capacityElem.value) || DEFAULT_RACE_CAPACITY;
        this.callbacks?.onCreateRoom(this.selectElem.value, capacity, (this.element.querySelector('#race-mode') as HTMLSelectElement).value as RaceMode);
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
    // Landing: keep the selected-track hero and the RACERS segmented control
    // in sync with the authoritative select elements.
    this.selectElem.addEventListener('change', () => {
      this.selectedTrackId = this.selectElem.value;
      saveMenuPreferences({ raceTrackId: this.selectElem.value });
      this.renderCreateHero();
    });
    this.capacityElem.addEventListener('change', () => this.syncCapacitySegments());
    // One uppercase, code-correct join field: real code alphabet only.
    this.joinInput.addEventListener('input', () => {
      const cleaned = this.joinInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (cleaned !== this.joinInput.value) this.joinInput.value = cleaned;
    });
    this.lobbyHostTrackElem.addEventListener('change', () => {
      this.callbacks?.onHostPickTrack(this.lobbyHostTrackElem.value, (this.element.querySelector('#race-host-mode') as HTMLSelectElement).value as RaceMode);
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

    this.element.querySelector('#race-results-next')!.addEventListener('click', () => this.callbacks?.onNextSong?.());
    this.element.querySelector('#race-host-mode')!.addEventListener('change', () => {
      if (this.isHost && this.lastRoom?.state === 'LOBBY') this.callbacks?.onHostPickTrack(this.lobbyHostTrackElem.value, (this.element.querySelector('#race-host-mode') as HTMLSelectElement).value as RaceMode);
    });
    (this.element.querySelector('#race-results-rematch') as HTMLButtonElement).addEventListener(
      'click',
      () => (this.isHost ? this.callbacks?.onRematch() : this.callbacks?.onRematchRequest?.())
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
      async () => {
        const code = this.lastRoom?.inviteCode ?? '';
        const btn = this.element.querySelector('#race-copy-invite') as HTMLButtonElement;
        try {
          if (!navigator.clipboard) throw new Error('Clipboard unavailable');
          await navigator.clipboard.writeText(code);
          btn.textContent = 'COPIED';
        } catch {
          const range = document.createRange();
          range.selectNodeContents(this.lobbyCodeElem);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          btn.textContent = 'SELECTED';
        }
        window.setTimeout(() => { btn.textContent = 'COPY'; }, 1400);
      }
    );
  }

  public setCallbacks(callbacks: RacePanelCallbacks): void {
    this.callbacks = callbacks;
  }

  public setCatalog(entries: RaceCatalogEntry[]): void {
    this.catalog = entries;
    const options = entries
      .map(
        (t, i) =>
          `<option value="${t.id}">[${(i + 1).toString().padStart(2, '0')}] ${t.title} ` +
          `(${t.bpm} BPM // ${t.difficultyLabel})</option>`
      )
      .join('');
    this.selectElem.innerHTML = options;
    this.lobbyHostTrackElem.innerHTML = options;
    if (entries.length > 0 && !this.selectElem.value) this.selectElem.value = entries[0].id;
    // Start on the signal this player raced last, when it is still in the catalog.
    const remembered = readMenuPreferences().raceTrackId;
    if (remembered && entries.some((e) => e.id === remembered)) this.selectElem.value = remembered;
    this.selectedTrackId = this.selectElem.value;
    this.renderCapacitySegments();
    this.syncCapacitySegments();
    this.renderCreateHero();
  }

  public getSelectedTrack(): string {
    return this.selectElem.value;
  }

  /** Selected-track hero: real title, BPM, difficulty and accent. */
  private renderCreateHero(): void {
    const entry = this.catalog.find((t) => t.id === this.selectedTrackId) ?? this.catalog[0];
    const accent = entry?.accentColor || 'var(--accent-color)';
    this.createHeroElem.style.setProperty('--race-accent', accent);
    this.createTitleElem.textContent = entry ? entry.title : '--';
    this.createBpmElem.textContent = entry ? `${entry.bpm} BPM` : '-- BPM';
    this.createDiffElem.textContent = entry ? entry.difficultyLabel : '--';
    this.selectView.style.setProperty('--race-accent', accent);
  }

  /** RACERS segmented control, kept in sync with the hidden native select. */
  private renderCapacitySegments(): void {
    this.capacitySegElem.innerHTML = RACE_CAPACITIES.map((n) => {
      const recommended = n === DEFAULT_RACE_CAPACITY;
      return (
        `<button class="race-cap-btn${recommended ? ' race-cap-recommended' : ''}"` +
        ` type="button" data-capacity="${n}"` +
        ` aria-pressed="false" aria-label="${n} racers${recommended ? ', recommended' : ''}">${n}</button>`
      );
    }).join('');
    this.capacitySegElem.querySelectorAll<HTMLButtonElement>('.race-cap-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.capacityElem.value = btn.dataset.capacity ?? String(DEFAULT_RACE_CAPACITY);
        this.syncCapacitySegments();
      });
      btn.addEventListener('keydown', (e) => {
        const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
          : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        const btns = [...this.capacitySegElem.querySelectorAll<HTMLButtonElement>('.race-cap-btn')];
        const idx = btns.indexOf(btn);
        const target = btns[(idx + dir + btns.length) % btns.length];
        target.focus();
        target.click();
      });
    });
  }

  /** Reflect the authoritative capacity select into the segmented buttons. */
  private syncCapacitySegments(): void {
    this.capacitySegElem.querySelectorAll<HTMLButtonElement>('.race-cap-btn').forEach((btn) => {
      const on = btn.dataset.capacity === this.capacityElem.value;
      btn.classList.toggle('race-cap-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
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
    this.rematchNoteElem.textContent = this.isHost ? '' : 'ASK THE HOST FOR A REMATCH OR THE NEXT SONG';
  }

  private searching = false;
  private mapVoteSource:
    | (() => { votes: ReadonlyMap<string, string>; myUserId: string | null; players: readonly RacePlayer[]; defaultKey: string; open: boolean })
    | null = null;

  /** Where the lobby reads the current map votes from (Game owns the room). */
  public setMapVoteSource(source: NonNullable<RacePanel['mapVoteSource']>): void {
    this.mapVoteSource = source;
  }

  /** Redraws the map vote card: the picked map is highlighted and every racer's vote is listed. */
  public refreshMapVotes(): void {
    const grid = this.element.querySelector('#race-map-grid') as HTMLElement | null;
    const line = this.element.querySelector('#race-map-votes') as HTMLElement | null;
    const source = this.mapVoteSource?.();
    if (!grid || !line || !source) return;
    if (grid.childElementCount === 0) {
      for (const map of ENVIRONMENT_MAPS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'race-map-btn';
        btn.dataset.mapKey = map.key;
        btn.innerHTML = `<img src="${map.thumbnail}" alt="" loading="lazy"><span>${this.escape(map.name)}</span>`;
        btn.addEventListener('click', () => this.callbacks?.onMapVote?.(map.key));
        grid.appendChild(btn);
      }
    }
    const mine = source.myUserId ? source.votes.get(source.myUserId) ?? source.defaultKey : source.defaultKey;
    grid.querySelectorAll<HTMLButtonElement>('.race-map-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mapKey === mine);
      btn.disabled = !source.open;
    });
    const nameOf = (key: string): string => ENVIRONMENT_MAPS.find((m) => m.key === key)?.name ?? key;
    line.textContent = source.players
      .filter((p) => p.connected)
      .map((p) => `${p.displayName.toUpperCase()}: ${nameOf(source.votes.get(p.userId) ?? source.defaultKey)}`)
      .join('   //   ');
  }
  private trackPickLocked = false;

  /**
   * Quick-matched rooms have their signal drawn from both players' choices, so
   * nobody picks one while the room loads. Locking hides the host's picker.
   */
  public setTrackPickLocked(locked: boolean, note = ''): void {
    this.trackPickLocked = locked;
    const noteElem = this.element.querySelector('#race-pick-note') as HTMLElement | null;
    if (noteElem) noteElem.textContent = this.trackPickLocked ? note : '';
    if (locked) (this.element.querySelector('#race-host-track-row') as HTMLElement | null)?.classList.add('hidden');
  }

  /** Quick-match search state: the button turns into CANCEL and a status line counts up. */
  public setSearching(searching: boolean, status = ''): void {
    this.searching = searching;
    const btn = this.element.querySelector('#race-find-opponent') as HTMLButtonElement | null;
    const line = this.element.querySelector('#race-find-status') as HTMLElement | null;
    if (btn) btn.textContent = searching ? '> CANCEL SEARCH' : '> FIND OPPONENT';
    if (line) line.textContent = status || (searching ? '' : 'MATCHES YOU WITH ANOTHER PLAYER // IF YOU PICK DIFFERENT SIGNALS, ONE IS DRAWN AT RANDOM');
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
    // Everyone can press REMATCH: the host starts it, a guest asks the host.
    (this.element.querySelector('#race-results-rematch') as HTMLButtonElement).textContent = isHost
      ? '> REMATCH // NEW MAP VOTE'
      : '> ASK FOR A REMATCH';
    (this.element.querySelector('#race-results-next') as HTMLButtonElement).disabled = !isHost;
    (this.element.querySelector('#race-results-lobby') as HTMLButtonElement).disabled = !isHost;
    if (!isHost && !this.resultsView.classList.contains('hidden')) this.rematchNoteElem.textContent = 'ASK THE HOST FOR A REMATCH OR THE NEXT SONG';
    // Only the host sees the track picker, and only while the room is unlocked.
    const canPick = false; // the signal is chosen before the room exists, never while it loads
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
    this.refreshMapVotes();

    this.lobbyCodeElem.textContent = room.inviteCode;
    this.lobbyTitleElem.textContent = room.trackTitle || room.trackId;
    this.lobbyCapacityElem.textContent = String(room.capacity);
    this.lobbyInviteInput.value = inviteUrl;
    this.joinInput.value = room.inviteCode;

    // Track identity: real title + BPM // difficulty from the official catalog,
    // painted with the real track accent. No track content change.
    const track = this.catalog.find((t) => t.id === raceBaseTrackId(room.trackId));
    const accent = track?.accentColor || 'var(--accent-color)';
    this.lobbyView.style.setProperty('--race-accent', accent);
    this.lobbyTitleElem.style.color = accent;
    (this.element.querySelector('#race-lobby-bpm') as HTMLElement).textContent =
      track ? `${track.bpm} BPM` : '';
    (this.element.querySelector('#race-lobby-diff') as HTMLElement).textContent =
      track ? track.difficultyLabel : '';
    (this.element.querySelector('#race-lobby-connected') as HTMLElement).textContent = String(
      players.filter((p) => p.connected).length
    );

    // Host track picker: only visible, unlocked, host-only.
    (this.element.querySelector('#race-host-track-row') as HTMLElement).classList.toggle(
      'hidden',
      true
    );
    if (room.state === 'LOBBY' && this.lobbyHostTrackElem.value !== raceBaseTrackId(room.trackId)) {
      this.lobbyHostTrackElem.value = raceBaseTrackId(room.trackId);
    }
    const modeSelect = this.element.querySelector('#race-host-mode') as HTMLSelectElement;
    modeSelect.value = raceMode(room.trackId); modeSelect.disabled = !this.isHost || room.state !== 'LOBBY';
    this.lobbyHostTrackElem.disabled = !this.isHost || room.state !== 'LOBBY';

    this.renderPlayerRows(room, players, myUserId, identities);

    const me = players.find((p) => p.userId === myUserId);
    this.readyState = me?.ready ?? false;
    this.renderReadyButton();

    const connected = players.filter((p) => p.connected);
    (this.element.querySelector('#race-results-rematch') as HTMLButtonElement).disabled = connected.length < 2;
    (this.element.querySelector('#race-results-next') as HTMLButtonElement).disabled = !this.isHost || connected.length < 2;
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
    const slots = Math.min(room.capacity, Math.max(2, players.length + 1));
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

  public setRunFeedback(feedback: RaceRunFeedback | null): void {
    this.runFeedback = feedback;
  }

  /** The big "who won" banner above the table: winner, time and the margin. */
  private renderWinnerBanner(
    rows: readonly RaceResultRow[],
    finishers: readonly RaceResultRow[],
    myUserId: string | null
  ): void {
    const banner = this.element.querySelector('#race-winner') as HTMLElement | null;
    if (!banner) return;
    const winner = finishers.find((r) => r.place === 1) ?? finishers[0];
    banner.classList.remove('hidden', 'race-winner-me', 'race-winner-lose');
    if (!winner) {
      banner.classList.add('race-winner-lose');
      banner.innerHTML = '<div class="race-winner-title">NO WINNER</div><div class="race-winner-sub">NOBODY FINISHED</div>';
      return;
    }
    const mine = rows.find((r) => r.userId === myUserId);
    const won = winner.userId === myUserId;
    const second = finishers.find((r) => r !== winner);
    const margin = second && second.gapUs ? ` // BY ${formatRaceTime(Math.abs(second.gapUs))}` : '';
    const track = this.lastRoom?.trackTitle ? ` // ${this.escape(this.lastRoom.trackTitle.toUpperCase())}` : '';
    banner.classList.add(won ? 'race-winner-me' : 'race-winner-lose');
    const title = won ? 'YOU WIN' : `${this.escape(winner.displayName.toUpperCase())} WINS`;
    const dropped = rows.some((r) => r.userId !== winner.userId && r.dnf);
    let sub = `${formatRaceTime(winner.finishTimeUs)}${margin}${track}${dropped ? ' // OPPONENT DISCONNECTED' : ''}`;
    if (!won && mine) {
      const yours = mine.dnf || mine.finishTimeUs === null ? 'DNF' : `${formatRaceTime(mine.finishTimeUs)} // PLACE ${mine.place ?? '--'}`;
      sub += ` // YOU: ${yours}`;
    }
    banner.innerHTML = `<div class="race-winner-title">${title}</div><div class="race-winner-sub">${sub}</div>`;
  }

  public renderResults(
    rows: readonly RaceResultRow[],
    myUserId: string | null,
    identities?: Map<string, { gloveName: string; knifeName: string }>
  ): void {
    const finishers = rows.filter((r) => r.finishTimeUs !== null && !r.dnf);
    this.resultsTitleElem.textContent = finishers.length === 0 ? 'RACE COMPLETE // NO FINISH' : 'RACE COMPLETE';

    this.renderWinnerBanner(rows, finishers, myUserId);

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
        `<span class="online-result-meta">${outcome}${gap ? ' ' + gap : ''}</span>`;
      this.resultsElem.appendChild(line);
    });

    const me = rows.find((row) => row.userId === myUserId && !row.dnf && row.finishTimeUs !== null);
    if (me && this.runFeedback) {
      const feedback = document.createElement('div');
      feedback.className = 'race-run-feedback';
      const run = this.runFeedback;
      const gain = pbImprovement(run.priorPbTime, run.time);
      const pb = run.isNewPb
        ? `NEW PB${gain !== null ? ` // -${gain.toFixed(3)}s` : ''}`
        : `PB ${formatRaceTime(run.priorPbTime === null ? null : Math.round(run.priorPbTime * 1_000_000))}`;
      feedback.textContent = `${run.rank} // ${pb}${run.diamondJustMastered ? ' // DIAMOND ACHIEVED // SIGNAL MASTERED' : ''}`;
      this.resultsElem.appendChild(feedback);
    }
    if (me && finishers.length > 1) {
      const rival = finishers.filter((row) => row.userId !== myUserId)
        .sort((a, b) => Math.abs(a.finishTimeUs! - me.finishTimeUs!) - Math.abs(b.finishTimeUs! - me.finishTimeUs!))[0];
      const difference = (me.finishTimeUs! - rival.finishTimeUs!) / 1_000_000;
      const target = document.createElement('div');
      target.className = 'race-rival-target';
      target.textContent = `RIVAL // ${rival.displayName} // ${difference >= 0 ? '+' : '-'}${Math.abs(difference).toFixed(3)}s`;
      this.resultsElem.appendChild(target);
    }

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
