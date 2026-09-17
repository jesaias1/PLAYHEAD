---
name: playhead-orchestration
description: Multi-model orchestration guide for PLAYHEAD. Defines roles, task specs, and invocation patterns for routing work between High-Intelligence Architect, Flash Implementation Worker, and Flash Verifier.
---

# PLAYHEAD Multi-Model Orchestration Guide

## Model Tiering Strategy
- **High-Intelligence / Architect (Gemini Pro / High)**:
  - High-level architecture, plan decomposition, movement physics invariants, complex debugging, final review.
- **Worker (`playhead-worker`, Model: `flash`)**:
  - Narrow single-task implementations (UI, TypeScript wiring, test updates, localized bug fixes).
  - Write tools enabled, subagent tools disabled.
- **Verifier (`playhead-verifier`, Model: `flash`)**:
  - Verification of diffs, running tests (`npm test`, `npm run build`), checking acceptance criteria and protected systems.
  - Strict PASS / FAIL reporting.
- **Investigator (`codebase-investigator` or built-in `research`, Model: `flash` / `flash_lite`)**:
  - Codebase search, file location, call-graph tracing without modifying files.

## Subagent Invocation Format

### 1. Worker Task Template
```typescript
invoke_subagent({
  Subagents: [{
    TypeName: "playhead-worker",
    Role: "Routine Code Worker",
    Model: "flash",
    Prompt: `
GOAL: [Concise objective]
FILES INVOLVED: [Exact file paths]
PROTECTED SYSTEMS: [Confirm movement/knife calibration untouched]
IMPLEMENTATION REQUIREMENTS:
1. [Clear step 1]
2. [Clear step 2]
ACCEPTANCE CRITERIA:
1. [Testable condition 1]
2. [Testable condition 2]
VERIFICATION COMMAND: npm test
`
  }]
})
```

### 2. Verifier Task Template
```typescript
invoke_subagent({
  Subagents: [{
    TypeName: "playhead-verifier",
    Role: "Diff & Test Verifier",
    Model: "flash",
    Prompt: `
TASK TO VERIFY: [Summary of task]
CRITERIA TO CHECK:
1. [Condition 1]
2. [Condition 2]
PROTECTED SYSTEMS CHECK:
- Verify PLAYHEAD_MOVEMENT_V1 was NOT modified.
- Verify knife calibration socket was NOT modified.
RUN COMMANDS:
- npm test
- npm run build
REPORT:
- PASS / FAIL for each criterion
- Exact diff summary
- Test run output
`
  }]
})
```

## Sequential Execution Rule
Never launch multiple worker subagents with overlapping write targets concurrently. Always follow:
**Plan -> Batch Worker -> Batch Verifier -> Checkpoint**.

## Cost / Quota Discipline
- Subagents consume model quota and MUST be minimized.
- Default to coherent implementation batches (e.g. 1 worker for an entire subsystem batch, followed by 1 verifier).
- Target 0–1 investigator, 1–3 workers, and 1–3 verifiers for even a large patch.
- Do NOT automatically spawn one worker/verifier pair per bullet point or minor edit.
- Investigators should only be invoked if architecture genuinely cannot be found via standard means. Workers can inspect relevant files directly.
- The Architect makes decisions once, writes batch specifications, and reviews concise batch verification reports.
