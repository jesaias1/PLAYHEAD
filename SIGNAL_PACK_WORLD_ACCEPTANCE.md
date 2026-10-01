# SIGNAL PACK — WORLD ACCEPTANCE

Scope: official Signal Pack visual-world pass. **Visuals only.**
Gameplay, movement, physics, route generation, checkpoints, rank/PB/replay/race,
account, Armory and canonical map identity are untouched.
Baseline: `2221269`. Production delivery follows the acceptance checks below.

## Track identities (all 14 actual official tracks)

| # | Catalog id | Name | World identity |
|---|-----------|------|----------------|
| 01 | `track_1_signal_drift` | **SIGNAL DRIFT** | **Baseline reference.** Uses the existing rendering unchanged (`usesOverride=false`). |
| 02 | `track_2_flow_state` | **FLOW STATE** | Sparse floating archipelago over a vast quiet void; distant light field; minimal signage. |
| 03 | `track_3_surf_the_void` | **SURF THE VOID** | Colossal suspended frame over deep abysses; cold glass; halo; void-heavy. |
| 04 | `track_4_airwave_theory` | **AIRWAVE THEORY** | Tiered stacked public plazas, tall open air columns; galaxy band. |
| 05 | `track_5_gravity_line` | **GRAVITY LINE** | Processional monolith field with stacked arch monuments; ordered, readable. |
| 06 | `track_6_over_the_edge` | **OVER THE EDGE** | Ruined/fractured collapsing edges, rusted surfaces; dark eclipse. |
| 07 | `track_7_drop_zone_surfer` | **DROP ZONE SURFER** | Dense kinetic signal canyon around a vertical energy chasm; dense signage; nebula. |
| 08 | `track_8_wave_surfing` | **WAVE SURFING** | Continuous surf canyon with a giant signal wall along the horizon; halo. |
| 09 | `track_9_neon_abyss` | **NEON ABYSS** | Monumental dark megacity over a deep void; eclipse; dense signage; energy chasm. |
| 10 | `track_10_neon_slipstream` | **NEON SLIPSTREAM** | Slender impossible spires, near-black ceramic lanes, minimal rest; no rare celestial. |
| 11 | `track_11_ex_gravity` | **EX GRAVITY** | Industrial vertical **machine spine** world; rusted plates; drop-driven. |
| 12 | `track_12_shadows_over_the_circuit` | **SHADOWS OVER THE CIRCUIT** | Muted glass framework/machine circuit; heavy haze; analytical signage. |
| 13 | `track_13_waveform_descent` | **WAVEFORM DESCENT** | Steep descent through **hanging architecture** below the route; nebula. |
| 14 | `track_14_kz_ascent` | **KZ ASCENT** | Near-black endgame spire climb, **no celestial body**; minimal signage; ascent hero. |

Colour is only one layer. Identity is carried by architectural family, hero
motif, composition scalars, route material family, signage density and sky
character, so the worlds remain distinguishable beyond colour.

## World system — what was generalized

New data module `src/world/SignalWorldProfile.ts`:
- `OfficialWorldProfile` — compact, authorable schema (architecture family +
  proportions/density/cutouts/spacing/supports, space openness/verticality/abyss,
  sky star/celestial/haze/tint, route material family, signage density/
  terminology/mascot, hero motif, celestial rarity, bounded section reaction).
- `SignalWorldProfileRegistry` — deterministic resolution by **trusted catalog
  id only**; unknown / custom / tutorial / lab resolve to `FALLBACK_WORLD_PROFILE`;
  a filename that resembles an official title can never select an official profile.
- `SIGNAL_DRIFT_PROFILE` is the frozen baseline (`usesOverride=false`).
- `stepProfileReactionGain` — bounded, smoothed section/drop gain.

New `src/world/SignalHeroMotifs.ts` — one authored hero composition per track
(orbital ring, suspended frame, signal wall, energy chasm, impossible tower,
hanging architecture, fractured archipelago, celestial ascent, inverted skyline,
machine spine, monolith field). Decoration only; every mesh is corridor-validated
before it is kept; bounded mesh counts with one shared material.

14 authored profiles keyed by the **actual** catalog ids in
`src/audio/SignalPackCatalog.ts`.

## Profile consumers (actual, not dead metadata)

| Consumer | What it changes |
|---|---|
| `src/world/World.ts` | resolves + propagates the profile; bounded reaction gain per frame |
| `src/world/SkylineArchitecture.ts` | architecture density, spacing, proportions, silhouette cutouts, signage density |
| `src/world/CitySignageSystem.ts` | signage amount/terminology/mascot gating, gated signage reactivity |
| `src/world/SignalHeroMotifs.ts` | per-track hero composition |
| `src/world/SignalLandmarks.ts` | landmark count/scale from hero scale |
| `src/world/CelestialLandmarks.ts` | celestial identity + rarity (incl. NONE), hero-star count, scale, gated reaction |
| `src/world/Megastructure.ts` | hero span (openness) and vertical scale |
| `src/world/ProceduralSky.ts` | real NEBULA / GALAXY_BAND / DISTANT_LIGHT_FIELD shader motifs + star density/tint + bounded SKY/ATMOSPHERE reaction |

**Repair pass additions.**
- **Inert path restored exactly.** Architecture family / slenderness / floating
  now genuinely change the batched skyline silhouette/proportion/support
  selection, while `profileFamilyShaping()` returns strict identity on the
  `usesOverride=false` path so Signal Drift and the fallback keep the exact
  authored HEAD formulas (step 6, `pDist*1.0`, `pTopY*1.0`, `sTopY*1.0`).
- **Persistent state resets every load.** `World.loadTrack` resets
  `profileReactionGain`, `MusicVisualController`, `ProceduralSky` and
  `Environment` profile state BEFORE applying the new profile, and applies the
  sky palette before the profile tint so tint is never overwritten. A previously
  loaded profiled track can no longer leak into Drift/custom.
- **Sky-only celestial motifs.** NEBULA / GALAXY_BAND / DISTANT_LIGHT_FIELD no
  longer alias MOON/HALO; they render as real bounded ProceduralSky shader
  motifs and place NO large body (NONE unchanged).
- **Hero motifs batched.** All accepted hero boxes collapse into ONE
  `InstancedMesh` (shared unit box + one material), validated using each
  placement's actual final world-space bounds; geometry is disposed on reload.
| `src/world/GeometryBuilder.ts` | route material family (platform/surf/edge treatment) |
| `src/world/Environment.ts` | background tint + atmosphere open/haze shaping |
| `src/world/ProceduralSky.ts` | star density + star tint |
| `src/world/MusicVisualController.ts` | stores bounded reaction bounds for the selected subsystems |

`src/core/Game.ts` passes the **trusted catalog id** on the official load path;
custom/tutorial/lab pass through the fallback (no filename inference).

## Music reactivity

- Section/drop response is driven by the existing section analysis + shared
  music bus. Each profile selects only 2–3 presentation families
  (`SKYLINE`, `SIGNAGE`, `HERO`, `SKY`, `ATMOSPHERE`); a bounded gain
  (`gainMin..gainMax`) glides over `smoothingSeconds` and only the profile's
  `curatedThemes` (e.g. `DROP`, `SURF`, `ASCENT`) reach the ceiling.
- The **global** `reactivityMultiplier` is unchanged, so the load-bearing
  gate/finish/knife reactivity is byte-for-byte identical.
- No mid-run world rebuild and no per-frame allocation: the gain is a single
  scalar multiplied into already-batched per-frame updates.


## Verified acceptance

- `npx tsc --noEmit` and ordinary `npm run build`: pass.
- Six focused Vitest files: 62 tests pass. Covers official profiles, canonical maps,
  final world geometry safety, signage, audio landmarks and the music catalog.
- All 14 official worlds loaded sequentially in the real WebGL Environment/World:
  no console errors, every final safety audit has zero surviving unsafe decoration.
- Flow State, Drop Zone Surfer, KZ Ascent and Signal Drift screenshots inspected.
  These checks establish rendered behavior; human art/feel approval is pending.
- All 14 canonical preset SHA256 hashes and 35 protected gameplay source hashes
  match their starting values. No gameplay generation or movement changes.
- Signal Drift/fallback skyline instance counts and recorded matrix values match
  the unmodified `2221269` synthetic fixture in
  `tests/fixtures/skyline-head-inert-snapshot.json`.
- Same-instance profile -> Drift -> fallback reset regression passes.
- Skyline disposal now removes its group from the scene. Reloads no longer retain
  disposed skyline objects. Hero pieces use one shared box InstancedMesh per world;
  every piece is tested using its final rotated/scaled bounds.

## Measured performance, with limits

At the same preview camera and song fraction (0.6), four presentation frames per
world, render counters reset per frame, no audio or gameplay run:

| Track | Fallback draw calls | Profile draw calls |
|---|---:|---:|
| Signal Drift | 150 | 150 |
| Flow State | 224 | 223 |
| Surf the Void | 227 | 225 |
| Airwave Theory | 177 | 175 |
| Gravity Line | 159 | 160 |
| Over the Edge | 138 | 144 |
| Drop Zone Surfer | 189 | 192 |
| Wave Surfing | 191 | 198 |
| Neon Abyss | 115 | 123 |
| Neon Slipstream | 115 | 109 |
| Ex Gravity | 139 | 144 |
| Shadows Over the Circuit | 131 | 132 |
| Waveform Descent | 193 | 203 |
| KZ Ascent | 163 | 162 |

Difference: -6 to +10 draw calls at this sampled view. This is a comparison against
same-track fallback composition, not a measured old-release FPS benchmark. No FPS
or frame-time claim is made. Gameplay frame pacing and human visual judgment need
playtesting. Production bundle retains the existing large-chunk warning.

Dev-only fixture: `dev/world-preview.html?track=ALL&t=0.6` reports 14 DOM rows,
errors, final safety, frame calls and hero instances. `baseline=1` selects fallback
composition at the identical camera/song position. One World is reused, previous
assets disposed, frame stats reset before each render. It never starts a run or
writes account, progress, reward, leaderboard or replay state.
