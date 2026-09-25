/**
 * UNIFIED COSMETIC DROP — one reward vocabulary for knives and gloves.
 *
 * A decoded Signal can reveal a KARAMBIT or a GLOVE. The reward pipeline must not
 * carry knife-specific assumptions through every layer, and the two glove
 * families must never blur:
 *
 *   KNIFE         Signal Drop reward (existing behaviour, unchanged)
 *   GLOVE         Signal Drop reward from the DROP_GLOVE_* namespace
 *   MASTERY GLOVE achievement-derived. NEVER appears in the drop pool.
 *
 * Pure: no THREE, no DOM, no storage.
 */

import type { CosmeticRarity } from './KarambitSkinSystem';

export type CosmeticKind = 'KNIFE' | 'GLOVE';

export interface CosmeticDropItem {
  id: string;
  kind: CosmeticKind;
  name: string;
  rarity: CosmeticRarity;
  dropEligible: boolean;
}

/**
 * CATEGORY WEIGHTS — the single source of truth for the knife/glove split.
 *
 * A successful decode first resolves a category, then resolves rarity within
 * that category using the existing rank-weighted bag. The category roll never
 * bypasses rarity weighting.
 */
export const SIGNAL_DROP_CATEGORY_WEIGHTS: Readonly<Record<CosmeticKind, number>> = {
  KNIFE: 65,
  GLOVE: 35
};

/** Total weight, derived so the table can be edited without touching the roll. */
export function totalCategoryWeight(
  weights: Readonly<Record<CosmeticKind, number>> = SIGNAL_DROP_CATEGORY_WEIGHTS
): number {
  return Math.max(1, (weights.KNIFE ?? 0) + (weights.GLOVE ?? 0));
}

/**
 * Rolls a cosmetic category from a uniform `rand` in [0, 1).
 * Pure, so the weighting is directly testable.
 */
export function rollDropCategory(
  rand: number,
  weights: Readonly<Record<CosmeticKind, number>> = SIGNAL_DROP_CATEGORY_WEIGHTS
): CosmeticKind {
  const total = totalCategoryWeight(weights);
  const clamped = Number.isFinite(rand) ? Math.max(0, Math.min(0.999999, rand)) : 0;
  const threshold = (weights.KNIFE ?? 0) / total;
  return clamped < threshold ? 'KNIFE' : 'GLOVE';
}

/**
 * Resolves the category to actually award, honouring duplicate protection.
 *
 * If the rolled category has no unowned eligible items, fall through to the
 * other category. A full knife collection must never block glove drops, and a
 * full glove collection must never block knife drops. Only when BOTH are
 * exhausted does the caller fall back to a duplicate-owned award.
 */
export function resolveDropCategory(
  rolled: CosmeticKind,
  availability: Readonly<Record<CosmeticKind, number>>
): CosmeticKind | null {
  if ((availability[rolled] ?? 0) > 0) return rolled;
  const other: CosmeticKind = rolled === 'KNIFE' ? 'GLOVE' : 'KNIFE';
  if ((availability[other] ?? 0) > 0) return other;
  return null;
}

/** Human label for the reveal, so the slot type is never inferred from artwork. */
export function cosmeticKindLabel(kind: CosmeticKind): string {
  return kind === 'GLOVE' ? 'GLOVE' : 'KARAMBIT';
}
