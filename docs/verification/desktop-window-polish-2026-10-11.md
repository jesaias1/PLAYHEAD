# Desktop windows and UI fixes — 2026-10-11

- Real title bars support pointer dragging on the menu, preparation, report, pause, settings, profile, account, Armory, music picker and decoder windows. Arrow keys move the focused title bar; Home/double-click recenters. Pointer cancellation clears the drag state. Window offsets are clamped after movement, viewport resize and content resizing.
- The main window now grows to its active page rather than holding a fixed 640px height. Maximum dimensions respect the available viewport. Compact desktop Armory details place the preview beside the title and metadata; settings use two columns on wider screens. Long lists and small screens retain overflow access when content cannot fit physically.
- Fixed the permanently hidden account submit button, unhandled async failure leaving controls disabled, and Enter on unrelated buttons triggering authentication. Pending submissions disable mode changes and duplicate requests; errors allow retry. Registration/login use appropriate password autocomplete. Closing clears the password field.
- Account/profile/settings dialogs now have names, initial focus, Tab containment, Escape close and focus restoration. Settings labels are connected to their controls.

## Verification

- `npx tsc --noEmit` passed.
- `npm run build` passed; existing bundle-size advisory remains.
- `npx vitest run`: 126 files, 1,568 tests passed. Added async account-state tests and window drag-boundary regression tests.
- Browser: dragged the main window to the right/bottom limits and verified its bounds exactly meet the 1280x720 viewport; double-click restored centering. Switched pages to confirm content-dependent height. Armory and Online panel scrollHeight equal clientHeight at 1280x720. Settings fit 840x438 with no horizontal/vertical overflow. Inspected real app at 375x812 and 800x700 embedded sizes.
- Local-only account fixture simulated rejected requests without contacting auth or creating accounts: error appeared, controls recovered, Enter on Close did not create another request, Tab wrapped inside dialog and focus returned to opener. Real-game profile Escape closed only the dialog and restored focus.

Animated skyline, waveform, gameplay, physics, camera, world geometry, knife calibration and audio-reactive world behavior remain unchanged. Visual approval remains with the user.
