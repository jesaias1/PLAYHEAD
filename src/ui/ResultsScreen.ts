/**
 * Results screen showing run metrics, typographic rank, and personal bests
 * "Editorial Graphic Design": Staged quick reveal over the completed world.
 */

import { RunRank, RunResults } from '../player/PlayerStats';
import { formatSpeed, formatTime } from '../utils/math';
import { seedToHex } from '../utils/hash';
import { KarambitSkinSystem } from '../viewmodel/KarambitSkinSystem';

export class ResultsScreen {
  public element: HTMLElement;
  private trackTitleElem: HTMLElement;
  private rankElem: HTMLElement;
  private rankSubElem: HTMLElement;

  private timeElem: HTMLElement;
  private targetElem: HTMLElement;
  private syncElem: HTMLElement;
  private maxSpeedElem: HTMLElement;
  private avgSpeedElem: HTMLElement;
  private strafeEffElem: HTMLElement;
  private fallsElem: HTMLElement;
  private scoreElem: HTMLElement;
  private rivalElem: HTMLElement;

  private statsGrid: HTMLElement;
  private actionsRow: HTMLElement;
  private signalDropPanel: HTMLElement;
  private signalDropStatus: HTMLElement;
  private signalDropReward: HTMLElement;
  private signalDropCount: HTMLElement;
  private signalDropOpenBtn: HTMLButtonElement;

  private replayBtn: HTMLButtonElement;
  private againBtn: HTMLButtonElement;
  private newTrackBtn: HTMLButtonElement;

  private onReplayCallback?: () => void;
  private onAgainCallback?: () => void;
  private onNewTrackCallback?: () => void;

  private revealTimeouts: number[] = [];

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'screen results-screen hidden';
    this.element.innerHTML = `
      <div class="results-container">
        <div class="results-header" id="res-header">
          <div class="results-title-group">
            <h1 class="results-title">RUN COMPLETE</h1>
            <div class="results-track-title" id="res-track-title">PLAYHEAD TRACK</div>
          </div>
          <div class="rank-group" id="res-rank-group">
            <div class="rank-badge" id="res-rank">GOLD</div>
            <div class="rank-tier-sub" id="res-rank-sub">// TIER III ACHIEVED</div>
          </div>
        </div>

        <div class="results-grid" id="res-grid">
          <div class="stat-card">
            <div class="stat-label">COMPLETION TIME</div>
            <div class="stat-value" id="res-time">00:00.000</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">TARGET TIME</div>
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
            <div class="stat-label">FALL COUNT</div>
            <div class="stat-value" id="res-falls">0</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">TOTAL SCORE</div>
            <div class="stat-value" id="res-score">0</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">VS THE ECHO</div>
            <div class="stat-value" id="res-rival">—</div>
          </div>
        </div>

        <div class="signal-drop-panel hidden" id="res-signal-drop" aria-live="polite">
          <div class="signal-drop-copy">
            <div class="signal-drop-kicker" id="res-signal-drop-status">SIGNAL ACQUIRED</div>
            <div class="signal-drop-reward" id="res-signal-drop-reward">DIAMOND PACKET READY</div>
            <div class="signal-drop-count" id="res-signal-drop-count">01 STORED SIGNAL</div>
          </div>
          <button class="btn-preview signal-drop-open" id="btn-res-signal-drop">DECODE SIGNAL</button>
        </div>

        <div class="results-actions" id="res-actions">
          <button class="btn-hero" id="btn-res-again">RUN AGAIN</button>
          <button class="btn-preview" id="btn-res-replay">REPLAY RUN</button>
          <button class="btn-preview" id="btn-res-new">NEW TRACK</button>
        </div>
      </div>
    `;

    this.trackTitleElem = this.element.querySelector('#res-track-title') as HTMLElement;
    this.rankElem = this.element.querySelector('#res-rank') as HTMLElement;
    this.rankSubElem = this.element.querySelector('#res-rank-sub') as HTMLElement;

    this.timeElem = this.element.querySelector('#res-time') as HTMLElement;
    this.targetElem = this.element.querySelector('#res-target') as HTMLElement;
    this.syncElem = this.element.querySelector('#res-sync') as HTMLElement;
    this.maxSpeedElem = this.element.querySelector('#res-max-speed') as HTMLElement;
    this.avgSpeedElem = this.element.querySelector('#res-avg-speed') as HTMLElement;
    this.strafeEffElem = this.element.querySelector('#res-strafe') as HTMLElement;
    this.fallsElem = this.element.querySelector('#res-falls') as HTMLElement;
    this.scoreElem = this.element.querySelector('#res-score') as HTMLElement;
    this.rivalElem = this.element.querySelector('#res-rival') as HTMLElement;

    this.statsGrid = this.element.querySelector('#res-grid') as HTMLElement;
    this.actionsRow = this.element.querySelector('#res-actions') as HTMLElement;
    this.signalDropPanel = this.element.querySelector('#res-signal-drop') as HTMLElement;
    this.signalDropStatus = this.element.querySelector('#res-signal-drop-status') as HTMLElement;
    this.signalDropReward = this.element.querySelector('#res-signal-drop-reward') as HTMLElement;
    this.signalDropCount = this.element.querySelector('#res-signal-drop-count') as HTMLElement;
    this.signalDropOpenBtn = this.element.querySelector('#btn-res-signal-drop') as HTMLButtonElement;

    this.againBtn = this.element.querySelector('#btn-res-again') as HTMLButtonElement;
    this.replayBtn = this.element.querySelector('#btn-res-replay') as HTMLButtonElement;
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

  public showResults(
    results: RunResults,
    seed: number,
    ghostInfo?: { rivalDelta?: number; isNewPB?: boolean },
    trackTitle = 'PLAYHEAD TRACK',
    overtimeInfo?: { isOvertime: boolean; overtimeDuration: number },
    progressionInfo?: { dropsAwarded: number; bestDropRank?: RunRank }
  ): void {
    this.clearTimeouts();

    this.trackTitleElem.textContent = trackTitle.toUpperCase();

    // Format Typographic Rank & Overtime State
    if (overtimeInfo?.isOvertime) {
      this.rankElem.textContent = 'UNRANKED';
      this.rankElem.className = 'rank-badge rank-unranked';
      this.rankSubElem.textContent = '// TRACK SIGNAL EXPIRED // OVERTIME';
      this.syncElem.textContent = `OVERTIME +${overtimeInfo.overtimeDuration.toFixed(2)}s`;
      this.syncElem.style.color = '#f59e0b';
    } else {
      const rank = results.rank.toUpperCase();
      this.rankElem.textContent = rank;
      this.rankElem.className = `rank-badge rank-${rank.toLowerCase()}`;

      switch (rank) {
        case 'DIAMOND':
          this.rankSubElem.textContent = '// TIER IV · OPTIMAL TRAVERSAL';
          break;
        case 'GOLD':
          this.rankSubElem.textContent = '// TIER III · HIGH VELOCITY';
          break;
        case 'SILVER':
          this.rankSubElem.textContent = '// TIER II · SOUND EXECUTION';
          break;
        case 'BRONZE':
        default:
          this.rankSubElem.textContent = '// TIER I · COURSE COMPLETED';
          break;
      }

      const sign = results.syncDelta >= 0 ? '+' : '-';
      this.syncElem.textContent = `${sign}${Math.abs(results.syncDelta).toFixed(2)}s`;
      this.syncElem.style.color = '';

      // Save Personal Best on valid ranked runs
      this.savePersonalBest(seed, results);
    }

    this.timeElem.textContent = formatTime(results.completionTime);
    this.targetElem.textContent = formatTime(results.targetTime);

    this.maxSpeedElem.textContent = `${formatSpeed(results.maxSpeed)} u/s`;
    this.avgSpeedElem.textContent = `${formatSpeed(results.averageSpeed)} u/s`;
    this.strafeEffElem.textContent = results.strafeEfficiency >= 0 ? `${results.strafeEfficiency}%` : '—';
    this.fallsElem.textContent = `${results.fallsCount}`;
    this.scoreElem.textContent = results.score.toLocaleString();
    this.prepareSignalDropPanel(progressionInfo?.dropsAwarded ?? 0, progressionInfo?.bestDropRank);

    // Temporal Rival & Ghost Info
    if (ghostInfo?.rivalDelta !== undefined) {
      const rSign = ghostInfo.rivalDelta < 0 ? '▲ -' : '▼ +';
      this.rivalElem.textContent = `${rSign}${Math.abs(ghostInfo.rivalDelta).toFixed(2)}s`;
      this.rivalElem.style.color = ghostInfo.rivalDelta < 0 ? '#00ff88' : '#ff3366';
    } else {
      this.rivalElem.textContent = '—';
      this.rivalElem.style.color = 'var(--text-primary)';
    }

    // Staged Quick Reveal Sequence (Total ~700ms)
    this.element.classList.remove('hidden');

    const rankGroup = this.element.querySelector('#res-rank-group') as HTMLElement;
    rankGroup.style.opacity = '0';
    this.statsGrid.style.opacity = '0';
    this.actionsRow.style.opacity = '0';

    // Step 1 (180ms): Stats grid slides in
    this.revealTimeouts.push(window.setTimeout(() => {
      this.statsGrid.style.transition = 'opacity var(--motion-normal)';
      this.statsGrid.style.opacity = '1';
    }, 180));

    // Step 2 (440ms): Typographic rank reveals
    this.revealTimeouts.push(window.setTimeout(() => {
      rankGroup.style.transition = 'opacity var(--motion-normal)';
      rankGroup.style.opacity = '1';
    }, 440));

    // Step 3 (660ms): Actions row appears and focuses
    this.revealTimeouts.push(window.setTimeout(() => {
      this.actionsRow.style.transition = 'opacity var(--motion-normal)';
      this.actionsRow.style.opacity = '1';
      if ((progressionInfo?.dropsAwarded ?? 0) > 0 && KarambitSkinSystem.getInstance().getPendingDropCount() > 0) {
        this.signalDropOpenBtn.focus();
      } else {
        this.againBtn.focus();
      }
    }, 660));
  }

  private prepareSignalDropPanel(newlyAwardedCount: number, bestDropRank?: RunRank): void {
    const skinSystem = KarambitSkinSystem.getInstance();
    const pending = skinSystem.getPendingDropCount();
    this.signalDropPanel.className = 'signal-drop-panel';
    if (pending <= 0) {
      this.signalDropPanel.classList.add('hidden');
      return;
    }

    this.signalDropStatus.textContent = newlyAwardedCount > 0
      ? `${newlyAwardedCount.toString().padStart(2, '0')} SIGNAL${newlyAwardedCount === 1 ? '' : 'S'} ACQUIRED`
      : 'STORED SIGNAL READY';
    this.signalDropReward.textContent = newlyAwardedCount > 0
      ? (bestDropRank === 'DIAMOND' ? 'PRISTINE SIGNAL DROP INCLUDED' : `${bestDropRank ?? 'RANK'} THRESHOLD PACKET RECEIVED`)
      : 'UNDECODED ARMORY PACKET';
    this.signalDropCount.textContent = `${pending.toString().padStart(2, '0')} STORED SIGNAL${pending === 1 ? '' : 'S'}`;
    this.signalDropOpenBtn.textContent = 'DECODE SIGNAL';
    this.signalDropOpenBtn.disabled = false;
  }

  private openSignalDrop(): void {
    const skinSystem = KarambitSkinSystem.getInstance();
    const reward = skinSystem.openSignalDrop();
    if (!reward) {
      this.prepareSignalDropPanel(0);
      return;
    }

    this.signalDropOpenBtn.disabled = true;
    this.signalDropPanel.classList.add('decoding');
    this.signalDropStatus.textContent = 'DECODING...';
    this.signalDropReward.textContent = '/// SIGNAL INTERFERENCE ///';

    this.revealTimeouts.push(window.setTimeout(() => {
      this.signalDropPanel.classList.remove('decoding');
      this.signalDropPanel.classList.add(`rarity-${reward.skin.rarity.toLowerCase()}`);
      this.signalDropStatus.textContent = `${reward.qualityLabel} // ${reward.skin.rarity} FOUND`;
      this.signalDropReward.textContent = reward.skin.name;
      const pending = skinSystem.getPendingDropCount();
      this.signalDropCount.textContent = `${pending.toString().padStart(2, '0')} SIGNAL${pending === 1 ? '' : 'S'} REMAINING`;
      if (pending > 0) {
        this.signalDropOpenBtn.textContent = 'DECODE NEXT SIGNAL';
        this.signalDropOpenBtn.disabled = false;
      } else {
        this.signalDropOpenBtn.textContent = 'SIGNAL ARCHIVED';
      }
    }, 320));
  }

  public hide(): void {
    this.clearTimeouts();
    this.element.classList.add('hidden');
  }

  private clearTimeouts(): void {
    for (const t of this.revealTimeouts) {
      clearTimeout(t);
    }
    this.revealTimeouts = [];
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
    this.againBtn.addEventListener('click', () => this.onAgainCallback?.());
    this.replayBtn.addEventListener('click', () => this.onReplayCallback?.());
    this.newTrackBtn.addEventListener('click', () => this.onNewTrackCallback?.());
    this.signalDropOpenBtn.addEventListener('click', () => this.openSignalDrop());
  }
}
