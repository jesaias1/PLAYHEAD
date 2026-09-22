/**
 * Master Game Controller for TRACK//RUN
 * Integrates StateMachine, AudioEngine, World, PlayerController, Replay, and UI
 */

import { GameState, StateMachine } from './StateMachine';
import * as THREE from 'three';
import { GameClock } from './Clock';
import { GameSettings, GraphicsTier, SettingsKey, SettingsManager } from './Settings';
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
import type { RunRank } from '../player/PlayerStats';
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
import { RestoreReason } from '../player/RestorePolicy';
import { movementDiagnostics, ViewSnapDetector, MovementDiagEvent, MovementDiagnostics, RawMouseSpikeDetector } from './MovementDiagnostics';
import { PointerInputProbe } from './PointerInputProbe';
import { BUILD_LABEL } from './BuildInfo';
import { LeaderboardManager } from '../leaderboard/LeaderboardManager';
import { CustomAudioRewardService } from '../audio/CustomAudioRewardService';
import { FINISH_GATE_HEIGHT, FinishGateDetector } from '../gameplay/FinishGateDetector';

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
  private currentOfficialTrackId: string | null = null;

  private currentCheckpoint: CheckpointDefinition | null = null;
  private passedCheckpoints = new Set<number>();

  private runElapsedTime = 0;
  private isFinished = false;
  private isOvertime = false;
  private finishGateDetector = new FinishGateDetector();
  private isQuickRestarting = false;

  private isFirstContactCourse = false;
  private shownOnboardingCues = new Set<string>();
  private currentCustomAudioBuffer: AudioBuffer | null = null;

  private movementLab: MovementLab | null = null;
  private previousStateBeforePause: GameState = GameState.PLAYING;
  private lastPauseTime = 0;
  private lastResumeTime = 0;

  private pendingRestoreVerification: {
    targetPos: { x: number; y: number; z: number };
    yaw: number;
    wasSurf: boolean;
    reason: RestoreReason | string;
    attempts: number;
    /** Context captured when the restore was issued, for diagnostics. */
    diag: {
      before: { x: number; y: number; z: number };
      velocity: { x: number; y: number; z: number };
      displaySpeed: number;
      cpId: number | null;
      cpWasNull: boolean;
      voidDeathY: number | null;
      cameraYaw: number;
      cameraPitch: number;
      fov: number;
      frameDeltaMs: number;
      gameState: string;
    };
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
    // Environment resolves AUTO/quality presets before the viewmodel exists.
    // Synchronize the initial pass once, then live graphics changes propagate
    // through the authoritative settings subscription below.
    this.viewmodelController.applyQuality(this.environment.activePreset);

    // Diagnostics: ?debugNoViewmodel=1 hides hands/knife ONLY, to isolate a
    // viewmodel sway illusion from a real world-view snap. It does not alter
    // camera, input, FOV, physics or collision.
    if (MovementDiagnostics.isViewmodelHiddenRequested(
      typeof window !== 'undefined' ? window.location.search : ''
    )) {
      this.viewmodelController.setDiagnosticHidden(true);
    }
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

    const settingsManager = SettingsManager.getInstance();
    this.applyLiveSettings(settingsManager.settings, new Set<SettingsKey>([
      'mouseSensitivity', 'fov', 'masterVolume', 'ghostMode'
    ]));
    settingsManager.subscribe((settings, changedKeys) => {
      this.applyLiveSettings(settings, changedKeys);
    });

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

    // Pause Screen
    this.ui.pauseScreen.setCallbacks({
      onResume: () => this.resumeGame(),
      onRestartCheckpoint: () => this.restoreToCheckpoint('PAUSE_RESTART_CP'),
      onRestartTrack: () => this.restartTrack(),
      onArmory: () => {
        this.ui.pauseScreen.hide();
        this.ui.armoryModal.show();
      },
      onSettings: () => {
        this.ui.pauseScreen.hide();
        this.ui.settingsModal.show();
      },
      onNewTrack: () => this.returnToImport()
    });

    // Armory Modal
    this.ui.armoryModal.setOnClose(() => {
      this.ui.armoryModal.hide();
      this.ui.pauseScreen.show();
    });

    // Settings Modal
    this.ui.settingsModal.setOnClose(() => {
      this.ui.settingsModal.hide();
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

    // Player fall / restore / full restart
    this.playerController.onFallCallback = (reason) => this.handlePlayerFall(reason);
    this.playerController.onRestoreCallback = () => this.handlePlayerManualRestore();
    this.playerController.onFullRestartCallback = () => {
      this.ui.hud.setRestartHoldProgress(null);
      this.restartTrack();
    };
    this.playerController.onHoldProgressCallback = (progress) => {
      this.ui.hud.setRestartHoldProgress(progress);
    };

    // Replay finished
    this.replayPlayer.onCompleteCallback = () => {
      this.stateMachine.transitionTo(GameState.FINISHED);
    };
  }

  private applyLiveSettings(
    settings: Readonly<GameSettings>,
    changedKeys: ReadonlySet<SettingsKey>
  ): void {
    if (changedKeys.has('mouseSensitivity')) {
      this.cameraController.setSensitivity(settings.mouseSensitivity);
    }
    if (changedKeys.has('fov')) {
      this.environment.setBaseFov(settings.fov);
    }
    if (changedKeys.has('masterVolume')) {
      this.audioEngine.setVolume(settings.masterVolume);
    }
    if (changedKeys.has('graphics')) {
      this.environment.applyQualityTier(settings.graphics as GraphicsTier, false);
    }
    if (changedKeys.has('ghostMode')) {
      this.ghostManager.applySettingsVisibility();
    }
    if (changedKeys.has('hideHud')) {
      if (settings.hideHud) {
        this.ui.hud.hide();
      } else if (this.stateMachine.is(GameState.PLAYING) || this.stateMachine.is(GameState.MOVEMENT_LAB)) {
        this.ui.hud.show();
      }
    }
    if (changedKeys.has('viewmodelFov')) {
      this.viewmodelController.setFov(settings.viewmodelFov || 65);
    }
  }

  private async enterMovementLab(trackId?: string): Promise<void> {
    this.currentOfficialTrackId = null;
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
          if (prevState === GameState.PAUSED && !this.isQuickRestarting) {
            this.audioEngine.resume();
          } else if (!this.isQuickRestarting) {
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

            // Record cosmetic progression and official leaderboard / custom audio rewards
            let dropsAwarded = 0;
            let bestDropRank: RunRank | undefined;
            let officialInfo: {
              isOfficial: boolean;
              trackId: string;
              candidate?: import('../leaderboard/LeaderboardManager').LeaderboardSubmissionCandidate;
              isNewLocalFirst?: boolean;
            } | undefined;
            let customRewardInfo: {
              isCustomAudio: boolean;
              eligible: boolean;
              statusMessage: string;
              reason?: 'TOO_SHORT' | 'ALREADY_CLAIMED';
            } | undefined;

            if (this.currentOfficialTrackId) {
              const trackName = this.currentAnalysis.filename || 'PLAYHEAD TRACK';
              const progressionKey = this.currentOfficialTrackId;
              if (results.rank !== 'UNRANKED') {
                const completionReward = KarambitSkinSystem.getInstance().recordTrackCompletion(
                  progressionKey,
                  results.rank,
                  this.currentOfficialTrackId
                );
                dropsAwarded = completionReward.dropsAwarded;
                bestDropRank = completionReward.awardedDropRanks[0];
              }

              // Record official run in LeaderboardManager
              const isOfficialValid = !this.movementLab && results.rank !== 'UNRANKED';
              const trackSeed = this.currentTrack.seed;
              const lbResult = LeaderboardManager.getInstance().recordOfficialRun(
                this.currentOfficialTrackId,
                trackSeed,
                results,
                isOfficialValid
              );

              const candidate = isOfficialValid
                ? LeaderboardManager.getInstance().prepareSubmissionCandidate(
                    this.currentOfficialTrackId,
                    trackName,
                    trackSeed,
                    results,
                    isOfficialValid
                  )
                : undefined;

              officialInfo = {
                isOfficial: true,
                trackId: this.currentOfficialTrackId,
                candidate,
                isNewLocalFirst: lbResult.isNewLocalFirst
              };
            } else if (this.currentCustomAudioBuffer) {
              // Custom audio run
              const dur = this.currentCustomAudioBuffer.duration;
              const fp = CustomAudioRewardService.computeAudioFingerprint(this.currentCustomAudioBuffer);
              const elig = CustomAudioRewardService.getInstance().checkEligibility(dur, fp);
              customRewardInfo = {
                isCustomAudio: true,
                eligible: elig.eligible,
                statusMessage: elig.statusMessage,
                reason: elig.reason
              };

              if (elig.eligible && results.rank !== 'UNRANKED') {
                CustomAudioRewardService.getInstance().claimReward(fp);
                KarambitSkinSystem.getInstance().grantSignalDrop('BRONZE');
                dropsAwarded = 1;
                bestDropRank = 'BRONZE';
              }
            }

            this.ui.resultsScreen.showResults(
              results,
              this.currentTrack.seed,
              { rivalDelta, isNewPB },
              this.currentAnalysis.filename || 'PLAYHEAD TRACK',
              { isOvertime, overtimeDuration },
              { dropsAwarded, bestDropRank },
              officialInfo,
              customRewardInfo
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
      this.currentOfficialTrackId = trackEntry.id;
      this.currentCustomAudioBuffer = null;
      this.isFirstContactCourse = !!trackEntry.isFirstContact;
      this.stateMachine.transitionTo(GameState.ANALYSING);
      this.ui.analysisScreen.setTrackTitle(trackEntry.title);
      this.ui.analysisScreen.setStage(`[SIGNAL] OFFICIAL PROGRAM REQUESTED // ${trackEntry.genre}`, 0.04);

      // Concurrently load audio and check precomputed level cache
      const [buffer, precomputed] = await Promise.all([
        trackEntry.generate(),
        PresetLevelCache.loadPreset(trackEntry.id)
      ]);

      if (precomputed) {
        // INSTANT LOAD PATH: Bypass heavy FFT analysis and procedural route regeneration
        this.ui.analysisScreen.setStage('[AUDIO] PROGRAM BUFFER READY', 0.35);
        await this.audioEngine.init();
        this.audioEngine.setBuffer(buffer);

        this.currentAnalysis = precomputed.analysis;
        this.ui.applyAccent(precomputed.analysis.visualAccent);
        this.environment.setAccent(precomputed.analysis.visualAccent);

        this.ui.analysisScreen.setStage('[MAP] PRECOMPUTED MOVEMENT PHRASES RESTORED', 0.72);
        this.currentTrack = precomputed.track;
        this.ui.analysisScreen.setStage('[WORLD] SYNTHESIZING SPACE', 0.88);
        this.world.loadTrack(precomputed.analysis, this.currentTrack, this.environment);
        if (precomputed.spectacleEvents) {
          this.world.songDirector.spectaclePlanner.events = precomputed.spectacleEvents;
        }
        this.world.songDirector.onSectionAnnouncement = (title) => {
          this.ui.hud.showSectionTitle(title);
        };

        this.ui.analysisScreen.setStage('[ROUTE] COURSE ONLINE', 0.97);
        this.ui.analysisScreen.displayAnalysis(precomputed.analysis);
        this.stateMachine.transitionTo(GameState.READY);
        return;
      }

      // Fallback: standard full analysis pipeline
      await this.processBuffer(buffer, trackEntry.title);
    } catch (err: unknown) {
      this.currentOfficialTrackId = null;
      this.currentCustomAudioBuffer = null;
      const msg = err instanceof Error ? err.message : 'Track load failed';
      alert(msg);
      this.stateMachine.transitionTo(GameState.IMPORT);
    }
  }

  private async handleFileSelected(file: File): Promise<void> {
    try {
      this.currentOfficialTrackId = null;
      this.isFirstContactCourse = false;
      this.stateMachine.transitionTo(GameState.ANALYSING);
      this.ui.analysisScreen.setTrackTitle(file.name);
      this.ui.analysisScreen.setStage('[SIGNAL] INPUT RECEIVED', 0.02);

      const { buffer, filename } = await AudioLoader.loadFromFile(file);
      this.currentCustomAudioBuffer = buffer;
      this.ui.analysisScreen.setStage('[AUDIO] PCM DECODED', 0.08);
      await this.processBuffer(buffer, filename);
    } catch (err: unknown) {
      this.currentCustomAudioBuffer = null;
      const msg = err instanceof Error ? err.message : 'Audio load failed';
      alert(msg);
      this.stateMachine.transitionTo(GameState.IMPORT);
    }
  }

  private async handleDevTrackSelected(genre: SyntheticGenre = 'ELECTRONIC_DROP'): Promise<void> {
    try {
      this.currentOfficialTrackId = null;
      this.currentCustomAudioBuffer = null;
      this.isFirstContactCourse = false;
      this.stateMachine.transitionTo(GameState.ANALYSING);
      const title = `DEV ${genre.replace('_', ' ')}`;
      this.ui.analysisScreen.setTrackTitle(title);
      this.ui.analysisScreen.setStage('[AUDIO] GENERATING DEV SIGNAL', 0.04);

      const buffer = await SyntheticTrack.generate(genre);
      this.ui.analysisScreen.setStage('[AUDIO] PCM BUFFER READY', 0.08);
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

    this.ui.analysisScreen.setStage('[DSP] PREPARING ANALYSIS', 0.1);
    const analysis = await AudioAnalyzer.analyze(buffer, filename, (stage, progress) => {
      this.ui.analysisScreen.setStage(stage, 0.1 + progress * 0.68);
    });

    this.currentAnalysis = analysis;
    this.ui.applyAccent(analysis.visualAccent);
    this.environment.setAccent(analysis.visualAccent);

    // Deterministically generate the course
    this.ui.analysisScreen.setStage('[MAP] MOVEMENT PHRASES', 0.82);
    this.currentTrack = TrackGenerator.generate(analysis);
    this.ui.analysisScreen.setStage('[ROUTE] TRAVERSAL VALIDATED', 0.9);
    this.ui.analysisScreen.setStage('[WORLD] SYNTHESIZING SPACE', 0.94);
    this.world.loadTrack(analysis, this.currentTrack, this.environment);
    this.world.songDirector.onSectionAnnouncement = (title) => {
      this.ui.hud.showSectionTitle(title);
    };

    this.ui.analysisScreen.setStage('[ROUTE] COURSE ONLINE', 0.98);
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
    this.finishGateDetector.reset(spawnPos);
    this.syncAuthoritativeVoidBoundary();
    this.playerController.lastTouchedSurfaceType = 'PLATFORM';
    // Re-arm the camera-translation monitor for the new track.
    this.diagSettleFrames = 0;
    this.diagHasPrev = false;

    const targetNode = this.currentTrack.route[1] || startNode;
    const lookTarget = targetNode === startNode ? {
      x: spawnPos.x + Math.sin(startNode.yaw) * 20,
      y: spawnPos.y,
      z: spawnPos.z + Math.cos(startNode.yaw) * 20
    } : targetNode.position;
    const spawnYaw = calculateLookYaw(spawnPos, lookTarget);
    this.playerController.setOrientation(spawnYaw);

    // setPalette applies the map's primary hue to the adaptive viewmodel accent.
    this.viewmodelController.setPalette(this.world.visualController.state.palette);
  }

  private isRestoringCheckpoint = false;

  /** Reason for the most recent restore — diagnostics only. */
  public lastRestoreReason: RestoreReason | string | null = null;

  /**
   * Full diagnostic record of the most recent automatic position reset.
   * DEV-facing only; used to make any rubberband attributable to its source.
   */
  public lastRestoreDiagnostic: Record<string, unknown> | null = null;

  /** True while a paused->playing resume is waiting for pointer lock. */
  private awaitingResumeLock = false;

  /** Smoothed FPS for the dev diagnostics overlay. */
  private smoothedFps = 0;

  /** Last observed frame delta in ms (movement diagnostics context). */
  private lastFrameDeltaMs = 0;

  // Camera-translation monitor scratch state (diagnostics only).
  private diagCamWorld = new THREE.Vector3();
  private diagPrevCamWorld = new THREE.Vector3();
  private diagPrevPlayerPos = new THREE.Vector3();
  private diagHasPrev = false;
  /** Frames to skip after a load before the camera checks are trusted. */
  private diagSettleFrames = 0;

  /** View-orientation discontinuity detector (active only in diagnostics mode). */
  private viewSnapDetector = new ViewSnapDetector();
  private rawSpikeDetector = new RawMouseSpikeDetector();
  private lastRawSpikeEvent: MovementDiagEvent | null = null;
  private lastViewSnapEvent: MovementDiagEvent | null = null;
  private mouseHandlerCount = 0;

  /** Pointer-granularity experiment (observation only). */
  private pointerProbe = new PointerInputProbe();
  private pointerProbeEnabled = false;

  /**
   * Pushes the authoritative world void boundary into the player.
   *
   * The boundary is derived from FINAL legitimate gameplay geometry (see
   * PhysicsWorld.getVoidDeathY). It is deliberately re-derived here rather than
   * being recomputed from the current checkpoint: tying the kill plane to the
   * current checkpoint's Y is what previously produced false restores for
   * players legitimately flying below an elevated checkpoint.
   */
  private syncAuthoritativeVoidBoundary(): void {
    this.playerController.authoritativeKillY = this.world.physics.getVoidDeathY();
    this.playerController.voidChecker = (pos) => this.world.physics.isPositionInVoid(pos);
  }

  /**
   * Renders the largest observed parent pointer event as a readable breakdown,
   * so it is immediately visible whether a big delta decomposes into smaller
   * coalesced samples or is a genuine single raw sample.
   */
  private describeLargestParentEvent(): string {
    const r = this.pointerProbe.largestParentEvent;
    if (!r) return '(none yet)';
    const parts = r.constituents
      .slice(0, 8)
      .map((c) => `${c.movementX}/${c.movementY}`)
      .join(' ');
    const more = r.constituents.length > 8 ? ` +${r.constituents.length - 8} more` : '';
    return `parent ${r.parentX}/${r.parentY} (${r.parentMagnitude.toFixed(1)}px) = ${r.constituentCount} sample(s) [${parts}${more}] sum=${r.sumX.toFixed(1)}/${r.sumY.toFixed(1)} spread=${r.timestampSpreadMs.toFixed(1)}ms via ${r.source}`;
  }

  /**
   * CAMERA TRANSLATION MONITOR (diagnostics only).
   *
   * The camera is owned by PlayerController.syncCamera(), which places it at
   * `player.position + eyeHeight`. This asserts that invariant every frame and
   * reports any frame where the camera's world position diverges from it, or
   * jumps discontinuously relative to the player.
   *
   * Reads state only — it never writes player, camera or physics.
   */
  private checkCameraTranslationDiagnostics(): void {
    const cam = this.environment.camera;
    if (!cam) return;

    // The camera is only owned by PlayerController.syncCamera() while the
    // simulation is actually running (PLAYING / MOVEMENT_LAB). Outside those
    // states a mismatch is expected and is not a desync.
    const simulationActive =
      this.stateMachine.is(GameState.PLAYING) || this.stateMachine.is(GameState.MOVEMENT_LAB);

    if (!simulationActive) {
      this.diagSettleFrames = 0;
      this.diagHasPrev = false;
      return;
    }

    // Ignore the first frames after a load: the camera is placed by the first
    // syncCamera() within a fixed step, so an immediate comparison would report
    // the pre-sync camera (a startup artifact, not a real desync).
    this.diagSettleFrames++;
    if (this.diagSettleFrames < 30) {
      cam.getWorldPosition(this.diagPrevCamWorld);
      this.diagPrevPlayerPos.set(
        this.playerController.position.x,
        this.playerController.position.y,
        this.playerController.position.z
      );
      this.diagHasPrev = true;
      return;
    }

    cam.getWorldPosition(this.diagCamWorld);
    const expectedX = this.playerController.position.x;
    const expectedY = this.playerController.position.y + this.playerController.config.eyeHeight;
    const expectedZ = this.playerController.position.z;

    const desync = Math.hypot(
      this.diagCamWorld.x - expectedX,
      this.diagCamWorld.y - expectedY,
      this.diagCamWorld.z - expectedZ
    );

    if (this.diagHasPrev) {
      const camStep = Math.hypot(
        this.diagCamWorld.x - this.diagPrevCamWorld.x,
        this.diagCamWorld.y - this.diagPrevCamWorld.y,
        this.diagCamWorld.z - this.diagPrevCamWorld.z
      );
      // Player step is invariant-safe: the physics body moved by at most this.
      const playerStep = Math.hypot(
        this.playerController.position.x - this.diagPrevPlayerPos.x,
        this.playerController.position.y - this.diagPrevPlayerPos.y,
        this.playerController.position.z - this.diagPrevPlayerPos.z
      );
      // A camera that moves much further than the player (beyond a small
      // tolerance) indicates a transform/space fault rather than gameplay.
      if (camStep > playerStep + 0.5) {
        movementDiagnostics.recordThrottled(
          'CAMERA_DESYNC',
          'CAMERA_MOVED_INDEPENDENT_OF_PLAYER',
          'Game.checkCameraTranslationDiagnostics',
          {
            cameraStep: camStep,
            playerStep,
            playerPos: `(${this.playerController.position.x.toFixed(3)}, ${this.playerController.position.y.toFixed(3)}, ${this.playerController.position.z.toFixed(3)})`,
            cameraWorld: `(${this.diagCamWorld.x.toFixed(3)}, ${this.diagCamWorld.y.toFixed(3)}, ${this.diagCamWorld.z.toFixed(3)})`,
            expectedEyeWorld: `(${expectedX.toFixed(3)}, ${expectedY.toFixed(3)}, ${expectedZ.toFixed(3)})`,
            desync,
            cameraLocal: `(${cam.position.x.toFixed(3)}, ${cam.position.y.toFixed(3)}, ${cam.position.z.toFixed(3)})`,
            cameraParent: cam.parent ? cam.parent.type : 'null',
            cameraYaw: this.cameraController.yaw,
            cameraPitch: this.cameraController.pitch,
            fov: cam.fov,
            frameDeltaMs: this.lastFrameDeltaMs
          },
          'cam-independent'
        );
      }
    }

    if (desync > 1e-3) {
      movementDiagnostics.recordThrottled(
        'CAMERA_DESYNC',
        'EYE_POINT_MISMATCH',
        'Game.checkCameraTranslationDiagnostics',
        {
          desync,
          cameraWorld: `(${this.diagCamWorld.x.toFixed(3)}, ${this.diagCamWorld.y.toFixed(3)}, ${this.diagCamWorld.z.toFixed(3)})`,
          expectedEyeWorld: `(${expectedX.toFixed(3)}, ${expectedY.toFixed(3)}, ${expectedZ.toFixed(3)})`,
          cameraLocal: `(${cam.position.x.toFixed(3)}, ${cam.position.y.toFixed(3)}, ${cam.position.z.toFixed(3)})`,
          cameraParent: cam.parent ? cam.parent.type : 'null',
          cameraYaw: this.cameraController.yaw,
          cameraPitch: this.cameraController.pitch,
          fov: cam.fov,
          frameDeltaMs: this.lastFrameDeltaMs
        },
        'eye-desync'
      );
    }

    this.diagPrevCamWorld.copy(this.diagCamWorld);
    this.diagPrevPlayerPos.set(
      this.playerController.position.x,
      this.playerController.position.y,
      this.playerController.position.z
    );
    this.diagHasPrev = true;
  }

  /**
   * Displays the restore notification (only after the restore is physically
   * confirmed) while keeping the player-facing message clean.
   *
   * Reason detail stays in diagnostics: emergency numeric recovery is surfaced
   * through the dev overlay rather than the production HUD.
   */
  private announceRestore(
    reason: RestoreReason | string,
    wasSurf: boolean,
    fallback = false,
    diag?: {
      before: { x: number; y: number; z: number };
      velocity: { x: number; y: number; z: number };
      displaySpeed: number;
      cpId: number | null;
      cpWasNull: boolean;
      voidDeathY: number | null;
      cameraYaw: number;
      cameraPitch: number;
      fov: number;
      frameDeltaMs: number;
      gameState: string;
    }
  ): void {
    // Always record the reason for diagnostics, independent of hint settings.
    this.lastRestoreReason = reason;

    // Log EVERY restore that completes — including the normal void restore,
    // which previously completed silently and was therefore invisible in a
    // reproduction.
    if (diag) {
      movementDiagnostics.record(
        'RESTORE',
        `${String(reason)}${fallback ? ' (fallback)' : ''}`,
        'Game.announceRestore (restore confirmed)',
        {
          restoredTo: `(${this.playerController.position.x.toFixed(3)}, ${this.playerController.position.y.toFixed(3)}, ${this.playerController.position.z.toFixed(3)})`,
          positionBefore: `(${diag.before.x.toFixed(3)}, ${diag.before.y.toFixed(3)}, ${diag.before.z.toFixed(3)})`,
          displacement: Math.hypot(
            this.playerController.position.x - diag.before.x,
            this.playerController.position.y - diag.before.y,
            this.playerController.position.z - diag.before.z
          ),
          velocity: `(${diag.velocity.x.toFixed(3)}, ${diag.velocity.y.toFixed(3)}, ${diag.velocity.z.toFixed(3)})`,
          displaySpeed: diag.displaySpeed,
          playerYBefore: diag.before.y,
          voidDeathY: diag.voidDeathY,
          checkpointId: diag.cpId,
          checkpointResolvedTo: diag.cpWasNull ? 'LEVEL_START' : 'CURRENT_CHECKPOINT',
          cameraYaw: diag.cameraYaw,
          cameraPitch: diag.cameraPitch,
          fov: diag.fov,
          frameDeltaMs: diag.frameDeltaMs,
          gameState: diag.gameState,
          wasSurf
        }
      );
    }

    const settings = SettingsManager.getInstance().settings;
    if (!settings.showHints) return;

    if (wasSurf) {
      this.ui.hud.showSurfTutorialHint(3000);
      return;
    }
    this.ui.hud.hideSurfTutorialHint();
    this.ui.hud.showToast('RESTORED TO CHECKPOINT', 1500);
  }

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

  private handlePlayerFall(reason: RestoreReason = RestoreReason.OTHER): void {
    if (this.stateMachine.is(GameState.MOVEMENT_LAB)) {
      this.restoreToCheckpoint(RestoreReason.OTHER, false);
      return;
    }
    if (this.stateMachine.is(GameState.COUNTDOWN)) {
      this.restoreToCheckpoint(RestoreReason.OTHER, false);
      return;
    }
    if (!this.stateMachine.is(GameState.PLAYING)) return;

    const wasSurf = this.playerController.lastTouchedSurfaceType === 'SURF';
    this.restoreToCheckpoint(reason, wasSurf);
  }

  private handlePlayerManualRestore(): void {
    if (this.stateMachine.is(GameState.MOVEMENT_LAB)) {
      this.restoreToCheckpoint(RestoreReason.MANUAL_RESTORE, false);
      return;
    }
    if (!this.stateMachine.is(GameState.PLAYING)) return;
    this.restoreToCheckpoint(RestoreReason.MANUAL_RESTORE, false);
  }

  private restoreToCheckpoint(reason: RestoreReason | string = RestoreReason.OTHER, wasSurf = false): void {
    if (this.isRestoringCheckpoint) return; // Prevent respawn races
    this.isRestoringCheckpoint = true;
    this.playerController.isRestoring = true;

    // Capture the full pre-restore context now: by the time the restore is
    // confirmed, the live player state has already been overwritten.
    const cam = this.environment.camera as THREE.PerspectiveCamera;
    const velAtRestore = this.playerController.velocity;
    const restoreDiag = {
      before: {
        x: this.playerController.position.x,
        y: this.playerController.position.y,
        z: this.playerController.position.z
      },
      velocity: { x: velAtRestore.x, y: velAtRestore.y, z: velAtRestore.z },
      displaySpeed: this.playerController.getSpeedUnits(),
      cpId: this.currentCheckpoint ? this.currentCheckpoint.id : null,
      cpWasNull: this.currentCheckpoint === null,
      voidDeathY: this.playerController.authoritativeKillY,
      cameraYaw: this.cameraController.yaw,
      cameraPitch: this.cameraController.pitch,
      fov: cam ? cam.fov : 0,
      frameDeltaMs: this.lastFrameDeltaMs,
      gameState: String(this.stateMachine.getState())
    };

    // Emit the restore request immediately (this is the decisive event: it
    // identifies WHO asked for the restore and WHY).
    movementDiagnostics.record(
      'RESTORE',
      String(reason),
      'Game.restoreToCheckpoint',
      {
        positionBefore: `(${restoreDiag.before.x.toFixed(3)}, ${restoreDiag.before.y.toFixed(3)}, ${restoreDiag.before.z.toFixed(3)})`,
        velocity: `(${restoreDiag.velocity.x.toFixed(3)}, ${restoreDiag.velocity.y.toFixed(3)}, ${restoreDiag.velocity.z.toFixed(3)})`,
        displaySpeed: restoreDiag.displaySpeed,
        playerY: restoreDiag.before.y,
        voidDeathY: restoreDiag.voidDeathY,
        checkpointId: restoreDiag.cpId,
        checkpointResolvedTo: restoreDiag.cpWasNull ? 'LEVEL_START' : 'CURRENT_CHECKPOINT',
        cameraYaw: restoreDiag.cameraYaw,
        cameraPitch: restoreDiag.cameraPitch,
        fov: restoreDiag.fov,
        frameDeltaMs: restoreDiag.frameDeltaMs,
        grounded: this.playerController.isGrounded,
        surfing: this.playerController.isSurfing,
        gameState: restoreDiag.gameState,
        wasSurf
      }
    );

    try {
      if (this.previousStateBeforePause === GameState.MOVEMENT_LAB || this.stateMachine.is(GameState.MOVEMENT_LAB)) {
        if (this.movementLab) {
          // Tap-R / fall restore returns to the last gauntlet test checkpoint
          // (or the lab spawn when outside the gauntlet).
          this.movementLab.respawnAtTestCheckpoint();
        }
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
      const wasGroundedBefore = this.playerController.isGrounded;
      const hadCheckpoint = this.currentCheckpoint !== null;

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
      this.finishGateDetector.resetMotion(spawnPos);
      this.playerController.setOrientation(spawnYaw);
      this.playerController.lastTouchedSurfaceType = 'PLATFORM';
      this.playerController.resetKeys();

      // ==========================================================
      // RESTORE DIAGNOSTICS
      //
      // Every automatic position reset is recorded with enough context to
      // identify exactly which system issued it and why. This is what makes a
      // mystery rubberband impossible: if the player snaps, the log names the
      // reason, the source, the speed and the displacement that triggered it.
      // Diagnostics only — never surfaced in normal production UI.
      // ==========================================================
      const hp = Math.hypot(velBefore.x, velBefore.z);
      const ddx = beforePos.x - spawnPos.x;
      const ddy = beforePos.y - spawnPos.y;
      const ddz = beforePos.z - spawnPos.z;
      const displacementToTarget = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);

      const diagnostic = {
        reason,
        source: 'Game.restoreToCheckpoint',
        cpId: this.currentCheckpoint?.id ?? null,
        resolvedTo: hadCheckpoint ? 'CURRENT_CHECKPOINT' : 'LEVEL_START',
        before: beforePos,
        target: spawnPos,
        after: { ...this.playerController.position },
        velBefore,
        horizontalSpeedBefore: hp,
        displacementToTarget,
        wasGrounded: wasGroundedBefore,
        wasSurfing: wasSurf,
        lastTouchedSurfaceType: this.playerController.lastTouchedSurfaceType,
        voidDeathY: this.playerController.authoritativeKillY,
        lowestGameplayY: this.world.physics.lowestGameplayY,
        finite: Number.isFinite(beforePos.x) && Number.isFinite(beforePos.y) &&
          Number.isFinite(beforePos.z) && Number.isFinite(velBefore.x),
        gameState: this.stateMachine.getState(),
        timestamp: Date.now()
      };

      // Always record in the rolling diagnostic buffer.
      this.playerController.restoreDiagnosticLogs.push({
        reason,
        cpId: this.currentCheckpoint?.id,
        before: beforePos,
        target: spawnPos,
        after: { ...this.playerController.position },
        velBefore,
        emergencyFallback: false,
        timestamp: Date.now()
      });
      if (this.playerController.restoreDiagnosticLogs.length > 20) {
        this.playerController.restoreDiagnosticLogs.shift();
      }

      // Restore diagnostics are emitted by movementDiagnostics.record above.

      this.lastRestoreDiagnostic = diagnostic;

      // Schedule atomic next-frame verification before showing restore notification
      this.pendingRestoreVerification = {
        targetPos: spawnPos,
        yaw: spawnYaw,
        wasSurf,
        reason,
        attempts: 0,
        diag: restoreDiag
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

/**
   * Resumes gameplay.
   *
   * POINTER LOCK POLICY: browsers refuse to re-acquire pointer lock without a
   * user gesture, so resuming is a two-step transaction:
   *   1. the click on RESUME requests pointer lock (that click IS the gesture)
   *   2. gameplay actually resumes only once the lock is confirmed
   *
   * If the lock fails, the game stays paused with the cursor free rather than
   * pretending to resume and leaving the player without mouse control.
   */
  private resumeGame(): void {
    if (!this.stateMachine.is(GameState.PAUSED)) return;

    this.lastResumeTime = performance.now();

    // If pointer lock is not held, request it and defer the state transition
    // until onLockChange confirms it. The current call stack is still inside
    // the user's click, so the request is a valid user-gesture lock.
    if (!this.cameraController.getIsLocked()) {
      this.awaitingResumeLock = true;
      this.cameraController.lock();
      // Fallback: if the browser neither confirms nor errors (rare), resume
      // anyway so the player is never trapped on the pause screen.
      window.setTimeout(() => {
        if (!this.awaitingResumeLock) return;
        this.awaitingResumeLock = false;
        this.finalizeResume();
      }, 600);
      return;
    }

    this.awaitingResumeLock = false;
    this.finalizeResume();
  }

  /** Performs the actual paused -> playing transition. */
  private finalizeResume(): void {
    if (!this.stateMachine.is(GameState.PAUSED)) return;

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

    this.isQuickRestarting = true;
    this.audioEngine.stop();
    this.prepareTrackForRun();

    this.ui.hideAllScreens();
    this.ui.countdownScreen.cancel();
    this.ui.pauseScreen.hide();
    this.ui.settingsModal.hide();
    this.ui.armoryModal.hide();
    this.ui.resultsScreen.hide();
    this.ui.hud.show();
    this.ui.hud.setRestartHoldProgress(null);

    this.isFinished = false;
    this.audioEngine.play(0);
    this.replayRecorder.start();
    this.ghostManager.start();
    this.cameraController.lock();

    // Brief input lockout (~0.1s / 100ms) to ensure keys held during reset don't immediately produce unwanted initial inputs
    this.playerController.lockInput(0.1);

    if (this.stateMachine.is(GameState.PLAYING)) {
      this.isQuickRestarting = false;
    } else {
      this.stateMachine.transitionTo(GameState.PLAYING);
      this.isQuickRestarting = false;
    }
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
    this.currentOfficialTrackId = null;
    this.stateMachine.transitionTo(GameState.IMPORT);
  }

  private setupInputHandlers(): void {
    // ---- View-orientation diagnostics (opt-in via ?debugMovement=1) -------
    // Pure observers: they read orientation state and never write it.
    if (movementDiagnostics.isEnabled) {
      this.mouseHandlerCount = this.cameraController.registeredHandlerCounts.mousemove;
      this.cameraController.onRawMouseDelta = (mx, my) => {
        this.viewSnapDetector.noteMouseDelta(mx, my);

        // Class B: watch the RAW stream itself, independent of orientation, so a
        // browser-side movementX/movementY spike is caught even though the
        // camera correctly follows it.
        const report = this.rawSpikeDetector.noteEvent(mx, my, {
          frameDeltaMs: this.lastFrameDeltaMs,
          isLocked: this.cameraController.getIsLocked(),
          mouseLookEnabled: this.cameraController.mouseLookEnabled,
          gameState: String(this.stateMachine.getState())
        });
        if (report) {
          movementDiagnostics.record('RAW_MOUSE_SPIKE', report.reason, 'CameraController mousemove (raw input)', {
            movementX: report.sample.movementX,
            movementY: report.sample.movementY,
            magnitude: report.sample.magnitude,
            medianMagnitude: report.medianMagnitude,
            mad: report.mad,
            ratio: report.ratio,
            windowSize: report.windowSize,
            eventsThisFrame: report.sample.eventsThisFrame,
            timeSincePrevEventMs: report.sample.sincePrevEventMs,
            frameDeltaMs: report.sample.frameDeltaMs,
            pointerLocked: report.sample.isLocked,
            mouseLookEnabled: report.sample.mouseLookEnabled,
            gameState: report.sample.gameState
          });
          this.lastRawSpikeEvent = movementDiagnostics.getLastEvent();
        }
      };

      this.cameraController.onOrientationFrame = (f) => {
        // FRAME-SCOPED check only: quaternion vs authoritative yaw/pitch.
        // (Expected-vs-actual input attribution is event-local, below.)
        const diagnosis = this.viewSnapDetector.checkQuaternion({
          yaw: f.yawAfter,
          pitch: f.pitchAfter,
          quatYaw: f.quatYawAfter,
          quatPitch: f.quatPitchAfter
        });

        this.viewSnapDetector.recordFrame({
          yawBefore: f.yawBefore,
          yawAfter: f.yawAfter,
          pitchBefore: f.pitchBefore,
          pitchAfter: f.pitchAfter,
          rawX: this.viewSnapDetector.frameAccumulated.x,
          rawY: this.viewSnapDetector.frameAccumulated.y,
          eventCount: this.viewSnapDetector.frameAccumulated.count,
          expectedYawDelta: 0,
          expectedPitchDelta: 0,
          actualYawDelta: f.yawAfter - f.yawBefore,
          actualPitchDelta: f.pitchAfter - f.pitchBefore,
          sensitivity: this.cameraController.getSensitivity(),
          isLocked: f.isLocked,
          justLocked: f.justLocked,
          frameDeltaMs: this.lastFrameDeltaMs,
          playerPos: {
            x: this.playerController.position.x,
            y: this.playerController.position.y,
            z: this.playerController.position.z
          },
          displaySpeed: this.playerController.getSpeedUnits(),
          timestamp: Date.now()
        });
        this.viewSnapDetector.resetFrameAccumulator();

        if (diagnosis) {
          movementDiagnostics.record(
            'VIEW_SNAP',
            diagnosis,
            'CameraController.update (quaternion divergence)',
            {
              yaw: f.yawAfter,
              pitch: f.pitchAfter,
              quatYaw: f.quatYawAfter,
              quatPitch: f.quatPitchAfter,
              pointerLocked: f.isLocked,
              frameDeltaMs: this.lastFrameDeltaMs
            }
          );
          this.lastViewSnapEvent = movementDiagnostics.getLastEvent();
        }
      };

      // EVENT-LOCAL attribution: compares expected vs actual inside the same
      // applyMouseDelta call. This is the correct scope, because yaw/pitch are
      // mutated synchronously inside the DOM mouse event.
      this.cameraController.onMouseApplied = (e) => {
        const diagnosis = this.viewSnapDetector.checkEvent(e);
        if (diagnosis) {
          const wrap = (v: number) => (v * 180) / Math.PI;
          movementDiagnostics.record(
            'VIEW_SNAP',
            diagnosis,
            'CameraController.applyMouseDelta (event-local)',
            {
              movementX: e.movementX,
              movementY: e.movementY,
              yawBeforeDeg: wrap(e.yawBefore),
              yawAfterDeg: wrap(e.yawAfter),
              pitchBeforeDeg: wrap(e.pitchBefore),
              pitchAfterDeg: wrap(e.pitchAfter),
              expectedYawDeltaDeg: wrap(e.expectedYawDelta),
              actualYawDeltaDeg: wrap(e.yawAfter - e.yawBefore),
              pitchClamped: e.pitchClamped,
              pointerLocked: e.isLocked,
              justLocked: e.justLocked
            }
          );
          this.lastViewSnapEvent = movementDiagnostics.getLastEvent();
        }
      };

      // Intentional discards are reported as such, never as a view snap.
      this.cameraController.onMouseDiscarded = (e) => {
        movementDiagnostics.record(
          'INPUT_DISCARDED',
          e.reason,
          'CameraController mousemove (deliberate discard)',
          { movementX: e.movementX, movementY: e.movementY }
        );
      };
    }

    // ---- Pointer-granularity experiment (?pointerInputExperiment=1) ------
    // Observation only: never applies input. Reports whether large mousemove
    // deltas decompose into smaller coalesced pointer samples.
    if (MovementDiagnostics.isPointerInputExperimentRequested(
      typeof window !== 'undefined' ? window.location.search : ''
    )) {
      this.pointerProbeEnabled = true;
      this.cameraController.pointerProbeSink = (source, e) => {
        this.pointerProbe.observe(source, e, {
          isLocked: this.cameraController.getIsLocked(),
          gameState: String(this.stateMachine.getState())
        });
      };
    }

    this.cameraController.onUnlock = () => {
      this.pauseGame();
    };

    // Pointer lock became available only after the user gesture; complete the
    // deferred resume. A failure keeps the game paused (cursor stays free).
    this.cameraController.onLockChange = (locked) => {
      if (!this.awaitingResumeLock) return;
      if (locked) {
        this.awaitingResumeLock = false;
        this.finalizeResume();
      }
      // On failure: intentionally do nothing. The pause screen stays up, so it
      // is obvious that gameplay has not resumed and a further click retries.
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
          this.viewmodelController.triggerMicroJab();
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
      } else if (e.code === 'KeyC' && e.shiftKey && !e.repeat) {
        // Dev shortcut: toggle the protected gameplay-corridor visualization
        if (this.world.debugCorridorGroup) {
          const next = !this.world.debugCorridorGroup.visible;
          this.world.setCorridorDebugVisible(next);
          this.ui.hud.showToast(`CORRIDOR DEBUG: ${next ? 'ON' : 'OFF'}`, 1500);
        } else {
          this.world.buildCorridorDebug();
          this.world.setCorridorDebugVisible(true);
          this.ui.hud.showToast('CORRIDOR DEBUG: ON', 1500);
        }
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

      // NOTE: `frameDelta` is initialised by this very `tick` call, so it is in
      // its temporal dead zone inside this callback. The render-frame delta is
      // recorded after tick() returns, below.

      // Smoothed FPS for developer diagnostics (never used for gameplay).
      if (dt > 0) {
        const instFps = 1 / dt;
        this.smoothedFps = this.smoothedFps === 0
          ? instFps
          : this.smoothedFps + (instFps - this.smoothedFps) * 0.08;
      }

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
          const reason = this.pendingRestoreVerification.reason;
          const diag = this.pendingRestoreVerification.diag;
          this.pendingRestoreVerification = null;
          this.announceRestore(reason, wasSurf, false, diag);
        } else {
          // Failed or displaced on frame: re-force authoritative transform
          this.pendingRestoreVerification.attempts++;
          this.playerController.setPosition(this.pendingRestoreVerification.targetPos);
          this.playerController.setOrientation(this.pendingRestoreVerification.yaw);

          if (this.pendingRestoreVerification.attempts > 3) {
            this.playerController.isRestoring = false;
            this.isRestoringCheckpoint = false;
            const wasSurf = this.pendingRestoreVerification.wasSurf;
            const reason = this.pendingRestoreVerification.reason;
            const diag = this.pendingRestoreVerification.diag;
            this.pendingRestoreVerification = null;
            this.announceRestore(reason, wasSurf, true, diag);
          }
        }
      }

      if (this.stateMachine.is(GameState.PLAYING)) {
        if (!this.isFinished) {
          const tickStartTime = this.runElapsedTime;
          this.playerController.updateFixed(dt);

          // Authoritative Finish Gate check: continuous swept crossing per 120Hz tick
          let crossedFinishThisTick = false;
          if (this.currentTrack) {
            const finish = this.currentTrack.finish;
            const finishNode = this.currentTrack.route.find(node => node.id === finish.routeNodeId);
            if (finishNode) {
              const crossing = this.finishGateDetector.sampleDetailed(
                this.playerController.position,
                {
                  position: finish.position,
                  yaw: finish.yaw,
                  width: finishNode.dimensions.x,
                  height: FINISH_GATE_HEIGHT
                },
                this.playerController.config.playerHeight,
                this.playerController.config.playerRadius
              );

              if (crossing && crossing.hit) {
                crossedFinishThisTick = true;
                const t = Math.max(0, Math.min(1, crossing.t));
                this.runElapsedTime = tickStartTime + t * dt;

                // Terminal replay frame at the exact sub-tick finish timestamp & contact position
                this.replayRecorder.record(
                  this.runElapsedTime,
                  t * dt,
                  crossing.contactPosition,
                  this.cameraController.yaw,
                  this.cameraController.pitch,
                  this.playerController.getSpeedUnits()
                );

                this.handleFinishSequence();
              }
            }
          }

          if (!crossedFinishThisTick) {
            this.runElapsedTime += dt;
            this.replayRecorder.record(
              this.runElapsedTime,
              dt,
              this.playerController.position,
              this.cameraController.yaw,
              this.cameraController.pitch,
              this.playerController.getSpeedUnits()
            );
          }
        } else {
          this.playerController.updateFixed(dt);
        }
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

      // Forward the SAME authoritative music state the world uses to the viewmodel.
      // (calmed in overtime so the hands do not keep pulsing after the run)
      const vmState = this.world.visualController.state;
      const reactiveEnergy = this.isOvertime ? 0 : vmState.energy;
      const reactiveTransient = this.isOvertime ? 0 : vmState.onsetPulse;
      const reactiveBass = this.isOvertime ? 0 : vmState.bass;

      this.viewmodelController.setAudioLevels(
        reactiveEnergy,
        reactiveTransient,
        reactiveBass
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
      this.devOverlay.update(this.playerController, this.world, this.audioEngine, this.environment, this.smoothedFps);

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
              // NOTE: the void boundary is intentionally NOT re-derived from the
              // checkpoint. It is a world constant (final geometry - margin), so
              // an elevated checkpoint can never raise the death plane above the
              // route below it.
              const split = this.ghostManager.onPlayerReachCheckpoint(i, this.runElapsedTime);
              if (split) {
                this.ui.hud.showSplit(split);
              } else {
                this.ui.hud.showToast(`CHECKPOINT ${i + 1} REACHED`, 2000);
              }
            }
          }
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
      this.devOverlay.update(this.playerController, this.world, this.audioEngine, this.environment, this.smoothedFps);
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

    // Render-frame delta for diagnostics context (safe here: tick() has returned).
    this.lastFrameDeltaMs = frameDelta * 1000;

    this.environment.update(frameDelta);

    // ---- Movement diagnostics (opt-in via ?debugMovement=1) --------------
    if (movementDiagnostics.isEnabled) {
      // Aggregate per-frame raw input check (batching / coalescing anomalies).
      const degPerPixel = (0.0022 * this.cameraController.getSensitivity()) * (180 / Math.PI);
      const frameSpike = this.rawSpikeDetector.endFrame(degPerPixel);
      if (frameSpike) {
        movementDiagnostics.record('RAW_MOUSE_SPIKE', frameSpike.reason, 'Game.gameLoop (per-frame raw input)', {
          movementX: frameSpike.sample.sumXThisFrame,
          movementY: frameSpike.sample.sumYThisFrame,
          sumMagnitude: Math.hypot(frameSpike.sample.sumXThisFrame, frameSpike.sample.sumYThisFrame),
          eventsThisFrame: frameSpike.sample.eventsThisFrame,
          maxAbsX: frameSpike.sample.maxAbsXThisFrame,
          maxAbsY: frameSpike.sample.maxAbsYThisFrame,
          impliedDegrees: Math.hypot(frameSpike.sample.sumXThisFrame, frameSpike.sample.sumYThisFrame) * degPerPixel,
          medianMagnitude: frameSpike.medianMagnitude,
          ratio: frameSpike.ratio,
          frameDeltaMs: this.lastFrameDeltaMs,
          pointerLocked: frameSpike.sample.isLocked,
          mouseLookEnabled: frameSpike.sample.mouseLookEnabled,
          gameState: frameSpike.sample.gameState
        });
        this.lastRawSpikeEvent = movementDiagnostics.getLastEvent();
      }

      this.checkCameraTranslationDiagnostics();
      const vmCam = this.environment.camera;
      const s = this.viewSnapDetector.lastSample;
      const rad2deg = 180 / Math.PI;
      movementDiagnostics.update({
        buildLabel: BUILD_LABEL,
        speedUnits: this.playerController.getSpeedUnits(),
        player: {
          x: this.playerController.position.x,
          y: this.playerController.position.y,
          z: this.playerController.position.z
        },
        yawDeg: (this.cameraController.yaw * 180) / Math.PI,
        pitchDeg: (this.cameraController.pitch * 180) / Math.PI,
        fov: vmCam.fov,
        frameDeltaMs: this.lastFrameDeltaMs,
        voidDeathY: this.playerController.authoritativeKillY,
        lastEvent: movementDiagnostics.getLastEvent(),
        orientation: s
          ? {
              rawX: s.rawX,
              rawY: s.rawY,
              mouseEvents: s.eventCount,
              yawBeforeDeg: s.yawBefore * rad2deg,
              yawAfterDeg: s.yawAfter * rad2deg,
              pitchBeforeDeg: s.pitchBefore * rad2deg,
              pitchAfterDeg: s.pitchAfter * rad2deg,
              expectedYawDeg: s.expectedYawDelta * rad2deg,
              expectedPitchDeg: s.expectedPitchDelta * rad2deg,
              actualYawDeg: s.actualYawDelta * rad2deg,
              actualPitchDeg: s.actualPitchDelta * rad2deg,
              isLocked: s.isLocked,
              justLocked: s.justLocked,
              mouseHandlers: this.mouseHandlerCount,
              rawInputActive: this.cameraController.rawInputActive
            }
          : undefined,
        lastViewSnap: this.lastViewSnapEvent,
        lastRawSpike: this.lastRawSpikeEvent,
        rawInput: {
          requestedMode: this.cameraController.rawInputSession.requestedMode,
          resolvedMode: this.cameraController.rawInputSession.resolvedMode,
          fallbackCount: this.cameraController.rawInputSession.fallbackCount,
          lastError: this.cameraController.rawInputSession.lastError,
          active: this.cameraController.rawInputActive
        },
        pointerProbe: {
          enabled: this.pointerProbeEnabled,
          rawUpdateCount: this.pointerProbe.counts.rawUpdate,
          pointerMoveCount: this.pointerProbe.counts.pointerMove,
          multiConstituentCount: this.pointerProbe.counts.multiConstituent,
          maxConstituentCount: this.pointerProbe.counts.maxConstituentCount,
          largestParentMagnitude: this.pointerProbe.counts.largestParentMagnitude,
          largestConstituentMagnitude: this.pointerProbe.counts.largestConstituentMagnitude,
          sumMismatches: this.pointerProbe.counts.sumMismatches,
          largestParentBreakdown: this.describeLargestParentEvent()
        },
        inputSource: {
          active: this.cameraController.inputSource,
          rawSupported: this.cameraController.pointerRawUpdateSupported,
          coalescedSupported: this.cameraController.coalescedSupported,
          rawEvents: this.cameraController.inputCounters.rawEvents,
          parentEvents: this.cameraController.inputCounters.parentEvents,
          appliedSamples: this.cameraController.inputCounters.appliedSamples,
          duplicateDrops: this.cameraController.inputCounters.duplicateDrops,
          largestAppliedSample: this.cameraController.inputCounters.largestAppliedSample,
          maxConstituents: this.cameraController.inputCounters.maxConstituents
        }
      });
    }

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
