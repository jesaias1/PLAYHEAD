/** Keyboard containment and focus restoration for desktop dialogs. */
export class ModalFocus {
  private opener: HTMLElement | null = null;

  constructor(private root: HTMLElement, onEscape: () => void) {
    root.addEventListener('keydown', (event) => {
      if (root.classList.contains('hidden')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onEscape();
      } else if (event.key === 'Tab') {
        const controls = Array.from(root.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]'
        )).filter((element) => element.getClientRects().length > 0 && !element.closest('.hidden'));
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    });
  }

  open(initial: HTMLElement): void {
    // A profile may refresh asynchronously while its dialog is already open.
    if (!this.root.classList.contains('hidden')) return;
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.root.classList.remove('hidden');
    initial.focus();
  }

  close(): void {
    const wasOpen = !this.root.classList.contains('hidden');
    this.root.classList.add('hidden');
    if (wasOpen && this.opener?.isConnected && this.opener.getClientRects().length) this.opener.focus();
    this.opener = null;
  }
}
