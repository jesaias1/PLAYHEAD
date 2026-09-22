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
    `;

    this.clockElem = this.element.querySelector('#race-clock') as HTMLElement;
    this.youRunElem = this.element.querySelector('#race-you-run') as HTMLElement;
    this.youBestElem = this.element.querySelector('#race-you-best') as HTMLElement;
    this.youAttemptElem = this.element.querySelector('#race-you-attempt') as HTMLElement;
    this.rivalRowElem = this.element.querySelector('#race-rival-row') as HTMLElement;
    this.rivalNameElem = this.element.querySelector('#race-rival-name') as HTMLElement;
    this.rivalBestElem = this.element.querySelector('#race-rival-best') as HTMLElement;
    this.noticeElem = this.element.querySelector('#race-notice') as HTMLElement;
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
