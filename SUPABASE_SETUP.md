# PLAYHEAD — SUPABASE ONLINE V1 SETUP

Everything in this document is a manual step you must run once. The repository
contains all required code (client, services, migrations, Edge Function, storage
policies); nothing here was auto-deployed, because the publishable key is a
*browser* credential and cannot create schema or deploy functions.

**Do not paste a `service_role` key into any `VITE_*` variable.** The browser
bundle must contain only the publishable key.

---

## 0. What is already in the repository

```
src/online/supabaseClient.ts        client + status (OFFLINE/CONNECTING/ONLINE/ERROR)
src/online/AuthService.ts           anonymous auth + profile
src/online/CloudProgression.ts      migration, merge, offline queue
src/online/LeaderboardService.ts    public boards + submission
src/online/RaceRoomService.ts       friend sessions (best-time session)
src/online/MapIdentity.ts           canonical map identity + fingerprint
src/online/OfficialMapRegistry.ts   accepted canonical maps (see step 8)
supabase/migrations/20260922000000_online_v1.sql
supabase/functions/submit-run/index.ts
```

---

## 1. Enable Anonymous Sign-Ins

Dashboard → **Authentication → Providers → Anonymous** → enable.

Without this, `signInAnonymously()` fails and PLAYHEAD stays `[OFFLINE]` — which
is still fully playable, just not synced.

---

## 2. Create the project link (CLI)

```bash
npm i -g supabase
supabase login
supabase link --project-ref aqtfqynloncgvtuksgus
```

If you prefer not to use the CLI, skip to step 3b.

---

## 3. Apply the database migration

**3a. CLI**

```bash
supabase db push
```

**3b. Dashboard alternative**

Open **SQL Editor**, paste the entire contents of
`supabase/migrations/20260922000000_online_v1.sql`, and run it.

This creates: `profiles`, `player_progress`, `cosmetic_ownership`,
`track_progress`, `custom_signal_claims`, `leaderboard_runs`, `race_rooms`,
`race_room_players`, all RLS policies, all indexes, the `run-replays` private
bucket, and the RPCs `sync_progression`, `my_pending_drop_ranks`, `spend_drop`,
`grant_progression_events`, `upsert_track_progress`,
`race_report_attempt_start`, `race_report_finish`, `expire_stale_race_rooms`.

---

## 4. Verify RLS is on

Dashboard → **Database → Tables** — every table in `public` must show RLS
enabled. The migration enables it explicitly, but confirm:

```sql
select tablename, rowsecurity from pg_tables where schemaname = 'public';
```

Every row must be `true`.

---

## 5. Deploy the submit-run Edge Function

```bash
supabase functions deploy submit-run
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the Supabase
runtime. **Do not** add them to `.env.local` or any `VITE_*` variable.

---

## 6. Add the Vite public environment variables

Create `.env.local` (already git-ignored):

```
VITE_SUPABASE_URL=https://aqtfqynloncgvtuksgus.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<your publishable key>
```

Restart the dev server. The client refuses to initialise — and logs a loud
error — if the configured key looks like a privileged credential
(`service_role`, `sb_secret_*`, `secret`).

---

## 7. Smoke-test with two anonymous browsers

1. Open the app in a normal window → status should read `[ONLINE]`.
2. Open a private window → a second anonymous account is created.
3. Dashboard → **Authentication → Users** should show two anonymous users, and
   `profiles` should have two rows with generated names (`PLAYER-A7F2`).

---

## 8. ENABLE COMPETITIVE SUBMISSION (currently disabled on purpose)

**Public leaderboard submission is disabled right now. This is deliberate.**

`src/online/OfficialMapRegistry.ts` ships with `REGISTRY_READY = false` and an
empty registry, and `supabase/functions/submit-run/index.ts` ships with an empty
`ACCEPTED_MAPS`. Both refuse submissions.

### Why

A global board is only meaningful if every player runs the **same map**. The
fingerprint machinery is implemented and deterministic, but the *official
analysis source* is not yet canonical:

- `public/music/presets/*.json` currently ship with a **stale numbering** that
  does not match the live Signal Pack catalog ids (the catalog asks for
  `track_5_gravity_line.json`; the file on disk is `track_4_gravity_line.json`).
- `PresetLevelCache.loadPreset()` therefore 404s, and `Game` falls back to a
  full **runtime FFT analysis** of the decoded audio.
- That analysis feeds `RouteGenerator.generate()`. Decoding and FFT are float
  pipelines, so the route — and therefore the map — can differ between
  browsers/decoders for the same official track.

Publishing scores from maps that are not provably identical would be publishing
competitive scores from **different maps**. So it is off.

### How to enable it (three steps)

1. **Regenerate the canonical presets.** With the dev server running:

   ```bash
   npm run dev
   npm run precompute-presets
   ```

   This writes presets keyed by the current catalog ids, each carrying a
   canonical `analysis` and a fully generated `track` (forks, spines, obstacles,
   `generationVersion`). Do not edit files while it runs — Vite HMR will
   navigate the page and abort the run.

2. **Build the registry** from those presets with the same pipeline the client
   uses, then paste the resulting entries into
   `src/online/OfficialMapRegistry.ts` and set `REGISTRY_READY = true`.

3. **Mirror the registry into the Edge Function** (`ACCEPTED_MAPS` in
   `supabase/functions/submit-run/index.ts`) and redeploy:

   ```bash
   supabase functions deploy submit-run
   ```

Until all three are done, runs are kept locally and the player is told
`CANONICAL MAP IDENTITY PENDING`. Everything else — local play, local PBs,
progression, cloud sync, and friend sessions — works regardless.

---

## 9. Room expiry housekeeping (optional)

`expire_stale_race_rooms()` marks abandoned rooms `EXPIRED`. Schedule it:

```sql
select cron.schedule('expire-race-rooms', '*/15 * * * *', $$select public.expire_stale_race_rooms();$$);
```

(Requires the `pg_cron` extension.)

---

## 10. Security checklist

- [ ] `VITE_SUPABASE_PUBLISHABLE_KEY` contains the **publishable** key only.
- [ ] No `service_role` / `sb_secret_*` value appears anywhere under `src/`.
- [ ] `.env.local` is git-ignored (it is, by `.gitignore`).
- [ ] RLS enabled on every `public` table.
- [ ] `leaderboard_runs` has **no** client insert policy.
- [ ] `run-replays` bucket is **private**.
- [ ] `submit-run` is deployed and rejects `dev: true`.
