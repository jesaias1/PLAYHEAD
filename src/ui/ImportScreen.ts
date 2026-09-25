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
import { masteryGloveSystem } from '../mastery/MasteryGloveSystem';
import { getMasteryGlove } from '../mastery/MasteryLadder';
import { DROP_GLOVES, getDropGlove, isDropGloveId } from '../viewmodel/DropGloveCatalog';
import { cosmeticKindLabel } from '../viewmodel/CosmeticDrop';

/** Two-digit zero padding for mastery counters. */
function pad2(n: number): string {
  return Math.max(0, Math.floor(n)).toString().padStart(2, '0');
}
import { KarambitSkinSystem, OpenedSignalDrop } from '../viewmodel/KarambitSkinSystem';
import { createProgramFingerprint } from './SignalIdentity';
import { LeaderboardManager } from '../leaderboard/LeaderboardManager';
import { formatTime } from '../utils/math';
import { RacePanel } from './RacePanel';
import { LeaderboardPanel } from './LeaderboardPanel';
import { OnlineStatusBar } from './OnlineStatusBar';

export class ImportScreen {
  public element: HTMLElement;

  // Tabs
  private tabShowcaseBtn: HTMLButtonElement;
  private tabCustomBtn: HTMLButtonElement;
  private tabLabBtn: HTMLButtonElement;
  private tabArmoryBtn: HTMLButtonElement;
  private tabOnlineBtn: HTMLButtonElement;

  /** 05 // RACE WITH FRIENDS � multiplayer session only. */
  public racePanel: RacePanel = new RacePanel();
  /** 06 // WORLD LEADERBOARD � competitive rankings only. */
  public leaderboardPanel: LeaderboardPanel = new LeaderboardPanel();

  /**
   * The SINGLE global connection indicator. Mounted once in the menu footer,
   * never inside a feature panel, so no page duplicates online status.
   */
  public onlineStatusBar: OnlineStatusBar = new OnlineStatusBar(() => this.onRetryOnlineSync?.());
  public onRetryOnlineSync?: () => void;

  /** Updates the single global connection indicator. */
  public setOnlineStatus(tag: string, detail: string): void {
    this.onlineStatusBar.setStatus(tag, detail);
  }

  /** Local player identity in the footer; the name opens the player's profile. */
  public setPlayerIdentity(displayName: string, onOpenProfile: () => void): void {
    this.onlineStatusBar.setIdentity(displayName, onOpenProfile);
  }

  /** Called when the leaderboard tab is opened (used to refresh the board). */
  public onLeaderboardTabOpened?: () => void;

  /** Opens 05 // ONLINE on the RACE subsection (e.g. from an invite URL). */
  public openRaceTab(): void {
    this.switchModule(4);
    this.switchOnlineSection('race');
  }

  /** Opens 05 // ONLINE on the LEADERBOARD subsection. */
  public openLeaderboardTab(): void {
    this.switchModule(4);
    this.switchOnlineSection('leaderboard');
  }

  /**
   * ONLINE internal sub-navigation.
   *
   * RACE and LEADERBOARD are subsections of one top-level tab, not separate
   * destinations, so the main menu stays clean without losing any functionality.
   */
  public switchOnlineSection(section: 'race' | 'leaderboard'): void {
    const race = section === 'race';
    this.onlineSubnavRace.classList.toggle('active', race);
    this.onlineSubnavLeaderboard.classList.toggle('active', !race);
    this.onlineSubnavRace.setAttribute('aria-selected', race ? 'true' : 'false');
    this.onlineSubnavLeaderboard.setAttribute('aria-selected', race ? 'false' : 'true');
    // Toggle the HOST containers: the panels themselves stay mounted, so no
    // online state is ever torn down by switching sections.
    this.raceHostElem.classList.toggle('hidden', !race);
    this.leaderboardHostElem.classList.toggle('hidden', race);
    if (!race) this.onLeaderboardTabOpened?.();
  }

  /**
   * ARMORY internal sub-navigation.
   *
   * Only ONE cosmetic family is expanded at a time, so the page never becomes a
   * wall of stacked sections.
   */
  public switchArmorySection(section: 'knives' | 'drops' | 'mastery'): void {
    this.armorySection = section;
    for (const btn of this.armorySubnavBtns) {
      const active = btn.dataset.armorySection === section;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    for (const panel of this.armorySectionPanels) {
      panel.classList.toggle('hidden', panel.dataset.armoryPanel !== section);
    }
  }

  public getArmorySection(): 'knives' | 'drops' | 'mastery' {
    return this.armorySection;
  }

  private showcasePanel: HTMLElement;
  private customPanel: HTMLElement;
  /** ONLINE internal sub-nav. */
  private onlineSubnavRace: HTMLButtonElement;
  private onlineSubnavLeaderboard: HTMLButtonElement;
  private raceHostElem: HTMLElement;
  private leaderboardHostElem: HTMLElement;
  /** ARMORY internal sub-nav. */
  private armorySubnavBtns: HTMLButtonElement[] = [];
  private armorySectionPanels: HTMLElement[] = [];
  private armorySection: 'knives' | 'drops' | 'mastery' = 'knives';
  private armoryEquippedKnifeElem: HTMLElement;
  private armoryEquippedGloveElem: HTMLElement;
  private armoryDecoderDetail: HTMLElement;
  private armoryDecoderToggleBtn: HTMLButtonElement;
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
  private showcaseRacePbBtn: HTMLButtonElement;
  private previewIconElem: HTMLElement;
  private previewTextElem: HTMLElement;
  private selectorStripElem: HTMLElement;

  // Custom Drop Elements
  private dropZone: HTMLElement;
  private fileInput: HTMLInputElement;
  private browseBtn: HTMLButtonElement;

  // Armory Elements
  private armoryGridElem: HTMLElement;
  private masterySummaryElem: HTMLElement;
  private masteryGlovesGridElem: HTMLElement;
  private masteryDevPreviewBtn: HTMLButtonElement;
  private dropGlovesGridElem: HTMLElement;
  private showcaseMasteryStripElem: HTMLElement;
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
  private onRacePbGhostCallback?: (trackId: string) => void;
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
          <button class="import-tab-btn" id="tab-btn-armory" type="button" role="tab" aria-selected="false" aria-controls="panel-armory" tabindex="-1">[ 04 // ARMORY ]</button>
        <button class="import-tab-btn" id="tab-btn-online" type="button" role="tab" aria-selected="false" aria-controls="panel-online" tabindex="-1" title="RACE WITH FRIENDS + WORLD LEADERBOARD">[ 05 // ONLINE ]</button>
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
              <button class="btn-preview btn-terminal-action" id="btn-showcase-race-pb" title="Race your personal best as a recorded ghost.">
                PB GHOST // UNAVAILABLE
              </button>
            </div>
          </div>

          <div class="terminal-panel-header" style="margin-top: 8px;">// SYSTEM CATALOG MATRIX · 14 SIGNALS LOADED</div>
          <div class="showcase-selector-strip terminal-selector-strip" id="showcase-strip">
            <!-- Populated dynamically via buildStrip() -->
          </div>
          <div class="showcase-mastery-strip" id="showcase-mastery-strip"></div>
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
          <!-- 1. COMPACT HEADER: identity + equipped state, never huge. -->
          <div class="armory-header">
            <div class="armory-header-title">
              <div class="armory-kicker">[ARMORY] COSMETIC CONTROL</div>
              <h2 class="armory-title">ARMORY</h2>
            </div>
            <div class="armory-equipped" aria-label="Currently equipped">
              <div class="armory-equipped-slot">
                <span>KARAMBIT</span><b id="armory-equipped-knife">--</b>
              </div>
              <div class="armory-equipped-slot">
                <span>GLOVES</span><b id="armory-equipped-glove">--</b>
              </div>
            </div>
            <button id="btn-armory-dev-toggle" class="terminal-btn-subtle armory-dev-toggle" type="button">DEV PREVIEW: OFF</button>
          </div>

          <!-- 2. COMPACT DECODER STRIP: one row by default, detail on demand.
               It must never push the cosmetic catalog down the page. -->
          <section class="armory-decoder-strip" aria-labelledby="signal-decoder-title">
            <div class="decoder-strip-main">
              <span class="decoder-strip-kicker" id="signal-decoder-title">SIGNAL DECODER</span>
              <span class="decoder-strip-status" id="decoder-status">NO SIGNAL AVAILABLE</span>
              <span class="decoder-strip-pending">PENDING <b id="decoder-pending">0</b></span>
              <button id="btn-decode-signal" class="btn-hero btn-terminal-exec decoder-button" type="button">[ NO SIGNAL AVAILABLE ]</button>
              <button id="btn-armory-decoder-toggle" class="terminal-btn-subtle decoder-toggle" type="button" aria-expanded="false">DETAIL</button>
            </div>
            <div class="decoder-strip-detail hidden" id="armory-decoder-detail">
              <div id="decoder-detail" class="decoder-detail">Complete official Signal Pack runs to acquire Armory signals.</div>
              <div class="decoder-quality-grid" aria-label="Rank signal quality">
                <span><b>BRONZE</b> SIGNAL</span>
                <span><b>SILVER</b> ENHANCED ODDS</span>
                <span><b>GOLD</b> HIGH-GRADE</span>
                <span><b>DIAMOND</b> PRISTINE</span>
              </div>
            </div>
          </section>

          <!-- 3. ARMORY SUB-NAV: only one cosmetic family is expanded at a time. -->
          <div class="armory-subnav" role="tablist" aria-label="Armory sections">
            <button class="armory-subnav-btn active" type="button" role="tab" aria-selected="true" data-armory-section="knives">[ KNIVES ]</button>
            <button class="armory-subnav-btn" type="button" role="tab" aria-selected="false" data-armory-section="drops">[ DROP GLOVES ]</button>
            <button class="armory-subnav-btn" type="button" role="tab" aria-selected="false" data-armory-section="mastery">[ MASTERY GLOVES ]</button>
          </div>

          <!-- 4. SECTIONS: responsive card grids, one visible at a time. -->
          <div class="armory-section" data-armory-panel="knives">
            <div class="armory-catalog-heading">[KARAMBIT] CHALLENGE UNLOCKS // COSMETIC CATALOG</div>
            <div id="armory-skins-grid" class="armory-skins-grid">
              <!-- Populated dynamically via renderArmory() -->
            </div>
          </div>

          <div class="armory-section hidden" data-armory-panel="drops">
            <div class="armory-catalog-heading">
              <span>[GLOVES] SIGNAL DROPS // RANDOM REWARDS</span>
            </div>
            <div id="drop-gloves-grid" class="armory-skins-grid"></div>
          </div>

          <div class="armory-section hidden" data-armory-panel="mastery">
            <div class="armory-catalog-heading">
              <span>[GLOVES] MASTERY // EARNED ACHIEVEMENTS</span>
              <button id="btn-mastery-dev-preview" class="terminal-btn-subtle" type="button">DEV // PREVIEW GLOVE</button>
            </div>
            <div class="mastery-summary" id="mastery-summary"></div>
            <div id="mastery-gloves-grid" class="armory-skins-grid"></div>
          </div>
        </div>
        <input type="file" id="import-file-input" accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac" style="display:none;" />

        <!-- 05: ONLINE — RACE and LEADERBOARD are INTERNAL subsections, not
             top-level tabs. The main menu stays clean; the two live panels keep
             their own modules and are mounted into these host slots. -->
        <div class="showcase-container showcase-panel hidden" id="panel-online" role="tabpanel" aria-labelledby="tab-btn-online" aria-hidden="true">
          <div class="online-subnav" role="tablist" aria-label="Online sections">
            <button class="online-subnav-btn active" id="online-subnav-race" type="button" role="tab" aria-selected="true">[ RACE ]</button>
            <button class="online-subnav-btn" id="online-subnav-leaderboard" type="button" role="tab" aria-selected="false">[ LEADERBOARD ]</button>
          </div>
          <div id="race-panel-host"></div>
          <div id="leaderboard-panel-host" class="hidden"></div>
        </div>

        <div class="privacy-notice terminal-footer-status">
          [CLIENT-SIDE AUDIO DSP] · [PROCEDURAL ROUTE GENERATION]
        </div>      </div>
    `;

    // Tab buttons
    this.tabShowcaseBtn = this.element.querySelector('#tab-btn-showcase') as HTMLButtonElement;
    this.tabCustomBtn = this.element.querySelector('#tab-btn-custom') as HTMLButtonElement;
    this.tabLabBtn = this.element.querySelector('#tab-btn-lab') as HTMLButtonElement;
    this.tabArmoryBtn = this.element.querySelector('#tab-btn-armory') as HTMLButtonElement;
    this.tabOnlineBtn = this.element.querySelector('#tab-btn-online') as HTMLButtonElement;

    // ONLINE panels (each owned by its own module; mounted into host slots).
    const raceHost = this.element.querySelector('#race-panel-host') as HTMLElement;
    if (raceHost) raceHost.appendChild(this.racePanel.element);
    const leaderboardHost = this.element.querySelector('#leaderboard-panel-host') as HTMLElement;
    if (leaderboardHost) leaderboardHost.appendChild(this.leaderboardPanel.element);
    this.raceHostElem = raceHost;
    this.leaderboardHostElem = leaderboardHost;
    // The panels ship hidden (they used to be top-level tabs). Now the HOST slots
    // own section visibility, so the panels themselves stay mounted and visible.
    this.racePanel.element.classList.remove('hidden');
    this.leaderboardPanel.element.classList.remove('hidden');

    // ONLINE internal sub-nav.
    this.onlineSubnavRace = this.element.querySelector('#online-subnav-race') as HTMLButtonElement;
    this.onlineSubnavLeaderboard = this.element.querySelector(
      '#online-subnav-leaderboard'
    ) as HTMLButtonElement;
    this.onlineSubnavRace.addEventListener('click', () => this.switchOnlineSection('race'));
    this.onlineSubnavLeaderboard.addEventListener('click', () =>
      this.switchOnlineSection('leaderboard')
    );

    // ARMORY internal sub-nav + compact header + collapsible decoder detail.
    this.armorySubnavBtns = [
      ...this.element.querySelectorAll<HTMLButtonElement>('.armory-subnav-btn')
    ];
    this.armorySectionPanels = [
      ...this.element.querySelectorAll<HTMLElement>('[data-armory-panel]')
    ];
    for (const btn of this.armorySubnavBtns) {
      btn.addEventListener('click', () => {
        const section = btn.dataset.armorySection as 'knives' | 'drops' | 'mastery';
        this.switchArmorySection(section);
      });
    }
    this.armoryEquippedKnifeElem = this.element.querySelector('#armory-equipped-knife') as HTMLElement;
    this.armoryEquippedGloveElem = this.element.querySelector('#armory-equipped-glove') as HTMLElement;
    this.armoryDecoderDetail = this.element.querySelector('#armory-decoder-detail') as HTMLElement;
    this.armoryDecoderToggleBtn = this.element.querySelector(
      '#btn-armory-decoder-toggle'
    ) as HTMLButtonElement;
    this.armoryDecoderToggleBtn.addEventListener('click', () => {
      const open = this.armoryDecoderDetail.classList.toggle('hidden') === false;
      this.armoryDecoderToggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      this.armoryDecoderToggleBtn.textContent = open ? 'HIDE' : 'DETAIL';
    });

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
    this.showcaseRacePbBtn = this.element.querySelector('#btn-showcase-race-pb') as HTMLButtonElement;
    this.previewIconElem = this.element.querySelector('#preview-icon') as HTMLElement;
    this.previewTextElem = this.element.querySelector('#preview-text') as HTMLElement;
    this.selectorStripElem = this.element.querySelector('#showcase-strip') as HTMLElement;

    // Custom drop elements
    this.dropZone = this.element.querySelector('#import-drop-zone') as HTMLElement;
    this.fileInput = this.element.querySelector('#import-file-input') as HTMLInputElement;
    this.browseBtn = this.element.querySelector('#btn-browse-file') as HTMLButtonElement;

    // Armory elements
    this.armoryGridElem = this.element.querySelector('#armory-skins-grid') as HTMLElement;
    this.masterySummaryElem = this.element.querySelector('#mastery-summary') as HTMLElement;
    this.masteryGlovesGridElem = this.element.querySelector('#mastery-gloves-grid') as HTMLElement;
    this.masteryDevPreviewBtn = this.element.querySelector('#btn-mastery-dev-preview') as HTMLButtonElement;
    this.dropGlovesGridElem = this.element.querySelector('#drop-gloves-grid') as HTMLElement;
    this.showcaseMasteryStripElem = this.element.querySelector('#showcase-mastery-strip') as HTMLElement;
    this.armoryDevToggleBtn = this.element.querySelector('#btn-armory-dev-toggle') as HTMLButtonElement;
    this.decoderPendingElem = this.element.querySelector('#decoder-pending') as HTMLElement;
    this.decoderStatusElem = this.element.querySelector('#decoder-status') as HTMLElement;
    this.decoderDetailElem = this.element.querySelector('#decoder-detail') as HTMLElement;
    this.decoderButton = this.element.querySelector('#btn-decode-signal') as HTMLButtonElement;

    this.buildStrip();
    this.buildLabSelect();
    this.updateShowcaseCard(this.selectedTrack);
    this.initEvents();

    // The ONE global connection indicator lives in the footer, not inside any
    // feature panel, so it never duplicates online controls on unrelated pages.
    const footer = this.element.querySelector('.terminal-footer-status') as HTMLElement;
    if (footer) {
      footer.appendChild(document.createTextNode(' · '));
      footer.appendChild(this.onlineStatusBar.element);
    }

    // Normalise tab/panel visibility on load. The panels rely on this rather
    // than on markup order, so a non-default panel can never render below the
    // default tab.
    this.switchModule(0);
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

    // Default the PB-ghost action to unavailable; Game confirms availability
    // once it knows whether a usable recorded replay exists for this track.
    this.setPbGhostAvailability({ available: false, pbTimeSeconds: summary.pbTime });

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
    this.renderMasterySummary();
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

  /**
   * Compact global mastery progress for the Signal Pack.
   *
   * Raw accomplishment counts, not an invented XP scalar. A Diamond track counts
   * toward every lower tier, so these numbers only ever go up.
   */
  public renderMasterySummary(): void {
    const evaluation = masteryGloveSystem.evaluate();
    const s = evaluation.summary;

    if (this.showcaseMasteryStripElem) {
      const parts = [
        `FULL SIGNAL PACK // ${pad2(s.cleared)} / ${pad2(s.total)} CLEARED`,
        `GOLD MASTERY // ${pad2(s.goldPlus)} / ${pad2(s.total)}`,
        `DIAMOND MASTERY // ${pad2(s.diamond)} / ${pad2(s.total)}`
      ];
      this.showcaseMasteryStripElem.innerHTML = parts
        .map((p) => `<span class="showcase-mastery-chip">${p}</span>`)
        .join('');
    }

    if (this.masterySummaryElem) {
      const rows: Array<[string, number]> = [
        ['CLEARED', s.cleared],
        ['BRONZE+', s.bronzePlus],
        ['SILVER+', s.silverPlus],
        ['GOLD+', s.goldPlus],
        ['DIAMOND', s.diamond]
      ];
      // First launch after mastery shipped: report historical recognition in ONE
      // compact line rather than firing a burst of reveals.
      const reconcile = masteryGloveSystem.getLastReconcile();
      const syncNotice =
        reconcile && reconcile.firstRecognition && reconcile.newlyRecognized.length > 1
          ? `<div class="mastery-sync-notice">MASTERY SYNC // ${reconcile.newlyRecognized.length} ACHIEVEMENTS RECOGNIZED</div>`
          : '';
      this.masterySummaryElem.innerHTML =
        `<div class="mastery-summary-title">SIGNAL MASTERY</div>` +
        syncNotice +
        rows
          .map(
            ([label, value]) =>
              `<div class="mastery-summary-row"><span>${label}</span><b>${pad2(value)} / ${pad2(
                s.total
              )}</b></div>`
          )
          .join('');
    }
  }

  /**
   * SIGNAL DROP GLOVES.
   *
   * Clearly labelled as random rewards and kept SEPARATE from the mastery list.
   * Ownership comes from the drop ledger; nothing here can affect mastery
   * eligibility. Locked entries are still previewable so the player can see what
   * exists.
   */
  public renderDropGloves(): void {
    if (!this.dropGlovesGridElem) return;
    const equippedId = masteryGloveSystem.getEquippedGloveId();
    const previewId = masteryGloveSystem.getDevPreviewGloveId();
    this.dropGlovesGridElem.innerHTML = '';

    for (const glove of DROP_GLOVES) {
      const owned = this.skinSystem.isDropGloveOwned(glove.id);
      const isEquipped = glove.id === equippedId;
      const isPreview = glove.id === previewId;

      const card = document.createElement('div');
      card.className = 'mastery-glove-card';
      card.dataset.gloveId = glove.id;
      card.dataset.state = owned ? 'UNLOCKED' : 'LOCKED';
      if (isEquipped) card.classList.add('equipped');
      if (isPreview) card.classList.add('previewing');

      const status = isEquipped
        ? 'EQUIPPED'
        : owned
          ? 'UNLOCKED'
          : 'LOCKED // SIGNAL DROP';

      card.innerHTML =
        `<div class="mastery-glove-head">` +
        `<span class="mastery-glove-name">${glove.name}</span>` +
        `<span class="mastery-glove-tier">${glove.rarity}</span>` +
        `</div>` +
        `<div class="mastery-glove-codename">${glove.codename}</div>` +
        `<div class="mastery-glove-req">SOURCE // SIGNAL DROP</div>` +
        `<div class="mastery-glove-status ${owned ? 'unlocked' : 'locked'}">${status}</div>`;

      const action = document.createElement('button');
      action.className = 'terminal-btn-subtle mastery-glove-action';
      if (isEquipped) {
        action.textContent = '[ EQUIPPED ]';
        action.disabled = true;
      } else if (owned) {
        action.textContent = '[ EQUIP ]';
        action.addEventListener('click', () => {
          masteryGloveSystem.equipAnyGlove(glove.id);
          this.renderArmory();
        });
      } else {
        action.textContent = '[ PREVIEW ]';
        action.addEventListener('click', () => {
          masteryGloveSystem.setDevPreview(isPreview ? null : glove.id);
          this.renderArmory();
        });
      }
      card.appendChild(action);
      this.dropGlovesGridElem.appendChild(card);
    }
  }

  /**
   * MASTERY GLOVES.
   *
   * Locked gloves are always previewable and their requirement is never hidden,
   * so a player always understands exactly what they need to accomplish. Gloves
   * are never random and never appear in the Signal Decoder.
   */
  public renderMasteryGloves(): void {
    if (!this.masteryGlovesGridElem) return;
    const evaluation = masteryGloveSystem.evaluate();
    const equippedId = masteryGloveSystem.getEquippedGloveId();
    const previewId = masteryGloveSystem.getDevPreviewGloveId();

    this.masteryDevPreviewBtn.textContent = previewId
      ? `DEV PREVIEW: ${previewId}`
      : 'DEV // PREVIEW GLOVE';
    this.masteryDevPreviewBtn.style.color = previewId ? '#ffdd00' : '#00f0ff';
    this.masteryDevPreviewBtn.style.borderColor = previewId ? '#ffdd00' : '#00f0ff';

    this.masteryGlovesGridElem.innerHTML = '';

    for (const status of evaluation.gloves) {
      const d = status.definition;
      const isEquipped = d.id === equippedId;
      const isPreview = d.id === previewId;
      const unlocked = status.satisfied;

      const card = document.createElement('div');
      card.className = 'mastery-glove-card';
      card.dataset.gloveId = d.id;
      card.dataset.state = unlocked ? 'UNLOCKED' : 'LOCKED';
      if (isEquipped) card.classList.add('equipped');
      if (isPreview) card.classList.add('previewing');

      const statusLine = isEquipped
        ? 'EQUIPPED'
        : unlocked
          ? 'UNLOCKED'
          : `LOCKED // ${status.progressLabel}`;

      card.innerHTML =
        `<div class="mastery-glove-head">` +
        `<span class="mastery-glove-name">${d.name}</span>` +
        `<span class="mastery-glove-tier">T${d.tier}</span>` +
        `</div>` +
        `<div class="mastery-glove-codename">${d.codename}</div>` +
        `<div class="mastery-glove-req">SOURCE // MASTERY</div>` +
        `<div class="mastery-glove-req">${d.requirementLabel}</div>` +
        `<div class="mastery-glove-status ${unlocked ? 'unlocked' : 'locked'}">${statusLine}</div>`;

      const action = document.createElement('button');
      action.className = 'terminal-btn-subtle mastery-glove-action';
      if (isEquipped) {
        action.textContent = '[ EQUIPPED ]';
        action.disabled = true;
      } else if (unlocked) {
        action.textContent = '[ EQUIP ]';
        action.addEventListener('click', () => {
          masteryGloveSystem.equipGlove(d.id);
          this.renderMasteryGloves();
        });
      } else {
        action.textContent = '[ PREVIEW ]';
        action.addEventListener('click', () => {
          masteryGloveSystem.setDevPreview(isPreview ? null : d.id);
          this.renderMasteryGloves();
        });
      }
      card.appendChild(action);
      this.masteryGlovesGridElem.appendChild(card);
    }
  }

  /**
   * COMPACT ARMORY HEADER.
   *
   * Shows the equipped identity in one line so the player always knows what they
   * are wearing without scrolling. Deliberately small: this is orientation, not
   * a showcase.
   */
  public renderArmoryHeader(): void {
    if (this.armoryEquippedKnifeElem) {
      const skinId = this.skinSystem.getEquippedSkinId();
      let name = '--';
      try {
        name = this.skinSystem.getSkin(skinId).name;
      } catch {
        name = '--';
      }
      this.armoryEquippedKnifeElem.textContent = name;
    }
    if (this.armoryEquippedGloveElem) {
      const gloveId = masteryGloveSystem.getEquippedGloveId();
      if (isDropGloveId(gloveId)) {
        const drop = getDropGlove(gloveId);
        this.armoryEquippedGloveElem.textContent = drop ? `${drop.name} // DROP` : '--';
      } else {
        this.armoryEquippedGloveElem.textContent = `${getMasteryGlove(gloveId).name} // MASTERY`;
      }
    }
  }

  public renderArmory(): void {
    this.renderSignalDecoder();
    this.renderArmoryHeader();
    this.renderMasterySummary();
    this.renderDropGloves();
    this.renderMasteryGloves();
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
      card.style.padding = '10px 12px';
      card.style.background = isEquipped ? 'rgba(0, 240, 255, 0.08)' : 'var(--bg-surface-elevated)';
      card.style.border = `1px solid ${isEquipped ? '#00f0ff' : 'var(--border-subtle)'}`;
      card.style.borderLeft = `4px solid ${isEquipped ? '#00f0ff' : (isUnlocked ? '#ffffff' : '#444c5c')}`;
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.justifyContent = 'space-between';
      card.style.gap = '8px';

      card.innerHTML = `
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
            <div>
              <div style="font-family: var(--font-mono); font-size: 0.88rem; font-weight: 700; color: ${isEquipped ? '#00f0ff' : (isUnlocked ? 'var(--text-primary)' : '#78889e')};">${skin.name}</div>
              <div style="font-size: 0.68rem; color: #8899aa; font-family: var(--font-mono); margin-top: 2px;">${skin.codename}</div>
            </div>
            <span style="font-size: 0.65rem; font-family: var(--font-mono); color: #00f0ff; border: 1px solid rgba(0,240,255,0.3); padding: 2px 6px;">${skin.paletteTag}</span>
          </div>
          <div style="font-size: 0.7rem; color: #8a9bb2; margin-top: 5px; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${skin.description}</div>
        </div>

        <div style="margin-top: 5px; padding-top: 7px; border-top: 1px solid rgba(255,255,255,0.06);">
          <div style="font-size: 0.68rem; color: ${isUnlocked ? '#00e5a3' : '#a855f7'}; font-family: var(--font-mono); margin-bottom: 6px;">
            ${isUnlocked ? `[READY // ${skin.shortRequirement}]` : `[REQUIREMENT: ${skin.unlockRequirement} · PROGRESS: ${progress.label}]`}
          </div>
          <div class="armory-action-slot"></div>
        </div>
      `;

      const actionSlot = card.querySelector('.armory-action-slot') as HTMLElement;
      if (isEquipped) {
        actionSlot.innerHTML = `<button disabled style="width: 100%; font-family: var(--font-mono); font-size: 0.74rem; font-weight: 700; color: #00f0ff; background: rgba(0, 240, 255, 0.15); padding: 5px 10px; border: 1px solid #00f0ff; cursor: default;">[EQUIPPED IN LOADOUT]</button>`;
      } else if (isUnlocked) {
        const btn = document.createElement('button');
        btn.textContent = '[▶ EQUIP // DEPLOY TO LOADOUT]';
        btn.style.width = '100%';
        btn.style.fontFamily = 'var(--font-mono)';
        btn.style.fontSize = '0.74rem';
        btn.style.padding = '5px 10px';
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
        actionSlot.innerHTML = `<button disabled style="width: 100%; font-family: var(--font-mono); font-size: 0.72rem; color: #5a6678; background: rgba(255,255,255,0.02); border: 1px solid #333a46; padding: 5px 10px; cursor: not-allowed;">[LOCKED // ACCESS RESTRICTED]</button>`;
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
      this.decoderStatusElem.dataset.rarity = reward.rarity;
      this.decoderDetailElem.textContent = `${reward.qualityLabel} // ${reward.rarity} // ${cosmeticKindLabel(reward.kind)} // ${reward.name}`;
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

  /**
   * Restrained ghost state for the selected track.
   *
   * The three cases are never conflated: no PB, PB with no replay, PB GHOST
   * (replay matches the PB exactly) and BEST RECORDED GHOST (fastest available
   * replay, slower than the PB). A PB with no replay must NOT offer a fake
   * action, so the button is disabled and says so.
   */
  public setPbGhostAvailability(state: {
    available: boolean;
    pbTimeSeconds?: number | null;
    actionText?: string;
    state?: string;
  }): void {
    if (!this.showcaseRacePbBtn) return;
    if (state.available) {
      this.showcaseRacePbBtn.disabled = false;
      this.showcaseRacePbBtn.textContent = state.actionText ?? '> RACE PB GHOST';
      this.showcaseRacePbBtn.classList.add('available');
    } else {
      this.showcaseRacePbBtn.disabled = true;
      this.showcaseRacePbBtn.textContent =
        state.actionText ??
        (state.pbTimeSeconds ? 'PB GHOST // NO REPLAY' : 'PB GHOST // NO PERSONAL BEST');
      this.showcaseRacePbBtn.classList.remove('available');
    }
    this.showcaseRacePbBtn.dataset.ghostState = state.state ?? '';
  }

  public setCallbacks(
    onFileSelected: (file: File) => void,
    onDevTrack: (genre?: SyntheticGenre) => void,
    onError: (err: string) => void,
    onMovementLab?: (trackId?: string) => void,
    onCatalogTrack?: (track: TrackCatalogEntry) => void,
    onRacePbGhost?: (trackId: string) => void
  ): void {
    this.onFileSelectedCallback = onFileSelected;
    this.onDevTrackCallback = onDevTrack;
    this.onErrorCallback = onError;
    this.onMovementLabCallback = onMovementLab;
    this.onCatalogTrackCallback = onCatalogTrack;
    this.onRacePbGhostCallback = onRacePbGhost;
  }

  public setDecodeModal(modal: import('./SignalDecodeModal').SignalDecodeModal): void {
    this.decodeModal = modal;
  }

  /**
   * Catalog entry for a track id. Used by ghost racing to enter the level that a
   * recorded run actually belongs to.
   */
  public getCatalogEntry(trackId: string): TrackCatalogEntry | null {
    return this.catalog.find((t) => t.id === trackId) ?? null;
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
    const tabs = [this.tabShowcaseBtn, this.tabCustomBtn, this.tabLabBtn, this.tabArmoryBtn, this.tabOnlineBtn];
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => this.switchModule(index));
      tab.addEventListener('keydown', (event: KeyboardEvent) => {
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

    this.showcaseRacePbBtn.addEventListener('click', () => {
      if (this.showcaseRacePbBtn.disabled) return;
      this.stopPreview();
      this.onRacePbGhostCallback?.(this.selectedTrack.id);
    });

    this.masteryDevPreviewBtn.addEventListener('click', () => {
      // DEV ONLY: cycles a visual preview. Never writes ownership or progress.
      const gloves = masteryGloveSystem.evaluate().gloves;
      const current = masteryGloveSystem.getDevPreviewGloveId();
      const index = gloves.findIndex((g) => g.definition.id === current);
      const next = index < 0 ? gloves[0] : gloves[(index + 1) % gloves.length];
      masteryGloveSystem.setDevPreview(index >= gloves.length - 1 ? null : next.definition.id);
      this.renderMasteryGloves();
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
    const tabs = [this.tabShowcaseBtn, this.tabCustomBtn, this.tabLabBtn, this.tabArmoryBtn, this.tabOnlineBtn];
    const panels = [
      this.showcasePanel,
      this.customPanel,
      this.labPanel,
      this.armoryPanel,
      this.element.querySelector('#panel-online') as HTMLElement
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
  }
}
