# Windows desktop UI — 2026-10-11

The interface now follows the supplied Windows 95 / terminal references: local pixel fonts, grey raised and inset controls, navy title bars, white catalogues and black terminal displays. The darker desktop preserves the existing moving building backdrop and selected-song waveform. The five navigation modules, two-pane catalogue, game flows and movement remain intact.

Coverage includes import/custom audio, Movement Lab, Armory, Online race/leaderboard, track preparation, settings, pause, results, profile/account, decoder, training music picker and in-world typography. Surf remains a darker secondary action to the left of normal launch; normal mode remains the default.

## Verification

- TypeScript: `npx tsc --noEmit` passed.
- Production build: `npm run build` passed (existing large-chunk advisory).
- Vitest: `npx vitest run` passed, 124 files / 1,560 tests.
- Browser inspection: real main menu, custom audio, Armory, Movement Lab, Online race, profile/account and normal-to-Surf preparation. Local UI fixtures inspected settings, pause, results, decoder, training picker and HUD without writing progression or creating races/accounts.
- Actual app rendered in 375 x 812 and 800 x 700 embedded viewports. Fixed narrow-screen card overlap and horizontal tab sizing. Narrow training picker retains complete scrollable rows and load buttons.
- Local fonts include attribution and upstream license notices under `public/assets/fonts/`; Google Fonts runtime requests removed.

Browser visual inspection confirms the rendered implementation, but final aesthetic approval and gameplay feel remain for the user to assess. No movement, surf equations, world geometry, knife calibration or audio-reactive world logic was changed.
