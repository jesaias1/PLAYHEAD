/**
 * Dev Debug Overlay displaying real-time physics and audio-visual bus features
 * for PLAYHEAD when ?debug=1 or toggled via F3
 */

import { PlayerController } from '../player/PlayerController';
import { World } from '../world/World';
import { AudioEngine } from '../audio/AudioEngine';
import { TrackGenerator } from '../generation/TrackGenerator';
import { Environment } from '../world/Environment';
import { BUILD_LABEL } from '../core/BuildInfo';
import { KarambitSkinSystem } from '../viewmodel/KarambitSkinSystem';
import { RouteChallengeGenerator } from '../generation/RouteChallengeGenerator';
import { RouteGenerator } from '../generation/RouteGenerator';
import { RouteExclusionCorridor } from '../world/RouteExclusionCorridor';
import type { MovementFeedbackState } from '../feedback/MovementFeedbackController';

/** DEV-only Signal Gate diagnostics. */
export interface GateDiagnosticState {
  sequenceId: string;
  progress: number;
  total: number;
  complete: boolean;
  incomplete: boolean;
  lastSpeedUnits: number;
  lastCenterError: number;
  lastAlignment: number;
}

export class DevOverlay {
  public element: HTMLElement;
  private isVisible = false;
  private textElement: HTMLElement;
  private buttonBar: HTMLElement;

  constructor() {
    this.element = document.createElement('div');
    this.element.id = 'dev-overlay';
    this.element.style.cssText = `
      position: absolute;
      top: 10px;
      left: 10px;
      background: rgba(4, 7, 12, 0.9);
      border: 1px solid rgba(0, 240, 255, 0.3);
      padding: 12px 16px;
      font-family: monospace;
      font-size: 11px;
      color: #00ff88;
      z-index: 9999;
      pointer-events: none;
      display: none;
      line-height: 1.5;
    `;

    this.textElement = document.createElement('div');
    this.element.appendChild(this.textElement);

    this.buttonBar = document.createElement('div');
    this.buttonBar.style.cssText = `
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px solid rgba(0, 240, 255, 0.2);
      display: flex;
      gap: 8px;
      pointer-events: auto;
    `;
    this.buttonBar.innerHTML = `
      <button id="btn-dev-grant-signals" style="background: rgba(0, 240, 255, 0.12); color: #00f0ff; border: 1px solid #00f0ff; padding: 4px 8px; font-family: monospace; font-size: 10px; cursor: pointer;">[ GRANT 999 SIGNALS ]</button>
      <button id="btn-dev-clear-signals" style="background: rgba(255, 50, 50, 0.12); color: #ff5555; border: 1px solid #ff5555; padding: 4px 8px; font-family: monospace; font-size: 10px; cursor: pointer;">[ CLEAR SIGNALS ]</button>
    `;
    this.element.appendChild(this.buttonBar);

    const grantBtn = this.buttonBar.querySelector('#btn-dev-grant-signals') as HTMLButtonElement;
    const clearBtn = this.buttonBar.querySelector('#btn-dev-clear-signals') as HTMLButtonElement;

    grantBtn?.addEventListener('click', () => {
      KarambitSkinSystem.getInstance().grantDevPendingSignals(999);
      grantBtn.textContent = '[ +999 SIGNALS GRANTED ]';
      setTimeout(() => { grantBtn.textContent = '[ GRANT 999 SIGNALS ]'; }, 1500);
    });

    clearBtn?.addEventListener('click', () => {
      KarambitSkinSystem.getInstance().clearDevPendingSignals();
      clearBtn.textContent = '[ SIGNALS CLEARED ]';
      setTimeout(() => { clearBtn.textContent = '[ CLEAR SIGNALS ]'; }, 1500);
    });

    // Expose console helpers
    (window as any).grantDevSignals = (count = 999) => {
      KarambitSkinSystem.getInstance().grantDevPendingSignals(count);
      console.log(`[DEV] Granted ${count} pending signals`);
    };
    (window as any).clearDevSignals = () => {
      KarambitSkinSystem.getInstance().clearDevPendingSignals();
      console.log('[DEV] Cleared all pending signals');
    };

    document.body.appendChild(this.element);

    // Check query param
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') === '1') {
      this.show();
    }

    // Toggle with F3 key
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  public toggle(): void {
    if (this.isVisible) this.hide();
    else this.show();
  }

  public show(): void {
    this.isVisible = true;
    this.element.style.display = 'block';
  }

  public hide(): void {
    this.isVisible = false;
    this.element.style.display = 'none';
  }

  public update(
    player: PlayerController,
    world: World,
    audio: AudioEngine,
    environment?: Environment,
    fps = 0,
    feedback?: MovementFeedbackState,
    gates?: GateDiagnosticState
  ): void {
    if (!this.isVisible) return;

    world.setDebugChainVisible(this.isVisible);

    const pos = player.position;
    const vel = player.velocity;
    const speed = player.getSpeedUnits();
    const vs = world.visualController.state;

    // --- Performance / build block ---------------------------------------
    let perfBlock = `${BUILD_LABEL}`;
    if (environment) {
      const info = environment.renderer.info;
      const scale = environment.getRenderScaleInfo();
      const preset = environment.activePreset;
      const frameMs = fps > 0 ? 1000 / fps : 0;
      const city = world.skyline ? world.skyline.getVisibleCounts() : null;
      perfBlock =
        `PERF` +
        `\n  FPS            ${fps.toFixed(0)}` +
        `\n  FRAME          ${frameMs.toFixed(1)} ms` +
        `\n  DPR            ${scale.effectiveRatio.toFixed(2)} (cap ${preset.dprCap})` +
        `\n  SCALE          ${preset.renderScale.toFixed(2)} (${scale.bufferWidth}x${scale.bufferHeight})` +
        `\n  DRAWS          ${info.render.calls}` +
        `\n  TRIS           ${(info.render.triangles / 1000).toFixed(1)}k` +
        `\n  LINES          ${info.render.lines} | POINTS ${info.render.points}` +
        `\n  GEOMETRIES     ${info.memory.geometries} | TEXTURES ${info.memory.textures}` +
        `\n  PROGRAMS       ${info.programs ? info.programs.length : 'n/a'}` +
        (city ? `\n  VISIBLE CITY   ${city.visible} / ${city.total}` : '') +
        `\n  QUALITY        ${environment.qualityTier}${environment.qualityTier === 'AUTO' ? ` -> ${environment.resolvedTier}` : ''}` +
        `\n  DECOR LOD      ${preset.decorationLodDistance > 0 ? preset.decorationLodDistance + 'm' : 'off'}` +
        `\n  ADAPTIVE FPS   ${environment.averageFps > 0 ? environment.averageFps.toFixed(0) : 'n/a'}`;
    }

    const conn = TrackGenerator.lastReport?.connectivity;
    const connStatus = conn
      ? (conn.isValid ? `100% VALID (${conn.totalEdgesChecked}/${conn.totalEdgesChecked} edges | max gap: ${conn.maxObservedHorizontalGap.toFixed(1)}m | max step: +${conn.maxObservedStepUp.toFixed(2)}m)` : `FAIL (${conn.brokenEdges.length} BROKEN EDGES!)`)
      : 'CHECKED';

    const lines = [
      '=== PLAYHEAD DEV DIAGNOSTICS (F3) ===',
      perfBlock,
      `ROUTE CHAIN: ${connStatus}`,
      `PALETTE: ${vs.palette.name} | THEME: ${vs.sectionTheme} (#${vs.sectionIndex + 1}) | REACTIVITY: ${vs.reactivityMultiplier.toFixed(1)}x`,
      `COLOR MIX: PRI=${vs.primaryMix.toFixed(2)} SEC=${vs.secondaryMix.toFixed(2)} HI=${vs.highlightMix.toFixed(2)}`,
      `STRAFE: ANGLE=${player.currentStrafeAngle.toFixed(1)}° EFF=${(player.currentStrafeEfficiency * 100).toFixed(0)}% [${player.currentStrafeRating}]`,
      `POS: X=${pos.x.toFixed(1)} Y=${pos.y.toFixed(1)} Z=${pos.z.toFixed(1)}`,
      `VEL: (${vel.x.toFixed(1)}, ${vel.y.toFixed(1)}, ${vel.z.toFixed(1)}) | SPEED: ${Math.round(speed)} u/s`,
      `GROUNDED: ${player.isGrounded} | SURFING: ${player.isSurfing} | SIDE: ${player.surfState.surfSide}`,
      `SURF: ANGLE=${player.surfState.surfaceAngleDeg.toFixed(1)}° | TANG_SPD=${player.surfState.tangentialSpeed.toFixed(1)} m/s | NORM=(${player.surfState.surfNormal.x.toFixed(2)}, ${player.surfState.surfNormal.y.toFixed(2)}, ${player.surfState.surfNormal.z.toFixed(2)})`,
      `AUDIO TIME: ${audio.getCurrentTime().toFixed(2)}s / ${audio.getDuration().toFixed(2)}s`,
      `ENERGY: ${vs.energy.toFixed(2)} | SUB: ${vs.subBass.toFixed(2)} | BASS: ${vs.bass.toFixed(2)} | MID: ${vs.mid.toFixed(2)} | HIGH: ${vs.high.toFixed(2)}`,
      `FLUX: ${vs.flux.toFixed(2)} | ONSET PULSE: ${vs.onsetPulse.toFixed(2)} | CENTROID: ${vs.brightness.toFixed(2)}`,
      `BUILDUP: ${vs.buildup.toFixed(2)} | DROP IMPACT: ${vs.dropImpact.toFixed(2)} | NEXT DROP DIST: ${vs.upcomingDropDistance > 9000 ? 'NONE' : vs.upcomingDropDistance.toFixed(1) + 'm'}`,
      `SYNC DELTA: ${vs.syncDelta.toFixed(2)}s | PLAYER PROG: ${(vs.playerProgress * 100).toFixed(1)}% | TIME PROG: ${(vs.progress * 100).toFixed(1)}%`,
      world.track ? `ROUTE NODES: ${world.track.route.length} | CPS: ${world.track.checkpoints.length} | REPAIRS: ${world.track.repairedJumpsCount} | ATTEMPTS: ${TrackGenerator.lastReport?.attempts || 1}` : 'TRACK: NONE',
      obstacleDiagnosticsLine(world),
      tempoDiagnosticsLine(),
      gates
        ? `SIGNAL GATES: ${gates.sequenceId} | progress ${gates.progress}/${gates.total} | ` +
          `complete=${gates.complete} incomplete=${gates.incomplete} | ` +
          `last speed ${Math.round(gates.lastSpeedUnits)} u/s align ${gates.lastAlignment.toFixed(2)} ` +
          `centreErr ${gates.lastCenterError.toFixed(2)}`
        : 'SIGNAL GATES: none',
      feedback
        ? `FEEDBACK: SPEED ${Math.round(feedback.speedUnits)} u/s [${feedback.speedBand}] ` +
          `I=${feedback.speedIntensity.toFixed(2)} | LAST ${feedback.lastEvent} | ` +
          `LAND I=${feedback.landingIntensity.toFixed(2)}${feedback.landingMajor ? ' (MAJOR)' : ''} | ` +
          `SURF Q=${feedback.surfQuality.toFixed(2)} | CAM ${feedback.cameraOffsetY.toFixed(3)}`
        : 'FEEDBACK: n/a'
    ];

    this.textElement.innerText = lines.join('\n');
  }
}

function tempoDiagnosticsLine(): string {
  const t = RouteGenerator.lastTempoReport;
  if (!t) return 'TEMPO: n/a';
  return (
    `TEMPO: RAW ${t.rawBpm.toFixed(0)} BPM -> EFFECTIVE ${t.effectiveBpm.toFixed(0)} BPM ` +
    `[${t.band}] ${t.interpretation} | PRESSURE ${t.pressure.toFixed(2)}` +
    `\nTEMPO ROUTE: STAGGER ${t.staggerChains} chains / ${t.staggerSteps} steps | ` +
    `OBSTACLE CADENCE x${t.obstacleSpacingMultiplier.toFixed(2)} | SURF EVENTS ${t.surfEvents}`
  );
}

function obstacleDiagnosticsLine(world: World): string {
  const report = RouteChallengeGenerator.getLastReport();
  const count = world.track?.obstacles?.length ?? 0;
  if (!report) {
    return `OBSTACLES: ${count} (no report)`;
  }
  const types = Object.entries(report.countByType)
    .map(([type, n]) => `${type}:${n}`)
    .join(' ');
  const difficulty = Object.entries(report.countByDifficulty)
    .map(([band, n]) => `${band}:${n}`)
    .join(' ');
  const rejections = Object.entries(report.rejectionReasons)
    .map(([reason, n]) => `${reason}:${n}`)
    .join(' ');
  const buildings = RouteExclusionCorridor.getLastBuildingReport();
  return (
    `OBSTACLES: ${report.obstaclesGenerated} in ${report.phrasesGenerated} phrases ` +
    `| ELIGIBLE: ${report.eligibleNodes} | REJECTED: ${report.rejected}` +
    `\nOBSTACLE TYPES: ${types || 'none'} | DIFFICULTY: ${difficulty || 'none'}` +
    `\nOBSTACLE REJECTIONS: ${rejections || 'none'}` +
    `\nBUILDINGS: ${buildings.candidatesGenerated} cand | overlap ${buildings.rejectedByGameplayCollision} | ` +
    `comfort ${buildings.rejectedByComfortClearance} | vertical ${buildings.rejectedByVerticalIntrusion} | ` +
    `surf ${buildings.rejectedBySurfCorridor} | survive ${buildings.finalSurvivingBuildings}`
  );
}
