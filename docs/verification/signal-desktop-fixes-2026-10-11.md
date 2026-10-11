# Signal desktop fixes — 2026-10-11

- Catalog header uses an intrinsic grid row and explicit spacing instead of a fixed row shorter than its inherited header margins. The track scroller starts below the complete title/count.
- Desktop window title bars and selected track use the selected catalog signal color. Text uses whichever of black/white has stronger contrast based on linear sRGB luminance. Signal variables stay separate from gameplay audio accents.
- One existing MenuBackdrop canvas is shared by main menu and preparation. It keeps the same animation and selected palette through EXEC TRACK; hidden during gameplay, with rendering skipped when neither menu nor preparation is visible.
- In-game Armory now has the full 1180px desktop inventory width, viewport limits and compact header. At 1280x720, all 24 knife tiles and 21 glove tiles fit alongside preview/detail and return controls without dialog scrolling (knife dialog 629px, glove dialog 654px).

Validation: TypeScript, production build and all 1,568 tests / 126 test files passed. Browser inspection checked the full header, bright-green and dark-purple signal colors/contrasting text, animated preparation skyline, and hidden backdrop when entering gameplay. The in-game Armory component was inspected in a local UI fixture for both equipment slots without changing ownership or opening drops. Human aesthetic approval remains authoritative.
