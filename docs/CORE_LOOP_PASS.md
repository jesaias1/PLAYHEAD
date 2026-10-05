# PLAYHEAD core loop acceptance

## Audit of the production starting point

| Connection | Initial state | Outcome |
| --- | --- | --- |
| New player → Signal Drift | DONE | Preserve the authored first signal and optional Academy. |
| Finish → rank/PB | PARTIAL | Existing rank evaluator and durable records; prioritize PB improvement and rank targets. |
| Results → another run | WEAK | Add a visible next goal, optional recorded duel, and direct next-signal play. |
| Signal Pack → mastery journey | PARTIAL | Preserve all 14 signals and order; show next tier, needed time, MASTERED and existing mastery counts. |
| Leaderboard → replay/ghost | DONE / PARTIAL | Preserve validated trajectory playback; identify the visible next opponent above the player and gap. |
| First Diamond → unique drop | DONE | Preserve local achievement tracking and server-issued unique awards; explain acquisition without confusing older stored drops. |
| Reward → Armory | DONE | Existing results action opens real inventory; SOURCE already describes Signal Drop, mastery and World Record origins. |
| All Diamonds → prestige | DONE | Existing SIGNAL_MASTER glove derives from all official ranks. BLACKSTAR stays WR-exclusive. |
| Online finish → progression | DONE / WEAK | Actual gate finish already enters shared official recording/submission before spectating; expose local PB/rank and rival gap in room results. |
| Race → rematch | DONE | Preserve room/server lifecycle and reset run feedback before the next scheduled race. |
| Account → return | DONE | Existing CloudProgression hydrates PB/rank/drop state; no new independent unlock state or schema. |
| First-signal source guards | BROKEN | Three existing assertions rejected a hardcoded ID. Use the canonical first catalog entry instead. |
| Optional favorites/featured signals/new achievements | MISSING, intentionally skipped | No extra systems required to improve the core loop. |

## Implemented loop

Results place the next rank or PB goal and next official signal above the primary
time/PB/local-position metrics. Remaining diagnostics are available under RUN DATA.
Rank goals use PlayerStats multipliers and its Silver/Gold/Diamond mistake limits.
Selected signal cards read canonical cached analysis duration; the menu never
guesses a medal threshold from soundtrack metadata. No per-frame progression work.

RETRY reuses the loaded world and clears an explicit recorded duel. The existing
solo ghost setting still controls normal PB/Echo presentation. RETRY VS PB uses
the existing identity-validated trajectory and enters normal countdown/play;
a slower fallback replay is labeled BEST RECORDED GHOST. Failed selections report
an error and duplicate navigation is guarded. NEXT SIGNAL follows authored order
without a main-menu trip; the final signal offers a return to unfinished mastery.

An official PB uses the previous official record, not whether a new local replay
happened to be saved. First PBs have no invented improvement amount. First Diamond
shows SIGNAL MASTERED even for guests. Only the asynchronous server-issued drop
answer produces the acquired message; an older unopened drop remains STORED SIGNAL.

Room results reuse the local official finish context for rank/PB and the existing
race rows for a nearest-rival gap. DNF cannot display local finish feedback, and
new scheduled races clear it. Synchronization, finish authority and rematches
are unchanged. This is presentation of shared progression, not a second economy.

## Preserved boundaries

Movement, surf equations, camera/sensitivity, route generation, Custom Audio
analysis, Academy physics, race synchronization, calibrated viewmodel transforms,
drop probabilities and server WR authority were not changed. Custom Audio retains
its existing local experience and does not write official mastery. No XP, money,
chores, new achievement database, social network or music uploads were added.
Guest play remains available; existing sync/drop account copy remains contextual.

Mastery counts mean canonical signals with Bronze-or-better, Gold-or-better and
Diamond respectively. All-pack prestige means Diamond on every canonical signal.
No vague completion percentage is introduced.

## Validation

Acceptance uses the pure target tests, the existing full regression suite, and
`tests/integration/core-loop.mjs`. The browser harness runs offline, uses assisted
crossings of the real finish gate, and separates real product transitions from
presentation fixtures. It covers first finish, retry, PB gain, explicit PB duel,
next signal, reload mastery, old-drop attribution, cloud-PB/fallback copy and race
feedback/reset. It cannot prove human movement feel or legal competitive times.

Authenticated cross-device mastery and legitimate ranked online finishes still
require human testing. The live room harness covers server room lifecycle and
rematch with controlled finish reports, deliberately bypassing ranked submission.
Assisted test finishes are never uploaded to production leaderboards.

Local acceptance: `npx tsc --noEmit` passed; `npm run build` passed with the existing
large-bundle advisory; `npx vitest run` passed all 1,407 tests. The core-loop browser
harness passed 14 checks with no page exceptions. The existing release-candidate
browser regression passed 41/41, including result/replay restoration, reachable
actions at 1280/1440/1920 widths, custom audio, Academy and loadout reload.
