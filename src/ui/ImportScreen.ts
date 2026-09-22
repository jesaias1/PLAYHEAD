/**
 * Import screen for PLAYHEAD
 * Terminal / Signal Console Interface:
 * Curated Signal Pack (14-track system catalog), interactive preview auditioning,
 * dedicated Custom Audio signal injection terminal, direct Movement Lab console entry,
 * and Karambit Armory & Cosmic Skins Profile.
 */

import { AudioLoader } from '../audio/AudioLoader';
import { SyntheticGenre } from '../audio/SyntheticTrack';
import { MusicPack, TrackCatalogEntry } from '../audio/MusicPack';
import { KarambitSkinSystem, OpenedSignalDrop } from '../viewmodel/KarambitSkinSystem';
import { createProgramFingerprint } from './SignalIdentity';
import { LeaderboardManager } from '../leaderboard/LeaderboardManager';
import { formatTime } from '../utils/math';
import { RacePanel } from './RacePanel';
import { LeaderboardPanel } from './LeaderboardPanel';

export class ImportScreen {
  public element: HTMLElement;

  // Tabs
  private tabShowcaseBtn: HTMLButtonElement;
  private tabCustomBtn: HTMLButtonElement;
  private tabLabBtn: HTMLButtonElement;
  private tabArmoryBtn: HTMLButtonElement;
  private tabRaceBtn: HTMLButtonElement;
  private tabLeaderboardBtn: HTMLButtonElement;

  /** 05 // RACE WITH FRIENDS � multiplayer session only. */
  public racePanel: RacePanel = new RacePanel();
  /** 06 // WORLD LEADERBOARD � competitive rankings only. */
  public leaderboardPanel: LeaderboardPanel = new LeaderboardPanel();

  /** Called when the leaderboard tab is opened (used to refresh the board). */
  public onLeaderboardTabOpened?: () => void;

  /** Opens 05 // RACE WITH FRIENDS (e.g. from an invite URL). */
  public openRaceTab(): void {
    this.switchModule(4);
  }

  /** Opens 06 // WORLD LEADERBOARD. */
  public openLeaderboardTab(): void {
    this.switchModule(5);
  }

  private showcasePanel: HTMLElement;
  private customPanel: HTMLElement;
  private labPanel: HTMLElement;
  private armoryPanel: HTMLElement;
  private labMusicSelect: HTMLSelectElement;
  private labEnterBtn: HTMLButtonElement;

  // Showcase Elements
  private showcaseTitleElem: HTMLElement;
  private showcaseArtistElem: HTMLElement;
  private showcaseGenreElem: HTMLElement;
  private showcaseBpmElem: HTMLElement;
  private showcaseDurationElem: HTMLElement;
  private showcaseDiffElem: HTMLElement;
  private showcaseDescElem: HTMLElement;
  private showcaseFingerprintElem: HTMLElement;
  private showcaseEnterBtn: HTMLButtonElement;
  private showcasePreviewBtn: HTMLButtonElement;
  private previewIconElem: HTMLElement;
  private previewTextElem: HTMLElement;
  private selectorStripElem: HTMLElement;

  // Custom Drop Elements
  private dropZone: HTMLElement;
  private fileInput: HTMLInputElement;
  private browseBtn: HTMLButtonElement;

  // Armory Elements
  private armoryGridElem: HTMLElement;
  private armoryDevToggleBtn: HTMLButtonElement;
  private decoderPendingElem: HTMLElement;
  private decoderStatusElem: HTMLElement;
  private decoderDetailElem: HTMLElement;
  private decoderButton: HTMLButtonElement;

  // State
  private catalog: TrackCatalogEntry[];
  private selectedTrack: TrackCatalogEntry;
  private isPreviewPlaying = false;
  private previewCtx: AudioContext | null = null;
  private currentPreviewSource: AudioBufferSourceNode | null = null;
  private skinSystem = KarambitSkinSystem.getInstance();
  private lastDecoderReward: OpenedSignalDrop | null = null;
  private decoderBusy = false;

  private onFileSelectedCallback?: (file: File) => void;
  private onCatalogTrackCallback?: (track: TrackCatalogEntry) => void;
  private onDevTrackCallback?: (genre?: SyntheticGenre) => void;
  private onErrorCallback?: (err: string) => void;
  private onMovementLabCallback?: (trackId?: string) => void;
  private decodeModal?: import('./SignalDecodeModal').SignalDecodeModal;

  constructor() {
    this.catalog = MusicPack.getCatalog();
    this.selectedTrack = this.catalog[0]; // Default track

    this.element = document.createElement('div');
    this.element.className = 'screen import-screen';
    this.element.innerHTML = `
      <div class="import-container terminal-console">
        <div class="brand-header">
          <div class="brand-title-wrap">
            <img src="/assets/brand/playhead_logo_text.png" class="brand-logo-text" alt="PLAYHEAD" />
            <img src="/assets/brand/playhead_mascot.png" class="brand-logo-mascot" alt="PLAYHEAD" />
          </div>
          <p class="brand-tagline">ENTER THE SIGNAL.<span class="terminal-cursor" aria-hidden="true"></span></p>
          <p class="brand-secondary">BECOME THE PLAYHEAD.</p>
        </div>

        <div class="import-tabs terminal-tabs" role="tablist" aria-label="PLAYHEAD system modules">
          <button class="import-tab-btn active" id="tab-btn-showcase" type="button" role="tab" aria-selected="true" aria-controls="panel-showcase">[ 01 // SIGNAL PACK ]</button>
          <button class="import-tab-btn" id="tab-btn-custom" type="button" role="tab" aria-selected="false" aria-controls="panel-custom" tabindex="-1">[ 02 // CUSTOM AUDIO ]</button>
          <button class="import-tab-btn" id="tab-btn-lab" type="button" role="tab" aria-selected="false" aria-controls="panel-lab" tabindex="-1">[ 03 // MOVEMENT LAB ]</button>
          <button class="import-tab-btn" id="tab-btn-armory" type="button" role="tab" aria-selected="false" aria-controls="panel-armory" tabindex="-1">[ 04 // KARAMBIT ARMORY ]</button>
          <button class="import-tab-btn" id="tab-btn-race" type="button" role="tab" aria-selected="false" aria-controls="panel-race" tabindex="-1" title="RACE WITH FRIENDS">[ 05 // RACE ]</button>
          <button class="import-tab-btn" id="tab-btn-leaderboard" type="button" role="tab" aria-selected="false" aria-controls="panel-leaderboard" tabindex="-1" title="WORLD LEADERBOARD">[ 06 // LEADERBOARD ]</button>
        </div>

        <!-- 01: THE SIGNAL PACK PANEL -->
        <div class="showcase-container showcase-panel" id="panel-showcase" role="tabpanel" aria-labelledby="tab-btn-showcase">
          <div class="terminal-panel-header">// SELECTED SIGNAL TELEMETRY</div>
          <div class="showcase-card terminal-card" id="showcase-card">
            <div class="showcase-header">
              <div class="showcase-title-group">
                <div class="showcase-artist" id="showcase-artist">SIGNAL ARCHIVES</div>
                <div class="showcase-track-title" id="showcase-title">FLOW STATE</div>
              </div>
            </div>

            <div class="showcase-meta-row">
              <span class="showcase-badge accent" id="showcase-genre">CHILLWAVE // FLOW</span>
              <span class="showcase-badge" id="showcase-bpm">110 BPM</span>
              <span class="showcase-badge" id="showcase-duration">01:12</span>
              <span class="showcase-badge" id="showcase-diff">TIER I · FLOW</span>
            </div>

            <div class="showcase-records-strip" id="showcase-records-strip">
              <div class="showcase-record-pill rank">
                <span class="record-label">BEST //</span>
                <span class="record-val" id="showcase-best-rank">—</span>
              </div>
              <div class="showcase-record-pill pb">
                <span class="record-label">PB //</span>
                <span class="record-val" id="showcase-pb-time">—</span>
              </div>
              <div class="showcase-record-pill local-first">
                <span class="record-label">LOCAL #1 //</span>
                <span class="record-val" id="showcase-local-first">—</span>
              </div>
            </div>

            <div class="showcase-desc" id="showcase-desc">
              Introductory rhythm run with gentle momentum hops, broad landing pads, and relaxing surf curves.
            </div>

            <div class="signal-program-readout" aria-label="Deterministic signal program identity">
              <div class="signal-program-header">
                <span class="signal-program-label">[SIGNAL] PROGRAM FINGERPRINT</span>
                <span class="signal-program-state">LOCKED // DETERMINISTIC</span>
              </div>
              <div class="signal-program-bars" id="showcase-fingerprint" aria-hidden="true"></div>
            </div>

            <div class="showcase-actions">
              <button class="btn-hero btn-terminal-exec" id="btn-showcase-enter">> EXEC TRACK</button>
              <button class="btn-preview btn-terminal-action" id="btn-showcase-preview">
                <span id="preview-icon">▶</span>
                <span id="preview-text">> AUDITION // PREVIEW</span>
              </button>
            </div>
          </div>

          <div class="terminal-panel-header" style="margin-top: 8px;">// SYSTEM CATALOG MATRIX · 14 SIGNALS LOADED</div>
          <div class="showcase-selector-strip terminal-selector-strip" id="showcase-strip">
            <!-- Populated dynamically via buildStrip() -->
          </div>
        </div>

        <!-- 02: CUSTOM AUDIO PANEL -->
        <div class="custom-panel terminal-panel hidden" id="panel-custom" role="tabpanel" aria-labelledby="tab-btn-custom" aria-hidden="true">
          <div class="terminal-panel-header">// EXTERNAL SIGNAL INJECTION</div>
          <div class="import-drop-zone terminal-drop-zone" id="import-drop-zone" role="button" tabindex="0" aria-label="Choose or drop an audio file">
            <div class="drop-icon terminal-glow-icon">⤓</div>
            <div class="drop-title">INITIALIZE AUDIO STREAM</div>
            <div class="drop-subtitle">> DRAG & DROP TRACK OR CLICK TO BROWSE</div>
            <div class="drop-meta">[ FLAC / WAV / MP3 / OGG ]</div>
          </div>

          <div class="custom-actions">
            <button class="btn-hero btn-terminal-exec" id="btn-browse-file">[ BROWSE AUDIO FILE ]</button>
          </div>
        </div>

        <!-- 03: MOVEMENT LAB SETUP PANEL -->
        <div class="showcase-container showcase-panel hidden" id="panel-lab" role="tabpanel" aria-labelledby="tab-btn-lab" aria-hidden="true">
          <div class="terminal-panel-header">// MOVEMENT LAB · KINETIC CALIBRATION & SANDBOX</div>
          <div class="terminal-card lab-console-card">
            <div class="lab-console-copy">
              Dedicated isolated physics sandbox for practicing bunny-hop timing, Source-inspired air strafing, and high-velocity surf ramp control.
            </div>
            <div class="lab-control-grid">
              <label class="settings-label" for="lab-music-select">[SIGNAL] SOUNDTRACK</label>
              <select class="settings-select lab-signal-select" id="lab-music-select">
                <option value="NONE">NONE // SILENT SANDBOX</option>
              </select>
            </div>
            <div class="lab-actions">
              <button class="btn-hero btn-terminal-exec" id="btn-lab-enter">> ENTER MOVEMENT LAB</button>
            </div>
          </div>
        </div>

        <!-- 04: KARAMBIT ARMORY PANEL -->
        <div class="showcase-container showcase-panel hidden" id="panel-armory" role="tabpanel" aria-labelledby="tab-btn-armory" aria-hidden="true">
          <div class="terminal-panel-header" style="display: flex; justify-content: space-between; align-items: center;">
            <span>[ARMORY] KARAMBIT COSMETIC CONTROL</span>
            <button id="btn-armory-dev-toggle" class="terminal-btn-subtle" style="display: none; font-size: 0.7rem; padding: 3px 8px; background: rgba(0, 240, 255, 0.08); border: 1px solid #00f0ff; color: #00f0ff; cursor: pointer; font-family: var(--font-mono);">
              DEV PREVIEW: OFF
            </button>
          </div>
          <section class="armory-decoder" aria-labelledby="signal-decoder-title">
            <div class="decoder-header">
              <div>
                <div class="decoder-kicker">[SIGNAL] COSMETIC ACQUISITION BUS</div>
                <h2 id="signal-decoder-title">SIGNAL DECODER</h2>
              </div>
              <div class="decoder-counter"><span>PENDING SIGNALS</span><strong id="decoder-pending">0</strong></div>
            </div>
            <div class="decoder-body">
              <div class="decoder-copy">
                <div id="decoder-status" class="decoder-status">NO SIGNAL AVAILABLE</div>
                <div id="decoder-detail" class="decoder-detail">Complete official Signal Pack runs to acquire Armory signals.</div>
              </div>
              <div class="decoder-quality-grid" aria-label="Rank signal quality">
                <span><b>BRONZE</b> SIGNAL</span>
                <span><b>SILVER</b> ENHANCED ODDS</span>
                <span><b>GOLD</b> HIGH-GRADE</span>
                <span><b>DIAMOND</b> PRISTINE</span>
              </div>
              <button id="btn-decode-signal" class="btn-hero btn-terminal-exec decoder-button" type="button">[ NO SIGNAL AVAILABLE ]</button>
            </div>
          </section>
          <div class="armory-catalog-heading">[ARMORY] CHALLENGE UNLOCKS // COSMETIC CATALOG</div>
          <div id="armory-skins-grid" class="armory-skins-grid">
            <!-- Populated dynamically via renderArmory() -->
          </div>
        </div>

        <input type="file" id="import-file-input" accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac" style="display:none;" />

        <!-- 05 / 06: ONLINE PANELS (mounted by RacePanel + LeaderboardPanel) -->
        <div id="race-panel-host"></div>
        <div id="leaderboard-panel-host"></div>

        <div class="privacy-notice terminal-footer-status">
          [CLIENT-SIDE AUDIO DSP] · [PROCEDURAL ROUTE GENERATION]
        </div>
      </div>
    `;

    // Tab buttons
    this.tabShowcaseBtn = this.element.querySelector('#tab-btn-showcase') as HTMLButtonElement;
    this.tabCustomBtn = this.element.querySelector('#tab-btn-custom') as HTMLButtonElement;
    this.tabLabBtn = this.element.querySelector('#tab-btn-lab') as HTMLButtonElement;
    this.tabArmoryBtn = this.element.querySelector('#tab-btn-armory') as HTMLButtonElement;
    this.tabRaceBtn = this.element.querySelector('#tab-btn-race') as HTMLButtonElement;
    this.tabLeaderboardBtn = this.element.querySelector('#tab-btn-leaderboard') as HTMLButtonElement;

    // ONLINE panels (each owned by its own module; mounted into host slots).
    const raceHost = this.element.querySelector('#race-panel-host') as HTMLElement;
    if (raceHost) raceHost.appendChild(this.racePanel.element);
    const leaderboardHost = this.element.querySelector('#leaderboard-panel-host') as HTMLElement;
    if (leaderboardHost) leaderboardHost.appendChild(this.leaderboardPanel.element);

    const catalogEntries = this.catalog.map((t) => ({
      id: t.id,
      title: t.title,
      bpm: t.bpm,
      difficultyLabel: t.difficultyLabel
    }));
    this.racePanel.setCatalog(catalogEntries);
    this.leaderboardPanel.setCatalog(catalogEntries);

    this.showcasePanel = this.element.querySelector('#panel-showcase') as HTMLElement;
    this.customPanel = this.element.querySelector('#panel-custom') as HTMLElement;
    this.labPanel = this.element.querySelector('#panel-lab') as HTMLElement;
    this.armoryPanel = this.element.querySelector('#panel-armory') as HTMLElement;
    this.labMusicSelect = this.element.querySelector('#lab-music-select') as HTMLSelectElement;
    this.labEnterBtn = this.element.querySelector('#btn-lab-enter') as HTMLButtonElement;

    // Showcase elements
    this.showcaseTitleElem = this.element.querySelector('#showcase-title') as HTMLElement;
    this.showcaseArtistElem = this.element.querySelector('#showcase-artist') as HTMLElement;
    this.showcaseGenreElem = this.element.querySelector('#showcase-genre') as HTMLElement;
    this.showcaseBpmElem = this.element.querySelector('#showcase-bpm') as HTMLElement;
    this.showcaseDurationElem = this.element.querySelector('#showcase-duration') as HTMLElement;
    this.showcaseDiffElem = this.element.querySelector('#showcase-diff') as HTMLElement;
    this.showcaseDescElem = this.element.querySelector('#showcase-desc') as HTMLElement;
    this.showcaseFingerprintElem = this.element.querySelector('#showcase-fingerprint') as HTMLElement;
    this.showcaseEnterBtn = this.element.querySelector('#btn-showcase-enter') as HTMLButtonElement;
    this.showcasePreviewBtn = this.element.querySelector('#btn-showcase-preview') as HTMLButtonElement;
    this.previewIconElem = this.element.querySelector('#preview-icon') as HTMLElement;
    this.previewTextElem = this.element.querySelector('#preview-text') as HTMLElement;
    this.selectorStripElem = this.element.querySelector('#showcase-strip') as HTMLElement;

    // Custom drop elements
    this.dropZone = this.element.querySelector('#import-drop-zone') as HTMLElement;
    this.fileInput = this.element.querySelector('#import-file-input') as HTMLInputElement;
    this.browseBtn = this.element.querySelector('#btn-browse-file') as HTMLButtonElement;

    // Armory elements
    this.armoryGridElem = this.element.querySelector('#armory-skins-grid') as HTMLElement;
    this.armoryDevToggleBtn = this.element.querySelector('#btn-armory-dev-toggle') as HTMLButtonElement;
    this.decoderPendingElem = this.element.querySelector('#decoder-pending') as HTMLElement;
    this.decoderStatusElem = this.element.querySelector('#decoder-status') as HTMLElement;
    this.decoderDetailElem = this.element.querySelector('#decoder-detail') as HTMLElement;
    this.decoderButton = this.element.querySelector('#btn-decode-signal') as HTMLButtonElement;

    this.buildStrip();
    this.buildLabSelect();
    this.updateShowcaseCard(this.selectedTrack);
    this.initEvents();
  }

  private buildLabSelect(): void {
    this.labMusicSelect.innerHTML = '<option value="NONE">NONE // SILENT SANDBOX</option>';
    this.catalog.forEach((t, idx) => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `[${(idx + 1).toString().padStart(2, '0')}] ${t.title} (${t.bpm} BPM // ${t.difficultyLabel})`;
      this.labMusicSelect.appendChild(opt);
    });
  }

  private buildStrip(): void {
    this.selectorStripElem.innerHTML = '';

    // Build catalog list with slot reserved for optional 00 // CALIBRATION // TUTORIAL
    const itemsToRender: Array<{
      entry: TrackCatalogEntry;
      displayIndex: string;
      isTutorial?: boolean;
    }> = [];

    const tutorialTrack = this.catalog.find(t => t.id === 'tutorial_00' || (t as any).isTutorial);
    if (tutorialTrack) {
      itemsToRender.push({
        entry: tutorialTrack,
        displayIndex: '00',
        isTutorial: true
      });
    }

    let officialIdx = 1;
    for (const t of this.catalog) {
      if (t === tutorialTrack) continue;
      itemsToRender.push({
        entry: t,
        displayIndex: (officialIdx++).toString().padStart(2, '0')
      });
    }

    itemsToRender.forEach(({ entry: t, displayIndex, isTutorial }) => {
      const summary = LeaderboardManager.getInstance().getRecordSummary(t.id);
      const bestRank = summary.bestRank;
      const rankClass = bestRank ? `rank-${bestRank.toLowerCase()}` : '';

      const item = document.createElement('button');
      item.type = 'button';
      item.className = `strip-item terminal-strip-item ${rankClass} ${t.id === this.selectedTrack.id ? 'active' : ''}`;
      item.dataset.trackId = t.id;
      item.setAttribute('aria-pressed', t.id === this.selectedTrack.id ? 'true' : 'false');

      const mins = Math.floor(t.duration / 60);
      const secs = Math.floor(t.duration % 60);
      const duration = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

      item.innerHTML = `
        <div class="strip-item-inner">
          <div class="strip-item-header">
            <span class="strip-item-num">[${displayIndex}] // ${isTutorial ? 'CALIBRATION // TUTORIAL' : t.difficultyLabel}</span>
            ${bestRank ? `<span class="strip-item-rank ${rankClass}">${bestRank}</span>` : ''}
          </div>
          <div class="strip-item-title">${t.title}</div>
          <div class="strip-signal-bars" aria-hidden="true"></div>
          <div class="strip-item-meta"><span>${t.bpm} BPM</span><span>${duration}</span></div>
        </div>
      `;

      const bars = item.querySelector('.strip-signal-bars') as HTMLElement;
      this.renderFingerprint(bars, t, 12);

      item.addEventListener('click', () => {
        this.selectTrack(t);
      });

      this.selectorStripElem.appendChild(item);
    });
  }

  public selectTrack(track: TrackCatalogEntry): void {
    this.stopPreview();
    this.selectedTrack = track;
    this.updateShowcaseCard(track);

    // Update active class on strip items
    const items = this.selectorStripElem.querySelectorAll('.strip-item');
    items.forEach((elem) => {
      if ((elem as HTMLElement).dataset.trackId === track.id) {
        elem.classList.add('active');
        elem.setAttribute('aria-pressed', 'true');
      } else {
        elem.classList.remove('active');
        elem.setAttribute('aria-pressed', 'false');
      }
    });
  }

  public refreshProgression(): void {
    this.buildStrip();
    this.updateShowcaseCard(this.selectedTrack);
  }

  private updateShowcaseCard(t: TrackCatalogEntry): void {
    this.showcaseTitleElem.textContent = t.title;
    this.showcaseArtistElem.textContent = t.artist;
    this.showcaseGenreElem.textContent = t.genre;
    this.showcaseBpmElem.textContent = `${t.bpm} BPM`;

    const mins = Math.floor(t.duration / 60);
    const secs = Math.floor(t.duration % 60);
    this.showcaseDurationElem.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    this.showcaseDiffElem.textContent = `TIER ${'I'.repeat(Math.min(5, t.difficulty))} · ${t.difficultyLabel}`;
    this.showcaseDescElem.textContent = `> ${t.description}`;

    const summary = LeaderboardManager.getInstance().getRecordSummary(t.id);
    const bestRankElem = this.element.querySelector('#showcase-best-rank') as HTMLElement;
    const pbElem = this.element.querySelector('#showcase-pb-time') as HTMLElement;
    const local1Elem = this.element.querySelector('#showcase-local-first') as HTMLElement;

    if (bestRankElem) {
      if (summary.bestRank) {
        bestRankElem.textContent = summary.bestRank;
        bestRankElem.className = `record-val rank-${summary.bestRank.toLowerCase()}`;
      } else {
        bestRankElem.textContent = '—';
        bestRankElem.className = 'record-val';
      }
    }

    if (pbElem) {
      pbElem.textContent = summary.pbTime !== null ? formatTime(summary.pbTime) : '—';
    }

    if (local1Elem) {
      local1Elem.textContent = summary.localFirstTime !== null ? formatTime(summary.localFirstTime) : '—';
    }

    const card = this.element.querySelector('#showcase-card') as HTMLElement;
    if (card) {
      card.style.borderLeftColor = t.accentColor;
    }
    this.showcaseGenreElem.style.borderColor = t.accentColor;
    this.showcaseGenreElem.style.color = t.accentColor;
    this.renderFingerprint(this.showcaseFingerprintElem, t);
  }

  private renderFingerprint(container: HTMLElement, track: TrackCatalogEntry, count = 18): void {
    const fragment = document.createDocumentFragment();
    for (const value of createProgramFingerprint(track.id, track.bpm, track.duration, track.difficulty, count)) {
      const bar = document.createElement('span');
      bar.style.setProperty('--signal-level', value.toString());
      fragment.appendChild(bar);
    }
    container.replaceChildren(fragment);
  }

  public renderArmory(): void {
    this.renderSignalDecoder();
    const isDev = this.skinSystem.isDevPreview();
    this.armoryDevToggleBtn.textContent = `DEV PREVIEW: ${isDev ? 'ACTIVE' : 'OFF'}`;
    this.armoryDevToggleBtn.style.color = isDev ? '#ffdd00' : '#00f0ff';
    this.armoryDevToggleBtn.style.borderColor = isDev ? '#ffdd00' : '#00f0ff';

    const equippedId = this.skinSystem.getEquippedSkinId();
    const skins = this.skinSystem.getSkins();

    this.armoryGridElem.innerHTML = '';
    skins.forEach((skin) => {
      const isEquipped = skin.id === equippedId;
      const isUnlocked = this.skinSystem.isSkinUnlocked(skin.id);
      const progress = this.skinSystem.getSkinProgress(skin.id);

      const card = document.createElement('div');
      card.className = 'terminal-card';
      card.style.padding = '12px 14px';
      card.style.background = isEquipped ? 'rgba(0, 240, 255, 0.08)' : 'var(--bg-surface-elevated)';
      card.style.border = `1px solid ${isEquipped ? '#00f0ff' : 'var(--border-subtle)'}`;
      card.style.borderLeft = `4px solid ${isEquipped ? '#00f0ff' : (isUnlocked ? '#ffffff' : '#444c5c')}`;
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.justifyContent = 'space-between';
      card.style.gap = '10px';

      card.innerHTML = `
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
            <div>
              <div style="font-family: var(--font-mono); font-size: 0.88rem; font-weight: 700; color: ${isEquipped ? '#00f0ff' : (isUnlocked ? 'var(--text-primary)' : '#78889e')};">${skin.name}</div>
              <div style="font-size: 0.68rem; color: #8899aa; font-family: var(--font-mono); margin-top: 2px;">${skin.codename}</div>
            </div>
            <span style="font-size: 0.65rem; font-family: var(--font-mono); color: #00f0ff; border: 1px solid rgba(0,240,255,0.3); padding: 2px 6px;">${skin.paletteTag}</span>
          </div>
          <div style="font-size: 0.72rem; color: #8a9bb2; margin-top: 8px; line-height: 1.35;">${skin.description}</div>
        </div>

        <div style="margin-top: 6px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.06);">
          <div style="font-size: 0.68rem; color: ${isUnlocked ? '#00e5a3' : '#a855f7'}; font-family: var(--font-mono); margin-bottom: 8px;">
            ${isUnlocked ? `[READY // ${skin.shortRequirement}]` : `[REQUIREMENT: ${skin.unlockRequirement} · PROGRESS: ${progress.label}]`}
          </div>
          <div class="armory-action-slot"></div>
        </div>
      `;

      const actionSlot = card.querySelector('.armory-action-slot') as HTMLElement;
      if (isEquipped) {
        actionSlot.innerHTML = `<button disabled style="width: 100%; font-family: var(--font-mono); font-size: 0.78rem; font-weight: 700; color: #00f0ff; background: rgba(0, 240, 255, 0.15); padding: 6px 10px; border: 1px solid #00f0ff; cursor: default;">[EQUIPPED IN LOADOUT]</button>`;
      } else if (isUnlocked) {
        const btn = document.createElement('button');
        btn.textContent = '[▶ EQUIP // DEPLOY TO LOADOUT]';
        btn.style.width = '100%';
        btn.style.fontFamily = 'var(--font-mono)';
        btn.style.fontSize = '0.78rem';
        btn.style.padding = '6px 10px';
        btn.style.background = 'transparent';
        btn.style.border = '1px solid #00f0ff';
        btn.style.color = '#00f0ff';
        btn.style.cursor = 'pointer';
        btn.addEventListener('mouseenter', () => {
          btn.style.background = '#00f0ff';
          btn.style.color = '#000000';
        });
        btn.addEventListener('mouseleave', () => {
          btn.style.background = 'transparent';
          btn.style.color = '#00f0ff';
        });
        btn.addEventListener('click', () => {
          this.skinSystem.equipSkin(skin.id);
          this.renderArmory();
        });
        actionSlot.appendChild(btn);
      } else {
        actionSlot.innerHTML = `<button disabled style="width: 100%; font-family: var(--font-mono); font-size: 0.75rem; color: #5a6678; background: rgba(255,255,255,0.02); border: 1px solid #333a46; padding: 6px 10px; cursor: not-allowed;">[LOCKED // ACCESS RESTRICTED]</button>`;
      }

      this.armoryGridElem.appendChild(card);
    });
  }

  private renderSignalDecoder(): void {
    const pending = this.skinSystem.getPendingDropCount();
    this.decoderPendingElem.textContent = pending.toString();

    if (this.decoderBusy) {
      this.decoderStatusElem.textContent = 'DECODING...';
      this.decoderDetailElem.textContent = 'Interpreting packet signature // resolving Armory payload.';
      this.decoderButton.textContent = '[ DECODING SIGNAL ]';
      this.decoderButton.disabled = true;
      return;
    }

    if (this.lastDecoderReward) {
      const reward = this.lastDecoderReward;
      this.decoderStatusElem.textContent = 'ARMORY SIGNAL FOUND';
      this.decoderStatusElem.dataset.rarity = reward.skin.rarity;
      this.decoderDetailElem.textContent = `${reward.qualityLabel} // ${reward.skin.rarity} // ${reward.skin.name}`;
    } else {
      this.decoderStatusElem.textContent = pending > 0 ? 'SIGNAL ACQUIRED' : 'NO SIGNAL AVAILABLE';
      this.decoderStatusElem.removeAttribute('data-rarity');
      this.decoderDetailElem.textContent = pending > 0
        ? 'Packet ready. Decode to register one permanent Armory cosmetic.'
        : 'Complete official Signal Pack runs to acquire Armory signals.';
    }

    this.decoderButton.disabled = pending === 0;
    this.decoderButton.textContent = pending > 0 ? '[ DECODE SIGNAL ]' : '[ NO SIGNAL AVAILABLE ]';
  }

  public setCallbacks(
    onFileSelected: (file: File) => void,
    onDevTrack: (genre?: SyntheticGenre) => void,
    onError: (err: string) => void,
    onMovementLab?: (trackId?: string) => void,
    onCatalogTrack?: (track: TrackCatalogEntry) => void
  ): void {
    this.onFileSelectedCallback = onFileSelected;
    this.onDevTrackCallback = onDevTrack;
    this.onErrorCallback = onError;
    this.onMovementLabCallback = onMovementLab;
    this.onCatalogTrackCallback = onCatalogTrack;
  }

  public setDecodeModal(modal: import('./SignalDecodeModal').SignalDecodeModal): void {
    this.decodeModal = modal;
  }

  public show(): void {
    this.renderArmory();
    this.element.classList.remove('hidden');
  }

  public hide(): void {
    this.stopPreview();
    this.element.classList.add('hidden');
  }

  private async togglePreview(): Promise<void> {
    if (this.isPreviewPlaying) {
      this.stopPreview();
      return;
    }

    try {
      this.previewTextElem.textContent = '[ SYNTHESIZING... ]';
      this.showcasePreviewBtn.classList.add('playing');

      if (!this.previewCtx) {
        const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.previewCtx = new AudioCtxClass();
      }
      if (this.previewCtx.state === 'suspended') {
        await this.previewCtx.resume();
      }

      const previewBuffer = await this.selectedTrack.generatePreview(this.previewCtx.sampleRate);
      if (!this.previewCtx) return;

      this.currentPreviewSource = this.previewCtx.createBufferSource();
      this.currentPreviewSource.buffer = previewBuffer;

      const gain = this.previewCtx.createGain();
      gain.gain.setValueAtTime(0.75, this.previewCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.previewCtx.currentTime + previewBuffer.duration);

      this.currentPreviewSource.connect(gain);
      gain.connect(this.previewCtx.destination);

      this.currentPreviewSource.onended = () => {
        this.stopPreview();
      };

      this.currentPreviewSource.start(0);
      this.isPreviewPlaying = true;
      this.previewIconElem.textContent = '■';
      this.previewTextElem.textContent = '[ STOP PREVIEW ]';
    } catch (e) {
      console.warn('[ImportScreen] Failed to play preview:', e);
      this.stopPreview();
    }
  }

  private stopPreview(): void {
    if (this.currentPreviewSource) {
      try {
        this.currentPreviewSource.stop();
        this.currentPreviewSource.disconnect();
      } catch {
        // Ignore if already stopped
      }
      this.currentPreviewSource = null;
    }
    this.isPreviewPlaying = false;
    this.previewIconElem.textContent = '▶';
    this.previewTextElem.textContent = '[ AUDITION // PREVIEW ]';
    this.showcasePreviewBtn?.classList.remove('playing');
  }

  private initEvents(): void {
    const tabs = [this.tabShowcaseBtn, this.tabCustomBtn, this.tabLabBtn, this.tabArmoryBtn, this.tabRaceBtn, this.tabLeaderboardBtn];
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => this.switchModule(index));
      tab.addEventListener('keydown', (event) => {
        let nextIndex = index;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = tabs.length - 1;
        else return;

        event.preventDefault();
        this.switchModule(nextIndex);
        tabs[nextIndex].focus();
      });
    });

    this.labEnterBtn.addEventListener('click', () => {
      this.stopPreview();
      const chosen = this.labMusicSelect.value;
      this.onMovementLabCallback?.(chosen === 'NONE' ? undefined : chosen);
    });

    this.armoryDevToggleBtn.addEventListener('click', () => {
      this.skinSystem.toggleDevPreview();
      this.renderArmory();
    });

    if (new URLSearchParams(window.location.search).get('debug') === '1') {
      this.armoryDevToggleBtn.style.display = 'inline-block';
    }

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        const isHidden = this.armoryDevToggleBtn.style.display === 'none' || !this.armoryDevToggleBtn.style.display;
        this.armoryDevToggleBtn.style.display = isHidden ? 'inline-block' : 'none';
      }
    });

    this.decoderButton.addEventListener('click', () => {
      if (this.decoderBusy || this.skinSystem.getPendingDropCount() === 0) return;
      if (this.decodeModal) {
        this.decodeModal.open(() => this.renderArmory());
        return;
      }
      const reward = this.skinSystem.openSignalDrop();
      if (!reward) return;
      this.lastDecoderReward = reward;
      this.decoderBusy = true;
      this.renderSignalDecoder();
      window.setTimeout(() => {
        this.decoderBusy = false;
        this.renderArmory();
      }, 320);
    });

    // Showcase actions
    this.showcaseEnterBtn.addEventListener('click', () => {
      this.stopPreview();
      if (this.onCatalogTrackCallback) {
        this.onCatalogTrackCallback(this.selectedTrack);
      } else {
        this.onDevTrackCallback?.('ELECTRONIC_DROP');
      }
    });

    this.showcasePreviewBtn.addEventListener('click', () => {
      this.togglePreview();
    });

    // Custom drop zone setup
    AudioLoader.setupDropZone(
      this.dropZone,
      (file) => {
        this.stopPreview();
        this.onFileSelectedCallback?.(file);
      },
      (err) => this.onErrorCallback?.(err)
    );

    this.dropZone.addEventListener('click', () => {
      this.fileInput.click();
    });

    this.dropZone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.fileInput.click();
      }
    });

    this.browseBtn.addEventListener('click', () => {
      this.fileInput.click();
    });

    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files && this.fileInput.files.length > 0) {
        const file = this.fileInput.files[0];
        this.stopPreview();
        this.onFileSelectedCallback?.(file);
      }
    });
  }

  private switchModule(activeIndex: number): void {
    const tabs = [this.tabShowcaseBtn, this.tabCustomBtn, this.tabLabBtn, this.tabArmoryBtn, this.tabRaceBtn, this.tabLeaderboardBtn];
    const panels = [
      this.showcasePanel,
      this.customPanel,
      this.labPanel,
      this.armoryPanel,
      this.racePanel.element,
      this.leaderboardPanel.element
    ];
    if (activeIndex !== 0) this.stopPreview();

    tabs.forEach((tab, index) => {
      const active = index === activeIndex;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
      panels[index].classList.toggle('hidden', !active);
      panels[index].setAttribute('aria-hidden', active ? 'false' : 'true');
    });

    if (activeIndex === 3) this.renderArmory();
    if (activeIndex === 5) this.onLeaderboardTabOpened?.();
  }
}
