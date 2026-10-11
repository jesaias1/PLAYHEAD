# Compact leaderboard verification — 2026-10-11

Changes: leaderboard-only 760px desktop window, 32px rows, compact single-line replay actions, striped list, sticky header, bounded results scrolling with PB outside it. Phone rows put actions below names/times. Active mode now has a sunken selected appearance.

Fixes: mounted Online panels no longer remain aria-hidden; corrected section labels; keyboard arrows/Home/End and roving tabindex for board modes; clear stale replay cache/loading scroll position; request generation prevents older responses overwriting a newer same-selection refresh.

Validation: npx tsc --noEmit; npm run build; npx vitest run — 127 files / 1571 tests pass. Added cache lifecycle tests and expanded real Game asynchronous refresh test for same-selection out-of-order completion. Existing build chunk warning remains.

Browser: actual localhost game with production world rankings; Normal/Surf keyboard switch and song selection preserve mode; 1280x720 desktop list rows measured 32px, panel clientHeight equals scrollHeight (no outer page scroll); 375px iframe leaderboard clientWidth equals scrollWidth (331px). Actual Surf board response observed. Visual review by agent only; human aesthetic approval remains separate. No gameplay changes.
