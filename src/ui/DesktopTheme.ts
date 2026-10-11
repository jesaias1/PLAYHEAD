/** Desktop chrome preference only. Never alters canvas/world colors. */
export type DesktopTheme = 'light' | 'dark';
const STORAGE_KEY = 'playhead.desktop-theme';

export function setDesktopTheme(theme: DesktopTheme): void {
  document.documentElement.dataset.desktopTheme = theme;
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* Session-only if storage is blocked. */ }
}

export function initializeDesktopTheme(): void {
  let theme: DesktopTheme = 'light';
  try { if (localStorage.getItem(STORAGE_KEY) === 'dark') theme = 'dark'; } catch { /* Keep the default. */ }
  document.documentElement.dataset.desktopTheme = theme;
}

export function mountDesktopThemeToggle(footer: HTMLElement): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'desktop-theme-toggle';
  button.setAttribute('aria-label', 'Dark mode');
  button.title = 'Toggle dark Windows 95 theme';
  const update = () => {
    const dark = document.documentElement.dataset.desktopTheme === 'dark';
    button.textContent = dark ? 'DARK' : 'LIGHT';
    button.setAttribute('aria-pressed', String(dark));
  };
  button.addEventListener('click', () => {
    setDesktopTheme(document.documentElement.dataset.desktopTheme === 'dark' ? 'light' : 'dark');
    update();
  });
  // Keep gameplay key handlers from cancelling native button activation.
  button.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
  });
  update();
  footer.appendChild(button);
  return button;
}
