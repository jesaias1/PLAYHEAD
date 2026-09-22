/**
 * REPLAY OVERLAY — minimal first-person replay controls.
 *
 * Restrained by design: the point of POV replay is the view, so this is a thin
 * bar at the bottom with the run identity, a timeline and three actions.
 * ESC exits; the overlay also offers the same actions for mouse users.
 */

import { formatRaceTime } from './RaceHud';

export interface ReplayOverlayState {
  player: string;
  finishTimeUs: number;
  currentMs: number;
  durationMs: number;
  paused: boolean;
}

export interface ReplayOverlayCallbacks {
  onTogglePause: () => void;
  onRestart: () => void;
  onExit: () => void;
}

export class ReplayOverlay {
  public element: HTMLElement;

  private callbacks: ReplayOverlayCallbacks | null = null;
  private titleElem: HTMLElement;
  private playerElem: HTMLElement;
  private timeElem: HTMLElement;
  private timelineElem: HTMLElement;
  private pauseBtn: HTMLButtonElement;

  constructor() {
    this.element = document.createElement('div');
    this.element.id = 'replay-overlay';
    this.element.className = 'replay-overlay hidden';
    this.element.innerHTML = `
      <div class="replay-head">
        <div class="replay-title" id="replay-title">REPLAY</div>
        <div class="replay-player" id="replay-player"></div>
        <div class="replay-finish" id="replay-finish">--:--.---</div>
      </div>

      <div class="replay-timeline">
        <div class="replay-timeline-track"><div class="replay-timeline-fill" id="replay-fill"></div></div>
        <div class="replay-timeline-text" id="replay-time">00:00.000 / 00:00.000</div>
      </div>

      <div class="replay-actions">
        <button class="terminal-btn-subtle" id="replay-pause" type="button">PAUSE</button>
        <button class="terminal-btn-subtle" id="replay-restart" type="button">RESTART</button>
        <button class="terminal-btn-subtle" id="replay-exit" type="button">EXIT</button>
        <span class="replay-hint">ESC EXITS</span>
      </div>
    `;

    this.titleElem = this.element.querySelector('#replay-title') as HTMLElement;
    this.playerElem = this.element.querySelector('#replay-player') as HTMLElement;
    this.timeElem = this.element.querySelector('#replay-time') as HTMLElement;
    this.timelineElem = this.element.querySelector('#replay-fill') as HTMLElement;
    this.pauseBtn = this.element.querySelector('#replay-pause') as HTMLButtonElement;

    this.pauseBtn.addEventListener('click', () => this.callbacks?.onTogglePause());
    (this.element.querySelector('#replay-restart') as HTMLButtonElement).addEventListener('click', () =>
      this.callbacks?.onRestart()
    );
    (this.element.querySelector('#replay-exit') as HTMLButtonElement).addEventListener('click', () =>
      this.callbacks?.onExit()
    );
  }

  public setCallbacks(callbacks: ReplayOverlayCallbacks): void {
    this.callbacks = callbacks;
  }

  public setTitle(title: string): void {
    this.titleElem.textContent = title;
  }

  public show(): void {
    this.element.classList.remove('hidden');
  }

  public hide(): void {
    this.element.classList.add('hidden');
  }

  public isVisible(): boolean {
    return !this.element.classList.contains('hidden');
  }

  public update(state: ReplayOverlayState): void {
    this.playerElem.textContent = state.player;
    const finish = formatRaceTime(state.finishTimeUs);
    this.element.querySelector('#replay-finish')!.textContent = finish;
    this.timeElem.textContent = `${formatRaceTime(state.currentMs * 1000)} / ${formatRaceTime(
      state.durationMs * 1000
    )}`;
    const progress = state.durationMs > 0 ? Math.min(1, state.currentMs / state.durationMs) : 0;
    this.timelineElem.style.width = `${(progress * 100).toFixed(2)}%`;
    this.pauseBtn.textContent = state.paused ? 'RESUME' : 'PAUSE';
  }
}
