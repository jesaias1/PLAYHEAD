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
import { KarambitSkinSystem } from '../viewmodel/KarambitSkinSystem';

export class ImportScreen {
  public element: HTMLElement;

  // Tabs
  private tabShowcaseBtn: HTMLButtonElement;
  private tabCustomBtn: HTMLButtonElement;
  private tabLabBtn: HTMLButtonElement;
  private tabArmoryBtn: HTMLButtonElement;

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

  // State
  private catalog: TrackCatalogEntry[];
  private selectedTrack: TrackCatalogEntry;
  private isPreviewPlaying = false;
  private previewCtx: AudioContext | null = null;
  private currentPreviewSource: AudioBufferSourceNode | null = null;
  private skinSystem = KarambitSkinSystem.getInstance();

  private onFileSelectedCallback?: (file: File) => void;
  private onCatalogTrackCallback?: (track: TrackCatalogEntry) => void;
  private onDevTrackCallback?: (genre?: SyntheticGenre) => void;
  private onErrorCallback?: (err: string) => void;
  private onMovementLabCallback?: (trackId?: string) => void;

  constructor() {
    this.catalog = MusicPack.getCatalog();
    this.selectedTrack = this.catalog[0]; // Default track

    this.element = document.createElement('div');
    this.element.className = 'screen import-screen';
    this.element.innerHTML = `
      <div class="import-container terminal-console">
        <div class="terminal-top-telemetry">
          <span class="telemetry-item">[SYS: ONLINE]</span>
          <span class="telemetry-item">[DSP KERNEL: V2.4_STABLE]</span>
          <span class="telemetry-item">[AUDIO PIPELINE: READY]</span>
          <span class="telemetry-item signal">[STATUS: READY]</span>
        </div>

        <div class="brand-header">
          <div class="brand-eyebrow">// ARCHITECTURAL AUDIO SYSTEM · TERMINAL CONSOLE</div>
          <div class="brand-title-wrap">
            <img src="/assets/brand/playhead_logo_text.png" class="brand-logo-text" alt="PLAYHEAD" />
            <img src="/assets/brand/playhead_mascot.png" class="brand-logo-mascot" alt="PLAYHEAD" />
          </div>
          <p class="brand-tagline">> SELECT FREQUENCY. ENTER THE SIGNAL.</p>
        </div>

        <div class="import-tabs terminal-tabs">
          <button class="import-tab-btn active" id="tab-btn-showcase">[ 01 // SIGNAL PACK ]</button>
          <button class="import-tab-btn" id="tab-btn-custom">[ 02 // CUSTOM AUDIO ]</button>
          <button class="import-tab-btn" id="tab-btn-lab">[ 03 // MOVEMENT LAB ]</button>
          <button class="import-tab-btn" id="tab-btn-armory">[ 04 // KARAMBIT ARMORY ]</button>
        </div>

        <!-- 01: THE SIGNAL PACK PANEL -->
        <div class="showcase-container showcase-panel" id="panel-showcase">
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

            <div class="showcase-desc" id="showcase-desc">
              Introductory rhythm run with gentle momentum hops, broad landing pads, and relaxing surf curves.
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
        <div class="custom-panel terminal-panel hidden" id="panel-custom">
          <div class="terminal-panel-header">// EXTERNAL SIGNAL INJECTION</div>
          <div class="import-drop-zone terminal-drop-zone" id="import-drop-zone">
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
        <div class="showcase-container showcase-panel hidden" id="panel-lab">
          <div class="terminal-panel-header">// MOVEMENT LAB · KINETIC CALIBRATION & SANDBOX</div>
          <div class="terminal-card" style="padding: 20px 24px; max-width: 680px; margin: 16px auto; display: flex; flex-direction: column; gap: 16px; border-left: 4px solid #00f0ff;">
            <div style="font-size: 0.85rem; color: #a0aec0; line-height: 1.5;">
              Dedicated isolated physics sandbox for practicing bunny-hop timing, Source-inspired air strafing, and high-velocity surf ramp control.
            </div>
            <div class="settings-row" style="margin-top: 4px; display: flex; align-items: center; justify-content: space-between; gap: 16px;">
              <label class="settings-label" style="min-width: 160px; font-size: 0.8rem; font-family: var(--font-mono); color: #cbd5e1;">SIGNAL // SOUNDTRACK</label>
              <select class="settings-select" id="lab-music-select" style="flex: 1; padding: 8px 12px; font-size: 0.8rem;">
                <option value="NONE">NONE // SILENT SANDBOX</option>
              </select>
            </div>
            <div style="font-size: 0.72rem; color: #718096; font-family: var(--font-mono); margin-top: 4px;">
              [MODE: UNRESTRICTED TRAVERSAL] · [COLLISION: AUTHORITATIVE] · [PB GHOST: ACTIVE]
            </div>
            <div style="margin-top: 8px; display: flex; gap: 12px;">
              <button class="btn-hero btn-terminal-exec" id="btn-lab-enter">> ENTER MOVEMENT LAB</button>
            </div>
          </div>
        </div>

        <!-- 04: KARAMBIT ARMORY PANEL -->
        <div class="showcase-container showcase-panel hidden" id="panel-armory">
          <div class="terminal-panel-header" style="display: flex; justify-content: space-between; align-items: center;">
            <span>// KARAMBIT ARMORY · PERFORMANCE UNLOCKS & COSMIC SHADERS</span>
            <button id="btn-armory-dev-toggle" class="terminal-btn-subtle" style="font-size: 0.7rem; padding: 3px 8px; background: rgba(0, 240, 255, 0.08); border: 1px solid #00f0ff; color: #00f0ff; cursor: pointer; font-family: var(--font-mono);">
              DEV PREVIEW: OFF
            </button>
          </div>
          <div id="armory-skins-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; margin-top: 10px; max-height: 480px; overflow-y: auto; padding-right: 4px;">
            <!-- Populated dynamically via renderArmory() -->
          </div>
        </div>

        <input type="file" id="import-file-input" accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac" style="display:none;" />

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
    this.catalog.forEach((t, idx) => {
      const item = document.createElement('div');
      item.className = `strip-item terminal-strip-item ${t.id === this.selectedTrack.id ? 'active' : ''}`;
      item.dataset.trackId = t.id;

      item.innerHTML = `
        <div class="strip-item-num">[${(idx + 1).toString().padStart(2, '0')}] // ${t.difficultyLabel}</div>
        <div class="strip-item-title">${t.title}</div>
        <div class="strip-item-bpm">${t.bpm} BPM</div>
      `;

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
      } else {
        elem.classList.remove('active');
      }
    });
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

    const card = this.element.querySelector('#showcase-card') as HTMLElement;
    if (card) {
      card.style.borderLeftColor = t.accentColor;
    }
    this.showcaseGenreElem.style.borderColor = t.accentColor;
    this.showcaseGenreElem.style.color = t.accentColor;
  }

  public renderArmory(): void {
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
    // Tab switching
    this.tabShowcaseBtn.addEventListener('click', () => {
      this.tabShowcaseBtn.classList.add('active');
      this.tabCustomBtn.classList.remove('active');
      this.tabLabBtn.classList.remove('active');
      this.tabArmoryBtn.classList.remove('active');
      this.showcasePanel.classList.remove('hidden');
      this.customPanel.classList.add('hidden');
      this.labPanel.classList.add('hidden');
      this.armoryPanel.classList.add('hidden');
    });

    this.tabCustomBtn.addEventListener('click', () => {
      this.stopPreview();
      this.tabCustomBtn.classList.add('active');
      this.tabShowcaseBtn.classList.remove('active');
      this.tabLabBtn.classList.remove('active');
      this.tabArmoryBtn.classList.remove('active');
      this.customPanel.classList.remove('hidden');
      this.showcasePanel.classList.add('hidden');
      this.labPanel.classList.add('hidden');
      this.armoryPanel.classList.add('hidden');
    });

    this.tabLabBtn.addEventListener('click', () => {
      this.stopPreview();
      this.tabLabBtn.classList.add('active');
      this.tabShowcaseBtn.classList.remove('active');
      this.tabCustomBtn.classList.remove('active');
      this.tabArmoryBtn.classList.remove('active');
      this.labPanel.classList.remove('hidden');
      this.showcasePanel.classList.add('hidden');
      this.customPanel.classList.add('hidden');
      this.armoryPanel.classList.add('hidden');
    });

    this.tabArmoryBtn.addEventListener('click', () => {
      this.stopPreview();
      this.tabArmoryBtn.classList.add('active');
      this.tabShowcaseBtn.classList.remove('active');
      this.tabCustomBtn.classList.remove('active');
      this.tabLabBtn.classList.remove('active');
      this.armoryPanel.classList.remove('hidden');
      this.showcasePanel.classList.add('hidden');
      this.customPanel.classList.add('hidden');
      this.labPanel.classList.add('hidden');
      this.renderArmory();
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
}
