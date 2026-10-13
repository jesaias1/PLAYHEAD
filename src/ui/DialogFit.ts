/**
 * DIALOG FIT: no window should need scrolling to reach its buttons.
 *
 * Windows are drawn slightly smaller than their design size, and a window
 * that is still taller than the screen is shrunk (CSS zoom) just enough to fit,
 * with the matching max-height so its box ends at the screen edge.
 * Purely presentational.
 */

const DIALOG_SELECTOR = [
  '.pause-container',
  '.settings-container',
  '.profile-container',
  '.results-container',
  '.analysis-container',
  '.armory-modal-container',
  '.armory-modal-console',
  '.movement-lab-song-container',
  '.decode-container',
  '.decode-modal-dialog',
  '.import-container.terminal-console'
].join(',');

/** Windows are drawn a little smaller than their design size even when they fit. */
const BASE_ZOOM = 0.92;
/** Never shrink below this: smaller than that is unreadable. */
const MIN_ZOOM = 0.62;
/** Breathing room kept around a dialog, in CSS px. */
const SCREEN_MARGIN = 20;

export function fitDialog(el: HTMLElement, viewportHeight: number): number {
  // Measure at natural size.
  el.style.zoom = '';
  el.style.maxHeight = '';
  if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return 1;
  // Leave a visible gap around every window instead of filling the screen edge to edge.
  const available = Math.max(200, (viewportHeight - SCREEN_MARGIN) * 0.94);
  const natural = el.scrollHeight;
  const zoom = Math.max(MIN_ZOOM, Math.min(BASE_ZOOM, available / natural));
  el.style.zoom = String(zoom);
  // The box limit is zoomed too, so counter it to keep the box at the screen height.
  el.style.maxHeight = `${available / zoom}px`;
  return zoom;
}

export function installDialogFit(root: HTMLElement): () => void {
  // A dialog is re-fitted when it appears, when the screen size changes, or when
  // its content grows or shrinks. Checked a few times a second: reading the
  // heights is cheap and only a change triggers the (small) re-measure.
  const seen = new WeakMap<HTMLElement, string>();
  const keyOf = (el: HTMLElement, height: number): string => {
    const visible = el.offsetParent !== null || getComputedStyle(el).position === 'fixed';
    return `${visible}|${height}|${Math.round(el.scrollHeight * (Number(el.style.zoom) || 1))}`;
  };
  const run = (): void => {
    const height = window.innerHeight;
    root.querySelectorAll<HTMLElement>(DIALOG_SELECTOR).forEach((el) => {
      if (seen.get(el) === keyOf(el, height)) return;
      fitDialog(el, height);
      seen.set(el, keyOf(el, height));
    });
  };
  const timer = window.setInterval(run, 350);
  const onResize = (): void => {
    requestAnimationFrame(run);
  };
  window.addEventListener('resize', onResize);
  run();

  return () => {
    window.clearInterval(timer);
    window.removeEventListener('resize', onResize);
  };
}
