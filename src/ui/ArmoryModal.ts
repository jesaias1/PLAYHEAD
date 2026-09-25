/**
 * ArmoryModal: Dedicated in-game terminal overlay for previewing and equipping
 * Karambit Cosmic Skins and inspecting performance unlocks during gameplay.
 */

import { KarambitSkinSystem } from '../viewmodel/KarambitSkinSystem';
import { masteryGloveSystem } from '../mastery/MasteryGloveSystem';

export class ArmoryModal {
  public element: HTMLElement;
  private skinsContainer: HTMLElement;
  private glovesContainer: HTMLElement;
  private devToggleBtn: HTMLButtonElement;
  private dropCount: HTMLElement;
  private dropOpenBtn: HTMLButtonElement;
  private dropReveal: HTMLElement;
  private closeBtn: HTMLButtonElement;

  private onCloseCallback?: () => void;
  private skinSystem = KarambitSkinSystem.getInstance();

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'screen armory-modal-screen hidden';
    this.element.innerHTML = `
      <div class="settings-container terminal-console" style="max-height: 90vh; width: 92%; max-width: 860px; overflow-y: auto; padding: 24px 28px; background: rgba(8, 12, 18, 0.96); border: 1px solid #1f293d; border-left: 3px solid #00f0ff; box-shadow: 0 16px 48px rgba(0,0,0,0.85);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px;">
          <div>
            <div style="font-family: var(--font-mono); font-size: 0.65rem; color: #00f0ff; letter-spacing: 0.25em;">// TACTICAL LOADOUT</div>
            <h2 class="pause-title" style="margin: 0; font-size: 1.8rem; text-align: left; letter-spacing: 0.12em;">KARAMBIT ARMORY</h2>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end;">
            <span id="armory-drop-count" style="font-family: var(--font-mono); font-size: 0.64rem; color: #9fb0c8;">SIGNAL DROPS: 00</span>
            <button id="btn-armory-open-drop" class="terminal-btn-subtle" style="font-size: 0.68rem; padding: 4px 10px; background: rgba(180, 124, 255, 0.08); border: 1px solid #b47cff; color: #d8b4fe; cursor: pointer; font-family: var(--font-mono);">
              DECODE SIGNAL
            </button>
            <button id="btn-armory-modal-dev-toggle" class="terminal-btn-subtle" style="font-size: 0.68rem; padding: 4px 10px; background: rgba(0, 240, 255, 0.08); border: 1px solid #00f0ff; color: #00f0ff; cursor: pointer; font-family: var(--font-mono);">
              DEV PREVIEW: OFF
            </button>
          </div>
        </div>

        <div id="armory-drop-reveal" class="hidden" aria-live="polite" style="margin: 0 0 12px; padding: 8px 12px; border: 1px solid rgba(180,124,255,0.45); border-left: 3px solid #b47cff; background: rgba(13,8,24,0.78); font-family: var(--font-mono); font-size: 0.72rem; letter-spacing: 0.1em;"></div>

        <div id="armory-modal-skins-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; max-height: 480px; overflow-y: auto; padding-right: 6px;">
          <!-- Dynamically populated -->
        </div>

        <!-- MASTERY GLOVES: earned, never random, never in the decoder. -->
        <div class="armory-catalog-heading mastery-heading" style="margin-top: 18px;">
          <span>[MASTERY] GLOVES // PROOF OF SKILL</span>
        </div>
        <div id="armory-modal-gloves" class="mastery-gloves-grid">
          <!-- Dynamically populated -->
        </div>

        <div style="margin-top: 20px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: space-between; align-items: center;">
          <span style="font-family: var(--font-mono); font-size: 0.65rem; color: #5a6678;">[ESC / BUTTON] RETURN TO PAUSE</span>
          <button class="primary" id="btn-armory-modal-close" style="padding: 8px 24px; font-size: 0.78rem;">[ < BACK TO PAUSE ]</button>
        </div>
      </div>
    `;

    this.skinsContainer = this.element.querySelector('#armory-modal-skins-grid') as HTMLElement;
    this.glovesContainer = this.element.querySelector('#armory-modal-gloves') as HTMLElement;
    this.devToggleBtn = this.element.querySelector('#btn-armory-modal-dev-toggle') as HTMLButtonElement;
    this.dropCount = this.element.querySelector('#armory-drop-count') as HTMLElement;
    this.dropOpenBtn = this.element.querySelector('#btn-armory-open-drop') as HTMLButtonElement;
    this.dropReveal = this.element.querySelector('#armory-drop-reveal') as HTMLElement;
    this.closeBtn = this.element.querySelector('#btn-armory-modal-close') as HTMLButtonElement;

    this.initEvents();
  }

  public setOnClose(cb: () => void): void {
    this.onCloseCallback = cb;
  }

  public show(): void {
    this.renderSkins();
    this.renderGloves();
    this.element.classList.remove('hidden');
    this.closeBtn.focus();
  }

  /**
   * MASTERY GLOVES.
   *
   * Requirements are never hidden, so the player always knows exactly what to
   * accomplish. Locked gloves stay previewable; ownership is derived, never
   * stored, and no glove can ever come from the Signal Decoder.
   */
  private renderGloves(): void {
    if (!this.glovesContainer) return;
    const evaluation = masteryGloveSystem.evaluate();
    const equippedId = masteryGloveSystem.getEquippedGloveId();
    this.glovesContainer.innerHTML = '';

    for (const status of evaluation.gloves) {
      const d = status.definition;
      const isEquipped = d.id === equippedId;
      const card = document.createElement('div');
      card.className = 'mastery-glove-card';
      card.dataset.gloveId = d.id;
      card.dataset.state = status.satisfied ? 'UNLOCKED' : 'LOCKED';
      if (isEquipped) card.classList.add('equipped');

      card.innerHTML =
        `<div class="mastery-glove-head">` +
        `<span class="mastery-glove-name">${d.name}</span>` +
        `<span class="mastery-glove-tier">T${d.tier}</span>` +
        `</div>` +
        `<div class="mastery-glove-codename">${d.codename}</div>` +
        `<div class="mastery-glove-req">${d.requirementLabel}</div>` +
        `<div class="mastery-glove-status ${status.satisfied ? 'unlocked' : 'locked'}">` +
        `${isEquipped ? 'EQUIPPED' : status.satisfied ? 'UNLOCKED' : `LOCKED // ${status.progressLabel}`}</div>`;

      const action = document.createElement('button');
      action.className = 'terminal-btn-subtle mastery-glove-action';
      if (isEquipped) {
        action.textContent = '[ EQUIPPED ]';
        action.disabled = true;
      } else if (status.satisfied) {
        action.textContent = '[ EQUIP ]';
        action.addEventListener('click', () => {
          masteryGloveSystem.equipGlove(d.id);
          this.renderGloves();
        });
      } else {
        action.textContent = '[ PREVIEW ]';
        action.addEventListener('click', () => {
          masteryGloveSystem.setDevPreview(
            masteryGloveSystem.getDevPreviewGloveId() === d.id ? null : d.id
          );
          this.renderGloves();
        });
      }
      card.appendChild(action);
      this.glovesContainer.appendChild(card);
    }
  }

  public hide(): void {
    this.element.classList.add('hidden');
  }

  public isVisible(): boolean {
    return !this.element.classList.contains('hidden');
  }

  private renderSkins(): void {
    const isDev = this.skinSystem.isDevPreview();
    this.devToggleBtn.textContent = `DEV PREVIEW: ${isDev ? 'ACTIVE' : 'OFF'}`;
    this.devToggleBtn.style.color = isDev ? '#ffdd00' : '#00f0ff';
    this.devToggleBtn.style.borderColor = isDev ? '#ffdd00' : '#00f0ff';
    const pendingDrops = this.skinSystem.getPendingDropCount();
    this.dropCount.textContent = `SIGNAL DROPS: ${pendingDrops.toString().padStart(2, '0')}`;
    this.dropOpenBtn.disabled = pendingDrops <= 0;
    this.dropOpenBtn.textContent = pendingDrops > 0 ? 'DECODE SIGNAL' : 'NO SIGNALS';
    this.dropOpenBtn.style.opacity = pendingDrops > 0 ? '1' : '0.42';

    const equippedId = this.skinSystem.getEquippedSkinId();
    const skins = this.skinSystem.getSkins();

    this.skinsContainer.innerHTML = '';
    skins.forEach((skin) => {
      const isEquipped = skin.id === equippedId;
      const isUnlocked = this.skinSystem.isSkinUnlocked(skin.id);
      const progress = this.skinSystem.getSkinProgress(skin.id);
      const rewardOwned = this.skinSystem.isSkinRewardOwned(skin.id);
      const rarityColor = this.getRarityColor(skin.rarity);

      const card = document.createElement('div');
      card.className = 'terminal-card';
      card.style.padding = '10px 12px';
      card.style.background = isEquipped ? 'rgba(0, 240, 255, 0.08)' : 'rgba(13, 17, 24, 0.75)';
      card.style.border = `1px solid ${isEquipped ? '#00f0ff' : 'var(--border-subtle)'}`;
      card.style.borderLeft = `3px solid ${isEquipped ? '#00f0ff' : (isUnlocked ? rarityColor : '#3e4654')}`;
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.justifyContent = 'space-between';
      card.style.gap = '8px';

      card.innerHTML = `
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
            <div>
              <div style="font-family: var(--font-mono); font-size: 0.82rem; font-weight: 700; color: ${isEquipped ? '#00f0ff' : (isUnlocked ? 'var(--text-primary)' : '#667788')};">${skin.name}</div>
              <div style="font-size: 0.64rem; color: #8899aa; font-family: var(--font-mono); margin-top: 1px;">${skin.codename}</div>
            </div>
            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 3px;">
              <span style="font-size: 0.6rem; font-family: var(--font-mono); color: ${rarityColor}; border: 1px solid ${rarityColor}; padding: 1px 4px;">${skin.rarity}</span>
              <span style="font-size: 0.55rem; font-family: var(--font-mono); color: #718096;">${skin.paletteTag}</span>
            </div>
          </div>
          <div class="armory-preview-slot" style="margin-top: 6px; height: 32px; background: rgba(0,0,0,0.35); border: 1px solid ${skin.rarity === 'ARTIFACT' ? 'rgba(180,124,255,0.32)' : 'rgba(255,255,255,0.08)'}; display: flex; align-items: center; justify-content: center; font-size: 0.58rem; color: ${skin.rarity === 'ARTIFACT' ? '#c4a7ff' : '#526176'}; font-family: var(--font-mono); letter-spacing: 0.08em;">
            ${skin.profile.isVideoArtifact ? '[LIVE BLADE INTERIOR // ACTIVE ONLY WHEN EQUIPPED]' : '[STATIC SIGNAL MATERIAL]'}
          </div>
          <div style="font-size: 0.68rem; color: #8a9bb2; margin-top: 6px; line-height: 1.3;">${skin.description}</div>
        </div>

        <div style="margin-top: 4px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.06);">
          <div style="font-size: 0.64rem; color: ${isUnlocked ? '#00e5a3' : '#a855f7'}; font-family: var(--font-mono); margin-bottom: 6px;">
            ${isUnlocked ? `[READY // ${rewardOwned ? 'SIGNAL DROP' : skin.shortRequirement}]` : `[REQ: ${skin.unlockRequirement} · ${progress.label}]`}
          </div>
          <div class="modal-armory-action-slot"></div>
        </div>
      `;

      const actionSlot = card.querySelector('.modal-armory-action-slot') as HTMLElement;
      if (isEquipped) {
        actionSlot.innerHTML = `<button disabled style="width: 100%; font-family: var(--font-mono); font-size: 0.72rem; font-weight: 700; color: #00f0ff; background: rgba(0, 240, 255, 0.15); padding: 4px 8px; border: 1px solid #00f0ff; cursor: default;">[EQUIPPED]</button>`;
      } else if (isUnlocked) {
        const btn = document.createElement('button');
        btn.textContent = '> EQUIP SKIN';
        btn.style.width = '100%';
        btn.style.fontFamily = 'var(--font-mono)';
        btn.style.fontSize = '0.72rem';
        btn.style.padding = '4px 8px';
        btn.style.background = 'transparent';
        btn.style.border = '1px solid #00f0ff';
        btn.style.color = '#00f0ff';
        btn.style.cursor = 'pointer';
        btn.addEventListener('mouseenter', () => {
          btn.style.background = '#00f0ff';
          btn.style.color = '#000000';
        });
        btn.addEventListener('mouseleave', () => {
          btn.style.background = 'transparent';
          btn.style.color = '#00f0ff';
        });
        btn.addEventListener('click', () => {
          this.skinSystem.equipSkin(skin.id);
          this.renderSkins();
        });
        actionSlot.appendChild(btn);
      } else {
        actionSlot.innerHTML = `<button disabled style="width: 100%; font-family: var(--font-mono); font-size: 0.7rem; color: #5a6678; background: rgba(255,255,255,0.02); border: 1px solid #333a46; padding: 4px 8px; cursor: not-allowed;">[LOCKED]</button>`;
      }

      this.skinsContainer.appendChild(card);
    });
  }

  private decodeModal?: import('./SignalDecodeModal').SignalDecodeModal;

  public setDecodeModal(modal: import('./SignalDecodeModal').SignalDecodeModal): void {
    this.decodeModal = modal;
  }

  private initEvents(): void {
    this.closeBtn.addEventListener('click', () => {
      this.hide();
      this.onCloseCallback?.();
    });

    this.devToggleBtn.addEventListener('click', () => {
      this.skinSystem.toggleDevPreview();
      this.renderSkins();
    });

    this.dropOpenBtn.addEventListener('click', () => {
      if (this.decodeModal) {
        this.decodeModal.open(() => this.renderSkins());
        return;
      }
      const reward = this.skinSystem.openSignalDrop();
      if (!reward) {
        this.renderSkins();
        return;
      }
      this.dropReveal.classList.remove('hidden');
      this.dropReveal.style.borderLeftColor = this.getRarityColor(reward.skin.rarity);
      this.dropReveal.style.color = this.getRarityColor(reward.skin.rarity);
      this.dropReveal.textContent = `${reward.qualityLabel} // ${reward.skin.rarity} FOUND // ${reward.skin.name}`;
      this.renderSkins();
    });
  }

  private getRarityColor(rarity: string): string {
    switch (rarity) {
      case 'ARTIFACT': return '#ffdf7a';
      case 'RELIC': return '#b47cff';
      case 'RARE': return '#47d7ff';
      default: return '#c8d0dc';
    }
  }
}
