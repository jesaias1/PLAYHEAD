/**
 * ARMORY INVENTORY MODEL — pure browsing logic for the cosmetic inventory.
 *
 * The Armory is an INVENTORY, not a store landing page. This module owns the
 * browsing model only: which items exist, how they are filtered and sorted, and
 * what a tile needs to say. It renders nothing and loads nothing.
 *
 * Two rules this module exists to enforce:
 *
 *   1. Browsing is METADATA-ONLY. An item carries name / rarity / ownership /
 *      source — never a texture, a video or a preview handle. Loading a real
 *      cosmetic asset stays a PREVIEW/EQUIP-time concern.
 *
 *   2. The two glove families never blur. SIGNAL DROP gloves are rolled by the
 *      decoder; MASTERY gloves are earned from canonical progress. They share the
 *      glove SLOT but never the acquisition family, and the family is always
 *      stated rather than implied.
 *
 * Pure: no DOM, no THREE, no storage.
 */

import type { CosmeticRarity, KarambitSkin } from '../viewmodel/KarambitSkinSystem';
import type { DropGlove } from '../viewmodel/DropGloveCatalog';
import type { MasteryGloveStatus } from '../mastery/MasteryLadder';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** The equipment slot being browsed. Exactly one is browsed at a time. */
export type ArmorySlot = 'karambit' | 'gloves';

/** How an item was acquired. Never inferred from the slot. */
export type ArmoryFamily = 'karambit' | 'drop' | 'mastery';

/** Secondary filter for the glove slot: both families share one slot. */
export type GloveFamilyFilter = 'all' | 'drop' | 'mastery';

export type OwnershipFilter = 'all' | 'owned' | 'locked';

export type ArmorySort = 'rarity' | 'name';

/**
 * A single browsable cosmetic.
 *
 * Deliberately flat and small: this is what a compact tile needs plus what the
 * single detail panel needs. Long copy lives here ONCE, never per tile.
 */
export interface ArmoryItem {
  id: string;
  name: string;
  codename: string;
  description: string;
  rarity: CosmeticRarity;
  slot: ArmorySlot;
  family: ArmoryFamily;
  /** Honest acquisition line: STANDARD ISSUE / SIGNAL PACK / SIGNAL DROP / MASTERY. */
  source: string;
  owned: boolean;
  equipped: boolean;
  /** Human requirement line, shown only in the detail panel. */
  requirement: string;
  /** Live progress, e.g. `09 / 14 GOLD+`. Empty when not applicable. */
  progress: string;
  /** Zero-asset tile accent, taken from the cosmetic's own palette. */
  swatch: string;
  /** True for cosmetics whose material is a live video artifact. */
  isLive: boolean;
}

export interface ArmoryInventoryInput {
  skins: readonly KarambitSkin[];
  skinOwned(id: string): boolean;
  /** Human progress label for a knife unlock. */
  skinProgress(id: string): string;
  equippedKnifeId: string;
  dropGloves: readonly DropGlove[];
  dropOwned(id: string): boolean;
  masteryGloves: readonly MasteryGloveStatus[];
  /** Equipped glove id, from EITHER family. */
  equippedGloveId: string;
}

export interface ArmoryFilters {
  slot: ArmorySlot;
  gloveFamily: GloveFamilyFilter;
  ownership: OwnershipFilter;
  sort: ArmorySort;
}

// ---------------------------------------------------------------------------
// Rarity
// ---------------------------------------------------------------------------

const RARITY_RANK: Record<CosmeticRarity, number> = {
  STANDARD: 0,
  RARE: 1,
  RELIC: 2,
  ARTIFACT: 3,
  OVERCLOCKED: 4
};

export function rarityRank(rarity: CosmeticRarity): number {
  return RARITY_RANK[rarity] ?? 0;
}

/** Shared rarity palette. Structural accent, not decoration. */
export function rarityColor(rarity: CosmeticRarity): string {
  switch (rarity) {
    case 'OVERCLOCKED':
      return '#ff0055';
    case 'ARTIFACT':
      return '#ffd700';
    case 'RELIC':
      return '#c084fc';
    case 'RARE':
      return '#38bdf8';
    default:
      return '#94a3b8';
  }
}

/**
 * Pull the colour out of a palette tag such as `CYAN // #00F0FF`.
 * Returns null when the tag has no parseable colour.
 */
export function paletteSwatch(paletteTag: string): string | null {
  const match = /#([0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(paletteTag);
  return match ? `#${match[1]}` : null;
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/** Honest acquisition label for a knife, derived from its own requirement text. */
export function knifeSource(skin: KarambitSkin): string {
  if (skin.shortRequirement === 'DEFAULT') return 'STANDARD ISSUE';
  if (skin.shortRequirement === 'SIGNAL DROP') return 'SIGNAL DROP';
  return 'SIGNAL PACK';
}

/**
 * Build every browsable cosmetic, in a stable order (knives, drop gloves,
 * mastery gloves). Filtering and sorting happen separately so the inventory can
 * be re-filtered without rebuilding.
 */
export function buildArmoryItems(input: ArmoryInventoryInput): ArmoryItem[] {
  const items: ArmoryItem[] = [];

  for (const skin of input.skins) {
    const owned = input.skinOwned(skin.id);
    items.push({
      id: skin.id,
      name: skin.name,
      codename: skin.codename,
      description: skin.description,
      rarity: skin.rarity,
      slot: 'karambit',
      family: 'karambit',
      source: knifeSource(skin),
      owned,
      // An item can only be EQUIPPED if it is genuinely owned: a stale or
      // synthetic equipped id must never produce a misleading marker.
      equipped: owned && skin.id === input.equippedKnifeId,
      requirement: skin.unlockRequirement,
      progress: input.skinProgress(skin.id),
      swatch: paletteSwatch(skin.paletteTag) ?? rarityColor(skin.rarity),
      isLive: !!skin.profile?.isVideoArtifact
    });
  }

  for (const glove of input.dropGloves) {
    const owned = input.dropOwned(glove.id);
    items.push({
      id: glove.id,
      name: glove.name,
      codename: glove.codename,
      description:
        'Rolled from the Signal Decoder. Random reward, permanently owned once decoded.',
      rarity: glove.rarity,
      slot: 'gloves',
      family: 'drop',
      source: 'SIGNAL DROP',
      owned,
      equipped: owned && glove.id === input.equippedGloveId,
      requirement: 'SIGNAL DROP // RANDOM REWARD',
      progress: '',
      swatch: rarityColor(glove.rarity),
      isLive: false
    });
  }

  for (const status of input.masteryGloves) {
    const d = status.definition;
    items.push({
      id: d.id,
      name: d.name,
      codename: d.codename,
      description: d.description,
      rarity: masteryRarity(d.tier),
      slot: 'gloves',
      family: 'mastery',
      source: 'MASTERY',
      owned: status.satisfied,
      equipped: status.satisfied && d.id === input.equippedGloveId,
      requirement: d.requirementLabel,
      progress: status.progressLabel,
      swatch: masterySwatch(d.tier),
      isLive: false
    });
  }

  return items;
}

/**
 * Mastery gloves have no drop rarity; their prestige tier is the honest
 * equivalent. Tier 0..6 maps onto the shared rarity vocabulary so the inventory
 * can sort and colour them consistently without inventing a second scale.
 */
export function masteryRarity(tier: number): CosmeticRarity {
  if (tier >= 6) return 'OVERCLOCKED';
  if (tier >= 5) return 'ARTIFACT';
  if (tier >= 4) return 'RELIC';
  if (tier >= 2) return 'RARE';
  return 'STANDARD';
}

function masterySwatch(tier: number): string {
  return rarityColor(masteryRarity(tier));
}

// ---------------------------------------------------------------------------
// Filtering & sorting
// ---------------------------------------------------------------------------

/** True when an item passes the slot + family + ownership filters. */
export function matchesFilters(item: ArmoryItem, filters: ArmoryFilters): boolean {
  if (item.slot !== filters.slot) return false;

  if (filters.slot === 'gloves' && filters.gloveFamily !== 'all') {
    if (item.family !== filters.gloveFamily) return false;
  }

  if (filters.ownership === 'owned' && !item.owned) return false;
  if (filters.ownership === 'locked' && item.owned) return false;

  return true;
}

/**
 * Filter and sort for display. Equipped items are NOT hoisted above the sort
 * order — a stable, predictable order is easier to scan than a magic one; the
 * equipped marker plus the header loadout line carry that information instead.
 */
export function filterArmoryItems(
  items: readonly ArmoryItem[],
  filters: ArmoryFilters
): ArmoryItem[] {
  const visible = items.filter((item) => matchesFilters(item, filters));

  const sorted = [...visible];
  if (filters.sort === 'name') {
    sorted.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  } else {
    sorted.sort(
      (a, b) =>
        rarityRank(b.rarity) - rarityRank(a.rarity) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id)
    );
  }
  return sorted;
}

/**
 * Resolve which item the detail panel should show.
 *
 * Keeps the current selection when it is still visible; otherwise falls back to
 * the equipped item, then to the first visible item. Returns null only when the
 * filter yields nothing.
 */
export function resolveSelection(
  visible: readonly ArmoryItem[],
  currentId: string | null
): ArmoryItem | null {
  if (visible.length === 0) return null;
  if (currentId) {
    const kept = visible.find((i) => i.id === currentId);
    if (kept) return kept;
  }
  const equipped = visible.find((i) => i.equipped);
  return equipped ?? visible[0];
}

/** `12 ITEMS` / `1 ITEM`, for the compact inventory counter. */
export function inventoryCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'ITEM' : 'ITEMS'}`;
}

/**
 * Ownership tally for the active slot, used by the compact filter bar so the
 * player can see how much is left without scrolling the whole inventory.
 */
export function ownershipTally(
  items: readonly ArmoryItem[],
  filters: ArmoryFilters
): { owned: number; locked: number; total: number } {
  const inSlot = items.filter((item) => {
    if (item.slot !== filters.slot) return false;
    if (filters.slot === 'gloves' && filters.gloveFamily !== 'all') {
      return item.family === filters.gloveFamily;
    }
    return true;
  });
  const owned = inSlot.filter((i) => i.owned).length;
  return { owned, locked: inSlot.length - owned, total: inSlot.length };
}

/** Can this item actually be equipped right now? Locked items never can. */
export function isEquippable(item: ArmoryItem | null): boolean {
  return !!item && item.owned;
}
