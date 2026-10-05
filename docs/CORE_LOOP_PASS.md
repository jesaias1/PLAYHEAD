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

## Follow-up audit — results to competition (2026-10-05)

Scope: connect an official solo result directly to the SAME canonical track's
existing competition, without a new system or a menu hunt. No submission,
rewards, movement, Custom Audio, Academy, race-sync or Armory-renderer change.

Audit findings (all preserved unless noted):

- Rank goals — `SignalPackMastery.nextRankTarget` / `describeNextRankTarget`
  already read the authoritative `PlayerStats` multipliers and mistake gates;
  unchanged.
- First-Diamond / reward attribution — the results screen already derives
  `diamondJustMastered` from authoritative mastery progress and shows the drop
  only from the server-minted id; unchanged. Guests still see SIGNAL MASTERED
  without a fabricated mint.
- Full-pack SIGNAL_MASTER glove — `masteryGloveSystem` already derives it from
  Diamond on every canonical signal; unchanged, BLACKSTAR remains WR-exclusive.
- Next signal — `nextSignalAfter` follows authored order and revisits unfinished
  mastery after the last signal; unchanged.
- Online Race rematch / shared progression — the room already feeds the shared
  official finish context and clears run feedback between scheduled races;
  unchanged.
- Custom Audio — never sets `currentOfficialTrackId`, so it can never publish to
  a world board, earn a Signal Drop or write official mastery; unchanged.
- Account hydration — `CloudProgression` + `authService.refreshAccountIdentity`
  already reconcile PB/rank/drop state; unchanged.

Narrow fix added (the only meaningful gap):

- Results now carry a compact world-PB line (accepted PB time/position + nearest
  opponent's name/time/gap) plus a secondary `[ VIEW LEADERBOARD ]`
  action that opens the SAME canonical track's existing board (select aimed at
  the current signal, then the normal tab refresh). It is offered only for an
  official, non-overtime, non-Custom-Audio run and is distinct from the existing
  optional `[ ADD TO LEADERBOARD ]` offline local queue action.
- `RACE GHOST` appears only when the nearest-above entry actually carries an
  accepted replay with supported version, path, hash and run ID. The payload is fetched only
  inside the existing `raceLeaderboardGhost` path, i.e. after the explicit click,
  and the run enters the normal countdown/play directly
  (`raceLeaderboardGhostAndPlay`, reusing the PB-duel flow).
- The board is fetched ONCE per eligible finish, chained AFTER the submission
  settles so the player's own position is accurate. A monotonic token plus a
  track/screen guard discards stale replies. The generation is captured BEFORE
  submission, so a delayed submission from an older same-track finish cannot
  launch a new request against the later report. Retry, next signal, custom audio,
  track selection, menu return and a new finish invalidate and hide it.
- Offline, guest-with-no-board and no-replay cases hide the block or the target
  row; no rank or opponent is invented. The panel run-lookup cache is primed by
  the same fetched page so `RACE GHOST` resolves without a second fetch.
- RETRY and the PB duel remain prominent. Board browsing, local submission,
  replay viewing and return are grouped under keyboard-accessible MORE OPTIONS.
  Ghost loading locks competing navigation until it settles, reports failures
  visibly and restores the previous enabled states. Unknown world position is
  labelled POSITION UNAVAILABLE; invalid time data supplies no invented target.

Limits: an authenticated account is required for a real world position on the
live backend; the local harness runs offline with aborted network calls, so it
verifies the honest offline/guest presentation, the replay gate and the lazy
click only. Real human movement feel, legal competitive times and live
cross-account ranking remain human-only validation.

Follow-up local acceptance: `npx tsc --noEmit` passed; `npm run build` passed with
the existing large-bundle advisory; the focused 12-file vitest set passed 357/357;
`tests/integration/core-loop.mjs` passed 29 checks with no page exceptions,
including delayed-submission regressions, failed/duplicate navigation, replay
return and reachable secondary controls at 1280x720 and 1440x900. A real accepted
Signal Drift leaderboard payload was verified on production. The live two-browser
race lifecycle passed 15 checks including controlled finish reports and rematch;
those reports bypass ranked progression and never enter the world leaderboard.
