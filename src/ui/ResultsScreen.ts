/**
 * Results screen showing run metrics, typographic rank, and personal bests
 * "Editorial Graphic Design": Staged quick reveal over the completed world.
 */

import { RunRank, RunResults } from '../player/PlayerStats';
import { formatSpeed, formatTime } from '../utils/math';
import { seedToHex } from '../utils/hash';
import { KarambitSkinSystem } from '../viewmodel/KarambitSkinSystem';
import { getUnrankedReason } from './RankResultCopy';
import {
  SUBMISSION_FEEDBACK_TEXT,
  SubmissionFeedback,
  SubmissionState,
  isRetryableSubmission
} from '../leaderboard/SubmissionFeedback';
import {
  MasteryGloveId,
  MasteryProgressDelta,
  getMasteryGlove
} from '../mastery/MasteryLadder';
import { masteryGloveSystem } from '../mastery/MasteryGloveSystem';
import { cosmeticKindLabel } from '../viewmodel/CosmeticDrop';
import { LeaderboardManager, LeaderboardSubmissionCandidate } from '../leaderboard/LeaderboardManager';
import { SignalPackCatalog } from '../audio/SignalPackCatalog';
import {
  describeNextRankTarget,
  nextSignalAfter,
  nextRankTarget,
  pbImprovement
} from '../mastery/SignalPackMastery';

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
  private ghostRaceElem: HTMLElement;
  private masteryElem: HTMLElement;
  private masteryProgressElem: HTMLElement;
  private masteryUnlockElem: HTMLElement;
  private masteryUnlockNameElem: HTMLElement;
  private masteryUnlockReqElem: HTMLElement;
  private masteryEquipBtn: HTMLButtonElement;
  private ghostRaceLabelElem: HTMLElement;
  private ghostRaceTimeElem: HTMLElement;
  private ghostRaceDeltaElem: HTMLElement;
  private nextElem: HTMLElement;
  private nextLineElem: HTMLElement;
  private nextSignalBtn: HTMLButtonElement;
  private retryPbBtn: HTMLButtonElement;
  private viewLeaderboardBtn: HTMLButtonElement;
  private competitionElem: HTMLElement;
  private competitionPosElem: HTMLElement;
  private competitionTargetElem: HTMLElement;
  private competitionAboveElem: HTMLElement;
  private competitionGapElem: HTMLElement;
  private raceGhostBtn: HTMLButtonElement;
  private activeCandidate: LeaderboardSubmissionCandidate | null = null;

  private onReplayCallback?: () => void;
  private onAgainCallback?: () => void;
  private onNewTrackCallback?: () => void;
  private onArmoryCallback?: () => void;
  private onRetryVsPbCallback?: () => Promise<{ ok: boolean; detail: string }>;
  private onNextSignalCallback?: (trackId: string) => Promise<{ ok: boolean; detail: string }>;
  private onViewLeaderboardCallback?: () => void;
  private onRaceGhostCallback?: (runId: string) => Promise<{ ok: boolean; detail: string }>;

  private revealTimeouts: number[] = [];
  /** Whether the CURRENT submission belongs to a registered account. */
  private registeredAccount = true;
  /** True only when this run was the FIRST Diamond on the current official track. */
  private lastDiamondMastered = false;
  private surfBadgeElem!: HTMLElement;
  private navigationBusy = false;

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
            <div class="results-surf-badge hidden" id="res-surf-badge">[SURF] SURF WORLD BOARD</div>
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

        <div class="results-ghost-race hidden" id="res-ghost-race" aria-live="polite">
          <div class="results-ghost-race-head">
            <span class="results-ghost-race-label" id="res-ghost-race-label">PB GHOST</span>
            <span class="results-ghost-race-time" id="res-ghost-race-time">--:--.---</span>
          </div>
          <div class="results-ghost-race-foot">
            <span class="results-ghost-race-delta-label">DELTA</span>
            <span class="results-ghost-race-delta" id="res-ghost-race-delta">+0.000</span>
          </div>
        </div>

        <div class="results-mastery hidden" id="res-mastery" aria-live="polite">
          <div class="results-mastery-progress" id="res-mastery-progress"></div>
          <div class="results-mastery-unlock hidden" id="res-mastery-unlock">
            <div class="results-mastery-unlock-kicker">MASTERY ACHIEVEMENT</div>
            <div class="results-mastery-unlock-name" id="res-mastery-unlock-name"></div>
            <div class="results-mastery-unlock-status">UNLOCKED</div>
            <div class="results-mastery-unlock-req" id="res-mastery-unlock-req"></div>
            <button class="terminal-btn-subtle" id="btn-res-mastery-equip" type="button">[ EQUIP ]</button>
          </div>
        </div>

        <div class="signal-drop-panel hidden" id="res-signal-drop" aria-live="polite">
          <div class="signal-drop-copy">
            <div class="signal-drop-kicker" id="res-signal-drop-status">SIGNAL ACQUIRED</div>
            <div class="signal-drop-reward" id="res-signal-drop-reward">DIAMOND PACKET READY</div>
            <div class="signal-drop-count" id="res-signal-drop-count">01 STORED SIGNAL</div>
          </div>
          <button class="btn-preview signal-drop-open" id="btn-res-signal-drop">OPEN IN ARMORY</button>
        </div>

        <div class="leaderboard-feedback-bar hidden" id="res-leaderboard-feedback"></div>

        <div class="results-next hidden" id="res-next" aria-live="polite">
          <div class="results-next-copy">
            <div class="results-next-kicker" id="res-next-kicker">NEXT TARGET</div>
            <div class="results-next-line" id="res-next-line">—</div>
          </div>
          <button class="btn-preview hidden" id="btn-res-next" type="button">[ NEXT SIGNAL ]</button>
        </div>

        <div class="results-competition hidden" id="res-competition" aria-live="polite">
          <div class="results-competition-row">
            <span class="results-competition-label">WORLD PB</span>
            <span class="results-competition-value" id="res-competition-pos">--</span>
          </div>
          <div class="results-competition-target hidden" id="res-competition-target">
            <span class="results-competition-above" id="res-competition-above">--</span>
            <span class="results-competition-gap" id="res-competition-gap">--</span>
            <button class="btn-preview hidden" id="btn-res-race-ghost" type="button" title="Race this accepted run as a ghost.">[ RACE GHOST ]</button>
          </div>
        </div>

        <div class="results-actions" id="res-actions">
          <button class="btn-hero" id="btn-res-again">[ RETRY ]</button>
          <button class="btn-preview hidden" id="btn-res-retry-pb" title="Retry with your stored PB ghost armed.">[ RETRY VS PB ]</button>
          <button class="btn-preview hidden" id="btn-res-leaderboard">[ ADD TO LEADERBOARD ]</button>
          <button class="btn-preview hidden" id="btn-res-view-leaderboard" title="Open this signal's world board.">[ VIEW LEADERBOARD ]</button>
          <button class="btn-preview" id="btn-res-replay" title="Watch your run back in first person.">[ WATCH REPLAY ]</button>
          <button class="btn-preview" id="btn-res-new">[ MAIN MENU ]</button>
        </div>
      </div>
    `;

    this.trackTitleElem = this.element.querySelector('#res-track-title') as HTMLElement;
    this.rankElem = this.element.querySelector('#res-rank') as HTMLElement;
    this.rankSubElem = this.element.querySelector('#res-rank-sub') as HTMLElement;
    this.pbStatusElem = this.element.querySelector('#res-pb-status') as HTMLElement;
    this.surfBadgeElem = this.element.querySelector('#res-surf-badge') as HTMLElement;

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
    this.ghostRaceElem = this.element.querySelector('#res-ghost-race') as HTMLElement;
    this.masteryElem = this.element.querySelector('#res-mastery') as HTMLElement;
    this.masteryProgressElem = this.element.querySelector('#res-mastery-progress') as HTMLElement;
    this.masteryUnlockElem = this.element.querySelector('#res-mastery-unlock') as HTMLElement;
    this.masteryUnlockNameElem = this.element.querySelector('#res-mastery-unlock-name') as HTMLElement;
    this.masteryUnlockReqElem = this.element.querySelector('#res-mastery-unlock-req') as HTMLElement;
    this.masteryEquipBtn = this.element.querySelector('#btn-res-mastery-equip') as HTMLButtonElement;
    this.ghostRaceLabelElem = this.element.querySelector('#res-ghost-race-label') as HTMLElement;
    this.ghostRaceTimeElem = this.element.querySelector('#res-ghost-race-time') as HTMLElement;
    this.ghostRaceDeltaElem = this.element.querySelector('#res-ghost-race-delta') as HTMLElement;
    this.nextElem = this.element.querySelector('#res-next') as HTMLElement;
    this.nextLineElem = this.element.querySelector('#res-next-line') as HTMLElement;
    this.nextSignalBtn = this.element.querySelector('#btn-res-next') as HTMLButtonElement;
    this.retryPbBtn = this.element.querySelector('#btn-res-retry-pb') as HTMLButtonElement;
    this.viewLeaderboardBtn = this.element.querySelector('#btn-res-view-leaderboard') as HTMLButtonElement;
    this.competitionElem = this.element.querySelector('#res-competition') as HTMLElement;
    this.competitionPosElem = this.element.querySelector('#res-competition-pos') as HTMLElement;
    this.competitionTargetElem = this.element.querySelector('#res-competition-target') as HTMLElement;
    this.competitionAboveElem = this.element.querySelector('#res-competition-above') as HTMLElement;
    this.competitionGapElem = this.element.querySelector('#res-competition-gap') as HTMLElement;
    this.raceGhostBtn = this.element.querySelector('#btn-res-race-ghost') as HTMLButtonElement;

    // Keep time, PB and local position primary; run diagnostics remain available.
    const details = document.createElement('details');
    details.className = 'results-run-data';
    details.innerHTML = '<summary>RUN DATA</summary><div class="results-grid"></div>';
    const dataGrid = details.querySelector('div')!;
    Array.from(this.statsGrid.children).forEach((card, index) => {
      if (index !== 0 && index !== 3 && index !== 4) dataGrid.appendChild(card);
    });
    this.statsGrid.after(details);
    this.statsGrid.before(this.nextElem);

    const options = document.createElement('details');
    options.className = 'results-secondary-actions';
    options.innerHTML = '<summary>MORE OPTIONS</summary><div></div>';
    [this.leaderboardBtn, this.viewLeaderboardBtn, this.replayBtn, this.newTrackBtn]
      .forEach(button => options.querySelector('div')!.appendChild(button));
    this.actionsRow.appendChild(options);

    this.initEvents();
  }

  public setCallbacks(callbacks: {
    onReplay: () => void;
    onAgain: () => void;
    onNewTrack: () => void;
    onArmory?: () => void;
    onRetryVsPb?: () => Promise<{ ok: boolean; detail: string }>;
    onNextSignal?: (trackId: string) => Promise<{ ok: boolean; detail: string }>;
    onViewLeaderboard?: () => void;
    onRaceGhost?: (runId: string) => Promise<{ ok: boolean; detail: string }>;
  }): void {
    this.onReplayCallback = callbacks.onReplay;
    this.onAgainCallback = callbacks.onAgain;
    this.onNewTrackCallback = callbacks.onNewTrack;
    this.onArmoryCallback = callbacks.onArmory;
    this.onRetryVsPbCallback = callbacks.onRetryVsPb;
    this.onNextSignalCallback = callbacks.onNextSignal;
    this.onViewLeaderboardCallback = callbacks.onViewLeaderboard;
    this.onRaceGhostCallback = callbacks.onRaceGhost;
  }

  public showResults(
    results: RunResults,
    seed: number,
    ghostInfo?: { rivalDelta?: number; isNewPB?: boolean },
    trackTitle = 'PLAYHEAD TRACK',
    overtimeInfo?: { isOvertime: boolean; overtimeDuration: number },
    progressionInfo?: { dropsAwarded: number; bestDropRank?: RunRank; registered?: boolean },
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
    },
    /**
     * Recorded-ghost comparison. Raw integer microseconds in, formatting out.
     * Absent when the run was not a ghost race.
     */
    ghostRaceInfo?: {
      label: string;
      ghostTimeUs: number;
      deltaUs: number;
    },
    /** Real world-submission state at the moment the results screen opens. */
    submissionFeedback?: SubmissionFeedback,
    /**
     * MASTERY: only supplied when progress ACTUALLY changed, so the player never
     * sees mastery noise after an unrelated run.
     */
    masteryInfo?: {
      progress: MasteryProgressDelta[];
      gloves: MasteryGloveId[];
    },
    /**
     * CORE LOOP: authoritative context captured BEFORE the run was recorded.
     * `priorPbTime` is the PB that existed before this run (seconds, or null when
     * there was none), `diamondJustMastered` is the true first-Diamond moment and
     * `pbGhostAvailable` says whether a compatible stored replay can be raced.
     */
    coreLoopInfo?: {
      priorPbTime: number | null;
      diamondJustMastered: boolean;
      pbGhostAvailable: boolean;
      pbGhostLabel?: string | null;
    },
    /**
     * SURF board context. When present the report shows a SURF badge and the
     * NORMAL reward panels (Signal Drop, mastery) are suppressed — a SURF run
     * never earns NORMAL drops/progression/prestige.
     */
    surfInfo?: { isSurf: true; boardTrackId: string; title: string }
  ): void {
    this.clearTimeouts();
    this.navigationBusy = false;
    this.againBtn.disabled = false;
    this.newTrackBtn.disabled = false;

    this.trackTitleElem.textContent = trackTitle.toUpperCase();
    const isNewPersonalBest = !overtimeInfo?.isOvertime && (
      officialInfo?.isOfficial && coreLoopInfo
        ? results.rank !== 'UNRANKED' && (coreLoopInfo.priorPbTime === null || results.completionTime < coreLoopInfo.priorPbTime)
        : ghostInfo?.isNewPB === true
    );

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

    if (isNewPersonalBest) {
      // Restrained PB delta: only when a previous PB actually existed. A first
      // PB reads as a NEW PERSONAL BEST with no invented improvement number.
      const prior = coreLoopInfo?.priorPbTime ?? null;
      const delta = pbImprovement(prior, results.completionTime);
      this.pbStatusElem.textContent = delta !== null && delta > 0.0005
        ? `[PB] NEW PERSONAL BEST // -${delta.toFixed(3)}s`
        : '[PB] NEW PERSONAL BEST';
      this.pbStatusElem.classList.remove('hidden');
    } else if (officialInfo?.isNewLocalFirst && !overtimeInfo?.isOvertime) {
      this.pbStatusElem.textContent = '[LOCAL #1] NEW LOCAL FIRST RECORD';
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
    if (progressionInfo?.registered !== undefined) {
      this.registeredAccount = progressionInfo.registered;
    }
    this.lastDiamondMastered = coreLoopInfo?.diamondJustMastered === true;
    if (this.lastDiamondMastered) this.rankSubElem.textContent = '// DIAMOND ACHIEVED // SIGNAL MASTERED';
    // SURF badge + NORMAL reward suppression. A SURF run can never earn a
    // Signal Drop or mastery progress, so those panels are hidden entirely.
    const isSurfRun = surfInfo?.isSurf === true;
    this.surfBadgeElem.classList.toggle('hidden', !isSurfRun);
    if (isSurfRun) {
      this.surfBadgeElem.textContent = '[SURF] SURF WORLD BOARD // NO NORMAL REWARDS';
    }
    this.prepareSignalDropPanel(
      isSurfRun ? 0 : (progressionInfo?.dropsAwarded ?? 0),
      isSurfRun ? undefined : progressionInfo?.bestDropRank,
      isSurfRun ? undefined : customRewardInfo
    );

    // Leaderboard Action Setup
    this.activeCandidate = officialInfo?.candidate || null;
    this.leaderboardFeedbackElem.classList.add('hidden');

    // Contextual competition is fetched asynchronously by the game AFTER this
    // run has settled; reset to the honest empty state on every new report.
    this.setCompetitionContext(null);
    (this.element.querySelector('.results-secondary-actions') as HTMLDetailsElement).open = false;
    const viewable = (
      officialInfo?.isOfficial === true ||
      isSurfRun
    ) &&
      !overtimeInfo?.isOvertime &&
      customRewardInfo?.isCustomAudio !== true;
    this.viewLeaderboardBtn.classList.toggle('hidden', !viewable);
    this.viewLeaderboardBtn.disabled = !viewable;

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

    // Recorded-ghost race comparison (PB ghost / world ghost).
    // Raw microseconds are compared; formatting happens only here.
    if (ghostRaceInfo) {
      const beaten = ghostRaceInfo.deltaUs < 0;
      this.ghostRaceElem.classList.remove('hidden');
      this.ghostRaceLabelElem.textContent = ghostRaceInfo.label;
      this.ghostRaceTimeElem.textContent = formatTime(ghostRaceInfo.ghostTimeUs / 1_000_000);
      const sign = beaten ? '-' : '+';
      this.ghostRaceDeltaElem.textContent = `${sign}${formatTime(
        Math.abs(ghostRaceInfo.deltaUs) / 1_000_000
      )}`;
      this.ghostRaceDeltaElem.className = `results-ghost-race-delta ${beaten ? 'ahead' : 'behind'}`;
    } else {
      this.ghostRaceElem.classList.add('hidden');
    }

    // Real world-submission state for this run.
    this.setSubmissionState(submissionFeedback?.state ?? 'NOT_OFFICIAL', submissionFeedback?.detail);

    // MASTERY: progress lines and a restrained unlock reveal. SURF runs never
    // change mastery, so the panel stays hidden.
    this.renderMasteryInfo(isSurfRun ? undefined : masteryInfo);

    // CORE LOOP: one or two authoritative next targets, the optional PB duel
    // action and the deterministic next official signal. Called last so it can
    // read the already-rendered PB / ghost state.
    this.renderCoreLoop(
      results,
      officialInfo,
      overtimeInfo,
      coreLoopInfo,
      isNewPersonalBest
    );

    // The goal opens the report and every action immediately.
    this.element.classList.remove('hidden');
    const rankGroup = this.element.querySelector('#res-rank-group') as HTMLElement;
    rankGroup.style.opacity = '1';
    this.statsGrid.style.opacity = '1';
    this.actionsRow.style.opacity = '1';
    if ((progressionInfo?.dropsAwarded ?? 0) > 0 && KarambitSkinSystem.getInstance().getPendingDropCount() > 0) {
      this.signalDropOpenBtn.focus();
    } else {
      this.againBtn.focus();
    }
  }

  public setRaceWaiting(waiting: boolean): void {
    this.againBtn.disabled = waiting;
    this.againBtn.textContent = waiting ? '[ WAITING FOR RACERS ]' : '[ RETRY ]';
    if (waiting) {
      this.retryPbBtn.classList.add('hidden');
      this.nextSignalBtn.classList.add('hidden');
    }
  }

  private prepareSignalDropPanel(
    newlyAwardedCount: number,
    bestDropRank?: RunRank,
    customRewardInfo?: {
      isCustomAudio: boolean;
      eligible: boolean;
      statusMessage: string;
      reason?: 'TOO_SHORT' | 'ALREADY_CLAIMED';
    },
    serverAcquired = false
  ): void {
    const skinSystem = KarambitSkinSystem.getInstance();
    const pending = skinSystem.getPendingDropCount();
    const isCollectionComplete = skinSystem.isDropPoolComplete();
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
      this.signalDropPanel.classList.add('hidden');
      return;
    }

    // SERVER-ISSUED drop: show the concise earned notification and route the
    // player to the Armory to open it. The full reveal never interrupts gameplay.
    if (skinSystem.hasStructuredDropPending()) {
      const stored = skinSystem.getUnopenedDropIds().length;
      this.signalDropPanel.classList.remove('hidden');
      if (serverAcquired) {
        this.signalDropStatus.textContent = 'FIRST DIAMOND // SIGNAL DROP ACQUIRED';
        this.signalDropReward.textContent = '[ARM] SIGNAL DROP ACQUIRED';
      } else {
        this.signalDropStatus.textContent = 'STORED SIGNAL READY';
        this.signalDropReward.textContent = 'UNOPENED SIGNAL DROP';
      }
      this.signalDropCount.textContent = `${stored.toString().padStart(2, '0')} STORED SIGNAL${stored === 1 ? '' : 'S'}`;
      this.signalDropOpenBtn.textContent = 'OPEN IN ARMORY';
      this.signalDropOpenBtn.disabled = false;
      return;
    }

    if (pending <= 0) {
      // FIRST DIAMOND but NOT a registered account: the server will not store a
      // drop, so never silently promise a minted one. Tell the player plainly.
      if ((newlyAwardedCount > 0 || this.lastDiamondMastered) && this.registeredAccount === false) {
        this.signalDropPanel.classList.remove('hidden');
        this.signalDropStatus.textContent = 'DIAMOND ACHIEVED';
        this.signalDropReward.textContent = 'SIGN IN TO STORE DROP';
        this.signalDropCount.textContent = 'ACCOUNT REQUIRED FOR SIGNAL DROPS';
        this.signalDropOpenBtn.textContent = 'SIGN IN';
        this.signalDropOpenBtn.disabled = true;
        return;
      }
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

  /**
   * Shows the replay action only when a first-person replay actually exists.
   * A WATCH button is never offered for a run with no replay.
   */
  public setReplayAvailable(available: boolean): void {
    this.replayBtn.classList.toggle('hidden', !available);
  }

  public setDecodeModal(modal: import('./SignalDecodeModal').SignalDecodeModal): void {
    this.decodeModal = modal;
  }

  /**
   * Re-renders the concise Signal Drop panel from CURRENT state. Called when the
   * asynchronous submit answer arrives (the panel was first drawn BEFORE the
   * server created the drop), so a first-Diamond award is surfaced immediately
   * instead of waiting for the next results visit.
   */
  public refreshSignalDropPanel(acquired = false): void {
    this.prepareSignalDropPanel(acquired ? 1 : 0, undefined, undefined, acquired);
  }

  private openSignalDrop(): void {
    const skinSystem = KarambitSkinSystem.getInstance();

    // STRUCTURED drop: never open during results. Route to the Armory, where the
    // server-driven decoder (terminal randomizer, skippable) performs the open.
    if (skinSystem.hasStructuredDropPending()) {
      this.decodeModal?.setOnComplete(() => this.prepareSignalDropPanel(0));
      this.onArmoryCallback?.();
      return;
    }

    if (this.decodeModal) {
      this.decodeModal.open(() => {
        this.prepareSignalDropPanel(0);
      });
      return;
    }
    // PRODUCTION: never mint from a legacy/DEV pending rank here. The offline
    // roller is DEV-only; a real award arrives through the Armory.
    if (!skinSystem.isDevPreview()) {
      this.prepareSignalDropPanel(0);
      return;
    }
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
      this.signalDropPanel.classList.add(`rarity-${reward.rarity.toLowerCase()}`);
      this.signalDropStatus.textContent = `${reward.qualityLabel} // ${reward.rarity} FOUND`;
      this.signalDropReward.textContent = `${cosmeticKindLabel(reward.kind)} // ${reward.name}`;
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
    // A hidden report can never show stale competition from a previous run.
    this.setCompetitionContext(null);
  }

  /**
   * Re-shows the CURRENT report without re-running the reveal or any of the
   * finish pipeline. Used when a WATCH REPLAY session exits back to the report
   * it came from, so the player sees the same report rather than a blank menu.
   */
  public show(): void {
    this.clearTimeouts();
    this.element.classList.remove('hidden');
    this.statsGrid.style.opacity = '1';
    const rankGroup = this.element.querySelector('#res-rank-group') as HTMLElement | null;
    if (rankGroup) rankGroup.style.opacity = '1';
    this.actionsRow.style.opacity = '1';
  }

  private clearTimeouts(): void {
    for (const t of this.revealTimeouts) {
      clearTimeout(t);
    }
    this.revealTimeouts = [];
  }

  /**
   * CORE LOOP: the run report must always answer "what next?" without becoming a
   * spreadsheet. Shows AT MOST one rank/PB target line and, when it is a real
   * official signal, the deterministic next official signal with an EXECUTE
   * action that enters it through the existing official load path.
   *
   * `RETRY VS PB` is offered only when all three hold: an official track, a
   * stored PB with a compatible recorded replay, and a normal (non-overtime)
   * run. An explicitly chosen RETRY VS PB arms the ghost; a normal RETRY never
   * does, so the ghost setting is respected.
   */
  private renderCoreLoop(
    results: RunResults,
    officialInfo?: { isOfficial: boolean; trackId: string; isNewLocalFirst?: boolean },
    overtimeInfo?: { isOvertime: boolean; overtimeDuration: number },
    coreLoopInfo?: { priorPbTime: number | null; diamondJustMastered: boolean; pbGhostAvailable: boolean; pbGhostLabel?: string | null },
    isNewPersonalBest = false
  ): void {
    const isOvertime = overtimeInfo?.isOvertime === true;
    const trackId = officialInfo?.trackId ?? null;

    // NEXT TARGET: the next rank above this run, honest about time vs clean-run.
    const target = nextRankTarget(
      results.targetTime,
      results.rank,
      results.completionTime,
      results.fallsCount + results.restartsCount
    );

    const lines: string[] = [];
    if (target) {
      lines.push(describeNextRankTarget(target));
    } else {
      const best = coreLoopInfo?.priorPbTime;
      lines.push(!isNewPersonalBest && best != null && results.completionTime > best
        ? `${(results.completionTime - best).toFixed(3)}s TO PB`
        : 'CHASE YOUR PB // RACE THE SIGNAL');
    }

    // Only offer the deterministic next official signal for official runs.
    let nextSignalId: string | null = null;
    if (trackId && SignalPackCatalog.getTrackById(trackId)) {
      // Authoritative ranks, exactly the ones mastery derives from.
      const ranks = masteryGloveSystem.getProgress().ranks;
      const next = nextSignalAfter(SignalPackCatalog.getTracks(), trackId, ranks);
      if (next) {
        nextSignalId = next.id;
        lines.push(`NEXT SIGNAL // ${next.title}`);
      }
    }

    if (lines.length === 0) {
      this.nextElem.classList.add('hidden');
    } else {
      this.nextElem.classList.remove('hidden');
      // At most two lines: a PB/rank target plus the journey step.
      this.nextLineElem.innerHTML = lines
        .slice(0, 2)
        .map((l) => `<div class="results-next-item">${this.escape(l)}</div>`)
        .join('');
    }

    if (nextSignalId && !isOvertime) {
      this.nextSignalBtn.classList.remove('hidden');
      this.nextSignalBtn.disabled = false;
      this.nextSignalBtn.dataset.trackId = nextSignalId;
      this.nextSignalBtn.textContent = '[ NEXT SIGNAL ]';
    } else {
      this.nextSignalBtn.classList.add('hidden');
      delete this.nextSignalBtn.dataset.trackId;
    }

    // OPTIONAL PB DUEL: an explicit action, never the default RETRY.
    const pbGhostAvailable = !!coreLoopInfo?.pbGhostAvailable;
    const canRetryVsPb = !!trackId && pbGhostAvailable && !isOvertime;
    this.retryPbBtn.classList.toggle('hidden', !canRetryVsPb);
    this.retryPbBtn.disabled = !canRetryVsPb;
    this.retryPbBtn.textContent = coreLoopInfo?.pbGhostLabel === 'BEST RECORDED GHOST'
      ? '[ RACE BEST RECORDED GHOST ]' : '[ RETRY VS PB ]';
    this.retryPbBtn.title = 'Retry with the compatible stored replay.';
  }

  private async navigateRun(action: (() => Promise<{ ok: boolean; detail: string }>) | undefined): Promise<void> {
    if (!action || this.navigationBusy) return;
    this.navigationBusy = true;
    const buttons = [this.againBtn, this.retryPbBtn, this.nextSignalBtn, this.newTrackBtn,
      this.raceGhostBtn, this.viewLeaderboardBtn, this.replayBtn, this.leaderboardBtn];
    const disabled = buttons.map(button => button.disabled);
    buttons.forEach(button => button.disabled = true);
    try {
      const result = await action();
      if (!result.ok) {
        this.nextLineElem.textContent = result.detail;
        this.nextElem.classList.remove('hidden');
      }
    } catch {
      this.nextLineElem.textContent = 'SIGNAL UNAVAILABLE // RETRY';
      this.nextElem.classList.remove('hidden');
    } finally {
      this.navigationBusy = false;
      buttons.forEach((button, index) => button.disabled = disabled[index]);
    }
  }

  private escape(value: string): string {
    return value.replace(/[&<>"']/g, (c) =>
      c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
    );
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
    this.retryPbBtn.addEventListener('click', () => void this.navigateRun(this.onRetryVsPbCallback));
    this.nextSignalBtn.addEventListener('click', () => {
      const trackId = this.nextSignalBtn.dataset.trackId;
      if (trackId) void this.navigateRun(this.onNextSignalCallback ? () => this.onNextSignalCallback!(trackId) : undefined);
    });
    this.replayBtn.addEventListener('click', () => this.onReplayCallback?.());
    this.newTrackBtn.addEventListener('click', () => this.onNewTrackCallback?.());
    this.signalDropOpenBtn.addEventListener('click', () => this.openSignalDrop());
    this.viewLeaderboardBtn.addEventListener('click', () => this.onViewLeaderboardCallback?.());
    this.raceGhostBtn.addEventListener('click', () => {
      const runId = this.raceGhostBtn.dataset.runId;
      if (!runId) return;
      void this.navigateRun(this.onRaceGhostCallback ? () => this.onRaceGhostCallback!(runId) : undefined);
    });
    this.leaderboardBtn.addEventListener('click', () => {
      if (!this.activeCandidate) return;
      // Manual retry path: queue locally so the existing offline flush can carry
      // it later. The real submission state is always reported by the game, so
      // this never claims a world entry was accepted.
      const queued = LeaderboardManager.getInstance().queueCandidate(this.activeCandidate);
      if (queued) {
        this.leaderboardBtn.textContent = '[ ENTRY QUEUED ]';
        this.leaderboardBtn.disabled = true;
        this.setSubmissionState('WORLD_ENTRY_QUEUED_OFFLINE');
      }
    });
  }

  /**
   * MASTERY progress for this run.
   *
   * Only rendered when progress actually changed, and the reveal is a single
   * restrained "you earned this" moment — never random-reward language, and never
   * a burst of five animations when a returning player is recognised.
   */
  private renderMasteryInfo(masteryInfo?: {
    progress: MasteryProgressDelta[];
    gloves: MasteryGloveId[];
  }): void {
    if (!masteryInfo || (masteryInfo.progress.length === 0 && masteryInfo.gloves.length === 0)) {
      this.masteryElem.classList.add('hidden');
      return;
    }
    this.masteryElem.classList.remove('hidden');

    this.masteryProgressElem.innerHTML = masteryInfo.progress
      .filter((delta, index, all) => delta.label === 'SIGNAL MASTERY' || index === all.length - 1)
      .map(
        (d) =>
          `<div class="results-mastery-line"><span>${d.label}</span>` +
          `<b>${d.before.toString().padStart(2, '0')} / ${d.total} &rarr; ${d.after
            .toString()
            .padStart(2, '0')} / ${d.total}</b></div>`
      )
      .join('');

    const first = masteryInfo.gloves[0];
    if (!first) {
      this.masteryUnlockElem.classList.add('hidden');
      return;
    }

    const definition = getMasteryGlove(first);
    this.masteryUnlockElem.classList.remove('hidden');
    this.masteryUnlockNameElem.textContent = definition.name;
    this.masteryUnlockReqElem.textContent = definition.requirementLabel;

    // More than one historical achievement recognised at once: say so compactly
    // instead of stacking reveals.
    const extra = masteryInfo.gloves.length - 1;
    this.masteryEquipBtn.textContent = extra > 0 ? `[ EQUIP ] +${extra} MORE` : '[ EQUIP ]';
    this.masteryEquipBtn.disabled = false;
    this.masteryEquipBtn.onclick = () => {
      const equipped = masteryGloveSystem.equipGlove(first);
      this.masteryEquipBtn.textContent = equipped ? '[ EQUIPPED ]' : '[ LOCKED ]';
      this.masteryEquipBtn.disabled = true;
    };
  }

  /**
   * Contextual world competition for this run's canonical track.
   *
   * `null` (offline, guest with no board, or a screen that has moved on) hides
   * the block entirely. An accepted PB outside the page has no known position,
   * and the next-above row is omitted when there is no honest target. The RACE
   * GHOST action appears only for an accepted run that actually carries a replay.
   */
  public setCompetitionContext(
    context: {
      position: number | null;
      timeUs: number;
      nextAbove: {
        rankPosition: number;
        displayName: string;
        timeUs: number;
        /** Honest own-time minus target-time gap, computed by the caller. */
        gapUs: number;
        runId: string;
        raceable: boolean;
      } | null;
    } | null
  ): void {
    delete this.raceGhostBtn.dataset.runId;
    this.raceGhostBtn.classList.add('hidden');

    if (!context) {
      this.competitionElem.classList.add('hidden');
      return;
    }

    this.competitionElem.classList.remove('hidden');
    this.competitionPosElem.textContent =
      `${formatTime(context.timeUs / 1_000_000)} // ${context.position === null ? 'POSITION UNAVAILABLE' : `#${context.position}`}`;

    const above = context.nextAbove;
    if (!above) {
      this.competitionTargetElem.classList.add('hidden');
      return;
    }

    this.competitionTargetElem.classList.remove('hidden');
    this.competitionAboveElem.textContent = `#${above.rankPosition} ${above.displayName} // ${formatTime(above.timeUs / 1_000_000)}`;
    // Display-only and clamped: the target is above the player, so the honest
    // gap can never be negative.
    this.competitionGapElem.textContent = `+${formatTime(Math.max(0, above.gapUs) / 1_000_000)}`;

    if (above.raceable) {
      this.raceGhostBtn.classList.remove('hidden');
      this.raceGhostBtn.dataset.runId = above.runId;
    }
  }

  /**
   * Renders the REAL world-submission state for this run.
   *
   * Called once when the screen opens and again whenever the server answers, so
   * the player never sees a claim that the server has not confirmed.
   */
  public setSubmissionState(state: SubmissionState, detail?: string): void {
    this.leaderboardFeedbackElem.textContent = detail
      ? `${SUBMISSION_FEEDBACK_TEXT[state]} // ${detail.toUpperCase()}`
      : SUBMISSION_FEEDBACK_TEXT[state];
    this.leaderboardFeedbackElem.classList.remove('hidden');
    this.leaderboardFeedbackElem.dataset.state = state;

    // The retry button is only meaningful when the run has NOT reached the board
    // and something can still be done about it.
    if (this.activeCandidate && isRetryableSubmission(state)) {
      this.leaderboardBtn.classList.remove('hidden');
      this.leaderboardBtn.disabled = false;
      this.leaderboardBtn.textContent = '[ ADD TO LEADERBOARD ]';
    } else if (this.activeCandidate) {
      this.leaderboardBtn.classList.add('hidden');
    }
  }
}
