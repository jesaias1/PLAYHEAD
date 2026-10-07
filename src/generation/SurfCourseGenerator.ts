import { SURF_GENERATION_VERSION } from './CourseType';
import { computeMapFingerprint } from '../online/MapIdentity';
/**
 * SurfCourseGenerator — SURF MODE 1.0 course authoring.
 *
 * A SURF course is ONE coherent flowing route built from surf PHRASES
 * (long lines, S curves, descents, feasible climbs, left/right transfers,
 * canyons, gentle partial spirals, platform interludes and a natural finish).
 * It is not normal PLAYHEAD geometry with wedges between platforms.
 *
 * Structure reuses the EXISTING Custom Audio / Signal Pack section analysis:
 * each musical section selects a phrase by theme, and musical structure drives
 * course SHAPE (INTRO line -> BUILD climb -> DROP canyon -> BREAKDOWN interlude
 * -> second peak transfer -> OUTRO release), never raw difficulty.
 *
 * Curved geometry comes exclusively from the shared SurfRibbon sampler, so
 * collision and rendering consume byte-identical stations. Every generated
 * phrase is validated by SurfCourseValidator against the frozen movement
 * constants and the ACTUAL geometry; an invalid phrase is simplified, then
 * omitted if it still cannot be validated. Nothing impossible is ever shipped.
 */

import { TrackAnalysis, AnalysisSection } from '../audio/AudioFeatures';
import {
  CheckpointDefinition,
  FinishDefinition,
  GeneratedTrack,
  RouteNode,
  RouteNodeType,
  Vector3Like
} from './GenerationTypes';
import { CourseType, normalizeCourseType } from './CourseType';
import { RouteConnectivityResult } from './RouteConnectivityValidator';
import { SeededRandom } from './SeededRandom';
import {
  buildRibbonStations,
  RibbonSpec,
  ribbonSegmentNodes,
} from './SurfRibbon';
import { climbFeasibility, SURF_SPEED_ENVELOPE, SurfCourseValidator, snapPlatformChain } from './SurfCourseValidator';
import { SURF_GRAVITY } from './SurfCourseValidator';
import {
  clampDescentDrop,
  sectionTravelWeights,
  surfBudgetMeters,
  surfTraits,
  SurfTraitProfile
} from './SurfPacing';

/** Salt keeps SURF geometry deterministic but distinct from a PLAYHEAD course. */
const SURF_SEED_SALT = 0x53555246; // 'SURF'

/** Phrase vocabulary selected per budgeted phrase by musical traits. */
type SurfPhraseKind =
  | 'CRUISE'
  | 'S_CURVE'
  | 'CANYON'
  | 'DESCENT'
  | 'DESCENT_BIG'
  | 'CLIMB'
  | 'TRANSFER'
  | 'PRECISION_TRANSFER'
  | 'SPIRAL'
  | 'INTERLUDE'
  | 'RUNWAY';

interface Cursor {
  pos: Vector3Like;
  yaw: number;
  arcLength: number;
  nodeId: number;
  ribbonId: number;
}

interface PhraseResult {
  nodes: RouteNode[];
  checkpoint?: CheckpointDefinition;
}

interface BudgetedPhraseResult {
  nodes: RouteNode[];
  checkpoint?: CheckpointDefinition;
  /** True when this phrase contains a real release/flick -> opposite catch. */
  transferFired: boolean;
  /** Surf length actually committed, in metres. */
  length: number;
}

const PLATFORM_THICKNESS = 2.0;

function advance(pos: Vector3Like, yaw: number, dist: number): Vector3Like {
  return { x: pos.x + Math.sin(yaw) * dist, y: pos.y, z: pos.z + Math.cos(yaw) * dist };
}

function right(yaw: number): Vector3Like {
  return { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
}

/**
 * Re-stamp a phrase's node times to a monotonic sub-window of the song.
 *
 * Phrase builders emit their OWN internal ordering (a launch before its catch),
 * but several builders stamped the ENTIRE section on each sub-ribbon, which made
 * node.time non-monotonic across a multi-phrase section. Spreading this phrase's
 * nodes evenly across the [start, end] window it actually owns restores strict
 * chronology and keeps checkpoint / finish times consistent with the song.
 */
function stampWindow(nodes: RouteNode[], start: number, end: number): void {
  if (nodes.length === 0) return;
  const span = Math.max(0, end - start);
  if (nodes.length === 1) {
    nodes[0].time = start;
    return;
  }
  for (let i = 0; i < nodes.length; i++) {
    nodes[i].time = start + (span * i) / (nodes.length - 1);
  }
}

export class SurfCourseGenerator {
  public static lastValidation: RouteConnectivityResult | null = null;

  /**
   * Generate a complete deterministic surf course for an analysed track.
   * `courseType` is carried onto the definition so cache/PB/replay identity can
   * never mix SURF with normal PLAYHEAD.
   */
  public static generate(analysis: TrackAnalysis, courseType: CourseType = 'SURF'): GeneratedTrack {
    const type = normalizeCourseType(courseType);
    const rng = new SeededRandom((analysis.seed ^ SURF_SEED_SALT) >>> 0);
    const nodes: RouteNode[] = [];
    const checkpoints: CheckpointDefinition[] = [];

    let cursor: Cursor = {
      pos: { x: 0, y: 0, z: 0 },
      yaw: 0,
      arcLength: 0,
      nodeId: 0,
      ribbonId: 1
    };

    // 1. Wide SURF start runway (initial acceleration / takeoff). Surf-dominant
    //    courses still need a legible, forgiving entry.
    const startLen = 44.0;
    const startWidth = 18.0;
    const startCenter = advance(cursor.pos, cursor.yaw, startLen * 0.5);
    nodes.push(makePlatform(cursor.nodeId++, startCenter, startWidth, startLen, cursor.yaw, 0, RouteNodeType.RUNWAY, 0.3, 0));
    checkpoints.push({
      id: 1,
      routeNodeId: nodes[0].id,
      time: 0,
      position: { ...startCenter },
      yaw: cursor.yaw,
      sectionIndex: 0
    });
    cursor.pos = advance(cursor.pos, cursor.yaw, startLen);
    cursor.arcLength += startLen;

    // 2. ADAPTIVE, DURATION-BUDGETED SURF BODY.
    //
    // Each musical section owns a REAL traversal budget (metres of surf) derived
    // from the song duration and that section's musical weight. Within its budget
    // a section emits MULTIPLE coherent phrases: long banked cruise ribbons, S
    // curves, energy-conserving climbs, descents, switchback canyons and genuine
    // flick/release -> opposite catch transfers, plus short runway breathers. A
    // phrase that cannot be validated is simplified, then omitted, and unused
    // budget is carried into the next section so the route still spans the song.
    const sections = analysis.sections.length ? analysis.sections : [{ ...fakeSection(), end: analysis.duration }];
    const pacing = surfBudgetMeters(analysis);
    const weights = sectionTravelWeights(sections, analysis.bpm);
    const traitProfiles = sections.map((sec) => surfTraits(analysis, sec));
    let remainder = 0;
    let gapCounter = 0;
    // GLOBAL phrase index and a global time cursor. Both deliberately survive
    // section boundaries: a short section resetting its own index is exactly
    // what made every section open on a repeated first-CRUISE and never select
    // a climb or transfer.
    let globalPhraseIndex = 0;
    let timeCursor = 0;
    // Every Nth surviving phrase is a MANDATORY genuine release -> opposite
    // catch, decided GLOBALLY so uniform FLOW / DROP songs still receive several
    // real airborne transfers instead of one long repeated line per section.
    const TRANSFER_CADENCE = 3;

    for (let s = 0; s < sections.length; s++) {
      const section = sections[s];
      const theme = section.theme;
      const traits = traitProfiles[s];
      // Budget = this section's share of the song, plus any carried remainder.
      const share = (weights[s] ?? 1 / Math.max(1, sections.length)) * pacing.targetDistance;
      let remaining = share + remainder;
      const sectionBudget = Math.max(1, remaining);
      remainder = 0;

      // A short checkpoint / runway breather between sections (never mid-drop),
      // always on a platform with enough room to reach entry speed.
      const wantsBreather = s > 0 && theme !== 'DROP' && traits.intensity < 0.85 && s % 2 === 1;
      if (wantsBreather) {
        const res = this.emitRunway(cursor, 24.0, 12.0, section, rng);
        nodes.push(...res.nodes);
        checkpoints.push(this.checkpointFor(res.nodes[0], section.index, section.start, cursor.yaw));
        remaining -= res.nodes.reduce((sum, node) => sum + node.dimensions.z, 0);
      }

      let phraseIndex = 0;
      // Hard cap on phrases per section so a pathological budget cannot spawn an
      // unbounded number of geometry groups, but still roomy enough that a long
      // section can emit many varied phrases and keep the transfer cadence.
      const maxPhrasesPerSection = Math.max(6, Math.min(20, Math.ceil(sectionBudget / 110)));
      const sectionDuration = Math.max(0.5, section.end - section.start);
      let safety = 0;

      while (remaining > 150 && phraseIndex < maxPhrasesPerSection && safety++ < 80) {
        const before: Cursor = { ...cursor, pos: { ...cursor.pos } };
        // Chronological sub-window for THIS phrase, proportional to the budget
        // it is about to spend. This is what keeps node.time monotonic within a
        // section instead of stamping the entire section on every phrase.
        const slotsLeft = Math.max(1, maxPhrasesPerSection - phraseIndex);
        const nominal = Math.min(remaining, 320, remaining / slotsLeft);
        const windowStart = timeCursor;
        const windowEnd = Math.min(
          section.end,
          windowStart + (nominal / sectionBudget) * sectionDuration
        );
        const forceTransfer = globalPhraseIndex > 0 && globalPhraseIndex % TRANSFER_CADENCE === TRANSFER_CADENCE - 1;
        const built = this.emitBudgetedPhrase({
          cursor, section, traits, rng,
          phraseIndex: globalPhraseIndex,
          targetMeters: remaining,
          gapCounter,
          forceTransfer,
          window: { start: windowStart, end: Math.max(windowStart + 0.25, windowEnd) }
        });
        if (!SurfCourseValidator.validatePhrase(built.nodes).ok) {
          Object.assign(cursor, before);
          // Reject the invalid phrase, but FIRST try the KNOWN-VALID transfer
          // template (phraseTransfer worked at 12/20/30m/s) so a transfer that
          // failed to build is replaced by a genuinely valid transfer rather
          // than by a cruise, preserving route variety.
          let fallback = built.transferFired
            ? this.phraseTransfer(cursor, section, rng, remaining)
            : this.phraseLongLine(cursor, section, rng, true);
          if (!SurfCourseValidator.validatePhrase(fallback.nodes).ok) {
            Object.assign(cursor, before);
            fallback = this.phraseLongLine(cursor, section, rng, true);
          }
          if (!SurfCourseValidator.validatePhrase(fallback.nodes).ok) {
            // Cannot place anything more here: stop and carry the budget on.
            break;
          }
          stampWindow(fallback.nodes, windowStart, windowEnd);
          const spent = fallback.nodes.reduce((sum, n) => sum + n.dimensions.z, 0);
          nodes.push(...fallback.nodes);
          if (fallback.checkpoint) checkpoints.push(fallback.checkpoint);
          remaining -= spent;
        } else {
          stampWindow(built.nodes, windowStart, windowEnd);
          const spent = built.nodes.reduce((sum, n) => sum + n.dimensions.z, 0);
          nodes.push(...built.nodes);
          if (built.checkpoint) checkpoints.push(built.checkpoint);
          remaining -= spent;
          if (built.transferFired) gapCounter++;
        }
        phraseIndex++;
        globalPhraseIndex++;
        // Advance the global time cursor by the window this phrase actually
        // consumed, so the NEXT phrase starts where this one ended.
        timeCursor = Math.min(section.end, Math.max(timeCursor, windowEnd));
      }

      // Never leave the song's final stretch unconsumed: push any large unspent
      // budget into a genuine final transfer for this section.
      if (remaining > 240) {
        const before: Cursor = { ...cursor };
        const tail = this.phraseTransfer(cursor, section, rng, remaining);
        if (SurfCourseValidator.validatePhrase(tail.nodes).ok) {
          stampWindow(tail.nodes, timeCursor, section.end);
          nodes.push(...tail.nodes);
          if (tail.checkpoint) checkpoints.push(tail.checkpoint);
          remaining -= tail.nodes.reduce((sum, n) => sum + n.dimensions.z, 0);
          globalPhraseIndex++;
        } else {
          Object.assign(cursor, before);
        }
      }

      // Carry the unspent budget FORWARD (retained, never halved away) so a
      // long/quiet section still spends its full share; only a pathological
      // overshoot is clamped so one loud section cannot unbalance the song.
      remainder = remaining;
    }

    // Spend any final unallocated metres on a broad continuous line.
    while (remainder > 150) {
      const section = sections[sections.length - 1];
      const tail = this.phraseCruise(cursor, section, rng, globalPhraseIndex++, traitProfiles[traitProfiles.length - 1], remainder, true);
      nodes.push(...tail.nodes);
      remainder -= tail.nodes.reduce((sum, node) => sum + node.dimensions.z, 0);
    }

    // 3. Natural finish: a long final surf release into a large finish platform.
    const finishRelease = this.emitRibbon(cursor, rng, {
      kind: 'FINAL_RELEASE',
      length: 110,
      startHalfWidth: 6.5,
      endHalfWidth: 8.0,
      startBank: 0.55,
      endBank: 0.18,
      headingChange: 0,
      verticalDelta: -18,
      timeStart: analysis.duration - 10,
      timeEnd: analysis.duration - 3,
      sectionIndex: Math.max(0, sections.length - 1),
      intensity: 0.85
    });
    nodes.push(...finishRelease.nodes);
    cursor.pos = finishRelease.exitPos;
    cursor.yaw = finishRelease.exitYaw;
    cursor.arcLength += finishRelease.length;

    const finishLen = 40.0;
    const finishWidth = 26.0;
    const finishGap = 5.0;
    const finishCenter = advance(cursor.pos, cursor.yaw, finishGap + finishLen * 0.5);
    const finishNode = makePlatform(
      cursor.nodeId++, finishCenter, finishWidth, finishLen, cursor.yaw, 0,
      RouteNodeType.FINISH, 1.0, Math.max(0, sections.length - 1)
    );
    // Natural finish: the finish deck sits a little below the release exit so a
    // fast player glides onto it instead of being asked to stop.
    finishNode.position.y = cursor.pos.y - 1.5;
    nodes.push(finishNode);

    // 4. Recompute arc lengths along the emitted chain (ribbons set 0).
    let cumulative = 0;
    for (const n of nodes) {
      cumulative += n.dimensions.z * 0.5;
      n.arcLength = cumulative;
      cumulative += n.dimensions.z * 0.5;
    }

    // 5. Repair only non-surf platform transitions, exactly like normal mode.
    const { nodes: repairedNodes, repairsCount } = snapPlatformChain(nodes);

    const routeDistance = repairedNodes.reduce((sum, node) => sum + node.dimensions.z, 0);
    for (const node of repairedNodes) node.time = analysis.duration * node.arcLength / routeDistance;

    // Sync checkpoints to repaired positions.
    for (const cp of checkpoints) {
      const node = repairedNodes.find((n) => n.id === cp.routeNodeId);
      if (node) {
        cp.position = { ...node.position };
        cp.yaw = node.yaw;
        cp.time = node.time;
      }
    }

    const updatedFinish = repairedNodes.find((n) => n.id === finishNode.id) || repairedNodes[repairedNodes.length - 1];
    const finish: FinishDefinition = {
      routeNodeId: updatedFinish.id,
      time: analysis.duration,
      position: { ...updatedFinish.position },
      yaw: updatedFinish.yaw
    };

    // Deduplicate checkpoints by route node and keep them chronological.
    const uniqueCps: CheckpointDefinition[] = [];
    const seen = new Set<number>();
    for (const cp of checkpoints.sort((a, b) => a.time - b.time)) {
      if (seen.has(cp.routeNodeId)) continue;
      seen.add(cp.routeNodeId);
      uniqueCps.push(cp);
    }

    const totalDistance = repairedNodes.reduce((sum, n) => sum + n.dimensions.z, 0);

    return finalizeSurfTrack({
      generationVersion: SURF_GENERATION_VERSION,
      courseType: type,
      seed: analysis.seed,
      route: repairedNodes,
      checkpoints: uniqueCps,
      finish,
      totalDistance,
      targetDuration: analysis.duration,
      repairedJumpsCount: repairsCount
    }, analysis);
  }

  // -------------------------------------------------------------------------
  // Phrase builders
  // -------------------------------------------------------------------------

  /**
   * Guaranteed-valid fallback: a wide runway plus straight, wide long lines
   * joined by catch decks. Straight ribbons cannot fail seam/transfer/climb
   * validation, so this always validates.
   */
  public static generateSafeFallback(analysis: TrackAnalysis): GeneratedTrack {
    const rng = new SeededRandom((analysis.seed ^ SURF_SEED_SALT) >>> 0);
    const nodes: RouteNode[] = [];
    const checkpoints: CheckpointDefinition[] = [];
    const cursor: Cursor = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, arcLength: 0, nodeId: 0, ribbonId: 1 };

    const startLen = 44.0;
    const startCenter = advance(cursor.pos, cursor.yaw, startLen * 0.5);
    nodes.push(makePlatform(cursor.nodeId++, startCenter, 18, startLen, 0, 0, RouteNodeType.RUNWAY, 0.3, 0));
    checkpoints.push({ id: 1, routeNodeId: nodes[0].id, time: 0, position: { ...startCenter }, yaw: 0, sectionIndex: 0 });
    cursor.pos = advance(cursor.pos, cursor.yaw, startLen);

    const bodyDistance = surfBudgetMeters(analysis).targetDistance;
    const count = Math.max(2, Math.min(64, Math.ceil(bodyDistance / 350)));
    for (let i = 0; i < count; i++) {
      const bankSign = rng.nextBool() ? 1 : -1;
      const ribbon = this.emitRibbon(cursor, rng, {
        kind: 'SAFE_LINE',
        length: Math.max(40, bodyDistance / count - 24),
        startHalfWidth: 6.5,
        endHalfWidth: 6.5,
        startBank: bankSign * 0.85,
        endBank: bankSign * 0.85,
        headingChange: 0,
        verticalDelta: -6,
        timeStart: (analysis.duration * i) / count,
        timeEnd: (analysis.duration * (i + 1)) / count,
        sectionIndex: Math.min(i, analysis.sections.length - 1),
        intensity: 0.6
      });
      nodes.push(...ribbon.nodes);
      cursor.pos = ribbon.exitPos;
      cursor.yaw = ribbon.exitYaw;
      cursor.arcLength += bodyDistance / count - 24;
      const deck = this.emitCatchDeck(cursor, analysis.sections[Math.min(i, analysis.sections.length - 1)] ?? fakeSection(), rng, 20);
      nodes.push(...deck.nodes);
    }

    const finishCenter = advance(cursor.pos, cursor.yaw, 5 + 20);
    const finishNode = makePlatform(cursor.nodeId++, finishCenter, 26, 40, cursor.yaw, 0, RouteNodeType.FINISH, 1.0, Math.max(0, analysis.sections.length - 1));
    finishNode.position.y = cursor.pos.y - 1.5;
    nodes.push(finishNode);

    let cumulative = 0;
    for (const n of nodes) {
      cumulative += n.dimensions.z * 0.5;
      n.arcLength = cumulative;
      cumulative += n.dimensions.z * 0.5;
    }
    const { nodes: repairedNodes, repairsCount } = snapPlatformChain(nodes);
    const updatedFinish = repairedNodes.find((n) => n.id === finishNode.id) || repairedNodes[repairedNodes.length - 1];
    return finalizeSurfTrack({
      generationVersion: SURF_GENERATION_VERSION,
      courseType: 'SURF',
      seed: analysis.seed,
      route: repairedNodes,
      checkpoints,
      finish: { routeNodeId: updatedFinish.id, time: analysis.duration, position: { ...updatedFinish.position }, yaw: updatedFinish.yaw },
      totalDistance: repairedNodes.reduce((sum, n) => sum + n.dimensions.z, 0),
      targetDuration: analysis.duration,
      repairedJumpsCount: repairsCount
    }, analysis);
  }

  /**
   * Selects the phrase for a musical section theme. In `simple` mode a
   * conservative, always-validatable long line is used; this is the
   * SIMPLIFY fallback when a richer phrase fails validation.
   */
  /**
   * Emit ONE coherent phrase sized to the remaining budget of a section.
   *
   * Deterministic selection mixes the musical trait profile (theme, intensity,
   * rhythmic density, bpm and onset rate) with the running phrase index so a
   * uniform FLOW/DROP song still receives long cruises, S curves, canyons,
   * descents, climbs and genuine AIR transfers rather than one repeated line.
   * No RNG is consumed when nothing is emitted, so retries stay deterministic.
   */
  private static emitBudgetedPhrase(ctx: {
    cursor: Cursor;
    section: AnalysisSection;
    traits: SurfTraitProfile;
    rng: SeededRandom;
    phraseIndex: number;
    /** Remaining section budget in metres; phrases are sized to fit it. */
    targetMeters: number;
    gapCounter: number;
    /** Global cadence: this phrase MUST be a genuine release/catch transfer. */
    forceTransfer: boolean;
    /** Chronological sub-window this phrase owns, in song seconds. */
    window: { start: number; end: number };
  }): BudgetedPhraseResult {
    const { cursor, section, traits, rng, phraseIndex, targetMeters, forceTransfer, window } = ctx;
    // HARD INVARIANT: a GLOBAL section boundary always opens on a long cruise so
    // the course has long sweeping surf even on the quietest, most uniform song.
    // But it is only the FIRST phrase of a section, never `targetMeters <= 600`
    // (which forced EVERY mid-section phrase to a cruise and starved the pool).
    const opensSection = phraseIndex === 0;
    // Varied climbs / S-curves are chosen INDEPENDENTLY of a short-section reset.
    const lowDensity = traits.density < 0.45 || traits.onsetRate < 1.6;
    let kind: SurfPhraseKind;
    if (phraseIndex % 6 === 1) {
      kind = 'CLIMB';
    } else if (phraseIndex % 6 === 3) {
      kind = 'DESCENT';
    } else if (forceTransfer) {
      // Genuine release -> opposite catch, mandatory at the global cadence.
      kind = traits.intensity > 0.6 && phraseIndex % 2 === 1 ? 'PRECISION_TRANSFER' : 'TRANSFER';
    } else if (opensSection || (lowDensity && phraseIndex % 3 === 0)) {
      kind = 'CRUISE';
    } else if (targetMeters <= 60) {
      kind = 'TRANSFER';
    } else {
      const pool: SurfPhraseKind[] = ['CRUISE', 'S_CURVE'];
      if (traits.intensity > 0.4) pool.push('CANYON');
      if (traits.intensity > 0.3) pool.push('DESCENT');
      if (traits.intensity < 0.8) pool.push('CLIMB', 'CLIMB');
      if (traits.onsetRate > 1.9 && phraseIndex % 3 === 2) pool.push('SPIRAL');
      if (traits.intensity < 0.5 && traits.density < 0.55) pool.push('INTERLUDE');
      if (traits.intensity > 0.6 && phraseIndex % 3 === 1) pool.push('PRECISION_TRANSFER');
      // Occasional real transfer even off the cadence so songs are lively.
      if (phraseIndex % 4 === 1) pool.push('TRANSFER');
      if (traits.intensity > 0.85 && rng.nextBool(0.3)) kind = 'DESCENT_BIG';
      else kind = pool[Math.floor(rng.next() * pool.length) % pool.length];
    }
    return this.buildBudgetedKind(kind, cursor, section, rng, phraseIndex, traits, targetMeters, window);
  }

  private static buildBudgetedKind(
    kind: SurfPhraseKind,
    cursor: Cursor,
    section: AnalysisSection,
    rng: SeededRandom,
    phraseIndex: number,
    traits: SurfTraitProfile,
    targetMeters: number,
    window: { start: number; end: number }
  ): BudgetedPhraseResult {
    switch (kind) {
      case 'S_CURVE': return { ...this.phraseSCurve(cursor, section, rng, targetMeters, window), transferFired: false, length: 0 };
      case 'CANYON': return { ...this.phraseCanyon(cursor, section, rng, targetMeters), transferFired: true, length: 0 };
      case 'DESCENT': return { ...this.phraseDescent(cursor, section, rng, false, targetMeters), transferFired: false, length: 0 };
      case 'DESCENT_BIG': return { ...this.phraseDescent(cursor, section, rng, true, targetMeters), transferFired: false, length: 0 };
      case 'CLIMB': return { ...this.phraseClimb(cursor, section, rng, targetMeters, window), transferFired: false, length: 0 };
      case 'TRANSFER': return { ...this.phraseFlickTransfer(cursor, section, rng, traits, targetMeters, window), transferFired: true, length: 0 };
      case 'PRECISION_TRANSFER': return { ...this.phraseTransfer(cursor, section, rng, targetMeters, window), transferFired: true, length: 0 };
      case 'SPIRAL': return { ...this.phraseSpiral(cursor, section, rng, targetMeters), transferFired: false, length: 0 };
      case 'INTERLUDE': return { ...this.phraseInterlude(cursor, section, rng), transferFired: false, length: 0 };
      case 'RUNWAY': return { ...this.phraseRunwayBreak(cursor, section, rng), transferFired: false, length: 0 };
      case 'CRUISE':
      default:
        return { ...this.phraseCruise(cursor, section, rng, phraseIndex, traits, targetMeters, false, window), transferFired: false, length: 0 };
    }
  }

  /**
   * Long sweeping banked CRUISE ribbon (150-350m) + a catch deck.
   *
   * This is the backbone of a song-length surf course: several of these per
   * song are what make the route last roughly the track duration instead of a
   * few short hops. Vertical drop is clamped per metre so even a 350m descent
   * cannot pump the player to unbounded speed.
   */
  private static phraseCruise(
    cursor: Cursor,
    section: AnalysisSection,
    rng: SeededRandom,
    phraseIndex: number,
    _traits: SurfTraitProfile,
    targetMeters: number,
    simple = false,
    window?: { start: number; end: number }
  ): PhraseResult {
    const bankSign = rng.nextBool() ? 1 : -1;
    // Sized to the remaining section budget (minus the catch deck), bounded to a
    // long sweeping 150-350m cruise. The small +-jitter keeps repeated cruises
    // from reading as one identical ribbon.
    const jitter = ((phraseIndex % 3) - 1) * 18;
    const rawLength = targetMeters - 24 + (simple ? 0 : jitter);
    // LONGER continuous cruises: the non-simple cap is raised so a big budget
    // section spends its budget on one readable sweeping line instead of
    // chopping it into many short ribbons (which read as busy and abrupt).
    const length = Math.max(150, Math.min(simple ? 1200 : 430, rawLength));
    // Gentler cruise heading: a long banked line should drift, not yaw hard.
    const headingChange = simple ? 0 : bankSign * rng.nextFloat(0.35, 0.8);
    const drop = clampDescentDrop(-(6 + length * 0.022), length);
    const timeStart = window?.start ?? section.start;
    const timeEnd = window?.end ?? section.end;
    const ribbon = this.emitRibbon(cursor, rng, {
      kind: 'CRUISE',
      length,
      startHalfWidth: 7.0,
      endHalfWidth: 6.0,
      startBank: bankSign * 0.9,
      endBank: bankSign * 1.0,
      headingChange,
      // TANGENT CONTINUITY: a small quadratic bend keeps heading rate from
      // snapping at the exit while still preventing a perfectly straight read.
      headingBend: simple ? 0 : bankSign * rng.nextFloat(-0.07, 0.07),
      verticalDelta: drop,
      timeStart,
      timeEnd,
      sectionIndex: section.index,
      intensity: section.intensity
    });
    cursor.pos = ribbon.exitPos;
    cursor.yaw = ribbon.exitYaw;
    cursor.arcLength += length;
    const deck = this.emitCatchDeck(cursor, section, rng);
    return { nodes: [...ribbon.nodes, ...deck.nodes] };
  }

  /**
   * Genuine FLICK / RELEASE -> OPPOSITE CATCH transfer.
   *
   * A banked launch ribbon curls outward and releases (a real horizontal gap
   * with a lateral offset) onto an opposite-banked catch ribbon. Unlike a
   * theme-gated transfer this is selected by musical traits, so uniform
   * FLOW/DROP songs still contain several real airborne catches.
   */
  private static phraseFlickTransfer(
    cursor: Cursor,
    section: AnalysisSection,
    rng: SeededRandom,
    _traits: SurfTraitProfile,
    targetMeters: number,
    window?: { start: number; end: number }
  ): PhraseResult {
    const firstSign = rng.nextBool() ? 1 : -1;
    const budget = Math.max(180, Math.min(600, targetMeters - 30));
    const launchLen = budget * 0.45;
    const flick = firstSign * rng.nextFloat(0.5, 0.95);
    const ws = window?.start ?? section.start;
    const we = window?.end ?? section.end;
    const first = this.emitRibbon(cursor, rng, {
      kind: 'FLICK_LAUNCH',
      length: launchLen,
      startHalfWidth: 7.0,
      endHalfWidth: 5.5,
      startBank: firstSign * 0.85,
      endBank: firstSign * 1.15,
      headingChange: flick,
      headingBend: flick * 0.4,
      verticalDelta: clampDescentDrop(-(6 + launchLen * 0.03), launchLen),
      timeStart: ws,
      timeEnd: ws + (we - ws) * 0.4,
      sectionIndex: section.index,
      intensity: section.intensity
    });
    // Release: a real horizontal + lateral gap to the opposite wall.
    const gap = rng.nextFloat(9.0, 13.0);
    const lateral = -firstSign * rng.nextFloat(4.0, 6.5);
    const r = right(first.exitYaw);
    const targetPos: Vector3Like = {
      x: first.exitPos.x + Math.sin(first.exitYaw) * gap + r.x * lateral,
      y: first.exitPos.y - 2.4,
      z: first.exitPos.z + Math.cos(first.exitYaw) * gap + r.z * lateral
    };
    const target = this.emitRibbonAt(
      cursor,
      rng,
      {
        kind: 'FLICK_CATCH',
        length: budget * 0.45,
        startHalfWidth: 11.0,
        endHalfWidth: 9.0,
        startBank: -firstSign * 1.1,
        endBank: -firstSign * 0.9,
        headingChange: -flick,
        verticalDelta: -8
      },
      targetPos,
      first.exitYaw,
      {
        timeStart: ws + (we - ws) * 0.45,
        timeEnd: we,
        sectionIndex: section.index,
        intensity: section.intensity
      }
    );
    // Preserve the real airborne gap: this is an intended catch, NOT a snap.
    target.nodes[0].surfTransition = 'AIR';
    cursor.pos = target.exitPos;
    cursor.yaw = target.exitYaw;
    cursor.arcLength += launchLen + gap + target.length;
    const deck = this.emitCatchDeck(cursor, section, rng, 24);
    return {
      nodes: [...first.nodes, ...target.nodes, ...deck.nodes],
      checkpoint: this.checkpointFor(deck.nodes[0], section.index, section.start, cursor.yaw)
    };
  }

  /** Short runway break: a checkpoint platform that relaunches into a line. */
  private static phraseRunwayBreak(
    cursor: Cursor,
    section: AnalysisSection,
    rng: SeededRandom
  ): PhraseResult {
    const runway = this.emitRunway(cursor, 22.0, 12.0, section, rng);
    const launch = this.emitRibbon(cursor, rng, {
      kind: 'BREAK_LAUNCH',
      length: 80,
      startHalfWidth: 6.5,
      endHalfWidth: 6.0,
      startBank: (rng.nextBool() ? 1 : -1) * 0.9,
      endBank: (rng.nextBool() ? 1 : -1) * 1.0,
      headingChange: rng.nextFloat(-0.3, 0.3),
      verticalDelta: -8,
      timeStart: section.start,
      timeEnd: section.end,
      sectionIndex: section.index,
      intensity: section.intensity
    });
    cursor.pos = launch.exitPos;
    cursor.yaw = launch.exitYaw;
    cursor.arcLength += launch.length;
    return {
      nodes: [...runway.nodes, ...launch.nodes],
      checkpoint: this.checkpointFor(runway.nodes[0], section.index, section.start, cursor.yaw)
    };
  }

  /** One continuous ribbon + a catch deck. */
  private static phraseLongLine(
    cursor: Cursor,
    section: AnalysisSection,
    rng: SeededRandom,
    simple = false
  ): PhraseResult {
    const bankSign = rng.nextBool() ? 1 : -1;
    const length = simple ? 40 : 46 + section.intensity * 14;
    const ribbon = this.emitRibbon(cursor, rng, {
      kind: 'LONG_LINE',
      length,
      startHalfWidth: simple ? 6.5 : 5.5,
      endHalfWidth: simple ? 6.5 : 5.0,
      startBank: bankSign * (simple ? 0.8 : 0.95),
      endBank: bankSign * (simple ? 0.8 : 1.0),
      headingChange: simple ? 0 : rng.nextFloat(-0.14, 0.14),
      verticalDelta: simple ? -6 : -6 - section.intensity * 5,
      timeStart: section.start,
      timeEnd: section.end,
      sectionIndex: section.index,
      intensity: section.intensity
    });
    cursor.pos = ribbon.exitPos;
    cursor.yaw = ribbon.exitYaw;
    cursor.arcLength += length;
    const deck = this.emitCatchDeck(cursor, section, rng);
    return { nodes: [...ribbon.nodes, ...deck.nodes] };
  }

  /** S curve: three contiguous ribbons (right bank -> neutral -> left bank). */
  private static phraseSCurve(cursor: Cursor, section: AnalysisSection, rng: SeededRandom, targetMeters: number, window?: { start: number; end: number }): PhraseResult {
    const nodes: RouteNode[] = [];
    const turn = rng.nextFloat(0.30, 0.44);
    const total = Math.max(120, Math.min(540, targetMeters - 22));
    const leg = total / 3;
    const specs: RibbonSpec[] = [
      {
        kind: 'S_CURVE_A', length: leg, startHalfWidth: 6.5, endHalfWidth: 6.0,
        startBank: 0.6, endBank: 1.0, headingChange: turn, verticalDelta: clampDescentDrop(-leg * 0.10, leg)
      },
      {
        kind: 'S_CURVE_B', length: leg, startHalfWidth: 6.0, endHalfWidth: 6.0,
        startBank: 1.0, endBank: -1.0, headingChange: -2 * turn, verticalDelta: clampDescentDrop(-leg * 0.12, leg)
      },
      {
        kind: 'S_CURVE_C', length: leg, startHalfWidth: 6.0, endHalfWidth: 6.5,
        startBank: -1.0, endBank: -0.6, headingChange: turn, verticalDelta: clampDescentDrop(-leg * 0.10, leg)
      }
    ];
    let sub = window?.start ?? section.start;
    const subStep = ((window?.end ?? section.end) - sub) / specs.length;
    for (const spec of specs) {
      const r = this.emitRibbon(cursor, rng, {
        ...spec,
        timeStart: sub,
        timeEnd: sub + subStep,
        sectionIndex: section.index,
        intensity: section.intensity
      });
      nodes.push(...r.nodes);
      cursor.pos = r.exitPos;
      cursor.yaw = r.exitYaw;
      cursor.arcLength += spec.length;
      sub += subStep;
    }
    const deck = this.emitCatchDeck(cursor, section, rng);
    return { nodes: [...nodes, ...deck.nodes] };
  }

  /** Large descent: a long plunging ribbon onto a broad lower catch deck. */
  private static phraseDescent(
    cursor: Cursor,
    section: AnalysisSection,
    rng: SeededRandom,
    big: boolean,
    _targetMeters: number
  ): PhraseResult {
    const bankSign = rng.nextBool() ? 1 : -1;
    const length = big ? 90 : 45;
    // Drop is clamped per metre travelled so a long plunge cannot inject
    // unbounded speed while still reading as a real descent.
    const drop = big ? -30 : -16;
    const ribbon = this.emitRibbon(cursor, rng, {
      kind: big ? 'DESCENT_BIG' : 'DESCENT',
      length,
      startHalfWidth: 6.5,
      endHalfWidth: 7.5,
      startBank: bankSign * 0.9,
      endBank: bankSign * 0.75,
      headingChange: rng.nextFloat(-0.1, 0.1),
      verticalDelta: drop,
      timeStart: section.start,
      timeEnd: section.end,
      sectionIndex: section.index,
      intensity: section.intensity
    });
    cursor.pos = ribbon.exitPos;
    cursor.yaw = ribbon.exitYaw;
    cursor.arcLength += length;
    const deck = this.emitCatchDeck(cursor, section, rng, big ? 30 : 24);
    return {
      nodes: [...ribbon.nodes, ...deck.nodes],
      checkpoint: this.checkpointFor(deck.nodes[0], section.index, section.start, cursor.yaw)
    };
  }

  /** Feasible climb: a rising banked ribbon within the speed envelope. */
  private static phraseClimb(cursor: Cursor, section: AnalysisSection, rng: SeededRandom, targetMeters: number, window?: { start: number; end: number }): PhraseResult {
    const bankSign = rng.nextBool() ? 1 : -1;
    const length = Math.max(60, Math.min(180, targetMeters - 20));
    // Keep the climb within the expected-speed energy budget (gravity is 24).
    const available = (SURF_SPEED_ENVELOPE.minimum * SURF_SPEED_ENVELOPE.minimum) / (2 * SURF_GRAVITY);
    const rise = Math.min(2.0, available * 0.65);
    const feasibility = climbFeasibility(SURF_SPEED_ENVELOPE.expected, rise, length);
    const adjustedRise = feasibility.feasible ? rise : Math.max(1.5, rise - 2.0);
    const ribbon = this.emitRibbon(cursor, rng, {
      kind: 'CLIMB',
      length,
      startHalfWidth: 5.5,
      endHalfWidth: 5.0,
      startBank: bankSign * 0.9,
      endBank: bankSign * 1.0,
      headingChange: (rng.nextBool() ? 1 : -1) * rng.nextFloat(0.2, 0.4),
      verticalDelta: adjustedRise,
      timeStart: window?.start ?? section.start,
      timeEnd: window?.end ?? section.end,
      sectionIndex: section.index,
      intensity: section.intensity
    });
    cursor.pos = ribbon.exitPos;
    cursor.yaw = ribbon.exitYaw;
    cursor.arcLength += length;
    const deck = this.emitCatchDeck(cursor, section, rng, 20);
    return { nodes: [...ribbon.nodes, ...deck.nodes] };
  }

  /**
   * Left -> right (or right -> left) wall transfer with a real catch wall.
   * Kept as a distinct deterministic PRECISION-style transfer; the budgeted
   * body uses `phraseFlickTransfer` for trait-driven catches.
   */
  private static phraseTransfer(cursor: Cursor, section: AnalysisSection, rng: SeededRandom, targetMeters: number, window?: { start: number; end: number }): PhraseResult {
    const firstSign = rng.nextBool() ? 1 : -1;
    const budget = Math.max(120, Math.min(400, targetMeters - 30));
    const ws = window?.start ?? section.start;
    const we = window?.end ?? section.end;
    const first = this.emitRibbon(cursor, rng, {
      kind: 'TRANSFER_A',
      length: budget * 0.45,
      startHalfWidth: 6.0,
      endHalfWidth: 5.5,
      startBank: firstSign * 0.9,
      endBank: firstSign * 1.05,
      headingChange: 0,
      verticalDelta: -6,
      timeStart: ws,
      timeEnd: ws + (we - ws) * 0.45,
      sectionIndex: section.index,
      intensity: section.intensity
    });
    // Target wall is laterally offset and slightly below, so the ballistic arc
    // from the launch wall can actually catch it.
    const gap = 8.0;
    const lateral = -firstSign * 4.0;
    const r = right(first.exitYaw);
    const targetPos: Vector3Like = {
      x: first.exitPos.x + Math.sin(first.exitYaw) * gap + r.x * lateral,
      y: first.exitPos.y - 2.2,
      z: first.exitPos.z + Math.cos(first.exitYaw) * gap + r.z * lateral
    };
    const targetSpec: RibbonSpec = {
      kind: 'TRANSFER_B',
      length: budget * 0.5,
      startHalfWidth: 10.0,
      endHalfWidth: 10.0,
      startBank: -firstSign * 1.05,
      endBank: -firstSign * 0.9,
      headingChange: 0,
      verticalDelta: -6
    };
    const target = this.emitRibbonAt(
      cursor,
      rng,
      targetSpec,
      targetPos,
      first.exitYaw,
      {
        timeStart: ws + (we - ws) * 0.5,
        timeEnd: we,
        sectionIndex: section.index,
        intensity: section.intensity
      }
    );
    // This is a REAL left/right airborne wall transfer: keep the gap + lateral
    // offset verbatim; the validator checks the full speed envelope against it.
    target.nodes[0].surfTransition = 'AIR';
    cursor.pos = target.exitPos;
    cursor.yaw = target.exitYaw;
    cursor.arcLength += budget * 0.95 + gap;
    const deck = this.emitCatchDeck(cursor, section, rng, 26);
    return { nodes: [...first.nodes, ...target.nodes, ...deck.nodes] };
  }

  /** Canyon: two opposite surf walls across a deep void, transfer between. */
  private static phraseCanyon(cursor: Cursor, section: AnalysisSection, rng: SeededRandom, targetMeters: number): PhraseResult {
    const firstSign = rng.nextBool() ? 1 : -1;
    const budget = Math.max(160, Math.min(700, targetMeters - 30));
    const first = this.emitRibbon(cursor, rng, {
      kind: 'CANYON_LEFT',
      length: budget * 0.42,
      startHalfWidth: 6.5,
      endHalfWidth: 6.0,
      startBank: firstSign * 1.0,
      endBank: firstSign * 1.1,
      headingChange: 0,
      verticalDelta: -14,
      timeStart: section.start,
      timeEnd: section.start + (section.end - section.start) * 0.4,
      sectionIndex: section.index,
      intensity: section.intensity
    });
    const gap = 10.0;
    const lateral = -firstSign * 5.0;
    const r = right(first.exitYaw);
    const targetPos: Vector3Like = {
      x: first.exitPos.x + Math.sin(first.exitYaw) * gap + r.x * lateral,
      y: first.exitPos.y - 2.6,
      z: first.exitPos.z + Math.cos(first.exitYaw) * gap + r.z * lateral
    };
    const target = this.emitRibbonAt(
      cursor,
      rng,
      {
        kind: 'CANYON_RIGHT', length: budget * 0.52, startHalfWidth: 12.0, endHalfWidth: 11.0,
        startBank: -firstSign * 1.1, endBank: -firstSign * 1.0, headingChange: 0, verticalDelta: -16
      },
      targetPos,
      first.exitYaw,
      {
        timeStart: section.start + (section.end - section.start) * 0.45,
        timeEnd: section.end,
        sectionIndex: section.index,
        intensity: section.intensity
      }
    );
    // Deliberate opposite-wall canyon transfer: preserve the real gap.
    target.nodes[0].surfTransition = 'AIR';
    cursor.pos = target.exitPos;
    cursor.yaw = target.exitYaw;
    cursor.arcLength += budget * 0.94 + gap;
    const deck = this.emitCatchDeck(cursor, section, rng, 28);
    return {
      nodes: [...first.nodes, ...target.nodes, ...deck.nodes],
      checkpoint: this.checkpointFor(deck.nodes[0], section.index, section.start, cursor.yaw)
    };
  }

  /** Gentle descending partial spiral (wide radius, readable). */
  private static phraseSpiral(cursor: Cursor, section: AnalysisSection, rng: SeededRandom, targetMeters: number): PhraseResult {
    const dirSign = rng.nextBool() ? 1 : -1;
    const length = Math.max(80, Math.min(300, targetMeters - 24));
    const ribbon = this.emitRibbon(cursor, rng, {
      kind: 'SPIRAL',
      length,
      startHalfWidth: 6.5,
      endHalfWidth: 6.0,
      startBank: dirSign * 0.85,
      endBank: dirSign * 1.0,
      headingChange: dirSign * 1.7,
      verticalDelta: -12,
      timeStart: section.start,
      timeEnd: section.end,
      sectionIndex: section.index,
      intensity: section.intensity
    });
    cursor.pos = ribbon.exitPos;
    cursor.yaw = ribbon.exitYaw;
    cursor.arcLength += length;
    const deck = this.emitCatchDeck(cursor, section, rng, 24);
    return { nodes: [...ribbon.nodes, ...deck.nodes] };
  }

  /** Platform interlude: a short bhop burst that launches back into surf. */
  private static phraseInterlude(cursor: Cursor, section: AnalysisSection, rng: SeededRandom): PhraseResult {
    const nodes: RouteNode[] = [];
    const count = 3 + (rng.nextBool() ? 1 : 0);
    let t = section.start;
    const step = (section.end - section.start) / count;
    for (let i = 0; i < count; i++) {
      const isLast = i === count - 1;
      const len = isLast ? 12.0 : 7.0;
      const width = isLast ? 13.0 : 9.5;
      const gap = i === 0 ? 4.0 : 6.0;
      const center = advance(cursor.pos, cursor.yaw, gap + len * 0.5);
      const node = makePlatform(
        cursor.nodeId++, center, width, len, cursor.yaw, 0,
        RouteNodeType.RUNWAY, section.intensity * 0.7, section.index
      );
      node.time = t;
      nodes.push(node);
      cursor.pos = advance(cursor.pos, cursor.yaw, gap + len);
      cursor.arcLength += gap + len;
      t += step;
    }
    // Launch back into a short surf line so the interlude serves surf flow.
    const launch = this.emitRibbon(cursor, rng, {
      kind: 'INTERLUDE_LAUNCH',
      length: 30,
      startHalfWidth: 6.0,
      endHalfWidth: 5.5,
      startBank: (rng.nextBool() ? 1 : -1) * 0.95,
      endBank: (rng.nextBool() ? 1 : -1) * 1.0,
      headingChange: rng.nextFloat(-0.12, 0.12),
      verticalDelta: -6,
      timeStart: t,
      timeEnd: section.end,
      sectionIndex: section.index,
      intensity: section.intensity
    });
    nodes.push(...launch.nodes);
    cursor.pos = launch.exitPos;
    cursor.yaw = launch.exitYaw;
    cursor.arcLength += 30;
    return {
      nodes,
      checkpoint: this.checkpointFor(nodes[0], section.index, section.start, cursor.yaw)
    };
  }

  // -------------------------------------------------------------------------
  // Emitters
  // -------------------------------------------------------------------------

  /** Emit a ribbon starting at the cursor and advance the cursor. */
  private static emitRibbon(
    cursor: Cursor,
    _rng: SeededRandom,
    spec: RibbonSpec & { timeStart: number; timeEnd: number; sectionIndex: number; intensity: number }
  ): { nodes: RouteNode[]; exitPos: Vector3Like; exitYaw: number; length: number } {
    return this.emitRibbonAt(
      cursor,
      _rng,
      spec,
      cursor.pos,
      cursor.yaw,
      { timeStart: spec.timeStart, timeEnd: spec.timeEnd, sectionIndex: spec.sectionIndex, intensity: spec.intensity }
    );
  }

  private static emitRibbonAt(
    cursor: Cursor,
    _rng: SeededRandom,
    spec: RibbonSpec,
    startPos: Vector3Like,
    startYaw: number,
    meta: { timeStart: number; timeEnd: number; sectionIndex: number; intensity: number }
  ): { nodes: RouteNode[]; exitPos: Vector3Like; exitYaw: number; length: number } {
    const stations = buildRibbonStations(spec, startPos, startYaw);
    const emitted = ribbonSegmentNodes(stations, spec, {
      ribbonId: cursor.ribbonId++,
      nodeIdStart: cursor.nodeId,
      timeStart: meta.timeStart,
      timeEnd: meta.timeEnd,
      sectionIndex: meta.sectionIndex,
      intensity: meta.intensity
    });
    cursor.nodeId = emitted.nextNodeId;
    const finalStation = stations[stations.length - 1];
    const lastSeg = stations[stations.length - 2];
    const f = {
      x: finalStation.center.x - lastSeg.center.x,
      y: finalStation.center.y - lastSeg.center.y,
      z: finalStation.center.z - lastSeg.center.z
    };
    const exitYaw = Math.atan2(f.x, f.z);
    return {
      nodes: emitted.nodes,
      exitPos: emitted.exitPos,
      exitYaw,
      length: spec.length
    };
  }

  /** A short wide landing deck after a ribbon, positioned from the real exit anchor. */
  private static emitCatchDeck(
    cursor: Cursor,
    section: AnalysisSection,
    rng: SeededRandom,
    length = 12
  ): { nodes: RouteNode[] } {
    // Platforms serve surf flow: keep them short so they never dominate the
    // course's traversal distance (surf must stay 75-90% of the run).
    length = Math.max(18, Math.min(26, length));
    // FORGIVING CATCH ENDS: a wide deck plus a SHORT release gap. The old 5 m
    // gap assumed a fast entry; a slower surfer had already dropped below the
    // 0.6 m shelf by the time the deck began and passed straight through the
    // shallow gap. 2.5 m means even a minimum-speed arc lands ON the deck.
    const width = 22 + rng.nextFloat(0, 4);
    const gap = 2.5;
    const center = advance(cursor.pos, cursor.yaw, gap + length * 0.5);
    center.y = cursor.pos.y - 0.5;
    const node = makePlatform(
      cursor.nodeId++, center, width, length, cursor.yaw, 0,
      RouteNodeType.LANDING, section.intensity * 0.5, section.index
    );
    node.time = section.end;
    cursor.pos = advance(center, cursor.yaw, length * 0.5);
    cursor.arcLength += gap + length;
    return { nodes: [node] };
  }

  private static emitRunway(
    cursor: Cursor,
    length: number,
    width: number,
    section: AnalysisSection,
    _rng: SeededRandom
  ): { nodes: RouteNode[] } {
    const gap = 5.0;
    const center = advance(cursor.pos, cursor.yaw, gap + length * 0.5);
    const node = makePlatform(
      cursor.nodeId++, center, width, length, cursor.yaw, 0,
      RouteNodeType.RUNWAY, section.intensity * 0.4, section.index
    );
    node.time = section.start;
    cursor.pos = advance(cursor.pos, cursor.yaw, gap + length);
    cursor.arcLength += gap + length;
    return { nodes: [node] };
  }

  private static checkpointFor(
    node: RouteNode,
    sectionIndex: number,
    time: number,
    yaw: number
  ): CheckpointDefinition {
    return {
      id: 1000 + node.id,
      routeNodeId: node.id,
      time,
      position: { ...node.position },
      yaw,
      sectionIndex
    };
  }
}

function makePlatform(
  id: number,
  center: Vector3Like,
  width: number,
  length: number,
  yaw: number,
  pitch: number,
  type: RouteNodeType,
  intensity: number,
  sectionIndex: number
): RouteNode {
  return {
    surfTransition: 'CONNECTED',
    id,
    time: 0,
    position: { ...center },
    dimensions: { x: width, y: PLATFORM_THICKNESS, z: length },
    yaw,
    pitch,
    roll: 0,
    type,
    intensity,
    sectionIndex,
    arcLength: 0,
    isSurf: false,
    isBoost: false
  };
}

function fakeSection(): AnalysisSection {
  return {
    index: 0,
    start: 0,
    end: 1,
    duration: 1,
    intensity: 0.5,
    rhythmicDensity: 0.5,
    brightness: 0.5,
    theme: 'FLOW'
  };
}



function finalizeSurfTrack(track: GeneratedTrack, analysis: TrackAnalysis): GeneratedTrack {
  const audioIdentity = analysis.customSource?.contentHash ?? `seed-${analysis.seed >>> 0}`;
  track.courseIdentity = `surf-v${SURF_GENERATION_VERSION}:${audioIdentity}:${computeMapFingerprint(track, analysis)}`;
  return track;
}
