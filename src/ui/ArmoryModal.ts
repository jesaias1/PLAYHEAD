/**
 * ArmoryModal: in-game LOADOUT INVENTORY overlay.
 *
 * Same browsing model as the main Armory: ONE equipment slot at a time, compact
 * inventory tiles, and a single detail panel that owns all the long copy. A tile
 * never carries a description, a source line, a requirement or an action.
 *
 * Browsing is metadata-only. Nothing here loads a cosmetic texture or video; the
 * preview architecture is unchanged, so a cosmetic is previewed by being worn.
 */

import { KarambitSkinSystem } from '../viewmodel/KarambitSkinSystem';
import { masteryGloveSystem } from '../mastery/MasteryGloveSystem';
import { DROP_GLOVES } from '../viewmodel/DropGloveCatalog';
import { cosmeticKindLabel } from '../viewmodel/CosmeticDrop';
import {
  ArmoryItem,
  ArmorySlot,
  ArmorySort,
  GloveFamilyFilter,
  OwnershipFilter,
  buildArmoryItems,
  filterArmoryItems,
  inventoryCountLabel,
  isEquippable,
  resolveSelection
} from './ArmoryInventory';

export class ArmoryModal {
  public element: HTMLElement;
  private inventoryElem: HTMLElement;
  private detailElem: HTMLElement;
  private countElem: HTMLElement;
  private gloveFilterGroup: HTMLElement;
  private slotBtns: HTMLButtonElement[] = [];
  private filterBtns: HTMLButtonElement[] = [];
  private devToggleBtn: HTMLButtonElement;
  private dropCount: HTMLElement;
  private dropOpenBtn: HTMLButtonElement;
  private dropReveal: HTMLElement;
  private closeBtn: HTMLButtonElement;

  private onCloseCallback?: () => void;
  private skinSystem = KarambitSkinSystem.getInstance();
  private decodeModal?: import('./SignalDecodeModal').SignalDecodeModal;

  private slot: ArmorySlot = 'karambit';
  private gloveFamily: GloveFamilyFilter = 'all';
  private ownership: OwnershipFilter = 'all';
  private sort: ArmorySort = 'rarity';
  private selectedId: string | null = null;
  private items: ArmoryItem[] = [];

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'screen armory-modal-screen hidden';
    this.element.innerHTML = `
      <div class="settings-container terminal-console armory-modal-console">
        <div class="armory-header">
          <div class="armory-header-title">
            <div class="armory-kicker">// TACTICAL LOADOUT</div>
            <h2 class="armory-title" style="font-size: 1.2rem;">ARMORY</h2>
          </div>
          <div class="armory-drops">
            <span class="armory-drops-count" id="armory-drop-count">SIGNAL DROPS // 00</span>
            <button id="btn-armory-open-drop" class="armory-decrypt-btn" type="button">[ DECRYPT ]</button>
          </div>
          <button id="btn-armory-modal-dev-toggle" class="armory-dev-toggle" type="button">DEV PREVIEW: OFF</button>
        </div>

        <div id="armory-drop-reveal" class="hidden armory-decoder-line" aria-live="polite"></div>

        <div class="armory-slots" role="tablist" aria-label="Equipment slot">
          <button class="armory-slot-btn active" type="button" role="tab" aria-selected="true" data-armory-slot="karambit">[ KARAMBIT ]</button>
          <button class="armory-slot-btn" type="button" role="tab" aria-selected="false" data-armory-slot="gloves">[ GLOVES ]</button>
        </div>

        <div class="armory-filters">
          <div class="armory-filter-group hidden" id="armory-modal-glove-filters" aria-label="Glove family">
            <button class="armory-filter-btn active" type="button" data-glove-family="all">ALL</button>
            <button class="armory-filter-btn" type="button" data-glove-family="drop">SIGNAL DROP</button>
            <button class="armory-filter-btn" type="button" data-glove-family="mastery">MASTERY</button>
          </div>
          <div class="armory-filter-group" aria-label="Ownership filter">
            <button class="armory-filter-btn active" type="button" data-owned-filter="all">ALL</button>
            <button class="armory-filter-btn" type="button" data-owned-filter="owned">OWNED</button>
            <button class="armory-filter-btn" type="button" data-owned-filter="locked">LOCKED</button>
          </div>
          <div class="armory-filter-group" aria-label="Sort order">
            <span class="armory-filter-label">SORT</span>
            <button class="armory-filter-btn active" type="button" data-armory-sort="rarity">RARITY</button>
            <button class="armory-filter-btn" type="button" data-armory-sort="name">NAME</button>
          </div>
          <span class="armory-count" id="armory-modal-count">00 ITEMS</span>
        </div>

        <div class="armory-body">
          <div id="armory-modal-inventory" class="armory-inventory" role="listbox" aria-label="Cosmetics"></div>
          <aside class="armory-detail" id="armory-modal-detail" aria-live="polite"></aside>
        </div>

        <div style="margin-top: 16px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: space-between; align-items: center;">
          <span style="font-family: var(--font-mono); font-size: 0.62rem; color: #5a6678;">[ESC / BUTTON] RETURN TO PAUSE</span>
          <button class="primary" id="btn-armory-modal-close" style="padding: 8px 24px; font-size: 0.78rem;">[ < BACK TO PAUSE ]</button>
        </div>
      </div>
    `;

    this.inventoryElem = this.element.querySelector('#armory-modal-inventory') as HTMLElement;
    this.detailElem = this.element.querySelector('#armory-modal-detail') as HTMLElement;
    this.countElem = this.element.querySelector('#armory-modal-count') as HTMLElement;
    this.gloveFilterGroup = this.element.querySelector(
      '#armory-modal-glove-filters'
    ) as HTMLElement;
    this.devToggleBtn = this.element.querySelector('#btn-armory-modal-dev-toggle') as HTMLButtonElement;
    this.dropCount = this.element.querySelector('#armory-drop-count') as HTMLElement;
    this.dropOpenBtn = this.element.querySelector('#btn-armory-open-drop') as HTMLButtonElement;
    this.dropReveal = this.element.querySelector('#armory-drop-reveal') as HTMLElement;
    this.closeBtn = this.element.querySelector('#btn-armory-modal-close') as HTMLButtonElement;

    this.slotBtns = [...this.element.querySelectorAll<HTMLButtonElement>('.armory-slot-btn')];
    for (const btn of this.slotBtns) {
      btn.addEventListener('click', () => {
        this.slot = btn.dataset.armorySlot as ArmorySlot;
        this.selectedId = null;
        this.render();
      });
    }
    this.filterBtns = [...this.element.querySelectorAll<HTMLButtonElement>('.armory-filter-btn')];
    for (const btn of this.filterBtns) {
      btn.addEventListener('click', () => {
        if (btn.dataset.gloveFamily) {
          this.gloveFamily = btn.dataset.gloveFamily as GloveFamilyFilter;
        } else if (btn.dataset.ownedFilter) {
          this.ownership = btn.dataset.ownedFilter as OwnershipFilter;
        } else if (btn.dataset.armorySort) {
          this.sort = btn.dataset.armorySort as ArmorySort;
        }
        this.selectedId = null;
        this.render();
      });
    }

    this.initEvents();
  }

  public setOnClose(cb: () => void): void {
    this.onCloseCallback = cb;
  }

  public setDecodeModal(modal: import('./SignalDecodeModal').SignalDecodeModal): void {
    this.decodeModal = modal;
  }

  public show(): void {
    this.render();
    this.element.classList.remove('hidden');
    this.closeBtn.focus();
  }

  public hide(): void {
    this.element.classList.add('hidden');
  }

  public isVisible(): boolean {
    return !this.element.classList.contains('hidden');
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private buildItems(): ArmoryItem[] {
    return buildArmoryItems({
      skins: this.skinSystem.getSkins(),
      skinOwned: (id) => this.skinSystem.isSkinUnlocked(id),
      skinProgress: (id) => this.skinSystem.getSkinProgress(id).label,
      equippedKnifeId: this.skinSystem.getEquippedSkinId(),
      dropGloves: DROP_GLOVES,
      dropOwned: (id) => this.skinSystem.isDropGloveOwned(id),
      masteryGloves: masteryGloveSystem.evaluate().gloves,
      equippedGloveId: masteryGloveSystem.getEquippedGloveId()
    });
  }

  private render(): void {
    const isDev = this.skinSystem.isDevPreview();
    this.devToggleBtn.textContent = `DEV PREVIEW: ${isDev ? 'ACTIVE' : 'OFF'}`;
    this.devToggleBtn.style.color = isDev ? '#ffdd00' : '#00f0ff';
    this.devToggleBtn.style.borderColor = isDev ? '#ffdd00' : '#00f0ff';

    const pendingDrops = this.skinSystem.getPendingDropCount();
    this.dropCount.textContent = `SIGNAL DROPS // ${pendingDrops.toString().padStart(2, '0')}`;
    this.dropOpenBtn.disabled = pendingDrops <= 0;

    this.items = this.buildItems();

    for (const btn of this.slotBtns) {
      const active = btn.dataset.armorySlot === this.slot;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    this.gloveFilterGroup.classList.toggle('hidden', this.slot !== 'gloves');
    for (const btn of this.filterBtns) {
      if (btn.dataset.gloveFamily) {
        btn.classList.toggle('active', btn.dataset.gloveFamily === this.gloveFamily);
      } else if (btn.dataset.ownedFilter) {
        btn.classList.toggle('active', btn.dataset.ownedFilter === this.ownership);
      } else if (btn.dataset.armorySort) {
        btn.classList.toggle('active', btn.dataset.armorySort === this.sort);
      }
    }

    const visible = filterArmoryItems(this.items, {
      slot: this.slot,
      gloveFamily: this.gloveFamily,
      ownership: this.ownership,
      sort: this.sort
    });
    this.countElem.textContent = inventoryCountLabel(visible.length);

    this.renderInventory(visible);
    this.renderDetail(visible);
  }

  private renderInventory(visible: readonly ArmoryItem[]): void {
    this.selectedId = resolveSelection(visible, this.selectedId)?.id ?? null;
    this.inventoryElem.innerHTML = '';

    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'armory-inventory-empty';
      empty.textContent = 'NO ITEMS MATCH THE CURRENT FILTER';
      this.inventoryElem.appendChild(empty);
      return;
    }

    for (const item of visible) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'armory-tile';
      tile.dataset.itemId = item.id;
      tile.dataset.state = item.owned ? 'OWNED' : 'LOCKED';
      tile.setAttribute('role', 'option');
      tile.setAttribute('aria-selected', item.id === this.selectedId ? 'true' : 'false');
      tile.setAttribute(
        'aria-label',
        `${item.name} // ${item.rarity}${
          item.equipped ? ' // EQUIPPED' : item.owned ? ' // OWNED' : ' // LOCKED'
        }`
      );
      tile.style.setProperty('--tile-accent', item.swatch);
      if (item.id === this.selectedId) tile.classList.add('selected');
      if (item.equipped) tile.classList.add('equipped');
      if (!item.owned) tile.classList.add('locked');

      const mark = item.equipped ? '✓' : item.owned ? '·' : '⊘';
      tile.innerHTML =
        `<span class="armory-tile-swatch" aria-hidden="true"></span>` +
        `<span class="armory-tile-name">${item.name}</span>` +
        `<span class="armory-tile-foot">` +
        `<span class="armory-tile-rarity">${item.rarity}</span>` +
        `<span class="armory-tile-mark" aria-hidden="true">${mark}</span>` +
        `</span>`;

      tile.addEventListener('click', () => {
        this.selectedId = item.id;
        this.renderInventory(visible);
        this.renderDetail(visible);
      });
      this.inventoryElem.appendChild(tile);
    }
  }

  private renderDetail(visible: readonly ArmoryItem[]): void {
    const item = resolveSelection(visible, this.selectedId);
    this.selectedId = item?.id ?? null;

    if (!item) {
      this.detailElem.innerHTML = `<div class="armory-detail-empty">SELECT AN ITEM TO INSPECT</div>`;
      return;
    }

    const statusLabel = item.equipped ? 'EQUIPPED' : item.owned ? 'OWNED' : 'LOCKED';
    const statusClass = item.equipped ? 'equipped' : item.owned ? 'owned' : 'locked';

    const rows: Array<[string, string]> = [
      ['SOURCE', item.source],
      ['REQUIREMENT', item.requirement]
    ];
    if (item.progress) rows.push(['PROGRESS', item.progress]);

    this.detailElem.innerHTML =
      `<div class="armory-detail-inner" style="--detail-accent: ${item.swatch};">` +
      `<div class="armory-detail-rarity">${item.rarity}${
        item.isLive ? ' // LIVE VIDEO ARTIFACT' : ''
      }</div>` +
      `<div class="armory-detail-name">${item.name}</div>` +
      `<div class="armory-detail-codename">${item.codename}</div>` +
      `<div class="armory-detail-status ${statusClass}">${statusLabel}</div>` +
      `<div class="armory-detail-desc">${item.description}</div>` +
      `<div class="armory-detail-rows">` +
      rows
        .map(([k, v]) => `<div class="armory-detail-row"><span>${k}</span><b>${v}</b></div>`)
        .join('') +
      `</div>` +
      `<div class="armory-detail-actions"></div>` +
      `</div>`;

    const slot = this.detailElem.querySelector('.armory-detail-actions') as HTMLElement;
    if (!slot) return;

    if (item.equipped) {
      slot.appendChild(this.buildAction('[ EQUIPPED ]', true, () => undefined, 'primary'));
      return;
    }
    if (isEquippable(item)) {
      slot.appendChild(
        this.buildAction('[ EQUIP ]', false, () => this.equip(item), 'primary')
      );
      return;
    }
    if (item.family === 'karambit') {
      slot.appendChild(this.buildAction('[ LOCKED // COMPLETE TO UNLOCK ]', true, () => undefined));
      return;
    }
    const previewId = masteryGloveSystem.getDevPreviewGloveId();
    const isPreviewing = previewId === item.id;
    slot.appendChild(
      this.buildAction(isPreviewing ? '[ STOP PREVIEW ]' : '[ PREVIEW ]', false, () => {
        masteryGloveSystem.setDevPreview(isPreviewing ? null : item.id);
        this.render();
      })
    );
  }

  private buildAction(
    label: string,
    disabled: boolean,
    onClick: () => void,
    variant?: 'primary'
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `armory-action-btn${variant ? ` ${variant}` : ''}`;
    btn.textContent = label;
    btn.disabled = disabled;
    if (!disabled) btn.addEventListener('click', onClick);
    return btn;
  }

  private equip(item: ArmoryItem): void {
    if (item.family === 'karambit') {
      this.skinSystem.equipSkin(item.id);
    } else {
      masteryGloveSystem.equipAnyGlove(item.id);
    }
    this.render();
  }

  private initEvents(): void {
    this.closeBtn.addEventListener('click', () => {
      this.hide();
      this.onCloseCallback?.();
    });

    this.devToggleBtn.addEventListener('click', () => {
      this.skinSystem.toggleDevPreview();
      this.render();
    });

    this.dropOpenBtn.addEventListener('click', () => {
      if (this.decodeModal) {
        this.decodeModal.open(() => this.render());
        return;
      }
      const reward = this.skinSystem.openSignalDrop();
      if (!reward) {
        this.render();
        return;
      }
      this.dropReveal.classList.remove('hidden');
      this.dropReveal.style.borderLeftColor = this.getRarityColor(reward.rarity);
      this.dropReveal.textContent = `${reward.qualityLabel} // ${reward.rarity} FOUND // ${cosmeticKindLabel(reward.kind)} // ${reward.name}`;
      this.render();
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
