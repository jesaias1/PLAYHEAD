# TRACK//RUN — PLAYTEST AUDIT LOG

This document tracks all critical, high, medium, and low severity issues identified during the audit pass.

---

## 1. MOVEMENT FEEL & PHYSICS AUDIT
- [ ] Ground acceleration & wish speed cap: Verify whether ground acceleration properly clamps to wishSpeed or allows slipping.
- [ ] Bunny hopping & landing frame friction: Inspect whether friction is applied during the landing frame before the jump triggers.
- [ ] Air acceleration & air strafing: Verify exact `PM_AirAccelerate` formula and wishDir construction. Check if air speed scales cleanly with mouse turns.
- [ ] Surfing: Test slope normal projection and ensure player does not stick to surf ramp or falsely trigger grounded state.
- [ ] Collider seam catching: Check whether capsule bottom catches on adjacent box colliders when sliding/bhopping across platforms.

## 2. COLLISION RELIABILITY & SPAWN SAFETY
- [ ] Start & Checkpoint Spawns: Ensure player never spawns intersecting a collider or falls through on tick 0.
- [ ] Kill plane & fall detection: Ensure death trigger doesn't loop infinitely or cause NaN coordinates.
- [ ] Decorative geometry collisions: Ensure decorative elements have collisions disabled so player doesn't clip them.

## 3. GENERATED ROUTE PLAYABILITY & PHRASING
- [ ] Transition readability: Setup -> Action -> Landing -> Recovery phrase rhythm.
- [ ] Route occlusions: Ensure subsequent platforms are clearly visible from takeoff edges.
- [ ] RouteValidator: Test validator on aggressive gaps and ensure repairs maintain realistic flow.
- [ ] Generation QA Stress Test: Build a headless generator harness simulating 100+ tracks to verify zero NaN, zero broken transitions, and strict monotonicity.

## 4. MUSIC -> LEVEL CAUSALITY & THE DROP
- [ ] Section themes & pacing: Verify macro sections (Flow, Ascent, Descent, Surf, Speed, Breath).
- [ ] Buildup -> Drop sequence: Ensure dramatic spatial transformation occurs at the synthetic track drop (~55s).
- [ ] Waveform architecture visibility: Ensure distant ribbon/pylons don't obscure the critical route.

## 5. CHECKPOINTS, AUDIO RESUME & SYNC
- [ ] Checkpoint seeking: Verify AudioEngine handles 10 rapid deaths without audio node overlap or clicks.
- [ ] Sync Delta: Verify progression tracking uses cumulative arc length rather than world coordinates.
- [ ] Speed metric: Verify HUD speed uses horizontal magnitude only.

## 6. REPLAY & UI POLISH
- [ ] Replay interpolation: Ensure no overshoot or gimbal lock.
- [ ] Menu interruptions: Escape key and mouse clicks should not trigger accidental jumps.
