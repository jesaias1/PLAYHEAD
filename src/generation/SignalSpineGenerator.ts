/**
 * SignalSpineGenerator for PLAYHEAD
 *
 * Generates procedural top-surface bridging geometry ("Signal Spine") to prevent
 * unfair void deaths across high-variance gameplay sequences:
 * 1. Post-surf landing platform chains (where landing speed varies widely).
 * 2. Staircase & ascent chains (where missed steps drop the player into the void).
 * 3. High-speed transfers (secondary catch surfaces on high-velocity gaps).
 *
 * Strict Design Invariants:
 * - NO UNDER-SLUNG CONNECTORS: Zero connector bars or support beams under platforms.
 * - TOP-SURFACE SPINE ONLY: Connector exists at the SAME gameplay elevation as the platform tops,
 *   bridging from the exit edge of one platform to the entry edge of the next.
 * - Collider and visible mesh match exactly: player can skate / bhop / run across it.
 * - KEEP RISK: Narrow profile (20% to 35% of platform width), preserving open void on the sides.
 * - ORGANIC VARIATION: Authored variants include STRAIGHT, OFFSET, CATWALK, and CURVED.
 * - SELECTIVE PLACEMENT: Deliberate open void preserved for PRECISION sections, major DROP leaps,
 *   and FINISH gates.
 */

import * as THREE from 'three';
import { TrackAnalysis } from '../audio/AudioFeatures';
import { RouteNode, RouteNodeType } from './GenerationTypes';
import { SeededRandom } from './SeededRandom';

export class SignalSpineGenerator {
  private static readonly BASE_ID = 90000;

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

    // -------------------------------------------------------------------------
    // 1. POST-SURF LANDING PLATFORM CHAINS
    // High-variance exit speed: bridge consecutive landings for the first 2-4 platforms.
    // -------------------------------------------------------------------------
    for (let i = 0; i < route.length - 1; i++) {
      const curr = route[i];
      const next = route[i + 1];

      // Surf exit: surf ramp transitioning to first non-surf landing platform
      if (curr.isSurf && !next.isSurf) {
        const maxCoverageNodes = Math.min(route.length - 1, i + 5);

        for (let j = i + 1; j < maxCoverageNodes; j++) {
          const a = route[j];
          const b = route[j + 1];
          if (b.isSurf || b.type === RouteNodeType.FINISH) break;

          const gapKey = `${a.id}->${b.id}`;
          if (coveredGaps.has(gapKey)) continue;

          // Variant selection
          const isCurved = Math.abs(b.yaw - a.yaw) > 0.08;
          const variant = isCurved
            ? 'CURVED'
            : (rng.nextBool(0.45) ? 'OFFSET' : (rng.nextBool(0.3) ? 'CATWALK' : 'STRAIGHT'));

          const spine = SignalSpineGenerator.createTopSurfaceSpine(
            spineId++,
            a,
            b,
            variant,
            rng
          );

          if (spine) {
            coveredGaps.add(gapKey);
            spines.push(spine);
          }
        }
      }
    }

    // -------------------------------------------------------------------------
    // 2. STAIRCASES & SMALL PLATFORM CHAINS
    // Bridges between consecutive steps in steep or narrow ascent sequences.
    // -------------------------------------------------------------------------
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i];
      const b = route[i + 1];
      if (a.isSurf || b.isSurf || a.type === RouteNodeType.FINISH || b.type === RouteNodeType.FINISH) continue;

      const gapKey = `${a.id}->${b.id}`;
      if (coveredGaps.has(gapKey)) continue;

      const isAscentChain =
        a.type === RouteNodeType.STEP_UP ||
        b.type === RouteNodeType.STEP_UP ||
        a.type === RouteNodeType.ASCENT_CHAIN ||
        b.type === RouteNodeType.ASCENT_CHAIN ||
        a.ascentVariant !== undefined ||
        b.ascentVariant !== undefined;

      const isSmallFootprint =
        (a.dimensions.x <= 7.0 && a.dimensions.z <= 18.0) ||
        (b.dimensions.x <= 7.0 && b.dimensions.z <= 18.0);

      const verticalStep = Math.abs(b.position.y - a.position.y);
      const isSteepOrSmall = isAscentChain || (isSmallFootprint && verticalStep > 0.3);

      if (isSteepOrSmall) {
        const isCurved = Math.abs(b.yaw - a.yaw) > 0.08;
        const variant = isCurved ? 'CURVED' : (rng.nextBool(0.35) ? 'CATWALK' : 'STRAIGHT');

        const spine = SignalSpineGenerator.createTopSurfaceSpine(
          spineId++,
          a,
          b,
          variant,
          rng
        );

        if (spine) {
          coveredGaps.add(gapKey);
          spines.push(spine);
        }
      }
    }

    // -------------------------------------------------------------------------
    // 3. HIGH-SPEED TRANSFERS
    // Gaps with high arrival velocity (>18 m/s or post-boost) and speed variance.
    // Selective Placement: Exclude PRECISION sections, major DROP leaps, and FINISH.
    // -------------------------------------------------------------------------
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i];
      const b = route[i + 1];
      if (a.isSurf || b.isSurf || a.type === RouteNodeType.FINISH || b.type === RouteNodeType.FINISH) continue;

      const gapKey = `${a.id}->${b.id}`;
      if (coveredGaps.has(gapKey)) continue;

      // Check section theme
      const section = analysis.sections?.[a.sectionIndex];
      const theme = section?.theme;

      // SELECTIVE PLACEMENT: Preserve open void for precision challenges and dramatic drop leaps
      if (theme === 'PRECISION') continue;
      if (theme === 'DROP' && i < 6) continue; // Initial colossal drop leap remains open void

      const dx = b.position.x - a.position.x;
      const dz = b.position.z - a.position.z;
      const horizontalDist = Math.hypot(dx, dz);

      const isPostBoost = a.isBoost || a.type === RouteNodeType.BOOST;
      const isHighSpeedGap = (isPostBoost && horizontalDist > 4.0 && horizontalDist < 18.0) ||
        (horizontalDist > 6.0 && horizontalDist < 16.0 && (section?.intensity ?? 0.5) > 0.6);

      if (isHighSpeedGap) {
        const variant = rng.nextBool(0.45) ? 'OFFSET' : 'STRAIGHT';
        const spine = SignalSpineGenerator.createTopSurfaceSpine(
          spineId++,
          a,
          b,
          variant,
          rng
        );

        if (spine) {
          coveredGaps.add(gapKey);
          spines.push(spine);
        }
      }
    }

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
   * Creates a narrow, top-surface bridging spine between two consecutive route platforms.
   * Ensures zero under-slung geometry: top surface is mathematically flush with platform tops.
   */
  private static createTopSurfaceSpine(
    id: number,
    a: RouteNode,
    b: RouteNode,
    variant: 'STRAIGHT' | 'OFFSET' | 'CATWALK' | 'CURVED',
    rng: SeededRandom
  ): RouteNode | null {
    const exitTopA = SignalSpineGenerator.getNodeExitTop(a);
    const entryTopB = SignalSpineGenerator.getNodeEntryTop(b);

    const dx = entryTopB.x - exitTopA.x;
    const dy = entryTopB.y - exitTopA.y;
    const dz = entryTopB.z - exitTopA.z;
    const horizDist = Math.hypot(dx, dz);
    const dist = Math.hypot(horizDist, dy);

    // Skip if platforms overlap/abut or gap is too colossal for a catch strip
    if (horizDist < 0.2 || dist > 28.0) return null;

    const yaw = Math.atan2(dx, dz);
    const pitch = -Math.atan2(dy, horizDist);

    // Ensure runnable / skateable pitch (slope <= 30 degrees)
    if (Math.abs(pitch) > 0.6) return null;

    // Narrow catch profile (20% to 35% of platform width) preserving open void on sides
    const minPlatWidth = Math.min(a.dimensions.x, b.dimensions.x);
    let widthRatio = 0.25;
    if (variant === 'CATWALK') widthRatio = 0.20;
    else if (variant === 'OFFSET') widthRatio = 0.28;
    else if (variant === 'CURVED') widthRatio = 0.30;

    const spineWidth = Math.max(1.5, Math.min(3.2, minPlatWidth * widthRatio));
    const spineThickness = Math.min(0.45, Math.min(a.dimensions.y, b.dimensions.y) * 0.45);
    const overlap = 0.5; // Generous 0.5m overlap into platform lips to prevent microscopic seams
    const spineLength = dist + overlap * 2.0;

    // Midpoint on top playable surface
    const topMid = new THREE.Vector3().addVectors(exitTopA, entryTopB).multiplyScalar(0.5);

    // Apply lateral offset if variant is OFFSET (following strafe arc or outer curve)
    if (variant === 'OFFSET') {
      const sideSign = rng.nextBool() ? 1 : -1;
      const maxShift = Math.min(2.5, (minPlatWidth - spineWidth) * 0.32);
      const shift = sideSign * maxShift;
      topMid.x += Math.cos(yaw) * shift;
      topMid.z -= Math.sin(yaw) * shift;
    }

    // Offset from top playable surface to box center
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
