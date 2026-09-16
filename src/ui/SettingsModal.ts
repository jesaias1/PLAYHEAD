/**
 * Settings modal for tuning sensitivity, FOV, volume, and accessibility options
 */

import { SettingsManager } from '../core/Settings';

export class SettingsModal {
  public element: HTMLElement;
  private sensInput: HTMLInputElement;
  private fovInput: HTMLInputElement;
  private volInput: HTMLInputElement;
  private motionInput: HTMLInputElement;
  private bhopInput: HTMLInputElement;
  private ghostSelect: HTMLSelectElement;
  private closeBtn: HTMLButtonElement;

  private onCloseCallback?: () => void;
  private settingsManager = SettingsManager.getInstance();

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'screen settings-screen hidden';
    this.element.innerHTML = `
      <div class="settings-container">
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
          <label class="settings-label">GHOST RACING</label>
          <select class="settings-select" id="set-ghost" style="background: var(--bg-surface-elevated); color: var(--text-primary); border: 1px solid var(--border-subtle); padding: 4px 8px; font-family: var(--font-mono); font-size: 0.8rem;">
            <option value="ALL">PB + THE ECHO</option>
            <option value="PB_ONLY">PB ONLY</option>
            <option value="RIVAL_ONLY">THE ECHO ONLY</option>
            <option value="OFF">OFF</option>
          </select>
        </div>

        <div class="settings-row">
          <label class="settings-label">VIEWMODEL (HANDS & BLADE)</label>
          <select class="settings-select" id="set-vm-mode" style="background: var(--bg-surface-elevated); color: var(--text-primary); border: 1px solid var(--border-subtle); padding: 4px 8px; font-family: var(--font-mono); font-size: 0.8rem;">
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
          <label class="settings-label">VIEWMODEL SWAY INTENSITY</label>
          <input type="range" class="settings-input" id="set-vm-sway" min="0" max="2" step="0.1" />
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
    this.ghostSelect = this.element.querySelector('#set-ghost') as HTMLSelectElement;
    this.vmModeSelect = this.element.querySelector('#set-vm-mode') as HTMLSelectElement;
    this.vmFovInput = this.element.querySelector('#set-vm-fov') as HTMLInputElement;
    this.vmSwayInput = this.element.querySelector('#set-vm-sway') as HTMLInputElement;
    this.closeBtn = this.element.querySelector('#btn-set-close') as HTMLButtonElement;

    this.initValues();
    this.initEvents();
  }

  private vmModeSelect: HTMLSelectElement;
  private vmFovInput: HTMLInputElement;
  private vmSwayInput: HTMLInputElement;

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

  private initValues(): void {
    const s = this.settingsManager.settings;
    this.sensInput.value = `${s.mouseSensitivity}`;
    this.fovInput.value = `${s.fov}`;
    this.volInput.value = `${s.masterVolume}`;
    this.motionInput.checked = s.reduceMotion;
    this.bhopInput.checked = s.holdToBhop;
    this.ghostSelect.value = s.ghostMode || 'ALL';
    this.vmModeSelect.value = s.viewmodelMode || 'FULL';
    this.vmFovInput.value = `${s.viewmodelFov || 65}`;
    this.vmSwayInput.value = `${s.viewmodelSway !== undefined ? s.viewmodelSway : 1.0}`;
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

    this.ghostSelect.addEventListener('change', () => {
      this.settingsManager.update({ ghostMode: this.ghostSelect.value as any });
    });

    this.vmModeSelect.addEventListener('change', () => {
      this.settingsManager.update({ viewmodelMode: this.vmModeSelect.value as any });
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
