import { afterEach, expect, it, vi } from 'vitest';
import { initializeDesktopTheme } from '../src/ui/DesktopTheme';
afterEach(() => vi.unstubAllGlobals());
it.each(['light', 'dark', null])('always starts dark regardless of the former preference %s', saved => {
  const dataset: Record<string, string> = {};
  vi.stubGlobal('document', { documentElement: { dataset } });
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => saved) });
  initializeDesktopTheme();
  expect(dataset.desktopTheme).toBe('dark');
});
it('does not depend on available local storage', () => {
  const dataset: Record<string, string> = {};
  vi.stubGlobal('document', { documentElement: { dataset } });
  vi.stubGlobal('localStorage', { getItem: () => { throw Error('blocked'); } });
  expect(initializeDesktopTheme).not.toThrow();
  expect(dataset.desktopTheme).toBe('dark');
});
