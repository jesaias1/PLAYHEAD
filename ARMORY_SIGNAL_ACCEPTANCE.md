# Armory Signal Drops acceptance

Implemented first-Diamond account drops with server-issued UUIDs, weighted unowned
knife-first rewards, eligible-glove fallback, atomic idempotent opening, and
BLACKSTAR exclusion. Results route to Armory; Armory runs the existing skippable
3.8-second terminal reveal. Client-local rank flags cannot create server rewards.

Ownership, unopened/opened drops and first-Diamond track markers follow the
account. Delayed opening/submission responses are discarded after account changes.
Existing legitimate cosmetics and distinct historical unspent drops are preserved;
spent historical Diamond keys continue blocking repeated awards.

SIGNALISM and GOD RUN reuse their existing identities, shader profiles and silent
runtime encodes. Locked Artifact identities are masked. Only an owned focused
preview/reveal creates a presentation video; dismissal/tab changes release it.
Gameplay keeps the existing blade UV/mask/depth/Fresnel shader and one active
VideoTexture. Videos are muted, volume zero, looping, inline and noninteractive.
Replay metadata remains cosmetic identity only. Movement, surf and race equations
were not changed.

## Validation

- Typecheck and production build passed (existing bundle-size warning).
- Final focused acceptance: 9 files, 181 tests passed, including account-switch,
  unowned knife/glove, cross-device pending reconciliation, replay/equip isolation,
  catalog mirror consistency and silent video lifecycle.
- Database: pre-migration legacy seed + migration + actual SQL functions tested in
  one BEGIN/ROLLBACK transaction on the linked project. Passed after correcting
  PostgreSQL ambiguity, authorized mint context and empty-pool update syntax.
- Migration 20261001000000 applied to aqtfqynloncgvtuksgus; submit-run deployed with
  its existing internal JWT/session validation configuration.
- Post-deployment database acceptance passed; fixtures rolled back. The existing
  WR privilege and synchronized race database acceptance also passed.
- Isolated local browser fixture: both Artifact videos decoded at 540px width,
  muted/looping with no controls, advancing playback time; GOD RUN skip worked.
  Closing left zero video elements. Claiming did not change equipped SIGNAL_CYAN.
  No console errors in the reveal fixture. No production account rewards/runs were
  manufactured. Screenshots are retained under work/armory-evidence (untracked).
- Runtime MP4 inspection: all four standard/low SIGNALISM and GOD RUN encodes have
  video tracks only, no audio tracks. Downloads originals are unchanged.
- Human playtesting remains authoritative for blade appearance and feel.

## Product constraint

There are 14 official tracks and 33 eligible rewards. The requested once-per-track,
one-item-per-drop rules allow at most 14 new drops; a fresh account cannot complete
all 33 rewards from the current track pack alone. Future tracks/reward sources are
needed. Historical legitimate drops remain usable. No farming loophole was added.
Run timing/rank remain client-reported through the existing canonical submit-run
validation; this change provides reward authority, not full run resimulation.

## Release

Only the Armory feature, migration, submit-run receipt, focused tests and this report
are committed. Unrelated experiments, .gitignore and work files are preserved.
Production uses the existing Vercel project and main branch at
https://playhead-sooty.vercel.app/; exact commit/READY verification is reported in chat.
