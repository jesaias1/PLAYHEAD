/**
 * Dedicated debug HUD for Movement Lab
 * Displays live kinematic variables, air control metrics, preset status, and input cheat sheet.
 */

import { PlayerController } from '../player/PlayerController';
import { CameraController } from '../player/CameraController';
import { formatSpeed, radToDeg } from '../utils/math';

export class MovementLabHUD {
  public element: HTMLElement;
  private presetElem: HTMLElement;
  private obstacleElem: HTMLElement;
  private speedElem: HTMLElement;
  private stateElem: HTMLElement;
  private velHElem: HTMLElement;
  private airAccelElem: HTMLElement;
  private strafeAngleElem: HTMLElement;
  private strafeEffElem: HTMLElement;
  private peakSpeedElem: HTMLElement;
  private lastLandingElem: HTMLElement;
  private lookElem: HTMLElement;
  private trajStatusElem: HTMLElement;
  private surfRowElem: HTMLElement;
  private surfInfoElem: HTMLElement;

  constructor() {
    this.element = document.createElement('div');
    this.element.id = 'movement-lab-hud';
    this.element.innerHTML = `
      <div class="lab-hud-panel">
        <div class="lab-hud-header">MOVEMENT LAB // CONTROLS CALIBRATION</div>
        <div class="lab-stat-row">
          <span class="lab-stat-label">PRESET:</span>
          <span class="lab-stat-val highlight" id="lab-preset">[3] PLAYHEAD</span>
        </div>
        <div class="lab-stat-row">
          <span class="lab-stat-label">OBSTACLE:</span>
          <span class="lab-stat-val" id="lab-obstacle">—</span>
        </div>
        <div class="lab-stat-row">
          <span class="lab-stat-label">SPEED:</span>
          <span class="lab-stat-val bold" id="lab-speed">0 u/s (0.0 m/s)</span>
        </div>
        <div class="lab-stat-row">
          <span class="lab-stat-label">STATE:</span>
          <span class="lab-stat-val" id="lab-state">GROUNDED</span>
        </div>
        <div class="lab-stat-row">
          <span class="lab-stat-label">VELOCITY:</span>
          <span class="lab-stat-val" id="lab-vel">H: 0.0 m/s | V: 0.0 m/s</span>
        </div>
        <div class="lab-stat-row">
          <span class="lab-stat-label">AIR ACCEL ADDED:</span>
          <span class="lab-stat-val" id="lab-air-accel">+0.00 m/s</span>
        </div>
        <div class="lab-stat-row">
          <span class="lab-stat-label">STRAFE ANGLE:</span>
          <span class="lab-stat-val" id="lab-strafe-angle">—</span>
        </div>
        <div class="lab-stat-row">
          <span class="lab-stat-label">ACCEL EFFICIENCY:</span>
          <span class="lab-stat-val" id="lab-strafe-eff">—</span>
        </div>
        <div class="lab-stat-row" id="lab-surf-row" style="display: none;">
          <span class="lab-stat-label">SURF TELEMETRY:</span>
          <span class="lab-stat-val surf" id="lab-surf-info">—</span>
        </div>
        <div class="lab-stat-row">
          <span class="lab-stat-label">PEAK SPEED:</span>
          <span class="lab-stat-val" id="lab-peak-speed">0 u/s</span>
        </div>
        <div class="lab-stat-row">
          <span class="lab-stat-label">LAST LANDING:</span>
          <span class="lab-stat-val" id="lab-last-landing">—</span>
        </div>
        <div class="lab-stat-row">
          <span class="lab-stat-label">LOOK & FOV:</span>
          <span class="lab-stat-val" id="lab-look">Yaw: 0° | Pitch: 0° | FOV: 75°</span>
        </div>
        <div class="lab-stat-row">
          <span class="lab-stat-label">TRAJECTORY TRAIL:</span>
          <span class="lab-stat-val" id="lab-traj">[T] OFF</span>
        </div>
      </div>

      <div class="lab-cheat-sheet">
        <span class="cheat-item"><b>WASD</b> MOVE</span>
        <span class="cheat-sep">|</span>
        <span class="cheat-item"><b>MOUSE</b> LOOK</span>
        <span class="cheat-sep">|</span>
        <span class="cheat-item"><b>SPACE</b> BHOP</span>
        <span class="cheat-sep">|</span>
        <span class="cheat-item"><b>R</b> RESET</span>
        <span class="cheat-sep">|</span>
        <span class="cheat-item"><b>1/2/3</b> PRESETS</span>
        <span class="cheat-sep">|</span>
        <span class="cheat-item"><b>4-8</b> SURF LAB</span>
        <span class="cheat-sep">|</span>
        <span class="cheat-item"><b>9</b> OBSTACLE LAB</span>
        <span class="cheat-sep">|</span>
        <span class="cheat-item"><b>[ ]</b> SECTION</span>
        <span class="cheat-sep">|</span>
        <span class="cheat-item"><b>T</b> TRAJECTORY</span>
        <span class="cheat-sep">|</span>
        <span class="cheat-item"><b>ESC</b> EXIT</span>
      </div>
    `;

    this.presetElem = this.element.querySelector('#lab-preset') as HTMLElement;
    this.obstacleElem = this.element.querySelector('#lab-obstacle') as HTMLElement;
    this.speedElem = this.element.querySelector('#lab-speed') as HTMLElement;
    this.stateElem = this.element.querySelector('#lab-state') as HTMLElement;
    this.velHElem = this.element.querySelector('#lab-vel') as HTMLElement;
    this.airAccelElem = this.element.querySelector('#lab-air-accel') as HTMLElement;
    this.strafeAngleElem = this.element.querySelector('#lab-strafe-angle') as HTMLElement;
    this.strafeEffElem = this.element.querySelector('#lab-strafe-eff') as HTMLElement;
    this.peakSpeedElem = this.element.querySelector('#lab-peak-speed') as HTMLElement;
    this.lastLandingElem = this.element.querySelector('#lab-last-landing') as HTMLElement;
    this.lookElem = this.element.querySelector('#lab-look') as HTMLElement;
    this.trajStatusElem = this.element.querySelector('#lab-traj') as HTMLElement;
    this.surfRowElem = this.element.querySelector('#lab-surf-row') as HTMLElement;
    this.surfInfoElem = this.element.querySelector('#lab-surf-info') as HTMLElement;
  }

  public update(
    player: PlayerController,
    cameraController: CameraController,
    currentFov: number,
    trajEnabled: boolean
  ): void {
    const horizSpeed = Math.sqrt(player.velocity.x * player.velocity.x + player.velocity.z * player.velocity.z);
    const speedUnits = player.getSpeedUnits();

    // Preset
    const presetLabels: Record<string, string> = {
      CURRENT: '[1] CURRENT (90 accel / 3.0 cap / 3.5 steer)',
      SOURCE: '[2] SOURCE (120 accel / 2.5 cap / 0 steer)',
      PLAYHEAD: '[3] PLAYHEAD (90 accel / 3.0 cap / 3.5 steer)',
      TRACK_RUN: '[3] PLAYHEAD (90 accel / 3.0 cap / 3.5 steer)'
    };
    this.presetElem.textContent = presetLabels[player.currentPreset] || player.currentPreset;

    // Speed
    this.speedElem.textContent = `${formatSpeed(speedUnits)} u/s (${horizSpeed.toFixed(1)} m/s)`;

    // State & Surf Telemetry
    const isSurf = player.surfState.isSurfing || player.isSurfing;
    if (isSurf) {
      const sideText = player.surfState.surfSide !== 'NONE' ? ` [${player.surfState.surfSide} RAMP]` : '';
      this.stateElem.textContent = `SURFING${sideText}`;
      this.stateElem.className = 'lab-stat-val surf';

      this.surfRowElem.style.display = 'flex';
      const tSpeed = player.surfState.tangentialSpeed;
      const tUnits = Math.round(tSpeed * player.config.speedUnitScale);
      const eUnits = Math.round(player.surfState.entrySpeed * player.config.speedUnitScale);
      const sn = player.surfState.surfNormal;
      this.surfInfoElem.textContent = `${player.surfState.surfaceAngleDeg.toFixed(1)}° slope | Tang: ${tUnits} u/s (${tSpeed.toFixed(1)} m/s) | Entry: ${eUnits} u/s | N: (${sn.x.toFixed(2)}, ${sn.y.toFixed(2)}, ${sn.z.toFixed(2)})`;
    } else if (player.isGrounded) {
      this.stateElem.textContent = 'GROUNDED';
      this.stateElem.className = 'lab-stat-val grounded';
      this.surfRowElem.style.display = 'none';
    } else {
      this.stateElem.textContent = 'AIRBORNE';
      this.stateElem.className = 'lab-stat-val airborne';
      this.surfRowElem.style.display = 'none';
    }

    // Velocity components
    this.velHElem.textContent = `H: ${horizSpeed.toFixed(1)} m/s | V: ${player.velocity.y.toFixed(1)} m/s`;

    // Air acceleration added this tick
    if (!player.isGrounded && player.lastAirAccelAdded > 0) {
      this.airAccelElem.textContent = `+${player.lastAirAccelAdded.toFixed(2)} m/s`;
      this.airAccelElem.className = 'lab-stat-val positive';
    } else {
      this.airAccelElem.textContent = '+0.00 m/s';
      this.airAccelElem.className = 'lab-stat-val';
    }

    // Strafe Angle & Efficiency
    if (!player.isGrounded && horizSpeed > 1.0) {
      this.strafeAngleElem.textContent = `${player.currentStrafeAngle.toFixed(1)}°`;
      const effPct = Math.round(player.currentStrafeEfficiency * 100);
      const rating = player.currentStrafeRating;
      this.strafeEffElem.textContent = `${effPct}% [${rating}]`;
      if (rating === 'OPTIMAL') {
        this.strafeEffElem.className = 'lab-stat-val positive';
      } else if (rating === 'GOOD') {
        this.strafeEffElem.className = 'lab-stat-val highlight';
      } else {
        this.strafeEffElem.className = 'lab-stat-val';
      }
    } else {
      this.strafeAngleElem.textContent = '—';
      this.strafeEffElem.textContent = '—';
      this.strafeEffElem.className = 'lab-stat-val';
    }

    // Peak speed and last landing
    this.peakSpeedElem.textContent = `${formatSpeed(player.stats.maxSpeed)} u/s`;
    this.lastLandingElem.textContent = player.lastLandingSpeed > 0 ? `${formatSpeed(player.lastLandingSpeed)} u/s` : '—';

    // Look angles & FOV
    const degYaw = Math.round(radToDeg(cameraController.yaw)) % 360;
    const degPitch = Math.round(radToDeg(cameraController.pitch));
    this.lookElem.textContent = `Yaw: ${degYaw}° | Pitch: ${degPitch}° | FOV: ${Math.round(currentFov)}°`;

    // Trajectory status
    this.trajStatusElem.textContent = trajEnabled ? '[T] ON' : '[T] OFF';
    this.trajStatusElem.className = trajEnabled ? 'lab-stat-val highlight' : 'lab-stat-val';
  }

  public show(): void {
    this.element.style.display = 'flex';
  }

  /** DEV: shows which obstacle gauntlet station the player is currently in. */
  public setObstacleSection(label: string | null): void {
    this.obstacleElem.textContent = label ?? '—';
    this.obstacleElem.className = label ? 'lab-stat-val highlight' : 'lab-stat-val';
  }

  public hide(): void {
    this.element.style.display = 'none';
  }

  public destroy(): void {
    if (this.element.parentElement) {
      this.element.parentElement.removeChild(this.element);
    }
  }
}
