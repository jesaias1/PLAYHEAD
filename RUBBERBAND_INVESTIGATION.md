# PLAYHEAD — Rubberband / View-Snap Investigation Handoff

Technical handoff for a stronger reasoning model. Branch `wip/remote-playhead`.
Written after commit `bafc624` plus the raw-input work in this pass.

> **LATEST UPDATE (this pass) — read section 14 first.** The `[VIEW SNAP]`
> `YAW_MISMATCH` detector was **time-misaligned and produced false positives**.
> That is now fixed. The laptop runtime spike, and the coalescing question, are
> addressed by a new observational probe.

---

## 14. LATEST FINDINGS (this pass) — READ FIRST

### 14.1 The previous `[VIEW SNAP] YAW_MISMATCH` was a FALSE POSITIVE

**Confirmed.** `CameraController.applyMouseDelta()` mutates `yaw`/`pitch`
**synchronously inside the DOM mouse event**. The old detector accumulated raw
input during those events but compared "expected vs actual" later, inside
`CameraController.update()` — a different, frame-separated time interval. Because
yaw had already been mutated before the window opened, `actual` measured 0 while
`expected` was non-zero, producing `YAW_MISMATCH` on completely correct input.
This matches the human observations exactly (`rawX=-10, rawY=-3, expected != 0,
actual = 0`).

**Fix:** attribution moved to the event itself.

- `CameraController.onMouseApplied` fires **inside** `applyMouseDelta` with
  before/after yaw+pitch from that same call.
- `ViewSnapDetector.checkEvent()` compares them with a `1e-9` tolerance (exact
  arithmetic; only float noise allowed). Verified: `dx=-10, dy=-3` → silent, and
  the laptop-style `131/-188` → silent.
- `ViewSnapDetector.checkQuaternion()` is now the **only** frame-scoped check
  (quaternion vs authoritative yaw/pitch, catches a second orientation writer).
- A deliberate `justLocked` discard is reported as `[INPUT DISCARDED]`, never as
  a view snap.

Also fixed a real wrap bug in `checkQuaternion`: `Euler.setFromQuaternion`
normalises yaw to `[-PI, PI]` while `yaw` accumulates unbounded, so both are now
normalised into the same range before comparison. (179° vs −179° differ by a real
2° and are still reported; 181° vs −179° are correctly equal.)

### 14.2 The laptop spike: `movementX=131, movementY=-188`

Interpretation from the human runtime capture:

| Field | Value | Reading |
|---|---|---|
| magnitude | ~229 px | vs recent median 14.37 px → **15.95×** |
| `eventsThisFrame` | 1 | it arrived as a single dispatch |
| `timeSincePrevEvent` | ~12 ms | normal inter-event spacing (~83 Hz) |
| `frameDelta` | ~11.4 ms | ~88 FPS — **the machine was NOT struggling** |
| `RAW INPUT` | true | session confirmed `unadjustedMovement` |

So this is a genuine **single-dispatch** event carrying ~229 px. At 0.0022 rad/px
that is ~29° of yaw in one dispatch — and a single `movementX` of 700 px would be
a 90°+ instantaneous turn.

Note this **exonerates frame rate**: 11.4 ms frames are healthy, so "low FPS
caused it" is not supported by the evidence.

### 14.3 Coalescing probe — implemented and ready to answer the question

`?pointerInputExperiment=1` enables observation-only listeners on
`pointerrawupdate` (where supported) and `pointermove`. They **never apply
input**; the production `mousemove` path remains the single authoritative
mouse-look source, so no delta can be applied twice.

Feature detection in the test Chromium:

| Capability | Result |
|---|---|
| `PointerEvent` | present |
| `getCoalescedEvents()` | **present** |
| `pointerrawupdate` | **supported** |
| handlers registered | `pointerrawupdate` 1, `pointermove` 1 |

The probe reports, for the largest parent event seen: parent delta, constituent
count, every constituent delta, the sum, whether the sum matches the parent,
largest constituent, and timestamp spread. Verified with all 20 constituents
summing exactly to the parent and **zero** sum mismatches.

**Unresolved at time of writing:** whether a real laptop-generated 131/−188
event decomposes into several smaller physical samples or is genuinely one raw
sample. The probe answers this directly on the affected machine, and the overlay
shows `POINTER PROBE` plus a `breakdown:` line.

### 14.4 Raw-input session accounting

`RAW INPUT: true` previously could not be distinguished from a silent fallback.
`rawInputSession` now records `requestId`, `requestedMode`, `resolvedMode`,
`fallbackCount` and `lastError`, so the flag can only be true for the **current**
lock session. Observed: `requestedMode=unadjustedMovement`,
`resolvedMode=unadjustedMovement`, `fallbackCount=0` — raw input genuinely
resolved, no fallback used.

### 14.5 What is still NOT proven

`requestPointerLock({ unadjustedMovement: true })` **did resolve** on the laptop
and the spike still occurred. So OS pointer acceleration is **not** the whole
explanation; either it is not the cause, or something upstream (device driver /
browser event coalescing) still batches motion. The coalescing probe is the
instrument that decides this. **ROOT CAUSE REMAINS NOT YET PROVEN.**

---

## 1. HUMAN REPRODUCTION (verbatim observations)

| Input | Result |
|---|---|
| Stand still, no rotation | no snap |
| Stand still, **rapid yaw** left/right | **snap occurs** |
| Stand still, **rapid pitch** up/down | **snap occurs** |
| Hold `W`, no camera motion | generally fine |
| Hold `S`, no camera motion | generally fine |
| Hold `W` + rapid ~180° turn | **snap occurs** |
| Graphics LOW / HIGH | does not solve it |
| Multiple machines | reproduces on both a weaker and a stronger PC |
| An older backup build | also reproduced |

Critical property: **the player is completely stationary when it happens.**
Therefore no translation, collision, restore or physics path is involved.

---

## 2. CONCLUSIVELY RULED OUT (with evidence)

| # | Hypothesis | How ruled out |
|---|---|---|
| 1 | Player translation / physics body moves | Only 4 position writers exist; all restores logged. Stationary rotation produces **0 player drift** with position hard-pinned. |
| 2 | Camera translation desync | `[CAMERA DESYNC]` monitor asserts `camera.worldPos == player.position + eyeHeight`. Measured **desync = 0** across yaw/pitch/alternating/combined rotation. |
| 3 | Camera hierarchy / local-vs-world space | Camera has **no parent** (`parent=null`); local == world. `parent.add(camera)` appears nowhere. |
| 4 | Render interpolation rollback | `Clock.renderAlpha` is computed and **never consumed**. `syncCamera()` writes the camera from physics every fixed step. |
| 5 | Void restore firing | `[PLAYHEAD RESTORE]` verified working in the production bundle; fires only when `y < VOID_DEATH_Y`. |
| 6 | Collision depenetration pushing back | `[PLAYER CORRECTION]` verified live; backward-depenetration log entries **0**. |
| 7 | Duplicate `mousemove` listeners | Measured registration count = **exactly 1**, stable across boot, pause, resume and **5× repeated pause/resume**. `MovementLab` adds only a `keydown` listener. |
| 8 | Second orientation writer | `camera.quaternion` is a pure function of `(pitch, yaw, roll)` via `setFromEuler`. Runtime check re-derives yaw/pitch from the live quaternion and compares — no divergence. |
| 9 | Yaw wrapping bug | `yaw` is **never normalized** (unbounded accumulation). `wrapAngleDelta()` unit-tested on `179°→-179°`, `-179°→179°`, `359°→1°`, `1°→359°` → all resolve to 2°. |
| 10 | Pitch clamp storing excess delta | Single clamp applied to the stored value; nothing accumulates behind the clamp; clamp case excluded from snap detection. |
| 11 | Event batching / polling-rate dependence | 125/500/1000/2000/4000/8000 Hz for identical 800 px displacement → final yaw identical to **< 1e-12**. |
| 12 | Frame-rate dependence of mouse look | render 144/60/30 with mouse 1000 and render 60 with mouse 8000 → identical final yaw to **< 1e-9**. |
| 13 | Delta applied twice / lost | Every DOM event applied exactly once: `ratio == 1.0000` for `dx = 1, 5, 13, 80, 250, 900`. |
| 14 | FOV affects sensitivity | FOV 60/75/90/110 with 400 px → identical yaw. FOV is **not** read by any movement/input path. |
| 15 | Pause/resume or lock-loss corrupts input | Delta after pause/resume matches expectation exactly; `justLocked` correctly discards one event. |
| 16 | Movement Lab auto-reset on look state | `resetPlayer()` callers: constructor setup, `R` key, `y < -20` fall check, `Game` lab-enter/reset. **None depends on camera/look state.** |
| 17 | Viewmodel sway affects world orientation | Viewmodel has its own scene+camera; `?debugNoViewmodel=1` leaves world orientation numerically identical. |
| 18 | Render performance / pixel ratio | LOW graphics does not fix it; the mechanism is provably input-side. |

---

## 3. CAMERA / INPUT ARCHITECTURE

```
Scene (no parent chain)
  PerspectiveCamera
      position  <- PlayerController.syncCamera()   (player.position + eyeHeight)
      quaternion<- CameraController.updateCameraRotation()
                   Euler(pitch, yaw, roll, 'YXZ')
```

**Ownership — one owner per concern:**

| Concern | Owner |
|---|---|
| Player translation | `PlayerController.position` |
| Camera translation | `PlayerController.syncCamera()` |
| Yaw | `CameraController.yaw` (written only by `applyMouseDelta`, `setOrientation`) |
| Pitch | `CameraController.pitch` (same, then clamped) |
| Roll | `CameraController.roll` — forced `0` (`cameraBankEnabled = false`) |
| Quaternion | `CameraController.updateCameraRotation()` — pure function |

**Exact raw-input flow:**

```
mousemove (document)
  -> CameraController mousemove handler        (CameraController.ts ~line 336)
       if (!isLocked && !mouseLookEnabled) return;
       onRawMouseDelta?.(e.movementX, e.movementY, justLocked)   // diagnostics
       if (justLocked) { justLocked = false; return; }           // one event dropped
       applyMouseDelta(e.movementX, e.movementY)
            this.lastMouseDeltaX += deltaX;  this.lastMouseDeltaY += deltaY;  // for viewmodel
            yaw   -= deltaX * (BASE_SENSITIVITY * sensitivity)
            pitch -= deltaY * (BASE_SENSITIVITY * sensitivity)
            pitch  = clamp(pitch, -1.55, 1.55)
            updateCameraRotation()
```

- `BASE_SENSITIVITY = 0.0022` rad/px (frozen; `speedUnitScale` unrelated)
- Delta is **not** multiplied by frame time, DPR, FOV or canvas size
- `consumeMouseDelta()` only feeds **viewmodel sway**, never yaw/pitch

---

## 4. POINTER LOCK LIFECYCLE

- `lock()` — sets `mouseLookEnabled`, hides cursor, requests pointer lock
- `pointerlockchange` — sets `isLocked`; **on success sets `justLocked = true`**;
  on unexpected loss calls `onUnlock` → `Game.pauseGame()`
- `pointerlockerror` — clears `isLockPending`, calls `onLockChange(false)`
- `Game.resumeGame()` — requests lock first, transitions to PLAYING only after
  `onLockChange(true)` confirms (600 ms fallback timer)
- `mousemove` auto-relock path exists but is gated on `isLockPending` and a 1200 ms cooldown

**Known latent issue (not a snap source):** after a *failed* relock,
`justLocked` can remain `true` until the next accepted `mousemove`, discarding
that one event.

---

## 5. FIXED TIMESTEP

| Property | Value |
|---|---|
| Fixed step | `1/120 s` (`GameClock`) |
| Max substeps | `10` |
| Frame clamp | `frameDelta` clamped to `0.1 s` |
| Accumulator | `+= frameDelta`, `-= fixedDt` per step |
| Overflow | `subSteps >= 10` → `accumulator = 0` (time discarded, never rolls position back) |
| Interpolation | `renderAlpha` computed, **unused** |

---

## 6. DIAGNOSTICS ADDED (all opt-in, runtime URL flags, work in production)

- `?debugMovement=1` — console + on-screen overlay
- `?debugNoViewmodel=1` — hides hands/knife ONLY

Events, each with full field sets:

| Tag | Meaning |
|---|---|
| `[PLAYHEAD RESTORE]` | restore request + confirmation (reason, source, positions, void Y, camera, FOV, dt, checkpoint) |
| `[PLAYER CORRECTION]` | backward collision depenetration |
| `[CAMERA DESYNC]` | camera world pos ≠ player + eye, or camera moving independent of player |
| `[VIEW SNAP]` | orientation change not explained by applied mouse input, or quaternion≠yaw/pitch |
| `[RAW MOUSE SPIKE]` | raw `movementX/Y` outlier (robust z-score + MAD over rolling history) |

Overlay shows: BUILD, SPEED, PLAYER, YAW/PITCH, FOV, VOID_Y, RAW DX/DY, YAW/PITCH
before→after, EXPECTED/ACTUAL deltas, POINTER LOCK, JUST LOCKED, RAW INPUT,
MOUSE HANDLERS, LAST VIEW SNAP, LAST RAW SPIKE (both persist after the event).

---

## 7. KEY EMPIRICAL FINDING — THE INPUT PATH IS UNBOUNDED

Measured in a real Chromium against the production `dist/` bundle:

| Input | Applied turn |
|---|---|
| 5 events × ~5 px | 3.0° |
| **1 event × 80 px** | **10.08°** (exactly `80 × 0.0022` rad) |
| **1 event × 5000 px** | **630.3°** |
| **1 event × 3000 px** | **378.2° in a single frame** |
| 1 event × 3000 px vertical | 88.8° (clamped) |

**There is no outlier rejection, no plausibility bound and no per-frame angular
limit anywhere in the input path.** Any single DOM `mousemove` carrying an
unusually large `movementX/Y` produces a proportional instantaneous view jump —
and because expected == actual, `[VIEW SNAP]` correctly reports nothing. This is
**Class B**: the raw input itself jumps and the camera faithfully follows.

This exactly matches the human symptom (large instantaneous view jump,
no diagnostic event) and its trigger profile (rapid mouse motion).

---

## 8. MOST LIKELY MECHANISM (unproven causally)

`movementX/Y` is delivered **after OS mouse acceleration**. On Windows with
"Enhance pointer precision" enabled, pointer acceleration amplifies fast motion
non-linearly, so a fast flick or direction reversal can produce a single event
with a several-hundred-pixel delta — which at `0.0022 rad/px` is a 60–160°+
instantaneous turn.

This explains every observation:

- rapid yaw/pitch → acceleration curve is steepest during fast motion ✔
- stationary → only the view rotates ✔
- `W`/`S` alone → no rotation, so no cursor motion to accelerate ✔
- `W` + fast turn → rotation plus movement ✔
- multiple machines → depends on each machine's pointer-acceleration setting ✔
- older backup reproduced → the input path has never had bounds ✔

**Mitigation implemented:** `requestPointerLock({ unadjustedMovement: true })`
(Pointer Lock 2.0) requests the raw device delta, bypassing OS acceleration.
Feature-detected with an immediate fallback to plain `requestPointerLock()`.
Confirmed supported in the test Chromium (Promise returned, **resolved**); it was
**not** previously requested. This is a source fix — it does not cap speed,
smooth, or limit angles.

**Why this is not claimed as proven root cause:** OS acceleration cannot be
reproduced in headless Chromium with synthetic events, so the causal link
between acceleration and the human snap has not been directly observed.

---

## 9. UNRESOLVED HYPOTHESES (ranked)

1. **OS pointer acceleration producing multi-hundred-pixel single-event deltas**
   (mitigated but unproven). Verify by logging `[RAW MOUSE SPIKE]` on the affected
   machine — a spike coinciding with the snap confirms it.
2. **Pointer lock silently not active while `mouseLookEnabled` is true.** Then
   ordinary cursor motion (up to full screen width per event) is applied as
   rotation. Harness confirms a 400 px event still drives the camera when
   `isLocked = false`. Verify via `POINTER LOCK` in the overlay at snap time.
3. **`justLocked` stale after a failed relock**, discarding/permitting one event
   at the wrong time. Low severity; one event either way.
4. **A browser/driver coalescing anomaly** delivering a batched delta as one
   event. Would appear as `[RAW MOUSE SPIKE]` with a large `eventsThisFrame`
   pattern.

---

## 10. KEY FILES / SYMBOLS

| File | Symbols |
|---|---|
| `src/player/CameraController.ts` | `yaw`, `pitch`, `roll`, `applyMouseDelta`, `updateCameraRotation`, `lock`, `requestPointerLockSafe`, `plainRequestPointerLock`, `justLocked`, `onRawMouseDelta`, `onOrientationFrame`, `registeredHandlerCounts`, `rawInputActive` |
| `src/player/PlayerController.ts` | `position`, `updateFixed`, `syncCamera`, `collisionCorrectionLogs` |
| `src/player/RestorePolicy.ts` | `decideRestore`, `RestoreReason`, `wrapAngleDelta` (consumer) |
| `src/core/Clock.ts` | `GameClock.tick`, `maxFrameTime`, `maxSubSteps` |
| `src/core/Game.ts` | `gameLoop`, `restoreToCheckpoint`, `announceRestore`, `resumeGame`, `finalizeResume`, `checkCameraTranslationDiagnostics` |
| `src/core/MovementDiagnostics.ts` | `MovementDiagnostics`, `ViewSnapDetector`, `RawMouseSpikeDetector`, `wrapAngleDelta` |
| `src/lab/MovementLab.ts` | `resetPlayer`, `initListeners`, `dispose` |

## 11. RELEVANT COMMITS

| Commit | Purpose |
|---|---|
| `807e8bb` | void restores + gameplay world safety |
| `19d7687` | rendering optimisation + presentation polish |
| `254ac6d` | opt-in runtime movement diagnostics |
| `bafc624` | view-orientation snap diagnostics + viewmodel isolation flag |
| (this pass) | raw mouse spike detector + raw (unadjusted) pointer input |

## 12. TEST / HARNESS ARTEFACTS

| Artefact | Purpose |
|---|---|
| `tests/verify_prod_diagnostics.mjs` | production-bundle restore diagnostics |
| `tests/verify_view_snap_diagnostics.mjs` | listener lifecycle + view-snap detection |
| `tests/stress_raw_mouse.mjs` | linearity, polling rate, frame decoupling, spike, FOV, lock integration |
| `tests/ViewOrientationDiagnostics.test.ts` | wrap math, snap detection, clamp exclusion |
| `tests/RubberbandRegression.test.ts` | pitch/FOV/cadence matrix over the real accumulator |
| `tests/HighSpeedMovement.test.ts` | high-speed movement never resets |

## 13. WHAT WOULD DEFINITIVELY CONFIRM IT

On an affected machine, with `?debugMovement=1`:

1. A `[RAW MOUSE SPIKE]` line (with `movementX/Y` in the hundreds/thousands)
   appearing at the **same moment** as the visible snap → **Class B confirmed**,
   and the raw-input fix is correct.
2. No spike, but `POINTER LOCK false` at snap time → hypothesis 2.
3. No spike and `POINTER LOCK true` → the input path is exonerated numerically,
   and the remaining suspect is a GPU/display-side artifact rather than state.