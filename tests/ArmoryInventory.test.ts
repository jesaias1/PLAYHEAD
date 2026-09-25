/**
 * ARMORY INVENTORY MODEL — pure browsing logic.
 *
 * These tests protect BEHAVIOUR: which items exist, how filters partition them,
 * how selection resolves, and the two invariants that matter most:
 *
 *   1. Browsing is metadata-only (no cosmetic asset ever enters an item).
 *   2. The two glove families never blur.
 *
 * They cannot prove the inventory is pleasant to browse. Only human testing can.
 */

import { describe, it, expect } from 'vitest';

import { KARAMBIT_SKINS } from '../src/viewmodel/KarambitSkinSystem';
import { DROP_GLOVES, isDropGloveId } from '../src/viewmodel/DropGloveCatalog';
import { MASTERY_GLOVES, MasteryGloveStatus } from '../src/mastery/MasteryLadder';
import {
  ArmoryFilters,
  ArmoryItem,
  buildArmoryItems,
  filterArmoryItems,
  inventoryCountLabel,
  isEquippable,
  knifeSource,
  masteryRarity,
  ownershipTally,
  paletteSwatch,
  rarityColor,
  rarityRank,
  resolveSelection
} from '../src/ui/ArmoryInventory';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function masteryStatuses(satisfiedIds: readonly string[] = []): MasteryGloveStatus[] {
  return MASTERY_GLOVES.map((definition, index) => {
    const satisfied = satisfiedIds.includes(definition.id);
    return {
      definition,
      satisfied,
      current: satisfied ? 1 : 0,
      required: 1,
      progressLabel: satisfied ? 'ISSUED' : `0${index} / 14`
    };
  });
}

interface BuildOptions {
  ownedKnives?: readonly string[];
  ownedDrops?: readonly string[];
  satisfiedMastery?: readonly string[];
  equippedKnife?: string;
  equippedGlove?: string;
}

function build(opts: BuildOptions = {}): ArmoryItem[] {
  const ownedKnives = new Set(opts.ownedKnives ?? [KARAMBIT_SKINS[0].id]);
  const ownedDrops = new Set(opts.ownedDrops ?? []);
  return buildArmoryItems({
    skins: KARAMBIT_SKINS,
    skinOwned: (id) => ownedKnives.has(id),
    skinProgress: () => '00 / 14',
    equippedKnifeId: opts.equippedKnife ?? KARAMBIT_SKINS[0].id,
    dropGloves: DROP_GLOVES,
    dropOwned: (id) => ownedDrops.has(id),
    masteryGloves: masteryStatuses(opts.satisfiedMastery ?? ['STANDARD_ISSUE']),
    equippedGloveId: opts.equippedGlove ?? 'STANDARD_ISSUE'
  });
}

const ALL: ArmoryFilters = {
  slot: 'karambit',
  gloveFamily: 'all',
  ownership: 'all',
  sort: 'rarity'
};

const gloveFilters = (over: Partial<ArmoryFilters> = {}): ArmoryFilters => ({
  slot: 'gloves',
  gloveFamily: 'all',
  ownership: 'all',
  sort: 'rarity',
  ...over
});

// ---------------------------------------------------------------------------
// 1. Coverage: every cosmetic is represented
// ---------------------------------------------------------------------------

describe('Inventory coverage', () => {
  it('represents every knife, drop glove and mastery glove exactly once', () => {
    const items = build();
    expect(items).toHaveLength(KARAMBIT_SKINS.length + DROP_GLOVES.length + MASTERY_GLOVES.length);

    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const skin of KARAMBIT_SKINS) expect(ids).toContain(skin.id);
    for (const glove of DROP_GLOVES) expect(ids).toContain(glove.id);
    for (const glove of MASTERY_GLOVES) expect(ids).toContain(glove.id);
  });

  it('places each cosmetic in the right slot and acquisition family', () => {
    const items = build();
    for (const item of items) {
      if (KARAMBIT_SKINS.some((s) => s.id === item.id)) {
        expect(item.slot, item.id).toBe('karambit');
        expect(item.family, item.id).toBe('karambit');
      } else if (isDropGloveId(item.id)) {
        expect(item.slot, item.id).toBe('gloves');
        expect(item.family, item.id).toBe('drop');
      } else {
        expect(item.slot, item.id).toBe('gloves');
        expect(item.family, item.id).toBe('mastery');
      }
    }
  });

  it('carries no cosmetic asset handle: browsing is metadata-only', () => {
    for (const item of build()) {
      expect(Object.keys(item)).not.toContain('texturePath');
      expect(Object.keys(item)).not.toContain('texture');
      expect(Object.keys(item)).not.toContain('material');
      expect(Object.keys(item)).not.toContain('video');
      // Every string field is a short human label, never a URL/path.
      for (const value of Object.values(item)) {
        if (typeof value === 'string') {
          expect(value, item.id).not.toMatch(/^https?:|^\/assets\/|\.webp$|\.png$|\.mp4$/);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Honest source labelling
// ---------------------------------------------------------------------------

describe('Source labelling', () => {
  it('labels a knife by how it is actually unlocked', () => {
    for (const skin of KARAMBIT_SKINS) {
      const source = knifeSource(skin);
      if (skin.shortRequirement === 'DEFAULT') expect(source).toBe('STANDARD ISSUE');
      else if (skin.shortRequirement === 'SIGNAL DROP') expect(source).toBe('SIGNAL DROP');
      else expect(source).toBe('SIGNAL PACK');
    }
  });

  it('keeps the two glove families explicitly distinct', () => {
    const items = build();
    for (const glove of DROP_GLOVES) {
      const item = items.find((i) => i.id === glove.id)!;
      expect(item.source).toBe('SIGNAL DROP');
      expect(item.requirement).toMatch(/SIGNAL DROP/);
    }
    for (const glove of MASTERY_GLOVES) {
      const item = items.find((i) => i.id === glove.id)!;
      expect(item.source).toBe('MASTERY');
      expect(item.requirement).toBe(glove.requirementLabel);
    }
  });

  it('a drop glove can never be labelled as mastery, or the reverse', () => {
    for (const item of build()) {
      if (item.family === 'drop') expect(item.source).not.toMatch(/MASTERY/);
      if (item.family === 'mastery') expect(item.source).not.toMatch(/DROP/);
    }
  });

  it('carries mastery progress so the detail panel can show real numbers', () => {
    const items = build({ satisfiedMastery: ['STANDARD_ISSUE', 'FIRST_CONTACT'] });
    const satisfied = items.find((i) => i.id === 'FIRST_CONTACT')!;
    const locked = items.find((i) => i.id === 'SIGNAL_MASTER')!;
    expect(satisfied.owned).toBe(true);
    expect(satisfied.progress).toBe('ISSUED');
    expect(locked.owned).toBe(false);
    expect(locked.progress).toMatch(/\d+ \/ 14/);
  });
});

// ---------------------------------------------------------------------------
// 3. Ownership + equipped state
// ---------------------------------------------------------------------------

describe('Ownership and equipped state', () => {
  it('marks exactly the equipped knife and the equipped glove', () => {
    const items = build({
      ownedKnives: ['SIGNAL_CYAN', 'VOID_SIGNAL'],
      ownedDrops: ['DROP_GLOVE_PEARL'],
      satisfiedMastery: ['STANDARD_ISSUE', 'FIRST_CONTACT'],
      equippedKnife: 'VOID_SIGNAL',
      equippedGlove: 'DROP_GLOVE_PEARL'
    });

    const equippedKnives = items.filter((i) => i.slot === 'karambit' && i.equipped);
    const equippedGloves = items.filter((i) => i.slot === 'gloves' && i.equipped);
    expect(equippedKnives.map((i) => i.id)).toEqual(['VOID_SIGNAL']);
    expect(equippedGloves.map((i) => i.id)).toEqual(['DROP_GLOVE_PEARL']);
  });

  it('an equipped drop glove is not mistaken for a mastery glove', () => {
    const items = build({
      equippedGlove: 'DROP_GLOVE_AUREATE_FULL',
      ownedDrops: ['DROP_GLOVE_AUREATE_FULL']
    });
    const equipped = items.find((i) => i.equipped && i.slot === 'gloves')!;
    expect(equipped.family).toBe('drop');
  });

  it('reports ownership straight from the ledger, never inferred', () => {
    const items = build({ ownedKnives: ['VOID_SIGNAL'], ownedDrops: ['DROP_GLOVE_CREME'] });
    expect(items.find((i) => i.id === 'VOID_SIGNAL')!.owned).toBe(true);
    expect(items.find((i) => i.id === 'DROP_GLOVE_CREME')!.owned).toBe(true);
    expect(items.find((i) => i.id === 'SIGNAL_CYAN')!.owned).toBe(false);
    expect(items.find((i) => i.id === 'DROP_GLOVE_PEARL')!.owned).toBe(false);
  });

  it('never marks a locked item as equipped, even for a stale equipped id', () => {
    const items = build({ ownedKnives: ['SIGNAL_CYAN'], equippedKnife: 'BLACKSTAR' });
    const blackstar = items.find((i) => i.id === 'BLACKSTAR')!;
    expect(blackstar.owned).toBe(false);
    expect(blackstar.equipped).toBe(false);
    expect(items.some((i) => i.slot === 'karambit' && i.equipped)).toBe(false);
  });

  it('never marks an unowned glove as equipped', () => {
    const items = build({
      ownedDrops: [],
      satisfiedMastery: [],
      equippedGlove: 'DROP_GLOVE_PEARL'
    });
    expect(items.some((i) => i.slot === 'gloves' && i.equipped)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Slot + family filtering
// ---------------------------------------------------------------------------

describe('Slot and family filters', () => {
  it('the karambit slot shows only knives', () => {
    const visible = filterArmoryItems(build(), ALL);
    expect(visible.length).toBe(KARAMBIT_SKINS.length);
    expect(visible.every((i) => i.slot === 'karambit')).toBe(true);
  });

  it('the glove slot shows both families when ALL is selected', () => {
    const visible = filterArmoryItems(build(), gloveFilters());
    expect(visible.length).toBe(DROP_GLOVES.length + MASTERY_GLOVES.length);
    expect(new Set(visible.map((i) => i.family))).toEqual(new Set(['drop', 'mastery']));
  });

  it('SIGNAL DROP shows only drop gloves', () => {
    const visible = filterArmoryItems(build(), gloveFilters({ gloveFamily: 'drop' }));
    expect(visible.length).toBe(DROP_GLOVES.length);
    expect(visible.every((i) => i.family === 'drop')).toBe(true);
  });

  it('MASTERY shows only mastery gloves', () => {
    const visible = filterArmoryItems(build(), gloveFilters({ gloveFamily: 'mastery' }));
    expect(visible.length).toBe(MASTERY_GLOVES.length);
    expect(visible.every((i) => i.family === 'mastery')).toBe(true);
  });

  it('the family filter is inert for the knife slot', () => {
    const withFamily = filterArmoryItems(
      build(),
      { ...ALL, gloveFamily: 'mastery' }
    );
    expect(withFamily.length).toBe(KARAMBIT_SKINS.length);
  });
});

// ---------------------------------------------------------------------------
// 5. Ownership filtering
// ---------------------------------------------------------------------------

describe('ALL / OWNED / LOCKED', () => {
  it('partitions the visible set exactly', () => {
    const items = build({
      ownedKnives: ['SIGNAL_CYAN', 'VOID_SIGNAL'],
      ownedDrops: ['DROP_GLOVE_CREME', 'DROP_GLOVE_PEARL'],
      satisfiedMastery: ['STANDARD_ISSUE']
    });

    const all = filterArmoryItems(items, ALL);
    const owned = filterArmoryItems(items, { ...ALL, ownership: 'owned' });
    const locked = filterArmoryItems(items, { ...ALL, ownership: 'locked' });

    expect(owned.length + locked.length).toBe(all.length);
    expect(owned.every((i) => i.owned)).toBe(true);
    expect(locked.every((i) => !i.owned)).toBe(true);
    expect(owned.map((i) => i.id).sort()).toEqual(['SIGNAL_CYAN', 'VOID_SIGNAL']);
  });

  it('combines with the glove family filter', () => {
    const items = build({
      ownedDrops: ['DROP_GLOVE_CREME', 'DROP_GLOVE_PEARL'],
      satisfiedMastery: ['STANDARD_ISSUE']
    });
    const ownedDrops = filterArmoryItems(
      items,
      gloveFilters({ gloveFamily: 'drop', ownership: 'owned' })
    );
    expect(ownedDrops.map((i) => i.id).sort()).toEqual(['DROP_GLOVE_CREME', 'DROP_GLOVE_PEARL']);

    const lockedMastery = filterArmoryItems(
      items,
      gloveFilters({ gloveFamily: 'mastery', ownership: 'locked' })
    );
    expect(lockedMastery.length).toBe(MASTERY_GLOVES.length - 1);
    expect(lockedMastery.some((i) => i.id === 'STANDARD_ISSUE')).toBe(false);
  });

  it('reports a tally for the active slot and family', () => {
    const items = build({
      ownedDrops: ['DROP_GLOVE_CREME'],
      satisfiedMastery: ['STANDARD_ISSUE', 'FIRST_CONTACT']
    });
    expect(ownershipTally(items, gloveFilters({ gloveFamily: 'drop' }))).toEqual({
      owned: 1,
      locked: DROP_GLOVES.length - 1,
      total: DROP_GLOVES.length
    });
    expect(ownershipTally(items, gloveFilters({ gloveFamily: 'mastery' })).owned).toBe(2);
    expect(ownershipTally(items, ALL).total).toBe(KARAMBIT_SKINS.length);
  });
});

// ---------------------------------------------------------------------------
// 6. Sorting
// ---------------------------------------------------------------------------

describe('Sorting', () => {
  it('sorts by rarity, best first', () => {
    const visible = filterArmoryItems(build(), ALL);
    for (let i = 1; i < visible.length; i++) {
      expect(rarityRank(visible[i - 1].rarity)).toBeGreaterThanOrEqual(
        rarityRank(visible[i].rarity)
      );
    }
  });

  it('sorts by name alphabetically when asked', () => {
    const visible = filterArmoryItems(build(), { ...ALL, sort: 'name' });
    const names = visible.map((i) => i.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('is stable and does not hoist the equipped item out of order', () => {
    const a = filterArmoryItems(build({ equippedKnife: 'VOID_SIGNAL' }), ALL).map((i) => i.id);
    const b = filterArmoryItems(build({ equippedKnife: 'SIGNAL_CYAN' }), ALL).map((i) => i.id);
    expect(a).toEqual(b);
  });

  it('ranks the rarity ladder monotonically', () => {
    expect(rarityRank('STANDARD')).toBeLessThan(rarityRank('RARE'));
    expect(rarityRank('RARE')).toBeLessThan(rarityRank('RELIC'));
    expect(rarityRank('RELIC')).toBeLessThan(rarityRank('ARTIFACT'));
    expect(rarityRank('ARTIFACT')).toBeLessThan(rarityRank('OVERCLOCKED'));
  });
});

// ---------------------------------------------------------------------------
// 7. Selection resolution
// ---------------------------------------------------------------------------

describe('Selection', () => {
  it('keeps the current selection while it stays visible', () => {
    const visible = filterArmoryItems(build(), ALL);
    const target = visible[3];
    expect(resolveSelection(visible, target.id)!.id).toBe(target.id);
  });

  it('falls back to the equipped item when the selection is filtered away', () => {
    const items = build({ ownedKnives: ['SIGNAL_CYAN', 'VOID_SIGNAL'], equippedKnife: 'VOID_SIGNAL' });
    const owned = filterArmoryItems(items, { ...ALL, ownership: 'owned' });
    const resolved = resolveSelection(owned, 'SIGNAL_CYAN');
    expect(resolved!.id).toBe('SIGNAL_CYAN');
    // Now select something that the filter excludes.
    const resolved2 = resolveSelection(owned, 'BLACKSTAR');
    expect(resolved2!.id).toBe('VOID_SIGNAL');
    expect(resolved2!.equipped).toBe(true);
  });

  it('falls back to the first item when nothing is equipped', () => {
    const items = build({ equippedKnife: 'BLACKSTAR' });
    const visible = filterArmoryItems(items, ALL);
    expect(resolveSelection(visible, null)!.id).toBe(visible[0].id);
  });

  it('returns null when the filter yields nothing', () => {
    expect(resolveSelection([], 'anything')).toBeNull();
  });

  it('never offers a selection outside the visible set', () => {
    const items = build();
    const locked = filterArmoryItems(items, { ...ALL, ownership: 'locked' });
    const resolved = resolveSelection(locked, items[0].id);
    expect(resolved).not.toBeNull();
    expect(resolved!.owned).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. Equip gating
// ---------------------------------------------------------------------------

describe('Equip gating', () => {
  it('only an owned item can be equipped', () => {
    const items = build({ ownedKnives: ['SIGNAL_CYAN'] });
    expect(isEquippable(items.find((i) => i.id === 'SIGNAL_CYAN')!)).toBe(true);
    expect(isEquippable(items.find((i) => i.id === 'VOID_SIGNAL')!)).toBe(false);
    expect(isEquippable(null)).toBe(false);
  });

  it('a locked mastery glove cannot be equipped even when selected', () => {
    const items = build({ satisfiedMastery: ['STANDARD_ISSUE'] });
    const locked = items.find((i) => i.id === 'SIGNAL_MASTER')!;
    expect(locked.owned).toBe(false);
    expect(isEquippable(locked)).toBe(false);
  });

  it('an unowned drop glove cannot be equipped even when selected', () => {
    const items = build({ ownedDrops: [] });
    const locked = items.find((i) => i.id === 'DROP_GLOVE_AUREATE_FULL')!;
    expect(isEquippable(locked)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. Presentation helpers
// ---------------------------------------------------------------------------

describe('Presentation helpers', () => {
  it('labels the item count', () => {
    expect(inventoryCountLabel(0)).toBe('0 ITEMS');
    expect(inventoryCountLabel(1)).toBe('1 ITEM');
    expect(inventoryCountLabel(23)).toBe('23 ITEMS');
  });

  it('parses a palette swatch from a palette tag without loading anything', () => {
    expect(paletteSwatch('CYAN // #00F0FF')).toBe('#00F0FF');
    expect(paletteSwatch('EMBER // #FF3300')).toBe('#FF3300');
    expect(paletteSwatch('NO COLOUR HERE')).toBeNull();
  });

  it('gives every item a swatch so tiles never need an asset', () => {
    for (const item of build()) {
      expect(item.swatch, item.id).toMatch(/^#[0-9a-f]{3,6}$/i);
    }
  });

  it('maps mastery tiers onto the shared rarity ladder', () => {
    expect(masteryRarity(0)).toBe('STANDARD');
    expect(rarityRank(masteryRarity(2))).toBeLessThan(rarityRank(masteryRarity(4)));
    expect(rarityRank(masteryRarity(4))).toBeLessThan(rarityRank(masteryRarity(6)));
    expect(masteryRarity(99)).toBe('OVERCLOCKED');
  });

  it('gives each rarity a distinct structural colour', () => {
    const colours = ['STANDARD', 'RARE', 'RELIC', 'ARTIFACT', 'OVERCLOCKED'].map((r) =>
      rarityColor(r as never)
    );
    expect(new Set(colours).size).toBe(colours.length);
  });

  it('flags live video artifacts for the detail panel only', () => {
    const items = build();
    const live = items.filter((i) => i.isLive);
    // Live knives exist in the catalog; the flag must not be lost.
    expect(live.length).toBeGreaterThan(0);
    expect(live.every((i) => i.slot === 'karambit')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. Purity
// ---------------------------------------------------------------------------

describe('Purity', () => {
  it('building and filtering never mutate the catalogs', () => {
    const skinsBefore = JSON.stringify(KARAMBIT_SKINS.map((s) => s.id));
    const glovesBefore = JSON.stringify(DROP_GLOVES.map((g) => g.id));
    const masteryBefore = JSON.stringify(MASTERY_GLOVES.map((g) => g.id));

    const items = build({ ownedKnives: ['VOID_SIGNAL'] });
    filterArmoryItems(items, ALL);
    filterArmoryItems(items, gloveFilters({ gloveFamily: 'mastery', ownership: 'locked' }));
    resolveSelection(items, items[5].id);

    expect(JSON.stringify(KARAMBIT_SKINS.map((s) => s.id))).toBe(skinsBefore);
    expect(JSON.stringify(DROP_GLOVES.map((g) => g.id))).toBe(glovesBefore);
    expect(JSON.stringify(MASTERY_GLOVES.map((g) => g.id))).toBe(masteryBefore);
  });

  it('filtering is order-preserving for equal keys', () => {
    const items = build();
    const all = filterArmoryItems(items, ALL);
    const filtered = filterArmoryItems(items, { ...ALL, ownership: 'all' });
    expect(filtered.map((i) => i.id)).toEqual(all.map((i) => i.id));
  });
});
