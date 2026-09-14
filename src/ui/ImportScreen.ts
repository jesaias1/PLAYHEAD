/**
 * Import screen for drag-and-drop, file browsing, or synthetic tracks
 * Branded for PLAYHEAD: DROP A SONG. ENTER IT.
 */

import { AudioLoader } from '../audio/AudioLoader';
import { SyntheticGenre } from '../audio/SyntheticTrack';

export class ImportScreen {
  public element: HTMLElement;
  private dropZone: HTMLElement;
  private fileInput: HTMLInputElement;
  private browseBtn: HTMLButtonElement;
  private devTrackBtn: HTMLButtonElement;
  private devDnbBtn: HTMLButtonElement;
  private devAmbientBtn: HTMLButtonElement;
  private devSilentBtn: HTMLButtonElement;
  private movementLabBtn: HTMLButtonElement;

  private onFileSelectedCallback?: (file: File) => void;
  private onDevTrackCallback?: (genre?: SyntheticGenre) => void;
  private onErrorCallback?: (err: string) => void;
  private onMovementLabCallback?: () => void;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'screen import-screen';
    this.element.innerHTML = `
      <div class="import-container">
        <h1 class="brand-title">PLAYHEAD</h1>
        <p class="brand-subtitle">DROP A SONG. ENTER IT.</p>
        <p class="brand-tagline">BECOME THE PLAYHEAD.</p>

        <div class="drop-zone" id="import-drop-zone">
          <div class="drop-prompt">DRAG AUDIO FILE HERE</div>
          <div class="drop-subtext">.MP3, .WAV, .OGG, .M4A, .FLAC</div>
        </div>

        <div class="import-actions">
          <button class="primary" id="btn-browse-file">BROWSE FILE</button>
          <button class="secondary" id="btn-dev-track">DEV: ELECTRONIC DROP</button>
          <button class="secondary" id="btn-dev-dnb">DEV: BREAKBEAT DNB</button>
          <button class="secondary" id="btn-dev-ambient">DEV: AMBIENT SPARSE</button>
          <button class="secondary" id="btn-dev-silent">DEV: NEAR SILENT</button>
          <button class="secondary" id="btn-movement-lab">MOVEMENT LAB</button>
        </div>

        <input type="file" id="import-file-input" accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac" style="display:none;" />

        <div class="privacy-notice">
          LOCAL ANALYSIS — AUDIO NEVER LEAVES YOUR DEVICE
        </div>
      </div>
    `;

    this.dropZone = this.element.querySelector('#import-drop-zone') as HTMLElement;
    this.fileInput = this.element.querySelector('#import-file-input') as HTMLInputElement;
    this.browseBtn = this.element.querySelector('#btn-browse-file') as HTMLButtonElement;
    this.devTrackBtn = this.element.querySelector('#btn-dev-track') as HTMLButtonElement;
    this.devDnbBtn = this.element.querySelector('#btn-dev-dnb') as HTMLButtonElement;
    this.devAmbientBtn = this.element.querySelector('#btn-dev-ambient') as HTMLButtonElement;
    this.devSilentBtn = this.element.querySelector('#btn-dev-silent') as HTMLButtonElement;
    this.movementLabBtn = this.element.querySelector('#btn-movement-lab') as HTMLButtonElement;

    this.initEvents();
  }

  public setCallbacks(
    onFileSelected: (file: File) => void,
    onDevTrack: (genre?: SyntheticGenre) => void,
    onError: (err: string) => void,
    onMovementLab?: () => void
  ): void {
    this.onFileSelectedCallback = onFileSelected;
    this.onDevTrackCallback = onDevTrack;
    this.onErrorCallback = onError;
    this.onMovementLabCallback = onMovementLab;
  }

  public show(): void {
    this.element.classList.remove('hidden');
  }

  public hide(): void {
    this.element.classList.add('hidden');
  }

  private initEvents(): void {
    AudioLoader.setupDropZone(
      this.dropZone,
      (file) => this.onFileSelectedCallback?.(file),
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
        this.onFileSelectedCallback?.(file);
      }
    });

    this.devTrackBtn.addEventListener('click', () => {
      this.onDevTrackCallback?.('ELECTRONIC_DROP');
    });

    this.devDnbBtn.addEventListener('click', () => {
      this.onDevTrackCallback?.('BREAKBEAT_DNB');
    });

    this.devAmbientBtn.addEventListener('click', () => {
      this.onDevTrackCallback?.('AMBIENT_SPARSE');
    });

    this.devSilentBtn.addEventListener('click', () => {
      this.onDevTrackCallback?.('NEAR_SILENT');
    });

    this.movementLabBtn.addEventListener('click', () => {
      this.onMovementLabCallback?.();
    });
  }
}
