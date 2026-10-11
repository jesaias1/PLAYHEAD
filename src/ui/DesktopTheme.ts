/** PLAYHEAD's default desktop chrome. Does not affect world/canvas colors. */
export function initializeDesktopTheme(): void {
  document.documentElement.dataset.desktopTheme = 'dark';
}
