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
import { MusicPack, TrackCatalogEntry } from '../audio/MusicPack';
import { PresetLevelCache } from '../audio/PresetLevelCache';
import { ViewmodelController } from '../viewmodel/ViewmodelController';
import { ViewmodelCalibrator } from '../viewmodel/ViewmodelCalibrator';
import { KarambitSkinSystem } from '../viewmodel/KarambitSkinSystem';
import { PaletteSelector } from '../audio/TrackPalettes';

export class Game {
  public stateMachine: StateMachine;
  public clock: GameClock;
  public audioEngine: AudioEngine;
  public environment: Environment;
  public world: World;
  public cameraController: CameraController;
  public playerController: PlayerController;
  public viewmodelController: ViewmodelController;
  public viewmodelCalibrator: ViewmodelCalibrator;
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
  private isOvertime = false;

  private isFirstContactCourse = false;
  private shownOnboardingCues = new Set<string>();

  private movementLab: MovementLab | null = null;
  private previousStateBeforePause: GameState = GameState.PLAYING;
  private lastPauseTime = 0;
  private lastResumeTime = 0;

  private pendingRestoreVerification: {
    targetPos: { x: number; y: number; z: number };
    yaw: number;
    wasSurf: boolean;
    attempts: number;
  } | null = null;

  constructor(canvasContainer: HTMLElement, uiRoot: HTMLElement) {
    this.stateMachine = new StateMachine(GameState.BOOT);
    this.clock = new GameClock(120); // 120 Hz fixed physics simulation
    this.audioEngine = new AudioEngine();

    // 1. Graphics Environment
    this.environment = new Environment(canvasContainer);

    // 2. World System
    this.world = new World(this.environment.scene);

    // 3. Player, Camera & Viewmodel
    this.cameraController = new CameraController(this.environment.camera, this.environment.renderer.domElement);
    this.playerController = new PlayerController(this.cameraController, this.world.physics);
    this.viewmodelController = new ViewmodelController();
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

    // 7. Dev Viewmodel Calibration Tool (F4)
    this.viewmodelCalibrator = new ViewmodelCalibrator(
      this.viewmodelController,
      this.environment.renderer.domElement,
      () => {
        // On calibration activate: unlock pointer, pause audio if in race
        this.cameraController.unlock();
        if (this.stateMachine.is(GameState.PLAYING)) {
          this.audioEngine.pause();
        }
      },
      () => {
        // On calibration deactivate: resume audio and relock pointer
        if (this.stateMachine.is(GameState.PLAYING)) {
          this.audioEngine.resume();
          this.cameraController.lock();
        } else if (this.stateMachine.is(GameState.MOVEMENT_LAB)) {
          this.cameraController.lock();
        }
      }
    );

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
      (trackId) => this.enterMovementLab(trackId),
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
      onRestartCheckpoint: () => this.restoreToCheckpoint('PAUSE_RESTART_CP'),
      onRestartTrack: () => this.restartTrack(),
      onArmory: () => {
        this.ui.pauseScreen.hide();
        this.ui.armoryModal.show();
      },
      onSettings: () => this.ui.settingsModal.show(),
      onNewTrack: () => this.returnToImport()
    });

    // Armory Modal
    this.ui.armoryModal.setOnClose(() => {
      this.ui.armoryModal.hide();
      this.ui.pauseScreen.show();
    });

    // Movement Lab Song Selector Modal
    this.ui.movementLabSongModal.setCallbacks({
      onSelect: async (trackEntry) => {
        try {
          const buffer = await trackEntry.generate();
          await this.audioEngine.init();
          this.audioEngine.setBuffer(buffer);
          this.audioEngine.play(0);
          const palette = PaletteSelector.getPaletteForTrackId(trackEntry.id);
          this.world.visualController.setPalette(palette);
          this.environment.setPalette(palette);
          this.viewmodelController.setPalette(palette);
          this.ui.hud.showToast(`AUDIO LOADED // ${trackEntry.title}`, 2000);
          this.cameraController.lock();
        } catch (e) {
          console.error('[MovementLab] Failed to switch soundtrack:', e);
        }
      },
      onClose: () => {
        this.cameraController.lock();
      }
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

  private async enterMovementLab(trackId?: string): Promise<void> {
    this.stateMachine.transitionTo(GameState.MOVEMENT_LAB);
    if (trackId && trackId !== 'NONE') {
      const trackEntry = MusicPack.getTrackById(trackId);
      if (trackEntry) {
        try {
          const buffer = await trackEntry.generate();
          await this.audioEngine.init();
          this.audioEngine.setBuffer(buffer);
          this.audioEngine.play(0);
          const palette = PaletteSelector.getPaletteForTrackId(trackEntry.id);
          this.world.visualController.setPalette(palette);
          this.environment.setPalette(palette);
          this.viewmodelController.setPalette(palette);
          this.ui.hud.showToast(`LAB AUDIO // ${trackEntry.title}`, 2000);
        } catch (e) {
          console.warn('[MovementLab] Failed to initialize selected soundtrack:', e);
        }
      }
    }
  }

  private setupStateMachine(): void {
    this.stateMachine.onTransition((newState, prevState) => {
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
          this.cameraController.lock();
          if (prevState === GameState.PAUSED) {
            // Preserving existing MovementLab state on unpause
          } else {
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
          }
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
          this.ui.pauseScreen.hide();
          this.ui.settingsModal.hide();
          this.ui.armoryModal.hide();
          this.ui.hud.show();
          this.cameraController.lock();
          if (prevState === GameState.PAUSED) {
            this.audioEngine.resume();
          } else {
            this.isFinished = false;
            this.audioEngine.play(this.currentCheckpoint ? this.currentCheckpoint.time : 0);
            this.replayRecorder.start();
            this.ghostManager.start();
          }
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

            const isOvertime = this.isOvertime;
            const overtimeDuration = Math.max(0, this.runElapsedTime - (this.currentAnalysis.duration || 0));

            // Check and save personal best ghost (ONLY for ranked runs, NEVER overtime)
            let isNewPB = false;
            if (this.replayRecorder.hasData() && !isOvertime) {
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

            // Record track completion and rank for Karambit skin unlocks ONLY on valid ranked runs
            if (!isOvertime) {
              const trackName = this.currentAnalysis.filename || 'PLAYHEAD TRACK';
              KarambitSkinSystem.getInstance().recordTrackCompletion(trackName, results.rank);
            }

            this.ui.resultsScreen.showResults(
              results,
              this.currentTrack.seed,
              { rivalDelta, isNewPB },
              this.currentAnalysis.filename || 'PLAYHEAD TRACK',
              { isOvertime, overtimeDuration }
            );
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

  public async loadPresetTrack(trackId: string): Promise<void> {
    const entry = MusicPack.getTrackById(trackId);
    if (entry) {
      await this.handleCatalogTrackSelected(entry);
    }
  }

  private async handleCatalogTrackSelected(trackEntry: TrackCatalogEntry): Promise<void> {
    try {
      this.isFirstContactCourse = !!trackEntry.isFirstContact;
      this.stateMachine.transitionTo(GameState.ANALYSING);
      this.ui.analysisScreen.setTrackTitle(trackEntry.title);
      this.ui.analysisScreen.setStage(`LOADING SIGNAL // ${trackEntry.genre}`);

      // Concurrently load audio and check precomputed level cache
      const [buffer, precomputed] = await Promise.all([
        trackEntry.generate(),
        PresetLevelCache.loadPreset(trackEntry.id)
      ]);

      if (precomputed) {
        // INSTANT LOAD PATH: Bypass heavy FFT analysis and procedural route regeneration
        await this.audioEngine.init();
        this.audioEngine.setBuffer(buffer);

        this.currentAnalysis = precomputed.analysis;
        this.ui.applyAccent(precomputed.analysis.visualAccent);
        this.environment.setAccent(precomputed.analysis.visualAccent);

        this.currentTrack = precomputed.track;
        this.world.loadTrack(precomputed.analysis, this.currentTrack, this.environment);
        if (precomputed.spectacleEvents) {
          this.world.songDirector.spectaclePlanner.events = precomputed.spectacleEvents;
        }
        this.world.songDirector.onSectionAnnouncement = (title) => {
          this.ui.hud.showSectionTitle(title);
        };

        this.ui.analysisScreen.displayAnalysis(precomputed.analysis);
        this.stateMachine.transitionTo(GameState.READY);
        return;
      }

      // Fallback: standard full analysis pipeline
      await this.processBuffer(buffer, trackEntry.title);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Track load failed';
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

    this.ui.analysisScreen.setStage('[DSP ] extracting waveform & detecting transients');
    const analysis = await AudioAnalyzer.analyze(buffer, filename, (stage, _prog) => {
      this.ui.analysisScreen.setStage(stage);
    });

    this.currentAnalysis = analysis;
    this.ui.applyAccent(analysis.visualAccent);
    this.environment.setAccent(analysis.visualAccent);

    // Deterministically generate the course
    this.ui.analysisScreen.setStage('[MAP ] compiling route & resolving surf phrases');
    this.currentTrack = TrackGenerator.generate(analysis);
    this.ui.analysisScreen.setStage('[VAL ] validating traversal & corridor safety');
    this.world.loadTrack(analysis, this.currentTrack, this.environment);
    this.world.songDirector.onSectionAnnouncement = (title) => {
      this.ui.hud.showSectionTitle(title);
    };

    this.ui.analysisScreen.setStage('[OK  ] execute.track');
    this.stateMachine.transitionTo(GameState.READY);
  }

  private prepareTrackForRun(): void {
    if (!this.currentTrack || this.currentTrack.route.length === 0) return;

    this.ui.hud.setTrackInfo(
      this.currentAnalysis?.filename || 'PLAYHEAD TRACK',
      'SECTION 01 // FLOW'
    );

    this.currentCheckpoint = null;
    this.passedCheckpoints.clear();
    this.shownOnboardingCues.clear();
    this.playerController.stats.reset();
    this.strafeVisualizer.clear();
    this.surfVisuals.clear();
    this.runElapsedTime = 0;
    this.isOvertime = false;
    this.ui.hud.setOvertimeStatus(false);

    // Prepare ghosts for track
    this.ghostManager.prepareTrack(this.currentTrack, this.currentAnalysis?.filename || 'PLAYHEAD TRACK');
    this.ghostManager.start();

    const startNode = this.currentTrack.route[0];
    const safeMargin = Math.min(2.5, startNode.dimensions.z * 0.25);
    const backDist = Math.max(0, (startNode.dimensions.z * 0.5) - safeMargin);
    const spawnPos = {
      x: startNode.position.x - Math.sin(startNode.yaw) * backDist,
      y: startNode.position.y + startNode.dimensions.y * 0.5 + 0.05,
      z: startNode.position.z - Math.cos(startNode.yaw) * backDist
    };
    this.playerController.setPosition(spawnPos);
    this.playerController.authoritativeKillY = startNode.position.y - 25.0;
    this.playerController.lastTouchedSurfaceType = 'PLATFORM';

    const targetNode = this.currentTrack.route[1] || startNode;
    const lookTarget = targetNode === startNode ? {
      x: spawnPos.x + Math.sin(startNode.yaw) * 20,
      y: spawnPos.y,
      z: spawnPos.z + Math.cos(startNode.yaw) * 20
    } : targetNode.position;
    const spawnYaw = calculateLookYaw(spawnPos, lookTarget);
    this.playerController.setOrientation(spawnYaw);

    const settings = SettingsManager.getInstance().settings;
    this.cameraController.setSensitivity(settings.mouseSensitivity);
    this.environment.setBaseFov(settings.fov);
    this.audioEngine.setVolume(settings.masterVolume);
    this.viewmodelController.setAccentColor(this.world.visualController.state.palette.primary);
    this.viewmodelController.setPalette(this.world.visualController.state.palette);
  }

  private isRestoringCheckpoint = false;

  private handleFinishSequence(): void {
    if (this.isFinished) return;
    this.isFinished = true;
    this.playerController.resetKeys();
    this.audioEngine.fadeOutAndStop(0.25);

    // Tiny beat of silence (~0.38s) before results presentation enters
    window.setTimeout(() => {
      this.stateMachine.transitionTo(GameState.FINISHED);
    }, 380);
  }

  private handlePlayerFall(): void {
    if (this.stateMachine.is(GameState.MOVEMENT_LAB)) {
      this.restoreToCheckpoint('FALL_LAB');
      return;
    }
    if (this.stateMachine.is(GameState.COUNTDOWN)) {
      this.restoreToCheckpoint('FALL_COUNTDOWN');
      return;
    }
    if (!this.stateMachine.is(GameState.PLAYING)) return;

    const wasSurf = this.playerController.lastTouchedSurfaceType === 'SURF';
    this.restoreToCheckpoint('VOID_FALL', wasSurf);
  }

  private handlePlayerManualRestore(): void {
    if (this.stateMachine.is(GameState.MOVEMENT_LAB)) {
      this.restoreToCheckpoint('MANUAL_LAB');
      return;
    }
    if (!this.stateMachine.is(GameState.PLAYING)) return;
    this.restoreToCheckpoint('MANUAL_R', false);
  }

  private restoreToCheckpoint(reason = 'RESTORE', wasSurf = false): void {
    if (this.isRestoringCheckpoint) return; // Prevent respawn races
    this.isRestoringCheckpoint = true;
    this.playerController.isRestoring = true;

    try {
      if (this.previousStateBeforePause === GameState.MOVEMENT_LAB || this.stateMachine.is(GameState.MOVEMENT_LAB)) {
        if (this.movementLab) {
          this.movementLab.resetPlayer();
        }
        this.playerController.authoritativeKillY = -25.0;
        this.playerController.lastTouchedSurfaceType = 'PLATFORM';
        this.playerController.isRestoring = false;
        this.isRestoringCheckpoint = false;
        if (this.stateMachine.is(GameState.PAUSED)) {
          this.resumeGame();
        }
        return;
      }

      if (!this.currentTrack) {
        this.playerController.isRestoring = false;
        this.isRestoringCheckpoint = false;
        return;
      }

      const beforePos = { ...this.playerController.position };
      const velBefore = { ...this.playerController.velocity };

      let spawnPos: { x: number; y: number; z: number };
      let spawnYaw: number;

      if (this.currentCheckpoint) {
        const cpNodeIdx = this.currentTrack.route.findIndex(n => n.id === this.currentCheckpoint!.routeNodeId);
        const cpNode = cpNodeIdx !== -1 ? this.currentTrack.route[cpNodeIdx] : null;

        if (cpNode) {
          const safeMargin = Math.min(2.5, cpNode.dimensions.z * 0.25);
          const backDist = Math.max(0, (cpNode.dimensions.z * 0.5) - safeMargin);
          spawnPos = {
            x: cpNode.position.x - Math.sin(cpNode.yaw) * backDist,
            y: cpNode.position.y + cpNode.dimensions.y * 0.5 + 0.05,
            z: cpNode.position.z - Math.cos(cpNode.yaw) * backDist
          };
          this.playerController.authoritativeKillY = cpNode.position.y - 25.0;

          const nextNode = (cpNodeIdx < this.currentTrack.route.length - 1)
            ? this.currentTrack.route[cpNodeIdx + 1]
            : null;
          const lookTarget = nextNode ? nextNode.position : {
            x: spawnPos.x + Math.sin(cpNode.yaw) * 20,
            y: spawnPos.y,
            z: spawnPos.z + Math.cos(cpNode.yaw) * 20
          };
          spawnYaw = calculateLookYaw(spawnPos, lookTarget);
        } else {
          spawnPos = {
            x: this.currentCheckpoint.position.x,
            y: this.currentCheckpoint.position.y + 1.05,
            z: this.currentCheckpoint.position.z
          };
          this.playerController.authoritativeKillY = this.currentCheckpoint.position.y - 25.0;
          spawnYaw = this.currentCheckpoint.yaw;
        }

        this.audioEngine.seek(this.currentCheckpoint.time);
      } else {
        // Restore to start platform with runway clearance
        const startNode = this.currentTrack.route[0];
        const safeMargin = Math.min(2.5, startNode.dimensions.z * 0.25);
        const backDist = Math.max(0, (startNode.dimensions.z * 0.5) - safeMargin);
        spawnPos = {
          x: startNode.position.x - Math.sin(startNode.yaw) * backDist,
          y: startNode.position.y + startNode.dimensions.y * 0.5 + 0.05,
          z: startNode.position.z - Math.cos(startNode.yaw) * backDist
        };
        this.playerController.authoritativeKillY = startNode.position.y - 25.0;

        const targetNode = this.currentTrack.route[1] || startNode;
        const lookTarget = targetNode === startNode ? {
          x: spawnPos.x + Math.sin(startNode.yaw) * 20,
          y: spawnPos.y,
          z: spawnPos.z + Math.cos(startNode.yaw) * 20
        } : targetNode.position;
        spawnYaw = calculateLookYaw(spawnPos, lookTarget);
        this.audioEngine.seek(0);
      }

      this.playerController.setPosition(spawnPos);
      this.playerController.setOrientation(spawnYaw);
      this.playerController.lastTouchedSurfaceType = 'PLATFORM';
      this.playerController.resetKeys();

      // Debug / regression logging
      this.playerController.restoreDiagnosticLogs.push({
        reason,
        cpId: this.currentCheckpoint?.id,
        before: beforePos,
        target: spawnPos,
        after: { ...this.playerController.position },
        velBefore,
        timestamp: Date.now()
      });
      if (this.playerController.restoreDiagnosticLogs.length > 20) {
        this.playerController.restoreDiagnosticLogs.shift();
      }

      // Schedule atomic next-frame verification before showing restore notification
      this.pendingRestoreVerification = {
        targetPos: spawnPos,
        yaw: spawnYaw,
        wasSurf,
        attempts: 0
      };
    } catch (e) {
      console.error('[PLAYHEAD ATOMIC RESTORE] Failed during restore transaction:', e);
      this.playerController.isRestoring = false;
      this.isRestoringCheckpoint = false;
      this.pendingRestoreVerification = null;
    }

    if (this.stateMachine.is(GameState.PAUSED)) {
      this.resumeGame();
    }
  }

  private pauseGame(): void {
    if (this.viewmodelCalibrator?.isActive) return;
    this.lastPauseTime = performance.now();
    if (this.stateMachine.is(GameState.PLAYING)) {
      this.previousStateBeforePause = GameState.PLAYING;
      this.stateMachine.transitionTo(GameState.PAUSED);
    } else if (this.stateMachine.is(GameState.MOVEMENT_LAB)) {
      this.previousStateBeforePause = GameState.MOVEMENT_LAB;
      this.stateMachine.transitionTo(GameState.PAUSED);
    }
  }

  private resumeGame(): void {
    if (this.stateMachine.is(GameState.PAUSED)) {
      this.lastResumeTime = performance.now();
      if (typeof document !== 'undefined') {
        if (document.activeElement && typeof (document.activeElement as HTMLElement).blur === 'function') {
          (document.activeElement as HTMLElement).blur();
        }
        document.body.style.cursor = 'none';
      }
      if (this.environment?.renderer?.domElement) {
        this.environment.renderer.domElement.style.cursor = 'none';
      }
      this.ui.pauseScreen.hide();
      this.ui.settingsModal.hide();
      this.ui.armoryModal.hide();
      if (this.previousStateBeforePause === GameState.MOVEMENT_LAB) {
        this.stateMachine.transitionTo(GameState.MOVEMENT_LAB);
      } else {
        this.stateMachine.transitionTo(GameState.PLAYING);
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
    this.cameraController.onUnlock = () => {
      this.pauseGame();
    };

    window.addEventListener('click', (e) => {
      // Never re-engage pointer lock if calibration tool is active
      if (this.viewmodelCalibrator?.isActive) return;

      // Ignore clicks on active UI screens, buttons, inputs, selects
      const target = e.target as HTMLElement | null;
      if (target) {
        if (
          target.tagName === 'BUTTON' ||
          target.tagName === 'INPUT' ||
          target.tagName === 'SELECT' ||
          target.closest('.pause-container') ||
          target.closest('.settings-container') ||
          target.closest('.screen:not(.hidden)')
        ) {
          return;
        }
      }

      if (this.stateMachine.is(GameState.PLAYING) || this.stateMachine.is(GameState.MOVEMENT_LAB)) {
        this.cameraController.lock();
      }
    });

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0 && this.cameraController.getIsLocked()) {
        if (this.stateMachine.is(GameState.PLAYING) || this.stateMachine.is(GameState.MOVEMENT_LAB)) {
          this.viewmodelController.triggerCosmeticSweep();
        }
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();

        const now = performance.now();

        if (this.ui.armoryModal.isVisible()) {
          this.ui.armoryModal.hide();
          this.ui.pauseScreen.show();
          return;
        }

        if (this.ui.movementLabSongModal.isVisible()) {
          this.ui.movementLabSongModal.hide();
          this.cameraController.lock();
          return;
        }

        if (this.ui.settingsModal.isVisible()) {
          this.ui.settingsModal.hide();
          this.ui.pauseScreen.show();
          return;
        }

        if (this.stateMachine.is(GameState.PLAYING) || this.stateMachine.is(GameState.MOVEMENT_LAB)) {
          if (now - this.lastResumeTime < 250) return;
          this.pauseGame();
        } else if (this.stateMachine.is(GameState.PAUSED)) {
          if (now - this.lastPauseTime < 250) return;
          this.resumeGame();
        } else if (this.stateMachine.is(GameState.REPLAY)) {
          this.replayPlayer.stop();
          this.audioEngine.stop();
          this.stateMachine.transitionTo(GameState.FINISHED);
        }
      } else if (e.code === 'KeyF' && !e.repeat) {
        if (this.stateMachine.is(GameState.PLAYING) || this.stateMachine.is(GameState.MOVEMENT_LAB)) {
          this.viewmodelController.triggerSignalPulse();
        }
      } else if (e.code === 'KeyM' && !e.repeat && this.stateMachine.is(GameState.MOVEMENT_LAB)) {
        if (this.ui.movementLabSongModal.isVisible()) {
          this.ui.movementLabSongModal.hide();
          this.cameraController.lock();
        } else {
          this.cameraController.unlock();
          this.ui.movementLabSongModal.show();
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
      } else if (e.code === 'F4' && !e.repeat) {
        // Dev shortcut: Toggle Viewmodel Calibration Tool
        if (
          this.stateMachine.is(GameState.PLAYING) ||
          this.stateMachine.is(GameState.MOVEMENT_LAB) ||
          this.stateMachine.is(GameState.COUNTDOWN)
        ) {
          e.preventDefault();
          this.viewmodelCalibrator.toggle();
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
      // Freeze simulation during viewmodel calibration
      if (this.viewmodelCalibrator.isActive) return;

      // Atomic Restore Verification on next simulation frame
      if (this.pendingRestoreVerification) {
        const p = this.playerController.position;
        const t = this.pendingRestoreVerification.targetPos;
        const dx = p.x - t.x;
        const dy = p.y - t.y;
        const dz = p.z - t.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const killY = this.playerController.authoritativeKillY;

        if (dist < 3.0 && p.y >= t.y - 1.0 && (killY === null || p.y > killY)) {
          // Success: authoritative restore physically confirmed at checkpoint
          this.playerController.isRestoring = false;
          this.isRestoringCheckpoint = false;
          const wasSurf = this.pendingRestoreVerification.wasSurf;
          this.pendingRestoreVerification = null;

          const settings = SettingsManager.getInstance().settings;
          if (settings.showHints) {
            if (wasSurf) {
              this.ui.hud.showSurfTutorialHint(3000);
            } else {
              this.ui.hud.hideSurfTutorialHint();
              this.ui.hud.showToast('RESTORED TO CHECKPOINT', 1500);
            }
          }
        } else {
          // Failed or displaced on frame: re-force authoritative transform
          this.pendingRestoreVerification.attempts++;
          this.playerController.setPosition(this.pendingRestoreVerification.targetPos);
          this.playerController.setOrientation(this.pendingRestoreVerification.yaw);

          if (this.pendingRestoreVerification.attempts > 3) {
            this.playerController.isRestoring = false;
            this.isRestoringCheckpoint = false;
            const wasSurf = this.pendingRestoreVerification.wasSurf;
            this.pendingRestoreVerification = null;
            console.warn('[PLAYHEAD WATCHDOG] Emergency fallback restore completed');
            const settings = SettingsManager.getInstance().settings;
            if (settings.showHints) {
              if (wasSurf) {
                this.ui.hud.showSurfTutorialHint(3000);
              } else {
                this.ui.hud.showToast('RESTORED TO CHECKPOINT', 1500);
              }
            }
          }
        }
      }

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

    // If dev calibration mode is active, freeze world updates and render calibrated viewmodel pose
    if (this.viewmodelCalibrator.isActive) {
      this.viewmodelController.updateCalibrationPose();
      this.environment.render(this.viewmodelController);
      return;
    }

    // Variable render updates
    if (this.stateMachine.is(GameState.PLAYING)) {
      this.cameraController.update(frameDelta);
      const songTime = this.audioEngine.getCurrentTime();
      const songDuration = this.audioEngine.getDuration();

      // Track End / Overtime State handling
      if (songDuration > 0 && this.runElapsedTime > songDuration && !this.isFinished) {
        if (!this.isOvertime) {
          this.isOvertime = true;
        }
        const overtimeSec = this.runElapsedTime - songDuration;
        this.ui.hud.setOvertimeStatus(true, overtimeSec);
      }

      const settings = SettingsManager.getInstance().settings;
      const worldProgress = this.world.update(
        songTime,
        this.playerController.position,
        this.cameraController.yaw,
        frameDelta,
        this.environment,
        this.playerController.getSpeedUnits(),
        settings.reduceMotion
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

      // Forward audio energy to viewmodel cosmic shader (calmed in overtime)
      const reactiveEnergy = this.isOvertime ? 0 : this.world.visualController.state.energy;
      const reactiveImpact = this.isOvertime ? 0 : this.world.visualController.state.dropImpact;

      this.viewmodelController.setAudioLevels(
        reactiveEnergy,
        reactiveImpact
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

      // Onboarding Guidance for FIRST CONTACT
      if (this.isFirstContactCourse) {
        if (this.runElapsedTime >= 1.2 && !this.shownOnboardingCues.has('bhop')) {
          this.shownOnboardingCues.add('bhop');
          this.ui.hud.showOnboardingCue('BHOP FLOW // HOLD [SPACE] OR TAP ON LANDING', 3800);
        } else if (this.runElapsedTime >= 14.0 && !this.shownOnboardingCues.has('strafe')) {
          this.shownOnboardingCues.add('strafe');
          this.ui.hud.showOnboardingCue('AIR STRAFE // TURN MOUSE IN AIR WHILE HOLDING [A] / [D]', 3800);
        }
      }

      // Dynamic FOV based on speed
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
            const dy = this.playerController.position.y - cp.position.y;
            const dz = this.playerController.position.z - cp.position.z;
            // Enforce both horizontal radius and strict vertical window (prevent triggering while falling in void)
            if (dx * dx + dz * dz < 12.0 * 12.0 && Math.abs(dy) < 6.0 && this.playerController.position.y >= cp.position.y - 2.0) {
              this.passedCheckpoints.add(cp.id);
              this.currentCheckpoint = cp;
              this.playerController.authoritativeKillY = cp.position.y - 25.0;
              const split = this.ghostManager.onPlayerReachCheckpoint(i, this.runElapsedTime);
              if (split) {
                this.ui.hud.showSplit(split);
              } else {
                this.ui.hud.showToast(`CHECKPOINT ${i + 1} REACHED`, 2000);
              }
            }
          }
        }

        // Finish Gate check (distinct PLAYHEAD end plane / signal line)
        const finish = this.currentTrack.finish;
        const fdx = this.playerController.position.x - finish.position.x;
        const fdy = this.playerController.position.y - finish.position.y;
        const fdz = this.playerController.position.z - finish.position.z;
        if (!this.isFinished && fdx * fdx + fdz * fdz < 16.0 * 16.0 && Math.abs(fdy) < 7.0 && this.playerController.position.y >= finish.position.y - 2.0) {
          this.handleFinishSequence();
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

    // Update First-Person Viewmodel (Hands + Karambit) in PLAYING, COUNTDOWN, or MOVEMENT_LAB
    let activeVm: ViewmodelController | null = null;
    if (
      this.stateMachine.is(GameState.PLAYING) ||
      this.stateMachine.is(GameState.COUNTDOWN) ||
      this.stateMachine.is(GameState.MOVEMENT_LAB)
    ) {
      const mouseDelta = this.cameraController.consumeMouseDelta();
      this.viewmodelController.update(
        frameDelta,
        this.playerController,
        this.cameraController,
        mouseDelta.x,
        mouseDelta.y
      );
      activeVm = this.viewmodelController;
    }

    // Unified render pass: world -> bloom -> signal style -> viewmodel -> tone map -> grain on top of all
    this.environment.render(activeVm);
  };
}
