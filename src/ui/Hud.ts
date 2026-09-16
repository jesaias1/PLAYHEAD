/**
 * In-game HUD displaying speed, sync delta, section, and notifications
 */

import { formatSpeed } from '../utils/math';
import { SplitResult } from '../replay/GhostManager';

export class Hud {
  public element: HTMLElement;
  private titleElem: HTMLElement;
  private sectionElem: HTMLElement;
  private speedElem: HTMLElement;
  private syncElem: HTMLElement;
  private progressBarFill: HTMLElement;
  private toastElem: HTMLElement;
  private toastTimeout: number | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.id = 'hud-container';
    this.element.className = 'hidden';
    this.element.innerHTML = `
      <div class="hud-top">
        <div class="hud-track-info">
          <div class="hud-track-title" id="hud-title">PLAYHEAD</div>
          <div class="hud-section-info" id="hud-section">SECTION 1 // FLOW</div>
        </div>
        <div class="hud-speed-gauge">
          <div class="hud-speed-value" id="hud-speed">0</div>
          <div class="hud-speed-unit">U/S</div>
        </div>
      </div>

      <div class="hud-center">
        <div class="hud-reticle"></div>
        <div class="hud-surf-indicator hidden" id="hud-surf-indicator">
          <span class="hud-surf-key" id="hud-surf-key">A</span>
          <span class="hud-surf-text" id="hud-surf-text">HOLD TO SURF</span>
        </div>
      </div>
      <div class="hud-toast" id="hud-toast"></div>

      <div class="hud-split-toast" id="hud-split-toast">
        <div class="hud-split-header" id="hud-split-header">CHECKPOINT 1 // VS ECHO</div>
        <div class="hud-split-val" id="hud-split-val">▲ -0.00s</div>
      </div>

      <div class="hud-bottom">
        <div class="hud-stats-strip">
          <div class="hud-sync-indicator">
            <span class="hud-sync-label">SYNC DELTA</span>
            <span class="hud-sync-val" id="hud-sync">0.00s</span>
          </div>
          <div class="hud-split-badge hidden" id="hud-split-badge">
            <span class="hud-split-badge-label" id="hud-split-badge-label">VS ECHO</span>
            <span class="hud-split-badge-val" id="hud-split-badge-val">0.00s</span>
          </div>
        </div>
        <div class="hud-progress-bar-container">
          <div class="hud-progress-bar-fill" id="hud-progress"></div>
        </div>
      </div>
    `;

    this.titleElem = this.element.querySelector('#hud-title') as HTMLElement;
    this.sectionElem = this.element.querySelector('#hud-section') as HTMLElement;
    this.speedElem = this.element.querySelector('#hud-speed') as HTMLElement;
    this.syncElem = this.element.querySelector('#hud-sync') as HTMLElement;
    this.progressBarFill = this.element.querySelector('#hud-progress') as HTMLElement;
    this.toastElem = this.element.querySelector('#hud-toast') as HTMLElement;
    this.surfIndicatorElem = this.element.querySelector('#hud-surf-indicator') as HTMLElement;
    this.surfKeyElem = this.element.querySelector('#hud-surf-key') as HTMLElement;
    this.surfTextElem = this.element.querySelector('#hud-surf-text') as HTMLElement;

    this.splitToastElem = this.element.querySelector('#hud-split-toast') as HTMLElement;
    this.splitHeaderElem = this.element.querySelector('#hud-split-header') as HTMLElement;
    this.splitValElem = this.element.querySelector('#hud-split-val') as HTMLElement;
    this.splitBadgeElem = this.element.querySelector('#hud-split-badge') as HTMLElement;
    this.splitBadgeLabelElem = this.element.querySelector('#hud-split-badge-label') as HTMLElement;
    this.splitBadgeValElem = this.element.querySelector('#hud-split-badge-val') as HTMLElement;
  }

  private surfIndicatorElem: HTMLElement;
  private surfKeyElem: HTMLElement;
  private surfTextElem: HTMLElement;

  private splitToastElem: HTMLElement;
  private splitHeaderElem: HTMLElement;
  private splitValElem: HTMLElement;
  private splitBadgeElem: HTMLElement;
  private splitBadgeLabelElem: HTMLElement;
  private splitBadgeValElem: HTMLElement;
  private splitTimeout: number | null = null;

  public show(): void {
    this.element.classList.remove('hidden');
  }

  public hide(): void {
    this.element.classList.add('hidden');
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
    this.toastElem.classList.remove('active');

    if (this.splitTimeout) {
      clearTimeout(this.splitTimeout);
      this.splitTimeout = null;
    }
    this.splitToastElem.classList.remove('active');
    this.splitBadgeElem.classList.add('hidden');
  }

  public setTrackInfo(title: string, sectionText: string): void {
    this.titleElem.textContent = title.toUpperCase();
    this.sectionElem.textContent = sectionText.toUpperCase();
  }

  public update(speed: number, syncDelta: number, progressRatio: number, sectionTheme?: string, sectionNumber?: number): void {
    if (sectionTheme && sectionNumber !== undefined) {
      this.sectionElem.textContent = `SECTION ${sectionNumber} // ${sectionTheme}`;
    }
    this.speedElem.textContent = formatSpeed(speed);

    // Speed intensity classes for visual feedback
    if (speed > 28) {
      this.speedElem.className = 'hud-speed-value speed-hyper';
    } else if (speed > 18) {
      this.speedElem.className = 'hud-speed-value speed-high';
    } else {
      this.speedElem.className = 'hud-speed-value';
    }

    // Sync Delta formatting
    const sign = syncDelta >= 0 ? '+' : '-';
    const abs = Math.abs(syncDelta).toFixed(2);
    this.syncElem.textContent = `${sign}${abs}s`;

    if (syncDelta < -0.5) {
      this.syncElem.className = 'hud-sync-val ahead';
    } else if (syncDelta > 0.5) {
      this.syncElem.className = 'hud-sync-val behind';
    } else {
      this.syncElem.className = 'hud-sync-val';
    }

    const pct = Math.min(100, Math.max(0, progressRatio * 100));
    this.progressBarFill.style.width = `${pct.toFixed(1)}%`;
  }

  public updateSurfPrompt(isSurfing: boolean, surfSide: 'LEFT' | 'RIGHT' | 'NONE'): void {
    if (isSurfing && (surfSide === 'LEFT' || surfSide === 'RIGHT')) {
      const key = surfSide === 'LEFT' ? 'A' : 'D';
      this.surfKeyElem.textContent = key;
      this.surfTextElem.textContent = `HOLD [${key}] TO SURF`;
      this.surfIndicatorElem.classList.remove('hidden');
    } else {
      this.surfIndicatorElem.classList.add('hidden');
    }
  }

  public showToast(msg: string, durationMs = 2000): void {
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }

    this.toastElem.textContent = msg;
    this.toastElem.classList.add('active');

    this.toastTimeout = window.setTimeout(() => {
      this.toastElem.classList.remove('active');
      this.toastTimeout = null;
    }, durationMs);
  }

  public showSplit(split: SplitResult, durationMs = 2600): void {
    if (this.splitTimeout) {
      clearTimeout(this.splitTimeout);
    }

    const targetName = split.target === 'PB' ? 'PB' : 'ECHO';
    const sign = split.isAhead ? '▲ -' : '▼ +';
    const absVal = Math.abs(split.deltaSeconds).toFixed(2);
    const splitClass = split.isAhead ? 'ahead' : 'behind';

    this.splitHeaderElem.textContent = `CHECKPOINT ${split.checkpointIndex + 1} // VS ${targetName}`;
    this.splitValElem.textContent = `${sign}${absVal}s`;
    this.splitValElem.className = `hud-split-val ${splitClass}`;
    this.splitToastElem.classList.add('active');

    // Update bottom badge
    this.splitBadgeLabelElem.textContent = `VS ${targetName}`;
    this.splitBadgeValElem.textContent = `${split.isAhead ? '-' : '+'}${absVal}s`;
    this.splitBadgeValElem.className = `hud-split-badge-val ${splitClass}`;
    this.splitBadgeElem.classList.remove('hidden');

    this.splitTimeout = window.setTimeout(() => {
      this.splitToastElem.classList.remove('active');
      this.splitTimeout = null;
    }, durationMs);
  }
}
