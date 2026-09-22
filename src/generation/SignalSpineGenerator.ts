/**
 * SignalSpineGenerator for PLAYHEAD
 *
 * Generates procedural top-surface bridging geometry ("Signal Spine") to prevent
 * unfair void deaths across high-variance gameplay sequences:
 * 1. Post-surf landing platform chains (where landing speed varies widely).
 * 2. Staircase & ascent chains (where missed steps drop the player into the void).
 * 3. Small-platform chains (precision footings where missing by 0.5m-1.5m is fatal).
 * 4. Medium & larger platform transfers (where inter-platform gap still punishes arrival speed).
 *
 * Strict Design Invariants:
 * - NO UNDER-SLUNG CONNECTORS: Zero connector bars or support beams under platforms.
 * - TOP-SURFACE SPINE ONLY: Connector exists at the SAME gameplay elevation as the platform tops,
 *   bridging from the exit edge of one platform to the entry edge of the next.
 * - Collider and visible mesh match exactly: player can skate / bhop / run across it.
 * - KEEP RISK: Narrow profile (18% to 30% of platform width), preserving open void on the sides.
 * - CONTROLLED INSTANCE VARIATION: Per-instance variation in width, length/overlap, lateral placement,
 *   and alignment (Fast Line vs Recovery Line vs Center).
 * - SELECTIVE PLACEMENT: Deliberate open void preserved for PRECISION sections, major DROP leaps,
 *   and FINISH gates.
 */

import * as THREE from 'three';
import { TrackAnalysis } from '../audio/AudioFeatures';
import { RouteNode, RouteNodeType } from './GenerationTypes';
import { SeededRandom } from './SeededRandom';

export interface SignalSpineGenerationReport {
  eligibleGaps: number;
  smallChainConnectors: number;
  mediumLargeConnectors: number;
  microBarConnectors: number;
  highRiskTransfersFound: number;
  highRiskConnectorsGenerated: number;
  transfersLeftUnsupported: number;
  totalGenerated: number;
  rejectedCount: number;
  rejectionReasons: Record<string, number>;
}

export class SignalSpineGenerator {
  private static readonly BASE_ID = 90000;
  private static lastReport: SignalSpineGenerationReport | null = null;

  public static getLastReport(): SignalSpineGenerationReport | null {
    return SignalSpineGenerator.lastReport;
  }

  /**
   * Generates procedural Signal Spines for a repaired route.
   */
  public static generate(
    route: RouteNode[],
    analysis: TrackAnalysis,
    rng: SeededRandom
  ): RouteNode[] {
    if (route.length < 4) return [];

    const spines: RouteNode[] = [];
    let spineId = SignalSpineGenerator.BASE_ID;

    // Track which node gaps already have a spine to avoid duplicate stacking
    const coveredGaps = new Set<string>();

    let smallChainConnectors = 0;
    let mediumLargeConnectors = 0;
    let microBarConnectors = 0;
    let highRiskTransfersFound = 0;
    let highRiskConnectorsGenerated = 0;
    let transfersLeftUnsupported = 0;
    let consecutiveUnsupportedHighRisk = 0;

    let eligibleGaps = 0;
    let rejectedCount = 0;
    const rejectionReasons: Record<string, number> = {};

    const recordRejection = (reason: string) => {
      rejectedCount++;
      rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
    };

    // Pre-scan surf exit indices to identify post-surf re-entry zones
    const postSurfEligibleGaps = new Set<string>();
    for (let i = 0; i < route.length - 1; i++) {
      if (route[i].isSurf && !route[i + 1].isSurf) {
        // Guarantee coverage for the first 3-5 platforms post-surf
        const maxCoverage = Math.min(route.length - 1, i + 5);
        for (let j = i + 1; j < maxCoverage; j++) {
          if (route[j + 1].isSurf || route[j + 1].type === RouteNodeType.FINISH) break;
          postSurfEligibleGaps.add(`${route[j].id}->${route[j + 1].id}`);
        }
      }
    }

    // -------------------------------------------------------------------------
    // PROCEDURAL CONNECTOR EVALUATION (Across All Consecutive Pairs)
    // -------------------------------------------------------------------------
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i];
      const b = route[i + 1];

      // Exclude surf ramps (surfing geometry is handled by surf physics) and finish gate
      if (a.isSurf || b.isSurf || a.type === RouteNodeType.FINISH || b.type === RouteNodeType.FINISH) {
        continue;
      }

      const gapKey = `${a.id}->${b.id}`;
      if (coveredGaps.has(gapKey)) continue;

      const section = analysis.sections?.[a.sectionIndex];
      const theme = section?.theme;
      if (theme === 'DROP' && i < 6) {
        recordRejection('initial_colossal_drop_leap');
        continue;
      }

      // Compute physical top surface anchors
      const exitTopA = SignalSpineGenerator.getNodeExitTop(a);
      const entryTopB = SignalSpineGenerator.getNodeEntryTop(b);

      const dx = entryTopB.x - exitTopA.x;
      const dy = entryTopB.y - exitTopA.y;
      const dz = entryTopB.z - exitTopA.z;
      const gapHoriz = Math.hypot(dx, dz);
      const gap3D = Math.hypot(gapHoriz, dy);

      // Skip non-gaps (platforms virtually touching or overlapping)
      if (gapHoriz < 1.0) {
        continue;
      }

      eligibleGaps++;

      // Physical sanity bounds: skip impossible leaps or vertical cliffs
      if (gap3D > 22.0) {
        recordRejection('gap_too_wide_for_connector');
        continue;
      }

      const pitch = -Math.atan2(dy, gapHoriz);
      // Slope > 30 degrees is a steep drop or wall, not a runnable connector
      if (Math.abs(pitch) > 0.6) {
        recordRejection('pitch_too_steep');
        continue;
      }

      // Platform size classification
      const minPlatWidth = Math.min(a.dimensions.x, b.dimensions.x);
      const minPlatLen = Math.min(a.dimensions.z, b.dimensions.z);

      // Micro-platform / bar chain classification:
      // Sequences of tiny bars, narrow beams, micro-platforms (width <= 6.5m or length <= 14m),
      // or explicit PRECISION theme sections.
      const isMicroBarChain = minPlatWidth <= 6.5 || minPlatLen <= 14.0 || theme === 'PRECISION';
      const isSmall = !isMicroBarChain && (minPlatWidth <= 8.5 || minPlatLen <= 18.0);

      // Gameplay sequence classifications
      const isPostSurfReentry = postSurfEligibleGaps.has(gapKey);
      const isAscentChain =
        a.type === RouteNodeType.STEP_UP ||
        b.type === RouteNodeType.STEP_UP ||
        a.type === RouteNodeType.ASCENT_CHAIN ||
        b.type === RouteNodeType.ASCENT_CHAIN ||
        a.ascentVariant !== undefined ||
        b.ascentVariant !== undefined ||
        Math.abs(b.position.y - a.position.y) > 0.25;

      let qualify = false;
      let isMicroChain = false;
      let isSmallChain = false;

      if (isMicroBarChain) {
        // High-Risk Transfer Chain (Micro-platforms, tiny bars, precision landings)
        highRiskTransfersFound++;

        // COVERAGE RULE:
        // Provide Signal Spine on a majority of these transfers (~70-85%), with occasional
        // intentional open jumps so danger remains real.
        // Never allow 3+ consecutive micro-bar leaps with zero recovery option.
        // Max consecutive unsupported high-risk transfers must be <= 2.
        if (consecutiveUnsupportedHighRisk >= 2) {
          qualify = true;
        } else {
          // 78% coverage target (within 70-85% rule)
          const roll = rng.next();
          if (roll < 0.78) {
            qualify = true;
          } else {
            consecutiveUnsupportedHighRisk++;
            transfersLeftUnsupported++;
            recordRejection('intentional_high_risk_open_leap');
          }
        }

        if (qualify) {
          consecutiveUnsupportedHighRisk = 0;
          highRiskConnectorsGenerated++;
          isMicroChain = true;
        }
      } else if (isPostSurfReentry) {
        // Category 1: Post-surf landing platform chains (100% coverage)
        qualify = true;
        isSmallChain = isSmall;
      } else if (isAscentChain) {
        // Category 2: Staircases & Step-Ups / Ascent Chains (100% coverage)
        qualify = true;
        isSmallChain = isSmall;
      } else if (isSmall) {
        // Category 3: Small-platform chains (100% coverage when gap >= 1.4m)
        if (gapHoriz >= 1.4) {
          qualify = true;
          isSmallChain = true;
        } else {
          recordRejection('small_chain_gap_too_short');
        }
      } else {
        // Category 4: Medium & Larger Platform Transfers (Broadened Qualifying Rule)
        if (gapHoriz >= 2.2) {
          // Select ~55% of medium/large transfers so they are common but not universal
          const qualifyRoll = rng.next();
          if (qualifyRoll < 0.55) {
            qualify = true;
            isSmallChain = false;
          } else {
            recordRejection('medium_large_open_void_jump');
          }
        } else {
          recordRejection('medium_large_gap_too_short');
        }
      }

      if (!qualify) continue;

      // -----------------------------------------------------------------------
      // CONTROLLED INSTANCE VARIATION
      // -----------------------------------------------------------------------
      const spineNodes = SignalSpineGenerator.createVariedTopSurfaceSpine(
        () => spineId++,
        a,
        b,
        exitTopA,
        entryTopB,
        gapHoriz,
        gap3D,
        pitch,
        minPlatWidth,
        isMicroChain,
        isSmallChain,
        isPostSurfReentry,
        rng
      );

      if (spineNodes && spineNodes.length > 0) {
        coveredGaps.add(gapKey);
        for (const spine of spineNodes) {
          spines.push(spine);
        }
        if (isMicroChain) {
          microBarConnectors += spineNodes.length;
        } else if (isSmallChain) {
          smallChainConnectors += spineNodes.length;
        } else {
          mediumLargeConnectors += spineNodes.length;
        }
      }
    }

    SignalSpineGenerator.lastReport = {
      eligibleGaps,
      smallChainConnectors,
      mediumLargeConnectors,
      microBarConnectors,
      highRiskTransfersFound,
      highRiskConnectorsGenerated,
      transfersLeftUnsupported,
      totalGenerated: spines.length,
      rejectedCount,
      rejectionReasons
    };

    return spines;
  }

  /**
   * Calculates the exact front exit anchor on the TOP playable surface of a node.
   */
  public static getNodeExitTop(node: RouteNode): THREE.Vector3 {
    const euler = new THREE.Euler(node.pitch || 0, node.yaw || 0, node.roll || 0, 'YXZ');
    const localExit = new THREE.Vector3(
      node.exitLateralOffset || 0,
      node.dimensions.y * 0.5,
      node.dimensions.z * 0.5
    ).applyEuler(euler);
    return new THREE.Vector3(
      node.position.x + localExit.x,
      node.position.y + localExit.y,
      node.position.z + localExit.z
    );
  }

  /**
   * Calculates the exact rear entry anchor on the TOP playable surface of a node.
   */
  public static getNodeEntryTop(node: RouteNode): THREE.Vector3 {
    const euler = new THREE.Euler(node.pitch || 0, node.yaw || 0, node.roll || 0, 'YXZ');
    const localEntry = new THREE.Vector3(
      0,
      node.dimensions.y * 0.5,
      -node.dimensions.z * 0.5
    ).applyEuler(euler);
    return new THREE.Vector3(
      node.position.x + localEntry.x,
      node.position.y + localEntry.y,
      node.position.z + localEntry.z
    );
  }

  /**
   * Creates narrow, top-surface bridging spine segments with controlled width & shape variation.
   * Ensures zero under-slung geometry: top surface sits cleanly at the playable elevation.
   *
   * Shapes:
   * 1. TAPERED: wider at platform attachments, narrower through middle, wider again near next platform.
   * 2. OFFSET: slightly left or right rather than always centered.
   * 3. BROKEN: occasional short missing section requiring one small controlled hop.
   * 4. TAPER-TO-REJOIN: spine gradually narrows or ends so player must return to main route.
   */
  private static createVariedTopSurfaceSpine(
    nextId: () => number,
    a: RouteNode,
    b: RouteNode,
    exitTopA: THREE.Vector3,
    entryTopB: THREE.Vector3,
    gapHoriz: number,
    gap3D: number,
    pitch: number,
    minPlatWidth: number,
    isMicroChain: boolean,
    isSmallChain: boolean,
    isPostSurfReentry: boolean,
    rng: SeededRandom
  ): RouteNode[] {
    const dx = entryTopB.x - exitTopA.x;
    const dz = entryTopB.z - exitTopA.z;
    const yaw = Math.atan2(dx, dz);

    // 1. Adaptive Width according to Movement Phrase:
    // - micro-bar / precision chain: ~6–12% of local usable width, skinny recovery profile
    // - post-surf catch / very punishing transfer: ~20–25% of local platform width
    // - normal small-platform chain: ~12–18%
    // - medium / large transfer recovery line: ~8–12%
    let widthRatio: number;
    let minWidthCap: number;
    let maxWidthCap: number;

    if (isMicroChain) {
      widthRatio = rng.nextFloat(0.06, 0.12);
      minWidthCap = 0.35;
      maxWidthCap = Math.max(0.60, minPlatWidth * 0.14);
    } else if (isPostSurfReentry) {
      widthRatio = rng.nextFloat(0.20, 0.25);
      minWidthCap = 1.20;
      maxWidthCap = 2.40;
    } else if (isSmallChain) {
      widthRatio = rng.nextFloat(0.12, 0.18);
      minWidthCap = 0.95;
      maxWidthCap = 1.70;
    } else {
      widthRatio = rng.nextFloat(0.08, 0.12);
      minWidthCap = 0.80;
      maxWidthCap = 1.40;
    }

    const baseWidth = Math.max(minWidthCap, Math.min(maxWidthCap, minPlatWidth * widthRatio));
    const spineThickness = Math.min(isMicroChain ? 0.30 : 0.40, Math.min(a.dimensions.y, b.dimensions.y) * 0.35);
    const overlap = rng.nextFloat(0.40, 0.80);
    const totalSpan = gap3D + overlap * 2.0;

    // Unit direction from exitTopA to entryTopB
    const dir = new THREE.Vector3(dx, entryTopB.y - exitTopA.y, dz).normalize();
    const spanStart = exitTopA.clone().addScaledVector(dir, -overlap);
    const spanEnd = entryTopB.clone().addScaledVector(dir, overlap);
    const lateralDir = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    const makeSegment = (
      uStart: number,
      uEnd: number,
      segWidth: number,
      latShift: number,
      variant: 'STRAIGHT' | 'OFFSET' | 'CURVED' | 'DIP' | 'CATWALK' | 'SHALLOW_SURF' | 'TAPERED' | 'BROKEN' | 'TAPER_TO_REJOIN'
    ): RouteNode => {
      const segLen = Math.max(0.2, (uEnd - uStart) * totalSpan);
      const uMid = (uStart + uEnd) * 0.5;
      const topMid = spanStart.clone().lerp(spanEnd, uMid);
      if (latShift !== 0) {
        topMid.addScaledVector(lateralDir, latShift);
      }
      // Rest 2.5cm atop platform surface
      topMid.y += 0.025;

      const topOffset = new THREE.Vector3(0, spineThickness * 0.5, 0).applyEuler(
        new THREE.Euler(pitch, yaw, 0, 'YXZ')
      );
      const spinePos = new THREE.Vector3().subVectors(topMid, topOffset);

      return {
        id: nextId(),
        time: a.time,
        position: { x: spinePos.x, y: spinePos.y, z: spinePos.z },
        dimensions: { x: segWidth, y: spineThickness, z: segLen },
        yaw,
        pitch,
        roll: 0,
        type: RouteNodeType.RUNWAY,
        intensity: a.intensity * 0.8,
        sectionIndex: a.sectionIndex,
        arcLength: a.arcLength,
        isSurf: false,
        isBoost: false,
        isOptional: true,
        isSignalSpine: true,
        signalSpineVariant: variant
      };
    };

    // Shape Selection
    const turnAngle = b.yaw - a.yaw;
    const isCurved = Math.abs(turnAngle) > 0.05;
    const shapeRoll = rng.next();

    let chosenShape: 'TAPERED' | 'OFFSET' | 'BROKEN' | 'TAPER_TO_REJOIN' | 'DEFAULT';

    if (isMicroChain) {
      if (shapeRoll < 0.32 && gap3D >= 2.5) {
        chosenShape = 'TAPERED';
      } else if (shapeRoll < 0.62) {
        chosenShape = 'OFFSET';
      } else if (shapeRoll < 0.80 && gapHoriz >= 3.5) {
        chosenShape = 'BROKEN';
      } else if (shapeRoll < 0.92 && gap3D >= 2.8) {
        chosenShape = 'TAPER_TO_REJOIN';
      } else {
        chosenShape = 'DEFAULT';
      }
    } else if (isPostSurfReentry) {
      if (shapeRoll < 0.45 && gap3D >= 3.0) {
        chosenShape = 'TAPERED';
      } else if (shapeRoll < 0.75) {
        chosenShape = 'OFFSET';
      } else if (shapeRoll < 0.90 && gap3D >= 3.5) {
        chosenShape = 'TAPER_TO_REJOIN';
      } else {
        chosenShape = 'DEFAULT';
      }
    } else if (isSmallChain) {
      if (shapeRoll < 0.35 && gap3D >= 3.0) {
        chosenShape = 'TAPERED';
      } else if (shapeRoll < 0.60) {
        chosenShape = 'OFFSET';
      } else if (shapeRoll < 0.80 && gapHoriz >= 4.2) {
        chosenShape = 'BROKEN';
      } else if (shapeRoll < 0.92 && gap3D >= 3.5) {
        chosenShape = 'TAPER_TO_REJOIN';
      } else {
        chosenShape = 'DEFAULT';
      }
    } else {
      // Medium & Larger transfers
      if (shapeRoll < 0.32 && gap3D >= 3.5) {
        chosenShape = 'TAPERED';
      } else if (shapeRoll < 0.58) {
        chosenShape = 'OFFSET';
      } else if (shapeRoll < 0.80 && gapHoriz >= 4.5) {
        chosenShape = 'BROKEN';
      } else if (shapeRoll < 0.92 && gap3D >= 3.5) {
        chosenShape = 'TAPER_TO_REJOIN';
      } else {
        chosenShape = 'DEFAULT';
      }
    }

    // 1. TAPERED SPINE:
    // Wider at platform attachments, narrower in middle, wider near next platform
    if (chosenShape === 'TAPERED') {
      const entryWidth = isMicroChain
        ? Math.min(minPlatWidth * 0.16, baseWidth * 1.3)
        : Math.min(2.6, Math.min(minPlatWidth * 0.30, baseWidth * 1.35));
      const midWidth = isMicroChain
        ? Math.max(0.30, baseWidth * 0.75)
        : Math.max(0.65, baseWidth * 0.75);
      const exitWidth = entryWidth;

      return [
        makeSegment(0.0, 0.28, entryWidth, 0, 'TAPERED'),
        makeSegment(0.27, 0.73, midWidth, 0, 'TAPERED'),
        makeSegment(0.72, 1.0, exitWidth, 0, 'TAPERED')
      ];
    }

    // 2. OFFSET SPINE:
    // Slightly left or right of center rather than always centered
    if (chosenShape === 'OFFSET') {
      const turnSign = Math.abs(turnAngle) > 0.02
        ? (turnAngle > 0 ? 1 : -1)
        : (rng.next() < 0.5 ? 1 : -1);
      const maxShift = isMicroChain
        ? Math.min(0.6, (minPlatWidth - baseWidth) * 0.25)
        : Math.min(2.4, (minPlatWidth - baseWidth) * 0.35);
      const shift = turnSign * rng.nextFloat(0.45, 0.85) * maxShift;

      return [makeSegment(0.0, 1.0, baseWidth, shift, 'OFFSET')];
    }

    // 3. BROKEN SPINE:
    // Short missing section requiring one small controlled hop
    if (chosenShape === 'BROKEN') {
      const hopLength = isMicroChain
        ? Math.min(1.2, Math.max(0.6, gapHoriz * 0.20))
        : Math.min(1.8, Math.max(1.2, gapHoriz * 0.25));
      const hopFraction = Math.min(0.35, hopLength / totalSpan);
      const seg1End = (1.0 - hopFraction) * 0.5;
      const seg2Start = seg1End + hopFraction;

      return [
        makeSegment(0.0, seg1End, baseWidth, 0, 'BROKEN'),
        makeSegment(seg2Start, 1.0, baseWidth, 0, 'BROKEN')
      ];
    }

    // 4. TAPER-TO-REJOIN:
    // Spine gradually narrows or ends so player must return to main route
    if (chosenShape === 'TAPER_TO_REJOIN') {
      const isExitCatch = rng.next() < 0.5;
      const rootWidth = isMicroChain
        ? Math.min(minPlatWidth * 0.16, baseWidth * 1.25)
        : Math.min(2.6, Math.min(minPlatWidth * 0.28, baseWidth * 1.25));
      const tipWidth = isMicroChain
        ? Math.max(0.30, baseWidth * 0.70)
        : Math.max(0.65, baseWidth * 0.70);

      if (isExitCatch) {
        // Starts at Platform A, extends ~68% into gap and narrows at tip
        return [
          makeSegment(0.0, 0.36, rootWidth, 0, 'TAPER_TO_REJOIN'),
          makeSegment(0.35, 0.70, tipWidth, 0, 'TAPER_TO_REJOIN')
        ];
      } else {
        // Entry catch tongue extending backwards from Platform B by ~68%
        return [
          makeSegment(0.30, 0.65, tipWidth, 0, 'TAPER_TO_REJOIN'),
          makeSegment(0.64, 1.0, rootWidth, 0, 'TAPER_TO_REJOIN')
        ];
      }
    }

    // 5. DEFAULT (STRAIGHT / CATWALK / CURVED)
    const variant = isCurved ? 'CURVED' : (baseWidth <= 0.8 ? 'CATWALK' : 'STRAIGHT');
    return [makeSegment(0.0, 1.0, baseWidth, 0, variant)];
  }
}
