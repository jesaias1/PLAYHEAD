/**
 * DROP GLOVE CATALOG — random cosmetic gloves from the Signal Decoder.
 *
 * These are NOT mastery gloves. They use a separate `DROP_GLOVE_*` id namespace
 * and a separate ownership ledger, and they can never satisfy a mastery
 * requirement. Mastery gloves are earned; these are rolled.
 *
 * The two families must never blur:
 *   MASTERY    derived from canonical official progress. Never random.
 *   DROP       awarded by the Signal Decoder. Never achievement-based.
 *
 * Pure: no THREE, no DOM, no storage. Reward logic stays decoupled from the
 * renderer.
 */

import type { CosmeticRarity } from './KarambitSkinSystem';

export type DropGloveId =
  | 'DROP_GLOVE_CREME'
  | 'DROP_GLOVE_PEARL'
  | 'DROP_GLOVE_PEARL_ICE'
  | 'DROP_GLOVE_SILVERSKIN'
  | 'DROP_GLOVE_CYBER'
  | 'DROP_GLOVE_CYBER_2'
  | 'DROP_GLOVE_CYBER_FULL'
  | 'DROP_GLOVE_CRYSTAL'
  | 'DROP_GLOVE_SYNTH'
  | 'DROP_GLOVE_SYNTH_FULL'
  | 'DROP_GLOVE_AUREATE'
  | 'DROP_GLOVE_AUREATE_FULL';

export interface DropGlove {
  id: DropGloveId;
  /** Display name. Deliberately distinct from every mastery glove name. */
  name: string;
  codename: string;
  rarity: CosmeticRarity;
  /** Runtime base-color texture. Never a video, never larger than 512 px. */
  texturePath: string;
  dropEligible: boolean;
  /** Relative frequency inside its rarity band. */
  dropWeight: number;
}

const DIR = '/assets/viewmodel/gloves/drops';

/**
 * THE DROP GLOVE CATALOG.
 *
 * Rarity spread is deliberately NOT flat: one STANDARD entry, four RARE, five
 * RELIC, one ARTIFACT and one OVERCLOCKED. The clean/simple gloves are common;
 * the visually distinctive ones are scarce.
 *
 * No name collides with a mastery glove. The gold variants are AUREATE rather
 * than GOLDLINE specifically so no id or label is ever ambiguous.
 */
export const DROP_GLOVES: readonly DropGlove[] = [
  {
    id: 'DROP_GLOVE_CREME',
    name: 'CREME',
    codename: 'SOFT PANEL',
    rarity: 'STANDARD',
    texturePath: `${DIR}/creme.webp`,
    dropEligible: true,
    dropWeight: 1
  },
  {
    id: 'DROP_GLOVE_PEARL',
    name: 'PEARL',
    codename: 'IRIDESCENT SHELL',
    rarity: 'RARE',
    texturePath: `${DIR}/pearl.webp`,
    dropEligible: true,
    dropWeight: 1
  },
  {
    id: 'DROP_GLOVE_PEARL_ICE',
    name: 'PEARL ICE',
    codename: 'FROZEN NACRE',
    rarity: 'RARE',
    texturePath: `${DIR}/pearl-ice.webp`,
    dropEligible: true,
    dropWeight: 1
  },
  {
    id: 'DROP_GLOVE_SILVERSKIN',
    name: 'SILVERSKIN',
    codename: 'COOL PLATE',
    rarity: 'RARE',
    texturePath: `${DIR}/silverskin.webp`,
    dropEligible: true,
    dropWeight: 1
  },
  {
    id: 'DROP_GLOVE_CYBER',
    name: 'CYBER',
    codename: 'NEON TRACE',
    rarity: 'RARE',
    texturePath: `${DIR}/cyber.webp`,
    dropEligible: true,
    dropWeight: 1
  },
  {
    id: 'DROP_GLOVE_CYBER_2',
    name: 'CYBER // II',
    codename: 'NEON TRACE MK2',
    rarity: 'RELIC',
    texturePath: `${DIR}/cyber-2.webp`,
    dropEligible: true,
    dropWeight: 1
  },
  {
    id: 'DROP_GLOVE_CYBER_FULL',
    name: 'CYBER // FULL',
    codename: 'FULL TRACE WEAVE',
    rarity: 'RELIC',
    texturePath: `${DIR}/cyber-full.webp`,
    dropEligible: true,
    dropWeight: 1
  },
  {
    id: 'DROP_GLOVE_CRYSTAL',
    name: 'CRYSTAL',
    codename: 'LATTICE SHELL',
    rarity: 'RELIC',
    texturePath: `${DIR}/crystal.webp`,
    dropEligible: true,
    dropWeight: 1
  },
  {
    id: 'DROP_GLOVE_SYNTH',
    name: 'SYNTH',
    codename: 'SPECTRAL WEAVE',
    rarity: 'RELIC',
    texturePath: `${DIR}/synth.webp`,
    dropEligible: true,
    dropWeight: 1
  },
  {
    id: 'DROP_GLOVE_AUREATE',
    name: 'AUREATE',
    codename: 'TRACED GOLD',
    rarity: 'RELIC',
    texturePath: `${DIR}/aureate.webp`,
    dropEligible: true,
    dropWeight: 1
  },
  {
    id: 'DROP_GLOVE_SYNTH_FULL',
    name: 'SYNTH // FULL',
    codename: 'FULL SPECTRAL WEAVE',
    rarity: 'ARTIFACT',
    texturePath: `${DIR}/synth-full.webp`,
    dropEligible: true,
    dropWeight: 1
  },
  {
    id: 'DROP_GLOVE_AUREATE_FULL',
    name: 'AUREATE // FULL',
    codename: 'APEX TRACED GOLD',
    rarity: 'OVERCLOCKED',
    texturePath: `${DIR}/aureate-full.webp`,
    dropEligible: true,
    dropWeight: 1
  }
];

/** True when an id belongs to the random drop glove family. */
export function isDropGloveId(id: string): id is DropGloveId {
  return id.startsWith('DROP_GLOVE_');
}

/** Lookup. Returns null for an unknown id so callers can fall back safely. */
export function getDropGlove(id: string): DropGlove | null {
  return DROP_GLOVES.find((g) => g.id === id) ?? null;
}

/** Drop-eligible gloves, in catalog order. */
export function dropEligibleGloves(): readonly DropGlove[] {
  return DROP_GLOVES.filter((g) => g.dropEligible);
}
