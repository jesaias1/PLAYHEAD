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
import type { RunRank, RunResults } from '../player/PlayerStats';
import { ReplayRecorder } from '../replay/ReplayRecorder';
import { ReplayPlayer } from '../replay/ReplayPlayer';
import { GhostManager } from '../replay/GhostManager';
import { PresetLevelCache } from '../audio/PresetLevelCache';
import { onlineBootstrap } from '../online/OnlineBootstrap';
import {
  raceRoomService,
  RaceRoomService,
  RaceResultRow
} from '../online/RaceRoomService';
import { leaderboardService } from '../online/LeaderboardService';
import type { RunSubmission } from '../online/LeaderboardService';
import { authService } from '../online/AuthService';
import { validateDisplayName } from '../online/AuthService';
import { computeMapIdentity } from '../online/MapIdentity';
import type { MapIdentity } from '../online/MapIdentity';
import { OFFICIAL_MAP_REGISTRY } from '../online/OfficialMapRegistry';
import {
  RemoteGhostRenderer,
  GUEST_SIGNAL_COLOR,
  HOST_SIGNAL_COLOR
} from '../online/RemoteGhostRenderer';
import { formatRaceTime } from '../ui/RaceHud';
import { PovReplayRecorder } from '../replay/pov/PovReplayRecorder';
import { PovReplayPlayer } from '../replay/pov/PovReplayPlayer';
import { PovReplay, PovReplayEventType, PovReplayIdentity, POV_REPLAY_VERSION, encodePovReplay, decodePovReplay } from '../replay/pov/PovReplayFormat';
import { GhostRaceController } from '../replay/GhostRaceController';
import {
  GhostFinishComparison,
  GhostRaceRun,
  buildGhostRaceRun,
  worldGhostLabel
} from '../replay/GhostRaceSource';
import { replayStorageService } from '../online/ReplayStorageService';
import { SignalPackCatalog } from '../audio/SignalPackCatalog';
import { UIManager } from '../ui/UIManager';
import { DevOverlay } from '../ui/DevOverlay';
import { calculateLookYaw } from '../utils/math';
import { MovementLab } from '../lab/MovementLab';
import { StrafeVisualizer } from '../player/StrafeVisualizer';
import { SurfVisuals } from '../world/SurfVisuals';
import { MusicPack, TrackCatalogEntry } from '../audio/MusicPack';
import { ViewmodelController } from '../viewmodel/ViewmodelController';
import { ViewmodelCalibrator } from '../viewmodel/ViewmodelCalibrator';
import { KarambitSkinSystem } from '../viewmodel/KarambitSkinSystem';
import { PaletteSelector } from '../audio/TrackPalettes';
import { RestoreReason } from '../player/RestorePolicy';
import { movementDiagnostics, ViewSnapDetector, MovementDiagEvent, MovementDiagnostics, RawMouseSpikeDetector } from './MovementDiagnostics';
import { PointerInputProbe } from './PointerInputProbe';
import { BUILD_LABEL } from './BuildInfo';
import { LeaderboardManager } from '../leaderboard/LeaderboardManager';
import type { LeaderboardSubmissionCandidate } from '../leaderboard/LeaderboardManager';
import type { SubmissionState, SubmissionFeedback } from '../leaderboard/SubmissionFeedback';
import {
  MasteryGloveId,
  MasteryProgressDelta,
  masteryProgressDeltas,
  newlySatisfiedGloves
} from '../mastery/MasteryLadder';
import { masteryGloveSystem } from '../mastery/MasteryGloveSystem';
import { getMasteryGlove } from '../mastery/MasteryLadder';
import { playerProfileService } from '../online/PlayerProfileService';
import { CustomAudioRewardService } from '../audio/CustomAudioRewardService';
import { FINISH_GATE_HEIGHT, FinishGateDetector } from '../gameplay/FinishGateDetector';
import { MovementFeedbackController } from '../feedback/MovementFeedbackController';
import { GateDiagnosticState, RaceGhostDiagnosticState } from '../ui/DevOverlay';
import { MovementSfx } from '../audio/MovementSfx';

/**
 * Player-facing outcome of an official run's world submission.
 *
 * The states and copy live in `leaderboard/SubmissionFeedback` so the results
 * screen can render them without importing the game loop.
 */
export type { SubmissionState, SubmissionFeedback };

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

  /**
   * True when the loaded official track came from a CANONICAL baked preset.
   *
   * Official competitive maps must never be produced by runtime audio analysis:
   * decoding and FFT are float pipelines that can differ between browsers, which
   * would give two players different maps for the same song. If the preset is
   * missing we still let the player play (offline-first), but the run is marked
   * non-canonical and can never be submitted to a public leaderboard.
   */
  public currentTrackCanonical = false;

  // ==========================================================================
  // ONLINE / FRIEND SESSION STATE (presentation + orchestration only)
  //
  // The local 120 Hz simulation stays authoritative for this client's run.
  // Supabase handles presence, lobby, countdown, ghost presentation and results
  // communication — never movement, collision or finish detection.
  // ==========================================================================

  /** Translucent remote signal ghost (presentation only, no collision). */
  private raceGhost: RemoteGhostRenderer | null = null;
  /**
   * RECORDED ghost race (solo). A completely separate lifecycle from the live
   * friend-race ghost above: a live multiplayer session never loads a recorded
   * ghost, and a recorded ghost is never driven by network samples.
   */
  public ghostRace: GhostRaceController;
  /** Validated ghost armed for the NEXT run start. */
  private pendingGhostRun: GhostRaceRun | null = null;
  /** Comparison captured at finish, for the results screen. */
  private lastGhostComparison: GhostFinishComparison | null = null;
  /**
   * Public identity for the players currently in a lobby / results screen.
   * Text metadata only — never a knife texture, glove asset or video.
   */
  private raceIdentities = new Map<string, { gloveName: string; knifeName: string }>();
  /** Result of the most recent official submission attempt, for the results UI. */
  private lastSubmissionState: SubmissionFeedback | null = null;
  /**
   * Upload promise from the run that just finished, so the submission can carry
   * the replay metadata. Reset at the start of every recording.
   */
  private pendingReplayUpload: Promise<{ ok: boolean; path?: string; hash?: string } | null> | null =
    null;
  private raceActive = false;
  /**
   * FRIEND RACE WORLD MODE — the authoritative switch for ghost presentation.
   *
   * True from the moment the race map starts loading until the session ends or
   * the player leaves the room. While it is true:
   *   - every SOLO ghost (PB, BEST RECORDED, WORLD, ECHO) is disabled
   *   - the ONLY gameplay-world ghost is the remote human opponent
   *   - the local player publishes live transforms continuously, including
   *     before the shared timer starts
   */
  private friendRaceWorld = false;
  /** Shared session start, as an epoch ms timestamp agreed by all clients. */
  private raceStartAtMs: number | null = null;
  private raceFinishReported = false;
  private raceCurrentRunAccumulator = 0;
  /**
   * Reusable local presentation transform. Mutated every frame and handed to the
   * broadcast scheduler, so the hot path performs no allocation.
   */
  private localTransformScratch = {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    running: true
  };
  private raceLastRivalBestUs: number | null = null;
  private raceLastLocalBestUs: number | null = null;
  /** Invite code captured from ?room= before the player reaches the menu. */
  private pendingInviteCode: string | null = null;
  private onlineInitialized = false;

  // ==========================================================================
  // POV REPLAY V1 state.
  //
  // The recorder stores a compact 30 Hz sample stream; the player reconstructs
  // the camera from recorded samples only (no re-simulation, so no drift).
  // ==========================================================================
  private povRecorder = new PovReplayRecorder();
  public povPlayer = new PovReplayPlayer();
  /** 'NONE' | 'POV' (player-facing) | 'LEGACY' (DEV-only box/chase replay). */
  private replayMode: 'NONE' | 'POV' | 'LEGACY' = 'NONE';
  private lastFinalizedReplay: PovReplay | null = null;
  public ui: UIManager;
  public devOverlay: DevOverlay;

  /** Presentation-only movement feedback (never affects gameplay). */
  public movementFeedback!: MovementFeedbackController;
  private movementSfx = MovementSfx.getInstance();

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
    // Recorded ghost racing is a separate lifecycle from the live friend ghost.
    this.ghostRace = new GhostRaceController(this.environment.scene);

    // 5. UI Manager
    this.ui = new UIManager(uiRoot);

    // 6. Dev Diagnostics Overlay
    this.devOverlay = new DevOverlay();

    // 6b. Online (Supabase) bootstrap — fire-and-forget.
    //
    // Deliberately non-blocking and failure-tolerant: if Supabase is not
    // configured or unreachable, PLAYHEAD launches and plays exactly as before
    // with local progression. Nothing here can delay or break the game.
    onlineBootstrap.start();

    // 6c. ONLINE UI wiring (leaderboards + friend best-time sessions).
    this.initOnline();

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
      'mouseSensitivity', 'fov', 'masterVolume', 'ghostMode', 'effectIntensity'
    ]));
    settingsManager.subscribe((settings, changedKeys) => {
      this.applyLiveSettings(settings, changedKeys);
    });

    // Animated cosmetics follow the resolved quality tier: weaker tiers decode a
    // smaller encode, which cuts GPU upload traffic several-fold. Presentation
    // only — it cannot touch the frozen knife socket or any movement behaviour.
    this.environment.onQualityResolved = (preset) => {
      KarambitSkinSystem.getInstance().setVideoQuality(preset.cosmeticVideoScale);
    };
    KarambitSkinSystem.getInstance().setVideoQuality(this.environment.activePreset.cosmeticVideoScale);

    // MASTERY: recognise historical achievements once, compactly. A returning
    // player who already qualifies gets the gloves WITHOUT repeating anything.
    const masterySync = masteryGloveSystem.reconcile();
    if (masterySync.newlyRecognized.length > 0) {
      console.info(
        `[MASTERY] ${masterySync.newlyRecognized.length} achievement(s) recognized: ${masterySync.newlyRecognized.join(', ')}`
      );
    }

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
      (track) => this.handleCatalogTrackSelected(track),
      (trackId) => {
        // RACE PB GHOST: retrieve + validate + enter the level. Failures surface
        // in the restrained showcase state instead of a fake action.
        void this.racePbGhost(trackId).then((r) => {
          if (!r.ok) {
            this.ui.importScreen.setPbGhostAvailability({ available: false });
            console.warn('[GHOST]', r.detail);
          }
        });
      }
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
      onReplay: () => {
        // Player-facing replay is TRUE FIRST-PERSON POV of the run just played.
        void this.watchLocalReplay().then((r) => {
          if (!r.ok) console.warn('[REPLAY]', r.detail);
        });
      },
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

    // Movement feedback (PRESENTATION ONLY). Detection/classification lives in
    // MovementFeedbackController; this wiring decides how each moment is shown.
    this.movementFeedback = new MovementFeedbackController({
      nearMiss: (intensity, side) => {
        this.movementSfx.playNearMiss(intensity, side);
        this.viewmodelController.triggerMovementAccent('NEAR_MISS', intensity);
      },
      landing: (intensity, major) => {
        this.movementSfx.playLanding(intensity, major);
        this.viewmodelController.triggerMovementAccent(major ? 'HARD_LANDING' : 'LANDING', intensity);
        this.world.pulseSignal(major ? 0.4 * intensity : 0.14 * intensity);
      },
      surfLock: (quality) => {
        this.movementSfx.playSurfLock(quality);
        this.viewmodelController.triggerMovementAccent('SURF_LOCK', quality);
        this.world.pulseSignal(0.32 * quality);
        this.ui.hud.showToast('SIGNAL LOCK // CLEAN SURF', 1200);
      },
      finish: () => {
        this.movementSfx.playFinishImpact();
        this.viewmodelController.triggerMovementAccent('FINISH', 1);
        this.world.pulseSignal(0.9);
      }
    });
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
    if (changedKeys.has('effectIntensity')) {
      // Presentation only: scales decorative / audio-reactive emissive and the
      // rival ghost. Cannot reach geometry, collision, timing or scoring.
      this.environment.setEffectIntensity(settings.effectIntensity || 'STANDARD');
      this.raceGhost?.setEffectScale(this.environment.effectProfile.additiveScale);
      this.ghostRace.setEffectScale(this.environment.effectProfile.additiveScale);
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

      // The wind / speed layer only belongs to active play or the Lab.
      if (newState !== GameState.PLAYING && newState !== GameState.MOVEMENT_LAB) {
        this.movementSfx.setWindLevel(0);
      }

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
            this.wireSignalGatePresentation();
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
          // FRIEND RACE: the world is live again. Republish immediately so the
          // opponent reappears on the start platform at once, rather than after
          // the countdown samples have aged out.
          this.publishLocalGhostSample();
          if (prevState === GameState.PAUSED && !this.isQuickRestarting) {
            this.audioEngine.resume();
          } else if (!this.isQuickRestarting) {
            this.isFinished = false;
            this.audioEngine.play(this.currentCheckpoint ? this.currentCheckpoint.time : 0);
            this.replayRecorder.start();
            this.startPovRecording();
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
          this.finishPovRecording();
          // Capture the recorded-ghost comparison BEFORE anything can clear the
          // ghost. The active ghost is never mutated mid-run: a new PB only
          // becomes the next run's ghost.
          this.lastGhostComparison = this.ghostRace.finishComparison(
            Math.round(this.runElapsedTime * 1_000_000)
          );
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
            let masteryProgress: MasteryProgressDelta[] = [];
            let newlyEarnedGloves: MasteryGloveId[] = [];

            if (this.currentOfficialTrackId) {
              const trackName = this.currentAnalysis.filename || 'PLAYHEAD TRACK';
              const progressionKey = this.currentOfficialTrackId;
              // MASTERY: capture authoritative progress before and after the run
              // so the results screen can report only progress that ACTUALLY
              // changed, and the Armory can recognise a newly earned glove.
              //
              // Eligibility is derived from the same canonical records the drop
              // economy already uses. Custom Audio and the Movement Lab never set
              // currentOfficialTrackId, so they can never satisfy a requirement.
              const masteryBefore = masteryGloveSystem.evaluate();
              if (results.rank !== 'UNRANKED') {
                const completionReward = KarambitSkinSystem.getInstance().recordTrackCompletion(
                  progressionKey,
                  results.rank,
                  this.currentOfficialTrackId
                );
                dropsAwarded = completionReward.dropsAwarded;
                bestDropRank = completionReward.awardedDropRanks[0];
              }
              const masteryAfter = masteryGloveSystem.evaluate();
              masteryProgress = masteryProgressDeltas(masteryBefore.summary, masteryAfter.summary);
              newlyEarnedGloves = newlySatisfiedGloves(masteryBefore, masteryAfter);
              if (newlyEarnedGloves.length > 0) {
                // Recognise them so the Armory shows them without a reveal burst.
                masteryGloveSystem.reconcile();
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
              customRewardInfo,
              this.lastGhostComparison
                ? {
                    label: this.lastGhostComparison.label,
                    ghostTimeUs: this.lastGhostComparison.ghostTimeUs,
                    deltaUs: this.lastGhostComparison.deltaUs
                  }
                : undefined,
              this.lastSubmissionState ?? { state: 'NOT_OFFICIAL' },
              masteryProgress.length > 0 || newlyEarnedGloves.length > 0
                ? { progress: masteryProgress, gloves: newlyEarnedGloves }
                : undefined
            );

            // WORLD SUBMISSION: runs independently of the results screen so the
            // player is never blocked, and reports the REAL outcome as it lands.
            this.lastSubmissionState = { state: 'SUBMITTING' };
            if (this.currentOfficialTrackId) {
              void this.submitOfficialRun(results, officialInfo?.candidate);
            } else {
              this.lastSubmissionState = { state: 'NOT_OFFICIAL' };
            }
          }
          break;

        case GameState.REPLAY:
          this.ui.hideAllScreens();
          this.cameraController.unlock();
          if (this.replayMode === 'POV') {
            // First-person replay: audio is seeked to the recorded song time by
            // updatePovReplay, so it must not be restarted from 0 here.
            this.audioEngine.play(this.povPlayer.getStartSongTimeMs() / 1000);
            this.povPlayer.play();
            this.ui.replayOverlay.setCallbacks({
              onTogglePause: () => {
                if (this.povPlayer.isPaused) this.povPlayer.resume();
                else this.povPlayer.pause();
              },
              onRestart: () => this.povPlayer.restart(),
              onExit: () => this.exitPovReplay()
            });
            this.ui.replayOverlay.setTitle('WORLD // WATCH RUN');
            this.ui.replayOverlay.show();
          } else {
            // DEV ONLY legacy path.
            this.audioEngine.play(0);
            this.replayPlayer.start(this.replayRecorder);
            this.ui.replayOverlay.setTitle('DEV // LEGACY REPLAY');
            this.ui.replayOverlay.show();
          }
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

  private async handleCatalogTrackSelected(
    trackEntry: TrackCatalogEntry,
    ghostRun: GhostRaceRun | null = null
  ): Promise<void> {
    // A plain track entry clears any armed ghost. Only an explicit ghost-race
    // entry arms one.
    this.pendingGhostRun = ghostRun;
    this.lastGhostComparison = null;
    this.ghostRace.clear();
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
        this.currentAnalysis = precomputed.analysis;
        this.ui.analysisScreen.setStage('[WORLD] SYNTHESIZING SPACE', 0.88);
        this.world.loadTrack(precomputed.analysis, precomputed.track, this.environment);
        if (precomputed.spectacleEvents) {
          this.world.songDirector.spectaclePlanner.events = precomputed.spectacleEvents;
        }
        this.world.songDirector.onSectionAnnouncement = (title) => {
          this.ui.hud.showSectionTitle(title);
        };

        this.ui.analysisScreen.setStage('[ROUTE] COURSE ONLINE', 0.97);
        this.ui.analysisScreen.displayAnalysis(precomputed.analysis);
        this.currentTrackCanonical = true;
        // The selected track is now current: refresh the restrained PB-ghost
        // action so it reflects whether a usable recorded replay exists.
        this.refreshPbGhostAvailability(trackEntry.id);
        this.stateMachine.transitionTo(GameState.READY);
        return;
      }

      // CANONICAL MAP GUARD.
      //
      // Reaching here for an OFFICIAL track means the baked preset was missing,
      // so the route would be generated from a runtime FFT analysis of the
      // decoded audio. That is not a canonical competitive map. We still let the
      // run happen (offline-first), but it is explicitly marked non-canonical so
      // it can never be submitted to a public leaderboard.
      this.currentTrackCanonical = false;
      console.warn(
        `[ONLINE] Canonical preset missing for official track "${trackEntry.id}". ` +
        'Falling back to runtime analysis: this run is NOT eligible for public ' +
        'leaderboard submission. Run `npm run precompute-presets` to restore the ' +
        'canonical map.'
      );

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
    this.movementFeedback.reset();
    this.movementSfx.reset();
    this.runElapsedTime = 0;
    this.isOvertime = false;
    this.ui.hud.setOvertimeStatus(false);

    // A full restart abandons the current attempt and starts a fresh personal
    // run. In a friend session this reports a new attempt; it never resets the
    // shared session clock.
    this.onRaceAttemptRestart();

    // Prepare ghosts for track
    this.ghostManager.prepareTrack(this.currentTrack, this.currentAnalysis?.filename || 'PLAYHEAD TRACK');
    this.ghostManager.start();

    // RECORDED GHOST RACE: arm the validated ghost for this run and reset it to
    // t=0. A full restart (hold-R) lands here, so the ghost returns to its start
    // alongside the player. Tap-R checkpoint restore does NOT land here and must
    // not rewind the ghost — the run timer keeps running, so the ghost keeps its
    // pace.
    this.armPendingGhostRun();

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
    // FRIEND RACE: publish the spawn transform immediately. A hold-R restart
    // lands here, so the opponent sees the reset on the start platform at once
    // instead of waiting for the next 12 Hz tick.
    this.publishLocalGhostSample();
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

  private gateDiagnostics(): GateDiagnosticState | undefined {
    const gates = this.movementLab?.signalGates;
    if (!gates) return undefined;
    const last = gates.sequence.lastResult;
    return {
      sequenceId: gates.id,
      progress: gates.sequence.passedCount,
      total: gates.sequence.gates.length,
      complete: gates.sequence.complete,
      incomplete: gates.sequence.incomplete,
      lastSpeedUnits: last ? last.result.speedUnits : 0,
      lastCenterError: last ? last.result.centerError : 0,
      lastAlignment: last ? last.result.alignment : 0
    };
  }

  /**
   * Wires Signal Gate presentation (audio / viewmodel / HUD). Detection and
   * state live in the gate system; this only decides how a crossing looks.
   * Passing or missing a gate never changes gameplay.
   */
  private wireSignalGatePresentation(): void {
    const gates = this.movementLab?.signalGates;
    if (!gates) return;
    gates.sinks = {
      crossing: (gateIndex, total, result) => {
        const quality = Math.max(0, Math.min(1, 0.5 * result.alignment + 0.5 * (1 - result.centerError)));
        this.movementSfx.playGateLock(quality);
        this.viewmodelController.triggerMovementAccent('SURF_LOCK', 0.6 + quality * 0.4);
        this.ui.hud.showToast(`SIGNAL LOCK  ${gateIndex + 1} / ${total}`, 900);
      },
      complete: (total) => {
        this.movementSfx.playGateComplete();
        this.viewmodelController.triggerMovementAccent('FINISH', 0.8);
        this.ui.hud.showToast('PERFECT LINE', 1600);
        this.world.pulseSignal(0.35);
        void total;
      }
    };
  }

  private handleFinishSequence(): void {
    if (this.isFinished) return;
    // The authoritative timer was already frozen at the exact sub-tick contact
    // timestamp before this runs. Nothing in this presentation sequence writes
    // runElapsedTime, so completion time is unchanged.
    this.isFinished = true;
    this.playerController.resetKeys();

    // Friend session: record this attempt's completion as a session best if it
    // is faster. Uses the frozen authoritative microsecond value.
    this.onRaceFinish();

    // 0 ms: instant confirmation (signal impact + viewmodel accent + world pulse).
    this.movementFeedback.notifyFinish();
    this.movementSfx.reset();

    // ~100-300 ms: music ducks into a short tail.
    this.audioEngine.fadeOutAndStop(0.45);

    // ~520 ms: Run Report transition begins. Deliberately short.
    window.setTimeout(() => {
      this.stateMachine.transitionTo(GameState.FINISHED);
    }, 520);
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
        this.movementFeedback.reset();
        this.movementSfx.reset();
        this.movementLab?.signalGates?.reset();
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
      this.movementFeedback.reset();
      this.movementSfx.reset();
      this.movementLab?.signalGates?.reset();
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
    // Leaving the world ALWAYS ends friend-race ghost mode, so a race can never
    // leak "solo ghosts disabled" into the next solo Signal.
    this.setFriendRaceWorld(false);
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

    // Per-frame render statistics accumulate across every composer pass.
    this.environment.resetFrameStats();

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
            // POV replay sample (30 Hz internally; allocation-free).
            this.recordPovFrame(dt);
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

      // Movement feedback runs on the SAME fixed tick as movement so landings,
      // surf transitions and near misses are classified against authoritative
      // state. Presentation only.
      if (
        this.stateMachine.is(GameState.PLAYING) ||
        this.stateMachine.is(GameState.MOVEMENT_LAB)
      ) {
        if (!this.isFinished) {
          this.movementFeedback.update(dt, this.playerController, this.world.physics);
          this.playerController.cameraPresentationOffsetY = this.movementFeedback.state.cameraOffsetY;
          this.playerController.syncCamera();
        }
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

      // Friend session: HUD, ghost presentation and throttled network reporting.
      // Presentation only — the local 120 Hz simulation above stays authoritative.
      this.updateRace(frameDelta);
      this.updateRaceGhost(frameDelta);

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

      // Recorded ghost race: driven by the AUTHORITATIVE run timer, never a wall
      // clock. Presentation only.
      this.ghostRace.update(this.runElapsedTime, this.playerController.position);

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

      // Restrained speed sensation: peripheral streaks + air layer. The centre
      // of the screen stays clean, and reduce-motion disables the streaks.
      const speedFeel = this.movementFeedback.state.speedIntensity;
      this.environment.setSpeedStreak(speedFeel * 0.42, settings.reduceMotion);
      this.movementSfx.setWindLevel(speedFeel * 0.55);

      // Dev Diagnostics update
      this.devOverlay.update(this.playerController, this.world, this.audioEngine, this.environment, this.smoothedFps, this.movementFeedback.state, this.gateDiagnostics(), this.raceGhostDiagnostics());

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
              // A recorded ghost race takes precedence for the split display: it
              // is the pace actually being chased, and it uses the same
              // authoritative run timer.
              const ghostSplit = this.ghostRace.onPlayerCheckpoint(i, this.runElapsedTime);
              if (ghostSplit) {
                this.ui.hud.showSplit({
                  checkpointIndex: ghostSplit.checkpointIndex,
                  deltaSeconds: ghostSplit.deltaSeconds,
                  target: 'GHOST',
                  isAhead: ghostSplit.isAhead,
                  label: ghostSplit.label
                });
              } else if (split) {
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
        const gateMusic = this.world.visualController.state;
        this.movementLab.update(frameDelta, {
          energy: gateMusic.energy,
          bass: gateMusic.bass,
          onsetPulse: gateMusic.onsetPulse,
          reactivityMultiplier: gateMusic.reactivityMultiplier
        });
        this.movementLab.setFeedbackEvent(this.movementFeedback.state.lastEvent);
      }
      this.surfVisuals.update(
        this.playerController,
        this.world.visualController.state,
        frameDelta
      );
      // Same restrained speed sensation as a real run, so it can be tested.
      const labSpeedFeel = this.movementFeedback.state.speedIntensity;
      const labReduceMotion = SettingsManager.getInstance().settings.reduceMotion;
      this.environment.setSpeedStreak(labSpeedFeel * 0.42, labReduceMotion);
      this.movementSfx.setWindLevel(labSpeedFeel * 0.55);
      this.devOverlay.update(this.playerController, this.world, this.audioEngine, this.environment, this.smoothedFps, this.movementFeedback.state, this.gateDiagnostics(), this.raceGhostDiagnostics());
    } else if (this.stateMachine.is(GameState.REPLAY)) {
      if (this.replayMode === 'POV') {
        // True first-person replay: the camera, audio and music-reactive world
        // are all reconstructed from the recorded samples.
        this.updatePovReplay(frameDelta);
      } else {
        // DEV ONLY: legacy box/chase replay, never the player-facing experience.
        this.updateLegacyReplay(frameDelta);
      }
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

  // ==========================================================================
  // ONLINE — UI wiring, friend session lifecycle, ghost presentation
  //
  // Everything below is orchestration + presentation. It never touches
  // movement, collision, surf physics, checkpoints or finish detection.
  // ==========================================================================

  private initOnline(): void {
    if (this.onlineInitialized) return;
    this.onlineInitialized = true;

    // Remote ghost: a translucent signal body in the existing scene.
    this.raceGhost = new RemoteGhostRenderer(this.environment.scene);
    this.raceGhost.setEffectScale(this.environment.effectProfile.additiveScale);

    // DEV-only remote-opponent probes (F3). They bypass the ghost visual to
    // separate "wrong transform/scene" from "wrong rendering".
    this.devOverlay.onRaceProbeChange = (state) => {
      this.raceGhost?.setDebugMarker(state.marker);
      this.raceGhost?.setDebugOffset(state.offset);
      this.raceGhost?.setForceVisible(state.force);
    };

    const racePanel = this.ui.importScreen.racePanel;
    const leaderboardPanel = this.ui.importScreen.leaderboardPanel;

    racePanel.setCallbacks({
      onCreateRoom: (trackId) => void this.createRaceRoom(trackId),
      onJoinRoom: (code) => void this.joinRaceRoom(code),
      onSetReady: (ready) => {
        void raceRoomService.setReady(ready).then((result) => {
          // The lobby reflects the SERVER's answer, and reports a real failure.
          this.ui.importScreen.racePanel.setReadyResult(result.ok, result.detail);
          if (!result.ok) console.warn('[RACE] ready update failed:', result.detail);
        });
      },
      onStartSession: () => void this.startRaceSession(),
      onLeaveRoom: () => void this.leaveRaceRoom(),
      onOpenProfile: (userId, displayName) => void this.openPlayerProfile(userId, displayName)
    });

    leaderboardPanel.setCallbacks({
      onSelectTrack: (trackId) => void this.refreshLeaderboard(trackId),
      onPlaySignal: (trackId) => void this.loadPresetTrack(trackId),
      onWatchRun: (runId) => void this.watchLeaderboardRun(runId),
      onRaceRun: (runId) => {
        // RACE GHOST is the only path that arms a recorded ghost. A failure is
        // reported, never silently ignored.
        void this.raceLeaderboardGhost(runId).then((r) => {
          if (!r.ok) {
            this.ui.importScreen.leaderboardPanel.setStatus(r.detail);
            console.warn('[GHOST]', r.detail);
          }
        });
      },
      onRetryConnection: () => {
        onlineBootstrap.retry();
        void this.refreshLeaderboard(leaderboardPanel.getSelectedTrack());
      },
      onOpenProfile: (userId, displayName) => void this.openPlayerProfile(userId, displayName)
    });

    this.ui.importScreen.onLeaderboardTabOpened = () => {
      this.refreshOnlineStatus();
      void this.refreshLeaderboard(leaderboardPanel.getSelectedTrack());
    };

    // Online status → the ONE global indicator in the menu footer.
    onlineBootstrap.subscribe((status) => {
      const tag = onlineBootstrap.getClient().getStatusLabel();
      const detail = `${status.state} // ${status.detail}`;
      this.ui.importScreen.setOnlineStatus(tag, detail);
      this.refreshLocalIdentity();
    });
    this.refreshOnlineStatus();
    this.refreshLocalIdentity();

    // Race room callbacks.
    raceRoomService.setCallbacks({
      onRoomUpdate: (room, players) => {
        const panelRef = this.ui.importScreen.racePanel;
        panelRef.setHost(raceRoomService.isHost());
        panelRef.renderLobby(room, players, raceRoomService.getInviteUrl() ?? '', authService.getUserId(), this.raceIdentities);
    // Identity is fetched lazily and only while a lobby is actually open.
    void this.refreshRaceIdentities();
        // A scheduled start drives the local countdown → session.
        if (room.state === 'COUNTDOWN' && room.startAtMs !== null && !this.raceActive) {
          this.beginRaceFromSchedule(room.startAtMs);
        }
      },
      onGhost: (sample) => this.raceGhost?.setSample(sample),
      onPlayerJoined: (player) => {
        this.ui.raceHud.showNotice(`${player.displayName} // JOINED`);
      },
      onPlayerLeft: () => {
        // Positive evidence: the opponent left the room. Remove the ghost at
        // once rather than waiting for the presence grace period.
        this.raceGhost?.markRemoteLeft();
        this.ui.raceHud.showNotice('PLAYER DISCONNECTED');
      },
      onFinished: (rows) => this.showRaceResults(rows),
      onError: (detail) => this.ui.importScreen.racePanel.showError(detail)
    });

    this.ui.importScreen.onRetryOnlineSync = () => onlineBootstrap.retry();

    // Invite URL: ?room=CODE opens 05 // RACE WITH FRIENDS and joins automatically.
    const invite = RaceRoomService.readInviteCodeFromUrl();    if (invite) {
      this.pendingInviteCode = invite;
      this.ui.importScreen.openRaceTab();
      void this.consumePendingInvite();
    }
  }

  private refreshOnlineStatus(): void {
    const status = onlineBootstrap.getStatus();
    const tag = onlineBootstrap.getClient().getStatusLabel();
    const detail = `${status.state} // ${status.detail}`;
    this.ui.importScreen.setOnlineStatus(tag, detail);
  }

  /**
   * Joins a ?room= invite once an authenticated session exists.
   * Retries briefly because anonymous auth is asynchronous.
   */
  private async consumePendingInvite(): Promise<void> {
    const code = this.pendingInviteCode;
    if (!code) return;

    for (let attempt = 0; attempt < 20; attempt++) {
      if (authService.isSignedIn()) {
        this.pendingInviteCode = null;
        await this.joinRaceRoom(code);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    this.pendingInviteCode = null;
    this.ui.importScreen.racePanel.showError(
      'COULD NOT JOIN ROOM // ONLINE SESSION UNAVAILABLE\n' + code
    );
  }

  private async refreshLeaderboard(trackId: string): Promise<void> {
    const panel = this.ui.importScreen.leaderboardPanel;
    const title = SignalPackCatalog.getTrackById(trackId)?.title ?? trackId;
    panel.setLoading(title);

    // The board is scoped to the canonical identity of the local map.
    const level = await PresetLevelCache.loadPreset(trackId);
    if (!level) {
      panel.render({ trackId, entries: [], you: null, offline: true }, title);
      return;
    }
    const identity = computeMapIdentity(trackId, level.track, level.analysis);
    const view = await leaderboardService.fetchLeaderboard(trackId, identity);
    panel.render(view, title);
  }

  // -- race lifecycle -------------------------------------------------------

  private async createRaceRoom(trackId: string): Promise<void> {
    const panel = this.ui.importScreen.racePanel;
    panel.clearError();

    const level = await PresetLevelCache.loadPreset(trackId);
    if (!level) {
      panel.showError('CANONICAL MAP UNAVAILABLE FOR THIS SIGNAL');
      return;
    }
    const title = SignalPackCatalog.getTrackById(trackId)?.title ?? trackId;
    const identity = computeMapIdentity(trackId, level.track, level.analysis);

    const result = await raceRoomService.createRoom({
      trackId,
      trackTitle: title,
      identity
    });
    if (!result.ok) {
      panel.showError(`COULD NOT CREATE ROOM // ${result.detail.toUpperCase()}`);
      return;
    }
    panel.setHost(true);
    // Canonical identity is verified against the room row, not assumed.
    const verdict = raceRoomService.verifyLocalMap(level.track);
    panel.setMapState(verdict.ok ? 'OK' : 'MISMATCH', verdict.ok ? '' : verdict.detail.replace(/\n/g, ' '));
    panel.showLobby();
    panel.renderLobby(
      result.room,
      raceRoomService.getPlayers(),
      raceRoomService.getInviteUrl() ?? '',
      authService.getUserId(),
      this.raceIdentities
    );
    void this.refreshRaceIdentities();
  }

  private async joinRaceRoom(code: string): Promise<void> {
    const panel = this.ui.importScreen.racePanel;
    panel.clearError();

    const result = await raceRoomService.joinByInviteCode(code);
    if (!result.ok) {
      panel.showError(`COULD NOT JOIN // ${result.detail.toUpperCase()}`);
      return;
    }

    // Both clients MUST agree on the map before READY/START is meaningful.
    panel.setMapState('VERIFYING');
    const level = await PresetLevelCache.loadPreset(result.room.trackId);
    if (!level) {
      panel.setMapState('MISMATCH', 'canonical map unavailable');
      panel.showError('CANONICAL MAP UNAVAILABLE FOR THIS ROOM');
      await raceRoomService.leaveRoom();
      return;
    }
    const verdict = raceRoomService.verifyLocalMap(level.track);
    if (!verdict.ok) {
      // Blocked by the MAP, not by readiness - say so explicitly.
      panel.setMapState('MISMATCH', verdict.detail.replace(/\n/g, ' '));
      panel.showError(verdict.detail);
      await raceRoomService.leaveRoom();
      return;
    }
    panel.setMapState('OK');

    panel.setHost(raceRoomService.isHost());
    panel.showLobby();
    panel.renderLobby(
      result.room,
      raceRoomService.getPlayers(),
      raceRoomService.getInviteUrl() ?? '',
      authService.getUserId(),
      this.raceIdentities
    );
    void this.refreshRaceIdentities();
  }

  private async startRaceSession(): Promise<void> {
    const result = await raceRoomService.startSession();
    if (!result.ok) {
      this.ui.importScreen.racePanel.showError(result.detail.toUpperCase());
      return;
    }
    // The scheduled timestamp drives the countdown on every client.
    if (result.startAtMs) this.beginRaceFromSchedule(result.startAtMs);
  }

  /**
   * Loads the room's canonical map, verifies identity locally, and runs the
   * shared countdown to the agreed start timestamp.
   */
  private async beginRaceFromSchedule(startAtMs: number): Promise<void> {
    if (this.raceActive) return;
    // FRIEND RACE and GHOST RACE are separate lifecycles. A live multiplayer
    // session must never inherit a recorded solo ghost.
    this.clearGhostRace();
    const room = raceRoomService.getRoom();
    if (!room) return;

    const level = await PresetLevelCache.loadPreset(room.trackId);
    if (!level) {
      this.ui.importScreen.racePanel.showError('CANONICAL MAP UNAVAILABLE');
      return;
    }
    const verdict = raceRoomService.verifyLocalMap(level.track);
    if (!verdict.ok) {
      this.ui.importScreen.racePanel.setMapState('MISMATCH', verdict.detail.replace(/\n/g, ' '));
      this.ui.importScreen.racePanel.showError(verdict.detail);
      return;
    }

    this.raceStartAtMs = startAtMs;
    this.raceActive = true;
    this.raceFinishReported = false;
    this.raceLastRivalBestUs = null;
    this.raceLastLocalBestUs = null;

    // FRIEND RACE WORLD MODE: from here until the session ends, the remote human
    // opponent is the ONLY gameplay-world ghost. This also releases any armed
    // recorded solo ghost and publishes the local spawn transform immediately.
    this.setFriendRaceWorld(true);

    this.ui.hideAllScreens();
    this.ui.raceHud.show();
    this.ui.raceHud.showNotice('SESSION STARTING');

    // Enter the normal track flow; the shared clock starts at startAtMs.
    await this.loadPresetTrack(room.trackId);

    // Deterministic opponent identity: each client sees the REMOTE player in the
    // REMOTE player's colour. The host is cyan, the guest is violet, so the two
    // players are never the same colour on screen.
    this.raceGhost?.setColor(
      raceRoomService.isHost() ? GUEST_SIGNAL_COLOR : HOST_SIGNAL_COLOR
    );
    // The map load replaced the world: republish the spawn transform so the
    // opponent is visible on the start platform without moving.
    this.publishLocalGhostSample();
  }

  private endRaceSession(): void {
    if (!this.raceActive) return;
    this.raceActive = false;
    this.raceStartAtMs = null;
    this.ui.raceHud.hide();
    this.raceGhost?.clear();
    this.setFriendRaceWorld(false);
    void raceRoomService.finishSession();
  }

  private showRaceResults(rows: readonly RaceResultRow[]): void {
    const panel = this.ui.importScreen.racePanel;
    panel.renderResults(rows, authService.getUserId(), this.raceIdentities);
    panel.showResults();
    this.ui.importScreen.show();
    this.ui.importScreen.openRaceTab();
    // Identity is fetched lazily, only when results are actually shown.
    void this.refreshRaceIdentities(() => panel.renderResults(rows, authService.getUserId(), this.raceIdentities));
  }

  private async leaveRaceRoom(): Promise<void> {
    this.raceActive = false;
    this.raceStartAtMs = null;
    this.ui.raceHud.hide();
    this.raceGhost?.clear();
    // Leaving the race world restores normal solo ghost eligibility.
    this.setFriendRaceWorld(false);
    await raceRoomService.leaveRoom();
    this.ui.importScreen.racePanel.showSelect();
  }

  /**
   * Per-frame race presentation. Throttled: the ghost broadcasts at ~12 Hz and
   * the live attempt time at ~1 Hz. No per-frame network, no DB writes.
   *
   * Runs for the WHOLE friend-race world lifetime, not only while the shared
   * timer is running: the opponent must be visible on the start platform before
   * the countdown finishes.
   */
  private updateRace(frameDelta: number): void {
    if (!this.friendRaceWorld) return;

    const room = raceRoomService.getRoom();
    if (room) {
      const now = Date.now();
      const remainingMs = room.startAtMs !== null
        ? Math.max(0, room.startAtMs + room.sessionSeconds * 1000 - now)
        : room.sessionSeconds * 1000;

      const players = raceRoomService.getPlayers();
      const myId = authService.getUserId();
      const me = players.find((p) => p.userId === myId) ?? null;
      const rival = players.find((p) => p.userId !== myId) ?? null;

      // Local live values come from the authoritative run timer, not the network.
      const currentRunUs = Math.round(this.runElapsedTime * 1_000_000);

      this.ui.raceHud.update({
        remainingMs,
        you: {
          displayName: me?.displayName ?? 'YOU',
          currentRunUs: this.raceFinishReported ? 0 : currentRunUs,
          sessionBestUs: me?.sessionBestUs ?? this.raceLastLocalBestUs,
          attemptCount: me?.attemptCount ?? 0,
          finishCount: me?.finishCount ?? 0,
          connected: true
        },
        rival: rival
          ? {
              displayName: rival.displayName,
              currentRunUs: rival.currentRunUs,
              sessionBestUs: rival.sessionBestUs,
              attemptCount: rival.attemptCount,
              finishCount: rival.finishCount,
              connected: rival.connected
            }
          : null
      });

      // Rival improvement notice (non-blocking).
      if (rival && rival.sessionBestUs !== null && rival.sessionBestUs !== this.raceLastRivalBestUs) {
        const previous = this.raceLastRivalBestUs;
        this.raceLastRivalBestUs = rival.sessionBestUs;
        if (previous !== null && rival.sessionBestUs < previous) {
          // Small, non-blocking. Names the rival AND states the role, so the
          // notification is unambiguous without a large popup.
          this.ui.raceHud.showNotice(
            `RIVAL ${rival.displayName} // NEW BEST ${formatRaceTime(rival.sessionBestUs)}`
          );
        }
      }

      // Live attempt time for the rival's HUD: ~1 Hz, never per frame.
      this.raceCurrentRunAccumulator += frameDelta;
      if (this.raceCurrentRunAccumulator >= 1) {
        this.raceCurrentRunAccumulator = 0;
        void raceRoomService.reportCurrentRun(this.raceFinishReported ? 0 : currentRunUs);
      }

      if (remainingMs <= 0) {
        this.endRaceSession();
        return;
      }
    }

    // Ghost sample: presentation only. The game loop stores the latest local
    // transform EVERY active frame; RaceRoomService owns the broadcast cadence
    // and stamps the timestamp at send time. That separation is what keeps the
    // opponent visible when a background tab's animation loop is throttled.
    this.storeLocalTransform();
  }

  /**
   * Stores the local player's current transform for the broadcast scheduler.
   *
   * Presentation only. Runs every active frame so the stored transform is always
   * current; it performs no network work and no allocation on the hot path.
   */
  private storeLocalTransform(): void {
    if (!this.friendRaceWorld) return;
    const p = this.playerController.position;
    const v = this.playerController.velocity;
    // Reused scratch object: the hot path must not allocate.
    const t = this.localTransformScratch;
    t.x = p.x;
    t.y = p.y;
    t.z = p.z;
    t.yaw = this.cameraController.yaw;
    t.pitch = this.cameraController.pitch;
    t.vx = v.x;
    t.vy = v.y;
    t.vz = v.z;
    t.running = !this.raceFinishReported;
    raceRoomService.setLocalTransform(t);
  }

  /**
   * Stores AND publishes the local transform immediately.
   *
   * Used on spawn, on entering the world and on visibility/focus transitions, so
   * the opponent never has to wait for the next scheduled tick to appear.
   */
  private publishLocalGhostSample(): void {
    if (!this.friendRaceWorld) return;
    this.storeLocalTransform();
    raceRoomService.publishNow();
  }

  /**
   * The ONE authoritative switch for friend-race world mode.
   *
   * Entering: disables every solo ghost source and releases any armed recorded
   * ghost, so the remote opponent is the only ghost in the world.
   * Leaving: restores normal solo ghost behaviour.
   */
  private setFriendRaceWorld(enabled: boolean): void {
    this.friendRaceWorld = enabled;
    this.ghostManager.setFriendRaceMode(enabled);
    this.ghostRace.setFriendRaceMode(enabled);
    if (enabled) {
      // Release any armed recorded solo ghost: the remote opponent is the only
      // ghost that may appear in a friend race world.
      this.clearGhostRace();
      // NOTE: the local spawn transform is NOT published here. This runs before
      // the race map loads, so the player is still at their previous position.
      // The spawn publish happens in prepareTrackForRun() and on entering
      // PLAYING, and the 12 Hz tick continues from there.
    }
  }

  /**
   * DEV snapshot of the friend-race ghost pipeline. Read-only.
   */
  private raceGhostDiagnostics(): RaceGhostDiagnosticState {
    const camera = this.environment.camera;
    const ghost = this.raceGhost?.getDiagnostics(Date.now(), camera) ?? null;
    const net = raceRoomService.getGhostDiagnostics();
    const myId = authService.getUserId();
    const players = raceRoomService.getPlayers();
    const rival = players.find((p) => p.userId !== myId) ?? null;
    return {
      friendRace: this.friendRaceWorld,
      raceActive: this.raceActive,
      raceStartAtMs: this.raceStartAtMs,
      soloGhostsDisabled: this.ghostManager.isFriendRaceMode(),
      recordedGhostArmed: this.ghostRace.isActive(),
      remoteConnected: rival?.connected ?? false,
      remotePresent: rival !== null,
      remoteName: rival?.displayName ?? 'none',
      txCount: net.txCount,
      txAgeMs: net.txAgeMs,
      txBackgroundCount: net.txBackgroundCount,
      rxCount: net.rxCount,
      rxAgeMs: net.rxAgeMs,
      ghostState: ghost?.state ?? 'NO_SAMPLE',
      ghostHasTarget: ghost?.hasTarget ?? false,
      ghostVisible: ghost?.visible ?? false,
      ghostSamples: ghost?.samplesReceived ?? 0,
      distanceM: ghost?.distanceM ?? null,
      color: ghost?.color ?? 0,
      documentVisible: net.documentVisible,
      windowFocused: net.windowFocused,
      lastVisibilityChangeAt: net.lastVisibilityChangeAt,
      rxPosition: ghost?.rxPosition ?? null,
      ghostLocal: ghost?.ghostLocal ?? { x: 0, y: 0, z: 0 },
      ghostWorld: ghost?.ghostWorld ?? { x: 0, y: 0, z: 0 },
      ghostAttached: ghost?.attached ?? false,
      ghostRootVisible: ghost?.rootVisible ?? false,
      ghostRootScale: ghost?.rootScale ?? { x: 0, y: 0, z: 0 },
      ghostChildCount: ghost?.childCount ?? 0,
      cameraDistanceM: ghost?.cameraDistanceM ?? null,
      ghostFrustum: ghost?.frustum ?? 'UNKNOWN',
      cameraLayerMask: ghost?.cameraLayerMask ?? null,
      ghostLayerMask: ghost?.ghostLayerMask ?? 0,
      ghostMaterialAlpha: ghost?.materialAlpha ?? 0,
      ghostMaterialVisible: ghost?.materialVisible ?? false,
      ghostFrustumCulled: ghost?.frustumCulled ?? true,
      debugMarker: ghost?.debugMarker ?? 'OFF',
      debugOffset: ghost?.debugOffset ?? false,
      forceVisible: ghost?.forceVisible ?? false
    };
  }

  private updateRaceGhost(frameDelta: number): void {
    // PRESENCE AUTHORITY: a stale transform is not a departed opponent. The room
    // tells us whether the rival still exists; only positive evidence removes
    // the ghost, and a stale stream holds position instead.
    if (this.raceGhost && this.friendRaceWorld) {
      const myId = authService.getUserId();
      const rival = raceRoomService.getPlayers().find((p) => p.userId !== myId) ?? null;
      this.raceGhost.setRemotePresent(rival !== null && rival.connected);
    }
    this.raceGhost?.update(frameDelta, this.playerController.position);
  }

  // ==========================================================================
  // POV REPLAY V1 — recording, playback and leaderboard WATCH
  //
  // Recording stores a compact 30 Hz sample stream plus an event list. Playback
  // reconstructs the camera from RECORDED samples only, so it cannot drift.
  // The legacy box/chase replay remains available in DEV tools only.
  // ==========================================================================

  /** Canonical identity of the currently loaded map, or null if not official. */
  public currentMapIdentity(): PovReplayIdentity | null {
    if (!this.currentTrack || !this.currentAnalysis || !this.currentOfficialTrackId) return null;
    if (!this.currentTrackCanonical) return null;
    const identity = computeMapIdentity(
      this.currentOfficialTrackId,
      this.currentTrack,
      this.currentAnalysis
    );
    return {
      trackId: identity.trackId,
      mapVersion: identity.mapVersion,
      mapFingerprint: identity.mapFingerprint,
      movementVersion: identity.movementVersion
    };
  }

  private startPovRecording(): void {
    // A fresh attempt: any previous run's upload must not leak into this run's
    // submission.
    this.pendingReplayUpload = null;
    const identity = this.currentMapIdentity();
    if (!identity) {
      // Custom audio and non-canonical maps are not competitively replayable.
      this.povRecorder.clear();
      return;
    }
    const skinId = KarambitSkinSystem.getInstance().getEquippedSkinId();
    const fov = this.environment.camera.fov;
    const startSongTimeMs = this.audioEngine.getCurrentTime() * 1000;
    this.povRecorder.start(identity, skinId, fov, startSongTimeMs);
  }

  /** Finalises the replay on run completion and attaches it to the run. */
  private finishPovRecording(): void {
    if (!this.povRecorder.isRecording()) return;
    this.povRecorder.setFinishTimeUs(this.runElapsedTime * 1_000_000);
    this.povRecorder.pushEvent('FINISH');
    this.povRecorder.stop();

    const replay = this.povRecorder.finalize();
    this.povRecorder.clear();
    this.lastFinalizedReplay = replay;

    if (replay) {
      // Local cache first: WATCH works instantly and offline.
      replayStorageService.rememberLocally(replay);
      // Upload is fire-and-forget and never blocks or fails the run. The
      // submission chains on this promise so it can carry the replay metadata.
      this.pendingReplayUpload = replayStorageService
        .uploadReplay(replay)
        .catch(() => null);
    }
  }

  /**
   * Full canonical identity (including generator + analysis fingerprints) for the
   * loaded official track, or null when the run is not canonical.
   */
  private fullMapIdentity(): MapIdentity | null {
    if (!this.currentTrack || !this.currentAnalysis || !this.currentOfficialTrackId) return null;
    if (!this.currentTrackCanonical) return null;
    return computeMapIdentity(this.currentOfficialTrackId, this.currentTrack, this.currentAnalysis);
  }

  /**
   * Submits a finished official run through the existing submit-run path, records
   * the replay reference for ghost racing, and reports the REAL outcome.
   *
   * Deliberately independent: PB update, replay storage, ghost bookkeeping and
   * world submission each happen on their own terms. A rejected submission never
   * costs the player their ghost, and a slower run never overwrites a faster PB.
   */
  private async submitOfficialRun(
    results: RunResults,
    candidate: LeaderboardSubmissionCandidate | undefined
  ): Promise<void> {
    const trackId = this.currentOfficialTrackId;
    if (!trackId) return;

    const publish = (state: SubmissionState, detail?: string): void => {
      this.lastSubmissionState = { state, detail };
      this.ui.resultsScreen.setSubmissionState(state, detail);
    };

    // 1. Canonical guard. A non-canonical map can never be submitted.
    const identity = this.fullMapIdentity();
    if (!identity) {
      publish('RUN_INELIGIBLE_NON_CANONICAL');
      return;
    }
    if (this.isOvertime) {
      publish('RUN_INELIGIBLE_OVERTIME');
      return;
    }
    if (!candidate) {
      publish('RUN_INELIGIBLE_UNRANKED');
      return;
    }

    // 2. Wait for the replay upload so the submission can carry its metadata.
    //    The results screen is already visible and reads SUBMITTING meanwhile.
    publish('SUBMITTING');
    const uploaded = await (this.pendingReplayUpload ?? Promise.resolve(null));
    const replay = this.lastFinalizedReplay;

    // 3. Ghost bookkeeping FIRST, so ghost racing works even if the world
    //    submission is rejected. The FASTEST recorded replay wins; a slower run
    //    becomes the best available ghost without touching the PB.
    if (uploaded?.ok && uploaded.path && uploaded.hash && replay) {
      const changed = LeaderboardManager.getInstance().recordGhostReplay(
        trackId,
        replay.finishTimeUs,
        uploaded.path,
        uploaded.hash,
        identity.mapFingerprint
      );
      if (changed) this.refreshPbGhostAvailability(trackId);
    }

    // 4. Submit. The server is the authority.
    const submission: RunSubmission = {
      identity,
      timeUs: Math.round(results.completionTime * 1_000_000),
      rank: results.rank,
      checkpointCount: this.passedCheckpoints.size,
      resetCount: Math.max(0, results.restartsCount),
      devMode: this.movementLab !== null,
      replayVersion: uploaded?.ok ? POV_REPLAY_VERSION : undefined,
      replayHash: uploaded?.ok ? uploaded.hash : undefined,
      replayPath: uploaded?.ok ? uploaded.path : undefined
    };

    const outcome = await leaderboardService.submitRun(submission);

    if (outcome.ok) {
      publish(outcome.isPersonalBest ? 'WORLD_PB_UPDATED' : 'WORLD_ENTRY_SUBMITTED');
      return;
    }

    // Offline / not signed in: queue locally and say so plainly. Never claim the
    // run reached the world board.
    if (outcome.reason === 'OFFLINE' || outcome.reason === 'NOT_AUTHENTICATED') {
      const queued = LeaderboardManager.getInstance().queueCandidate(candidate);
      publish(
        queued ? 'WORLD_ENTRY_QUEUED_OFFLINE' : 'WORLD_SUBMISSION_FAILED',
        outcome.detail
      );
      return;
    }

    // Identity / registry / dev rejections are ineligibility, with the real reason.
    if (
      outcome.reason === 'IDENTITY_MISMATCH' ||
      outcome.reason === 'REGISTRY_NOT_READY' ||
      outcome.reason === 'DEV_RUN'
    ) {
      publish('RUN_INELIGIBLE_NON_CANONICAL', outcome.detail);
      return;
    }

    publish('WORLD_SUBMISSION_FAILED', outcome.detail);
  }

  /** Records one simulation frame into the POV replay (cheap, allocation-free). */
  private recordPovFrame(dt: number): void {
    if (!this.povRecorder.isRecording()) return;
    this.povRecorder.record(dt, {
      songTimeMs: this.runElapsedTime * 1000,
      pos: this.playerController.position,
      vel: this.playerController.velocity,
      yaw: this.cameraController.yaw,
      pitch: this.cameraController.pitch,
      grounded: this.playerController.isGrounded,
      surfing: this.playerController.isSurfing,
      surfSide: this.playerController.surfState.surfSide === 'LEFT' ? -1 : 1
    });
  }

  /** Records a presentation event into the replay stream. */
  public recordReplayEvent(type: PovReplayEventType, data?: number): void {
    this.povRecorder.pushEvent(type, data);
  }

  /**
   * Opens a true first-person replay of a leaderboard run.
   * Refuses to play if the canonical map identity does not match.
   */
  public async watchLeaderboardRun(runId: string): Promise<{ ok: boolean; detail: string }> {
    const entry = this.ui.importScreen.leaderboardPanel.getEntryByRunId(runId);
    const trackId = entry?.trackId ?? this.ui.importScreen.leaderboardPanel.getSelectedTrack();
    const finishTimeUs = entry?.timeUs;

    const level = await PresetLevelCache.loadPreset(trackId);
    if (!level) return { ok: false, detail: 'CANONICAL MAP UNAVAILABLE' };
    const identity = computeMapIdentity(trackId, level.track, level.analysis);
    const expected: PovReplayIdentity = {
      trackId,
      mapVersion: identity.mapVersion,
      mapFingerprint: identity.mapFingerprint,
      movementVersion: identity.movementVersion
    };

    // Local replay first (own run, instant and offline-capable).
    const localPayload = finishTimeUs ? replayStorageService.getLocal(trackId, finishTimeUs) : null;
    const payload = localPayload ?? (await replayStorageService.fetchReplayForRun(runId)).payload;

    if (!payload) return { ok: false, detail: 'REPLAY UNAVAILABLE FOR THIS RUN' };
    return this.enterPovReplay(payload, expected, trackId, finishTimeUs);
  }

  /** Plays the most recent locally recorded run (Results screen). */
  public async watchLocalReplay(): Promise<{ ok: boolean; detail: string }> {
    const identity = this.currentMapIdentity();
    if (!identity || !this.lastFinalizedReplay) {
      return { ok: false, detail: 'NO LOCAL REPLAY RECORDED' };
    }
    const payload = encodePovReplay(this.lastFinalizedReplay);
    return this.enterPovReplay(
      payload,
      identity,
      identity.trackId,
      this.lastFinalizedReplay.finishTimeUs
    );
  }

  /** Arms the ghost for the next run start and resets it to t=0. */
  private armPendingGhostRun(): void {
    // FRIEND RACE: a live multiplayer session never arms a recorded solo ghost,
    // on map load or on a hold-R restart.
    if (this.friendRaceWorld) {
      this.clearGhostRace();
      return;
    }
    if (this.pendingGhostRun) {
      this.ghostRace.load(this.pendingGhostRun);
      this.ghostRace.setEffectScale(this.environment.effectProfile.additiveScale);
      this.ui.hud.setGhostRaceIndicator(this.pendingGhostRun.label, this.pendingGhostRun.finishTimeUs);
    } else {
      this.ui.hud.setGhostRaceIndicator(null, null);
    }
    // start() is safe with no ghost: it only resets presentation state.
    this.ghostRace.start();
  }

  /**
   * Releases any recorded ghost. Used when leaving ghost racing so a live
   * friend race (or a plain run) can never inherit one.
   */
  public clearGhostRace(): void {
    this.pendingGhostRun = null;
    this.lastGhostComparison = null;
    this.ghostRace.clear();
    this.ui.hud.setGhostRaceIndicator(null, null);
  }

  /** Maps a ghost rejection to the player-facing text. */
  private static ghostRejectionDetail(reason: string): string {
    if (
      reason === 'MAP_VERSION_MISMATCH' ||
      reason === 'MAP_FINGERPRINT_MISMATCH' ||
      reason === 'MOVEMENT_VERSION_MISMATCH' ||
      reason === 'TRACK_MISMATCH'
    ) {
      return 'GHOST // MAP VERSION MISMATCH';
    }
    return `GHOST // ${reason}`;
  }

  /** Canonical identity of a track as shipped, or null when unavailable. */
  private async canonicalIdentityFor(trackId: string): Promise<PovReplayIdentity | null> {
    const level = await PresetLevelCache.loadPreset(trackId);
    if (!level) return null;
    const identity = computeMapIdentity(trackId, level.track, level.analysis);
    return {
      trackId,
      mapVersion: identity.mapVersion,
      mapFingerprint: identity.mapFingerprint,
      movementVersion: identity.movementVersion
    };
  }

  /**
   * The local player's identity in the menu footer.
   *
   * The NAME is the interaction target for the player's own profile, so there is
   * no duplicate profile button anywhere. A missing or blank name falls back to
   * the generated PLAYHEAD style, never a UUID.
   */
  public refreshLocalIdentity(): void {
    const name = authService.getProfile()?.displayName;
    this.ui.importScreen.setPlayerIdentity(name ?? 'PLAYER', () => this.openOwnProfile());
  }

  /**
   * Opens the local player's own profile.
   *
   * Built entirely from local authoritative state, so it works offline. The name
   * is the only identity string rendered — never a UUID.
   */
  public openOwnProfile(): void {
    const modal = this.ui.profileModal;
    modal.setCallbacks({
      onWatchLocalPb: (trackId) => void this.watchOwnPb(trackId),
      onRaceLocalPb: (trackId) => void this.racePbGhost(trackId),
      onRename: (name) => {
        // Validation is synchronous; the SAVE outcome is reported separately via
        // setRenameResult, so the modal never claims a save the server has not
        // confirmed.
        const local = validateDisplayName(name);
        if (!local.ok) return { ok: false, detail: local.detail };
        void authService.setDisplayName(name).then((r) => {
          modal.setRenameResult(r.ok, r.ok ? 'saved' : r.detail);
          if (r.ok) {
            this.ui.importScreen.setPlayerIdentity(r.value, () => this.openOwnProfile());
          }
        });
        return { ok: true, detail: '' };
      }
    });
    modal.render(playerProfileService.buildLocalProfile(), true);
  }

  /**
   * Opens another player's PUBLIC profile.
   *
   * Identity comes from the narrow `public_profiles` projection; the record comes
   * from the already-public accepted leaderboard runs. No private table is read,
   * and no UUID is ever rendered.
   */
  public async openPlayerProfile(userId: string, displayName: string): Promise<void> {
    const modal = this.ui.profileModal;
    modal.setCallbacks({
      onWatchRemoteRun: (runId) => void this.watchLeaderboardRun(runId),
      onRaceRemoteRun: (runId) => void this.raceLeaderboardGhost(runId)
    });
    // Show the honest offline state immediately, then replace it if the fetch
    // succeeds. Never fabricate profile data.
    modal.render(playerProfileService.offlineProfile(displayName));

    const view = await playerProfileService.fetchPublicProfile(userId);
    if (!view) {
      modal.render(playerProfileService.offlineProfile(displayName));
      return;
    }
    modal.render(view);
  }

  /** Watches the local player's own PB for a track, when a replay exists. */
  public async watchOwnPb(trackId: string): Promise<{ ok: boolean; detail: string }> {
    const manager = LeaderboardManager.getInstance();
    const pbTimeUs = manager.getPbTimeUs(trackId);
    if (pbTimeUs === null) return { ok: false, detail: 'NO PERSONAL BEST ON THIS TRACK' };

    const payload = replayStorageService.getLocal(trackId, pbTimeUs);
    if (!payload) return { ok: false, detail: 'NO LOCAL REPLAY FOR THIS PB' };

    const expected = await this.canonicalIdentityFor(trackId);
    if (!expected) return { ok: false, detail: 'CANONICAL MAP UNAVAILABLE' };

    return this.enterPovReplay(payload, expected, trackId, pbTimeUs);
  }

  /**
   * Fetches public identity for the players currently in a lobby / results.
   *
   * LAZY: only called while a lobby or results screen is actually open, and it
   * loads text metadata only — never a knife texture, glove asset or video.
   */
  private async refreshRaceIdentities(after?: () => void): Promise<void> {
    const players = raceRoomService.getPlayers();
    if (players.length === 0) return;
    const ids = players.map((p) => p.userId);
    const identities = await playerProfileService.fetchPublicIdentities(ids);
    if (identities.size === 0) return;

    const next = new Map(this.raceIdentities);
    for (const [id, identity] of identities) {
      next.set(id, {
        gloveName: getMasteryGlove(identity.equippedGloveId).name,
        knifeName: KarambitSkinSystem.getInstance().getSkin(identity.equippedKnifeId).name
      });
    }
    this.raceIdentities = next;
    after?.();
  }

  /**
   * Resolves the replay payload for this track's best raceable ghost.
   *
   * Order: local in-session replay for the PB time (instant, offline), then the
   * stored fastest replay — but ONLY when it was recorded on the current
   * canonical map. An old-map replay is never used for a current race.
   */
  private async resolveGhostPayload(
    trackId: string
  ): Promise<{ payload: string; finishTimeUs: number | null } | null> {
    const manager = LeaderboardManager.getInstance();
    const pbTimeUs = manager.getPbTimeUs(trackId);

    if (pbTimeUs !== null) {
      const local = replayStorageService.getLocal(trackId, pbTimeUs);
      if (local) return { payload: local, finishTimeUs: pbTimeUs };
    }

    const ref = manager.getGhostReplayRef(trackId);
    const fingerprint = this.canonicalFingerprintFor(trackId);
    if (ref && fingerprint && ref.mapFingerprint === fingerprint) {
      const local = replayStorageService.getLocal(trackId, ref.finishTimeUs);
      if (local) return { payload: local, finishTimeUs: ref.finishTimeUs };

      const fetched = await replayStorageService.fetchOwnReplay(ref.path);
      if (fetched.ok && fetched.payload) {
        return { payload: fetched.payload, finishTimeUs: ref.finishTimeUs };
      }
    }

    return null;
  }

  /** Shipped canonical map fingerprint for a track id, or null when unknown. */
  private canonicalFingerprintFor(trackId: string): string | null {
    return OFFICIAL_MAP_REGISTRY.find((e) => e.trackId === trackId)?.mapFingerprint ?? null;
  }

  /** Correct, non-conflated ghost label for a resolved ghost time. */
  private ghostLabelFor(trackId: string, ghostTimeUs: number | null): 'PB GHOST' | 'BEST RECORDED GHOST' {
    const pbTimeUs = LeaderboardManager.getInstance().getPbTimeUs(trackId);
    if (pbTimeUs !== null && ghostTimeUs !== null && ghostTimeUs !== pbTimeUs) {
      return 'BEST RECORDED GHOST';
    }
    return 'PB GHOST';
  }

  /**
   * RACE YOUR PB — runs the official level with the player's recorded PB as a
   * non-interactive ghost.
   *
   * Flow: retrieve replay -> validate identity -> load canonical map -> enter
   * the normal run flow. Nothing is fetched after movement has begun.
   *
   * A legacy PB with no replay is reported honestly and never fabricated. When a
   * slower run has a replay, that run is raced as BEST RECORDED GHOST and the
   * faster PB time is untouched.
   */
  public async racePbGhost(trackId: string): Promise<{ ok: boolean; detail: string }> {
    const entry = this.ui.importScreen.getCatalogEntry(trackId);
    if (!entry) return { ok: false, detail: 'TRACK NOT FOUND' };

    const expected = await this.canonicalIdentityFor(trackId);
    if (!expected) return { ok: false, detail: 'CANONICAL MAP UNAVAILABLE' };

    const resolved = await this.resolveGhostPayload(trackId);
    if (!resolved) return { ok: false, detail: 'PB GHOST // NO REPLAY' };

    const decoded = decodePovReplay(resolved.payload);
    if (!decoded.ok) return { ok: false, detail: `GHOST // REJECTED (${decoded.reason})` };

    const built = buildGhostRaceRun({
      kind: 'PB',
      label: this.ghostLabelFor(trackId, resolved.finishTimeUs),
      replay: decoded.replay,
      expectedIdentity: expected,
      payload: resolved.payload,
      // Self-consistency: the bytes must match the hash the replay carries.
      expectedHash: decoded.replay.hash
    });
    if (!built.ok) return { ok: false, detail: Game.ghostRejectionDetail(built.reason) };

    await this.handleCatalogTrackSelected(entry, built.run);
    return { ok: true, detail: 'GHOST // VERIFIED' };
  }

  /**
   * RACE A WORLD LEADERBOARD RUN — same flow, but the replay must come from an
   * ACCEPTED leaderboard run through the existing secure retrieval path.
   */
  public async raceLeaderboardGhost(runId: string): Promise<{ ok: boolean; detail: string }> {
    const panel = this.ui.importScreen.leaderboardPanel;
    const entry = panel.getEntryByRunId(runId);
    const trackId = entry?.trackId ?? panel.getSelectedTrack();
    const finishTimeUs = entry?.timeUs;

    const catalogEntry = this.ui.importScreen.getCatalogEntry(trackId);
    if (!catalogEntry) return { ok: false, detail: 'TRACK NOT FOUND' };

    const expected = await this.canonicalIdentityFor(trackId);
    if (!expected) return { ok: false, detail: 'CANONICAL MAP UNAVAILABLE' };

    // Local replay first (the player's own accepted run), then the secure
    // accepted-run path. No new retrieval backend is introduced.
    const localPayload = finishTimeUs
      ? replayStorageService.getLocal(trackId, finishTimeUs)
      : null;
    const payload = localPayload ?? (await replayStorageService.fetchReplayForRun(runId)).payload;
    if (!payload) return { ok: false, detail: 'GHOST // REPLAY UNAVAILABLE' };

    const decoded = decodePovReplay(payload);
    if (!decoded.ok) return { ok: false, detail: `GHOST // REJECTED (${decoded.reason})` };

    const built = buildGhostRaceRun({
      kind: 'WORLD',
      label: worldGhostLabel(entry?.rankPosition ?? 0, entry?.displayName ?? 'RUNNER'),
      replay: decoded.replay,
      expectedIdentity: expected,
      expectedFinishTimeUs: finishTimeUs,
      payload,
      expectedHash: entry?.replayHash ?? undefined
    });
    if (!built.ok) return { ok: false, detail: Game.ghostRejectionDetail(built.reason) };

    await this.handleCatalogTrackSelected(catalogEntry, built.run);
    return { ok: true, detail: 'GHOST // VERIFIED' };
  }

  /**
   * Refreshes the restrained ghost action for the selected track.
   *
   * Reports one of four distinct, non-conflated states: no PB, PB with no
   * replay, PB GHOST, or BEST RECORDED GHOST. A PB whose only replay is from an
   * older map is reported as having no usable replay rather than offering a
   * ghost that would be rejected on load.
   */
  public refreshPbGhostAvailability(trackId: string): void {
    const manager = LeaderboardManager.getInstance();
    const info = manager.resolveGhostAvailability(
      trackId,
      this.canonicalFingerprintFor(trackId),
      (finishTimeUs) => replayStorageService.getLocal(trackId, finishTimeUs) !== null
    );

    this.ui.importScreen.setPbGhostAvailability({
      available: info.available,
      pbTimeSeconds: info.pbTimeUs !== null ? info.pbTimeUs / 1_000_000 : null,
      actionText: info.actionText,
      state: info.state
    });
  }

  public hasLocalReplay(): boolean {
    return this.lastFinalizedReplay !== null && this.currentMapIdentity() !== null;
  }

  private async enterPovReplay(
    payload: string,
    expected: PovReplayIdentity,
    trackId: string,
    finishTimeUs?: number
  ): Promise<{ ok: boolean; detail: string }> {
    const loaded = this.povPlayer.load(payload, { identity: expected, finishTimeUs });
    if (!loaded.ok) return { ok: false, detail: `REPLAY REJECTED // ${loaded.reason}` };

    const level = await PresetLevelCache.loadPreset(trackId);
    if (!level) return { ok: false, detail: 'CANONICAL MAP UNAVAILABLE' };

    this.replayMode = 'POV';
    this.povPlayer.restart();
    this.stateMachine.transitionTo(GameState.REPLAY);
    return { ok: true, detail: 'PLAYING' };
  }

  /** ESC / EXIT: leaves replay cleanly and restores pointer lock behaviour. */
  public exitPovReplay(): void {
    this.replayMode = 'NONE';
    this.povPlayer.unload();
    this.ui.replayOverlay.hide();
    this.clearGhostRace();
    this.stateMachine.transitionTo(GameState.IMPORT);
  }

  /** Per-frame POV replay presentation. */
  private updatePovReplay(frameDelta: number): void {
    const frame = this.povPlayer.update(frameDelta);

    // Camera: recorded position + frozen eye height, recorded yaw/pitch and FOV.
    this.environment.camera.position.copy(frame.position);
    this.environment.camera.rotation.set(frame.pitch, frame.yaw, 0, 'YXZ');
    if (Math.abs(this.environment.camera.fov - frame.fov) > 0.01) {
      this.environment.camera.fov = frame.fov;
      this.environment.camera.updateProjectionMatrix();
    }

    // Audio + music-reactive world follow the recorded song time.
    const songTime = frame.songTimeMs / 1000;
    this.audioEngine.seek(songTime);
    this.world.update(songTime, frame.position, frame.yaw, frameDelta, this.environment);

    // Viewmodel: the runner's cosmetic (safe fallback if it no longer exists).
    this.viewmodelController.update(
      frameDelta,
      this.playerController,
      this.cameraController,
      0,
      0
    );
    const skinId = this.povPlayer.getSkinId();
    if (skinId && skinId !== KarambitSkinSystem.getInstance().getEquippedSkinId()) {
      // equipSkin() denies unknown ids and falls back safely, so an old replay
      // referencing a removed cosmetic cannot break playback.
      KarambitSkinSystem.getInstance().equipSkin(skinId);
    }

    this.ui.replayOverlay.update({
      player: '',
      finishTimeUs: this.povPlayer.getFinishTimeUs(),
      currentMs: this.povPlayer.getCurrentMs(),
      durationMs: this.povPlayer.getDurationMs(),
      paused: this.povPlayer.isPaused
    });
  }

  /** DEV ONLY: the legacy box/chase replay. Never the player-facing experience. */
  private updateLegacyReplay(frameDelta: number): void {
    this.replayPlayer.update(frameDelta);
    const songTime = this.audioEngine.getCurrentTime();
    this.world.update(songTime, this.environment.camera.position, 0, frameDelta, this.environment);
  }
  /** Called from restartTrack() so a full restart reports a new attempt. */
  private onRaceAttemptRestart(): void {
    if (!this.raceActive) return;
    this.raceFinishReported = false;
    // NOTE: the REMOTE ghost is deliberately NOT cleared here. It is driven by
    // the opponent's live transforms, so a local restart must not affect it. The
    // local spawn transform is republished by prepareTrackForRun() instead.
    void raceRoomService.reportAttemptStart();
  }

  /** Called from handleFinishSequence() with the authoritative run time. */
  private onRaceFinish(): void {
    if (!this.raceActive || this.raceFinishReported) return;
    this.raceFinishReported = true;
    const timeUs = Math.round(this.runElapsedTime * 1_000_000);
    this.raceLastLocalBestUs =
      this.raceLastLocalBestUs === null ? timeUs : Math.min(this.raceLastLocalBestUs, timeUs);
    void raceRoomService.reportFinish(timeUs);
  }
}
