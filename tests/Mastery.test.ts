/**
 * MASTERY V1 — proof-of-skill glove progression.
 *
 * Locks in the product rule that defines the whole feature:
 *
 *   KNIFE = what the Signal gave you. GLOVES = what you proved.
 *
 * Every glove is bound to an actual accomplishment on the canonical official
 * Signal Pack. Nothing is random, purchasable, time-gated or grindable, and
 * nothing can be satisfied by Custom Audio, the Movement Lab, a friend race or a
 * Signal Drop.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';

import {
  DEFAULT_MASTERY_GLOVE_ID,
  MASTERY_GLOVES,
  MasteryGloveId,
  MasteryProgress,
  computeMasterySummary,
  evaluateMastery,
  evaluateRequirement,
  getMasteryGlove,
  isGloveSatisfied,
  masteryProgressDeltas,
  masteryRankValue,
  newlySatisfiedGloves
} from '../src/mastery/MasteryLadder';
import { MasteryGloveSystem } from '../src/mastery/MasteryGloveSystem';
import { SignalPackCatalog } from '../src/audio/SignalPackCatalog';
import { OFFICIAL_MAP_REGISTRY } from '../src/online/OfficialMapRegistry';
import {
  GLOVE_TREATMENTS,
  applyGloveTreatment,
  getGloveTreatment,
  maxGloveEmissiveIntensity
} from '../src/viewmodel/GloveTreatments';
import { ViewmodelAssetLoader } from '../src/viewmodel/ViewmodelAssetLoader';

const repoRoot = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const CATALOG_IDS = SignalPackCatalog.getTracks().map((t) => t.id);

/** Builds progress with the given rank for the first N tracks. */
function progressWith(rank: string, count: number, ids: readonly string[] = CATALOG_IDS): MasteryProgress {
  const ranks: Record<string, string> = {};
  for (let i = 0; i < Math.min(count, ids.length); i++) ranks[ids[i]] = rank;
  return { trackIds: ids, ranks: ranks as MasteryProgress['ranks'] };
}

function progressFrom(ranks: Record<string, string>): MasteryProgress {
  return { trackIds: CATALOG_IDS, ranks: ranks as MasteryProgress['ranks'] };
}

// ---------------------------------------------------------------------------
// 1. The ladder itself
// ---------------------------------------------------------------------------

describe('Mastery ladder — definitions', () => {
  it('has a default glove that is always owned', () => {
    const info = evaluateMastery(progressFrom({}));
    const standard = info.gloves.find((g) => g.definition.id === 'STANDARD_ISSUE')!;
    expect(standard.satisfied).toBe(true);
    expect(standard.progressLabel).toBe('ISSUED');
    expect(DEFAULT_MASTERY_GLOVE_ID).toBe('STANDARD_ISSUE');
  });

  it('never hides a requirement', () => {
    for (const glove of MASTERY_GLOVES) {
      expect(glove.requirementLabel, glove.id).toBeTruthy();
      expect(glove.requirementLabel.length, glove.id).toBeGreaterThan(3);
    }
  });

  it('is an ordered ladder with no gaps or duplicates', () => {
    const ids = MASTERY_GLOVES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    const tiers = MASTERY_GLOVES.map((g) => g.tier);
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
  });

  it('resolves unknown ids to the default glove instead of throwing', () => {
    expect(getMasteryGlove('NOT_A_GLOVE').id).toBe(DEFAULT_MASTERY_GLOVE_ID);
    expect(getMasteryGlove('').id).toBe(DEFAULT_MASTERY_GLOVE_ID);
  });

  it('counts the canonical catalog dynamically (all 14 official tracks)', () => {
    expect(CATALOG_IDS.length).toBe(14);
    expect(OFFICIAL_MAP_REGISTRY.length).toBe(14);
    expect(computeMasterySummary(progressFrom({})).total).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// 2. Summary counting
// ---------------------------------------------------------------------------

describe('Mastery summary', () => {
  it('reports zero for a fresh player', () => {
    const s = computeMasterySummary(progressFrom({}));
    expect(s).toEqual({ total: 14, cleared: 0, bronzePlus: 0, silverPlus: 0, goldPlus: 0, diamond: 0 });
  });

  it('a Diamond track counts toward EVERY lower tier', () => {
    const s = computeMasterySummary(progressFrom({ [CATALOG_IDS[0]]: 'DIAMOND' }));
    expect(s.cleared).toBe(1);
    expect(s.bronzePlus).toBe(1);
    expect(s.silverPlus).toBe(1);
    expect(s.goldPlus).toBe(1);
    expect(s.diamond).toBe(1);
  });

  it('rank ordering is monotonic', () => {
    expect(masteryRankValue('UNRANKED')).toBe(0);
    expect(masteryRankValue('BRONZE')).toBeLessThan(masteryRankValue('SILVER'));
    expect(masteryRankValue('SILVER')).toBeLessThan(masteryRankValue('GOLD'));
    expect(masteryRankValue('GOLD')).toBeLessThan(masteryRankValue('DIAMOND'));
    expect(masteryRankValue(undefined)).toBe(0);
  });

  it('ignores ranks for tracks outside the canonical catalog', () => {
    const s = computeMasterySummary({
      trackIds: CATALOG_IDS,
      ranks: { custom_audio_file: 'DIAMOND', movement_lab: 'DIAMOND' } as MasteryProgress['ranks']
    });
    expect(s.cleared).toBe(0);
    expect(s.diamond).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Exact unlock thresholds (the brief's required cases)
// ---------------------------------------------------------------------------

describe('Mastery gloves — unlock thresholds', () => {
  it('no progress unlocks only the default glove', () => {
    const info = evaluateMastery(progressFrom({}));
    expect(info.unlockedIds).toEqual(['STANDARD_ISSUE']);
  });

  it('one completion unlocks FIRST CONTACT', () => {
    const info = evaluateMastery(progressWith('BRONZE', 1));
    expect(info.unlockedIds).toContain('FIRST_CONTACT');
    expect(info.unlockedIds).not.toContain('SIGNAL_RUNNER');
  });

  it('Bronze on all 14 unlocks SIGNAL RUNNER', () => {
    const info = evaluateMastery(progressWith('BRONZE', 14));
    expect(info.unlockedIds).toContain('SIGNAL_RUNNER');
    expect(info.unlockedIds).not.toContain('VELOCITY');
  });

  it('Silver on all 14 unlocks VELOCITY', () => {
    const info = evaluateMastery(progressWith('SILVER', 14));
    expect(info.unlockedIds).toContain('VELOCITY');
    expect(info.unlockedIds).not.toContain('GOLDLINE');
  });

  it('Gold on all 14 unlocks GOLDLINE', () => {
    const info = evaluateMastery(progressWith('GOLD', 14));
    expect(info.unlockedIds).toContain('GOLDLINE');
    expect(info.unlockedIds).not.toContain('DIAMOND_HAND');
  });

  it('Diamond on 5 unlocks DIAMOND HAND', () => {
    const four = evaluateMastery(progressWith('DIAMOND', 4));
    expect(four.unlockedIds).not.toContain('DIAMOND_HAND');

    const five = evaluateMastery(progressWith('DIAMOND', 5));
    expect(five.unlockedIds).toContain('DIAMOND_HAND');
    expect(five.unlockedIds).not.toContain('SIGNAL_MASTER');
  });

  it('Diamond on all 14 unlocks SIGNAL MASTER', () => {
    const thirteen = evaluateMastery(progressWith('DIAMOND', 13));
    expect(thirteen.unlockedIds).not.toContain('SIGNAL_MASTER');

    const all = evaluateMastery(progressWith('DIAMOND', 14));
    expect(all.unlockedIds).toContain('SIGNAL_MASTER');
    expect(all.unlockedIds).toEqual([
      'STANDARD_ISSUE',
      'FIRST_CONTACT',
      'SIGNAL_RUNNER',
      'VELOCITY',
      'GOLDLINE',
      'DIAMOND_HAND',
      'SIGNAL_MASTER'
    ]);
  });

  it('13 / 14 does NOT unlock an all-track achievement', () => {
    for (const rank of ['BRONZE', 'SILVER', 'GOLD', 'DIAMOND'] as const) {
      const info = evaluateMastery(progressWith(rank, 13));
      const idByRank: Record<string, MasteryGloveId> = {
        BRONZE: 'SIGNAL_RUNNER',
        SILVER: 'VELOCITY',
        GOLD: 'GOLDLINE',
        DIAMOND: 'SIGNAL_MASTER'
      };
      expect(info.unlockedIds, `${rank} x13`).not.toContain(idByRank[rank]);
    }
  });

  it('a mixed catalog still satisfies all-track tiers when every track qualifies', () => {
    const ranks: Record<string, string> = {};
    CATALOG_IDS.forEach((id, i) => (ranks[id] = i % 2 === 0 ? 'DIAMOND' : 'GOLD'));
    const info = evaluateMastery(progressFrom(ranks));
    expect(info.unlockedIds).toContain('GOLDLINE');
    expect(info.unlockedIds).toContain('DIAMOND_HAND');
    expect(info.unlockedIds).not.toContain('SIGNAL_MASTER');
  });

  it('reports progress labels a player can act on', () => {
    const nine = evaluateMastery(progressWith('GOLD', 9));
    const goldline = nine.gloves.find((g) => g.definition.id === 'GOLDLINE')!;
    expect(goldline.progressLabel).toBe('09 / 14 GOLD+');
    expect(goldline.satisfied).toBe(false);
  });

  it('evaluates requirements directly and consistently', () => {
    const p = progressWith('SILVER', 14);
    expect(evaluateRequirement({ kind: 'COMPLETE_ANY' }, p).satisfied).toBe(true);
    expect(evaluateRequirement({ kind: 'BRONZE_ALL' }, p).satisfied).toBe(true);
    expect(evaluateRequirement({ kind: 'SILVER_ALL' }, p).satisfied).toBe(true);
    expect(evaluateRequirement({ kind: 'GOLD_ALL' }, p).satisfied).toBe(false);
    expect(evaluateRequirement({ kind: 'DIAMOND_ALL' }, p).satisfied).toBe(false);
    expect(evaluateRequirement({ kind: 'DIAMOND_COUNT', count: 5 }, p).satisfied).toBe(false);
  });

  it('an empty catalog can never satisfy an all-track requirement', () => {
    const empty: MasteryProgress = { trackIds: [], ranks: {} };
    expect(evaluateRequirement({ kind: 'BRONZE_ALL' }, empty).satisfied).toBe(false);
    expect(evaluateRequirement({ kind: 'DIAMOND_ALL' }, empty).satisfied).toBe(false);
  });

  it('isGloveSatisfied agrees with the full evaluation', () => {
    const p = progressWith('GOLD', 14);
    const info = evaluateMastery(p);
    for (const status of info.gloves) {
      expect(isGloveSatisfied(status.definition.id, p), status.definition.id).toBe(status.satisfied);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Progress deltas + newly earned
// ---------------------------------------------------------------------------

describe('Mastery progress reporting', () => {
  it('reports only progress that actually changed, and never a decrease', () => {
    const before = computeMasterySummary(progressWith('GOLD', 5));
    const after = computeMasterySummary(progressWith('GOLD', 6));
    const deltas = masteryProgressDeltas(before, after);
    expect(deltas.map((d) => d.label)).toContain('GOLD MASTERY');
    for (const d of deltas) {
      expect(d.after, d.label).toBeGreaterThan(d.before);
      expect(d.total).toBe(14);
    }
  });

  it('reports nothing when a run changes no mastery progress', () => {
    const s = computeMasterySummary(progressWith('GOLD', 6));
    expect(masteryProgressDeltas(s, s)).toEqual([]);
  });

  it('reports a Diamond as progress across every tier at once', () => {
    const before = computeMasterySummary(progressWith('GOLD', 14));
    const after = computeMasterySummary(progressWith('DIAMOND', 14));
    const deltas = masteryProgressDeltas(before, after);
    const labels = deltas.map((d) => d.label);
    expect(labels).toContain('DIAMOND MASTERY');
    expect(labels).not.toContain('GOLD MASTERY');
  });

  it('reports only gloves that became newly satisfied', () => {
    const before = evaluateMastery(progressWith('GOLD', 13));
    const after = evaluateMastery(progressWith('GOLD', 14));
    // Completing the pack at Gold satisfies every all-track tier at once.
    expect(newlySatisfiedGloves(before, after)).toEqual([
      'SIGNAL_RUNNER',
      'VELOCITY',
      'GOLDLINE'
    ]);
  });

  it('does not re-report an already-satisfied glove', () => {
    const before = evaluateMastery(progressWith('GOLD', 14));
    const after = evaluateMastery(progressWith('GOLD', 14));
    expect(newlySatisfiedGloves(before, after)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. Ownership, persistence and safety
// ---------------------------------------------------------------------------

describe('Mastery glove system', () => {
  let system: MasteryGloveSystem;

  beforeEach(() => {
    system = MasteryGloveSystem.getInstance();
    system.resetForTests();
    // Clear authoritative rank records so each test starts from zero progress.
    (system as unknown as { getProgress: () => MasteryProgress }).getProgress = () => ({
      trackIds: CATALOG_IDS,
      ranks: {}
    });
  });

  it('a no-progress player can only wear the default glove', () => {
    expect(system.getEquippedGloveId()).toBe(DEFAULT_MASTERY_GLOVE_ID);
    expect(system.equipGlove('GOLDLINE')).toBe(false);
    expect(system.getEquippedGloveId()).toBe(DEFAULT_MASTERY_GLOVE_ID);
  });

  it('cannot equip an unearned glove even by id', () => {
    expect(system.equipGlove('SIGNAL_MASTER')).toBe(false);
    expect(system.getEquippedGloveId()).toBe(DEFAULT_MASTERY_GLOVE_ID);
  });

  it('falls back safely when the equipped glove is no longer satisfied', () => {
    // Simulate a player who earned Gold everywhere and equipped GOLDLINE.
    (system as unknown as { getProgress: () => MasteryProgress }).getProgress = () =>
      progressWith('GOLD', 14);
    expect(system.equipGlove('GOLDLINE')).toBe(true);
    expect(system.getEquippedGloveId()).toBe('GOLDLINE');

    // Progress disappears (e.g. a fresh device with no records): must not crash,
    // must not keep claiming the glove.
    (system as unknown as { getProgress: () => MasteryProgress }).getProgress = () => ({
      trackIds: CATALOG_IDS,
      ranks: {}
    });
    expect(system.getEquippedGloveId()).toBe(DEFAULT_MASTERY_GLOVE_ID);
  });

  it('ignores an unknown cloud equipped glove', () => {
    system.applyCloudEquippedGlove('NOT_A_REAL_GLOVE');
    expect(system.getEquippedGloveId()).toBe(DEFAULT_MASTERY_GLOVE_ID);
  });

  it('does not adopt a cloud glove the player has not earned', () => {
    system.applyCloudEquippedGlove('SIGNAL_MASTER');
    expect(system.getEquippedGloveId()).toBe(DEFAULT_MASTERY_GLOVE_ID);
  });

  it('adopts a cloud glove that IS genuinely satisfied', () => {
    (system as unknown as { getProgress: () => MasteryProgress }).getProgress = () =>
      progressWith('DIAMOND', 14);
    system.applyCloudEquippedGlove('SIGNAL_MASTER');
    expect(system.getEquippedGloveId()).toBe('SIGNAL_MASTER');
  });

  it('DEV preview never writes ownership or progress', () => {
    system.setDevPreview('SIGNAL_MASTER');
    expect(system.getDevPreviewGloveId()).toBe('SIGNAL_MASTER');
    expect(system.getEffectiveGloveId()).toBe('SIGNAL_MASTER');
    // Ownership is untouched: nothing was earned and nothing was persisted.
    expect(system.isSatisfied('SIGNAL_MASTER')).toBe(false);
    system.setDevPreview(null);
    expect(system.getEffectiveGloveId()).toBe(DEFAULT_MASTERY_GLOVE_ID);
  });

  it('migrates an existing qualifying player without repetition', () => {
    (system as unknown as { getProgress: () => MasteryProgress }).getProgress = () =>
      progressWith('GOLD', 14);
    const result = system.reconcile();
    expect(result.firstRecognition).toBe(true);
    expect(result.newlyRecognized).toContain('GOLDLINE');
    expect(result.newlyRecognized).toContain('VELOCITY');
    expect(result.newlyRecognized).toContain('SIGNAL_RUNNER');
    // A second reconcile reports nothing new: no duplicate recognition.
    const second = system.reconcile();
    expect(second.newlyRecognized).toEqual([]);
  });

  it('notifies listeners on equip so the viewmodel can react', () => {
    let seen: string | null = null;
    const off = system.addListener((id) => (seen = id));
    (system as unknown as { getProgress: () => MasteryProgress }).getProgress = () =>
      progressWith('GOLD', 14);
    system.equipGlove('GOLDLINE');
    expect(seen).toBe('GOLDLINE');
    off();
  });
});

// ---------------------------------------------------------------------------
// 6. Gloves can never be random
// ---------------------------------------------------------------------------

describe('Mastery gloves — integrity', () => {
  it('no glove id can ever enter the Signal Drop pool', () => {
    const skinSystem = read('src/viewmodel/KarambitSkinSystem.ts');
    // The drop economy only knows about drop-eligible KARAMBIT skins.
    expect(skinSystem).toMatch(/KARAMBIT_SKINS\.filter\(skin => skin\.dropEligible\)/);

    // The drop-opening path itself must not know mastery exists.
    const dropFn = skinSystem.slice(
      skinSystem.indexOf('public openSignalDrop('),
      skinSystem.indexOf('public getSkinProgress(')
    );
    expect(dropFn.length).toBeGreaterThan(50);
    expect(dropFn).not.toMatch(/mastery|MASTERY|GLOVE/i);
    for (const glove of MASTERY_GLOVES) {
      expect(dropFn, glove.id).not.toContain(glove.id);
    }
  });

  it('the decoder cannot reference mastery', () => {
    // The decoder is the random-reward surface. It must know nothing about
    // mastery gloves, so a glove can never be rolled.
    const decode = read('src/ui/SignalDecodeModal.ts');
    expect(decode).not.toMatch(/masteryGloveSystem|MASTERY_GLOVES|GLOVE_TREATMENTS/);
    for (const glove of MASTERY_GLOVES) {
      expect(decode, glove.id).not.toContain(glove.id);
    }
  });

  it('the drop-opener cannot reference mastery', () => {
    const skinSystem = read('src/viewmodel/KarambitSkinSystem.ts');
    const dropFn = skinSystem.slice(
      skinSystem.indexOf('public openSignalDrop('),
      skinSystem.indexOf('public getSkinProgress(')
    );
    expect(dropFn).not.toMatch(/masteryGloveSystem|MASTERY_GLOVES|GLOVE_TREATMENTS/);
  });

  it('reward bags are validated against drop-eligible skin ids only', () => {
    const src = read('src/viewmodel/KarambitSkinSystem.ts');
    expect(src).toMatch(/const rewardIds = new Set\(KARAMBIT_SKINS\.filter\(skin => skin\.dropEligible\)/);
  });

  it('custom audio and the Movement Lab cannot satisfy mastery', () => {
    const game = read('src/core/Game.ts');
    const anchor = game.indexOf('const masteryBefore = masteryGloveSystem.evaluate()');
    expect(anchor).toBeGreaterThan(-1);
    // Mastery is evaluated INSIDE the official-track branch, so a run that is not
    // an official catalog track never contributes to mastery.
    const preceding = game.slice(Math.max(0, anchor - 1200), anchor);
    expect(preceding).toMatch(/if \(this\.currentOfficialTrackId\)/);

    // And the non-official entry points clear the official id outright.
    for (const marker of [
      'private async handleFileSelected',
      'private async enterMovementLab',
      'private async handleDevTrackSelected'
    ]) {
      const idx = game.indexOf(marker);
      expect(idx).toBeGreaterThan(-1);
      const block = game.slice(idx, idx + 500);
      expect(block, marker).toMatch(/this\.currentOfficialTrackId = null/);
    }
  });

  it('all 14 official tracks are accounted for from the canonical catalog', () => {
    const systemSrc = read('src/mastery/MasteryGloveSystem.ts');
    expect(systemSrc).toMatch(/SignalPackCatalog\.getTracks\(\)\.map\(\(t\) => t\.id\)/);
    // No hardcoded track id anywhere in the mastery system.
    expect(systemSrc).not.toMatch(/track_1[0-4]_|track_[1-9]_/);
  });

  it('old-map progress follows the existing canonical policy, not a new ledger', () => {
    // Mastery derives from the SAME authoritative records the existing canonical
    // progress policy already governs; it adds no second source of truth.
    const systemSrc = read('src/mastery/MasteryGloveSystem.ts');
    expect(systemSrc).toMatch(/KarambitSkinSystem\.getInstance\(\)\.getTrackRecords\(\)/);
    expect(systemSrc).not.toMatch(/localStorage\.setItem\([^)]*unlock/i);
  });
});

// ---------------------------------------------------------------------------
// 7. Visual treatments
// ---------------------------------------------------------------------------

describe('Mastery glove treatments', () => {
  it('defines a treatment for every glove', () => {
    for (const glove of MASTERY_GLOVES) {
      expect(GLOVE_TREATMENTS[glove.id], glove.id).toBeTruthy();
    }
  });

  it('increases prestige monotonically without becoming a lamp', () => {
    const ordered = MASTERY_GLOVES.map((g) => GLOVE_TREATMENTS[g.id]);
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i].metalness).toBeGreaterThanOrEqual(ordered[i - 1].metalness);
      expect(ordered[i].roughness).toBeLessThanOrEqual(ordered[i - 1].roughness);
    }
    // The top tier is a rare MATERIAL, not the brightest object on screen.
    expect(ordered[ordered.length - 1].metalness).toBeGreaterThan(0.6);
    expect(ordered[ordered.length - 1].roughness).toBeLessThan(0.2);
  });

  it('can never reach the bloom threshold, even at full pulse and HIGH effect', () => {
    // The recent visual calibration puts the bloom threshold at 0.88.
    expect(maxGloveEmissiveIntensity(1.3)).toBeLessThan(0.5);
  });

  it('applies to real materials as parameters only', () => {
    const materials = [
      new THREE.MeshStandardMaterial(),
      new THREE.MeshStandardMaterial()
    ];
    applyGloveTreatment(materials, GLOVE_TREATMENTS.GOLDLINE, 0, 1);
    for (const mat of materials) {
      expect(mat.metalness).toBeCloseTo(GLOVE_TREATMENTS.GOLDLINE.metalness, 6);
      expect(mat.roughness).toBeCloseTo(GLOVE_TREATMENTS.GOLDLINE.roughness, 6);
      expect(mat.color.getHex()).toBe(GLOVE_TREATMENTS.GOLDLINE.tint);
      expect(mat.emissive.getHex()).toBe(GLOVE_TREATMENTS.GOLDLINE.emissive);
    }
  });

  it('a musical pulse lifts emissive but stays capped', () => {
    const mat = new THREE.MeshStandardMaterial();
    applyGloveTreatment([mat], GLOVE_TREATMENTS.SIGNAL_MASTER, 0, 1);
    const resting = mat.emissiveIntensity;
    applyGloveTreatment([mat], GLOVE_TREATMENTS.SIGNAL_MASTER, 0.32, 1);
    const pulsed = mat.emissiveIntensity;
    expect(pulsed).toBeGreaterThan(resting);
    expect(pulsed).toBeLessThan(0.5);
  });

  it('effect intensity scales presentation only, never the treatment identity', () => {
    const low = new THREE.MeshStandardMaterial();
    const high = new THREE.MeshStandardMaterial();
    applyGloveTreatment([low], GLOVE_TREATMENTS.DIAMOND_HAND, 0, 0.55);
    applyGloveTreatment([high], GLOVE_TREATMENTS.DIAMOND_HAND, 0, 1.3);
    expect(high.emissiveIntensity).toBeGreaterThan(low.emissiveIntensity);
    // Material identity is identical regardless of tier.
    expect(low.metalness).toBe(high.metalness);
    expect(low.roughness).toBe(high.roughness);
    expect(low.color.getHex()).toBe(high.color.getHex());
  });

  it('unknown glove ids fall back to the standard-issue treatment', () => {
    expect(getGloveTreatment('NOPE')).toEqual(GLOVE_TREATMENTS.STANDARD_ISSUE);
    expect(getGloveTreatment('')).toEqual(GLOVE_TREATMENTS.STANDARD_ISSUE);
  });

  it('introduces no new textures, geometry or draw calls', () => {
    const src = read('src/viewmodel/GloveTreatments.ts');
    expect(src).not.toMatch(/TextureLoader|GLTFLoader|VideoTexture|new THREE\.Mesh|new THREE\.Geometry/);
    // And no new shipped asset paths.
    expect(src).not.toMatch(/\/assets\//);
  });

  it('the rig exposes a glove applier that touches arm materials only', () => {
    const rig = ViewmodelAssetLoader.buildFallbackRig(new THREE.Color(0x00f0ff));
    expect(typeof rig.applyGlove).toBe('function');
    expect(rig.armMaterials.length).toBeGreaterThan(0);

    // A glove change must not move the frozen knife socket.
    const before = rig.knifeGroup.position.clone();

    rig.applyGlove('GOLDLINE', 1);
    const mat = rig.armMaterials[0];
    expect(mat.metalness).toBeCloseTo(GLOVE_TREATMENTS.GOLDLINE.metalness, 6);
    expect(rig.knifeGroup.position.x).toBe(before.x);
    expect(rig.knifeGroup.position.y).toBe(before.y);
    expect(rig.knifeGroup.position.z).toBe(before.z);

    rig.dispose();
  });

  it('never writes the frozen knife calibration', () => {
    const loader = read('src/viewmodel/ViewmodelAssetLoader.ts');
    expect(loader).toMatch(/knifeGroup\.position\.set\(0\.0093, 0\.1107, 0\.0033\)/);
    // Glove application only ever writes arm materials.
    const gloveFn = loader.slice(
      loader.indexOf('const applyGlove = ('),
      loader.indexOf('const applyGlove = (') + 400
    );
    expect(gloveFn).not.toMatch(/knifeGroup|knifeScene|cosmicMaterial/);
  });
});

// ---------------------------------------------------------------------------
// 8. Presentation cannot touch gameplay or identity
// ---------------------------------------------------------------------------

describe('Mastery — gameplay isolation', () => {
  it('no mastery module imports physics, movement, generation or map identity', () => {
    for (const file of [
      'src/mastery/MasteryLadder.ts',
      'src/mastery/MasteryGloveSystem.ts',
      'src/viewmodel/GloveTreatments.ts'
    ]) {
      const src = read(file);
      const imports = src.match(/^import[\s\S]*?from\s+'[^']+';/gm) ?? [];
      for (const line of imports) {
        expect(line, `${file}: ${line}`).not.toMatch(/physics|player\/PlayerController|generation\/|MapIdentity|LeaderboardService/);
      }
      expect(src, file).not.toMatch(/PLAYHEAD_MOVEMENT_V1|Collider|Raycaster|PhysicsWorld/);
    }
  });

  it('quality and effect settings cannot alter eligibility', () => {
    // Eligibility reads only the catalog and authoritative rank records.
    const src = read('src/mastery/MasteryGloveSystem.ts');
    expect(src).not.toMatch(/qualityTier|resolvedTier|effectProfile|effectIntensity|graphics/);
    const ladder = read('src/mastery/MasteryLadder.ts');
    expect(ladder).not.toMatch(/quality|effect|bloom|renderScale/i);
  });

  it('the armory UI exposes mastery through the system, never hardcoded state', () => {
    for (const file of ['src/ui/ImportScreen.ts', 'src/ui/ArmoryModal.ts']) {
      const src = read(file);
      expect(src, file).toMatch(/masteryGloveSystem/);
      expect(src, file).not.toMatch(/track_1[0-4]_|track_[1-9]_/);
    }
  });
});
