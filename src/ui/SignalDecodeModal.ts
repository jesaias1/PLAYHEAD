/**
 * SignalDecodeModal: Case-opening style rolling reveal modal for decoding
 * pending signal drops into Karambit cosmetics.
 */

import { KarambitSkin, KarambitSkinSystem, OpenedSignalDrop } from '../viewmodel/KarambitSkinSystem';

export class SignalDecodeModal {
  public element: HTMLElement;
  private stripContainer: HTMLElement;
  private stripInner: HTMLElement;
  private celebrationCard: HTMLElement;
  private titleElem: HTMLElement;
  private kickerElem: HTMLElement;
  private statusElem: HTMLElement;
  private onCompleteCallback?: (skin: KarambitSkin) => void;

  private skinSystem = KarambitSkinSystem.getInstance();
  private isRolling = false;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'screen signal-decode-modal-screen hidden';
    this.element.innerHTML = `
      <div class="decode-modal-backdrop" style="position: absolute; inset: 0; background: rgba(2, 6, 12, 0.88); backdrop-filter: blur(14px);"></div>
      <div class="decode-modal-dialog terminal-console" style="position: relative; z-index: 2; width: min(92vw, 760px); padding: 24px 28px; background: rgba(8, 14, 22, 0.98); border: 1px solid #1f2f45; border-top: 3px solid #00f0ff; box-shadow: 0 20px 60px rgba(0,0,0,0.85); text-align: center;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px; margin-bottom: 16px;">
          <div style="text-align: left;">
            <div id="decode-modal-kicker" style="font-family: var(--font-mono); font-size: 0.65rem; color: #00f0ff; letter-spacing: 0.25em;">// SIGNAL RECOVERY BUS</div>
            <h2 id="decode-modal-title" style="margin: 2px 0 0; font-size: 1.4rem; font-family: var(--font-mono); letter-spacing: 0.12em; color: #f4fbff;">DECODING SIGNAL TRANSMISSION</h2>
          </div>
          <span id="decode-modal-status" style="font-family: var(--font-mono); font-size: 0.65rem; color: #8fa0b5; border: 1px solid rgba(255,255,255,0.12); padding: 3px 8px;">ACQUIRING TELEMETRY</span>
        </div>

        <!-- ROLLING ROULETTE STRIP CONTAINER -->
        <div id="decode-strip-wrapper" style="position: relative; width: 100%; height: 160px; margin: 18px 0; overflow: hidden; background: rgba(3, 7, 12, 0.9); border: 1px solid #1a2536;">
          <!-- Center reticle marker -->
          <div style="position: absolute; left: 50%; top: 0; bottom: 0; width: 4px; transform: translateX(-50%); background: #00f0ff; box-shadow: 0 0 16px #00f0ff; z-index: 10; pointer-events: none;">
            <div style="position: absolute; top: 0; left: -6px; width: 0; height: 0; border-left: 8px solid transparent; border-right: 8px solid transparent; border-top: 10px solid #00f0ff;"></div>
            <div style="position: absolute; bottom: 0; left: -6px; width: 0; height: 0; border-left: 8px solid transparent; border-right: 8px solid transparent; border-bottom: 10px solid #00f0ff;"></div>
          </div>

          <div id="decode-strip-inner" style="display: flex; gap: 10px; position: absolute; left: 50%; top: 12px; height: 136px; will-change: transform;">
            <!-- Populated dynamically with candidate cosmetic cards -->
          </div>
        </div>

        <!-- CELEBRATION / REVEAL CARD -->
        <div id="decode-celebration" class="hidden" style="margin-top: 16px; padding: 16px; border: 1px solid rgba(0, 240, 255, 0.4); border-left: 4px solid #00f0ff; background: rgba(10, 18, 28, 0.85); text-align: left;">
          <!-- Populated when animation lands -->
        </div>

        <!-- FOOTER ACTIONS -->
        <div id="decode-actions" style="margin-top: 18px; display: flex; justify-content: flex-end; gap: 12px;">
          <button id="btn-decode-modal-close" class="terminal-btn-subtle" style="display: none; padding: 8px 18px; font-family: var(--font-mono); font-size: 0.75rem; cursor: pointer; color: #8fa0b5; border: 1px solid #334458;">[ CLOSE ]</button>
        </div>
      </div>
    `;

    const backdrop = this.element.querySelector('.decode-modal-backdrop') as HTMLElement;
    backdrop?.addEventListener('click', () => {
      if (!this.isRolling) this.hide();
    });
    this.stripContainer = this.element.querySelector('#decode-strip-wrapper') as HTMLElement;
    this.stripInner = this.element.querySelector('#decode-strip-inner') as HTMLElement;
    this.celebrationCard = this.element.querySelector('#decode-celebration') as HTMLElement;
    this.titleElem = this.element.querySelector('#decode-modal-title') as HTMLElement;
    this.kickerElem = this.element.querySelector('#decode-modal-kicker') as HTMLElement;
    this.statusElem = this.element.querySelector('#decode-modal-status') as HTMLElement;

    const closeBtn = this.element.querySelector('#btn-decode-modal-close') as HTMLButtonElement;
    closeBtn.addEventListener('click', () => this.hide());
  }

  public open(onComplete?: (skin: KarambitSkin) => void): void {
    if (this.isRolling) return;
    this.onCompleteCallback = onComplete;

    const pending = this.skinSystem.getPendingDropCount();
    if (pending <= 0) {
      return;
    }

    if (this.skinSystem.isCollectionComplete()) {
      this.showCollectionCompleteDialog();
      return;
    }

    const reward = this.skinSystem.openSignalDrop();
    if (!reward || reward.isCollectionComplete) {
      this.showCollectionCompleteDialog();
      return;
    }

    this.startRollingReveal(reward);
  }

  private showCollectionCompleteDialog(): void {
    this.element.classList.remove('hidden');
    this.stripContainer.style.display = 'none';
    this.celebrationCard.classList.remove('hidden');
    this.titleElem.textContent = 'ALL SIGNALS DECODED';
    this.kickerElem.textContent = '// ARSENAL COMPLETE';
    this.statusElem.textContent = '100% DISCOVERED';

    this.celebrationCard.innerHTML = `
      <div style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; color: #00f0ff;">COLLECTION ARCHIVE COMPLETE</div>
      <div style="font-family: var(--font-mono); font-size: 0.72rem; color: #8fa0b5; margin-top: 6px; line-height: 1.4;">
        All available cosmetic profiles and video artifacts have been unlocked in your loadout. No duplicate signals will be granted.
      </div>
    `;

    const closeBtn = this.element.querySelector('#btn-decode-modal-close') as HTMLButtonElement;
    closeBtn.style.display = 'inline-block';
    closeBtn.textContent = '[ CONFIRM ]';
    closeBtn.focus();
  }

  private startRollingReveal(reward: OpenedSignalDrop): void {
    this.isRolling = true;
    this.element.classList.remove('hidden');
    this.stripContainer.style.display = 'block';
    this.celebrationCard.classList.add('hidden');
    this.celebrationCard.innerHTML = '';
    this.titleElem.textContent = 'DECODING SIGNAL TRANSMISSION...';
    this.kickerElem.textContent = `// ${reward.qualityLabel}`;
    this.statusElem.textContent = 'RECEIVING STREAM';

    const closeBtn = this.element.querySelector('#btn-decode-modal-close') as HTMLButtonElement;
    closeBtn.style.display = 'none';

    // Build rolling card strip
    const allSkins = this.skinSystem.getSkins().filter(s => s.dropEligible);
    const CARD_WIDTH = 130;
    const CARD_GAP = 10;
    const TOTAL_CARDS = 32;
    const TARGET_INDEX = 24;

    this.stripInner.innerHTML = '';
    const cards: HTMLElement[] = [];

    for (let i = 0; i < TOTAL_CARDS; i++) {
      const skin = (i === TARGET_INDEX)
        ? reward.skin
        : allSkins[Math.floor(Math.random() * allSkins.length)] || reward.skin;

      const rarityColor = this.getRarityColor(skin.rarity);
      const isTarget = i === TARGET_INDEX;

      const card = document.createElement('div');
      card.className = 'decode-card';
      card.style.width = `${CARD_WIDTH}px`;
      card.style.height = '112px';
      card.style.flexShrink = '0';
      card.style.padding = '8px 10px';
      card.style.background = isTarget ? 'rgba(10, 20, 32, 0.95)' : 'rgba(8, 12, 18, 0.85)';
      card.style.border = `1px solid ${isTarget ? rarityColor : 'rgba(255,255,255,0.08)'}`;
      card.style.borderTop = `3px solid ${rarityColor}`;
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.justifyContent = 'space-between';
      card.style.boxSizing = 'border-box';
      card.style.textAlign = 'left';

      card.innerHTML = `
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-family: var(--font-mono); font-size: 0.52rem; color: ${rarityColor}; border: 1px solid ${rarityColor}; padding: 1px 3px;">${skin.rarity}</span>
            <span style="font-family: var(--font-mono); font-size: 0.50rem; color: #64748b;">${skin.profile.isVideoArtifact ? 'VIDEO' : 'STATIC'}</span>
          </div>
          <div style="font-family: var(--font-mono); font-size: 0.70rem; font-weight: 700; color: #f1f5f9; margin-top: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${skin.name}
          </div>
          <div style="font-family: var(--font-mono); font-size: 0.56rem; color: #8899aa; margin-top: 2px;">
            ${skin.codename}
          </div>
        </div>
        <div style="font-family: var(--font-mono); font-size: 0.52rem; color: ${skin.profile.isVideoArtifact ? '#00f0ff' : '#475569'};">
          ${skin.profile.isVideoArtifact ? '[LIVE ARTIFACT]' : '[SIGNAL PROFILE]'}
        </div>
      `;

      cards.push(card);
      this.stripInner.appendChild(card);
    }

    // Target displacement: center of card at TARGET_INDEX
    // Card center offset from start of strip: TARGET_INDEX * (CARD_WIDTH + CARD_GAP) + CARD_WIDTH / 2
    const targetOffset = TARGET_INDEX * (CARD_WIDTH + CARD_GAP) + (CARD_WIDTH / 2);
    // Initial start offset: offset by first card center so reticle is on card 0
    const startOffset = CARD_WIDTH / 2;

    this.stripInner.style.transition = 'none';
    this.stripInner.style.transform = `translateX(${-startOffset}px)`;

    // Force reflow
    void this.stripInner.offsetHeight;

    // Trigger smooth deceleration ease-out animation
    const durationMs = 2100;
    this.stripInner.style.transition = `transform ${durationMs}ms cubic-bezier(0.1, 0.82, 0.16, 1.0)`;
    this.stripInner.style.transform = `translateX(${-targetOffset}px)`;

    setTimeout(() => {
      this.isRolling = false;
      this.revealAward(reward);
    }, durationMs + 100);
  }

  private revealAward(reward: OpenedSignalDrop): void {
    const rarityColor = this.getRarityColor(reward.skin.rarity);
    this.titleElem.textContent = 'SIGNAL DECODED // ACQUIRED';
    this.statusElem.textContent = reward.skin.rarity;
    this.statusElem.style.borderColor = rarityColor;
    this.statusElem.style.color = rarityColor;

    this.celebrationCard.classList.remove('hidden');
    this.celebrationCard.style.borderColor = rarityColor;
    this.celebrationCard.style.borderLeftColor = rarityColor;
    this.celebrationCard.style.boxShadow = `0 0 24px ${rarityColor}33`;

    this.celebrationCard.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
        <div>
          <div style="font-family: var(--font-mono); font-size: 0.62rem; color: ${rarityColor}; letter-spacing: 0.15em; font-weight: 700;">
            [${reward.qualityLabel} // ${reward.skin.rarity}]
          </div>
          <div style="font-family: var(--font-mono); font-size: 1.1rem; font-weight: 800; color: #ffffff; margin-top: 3px;">
            ${reward.skin.name}
          </div>
          <div style="font-family: var(--font-mono); font-size: 0.68rem; color: #94a3b8; margin-top: 2px;">
            ${reward.skin.codename} · ${reward.skin.paletteTag}
          </div>
        </div>
        <div style="text-align: right;">
          <span style="font-family: var(--font-mono); font-size: 0.60rem; padding: 2px 6px; border: 1px solid ${rarityColor}; color: ${rarityColor};">
            ${reward.skin.profile.isVideoArtifact ? 'LIVE ARTIFACT' : 'PROFILE'}
          </span>
        </div>
      </div>
      <div style="font-family: var(--font-mono); font-size: 0.68rem; color: #cbd5e1; margin-top: 8px; line-height: 1.35;">
        ${reward.skin.description}
      </div>
      <div style="margin-top: 14px; display: flex; gap: 10px; justify-content: flex-end;">
        <button id="btn-decode-equip" class="primary" style="padding: 7px 18px; font-family: var(--font-mono); font-size: 0.75rem; cursor: pointer;">
          > EQUIP NOW
        </button>
        <button id="btn-decode-claim" class="secondary" style="padding: 7px 16px; font-family: var(--font-mono); font-size: 0.75rem; cursor: pointer;">
          CLAIM & RETURN
        </button>
      </div>
    `;

    const equipBtn = this.celebrationCard.querySelector('#btn-decode-equip') as HTMLButtonElement;
    const claimBtn = this.celebrationCard.querySelector('#btn-decode-claim') as HTMLButtonElement;

    equipBtn.addEventListener('click', () => {
      this.skinSystem.equipSkin(reward.skin.id);
      this.hide();
      this.onCompleteCallback?.(reward.skin);
    });

    claimBtn.addEventListener('click', () => {
      this.hide();
      this.onCompleteCallback?.(reward.skin);
    });

    equipBtn.focus();
  }

  public hide(): void {
    if (this.isRolling) return;
    this.element.classList.add('hidden');
    this.stripInner.innerHTML = '';
  }

  public isVisible(): boolean {
    return !this.element.classList.contains('hidden');
  }

  private getRarityColor(rarity: string): string {
    switch (rarity) {
      case 'ARTIFACT': return '#ffd700';
      case 'RELIC': return '#c084fc';
      case 'RARE': return '#38bdf8';
      default: return '#94a3b8';
    }
  }
}
