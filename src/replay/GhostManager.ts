/**
 * GhostManager: Coordinates in-game ghost runners, checkpoint split time comparisons,
 * and integration with the game loop and HUD.
 */

import * as THREE from 'three';
import { GeneratedTrack } from '../generation/GenerationTypes';
import { GhostRunner } from './GhostRunner';
import { GhostStorage, SavedGhostRun } from './GhostStorage';
import { AuthorGhostGenerator, AuthorGhostRun } from './AuthorGhostGenerator';
import { ReplayFrame } from './ReplayRecorder';
import { SettingsManager, GhostMode } from '../core/Settings';

export interface SplitResult {
  checkpointIndex: number;
  deltaSeconds: number;
  target: 'PB' | 'ECHO' | 'GHOST';
  isAhead: boolean;
  /**
   * Optional precise label for the HUD (e.g. `PB GHOST`, `WORLD #1 // SIGNAL-4F21`).
   * Falls back to the target name when absent.
   */
  label?: string;
}

export class GhostManager {
  private scene: THREE.Scene;
  private pbGhost: GhostRunner | null = null;
  private rivalGhost: GhostRunner | null = null;

  private activePBData: SavedGhostRun | null = null;
  private activeRivalData: AuthorGhostRun | null = null;

  public playerCheckpointTimes: number[] = [];
  public currentTrackTitle = '';

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Initializes or refreshes ghosts for the specified track
   */
  public prepareTrack(track: GeneratedTrack, trackTitle?: string): void {
    this.dispose();

    this.currentTrackTitle = trackTitle || 'PLAYHEAD TRACK';
    this.playerCheckpointTimes = [];

    // 1. Synthesize Rival / Echo ghost deterministically
    this.activeRivalData = AuthorGhostGenerator.generate(track);
    this.rivalGhost = new GhostRunner(this.scene, {
      type: 'RIVAL',
      primaryColor: 0xa855f7, // Cosmic violet wireframe
      emissiveColor: 0xfbbf24, // Radiant amber inner core
      name: 'Rival_Echo'
    });
    this.rivalGhost.setFrames(this.activeRivalData.frames);

    // 2. Load PB ghost if saved in localStorage
    this.activePBData = GhostStorage.loadPB(track.seed);
    if (this.activePBData) {
      const pbFrames = GhostStorage.decompressFrames(this.activePBData.frames);
      this.pbGhost = new GhostRunner(this.scene, {
        type: 'PB',
        primaryColor: 0x00f0ff, // Cyan holographic wireframe
        emissiveColor: 0xffffff, // Electric white inner core
        name: 'Player_PB'
      });
      this.pbGhost.setFrames(pbFrames);
    } else {
      this.pbGhost = null;
    }

    this.applySettingsVisibility();
  }

  /**
   * Updates visibility based on user settings
   */
  public applySettingsVisibility(): void {
    const settings = SettingsManager.getInstance().settings;
    const mode: GhostMode = settings.ghostMode || 'ALL';

    if (mode === 'OFF') {
      this.pbGhost?.hide();
      this.rivalGhost?.hide();
    } else if (mode === 'PB_ONLY') {
      this.pbGhost?.show();
      this.rivalGhost?.hide();
    } else if (mode === 'RIVAL_ONLY') {
      this.pbGhost?.hide();
      this.rivalGhost?.show();
    } else {
      // 'ALL'
      this.pbGhost?.show();
      this.rivalGhost?.show();
    }
  }

  /**
   * Resets ghost positions and player checkpoint timestamps at run start
   */
  public start(): void {
    this.playerCheckpointTimes = [];
    this.pbGhost?.reset();
    this.rivalGhost?.reset();
    this.applySettingsVisibility();
  }

  /**
   * Updates both ghost positions and alpha fades in the 3D scene
   */
  public update(runElapsedTime: number, playerPos: THREE.Vector3, dt: number): void {
    this.pbGhost?.update(runElapsedTime, playerPos, dt);
    this.rivalGhost?.update(runElapsedTime, playerPos, dt);
  }

  /**
   * Registers player reaching a checkpoint and calculates the split time difference
   */
  public onPlayerReachCheckpoint(cpIndex: number, playerTime: number): SplitResult | null {
    this.playerCheckpointTimes[cpIndex] = playerTime;

    // Prefer comparing against PB if available, otherwise compare against Echo / Rival
    if (this.activePBData && this.activePBData.checkpointTimes && this.activePBData.checkpointTimes[cpIndex] !== undefined) {
      const pbTime = this.activePBData.checkpointTimes[cpIndex];
      const delta = playerTime - pbTime;
      return {
        checkpointIndex: cpIndex,
        deltaSeconds: delta,
        target: 'PB',
        isAhead: delta < 0
      };
    } else if (this.activeRivalData && this.activeRivalData.checkpointTimes && this.activeRivalData.checkpointTimes[cpIndex] !== undefined) {
      const rivalTime = this.activeRivalData.checkpointTimes[cpIndex];
      const delta = playerTime - rivalTime;
      return {
        checkpointIndex: cpIndex,
        deltaSeconds: delta,
        target: 'ECHO',
        isAhead: delta < 0
      };
    }

    return null;
  }

  /**
   * Saves the completed run as personal best if qualified
   */
  public saveIfPersonalBest(
    seed: number,
    trackTitle: string,
    completionTime: number,
    score: number,
    frames: ReplayFrame[]
  ): boolean {
    return GhostStorage.savePB(
      seed,
      trackTitle,
      completionTime,
      score,
      frames,
      this.playerCheckpointTimes
    );
  }

  public hasPB(): boolean {
    return this.activePBData !== null;
  }

  public getPBTime(): number | null {
    return this.activePBData ? this.activePBData.completionTime : null;
  }

  public getRivalTime(): number | null {
    return this.activeRivalData ? this.activeRivalData.completionTime : null;
  }

  public dispose(): void {
    if (this.pbGhost) {
      this.pbGhost.dispose();
      this.pbGhost = null;
    }
    if (this.rivalGhost) {
      this.rivalGhost.dispose();
      this.rivalGhost = null;
    }
    this.activePBData = null;
    this.activeRivalData = null;
  }
}
