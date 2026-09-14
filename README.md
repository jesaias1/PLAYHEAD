# PLAYHEAD

> **DROP A SONG. ENTER IT.**
> *BECOME THE PLAYHEAD.*

PLAYHEAD is an experimental first-person movement game that transforms any client-side audio file into a monumental procedural 3D world. You do not simply run while music plays; **the song has become a place, and you are the playhead physically strafing through your music.**

---

## Visual Language: Monumental Audio Brutalism

PLAYHEAD avoids generic neon cyberpunk clichés and cheap particle explosions in favor of colossal, matte dark architectural forms, dramatic audio-reactive atmospheric fog, high negative space, and curated song-derived monochromatic palettes (`ICE`, `EMBER`, `SIGNAL_RED`, `ACID`, `ULTRAVIOLET`, `GLACIER`).
- **The Song Ahead**: Unactivated, dormant brutalist structures loom out of atmospheric haze.
- **The Now-Line**: Structures ignite and resonate as the player reaches their exact timestamp in the song.
- **The Song Behind**: The track cools into deep twilight shadows and fades back into fog.
- **Spectral Architecture**: Waveform canyon relief walls flank the route, overhead spectral canopy fins loom high above, and beat-synced onset gates frame the path.
- **Drop Setpieces**: Major drops explode into monumental architectural events (Split Monoliths, Spectral Cathedrals, Void Bridges, Signal Gates, and Fractures) accompanied by sudden atmospheric clearing and horizon beacon flare.

---

## Features (First Playable Vertical Slice)

- **Real Client-Side Audio Analysis (Web Audio API)**
  - Radix-2 Cooley-Tukey FFT (2048-sample window, 512-sample hop).
  - Multi-band frequency splitting (Sub/Bass, Low-Mid, Mid, High).
  - Spectral flux and transient onset detection with adaptive moving thresholds.
  - Autocorrelation / comb filter tempo estimator (clamped 65–190 BPM).
  - Robust 95th-percentile normalization to handle both quiet acoustic and brick-walled masters.
  - Macro-section boundary detector segmenting tracks into 4–10 themed movement zones.
  - Synthetic 75-second 128 BPM electronic test track generator for zero-setup offline testing.

- **Deterministic Course Generation & Safety Validation**
  - MurmurHash3 seed derived from audio PCM hash, duration, and metadata.
  - Route modules: `RUNWAY`, `STEP_UP`, `STEP_DOWN`, `GAP`, `ASCENT_CHAIN`, `DESCENT_CHAIN`, `SURF_RAMP`, `BOOST`, `CHECKPOINT`, `FINISH`.
  - Non-negotiable physics feasibility validator (`RouteValidator`): models parabolic jump trajectories, player velocity, and gravity to automatically repair impossible gaps and steep steps.

- **Source/Quake-Inspired First-Person Movement**
  - Decoupled 120 Hz fixed-timestep physics simulation with accumulator.
  - Source engine `PM_AirAccelerate` and `PM_WalkMove` physics.
  - Bunny-hopping with coyote time (120ms) and jump buffer (150ms) preserving horizontal velocity.
  - Air strafing: skilled directional turning during flight increases traversal speed.
  - Surfing: steep slope surfaces project momentum tangentially along the surface plane without ground friction.
  - Swept-capsule collision resolution against oriented bounding boxes.

- **Game Loop, Sync & Replay**
  - Start platform with 3-2-1-RUN countdown; audio begins precisely at RUN.
  - Checkpoint restoration: falling into the void triggers an instant restore with anti-pop audio seeking.
  - Sync Delta metric measuring whether the player is ahead or behind reference song progression.
  - Scoring and ranking (Bronze, Silver, Gold, Diamond) with local storage personal bests.
  - Full cinematic replay: records at 25 Hz with smooth Hermite interpolation and dynamic third-person chase camera.

---

## Audio Privacy Statement

**LOCAL ANALYSIS — YOUR AUDIO NEVER LEAVES THIS DEVICE.**
All PCM decoding, FFT spectral analysis, and procedural generation run 100% locally in the browser. No audio is ever uploaded to any server or cloud service.

---

## Supported Formats

- `.mp3`
- `.wav`
- `.ogg`
- `.m4a`
- `.flac`
- `.aac`
- `.webm`

---

## Controls

| Key / Input | Action |
| --- | --- |
| **W / A / S / D** | Move / Air-Strafe |
| **Mouse** | Look (Pointer Lock) |
| **Space** | Jump / Bunny-Hop |
| **R** | Quick Restore to Last Checkpoint |
| **Escape** | Pause / Settings / Release Cursor |
| **F3** | Toggle Dev Diagnostics Overlay |

---

## Installation & Running

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run unit tests
npm run test

# Type check
npm run typecheck

# Production build
npm run build
```

---

## Architecture Overview

```text
src/
├── core/
│   ├── Game.ts               # Master coordinator
│   ├── StateMachine.ts       # Type-safe game lifecycle states
│   ├── Clock.ts              # 120Hz fixed-timestep accumulator
│   └── Settings.ts           # Settings & localStorage persistence
├── audio/
│   ├── AudioAnalyzer.ts      # FFT, spectral flux, onsets, tempo, sections
│   ├── AudioEngine.ts        # Web Audio playback & checkpoint seeking
│   ├── AudioFeatures.ts      # Data types & interfaces
│   ├── AudioLoader.ts        # Drag-drop & file picker decoding
│   ├── SyntheticTrack.ts     # Offline 4-genre dev track synthesizer
│   └── TrackPalettes.ts      # Curated deterministic track color palettes
├── generation/
│   ├── GenerationTypes.ts    # RouteNode and Track interfaces
│   ├── RouteGenerator.ts     # Procedural time-to-space course generator
│   ├── RouteValidator.ts     # Jump feasibility physics validator
│   ├── SeededRandom.ts       # Deterministic Mulberry32 PRNG
│   └── TrackGenerator.ts     # Track generation entry point
├── physics/
│   ├── Collider.ts           # OBB sphere/capsule intersection
│   └── PhysicsWorld.ts       # Spatial collection & capsule resolution
├── player/
│   ├── CameraController.ts   # Mouse look, dynamic FOV, bank roll
│   ├── MovementConfig.ts     # Tunable physics constants
│   ├── MovementMath.ts       # Source acceleration, friction, surf math
│   ├── PlayerController.ts   # Velocity integration & collision
│   ├── PlayerStats.ts        # Speed, strafe efficiency, and ranking
│   └── StrafeVisualizer.ts   # Curved air-strafe ribbons, trail & speed streaks
├── world/
│   ├── Environment.ts        # Three.js scene, lighting, brutalist reactive fog
│   ├── GeometryBuilder.ts    # Procedural platforms, arches, finish portal
│   ├── MusicVisualController.ts # Multi-band envelopes, buildup & drop impact bus
│   ├── ProceduralSky.ts      # Custom gradient void, sub-bass glow, beacons
│   ├── SkylineArchitecture.ts# Distant audio-derived brutalist towers
│   ├── SpectralArchitecture.ts# Waveform canyons, canopy fins, onset gates
│   ├── DropSetpiece.ts       # Split Monolith, Cathedral, Void Bridge, etc.
│   ├── PlayheadSystem.ts     # Temporal activation (Future / Present / Past)
│   └── World.ts              # Scene, audio-visual bus & physics orchestrator
├── replay/
│   ├── ReplayRecorder.ts     # 25Hz trajectory sampler
│   ├── ReplayCamera.ts       # Third-person trailing chase camera
│   └── ReplayPlayer.ts       # Hermite interpolated playback
└── ui/
    ├── UIManager.ts          # Central UI coordinator
    ├── ImportScreen.ts       # Drag-and-drop & dev 4-genre track loader
    ├── AnalysisScreen.ts     # Waveform canvas & audio metrics
    ├── CountdownScreen.ts    # 3-2-1-RUN overlay & controls hint
    ├── Hud.ts                # In-game speedometer, progress, sync delta, section theme
    ├── PauseScreen.ts        # Pause menu
    ├── ResultsScreen.ts      # Score, rank, and personal bests
    ├── SettingsModal.ts      # Sensitivity, FOV, motion accessibility
    └── DevOverlay.ts         # Real-time diagnostic stats & audio bus telemetry (F3)
```

---

## Known Limitations

- High-DPI screens are capped at 2.0x device pixel ratio for smooth 60+ FPS performance.
- Extremely long tracks (>10 minutes) may compress spatial layout; optimal experience is 1:30 to 5:00 songs.
