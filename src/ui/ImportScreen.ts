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
import {
  ArmoryItem,
  ArmorySlot,
  ArmorySort,
  GloveFamilyFilter,
  OwnershipFilter,
  buildArmoryItems,
  filterArmoryItems,
  inventoryCountLabel,
  isEquippable,
  resolveSelection
} from './ArmoryInventory';

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
   * ARMORY primary slot navigation.
   *
   * Exactly ONE equipment slot is browsed at a time. Knives and gloves are
   * different equipment, so they are different slots — not two sections of one
   * page. The glove slot carries its own family filter.
   */
  public switchArmorySlot(slot: ArmorySlot): void {
    this.armorySlot = slot;
    this.armorySelectedId = null;
    this.renderArmory();
  }

  public getArmorySlot(): ArmorySlot {
    return this.armorySlot;
  }

  /** Secondary glove filter: SIGNAL DROP and MASTERY share the glove slot. */
  public setArmoryGloveFamily(family: GloveFamilyFilter): void {
    this.armoryGloveFamily = family;
    this.armorySelectedId = null;
    this.renderArmory();
  }

  public getArmoryGloveFamily(): GloveFamilyFilter {
    return this.armoryGloveFamily;
  }

  public setArmoryOwnershipFilter(ownership: OwnershipFilter): void {
    this.armoryOwnership = ownership;
    this.armorySelectedId = null;
    this.renderArmory();
  }

  public getArmoryOwnershipFilter(): OwnershipFilter {
    return this.armoryOwnership;
  }

  public setArmorySort(sort: ArmorySort): void {
    this.armorySort = sort;
    this.renderArmory();
  }

  public getArmorySort(): ArmorySort {
    return this.armorySort;
  }

  /** The item currently shown in the detail panel, if any. */
  public getArmorySelectedId(): string | null {
    return this.armorySelectedId;
  }

  /** Selects a tile. Selection never equips; it only updates the detail panel. */
  public selectArmoryItem(id: string): void {
    this.armorySelectedId = id;
    this.renderArmorySelection();
  }

  private showcasePanel: HTMLElement;
  private customPanel: HTMLElement;
  /** ONLINE internal sub-nav. */
  private onlineSubnavRace: HTMLButtonElement;
  private onlineSubnavLeaderboard: HTMLButtonElement;
  private raceHostElem: HTMLElement;
  private leaderboardHostElem: HTMLElement;
  /** ARMORY inventory: one slot browser, filters, and a single detail panel. */
  private armorySlotBtns: HTMLButtonElement[] = [];
  private armoryFilterBtns: HTMLButtonElement[] = [];
  private armoryGloveFilterGroup: HTMLElement;
  private armoryInventoryElem: HTMLElement;
  private armoryDetailElem: HTMLElement;
  private armoryCountElem: HTMLElement;
  private armoryMasteryStatusElem: HTMLElement;
  private armoryMasteryRowsElem: HTMLElement;
  private armoryViewRewardBtn: HTMLButtonElement;
  private armoryEquippedKnifeElem: HTMLElement;
  private armoryEquippedGloveElem: HTMLElement;
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
  private masteryDevPreviewBtn: HTMLButtonElement;
  private showcaseMasteryStripElem: HTMLElement;
  private armoryDevToggleBtn: HTMLButtonElement;
  private decoderPendingElem: HTMLElement;
  private decoderStatusElem: HTMLElement;
  private decoderDetailElem: HTMLElement;
  private decoderButton: HTMLButtonElement;

  // Armory browsing state. Exactly one slot is browsed at a time.
  private armorySlot: ArmorySlot = 'karambit';
  private armoryGloveFamily: GloveFamilyFilter = 'all';
  private armoryOwnership: OwnershipFilter = 'all';
  private armorySort: ArmorySort = 'rarity';
  private armorySelectedId: string | null = null;
  /** Built once per render; filtering never re-reads ownership. */
  private armoryItems: ArmoryItem[] = [];

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

        <!-- 04: ARMORY — LOADOUT INVENTORY.
             Compact header, ONE equipment slot at a time, a dense tile grid and
             ONE detail panel. Browsing is metadata-only: no tile ever loads a
             cosmetic texture or video. -->
        <div class="showcase-container showcase-panel hidden" id="panel-armory" role="tabpanel" aria-labelledby="tab-btn-armory" aria-hidden="true">
          <!-- 1. COMPACT HEADER: what am I wearing + how many drops are waiting. -->
          <div class="armory-header">
            <div class="armory-header-title">
              <div class="armory-kicker">[ARMORY] LOADOUT INVENTORY</div>
              <h2 class="armory-title">ARMORY</h2>
            </div>
            <div class="armory-loadout" aria-label="Current loadout">
              <div class="armory-loadout-slot">
                <span>KARAMBIT</span><b id="armory-equipped-knife">--</b>
              </div>
              <div class="armory-loadout-slot">
                <span>GLOVES</span><b id="armory-equipped-glove">--</b>
              </div>
            </div>
            <div class="armory-drops">
              <span class="armory-drops-count">SIGNAL DROPS // <b id="decoder-pending">00</b></span>
              <button id="btn-decode-signal" class="armory-decrypt-btn" type="button" title="Rank signal quality: BRONZE signal · SILVER enhanced odds · GOLD high-grade · DIAMOND pristine">[ DECRYPT ]</button>
            </div>
            <button id="btn-armory-dev-toggle" class="terminal-btn-subtle armory-dev-toggle" type="button">DEV PREVIEW: OFF</button>
          </div>

          <!-- 2. DECODER STATE: ONE line. The decoder experience itself opens from
               [ DECRYPT ] and must never consume permanent Armory height. -->
          <div class="armory-decoder-line" id="armory-decoder-line">
            <span class="decoder-strip-kicker">SIGNAL DECODER</span>
            <span class="decoder-status" id="decoder-status">NO SIGNAL AVAILABLE</span>
            <span class="decoder-detail" id="decoder-detail">Complete official Signal Pack runs to acquire Armory signals.</span>
            <button id="btn-armory-view-reward" class="terminal-btn-subtle armory-view-reward hidden" type="button">[ VIEW IN ARMORY ]</button>
          </div>

          <!-- 3. PRIMARY SLOT NAV: exactly one equipment slot is browsed at once. -->
          <div class="armory-slots" role="tablist" aria-label="Equipment slot">
            <button class="armory-slot-btn active" type="button" role="tab" aria-selected="true" data-armory-slot="karambit">[ KARAMBIT ]</button>
            <button class="armory-slot-btn" type="button" role="tab" aria-selected="false" data-armory-slot="gloves">[ GLOVES ]</button>
          </div>

          <!-- 4. FILTER BAR: glove family (gloves only) + ownership + sort. -->
          <div class="armory-filters">
            <div class="armory-filter-group hidden" id="armory-glove-filters" aria-label="Glove family">
              <button class="armory-filter-btn active" type="button" data-glove-family="all">ALL</button>
              <button class="armory-filter-btn" type="button" data-glove-family="drop">SIGNAL DROP</button>
              <button class="armory-filter-btn" type="button" data-glove-family="mastery">MASTERY</button>
            </div>
            <div class="armory-filter-group" aria-label="Ownership filter">
              <button class="armory-filter-btn active" type="button" data-owned-filter="all">ALL</button>
              <button class="armory-filter-btn" type="button" data-owned-filter="owned">OWNED</button>
              <button class="armory-filter-btn" type="button" data-owned-filter="locked">LOCKED</button>
            </div>
            <div class="armory-filter-group" aria-label="Sort order">
              <span class="armory-filter-label">SORT</span>
              <button class="armory-filter-btn active" type="button" data-armory-sort="rarity">RARITY</button>
              <button class="armory-filter-btn" type="button" data-armory-sort="name">NAME</button>
            </div>
            <span class="armory-count" id="armory-count">00 ITEMS</span>
          </div>

          <!-- 5. MASTERY STATUS: compact, and only while browsing mastery gloves. -->
          <div class="armory-mastery-status hidden" id="armory-mastery-status">
            <div class="armory-mastery-rows" id="armory-mastery-rows"></div>
            <button id="btn-mastery-dev-preview" class="terminal-btn-subtle" type="button">DEV // PREVIEW GLOVE</button>
          </div>

          <!-- 6. TWO PANE: dense inventory + ONE detail panel. -->
          <div class="armory-body">
            <div id="armory-inventory" class="armory-inventory" role="listbox" aria-label="Cosmetics"></div>
            <aside class="armory-detail" id="armory-detail" aria-live="polite"></aside>
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

    // ARMORY: slot nav, filters, inventory grid and the single detail panel.
    this.armorySlotBtns = [
      ...this.element.querySelectorAll<HTMLButtonElement>('.armory-slot-btn')
    ];
    for (const btn of this.armorySlotBtns) {
      btn.addEventListener('click', () => {
        this.switchArmorySlot(btn.dataset.armorySlot as ArmorySlot);
      });
    }
    this.armoryFilterBtns = [
      ...this.element.querySelectorAll<HTMLButtonElement>('.armory-filter-btn')
    ];
    for (const btn of this.armoryFilterBtns) {
      btn.addEventListener('click', () => {
        if (btn.dataset.gloveFamily) {
          this.setArmoryGloveFamily(btn.dataset.gloveFamily as GloveFamilyFilter);
        } else if (btn.dataset.ownedFilter) {
          this.setArmoryOwnershipFilter(btn.dataset.ownedFilter as OwnershipFilter);
        } else if (btn.dataset.armorySort) {
          this.setArmorySort(btn.dataset.armorySort as ArmorySort);
        }
      });
    }
    this.armoryEquippedKnifeElem = this.element.querySelector('#armory-equipped-knife') as HTMLElement;
    this.armoryEquippedGloveElem = this.element.querySelector('#armory-equipped-glove') as HTMLElement;
    this.armoryGloveFilterGroup = this.element.querySelector('#armory-glove-filters') as HTMLElement;
    this.armoryInventoryElem = this.element.querySelector('#armory-inventory') as HTMLElement;
    this.armoryDetailElem = this.element.querySelector('#armory-detail') as HTMLElement;
    this.armoryCountElem = this.element.querySelector('#armory-count') as HTMLElement;
    this.armoryMasteryStatusElem = this.element.querySelector(
      '#armory-mastery-status'
    ) as HTMLElement;
    this.armoryMasteryRowsElem = this.element.querySelector('#armory-mastery-rows') as HTMLElement;
    this.armoryViewRewardBtn = this.element.querySelector(
      '#btn-armory-view-reward'
    ) as HTMLButtonElement;
    this.armoryViewRewardBtn.addEventListener('click', () => this.viewDecoderRewardInArmory());

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
    this.masteryDevPreviewBtn = this.element.querySelector('#btn-mastery-dev-preview') as HTMLButtonElement;
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
  /**
   * Showcase mastery chips (Signal Pack tab only).
   *
   * The full mastery breakdown is no longer permanent Armory furniture: it
   * appears in the Armory only while browsing MASTERY gloves.
   */
  public renderMasterySummary(): void {
    if (!this.showcaseMasteryStripElem) return;
    const s = masteryGloveSystem.evaluate().summary;
    const parts = [
      `FULL SIGNAL PACK // ${pad2(s.cleared)} / ${pad2(s.total)} CLEARED`,
      `GOLD MASTERY // ${pad2(s.goldPlus)} / ${pad2(s.total)}`,
      `DIAMOND MASTERY // ${pad2(s.diamond)} / ${pad2(s.total)}`
    ];
    this.showcaseMasteryStripElem.innerHTML = parts
      .map((p) => `<span class="showcase-mastery-chip">${p}</span>`)
      .join('');
  }

  // =========================================================================
  // ARMORY — LOADOUT INVENTORY
  // =========================================================================

  /**
   * Rebuild the browsable item list from authoritative ownership.
   *
   * This is the ONLY place the Armory reads ownership, and it reads METADATA
   * only: no cosmetic texture, video or preview handle is touched. Loading a
   * real asset stays a PREVIEW / EQUIP-time concern.
   */
  private buildArmoryItems(): ArmoryItem[] {
    return buildArmoryItems({
      skins: this.skinSystem.getSkins(),
      skinOwned: (id) => this.skinSystem.isSkinUnlocked(id),
      skinProgress: (id) => this.skinSystem.getSkinProgress(id).label,
      equippedKnifeId: this.skinSystem.getEquippedSkinId(),
      dropGloves: DROP_GLOVES,
      dropOwned: (id) => this.skinSystem.isDropGloveOwned(id),
      masteryGloves: masteryGloveSystem.evaluate().gloves,
      equippedGloveId: masteryGloveSystem.getEquippedGloveId()
    });
  }

  private visibleArmoryItems(): ArmoryItem[] {
    return filterArmoryItems(this.armoryItems, {
      slot: this.armorySlot,
      gloveFamily: this.armoryGloveFamily,
      ownership: this.armoryOwnership,
      sort: this.armorySort
    });
  }

  /** Full Armory render: header, chrome, inventory and detail. */
  public renderArmory(): void {
    this.armoryItems = this.buildArmoryItems();
    this.renderArmoryHeader();
    this.renderArmorySelection();
    this.renderSignalDecoder();
  }

  /** Re-render the browsing surface WITHOUT re-reading ownership. */
  private renderArmorySelection(): void {
    const visible = this.visibleArmoryItems();
    this.renderArmoryChrome(visible);
    this.renderArmoryInventory(visible);
    this.renderArmoryDetail(visible);
  }

  /**
   * COMPACT HEADER — "what am I currently wearing?"
   *
   * Orientation only; it must never grow into a showcase. The glove family is
   * stated because a SIGNAL DROP glove and a MASTERY glove must never blur.
   */
  public renderArmoryHeader(): void {
    if (this.armoryEquippedKnifeElem) {
      let name = '--';
      try {
        name = this.skinSystem.getSkin(this.skinSystem.getEquippedSkinId()).name;
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

  /** Slot nav, family/ownership/sort filters, counter and mastery status. */
  private renderArmoryChrome(visible: readonly ArmoryItem[]): void {
    for (const btn of this.armorySlotBtns) {
      const active = btn.dataset.armorySlot === this.armorySlot;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    }

    // The family filter only means anything for the glove slot: knives have no
    // second acquisition family.
    this.armoryGloveFilterGroup.classList.toggle('hidden', this.armorySlot !== 'gloves');

    for (const btn of this.armoryFilterBtns) {
      if (btn.dataset.gloveFamily) {
        btn.classList.toggle('active', btn.dataset.gloveFamily === this.armoryGloveFamily);
      } else if (btn.dataset.ownedFilter) {
        btn.classList.toggle('active', btn.dataset.ownedFilter === this.armoryOwnership);
      } else if (btn.dataset.armorySort) {
        btn.classList.toggle('active', btn.dataset.armorySort === this.armorySort);
      }
    }

    if (this.armoryCountElem) {
      this.armoryCountElem.textContent = inventoryCountLabel(visible.length);
    }

    this.renderArmoryMasteryStatus();
  }

  /**
   * MASTERY STATUS — compact, and ONLY while browsing mastery gloves.
   *
   * Browsing knives must never be crowded by glove achievement data.
   */
  private renderArmoryMasteryStatus(): void {
    if (!this.armoryMasteryStatusElem) return;
    const show = this.armorySlot === 'gloves' && this.armoryGloveFamily === 'mastery';
    this.armoryMasteryStatusElem.classList.toggle('hidden', !show);
    if (!show) return;
    const s = masteryGloveSystem.evaluate().summary;
    this.armoryMasteryRowsElem.innerHTML =
      `<span class="armory-mastery-chip">SIGNAL MASTERY</span>` +
      `<span class="armory-mastery-chip">GOLD+ <b>${pad2(s.goldPlus)}/${pad2(s.total)}</b></span>` +
      `<span class="armory-mastery-chip">DIAMOND <b>${pad2(s.diamond)}/${pad2(s.total)}</b></span>`;
  }

  private renderArmoryInventory(visible: readonly ArmoryItem[]): void {
    if (!this.armoryInventoryElem) return;
    this.armorySelectedId = resolveSelection(visible, this.armorySelectedId)?.id ?? null;
    this.armoryInventoryElem.innerHTML = '';

    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'armory-inventory-empty';
      empty.textContent = 'NO ITEMS MATCH THE CURRENT FILTER';
      this.armoryInventoryElem.appendChild(empty);
      return;
    }

    for (const item of visible) {
      this.armoryInventoryElem.appendChild(this.buildArmoryTile(item));
    }
  }

  /**
   * COMPACT INVENTORY TILE.
   *
   * Name, rarity, ownership/equipped marker, and a zero-asset palette swatch.
   * Description, source, requirement and actions deliberately live in the detail
   * panel instead of being repeated on every tile.
   */
  private buildArmoryTile(item: ArmoryItem): HTMLElement {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'armory-tile';
    tile.dataset.itemId = item.id;
    tile.dataset.family = item.family;
    tile.dataset.rarity = item.rarity;
    tile.dataset.state = item.owned ? 'OWNED' : 'LOCKED';
    tile.setAttribute('role', 'option');
    tile.setAttribute('aria-selected', item.id === this.armorySelectedId ? 'true' : 'false');
    tile.setAttribute(
      'aria-label',
      `${item.name} // ${item.rarity}${
        item.equipped ? ' // EQUIPPED' : item.owned ? ' // OWNED' : ' // LOCKED'
      }`
    );
    tile.style.setProperty('--tile-accent', item.swatch);
    if (item.id === this.armorySelectedId) tile.classList.add('selected');
    if (item.equipped) tile.classList.add('equipped');
    if (!item.owned) tile.classList.add('locked');

    const mark = item.equipped ? '✓' : item.owned ? '·' : '⊘';
    tile.innerHTML =
      `<span class="armory-tile-swatch" aria-hidden="true"></span>` +
      `<span class="armory-tile-name">${item.name}</span>` +
      `<span class="armory-tile-foot">` +
      `<span class="armory-tile-rarity">${item.rarity}</span>` +
      `<span class="armory-tile-mark" aria-hidden="true">${mark}</span>` +
      `</span>`;

    tile.addEventListener('click', () => this.selectArmoryItem(item.id));
    return tile;
  }

  /**
   * THE SINGLE DETAIL PANEL.
   *
   * Everything long lives here exactly ONCE: description, source, requirement,
   * progress and the actions. This is what keeps the grid scannable.
   */
  private renderArmoryDetail(visible: readonly ArmoryItem[]): void {
    if (!this.armoryDetailElem) return;
    const item = resolveSelection(visible, this.armorySelectedId);
    this.armorySelectedId = item?.id ?? null;

    if (!item) {
      this.armoryDetailElem.innerHTML =
        `<div class="armory-detail-empty">SELECT AN ITEM TO INSPECT</div>`;
      return;
    }

    const statusLabel = item.equipped ? 'EQUIPPED' : item.owned ? 'OWNED' : 'LOCKED';
    const statusClass = item.equipped ? 'equipped' : item.owned ? 'owned' : 'locked';

    const rows: Array<[string, string]> = [
      ['SOURCE', item.source],
      ['REQUIREMENT', item.requirement]
    ];
    if (item.progress) rows.push(['PROGRESS', item.progress]);

    this.armoryDetailElem.innerHTML =
      `<div class="armory-detail-inner" style="--detail-accent: ${item.swatch};">` +
      `<div class="armory-detail-rarity">${item.rarity}${
        item.isLive ? ' // LIVE VIDEO ARTIFACT' : ''
      }</div>` +
      `<div class="armory-detail-name">${item.name}</div>` +
      `<div class="armory-detail-codename">${item.codename}</div>` +
      `<div class="armory-detail-status ${statusClass}">${statusLabel}</div>` +
      `<div class="armory-detail-desc">${item.description}</div>` +
      `<div class="armory-detail-rows">` +
      rows
        .map(
          ([k, v]) => `<div class="armory-detail-row"><span>${k}</span><b>${v}</b></div>`
        )
        .join('') +
      `</div>` +
      `<div class="armory-detail-actions"></div>` +
      `</div>`;

    this.renderArmoryDetailActions(item);
  }

  /**
   * Detail actions.
   *
   * The preview architecture is UNCHANGED: the app has exactly one viewmodel, so
   * a cosmetic is previewed by being worn — no second scene, no eager asset load.
   * Locked gloves keep the existing DEV-preview affordance; locked knives cannot
   * be worn and say so rather than offering a fake action.
   */
  private renderArmoryDetailActions(item: ArmoryItem): void {
    const slot = this.armoryDetailElem?.querySelector('.armory-detail-actions') as HTMLElement;
    if (!slot) return;
    slot.innerHTML = '';

    if (item.equipped) {
      slot.appendChild(
        this.buildArmoryAction('[ EQUIPPED ]', true, () => undefined, 'primary')
      );
      return;
    }

    if (isEquippable(item)) {
      slot.appendChild(
        this.buildArmoryAction('[ EQUIP ]', false, () => this.equipArmoryItem(item), 'primary')
      );
      return;
    }

    if (item.family === 'karambit') {
      slot.appendChild(
        this.buildArmoryAction('[ LOCKED // COMPLETE TO UNLOCK ]', true, () => undefined)
      );
      return;
    }

    // Locked gloves remain previewable, exactly as before.
    const previewId = masteryGloveSystem.getDevPreviewGloveId();
    const isPreviewing = previewId === item.id;
    slot.appendChild(
      this.buildArmoryAction(isPreviewing ? '[ STOP PREVIEW ]' : '[ PREVIEW ]', false, () => {
        masteryGloveSystem.setDevPreview(isPreviewing ? null : item.id);
        this.renderArmorySelection();
      })
    );
  }

  private buildArmoryAction(
    label: string,
    disabled: boolean,
    onClick: () => void,
    variant?: 'primary'
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `armory-action-btn${variant ? ` ${variant}` : ''}`;
    btn.textContent = label;
    btn.disabled = disabled;
    if (!disabled) btn.addEventListener('click', onClick);
    return btn;
  }

  /** Equip a cosmetic. Knives and gloves have separate equip paths. */
  private equipArmoryItem(item: ArmoryItem): void {
    if (item.family === 'karambit') {
      this.skinSystem.equipSkin(item.id);
    } else {
      masteryGloveSystem.equipAnyGlove(item.id);
    }
    this.renderArmory();
  }

  /**
   * Jump to the cosmetic that was just decoded: correct slot, correct family
   * filter, selected in the detail panel.
   */
  public viewDecoderRewardInArmory(): void {
    const reward = this.lastDecoderReward;
    if (!reward) return;
    const item = this.armoryItems.find((i) => i.id === reward.item.id);
    if (!item) return;
    this.armorySlot = item.slot;
    if (item.slot === 'gloves') this.armoryGloveFamily = 'all';
    this.armoryOwnership = 'all';
    this.armorySelectedId = item.id;
    this.renderArmory();
  }

  /**
   * COMPACT DECODER STATE.
   *
   * ONE line of state plus the [ DECRYPT ] trigger in the header. The decoder
   * experience itself is the existing modal; this only reports availability, so
   * the decoder never consumes permanent Armory height.
   */
  private renderSignalDecoder(): void {
    const pending = this.skinSystem.getPendingDropCount();
    this.decoderPendingElem.textContent = pad2(pending);

    if (this.decoderBusy) {
      this.decoderStatusElem.textContent = 'DECODING...';
      this.decoderDetailElem.textContent =
        'Interpreting packet signature // resolving Armory payload.';
      this.decoderButton.disabled = true;
      this.armoryViewRewardBtn.classList.add('hidden');
      return;
    }

    if (this.lastDecoderReward) {
      const reward = this.lastDecoderReward;
      this.decoderStatusElem.textContent = 'ARMORY SIGNAL FOUND';
      this.decoderStatusElem.dataset.rarity = reward.rarity;
      this.decoderDetailElem.textContent = `${reward.qualityLabel} // ${reward.rarity} // ${cosmeticKindLabel(
        reward.kind
      )} // ${reward.name}`;
      this.armoryViewRewardBtn.classList.remove('hidden');
    } else {
      this.decoderStatusElem.textContent = pending > 0 ? 'SIGNAL ACQUIRED' : 'NO SIGNAL AVAILABLE';
      this.decoderStatusElem.removeAttribute('data-rarity');
      this.decoderDetailElem.textContent =
        pending > 0
          ? 'Packet ready. Decode to register one permanent Armory cosmetic.'
          : 'Complete official Signal Pack runs to acquire Armory signals.';
      this.armoryViewRewardBtn.classList.add('hidden');
    }

    this.decoderButton.disabled = pending === 0;
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
      this.renderArmorySelection();
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

    // The Armory is a dense inventory: it earns a wider console than the
    // single-column reading panels, and it starts at the top of the screen so
    // the sticky navigation is pinned where the player expects it.
    this.element
      .querySelector('.import-container')
      ?.classList.toggle('import-container--inventory', activeIndex === 3);
    this.element.classList.toggle('import-screen--top', activeIndex === 3);

    if (activeIndex === 3) this.renderArmory();
  }
}
