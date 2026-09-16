/**
 * Import screen for PLAYHEAD
 * Features the Signal Showcase (curated 5-track production catalog),
 * interactive audio preview auditioning, custom drag-and-drop file import,
 * and direct entrance to the Movement Lab.
 */

import { AudioLoader } from '../audio/AudioLoader';
import { SyntheticGenre } from '../audio/SyntheticTrack';
import { MusicPack, TrackCatalogEntry } from '../audio/MusicPack';

export class ImportScreen {
  public element: HTMLElement;

  // Tabs
  private tabShowcaseBtn: HTMLButtonElement;
  private tabCustomBtn: HTMLButtonElement;
  private tabLabBtn: HTMLButtonElement;

  private showcasePanel: HTMLElement;
  private customPanel: HTMLElement;

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

  // State
  private catalog: TrackCatalogEntry[];
  private selectedTrack: TrackCatalogEntry;
  private isPreviewPlaying = false;
  private previewCtx: AudioContext | null = null;
  private currentPreviewSource: AudioBufferSourceNode | null = null;

  // Callbacks
  private onFileSelectedCallback?: (file: File) => void;
  private onCatalogTrackCallback?: (track: TrackCatalogEntry) => void;
  private onDevTrackCallback?: (genre?: SyntheticGenre) => void;
  private onErrorCallback?: (err: string) => void;
  private onMovementLabCallback?: () => void;

  constructor() {
    this.catalog = MusicPack.getCatalog();
    this.selectedTrack = this.catalog[0]; // Default: FIRST CONTACT

    this.element = document.createElement('div');
    this.element.className = 'screen import-screen';
    this.element.innerHTML = `
      <div class="import-container">
        <div class="brand-badge">ARCHITECTURAL AUDIO ENGINE v1.1</div>
        <h1 class="brand-title">PLAYHEAD</h1>
        <p class="brand-subtitle">DROP A TRACK. ENTER THE SIGNAL.</p>

        <div class="import-tabs">
          <button class="import-tab-btn active" id="tab-btn-showcase">THE SIGNAL PACK</button>
          <button class="import-tab-btn" id="tab-btn-custom">CUSTOM AUDIO FILE</button>
          <button class="import-tab-btn" id="tab-btn-lab">MOVEMENT LAB</button>
        </div>

        <!-- SHOWCASE PANEL -->
        <div class="showcase-container showcase-panel" id="panel-showcase">
          <div class="showcase-card" id="showcase-card">
            <div class="showcase-header">
              <div class="showcase-title-group">
                <div class="showcase-artist" id="showcase-artist">PLAYHEAD AUDIO LABS</div>
                <div class="showcase-track-title" id="showcase-title">FIRST CONTACT</div>
              </div>
            </div>

            <div class="showcase-meta-row">
              <span class="showcase-badge accent" id="showcase-genre">MELODIC SYNTH // FLOW</span>
              <span class="showcase-badge" id="showcase-bpm">120 BPM</span>
              <span class="showcase-badge" id="showcase-duration">01:12</span>
              <span class="showcase-badge" id="showcase-diff">★☆☆☆☆ FLOW</span>
            </div>

            <div class="showcase-desc" id="showcase-desc">
              Crafted as the quintessential onboarding course. Features gentle rhythm hops, smooth acceleration, and introductory downhill surf glides.
            </div>

            <div class="showcase-actions">
              <button class="primary btn-hero" id="btn-showcase-enter">ENTER TRACK</button>
              <button class="btn-preview" id="btn-showcase-preview">
                <span id="preview-icon">▶</span>
                <span id="preview-text">PREVIEW AUDIO</span>
              </button>
            </div>
          </div>

          <div class="showcase-selector-strip" id="showcase-strip"></div>
        </div>

        <!-- CUSTOM FILE DROP PANEL -->
        <div class="custom-file-panel hidden" id="panel-custom">
          <div class="drop-zone" id="import-drop-zone">
            <div class="signal-line"></div>
            <div class="drop-prompt">DRAG AUDIO FILE HERE OR CLICK TO BROWSE</div>
            <div class="drop-subtext">MP3 · WAV · FLAC · OGG · M4A — REAL-TIME PROCEDURAL GENERATION</div>
          </div>
          <button class="primary btn-hero" id="btn-browse-file" style="margin-bottom: 20px;">BROWSE AUDIO FILE</button>
        </div>

        <input type="file" id="import-file-input" accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac" style="display:none;" />

        <div class="privacy-notice">
          HIGH-PRECISION CLIENT-SIDE DSP // ZERO ASSET DOWNLOADS // FULL PROCEDURAL GENERATION
        </div>
      </div>
    `;

    // Tab buttons
    this.tabShowcaseBtn = this.element.querySelector('#tab-btn-showcase') as HTMLButtonElement;
    this.tabCustomBtn = this.element.querySelector('#tab-btn-custom') as HTMLButtonElement;
    this.tabLabBtn = this.element.querySelector('#tab-btn-lab') as HTMLButtonElement;

    this.showcasePanel = this.element.querySelector('#panel-showcase') as HTMLElement;
    this.customPanel = this.element.querySelector('#panel-custom') as HTMLElement;

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

    this.buildStrip();
    this.updateShowcaseCard(this.selectedTrack);
    this.initEvents();
  }

  private buildStrip(): void {
    this.selectorStripElem.innerHTML = '';
    this.catalog.forEach((t, idx) => {
      const item = document.createElement('div');
      item.className = `strip-item ${t.id === this.selectedTrack.id ? 'active' : ''}`;
      item.dataset.trackId = t.id;

      const stars = '★'.repeat(t.difficulty) + '☆'.repeat(5 - t.difficulty);
      item.innerHTML = `
        <div class="strip-item-num">0${idx + 1} // ${stars}</div>
        <div class="strip-item-title">${t.title}</div>
        <div class="strip-item-bpm">${t.bpm} BPM · ${t.difficultyLabel}</div>
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

    const stars = '★'.repeat(t.difficulty) + '☆'.repeat(5 - t.difficulty);
    this.showcaseDiffElem.textContent = `${stars} ${t.difficultyLabel}`;
    this.showcaseDescElem.textContent = t.description;

    const card = this.element.querySelector('#showcase-card') as HTMLElement;
    if (card) {
      card.style.borderColor = `${t.accentColor}88`;
      card.style.boxShadow = `0 8px 32px rgba(0, 0, 0, 0.6), 0 0 20px ${t.accentColor}22`;
    }
    this.showcaseGenreElem.style.borderColor = t.accentColor;
    this.showcaseGenreElem.style.color = t.accentColor;
  }

  public setCallbacks(
    onFileSelected: (file: File) => void,
    onDevTrack: (genre?: SyntheticGenre) => void,
    onError: (err: string) => void,
    onMovementLab?: () => void,
    onCatalogTrack?: (track: TrackCatalogEntry) => void
  ): void {
    this.onFileSelectedCallback = onFileSelected;
    this.onDevTrackCallback = onDevTrack;
    this.onErrorCallback = onError;
    this.onMovementLabCallback = onMovementLab;
    this.onCatalogTrackCallback = onCatalogTrack;
  }

  public show(): void {
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
      this.previewTextElem.textContent = 'SYNTHESIZING...';
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
      this.previewTextElem.textContent = 'STOP PREVIEW';
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
    this.previewTextElem.textContent = 'PREVIEW AUDIO';
    this.showcasePreviewBtn?.classList.remove('playing');
  }

  private initEvents(): void {
    // Tab switching
    this.tabShowcaseBtn.addEventListener('click', () => {
      this.tabShowcaseBtn.classList.add('active');
      this.tabCustomBtn.classList.remove('active');
      this.showcasePanel.classList.remove('hidden');
      this.customPanel.classList.add('hidden');
    });

    this.tabCustomBtn.addEventListener('click', () => {
      this.stopPreview();
      this.tabCustomBtn.classList.add('active');
      this.tabShowcaseBtn.classList.remove('active');
      this.customPanel.classList.remove('hidden');
      this.showcasePanel.classList.add('hidden');
    });

    this.tabLabBtn.addEventListener('click', () => {
      this.stopPreview();
      this.onMovementLabCallback?.();
    });

    // Showcase actions
    this.showcaseEnterBtn.addEventListener('click', () => {
      this.stopPreview();
      if (this.onCatalogTrackCallback) {
        this.onCatalogTrackCallback(this.selectedTrack);
      } else {
        // Fallback to dev track callback
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
