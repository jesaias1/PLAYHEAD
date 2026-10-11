/** Keep movable desktop windows inside the current viewport as content grows. */
export function clampWindowOffset(base: number, extent: number, viewport: number, offset: number): number {
  return Math.max(-base, Math.min(Math.max(0, viewport - extent) - base, offset));
}

export function makeDesktopWindow(panel: HTMLElement, title: string, existingHandle?: HTMLElement): void {
  let x = 0, y = 0, appliedX = 0, appliedY = 0;
  let drag: { id: number; x: number; y: number; startX: number; startY: number } | null = null;
  const handle = existingHandle ?? document.createElement('div');
  if (!existingHandle) {
    handle.textContent = title;
    panel.prepend(handle);
    panel.classList.add('desktop-real-title');
  }
  handle.classList.add('desktop-window-title');
  handle.tabIndex = 0;
  handle.title = 'Drag to move. Arrow keys move; Home or double-click centers.';
  handle.setAttribute('aria-label', `${title}. Move window with arrow keys; Home to center.`);
  const clamp = () => {
    if (!panel.getClientRects().length) return;
    const rect = panel.getBoundingClientRect();
    x = clampWindowOffset(rect.left - appliedX, rect.width, window.innerWidth, x);
    y = clampWindowOffset(rect.top - appliedY, rect.height, window.innerHeight, y);
    panel.style.translate = `${x}px ${y}px`;
    appliedX = x; appliedY = y;
  };
  const center = () => { x = 0; y = 0; clamp(); };
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (event.target as Element).closest('button,input,select,a')) return;
    event.preventDefault();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: x, startY: y };
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    x = drag.startX + event.clientX - drag.x;
    y = drag.startY + event.clientY - drag.y;
    clamp();
  });
  const stop = () => { drag = null; handle.classList.remove('dragging'); };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
  handle.addEventListener('lostpointercapture', stop);
  handle.addEventListener('dblclick', center);
  handle.addEventListener('keydown', (event) => {
    if (event.target !== handle) return;
    const step = event.shiftKey ? 20 : 5;
    if (event.key === 'Home') center();
    else if (event.key === 'ArrowLeft') x -= step;
    else if (event.key === 'ArrowRight') x += step;
    else if (event.key === 'ArrowUp') y -= step;
    else if (event.key === 'ArrowDown') y += step;
    else return;
    event.preventDefault(); event.stopPropagation(); clamp();
  });
  window.addEventListener('resize', clamp);
  new ResizeObserver(clamp).observe(panel);
}
