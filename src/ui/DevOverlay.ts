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
import { RouteForkGenerator } from '../generation/RouteForkGenerator';
import type { ChannelIsolation } from '../world/MusicVisualController';
import { onlineBootstrap } from '../online/OnlineBootstrap';
import { leaderboardService } from '../online/LeaderboardService';
import { raceRoomService } from '../online/RaceRoomService';
import { PresetLevelCache } from '../audio/PresetLevelCache';
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

    // Toggle with F3 key; 1/2/3/4 isolate audio-visual channels (DEV only).
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.toggle();
        return;
      }
      if (!this.isVisible) return;
      const mode =
        e.code === 'Digit1' ? 'BASS' :
        e.code === 'Digit2' ? 'MID' :
        e.code === 'Digit3' ? 'HIGH' :
        e.code === 'Digit4' ? 'FULL' : null;
      if (mode) {
        e.preventDefault();
        this.channelIsolation = mode as ChannelIsolation;
      }
    });
  }

  /** DEV-only: current audio-visual channel isolation mode. */
  public channelIsolation: ChannelIsolation = 'FULL';

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
    world.visualController.setChannelIsolation(this.channelIsolation);

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
        `\n  ADAPTIVE FPS   ${environment.averageFps > 0 ? environment.averageFps.toFixed(0) : 'n/a'}` +
        `\n  ADAPTIVE TIER  ${environment.resolvedTier} | BLOOM ${environment.postProcessing.bloomPass.strength.toFixed(2)}` +
        `\n  COSMETIC VID   ${preset.cosmeticVideoScale}`;
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
      forkDiagnosticsLine(world),
      audioVisualDiagnosticsLine(world, this.channelIsolation),
      worldSafetyDiagnosticsLine(world),
      onlineDiagnosticsLine(),
      raceLobbyDiagnosticsLine(),
      assetDiagnosticsLine(),
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

/**
 * DEV: compact audio-visual choreography readout.
 *
 * Shows the derived channel values the world is actually being driven by, plus
 * the route/primary/secondary/tertiary response levels, so a tester can see
 * which parts of the music are reaching the world at any moment.
 */
/**
 * DEV: final world geometry safety report.
 *
 * This is the build-time audit result, not a per-frame metric: it is the last
 * word on whether any environment geometry intersects the gameplay envelope.
 * FINAL UNSAFE must be 0.
 */
/**
 * DEV: online / cloud progression status.
 *
 * Reports the real state, including the fact that competitive submission is
 * intentionally disabled until canonical map identity is available.
 */
function onlineDiagnosticsLine(): string {
  const status = onlineBootstrap.getStatus();
  const client = onlineBootstrap.getClient();
  const canSubmit = leaderboardService.canSubmitCompetitively();
  return (
    `ONLINE: ${client.getStatusLabel()} | ${status.state}` +
    `\n  ${status.detail}` +
    `\n  queue ${status.pendingOperations} | last sync ${
      status.lastSyncAt > 0 ? new Date(status.lastSyncAt).toISOString().slice(11, 19) : 'never'
    }` +
    `\n  SUBMIT ${canSubmit.ok ? 'ENABLED' : 'DISABLED'} // ${canSubmit.detail}`
  );
}

/**
 * DEV: friend-race lobby diagnostics.
 *
 * READY failures used to be invisible because the write result was discarded.
 * This exposes the whole chain: local identity, the row, the DB value, the last
 * verified write result, and how many realtime player events actually arrived.
 * Only a short user-id suffix is shown - never a full UUID in normal UI.
 */
function raceLobbyDiagnosticsLine(): string {
  const d = raceRoomService.getLobbyDiagnostics();
  const last = d.lastReadyUpdate;
  return (
    `RACE LOBBY: user ..${d.userIdSuffix} | room ${d.roomId}` +
    `\n  ROW ${d.rowFound ? 'yes' : 'no'} | READY local ${d.readyLocal} | READY db ${
      d.readyDatabase === null ? 'n/a' : d.readyDatabase
    }` +
    `\n  CONNECTED ${d.connected} | sync ${d.lobbySyncActive ? 'polling' : 'off'} | realtime player events ${d.realtimePlayerEvents}` +
    `\n  LAST READY: ${last ? `${last.ok ? 'ok' : 'FAIL'} rows=${last.rows} ${last.detail}` : 'none'}`
  );
}

/**
 * DEV: asset + cosmetic resource diagnostics.
 *
 * Covers the laptop suspects the PERF block cannot: how much cosmetic resource
 * is actually resident, whether an animated skin is decoding (and at what
 * resolution), and whether canonical presets are being re-fetched or re-parsed.
 */
function assetDiagnosticsLine(): string {
  const skins = KarambitSkinSystem.getInstance();
  const vid = skins.getVideoDiagnostics();
  const cache = PresetLevelCache.getCacheInfo();
  const lines = [
    `ASSETS: equipped ${skins.getEquippedSkinId()}` +
      `\n  STATIC TEX ${skins.getResidentTextureCount()} resident (max 1)` +
      ` | LIVE VIDEO ${skins.getActiveVideoCount()} (max 1)`
  ];
  lines.push(
    vid
      ? `  VIDEO ${vid.width}x${vid.height} ${vid.quality} | ready ${vid.readyState} | ` +
          `${vid.paused ? 'PAUSED' : 'PLAYING'} | ${vid.src.split('/').pop()}`
      : '  VIDEO none (no animated skin equipped)'
  );
  lines.push(
    `  PRESETS cached ${cache.cached} | fetches ${cache.loads} | cache hits ${cache.hits} | failed ${cache.misses}`
  );
  return lines.join('\n');
}

function worldSafetyDiagnosticsLine(world: World): string {  const r = world.worldSafetyReport;
  if (!r) return 'WORLD SAFETY: not run';
  return (
    `WORLD SAFETY: volumes ${r.gameplayVolumes} | objects ${r.decorativeObjects} | instances ${r.decorativeInstances}` +
    `\n  OVERLAP ${r.directOverlap} | VERTICAL ${r.verticalIntrusion} | SURF ${r.surfCorridor} | HEADROOM ${r.headroom} | COMFORT ${r.comfortClearance}` +
    `\n  REMOVED ${r.removed} | FINAL UNSAFE ${r.finalUnsafe}${r.finalUnsafe > 0 ? '  <-- MUST BE 0' : ''}` +
    `\n  unregistered ${r.unregisteredRenderables} | audit ${r.durationMs.toFixed(1)} ms`
  );
}

function audioVisualDiagnosticsLine(world: World, isolation: ChannelIsolation): string {
  const vs = world.visualController.state;
  const ch = vs.channels;
  const f = (n: number): string => n.toFixed(2);

  const route = Math.min(1.5, world.signalImpulse + ch.transient * 0.6 + ch.bassMass * 0.4);
  const primary = Math.min(1.5, ch.dropPrimary * 1.15 + ch.transient * 0.58 + ch.bassMass * 0.44);
  const secondary = Math.min(1.5, ch.dropSecondary * 0.72 + ch.bassMass * 0.26);
  const tertiary = Math.min(1.5, ch.dropTertiary * 0.40 + ch.bassMass * 0.14);

  const landmarks = world.signalLandmarks;
  const packets = world.routePackets;

  return (
    `AUDIO VISUAL [${isolation}]` +
    `\n  BASS       ${f(ch.bassMass)}` +
    `\n  MID        ${f(ch.midFlow)}` +
    `\n  HIGH       ${f(ch.highGlint)}` +
    `\n  ONSET      ${f(ch.transient)}` +
    `\n  ENERGY     ${f(vs.energy)}` +
    `\n  DROP       ${f(ch.dropPrimary)} / ${f(ch.dropSecondary)} / ${f(ch.dropTertiary)}` +
    `\n  SECTION    ${vs.sectionTheme} (energy ${f(ch.sectionEnergy)})` +
    `\n  PRESENCE   ${f(ch.presence)}` +
    `\n  ROUTE      ${f(route)}  packets ${packets ? packets.getActiveCount() : 0}` +
    `\n  PRIMARY    ${f(primary)}` +
    `\n  SECONDARY  ${f(secondary)}` +
    `\n  TERTIARY   ${f(tertiary)}` +
    `\n  LANDMARKS  ${landmarks ? landmarks.getVisibleCount() : 0} instances / ${landmarks ? landmarks.getDrawCallCount() : 0} draws`
  );
}

function forkDiagnosticsLine(world: World): string {  const forks = world.track?.forks ?? [];
  if (forks.length === 0) return 'FORKS: none';

  const report = RouteForkGenerator.getLastReport();
  const head =
    `FORKS: ${forks.length}` +
    (report
      ? ` | attempts ${report.attempts} accepted ${report.accepted} | ` +
        `rejected geom ${report.rejectedGeometry} solv ${report.rejectedSolvability} ` +
        `arch ${report.rejectedArchitecture} rejoin ${report.rejectedRejoin}`
      : '');
  const types = forks.map((f) => f.type).join(' ');

  // Nearest fork to the player's current route progress.
  const route = world.track?.route ?? [];
  const total = world.track?.totalDistance || 1;
  const playerArc = world.visualController.state.playerProgress * total;
  let nearest = forks[0];
  let best = Infinity;
  for (const fork of forks) {
    const mid = (fork.entryArcLength + fork.rejoinArcLength) * 0.5;
    const d = Math.abs(mid - playerArc);
    if (d < best) {
      best = d;
      nearest = fork;
    }
  }
  const safeNodes = route.filter(
    (n) => n.arcLength >= nearest.entryArcLength && n.arcLength <= nearest.rejoinArcLength
  ).length;

  return (
    head +
    `\nFORK TYPES: ${types || 'none'}` +
    `\nFORK NEAREST: ${nearest.type} | safe nodes ${safeNodes} | mastery nodes ${nearest.masteryNodes.length}` +
    `\nFORK DISTANCE: safe ${nearest.safeDistance.toFixed(0)}m | mastery ${nearest.masteryDistance.toFixed(0)}m` +
    `\nFORK VALIDATED: ${nearest.validated ? 'YES' : 'NO'}`
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
