/**
 * MovementLabSongModal: Compact terminal track chooser overlay for Movement Lab.
 * Allows instant song switching with hotkey [M] without leaving the lab.
 */

import { MusicPack, TrackCatalogEntry } from '../audio/MusicPack';

export class MovementLabSongModal {
  public element: HTMLElement;
  private trackListElem: HTMLElement;
  private closeBtn: HTMLButtonElement;
  private catalog: TrackCatalogEntry[];
  private onSelectCallback?: (track: TrackCatalogEntry) => void;
  private onCloseCallback?: () => void;

  constructor() {
    this.catalog = MusicPack.getCatalog();
    this.element = document.createElement('div');
    this.element.className = 'screen movement-lab-song-screen hidden';
    this.element.innerHTML = `
      <div class="settings-container terminal-console" style="max-height: 84vh; width: 90%; max-width: 680px; overflow-y: auto; padding: 20px 24px; background: rgba(8, 12, 18, 0.96); border: 1px solid #1f293d; border-left: 3px solid #00f0ff; box-shadow: 0 16px 48px rgba(0,0,0,0.85);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px;">
          <div>
            <div style="font-family: var(--font-mono); font-size: 0.65rem; color: #00f0ff; letter-spacing: 0.25em;">// AUDIO KERNEL</div>
            <h2 class="pause-title" style="margin: 0; font-size: 1.6rem; text-align: left; letter-spacing: 0.1em;">MOVEMENT LAB // AUDIO FREQUENCY</h2>
          </div>
          <span style="font-family: var(--font-mono); font-size: 0.68rem; color: #5a6678;">HOTKEY [M] / [ESC]</span>
        </div>

        <div style="font-family: var(--font-mono); font-size: 0.72rem; color: #8899aa; margin-bottom: 12px;">
          > SELECT SIGNAL PACK SOUNDTRACK FOR MOVEMENT TRAINING:
        </div>

        <div id="lab-song-list" style="display: flex; flex-direction: column; gap: 6px; max-height: 380px; overflow-y: auto; padding-right: 4px;">
          <!-- Dynamically populated -->
        </div>

        <div style="margin-top: 16px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: flex-end;">
          <button class="primary" id="btn-lab-song-close" style="padding: 6px 18px; font-size: 0.75rem;">[ CLOSE ]</button>
        </div>
      </div>
    `;

    this.trackListElem = this.element.querySelector('#lab-song-list') as HTMLElement;
    this.closeBtn = this.element.querySelector('#btn-lab-song-close') as HTMLButtonElement;

    this.populateTracks();
    this.initEvents();
  }

  public setCallbacks(callbacks: {
    onSelect: (track: TrackCatalogEntry) => void;
    onClose: () => void;
  }): void {
    this.onSelectCallback = callbacks.onSelect;
    this.onCloseCallback = callbacks.onClose;
  }

  public show(currentTrackId?: string): void {
    this.updateActiveTrack(currentTrackId);
    this.element.classList.remove('hidden');
    this.closeBtn.focus();
  }

  public hide(): void {
    this.element.classList.add('hidden');
  }

  public isVisible(): boolean {
    return !this.element.classList.contains('hidden');
  }

  private populateTracks(): void {
    this.trackListElem.innerHTML = '';
    this.catalog.forEach((t, idx) => {
      const row = document.createElement('div');
      row.className = 'strip-item terminal-strip-item';
      row.dataset.trackId = t.id;
      row.style.flexDirection = 'row';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      row.style.padding = '8px 12px';

      row.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
          <span style="font-family: var(--font-mono); font-size: 0.7rem; color: #00f0ff;">[${(idx + 1).toString().padStart(2, '0')}]</span>
          <div>
            <div style="font-family: var(--font-sans); font-size: 0.88rem; font-weight: 700; color: var(--text-primary); letter-spacing: 0.05em;">${t.title}</div>
            <div style="font-family: var(--font-mono); font-size: 0.65rem; color: #8899aa;">${t.genre} · ${t.difficultyLabel}</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <span style="font-family: var(--font-mono); font-size: 0.72rem; color: #e2e8f0;">${t.bpm} BPM</span>
          <button class="terminal-btn-subtle" style="font-size: 0.7rem; padding: 3px 8px; border: 1px solid rgba(0, 240, 255, 0.4); color: #00f0ff; background: transparent; cursor: pointer;">> LOAD</button>
        </div>
      `;

      row.addEventListener('click', () => {
        this.hide();
        this.onSelectCallback?.(t);
      });

      this.trackListElem.appendChild(row);
    });
  }

  private updateActiveTrack(currentTrackId?: string): void {
    const rows = this.trackListElem.querySelectorAll('.strip-item');
    rows.forEach((r) => {
      if ((r as HTMLElement).dataset.trackId === currentTrackId) {
        r.classList.add('active');
      } else {
        r.classList.remove('active');
      }
    });
  }

  private initEvents(): void {
    this.closeBtn.addEventListener('click', () => {
      this.hide();
      this.onCloseCallback?.();
    });
  }
}
