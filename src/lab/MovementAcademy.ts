/**
 * MOVEMENT ACADEMY — authored course + session observer.
 *
 * Owns ONLY academy geometry, the per-lesson session loop and the academy HUD.
 * It shares the REAL PlayerController + CameraController: Game drives
 * `updateFixed` on the shared fixed timestep and calls `update(dt)` with the
 * exact same dt, so a bhop landing + buffered jump is never missed.
 *
 * It never changes movement/config constants and never invents a death rule.
 * The only automatic restore is the authoritative world void boundary, exactly
 * like the Lab. Lesson completion is proven from the player's OWN observed
 * trajectory (MovementAcademyObserver), never from touching a marker.
 */

import * as THREE from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { RouteVoidEnvelope } from '../physics/RouteVoidEnvelope';
import { PlayerController } from '../player/PlayerController';
import { CameraController } from '../player/CameraController';
import {
  ACADEMY_LESSON_ORDER,
  LessonAnchor,
  LessonId,
  ProgressSnapshot,
  completeLesson,
  createProgress,
  isAcademyComplete,
  isSessionFinished,
  loadProgress,
  saveProgress,
  selectLesson as selectLessonProgress,
  skipLesson
} from './MovementAcademyProgress';
import { MovementAcademyObserver, MoveSample, Observation, evaluateLessonGoal } from './MovementAcademyObserver';
import { MovementAcademyHUD, AcademyHudInput } from './MovementAcademyHUD';
import { AcademyDef, buildAcademyLayout } from './AcademyLayout';

const HUD_INTERVAL_SECONDS = 1 / 10;

const CYAN = 0x00f0ff;

/** Minimal DOM-free HUD used when no document exists (unit tests / headless). */
class NullAcademyHud implements AcademyHudInput {
  public element: HTMLElement = { style: {} } as unknown as HTMLElement;
  private last: unknown = null;
  public setControlCallbacks(): void {}
  public show(): void {}
  public hide(): void {}
  public destroy(): void {}
  public update(state: unknown): void { this.last = state; }
  public get lastState(): unknown { return this.last; }
}

export class MovementAcademy {
  private scene: THREE.Scene;
  private physics: PhysicsWorld;
  private player: PlayerController;
  private cameraController: CameraController;
  private previousPreset: PlayerController['currentPreset'];

  private rootGroup = new THREE.Group();
  private hud: AcademyHudInput;

  private anchors: Record<LessonId, LessonAnchor>;

  private progress: ProgressSnapshot = createProgress();
  private complete = false;
  private sessionFinished = false;
  private skipped = false;
  private voidFlashUntil = 0;
  private simTime = 0;
  private voidPending = false;
  private hudAccumulator = 0;

  private observer = new MovementAcademyObserver();
  private sampleScratch: MoveSample;
  private obsScratch: Observation;

  private isDisposed = false;
  public exitCallback?: () => void;
  public signalPackCallback?: () => void;

  private materials = {
    concrete: new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.65, metalness: 0.2 }),
    surfFace: new THREE.MeshStandardMaterial({ color: 0x3fd8ff, emissive: 0x0090b8, emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.5 }),
    surfBack: new THREE.MeshStandardMaterial({ color: 0x0a0d12, roughness: 0.9, metalness: 0.1 })
  };
  private markingMaterials = new Map<number, THREE.MeshBasicMaterial>();

  /** Previous player void wiring, restored on dispose. */
  private prevKillY: number | null | undefined;
  private prevVoidChecker: ((pos: { x: number; y: number; z: number }) => boolean) | undefined;

  constructor(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    player: PlayerController,
    cameraController: CameraController,
    hudMount: HTMLElement
  ) {
    this.scene = scene;
    this.physics = physics;
    this.player = player;
    this.cameraController = cameraController;
    this.previousPreset = player.currentPreset;
    player.setPreset('PLAYHEAD');

    const layout = buildAcademyLayout();
    this.anchors = layout.anchors;

    if (typeof document !== 'undefined') {
      this.hud = new MovementAcademyHUD();
      hudMount.appendChild(this.hud.element);
    } else {
      this.hud = new NullAcademyHud();
    }
    this.hud.setControlCallbacks({
      onRetry: () => this.retryCurrent(),
      onSkip: () => this.skipCurrent(),
      onExit: () => this.exitCallback?.(),
      onSelect: (index: number) => this.selectLessonByIndex(index),
      onSignalPack: () => this.signalPackCallback?.()
    });

    this.physics.voidEnvelope = new RouteVoidEnvelope();
    this.physics.buildFromRoute(layout.nodes);
    this.buildGeometry(layout);

    this.progress = loadProgress(this.storage());
    this.sessionFinished = isSessionFinished(this.progress);
    this.complete = isAcademyComplete(this.progress);

    this.scene.add(this.rootGroup);

    // Take ownership of the authoritative void boundary for the Academy
    // colliders now that they are the only ones in the world.
    this.prevKillY = this.player.authoritativeKillY;
    this.prevVoidChecker = this.player.voidChecker;
    this.captureVoidBoundary();

    this.sampleScratch = {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0,
      grounded: true, airborne: false, surfing: false, speedUnits: 0,
      keys: { forward: false, backward: false, left: false, right: false }
    };
    this.obsScratch = {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: 0,
      grounded: true,
      surfing: false,
      voidCrossed: false,
      speedUnits: 0,
      totalSpeedUnits: 0,
      yawRate: 0,
      keys: { forward: false, backward: false, left: false, right: false },
      wasGrounded: false,
      wasAirborne: false,
      exitSpeedUnits: 0
    };

    this.spawnCurrent();
  }

  // ------------------------------------------------------------------
  // Public state
  // ------------------------------------------------------------------

  public getSkipped(): boolean { return this.skipped; }
  public getActiveLesson(): LessonId { return this.progress.active; }
  public isComplete(): boolean { return this.complete; }
  public isSessionFinished(): boolean { return this.sessionFinished; }
  public getProgress(): ProgressSnapshot { return this.progress; }
  public get anchorsForTesting(): Record<LessonId, LessonAnchor> { return this.anchors; }
  public getObserver(): MovementAcademyObserver { return this.observer; }

  private storage(): Storage | null {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  }

  private captureVoidBoundary(): void {
    this.player.voidChecker = (pos) => this.physics.isPositionInVoid(pos);
    this.player.authoritativeKillY = this.physics.getVoidDeathY();
  }

  // ------------------------------------------------------------------
  // Geometry
  // ------------------------------------------------------------------

  private markingMaterial(color: number): THREE.MeshBasicMaterial {
    let mat = this.markingMaterials.get(color);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
      this.markingMaterials.set(color, mat);
    }
    return mat;
  }

  private buildGeometry(layout: ReturnType<typeof buildAcademyLayout>): void {
    let nodeIndex = 0;
    for (const def of layout.defs) {
      if (def.marking) {
        this.addMarking(def);
        continue;
      }
      const node = layout.nodes[nodeIndex++];
      if (!node) continue;
      this.addSolid(def, node);
    }
  }

  private addSolid(def: AcademyDef, node: ReturnType<typeof buildAcademyLayout>['nodes'][number]): void {
    const geom = new THREE.BoxGeometry(def.width, def.height, def.length);
    const material = def.surf ? this.materials.surfFace : this.materials.concrete;
    const mesh = new THREE.Mesh(geom, material);
    mesh.name = def.name;
    mesh.position.set(def.x, def.y, def.z);
    mesh.rotation.set(def.pitch ?? 0, def.yaw ?? 0, def.roll ?? 0, 'YXZ');
    this.rootGroup.add(mesh);
    mesh.updateMatrixWorld(true);
    this.physics.lowestGameplayY = Math.min(
      this.physics.lowestGameplayY, new THREE.Box3().setFromObject(mesh).min.y
    );
    this.physics.killPlaneY = this.physics.getVoidDeathY();

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geom),
      new THREE.LineBasicMaterial({ color: def.surf ? CYAN : 0x556677, transparent: true, opacity: 0.6 })
    );
    edges.position.copy(mesh.position);
    edges.rotation.copy(mesh.rotation);
    this.rootGroup.add(edges);

    if (def.surf && node.surfNormal) {
      const n = new THREE.Vector3(node.surfNormal.x, node.surfNormal.y, node.surfNormal.z);
      const back = new THREE.Mesh(geom.clone(), this.materials.surfBack);
      back.position.copy(mesh.position).addScaledVector(n, -(def.height * 0.5 + 0.05));
      back.rotation.copy(mesh.rotation);
      this.rootGroup.add(back);
    }

  }

  private addMarking(def: AcademyDef): void {
    const geom = new THREE.BoxGeometry(def.width, def.height, def.length);
    const mesh = new THREE.Mesh(geom, this.markingMaterial(def.color ?? CYAN));
    mesh.name = def.name;
    mesh.position.set(def.x, def.y, def.z);
    mesh.rotation.set(def.pitch ?? 0, def.yaw ?? 0, def.roll ?? 0, 'YXZ');
    this.rootGroup.add(mesh);
  }

  // ------------------------------------------------------------------
  // Session
  // ------------------------------------------------------------------

  private get active(): LessonId { return this.progress.active; }

  private spawnCurrent(): void {
    const anchor = this.anchors[this.active];
    this.player.setPosition(new THREE.Vector3(anchor.spawn.x, anchor.spawn.y, anchor.spawn.z));
    this.player.setOrientation(anchor.spawnYaw);
    this.cameraController.setOrientation(anchor.spawnYaw, 0);
    this.player.velocity.set(0, 0, 0);
    this.player.resetKeys();
    this.observer.reset();
    this.pushHud(true);
  }

  private now(): number {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }

  /**
   * Called by Game AFTER the shared fixed tick has stepped PlayerController,
   * with the exact same dt, so no landing/buffered jump is ever missed.
   */
  public update(dtHint?: number): void {
    if (this.isDisposed) return;
    const dt = Number.isFinite(dtHint) && (dtHint as number) >= 0 ? Math.min(dtHint as number, 1 / 30) : 1 / 120;
    this.simTime += dt;

    if (this.voidPending) {
      this.voidPending = false;
      this.voidFlashUntil = this.now() + 2500;
      this.spawnCurrent();
      return;
    }

    if (!this.complete && !this.sessionFinished) {
      const k = this.player.keysState;
      const s = this.sampleScratch;
      s.x = this.player.position.x;
      s.y = this.player.position.y;
      s.z = this.player.position.z;
      s.vx = this.player.velocity.x;
      s.vy = this.player.velocity.y;
      s.vz = this.player.velocity.z;
      s.yaw = this.cameraController.yaw;
      s.grounded = this.player.isGrounded;
      s.surfing = this.player.isSurfing || this.player.surfState.isSurfing;
      s.airborne = !this.player.isGrounded && !s.surfing;
      s.speedUnits = this.player.getSpeedUnits();
      s.keys.forward = k.forward;
      s.keys.backward = k.backward;
      s.keys.left = k.left;
      s.keys.right = k.right;
      s.surfControl = (this.player.surfState.surfSide === 'LEFT' && k.left) ||
        (this.player.surfState.surfSide === 'RIGHT' && k.right);
      this.observer.sample(s);

      // Only evaluate the spatial goal once the attempt holds real action
      // evidence. This skips the object work for the (many) ticks where the
      // player has not yet demonstrated the skill.
      if (this.observer.hasActionEvidence(this.active)) {
        const o = this.obsScratch;
        o.position.x = s.x; o.position.y = s.y; o.position.z = s.z;
        o.velocity.x = s.vx; o.velocity.y = s.vy; o.velocity.z = s.vz;
        o.yaw = s.yaw;
        o.grounded = s.grounded;
        o.surfing = s.surfing;
        o.voidCrossed = false;
        o.speedUnits = s.speedUnits;
        o.totalSpeedUnits = Math.hypot(s.vx, s.vy, s.vz) * this.player.config.speedUnitScale;
        o.yawRate = 0;
        o.keys = s.keys;
        o.wasGrounded = false;
        o.wasAirborne = false;
        o.exitSpeedUnits = 0;
        const anchor = this.anchors[this.active];
        if (evaluateLessonGoal(this.active, anchor, o, this.observer)) {
          this.completeCurrent();
        }
      }
    }

    this.hudAccumulator += dt;
    if (this.hudAccumulator >= HUD_INTERVAL_SECONDS) {
      this.hudAccumulator = 0;
      this.pushHud();
    }
  }

  private completeCurrent(): void {
    const result = completeLesson(this.progress, this.active);
    this.progress = result.progress;
    saveProgress(this.progress, this.storage());
    this.skipped = false;
    this.sessionFinished = result.sessionFinished;
    this.complete = isAcademyComplete(this.progress);

    if (this.complete || this.sessionFinished) {
      this.pushHud(true);
      return;
    }
    this.spawnCurrent();
  }

  public skipCurrent(): void {
    if (this.complete || this.sessionFinished) return;
    const result = skipLesson(this.progress, this.active);
    this.progress = result.progress;
    saveProgress(this.progress, this.storage());
    this.skipped = true;
    this.sessionFinished = result.sessionFinished;
    this.complete = isAcademyComplete(this.progress);
    if (this.sessionFinished) {
      this.pushHud(true);
      return;
    }
    this.spawnCurrent();
  }

  public retryCurrent(): void {
    this.complete = false;
    this.sessionFinished = false;
    this.skipped = false;
    this.spawnCurrent();
  }

  /** Jump to lesson index 0..4 (from the HUD buttons or Digit1-5). */
  public selectLessonByIndex(index: number): void {
    const id = ACADEMY_LESSON_ORDER[index];
    if (!id) return;
    this.selectLesson(id);
  }

  public selectLesson(id: LessonId): void {
    this.progress = selectLessonProgress(this.progress, id);
    saveProgress(this.progress, this.storage());
    // An explicit lesson selection is ALWAYS a live, replayable attempt, even
    // from the finished/complete screen.
    this.complete = false;
    this.sessionFinished = false;
    this.skipped = false;
    this.spawnCurrent();
  }

  /** Authoritative void restore only — the single automatic academy retry. */
  public reportVoidRestore(): void {
    if (this.isDisposed) return;
    this.voidPending = true;
  }

  private pushHud(force = false): void {
    if (this.isDisposed) return;
    this.hud.update({
      speedUnits: this.player.getSpeedUnits(),
      progress: this.progress,
      active: this.progress.active,
      skipped: this.skipped,
      voidRestored: this.now() < this.voidFlashUntil,
      complete: this.complete,
      sessionFinished: this.sessionFinished,
      demonstrated: this.observer.hasActionEvidence(this.active)
    });
    void force;
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    this.hud.destroy();

    this.rootGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
      } else if (obj instanceof THREE.LineSegments || obj instanceof THREE.Points) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    for (const mat of Object.values(this.materials)) mat.dispose();
    for (const mat of this.markingMaterials.values()) mat.dispose();

    this.scene.remove(this.rootGroup);

    // Remove ONLY the Academy colliders, then restore the previous void wiring.
    this.physics.clear();
    if (this.prevKillY !== undefined) this.player.authoritativeKillY = this.prevKillY ?? null;
    this.player.voidChecker = this.prevVoidChecker;
    this.player.setPreset(this.previousPreset);
  }
}
