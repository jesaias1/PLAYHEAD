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

/** Salt keeps SURF geometry deterministic but distinct from a PLAYHEAD course. */
const SURF_SEED_SALT = 0x53555246; // 'SURF'

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

const PLATFORM_THICKNESS = 2.0;

function advance(pos: Vector3Like, yaw: number, dist: number): Vector3Like {
  return { x: pos.x + Math.sin(yaw) * dist, y: pos.y, z: pos.z + Math.cos(yaw) * dist };
}

function right(yaw: number): Vector3Like {
  return { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
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

    // 2. One phrase per musical section, chosen by theme.
    const sections = analysis.sections;
    for (let s = 0; s < sections.length; s++) {
      const section = sections[s];
      const isLast = s === sections.length - 1;
      const theme = section.theme;

      // A short checkpoint / runway breather every few sections, always on a
      // platform (never mid-surf), with enough room to reach entry speed.
      const wantsBreather = s > 0 && (s % 3 === 2) && theme !== 'DROP';
      if (wantsBreather) {
        const res = this.emitRunway(cursor, 22.0, 12.0, section, rng);
        nodes.push(...res.nodes);
        checkpoints.push(this.checkpointFor(res.nodes[0], section.index, section.start, cursor.yaw));
      }

      // Build the phrase with local rollback: a phrase that fails validation is
      // retried with a simpler variant, and omitted if it still cannot be
      // validated. Impossible content is never committed.
      const before: Cursor = { ...cursor };
      let phrase = this.buildPhrase(theme, s, isLast, cursor, section, rng, false);
      if (!SurfCourseValidator.validatePhrase(phrase.nodes).ok) {
        // SIMPLIFY: retry with the deterministic conservative variant.
        Object.assign(cursor, before);
        phrase = this.buildPhrase(theme, s, isLast, cursor, section, rng, true);
        if (!SurfCourseValidator.validatePhrase(phrase.nodes).ok) {
          // OMIT: roll the cursor back and skip this musical phrase entirely.
          Object.assign(cursor, before);
          continue;
        }
      }

      nodes.push(...phrase.nodes);
      if (phrase.checkpoint) checkpoints.push(phrase.checkpoint);
    }

    // 3. Natural finish: a long final surf release into a large finish platform.
    const finishRelease = this.emitRibbon(cursor, rng, {
      kind: 'FINAL_RELEASE',
      length: 52,
      startHalfWidth: 6.5,
      endHalfWidth: 8.0,
      startBank: 0.55,
      endBank: 0.18,
      headingChange: 0,
      verticalDelta: -10,
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

    // Sync checkpoints to repaired positions.
    for (const cp of checkpoints) {
      const node = repairedNodes.find((n) => n.id === cp.routeNodeId);
      if (node) {
        cp.position = { ...node.position };
        cp.yaw = node.yaw;
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

    const count = Math.max(2, Math.min(6, Math.floor(analysis.duration / 24)));
    for (let i = 0; i < count; i++) {
      const bankSign = rng.nextBool() ? 1 : -1;
      const ribbon = this.emitRibbon(cursor, rng, {
        kind: 'SAFE_LINE',
        length: 40,
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
      cursor.arcLength += 40;
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
  private static buildPhrase(
    theme: AnalysisSection['theme'],
    s: number,
    isLast: boolean,
    cursor: Cursor,
    section: AnalysisSection,
    rng: SeededRandom,
    simple: boolean
  ): PhraseResult {
    if (simple) return this.phraseLongLine(cursor, section, rng, true);
    switch (theme) {
      case 'BUILDUP':
        return this.phraseClimb(cursor, section, rng);
      case 'DROP':
        return this.phraseDescent(cursor, section, rng, true);
      case 'BREATH':
        return this.phraseInterlude(cursor, section, rng);
      case 'PRECISION':
        return this.phraseTransfer(cursor, section, rng);
      case 'ASCENT':
        return this.phraseClimb(cursor, section, rng);
      case 'DESCENT':
        return this.phraseDescent(cursor, section, rng, false);
      case 'SPEED':
        return s % 2 === 0 ? this.phraseSCurve(cursor, section, rng) : this.phraseCanyon(cursor, section, rng);
      case 'SURF':
        return s % 3 === 0 ? this.phraseSpiral(cursor, section, rng) : this.phraseLongLine(cursor, section, rng);
      case 'FLOW':
      default:
        if (isLast) return this.phraseLongLine(cursor, section, rng);
        return rng.nextBool(0.5) ? this.phraseLongLine(cursor, section, rng) : this.phraseSCurve(cursor, section, rng);
    }
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
  private static phraseSCurve(cursor: Cursor, section: AnalysisSection, rng: SeededRandom): PhraseResult {
    const nodes: RouteNode[] = [];
    const turn = rng.nextFloat(0.30, 0.44);
    const specs: RibbonSpec[] = [
      {
        kind: 'S_CURVE_A', length: 26, startHalfWidth: 6.5, endHalfWidth: 6.0,
        startBank: 0.6, endBank: 1.0, headingChange: turn, verticalDelta: -4
      },
      {
        kind: 'S_CURVE_B', length: 30, startHalfWidth: 6.0, endHalfWidth: 6.0,
        startBank: 1.0, endBank: -1.0, headingChange: -2 * turn, verticalDelta: -5
      },
      {
        kind: 'S_CURVE_C', length: 26, startHalfWidth: 6.0, endHalfWidth: 6.5,
        startBank: -1.0, endBank: -0.6, headingChange: turn, verticalDelta: -4
      }
    ];
    let sub = section.start;
    const subStep = (section.end - section.start) / specs.length;
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
    big: boolean
  ): PhraseResult {
    const bankSign = rng.nextBool() ? 1 : -1;
    const length = big ? 64 : 52;
    const drop = big ? -(20 + section.intensity * 6) : -(11 + section.intensity * 4);
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
  private static phraseClimb(cursor: Cursor, section: AnalysisSection, rng: SeededRandom): PhraseResult {
    const bankSign = rng.nextBool() ? 1 : -1;
    const length = 42 + section.intensity * 10;
    // Keep the climb within the expected-speed energy budget (gravity is 24).
    const available = (SURF_SPEED_ENVELOPE.minimum * SURF_SPEED_ENVELOPE.minimum) / (2 * SURF_GRAVITY);
    const rise = Math.min(2.7, available * 0.85);
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
      timeStart: section.start,
      timeEnd: section.end,
      sectionIndex: section.index,
      intensity: section.intensity
    });
    cursor.pos = ribbon.exitPos;
    cursor.yaw = ribbon.exitYaw;
    cursor.arcLength += length;
    const deck = this.emitCatchDeck(cursor, section, rng, 20);
    return { nodes: [...ribbon.nodes, ...deck.nodes] };
  }

  /** Left -> right (or right -> left) wall transfer with a real catch wall. */
  private static phraseTransfer(cursor: Cursor, section: AnalysisSection, rng: SeededRandom): PhraseResult {
    const firstSign = rng.nextBool() ? 1 : -1;
    const first = this.emitRibbon(cursor, rng, {
      kind: 'TRANSFER_A',
      length: 30,
      startHalfWidth: 6.0,
      endHalfWidth: 5.5,
      startBank: firstSign * 0.9,
      endBank: firstSign * 1.05,
      headingChange: 0,
      verticalDelta: -5,
      timeStart: section.start,
      timeEnd: section.start + (section.end - section.start) * 0.45,
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
      length: 34,
      startHalfWidth: 10.0,
      endHalfWidth: 10.0,
      startBank: -firstSign * 1.05,
      endBank: -firstSign * 0.9,
      headingChange: 0,
      verticalDelta: -5
    };
    const target = this.emitRibbonAt(
      cursor,
      rng,
      targetSpec,
      targetPos,
      first.exitYaw,
      {
        timeStart: section.start + (section.end - section.start) * 0.5,
        timeEnd: section.end,
        sectionIndex: section.index,
        intensity: section.intensity
      }
    );
    // This is a REAL left/right airborne wall transfer: keep the gap + lateral
    // offset verbatim; the validator checks the full speed envelope against it.
    target.nodes[0].surfTransition = 'AIR';
    cursor.pos = target.exitPos;
    cursor.yaw = target.exitYaw;
    cursor.arcLength += 30 + gap + 34;
    const deck = this.emitCatchDeck(cursor, section, rng, 26);
    return { nodes: [...first.nodes, ...target.nodes, ...deck.nodes] };
  }

  /** Canyon: two opposite surf walls across a deep void, transfer between. */
  private static phraseCanyon(cursor: Cursor, section: AnalysisSection, rng: SeededRandom): PhraseResult {
    const firstSign = rng.nextBool() ? 1 : -1;
    const first = this.emitRibbon(cursor, rng, {
      kind: 'CANYON_LEFT',
      length: 34,
      startHalfWidth: 6.5,
      endHalfWidth: 6.0,
      startBank: firstSign * 1.0,
      endBank: firstSign * 1.1,
      headingChange: 0,
      verticalDelta: -7,
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
        kind: 'CANYON_RIGHT', length: 40, startHalfWidth: 12.0, endHalfWidth: 12.0,
        startBank: -firstSign * 1.1, endBank: -firstSign * 1.0, headingChange: 0, verticalDelta: -8
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
    cursor.arcLength += 34 + gap + 40;
    const deck = this.emitCatchDeck(cursor, section, rng, 28);
    return {
      nodes: [...first.nodes, ...target.nodes, ...deck.nodes],
      checkpoint: this.checkpointFor(deck.nodes[0], section.index, section.start, cursor.yaw)
    };
  }

  /** Gentle descending partial spiral (wide radius, readable). */
  private static phraseSpiral(cursor: Cursor, section: AnalysisSection, rng: SeededRandom): PhraseResult {
    const dirSign = rng.nextBool() ? 1 : -1;
    const length = 56;
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
    length = Math.max(10, Math.min(14, length));
    const width = 20 + rng.nextFloat(0, 4);
    const gap = 5.0;
    const center = advance(cursor.pos, cursor.yaw, gap + length * 0.5);
    center.y = cursor.pos.y - 0.6;
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
