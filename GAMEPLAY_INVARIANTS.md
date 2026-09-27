# GAMEPLAY INVARIANTS

Machine-readable enough for a future coding agent. **If you are about to change
something listed here, stop and read the note first.** These are not style
preferences; each one is either human-approved or guards a bug that has already
shipped once.

---

## 1. MOVEMENT — `PLAYHEAD_MOVEMENT_V1` — FROZEN

| Constant | Value |
|---|---|
| fixed timestep | 120 Hz |
| gravity | 24.0 m/s² |
| jumpVelocity | 8.8 |
| groundAcceleration | 10.0 s⁻¹ |
| airAcceleration | 90.0 s⁻¹ |
| maxGroundWishSpeed | 14.0 m/s |
| maxAirWishSpeed | 3.0 m/s |
| supplementalAirSteer | 3.5 rad/s |
| friction | 4.5 |
| stopSpeed | 3.0 |
| coyoteTime | 0.12 s |
| jumpBufferTime | 0.15 s |
| playerHeight | 1.8 |
| radius | 0.5 |
| eyeHeight | 1.62 |
| speedUnitScale | 40 |
| speed cap | **none** |
| FOV | ≈75° |

Air acceleration is classic Source vector-addition. Jump is applied **before**
friction so bhop momentum is preserved.

**Do not change any of these to make a level work. If a route does not work,
change the route.**

Source of truth: `src/player/MovementConfig.ts`, `src/player/PlayerController.ts`.
Guard: `tests/MovementRegression.test.ts`, `tests/HighSpeedMovement.test.ts`.

---

## 2. SURF — FROZEN

No magnetising, no auto-steer, no spline guidance, no increased grip, no faked
speed. Fix only a *demonstrated* physics bug.

Guard: `tests/SurfPhysics.test.ts`, `tests/SurfConnectivityRegression.test.ts`,
`tests/OptionalSurfValidation.test.ts`.

---

## 3. KNIFE CALIBRATION — FROZEN

```ts
knifeGroup.position.set(0.0093, 0.1107, 0.0033);
knifeGroup.rotation.set(3.034, 0.3737, 0.2205);
knifeGroup.scale.set(1.011, 1.011, 1.011);
```

Cosmetic motion (F pulse, Mouse1 jab) animates an **action group above** the
socket: `scene → rootGroup → swayGroup → motionGroup → actionGroup → rig`. The
socket transform is never written by action code.

Source: `src/viewmodel/ViewmodelAssetLoader.ts` (the only writer),
`src/viewmodel/ViewmodelController.ts` (action groups only).

---

## 4. TIMING AUTHORITY

Two clocks, with a defined relationship:

| Clock | Owns |
|---|---|
| `AudioEngine.getCurrentTime()` (Web Audio `ctx.currentTime`) | the **music**: world reactivity, song director, section events |
| `runElapsedTime` (accumulated fixed steps) | the **run**: timer, rank, PB, overtime, ghost, splits |

They stay coherent because **both freeze on pause and both rewind on checkpoint
restore** (`audioEngine.seek(checkpoint.time)`).

`GameClock` clamps `frameDelta` to **100 ms** and caps catch-up at **10
substeps**, so a backgrounded tab cannot produce a physics blowout or buffered
jumps.

**Do not introduce a third clock.** Do not let `performance.now()`, frame count
or physics ticks become a competing source of truth.

Guard: `tests/SubTickFinishTiming.test.ts`.

---

## 5. RESTORE — ATOMIC, AND VERIFIED

There is exactly ONE restore path: `Game.restoreToCheckpoint()`.

Sequence: re-entrancy guard → set `isRestoring` → capture diagnostics → resolve
spawn from **real platform bounds + route-forward look target** (never a fixed
world offset) → `setPosition` → reset finish-gate motion → `setOrientation` →
`resetKeys` → `audioEngine.seek()` → queue `pendingRestoreVerification`.

The verification step runs on the **next frame** and requires the authoritative
position to be within 3 m of the target and above the kill plane before it
releases `isRestoring`. It re-forces the transform up to **3 attempts** before
falling back. This is what prevents the historical
"RESTORED TO CHECKPOINT while still falling" bug.

**Do not add a second partial teleport path.**

Guard: `tests/VoidFallRegression.test.ts`, `tests/VoidRestorePolicy.test.ts`,
`tests/RubberbandRegression.test.ts`.

---

## 6. VOID / OOB

- The ONLY gameplay death is crossing the authoritative void boundary:
  `PhysicsWorld.getVoidDeathY()` = lowest **final gameplay** geometry − margin.
- **Never** derive the death plane from the current checkpoint: that raises it
  above lower route sections and teleports legitimate players.
- Decorative geometry may extend kilometres down and must not affect the plane.
- Airborne time, speed, horizontal distance, distance from the route, skipped
  platforms, missing ground contact and being below the local platform must
  **never** restore the player. Long high-speed transfers are intended.
- Numeric corruption (NaN / Infinity / absurd coordinates) routes to a
  **separate** emergency path: `src/player/RestorePolicy.ts`,
  `EMERGENCY_COORD_LIMIT = 1_000_000`.

---

## 7. RANK

Rank is computed in `src/player/PlayerStats.ts` from
`paceRatio = completionTime / targetTime` plus a mistake budget:

| Rank | paceRatio ≤ | max mistakes |
|---|---|---|
| DIAMOND | 1.04 | 0 |
| GOLD | 1.18 | 1 |
| SILVER | 1.40 | 3 |
| BRONZE | 1.85 | — |

`targetTime` is the **song duration** (`currentAnalysis.duration`). Overtime runs
are unranked in intent.

**Known calibration finding (unresolved, needs human playtest):** every official
route's physics-derived achievable time exceeds its song, so no official track is
completable on running and jumping alone within the music. See
`PERFORMANCE_BASELINE.md` §4 and `docs/SIGNAL_PACK_AUTHORING.md`.

Guard: `tests/PlayerRankBalance.test.ts`, `tests/RankResultCopy.test.ts`.

---

## 8. OVERTIME

When the music ends before the finish:

- music ends naturally — **no restart, no loop**
- state becomes `SIGNAL LOST // OVERTIME`
- the player may continue
- the run becomes unranked
- **no PB, no Diamond, no Signal Drop**

PB is gated explicitly (`if (this.replayRecorder.hasData() && !isOvertime)`).

---

## 9. PB / GHOST

PB updates **only** after a successful, ranked, valid, faster run. Never on
failure, overtime, abort, tutorial or Movement Lab practice.

Ghost data is associated with a track and a route version. A route/content
version change must not render a ghost through new geometry.

Guard: `tests/ghost_racing.test.ts`, `tests/GhostRace.test.ts`,
`tests/PresetRouteVersion.test.ts`.

---

## 10. SIGNAL DROPS

**One Diamond per unique official track grants ONE Signal Drop, ever.**

The ledger is keyed by **track id**, not by content version. Changing a route
must never grant a second drop for the same track. Already-earned drops are never
revoked. Unspendable drops are **banked**, never discarded and never replaced
with filler.

The reward is selected and persisted **before** the reveal animation, so a
reload cannot reroll it.

Guard: `tests/ArmorySignalDrops.test.ts`, `tests/SignalDropGloves.test.ts`,
`tests/SignalDecoder.test.ts`.

---

## 11. DECORATION COLLISION POLICY

- Decoration is **visual-only** by default and must never be landable.
- One authoritative protected region: `RouteExclusionCorridor`.
- Final validation runs on **final world-space geometry**, after all placement,
  scaling and rotation, and includes route + surf ramps + recovery shelves.
- Never trust a proxy radius; measure real bounding boxes.
- Invalid decoration is **rejected**. Never move or deform gameplay to fit decor.

Guard: `tests/WorldGeometrySafety.test.ts`,
`tests/RouteExclusionCorridor.test.ts`.

---

## 12. OFFICIAL CONTENT VERSIONING

| Version | Meaning |
|---|---|
| `ROUTE_GENERATION_VERSION` | generator output version; gates preset staleness |
| `SIGNAL_PACK_CONTENT_VERSION` | authored official content as a whole |
| `OFFICIAL_PROFILE_VERSION` | per-profile shape |

`PresetLevelCache` refuses a preset whose `generationVersion` mismatches, so a
generator change cannot silently load a stale route.

---

## 13. WHAT MAY CHANGE FREELY

Nothing in this document. Everything **visual** may change: materials, lighting,
fog, sky, stars, architecture appearance, decor appearance, shaders,
post-processing, VFX, particles, world scale *presentation*.

Presentation may change. **Behaviour may not.**
