# PRE-VISUAL BASELINE

The contract for the next phase: a dedicated **visual / world / renderer
overhaul**.

This file is the boundary. It says what the visual pass may change and what it
must leave alone. Read `GAMEPLAY_INVARIANTS.md` for the behavioural detail and
`PERFORMANCE_BASELINE.md` for the measured starting point.

---

## 1. Why this boundary exists

Every prior roadmap phase hardened a different system: movement, surf, restore,
pointer lock, audio timing, save integrity, Signal Drops, official content
versioning. That work is now a known-good baseline.

If the visual pass also has to debug gameplay and product bugs, it will do both
badly. So: **presentation may change freely; behaviour may not change at all.**

---

## 2. MAY CHANGE

Everything visual. No permission needed.

- **Materials and shaders** — the cosmic karambit shader language, platform
  surfaces, surf faces, obstacle materials.
- **Lighting** — key/fill/rim balance, light temperature, time-of-day character,
  per-track light mood.
- **Fog and atmosphere** — haze, mist, void fade, depth grading.
- **Sky, stars, celestial bodies** — star fields, hero stars, moons, planets.
- **Architecture visuals** — silhouettes, motifs, scale, placement, edge light.
- **Decor visuals** — setpieces, signage, pylons, ruins, megastructure detail.
- **Post-processing** — bloom, grain, colour grading, any new pass.
- **VFX and particles** — world events, spectacle effects, transient responses.
- **World scale presentation** — how monumental the world *looks*.
- **Renderer architecture** — the internal rendering strategy.
- **UI micro-visuals** — only where compatible with the existing Signal OS
  identity, and only if not a redesign.

---

## 3. MUST NOT CHANGE WITHOUT EXPLICIT REASON

- `PLAYHEAD_MOVEMENT_V1` — every constant. `GAMEPLAY_INVARIANTS.md` §1.
- Surf physics.
- Collision geometry and collision policy.
- Route topology — node positions, connectivity, checkpoints, finish.
- Checkpoint logic and the atomic restore transaction.
- Void / OOB thresholds.
- Audio timing and the two-clock relationship.
- Rank thresholds and rank logic.
- PB and ghost validity rules.
- Signal Drop rules and the reward ledger key.
- Tutorial semantics.
- Save format and migration.
- Knife calibration and the viewmodel action hierarchy.

If a visual change appears to *require* touching one of these, the change is
wrong, not the invariant.

---

## 4. GUARDRAILS

### 4.1 Readability beats beauty

A visual change must never obscure:

- the route target
- the surf face
- a checkpoint
- the goal
- the HUD

If a shot looks better but the landing is harder to read, the shot loses.

### 4.2 Gameplay exclusion is not negotiable

New architecture must respect `RouteExclusionCorridor` and run through the world
geometry safety pass **after** placement. Gameplay volumes include platforms,
jump arcs, landings, headroom, surf travel, checkpoint runways, rejoin paths and
recovery shelves.

Never move gameplay to fit decoration.

### 4.3 Spectacle attaches to authored intent

Attach visual events to the semantic moments that already exist
(`SpectacleIntent` in `src/generation/OfficialSignalPack.ts`), not to
`if (track === X && time > 32.1)` scattered through rendering files.

See `docs/SIGNAL_PACK_AUTHORING.md`.

### 4.4 Consume the existing audio analysis

Do not build a second FFT or analyser. The bands, flux, section state, transients
and energy already exist on `world.visualController.state` and the audio-visual
channel object. Reuse them.

### 4.5 Use the authored per-track dream profile

Palette, motifs, signage density, star density and fog character come from the
track's authored profile. Do not invent a random palette per run; official tracks
are deterministic.

### 4.6 Signal OS is not yours to redesign

The menu identity was deliberately rebuilt. The visual pass is about the **world**.
Do not revert the shell to generic cards or restyle it as part of a world change.

### 4.7 The Armory is load-bearing

Do not alter knife calibration. Do not break Artifact `VideoTexture` lifecycle.
At most one artifact video decodes at a time, and browsing the Armory must
continue to create zero video elements.

### 4.8 Tutorial readability

Movement Lab may be beautified. Instructional readability must survive.

### 4.9 Performance

Frame consistency over spectacle. `PERFORMANCE_BASELINE.md` §7: scene complexity
is dominated by **signal spines and route nodes**, not by sky or UI. The heaviest
official track has ~2.8× the route nodes of the lightest.

Measure before and after. Do not optimise blind.

---

## 5. Determinism

Same track and content version must produce the same route, checkpoints,
spectacle markers and world identity. Ambient non-gameplay randomness may be
seeded; hero architecture must not be randomised per session.

A developer must be able to reload a track and see the same key compositions.

---

## 6. Frozen-content note

`SIGNAL_PACK_CONTENT_VERSION` is currently **1** and every authored rank target is
**disabled**. The calibration finding in `PERFORMANCE_BASELINE.md` §5 is
unresolved and requires human playtest — the visual pass must not "fix" it by
changing rank or route behaviour.
