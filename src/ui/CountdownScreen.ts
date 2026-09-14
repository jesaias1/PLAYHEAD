/**
 * Starting Countdown screen with animated 3-2-1-RUN sequence and controls overlay
 */

export class CountdownScreen {
  public element: HTMLElement;
  private countNumberElem: HTMLElement;
  private timer: number | null = null;
  private onCompleteCallback?: () => void;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'screen countdown-screen hidden';
    this.element.innerHTML = `
      <div class="countdown-number" id="countdown-val">3</div>

      <div class="control-hints">
        <div class="control-hint-item">
          <span class="key-badge">WASD</span>
          <span class="key-desc">MOVE / STRAFE</span>
        </div>
        <div class="control-hint-item">
          <span class="key-badge">MOUSE</span>
          <span class="key-desc">LOOK</span>
        </div>
        <div class="control-hint-item">
          <span class="key-badge">SPACE</span>
          <span class="key-desc">JUMP / BHOP</span>
        </div>
        <div class="control-hint-item">
          <span class="key-badge">R</span>
          <span class="key-desc">RESTORE</span>
        </div>
      </div>
    `;

    this.countNumberElem = this.element.querySelector('#countdown-val') as HTMLElement;
  }

  public start(onComplete: () => void): void {
    this.onCompleteCallback = onComplete;
    this.element.classList.remove('hidden');

    let step = 3;
    this.countNumberElem.textContent = `${step}`;

    if (this.timer) clearInterval(this.timer);

    this.timer = window.setInterval(() => {
      step--;
      if (step > 0) {
        this.countNumberElem.textContent = `${step}`;
      } else if (step === 0) {
        this.countNumberElem.textContent = 'RUN';
        // Audio and play begin right when RUN displays!
        this.onCompleteCallback?.();
      } else {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.element.classList.add('hidden');
      }
    }, 1000);
  }

  public cancel(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.element.classList.add('hidden');
  }
}
