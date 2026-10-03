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
  /**
   * True for the reserved WORLD RECORD prestige cosmetic (BLACKSTAR). It is the
   * deliberate server-confirmed reward, never part of the normal Signal Drop
   * pool, so collection progress excludes it from ordinary completion totals.
   */
  worldRecord: boolean;
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
  /**
   * When true, a LOCKED ARTIFACT keeps its rarity/status and a masked hint but
   * withholds its name / codename / description / preview. Obtained items and
   * every non-ARTIFACT item always reveal fully.
   */
  maskUnknownArtifacts?: boolean;
}

/** Player-facing placeholder for an undiscovered ARTIFACT cosmetic. */
export const UNKNOWN_ARTIFACT_NAME = 'UNKNOWN ARTIFACT';
export const UNKNOWN_ARTIFACT_CODENAME = 'IDENTITY SEALED';
export const UNKNOWN_ARTIFACT_DESCRIPTION =
  'Live-signal artifact. Identity and preview stay sealed until it is decoded from a Signal Drop.';

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
  // RESERVED PRESTIGE: BLACKSTAR is the server-confirmed WORLD RECORD reward,
  // never a normal Signal Drop. The authoritative flag lives on its profile.
  if (skin.profile?.isBlackstar) return 'WORLD RECORD';
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
      isLive: !!skin.profile?.isVideoArtifact,
      worldRecord: !!skin.profile?.isBlackstar
    });
    // UNDISCOVERED ARTIFACT: keep the rarity/category/locked signal honest but
    // seal the identity so the premium video skins stay a genuine discovery.
    if (input.maskUnknownArtifacts && !owned && (skin.rarity === 'ARTIFACT' || skin.rarity === 'OVERCLOCKED')) {
      const masked = items[items.length - 1];
      masked.name = UNKNOWN_ARTIFACT_NAME;
      masked.codename = UNKNOWN_ARTIFACT_CODENAME;
      masked.description = UNKNOWN_ARTIFACT_DESCRIPTION;
      masked.progress = '';
    }
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
      isLive: false,
      worldRecord: false
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
      isLive: false,
      worldRecord: false
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

/**
 * COLLECTION PROGRESS — concise per-slot ownership, derived entirely from item
 * metadata. The reserved WORLD RECORD cosmetic (BLACKSTAR) is EXCLUDED from the
 * ordinary totals because it is not part of the Signal Drop / Signal Pack
 * completion loop; it is tracked as its own prestige line instead.
 */
export function collectionProgress(items: readonly ArmoryItem[]): {
  karambit: { owned: number; total: number };
  gloves: { owned: number; total: number };
  worldRecord: { owned: number; total: number };
} {
  const tally = (pred: (i: ArmoryItem) => boolean) => {
    const subset = items.filter(pred);
    return { owned: subset.filter((i) => i.owned).length, total: subset.length };
  };
  return {
    karambit: tally((i) => i.slot === 'karambit' && !i.worldRecord),
    gloves: tally((i) => i.slot === 'gloves'),
    worldRecord: tally((i) => i.worldRecord)
  };
}

/** Can this item actually be equipped right now? Locked items never can. */
export function isEquippable(item: ArmoryItem | null): boolean {
  return !!item && item.owned;
}

/**
 * DETAIL ROWS — the concise info hierarchy for the single detail panel:
 *
 *   SOURCE   how it is earned (STANDARD ISSUE / SIGNAL DROP / SIGNAL PACK /
 *            MASTERY / WORLD RECORD)
 *   REQUIREMENT  only when it adds information beyond the source line
 *   PROGRESS     live numbers when the acquisition is progress-based
 *
 * The requirement line is suppressed when it merely restates the source (the
 * repeated `SIGNAL DROP` lines the UI used to print twice). This is metadata
 * driven — no per-skin branches.
 */
export function armoryDetailRows(item: ArmoryItem): Array<[string, string]> {
  const rows: Array<[string, string]> = [['SOURCE', item.source], ['TYPE', item.slot === 'karambit' ? 'KNIFE' : 'GLOVES']];

  const requirement = item.requirement.trim();
  if (requirement && !requirementRestatesSource(item.source, requirement)) {
    rows.push(['REQUIREMENT', requirement]);
  }
  if (item.progress && !requirementRestatesSource(item.source, item.progress)) rows.push(['PROGRESS', item.progress]);
  return rows;
}

/** True when a requirement line adds nothing beyond the source label. */
function requirementRestatesSource(source: string, requirement: string): boolean {
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const src = norm(source);
  const req = norm(requirement);
  if (!src || !req) return false;
  if (src === req) return true;
  if (src === 'STANDARD ISSUE' && req === 'STANDARD ISSUE UNLOCKED BY DEFAULT') return true;
  // `SIGNAL DROP` source with any requirement that only talks about the drop.
  if (req === 'SIGNAL DROP' || req === 'SIGNAL DROP RANDOM REWARD') return true;
  if (req.includes('DISCOVERED THROUGH A SIGNAL DROP') && src === 'SIGNAL DROP') return true;
  return false;
}
