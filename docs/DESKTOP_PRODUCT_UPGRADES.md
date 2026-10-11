# Desktop and multiplayer product pass

- Dark Win95 desktop is the default before the app loads. No theme button. Native select options also use a dark palette.
- Armory previews use an opaque charcoal inset and a wider desktop preview; both main and in-game layouts fit at 1280x720.
- Signal Pack search combines title/artist/genre, tier and duration filters. Clear restores the full catalog without changing official ordering.
- Device-local settings remember song, Normal/Surf, and inventory filters. Unknown or blocked storage falls back safely.
- Leaderboards page 25 accepted canonical runs at a time with stable time/id ordering. Find Me locates the requesting account's best run across all pages. Refresh/Retry waits for reconnection and settles failures visibly.
- Up to ten named device-local loadouts save equipped knives and gloves; applying requires current ownership of both items. Presets never grant cosmetics.
- Recorded POV playback supports seeking and 0.5x/1x/1.5x/2x speed. Audio and presentation share the recorded clock; live movement is unchanged. Skipped replay events do not trigger effects.
- Finished reports offer Download Card independently of the native share sheet or clipboard permission.
- Multiplayer setup and host lobby offer Normal/Surf. Host, guest and world loading resolve one canonical course identity. Surf ids remain separate from Normal.
- After shared final race results, the host can Play Next Song, rematch the same song, or return to lobby. Next Song follows catalog order (wrapping at the end), retains mode and room, resets through existing authoritative rematch/select-track RPCs, and requires everyone to ready up again. Guests wait for the host. No new database migration is needed.

## Automated verification

Run `npx tsc --noEmit`, `npm run build`, `npx vitest run`, and `npm run test:ui`.
The browser regression command uses installed Chromium (`CHROME_BIN` can specify its path), a temporary Vite server and the offline component fixture at `tests/ui/desktop.html`. It checks theme/native option palette, catalog filtering/reset/header separation, leaderboard pagination/Find Me/retry, replay controls, preview dimensions, main/in-game Armory fit, horizontal overflow, missing assets and runtime errors at desktop/tablet/mobile widths. Screenshots are saved under `work/ui-checks`.
The GitHub Game quality workflow runs these commands and uploads browser screenshots. Offline fixture results/rankings are presentation test data and never contact the public leaderboard.

Validation distinguishes test coverage from live playtesting: automated tests exercise continuation and canonical Surf identity, while a real server-backed room was created, changed between Surf and Normal, and left cleanly. This pass does not claim a completed two-human race or human approval of visual feel.
