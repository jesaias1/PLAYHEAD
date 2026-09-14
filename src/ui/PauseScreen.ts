/**
 * Pause screen menu
 */

export class PauseScreen {
  public element: HTMLElement;
  private resumeBtn: HTMLButtonElement;
  private restartCpBtn: HTMLButtonElement;
  private restartTrackBtn: HTMLButtonElement;
  private newTrackBtn: HTMLButtonElement;
  private settingsBtn: HTMLButtonElement;

  private onResumeCallback?: () => void;
  private onRestartCpCallback?: () => void;
  private onRestartTrackCallback?: () => void;
  private onNewTrackCallback?: () => void;
  private onSettingsCallback?: () => void;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'screen pause-screen hidden';
    this.element.innerHTML = `
      <div class="pause-container">
        <h2 class="pause-title">PAUSED</h2>
        <button class="primary" id="btn-pause-resume">RESUME</button>
        <button class="secondary" id="btn-pause-restart-cp">RESTART FROM CHECKPOINT</button>
        <button class="secondary" id="btn-pause-restart-track">RESTART TRACK</button>
        <button class="secondary" id="btn-pause-settings">SETTINGS</button>
        <button class="secondary" id="btn-pause-new-track">NEW TRACK</button>
      </div>
    `;

    this.resumeBtn = this.element.querySelector('#btn-pause-resume') as HTMLButtonElement;
    this.restartCpBtn = this.element.querySelector('#btn-pause-restart-cp') as HTMLButtonElement;
    this.restartTrackBtn = this.element.querySelector('#btn-pause-restart-track') as HTMLButtonElement;
    this.settingsBtn = this.element.querySelector('#btn-pause-settings') as HTMLButtonElement;
    this.newTrackBtn = this.element.querySelector('#btn-pause-new-track') as HTMLButtonElement;

    this.initEvents();
  }

  public setCallbacks(callbacks: {
    onResume: () => void;
    onRestartCheckpoint: () => void;
    onRestartTrack: () => void;
    onSettings: () => void;
    onNewTrack: () => void;
  }): void {
    this.onResumeCallback = callbacks.onResume;
    this.onRestartCpCallback = callbacks.onRestartCheckpoint;
    this.onRestartTrackCallback = callbacks.onRestartTrack;
    this.onSettingsCallback = callbacks.onSettings;
    this.onNewTrackCallback = callbacks.onNewTrack;
  }

  public show(): void {
    this.element.classList.remove('hidden');
    this.resumeBtn.focus();
  }

  public hide(): void {
    this.element.classList.add('hidden');
  }

  private initEvents(): void {
    this.resumeBtn.addEventListener('click', () => this.onResumeCallback?.());
    this.restartCpBtn.addEventListener('click', () => this.onRestartCpCallback?.());
    this.restartTrackBtn.addEventListener('click', () => this.onRestartTrackCallback?.());
    this.settingsBtn.addEventListener('click', () => this.onSettingsCallback?.());
    this.newTrackBtn.addEventListener('click', () => this.onNewTrackCallback?.());
  }
}
