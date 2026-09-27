# PERFORMANCE BASELINE

Measured before the visual overhaul so the next pass has a real reference.

**Read §4 before trusting any number here.** Runtime FPS/frame-time was **not**
measured and is **not** estimated — the environment cannot reach `GameState.PLAYING`
(the AudioContext requires a trusted user gesture, and the browser is a headless
software rasteriser). Inventing those numbers would be worse than omitting them.

---

## 1. Test environment

| | |
|---|---|
| Host | Windows, `C:\Users\lin4s\Documents\TRACKRUN.worktrees\feat-armory-signal-drops` |
| Node | v24.12.0 |
| Build | Vite 6 (`npm run build`), production output in `dist/` |
| Measurement | static analysis of `dist/` and `public/`, plus preset inspection |
| **NOT available** | GPU timing, FPS, frame time, 1% low, draw calls, triangles |

The runtime numbers must be captured with the in-game **F3 overlay** during real
play on target hardware.

---

## 2. Production bundle

| Kind | Size |
|---|---|
| `.mp4` (knife artifact videos) | **68.50 MB** |
| `.json` (precomputed presets) | **46.65 MB** |
| `.ogg` (signal pack audio) | 22.29 MB |
| `.mp3` (signal pack audio) | 11.84 MB |
| `.webp` (textures) | 4.33 MB |
| `.glb` (karambit + arms) | 2.09 MB |
| **`.js` (application)** | **1.58 MB** |
| `.png` (brand) | 1.16 MB |
| `.woff2` (fonts) | 0.28 MB |
| `.css` | 0.07 MB |
| **dist total** | **158.79 MB** |

**JS is a single chunk of 1617.5 KB.** There is no code splitting. At this size
that is not a defect, and splitting startup is not worth the fragility.

### The two dominant costs, and why they are acceptable

- **68.5 MB of knife video** across 30 files. By design **at most one video
  decodes at a time** (the equipped artifact), and only when equipped. Browsing
  the Armory creates **zero** video elements — verified in the running build.
- **46.65 MB of presets**, one fetched per track selection (1.85–5.58 MB each).
  `analysis.frames` is the bulk. This is the price of near-instant official load:
  no FFT, no route generation at selection time.

---

## 3. Shipped asset inventory (`public/`)

| Category | Files | Size |
|---|---|---|
| knife videos | 30 | 68.50 MB |
| presets (precomputed) | 14 | 46.65 MB |
| audio (signal pack) | 14 | 34.13 MB |
| glove textures | 24 | 2.21 MB |
| knife textures | 6 | 2.12 MB |
| brand | 2 | 0.61 MB |
| fonts | 13 | 0.28 MB |
| other | 3 | 2.63 MB |
| **total** | | **157.14 MB** |

---

## 4. Per-track world object counts (draw-call proxy)

These dominate scene complexity. From the shipped presets:

| track | route | ramps | shelves | spines | obstacles | forks | spectacle | preset |
|---|---|---|---|---|---|---|---|---|
| track_1_signal_drift | 66 | 6 | 1 | 77 | 8 | 1 | 4 | 2522 KB |
| track_2_flow_state | **145** | 8 | 11 | **258** | **31** | 3 | 4 | **5580 KB** |
| track_3_surf_the_void | 109 | 9 | 3 | 154 | 17 | 3 | 5 | 4011 KB |
| track_4_airwave_theory | 102 | 9 | 4 | 152 | 20 | 2 | 5 | 3786 KB |
| track_5_gravity_line | 80 | 7 | 5 | 141 | 15 | 2 | 4 | 2962 KB |
| track_6_over_the_edge | 95 | 8 | 2 | 144 | 15 | 3 | 5 | 3610 KB |
| track_7_drop_zone_surfer | 119 | 9 | 8 | 192 | 18 | 3 | 5 | 4251 KB |
| track_8_wave_surfing | 96 | 8 | 1 | 154 | 20 | 2 | 6 | 3674 KB |
| track_9_neon_abyss | 62 | 5 | 2 | 92 | 9 | 1 | 3 | 2412 KB |
| track_10_neon_slipstream | 62 | 5 | 0 | 88 | 8 | 1 | 3 | 2444 KB |
| track_11_ex_gravity | 87 | 7 | 4 | 147 | 4 | 1 | 3 | 3257 KB |
| track_12_shadows_over_the_circuit | **51** | 4 | 6 | **79** | 7 | 1 | 3 | 1851 KB |
| track_13_waveform_descent | 108 | 8 | 8 | **184** | 12 | 3 | 3 | 4071 KB |
| track_14_kz_ascent | 91 | 8 | 2 | 172 | 14 | 3 | 3 | 3337 KB |

**Representative tracks for the next pass:**
- **Signal Drift** — the benchmark first impression (66 route / 77 spines).
- **Flow State** — the heaviest (145 route / 258 spines / 31 obstacles / 5.58 MB preset).
- **Shadows Over the Circuit** — the lightest and shortest (51 route / 79 spines / 84 s).

**Signal spines are the largest single object class on every track** (77–258),
larger than the route itself. If the visual pass needs draw-call headroom, that is
the first place to look.

---

## 5. Measured calibration finding

From `npm run signalpack:report` (physics-derived achievable time vs song):

| track | song | estimate | margin |
|---|---|---|---|
| signal_drift | 116.1 s | 189.0 s | **−72.9 s** |
| flow_state | 251.5 s | 405.2 s | **−153.7 s** |
| shadows_over_the_circuit | 84.2 s | 144.0 s | **−59.8 s** |
| waveform_descent | 182.4 s | 303.4 s | **−121.0 s** |

All 14 tracks are negative. The estimate assumes ground running at a sustained
fraction of wish speed and **understates bhop/surf momentum**, so this does not
prove overtime is inevitable. It does establish that **no official track is
completable on running and jumping alone within its song**.

Unresolved. Requires human playtest before any rank or route recalibration.

---

## 6. What the next pass must measure

Capture on real target hardware, with the F3 overlay, for Signal Drift / Flow
State / Shadows Over the Circuit:

- resolution and devicePixelRatio
- average FPS and frame time; 1% low if tooling allows
- CPU frame time
- **draw calls**, **triangles**, geometries, textures, shader programs
- scene object count
- load time (cold and warm)

Then compare against this file. Do not optimise blind.

---

## 7. Budget guidance

PLAYHEAD defines **no official target FPS**. Do not invent one.

What the baseline does say:

- The JS payload (1.58 MB, single chunk) is not the constraint.
- Scene complexity is dominated by **signal spines and route nodes**, not by the
  sky, stars or UI.
- The heaviest official track has ~2.8× the route nodes of the lightest, so a
  visual change that scales with route length will cost ~3× more on Flow State
  than on Shadows Over the Circuit.

Prioritise **frame consistency** over one spectacular extra prop. PLAYHEAD
movement depends on responsive presentation even though the physics is
fixed-step.
