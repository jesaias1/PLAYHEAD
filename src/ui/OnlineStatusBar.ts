/**
 * ONLINE STATUS — the ONE subtle global connection indicator.
 *
 * Lives in the main menu footer, not inside any feature panel, so it never
 * duplicates online controls on unrelated pages and never grows into a large
 * sync panel. It reports the real state only: OFFLINE / CONNECTING / ONLINE /
 * LOCAL // SYNC PENDING.
 */

export class OnlineStatusBar {
  public element: HTMLElement;

  private tagElem: HTMLElement;
  private retryBtn: HTMLButtonElement;
  private identityBtn: HTMLButtonElement;

  constructor(onRetry: () => void) {
    this.element = document.createElement('span');
    this.element.className = 'online-status-inline';
    this.element.innerHTML =
      `<button class="online-status-identity" type="button" title="Open your player profile">PLAYER</button>` +
      `<span class="online-status-sep">//</span>` +
      `<span class="online-status-tag">[OFFLINE]</span>` +
      `<button class="online-status-retry" type="button" title="Retry cloud sync">RETRY</button>`;

    this.tagElem = this.element.querySelector('.online-status-tag') as HTMLElement;
    this.retryBtn = this.element.querySelector('.online-status-retry') as HTMLButtonElement;
    this.identityBtn = this.element.querySelector('.online-status-identity') as HTMLButtonElement;
    this.retryBtn.addEventListener('click', onRetry);
  }

  /**
   * The local player's identity in the footer.
   *
   * The NAME itself is the interaction target for opening your own profile, so
   * there is no duplicate "PROFILE" button anywhere.
   */
  public setIdentity(displayName: string, onOpenProfile: () => void): void {
    // Never render a raw UUID: an empty name falls back to the generated style.
    const safe = displayName && displayName.trim().length > 0 ? displayName.trim() : 'PLAYER';
    this.identityBtn.textContent = safe;
    this.identityBtn.onclick = onOpenProfile;
  }

  public setStatus(tag: string, detail: string): void {
    this.tagElem.textContent = tag;
    // The detail is available on hover rather than printed inline: this is a
    // restrained global indicator, not a diagnostics panel.
    this.element.title = detail;
    const offline = tag.includes('OFFLINE') || tag.includes('PENDING');
    this.tagElem.classList.toggle('online-status-offline', offline);
    // Only offer retry when there is something to retry.
    this.retryBtn.classList.toggle('hidden', !offline);
  }
}
