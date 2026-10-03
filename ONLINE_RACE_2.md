# Online Race 2.0

Private first-to-finish races support 2–8 players, with capacities 2/3/4/6/8 and a recommended default of 4. Rooms start with at least two connected members; they need not be full.

## Authority and lifecycle

Atomic server joins enforce capacity and lock membership at LOADING. Account usernames and cosmetic loadouts come from server records. Every connected member must lobby-ready, load the same map fingerprint/version, then explicitly in-game-ready. The server assigns one future start epoch. Clients correct their clocks against the server and start the shared song at epoch-derived elapsed time, including late starts. Pre-GO movement freezes without changing movement physics.

A new race ID scopes each rematch. Stale writes and ghost samples are rejected. Server receipt time sets immutable microsecond finish times and ordering. The client reports crossing the finish; this is not server-simulated route validation or complete anti-cheat. Ranked PB/replay/reward validation remains separate and unchanged.

The first finisher spectates remaining racers with next/previous targets. Others continue until finished or DNF; overtime remains unranked. Results put finishers before DNFs. The host can rematch with at least two survivors, or return everyone to a fresh lobby, including with only one survivor.

Lobby departures release capacity. Loading departures abort safely, including delayed asynchronous loaders and late load-report responses. Countdown departures cancel the old GO and require survivors to ready again. Running departures become DNF after a 20-second heartbeat grace while others continue. Load timeout is 180 seconds; rooms expire after two hours.

## Rendering and performance

Up to seven remote signal ghosts use stable eight-color accents and account names. Account cosmetic metadata remains available in the roster/results; full remote character cosmetic models are deferred. Ghosts have no player collision or movement simulation. Networking sends at 12 Hz independently of rendering. An eight-snapshot bounded buffer interpolates with 100 ms presentation delay; restore discontinuities snap. HUD updates at 10 Hz. Placement uses checkpoint progress; no speculative live time gaps are shown. Final gaps use raw finish times.

Four local headless Chromium clients measured approximately 6.1 ms median and 6.2 ms p95 frame intervals with three remotes each. This is local evidence, not a general hardware guarantee. Human playtesting remains authoritative for visual quality, music response and feel. Eight-client racing performance is not established.

## Deployment and verification

Apply migrations 20261002000000 through 20261002000005 before deploying the frontend. They preserve accounts, PBs, leaderboards, replays and cosmetic ownership; retire legacy race write RPCs; and restrict race tables to members. These migrations were applied to the existing linked Supabase project.

Typecheck and production build passed. Seventeen focused files / 323 tests passed, including protected movement, surf, high-speed transfers and void policy. Full Vitest: 1,375 passed and three failures in unchanged ImportScreen hardcoded-track assertions (GhostRaceCatalogSweep, LeaderboardGhostIntegration, Mastery). Those unrelated onboarding failures are retained.

Actual independent browsers verified two- and four-player loading/ready gates, shared epoch/song time, remote visibility, immutable finishes, first-finisher spectating, clean rematch IDs and stale-write rejection. Four-player verification delayed one start by 6.5 seconds with a five-second clock skew. Eight-client capacity was verified; two simultaneous contenders for the final slot produced exactly one successful join. Outsider membership mutations and direct fabricated finish writes were rejected.

Browser scripts generate temporary account credentials in memory, never print or persist passwords, and avoid submitting fabricated ranked runs. Controlled finish calls verify lifecycle wiring; they do not prove human route completion or ranked replay validity.

```powershell
node tests/integration/online-race-2.mjs --url http://localhost:3000 --players 2 --exec <chromium.exe>
node tests/integration/online-race-2.mjs --url http://localhost:3000 --players 4 --late true --exec <chromium.exe>
node tests/integration/online-race-2-disconnect.mjs --url http://localhost:3000 --exec <chromium.exe>
node tests/integration/online-race-2-capacity.mjs --url http://localhost:3000 --exec <chromium.exe>
```

Use the production URL instead of localhost to verify a deployed build. Screenshots and JSON go to work/race-evidence by default; use --shots for another directory. No MMR, chat, public matchmaking, public spectators or new replay format is introduced.
