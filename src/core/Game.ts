/**
 * Master Game Controller for TRACK//RUN
 * Integrates StateMachine, AudioEngine, World, PlayerController, Replay, and UI
 */

import { GameState, StateMachine } from './StateMachine';
import { GameClock } from './Clock';
import { SettingsManager } from './Settings';
import { AudioEngine } from '../audio/AudioEngine';
import { AudioLoader } from '../audio/AudioLoader';
import { AudioAnalyzer } from '../audio/AudioAnalyzer';
import { SyntheticGenre, SyntheticTrack } from '../audio/SyntheticTrack';
import { TrackAnalysis } from '../audio/AudioFeatures';
import { TrackGenerator } from '../generation/TrackGenerator';
import { GeneratedTrack, CheckpointDefinition } from '../generation/GenerationTypes';
import { Environment } from '../world/Environment';
import { World } from '../world/World';
import { CameraController } from '../player/CameraController';
import { PlayerController } from '../player/PlayerController';
import { ReplayRecorder } from '../replay/ReplayRecorder';
import { ReplayPlayer } from '../replay/ReplayPlayer';
import { GhostManager } from '../replay/GhostManager';
import { UIManager } from '../ui/UIManager';
import { DevOverlay } from '../ui/DevOverlay';
import { calculateLookYaw } from '../utils/math';
import { MovementLab } from '../lab/MovementLab';
import { StrafeVisualizer } from '../player/StrafeVisualizer';
import { SurfVisuals } from '../world/SurfVisuals';
import { TrackCatalogEntry } from '../audio/MusicPack';

export class Game {
  public stateMachine: StateMachine;
  public clock: GameClock;
  public audioEngine: AudioEngine;
  public environment: Environment;
  public world: World;
  public cameraController: CameraController;
  public playerController: PlayerController;
  public strafeVisualizer: StrafeVisualizer;
  public surfVisuals: SurfVisuals;
  public replayRecorder: ReplayRecorder;
  public replayPlayer: ReplayPlayer;
  public ghostManager: GhostManager;
  public ui: UIManager;
  public devOverlay: DevOverlay;

  private currentAnalysis: TrackAnalysis | null = null;
  private currentTrack: GeneratedTrack | null = null;

  private currentCheckpoint: CheckpointDefinition | null = null;
  private passedCheckpoints = new Set<number>();

  private runElapsedTime = 0;
  private isFinished = false;

  private isFirstContactCourse = false;
  private shownOnboardingCues = new Set<string>();

  private movementLab: MovementLab | null = null;
  private previousStateBeforePause: GameState = GameState.PLAYING;

  constructor(canvasContainer: HTMLElement, uiRoot: HTMLElement) {
    this.stateMachine = new StateMachine(GameState.BOOT);
    this.clock = new GameClock(120); // 120 Hz fixed physics simulation
    this.audioEngine = new AudioEngine();

    // 1. Graphics Environment
    this.environment = new Environment(canvasContainer);

    // 2. World System
    this.world = new World(this.environment.scene);

    // 3. Player & Camera
    this.cameraController = new CameraController(this.environment.camera, this.environment.renderer.domElement);
    this.playerController = new PlayerController(this.cameraController, this.world.physics);
    this.strafeVisualizer = new StrafeVisualizer(this.environment.scene);
    this.surfVisuals = new SurfVisuals(this.environment.scene);

    // 4. Replay & Ghost Systems
    this.replayRecorder = new ReplayRecorder();
    this.replayPlayer = new ReplayPlayer(this.environment.scene, this.environment.camera);
    this.ghostManager = new GhostManager(this.environment.scene);

    // 5. UI Manager
    this.ui = new UIManager(uiRoot);

    // 6. Dev Diagnostics Overlay
    this.devOverlay = new DevOverlay();

    this.setupCallbacks();
    this.setupStateMachine();
    this.setupInputHandlers();

    // Boot complete -> Transition to IMPORT
    this.stateMachine.transitionTo(GameState.IMPORT);

    (window as unknown as { game: Game }).game = this;

    // Start render/physics loop
    this.clock.start();
    requestAnimationFrame(this.gameLoop);
  }

  private setupCallbacks(): void {
    // Import Screen
    this.ui.importScreen.setCallbacks(
      (file) => this.handleFileSelected(file),
      (genre) => this.handleDevTrackSelected(genre),
      (err) => alert(err),
      () => this.enterMovementLab(),
      (track) => this.handleCatalogTrackSelected(track)
    );

    // Analysis Screen
    this.ui.analysisScreen.setOnEnterTrack(() => {
      this.stateMachine.transitionTo(GameState.COUNTDOWN);
    });

    // Settings Modal
    this.ui.settingsModal.setOnClose(() => {
      this.ghostManager.applySettingsVisibility();
    });

    // Pause Screen
    this.ui.pauseScreen.setCallbacks({
      onResume: () => this.resumeGame(),
      onRestartCheckpoint: () => this.restoreToCheckpoint(),
      onRestartTrack: () => this.restartTrack(),
      onSettings: () => this.ui.settingsModal.show(),
      onNewTrack: () => this.returnToImport()
    });

    // Results Screen
    this.ui.resultsScreen.setCallbacks({
      onReplay: () => this.stateMachine.transitionTo(GameState.REPLAY),
      onAgain: () => this.restartTrack(),
      onNewTrack: () => this.returnToImport()
    });

    // Player fall / restore
    this.playerController.onFallCallback = () => this.handlePlayerFall();
    this.playerController.onRestoreCallback = () => this.handlePlayerManualRestore();

    // Replay finished
    this.replayPlayer.onCompleteCallback = () => {
      this.stateMachine.transitionTo(GameState.FINISHED);
    };
  }

  private enterMovementLab(): void {
    this.stateMachine.transitionTo(GameState.MOVEMENT_LAB);
  }

  private setupStateMachine(): void {
    this.stateMachine.onTransition((newState) => {
      this.ui.hideAllScreens();

      switch (newState) {
        case GameState.IMPORT:
          this.audioEngine.stop();
          this.cameraController.unlock();
          this.strafeVisualizer.clear();
          this.surfVisuals.clear();
          if (this.movementLab) {
            this.movementLab.dispose();
            this.movementLab = null;
          }
          this.ui.importScreen.show();
          break;

        case GameState.MOVEMENT_LAB:
          this.ui.hideAllScreens();
          this.audioEngine.stop();
          this.world.dispose();
          this.strafeVisualizer.clear();
          this.surfVisuals.clear();
          this.currentAnalysis = null;
          this.currentTrack = null;
          if (this.movementLab) {
            this.movementLab.dispose();
            this.movementLab = null;
          }
          this.movementLab = new MovementLab(
            this.environment.scene,
            this.world.physics,
            this.playerController,
            this.cameraController,
            this.ui.root
          );
          this.cameraController.lock();
          break;

        case GameState.ANALYSING:
          this.ui.hideAllScreens();
          this.ui.analysisScreen.show();
          break;

        case GameState.READY:
          this.ui.hideAllScreens();
          this.ui.analysisScreen.show();
          if (this.currentAnalysis) {
            this.ui.analysisScreen.displayAnalysis(this.currentAnalysis);
          }
          break;

        case GameState.COUNTDOWN:
          this.prepareTrackForRun();
          this.ui.hideAllScreens();
          this.cameraController.lock();
          this.ui.countdownScreen.start(() => {
            this.stateMachine.transitionTo(GameState.PLAYING);
          });
          break;

        case GameState.PLAYING:
          this.ui.countdownScreen.cancel();
          this.ui.hud.show();
          this.cameraController.lock();
          this.isFinished = false;
          this.audioEngine.play(this.currentCheckpoint ? this.currentCheckpoint.time : 0);
          this.replayRecorder.start();
          this.ghostManager.start();
          break;

        case GameState.PAUSED:
          this.cameraController.unlock();
          this.audioEngine.pause();
          this.playerController.resetKeys();
          this.ui.hud.hide();
          this.ui.pauseScreen.show();
          break;

        case GameState.FINISHED:
          this.cameraController.unlock();
          this.replayRecorder.stop();
          this.ui.hud.hide();
          if (this.currentAnalysis && this.currentTrack) {
            const results = this.playerController.stats.computeResults(
              this.runElapsedTime,
              this.currentAnalysis.duration
            );

            // Check and save personal best ghost
            let isNewPB = false;
            if (this.replayRecorder.hasData()) {
              isNewPB = this.ghostManager.saveIfPersonalBest(
                this.currentTrack.seed,
                this.currentAnalysis.filename || 'PLAYHEAD TRACK',
                results.completionTime,
                results.score,
                this.replayRecorder.frames
              );
            }

            const rivalTime = this.ghostManager.getRivalTime();
            const rivalDelta = rivalTime !== null ? results.completionTime - rivalTime : undefined;

            this.ui.resultsScreen.showResults(results, this.currentTrack.seed, {
              rivalDelta,
              isNewPB
            });
          }
          break;

        case GameState.REPLAY:
          this.ui.hideAllScreens();
          this.cameraController.unlock();
          this.audioEngine.play(0);
          this.replayPlayer.start(this.replayRecorder);
          break;
      }
    });
  }

  private async handleCatalogTrackSelected(trackEntry: TrackCatalogEntry): Promise<void> {
    try {
      this.isFirstContactCourse = !!trackEntry.isFirstContact;
      this.stateMachine.transitionTo(GameState.ANALYSING);
      this.ui.analysisScreen.setTrackTitle(trackEntry.title);
      this.ui.analysisScreen.setStage(`SYNTHESIZING SIGNAL // ${trackEntry.genre}`);

      const buffer = await trackEntry.generate();
      await this.processBuffer(buffer, trackEntry.title);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Track synthesis failed';
      alert(msg);
      this.stateMachine.transitionTo(GameState.IMPORT);
    }
  }

  private async handleFileSelected(file: File): Promise<void> {
    try {
      this.isFirstContactCourse = false;
      this.stateMachine.transitionTo(GameState.ANALYSING);
      this.ui.analysisScreen.setTrackTitle(file.name);

      const { buffer, filename } = await AudioLoader.loadFromFile(file);
      await this.processBuffer(buffer, filename);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Audio load failed';
      alert(msg);
      this.stateMachine.transitionTo(GameState.IMPORT);
    }
  }

  private async handleDevTrackSelected(genre: SyntheticGenre = 'ELECTRONIC_DROP'): Promise<void> {
    try {
      this.isFirstContactCourse = false;
      this.stateMachine.transitionTo(GameState.ANALYSING);
      const title = `DEV ${genre.replace('_', ' ')}`;
      this.ui.analysisScreen.setTrackTitle(title);
      this.ui.analysisScreen.setStage('GENERATING DEV AUDIO SIGNAL');

      const buffer = await SyntheticTrack.generate(genre);
      await this.processBuffer(buffer, title);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Dev track failed';
      alert(msg);
      this.stateMachine.transitionTo(GameState.IMPORT);
    }
  }

  private async processBuffer(buffer: AudioBuffer, filename: string): Promise<void> {
    await this.audioEngine.init();
    this.audioEngine.setBuffer(buffer);

    const analysis = await AudioAnalyzer.analyze(buffer, filename, (stage, _prog) => {
      this.ui.analysisScreen.setStage(stage);
    });

    this.currentAnalysis = analysis;
    this.ui.applyAccent(analysis.visualAccent);
    this.environment.setAccent(analysis.visualAccent);

    // Deterministically generate the course
    this.currentTrack = TrackGenerator.generate(analysis);
    this.world.loadTrack(analysis, this.currentTrack, this.environment);

    this.stateMachine.transitionTo(GameState.READY);
  }

  private prepareTrackForRun(): void {
    if (!this.currentTrack || this.currentTrack.route.length === 0) return;

    this.currentCheckpoint = null;
    this.passedCheckpoints.clear();
    this.shownOnboardingCues.clear();
    this.playerController.stats.reset();
    this.strafeVisualizer.clear();
    this.surfVisuals.clear();
    this.runElapsedTime = 0;

    // Prepare ghosts for track
    this.ghostManager.prepareTrack(this.currentTrack, this.currentAnalysis?.filename || 'PLAYHEAD TRACK');
    this.ghostManager.start();

    const startNode = this.currentTrack.route[0];
    const spawnPos = {
      x: startNode.position.x,
      y: startNode.position.y + 1.5,
      z: startNode.position.z - startNode.dimensions.z * 0.35
    };
    this.playerController.setPosition(spawnPos);

    const targetNode = this.currentTrack.route[1] || startNode;
    const lookTarget = targetNode === startNode ? { x: spawnPos.x, z: spawnPos.z + 20 } : targetNode.position;
    const spawnYaw = calculateLookYaw(spawnPos, lookTarget);
    this.playerController.setOrientation(spawnYaw);

    const settings = SettingsManager.getInstance().settings;
    this.cameraController.setSensitivity(settings.mouseSensitivity);
    this.environment.setBaseFov(settings.fov);
    this.audioEngine.setVolume(settings.masterVolume);
  }

  private handlePlayerFall(): void {
    if (!this.stateMachine.is(GameState.PLAYING)) return;
    this.ui.hud.showToast('RESTORED TO CHECKPOINT', 1500);
    this.restoreToCheckpoint();
  }

  private handlePlayerManualRestore(): void {
    if (!this.stateMachine.is(GameState.PLAYING)) return;
    this.ui.hud.showToast('MANUAL RESTORE', 1200);
    this.restoreToCheckpoint();
  }

  private restoreToCheckpoint(): void {
    if (this.previousStateBeforePause === GameState.MOVEMENT_LAB || this.stateMachine.is(GameState.MOVEMENT_LAB)) {
      if (this.movementLab) {
        this.movementLab.resetPlayer();
      }
      if (this.stateMachine.is(GameState.PAUSED)) {
        this.resumeGame();
      }
      return;
    }

    if (!this.currentTrack) return;

    if (this.currentCheckpoint) {
      const spawnPos = {
        x: this.currentCheckpoint.position.x,
        y: this.currentCheckpoint.position.y + 1.5,
        z: this.currentCheckpoint.position.z
      };
      this.playerController.setPosition(spawnPos);

      const cpNodeIdx = this.currentTrack.route.findIndex(n => n.id === this.currentCheckpoint!.routeNodeId);
      const nextNode = (cpNodeIdx !== -1 && cpNodeIdx < this.currentTrack.route.length - 1)
        ? this.currentTrack.route[cpNodeIdx + 1]
        : null;
      const lookTarget = nextNode ? nextNode.position : { x: spawnPos.x, z: spawnPos.z + 20 };
      const cpYaw = calculateLookYaw(spawnPos, lookTarget);
      this.playerController.setOrientation(cpYaw);
      this.audioEngine.seek(this.currentCheckpoint.time);
    } else {
      // Restore to start
      const startNode = this.currentTrack.route[0];
      const spawnPos = {
        x: startNode.position.x,
        y: startNode.position.y + 1.5,
        z: startNode.position.z - startNode.dimensions.z * 0.35
      };
      this.playerController.setPosition(spawnPos);

      const targetNode = this.currentTrack.route[1] || startNode;
      const lookTarget = targetNode === startNode ? { x: spawnPos.x, z: spawnPos.z + 20 } : targetNode.position;
      const spawnYaw = calculateLookYaw(spawnPos, lookTarget);
      this.playerController.setOrientation(spawnYaw);
      this.audioEngine.seek(0);
    }

    if (this.stateMachine.is(GameState.PAUSED)) {
      this.resumeGame();
    }
  }

  private resumeGame(): void {
    if (this.stateMachine.is(GameState.PAUSED)) {
      if (this.previousStateBeforePause === GameState.MOVEMENT_LAB) {
        this.stateMachine.transitionTo(GameState.MOVEMENT_LAB);
        this.cameraController.lock();
      } else {
        this.stateMachine.transitionTo(GameState.PLAYING);
        this.cameraController.lock();
        this.audioEngine.resume();
      }
    }
  }

  private restartTrack(): void {
    if (this.previousStateBeforePause === GameState.MOVEMENT_LAB || this.stateMachine.is(GameState.MOVEMENT_LAB)) {
      if (this.movementLab) {
        this.movementLab.resetPlayer();
      }
      if (this.stateMachine.is(GameState.PAUSED)) {
        this.resumeGame();
      }
      return;
    }
    this.audioEngine.stop();
    this.stateMachine.transitionTo(GameState.COUNTDOWN);
  }

  private returnToImport(): void {
    this.audioEngine.stop();
    this.world.dispose();
    this.ghostManager.dispose();
    this.strafeVisualizer.clear();
    this.surfVisuals.clear();
    if (this.movementLab) {
      this.movementLab.dispose();
      this.movementLab = null;
    }
    this.currentAnalysis = null;
    this.currentTrack = null;
    this.stateMachine.transitionTo(GameState.IMPORT);
  }

  private setupInputHandlers(): void {
    this.environment.renderer.domElement.addEventListener('click', () => {
      if (this.stateMachine.is(GameState.PLAYING) || this.stateMachine.is(GameState.MOVEMENT_LAB)) {
        this.cameraController.lock();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.stateMachine.is(GameState.PLAYING)) {
          this.previousStateBeforePause = GameState.PLAYING;
          this.stateMachine.transitionTo(GameState.PAUSED);
        } else if (this.stateMachine.is(GameState.MOVEMENT_LAB)) {
          this.previousStateBeforePause = GameState.MOVEMENT_LAB;
          this.cameraController.unlock();
          this.stateMachine.transitionTo(GameState.PAUSED);
        } else if (this.stateMachine.is(GameState.PAUSED)) {
          this.resumeGame();
        } else if (this.stateMachine.is(GameState.REPLAY)) {
          this.replayPlayer.stop();
          this.audioEngine.stop();
          this.stateMachine.transitionTo(GameState.FINISHED);
        }
      } else if (e.code === 'Digit0' && !e.repeat) {
        // Cycle audio-visual reactivity multiplier: 0.5x -> 1.0x -> 1.5x
        const current = this.world.visualController.reactivityMultiplier;
        const next = current < 0.9 ? 1.0 : (current < 1.4 ? 1.5 : 0.5);
        this.world.visualController.setReactivityMultiplier(next);
        this.ui.hud.showToast(`AUDIO REACTIVITY: ${next.toFixed(1)}X`, 1500);
      } else if (e.code === 'KeyN' && e.shiftKey && !e.repeat) {
        // Dev shortcut: Jump to next checkpoint
        if (this.stateMachine.is(GameState.PLAYING)) {
          this.jumpToNextCheckpoint();
        }
      }
    });
  }

  private jumpToNextCheckpoint(): void {
    if (!this.currentTrack || this.currentTrack.checkpoints.length === 0) return;
    const songTime = this.audioEngine.getCurrentTime();
    const nextCp = this.currentTrack.checkpoints.find(cp => cp.time > songTime + 1.0);
    if (nextCp) {
      this.currentCheckpoint = nextCp;
      this.restoreToCheckpoint();
      this.ui.hud.showToast(`DEV JUMP: CHECKPOINT (#${nextCp.sectionIndex}) @ ${nextCp.time.toFixed(1)}s`, 1500);
    } else {
      this.currentCheckpoint = null;
      this.restoreToCheckpoint();
      this.ui.hud.showToast('DEV JUMP: START @ 0.0s', 1500);
    }
  }

  /**
   * Main game loop running fixed-timestep updates and variable rAF render
   */
  private gameLoop = (): void => {
    requestAnimationFrame(this.gameLoop);

    const { frameDelta } = this.clock.tick((dt) => {
      if (this.stateMachine.is(GameState.PLAYING)) {
        this.playerController.updateFixed(dt);

        // Record replay frame
        this.runElapsedTime += dt;
        this.replayRecorder.record(
          this.runElapsedTime,
          dt,
          this.playerController.position,
          this.cameraController.yaw,
          this.cameraController.pitch,
          this.playerController.getSpeedUnits()
        );
      } else if (this.stateMachine.is(GameState.MOVEMENT_LAB)) {
        this.playerController.updateFixed(dt);
      }
    });

    // Variable render updates
    if (this.stateMachine.is(GameState.PLAYING)) {
      this.cameraController.update(frameDelta);
      const songTime = this.audioEngine.getCurrentTime();
      const worldProgress = this.world.update(
        songTime,
        this.playerController.position,
        this.cameraController.yaw,
        frameDelta,
        this.environment,
        this.playerController.getSpeedUnits()
      );

      // Route progression, Sync Delta, and Checkpoints
      const syncDelta = worldProgress.syncDelta;

      // Update Strafe Visualizer
      this.strafeVisualizer.update(
        this.playerController,
        this.world.visualController.state,
        frameDelta
      );

      // Update Surf Visuals
      this.surfVisuals.update(
        this.playerController,
        this.world.visualController.state,
        frameDelta
      );

      // Update Ghosts
      this.ghostManager.update(this.runElapsedTime, this.playerController.position, frameDelta);

      // Update HUD
      this.ui.hud.update(
        this.playerController.getSpeedUnits(),
        syncDelta,
        worldProgress.progressRatio,
        this.world.visualController.state.sectionTheme,
        this.world.visualController.state.sectionIndex + 1
      );

      this.ui.hud.updateSurfPrompt(
        this.playerController.surfState.isSurfing || this.playerController.isSurfing,
        this.playerController.surfState.surfSide
      );

      // Onboarding Guidance for FIRST CONTACT
      if (this.isFirstContactCourse) {
        if (this.runElapsedTime >= 1.2 && !this.shownOnboardingCues.has('bhop')) {
          this.shownOnboardingCues.add('bhop');
          this.ui.hud.showOnboardingCue('BHOP FLOW // HOLD [SPACE] OR TAP ON LANDING', 3800);
        } else if (this.runElapsedTime >= 14.0 && !this.shownOnboardingCues.has('strafe')) {
          this.shownOnboardingCues.add('strafe');
          this.ui.hud.showOnboardingCue('AIR STRAFE // TURN MOUSE IN AIR WHILE HOLDING [A] / [D]', 3800);
        } else if (this.runElapsedTime >= 34.0 && !this.shownOnboardingCues.has('surf')) {
          this.shownOnboardingCues.add('surf');
          this.ui.hud.showOnboardingCue('SURF RAMP // HOLD [A] FOR LEFT RAMP / [D] FOR RIGHT', 3800);
        }
      }

      // Dynamic FOV based on speed
      const settings = SettingsManager.getInstance().settings;
      this.environment.setDynamicFovSpeed(
        this.playerController.velocity.length(),
        30,
        settings.reduceMotion
      );

      // Dev Diagnostics update
      this.devOverlay.update(this.playerController, this.world, this.audioEngine);

      // Checkpoint passing check
      if (this.currentTrack) {
        for (let i = 0; i < this.currentTrack.checkpoints.length; i++) {
          const cp = this.currentTrack.checkpoints[i];
          if (!this.passedCheckpoints.has(cp.id)) {
            const dx = this.playerController.position.x - cp.position.x;
            const dz = this.playerController.position.z - cp.position.z;
            if (dx * dx + dz * dz < 12.0 * 12.0) {
              this.passedCheckpoints.add(cp.id);
              this.currentCheckpoint = cp;
              const split = this.ghostManager.onPlayerReachCheckpoint(i, this.runElapsedTime);
              if (split) {
                this.ui.hud.showSplit(split);
              } else {
                this.ui.hud.showToast(`CHECKPOINT ${i + 1} REACHED`, 2000);
              }
            }
          }
        }

        // Finish Gate check
        const finish = this.currentTrack.finish;
        const fdx = this.playerController.position.x - finish.position.x;
        const fdz = this.playerController.position.z - finish.position.z;
        if (!this.isFinished && fdx * fdx + fdz * fdz < 16.0 * 16.0) {
          this.isFinished = true;
          this.stateMachine.transitionTo(GameState.FINISHED);
        }
      }
    } else if (this.stateMachine.is(GameState.MOVEMENT_LAB)) {
      this.cameraController.update(frameDelta);
      if (this.movementLab) {
        this.movementLab.update(frameDelta);
      }
      this.surfVisuals.update(
        this.playerController,
        this.world.visualController.state,
        frameDelta
      );
      this.devOverlay.update(this.playerController, this.world, this.audioEngine);
    } else if (this.stateMachine.is(GameState.REPLAY)) {
      this.replayPlayer.update(frameDelta);
      const songTime = this.audioEngine.getCurrentTime();
      this.world.update(
        songTime,
        this.environment.camera.position,
        0,
        frameDelta,
        this.environment
      );
    }

    this.environment.update(frameDelta);
    this.environment.render();
  };
}
