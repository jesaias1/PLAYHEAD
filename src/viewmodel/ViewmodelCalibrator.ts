/**
 * ViewmodelCalibrator — Developer-only tool for visual viewmodel weapon calibration.
 * Allows manually positioning, rotating, and scaling the weapon socket relative to the hand bone.
 *
 * Activated via [F4].
 * - Unlocks pointer lock
 * - Freezes player movement & physics
 * - Freezes viewmodel in rock-solid default idle pose (no sway/inertia/compression)
 * - Attaches Three.js TransformControls in local space
 * - Provides interactive floating panel with precision numeric inputs & step buttons
 * - Displays socket origin & weapon pivot debug axes
 * - Supports COPY CONFIG (JSON/TypeScript) and SAVE LOCAL (localStorage persistence)
 */

import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { ViewmodelController } from './ViewmodelController';

export interface KnifeCalibrationData {
  position: [number, number, number];
  rotationDeg: [number, number, number];
  rotationRad: [number, number, number];
  scale: number;
}

export const DEFAULT_KNIFE_CALIBRATION: KnifeCalibrationData = {
  position: [0.0093, 0.1107, 0.0033],
  rotationDeg: [173.8, 21.4, 12.6],
  rotationRad: [3.034, 0.3737, 0.2205],
  scale: 1.011
};

export const CALIBRATION_STORAGE_KEY = 'playhead.viewmodel.karambitCalibration';

export class ViewmodelCalibrator {
  public isActive = false;

  private viewmodelController: ViewmodelController;
  private domElement: HTMLElement;
  private transformControls: TransformControls | null = null;
  private gizmoHelper: THREE.Object3D | null = null;

  // Debug Axis Helpers
  private socketAxes: THREE.AxesHelper | null = null;
  private knifeAxes: THREE.AxesHelper | null = null;

  // UI Panel Elements
  private panelContainer: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;

  // Inputs
  private posInputs: { x: HTMLInputElement; y: HTMLInputElement; z: HTMLInputElement } | null = null;
  private rotInputs: { x: HTMLInputElement; y: HTMLInputElement; z: HTMLInputElement } | null = null;
  private scaleInput: HTMLInputElement | null = null;
  private modeButtons: { [mode: string]: HTMLButtonElement } = {};
  private spaceButton: HTMLButtonElement | null = null;
  private fineButton: HTMLButtonElement | null = null;

  // Modes & State
  private currentMode: 'translate' | 'rotate' | 'scale' = 'rotate';
  private currentSpace: 'local' | 'world' = 'local';
  private isFineMode = false;
  private isShiftDown = false;

  // Callbacks
  private onActivateCallback?: () => void;
  private onDeactivateCallback?: () => void;

  constructor(
    viewmodelController: ViewmodelController,
    domElement: HTMLElement,
    onActivate?: () => void,
    onDeactivate?: () => void
  ) {
    this.viewmodelController = viewmodelController;
    this.domElement = domElement;
    this.onActivateCallback = onActivate;
    this.onDeactivateCallback = onDeactivate;

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      this.initTransformControls();
      this.initUI();
      this.initKeyListeners();
    }
  }

  /**
   * Loads saved calibration from localStorage if present
   */
  public static loadSavedCalibration(): KnifeCalibrationData | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(CALIBRATION_STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.position) && Array.isArray(data.rotationRad)) {
        return data as KnifeCalibrationData;
      }
    } catch (err) {
      console.warn('[ViewmodelCalibrator] Failed to parse saved calibration:', err);
    }
    return null;
  }

  private initTransformControls(): void {
    try {
      this.transformControls = new TransformControls(
        this.viewmodelController.camera,
        this.domElement
      );
      this.transformControls.setSpace(this.currentSpace);
      this.transformControls.setMode(this.currentMode);
      this.transformControls.setSize(0.75);

      this.gizmoHelper = this.transformControls.getHelper();

      // Listen for gizmo manipulation
      this.transformControls.addEventListener('objectChange', () => {
        this.syncFromTargetObject();
      });
    } catch (err) {
      console.warn('[ViewmodelCalibrator] TransformControls initialization failed:', err);
    }
  }

  /**
   * Toggles calibration mode on/off via F4 or UI button
   */
  public toggle(): void {
    if (this.isActive) {
      this.deactivate();
    } else {
      this.activate();
    }
  }

  /**
   * Activates calibration mode: freezes player & viewmodel, attaches gizmo, shows panel
   */
  public activate(): void {
    if (this.isActive) return;
    this.isActive = true;

    const knifeGroup = this.viewmodelController.getKnifeGroup();
    const handRBone = this.viewmodelController.getHandRBone();

    // 1. Attach TransformControls
    if (this.transformControls && knifeGroup) {
      this.transformControls.attach(knifeGroup);
      if (this.gizmoHelper && !this.viewmodelController.scene.children.includes(this.gizmoHelper)) {
        this.viewmodelController.scene.add(this.gizmoHelper);
      }
    }

    // 2. Attach Socket & Knife Origin Debug Axes
    if (handRBone) {
      if (!this.socketAxes) {
        this.socketAxes = new THREE.AxesHelper(0.06);
        this.socketAxes.name = 'socket_axes_helper';
      }
      handRBone.add(this.socketAxes);
      this.socketAxes.visible = true;
    }

    if (knifeGroup) {
      if (!this.knifeAxes) {
        this.knifeAxes = new THREE.AxesHelper(0.045);
        this.knifeAxes.name = 'knife_axes_helper';
      }
      knifeGroup.add(this.knifeAxes);
      this.knifeAxes.visible = true;
    }

    // 3. Show UI Panel & Refresh Values
    if (this.panelContainer) {
      this.panelContainer.style.display = 'block';
    }
    this.syncInputsFromState();
    this.setStatus('Calibration active. Drag gizmo or adjust numbers.');

    // 4. Trigger external callback (unlock pointer, pause song, etc.)
    this.onActivateCallback?.();
  }

  /**
   * Deactivates calibration mode: removes gizmo, hides panel, restores gameplay
   */
  public deactivate(): void {
    if (!this.isActive) return;
    this.isActive = false;

    // 1. Detach TransformControls
    if (this.transformControls) {
      this.transformControls.detach();
      if (this.gizmoHelper && this.viewmodelController.scene.children.includes(this.gizmoHelper)) {
        this.viewmodelController.scene.remove(this.gizmoHelper);
      }
    }

    // 2. Hide Debug Axes
    if (this.socketAxes) {
      this.socketAxes.visible = false;
      this.socketAxes.parent?.remove(this.socketAxes);
    }
    if (this.knifeAxes) {
      this.knifeAxes.visible = false;
      this.knifeAxes.parent?.remove(this.knifeAxes);
    }

    // 3. Hide UI Panel
    if (this.panelContainer) {
      this.panelContainer.style.display = 'none';
    }

    // 4. Trigger external callback (lock pointer, resume gameplay, etc.)
    this.onDeactivateCallback?.();
  }

  public setMode(mode: 'translate' | 'rotate' | 'scale'): void {
    this.currentMode = mode;
    if (this.transformControls) {
      this.transformControls.setMode(mode);
    }
    Object.entries(this.modeButtons).forEach(([m, btn]) => {
      if (m === mode) {
        btn.style.background = '#00f0ff';
        btn.style.color = '#000000';
      } else {
        btn.style.background = '#1a2230';
        btn.style.color = '#88a0b8';
      }
    });
    this.setStatus(`Mode: ${mode.toUpperCase()}`);
  }

  public toggleSpace(): void {
    this.currentSpace = this.currentSpace === 'local' ? 'world' : 'local';
    if (this.transformControls) {
      this.transformControls.setSpace(this.currentSpace);
    }
    if (this.spaceButton) {
      this.spaceButton.textContent = `SPACE: ${this.currentSpace.toUpperCase()}`;
      this.spaceButton.style.borderColor = this.currentSpace === 'local' ? '#00f0ff' : '#ffaa00';
    }
    this.setStatus(`Transform Space: ${this.currentSpace.toUpperCase()}`);
  }

  public toggleFineMode(): void {
    this.isFineMode = !this.isFineMode;
    this.updateFineButtonUI();
  }

  private updateFineButtonUI(): void {
    const isFine = this.isFineMode || this.isShiftDown;
    if (this.fineButton) {
      this.fineButton.textContent = isFine ? 'FINE: ON (0.1x)' : 'FINE: OFF (1x)';
      this.fineButton.style.color = isFine ? '#00f0ff' : '#88a0b8';
      this.fineButton.style.borderColor = isFine ? '#00f0ff' : '#334455';
    }
  }

  /**
   * Called when TransformControls moves the object
   */
  private syncFromTargetObject(): void {
    const knifeGroup = this.viewmodelController.getKnifeGroup();
    if (!knifeGroup) return;

    // Update viewmodelController authoritative socket transform
    this.viewmodelController.knifeSocketPos.copy(knifeGroup.position);
    this.viewmodelController.knifeSocketRot.set(
      knifeGroup.rotation.x,
      knifeGroup.rotation.y,
      knifeGroup.rotation.z
    );
    this.viewmodelController.knifeSocketScale.copy(knifeGroup.scale);

    // Refresh UI inputs
    this.syncInputsFromState();
  }

  /**
   * Refreshes the HTML input fields with the current viewmodel socket state
   */
  public syncInputsFromState(): void {
    const pos = this.viewmodelController.knifeSocketPos;
    const rot = this.viewmodelController.knifeSocketRot;
    const scale = this.viewmodelController.knifeSocketScale;

    if (this.posInputs) {
      this.posInputs.x.value = pos.x.toFixed(4);
      this.posInputs.y.value = pos.y.toFixed(4);
      this.posInputs.z.value = pos.z.toFixed(4);
    }

    if (this.rotInputs) {
      const degX = (rot.x * 180) / Math.PI;
      const degY = (rot.y * 180) / Math.PI;
      const degZ = (rot.z * 180) / Math.PI;
      this.rotInputs.x.value = degX.toFixed(1);
      this.rotInputs.y.value = degY.toFixed(1);
      this.rotInputs.z.value = degZ.toFixed(1);
    }

    if (this.scaleInput) {
      this.scaleInput.value = scale.x.toFixed(3);
    }
  }

  /**
   * Applies the UI input values into the 3D socket and gizmo
   */
  private applyInputsToTarget(): void {
    if (!this.posInputs || !this.rotInputs || !this.scaleInput) return;

    const posX = parseFloat(this.posInputs.x.value) || 0;
    const posY = parseFloat(this.posInputs.y.value) || 0;
    const posZ = parseFloat(this.posInputs.z.value) || 0;

    const degX = parseFloat(this.rotInputs.x.value) || 0;
    const degY = parseFloat(this.rotInputs.y.value) || 0;
    const degZ = parseFloat(this.rotInputs.z.value) || 0;

    const s = parseFloat(this.scaleInput.value) || 1.0;

    const radX = (degX * Math.PI) / 180;
    const radY = (degY * Math.PI) / 180;
    const radZ = (degZ * Math.PI) / 180;

    this.viewmodelController.knifeSocketPos.set(posX, posY, posZ);
    this.viewmodelController.knifeSocketRot.set(radX, radY, radZ);
    this.viewmodelController.knifeSocketScale.set(s, s, s);

    const knifeGroup = this.viewmodelController.getKnifeGroup();
    if (knifeGroup) {
      knifeGroup.position.set(posX, posY, posZ);
      knifeGroup.rotation.set(radX, radY, radZ);
      knifeGroup.scale.set(s, s, s);
      knifeGroup.updateMatrixWorld(true);
    }
    this.gizmoHelper?.updateMatrixWorld(true);
  }

  /**
   * Nudges a specific channel by delta
   */
  private nudgeValue(channel: 'posX' | 'posY' | 'posZ' | 'rotX' | 'rotY' | 'rotZ' | 'scale', sign: number): void {
    const isFine = this.isFineMode || this.isShiftDown;

    if (channel.startsWith('pos')) {
      const step = isFine ? 0.0002 : 0.001;
      const axis = channel.slice(3).toLowerCase() as 'x' | 'y' | 'z';
      if (this.posInputs) {
        const cur = parseFloat(this.posInputs[axis].value) || 0;
        this.posInputs[axis].value = (cur + sign * step).toFixed(4);
      }
    } else if (channel.startsWith('rot')) {
      const step = isFine ? 0.1 : 0.5;
      const axis = channel.slice(3).toLowerCase() as 'x' | 'y' | 'z';
      if (this.rotInputs) {
        const cur = parseFloat(this.rotInputs[axis].value) || 0;
        this.rotInputs[axis].value = (cur + sign * step).toFixed(1);
      }
    } else if (channel === 'scale') {
      const step = isFine ? 0.002 : 0.01;
      if (this.scaleInput) {
        const cur = parseFloat(this.scaleInput.value) || 1.0;
        this.scaleInput.value = Math.max(0.1, cur + sign * step).toFixed(3);
      }
    }

    this.applyInputsToTarget();
  }

  /**
   * Copies formatted config to clipboard & prints in console
   */
  public copyConfig(): void {
    const pos = this.viewmodelController.knifeSocketPos;
    const rot = this.viewmodelController.knifeSocketRot;
    const scale = this.viewmodelController.knifeSocketScale;

    const degX = (rot.x * 180) / Math.PI;
    const degY = (rot.y * 180) / Math.PI;
    const degZ = (rot.z * 180) / Math.PI;

    const data: KnifeCalibrationData = {
      position: [
        parseFloat(pos.x.toFixed(4)),
        parseFloat(pos.y.toFixed(4)),
        parseFloat(pos.z.toFixed(4))
      ],
      rotationDeg: [
        parseFloat(degX.toFixed(1)),
        parseFloat(degY.toFixed(1)),
        parseFloat(degZ.toFixed(1))
      ],
      rotationRad: [
        parseFloat(rot.x.toFixed(4)),
        parseFloat(rot.y.toFixed(4)),
        parseFloat(rot.z.toFixed(4))
      ],
      scale: parseFloat(scale.x.toFixed(3))
    };

    const jsonSnippet = JSON.stringify({ karambitSocket: data }, null, 2);
    const tsSnippet = `// Calibrated Karambit Socket Transform (hand.R):\nknifeGroup.position.set(${data.position.join(', ')});\nknifeGroup.rotation.set(${data.rotationRad.join(', ')}); // deg: [${data.rotationDeg.join('°, ')}°]\nknifeGroup.scale.set(${data.scale}, ${data.scale}, ${data.scale});`;

    const fullText = `${jsonSnippet}\n\n${tsSnippet}`;

    // 1. Copy to clipboard
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(fullText).then(() => {
        this.setStatus('CONFIG COPIED TO CLIPBOARD!');
      }).catch(() => {
        this.copyViaTextarea(fullText);
      });
    } else {
      this.copyViaTextarea(fullText);
    }

    // 2. Output to dev console
    console.log('[PLAYHEAD VIEWMODEL CALIBRATION]\n' + fullText);
  }

  private copyViaTextarea(text: string): void {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    this.setStatus('CONFIG COPIED TO CLIPBOARD!');
  }

  /**
   * Saves current calibration into localStorage
   */
  public saveLocal(): void {
    const pos = this.viewmodelController.knifeSocketPos;
    const rot = this.viewmodelController.knifeSocketRot;
    const scale = this.viewmodelController.knifeSocketScale;

    const data: KnifeCalibrationData = {
      position: [
        parseFloat(pos.x.toFixed(4)),
        parseFloat(pos.y.toFixed(4)),
        parseFloat(pos.z.toFixed(4))
      ],
      rotationDeg: [
        parseFloat(((rot.x * 180) / Math.PI).toFixed(1)),
        parseFloat(((rot.y * 180) / Math.PI).toFixed(1)),
        parseFloat(((rot.z * 180) / Math.PI).toFixed(1))
      ],
      rotationRad: [
        parseFloat(rot.x.toFixed(4)),
        parseFloat(rot.y.toFixed(4)),
        parseFloat(rot.z.toFixed(4))
      ],
      scale: parseFloat(scale.x.toFixed(3))
    };

    try {
      localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(data));
      this.setStatus('SAVED TO LOCALSTORAGE (PERSISTS ON RELOAD)');
    } catch (e) {
      console.warn('[ViewmodelCalibrator] Save error:', e);
      this.setStatus('ERROR: COULD NOT SAVE TO LOCALSTORAGE');
    }
  }

  /**
   * Resets socket transform to hardcoded default
   */
  public resetToDefault(): void {
    this.viewmodelController.knifeSocketPos.set(...DEFAULT_KNIFE_CALIBRATION.position);
    this.viewmodelController.knifeSocketRot.set(...DEFAULT_KNIFE_CALIBRATION.rotationRad);
    this.viewmodelController.knifeSocketScale.set(
      DEFAULT_KNIFE_CALIBRATION.scale,
      DEFAULT_KNIFE_CALIBRATION.scale,
      DEFAULT_KNIFE_CALIBRATION.scale
    );

    const knifeGroup = this.viewmodelController.getKnifeGroup();
    if (knifeGroup) {
      knifeGroup.position.copy(this.viewmodelController.knifeSocketPos);
      knifeGroup.rotation.set(
        this.viewmodelController.knifeSocketRot.x,
        this.viewmodelController.knifeSocketRot.y,
        this.viewmodelController.knifeSocketRot.z
      );
      knifeGroup.scale.copy(this.viewmodelController.knifeSocketScale);
      knifeGroup.updateMatrixWorld(true);
    }
    this.gizmoHelper?.updateMatrixWorld(true);

    try {
      localStorage.removeItem(CALIBRATION_STORAGE_KEY);
    } catch {
      // ignore
    }

    this.syncInputsFromState();
    this.setStatus('RESET TO HARDCODED DEFAULT');
  }

  private setStatus(msg: string): void {
    if (this.statusEl) {
      this.statusEl.textContent = msg;
    }
  }

  private initKeyListeners(): void {
    window.addEventListener('keydown', (e) => {
      if (!this.isActive) return;

      // Don't intercept shortcut keys if user is typing into input field
      if (e.target instanceof HTMLInputElement) return;

      if (e.key === 'Shift') {
        this.isShiftDown = true;
        this.updateFineButtonUI();
      }

      if (e.code === 'Digit1' || e.code === 'KeyW') {
        e.preventDefault();
        this.setMode('translate');
      } else if (e.code === 'Digit2' || e.code === 'KeyE') {
        e.preventDefault();
        this.setMode('rotate');
      } else if (e.code === 'Digit3' || e.code === 'KeyR') {
        e.preventDefault();
        this.setMode('scale');
      } else if (e.code === 'KeyL') {
        e.preventDefault();
        this.toggleSpace();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') {
        this.isShiftDown = false;
        this.updateFineButtonUI();
      }
    });
  }

  private initUI(): void {
    const container = document.createElement('div');
    container.id = 'viewmodel-calibrator-panel';
    container.style.cssText = `
      position: fixed;
      top: 18px;
      right: 18px;
      width: 320px;
      background: rgba(10, 14, 22, 0.94);
      border: 1px solid rgba(0, 240, 255, 0.5);
      border-radius: 6px;
      padding: 14px;
      color: #e0e8f0;
      font-family: 'Consolas', 'Menlo', 'Monaco', monospace;
      font-size: 12px;
      z-index: 99999;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.7);
      user-select: none;
      display: none;
    `;

    // Title Bar
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding-bottom: 8px;
    `;
    header.innerHTML = `
      <div>
        <span style="color: #00f0ff; font-weight: bold; font-size: 13px; letter-spacing: 1px;">VIEWMODEL CALIBRATION</span>
        <span style="background: rgba(0,240,255,0.2); color: #00f0ff; padding: 1px 4px; border-radius: 3px; font-size: 10px; margin-left: 6px;">DEV</span>
      </div>
    `;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ (F4)';
    closeBtn.style.cssText = `
      background: transparent;
      border: 1px solid #445566;
      color: #88a0b8;
      border-radius: 3px;
      padding: 2px 6px;
      cursor: pointer;
      font-size: 11px;
    `;
    closeBtn.onclick = () => this.deactivate();
    header.appendChild(closeBtn);
    container.appendChild(header);

    // Target Label
    const targetEl = document.createElement('div');
    targetEl.style.cssText = 'color: #88a0b8; font-size: 11px; margin-bottom: 10px;';
    targetEl.innerHTML = `TARGET: <strong style="color: #fff;">KARAMBIT</strong> (socket: <span style="color: #00f0ff;">hand.R</span>)`;
    container.appendChild(targetEl);

    // Mode Selector Toolbar
    const modeRow = document.createElement('div');
    modeRow.style.cssText = 'display: flex; gap: 4px; margin-bottom: 8px;';

    const modes: Array<'translate' | 'rotate' | 'scale'> = ['translate', 'rotate', 'scale'];
    const modeLabels = { translate: 'TRANS [1/W]', rotate: 'ROT [2/E]', scale: 'SCALE [3/R]' };

    modes.forEach((m) => {
      const btn = document.createElement('button');
      btn.textContent = modeLabels[m];
      btn.style.cssText = `
        flex: 1;
        padding: 5px 0;
        font-size: 10px;
        font-family: inherit;
        border: 1px solid #334455;
        border-radius: 3px;
        cursor: pointer;
        background: ${m === this.currentMode ? '#00f0ff' : '#1a2230'};
        color: ${m === this.currentMode ? '#000000' : '#88a0b8'};
        font-weight: bold;
      `;
      btn.onclick = () => this.setMode(m);
      this.modeButtons[m] = btn;
      modeRow.appendChild(btn);
    });
    container.appendChild(modeRow);

    // Sub Toolbar: Space & Fine Mode
    const subToolRow = document.createElement('div');
    subToolRow.style.cssText = 'display: flex; gap: 6px; margin-bottom: 12px;';

    this.spaceButton = document.createElement('button');
    this.spaceButton.textContent = 'SPACE: LOCAL';
    this.spaceButton.style.cssText = `
      flex: 1;
      padding: 4px 6px;
      font-size: 10px;
      background: #141c28;
      border: 1px solid #00f0ff;
      color: #00f0ff;
      border-radius: 3px;
      cursor: pointer;
      font-family: inherit;
    `;
    this.spaceButton.onclick = () => this.toggleSpace();

    this.fineButton = document.createElement('button');
    this.fineButton.textContent = 'FINE: OFF (1x)';
    this.fineButton.style.cssText = `
      flex: 1;
      padding: 4px 6px;
      font-size: 10px;
      background: #141c28;
      border: 1px solid #334455;
      color: #88a0b8;
      border-radius: 3px;
      cursor: pointer;
      font-family: inherit;
    `;
    this.fineButton.onclick = () => this.toggleFineMode();

    subToolRow.appendChild(this.spaceButton);
    subToolRow.appendChild(this.fineButton);
    container.appendChild(subToolRow);

    // Coordinate Rows Helper
    const createChannelRow = (
      label: string,
      color: string,
      channel: 'posX' | 'posY' | 'posZ' | 'rotX' | 'rotY' | 'rotZ' | 'scale',
      step: number
    ): { row: HTMLElement; input: HTMLInputElement } => {
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; align-items: center; margin-bottom: 4px;';

      const lbl = document.createElement('span');
      lbl.textContent = label;
      lbl.style.cssText = `width: 22px; color: ${color}; font-weight: bold;`;

      const minusBtn = document.createElement('button');
      minusBtn.textContent = '-';
      minusBtn.style.cssText = 'width: 24px; height: 22px; background: #1a2230; border: 1px solid #334455; color: #fff; cursor: pointer; border-radius: 3px 0 0 3px; font-family: inherit;';
      minusBtn.onclick = () => this.nudgeValue(channel, -1);

      const input = document.createElement('input');
      input.type = 'number';
      input.step = String(step);
      input.style.cssText = `
        flex: 1;
        height: 20px;
        background: #0f1520;
        border: 1px solid #334455;
        border-left: none;
        border-right: none;
        color: #fff;
        text-align: right;
        padding: 0 4px;
        font-family: inherit;
        font-size: 11px;
      `;
      input.onchange = () => this.applyInputsToTarget();

      const plusBtn = document.createElement('button');
      plusBtn.textContent = '+';
      plusBtn.style.cssText = 'width: 24px; height: 22px; background: #1a2230; border: 1px solid #334455; color: #fff; cursor: pointer; border-radius: 0 3px 3px 0; font-family: inherit;';
      plusBtn.onclick = () => this.nudgeValue(channel, 1);

      row.appendChild(lbl);
      row.appendChild(minusBtn);
      row.appendChild(input);
      row.appendChild(plusBtn);

      return { row, input };
    };

    // Position Group
    const posHeader = document.createElement('div');
    posHeader.textContent = 'LOCAL POSITION (m)';
    posHeader.style.cssText = 'color: #88a0b8; font-size: 10px; margin: 8px 0 4px; font-weight: bold;';
    container.appendChild(posHeader);

    const posX = createChannelRow('X', '#ff5555', 'posX', 0.001);
    const posY = createChannelRow('Y', '#55ff55', 'posY', 0.001);
    const posZ = createChannelRow('Z', '#5599ff', 'posZ', 0.001);
    container.appendChild(posX.row);
    container.appendChild(posY.row);
    container.appendChild(posZ.row);
    this.posInputs = { x: posX.input, y: posY.input, z: posZ.input };

    // Rotation Group
    const rotHeader = document.createElement('div');
    rotHeader.textContent = 'LOCAL ROTATION (deg)';
    rotHeader.style.cssText = 'color: #88a0b8; font-size: 10px; margin: 8px 0 4px; font-weight: bold;';
    container.appendChild(rotHeader);

    const rotX = createChannelRow('X', '#ff5555', 'rotX', 0.5);
    const rotY = createChannelRow('Y', '#55ff55', 'rotY', 0.5);
    const rotZ = createChannelRow('Z', '#5599ff', 'rotZ', 0.5);
    container.appendChild(rotX.row);
    container.appendChild(rotY.row);
    container.appendChild(rotZ.row);
    this.rotInputs = { x: rotX.input, y: rotY.input, z: rotZ.input };

    // Scale Group
    const scaleHeader = document.createElement('div');
    scaleHeader.textContent = 'SCALE';
    scaleHeader.style.cssText = 'color: #88a0b8; font-size: 10px; margin: 8px 0 4px; font-weight: bold;';
    container.appendChild(scaleHeader);

    const scaleRow = createChannelRow('S', '#ffaa00', 'scale', 0.01);
    container.appendChild(scaleRow.row);
    this.scaleInput = scaleRow.input;

    // Action Buttons
    const actionRow = document.createElement('div');
    actionRow.style.cssText = 'display: flex; gap: 6px; margin-top: 14px;';

    const createActionBtn = (text: string, bg: string, color: string, onClick: () => void): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.textContent = text;
      btn.style.cssText = `
        flex: 1;
        padding: 6px 0;
        background: ${bg};
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: ${color};
        font-weight: bold;
        font-size: 10px;
        border-radius: 4px;
        cursor: pointer;
        font-family: inherit;
        transition: filter 0.15s;
      `;
      btn.onmouseover = () => { btn.style.filter = 'brightness(1.2)'; };
      btn.onmouseout = () => { btn.style.filter = 'brightness(1.0)'; };
      btn.onclick = onClick;
      return btn;
    };

    const resetBtn = createActionBtn('RESET', '#2a1a1a', '#ff6666', () => this.resetToDefault());
    const copyBtn = createActionBtn('COPY CONFIG', '#0a2a35', '#00f0ff', () => this.copyConfig());
    const saveBtn = createActionBtn('SAVE LOCAL', '#1a351a', '#66ff66', () => this.saveLocal());

    actionRow.appendChild(resetBtn);
    actionRow.appendChild(copyBtn);
    actionRow.appendChild(saveBtn);
    container.appendChild(actionRow);

    // Status / Feedback Line
    this.statusEl = document.createElement('div');
    this.statusEl.style.cssText = 'margin-top: 10px; color: #88a0b8; font-size: 10px; min-height: 14px; text-align: center;';
    this.statusEl.textContent = 'Hold [SHIFT] for 0.1x fine nudge step';
    container.appendChild(this.statusEl);

    document.body.appendChild(container);
    this.panelContainer = container;
  }

  public dispose(): void {
    this.deactivate();
    this.transformControls?.dispose();
    if (this.panelContainer && this.panelContainer.parentElement) {
      this.panelContainer.parentElement.removeChild(this.panelContainer);
    }
  }
}
