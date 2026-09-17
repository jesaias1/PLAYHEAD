# AGENTS.md — Durable Rules for PLAYHEAD Sessions

Concise operating rules for any agent (DeepSeek Harness, Gemini, or otherwise)
working in this repository. See `GEMINI.md` for the wider project context.

## Identity & Stack

- **PLAYHEAD** is a first-person, music-driven movement game.
- Stack: Vite + TypeScript + Three.js + Web Audio API. Tests: Vitest.
- Aesthetic: **Cosmic Pixel Brutalism / PLAYHEAD SIGNAL RENDER** — terminal /
  operator-console UI, monumental brutalist architecture, authored pixel textures.
- The world should feel connected to the music: selected architecture breathes
  with the track, strong transients produce satisfying glow responses.

## Protect These. Always.

1. **`PLAYHEAD_MOVEMENT_V1` is FROZEN.**
   Never alter gravity, jump velocity, ground/air acceleration, max wish speeds,
   supplemental air steer, friction, stop speed, coyote time, jump buffering,
   bhop landing behaviour, velocity preservation, or camera movement behaviour.

2. **Approved surf physics are FROZEN.** Do not change surf movement equations.

3. **NEVER fix a route, world, or visual bug by altering movement.** Gameplay
   geometry and gameplay rules win over decoration, visuals, and convenience.

4. **Karambit calibration is FROZEN:**
   - position `[0.0093, 0.1107, 0.0033]`
   - rotation (radians) `[3.034, 0.3737, 0.2205]`
   - scale `1.011`
   Procedural viewmodel motion may only move parent/action groups, never the
   base knife socket.

5. **Audio-reactive visuals** (gate/finish beacons, adaptive viewmodel accent)
   are load-bearing identity. Only change them to repair a real regression.

## Void / Restore Rules

- The ONLY gameplay death is crossing the authoritative world void boundary
  (`PhysicsWorld.getVoidDeathY()` = lowest final gameplay geometry − margin).
- Airborne duration, speed, horizontal distance, distance from the route,
  skipped platforms, missing ground contact, and being below the local platform
  must **never** restore the player. Long high-speed transfers are intended.
- Never derive the death plane from the current checkpoint — that raises the
  plane above lower route sections and teleports legitimate players.
- Numeric corruption (NaN / Infinity / absurd coordinates) routes to a
  **separate** emergency path (`src/player/RestorePolicy.ts`). See
  `tests/VoidRestorePolicy.test.ts` and `tests/HighSpeedMovement.test.ts`.

## World Safety Rules

- One authoritative protected gameplay region: `RouteExclusionCorridor`.
- Final decoration validation runs on **final world-space geometry**, after all
  placement/scaling/rotation, and must include route + optional surf ramps +
  recovery shelves.
- Never trust a proxy radius; measure real bounding boxes (rotated geometry can
  be several times larger than its nominal dimension).
- Invalid decoration is rejected — never move or deform gameplay to fit it.

## Working Method

- **Inspect before editing.** The repository is the source of truth.
- No unrelated refactors. No drive-by rewrites. Keep changes small and contained.
- No destructive Git: no reset, rebase, force-push, or history rewrite.
- **Use the repo's existing Git identity.** Never override the author and never
  use a synthetic/local identity such as `playhead@local`.
- Current development branch: `wip/remote-playhead` (deployed via Vercel).
- Runtime assets belong inside the project (`public/assets/`), never external
  or Downloads paths.

## Verification

- Always run: `npx tsc --noEmit`, `npm run build`, `npx vitest run`.
- Tests verify wiring and stability — they do **not** prove visual quality.
- **Human playtesting is authoritative** for feel, pulse strength, colour
  balance, hand appearance, and whether reactivity is actually satisfying.
  Do not claim visuals are correct until a human has seen them.
