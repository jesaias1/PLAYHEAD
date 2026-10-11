import { afterEach, describe, expect, it, vi } from 'vitest';
import { clampWindowOffset, makeDesktopWindow } from '../src/ui/DesktopWindow';

describe('desktop window bounds', () => {
  it('allows a move that leaves the whole window visible', () => {
    expect(clampWindowOffset(100, 800, 1280, 40)).toBe(40);
  });
  it('keeps the title bar from going above or left of the viewport', () => {
    expect(clampWindowOffset(100, 800, 1280, -900)).toBe(-100);
  });
  it('keeps the far edge visible after a drag or content growth', () => {
    expect(clampWindowOffset(100, 1100, 1280, 200)).toBe(80);
  });
  it('anchors oversized windows at the viewport origin', () => {
    expect(clampWindowOffset(-20, 1000, 720, 500)).toBe(20);
  });
});

describe('desktop drag integration', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('uses the previously applied position when clamping a new pointer move', () => {
    const events = new Map<string, (event: any) => void>();
    const handle = { classList: { add: vi.fn(), remove: vi.fn() }, setAttribute: vi.fn(),
      addEventListener: (name: string, callback: (event: any) => void) => events.set(name, callback),
      setPointerCapture: vi.fn() };
    const panel = { style: { translate: '0px 0px' }, getClientRects: () => [1], getBoundingClientRect: () => {
      const [x, y] = panel.style.translate.split(' ').map(parseFloat);
      return { left: 50 + x, top: 20 + y, width: 1180, height: 680 };
    } };
    vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 720, addEventListener: vi.fn() });
    vi.stubGlobal('ResizeObserver', class { observe() {} });
    makeDesktopWindow(panel as unknown as HTMLElement, 'Test', handle as unknown as HTMLElement);
    events.get('pointerdown')!({ button: 0, target: { closest: () => null }, preventDefault: vi.fn(), pointerId: 1, clientX: 400, clientY: 30 });
    events.get('pointermove')!({ pointerId: 1, clientX: 800, clientY: 180 });
    expect(panel.style.translate).toBe('50px 20px');
    events.get('dblclick')!({});
    expect(panel.style.translate).toBe('0px 0px');
  });
});
