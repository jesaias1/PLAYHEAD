/**
 * GHOST RACE CONTROLLER — one solo recorded ghost, driven by the run timeline.
 *
 * Owns AT MOST ONE ghost. It is deliberately a separate lifecycle from the live
 * friend-race ghost (`RemoteGhostRenderer`): a live multiplayer session must
 * never accidentally load a recorded ghost, and a recorded ghost must never be
 * driven by network samples.
 *
 * TIMELINE: playback follows the local player's AUTHORITATIVE run timer, not a
 * wall clock. At run start the player timer and the ghost time are both zero, so
 * they share one timeline. Tap-R checkpoint restore does not rewind the run
 * timer, so the ghost keeps its pace; hold-R full restart resets both to zero.
 *
 * Presentation only:
 *   - no collision, no triggers, no gameplay effect, no audio effect
 *   - never re-simulates movement inputs (it interpolates RECORDED transforms)
 *   - never reads or writes anything the physics, timing or scoring paths use
 */

import * as THREE from 'three';
import { GhostVisual } from './GhostVisual';
import {
  GhostFinishComparison,
  GhostRaceRun,
  GhostRaceSplit,
  ghostFinishDelta,
  ghostProximityScale,
  ghostSplitAt,
  sampleGhost
} from './GhostRaceSource';

/** PB ghost identity: cool signal cyan, matching the PB language elsewhere. */
export const PB_GHOST_COLOR = 0x00f0ff;
/** World ghost identity: rival violet, matching the live rival ghost. */
export const WORLD_GHOST_COLOR = 0x9d8cff;

export class GhostRaceController {
  private visual: GhostVisual | null = null;
  private run: GhostRaceRun | null = null;
  private effectScale = 1;
  private proximityScale = 1;
  private visible = false;

  constructor(private readonly scene: THREE.Scene) {}

  /** True when a ghost is loaded and being driven. */
  public isActive(): boolean {
    return this.run !== null;
  }

  public getRun(): GhostRaceRun | null {
    return this.run;
  }

  /**
   * Loads a validated ghost, replacing any existing one.
   * Only ever one solo ghost exists, so the previous visual is disposed first.
   */
  public load(run: GhostRaceRun): void {
    this.clear();
    this.run = run;
    this.visual = new GhostVisual(this.scene, {
      color: run.kind === 'PB' ? PB_GHOST_COLOR : WORLD_GHOST_COLOR
    });
    this.visual.group.name = 'GhostRaceRecorded';
    this.visual.setOpacityScale(this.effectScale);
    this.visual.setVisible(false);
  }

  /**
   * Run start: the ghost returns to its recorded origin.
   * Called on run start and on full restart (hold-R) — never on checkpoint
   * restore, which must not rewind the authoritative timeline.
   */
  public start(): void {
    this.proximityScale = 1;
    this.visible = false;
    this.visual?.setVisible(false);
    // Place it at the recorded t=0 pose immediately so there is no slide-in.
    this.applySample(0);
  }

  /**
   * Follows the authoritative run timer.
   *
   * @param runElapsedSeconds the local player's run time
   * @param playerPosition    used only for a proximity fade
   */
  public update(runElapsedSeconds: number, playerPosition: THREE.Vector3): void {
    if (!this.run || !this.visual) return;

    const runElapsedMs = Math.max(0, runElapsedSeconds) * 1000;
    this.applySample(runElapsedMs);

    const sample = sampleGhost(this.run, runElapsedMs);
    const distance = Math.hypot(
      sample.x - playerPosition.x,
      sample.y - playerPosition.y,
      sample.z - playerPosition.z
    );
    this.proximityScale = ghostProximityScale(distance);
    this.visible = this.proximityScale > 0;
    this.visual.setOpacityScale(this.effectScale * Math.max(this.proximityScale, 0.0001));
    this.visual.setVisible(this.visible);
  }

  private applySample(runElapsedMs: number): void {
    if (!this.run || !this.visual) return;
    const sample = sampleGhost(this.run, runElapsedMs);
    this.visual.setTransform(sample.x, sample.y, sample.z, sample.yaw);
  }

  /**
   * Split against the ghost when the player reaches a checkpoint.
   * Returns null when the ghost never recorded that checkpoint.
   */
  public onPlayerCheckpoint(checkpointIndex: number, playerElapsedSeconds: number): GhostRaceSplit | null {
    if (!this.run) return null;
    return ghostSplitAt(this.run, checkpointIndex, playerElapsedSeconds);
  }

  /** Finish comparison in raw integer microseconds, or null with no ghost. */
  public finishComparison(playerFinishUs: number): GhostFinishComparison | null {
    if (!this.run) return null;
    return ghostFinishDelta(this.run, playerFinishUs);
  }

  /** Presentation-only intensity. Never alters trajectory or timing. */
  public setEffectScale(scale: number): void {
    if (!Number.isFinite(scale) || scale <= 0) return;
    this.effectScale = scale;
    this.visual?.setOpacityScale(scale * Math.max(this.proximityScale, 0.0001));
  }

  /** Releases the ghost. Safe to call at any time. */
  public clear(): void {
    if (this.visual) {
      this.visual.dispose();
      this.visual = null;
    }
    this.run = null;
    this.visible = false;
    this.proximityScale = 1;
  }

  public dispose(): void {
    this.clear();
  }
}
