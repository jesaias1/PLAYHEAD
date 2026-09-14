/**
 * Results screen showing run metrics, rank, and local personal bests
 */

import { RunResults } from '../player/PlayerStats';
import { formatSpeed, formatTime } from '../utils/math';
import { seedToHex } from '../utils/hash';

export class ResultsScreen {
  public element: HTMLElement;
  private rankElem: HTMLElement;
  private timeElem: HTMLElement;
  private targetElem: HTMLElement;
  private syncElem: HTMLElement;
  private maxSpeedElem: HTMLElement;
  private avgSpeedElem: HTMLElement;
  private strafeEffElem: HTMLElement;
  private fallsElem: HTMLElement;
  private scoreElem: HTMLElement;

  private replayBtn: HTMLButtonElement;
  private againBtn: HTMLButtonElement;
  private newTrackBtn: HTMLButtonElement;

  private onReplayCallback?: () => void;
  private onAgainCallback?: () => void;
  private onNewTrackCallback?: () => void;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'screen results-screen hidden';
    this.element.innerHTML = `
      <div class="results-container">
        <div class="results-header">
          <h2 class="results-title">TRACK COMPLETE</h2>
          <div class="rank-badge" id="res-rank">GOLD</div>
        </div>

        <div class="results-grid">
          <div class="stat-card">
            <div class="stat-label">TIME</div>
            <div class="stat-value" id="res-time">00:00.000</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">TARGET</div>
            <div class="stat-value" id="res-target">00:00.000</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">SYNC DELTA</div>
            <div class="stat-value" id="res-sync">+0.00s</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">MAX SPEED</div>
            <div class="stat-value" id="res-max-speed">0 u/s</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">AVERAGE SPEED</div>
            <div class="stat-value" id="res-avg-speed">0 u/s</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">STRAFE EFFICIENCY</div>
            <div class="stat-value" id="res-strafe">0%</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">FALLS</div>
            <div class="stat-value" id="res-falls">0</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">TOTAL SCORE</div>
            <div class="stat-value" id="res-score">0</div>
          </div>
        </div>

        <div class="results-actions">
          <button class="primary" id="btn-res-replay">REPLAY RUN</button>
          <button class="secondary" id="btn-res-again">RUN AGAIN</button>
          <button class="secondary" id="btn-res-new">NEW TRACK</button>
        </div>
      </div>
    `;

    this.rankElem = this.element.querySelector('#res-rank') as HTMLElement;
    this.timeElem = this.element.querySelector('#res-time') as HTMLElement;
    this.targetElem = this.element.querySelector('#res-target') as HTMLElement;
    this.syncElem = this.element.querySelector('#res-sync') as HTMLElement;
    this.maxSpeedElem = this.element.querySelector('#res-max-speed') as HTMLElement;
    this.avgSpeedElem = this.element.querySelector('#res-avg-speed') as HTMLElement;
    this.strafeEffElem = this.element.querySelector('#res-strafe') as HTMLElement;
    this.fallsElem = this.element.querySelector('#res-falls') as HTMLElement;
    this.scoreElem = this.element.querySelector('#res-score') as HTMLElement;

    this.replayBtn = this.element.querySelector('#btn-res-replay') as HTMLButtonElement;
    this.againBtn = this.element.querySelector('#btn-res-again') as HTMLButtonElement;
    this.newTrackBtn = this.element.querySelector('#btn-res-new') as HTMLButtonElement;

    this.initEvents();
  }

  public setCallbacks(callbacks: {
    onReplay: () => void;
    onAgain: () => void;
    onNewTrack: () => void;
  }): void {
    this.onReplayCallback = callbacks.onReplay;
    this.onAgainCallback = callbacks.onAgain;
    this.onNewTrackCallback = callbacks.onNewTrack;
  }

  public showResults(results: RunResults, seed: number): void {
    this.rankElem.textContent = results.rank;
    this.timeElem.textContent = formatTime(results.completionTime);
    this.targetElem.textContent = formatTime(results.targetTime);

    const sign = results.syncDelta >= 0 ? '+' : '-';
    this.syncElem.textContent = `${sign}${Math.abs(results.syncDelta).toFixed(2)}s`;

    this.maxSpeedElem.textContent = `${formatSpeed(results.maxSpeed)} u/s`;
    this.avgSpeedElem.textContent = `${formatSpeed(results.averageSpeed)} u/s`;
    this.strafeEffElem.textContent = results.strafeEfficiency >= 0 ? `${results.strafeEfficiency}%` : '—';
    this.fallsElem.textContent = `${results.fallsCount}`;
    this.scoreElem.textContent = results.score.toLocaleString();

    // Check & Save Personal Best
    this.savePersonalBest(seed, results);

    this.element.classList.remove('hidden');
    this.replayBtn.focus();
  }

  public hide(): void {
    this.element.classList.add('hidden');
  }

  private savePersonalBest(seed: number, results: RunResults): void {
    try {
      const key = `trackrun_pb_${seedToHex(seed)}`;
      const prevStr = localStorage.getItem(key);
      if (prevStr) {
        const prev = JSON.parse(prevStr);
        if (results.score > prev.score) {
          localStorage.setItem(key, JSON.stringify(results));
        }
      } else {
        localStorage.setItem(key, JSON.stringify(results));
      }
    } catch {
      // Ignore localStorage issues
    }
  }

  private initEvents(): void {
    this.replayBtn.addEventListener('click', () => this.onReplayCallback?.());
    this.againBtn.addEventListener('click', () => this.onAgainCallback?.());
    this.newTrackBtn.addEventListener('click', () => this.onNewTrackCallback?.());
  }
}
