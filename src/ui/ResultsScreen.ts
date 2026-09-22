/**
 * Results screen showing run metrics, typographic rank, and personal bests
 * "Editorial Graphic Design": Staged quick reveal over the completed world.
 */

import { RunRank, RunResults } from '../player/PlayerStats';
import { formatSpeed, formatTime } from '../utils/math';
import { seedToHex } from '../utils/hash';
import { KarambitSkinSystem } from '../viewmodel/KarambitSkinSystem';
import { getUnrankedReason } from './RankResultCopy';
import { LeaderboardManager, LeaderboardSubmissionCandidate } from '../leaderboard/LeaderboardManager';

export class ResultsScreen {
  public element: HTMLElement;
  private trackTitleElem: HTMLElement;
  private rankElem: HTMLElement;
  private rankSubElem: HTMLElement;
  private pbStatusElem: HTMLElement;

  private timeElem: HTMLElement;
  private targetElem: HTMLElement;
  private syncElem: HTMLElement;
  private maxSpeedElem: HTMLElement;
  private avgSpeedElem: HTMLElement;
  private strafeEffElem: HTMLElement;
  private fallsElem: HTMLElement;
  private scoreElem: HTMLElement;
  private rivalElem: HTMLElement;
  private pbValElem: HTMLElement;
  private localFirstElem: HTMLElement;

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
  private leaderboardBtn: HTMLButtonElement;
  private leaderboardFeedbackElem: HTMLElement;
  private activeCandidate: LeaderboardSubmissionCandidate | null = null;

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
            <div class="results-kicker">[SYS] RUN REPORT // SIGNAL ARCHIVE</div>
            <h1 class="results-title">RUN REPORT</h1>
            <div class="results-track-title"><span>[SIGNAL]</span> <span id="res-track-title">PLAYHEAD TRACK</span></div>
            <div class="results-pb-status hidden" id="res-pb-status">[PB] NEW PERSONAL BEST</div>
          </div>
          <div class="rank-group" id="res-rank-group">
            <div class="rank-badge" id="res-rank">GOLD</div>
            <div class="rank-tier-sub" id="res-rank-sub">// TIER III ACHIEVED</div>
          </div>
        </div>

        <div class="results-grid" id="res-grid">
          <div class="stat-card stat-card-completion">
            <div class="stat-label">[TIME] COMPLETION</div>
            <div class="stat-value" id="res-time">00:00.000</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">[TIME] TARGET</div>
            <div class="stat-value" id="res-target">00:00.000</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">[SIGNAL] SYNC DELTA</div>
            <div class="stat-value" id="res-sync">+0.00s</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">[RECORD] PERSONAL BEST</div>
            <div class="stat-value" id="res-pb-val">—</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">[RECORD] LOCAL #1</div>
            <div class="stat-value" id="res-local-first">—</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">[GHOST] VS THE ECHO</div>
            <div class="stat-value" id="res-rival">—</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">[RUN] MAX SPEED</div>
            <div class="stat-value" id="res-max-speed">0 u/s</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">[RUN] AVERAGE SPEED</div>
            <div class="stat-value" id="res-avg-speed">0 u/s</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">[RUN] STRAFE EFFICIENCY</div>
            <div class="stat-value" id="res-strafe">0%</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">[ROUTE] FALL COUNT</div>
            <div class="stat-value" id="res-falls">0</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">[SYS] TOTAL SCORE</div>
            <div class="stat-value" id="res-score">0</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">[SYS] VERIFICATION</div>
            <div class="stat-value" id="res-verification" style="font-size: 0.72rem; color: #00f0ff;">DETERMINISTIC</div>
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

        <div class="leaderboard-feedback-bar hidden" id="res-leaderboard-feedback">
          LEADERBOARD ENTRY SAVED // ONLINE SUBMISSION COMING LATER
        </div>

        <div class="results-actions" id="res-actions">
          <button class="btn-hero" id="btn-res-again">[ RETRY ]</button>
          <button class="btn-preview hidden" id="btn-res-leaderboard">[ ADD TO LEADERBOARD ]</button>
          <button class="btn-preview" id="btn-res-replay">[ REPLAY ]</button>
          <button class="btn-preview" id="btn-res-new">[ MAIN MENU ]</button>
        </div>
      </div>
    `;

    this.trackTitleElem = this.element.querySelector('#res-track-title') as HTMLElement;
    this.rankElem = this.element.querySelector('#res-rank') as HTMLElement;
    this.rankSubElem = this.element.querySelector('#res-rank-sub') as HTMLElement;
    this.pbStatusElem = this.element.querySelector('#res-pb-status') as HTMLElement;

    this.timeElem = this.element.querySelector('#res-time') as HTMLElement;
    this.targetElem = this.element.querySelector('#res-target') as HTMLElement;
    this.syncElem = this.element.querySelector('#res-sync') as HTMLElement;
    this.maxSpeedElem = this.element.querySelector('#res-max-speed') as HTMLElement;
    this.avgSpeedElem = this.element.querySelector('#res-avg-speed') as HTMLElement;
    this.strafeEffElem = this.element.querySelector('#res-strafe') as HTMLElement;
    this.fallsElem = this.element.querySelector('#res-falls') as HTMLElement;
    this.scoreElem = this.element.querySelector('#res-score') as HTMLElement;
    this.rivalElem = this.element.querySelector('#res-rival') as HTMLElement;
    this.pbValElem = this.element.querySelector('#res-pb-val') as HTMLElement;
    this.localFirstElem = this.element.querySelector('#res-local-first') as HTMLElement;

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
    this.leaderboardBtn = this.element.querySelector('#btn-res-leaderboard') as HTMLButtonElement;
    this.leaderboardFeedbackElem = this.element.querySelector('#res-leaderboard-feedback') as HTMLElement;

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
    progressionInfo?: { dropsAwarded: number; bestDropRank?: RunRank },
    officialInfo?: {
      isOfficial: boolean;
      trackId: string;
      candidate?: LeaderboardSubmissionCandidate;
      isNewLocalFirst?: boolean;
    },
    customRewardInfo?: {
      isCustomAudio: boolean;
      eligible: boolean;
      statusMessage: string;
      reason?: 'TOO_SHORT' | 'ALREADY_CLAIMED';
    }
  ): void {
    this.clearTimeouts();

    this.trackTitleElem.textContent = trackTitle.toUpperCase();
    const isNewPersonalBest = !overtimeInfo?.isOvertime && ghostInfo?.isNewPB === true;

    // Personal Best and Local #1 Display
    const recSummary = officialInfo?.trackId
      ? LeaderboardManager.getInstance().getRecordSummary(officialInfo.trackId)
      : null;

    const pbTime = isNewPersonalBest
      ? results.completionTime
      : (recSummary?.pbTime ?? null);

    const localFirstTime = (officialInfo?.isNewLocalFirst && !overtimeInfo?.isOvertime)
      ? results.completionTime
      : (recSummary?.localFirstTime ?? null);

    this.pbValElem.textContent = pbTime !== null && pbTime !== undefined
      ? formatTime(pbTime)
      : '—';
    this.localFirstElem.textContent = localFirstTime !== null && localFirstTime !== undefined
      ? formatTime(localFirstTime)
      : '—';

    if (officialInfo?.isNewLocalFirst && !overtimeInfo?.isOvertime) {
      this.pbStatusElem.textContent = '[LOCAL #1] NEW LOCAL FIRST RECORD';
      this.pbStatusElem.classList.remove('hidden');
    } else if (isNewPersonalBest) {
      this.pbStatusElem.textContent = '[PB] NEW PERSONAL BEST';
      this.pbStatusElem.classList.remove('hidden');
    } else {
      this.pbStatusElem.classList.add('hidden');
    }

    // Format Typographic Rank & Overtime State
    if (results.rank === 'UNRANKED') {
      this.rankElem.textContent = 'UNRANKED';
      this.rankElem.className = 'rank-badge rank-unranked';
      this.rankSubElem.textContent = getUnrankedReason(results, overtimeInfo?.isOvertime === true);
      this.syncElem.textContent = overtimeInfo?.isOvertime
        ? `OVERTIME +${overtimeInfo.overtimeDuration.toFixed(2)}s`
        : `+${Math.max(0, results.syncDelta).toFixed(2)}s`;
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

      // Preserve the existing rule that overtime runs do not replace PB data.
      if (!overtimeInfo?.isOvertime) this.savePersonalBest(seed, results);
    }

    this.timeElem.textContent = formatTime(results.completionTime);
    this.targetElem.textContent = formatTime(results.targetTime);

    this.maxSpeedElem.textContent = `${formatSpeed(results.maxSpeed)} u/s`;
    this.avgSpeedElem.textContent = `${formatSpeed(results.averageSpeed)} u/s`;
    this.strafeEffElem.textContent = results.strafeEfficiency >= 0 ? `${results.strafeEfficiency}%` : '—';
    this.fallsElem.textContent = `${results.fallsCount}`;
    this.scoreElem.textContent = results.score.toLocaleString();
    this.prepareSignalDropPanel(progressionInfo?.dropsAwarded ?? 0, progressionInfo?.bestDropRank, customRewardInfo);

    // Leaderboard Action Setup
    this.activeCandidate = officialInfo?.candidate || null;
    this.leaderboardFeedbackElem.classList.add('hidden');

    if (
      officialInfo?.isOfficial &&
      this.activeCandidate &&
      results.rank !== 'UNRANKED' &&
      !overtimeInfo?.isOvertime
    ) {
      this.leaderboardBtn.classList.remove('hidden');
      const isAlreadyQueued = LeaderboardManager.getInstance().isCandidateQueued(this.activeCandidate.submissionId);
      if (isAlreadyQueued) {
        this.leaderboardBtn.textContent = '[ ENTRY SAVED ]';
        this.leaderboardBtn.disabled = true;
      } else {
        this.leaderboardBtn.textContent = '[ ADD TO LEADERBOARD ]';
        this.leaderboardBtn.disabled = false;
      }
    } else {
      this.leaderboardBtn.classList.add('hidden');
    }

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

  private prepareSignalDropPanel(
    newlyAwardedCount: number,
    bestDropRank?: RunRank,
    customRewardInfo?: {
      isCustomAudio: boolean;
      eligible: boolean;
      statusMessage: string;
      reason?: 'TOO_SHORT' | 'ALREADY_CLAIMED';
    }
  ): void {
    const skinSystem = KarambitSkinSystem.getInstance();
    const pending = skinSystem.getPendingDropCount();
    const isCollectionComplete = skinSystem.isCollectionComplete();
    this.signalDropPanel.className = 'signal-drop-panel';

    if (isCollectionComplete) {
      this.signalDropPanel.classList.remove('hidden');
      this.signalDropStatus.textContent = 'ALL SIGNALS DECODED // ARCHIVE COMPLETE';
      this.signalDropReward.textContent = '100% COSMETIC ARCHIVE UNLOCKED';
      this.signalDropCount.textContent = 'NO DUPLICATES AWARDED';
      this.signalDropOpenBtn.textContent = 'ARCHIVE COMPLETE';
      this.signalDropOpenBtn.disabled = true;
      return;
    }

    if (customRewardInfo?.isCustomAudio) {
      this.signalDropPanel.classList.remove('hidden');
      if (customRewardInfo.eligible) {
        this.signalDropStatus.textContent = 'SIGNAL ACQUIRED // 1 SIGNAL DROP';
        this.signalDropReward.textContent = 'FIRST COMPLETION SIGNAL DROP';
        this.signalDropCount.textContent = `${pending.toString().padStart(2, '0')} STORED SIGNAL${pending === 1 ? '' : 'S'}`;
        this.signalDropOpenBtn.textContent = 'DECODE SIGNAL';
        this.signalDropOpenBtn.disabled = false;
      } else if (customRewardInfo.reason === 'TOO_SHORT') {
        this.signalDropStatus.textContent = 'SIGNAL TOO SHORT // 01:00 MIN REQUIRED';
        this.signalDropReward.textContent = 'AUDIO DURATION < 60 SECONDS';
        this.signalDropCount.textContent = 'INELIGIBLE FOR SIGNAL DROP';
        this.signalDropOpenBtn.textContent = 'TOO SHORT';
        this.signalDropOpenBtn.disabled = true;
      } else {
        this.signalDropStatus.textContent = 'SIGNAL ARCHIVED // COMPLETION REWARD CLAIMED';
        this.signalDropReward.textContent = 'PREVIOUSLY CLAIMED AUDIO CONTENT';
        this.signalDropCount.textContent = 'ONE-TIME DROP PREVIOUSLY CLAIMED';
        this.signalDropOpenBtn.textContent = 'CLAIMED';
        this.signalDropOpenBtn.disabled = true;
      }
      return;
    }

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

  private decodeModal?: import('./SignalDecodeModal').SignalDecodeModal;

  public setDecodeModal(modal: import('./SignalDecodeModal').SignalDecodeModal): void {
    this.decodeModal = modal;
  }

  private openSignalDrop(): void {
    if (this.decodeModal) {
      this.decodeModal.open(() => {
        this.prepareSignalDropPanel(0);
      });
      return;
    }

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
    this.leaderboardBtn.addEventListener('click', () => {
      if (!this.activeCandidate) return;
      const queued = LeaderboardManager.getInstance().queueCandidate(this.activeCandidate);
      if (queued) {
        this.leaderboardBtn.textContent = '[ ENTRY SAVED ]';
        this.leaderboardBtn.disabled = true;
        this.leaderboardFeedbackElem.textContent = 'LEADERBOARD ENTRY SAVED // ONLINE SUBMISSION COMING LATER';
        this.leaderboardFeedbackElem.classList.remove('hidden');
      }
    });
  }
}
