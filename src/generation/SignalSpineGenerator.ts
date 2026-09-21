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

      // Selective Placements: Preserve deliberate open void for precision setpieces
      const section = analysis.sections?.[a.sectionIndex];
      const theme = section?.theme;
      if (theme === 'PRECISION') {
        recordRejection('precision_theme_open_void');
        continue;
      }
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
      const isSmall = minPlatWidth <= 8.0 || minPlatLen <= 18.0;

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
      let isSmallChain = false;

      if (isPostSurfReentry) {
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
        // For medium (8m-16m) and larger (16m+) platforms: qualify when gap presents meaningful risk
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
      const spine = SignalSpineGenerator.createVariedTopSurfaceSpine(
        spineId++,
        a,
        b,
        exitTopA,
        entryTopB,
        gapHoriz,
        gap3D,
        pitch,
        minPlatWidth,
        isSmallChain,
        rng
      );

      if (spine) {
        coveredGaps.add(gapKey);
        spines.push(spine);
        if (isSmallChain) {
          smallChainConnectors++;
        } else {
          mediumLargeConnectors++;
        }
      }
    }

    SignalSpineGenerator.lastReport = {
      eligibleGaps,
      smallChainConnectors,
      mediumLargeConnectors,
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
   * Creates a narrow, top-surface bridging spine with controlled instance variation.
   * Ensures zero under-slung geometry: top surface sits cleanly at the playable elevation.
   */
  private static createVariedTopSurfaceSpine(
    id: number,
    a: RouteNode,
    b: RouteNode,
    exitTopA: THREE.Vector3,
    entryTopB: THREE.Vector3,
    _gapHoriz: number,
    gap3D: number,
    pitch: number,
    minPlatWidth: number,
    isSmallChain: boolean,
    rng: SeededRandom
  ): RouteNode | null {
    const dx = entryTopB.x - exitTopA.x;
    const dz = entryTopB.z - exitTopA.z;
    const yaw = Math.atan2(dx, dz);

    // 1. Width Variation: 18% to 28% of local platform width (narrow lifeline, never a full-width bridge)
    const widthRatio = rng.nextFloat(0.18, 0.28);
    const maxWidthCap = isSmallChain ? 2.8 : 4.2;
    const spineWidth = Math.max(1.5, Math.min(maxWidthCap, minPlatWidth * widthRatio));

    // 2. Thickness: low profile (0.35m - 0.45m), sitting within upper platform elevation
    const spineThickness = Math.min(0.45, Math.min(a.dimensions.y, b.dimensions.y) * 0.45);

    // 3. Length / Overlap Variation: 0.40m to 0.85m overlap into platform lips
    const overlap = rng.nextFloat(0.40, 0.85);
    const spineLength = gap3D + overlap * 2.0;

    // Midpoint on top playable surface
    const topMid = new THREE.Vector3().addVectors(exitTopA, entryTopB).multiplyScalar(0.5);

    // Elevation tuning: +0.025m (2.5cm) lip above platform top to cleanly rest like a runway catwalk plate
    topMid.y += 0.025;

    // 4. Lateral Placement & Alignment Variation (Fast Line vs Recovery Line vs Center)
    const turnAngle = b.yaw - a.yaw;
    const isCurved = Math.abs(turnAngle) > 0.04;
    const alignmentRoll = rng.next();

    let variant: 'STRAIGHT' | 'OFFSET' | 'CATWALK' | 'CURVED' = 'STRAIGHT';

    if (isCurved) {
      const turnSign = turnAngle > 0 ? 1 : -1;
      const maxShift = Math.min(3.0, (minPlatWidth - spineWidth) * 0.35);

      if (alignmentRoll < 0.45) {
        // Fast Line: biased toward inside turn corner cutting the apex
        const shift = -turnSign * rng.nextFloat(0.4, 0.85) * maxShift;
        topMid.x += Math.cos(yaw) * shift;
        topMid.z -= Math.sin(yaw) * shift;
        variant = 'CURVED';
      } else if (alignmentRoll < 0.80) {
        // Recovery Line: biased toward outside drift margin catching wide players
        const shift = turnSign * rng.nextFloat(0.5, 0.95) * maxShift;
        topMid.x += Math.cos(yaw) * shift;
        topMid.z -= Math.sin(yaw) * shift;
        variant = 'OFFSET';
      } else {
        // Center alignment along curved trajectory
        variant = 'CURVED';
      }
    } else {
      // Straight trajectory
      const maxShift = Math.min(2.6, (minPlatWidth - spineWidth) * 0.32);

      if (alignmentRoll < 0.35) {
        // Slight left strafe bias
        const shift = -rng.nextFloat(0.4, 0.85) * maxShift;
        topMid.x += Math.cos(yaw) * shift;
        topMid.z -= Math.sin(yaw) * shift;
        variant = 'OFFSET';
      } else if (alignmentRoll < 0.70) {
        // Slight right strafe bias
        const shift = rng.nextFloat(0.4, 0.85) * maxShift;
        topMid.x += Math.cos(yaw) * shift;
        topMid.z -= Math.sin(yaw) * shift;
        variant = 'OFFSET';
      } else {
        // Center alignment
        variant = spineWidth <= 2.2 ? 'CATWALK' : 'STRAIGHT';
      }
    }

    // Offset from top surface to box center
    const topOffset = new THREE.Vector3(0, spineThickness * 0.5, 0).applyEuler(
      new THREE.Euler(pitch, yaw, 0, 'YXZ')
    );
    const spinePos = new THREE.Vector3().subVectors(topMid, topOffset);

    return {
      id,
      time: a.time,
      position: { x: spinePos.x, y: spinePos.y, z: spinePos.z },
      dimensions: { x: spineWidth, y: spineThickness, z: spineLength },
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
  }
}
