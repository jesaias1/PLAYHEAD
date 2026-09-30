/**
 * RACE HUD — the minimal in-session overlay for a friend Best-Time Session.
 *
 * Restrained on purpose: it shows the shared session clock, your current run and
 * session best, and the rival's session best. It never obstructs movement and
 * never shows a big blocking panel during play.
 *
 * Formatting note: display is 3-decimal, but every COMPARISON uses raw
 * microsecond values from the authoritative timer. Formatted strings are never
 * compared.
 */

export interface RaceHudPlayerView {
  displayName: string;
  currentRunUs: number;
  sessionBestUs: number | null;
  attemptCount: number;
  finishCount: number;
  connected: boolean;
}

export interface RaceHudState {
  remainingMs: number;
  you: RaceHudPlayerView;
  rival: RaceHudPlayerView | null;
}

export function formatRaceTime(us: number | null): string {
  if (us === null || !Number.isFinite(us) || us < 0) return '--:--.---';
  const totalMs = Math.floor(us / 1000);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

export function formatSessionClock(remainingMs: number): string {
  const clamped = Math.max(0, remainingMs);
  const totalSeconds = Math.ceil(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export class RaceHud {
  public element: HTMLElement;

  private clockElem: HTMLElement;
  private youRunElem: HTMLElement;
  private youBestElem: HTMLElement;
  private youAttemptElem: HTMLElement;
  private rivalNameElem: HTMLElement;
  private rivalBestElem: HTMLElement;
  private rivalRowElem: HTMLElement;
  private noticeElem: HTMLElement;
  private phaseElem: HTMLElement;
  private phaseOpponentElem: HTMLElement;
  private phaseYouElem: HTMLElement;
  private phasePromptElem: HTMLElement;
  private countdownElem: HTMLElement;
  private noticeTimeout: number | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.id = 'race-hud';
    this.element.className = 'race-hud hidden';
    this.element.innerHTML = `
      <div class="race-hud-clock">
        <span class="race-hud-clock-label">SESSION</span>
        <span class="race-hud-clock-val" id="race-clock">05:00</span>
      </div>

      <div class="race-hud-panel">
        <div class="race-hud-player">
          <div class="race-hud-name">YOU</div>
          <div class="race-hud-row"><span>RUN</span><b id="race-you-run">--:--.---</b></div>
          <div class="race-hud-row"><span>BEST</span><b id="race-you-best">--:--.---</b></div>
          <div class="race-hud-row"><span>ATTEMPT</span><b id="race-you-attempt">0</b></div>
        </div>

        <div class="race-hud-player race-hud-rival" id="race-rival-row">
          <div class="race-hud-name" id="race-rival-name">SIGNAL</div>
          <div class="race-hud-row"><span>BEST</span><b id="race-rival-best">--:--.---</b></div>
        </div>
      </div>

      <div class="race-hud-notice hidden" id="race-notice"></div>

      <!-- SECOND READY / synchronized countdown overlay -->
      <div class="race-hud-phase hidden" id="race-phase">
        <div class="race-phase-line" id="race-phase-opponent">OPPONENT: NOT READY</div>
        <div class="race-phase-line race-phase-you" id="race-phase-you">YOU: NOT READY</div>
        <div class="race-phase-prompt" id="race-phase-prompt">PRESS [SPACE] TO READY</div>
      </div>
      <div class="race-hud-countdown hidden" id="race-countdown">3</div>
    `;

    this.clockElem = this.element.querySelector('#race-clock') as HTMLElement;
    this.youRunElem = this.element.querySelector('#race-you-run') as HTMLElement;
    this.youBestElem = this.element.querySelector('#race-you-best') as HTMLElement;
    this.youAttemptElem = this.element.querySelector('#race-you-attempt') as HTMLElement;
    this.rivalRowElem = this.element.querySelector('#race-rival-row') as HTMLElement;
    this.rivalNameElem = this.element.querySelector('#race-rival-name') as HTMLElement;
    this.rivalBestElem = this.element.querySelector('#race-rival-best') as HTMLElement;
    this.noticeElem = this.element.querySelector('#race-notice') as HTMLElement;
    this.phaseElem = this.element.querySelector('#race-phase') as HTMLElement;
    this.phaseOpponentElem = this.element.querySelector('#race-phase-opponent') as HTMLElement;
    this.phaseYouElem = this.element.querySelector('#race-phase-you') as HTMLElement;
    this.phasePromptElem = this.element.querySelector('#race-phase-prompt') as HTMLElement;
    this.countdownElem = this.element.querySelector('#race-countdown') as HTMLElement;
  }

  public show(): void {
    this.element.classList.remove('hidden');
  }

  public hide(): void {
    this.element.classList.add('hidden');
    this.clearNotice();
  }

  public update(state: RaceHudState): void {
    this.clockElem.textContent = formatSessionClock(state.remainingMs);
    // Low-time emphasis only; no flashing.
    this.clockElem.classList.toggle('race-hud-clock-low', state.remainingMs <= 30_000);

    this.youRunElem.textContent = formatRaceTime(state.you.currentRunUs);
    this.youBestElem.textContent = formatRaceTime(state.you.sessionBestUs);
    this.youAttemptElem.textContent = String(state.you.attemptCount);

    if (!state.rival || !state.rival.connected) {
      this.rivalRowElem.classList.add('race-hud-disconnected');
      this.rivalNameElem.textContent = state.rival ? 'PLAYER DISCONNECTED' : 'WAITING FOR SIGNAL...';
      this.rivalBestElem.textContent = state.rival ? formatRaceTime(state.rival.sessionBestUs) : '--:--.---';
      return;
    }

    this.rivalRowElem.classList.remove('race-hud-disconnected');
    this.rivalNameElem.textContent = state.rival.displayName;
    this.rivalBestElem.textContent = formatRaceTime(state.rival.sessionBestUs);
  }

  /**
   * In-game WAITING / READY stage. The countdown does not begin until BOTH
   * players are ready; this makes that state explicit for the local player.
   */
  public setPhase(state: {
    phase: 'WAITING' | 'READY' | 'COUNTDOWN' | 'RACING' | 'FINISHED';
    youReady: boolean;
    opponentName: string;
    opponentReady: boolean;
  }): void {
    if (state.phase === 'RACING' || state.phase === 'FINISHED') {
      this.phaseElem.classList.add('hidden');
      return;
    }
    this.phaseElem.classList.remove('hidden');
    this.phaseOpponentElem.textContent =
      `${state.opponentName.toUpperCase()}: ${state.opponentReady ? 'READY' : 'NOT READY'}`;
    this.phaseOpponentElem.classList.toggle('race-phase-ready', state.opponentReady);
    this.phaseYouElem.textContent = `YOU: ${state.youReady ? 'READY' : 'NOT READY'}`;
    this.phaseYouElem.classList.toggle('race-phase-ready', state.youReady);

    if (state.phase === 'COUNTDOWN') {
      this.phasePromptElem.textContent = 'BOTH READY // STARTING';
    } else if (state.youReady) {
      this.phasePromptElem.textContent = 'WAITING FOR OPPONENT';
    } else if (state.opponentReady) {
      this.phasePromptElem.textContent = 'OPPONENT READY // PRESS [SPACE]';
    } else {
      this.phasePromptElem.textContent = 'PRESS [SPACE] TO READY';
    }
  }

  /** Shared 3-2-1-GO derived from the authoritative race start timestamp. */
  public setCountdown(seconds: number | null): void {
    if (seconds === null || seconds <= 0) {
      this.countdownElem.classList.add('hidden');
      this.countdownElem.textContent = '';
      return;
    }
    this.countdownElem.classList.remove('hidden');
    this.countdownElem.textContent = String(seconds);
  }

  /** Small, non-blocking notification (e.g. a rival improving their best). */
  public showNotice(text: string): void {
    this.noticeElem.textContent = text;
    this.noticeElem.classList.remove('hidden');
    if (this.noticeTimeout !== null) window.clearTimeout(this.noticeTimeout);
    this.noticeTimeout = window.setTimeout(() => this.clearNotice(), 4000);
  }

  private clearNotice(): void {
    if (this.noticeTimeout !== null) {
      window.clearTimeout(this.noticeTimeout);
      this.noticeTimeout = null;
    }
    this.noticeElem.classList.add('hidden');
    this.noticeElem.textContent = '';
  }
}
