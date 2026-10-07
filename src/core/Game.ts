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
import { CustomSourceMeta, TrackAnalysis } from '../audio/AudioFeatures';
import { computeCustomContentIdentity } from '../utils/hash';
import { estimateRouteTiming } from '../generation/CustomTimingEstimate';
import { resolveCustomAudioLevel } from '../generation/CustomPipeline';
import { TrackGenerator } from '../generation/TrackGenerator';
import { GeneratedTrack, CheckpointDefinition } from '../generation/GenerationTypes';
import { CourseType, DEFAULT_COURSE_TYPE, normalizeCourseType } from '../generation/CourseType';
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
import { online } from '../online/supabaseClient';
import { cloudProgression } from '../online/CloudProgression';
import {
  raceRoomService,
  RaceRoomService,
  RacePlayer,
  RaceRoom,
  RaceResultRow,
  computeRaceResults,
  isRaceComplete
} from '../online/RaceRoomService';
import { leaderboardService } from '../online/LeaderboardService';
import type { LeaderboardView, RunSubmission } from '../online/LeaderboardService';
import { authService } from '../online/AuthService';
import { validateDisplayName } from '../online/AuthService';
import { computeMapIdentity } from '../online/MapIdentity';
import type { MapIdentity } from '../online/MapIdentity';
import { OFFICIAL_MAP_REGISTRY } from '../online/OfficialMapRegistry';
import {
  RemoteRacerGhosts,
  GUEST_SIGNAL_COLOR,
  HOST_SIGNAL_COLOR
} from '../online/RemoteGhostRenderer';
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
import { competitionGapUs } from '../mastery/SignalPackMastery';
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

  /**
   * All REMOTE racer ghosts (presentation only, no collision, no authority).
   * One cheap RemoteGhostRenderer per remote participant, keyed by userId, so a
   * 2-8 racer room shows every other racer. The local racer has no proxy.
   */
  private raceGhosts: RemoteRacerGhosts | null = null;
  /** Racer currently followed after finishing (spectator). */
  private spectateUserId: string | null = null;

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
   * Result-screen competition fetch bookkeeping. A single event-driven board
   * fetch per official finish; `resultBoardToken` invalidates any in-flight
   * response when the run/track/screen changes (retry, next signal, custom
   * audio, race start, menu return).
   */
  private resultBoardToken = 0;
  /**
   * Upload promise from the run that just finished, so the submission can carry
   * the replay metadata. Reset at the start of every recording.
   */
  private pendingReplayUpload: Promise<{ ok: boolean; path?: string; hash?: string } | null> | null =
    null;
  private raceActive = false;
  /** True while the LOADING phase is loading the race map (guards double entry). */
  private raceLoading = false;
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
  /** True once this client has reported CLIENT_LOADED for the current race. */
  private raceLoadReported = false;
  /**
   * Load generation. Bumped on every abort / leave / disconnect so an in-flight
   * async map load from a PREVIOUS race can never publish a stale report or
   * hydrate a world the player has already left.
   */
  private raceLoadGeneration = 0;
  /** True once this client has pressed the in-game READY stage. */
  private raceInGameReady = false;
  /** Ensures the synchronized GO is armed exactly once per race. */
  private raceGoArmed = false;
  /** Local mirror of the authoritative race phase, for the in-game HUD. */
  private racePhase: 'WAITING' | 'READY' | 'COUNTDOWN' | 'RACING' | 'FINISHED' = 'WAITING';
  /** World song time captured at the synchronized GO. */
  private raceSongStartSec = 0;
  /**
   * Offset from this browser's Date.now() to the AUTHORITATIVE room clock, in
   * ms. Server `now()` is adopted on every room refresh, so the shared countdown,
   * timer, song and results are anchored to one authoritative timeline instead
   * of a local clock that can drift or arrive late.
   */
  private raceClockOffsetMs = 0;

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
    teleportId: 0,
    checkpointIndex: 0,
    checkpointTotal: 0,
    running: true
  };
  /** Ordered ACTIVE rival ids for FINISH-spectator NEXT / PREV switching. */
  private spectateOrder: string[] = [];
  /** Last checkpoint index submitted for each rival (HUD placement only). */
  private readonly rivalProgress = new Map<string, { index: number; total: number }>();
  /** Throttle accumulator for ~2 Hz progress reporting. */
  private raceProgressAccumulator = 0;
  /** Last checkpoint index submitted for this racer (dedupes progress RPCs). */
  private raceLastProgress = -1;
  /** True once this racer has reported crossing the finish gate. */
  private raceFinishReported = false;
  /** Follower index for post-finish NEXT / PREV racer switching. */
  private spectateIndex = 0;
  /** Ensures the final room results are shown exactly once per race instance. */
  private raceResultsShownForRaceId: string | null = null;
  private currentRaceInstanceId: string | null = null;
  private raceHudAccumulator = 0;
  private raceTeleportId = 0;
  private raceWasRestoring = false;
  private readonly racePresentIds = new Set<string>();
  private readonly rivalYaw = new Map<string, number>();
  private readonly spectatePosition = new THREE.Vector3();
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
  /** Glove previewed during POV replay; never the player's equipped glove. */
  private replayGlovePreviewId: string | null = null;
  /**
   * State to return to when a POV replay ends.
   *
   * A replay opened from the Run Report must return to that report, not dump the
   * player on the main menu. A replay opened from a leaderboard entry (no local
   * results to return to) ends at IMPORT. Set on ENTER, read on EXIT.
   */
  private replayReturnState: GameState = GameState.IMPORT;
  private lastFinalizedReplay: PovReplay | null = null;
  public ui: UIManager;
  public devOverlay: DevOverlay;

  /** Presentation-only movement feedback (never affects gameplay). */
  public movementFeedback!: MovementFeedbackController;
  private movementSfx = MovementSfx.getInstance();

  private currentAnalysis: TrackAnalysis | null = null;
  private currentTrack: GeneratedTrack | null = null;
  private currentOfficialTrackId: string | null = null;
  /**
   * Course style of the currently loaded custom run. PLAYHEAD is the default
   * and is the legacy identity; SURF namespaces the custom cache, PB ghost and
   * replay metadata so the two styles can never mix.
   */
  private currentCourseType: CourseType = DEFAULT_COURSE_TYPE;

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
      (file, courseType) => this.handleFileSelected(file, courseType),
      (genre) => this.handleDevTrackSelected(genre),
      (err) => alert(err),
      (trackId) => this.enterMovementLab(trackId),
      () => this.enterMovementLab(undefined, { academy: true }),
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
      onAgain: () => {
        this.clearGhostRace();
        this.restartTrack();
      },
      onNewTrack: () => this.returnToImport(),
      onRetryVsPb: () => {
        // Explicit PB duel: only THIS action arms a ghost. A plain RETRY never
        // does, so the ghost toggle is respected.
        const trackId = this.currentOfficialTrackId;
        if (!trackId || this.friendRaceWorld) return Promise.resolve({ ok: false, detail: 'PB DUEL UNAVAILABLE' });
        return this.racePbGhostAndPlay(trackId);
      },
      onNextSignal: async (trackId) => {
        // Direct next-signal entry through the existing official load path: no
        // menu round-trip, no forcing a lock, deterministic catalog order.
        const entry = MusicPack.getTrackById(trackId);
        if (!entry || this.friendRaceWorld) return { ok: false, detail: 'NEXT SIGNAL UNAVAILABLE' };
        await this.handleCatalogTrackSelected(entry);
        if (!this.stateMachine.is(GameState.READY)) return { ok: false, detail: 'SIGNAL LOAD FAILED // RETRY' };
        this.stateMachine.transitionTo(GameState.COUNTDOWN);
        return { ok: true, detail: 'SIGNAL READY' };
      },
      onArmory: () => {
        // Results -> ARMORY: land on the real drops inventory, then the player
        // opens the stored drop there (results never runs the full reveal).
        this.returnToImport();
        this.ui.importScreen.openArmoryTab();
      },
      onViewLeaderboard: () => {
        // Contextual competition: open the SAME canonical track's existing board
        // without a menu hunt. The select is aimed first so the tab-open refresh
        // targets this signal; no board state is duplicated.
        const trackId = this.currentOfficialTrackId;
        if (!trackId) return;
        this.ui.importScreen.leaderboardPanel.setSelectedTrack(trackId);
        this.returnToImport();
        this.ui.importScreen.openLeaderboardTab();
      },
      onRaceGhost: (runId) => this.raceLeaderboardGhostAndPlay(runId)
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
    this.replayPlayer.onCompleteCallback = () => this.exitPovReplay();

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
      this.raceGhosts?.setEffectScale(this.environment.effectProfile.additiveScale);
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

  private pendingAcademyEntry = false;

  private async enterMovementLab(trackId?: string, opts?: { academy?: boolean }): Promise<void> {
    this.currentOfficialTrackId = null;
    this.pendingAcademyEntry = !!opts?.academy;
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
            this.movementLab.onAcademySignalPack = () => {
              this.returnToImport();
              this.ui.importScreen.openSignalPackTab();
            };
            if (this.pendingAcademyEntry) {
              this.pendingAcademyEntry = false;
              this.movementLab.enterAcademy();
              const academy = this.movementLab.getAcademy();
              if (academy) {
                academy.exitCallback = () => this.returnToImport();
              }
            }
          }
          break;

        case GameState.ANALYSING:
          this.ui.hideAllScreens();
          this.ui.analysisScreen.show();
          break;

        case GameState.READY:
          this.ui.hideAllScreens();
          this.ui.analysisScreen.show(prevState !== GameState.ANALYSING);
          if (this.currentAnalysis) {
            this.ui.analysisScreen.displayAnalysis(this.currentAnalysis);
          }
          break;

        case GameState.COUNTDOWN:
          this.prepareTrackForRun();
          this.ui.hideAllScreens();
          this.cameraController.lock();
          if (this.raceActive) {
            // ONLINE RACE: no separate local 3-2-1 screen. Enter the staged
            // gameplay scene; the SHARED in-game READY and the synchronized GO
            // (from the authoritative race timestamp) own the start.
            this.stateMachine.transitionTo(GameState.PLAYING);
            break;
          }
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
          if (this.raceActive && this.racePhase !== 'RACING') {
            // STAGED: the level is loaded and both players are visible, but the
            // music, run timer and replay recording wait for the synchronized GO.
            // Persistently zero horizontal velocity so nobody inches forward.
            this.playerController.velocity.set(0, 0, 0);
          } else if (prevState === GameState.PAUSED && !this.isQuickRestarting) {
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
          // Returning from a replay opened by the Run Report: re-show the report
          // that is already built. Everything that produced it (PB save, drops,
          // world submission) already ran, so re-running it would duplicate work.
          if (prevState === GameState.REPLAY) {
            this.returnFromReplayToReport();
            break;
          }
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
                this.replayRecorder.frames,
                this.currentCourseType
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
            // The authoritative PB BEFORE this run is what makes a "PB DELTA"
            // honest. Read once, before recordOfficialRun can overwrite it.
            let priorPbTime: number | null = null;
            let diamondJustMastered = false;

            if (this.currentOfficialTrackId) {
              priorPbTime = LeaderboardManager.getInstance().getRecordSummary(
                this.currentOfficialTrackId
              ).pbTime;
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
              // First DIAMOND on this official track == the signal is mastered.
              diamondJustMastered =
                results.rank === 'DIAMOND' &&
                masteryBefore.summary.diamond < masteryAfter.summary.diamond;
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
                // Custom audio earns its own completion reward, but it MUST NOT
                // create a Signal Drop: drops are reserved for the first
                // DIAMOND on a unique official Signal Pack track.
                CustomAudioRewardService.getInstance().claimReward(fp);
              }
            }

            // A WATCH REPLAY button is only meaningful when a first-person
            // replay actually exists. Never offer an action that silently does
            // nothing (custom audio and non-canonical maps record no replay).
            this.ui.resultsScreen.setReplayAvailable(this.hasLocalReplay());
            const pbGhost = this.resolvePbGhostAvailable(this.currentOfficialTrackId);
            if (this.friendRaceWorld && this.currentOfficialTrackId) {
              this.ui.importScreen.racePanel.setRunFeedback({
                rank: results.rank,
                time: results.completionTime,
                priorPbTime,
                isNewPb: !isOvertime && results.rank !== 'UNRANKED' && (priorPbTime === null || results.completionTime < priorPbTime),
                diamondJustMastered
              });
            }
            this.ui.resultsScreen.showResults(
              results,
              this.currentTrack.seed,
              { rivalDelta, isNewPB },
              this.currentAnalysis.filename || 'PLAYHEAD TRACK',
              { isOvertime, overtimeDuration },
              { dropsAwarded, bestDropRank, registered: authService.isRegisteredAccount() },
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
                : undefined,
              {
                priorPbTime,
                diamondJustMastered,
                pbGhostAvailable: pbGhost.available,
                pbGhostLabel: pbGhost.label
              }
            );

            // WORLD SUBMISSION: runs independently of the results screen so the
            // player is never blocked, and reports the REAL outcome as it lands.
            this.invalidateResultCompetition();
            const boardToken = this.resultBoardToken;
            this.lastSubmissionState = { state: 'SUBMITTING' };
            if (this.currentOfficialTrackId) {
              const boardTrackId = this.currentOfficialTrackId;
              // ONE event-driven board fetch per eligible finish, chained AFTER
              // the submission settles so the player's own position is accurate.
              // Never for overtime/unranked (their time is not comparable) and
              // never for a non-canonical map (no canonical identity).
              const boardIdentity = !isOvertime && results.rank !== 'UNRANKED'
                ? this.fullMapIdentity()
                : null;
              void this.submitOfficialRun(results, officialInfo?.candidate).finally(() => {
                if (boardIdentity) void this.refreshResultCompetition(boardTrackId, boardIdentity, boardToken);
              });
            } else {
              this.lastSubmissionState = { state: 'NOT_OFFICIAL' };
            }
          }
          if (this.friendRaceWorld && this.raceFinishReported) {
            this.ui.resultsScreen.hide();
            this.ui.raceHud.show();
            this.audioEngine.play(Math.max(0, (this.raceNowMs() - (this.raceStartAtMs ?? this.raceNowMs())) / 1000));
          }
          break;

        case GameState.REPLAY:
          this.ui.hideAllScreens();
          this.cameraController.unlock();
          // Local WATCH returns to its existing report; leaderboard WATCH returns to the menu.
          this.replayReturnState = prevState === GameState.FINISHED ? GameState.FINISHED : GameState.IMPORT;
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

  /**
   * Canonical playback preparation for WATCH.
   *
   * Reuses the existing official-track load path (which restores the baked
   * preset audio buffer + frozen world + route) so the replay is presented
   * against exactly the map it was recorded on. Idempotent: it is a no-op when
   * the requested official track is already loaded as the canonical map, so it
   * never regenerates the level or disturbs an in-progress run.
   */
  private async prepareCanonicalPlayback(trackId: string): Promise<boolean> {
    if (
      !this.stateMachine.is(GameState.IMPORT) &&
      this.currentOfficialTrackId === trackId &&
      this.currentTrackCanonical &&
      this.currentMapIdentity() !== null
    ) {
      return true;
    }

    const entry = MusicPack.getTrackById(trackId);
    if (!entry) return false;

    await this.handleCatalogTrackSelected(entry);

    // READY + a matching canonical identity is the evidence that preparation
    // actually restored the frozen map; anything else is a failed load.
    return (
      this.stateMachine.is(GameState.READY) &&
      this.currentOfficialTrackId === entry.id &&
      this.currentTrackCanonical &&
      this.currentMapIdentity() !== null
    );
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
    // Any track change (retry, next signal, custom audio, menu selection)
    // supersedes a result-board fetch still in flight.
    this.invalidateResultCompetition();
    try {
      this.currentOfficialTrackId = trackEntry.id;
      this.currentCustomAudioBuffer = null;
      // Official Signal Pack courses are PLAYHEAD; a surf selection can never leak
      // its identity into an official run.
      this.currentCourseType = DEFAULT_COURSE_TYPE;
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
        // The catalog id here is TRUSTED (arrived from a real official track
        // selection), so the world can resolve the correct official profile.
        this.world.loadTrack(
          precomputed.analysis,
          precomputed.track,
          this.environment,
          trackEntry.id
        );
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

  private async handleFileSelected(file: File, courseType: CourseType = DEFAULT_COURSE_TYPE): Promise<void> {
    try {
      this.currentOfficialTrackId = null;
      this.currentCourseType = normalizeCourseType(courseType);
      this.isFirstContactCourse = false;
      this.stateMachine.transitionTo(GameState.ANALYSING);
      this.ui.analysisScreen.setTrackTitle(file.name);
      this.ui.analysisScreen.setStage('[SIGNAL] INPUT RECEIVED', 0.02);

      const { buffer, filename, encodedBytes } = await AudioLoader.loadFromFile(file);
      this.currentCustomAudioBuffer = buffer;
      this.ui.analysisScreen.setStage('[AUDIO] PCM DECODED', 0.08);
      await this.processBuffer(buffer, filename, {
        custom: { source: 'FILE', encodedBytes: encodedBytes },
        courseType: this.currentCourseType
      });
    } catch (err: unknown) {
      this.currentCustomAudioBuffer = null;
      this.reportCustomImportError(err);
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
      await this.processBuffer(buffer, title, {
        custom: { source: 'DEV', encodedBytes: null }
      });
    } catch (err: unknown) {
      this.reportCustomImportError(err);
      this.stateMachine.transitionTo(GameState.IMPORT);
    }
  }

  /**
   * Compact, user-facing custom-import error. Never surfaces raw decoder
   * messages or stack traces; the existing import page remains the retry path.
   */
  private reportCustomImportError(err: unknown): void {
    const raw = err instanceof Error ? err.message : '';
    let message = 'CUSTOM AUDIO COULD NOT BE ANALYSED — CHOOSE ANOTHER FILE';
    if (/too short/i.test(raw)) {
      message = 'SIGNAL TOO SHORT — MINIMUM 1 SECOND OF AUDIO REQUIRED';
    } else if (/unsupported|decode|format/i.test(raw)) {
      message = 'UNSUPPORTED OR UNREADABLE AUDIO — TRY WAV, MP3, OGG OR FLAC';
    }
    console.error('[CUSTOM AUDIO] import failed:', raw || err);
    this.ui.importScreen.setCustomStatus(message, 'error');
  }

  private async processBuffer(
    buffer: AudioBuffer,
    filename: string,
    options?: {
      custom?: { source: CustomSourceMeta['source']; encodedBytes?: ArrayBuffer | null };
      courseType?: CourseType;
    }
  ): Promise<void> {
    const isCustom = options?.custom != null;
    const courseType: CourseType = normalizeCourseType(options?.courseType);
    this.currentCourseType = courseType;
    if (isCustom) this.ui.importScreen.setCustomStatus(null);

    await this.audioEngine.init();
    this.audioEngine.setBuffer(buffer);

    // Compute content identity BEFORE analysis so a cache hit can skip the
    // expensive DSP entirely. The identity is handed to the analyzer so the
    // bytes are hashed exactly once.
    const identity = isCustom
      ? await computeCustomContentIdentity(buffer, options!.custom!.encodedBytes ?? null)
      : null;

    this.ui.analysisScreen.setStage('[DSP] PREPARING ANALYSIS', 0.1);

    let analysis: TrackAnalysis;
    let track: GeneratedTrack;
    if (identity) {
      const resolved = await resolveCustomAudioLevel(
        buffer,
        filename,
        identity,
        options!.custom!,
        { analyze: AudioAnalyzer.analyze, generate: (value, type) => TrackGenerator.generate(value, type) },
        courseType,
        (stage, progress) => this.ui.analysisScreen.setStage(stage, 0.1 + progress * 0.68)
      );
      analysis = resolved.analysis;
      track = resolved.track;
      this.ui.analysisScreen.setStage(
        courseType === 'SURF' ? (resolved.cacheHit ? '[MAP] CACHED SURF PHRASES RESTORED' : '[MAP] SURF PHRASES') : (resolved.cacheHit ? '[MAP] CACHED MOVEMENT PHRASES RESTORED' : '[MAP] MOVEMENT PHRASES'),
        0.82
      );
    } else {
      analysis = await AudioAnalyzer.analyze(buffer, filename, (stage, progress) => {
        this.ui.analysisScreen.setStage(stage, 0.1 + progress * 0.68);
      });
      this.ui.analysisScreen.setStage(courseType === 'SURF' ? '[MAP] SURF PHRASES' : '[MAP] MOVEMENT PHRASES', 0.82);
      track = TrackGenerator.generate(analysis, courseType);
    }

    this.currentAnalysis = analysis;
    this.ui.applyAccent(analysis.visualAccent);
    this.environment.setAccent(analysis.visualAccent);
    this.currentTrack = track;
    // Honest timing: a short clip that cannot contain a safe start/finish is
    // reported as a limitation instead of claiming a before-song finish. The
    // competitive run itself is unchanged; this only sets player-facing copy.
    if (isCustom) {
      const timing = estimateRouteTiming(track, analysis);
      if (!timing.fitsSong) {
        this.ui.analysisScreen.addStageLog(
          `[TIME] COURSE ESTIMATE ${Math.ceil(timing.planningBudgetSeconds)}s // OVERTIME MAY BE NEEDED`
        );
      }
    }
    this.ui.analysisScreen.setStage('[ROUTE] TRAVERSAL VALIDATED', 0.9);
    this.ui.analysisScreen.setStage('[WORLD] SYNTHESIZING SPACE', 0.94);
    // Custom audio / tutorial / lab: no official catalog id, so the world uses
    // the fallback profile. A filename is never trusted to select an official one.
    this.world.loadTrack(analysis, this.currentTrack, this.environment, this.currentOfficialTrackId);
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

    // Perf pass: compile the loaded world's shader programs during this
    // existing load/prepare stage so late-revealed structures do not cause a
    // first-visible shader-compile hitch mid-run.
    this.environment.prewarmShaders();
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

    // Friend race: report the finish crossing to the shared race authority.
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
      const academy = this.movementLab?.getAcademy();
      if (academy) {
        // The ONLY automatic academy restore: the authoritative void boundary.
        // Numeric corruption remains a separate emergency recovery path.
        if (reason === RestoreReason.NORMAL_VOID) academy.reportVoidRestore();
        else academy.retryCurrent();
        this.playerController.isRestoring = false;
        this.isRestoringCheckpoint = false;
        return;
      }
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
    // COMPETITIVE: during a friend race, tap-R is a CHECKPOINT RESTORE only. A
    // full quick-restart would zero the run timer and retry a fresh attempt, and
    // that attempt must be announced with race_report_attempt_start (only valid
    // while RUNNING). Rather than start an untracked attempt, the manual restore
    // is ignored until the race is actually RUNNING.
    if (this.friendRaceWorld && this.racePhase !== 'RACING') {
      this.ui.raceHud.showNotice('WAITING FOR SHARED START');
      return;
    }
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

        // COMPETITIVE: never rewind the shared audio/timer timeline. The
        // position-only restore below keeps the race timer and song on the
        // authoritative epoch; solo runs keep the classic checkpoint seek.
        if (!this.friendRaceWorld) this.audioEngine.seek(this.currentCheckpoint.time);
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
        if (!this.friendRaceWorld) this.audioEngine.seek(0);
      }

      this.playerController.setPosition(spawnPos);
      this.finishGateDetector.resetMotion(spawnPos);
      this.playerController.setOrientation(spawnYaw);
      this.playerController.lastTouchedSurfaceType = 'PLATFORM';
      this.playerController.resetKeys();

      // RESET/RESTORE SPEED: resume a CHECKPOINT restore with ~500 displayed
      // speed units (~12.5 m/s) horizontally, along the route's forward
      // direction, so recovery flows back into gameplay instead of a dead stop.
      // Deliberately NOT applied to a level-start restore: an initial race start
      // must keep zero speed. Applied exactly once; physics owns every frame after.
      if (hadCheckpoint) {
        this.playerController.applyRestoreVelocity(
          spawnYaw,
          PlayerController.CHECKPOINT_RESTORE_SPEED_UNITS
        );
      }

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

    // A restart without a loaded track has nothing to restart. Fall back to the
    // menu instead of stranding the machine in FINISHED with a frozen run
    // (prepareTrackForRun returns early on an empty route, so the restart would
    // otherwise silently do nothing).
    if (!this.currentTrack || !this.currentAnalysis || this.currentTrack.route.length === 0) {
      this.isQuickRestarting = false;
      this.returnToImport();
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
    this.invalidateResultCompetition();
    this.ui.hud.show();
    this.ui.hud.setRestartHoldProgress(null);

    this.isFinished = false;
    this.audioEngine.play(0);
    this.replayRecorder.start();
    // A RETRY is a fresh attempt: begin a new POV recording so this run has its
    // own WATCH payload. The PLAYING transition deliberately skips recording
    // when isQuickRestarting is set, so the restart must start it here.
    this.startPovRecording();
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
    this.invalidateResultCompetition();
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
    // Leaving the world clears any Armory preview override so a stale ephemeral
    // skin can never outlive the screen that set it, and releases any equipped
    // ARTIFACT video so an offscreen menu never keeps decoding it.
    this.ui.importScreen.clearArmoryPreview();
    KarambitSkinSystem.getInstance().suspendActiveVideo();
    this.stateMachine.transitionTo(GameState.IMPORT);
  }

  private setupInputHandlers(): void {
    // Academy lesson selection must reach us before the controller's Lab-only
    // 1/2/3 calibration shortcuts, which would otherwise change the preset.
    window.addEventListener('keydown', (e) => {
      if (!this.movementLab?.isAcademyMode() || !/^Digit[1-3]$/.test(e.code)) return;
      e.stopImmediatePropagation();
      const target = e.target;
      if (target instanceof HTMLElement &&
          (target.isContentEditable || target.matches('input, textarea, select'))) return;
      e.preventDefault();
      this.handleAcademyKey(e);
    }, true);
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
      // In-game race READY consumes SPACE only while the race is staged.
      if (this.handleRaceReadyKey(e)) return;
      // FINISH spectator NEXT / PREV consumes the arrow keys only after we
      // have finished (or DNF'd); live movement keys are never intercepted.
      if (this.handleSpectateKey(e)) return;
      // MOVEMENT ACADEMY dedicated controls (only while a live lesson is
      // running, never while paused or with a modal open).
      if (this.handleAcademyKey(e)) return;
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
          // ESC is the same exit as the overlay button: release the replay
          // (audio, glove/knife preview, ghost) instead of a partial transition
          // that would leave those resources held while the report is shown.
          this.exitPovReplay();
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

  /**
   * MOVEMENT ACADEMY keys. Returns true when the event was consumed so Lab
   * cheat keys and presets never fire mid-lesson. Retry ([R]) is intentionally
   * NOT handled here: the approved PlayerController R path already routes to
   * the Academy retry via MovementLab.resetPlayer, so there is no duplicate.
   */
  private handleAcademyKey(e: KeyboardEvent): boolean {
    const academy = this.movementLab?.getAcademy();
    if (!academy) return false;
    if (this.stateMachine.is(GameState.PAUSED)) return false;
    if (
      this.ui.armoryModal.isVisible() ||
      this.ui.settingsModal.isVisible() ||
      this.ui.movementLabSongModal.isVisible()
    ) {
      return false;
    }

    if (e.repeat) return true;

    switch (e.code) {
      case 'KeyX':
        e.preventDefault();
        this.returnToImport();
        return true;
      case 'KeyK':
        e.preventDefault();
        academy.skipCurrent();
        return true;
      case 'KeyL':
        e.preventDefault();
        academy.movementLabCallback?.();
        return true;
      case 'KeyT':
        e.preventDefault();
        academy.replayAcademy();
        return true;
      case 'Enter':
        e.preventDefault();
        this.movementLab?.onAcademySignalPack?.();
        return true;
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
      case 'Digit4':
      case 'Digit5': {
        e.preventDefault();
        academy.selectLessonByIndex(Number(e.code.slice(5)) - 1);
        return true;
      }
      default:
        return false;
    }
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
        // ONLINE RACE: until GO the player is staged on the start platform and
        // the run timer does not advance, so both clients start from the same
        // authoritative zero. Physics owns every frame after GO.
        if (this.raceActive && this.racePhase !== 'RACING' && !this.isFinished) {
          this.holdForRaceStart();
          const songTime = this.audioEngine.getCurrentTime();
          this.world.update(songTime, this.playerController.position, this.cameraController.yaw, dt, this.environment);
          this.viewmodelController.setAudioLevels(
            this.world.visualController.state.energy,
            this.world.visualController.state.onsetPulse,
            this.world.visualController.state.bass
          );
        } else if (!this.isFinished) {
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
        // Academy observes the SAME authoritative fixed tick: a bhop landing +
        // immediately-buffered jump is never missed by render sampling.
        const academy = this.movementLab?.getAcademy();
        academy?.update(dt);
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
      this.updateSpectatorCamera(frameDelta);

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
      if (this.devOverlay.visible) {
        this.devOverlay.update(this.playerController, this.world, this.audioEngine, this.environment, this.smoothedFps, this.movementFeedback.state, this.gateDiagnostics(), this.raceGhostDiagnostics());
      }

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
    } else if (this.stateMachine.is(GameState.FINISHED) && this.friendRaceWorld) {
      this.updateRace(frameDelta);
      this.updateRaceGhost(frameDelta);
      this.updateSpectatorCamera(frameDelta);
      this.world.update(this.audioEngine.getCurrentTime(), this.environment.camera.position, 0, frameDelta, this.environment);
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
      if (this.devOverlay.visible) {
        this.devOverlay.update(this.playerController, this.world, this.audioEngine, this.environment, this.smoothedFps, this.movementFeedback.state, this.gateDiagnostics(), this.raceGhostDiagnostics());
      }
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
    } else if (this.stateMachine.is(GameState.REPLAY) && this.replayMode === 'POV') {
      // updatePovReplay already applied the recorded loadout and pose this frame.
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

    // REMOTE RACER GHOSTS: one translucent signal body PER remote participant,
    // keyed by stable userId, in the existing scene. Presentation only.
    this.raceGhosts = new RemoteRacerGhosts(this.environment.scene);
    this.raceGhosts.setEffectScale(this.environment.effectProfile.additiveScale);

    // DEV-only remote-opponent probes (F3). They bypass the ghost visual to
    // separate "wrong transform/scene" from "wrong rendering".
    this.devOverlay.onRaceProbeChange = (state) => {
      this.raceGhosts?.setDebugMarker(state.marker);
      this.raceGhosts?.setDebugOffset(state.offset);
      this.raceGhosts?.setForceVisible(state.force);
    };

    const racePanel = this.ui.importScreen.racePanel;
    const leaderboardPanel = this.ui.importScreen.leaderboardPanel;

    racePanel.setCallbacks({
      onCreateRoom: (trackId, capacity) => void this.createRaceRoom(trackId, capacity),
      onJoinRoom: (code) => void this.joinRaceRoom(code),
      onSetReady: (ready) => {
        void raceRoomService.setReady(ready).then((result) => {
          // The lobby reflects the SERVER's answer, and reports a real failure.
          this.ui.importScreen.racePanel.setReadyResult(result.ok, result.detail);
          if (!result.ok) console.warn('[RACE] ready update failed:', result.detail);
        });
      },
      onLeaveRoom: () => void this.leaveRaceRoom(),
      onRematch: () => this.handleRaceRematch(),
      onReturnToLobby: () => {
        void raceRoomService.returnToLobby().then(result => {
          if (result.ok) this.returnToRaceLobby();
          else this.ui.importScreen.racePanel.showError(result.detail);
        });
      },
      onHostPickTrack: (trackId) => void this.hostPickRaceTrack(trackId),
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
      // Once a session exists, reconcile account identity and any world-record
      // prestige award the server created for this account.
      if (status.state === 'SYNCED' || status.state === 'MIGRATED') {
        void authService.refreshAccountIdentity().then(() => this.refreshLocalIdentity());
        void this.refreshWorldRecordRewards();
      }
    });
    this.refreshOnlineStatus();
    this.refreshLocalIdentity();

    // Race room callbacks.
    raceRoomService.setCallbacks({
      onRoomUpdate: (room, players) => {
        this.racePresentIds.clear();
        const myId = authService.getUserId();
        for (const racer of players) {
          if (racer.userId === myId) continue;
          this.racePresentIds.add(racer.userId);
          this.raceGhosts?.setRemotePresent(racer.userId, racer.connected);
        }
        this.raceGhosts?.retainOnly(this.racePresentIds);
        const panelRef = this.ui.importScreen.racePanel;
        panelRef.setHost(raceRoomService.isHost());
        panelRef.renderLobby(room, players, raceRoomService.getInviteUrl() ?? '', authService.getUserId(), this.raceIdentities);
    // Identity is fetched lazily and only while a lobby is actually open.
    void this.refreshRaceIdentities();
        // AUTHORITATIVE PHASE: both clients react to the SAME room state. No
        // client self-starts the race and no manual EXEC SONG is involved.
        this.onRacePhase(room, players);
      },
      onGhost: (sample) => this.onRemoteGhostSample(sample),
      onPlayerJoined: (player) => {
        this.ui.raceHud.showNotice(`${player.displayName} // JOINED`);
      },
      onPlayerLeft: (userId) => {
        // Positive evidence: that racer left the room. Remove their ghost at
        // once rather than waiting for the presence grace period.
        this.raceGhosts?.markRemoteLeft(userId);
        this.rivalProgress.delete(userId);
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
      panel.render({ trackId, entries: [], you: null, nextAbove: null, offline: true }, title);
      return;
    }
    const identity = computeMapIdentity(trackId, level.track, level.analysis);
    const view = await leaderboardService.fetchLeaderboard(trackId, identity);
    panel.render(view, title);
  }

  /**
   * One event-driven board fetch for the JUST-FINISHED official run.
   *
   * Called after the world submission has settled, so the player's own position
   * is accurate. The response is discarded when the token is stale or the screen
   * has moved on, so a slow reply can never overwrite a later run's context. The
   * fetched entries are also cached on the leaderboard panel so the results
   * RACE GHOST action can resolve a run id without a second fetch. Offline or
   * empty responses simply hide the competition block — no rank is invented.
   */
  private async refreshResultCompetition(trackId: string, identity: MapIdentity, token: number): Promise<void> {
    const isCurrent = () => token === this.resultBoardToken &&
      this.stateMachine.is(GameState.FINISHED) && this.currentOfficialTrackId === trackId &&
      !this.friendRaceWorld && !this.ui.resultsScreen.element.classList.contains('hidden');
    if (!isCurrent()) return;
    try {
      const view: LeaderboardView = await leaderboardService.fetchLeaderboard(trackId, identity);
      if (!isCurrent()) return;

      if (view.offline || !view.you || !Number.isFinite(view.you.timeUs) || view.you.timeUs <= 0) {
        this.ui.resultsScreen.setCompetitionContext(null);
        return;
      }

      // Prime the run lookup cache only; the panel is not rendered here.
      this.ui.importScreen.leaderboardPanel.setEntries(view.entries);

      const above = view.nextAbove;
      const gapUs = above ? competitionGapUs(view.you.timeUs, above.timeUs) : null;
      this.ui.resultsScreen.setCompetitionContext({
        position: view.you.position,
        timeUs: view.you.timeUs,
        nextAbove: above && gapUs !== null
          ? {
              rankPosition: above.rankPosition,
              displayName: above.displayName,
              timeUs: above.timeUs,
              gapUs,
              runId: above.runId,
              raceable: above.verificationState === 'accepted' && above.replayVersion === POV_REPLAY_VERSION &&
                !!above.replayPath && !!above.replayHash && !!above.runId
            }
          : null
      });
    } catch {
      if (!isCurrent()) return;
      this.ui.resultsScreen.setCompetitionContext(null);
    }
  }

  /**
   * Invalidates any pending/visible result-screen competition and hides it. Used
   * whenever the run/screen changes (retry, next signal, custom audio, track
   * selection, menu return, a new finish) so a late async reply cannot attach
   * the previous run's position to the current report.
   */
  private invalidateResultCompetition(): void {
    this.resultBoardToken++;
    this.ui.resultsScreen.setCompetitionContext(null);
  }

  // -- race lifecycle -------------------------------------------------------

  private async createRaceRoom(trackId: string, capacity?: number): Promise<void> {
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
      identity,
      capacity
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

  /**
   * RESULT-SCREEN callbacks. REMATCH resets the room server-side and bumps the
   * race instance; RETURN TO LOBBY also resets the authoritative room.
   */
  private async handleRaceRematch(): Promise<void> {
    const result = await raceRoomService.requestRematch();
    if (!result.ok) {
      this.ui.importScreen.racePanel.showError(`REMATCH FAILED // ${result.detail.toUpperCase()}`);
      return;
    }
    this.ui.importScreen.racePanel.setRematchNote('REMATCH READY // ALL RACERS RESET');
    this.returnToRaceLobby();
  }

  private returnToRaceLobby(): void {
    this.raceLoadGeneration++;
    const room = raceRoomService.getRoom();
    if (!room) {
      this.ui.importScreen.racePanel.showSelect();
      return;
    }
    this.raceActive = false;
    this.raceLoading = false;
    this.raceGoArmed = false;
    this.raceInGameReady = false;
    this.raceLoadReported = false;
    this.racePhase = 'WAITING';
    this.raceStartAtMs = null;
    this.raceResultsShownForRaceId = null;
    this.ui.raceHud.setCountdown(null);
    this.ui.raceHud.hide();
    this.clearRaceGhosts();
    this.setFriendRaceWorld(false);
    if (this.stateMachine.is(GameState.COUNTDOWN) || this.stateMachine.is(GameState.PLAYING) || this.stateMachine.is(GameState.FINISHED)) {
      this.stateMachine.transitionTo(GameState.IMPORT);
    }
    const panel = this.ui.importScreen.racePanel;
    panel.clearError();
    panel.showLobby();
    panel.setHost(raceRoomService.isHost());
    panel.renderLobby(
      room,
      raceRoomService.getPlayers(),
      raceRoomService.getInviteUrl() ?? '',
      authService.getUserId(),
      this.raceIdentities
    );
  }

  /** Host: picks the OFFICIAL track while the room is still in LOBBY. */
  private async hostPickRaceTrack(trackId: string): Promise<void> {
    const level = await PresetLevelCache.loadPreset(trackId);
    if (!level) {
      this.ui.importScreen.racePanel.showError('CANONICAL MAP UNAVAILABLE FOR THIS SIGNAL');
      return;
    }
    const title = SignalPackCatalog.getTrackById(trackId)?.title ?? trackId;
    const identity = computeMapIdentity(trackId, level.track, level.analysis);
    const result = await raceRoomService.selectTrack(trackId, title, identity);
    if (!result.ok) {
      this.ui.importScreen.racePanel.showError(`TRACK SELECT FAILED // ${result.detail.toUpperCase()}`);
      return;
    }
    this.returnToRaceLobby();
  }

  /**
   * ONE authoritative phase handler, driven by the room's own state.
   *
   * LOADING   -> both clients auto-load the selected track (no EXEC SONG)
   * IN_GAME   -> the level is loaded; clients report CLIENT_LOADED and show the
   *              in-game WAITING/READY stage
   * COUNTDOWN -> the shared GO timestamp is known; the synchronized countdown
   *              and the single race timeline are armed
   * RUNNING   -> the race timeline is live
   */
  private onRacePhase(room: RaceRoom, players: readonly RacePlayer[]): void {
    if (room.state === 'EXPIRED' || room.expiresAtMs < raceRoomService.getAuthoritativeNowMs()) {
      void this.leaveRaceRoom().then(() => this.ui.importScreen.racePanel.showError('ROOM EXPIRED // CREATE A NEW RACE'));
      return;
    }
    if (this.currentRaceInstanceId !== room.raceId) {
      const previous = this.currentRaceInstanceId;
      this.currentRaceInstanceId = room.raceId;
      if (previous !== null) this.returnToRaceLobby();
    }
    // ADOPT THE AUTHORITATIVE CLOCK. The service derives this offset from the
    // server now() returned with the room; re-reading it on every room update
    // keeps the countdown, timer, song and results on ONE shared timeline.
    this.raceClockOffsetMs = raceRoomService.getServerClockOffsetMs();
    switch (room.state) {
      case 'LOADING':
        if (!this.raceActive && !this.raceLoading) {
          void this.beginRaceFromSchedule(room.startAtMs ?? this.raceNowMs());
        } else if (this.raceActive && !this.raceLoading && !this.raceLoadReported) {
          void this.reportRaceLoaded(this.raceLoadGeneration);
        }
        break;

      case 'IN_GAME':
        // DEFENSIVE: if this client missed the LOADING broadcast (throttled tab,
        // dropped socket) it still auto-loads here rather than sitting outside
        // the readiness set forever.
        if (!this.raceActive && !this.raceLoading) {
          void this.beginRaceFromSchedule(room.startAtMs ?? this.raceNowMs());
          break;
        }
        if (this.raceActive && !this.raceLoadReported) {
          void this.reportRaceLoaded(this.raceLoadGeneration);
        }
        if (this.friendRaceWorld) {
          const local = players.find(p => p.userId === authService.getUserId());
          this.raceInGameReady = local?.inGameReady ?? false;
          this.raceGoArmed = false;
          this.raceStartAtMs = null;
          this.racePhase = this.raceInGameReady ? 'READY' : 'WAITING';
          this.updateRaceHudPhase();
        }
        break;

      case 'COUNTDOWN':
        if (room.startAtMs !== null) this.armRaceGo(room.startAtMs);
        break;

      case 'RUNNING':
        // MISSING-COUNTDOWN SAFETY: if this client never observed the COUNTDOWN
        // broadcast (dropped/throttled socket) but the room is already RUNNING,
        // arm the shared start from the authoritative start_at_ms now, so the
        // song, timer and results still share ONE timeline with the opponent.
        if (this.raceActive && !this.raceFinishReported && this.racePhase !== 'RACING' && room.startAtMs !== null) {
          this.armRaceGo(room.startAtMs);
        }
        break;

      default:
        break;
    }

    // A disconnect before the race is live reverts the room. Abort cleanly so
    // the remaining player is never frozen in a broken race state.
    if (
      this.raceActive &&
      this.racePhase !== 'RACING' &&
      room.state === 'LOBBY'
    ) {
      this.returnToRaceLobby();
    }

    // FAILED LOAD / DISCONNECT DURING THE RACE WORLD: if the opponent is gone
    // while we are still staged (never reached GO), leave the session cleanly so
    // the remaining player is not frozen in a dead gameplay scene.
    if (
      this.raceActive &&
      this.racePhase !== 'RACING' &&
      (room.state === 'LOADING' || room.state === 'IN_GAME' || room.state === 'COUNTDOWN')
    ) {
      const myId = authService.getUserId();
      const remaining = players.filter(p => p.connected && p.userId !== myId);
      if (remaining.length === 0) {
        this.returnToRaceLobby();
        this.ui.importScreen.racePanel.showError('RACE ABORTED // NOT ENOUGH CONNECTED RACERS');
      }
    }
    void players;
  }

  /** Authoritative race time: this browser clock corrected by the server offset. */
  private raceNowMs(): number {
    return Date.now() + this.raceClockOffsetMs;
  }

  /**
   * Arms the ONE synchronized GO for this race. Every client derives the same
   * 3-2-1-GO and the same song position from the SAME server timestamp; there
   * are never two independent local countdowns.
   */
  private armRaceGo(startAtMs: number): void {
    if (!this.raceActive || this.raceGoArmed) return;
    this.raceGoArmed = true;
    this.raceStartAtMs = startAtMs;
    this.racePhase = 'COUNTDOWN';

    if (this.friendRaceWorld) {
      // COMPETITIVE: the session timeline is the SHARED epoch. Do NOT seek the
      // audio here - a seek would rewind the shared timeline and desync audio
      // from the timer and finish result. The song is started at the
      // epoch-derived position at GO (onRaceGo), so audio/timer/results agree.
      // COMPETITIVE START IS SONG ZERO: never a checkpoint time, so both clients
      // begin the shared song from the same origin.
      this.raceSongStartSec = 0;
      this.ui.raceHud.showNotice('SYNCHRONIZED START // 2 1 GO');
    } else {
      const target = this.currentCheckpoint ? this.currentCheckpoint.time : 0;
      this.audioEngine.seek(target);
      this.raceSongStartSec = this.audioEngine.getCurrentTime();
      this.ui.raceHud.showNotice('SYNCHRONIZED START // 3 2 1 GO');
    }

    this.updateRaceHudPhase();
    const tick = (): void => {
      if (!this.raceActive || this.racePhase === 'RACING') return;
      const current = raceRoomService.getRoom();
      if (!current || current.startAtMs !== startAtMs || (current.state !== 'COUNTDOWN' && current.state !== 'RUNNING')) return;
      // AUTHORITATIVE remaining time, never a raw local Date.now(): a throttled
      // or late client still counts down to the SAME server instant.
      const remaining = this.raceStartAtMs! - this.raceNowMs();
      if (remaining <= 0) {
        this.onRaceGo();
        return;
      }
      this.ui.raceHud.setCountdown(Math.ceil(remaining / 1000));
      window.setTimeout(tick, 60);
    };
    tick();
  }

  /**
   * The shared GO instant. Both players become controllable at the same
   * authoritative moment and the song/timer start from the same zero.
   */
  private onRaceGo(): void {
    const room = raceRoomService.getRoom();
    if (!this.raceActive || this.raceFinishReported || this.racePhase === 'RACING') return;
    if (!room || (room.state !== 'COUNTDOWN' && room.state !== 'RUNNING') || room.startAtMs !== this.raceStartAtMs) return;
    this.racePhase = 'RACING';
    this.updateRaceHudPhase();
    this.ui.raceHud.setCountdown(null);

    // LATE-DELIVERY CORRECTION: how long ago the SHARED GO instant actually
    // passed. If the rAF loop, the tab or the scheduler did not fire on the
    // exact millisecond — or this client learned the timestamp late — the race
    // timer and the song both start already advanced by that amount, so every
    // client shares ONE elapsed timeline instead of restarting from zero.
    const lateSec = this.raceStartAtMs !== null
      ? Math.max(0, (this.raceNowMs() - this.raceStartAtMs) / 1000)
      : 0;
    const songTarget = this.raceSongStartSec + lateSec;

    // Song, run timer and replay recording all start from the SAME position.
    this.runElapsedTime = songTarget;
    this.audioEngine.play(songTarget);
    this.replayRecorder.start();
    this.startPovRecording();
    this.ghostManager.start();

    this.playerController.isRestoring = false;
    this.playerController.resetKeys();
    this.ui.raceHud.showNotice('GO');

    // The RPC sets the server's authorized-write flag itself, so the guard
    // accepts the COUNTDOWN -> RUNNING transition. Report honestly if it fails.
    void raceRoomService.markRunning().then((r) => {
      if (!r.ok) this.ui.raceHud.showNotice(`RUNNING FLAG FAILED // ${r.detail}`);
    });
  }

  /** Holds the player staged on the start platform until GO. */
  private holdForRaceStart(): void {
    this.playerController.velocity.set(0, 0, 0);
  }

  /** In-game READY can be pressed with SPACE (or the on-screen HUD prompt). */
  private handleRaceReadyKey(e: KeyboardEvent): boolean {
    if (!this.friendRaceWorld || !this.raceActive) return false;
    if (this.racePhase !== 'WAITING' && this.racePhase !== 'READY') return false;
    if (e.code === 'Space') {
      e.preventDefault();
      void this.signalInGameReady();
      return true;
    }
    return false;
  }

  /** IN-GAME READY: the SECOND ready stage. */
  private async signalInGameReady(): Promise<void> {
    if (!this.raceActive || this.raceInGameReady) return;
    if (this.racePhase !== 'WAITING' && this.racePhase !== 'READY') return;
    // SECOND READINESS GATE: the opponent must actually EXIST in the room and
    // this client must have RECEIVED their spawn transform, otherwise a client
    // could ready into a countdown with an invisible / absent opponent.
    const readyGate = this.opponentSpawnReceived();
    if (!readyGate.ok) {
      this.ui.raceHud.showNotice(readyGate.detail);
      return;
    }
    this.raceInGameReady = true;
    this.racePhase = 'READY';
    this.updateRaceHudPhase();
    const result = await raceRoomService.setInGameReady(true);
    if (!result.ok) {
      // Roll the optimistic local READY back: the server did not accept it, and
      // an unconfirmed READY would make the HUD lie about both players.
      this.raceInGameReady = false;
      this.racePhase = 'WAITING';
      this.updateRaceHudPhase();
      this.ui.raceHud.showNotice(result.detail);
    }
  }

  /**
   * In-game WAITING / READY HUD, showing EVERY racer's readiness. The race does
   * not begin until at least 2 racers are connected AND all of them are ready.
   */
  private updateRaceHudPhase(): void {
    const myId = authService.getUserId();
    const players = raceRoomService.getPlayers();
    const connected = players.filter((p) => p.connected);
    const lines = connected.map((p) => ({
      label: `${p.displayName}${p.userId === myId ? ' (YOU)' : ''} // ${
        p.inGameReady ? 'READY' : p.loaded ? 'NOT READY' : 'LOADING'
      }`,
      ready: p.inGameReady
    }));
    const plural = connected.length === 1 ? 'RACER' : 'RACERS';
    const prompt = this.raceInGameReady
      ? `WAITING FOR ${Math.max(0, connected.length - 1)} OTHER ${plural}`
      : 'PRESS [SPACE] TO READY';
    const title = this.racePhase === 'COUNTDOWN' ? 'SIGNALS LOCKED' : 'SIGNAL CHECK';
    this.ui.raceHud.setPhase({
      allLoaded: connected.length >= 2 && connected.every((p) => p.loaded),
      phase: this.racePhase,
      title,
      lines,
      prompt
    });
  }

  /**
   * Whether the opponent is genuinely present and visible: a connected room
   * member OTHER than us AND a received ghost sample (spawn transform).
   */
  private opponentSpawnReceived(): { ok: boolean; detail: string } {
    const myId = authService.getUserId();
    const players = raceRoomService.getPlayers().filter(p => p.connected);
    if (players.length < 2) return { ok: false, detail: 'WAITING FOR RACERS // NOT ENOUGH CONNECTED' };
    if (!this.raceLoadReported || players.some(p => !p.loaded)) return { ok: false, detail: 'WAITING FOR ALL RACERS TO LOAD' };
    for (const racer of players) {
      if (racer.userId === myId) continue;
      const age = raceRoomService.getRemoteRxAgeMs(racer.userId);
      if (!this.raceGhosts?.hasSample(racer.userId) || age < 0 || age > 4000) {
        return { ok: false, detail: `WAITING FOR ${racer.displayName} // SPAWN SIGNAL` };
      }
    }
    return { ok: true, detail: 'all racers visible' };
  }

  /**
   * Loads the room's canonical map, verifies identity locally, and runs the
   * shared countdown to the agreed start timestamp.
   */
  private async beginRaceFromSchedule(startAtMs: number): Promise<void> {
    if (this.raceActive || this.raceLoading) return;
    this.raceLoading = true;
    this.ui.importScreen.racePanel.setRunFeedback(null);
    // FRIEND RACE and GHOST RACE are separate lifecycles. A live multiplayer
    // session must never inherit a recorded solo ghost.
    this.clearGhostRace();
    const room = raceRoomService.getRoom();
    if (!room) { this.raceLoading = false; return; }
    const loadGeneration = this.raceLoadGeneration;

    const level = await PresetLevelCache.loadPreset(room.trackId);
    if (loadGeneration !== this.raceLoadGeneration) return;
    if (!level) {
      this.ui.importScreen.racePanel.showError('CANONICAL MAP UNAVAILABLE');
      this.raceLoading = false;
      return;
    }
    const verdict = raceRoomService.verifyLocalMap(level.track);
    if (!verdict.ok) {
      this.ui.importScreen.racePanel.setMapState('MISMATCH', verdict.detail.replace(/\n/g, ' '));
      this.ui.importScreen.racePanel.showError(verdict.detail);
      this.raceLoading = false;
      return;
    }

    this.raceStartAtMs = startAtMs;
    this.raceActive = true;
    this.raceFinishReported = false;
    this.raceLoadReported = false;
    this.raceInGameReady = false;
    this.raceGoArmed = false;
    this.racePhase = 'WAITING';
    this.raceSongStartSec = 0;

    // FRIEND RACE WORLD MODE: from here until the session ends, the remote human
    // opponent is the ONLY gameplay-world ghost. This also releases any armed
    // recorded solo ghost and publishes the local spawn transform immediately.
    this.setFriendRaceWorld(true);

    this.ui.hideAllScreens();
    this.ui.raceHud.show();
    this.ui.raceHud.showNotice('SESSION STARTING');

    // Enter the normal track flow; the shared clock starts at startAtMs.
    await this.loadPresetTrack(room.trackId);
    if (loadGeneration !== this.raceLoadGeneration || raceRoomService.getRoom()?.state === 'LOBBY' || raceRoomService.getRoom()?.state === 'EXPIRED') {
      if (!this.raceActive) this.stateMachine.transitionTo(GameState.IMPORT);
      return;
    }
    this.raceLoading = false;

    // The map load replaced the world: republish the spawn transform so the
    // opponent is visible on the start platform without moving.
    this.publishLocalGhostSample();

    // AUTO-LAUNCH: enter the staged gameplay scene. This replaces the manual
    // EXEC SONG step entirely — reaching LOADING is the instruction to load.
    this.stateMachine.transitionTo(GameState.COUNTDOWN);

    // Deterministic opponent identity: each client sees the REMOTE player in the
    // REMOTE player's colour. The host is cyan, the guest is violet, so the two
    // players are never the same colour on screen.
    // RIVAL IDENTITY: every remote racer renders in THEIR OWN stable server-
    // assigned accent (colour_index), set per userId at ghost creation. No
    // per-client override, so all viewers see the same racer in the same colour.
    void GUEST_SIGNAL_COLOR;
    void HOST_SIGNAL_COLOR;

    // LOAD GENERATION CHECK: if the race was aborted / left while the map was
    // loading, do not publish a stale CLIENT_LOADED for a world we have left.
    if (loadGeneration !== this.raceLoadGeneration) return;

    // CLIENT_LOADED: delayed replies must not abandon a newer load generation.
    this.racePhase = 'WAITING';
    this.updateRaceHudPhase();
    await this.reportRaceLoaded(loadGeneration);
  }

  private async reportRaceLoaded(loadGeneration: number): Promise<void> {
    if (loadGeneration !== this.raceLoadGeneration || this.raceLoadReported || !this.raceActive) return;
    this.raceLoadReported = true;
    const loaded = await raceRoomService.reportLoaded(true);
    if (loadGeneration !== this.raceLoadGeneration || !this.raceActive) return;
    if (!loaded.ok) {
      this.raceLoadReported = false;
      this.ui.raceHud.showNotice('LOAD REPORT RETRY // ' + loaded.detail);
    }
  }

  /**
   * LOCAL FINISH: the racer crossed the gate. The race world, the other racers
   * and the shared clock all keep running; this client switches to the FINISH
   * spectator view until the whole room is finished (or the player leaves).
   */
  private endRaceSession(): void {
    if (!this.raceActive) return;
    this.racePhase = 'FINISHED';
    this.updateRaceHudPhase();
    this.ui.raceHud.showNotice('FINISHED // SPECTATING REMAINING RACERS');
    // The ghost registry stays alive: the other racers are still moving.
    this.spectateIndex = 0;
    this.spectateUserId = null;
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
    this.raceLoadGeneration++;
    this.raceActive = false;
    this.raceLoading = false;
    this.raceGoArmed = false;
    this.raceInGameReady = false;
    this.racePhase = 'WAITING';
    this.raceStartAtMs = null;
    this.ui.raceHud.setCountdown(null);
    this.ui.raceHud.hide();
    this.clearRaceGhosts();
    // Leaving the race world restores normal solo ghost eligibility.
    this.setFriendRaceWorld(false);
    await raceRoomService.leaveRoom();
    if (this.stateMachine.is(GameState.PLAYING) || this.stateMachine.is(GameState.COUNTDOWN) || this.stateMachine.is(GameState.FINISHED)) {
      this.stateMachine.transitionTo(GameState.IMPORT);
    }
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
    this.storeLocalTransform();
    this.raceHudAccumulator += frameDelta;
    if (this.raceHudAccumulator < 0.1) return;
    frameDelta = this.raceHudAccumulator;
    this.raceHudAccumulator = 0;

    const room = raceRoomService.getRoom();
    const players = raceRoomService.getPlayers();
    const myId = authService.getUserId();
    const me = players.find((p) => p.userId === myId) ?? null;

    // AUTHORITATIVE elapsed: derived from the shared start epoch, never a local
    // countdown. Outside a running race it stays at zero.
    const raceElapsedUs = this.raceStartAtMs !== null
      ? Math.max(0, Math.round((this.raceNowMs() - this.raceStartAtMs) * 1000))
      : 0;

    this.ui.raceHud.update({
      raceElapsedUs,
      placement: this.computePlacement(players, myId),
      totalRacers: players.length,
      leaderDeltaUs: null,
      finished: this.raceFinishReported,
      myFinishTimeUs: me?.finishUs ?? null,
      dnf: me?.dnf ?? false,
      rivals: this.buildRivalViews(players, myId)
    });

    // FINISH SPECTATOR: once we have finished (or DNF'd) keep watching the
    // racers still on track. NEXT / PREV switches the followed racer; the
    // spectator camera path is applied per frame while active.
    if (this.raceFinishReported || (me?.dnf ?? false)) {
      this.spectateOrder = this.activeRivalIds(players);
      if (this.spectateOrder.length > 0) {
        if (!this.spectateUserId || !this.spectateOrder.includes(this.spectateUserId)) {
          this.spectateIndex = 0;
          this.spectateUserId = this.spectateOrder[0];
        }
      } else {
        this.spectateUserId = null;
      }
    }

    // Checkpoint progress for everyone else: ~2 Hz progress broadcast.
    this.raceProgressAccumulator += frameDelta;
    if (this.raceProgressAccumulator >= 0.5 && this.racePhase === 'RACING' && !this.raceFinishReported) {
      this.raceProgressAccumulator = 0;
      const cpIndex = this.passedCheckpoints.size;
      const cpTotal = this.currentTrack?.checkpoints.length ?? 0;
      if (cpIndex !== this.raceLastProgress) {
        this.raceLastProgress = cpIndex;
        void raceRoomService.reportProgress(cpIndex, cpTotal);
      }
    }

    // FINAL ROOM RESULTS: only once EVERY racer has finished or DNF'd.
    if (room && room.state === 'FINISHED') {
      this.maybeShowFinalResults(room, players);
    }

    // Ghost sample: presentation only. The game loop stores the latest local
    // transform EVERY active frame; RaceRoomService owns the broadcast cadence
    // and stamps the timestamp at send time. That separation is what keeps the
    // opponent visible when a background tab's animation loop is throttled.
    this.storeLocalTransform();
    this.updateSpectatorHud();
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
    const restoring = this.playerController.isRestoring;
    if (restoring && !this.raceWasRestoring) this.raceTeleportId++;
    this.raceWasRestoring = restoring;
    t.teleportId = this.raceTeleportId;
    t.x = p.x;
    t.y = p.y;
    t.z = p.z;
    t.yaw = this.cameraController.yaw;
    t.pitch = this.cameraController.pitch;
    t.vx = v.x;
    t.vy = v.y;
    t.vz = v.z;
    t.checkpointIndex = this.passedCheckpoints.size;
    t.checkpointTotal = this.currentTrack?.checkpoints.length ?? 0;
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
  /** 1-based placement by finish order (finishers), then active racers by progress. */
  private computePlacement(players: readonly RacePlayer[], myId: string | null): number | null {
    const myIndex = this.placementOrder(players).indexOf(myId ?? '');
    return myIndex < 0 ? null : myIndex + 1;
  }

  private placementOrder(players: readonly RacePlayer[]): string[] {
    const finishers = players
      .filter((p) => !p.dnf && p.finishUs !== null && p.finishUs > 0)
      .sort((a, b) => (a.finishUs! - b.finishUs!) || (a.joinedAt - b.joinedAt));
    const running = players
      .filter((p) => !p.dnf && p.finishUs === null)
      .sort((a, b) => (b.progress - a.progress) || (a.joinedAt - b.joinedAt));
    const dnf = players.filter((p) => p.dnf).sort((a, b) => a.joinedAt - b.joinedAt);
    return [...finishers, ...running, ...dnf].map((p) => p.userId);
  }

  /** Delta in us to the current leader (finish time if finished, else progress). */
  private buildRivalViews(players: readonly RacePlayer[], myId: string | null) {
    const order = this.placementOrder(players);
    const byId = new Map(players.map((p) => [p.userId, p]));
    return order
      .filter((id) => id !== myId)
      .map((id) => byId.get(id)!)
      .map((p) => ({
        userId: p.userId,
        displayName: p.displayName,
        colorIndex: p.colorIndex,
        finishTimeUs: p.finishUs,
        dnf: p.dnf,
        checkpointIndex: p.progress,
        checkpointTotal: p.checkpointTotal,
        connected: p.connected
      }));
  }

  private activeRivalIds(players: readonly RacePlayer[]): string[] {
    const myId = authService.getUserId();
    return players
      .filter((p) => p.userId !== myId && p.connected && !p.dnf && p.finishUs === null)
      .sort((a, b) => (b.progress - a.progress) || (a.joinedAt - b.joinedAt))
      .map((p) => p.userId);
  }

  /** Applies a fresh remote transform to the correct per-racer ghost. */
  private onRemoteGhostSample(sample: import('../online/RaceRoomService').GhostSample): void {
    this.raceGhosts?.setSample(sample);
    this.rivalYaw.set(sample.userId, sample.yaw);
    const racer = raceRoomService.getPlayers().find(p => p.userId === sample.userId);
    if (racer) this.raceGhosts?.setDisplayName(racer.userId, racer.displayName);
    // SPAWN VISIBILITY READINESS: remember each rival's reported checkpoint so
    // the HUD has placement data even before the next room poll returns.
    this.rivalProgress.set(sample.userId, {
      index: sample.checkpointIndex,
      total: sample.checkpointTotal
    });
  }

  /** FINISH spectator NEXT / PREV. Returns true when the key was consumed. */
  private handleSpectateKey(e: KeyboardEvent): boolean {
    if (!this.raceFinishReported && !this.playerIsDnf()) return false;
    if (this.spectateOrder.length === 0) return false;
    if (e.code !== 'ArrowRight' && e.code !== 'ArrowLeft') return false;
    e.preventDefault();
    const delta = e.code === 'ArrowRight' ? 1 : -1;
    this.spectateIndex =
      (this.spectateIndex + delta + this.spectateOrder.length) % this.spectateOrder.length;
    this.spectateUserId = this.spectateOrder[this.spectateIndex];
    return true;
  }

  private playerIsDnf(): boolean {
    const myId = authService.getUserId();
    return raceRoomService.getPlayers().find((p) => p.userId === myId)?.dnf ?? false;
  }

  /**
   * Isolated SPECTATOR camera path for a finished racer. It NEVER touches the
   * frozen movement, the finish detector or the normal first-person camera feel:
   * a completed racer cannot influence the live simulation from here.
   */
  private updateSpectatorCamera(frameDelta: number): void {
    if (!this.spectateUserId) return;
    if (!this.raceGhosts?.copyPosition(this.spectateUserId, this.spectatePosition)) return;
    const rx = this.spectatePosition;
    const speed = frameDelta > 0 ? 1 - Math.pow(0.001, frameDelta) : 1;
    const cam = this.environment.camera;
    const yaw = this.rivalYaw.get(this.spectateUserId) ?? 0;
    cam.position.x += (rx.x + Math.sin(yaw) * 3 - cam.position.x) * speed;
    cam.position.y += (rx.y + 2.2 - cam.position.y) * speed;
    cam.position.z += (rx.z + Math.cos(yaw) * 3 - cam.position.z) * speed;
    cam.lookAt(rx.x, rx.y + 1.2, rx.z);
  }

  /** Shows the final room results exactly once per race instance. */
  private maybeShowFinalResults(room: RaceRoom, players: readonly RacePlayer[]): void {
    if (this.raceResultsShownForRaceId === room.raceId) return;
    if (!isRaceComplete(players)) return;
    this.raceResultsShownForRaceId = room.raceId;
    this.showRaceResults(computeRaceResults(players));
  }

  /** Update the FINISH spectator HUD text for the followed racer. */
  private updateSpectatorHud(): void {
    if (!this.raceFinishReported && !this.playerIsDnf()) {
      this.ui.raceHud.setSpectating(null);
      return;
    }
    const target = this.spectateUserId
      ? raceRoomService.getPlayers().find((p) => p.userId === this.spectateUserId) ?? null
      : null;
    if (!target) {
      this.ui.raceHud.setSpectating(null);
      return;
    }
    const prog = this.rivalProgress.get(target.userId);
    const index = prog?.index ?? target.progress;
    const total = prog?.total ?? target.checkpointTotal;
    this.ui.raceHud.setSpectating({
      name: target.displayName,
      checkpointIndex: index,
      checkpointTotal: total
    });
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

  /** First active REMOTE racer, for the DEV overlay + READY gate diagnostics. */
  private primaryRival(): RacePlayer | null {
    const myId = authService.getUserId();
    return raceRoomService.getPlayers().find((p) => p.userId !== myId) ?? null;
  }

  /**
   * DEV snapshot of the multi-racer ghost pipeline. Read-only; the "ghost" field
   * reports a representative remote racer so the DevOverlay line keeps working.
   */
  private raceGhostDiagnostics(): RaceGhostDiagnosticState {
    const camera = this.environment.camera;
    const states = this.raceGhosts?.states() ?? [];
    const firstId = states[0]?.userId ?? null;
    const ghost = this.raceGhosts?.diagnosticsFor(firstId ?? '', Date.now(), camera) ?? null;
    const net = raceRoomService.getGhostDiagnostics();
    const rival = this.primaryRival();
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

  /**
   * READ-ONLY harness snapshot of the live race presentation.
   *
   * Exposes the REAL observable state (the actual ghost mesh visibility and
   * transform, the local controller position, the authoritative timer and the
   * audio clock) so an integration harness can assert on what is DRAWN, not on
   * callback existence. It performs no mutation.
   */
  public getRaceHarnessSnapshot(): {
    racePhase: string;
    state: string;
    raceActive: boolean;
    friendRace: boolean;
    raceStartAtMs: number | null;
    serverOffsetMs: number;
    runElapsedSec: number;
    songTimeSec: number;
    elapsedSec: number;
    inGameReady: boolean;
    ghost: ReturnType<NonNullable<RemoteRacerGhosts['diagnosticsFor']>> | null;
    ghostStagingOffset: boolean;
    ghosts: ReturnType<RemoteRacerGhosts['states']>;
    spectateUserId: string | null;
    localPosition: { x: number; y: number; z: number };
  } {
    const camera = this.environment.camera;
    return {
      racePhase: this.racePhase,
      state: String(this.stateMachine.getState()),
      raceActive: this.raceActive,
      friendRace: this.friendRaceWorld,
      raceStartAtMs: this.raceStartAtMs,
      serverOffsetMs: raceRoomService.getServerClockOffsetMs(),
      runElapsedSec: this.runElapsedTime,
      songTimeSec: this.audioEngine.getCurrentTime(),
      elapsedSec: this.raceStartAtMs !== null
        ? Math.max(0, (Date.now() + this.raceClockOffsetMs - this.raceStartAtMs) / 1000)
        : 0,
      inGameReady: this.raceInGameReady,
      ghost: this.raceGhosts?.diagnosticsFor(this.raceGhosts?.states()[0]?.userId ?? '', Date.now(), camera) ?? null,
      ghostStagingOffset: this.raceGhosts?.isStagingOffsetEnabled() ?? false,
      ghosts: this.raceGhosts?.states() ?? [],
      spectateUserId: this.spectateUserId,
      localPosition: {
        x: this.playerController.position.x,
        y: this.playerController.position.y,
        z: this.playerController.position.z
      }
    };
  }

  private updateRaceGhost(frameDelta: number): void {
    if (!this.friendRaceWorld) return;
    this.raceGhosts?.setLocalColorIndex(raceRoomService.getMyColorIndex());
    this.raceGhosts?.setStaging(this.racePhase === 'WAITING' || this.racePhase === 'READY' || this.racePhase === 'COUNTDOWN', this.cameraController.yaw);
    // PRESENCE AUTHORITY: a stale transform is not a departed racer. Only the
    // room's connected flag may hide a ghost; a stale stream holds position.
    this.raceGhosts?.update(frameDelta, this.playerController.position);
  }

  private clearRaceGhosts(): void {
    this.raceGhosts?.clear();
    this.rivalProgress.clear();
    this.rivalYaw.clear();
    this.spectateOrder = [];
    this.spectateUserId = null;
    this.spectateIndex = 0;
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
      movementVersion: identity.movementVersion,
      // Official Signal Pack courses are PLAYHEAD; this keeps competitive
      // identity explicit without altering any fingerprint.
      courseType: normalizeCourseType(identity.courseType)
    };
  }

  private startPovRecording(): void {
    // A fresh attempt: any previous run's upload must not leak into this run's
    // submission.
    this.pendingReplayUpload = null;
    // A RETRY must not leave the previous attempt's replay attached: it would
    // advertise a WATCH button for a run that did not produce a replay, and
    // attach stale replay metadata to the new submission.
    this.lastFinalizedReplay = null;
    const identity = this.currentMapIdentity();
    if (!identity) {
      // Custom audio and non-canonical maps are not competitively replayable.
      this.povRecorder.clear();
      return;
    }
    const skinId = KarambitSkinSystem.getInstance().getEquippedSkinId();
    // Gloves are a first-person cosmetic. Record which glove the run actually
    // used so an old replay is unaffected by later loadout changes.
    const gloveId = masteryGloveSystem.getEquippedGloveId();
    const fov = this.environment.camera.fov;
    const startSongTimeMs = this.audioEngine.getCurrentTime() * 1000;
    this.povRecorder.start(identity, skinId, fov, startSongTimeMs, gloveId);
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
    const submissionUserId = authService.getUserId();
    let signalDropAcquired = false;

    const publish = (state: SubmissionState, detail?: string): void => {
      if (authService.getUserId() !== submissionUserId) return;
      this.lastSubmissionState = { state, detail };
      this.ui.resultsScreen.setSubmissionState(state, detail);
      // The drop panel was drawn BEFORE the submit answer. Re-render it now so a
      // server-minted first-Diamond drop is reported immediately.
      this.ui.resultsScreen.refreshSignalDropPanel(signalDropAcquired);
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
    if (authService.getUserId() !== submissionUserId) return;
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
    if (authService.getUserId() !== submissionUserId) return;

    if (outcome.ok) {
      // SERVER-MINTED SIGNAL DROP: the server created it for the first DIAMOND on
      // a unique official track. Mirror the id so the next Armory visit can open
      // it. This is a mirror only; no ownership is granted here.
      if (outcome.signalDropId) {
        KarambitSkinSystem.getInstance().mergeCloudDropAward(outcome.signalDropId);
        signalDropAcquired = true;
      }
      // WORLD RECORD: the server decides and creates the award. This client only
      // CLAIMS what the server already made for it, then unions the prestige
      // cosmetic into local ownership. No client path can mint the provenance.
      if (outcome.isWorldRecord && outcome.worldRecordAwardId) {
        const claim = await cloudProgression.claimWorldRecordReward(outcome.worldRecordAwardId);
        publish(
          claim.ok ? 'WORLD_RECORD_SET' : 'WORLD_PB_UPDATED',
          claim.ok ? undefined : claim.detail
        );
        return;
      }
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
    this.ui.importScreen.setAccountState(authService.getUsername(), () => this.openAccountModal());
    this.ui.loginModal.renderSession(authService.getUsername());
  }

  /**
   * Claims any world-record prestige awards the server has created for this
   * account but that this device has not yet applied locally. Idempotent: the
   * server grants at most once per account, so re-running this is safe.
   */
  private async refreshWorldRecordRewards(): Promise<void> {
    const client = online.getClient();
    if (!client || !authService.isSignedIn()) return;
    try {
      const { data, error } = await client.rpc('my_world_record_awards');
      if (error) return;
      const rows = (Array.isArray(data) ? data : []) as Array<{ award_id?: string }>;
      for (const row of rows) {
        const awardId = row.award_id;
        if (!awardId) continue;
        if (cloudProgression.hasClaimedWorldRecordAward(awardId)) continue;
        await cloudProgression.claimWorldRecordReward(awardId);
      }
    } catch {
      /* reward reconciliation is best-effort; never blocks boot */
    }
  }

  /**
   * Opens the username + password account modal (no email). On success the new
   * session is adopted, then progression is reconciled and the WORLD RECORD
   * reward table is checked, so an account created on this device immediately
   * sees everything it is entitled to.
   */
  private openAccountModal(): void {
    const modal = this.ui.loginModal;
    modal.setCallbacks({
      onSubmit: async (mode, username, password) => {
        const result = mode === 'register'
          ? await authService.registerAccount(username, password)
          : await authService.loginAccount(username, password);
        if (!result.ok) return { ok: false, detail: result.detail };
        this.refreshLocalIdentity();
        // Account isolation + safe one-time guest adoption are handled in sync().
        await cloudProgression.sync();
        await this.refreshWorldRecordRewards();
        return { ok: true, detail: 'ok' };
      },
      onSignOut: async () => {
        // Real sign-out: end the session, restore the device's GUEST local state
        // (so the next account cannot inherit this account's progression), then
        // start a fresh anonymous session so play stays online.
        await authService.logoutAccount();
        cloudProgression.signOutLocalState();
        this.refreshLocalIdentity();
        await authService.ensureSession();
        this.refreshLocalIdentity();
      }
    });
    modal.renderSession(authService.getUsername());
    modal.show();
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
   * RACE A WORLD LEADERBOARD RUN from the results screen — one step.
   *
   * Reuses the SAME validated ghost flow as the leaderboard panel, then enters
   * the normal countdown/play directly instead of returning to the menu. The
   * replay payload is fetched only inside `raceLeaderboardGhost`, i.e. after the
   * player's explicit RACE GHOST click.
   */
  public async raceLeaderboardGhostAndPlay(runId: string): Promise<{ ok: boolean; detail: string }> {
    if (this.friendRaceWorld) return { ok: false, detail: 'GHOST RACE UNAVAILABLE DURING ONLINE RACE' };
    const raced = await this.raceLeaderboardGhost(runId);
    if (!raced.ok) return raced;
    if (!this.stateMachine.is(GameState.READY)) return { ok: false, detail: 'SIGNAL LOAD FAILED // RETRY' };
    this.stateMachine.transitionTo(GameState.COUNTDOWN);
    return raced;
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

  /**
   * Whether a compatible stored replay exists for this track, so the results
   * screen can offer RETRY VS PB. Delegates to the SAME authoritative ghost
   * resolution the Signal Pack showcase uses — no second source of truth.
   */
  private resolvePbGhostAvailable(trackId: string | null): { available: boolean; label: string | null } {
    if (!trackId) return { available: false, label: null };
    return LeaderboardManager.getInstance().resolveGhostAvailability(
      trackId,
      this.canonicalFingerprintFor(trackId),
      (finishTimeUs) => replayStorageService.getLocal(trackId, finishTimeUs) !== null
    );
  }

  /**
   * RETRY VS PB — the explicit PB duel chosen from the results screen.
   *
   * Loads the validated PB/BEST-recorded ghost through the existing flow and
   * then starts the run in ONE step, so the report does not round-trip through
   * the menu. It NEVER runs for a plain RETRY: only an explicit selection arms a
   * ghost, so the player's ghost toggle is respected.
   */
  public async racePbGhostAndPlay(trackId: string): Promise<{ ok: boolean; detail: string }> {
    const raced = await this.racePbGhost(trackId);
    if (!raced.ok) return raced;
    if (!this.stateMachine.is(GameState.READY)) return { ok: false, detail: 'SIGNAL LOAD FAILED // RETRY' };
    this.stateMachine.transitionTo(GameState.COUNTDOWN);
    return raced;
  }

  private async enterPovReplay(
    payload: string,
    expected: PovReplayIdentity,
    trackId: string,
    finishTimeUs?: number
  ): Promise<{ ok: boolean; detail: string }> {
    const loaded = this.povPlayer.load(payload, { identity: expected, finishTimeUs });
    if (!loaded.ok) return { ok: false, detail: `REPLAY REJECTED // ${loaded.reason}` };

    // The replay is only meaningful against its canonical map. Require the
    // shipped preset, then run the SAME canonical preparation the game uses for
    // a WATCH/ghost load (baked audio buffer + frozen world/route).
    const level = await PresetLevelCache.loadPreset(trackId);
    if (!level) return { ok: false, detail: 'CANONICAL MAP UNAVAILABLE' };

    const prepared = await this.prepareCanonicalPlayback(trackId);
    if (!prepared) {
      this.povPlayer.unload();
      return { ok: false, detail: 'CANONICAL PLAYBACK PREPARATION FAILED' };
    }

    // Confirm the loaded map really is the one the replay was recorded against.
    const loadedIdentity = this.currentMapIdentity();
    if (
      !loadedIdentity ||
      loadedIdentity.trackId !== expected.trackId ||
      loadedIdentity.mapVersion !== expected.mapVersion ||
      loadedIdentity.mapFingerprint !== expected.mapFingerprint ||
      loadedIdentity.movementVersion !== expected.movementVersion ||
      normalizeCourseType(loadedIdentity.courseType) !== normalizeCourseType(expected.courseType)
    ) {
      this.povPlayer.unload();
      return { ok: false, detail: 'REPLAY MAP IDENTITY MISMATCH' };
    }

    this.replayMode = 'POV';
    this.povPlayer.restart();
    // The canonical preparation leaves the machine in READY (or FINISHED for a
    // local results replay); the transition must be accepted, never assumed.
    if (!this.stateMachine.transitionTo(GameState.REPLAY)) {
      this.replayMode = 'NONE';
      this.povPlayer.unload();
      return { ok: false, detail: 'REPLAY ENTRY REJECTED' };
    }
    return { ok: true, detail: 'PLAYING' };
  }

  /**
   * FINISHED arrived FROM a replay: re-show the report that is ALREADY built.
   * The finish pipeline (PB save, drops, world submission) ran once when the
   * run first finished; re-running it here would duplicate all of it. Falls
   * back to the menu only if the report's source data is genuinely gone.
   */
  private returnFromReplayToReport(): void {
    if (this.currentAnalysis && this.currentTrack) {
      this.ui.resultsScreen.show();
    } else {
      this.stateMachine.transitionTo(GameState.IMPORT);
    }
  }

  /**
   * ESC / EXIT: leaves replay cleanly and restores pointer lock behaviour.
   *
   * Single teardown for BOTH replay modes. Releases the replay audio and any
   * ephemeral knife/glove preview, then returns to the Run Report when the
   * replay was opened from it, or the main menu otherwise.
   */
  public exitPovReplay(): void {
    this.replayMode = 'NONE';
    // Both replay modes own the audio; stopping here is what prevents the
    // recorded song from leaking back into the menu or the results screen.
    this.audioEngine.stop();
    this.replayPlayer.stop();
    this.povPlayer.unload();
    this.ui.replayOverlay.hide();
    this.clearGhostRace();
    // Drop any replay glove preview so the player's own loadout is unaffected.
    if (this.replayGlovePreviewId !== null) {
      masteryGloveSystem.setDevPreview(null);
      this.replayGlovePreviewId = null;
    }
    // Same for the ephemeral replay knife preview: restore the real equipped arm.
    const replaySkin = KarambitSkinSystem.getInstance();
    if (replaySkin.getReplaySkinPreviewId() !== null) {
      replaySkin.setReplaySkinPreview(null);
      this.viewmodelController.refreshRenderedSkin();
    }
    // FINISHED restores the existing report without submitting the run again.
    this.stateMachine.transitionTo(
      this.replayReturnState === GameState.FINISHED ? GameState.FINISHED : GameState.IMPORT
    );
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
    const skin = KarambitSkinSystem.getInstance();
    const skinId = this.povPlayer.getSkinId();
    // REPLAY LOOK: render the recorded knife as an EPHEMERAL preview. This never
    // equips it and never persists, so watching another player's run (an
    // unowned WORLD RECORD knife, a dropped glove) cannot change the viewer's
    // own loadout. Neither the equip listener nor the glove listener fire for an
    // override, so the rendered skin is refreshed explicitly.
    const desiredSkin = skinId || null;
    if (skin.getReplaySkinPreviewId() !== desiredSkin) {
      skin.setReplaySkinPreview(desiredSkin);
      this.viewmodelController.refreshRenderedSkin();
    }

    // GLOVES: same ephemeral rule, and a different namespace. setDevPreview()
    // supports BOTH recorded drop gloves (even unowned) and mastery gloves.
    // Historical replays carry no glove metadata and fall back to the neutral
    // default rather than the SPECTATOR's equipped glove.
    const desiredGlove = this.povPlayer.getGloveId() || null;
    if (desiredGlove !== this.replayGlovePreviewId) {
      masteryGloveSystem.setDevPreview(desiredGlove);
      this.replayGlovePreviewId = desiredGlove;
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
    // A FIRST-TO-FINISH race is a single attempt: a mid-race local restart does
    // NOT reset the attempt, the finish flag or the shared clock. The remote
    // ghost is deliberately untouched; only the local spawn transform is
    // republished by prepareTrackForRun().
  }

  /**
   * LOCAL FINISH. The authoritative elapsed is derived SERVER-SIDE from the
   * shared start epoch; the client reports the crossing and never declares its
   * own winner or time. The existing ranked replay / PB / WR flow that runs in
   * handleFinishSequence() is unchanged.
   */
  private onRaceFinish(): void {
    if (!this.raceActive || this.raceFinishReported) return;
    if (this.racePhase !== 'RACING') return;
    this.raceFinishReported = true;
    const progress = {
      checkpointIndex: this.passedCheckpoints.size,
      checkpointTotal: this.currentTrack?.checkpoints.length ?? 0
    };
    const raceId = raceRoomService.getRaceId();
    const report = async (): Promise<void> => {
      if (!this.raceActive || raceRoomService.getRaceId() !== raceId) return;
      const mine = raceRoomService.getPlayers().find(p => p.userId === authService.getUserId());
      if (mine?.finishUs !== null && mine?.finishUs !== undefined) return;
      if (raceRoomService.getRoom()?.state === 'COUNTDOWN') {
        window.setTimeout(() => void report(), 100);
        return;
      }
      if (raceRoomService.getRoom()?.state !== 'RUNNING') return;
      const result = await raceRoomService.reportFinish(progress);
      if (!result.ok && this.raceActive && raceRoomService.getRaceId() === raceId) {
        this.ui.raceHud.showNotice(`FINISH PENDING // ${result.detail}`);
        window.setTimeout(() => void report(), 2000);
      }
    };
    void report();
    this.endRaceSession();
  }
}
