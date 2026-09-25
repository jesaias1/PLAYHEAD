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
 * TWO RESOLUTIONS PER GLOVE
 *   `texturePath`   512 px, selected by LOW / MEDIUM.
 *   `hiTexturePath` 1024 px, selected by HIGH / ULTRA.
 * The authoring sheets are 1254 px and the glove occupies only a thin band of
 * the sheet, so the 512 variant carried roughly 177 px of real glove detail —
 * visibly soft on a magnified first-person viewmodel. The hi variant roughly
 * doubles that. Both are lazy-loaded and cached; only the equipped glove is ever
 * resident, and neither is a video.
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
  | 'DROP_GLOVE_CYBER_FULL'
  | 'DROP_GLOVE_CRYSTAL'
  | 'DROP_GLOVE_SYNTH'
  | 'DROP_GLOVE_AUREATE'
  | 'DROP_GLOVE_SYNTH_FULL'
  | 'DROP_GLOVE_AUREATE_FULL';

export interface DropGlove {
  id: DropGloveId;
  /** Display name. Deliberately distinct from every mastery glove name. */
  name: string;
  codename: string;
  rarity: CosmeticRarity;
  /** Runtime base-color texture for LOW / MEDIUM. Never a video. */
  texturePath: string;
  /** Sharper base-color texture for HIGH / ULTRA. Never a video. */
  hiTexturePath: string;
  dropEligible: boolean;
  /** Relative frequency inside its rarity band. */
  dropWeight: number;
}

const DIR = '/assets/viewmodel/gloves/drops';
const HI_DIR = `${DIR}/hi`;

/**
 * THE DROP GLOVE CATALOG.
 *
 * Rarity spread is deliberately NOT flat: one STANDARD, three RARE, six RELIC,
 * one ARTIFACT and one OVERCLOCKED. The clean/simple gloves are common; the
 * visually distinctive ones are scarce.
 *
 * The white / pearl family carries the premium end of the ladder: PEARL ICE
 * ships at RELIC because the frozen-nacre treatment is one of the strongest
 * materials in the set.
 *
 * CYBER // II was REMOVED from production: it read too similarly to CYBER to
 * justify a separate drop. CYBER and CYBER // FULL remain, and are clearly
 * distinct — CYBER is a fingerless black glove with a neon trace, CYBER // FULL
 * is a full-finger black glove with a full neon weave.
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
    hiTexturePath: `${HI_DIR}/creme.webp`,
    dropEligible: true,
    dropWeight: 1
  },
  {
    id: 'DROP_GLOVE_PEARL',
    name: 'PEARL',
    codename: 'IRIDESCENT SHELL',
    rarity: 'RARE',
    texturePath: `${DIR}/pearl.webp`,
    hiTexturePath: `${HI_DIR}/pearl.webp`,
    dropEligible: true,
    dropWeight: 1
  },
  {
    id: 'DROP_GLOVE_PEARL_ICE',
    name: 'PEARL ICE',
    codename: 'FROZEN NACRE',
    rarity: 'RELIC',
    texturePath: `${DIR}/pearl-ice.webp`,
    hiTexturePath: `${HI_DIR}/pearl-ice.webp`,
    dropEligible: true,
    dropWeight: 1
  },
  {
    id: 'DROP_GLOVE_SILVERSKIN',
    name: 'SILVERSKIN',
    codename: 'COOL PLATE',
    rarity: 'RARE',
    texturePath: `${DIR}/silverskin.webp`,
    hiTexturePath: `${HI_DIR}/silverskin.webp`,
    dropEligible: true,
    dropWeight: 1
  },
  {
    id: 'DROP_GLOVE_CYBER',
    name: 'CYBER',
    codename: 'NEON TRACE',
    rarity: 'RARE',
    texturePath: `${DIR}/cyber.webp`,
    hiTexturePath: `${HI_DIR}/cyber.webp`,
    dropEligible: true,
    dropWeight: 1
  },
  {
    id: 'DROP_GLOVE_CYBER_FULL',
    name: 'CYBER // FULL',
    codename: 'FULL TRACE WEAVE',
    rarity: 'RELIC',
    texturePath: `${DIR}/cyber-full.webp`,
    hiTexturePath: `${HI_DIR}/cyber-full.webp`,
    dropEligible: true,
    dropWeight: 1
  },
  {
    id: 'DROP_GLOVE_CRYSTAL',
    name: 'CRYSTAL',
    codename: 'LATTICE SHELL',
    rarity: 'RELIC',
    texturePath: `${DIR}/crystal.webp`,
    hiTexturePath: `${HI_DIR}/crystal.webp`,
    dropEligible: true,
    dropWeight: 1
  },
  {
    id: 'DROP_GLOVE_SYNTH',
    name: 'SYNTH',
    codename: 'SPECTRAL WEAVE',
    rarity: 'RELIC',
    texturePath: `${DIR}/synth.webp`,
    hiTexturePath: `${HI_DIR}/synth.webp`,
    dropEligible: true,
    dropWeight: 1
  },
  {
    id: 'DROP_GLOVE_AUREATE',
    name: 'AUREATE',
    codename: 'TRACED GOLD',
    rarity: 'RELIC',
    texturePath: `${DIR}/aureate.webp`,
    hiTexturePath: `${HI_DIR}/aureate.webp`,
    dropEligible: true,
    dropWeight: 1
  },
  {
    id: 'DROP_GLOVE_SYNTH_FULL',
    name: 'SYNTH // FULL',
    codename: 'FULL SPECTRAL WEAVE',
    rarity: 'ARTIFACT',
    texturePath: `${DIR}/synth-full.webp`,
    hiTexturePath: `${HI_DIR}/synth-full.webp`,
    dropEligible: true,
    dropWeight: 1
  },
  {
    id: 'DROP_GLOVE_AUREATE_FULL',
    name: 'AUREATE // FULL',
    codename: 'APEX TRACED GOLD',
    rarity: 'OVERCLOCKED',
    texturePath: `${DIR}/aureate-full.webp`,
    hiTexturePath: `${HI_DIR}/aureate-full.webp`,
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

/**
 * Ids that were once obtainable but are no longer in production.
 *
 * A player who decoded one of these before it was retired still has it in their
 * ownership ledger. Nothing is deleted from their progression: the id simply
 * stops resolving, so every catalog-driven lookup (`getDropGlove`,
 * `getEquippedGloveId`, the Armory inventory, the reward bags) falls back
 * cleanly and the cosmetic is never rendered or re-rolled.
 */
export const RETIRED_DROP_GLOVE_IDS: readonly string[] = ['DROP_GLOVE_CYBER_2'];

/** True when an id was retired from production. */
export function isRetiredDropGloveId(id: string): boolean {
  return RETIRED_DROP_GLOVE_IDS.includes(id);
}
