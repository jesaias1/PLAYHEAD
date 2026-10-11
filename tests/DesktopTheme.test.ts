import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeDesktopTheme, mountDesktopThemeToggle, setDesktopTheme } from '../src/ui/DesktopTheme';

function setup(saved: string | null = null) {
  const dataset: Record<string, string> = {};
  const attrs: Record<string, string> = {};
  let click = () => {};
  const button = { textContent: '', setAttribute: (name: string, value: string) => { attrs[name] = value; },
    addEventListener: (name: string, handler: () => void) => { if (name === 'click') click = handler; } };
  const storage = { getItem: vi.fn(() => saved), setItem: vi.fn() };
  vi.stubGlobal('document', { documentElement: { dataset }, createElement: () => button });
  vi.stubGlobal('localStorage', storage);
  return { dataset, storage, button, attrs, click: () => click() };
}

afterEach(() => vi.unstubAllGlobals());
describe('desktop theme preference', () => {
  it.each([null, 'light', 'invalid'])('keeps light as the default for %s', saved => {
    const { dataset } = setup(saved);
    initializeDesktopTheme();
    expect(dataset.desktopTheme).toBe('light');
  });
  it('restores dark before mounting the UI and toggles both ways', () => {
    const { dataset, storage, attrs, button, click } = setup('dark');
    initializeDesktopTheme();
    const appendChild = vi.fn();
    mountDesktopThemeToggle({ appendChild } as unknown as HTMLElement);
    expect(appendChild).toHaveBeenCalledWith(button);
    expect(attrs['aria-pressed']).toBe('true');
    expect(button.textContent).toBe('DARK');
    click();
    expect(dataset.desktopTheme).toBe('light');
    expect(attrs['aria-pressed']).toBe('false');
    expect(storage.setItem).toHaveBeenLastCalledWith('playhead.desktop-theme', 'light');
    click();
    expect(dataset.desktopTheme).toBe('dark');
    expect(attrs['aria-pressed']).toBe('true');
  });
  it('works for the session when local storage is blocked', () => {
    const { dataset, storage } = setup();
    storage.getItem.mockImplementation(() => { throw new Error('blocked'); });
    storage.setItem.mockImplementation(() => { throw new Error('blocked'); });
    expect(() => initializeDesktopTheme()).not.toThrow();
    expect(dataset.desktopTheme).toBe('light');
    expect(() => setDesktopTheme('dark')).not.toThrow();
    expect(dataset.desktopTheme).toBe('dark');
  });
});
