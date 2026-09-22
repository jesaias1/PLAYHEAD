/**
 * 06 // WORLD LEADERBOARD — competitive rankings for the official Signal Pack.
 *
 * Leaderboards ONLY. This is not a lobby and it does not require the player to
 * press PLAY to read rankings: selecting a signal loads its board immediately.
 *
 * Boards are scoped to the exact canonical identity (track_id + map_version +
 * map_fingerprint + movement_version) by the existing service, and only
 * `verification_state = 'accepted'` runs are shown. When the backend is
 * unreachable the panel says so instead of inventing a ranking.
 */

import type { LeaderboardView } from '../online/LeaderboardService';
import { formatRaceTime } from './RaceHud';
import { OnlineStatusBar } from './OnlineStatusBar';

export interface LeaderboardCatalogEntry {
  id: string;
  title: string;
  bpm: number;
  difficultyLabel: string;
}

export interface LeaderboardPanelCallbacks {
  onSelectTrack: (trackId: string) => void;
  onPlaySignal: (trackId: string) => void;
  onRetryConnection: () => void;
}

export class LeaderboardPanel {
  public element: HTMLElement;

  private callbacks: LeaderboardPanelCallbacks | null = null;
  private statusBar: OnlineStatusBar;

  private selectElem: HTMLSelectElement;
  private statusElem: HTMLElement;
  private tableElem: HTMLElement;
  private youElem: HTMLElement;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'showcase-container showcase-panel leaderboard-panel';
    this.element.id = 'panel-leaderboard';
    this.element.setAttribute('role', 'tabpanel');
    this.element.setAttribute('aria-labelledby', 'tab-btn-leaderboard');
    this.element.setAttribute('aria-hidden', 'true');

    this.element.innerHTML = `
      <div class="leaderboard-head">
        <label class="online-label" for="lb-track-select">SIGNAL</label>
        <select class="online-select" id="lb-track-select"></select>
        <button class="terminal-btn-subtle" id="lb-play" type="button">> PLAY SIGNAL</button>
      </div>

      <div class="online-lb-status" id="lb-status">SELECT A SIGNAL</div>
      <div class="online-lb-table" id="lb-table"></div>
      <div class="online-lb-you" id="lb-you"></div>
    `;

    this.statusBar = new OnlineStatusBar(() => this.callbacks?.onRetryConnection());
    this.element.insertBefore(this.statusBar.element, this.element.firstChild);

    this.selectElem = this.element.querySelector('#lb-track-select') as HTMLSelectElement;
    this.statusElem = this.element.querySelector('#lb-status') as HTMLElement;
    this.tableElem = this.element.querySelector('#lb-table') as HTMLElement;
    this.youElem = this.element.querySelector('#lb-you') as HTMLElement;

    // Selecting a signal loads its board straight away — no PLAY required.
    this.selectElem.addEventListener('change', () => {
      this.callbacks?.onSelectTrack(this.selectElem.value);
    });
    (this.element.querySelector('#lb-play') as HTMLButtonElement).addEventListener('click', () => {
      this.callbacks?.onPlaySignal(this.selectElem.value);
    });
  }

  public setCallbacks(callbacks: LeaderboardPanelCallbacks): void {
    this.callbacks = callbacks;
  }

  public setCatalog(entries: LeaderboardCatalogEntry[]): void {
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

  public setStatus(tag: string, detail: string): void {
    this.statusBar.setStatus(tag, detail);
  }

  public setLoading(trackTitle: string): void {
    this.statusElem.textContent = `LOADING // ${trackTitle}`;
    this.tableElem.innerHTML = '';
    this.youElem.innerHTML = '';
  }

  public render(view: LeaderboardView, trackTitle: string): void {
    if (view.offline) {
      this.statusElem.textContent = 'WORLD // OFFLINE — LOCAL RESULTS ONLY';
      this.tableElem.innerHTML = '';
      this.youElem.innerHTML = `<div class="online-lb-empty">[LOCAL // SYNC PENDING]</div>`;
      return;
    }

    this.statusElem.textContent = `WORLD // ${trackTitle.toUpperCase()}`;

    if (view.entries.length === 0) {
      this.tableElem.innerHTML =
        `<div class="online-lb-empty">NO ACCEPTED RUNS ON THIS CANONICAL MAP YET</div>`;
    } else {
      const head =
        `<div class="online-lb-row online-lb-head">` +
        `<span class="online-lb-rank">#</span>` +
        `<span class="online-lb-name">PLAYER</span>` +
        `<span class="online-lb-time">TIME</span>` +
        `</div>`;
      const rows = view.entries
        .map(
          (e) =>
            `<div class="online-lb-row">` +
            `<span class="online-lb-rank">${e.rankPosition}</span>` +
            `<span class="online-lb-name">${this.escape(e.displayName)}</span>` +
            `<span class="online-lb-time">${formatRaceTime(e.timeUs)}</span>` +
            `</div>`
        )
        .join('');
      this.tableElem.innerHTML = head + rows;
    }

    if (view.you) {
      this.youElem.innerHTML =
        `<div class="online-lb-you-block">` +
        `<div class="online-lb-you-label">YOUR PB</div>` +
        `<div class="online-lb-you-time">${formatRaceTime(view.you.timeUs)}</div>` +
        `<div class="online-lb-you-label">WORLD POSITION</div>` +
        `<div class="online-lb-you-pos">${view.you.position === null ? 'UNRANKED' : '#' + view.you.position}</div>` +
        `</div>`;
    } else {
      this.youElem.innerHTML =
        `<div class="online-lb-you-block online-lb-empty">NO PERSONAL BEST ON THIS MAP</div>`;
    }
  }

  private escape(value: string): string {
    return value.replace(/[&<>"']/g, (c) =>
      c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
    );
  }
}
