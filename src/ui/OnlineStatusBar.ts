/**
 * ONLINE STATUS BAR — the slim connection indicator shared by the two online
 * tabs (05 RACE WITH FRIENDS, 06 WORLD LEADERBOARD).
 *
 * Shows the real state only: OFFLINE / CONNECTING / ONLINE / LOCAL // SYNC
 * PENDING. It never claims a connection the client does not have.
 */

export class OnlineStatusBar {
  public element: HTMLElement;

  private tagElem: HTMLElement;
  private detailElem: HTMLElement;
  private retryBtn: HTMLButtonElement;

  constructor(onRetry: () => void) {
    this.element = document.createElement('div');
    this.element.className = 'online-status-bar';
    this.element.innerHTML = `
      <span class="online-status-tag" id="online-status-tag">[OFFLINE]</span>
      <span class="online-status-detail" id="online-status-detail">not connected</span>
      <button class="terminal-btn-subtle online-retry" type="button">RETRY SYNC</button>
    `;
    this.tagElem = this.element.querySelector('#online-status-tag') as HTMLElement;
    this.detailElem = this.element.querySelector('#online-status-detail') as HTMLElement;
    this.retryBtn = this.element.querySelector('.online-retry') as HTMLButtonElement;
    this.retryBtn.addEventListener('click', onRetry);

    // Unique ids are not required; clear them so the DOM stays valid when two
    // status bars are mounted at once.
    this.tagElem.removeAttribute('id');
    this.detailElem.removeAttribute('id');
  }

  public setStatus(tag: string, detail: string): void {
    this.tagElem.textContent = tag;
    this.detailElem.textContent = detail;
    const offline = tag.includes('OFFLINE') || tag.includes('PENDING');
    this.tagElem.classList.toggle('online-status-offline', offline);
  }
}
