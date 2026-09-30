# Player/account/replay and synchronized race acceptance

## Deployed backend

Supabase project aqtfqynloncgvtuksgus: migrations 20260930000000 through 20260930000004 applied; account-auth, submit-run and get-replay-url deployed. Existing project and private replay bucket retained. Public browser key only; functions perform their own session validation.

## Behavioral changes

Username/password accounts use GoTrue hashing and stable user UUIDs. Progression, local backups, migration markers, queued work and WR claims are scoped by account. Knife and drop-glove eligibility both participate in drop-pool completion. BLACKSTAR is excluded from future random drops; an accepted, strictly faster ranked WR earns its permanent server-derived award. Historical ownership remains compatible.

Replay metadata records knife and gloves once and renders them through ephemeral preview overrides without changing player equipment. The missing production replay retrieval function was deployed. Checkpoint restores initialize horizontal route-forward velocity to 500 display units (12.5 m/s), with zero vertical velocity; competitive starts remain zero. Movement equations and knife calibration are unchanged. Numeric sensitivity and slider share the persisted value.

Race root causes were a host/manual-start lobby path, missing loaded/second-ready protocol, local rather than shared race clocks, and remote placeholder scene lifecycle. The authoritative flow is LOBBY -> LOADING -> IN_GAME -> COUNTDOWN -> RUNNING -> FINISHED, with EXPIRED/abort recovery. Both lobby ready automatically load; both clients loaded then both in-game ready schedule one server start timestamp. Clock-corrected music/timer follow it. Remote capsule meshes remain attached and render interpolated transforms; same-spawn presentation is offset so the rival can be seen. Finish reports derive time from the server epoch and are idempotent.

## Verification

Root typecheck/build passed; 281 tests passed across 16 relevant files. Focused tests cover account isolation, reserved rewards, authority, replay metadata/preview, restore velocity, drop gloves, race wiring, and remote ghost lifecycle. The rollback-only deployed SQL acceptance script verifies accepted WR/slower/tie/unranked cases, reward claim idempotency and permissions, slow-loader/second-ready barriers, direct state-jump denial, shared epoch finishes and duplicate finish denial.

The real browser harness passed 27/27 race, fresh-browser, loadout-save and replay checks using two separate browser contexts/accounts against the deployed Supabase service and local application. A delayed client demonstrably blocked countdown; one second-ready blocked countdown; both clients entered PLAYING/RACING on the shared epoch; audio differed from the shared elapsed clock by milliseconds in the observed run; received remote movement changed ~24.3 metres. Controlled finish reports produced WIN/LOSS. Disconnect before GO reverted the survivor room to LOBBY. These reports exercise result authority; they do not constitute a human full-course race.

An existing accepted leaderboard replay successfully downloaded and decoded via get-replay-url. Fresh-browser knife/drop-glove ownership and both equips restored correctly after the persistence fix. Real equip changes automatically saved and later sync preserved them. Committed-change listeners exclude cloud hydration and replay previews; adoption is scoped to the account, and a save response cannot overwrite a selection made during its request. An old anonymous identity response cannot clear a newly signed-in account. The integration run used a cold Vite server to avoid duplicate singleton instances in timestamped hot-reload imports.

Reproduce: node tests/integration/two-browser-race.mjs --url http://127.0.0.1:3000 --exec <chromium.exe>. This creates disposable test accounts and ordinary cosmetic fixtures, never ranked leaderboard runs. Database checks: npx supabase db query --linked --file tests/integration/player-integrity-db-acceptance.sql (BEGIN/ROLLBACK).

## Limits

Run timing still originates in client submissions; there is no server replay resimulation or complete anti-cheat. Privileged WR flags are not trusted. Accounts deliberately have no email recovery. Human playtesting remains authoritative for movement feel, appearance and reactivity. Production Vercel verification requires authenticated project settings access; the connector settings call fails and the local Vercel CLI is logged out. Do not treat a main preview as production acceptance.

