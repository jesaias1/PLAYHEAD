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

export class DevOverlay {
  public element: HTMLElement;
  private isVisible = false;

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
    fps = 0
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
      perfBlock =
        `${BUILD_LABEL} | TIER: ${environment.qualityTier}` +
        (environment.qualityTier === 'AUTO' ? ` -> ${environment.resolvedTier}` : '') +
        `\nFPS: ${fps.toFixed(0)} | DRAW CALLS: ${info.render.calls} | TRIS: ${info.render.triangles}` +
        `\nRENDER SCALE: ${scale.effectiveRatio.toFixed(2)}x (${scale.bufferWidth}x${scale.bufferHeight}) | DPR: ${window.devicePixelRatio.toFixed(2)} cap ${preset.dprCap}` +
        `\nGPU MEM: ${info.memory.geometries} geo / ${info.memory.textures} tex | PROGRAMS: ${info.programs ? info.programs.length : 'n/a'}` +
        `\nDECOR LOD: ${preset.decorationLodDistance > 0 ? preset.decorationLodDistance + 'm' : 'off'}` +
        `\nADAPTIVE FPS: ${environment.averageFps > 0 ? environment.averageFps.toFixed(0) : 'n/a'}`;
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
      world.track ? `ROUTE NODES: ${world.track.route.length} | CPS: ${world.track.checkpoints.length} | REPAIRS: ${world.track.repairedJumpsCount} | ATTEMPTS: ${TrackGenerator.lastReport?.attempts || 1}` : 'TRACK: NONE'
    ];

    this.element.innerText = lines.join('\n');
  }
}
