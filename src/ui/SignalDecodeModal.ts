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
  private skipBtn: HTMLButtonElement;
  private closeBtn: HTMLButtonElement;
  private onCompleteCallback?: (skin: KarambitSkin) => void;

  private skinSystem = KarambitSkinSystem.getInstance();
  private isRolling = false;
  private rollTimeout: number | null = null;
  private activeReward: OpenedSignalDrop | null = null;
  private currentTargetOffset = 0;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'screen signal-decode-modal-screen hidden';
    this.element.innerHTML = `
      <div class="decode-modal-backdrop" style="position: absolute; inset: 0; background: rgba(2, 6, 12, 0.88); backdrop-filter: blur(14px);"></div>
      <div class="decode-modal-dialog terminal-console" style="position: relative; z-index: 2; width: min(92vw, 780px); padding: 24px 28px; background: rgba(8, 14, 22, 0.98); border: 1px solid #1f2f45; border-top: 3px solid #00f0ff; box-shadow: 0 20px 60px rgba(0,0,0,0.85); text-align: center;">
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
        <div id="decode-celebration" class="hidden" style="margin-top: 16px; padding: 18px; border: 1px solid rgba(0, 240, 255, 0.4); border-left: 4px solid #00f0ff; background: rgba(10, 18, 28, 0.85); text-align: left;">
          <!-- Populated when animation lands -->
        </div>

        <!-- FOOTER ACTIONS -->
        <div id="decode-actions" style="margin-top: 18px; display: flex; justify-content: flex-end; gap: 12px;">
          <button id="btn-decode-modal-skip" class="terminal-btn-subtle" style="display: none; padding: 8px 18px; font-family: var(--font-mono); font-size: 0.75rem; cursor: pointer; color: #00f0ff; border: 1px solid #00f0ff; background: rgba(0, 240, 255, 0.08);">[ SKIP REVEAL // SPACE ]</button>
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
    this.skipBtn = this.element.querySelector('#btn-decode-modal-skip') as HTMLButtonElement;
    this.closeBtn = this.element.querySelector('#btn-decode-modal-close') as HTMLButtonElement;

    this.skipBtn.addEventListener('click', () => this.skipReveal());
    this.closeBtn.addEventListener('click', () => this.hide());

    window.addEventListener('keydown', (e) => {
      if (!this.isVisible()) return;
      if (this.isRolling) {
        if (e.code === 'Space' || e.key === ' ' || e.code === 'Escape') {
          e.preventDefault();
          this.skipReveal();
        }
      } else if (e.code === 'Escape') {
        this.hide();
      }
    });
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

    this.skipBtn.style.display = 'none';
    this.closeBtn.style.display = 'inline-block';
    this.closeBtn.textContent = '[ CONFIRM ]';
    this.closeBtn.focus();
  }

  private startRollingReveal(reward: OpenedSignalDrop): void {
    this.isRolling = true;
    this.activeReward = reward;
    this.element.classList.remove('hidden');
    this.stripContainer.style.display = 'block';
    this.celebrationCard.classList.add('hidden');
    this.celebrationCard.innerHTML = '';
    this.titleElem.textContent = 'DECODING SIGNAL TRANSMISSION...';
    this.kickerElem.textContent = `// ${reward.qualityLabel}`;
    this.statusElem.textContent = 'RECEIVING STREAM';

    this.closeBtn.style.display = 'none';
    this.skipBtn.style.display = 'inline-block';

    // Build rolling card strip: 46 cards, target index 38
    const allSkins = this.skinSystem.getSkins().filter(s => s.dropEligible);
    const highTierSkins = allSkins.filter(s => s.rarity === 'ARTIFACT' || s.rarity === 'RELIC');
    const CARD_WIDTH = 130;
    const CARD_GAP = 10;
    const TOTAL_CARDS = 46;
    const TARGET_INDEX = 38;

    this.stripInner.innerHTML = '';
    const cards: HTMLElement[] = [];

    for (let i = 0; i < TOTAL_CARDS; i++) {
      let skin: KarambitSkin;
      if (i === TARGET_INDEX) {
        skin = reward.skin;
      } else if ((i === TARGET_INDEX - 1 || i === TARGET_INDEX + 1) && highTierSkins.length > 0) {
        // Dramatic near-miss on either side of target
        skin = highTierSkins[Math.floor(Math.random() * highTierSkins.length)];
      } else {
        skin = allSkins[Math.floor(Math.random() * allSkins.length)] || reward.skin;
      }

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
    this.currentTargetOffset = TARGET_INDEX * (CARD_WIDTH + CARD_GAP) + (CARD_WIDTH / 2);
    const startOffset = CARD_WIDTH / 2;

    this.stripInner.style.transition = 'none';
    this.stripInner.style.transform = `translateX(${-startOffset}px)`;

    // Force reflow
    void this.stripInner.offsetHeight;

    // Trigger smooth deceleration ease-out animation (3800ms)
    const durationMs = 3800;
    this.stripInner.style.transition = `transform ${durationMs}ms cubic-bezier(0.06, 0.78, 0.12, 1.0)`;
    this.stripInner.style.transform = `translateX(${-this.currentTargetOffset}px)`;

    this.rollTimeout = window.setTimeout(() => {
      this.isRolling = false;
      this.revealAward(reward);
    }, durationMs + 100);
  }

  private skipReveal(): void {
    if (!this.isRolling || !this.activeReward) return;
    if (this.rollTimeout !== null) {
      window.clearTimeout(this.rollTimeout);
      this.rollTimeout = null;
    }

    // Fast deceleration jump
    this.stripInner.style.transition = 'transform 180ms cubic-bezier(0.1, 0.85, 0.2, 1.0)';
    this.stripInner.style.transform = `translateX(${-this.currentTargetOffset}px)`;

    this.rollTimeout = window.setTimeout(() => {
      this.isRolling = false;
      if (this.activeReward) {
        this.revealAward(this.activeReward);
      }
    }, 200);
  }

  private revealAward(reward: OpenedSignalDrop): void {
    this.skipBtn.style.display = 'none';
    const rarityColor = this.getRarityColor(reward.skin.rarity);
    const isHighTier = reward.skin.rarity === 'ARTIFACT' || reward.skin.rarity === 'RELIC';

    this.titleElem.textContent = isHighTier ? 'PRIORITY SIGNAL DECODED' : 'SIGNAL DECODED // ACQUIRED';
    this.statusElem.textContent = reward.skin.rarity;
    this.statusElem.style.borderColor = rarityColor;
    this.statusElem.style.color = rarityColor;

    this.celebrationCard.classList.remove('hidden');
    this.celebrationCard.style.borderColor = rarityColor;
    this.celebrationCard.style.borderLeftColor = rarityColor;
    this.celebrationCard.style.background = isHighTier
      ? `radial-gradient(circle at top right, ${rarityColor}28, rgba(10, 18, 28, 0.95))`
      : 'rgba(10, 18, 28, 0.90)';
    this.celebrationCard.style.boxShadow = `0 0 32px ${rarityColor}44, inset 0 0 16px ${rarityColor}18`;

    this.celebrationCard.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
        <div>
          <div style="font-family: var(--font-mono); font-size: 0.62rem; color: ${rarityColor}; letter-spacing: 0.15em; font-weight: 700;">
            [${reward.qualityLabel} // ${reward.skin.rarity}] ${isHighTier ? '★ CRITICAL ARSENAL DISCOVERY' : ''}
          </div>
          <div style="font-family: var(--font-mono); font-size: 1.25rem; font-weight: 800; color: #ffffff; margin-top: 3px; letter-spacing: 0.04em;">
            ${reward.skin.name}
          </div>
          <div style="font-family: var(--font-mono); font-size: 0.68rem; color: #94a3b8; margin-top: 2px;">
            ${reward.skin.codename} · ${reward.skin.paletteTag}
          </div>
        </div>
        <div style="text-align: right;">
          <span style="font-family: var(--font-mono); font-size: 0.60rem; padding: 3px 8px; border: 1px solid ${rarityColor}; color: ${rarityColor}; background: ${rarityColor}18;">
            ${reward.skin.profile.isVideoArtifact ? 'LIVE VIDEO ARTIFACT' : 'PROFILE TIER'}
          </span>
        </div>
      </div>
      <div style="font-family: var(--font-mono); font-size: 0.72rem; color: #cbd5e1; margin-top: 10px; line-height: 1.45;">
        ${reward.skin.description}
      </div>
      <div style="margin-top: 16px; display: flex; gap: 12px; justify-content: flex-end;">
        <button id="btn-decode-equip" class="primary" style="padding: 8px 22px; font-family: var(--font-mono); font-size: 0.75rem; cursor: pointer;">
          > EQUIP NOW
        </button>
        <button id="btn-decode-claim" class="secondary" style="padding: 8px 18px; font-family: var(--font-mono); font-size: 0.75rem; cursor: pointer;">
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
    if (this.rollTimeout !== null) {
      window.clearTimeout(this.rollTimeout);
      this.rollTimeout = null;
    }
    this.element.classList.add('hidden');
    this.stripInner.innerHTML = '';
    this.activeReward = null;
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
