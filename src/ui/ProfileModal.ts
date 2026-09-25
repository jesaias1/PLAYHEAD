/**
 * PLAYER PROFILE — restrained identity surface.
 *
 * A modal, not a navigation tab: PLAYHEAD's tab row is already dense, and a
 * profile is a glance, not a destination.
 *
 * DELIBERATELY NOT SHOWN: email, auth provider, raw auth metadata, storage paths,
 * offline queue, progression ledgers, session/IP data, or any raw UUID. The only
 * identifiers rendered are the display name and canonical track ids.
 *
 * PERFORMANCE: text and CSS only. No Three.js scene, no knife texture, no glove
 * asset, no animated VideoTexture and no replay file is loaded to show a profile.
 */

import { KarambitSkinSystem } from '../viewmodel/KarambitSkinSystem';
import { formatRaceTime } from './RaceHud';
import type { PlayerProfileView, ProfileTrackRow } from '../online/PlayerProfileService';

export interface ProfileModalCallbacks {
  /** Another player's accepted public run. */
  onWatchRemoteRun?: (runId: string) => void;
  onRaceRemoteRun?: (runId: string) => void;
  /** The local player's own PB for a track. */
  onWatchLocalPb?: (trackId: string) => void;
  onRaceLocalPb?: (trackId: string) => void;
  /** Display-name edit for the local player. */
  onRename?: (name: string) => { ok: boolean; detail: string };
  onClose?: () => void;
}

export class ProfileModal {
  public element: HTMLElement;

  private titleElem: HTMLElement;
  private statusElem: HTMLElement;
  private equippedElem: HTMLElement;
  private masteryElem: HTMLElement;
  private tracksElem: HTMLElement;
  private renameRow: HTMLElement;
  private renameInput: HTMLInputElement;
  private renameBtn: HTMLButtonElement;
  private closeBtn: HTMLButtonElement;

  private callbacks: ProfileModalCallbacks = {};

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'screen profile-screen hidden';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.innerHTML = `
      <div class="profile-container">
        <div class="profile-header">
          <div class="profile-title-group">
            <div class="profile-kicker">[IDENTITY] PLAYER PROFILE</div>
            <h3 class="profile-title" id="profile-name">PLAYER</h3>
            <div class="profile-status" id="profile-status"></div>
          </div>
          <button class="terminal-btn-subtle" id="btn-profile-close" type="button">[ CLOSE ]</button>
        </div>

        <div class="profile-rename hidden" id="profile-rename-row">
          <label class="profile-label" for="profile-rename-input">DISPLAY NAME</label>
          <input class="online-input" id="profile-rename-input" type="text" maxlength="24"
                 autocomplete="off" spellcheck="false" />
          <button class="terminal-btn-subtle" id="btn-profile-rename" type="button">[ SAVE ]</button>
          <span class="profile-rename-hint" id="profile-rename-hint"></span>
        </div>

        <div class="profile-section">
          <div class="profile-section-title">EQUIPPED</div>
          <div class="profile-equipped" id="profile-equipped"></div>
        </div>

        <div class="profile-section">
          <div class="profile-section-title">SIGNAL MASTERY</div>
          <div class="profile-mastery" id="profile-mastery"></div>
        </div>

        <div class="profile-section">
          <div class="profile-section-title">OFFICIAL RUNS</div>
          <div class="profile-tracks" id="profile-tracks"></div>
        </div>
      </div>
    `;

    this.titleElem = this.element.querySelector('#profile-name') as HTMLElement;
    this.statusElem = this.element.querySelector('#profile-status') as HTMLElement;
    this.equippedElem = this.element.querySelector('#profile-equipped') as HTMLElement;
    this.masteryElem = this.element.querySelector('#profile-mastery') as HTMLElement;
    this.tracksElem = this.element.querySelector('#profile-tracks') as HTMLElement;
    this.renameRow = this.element.querySelector('#profile-rename-row') as HTMLElement;
    this.renameInput = this.element.querySelector('#profile-rename-input') as HTMLInputElement;
    this.renameBtn = this.element.querySelector('#btn-profile-rename') as HTMLButtonElement;
    this.closeBtn = this.element.querySelector('#btn-profile-close') as HTMLButtonElement;

    this.closeBtn.addEventListener('click', () => {
      this.hide();
      this.callbacks.onClose?.();
    });
    this.element.addEventListener('click', (e) => {
      // Click the backdrop to close.
      if (e.target === this.element) {
        this.hide();
        this.callbacks.onClose?.();
      }
    });
    this.renameBtn.addEventListener('click', () => this.submitRename());
    this.renameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.submitRename();
    });
  }

  public setCallbacks(callbacks: ProfileModalCallbacks): void {
    this.callbacks = callbacks;
  }

  public isVisible(): boolean {
    return !this.element.classList.contains('hidden');
  }

  public hide(): void {
    this.element.classList.add('hidden');
  }

  /** Renders a profile view. `allowRename` is only true for the local player. */
  public render(view: PlayerProfileView, allowRename = false): void {
    // Display name is the ONLY identity string rendered. Never a UUID.
    this.titleElem.textContent = view.displayName;

    if (view.offline) {
      this.statusElem.textContent = 'PROFILE // OFFLINE';
      this.equippedElem.innerHTML = '';
      this.masteryElem.innerHTML = '';
      this.tracksElem.innerHTML = '';
      this.renameRow.classList.add('hidden');
      this.element.classList.remove('hidden');
      return;
    }

    this.statusElem.textContent = view.isLocal ? 'THIS DEVICE' : 'PUBLIC PROFILE';
    this.renameRow.classList.toggle('hidden', !allowRename);
    if (allowRename) {
      this.renameInput.value = view.displayName;
      this.setRenameHint('', false);
    }

    this.renderEquipped(view);
    this.renderMastery(view);
    this.renderTracks(view);

    this.element.classList.remove('hidden');
  }

  // -- sections -------------------------------------------------------------

  private renderEquipped(view: PlayerProfileView): void {
    const knifeName = this.knifeDisplayName(view.equippedKnifeId);
    // The glove is shown with the ACHIEVEMENT behind it, never as a bare skin
    // name. That is what gives the cosmetic its prestige.
    const gloveBlock = view.gloveName
      ? `<div class="profile-item">
           <span class="profile-item-label">GLOVES</span>
           <span class="profile-item-value">${this.escape(view.gloveName)}</span>
           <span class="profile-item-req">${this.escape(view.gloveRequirement)}</span>
         </div>`
      : '';

    this.equippedElem.innerHTML =
      `<div class="profile-item">
         <span class="profile-item-label">KARAMBIT</span>
         <span class="profile-item-value">${this.escape(knifeName)}</span>
       </div>` + gloveBlock;
  }

  private renderMastery(view: PlayerProfileView): void {
    const m = view.mastery;
    const rows: Array<[string, number]> = [
      ['CLEARED', m.cleared],
      ['BRONZE+', m.bronzePlus],
      ['SILVER+', m.silverPlus],
      ['GOLD+', m.goldPlus],
      ['DIAMOND', m.diamond]
    ];
    this.masteryElem.innerHTML =
      rows
        .map(
          ([label, value]) =>
            `<div class="profile-mastery-row"><span>${label}</span><b>${pad2(value)} / ${pad2(
              m.total
            )}</b></div>`
        )
        .join('') +
      (view.worldPosition !== null
        ? `<div class="profile-mastery-row profile-world"><span>WORLD POSITION</span><b>#${view.worldPosition}</b></div>`
        : '');
  }

  private renderTracks(view: PlayerProfileView): void {
    if (view.tracks.length === 0) {
      this.tracksElem.innerHTML = `<div class="profile-empty">NO OFFICIAL RUNS ON RECORD</div>`;
      return;
    }

    this.tracksElem.innerHTML = '';
    view.tracks.forEach((row, index) => {
      const line = document.createElement('div');
      line.className = 'profile-track-row';
      const rank = row.rank ?? '—';
      const time = row.timeUs !== null ? formatRaceTime(row.timeUs) : '—';
      const actions = this.trackActions(view, row);

      line.innerHTML =
        `<span class="profile-track-index">${pad2(index + 1)}</span>` +
        `<span class="profile-track-name">${this.escape(row.title)}</span>` +
        `<span class="profile-track-rank ${row.rank ? 'rank-' + row.rank.toLowerCase() : ''}">${rank}</span>` +
        `<span class="profile-track-time">${time}</span>` +
        `<span class="profile-track-actions">${actions}</span>`;

      if (view.isLocal && row.hasReplay) {
        line.querySelector('.profile-watch')?.addEventListener('click', () => {
          this.callbacks.onWatchLocalPb?.(row.trackId);
        });
        line.querySelector('.profile-race')?.addEventListener('click', () => {
          this.callbacks.onRaceLocalPb?.(row.trackId);
        });
      } else if (!view.isLocal && row.runId && row.hasReplay) {
        const runId = row.runId;
        line.querySelector('.profile-watch')?.addEventListener('click', () => {
          this.callbacks.onWatchRemoteRun?.(runId);
        });
        line.querySelector('.profile-race')?.addEventListener('click', () => {
          this.callbacks.onRaceRemoteRun?.(runId);
        });
      }

      this.tracksElem.appendChild(line);
    });
  }

  /**
   * WATCH / RACE are offered ONLY when a valid replay genuinely exists. No button
   * is rendered otherwise, so the UI never promises a replay that is not there.
   */
  private trackActions(view: PlayerProfileView, row: ProfileTrackRow): string {
    if (!row.hasReplay || row.timeUs === null) return '';
    const canRace = view.isLocal || !!row.runId;
    const watch = `<button class="terminal-btn-subtle profile-watch" type="button">WATCH PB</button>`;
    const race = canRace
      ? `<button class="terminal-btn-subtle profile-race" type="button">RACE GHOST</button>`
      : '';
    return watch + race;
  }

  // -- rename ---------------------------------------------------------------

  private submitRename(): void {
    if (!this.callbacks.onRename) return;
    const result = this.callbacks.onRename(this.renameInput.value);
    if (!result.ok) {
      this.setRenameHint(result.detail.toUpperCase(), true);
      return;
    }
    // Validation passed: the save is in flight. The game reports the real
    // outcome through setRenameResult, so nothing is claimed early.
    this.setRenameHint('SAVING...', false);
  }

  /** The REAL save outcome, reported by the game once the server answers. */
  public setRenameResult(ok: boolean, detail: string): void {
    if (ok) {
      this.setRenameHint('NAME SAVED', false);
      this.titleElem.textContent = this.renameInput.value.trim().replace(/\s+/g, ' ');
    } else {
      this.setRenameHint(detail.toUpperCase(), true);
    }
  }

  private setRenameHint(text: string, isError: boolean): void {
    const hint = this.element.querySelector('#profile-rename-hint') as HTMLElement | null;
    if (!hint) return;
    hint.textContent = text;
    hint.classList.toggle('error', isError);
  }

  // -- helpers --------------------------------------------------------------

  private knifeDisplayName(skinId: string): string {
    if (!skinId) return '—';
    try {
      return KarambitSkinSystem.getInstance().getSkin(skinId).name;
    } catch {
      return '—';
    }
  }

  private escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

function pad2(n: number): string {
  return Math.max(0, Math.floor(n)).toString().padStart(2, '0');
}
