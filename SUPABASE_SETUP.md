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

## 3. Apply the database migrations

**3a. CLI**

```bash
supabase db push
```

**3b. Dashboard alternative**

Open **SQL Editor**, paste the entire contents of each file in
`supabase/migrations/` **in filename order**, and run them.

- `20260922000000_online_v1.sql` — schema, RLS, RPCs, storage bucket.
- `20260923000000_realtime_publication.sql` — **required for the friend-race
  lobby.** It adds `race_room_players` and `race_rooms` to the
  `supabase_realtime` publication and sets `replica identity full`.
- `20260925000000_mastery_equipped_glove.sql` — **required for mastery glove
  carry-over across devices.** It adds `player_progress.equipped_glove` and lets
  `sync_progression` carry it.

> Without the second migration the lobby still lets players see each other on
> join, but `postgres_changes` events are never delivered — so a READY change is
> never propagated and the race can never start.
>
> Without the third migration the equipped mastery glove persists locally only:
> it will not follow the player to another device. Nothing breaks either way —
> the client treats the field as optional.

This creates: `profiles`, `player_progress`, `cosmetic_ownership`,
`track_progress`, `custom_signal_claims`, `leaderboard_runs`, `race_rooms`,
`race_room_players`, all RLS policies, all indexes, the `run-replays` private
bucket, and the RPCs `sync_progression`, `my_pending_drop_ranks`, `spend_drop`,
`grant_progression_events`, `upsert_track_progress`,
`race_report_attempt_start`, `race_report_finish`, `expire_stale_race_rooms`.

---

## 3c. Verify Realtime publication (friend race)

Dashboard → **Database → Publications**, or run:

```sql
select tablename from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public';
```

`race_room_players` and `race_rooms` must both be listed.

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

## 8. CANONICAL OFFICIAL MAPS (DONE — maintenance only)

Public leaderboard submission is **ENABLED**. Every official Signal Pack track
now has one canonical, versioned, deterministic map:

- `public/music/presets/*.json` are keyed by the **live catalog ids** and each
  carries a baked `analysis` plus a fully resolved `track` with
  `generationVersion` set, so `PresetLevelCache` uses the shipped map verbatim
  and official tracks **never** fall back to runtime FFT analysis for route
  generation.
- `src/online/OfficialMapRegistry.ts` and
  `supabase/functions/submit-run/accepted-maps.ts` are **generated** from the
  same computation (`PresetLevelCache.buildLevelData`), so client and server can
  never disagree about which maps are canonical.
- `REGISTRY_READY = true`, 14 entries.

Verified by `tests/CanonicalOfficialMaps.test.ts`:
100/100 identical fingerprints for KZ ASCENT and GRAVITY LINE, stable across the
whole catalog, independent of quality tier, identical for fresh sessions, and
FINAL UNSAFE DECORATION = 0 for every track.

### Regenerating (only needed if the generator or analysis changes)

```bash
npm run dev                       # dev server must be running
npm run precompute-presets        # rebuild canonical presets (do not edit files while it runs)
WRITE_REGISTRY=1 npx vitest run tests/CanonicalOfficialMaps.test.ts
npx vitest run tests/CanonicalOfficialMaps.test.ts   # verify the drift guard
supabase functions deploy submit-run
```

`CANONICAL_FULL=1` runs the full 100-repeat determinism sweep per mandatory
track; the default run is a fast regression subset.

### Note on payload size

The canonical presets total ~69 MB because the baked analysis frames are
pretty-printed JSON. Minifying them would roughly halve that and would NOT
change any fingerprint (the parsed analysis is identical), so it is a safe
follow-up optimisation — not a correctness issue.

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
