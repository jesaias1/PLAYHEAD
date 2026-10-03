/**
 * RACE HUD — the restrained in-race overlay for an ONLINE RACE.
 *
 * Shows only what a racer needs at speed: PLACEMENT (n / total), the shared race
 * clock, the leader delta, and the OTHER racers' finish state. When the player
 * has finished it becomes a SPECTATOR HUD (who is being watched, their progress,
 * the live race clock). It never obstructs movement and never shows a blocking
 * panel during play.
 *
 * Formatting note: display is 3-decimal, but every COMPARISON uses raw
 * microsecond values from the authoritative race clock. Formatted strings are
 * never compared.
 */

export interface RaceHudRivalView {
  userId: string;
  displayName: string;
  colorIndex: number;
  finishTimeUs: number | null;
  dnf: boolean;
  checkpointIndex: number;
  checkpointTotal: number;
  connected: boolean;
}

export interface RaceHudState {
  /** Shared race clock, in microseconds since GO. */
  raceElapsedUs: number;
  /** My placement among racers (1-based); null while unknown. */
  placement: number | null;
  totalRacers: number;
  /** Delta to the current leader in us (negative = I am ahead). */
  leaderDeltaUs: number | null;
  finished: boolean;
  myFinishTimeUs: number | null;
  dnf: boolean;
  rivals: RaceHudRivalView[];
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

/** The shared race clock (MM:SS.mmm), derived from the authoritative epoch. */
export function formatRaceClock(us: number): string {
  return formatRaceTime(Math.max(0, us));
}

export class RaceHud {
  private rivalMarkup = '';
  public element: HTMLElement;

  private placementElem: HTMLElement;
  private clockElem: HTMLElement;
  private deltaElem: HTMLElement;
  private rivalsElem: HTMLElement;
  private noticeElem: HTMLElement;
  private phaseElem: HTMLElement;
  private phaseTitleElem: HTMLElement;
  private phaseLinesElem: HTMLElement;
  private phasePromptElem: HTMLElement;
  private countdownElem: HTMLElement;
  private spectateElem: HTMLElement;
  private spectateNameElem: HTMLElement;
  private spectateProgressElem: HTMLElement;
  private noticeTimeout: number | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.id = 'race-hud';
    this.element.className = 'race-hud hidden';
    this.element.innerHTML = `
      <div class="race-hud-core">
        <div class="race-hud-place">
          <span class="race-hud-place-val" id="race-place">--</span>
          <span class="race-hud-place-total" id="race-place-total">/ --</span>
        </div>
        <div class="race-hud-clock">
          <span class="race-hud-clock-label">RACE</span>
          <span class="race-hud-clock-val" id="race-clock">00:00.000</span>
        </div>
        <div class="race-hud-delta" id="race-delta"></div>
      </div>

      <div class="race-hud-rivals" id="race-rivals"></div>

      <div class="race-hud-spectate hidden" id="race-spectate">
        <div class="race-hud-spectate-label">SPECTATING</div>
        <div class="race-hud-spectate-name" id="race-spectate-name">--</div>
        <div class="race-hud-spectate-progress" id="race-spectate-progress"></div>
        <div class="race-hud-spectate-hint">[ \u2190 / \u2192 ] PREV / NEXT RACER</div>
      </div>

      <div class="race-hud-notice hidden" id="race-notice"></div>

      <div class="race-hud-phase hidden" id="race-phase">
        <div class="race-phase-title" id="race-phase-title">SIGNAL CHECK</div>
        <div class="race-phase-lines" id="race-phase-lines"></div>
        <div class="race-phase-prompt" id="race-phase-prompt">PRESS [SPACE] TO READY</div>
      </div>
      <div class="race-hud-countdown hidden" id="race-countdown">3</div>
    `;

    this.placementElem = this.element.querySelector('#race-place') as HTMLElement;
    this.clockElem = this.element.querySelector('#race-clock') as HTMLElement;
    this.deltaElem = this.element.querySelector('#race-delta') as HTMLElement;
    this.rivalsElem = this.element.querySelector('#race-rivals') as HTMLElement;
    this.noticeElem = this.element.querySelector('#race-notice') as HTMLElement;
    this.phaseElem = this.element.querySelector('#race-phase') as HTMLElement;
    this.phaseTitleElem = this.element.querySelector('#race-phase-title') as HTMLElement;
    this.phaseLinesElem = this.element.querySelector('#race-phase-lines') as HTMLElement;
    this.phasePromptElem = this.element.querySelector('#race-phase-prompt') as HTMLElement;
    this.countdownElem = this.element.querySelector('#race-countdown') as HTMLElement;
    this.spectateElem = this.element.querySelector('#race-spectate') as HTMLElement;
    this.spectateNameElem = this.element.querySelector('#race-spectate-name') as HTMLElement;
    this.spectateProgressElem = this.element.querySelector(
      '#race-spectate-progress'
    ) as HTMLElement;
  }

  public show(): void {
    this.element.classList.remove('hidden');
  }

  public hide(): void {
    this.element.classList.add('hidden');
    this.clearNotice();
  }

  public update(state: RaceHudState): void {
    this.clockElem.textContent = formatRaceClock(state.raceElapsedUs);
    this.placementElem.textContent = state.placement === null ? '--' : String(state.placement);
    const total = this.element.querySelector('#race-place-total') as HTMLElement;
    total.textContent = `/ ${state.totalRacers}`;

    if (state.finished) {
      this.deltaElem.textContent =
        state.myFinishTimeUs !== null ? `FINISHED ${formatRaceTime(state.myFinishTimeUs)}` : 'FINISHED';
      this.deltaElem.classList.add('race-hud-delta-done');
    } else if (state.dnf) {
      this.deltaElem.textContent = 'DNF';
      this.deltaElem.classList.add('race-hud-delta-done');
    } else {
      this.deltaElem.classList.remove('race-hud-delta-done');
      if (state.leaderDeltaUs === null) {
        this.deltaElem.textContent = '';
      } else if (state.leaderDeltaUs === 0) {
        this.deltaElem.textContent = 'LEAD';
      } else if (state.leaderDeltaUs < 0) {
        this.deltaElem.textContent = `LEAD ${formatRaceTime(-state.leaderDeltaUs)}`;
      } else {
        this.deltaElem.textContent = `+${formatRaceTime(state.leaderDeltaUs)} TO LEADER`;
      }
    }

    // Rivals: small one-line rows, ordered as received (already placement order
    // from the game). Rebuilt only when a racer actually changes state.
    const markup = state.rivals
      .map((r) => {
        const stateText = r.dnf
          ? 'DNF'
          : r.finishTimeUs !== null
            ? `FIN ${formatRaceTime(r.finishTimeUs)}`
            : `CP ${r.checkpointIndex}/${r.checkpointTotal}`;
        const cls = r.dnf
          ? 'race-rival-dnf'
          : r.finishTimeUs !== null
            ? 'race-rival-done'
            : '';
        return (
          `<div class="race-hud-rival ${cls}" data-color="${r.colorIndex}">` +
          `<span class="race-hud-rival-dot"></span>` +
          `<span class="race-hud-rival-name">${this.escape(r.displayName)}</span>` +
          `<span class="race-hud-rival-state">${stateText}</span>` +
          `</div>`
        );
      })
      .join('');
    if (markup !== this.rivalMarkup) {
      this.rivalMarkup = markup;
      this.rivalsElem.innerHTML = markup;
    }
  }

  /**
   * In-game WAITING / READY stage. The countdown does not begin until EVERY
   * racer is ready; this makes the readiness set explicit for the local player.
   */
  public setPhase(state: {
    phase: 'WAITING' | 'READY' | 'COUNTDOWN' | 'RACING' | 'FINISHED';
    title: string;
    lines: { label: string; ready: boolean }[];
    prompt: string;
  }): void {
    if (state.phase === 'RACING' || state.phase === 'FINISHED') {
      this.phaseElem.classList.add('hidden');
      return;
    }
    this.phaseElem.classList.remove('hidden');
    this.phaseTitleElem.textContent = state.title;
    this.phaseLinesElem.innerHTML = state.lines
      .slice(0, 8)
      .map(
        (l) =>
          `<div class="race-phase-line${l.ready ? ' race-phase-ready' : ''}">` +
          `${this.escape(l.label)}</div>`
      )
      .join('');
    this.phasePromptElem.textContent = state.prompt;
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

  /** Post-finish spectator view. Pass null to hide. */
  public setSpectating(info: { name: string; checkpointIndex: number; checkpointTotal: number } | null): void {
    if (!info) {
      this.spectateElem.classList.add('hidden');
      return;
    }
    this.spectateElem.classList.remove('hidden');
    this.spectateNameElem.textContent = info.name.toUpperCase();
    this.spectateProgressElem.textContent =
      info.checkpointTotal > 0 ? `CHECKPOINT ${info.checkpointIndex} / ${info.checkpointTotal}` : '';
  }

  /** Small, non-blocking notification (e.g. a racer improving, joining). */
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

  private escape(value: string): string {
    return value.replace(/[&<>"']/g, (c) =>
      c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
    );
  }
}
