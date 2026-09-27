# VISUAL OVERHAUL HANDOFF

For the next phase: the dedicated **PLAYHEAD visual / world / renderer
overhaul**.

Read these four files and you will not need archaeology:

| File | What it gives you |
|---|---|
| `README.md` | what PLAYHEAD is |
| `DESIGN.md` | the Signal OS interface language |
| `GAMEPLAY_INVARIANTS.md` | **what is frozen** |
| `PERFORMANCE_BASELINE.md` | the measured starting point |
| `PRE_VISUAL_BASELINE.md` | the contract: what may change |
| `docs/SIGNAL_PACK_AUTHORING.md` | how official content is authored |

---

## 1. What PLAYHEAD is

A first-person, music-driven movement game. **Drop a song. Enter it. Become the
Playhead.** A song becomes a traversable 3D course; the world reacts to the music
in real time.

Two pipelines share one engine:

```
CUSTOM AUDIO   analysis -> procedural generation -> validation
SIGNAL PACK    analysis -> procedural foundation -> authored profile
               -> validation -> precompute
```

The official Signal Pack is a curated showcase. Custom Audio is procedural magic
for arbitrary user music. **Neither may compromise the other.**

---

## 2. What is frozen

`GAMEPLAY_INVARIANTS.md` in full. The short version:

movement constants · surf physics · collision · route topology · checkpoint
restore · void/OOB · audio timing · rank · PB/ghost validity · Signal Drop rules ·
tutorial semantics · save format · knife calibration.

**Presentation may change freely. Behaviour may not change at all.**

---

## 3. Running PLAYHEAD

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # production build into dist/
npm run preview        # serve the production build
```

Requires a **user gesture** to start a run (browser AudioContext policy).

### Dev keys

| Key | Action |
|---|---|
| `F3` | DEV diagnostics overlay (PERF, TEMPO, OBSTACLES, BUILDINGS, ROUTE CHAIN, FORKS, AUDIO VISUAL, WORLD SAFETY, ONLINE, RACE LOBBY, REMOTE PLAYER, ASSETS) |
| `F3` then `1/2/3/4` | isolate audio-visual channels (BASS / MID / HIGH / FULL) |
| `F4` | viewmodel calibration tool |
| `?debug=1` | start with the overlay visible |

In the Movement Lab: `[0]` signal gate run, `[9]` gauntlet start, `[N]` route
fork zone, `[4]–[8]` areas.

---

## 4. Measuring performance

There is **no automated FPS harness**. Use the F3 overlay during real play.

It reports: FPS, frame ms, DPR, render scale, **draws**, **tris**, lines/points,
geometries, textures, programs, visible city counts, quality tier, decoration LOD,
adaptive FPS/tier, bloom strength, cosmetic video scale.

Capture for the three representative tracks in `PERFORMANCE_BASELINE.md` §4:
**Signal Drift** (benchmark), **Flow State** (heaviest), **Shadows Over the
Circuit** (lightest).

Also available:

```bash
npm run build            # bundle composition -> dist/
npm run signalpack:report # per-track route/object counts + rank estimates
npm run smoke            # cheap critical automated checks
npm run validate         # typecheck + full test suite
```

---

## 5. Current rendering state

| Concern | Where |
|---|---|
| Renderer, camera, post-processing | `src/world/Environment.ts` |
| Post-processing passes | `src/rendering/PostProcessing.ts` |
| Quality tiers | `src/rendering/QualityPresets.ts` |
| Effect-intensity profiles | `src/rendering/EffectIntensity.ts` |
| World assembly | `src/world/World.ts` |
| Geometry construction | `src/world/GeometryBuilder.ts` |
| Karambit shader | `src/viewmodel/KarambitCosmicShader.ts` |
| Music-reactive state | `src/world/MusicVisualController.ts` |
| Skyline / architecture | `src/world/SkylineArchitecture.ts` |
| Signal landmarks | `src/world/SignalLandmarks.ts` |
| Spectacle planner | `src/world/SpectaclePlanner.ts` |
| Celestial landmarks | `src/world/CelestialLandmarks.ts` |
| World safety pass | `src/world/WorldGeometrySafetyPass.ts` |

Quality tiers already exist (`LOW / MEDIUM / HIGH / ULTRA / AUTO`) and scale
render scale, DPR cap, decoration LOD, bloom, grain, landmark density, route
packet count, cosmetic video encode and glove texture resolution. **Leave the
system; it already works.**

---

## 6. Where the visual budget is

From `PERFORMANCE_BASELINE.md`:

- **Signal spines are the largest object class on every track** (77–258) — larger
  than the route itself. First place to look for draw-call headroom.
- Route nodes 51–145; obstacles 4–31.
- The JS payload (1.58 MB, one chunk) is not the constraint.
- Flow State costs ~2.8× the route nodes of Shadows Over the Circuit. A change
  that scales with route length costs ~3× more there.
- 68.5 MB of knife video, but **at most one decodes at a time** and browsing the
  Armory decodes none.

**No official target FPS exists. Do not invent one.**

---

## 7. Known weak visual areas

Honest list, from prior passes. None are fixed.

1. **Official track calibration** — every official route's physics-derived
   achievable time exceeds its song, so momentum mechanics are mandatory even on
   the ENTRY track. Unresolved; needs human playtest, not a visual fix.
2. **`WHITE_NOISE`** — improved to pearly/icy, but never human-verified.
3. **`BLACKSTAR`** — has a dedicated `uIsBlackstar` shader path and genuine
   depth; already strong, do not flatten it.
4. **The mascot is barely present** — only the boot-mark logo. Sparse by design,
   arguably too sparse.
5. **Dead space at 2560×1440** in the Signal Pack — 14 registry rows do not fill
   a tall viewport.
6. **Legacy panels (Settings, Results, Profile)** inherit the new design tokens
   but were not recomposed.
7. **Glove textures** — anisotropy and a 1024 hi tier were added; in-game quality
   is human-unverified.

---

## 8. Content authoring and spectacle

Official tracks are described by authored profiles:
`src/generation/OfficialSignalPack.ts` + `OfficialTrackProfile.ts`.

A profile carries **movement identity, phrase plan by musical section, spectacle
moments at real song times, 1–3 visual motifs, palette, surf policy, band**.

Spectacle is expressed as **intent** — `CELESTIAL_REVEAL`, `ARCH_TRAVERSAL`,
`VOID_OPENING`, `TOWER_ASCENT`, `MONOLITH_WAKE`, `SIGNAL_BURST`, `FOG_LIFT`,
`FINAL_BEACON` — never as a renderer instruction. **Map these onto concrete
effects.** That separation exists so you can amplify spectacle without touching
authoring data.

Gate: `npm run signalpack:validate`.

---

## 9. Music reactivity

Do not build a second analyser. Existing inputs on
`world.visualController.state` and the channel object:

- `energy`, `subBass`, `bass`, `mid`, `high`
- `flux`, `onsetPulse`, `brightness`
- `buildup`, `dropImpact`, `upcomingDropDistance`
- `sectionTheme`, `sectionIndex`, `palette`
- `channels.{bassMass, midFlow, highGlint, transient, dropPrimary, dropSecondary, dropTertiary, presence, sectionEnergy}`

Reactivity is **visual only**. It must never alter collision geometry or
competitive state.

---

## 10. Per-track visual identity

Every official track has a deterministic dream profile: palette, 1–3 motifs,
signage density, star density, fog character, and optionally no celestial body.

**Use it.** Do not randomise palettes per run. Official tracks are deterministic
and a developer must be able to reload and see the same key compositions.

---

## 11. Constraints you will be held to

1. Movement, surf, collision, route topology, checkpoints, timing, rank, PB,
   Signal Drops, tutorial semantics, save format, knife calibration: **frozen**.
2. New architecture must respect `RouteExclusionCorridor` and pass the world
   geometry safety pass **after** placement.
3. Readability beats beauty: never obscure route target, surf face, checkpoint,
   goal or HUD.
4. Frame consistency beats one spectacular prop.
5. Signal OS identity is not yours to redesign.
6. Armory video lifecycle must keep working: one decode at a time, zero while
   browsing.
7. Measure before and after. Do not optimise blind.

---

## 12. What "done" looks like

Not a checklist. The bar is:

> A player remembers **THE ASCENT**, **THE SURF**, **THE DROP**, **THE ARCH**,
> **THE FINAL RUN** — not "a bunch of generated platforms."

The official Signal Pack is an authored showcase. Make it look like one.
