/**
 * Settings modal for tuning sensitivity, FOV, volume, accessibility options,
 * and game hints / tips.
 */

import { SettingsManager } from '../core/Settings';

export class SettingsModal {
  public element: HTMLElement;
  private sensInput: HTMLInputElement;
  private fovInput: HTMLInputElement;
  private volInput: HTMLInputElement;
  private motionInput: HTMLInputElement;
  private bhopInput: HTMLInputElement;
  private hintsInput: HTMLInputElement;
  private ghostSelect: HTMLSelectElement;
  private vmModeSelect: HTMLSelectElement;
  private vmAccentSelect: HTMLSelectElement;
  private calloutsSelect: HTMLSelectElement;
  private hideHudInput: HTMLInputElement;
  private fullscreenBtn: HTMLButtonElement;
  private vmFovInput: HTMLInputElement;
  private vmSwayInput: HTMLInputElement;
  private closeBtn: HTMLButtonElement;

  private onCloseCallback?: () => void;
  private settingsManager = SettingsManager.getInstance();

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'screen settings-screen hidden';
    this.element.innerHTML = `
      <div class="settings-container" style="max-height: 88vh; overflow-y: auto;">
        <h3 class="pause-title">SETTINGS</h3>

        <div class="settings-row">
          <label class="settings-label">MOUSE SENSITIVITY</label>
          <input type="range" class="settings-input" id="set-sens" min="0.2" max="3.0" step="0.1" />
        </div>

        <div class="settings-row">
          <label class="settings-label">FIELD OF VIEW (FOV)</label>
          <input type="range" class="settings-input" id="set-fov" min="70" max="110" step="1" />
        </div>

        <div class="settings-row">
          <label class="settings-label">MASTER VOLUME</label>
          <input type="range" class="settings-input" id="set-vol" min="0" max="1" step="0.05" />
        </div>

        <div class="settings-row">
          <label class="settings-label">REDUCE MOTION</label>
          <input type="checkbox" id="set-motion" />
        </div>

        <div class="settings-row">
          <label class="settings-label">HOLD-TO-BHOP</label>
          <input type="checkbox" id="set-bhop" />
        </div>

        <div class="settings-row">
          <label class="settings-label">GAME HINTS / TIPS</label>
          <input type="checkbox" id="set-hints" />
        </div>

        <div class="settings-row">
          <label class="settings-label">GHOST RACING</label>
          <select class="settings-select" id="set-ghost">
            <option value="ALL">PB + THE ECHO</option>
            <option value="PB_ONLY">PB ONLY</option>
            <option value="RIVAL_ONLY">THE ECHO ONLY</option>
            <option value="OFF">OFF</option>
          </select>
        </div>

        <div class="settings-row">
          <label class="settings-label">VIEWMODEL (HANDS & BLADE)</label>
          <select class="settings-select" id="set-vm-mode">
            <option value="FULL">FULL (BOTH HANDS + KARAMBIT)</option>
            <option value="MINIMAL">MINIMAL (RIGHT HAND ONLY)</option>
            <option value="OFF">OFF (DISABLED)</option>
          </select>
        </div>

        <div class="settings-row">
          <label class="settings-label">VIEWMODEL FOV</label>
          <input type="range" class="settings-input" id="set-vm-fov" min="50" max="85" step="1" />
        </div>

        <div class="settings-row">
          <label class="settings-label">VIEWMODEL SWAY</label>
          <input type="range" class="settings-input" id="set-vm-sway" min="0" max="2.0" step="0.1" />
        </div>

        <div class="settings-row">
          <label class="settings-label">VIEWMODEL ACCENT</label>
          <select class="settings-select" id="set-vm-accent">
            <option value="ADAPTIVE">ADAPTIVE (FOLLOW TRACK PALETTE)</option>
            <option value="DEFAULT_CYAN">DEFAULT CYAN</option>
            <option value="OFF">OFF</option>
          </select>
        </div>

        <div class="settings-row">
          <label class="settings-label">TERMINAL CALLOUTS</label>
          <select class="settings-select" id="set-callouts">
            <option value="MINIMAL">MINIMAL</option>
            <option value="FULL">FULL</option>
            <option value="OFF">OFF</option>
          </select>
        </div>

        <div class="settings-row">
          <label class="settings-label">HIDE HUD / UI</label>
          <input type="checkbox" id="set-hide-hud" />
        </div>

        <div class="settings-row" style="justify-content: space-between; align-items: center; margin-top: 10px;">
          <label class="settings-label">DISPLAY MODE</label>
          <button class="terminal-btn-subtle" id="btn-toggle-fullscreen" style="padding: 6px 14px; background: rgba(0, 240, 255, 0.08); border: 1px solid #00f0ff; color: #00f0ff; cursor: pointer; font-family: var(--font-mono); font-size: 0.8rem;">
            [ TOGGLE FULLSCREEN ]
          </button>
        </div>

        <div style="margin-top: 24px; text-align: center;">
          <button class="primary" id="btn-set-close">CLOSE</button>
        </div>
      </div>
    `;

    this.sensInput = this.element.querySelector('#set-sens') as HTMLInputElement;
    this.fovInput = this.element.querySelector('#set-fov') as HTMLInputElement;
    this.volInput = this.element.querySelector('#set-vol') as HTMLInputElement;
    this.motionInput = this.element.querySelector('#set-motion') as HTMLInputElement;
    this.bhopInput = this.element.querySelector('#set-bhop') as HTMLInputElement;
    this.hintsInput = this.element.querySelector('#set-hints') as HTMLInputElement;
    this.ghostSelect = this.element.querySelector('#set-ghost') as HTMLSelectElement;
    this.vmModeSelect = this.element.querySelector('#set-vm-mode') as HTMLSelectElement;
    this.vmAccentSelect = this.element.querySelector('#set-vm-accent') as HTMLSelectElement;
    this.calloutsSelect = this.element.querySelector('#set-callouts') as HTMLSelectElement;
    this.hideHudInput = this.element.querySelector('#set-hide-hud') as HTMLInputElement;
    this.fullscreenBtn = this.element.querySelector('#btn-toggle-fullscreen') as HTMLButtonElement;
    this.vmFovInput = this.element.querySelector('#set-vm-fov') as HTMLInputElement;
    this.vmSwayInput = this.element.querySelector('#set-vm-sway') as HTMLInputElement;
    this.closeBtn = this.element.querySelector('#btn-set-close') as HTMLButtonElement;

    this.initValues();
    this.initEvents();
  }

  public setOnClose(cb: () => void): void {
    this.onCloseCallback = cb;
  }

  public show(): void {
    this.initValues();
    this.element.classList.remove('hidden');
    this.closeBtn.focus();
  }

  public hide(): void {
    this.element.classList.add('hidden');
  }

  public isVisible(): boolean {
    return !this.element.classList.contains('hidden');
  }

  private initValues(): void {
    const s = this.settingsManager.settings;
    this.sensInput.value = s.mouseSensitivity.toString();
    this.fovInput.value = s.fov.toString();
    this.volInput.value = s.masterVolume.toString();
    this.motionInput.checked = s.reduceMotion;
    this.bhopInput.checked = s.holdToBhop;
    this.hintsInput.checked = s.showHints !== false;
    this.ghostSelect.value = s.ghostMode || 'ALL';
    this.vmModeSelect.value = s.viewmodelMode || 'FULL';
    this.vmAccentSelect.value = s.viewmodelAccent || 'ADAPTIVE';
    this.calloutsSelect.value = s.terminalCallouts || 'MINIMAL';
    this.hideHudInput.checked = !!s.hideHud;
    this.vmFovInput.value = (s.viewmodelFov || 65).toString();
    this.vmSwayInput.value = (s.viewmodelSway !== undefined ? s.viewmodelSway : 1.0).toString();
  }

  private initEvents(): void {
    this.sensInput.addEventListener('input', () => {
      this.settingsManager.update({ mouseSensitivity: parseFloat(this.sensInput.value) });
    });

    this.fovInput.addEventListener('input', () => {
      this.settingsManager.update({ fov: parseInt(this.fovInput.value, 10) });
    });

    this.volInput.addEventListener('input', () => {
      this.settingsManager.update({ masterVolume: parseFloat(this.volInput.value) });
    });

    this.motionInput.addEventListener('change', () => {
      this.settingsManager.update({ reduceMotion: this.motionInput.checked });
    });

    this.bhopInput.addEventListener('change', () => {
      this.settingsManager.update({ holdToBhop: this.bhopInput.checked });
    });

    this.hintsInput.addEventListener('change', () => {
      this.settingsManager.update({ showHints: this.hintsInput.checked });
    });

    this.ghostSelect.addEventListener('change', () => {
      this.settingsManager.update({ ghostMode: this.ghostSelect.value as any });
    });

    this.vmModeSelect.addEventListener('change', () => {
      this.settingsManager.update({ viewmodelMode: this.vmModeSelect.value as any });
    });

    this.vmAccentSelect.addEventListener('change', () => {
      this.settingsManager.update({ viewmodelAccent: this.vmAccentSelect.value as any });
    });

    this.calloutsSelect.addEventListener('change', () => {
      this.settingsManager.update({ terminalCallouts: this.calloutsSelect.value as any });
    });

    this.hideHudInput.addEventListener('change', () => {
      this.settingsManager.update({ hideHud: this.hideHudInput.checked });
    });

    this.fullscreenBtn.addEventListener('click', () => {
      if (typeof document !== 'undefined') {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      }
    });

    this.vmFovInput.addEventListener('input', () => {
      this.settingsManager.update({ viewmodelFov: parseInt(this.vmFovInput.value, 10) });
    });

    this.vmSwayInput.addEventListener('input', () => {
      this.settingsManager.update({ viewmodelSway: parseFloat(this.vmSwayInput.value) });
    });

    this.closeBtn.addEventListener('click', () => {
      this.hide();
      this.onCloseCallback?.();
    });
  }
}
