# PLAYHEAD — PROJECT CONTEXT & PROTECTED CONSTRAINTS

## Project Overview
- **Core**: First-person music-driven movement game (Vite, TypeScript, Three.js, Web Audio API).
- **Movement**: Bhop, Source/GoldSrc-inspired air-strafing, surfing.
- **Audio**: Pre-rendered & procedural Signal Pack tracks (14 catalog tracks) + user custom audio injection.
- **Aesthetic**: Cosmic Pixel Brutalism, terminal/operator-console UI.

## Protected Systems (DO NOT MODIFY WITHOUT EXPLICIT USER INSTRUCTION)
1. **Movement Physics (`PLAYHEAD_MOVEMENT_V1`)**:
   - `src/core/PlayerController.ts` movement constants (gravity, ground/air acceleration, friction, jump impulse, surf stickiness, max air speed) are frozen.
   - NEVER tweak movement parameters to fix level or route generation issues.
2. **Surf Physics & Mechanics**:
   - Approved ramp stickiness and sliding dynamics in `PlayerController.ts` are protected.
3. **Calibrated Karambit Socket Transform**:
   - Position: `[0.0093, 0.1107, 0.0033]`
   - Rotation (radians): `[3.034, 0.3737, 0.2205]`
   - Scale: `1.011`
   - Procedural viewmodel motions (sway, bobbing, actions) must only modify parent/action groups (`actionGroup`), never mutate the base knife socket.
4. **Clean Scope & Asset Integrity**:
   - No unrelated refactoring or drive-by cosmetic rewrites.
   - Runtime assets must reside in project assets (`public/assets/`), never external or Downloads paths.

## Model Orchestration Workflow
- **Architect / Primary Model (Pro / High-Intelligence)**:
  - Architecture, task decomposition, complex bug diagnosis, movement/surf physics reasoning, final review.
- **Implementation Worker (`playhead-worker`, Model: Flash)**:
  - Executes coherent batches of tasks. Respects protected systems. Reports concise diff and test status.
- **Verifier (`playhead-verifier`, Model: Flash)**:
  - Inspects diffs, runs `npm test` and `npm run build`, verifies protected systems, strictly outputs PASS / FAIL.
- **Cost / Quota Discipline**:
  - Subagents are model calls and must be minimized to preserve 5-hour quotas.
  - Default to coherent implementation batches (e.g. 1 worker for entire Route batch, 1 worker for entire Armory batch).
  - Target 0–1 investigator, 1–3 workers, and 1–3 verifiers for even a large patch.
  - Do NOT automatically spawn one worker/verifier pair per bullet point or minor edit.
- **Execution Order**: Sequential single-writer pipeline (Architect Plan -> Batch Worker -> Batch Verifier -> Final Review).
