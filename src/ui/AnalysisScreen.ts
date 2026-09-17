/**
 * Analysis readout screen displaying real waveform, progress stages, and musical metrics
 * "World Mapped" experience: turns the audio signal into an authored procedural world.
 */

import { TrackAnalysis } from '../audio/AudioFeatures';
import { formatTime } from '../utils/math';
import { PaletteSelector } from '../audio/TrackPalettes';
import { VisualDreamDirector } from '../world/VisualDreamProfile';

export class AnalysisScreen {
  public element: HTMLElement;
  private trackTitleElem: HTMLElement;
  private stageElem: HTMLElement;
  private logElem: HTMLElement;
  private waveformCanvas: HTMLCanvasElement;
  private enterBtn: HTMLButtonElement;

  private durElem: HTMLElement;
  private bpmElem: HTMLElement;
  private sectionsElem: HTMLElement;
  private energyElem: HTMLElement;
  private profileElem: HTMLElement;
  private paletteElem: HTMLElement;

  private onEnterTrackCallback?: () => void;
  private animScanFrame = 0;
  private scanProgress = 0;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'screen analysis-screen hidden';
    this.element.innerHTML = `
      <div class="analysis-container">
        <div class="analysis-header">
          <h2 class="analysis-track-title" id="analysis-title">SIGNAL LOADING...</h2>
          <div class="analysis-stage" id="analysis-stage">SYNTHESIZING SIGNAL</div>
          <div class="terminal-stage-log" id="analysis-log" style="font-family: var(--font-mono); font-size: 0.78rem; color: #8899aa; margin-top: 8px; max-height: 80px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; border-left: 2px solid rgba(0,240,255,0.4); padding-left: 8px;"></div>
        </div>

        <canvas class="waveform-canvas" id="analysis-waveform" width="840" height="120"></canvas>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">DURATION</div>
            <div class="stat-value" id="stat-dur">--:--</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">TEMPO</div>
            <div class="stat-value" id="stat-bpm">--- BPM</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">SECTIONS</div>
            <div class="stat-value" id="stat-sections">--</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">ENERGY PROFILE</div>
            <div class="stat-value" id="stat-energy">---</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">DREAM MOTIF</div>
            <div class="stat-value" id="stat-profile">------</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">SIGNAL PALETTE</div>
            <div class="stat-value" id="stat-palette">------</div>
          </div>
        </div>

        <div class="analysis-footer">
          <button class="btn-hero" id="btn-enter-track" disabled>ENTER TRACK</button>
        </div>
      </div>
    `;

    this.trackTitleElem = this.element.querySelector('#analysis-title') as HTMLElement;
    this.stageElem = this.element.querySelector('#analysis-stage') as HTMLElement;
    this.logElem = this.element.querySelector('#analysis-log') as HTMLElement;
    this.waveformCanvas = this.element.querySelector('#analysis-waveform') as HTMLCanvasElement;
    this.enterBtn = this.element.querySelector('#btn-enter-track') as HTMLButtonElement;

    this.durElem = this.element.querySelector('#stat-dur') as HTMLElement;
    this.bpmElem = this.element.querySelector('#stat-bpm') as HTMLElement;
    this.sectionsElem = this.element.querySelector('#stat-sections') as HTMLElement;
    this.energyElem = this.element.querySelector('#stat-energy') as HTMLElement;
    this.profileElem = this.element.querySelector('#stat-profile') as HTMLElement;
    this.paletteElem = this.element.querySelector('#stat-palette') as HTMLElement;

    this.initEvents();
  }

  private initEvents(): void {
    const handleEnter = () => {
      if (this.enterBtn.disabled) return;
      this.triggerTransition();
    };

    this.enterBtn.addEventListener('click', handleEnter);

    window.addEventListener('keydown', (e) => {
      if (!this.element.classList.contains('hidden') && !this.enterBtn.disabled) {
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          handleEnter();
        }
      }
    });
  }

  private triggerTransition(): void {
    this.enterBtn.disabled = true;
    // 1. Contracting animation: collapse waveform to 2px signal line
    this.element.classList.add('contracting');

    // 2. Smoothly hand off to Countdown
    window.setTimeout(() => {
      this.onEnterTrackCallback?.();
    }, 280);
  }

  public setOnEnterTrack(callback: () => void): void {
    this.onEnterTrackCallback = callback;
  }

  public addStageLog(text: string): void {
    if (!this.logElem) return;
    const row = document.createElement('div');
    row.textContent = text;
    if (text.includes('[OK') || text.includes('READY')) {
      row.style.color = '#00f0ff';
      row.style.fontWeight = 'bold';
    } else if (text.startsWith('>')) {
      row.style.color = '#ffdd00';
    } else {
      row.style.color = '#94a3b8';
    }
    this.logElem.appendChild(row);
    this.logElem.scrollTop = this.logElem.scrollHeight;
  }

  public setStage(stageText: string): void {
    this.stageElem.textContent = stageText.toUpperCase();
    this.addStageLog(stageText);
  }

  public setTrackTitle(title: string): void {
    this.trackTitleElem.textContent = title.toUpperCase();
  }

  public show(): void {
    this.element.classList.remove('hidden');
    this.element.classList.remove('contracting');
    this.enterBtn.disabled = true;
    if (this.logElem) {
      this.logElem.innerHTML = '';
    }
    this.clearWaveform();
  }

  public hide(): void {
    if (this.animScanFrame) {
      cancelAnimationFrame(this.animScanFrame);
      this.animScanFrame = 0;
    }
    this.element.classList.add('hidden');
    this.element.classList.remove('contracting');
  }

  public displayAnalysis(analysis: TrackAnalysis): void {
    this.trackTitleElem.textContent = analysis.filename.toUpperCase();
    this.stageElem.textContent = 'WORLD MAPPED // READY TO RUN';

    this.durElem.textContent = formatTime(analysis.duration).slice(0, 5);
    this.bpmElem.textContent = `${analysis.bpm} BPM`;
    this.sectionsElem.textContent = `${analysis.sections.length} PHRASES`;

    let energyDesc = 'MODERATE';
    if (analysis.globalEnergy > 0.65) energyDesc = 'EXTREME';
    else if (analysis.globalEnergy > 0.45) energyDesc = 'HIGH';
    else if (analysis.globalEnergy < 0.25) energyDesc = 'LOW';
    this.energyElem.textContent = energyDesc;

    // Determine Palette and Visual Dream Motif
    const centroid = analysis.frames.length > 0 ? analysis.frames[0].centroid : 0.5;
    const palette = PaletteSelector.selectPalette(analysis.seed, centroid, analysis.globalEnergy);
    const profile = VisualDreamDirector.selectProfile(analysis.seed, analysis, palette);

    this.profileElem.textContent = profile.title.toUpperCase();
    this.paletteElem.textContent = palette.name.replace('_', ' ').toUpperCase();
    this.paletteElem.style.color = palette.primaryHex;

    this.animateWaveformSweep(analysis);

    this.enterBtn.disabled = false;
    this.enterBtn.focus();
  }

  private clearWaveform(): void {
    const ctx = this.waveformCanvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, this.waveformCanvas.width, this.waveformCanvas.height);
  }

  private animateWaveformSweep(analysis: TrackAnalysis): void {
    if (this.animScanFrame) {
      cancelAnimationFrame(this.animScanFrame);
    }
    this.scanProgress = 0;

    const startT = performance.now();
    const duration = 650; // 650ms sweep

    const loop = (now: number) => {
      const elapsed = now - startT;
      this.scanProgress = Math.min(1.0, elapsed / duration);
      this.drawWaveform(analysis, this.scanProgress);

      if (this.scanProgress < 1.0) {
        this.animScanFrame = requestAnimationFrame(loop);
      } else {
        this.animScanFrame = 0;
      }
    };
    this.animScanFrame = requestAnimationFrame(loop);
  }

  private drawWaveform(analysis: TrackAnalysis, scanRatio = 1.0): void {
    const ctx = this.waveformCanvas.getContext('2d');
    if (!ctx) return;

    const w = this.waveformCanvas.width;
    const h = this.waveformCanvas.height;
    const midY = h * 0.5;

    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, w, h);

    // Section vertical markers and labels
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.font = '9px "Space Mono", monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';

    for (const sec of analysis.sections) {
      const x = (sec.start / analysis.duration) * w;
      if (x <= w * scanRatio) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();

        ctx.fillText(sec.theme, x + 4, 12);
      }
    }

    // Real Waveform bars (graded by amplitude & spectral excitement)
    const env = analysis.waveform;
    const barWidth = w / env.length;
    const accentHex = analysis.visualAccent.hex;
    const maxBarIdx = Math.floor(env.length * scanRatio);

    for (let i = 0; i < maxBarIdx; i++) {
      const amp = env[i];
      const barH = Math.max(3, amp * (h * 0.88));
      const x = i * barWidth;
      const y = midY - barH * 0.5;

      // Brighter highlight for peaks
      if (amp > 0.65) {
        ctx.fillStyle = '#ffffff';
      } else if (amp > 0.35) {
        ctx.fillStyle = accentHex;
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      }

      ctx.fillRect(x, y, Math.max(1, barWidth - 1), barH);
    }

    // Scanline needle
    if (scanRatio < 1.0) {
      const scanX = w * scanRatio;
      ctx.strokeStyle = accentHex;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(scanX, 0);
      ctx.lineTo(scanX, h);
      ctx.stroke();
    }
  }
}
