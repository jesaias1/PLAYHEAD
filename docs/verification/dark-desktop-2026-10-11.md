# Optional dark desktop — 2026-10-11

Added subtle LIGHT/DARK pressed toggle in menu footer. Light is the default; localStorage preference restores before Game creates UI. Blocked storage gracefully permits session-only changes. Button supports native keyboard activation without gameplay key interception.

Desktop neutral colors now use palette variables: charcoal faces, dark list/input fields, light text, subdued borders and classic raised/sunken bevels. Track titlebars/selection colors, skyline/canvas, DOS panels and gameplay remain authored. Dark-specific readable success/error/link colors and progress bars.

Validation: npx tsc --noEmit; npm run build; npx vitest run — 128 files, 1576 tests pass. Five new preference tests cover defaults/invalid storage, saved dark restoration, two-way toggle and blocked storage. Browser checked real menu, Custom Audio, Armory, account dialog, leaderboard and preparation; dark persists reload, Enter/Space toggle, light palette returns. At375px footer scrollWidth=clientWidth=355px with toggle/account controls within viewport. Agent visual inspection only; no human playtesting claimed. Existing build chunk warning remains.
