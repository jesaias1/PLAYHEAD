/**
 * MOVEMENT ACADEMY — sparse terminal HUD.
 *
 * Presentation only. Every setter diffs against the last value, so a throttled
 * caller still touches the DOM only when a visible string actually changes.
 *
 * Ownership model:
 *  - A deliberate [R] RETRY / [K] SKIP restarts the lesson, so a transient
 *    miss must NOT be called "FAILED".
 *  - An AUTOMATIC void restore (the player fell) is reported explicitly as
 *    [R] RETRY. A missed jump on a forward course is therefore retried with R,
 *    never with a key the player may not have been taught yet.
 */

import {
  ACADEMY_LESSON_ORDER,
  ACADEMY_LESSON_SHORT,
  ACADEMY_LESSON_TITLES,
  LessonId,
  LessonProgress,
  ProgressSnapshot
} from './MovementAcademyProgress';
import { SettingsManager } from '../core/Settings';

export interface AcademyHudState {
  speedUnits: number;
  progress: ProgressSnapshot;
  active: LessonId;
  skipped: boolean;
  /** An automatic void restore just happened: tell the player to press R. */
  voidRestored?: boolean;
  complete: boolean;
  sessionFinished: boolean;
  demonstrated?: boolean;
}

export interface AcademyHudControlCallbacks {
  onRetry: () => void;
  onSkip: () => void;
  onExit: () => void;
  onSelect: (index: number) => void;
  onSignalPack: () => void;
  onMovementLab: () => void;
  onReplay: () => void;
}

export type AcademyHudInput = {
  element: HTMLElement;
  setControlCallbacks(cb: AcademyHudControlCallbacks): void;
  show(): void;
  hide(): void;
  destroy(): void;
  update(state: AcademyHudState): void;
};

const OBJECTIVES: Record<LessonId, string[]> = {
  MOVEMENT: ['[MOVE] WASD', '[LOOK] MOUSE', '[JUMP] SPACE', 'JUMP THE PIT -> PAD'],
  AIR_STRAFE: ['[AIR] JUMP, RELEASE W', 'A + TURN LEFT / D + TURN RIGHT', 'TURN SMOOTHLY -> LAND ON THE PAD'],
  BHOP: ['[BHOP] LAND -> JUMP AGAIN', 'A/D + SMOOTH MOUSE TURN IN AIR', 'PRESERVE YOUR SPEED'],
  SURF: ['[SURF] RUN TO THE AMBER EDGE', 'RELEASE W - HOLD A INTO THE BRIGHT FACE', 'AIM AHEAD -> EXIT WITH SPEED'],
  FLOW: ['USE EVERYTHING YOU LEARNED', 'JUMP + STRAFE + SURF', 'REACH THE EXIT']
};

const PROGRESS_LABEL: Record<LessonProgress, string> = {
  LOCKED: '--',
  ACTIVE: 'ACTIVE',
  COMPLETE: 'COMPLETE',
  SKIPPED: 'SKIPPED'
};

export class MovementAcademyHUD implements AcademyHudInput {
  public element: HTMLElement;
  private titleElem: HTMLElement;
  private objectiveElem: HTMLElement;
  private speedElem: HTMLElement;
  private statusElem: HTMLElement;
  private progressElem: HTMLElement;
  private buttonsElem: HTMLElement;
  private last: Record<string, string> = {};
  private lastComplete = false;

  constructor() {
    this.element = document.createElement('div');
    this.element.id = 'movement-academy-hud';
    this.element.innerHTML = `
      <div class="academy-panel">
        <div class="academy-header">MOVEMENT ACADEMY</div>
        <div class="academy-lesson" id="academy-lesson">01 // MOVEMENT</div>
        <div class="academy-objective" id="academy-objective"></div>
        <div class="academy-speed" id="academy-speed">SPEED // 0 u/s</div>
        <div class="academy-status" id="academy-status">--</div>
        <div class="academy-progress" id="academy-progress"></div>
        <div class="academy-buttons" id="academy-buttons">
          <button class="academy-btn" id="academy-btn-retry" type="button">[R] RETRY</button>
          <button class="academy-btn" id="academy-btn-skip" type="button">[K] SKIP</button>
          <button class="academy-btn" id="academy-btn-exit" type="button" title="Exit Academy to the menu">[X] EXIT</button>
          <button class="academy-btn" id="academy-btn-pack" type="button">[ENTER] SIGNAL PACK</button>
          <button class="academy-btn" id="academy-btn-lab" type="button">[L] MOVEMENT LAB</button>
          <button class="academy-btn" id="academy-btn-replay" type="button">[T] REPLAY ACADEMY</button>
        </div>
        <div class="academy-select" id="academy-select"></div>
        <div class="academy-controls" id="academy-controls">WASD MOVE - MOUSE LOOK - SPACE JUMP - ESC PAUSE<br>[R] RETRY - [K] SKIP - [1-5] LESSON - [X] EXIT</div>
      </div>`;
    this.titleElem = this.element.querySelector('#academy-lesson') as HTMLElement;
    this.objectiveElem = this.element.querySelector('#academy-objective') as HTMLElement;
    this.speedElem = this.element.querySelector('#academy-speed') as HTMLElement;
    this.statusElem = this.element.querySelector('#academy-status') as HTMLElement;
    this.progressElem = this.element.querySelector('#academy-progress') as HTMLElement;
    this.buttonsElem = this.element.querySelector('#academy-buttons') as HTMLElement;
  }


  public setControlCallbacks(cb: AcademyHudControlCallbacks): void {
    (this.element.querySelector('#academy-btn-retry') as HTMLButtonElement | null)?.addEventListener('click', cb.onRetry);
    (this.element.querySelector('#academy-btn-skip') as HTMLButtonElement | null)?.addEventListener('click', cb.onSkip);
    (this.element.querySelector('#academy-btn-exit') as HTMLButtonElement | null)?.addEventListener('click', cb.onExit);
    (this.element.querySelector('#academy-btn-pack') as HTMLButtonElement | null)?.addEventListener('click', cb.onSignalPack);
    (this.element.querySelector('#academy-btn-lab') as HTMLButtonElement | null)?.addEventListener('click', cb.onMovementLab);
    (this.element.querySelector('#academy-btn-replay') as HTMLButtonElement | null)?.addEventListener('click', cb.onReplay);
    this.buildLessonButtons(cb);
  }

  /** One button per lesson, created eagerly so keyboard and pointer share it. */
  private buildLessonButtons(cb: AcademyHudControlCallbacks): void {
    const select = this.element.querySelector('#academy-select') as HTMLElement | null;
    if (!select) return;
    select.innerHTML = '';
    ACADEMY_LESSON_ORDER.forEach((id, index) => {
      const button = document.createElement('button');
      button.className = 'academy-btn academy-btn-lesson';
      button.type = 'button';
      button.id = `academy-lesson-${index}`;
      button.textContent = `${index + 1} ${ACADEMY_LESSON_SHORT[id]}`;
      button.addEventListener('click', () => cb.onSelect(index));
      select.appendChild(button);
    });
  }

  public show(): void { this.element.style.display = 'flex'; }
  public hide(): void { this.element.style.display = 'none'; }
  public destroy(): void { this.element.parentElement?.removeChild(this.element); }

  private set(node: HTMLElement, key: string, text: string, className?: string): void {
    if (this.last[key] !== text) {
      node.textContent = text;
      this.last[key] = text;
    }
    if (className !== undefined && node.className !== className) {
      node.className = className;
    }
  }

  public update(state: AcademyHudState): void {
    const id = state.active;
    const packButton = this.element.querySelector('#academy-btn-pack') as HTMLElement;
    packButton.style.display = state.complete || state.sessionFinished ? '' : 'none';
    for (const selector of ['#academy-btn-lab', '#academy-btn-replay']) {
      (this.element.querySelector(selector) as HTMLElement).style.display = packButton.style.display;
    }

    // -------- COMPLETE (every lesson honestly completed) --------
    if (state.complete) {
      if (!this.lastComplete) {
        this.lastComplete = true;
        if (this.buttonsElem) this.buttonsElem.style.display = 'flex';
      }
      this.set(this.titleElem, 'lesson', 'MOVEMENT ACADEMY COMPLETE', 'academy-lesson complete');
      this.set(this.objectiveElem, 'objective', 'MOVEMENT SYSTEM // ONLINE\nCHOOSE YOUR NEXT RUN', 'academy-objective complete');
      this.set(this.speedElem, 'speed', '', 'academy-speed hidden');
      this.set(this.statusElem, 'status', 'ACADEMY COMPLETE', 'academy-status complete');
      this.set(this.progressElem, 'progress', this.renderProgress(state.progress), 'academy-progress');
      this.setLessonButtonLabels(state.progress);
      return;
    }
    this.lastComplete = false;
    if (this.buttonsElem) this.buttonsElem.style.display = 'flex';

    // -------- SESSION FINISHED (FLOW skipped) --------
    if (state.sessionFinished) {
      this.set(this.titleElem, 'lesson', 'MOVEMENT ACADEMY', 'academy-lesson');
      this.set(this.objectiveElem, 'objective', 'SESSION FINISHED\nCOMPLETE SKIPPED LESSONS TO CLEAR ACADEMY', 'academy-objective');
      this.set(this.speedElem, 'speed', '', 'academy-speed hidden');
      this.set(this.statusElem, 'status', state.skipped ? 'FLOW SKIPPED // SESSION DONE' : 'SESSION DONE', state.skipped ? 'academy-status skipped' : 'academy-status');
      this.set(this.progressElem, 'progress', this.renderProgress(state.progress), 'academy-progress');
      this.setLessonButtonLabels(state.progress);
      return;
    }

    // -------- LIVE LESSON --------
    this.set(this.titleElem, 'lesson', ACADEMY_LESSON_TITLES[id], 'academy-lesson');
    this.set(this.speedElem, 'speed', `SPEED // ${Math.round(state.speedUnits)} u/s`, 'academy-speed');

    let status = '--';
    let statusClass = 'academy-status';
    if (state.voidRestored) {
      status = 'RESTORED // TRY AGAIN';
      statusClass = 'academy-status warn';
    } else if (state.skipped) {
      status = 'SKIPPED // NOT COUNTED';
      statusClass = 'academy-status skipped';
    } else if (state.demonstrated) {
      status = id === 'BHOP' ? 'GOOD // MOMENTUM HELD' : 'GOOD // REACH THE EXIT';
      statusClass = 'academy-status good';
    }
    this.set(this.statusElem, 'status', status, statusClass);

    const guidance = id === 'BHOP'
      ? [SettingsManager.getInstance().settings.holdToBhop ? '[BHOP] HOLD SPACE TO CHAIN' : '[BHOP] LAND -> TAP SPACE', ...OBJECTIVES[id].slice(1)]
      : OBJECTIVES[id];
    this.set(this.objectiveElem, 'objective', state.demonstrated ? 'ACTION CONFIRMED -> REACH THE PAD' : guidance.join('\n'), 'academy-objective');
    this.set(this.progressElem, 'progress', this.renderProgress(state.progress), 'academy-progress');
    this.setLessonButtonLabels(state.progress);
  }

  private setLessonButtonLabels(progress: ProgressSnapshot): void {
    for (let i = 0; i < ACADEMY_LESSON_ORDER.length; i++) {
      const id = ACADEMY_LESSON_ORDER[i];
      const button = this.element.querySelector(`#academy-lesson-${i}`) as HTMLButtonElement | null;
      if (!button) continue;
      const done = progress.lessons[id] === 'COMPLETE';
      const active = progress.active === id;
      this.set(button, `lesson-button-${i}`, `${i + 1} ${ACADEMY_LESSON_SHORT[id]}${done ? ' *' : ''}`,
        `academy-btn academy-btn-lesson${active ? ' active' : ''}${done ? ' done' : ''}`);
    }
  }

  /** Terminal-brief lesson list (one short row per lesson). */
  private renderProgress(progress: ProgressSnapshot): string {
    const completed = ACADEMY_LESSON_ORDER.filter(id => progress.lessons[id] === 'COMPLETE');
    const skipped = ACADEMY_LESSON_ORDER.filter(id => progress.lessons[id] === 'SKIPPED');
    const numbers = (ids: LessonId[]) => ids.map(id => ACADEMY_LESSON_ORDER.indexOf(id) + 1).join(' / ') || '--';
    return `${completed.length}/5 COMPLETE // ${PROGRESS_LABEL[progress.lessons[progress.active]]}\nCLEARED: ${numbers(completed)}   SKIPPED: ${numbers(skipped)}`;
  }
}
