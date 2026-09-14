/**
 * Analysis readout screen displaying real waveform, progress stages, and musical metrics
 */

import { TrackAnalysis } from '../audio/AudioFeatures';
import { formatTime } from '../utils/math';
import { seedToHex } from '../utils/hash';

export class AnalysisScreen {
  public element: HTMLElement;
  private trackTitleElem: HTMLElement;
  private stageElem: HTMLElement;
  private waveformCanvas: HTMLCanvasElement;
  private enterBtn: HTMLButtonElement;

  private durElem: HTMLElement;
  private bpmElem: HTMLElement;
  private onsetsElem: HTMLElement;
  private sectionsElem: HTMLElement;
  private energyElem: HTMLElement;
  private seedElem: HTMLElement;

  private onEnterTrackCallback?: () => void;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'screen analysis-screen hidden';
    this.element.innerHTML = `
      <div class="analysis-container">
        <div class="analysis-header">
          <h2 class="analysis-track-title" id="analysis-title">SIGNAL LOADING...</h2>
          <div class="analysis-stage" id="analysis-stage">DECODING SIGNAL</div>
        </div>

        <canvas class="waveform-canvas" id="analysis-waveform" width="780" height="120"></canvas>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">DURATION</div>
            <div class="stat-value" id="stat-dur">--:--</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">BPM</div>
            <div class="stat-value" id="stat-bpm">---</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">ONSETS</div>
            <div class="stat-value" id="stat-onsets">---</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">SECTIONS</div>
            <div class="stat-value" id="stat-sections">--</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">ENERGY</div>
            <div class="stat-value" id="stat-energy">---</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">SEED</div>
            <div class="stat-value" id="stat-seed">------</div>
          </div>
        </div>

        <div class="analysis-footer">
          <button class="primary" id="btn-enter-track" disabled>ENTER TRACK</button>
        </div>
      </div>
    `;

    this.trackTitleElem = this.element.querySelector('#analysis-title') as HTMLElement;
    this.stageElem = this.element.querySelector('#analysis-stage') as HTMLElement;
    this.waveformCanvas = this.element.querySelector('#analysis-waveform') as HTMLCanvasElement;
    this.enterBtn = this.element.querySelector('#btn-enter-track') as HTMLButtonElement;

    this.durElem = this.element.querySelector('#stat-dur') as HTMLElement;
    this.bpmElem = this.element.querySelector('#stat-bpm') as HTMLElement;
    this.onsetsElem = this.element.querySelector('#stat-onsets') as HTMLElement;
    this.sectionsElem = this.element.querySelector('#stat-sections') as HTMLElement;
    this.energyElem = this.element.querySelector('#stat-energy') as HTMLElement;
    this.seedElem = this.element.querySelector('#stat-seed') as HTMLElement;

    this.enterBtn.addEventListener('click', () => {
      this.onEnterTrackCallback?.();
    });
  }

  public setOnEnterTrack(callback: () => void): void {
    this.onEnterTrackCallback = callback;
  }

  public setStage(stageText: string): void {
    this.stageElem.textContent = stageText;
  }

  public setTrackTitle(title: string): void {
    this.trackTitleElem.textContent = title.toUpperCase();
  }

  public show(): void {
    this.element.classList.remove('hidden');
    this.enterBtn.disabled = true;
    this.clearWaveform();
  }

  public hide(): void {
    this.element.classList.add('hidden');
  }

  public displayAnalysis(analysis: TrackAnalysis): void {
    this.trackTitleElem.textContent = analysis.filename.toUpperCase();
    this.stageElem.textContent = 'TRACK MAPPED';

    this.durElem.textContent = formatTime(analysis.duration).slice(0, 5);
    this.bpmElem.textContent = `${analysis.bpm}`;
    this.onsetsElem.textContent = `${analysis.onsets.length}`;
    this.sectionsElem.textContent = `${analysis.sections.length}`;

    let energyDesc = 'MODERATE';
    if (analysis.globalEnergy > 0.65) energyDesc = 'EXTREME';
    else if (analysis.globalEnergy > 0.45) energyDesc = 'HIGH';
    else if (analysis.globalEnergy < 0.25) energyDesc = 'LOW';
    this.energyElem.textContent = energyDesc;

    this.seedElem.textContent = seedToHex(analysis.seed).slice(0, 6);

    this.drawWaveform(analysis);

    this.enterBtn.disabled = false;
    this.enterBtn.focus();
  }

  private clearWaveform(): void {
    const ctx = this.waveformCanvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0e1013';
    ctx.fillRect(0, 0, this.waveformCanvas.width, this.waveformCanvas.height);
  }

  private drawWaveform(analysis: TrackAnalysis): void {
    const ctx = this.waveformCanvas.getContext('2d');
    if (!ctx) return;

    const w = this.waveformCanvas.width;
    const h = this.waveformCanvas.height;
    const midY = h * 0.5;

    ctx.fillStyle = '#0e1013';
    ctx.fillRect(0, 0, w, h);

    // Section vertical markers
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    for (const sec of analysis.sections) {
      const x = (sec.start / analysis.duration) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Real Waveform bars
    const env = analysis.waveform;
    const barWidth = w / env.length;
    ctx.fillStyle = analysis.visualAccent.hex;

    for (let i = 0; i < env.length; i++) {
      const amp = env[i];
      const barH = Math.max(2, amp * (h * 0.85));
      const x = i * barWidth;
      const y = midY - barH * 0.5;
      ctx.fillRect(x, y, Math.max(1, barWidth - 1), barH);
    }
  }
}
