# SIGNAL PACK AUTHORING

How the official Signal Pack is authored, validated and reported. Written so a
future contributor (human or model) can work on official tracks without
archaeology.

---

## 1. The two pipelines

They are deliberately different, and neither may compromise the other.

```
CUSTOM AUDIO   analysis -> procedural generation -> validation
SIGNAL PACK    analysis -> procedural foundation -> AUTHORED PROFILE
               -> validation -> precompute
```

Custom Audio is the core product promise: arbitrary user music becomes a level.
It must keep working with no authored data at all.

Official tracks keep the procedural foundation — the same builder, the same
surf planner, the same validator — and add a curated layer on top.

---

## 2. Where things live

| Concern | File |
|---|---|
| Authored profiles, one per track | `src/generation/OfficialSignalPack.ts` |
| Profile types, validation, rank estimation | `src/generation/OfficialTrackProfile.ts` |
| Route building (shared with Custom Audio) | `src/generation/RouteGenerator.ts` |
| Precomputed shipped level data | `public/music/presets/<trackId>.json` |
| Build-time preset generation | `scripts/precompute_presets.mjs` |
| Authoring gate + report | `tests/SignalPackAuthoring.test.ts` |

---

## 3. Running the report

```bash
npm run signalpack:report                       # all tracks
npm run signalpack:validate                     # same thing, as a gate
SIGNALPACK_TRACK=track_1_signal_drift npx vitest run tests/SignalPackAuthoring.test.ts
```

The report prints, per track: band, movement identity, surf policy, route node
count, surf node count, checkpoints, spectacle count, song length, the
physics-derived achievable-time estimate, and the audio margin.

### Why it is a vitest test and not a standalone script

The profiles are TypeScript in `src/`. Node's type stripping cannot resolve this
repo's extensionless relative imports, and copying the profiles into a `.mjs`
tool would guarantee drift. Running inside vitest means the gate uses the SAME
module graph the game does, so it cannot validate a stale copy.

---

## 4. Authoring a track

### 4.1 Write the intent first

`intent` is required and must be one sentence. If it cannot be written
distinctly, the level is not distinct enough yet — that is the point of the
field, not a formality.

> "The surf statement: long, shallow, committed surf bodies over open void,
> where leaving the ramp early is the only real mistake."

### 4.2 Choose ONE movement identity

`FLOW ASCENT AIR SURF PRECISION SPEED RHYTHM VERTICAL TRANSFER HYBRID`

A track has a point of view. Do not give every track equal quantities of every
mechanic. The gate fails if one identity dominates more than a third of the pack,
and if fewer than five identities are used overall.

### 4.3 Describe phrases, do not place geometry

`sectionPhrases` maps a MUSICAL SECTION index to authored intent:

```ts
{ sectionIndex: 2, phrase: 'SURF_BODY', density: 'MEDIUM', primary: 'SURF',
  spectacle: 'VOID_OPENING', optionalSideSurf: false }
```

The route builder does the geometry. Manual coordinates are reserved for a hero
sequence that genuinely needs them, and no track currently does.

### 4.4 Spectacle is INTENTION, not rendering

`CELESTIAL_REVEAL`, `ARCH_TRAVERSAL`, `VOID_OPENING` — never "set material
brightness to 3.7". A later visual phase maps intentions onto concrete effects
without touching authoring data.

Mark `trailerCandidate: true` on the strongest moments; mark `screenClear: true`
where front-of-camera space should stay clean for readability and capture.

### 4.5 Visual motifs: one to three

`ARCHES BLACK_SLABS RUINED_PILLARS SIGNAL_ANTENNAE FLOATING_ROCK
VERTICAL_FRAMES MONOLITHS SUSPENDED_SLABS`

More than three dilutes the identity and the gate rejects it.

---

## 5. Rank calibration

### The rule that matters

**An ENABLED rank target requires `HUMAN_PLAYTEST` or `RECORDED_RUNS`.**

`estimateRankTargets()` produces a first-order achievable time from REAL route
geometry using the frozen movement's own `maxGroundWishSpeed`, a sustained
fraction of it, per-node landing overhead, and surf segments at a higher
fraction. It is physics-derived rather than a path-length heuristic — but it is
still an ESTIMATE, and the validator refuses to accept it as the basis for a
shipped rank target.

This exists because rank gates Signal Drops. Silently making Diamond unreachable
from a formula would break the reward economy.

### Reading the report

```
margin = song seconds remaining after the estimate
```

**A negative margin does not by itself mean overtime is inevitable.** The
estimate assumes ground running at a sustained fraction of wish speed and
understates what bhop and surf momentum actually achieve. What a negative margin
DOES mean is:

> the route cannot be completed on running and jumping alone within the song.

That is a design statement worth checking against the track's band. An `ENTRY`
track with a large negative margin is asking a beginner to use momentum
mechanics it has not taught yet.

### Turning a target on

Once a human has played the track:

```ts
rankTargets: {
  enabled: true,
  targetTimeSeconds: 92.5,
  basis: 'HUMAN_PLAYTEST',
  note: 'Clean run, 2 restores, finished with 18s of audio left.'
}
```

The gate then enforces that the basis is real evidence and that a note records
where the number came from.

---

## 6. Versioning

| Version | Meaning |
|---|---|
| `SIGNAL_PACK_CONTENT_VERSION` | The authored official content as a whole. Bump when a profile changes in a route-affecting way. |
| `OFFICIAL_PROFILE_VERSION` | Per-profile shape version. |
| `ROUTE_GENERATION_VERSION` | The generator's own output version (`RouteGenerator.ts`). Already gates preset staleness. |

`PresetLevelCache` already refuses a preset whose `track.generationVersion` does
not match `ROUTE_GENERATION_VERSION`, so a generator change cannot silently load
a stale route.

**Changing a route must never grant a second Signal Drop for the same track.**
The reward ledger is keyed by track id, not by content version, and that is
deliberate. Do not add a version to that key.

---

## 7. Adding a spectacle moment

1. Pick a real song time from the track's analysis.
2. Choose an intent from `SpectacleIntent`.
3. Set `screenClear` if the composition should stay open.
4. Set `trailerCandidate` only if it is genuinely strong.
5. Run `npm run signalpack:validate` — the gate rejects a moment outside the song.

---

## 8. Checklist for an official track

Before calling a track done:

- [ ] A distinct `intent` sentence exists and is not shared with another track.
- [ ] One movement identity, and it matches what the route actually contains.
- [ ] `sectionPhrases` cover the meaningful musical sections.
- [ ] At least one spectacle moment that a player would remember.
- [ ] 1–3 motifs; the palette is not a palette-swap of another track.
- [ ] Surf policy matches reality (`MANDATORY`/`SIGNATURE` requires real surf).
- [ ] `npm run signalpack:validate` passes.
- [ ] **A human has played it.** Nothing else substitutes for this.

---

## 9. What is NOT authored here

- Movement constants. `PLAYHEAD_MOVEMENT_V1` is frozen.
- Surf physics.
- Route geometry coordinates.
- Renderer behaviour.

If a route does not work, change the route — never the movement.
