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
  private accountBtn: HTMLButtonElement;

  constructor(onRetry: () => void) {
    this.element = document.createElement('span');
    this.element.className = 'online-status-inline';
    this.element.innerHTML =
      `<button class="online-status-identity" type="button" title="Open your player profile">PLAYER</button>` +
      `<span class="online-status-sep">//</span>` +
      `<button class="online-status-account" type="button" title="Create or sign into a username account">SIGN IN</button>` +
      `<span class="online-status-sep">//</span>` +
      `<span class="online-status-tag">[OFFLINE]</span>` +
      `<button class="online-status-retry" type="button" title="Retry cloud sync">RETRY</button>`;

    this.tagElem = this.element.querySelector('.online-status-tag') as HTMLElement;
    this.retryBtn = this.element.querySelector('.online-status-retry') as HTMLButtonElement;
    this.identityBtn = this.element.querySelector('.online-status-identity') as HTMLButtonElement;
    this.accountBtn = this.element.querySelector('.online-status-account') as HTMLButtonElement;
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

  /**
   * The account entry point. Shows the registered username, or SIGN IN when the
   * player is on an anonymous device-bound session.
   */
  public setAccount(username: string | null, onOpenAccount: () => void): void {
    this.accountBtn.textContent = username ? username : 'SIGN IN';
    this.accountBtn.classList.toggle('online-status-account-registered', !!username);
    this.accountBtn.onclick = onOpenAccount;
  }

  public setStatus(tag: string, detail: string): void {
    this.tagElem.textContent = tag;
    // The detail is available on hover rather than printed inline: this is a
    // restrained global indicator, not a diagnostics panel.
    const failed = tag.includes('ERROR');
    const pending = tag.includes('PENDING');
    const offline = tag.includes('OFFLINE') || pending || failed;
    this.element.title = failed ? '[NET] REQUEST FAILED // RETRY OR SIGN IN'
      : pending ? '[NET] SYNC PENDING // RETRY'
      : offline ? '[NET] OFFLINE // RETRY CONNECTION' : detail;
    this.tagElem.classList.toggle('online-status-offline', offline);
    // Only offer retry when there is something to retry.
    this.retryBtn.classList.toggle('hidden', !offline);
  }
}
