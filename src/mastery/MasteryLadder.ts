/**
 * MASTERY LADDER — proof-of-skill progression.
 *
 * KNIFE = what the Signal gave you. GLOVES = what you proved.
 *
 * Every mastery glove is bound to an ACTUAL movement accomplishment on the
 * canonical official Signal Pack. Nothing here is random, purchasable, time-gated
 * or grindable, and nothing here is satisfied by Custom Audio, the Movement Lab,
 * a friend race, or an old-map run.
 *
 * This module is PURE: it takes the canonical catalog plus authoritative rank
 * records and derives everything. Ownership is therefore DERIVED, never a fragile
 * independent unlock boolean, so a cross-device migration cannot lose an
 * achievement the player genuinely earned.
 */

import type { RunRank } from '../player/PlayerStats';

/** Monotonic rank ordering. A higher rank always counts toward lower tiers. */
export const MASTERY_RANK_VALUE: Record<string, number> = {
  UNRANKED: 0,
  BRONZE: 1,
  SILVER: 2,
  GOLD: 3,
  DIAMOND: 4
};

export function masteryRankValue(rank: RunRank | undefined): number {
  if (!rank) return 0;
  return MASTERY_RANK_VALUE[rank] ?? 0;
}

export type MasteryRequirementKind =
  | 'COMPLETE_ANY'
  | 'BRONZE_ALL'
  | 'SILVER_ALL'
  | 'GOLD_ALL'
  | 'DIAMOND_COUNT'
  | 'DIAMOND_ALL';

export interface MasteryRequirement {
  kind: MasteryRequirementKind;
  /** Only meaningful for DIAMOND_COUNT. */
  count?: number;
}

export type MasteryGloveId =
  | 'STANDARD_ISSUE'
  | 'FIRST_CONTACT'
  | 'SIGNAL_RUNNER'
  | 'VELOCITY'
  | 'GOLDLINE'
  | 'DIAMOND_HAND'
  | 'SIGNAL_MASTER';

export interface MasteryGloveDefinition {
  id: MasteryGloveId;
  name: string;
  codename: string;
  description: string;
  requirement: MasteryRequirement;
  /** Human requirement line shown in the Armory. Never hidden. */
  requirementLabel: string;
  /** Ordering / prestige tier. */
  tier: number;
}

/**
 * THE LADDER.
 *
 * Deliberately restrained: seven gloves, each one a real accomplishment. There
 * is no XP, no level number and no currency.
 */
export const MASTERY_GLOVES: readonly MasteryGloveDefinition[] = [
  {
    id: 'STANDARD_ISSUE',
    name: 'STANDARD ISSUE',
    codename: 'BASELINE',
    description: 'Clean, understated PLAYHEAD glove. Issued to every operator.',
    requirement: { kind: 'COMPLETE_ANY' },
    requirementLabel: 'ISSUED BY DEFAULT',
    tier: 0
  },
  {
    id: 'FIRST_CONTACT',
    name: 'FIRST CONTACT',
    codename: 'PROOF OF ENTRY',
    description: 'Signal stitching and small cyan technical accents. Your first completed Signal.',
    requirement: { kind: 'COMPLETE_ANY' },
    requirementLabel: 'COMPLETE ANY OFFICIAL SIGNAL',
    tier: 1
  },
  {
    id: 'SIGNAL_RUNNER',
    name: 'SIGNAL RUNNER',
    codename: 'CONSISTENT',
    description: 'Technical runner glove with structured panel detail. Bronze or better across the pack.',
    requirement: { kind: 'BRONZE_ALL' },
    requirementLabel: 'BRONZE+ ON ALL OFFICIAL SIGNALS',
    tier: 2
  },
  {
    id: 'VELOCITY',
    name: 'VELOCITY',
    codename: 'MOMENTUM',
    description: 'Cooler performance material with a restrained moving signal seam.',
    requirement: { kind: 'SILVER_ALL' },
    requirementLabel: 'SILVER+ ON ALL OFFICIAL SIGNALS',
    tier: 3
  },
  {
    id: 'GOLDLINE',
    name: 'GOLDLINE',
    codename: 'PRECISION',
    description: 'Dark premium base with thin metallic gold signal tracing. Earned, not decorated.',
    requirement: { kind: 'GOLD_ALL' },
    requirementLabel: 'GOLD+ ON ALL OFFICIAL SIGNALS',
    tier: 4
  },
  {
    id: 'DIAMOND_HAND',
    name: 'DIAMOND HAND',
    codename: 'PRESTIGE',
    description: 'Icy crystalline signal accents over a dark base. Diamond on five Signals.',
    requirement: { kind: 'DIAMOND_COUNT', count: 5 },
    requirementLabel: 'DIAMOND ON 5 OFFICIAL SIGNALS',
    tier: 5
  },
  {
    id: 'SIGNAL_MASTER',
    name: 'SIGNAL MASTER',
    codename: 'APEX',
    description:
      'Precision signal lines and a spectral identity that answers strong musical events. Diamond on every Signal.',
    requirement: { kind: 'DIAMOND_ALL' },
    requirementLabel: 'DIAMOND ON ALL 14 OFFICIAL SIGNALS',
    tier: 6
  }
];

/** The glove every player owns. */
export const DEFAULT_MASTERY_GLOVE_ID: MasteryGloveId = 'STANDARD_ISSUE';

export interface MasteryProgress {
  /** Canonical official track ids, taken live from the catalog. */
  trackIds: readonly string[];
  /** Authoritative best rank per official track id. */
  ranks: Readonly<Record<string, RunRank>>;
}

export interface MasterySummary {
  total: number;
  cleared: number;
  bronzePlus: number;
  silverPlus: number;
  goldPlus: number;
  diamond: number;
}

export interface MasteryGloveStatus {
  definition: MasteryGloveDefinition;
  satisfied: boolean;
  current: number;
  required: number;
  /** e.g. `09 / 14 GOLD+`, or `ISSUED` for the default glove. */
  progressLabel: string;
}

export interface MasteryEvaluation {
  summary: MasterySummary;
  gloves: MasteryGloveStatus[];
  /** Ids currently satisfied, in ladder order. */
  unlockedIds: MasteryGloveId[];
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/**
 * Raw accomplishment counts.
 *
 * These are the meaningful numbers: no arbitrary XP scalar is invented. Because
 * rank ordering is monotonic, a Diamond track naturally counts toward Bronze+,
 * Silver+, Gold+ and Diamond.
 */
export function computeMasterySummary(progress: MasteryProgress): MasterySummary {
  let cleared = 0;
  let bronzePlus = 0;
  let silverPlus = 0;
  let goldPlus = 0;
  let diamond = 0;

  for (const trackId of progress.trackIds) {
    const value = masteryRankValue(progress.ranks[trackId]);
    if (value >= 1) {
      cleared++;
      bronzePlus++;
    }
    if (value >= 2) silverPlus++;
    if (value >= 3) goldPlus++;
    if (value >= 4) diamond++;
  }

  return { total: progress.trackIds.length, cleared, bronzePlus, silverPlus, goldPlus, diamond };
}

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

/** Evaluates one requirement against authoritative progress. */
export function evaluateRequirement(
  requirement: MasteryRequirement,
  progress: MasteryProgress
): { satisfied: boolean; current: number; required: number } {
  const total = progress.trackIds.length;

  const countAtLeast = (value: number): number =>
    progress.trackIds.reduce(
      (n, id) => (masteryRankValue(progress.ranks[id]) >= value ? n + 1 : n),
      0
    );

  switch (requirement.kind) {
    case 'COMPLETE_ANY': {
      const current = countAtLeast(1);
      return { satisfied: current >= 1, current, required: 1 };
    }
    case 'BRONZE_ALL': {
      const current = countAtLeast(1);
      return { satisfied: total > 0 && current >= total, current, required: total };
    }
    case 'SILVER_ALL': {
      const current = countAtLeast(2);
      return { satisfied: total > 0 && current >= total, current, required: total };
    }
    case 'GOLD_ALL': {
      const current = countAtLeast(3);
      return { satisfied: total > 0 && current >= total, current, required: total };
    }
    case 'DIAMOND_COUNT': {
      const need = Math.max(1, Math.floor(requirement.count ?? 1));
      const current = countAtLeast(4);
      return { satisfied: current >= need, current, required: need };
    }
    case 'DIAMOND_ALL': {
      const current = countAtLeast(4);
      return { satisfied: total > 0 && current >= total, current, required: total };
    }
    default:
      return { satisfied: false, current: 0, required: 1 };
  }
}

/** Short progress label for the Armory. */
export function requirementProgressLabel(
  definition: MasteryGloveDefinition,
  current: number,
  required: number
): string {
  if (definition.id === DEFAULT_MASTERY_GLOVE_ID) return 'ISSUED';
  switch (definition.requirement.kind) {
    case 'COMPLETE_ANY':
      return current >= required ? 'CLEARED' : '0 / 1 CLEARED';
    case 'DIAMOND_COUNT':
      return `${pad(current)} / ${pad(required)} DIAMOND`;
    case 'BRONZE_ALL':
      return `${pad(current)} / ${pad(required)} BRONZE+`;
    case 'SILVER_ALL':
      return `${pad(current)} / ${pad(required)} SILVER+`;
    case 'GOLD_ALL':
      return `${pad(current)} / ${pad(required)} GOLD+`;
    case 'DIAMOND_ALL':
      return `${pad(current)} / ${pad(required)} DIAMOND`;
    default:
      return `${current} / ${required}`;
  }
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

// ---------------------------------------------------------------------------
// Full evaluation
// ---------------------------------------------------------------------------

/** Evaluates the whole ladder against authoritative progress. */
export function evaluateMastery(progress: MasteryProgress): MasteryEvaluation {
  const summary = computeMasterySummary(progress);
  const gloves: MasteryGloveStatus[] = [];
  const unlockedIds: MasteryGloveId[] = [];

  for (const definition of MASTERY_GLOVES) {
    const result = evaluateRequirement(definition.requirement, progress);
    // The default glove is always satisfied regardless of progress.
    const satisfied = definition.id === DEFAULT_MASTERY_GLOVE_ID ? true : result.satisfied;
    if (satisfied) unlockedIds.push(definition.id);

    gloves.push({
      definition,
      satisfied,
      current: result.current,
      required: result.required,
      progressLabel: requirementProgressLabel(definition, result.current, result.required)
    });
  }

  return { summary, gloves, unlockedIds };
}

/** Convenience: is one glove satisfied by this progress? */
export function isGloveSatisfied(id: MasteryGloveId, progress: MasteryProgress): boolean {
  const definition = MASTERY_GLOVES.find((g) => g.id === id);
  if (!definition) return false;
  if (definition.id === DEFAULT_MASTERY_GLOVE_ID) return true;
  return evaluateRequirement(definition.requirement, progress).satisfied;
}

/** Definition lookup; unknown ids resolve to the default glove. */
export function getMasteryGlove(id: string): MasteryGloveDefinition {
  return (
    MASTERY_GLOVES.find((g) => g.id === id) ??
    MASTERY_GLOVES.find((g) => g.id === DEFAULT_MASTERY_GLOVE_ID)!
  );
}

/**
 * Summary deltas worth showing on the results screen.
 *
 * Only reports progress that ACTUALLY changed, so the UI never spams the player
 * with mastery noise after an unrelated run.
 */
export interface MasteryProgressDelta {
  /** Human label for the milestone line, e.g. `GOLD MASTERY`. */
  label: string;
  before: number;
  after: number;
  total: number;
}

export function masteryProgressDeltas(
  before: MasterySummary,
  after: MasterySummary
): MasteryProgressDelta[] {
  const deltas: MasteryProgressDelta[] = [];
  const push = (label: string, b: number, a: number): void => {
    if (a > b) deltas.push({ label, before: b, after: a, total: after.total });
  };
  push('SIGNAL MASTERY', before.cleared, after.cleared);
  push('BRONZE MASTERY', before.bronzePlus, after.bronzePlus);
  push('SILVER MASTERY', before.silverPlus, after.silverPlus);
  push('GOLD MASTERY', before.goldPlus, after.goldPlus);
  push('DIAMOND MASTERY', before.diamond, after.diamond);
  return deltas;
}

/** Gloves that became satisfied between two evaluations. */
export function newlySatisfiedGloves(
  before: MasteryEvaluation,
  after: MasteryEvaluation
): MasteryGloveId[] {
  const beforeSet = new Set(before.unlockedIds);
  return after.unlockedIds.filter((id) => !beforeSet.has(id));
}
