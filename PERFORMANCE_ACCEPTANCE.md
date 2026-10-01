# PLAYHEAD performance acceptance

## Scope and changes

One focused pass; movement/surf equations, fixed timestep and accumulator, checkpoints/restore speed, mouse sensitivity, camera/FOV, knife socket, gameplay geometry and all presentation settings are unchanged.

- Build the protected-corridor debug volumes only when Shift+C first requests them. Normal loads previously created 66 invisible geometries and materials.
- Reuse movement basis/wish vectors, camera rotation Euler and consumed mouse-delta storage. Existing no-argument basis getters still return independent vectors.
- Skip gate/remote diagnostic object creation when the existing dev overlay is hidden. The overlay's update already returned early; its string formatting was not running while hidden.
- Reuse the route-signal sample and skyline distance-culling matrix/vector.
- Compile loaded world materials in existing run preparation, before normal countdown or staged race readiness. This warms additional programs; it does not guarantee every texture, post-processing or viewmodel first-use cost is eliminated. Quick restart reuses the same programs.

## Observed before / after

Baseline captured before source changes at commit 3a4600a. Isolated headless Edge, canonical Signal Drift, same spawn view, 1600x900 drawing buffer, AUTO resolved HIGH, renderScale 1, DPR cap 2 and decoration LOD 0 for both samples.

| Metric | Before | After |
|---|---:|---:|
| Draw calls across world/post passes | 283 | 283 |
| Triangles | 17,812 | 17,812 |
| Renderer-tracked geometries | 222 | 222 |
| Textures | 45 | 45 |
| Unique scene geometries | 294 | 228 |
| Unique scene materials | 223 | 157 |
| Renderable nodes with automatic matrix updates | 243 | 177 |
| Compiled programs | 42 | 71 |
| CPU-only rAF median / p95 / maximum, ms | 16.7 / 16.7 / 16.8 | 16.7 / 16.8 / 16.8 |
| CPU-only frames over 25 ms / 50 ms | 0 / 0 | 0 / 0 |
| Steady world.update average, ms | 0.086 | 0.085 |

The 66 debug resources were not rendered, so their removal reduces resident objects and traversal work, not visible draw calls. The 29 extra programs were compiled during preparation. Per-tick allocation removal is confirmed by the diff; GC events and hardware shader hitch duration were not measured.

The full renderer used software WebGL in the isolated harness. Its roughly 300 ms frame intervals cannot establish normal hardware performance. For the six-second CPU-only comparison the render function was stubbed; these rAF figures are NOT rendered-game FPS. CPU timings show no meaningful measured gain. This pass reduces unused resources, allocation pressure and first-use compilation risk; improved hardware smoothness remains unproven.

## Validation and limits

Root: npx tsc --noEmit and npm run build passed. 259 focused tests passed across 14 files: camera direction, movement math/regression/high speed, surf physics, checkpoint velocity/void restore, quality presets, POV/replay entry/preview, recorded ghost, friend race ghost and lobby readiness. No new graphics menu or profiler was added.

Worker runtime checks exercised normal Signal Drift loading/play, forward movement, hidden/shown dev overlay and lazy corridor visualization. Route-position probes exercised surf and dense sections, but did not preserve comparable per-section timing samples; do not claim a dense/surf speedup. Dormant ghost-manager update was timed; this does not represent an active remote peer or populated PB playback. Root live browser verification checks ordinary world loading and accepted leaderboard WATCH after deployment. A two-client online performance comparison and hardware GPU profile remain unmeasured.

No visual setting, scene geometry, lighting, bloom, fog, reactivity or intended quality was reduced. Browser inspection can verify presence/rendering; human playtesting remains authoritative for visual quality and movement feel.

Local raw evidence: work/performance-evidence/perf-baseline.json, perf-after.json and perf-pass.mjs. The harness is a disposable development probe and is not shipped in player code. Preserve the unrelated experimental files.
