/**
 * SignalSpineGenerator for PLAYHEAD
 *
 * Generates procedural secondary traversal geometry ("Signal Spine") to prevent
 * unfair void deaths across high-variance gameplay sequences:
 * 1. Post-surf recovery sequences (guaranteed recovery lines for the first 2-4 landings).
 * 2. Staircases & small-platform chains (under-slung ribbons catching missed steps).
 * 3. High-speed transfers (secondary catch surfaces on high-velocity gaps).
 *
 * Strict Design Invariants:
 * - NOT an invisible floor or oversized safety net.
 * - NOT an aircraft-carrier platform enlargement (main route platforms remain untouched).
 * - Visible brutalist concrete / signal geometry layer.
 * - Strict sub-optimality: narrower (1.8m-3.2m), lower (y - 1.5m to -2.8m), or laterally offset.
 *   Taking the recovery line incurs elevation, speed, and time penalties compared to the clean main line.
 * - Selective placement: true hero jumps, committed launches, and deliberate precision setpieces
 *   (e.g. PRECISION sections, major DROP leaps, FINISH gates) retain pure open void below.
 */

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
    // 1. POST-SURF RECOVERY SEQUENCES
    // Every surf exit must guarantee a recovery line for the first 2-4 landings.
    // -------------------------------------------------------------------------
    for (let i = 0; i < route.length - 1; i++) {
      const curr = route[i];
      const next = route[i + 1];

      // Identify surf exit (surf ramp transitioning to non-surf landing or runway)
      if (curr.isSurf && !next.isSurf) {
        // Guarantee recovery coverage for the first 2 to 4 landings post-surf
        const maxCoverageNodes = Math.min(route.length - 1, i + 4);

        for (let j = i; j < maxCoverageNodes; j++) {
          const a = route[j];
          const b = route[j + 1];
          if (b.type === RouteNodeType.FINISH) break;

          const gapKey = `${a.id}->${b.id}`;
          if (coveredGaps.has(gapKey)) continue;
          coveredGaps.add(gapKey);

          const spine = SignalSpineGenerator.createPostSurfSpine(
            spineId++,
            a,
            b,
            j - i, // step index after surf
            rng
          );
          if (spine) spines.push(spine);
        }

        // On the first landing directly following surf exit, also add an outside-drift
        // recovery catch wing to guarantee that high-speed exit lateral drift doesn't plunge
        if (i + 1 < route.length) {
          const landing = route[i + 1];
          const driftWing = SignalSpineGenerator.createCatchWingSpine(
            spineId++,
            curr,
            landing,
            rng
          );
          if (driftWing) spines.push(driftWing);
        }
      }
    }

    // -------------------------------------------------------------------------
    // 2. STAIRCASES & SMALL PLATFORM CHAINS
    // Under-slung ribbons beneath rapid vertical changes or small-footprint platforms.
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
        coveredGaps.add(gapKey);
        const spine = SignalSpineGenerator.createStaircaseSpine(spineId++, a, b, rng);
        if (spine) spines.push(spine);
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
      const horizontalDist = Math.sqrt(dx * dx + dz * dz);

      const isPostBoost = a.isBoost || a.type === RouteNodeType.BOOST;
      const isHighSpeedGap = (isPostBoost && horizontalDist > 5.0) || (horizontalDist > 8.0 && (section?.intensity ?? 0.5) > 0.6);

      if (isHighSpeedGap) {
        coveredGaps.add(gapKey);
        const spine = SignalSpineGenerator.createHighSpeedTransferSpine(spineId++, a, b, rng);
        if (spine) spines.push(spine);
      }
    }

    return spines;
  }

  /**
   * Post-surf recovery spine: spans the gap between post-surf landings.
   * Narrower and placed 1.8m-2.4m below the main line.
   */
  private static createPostSurfSpine(
    id: number,
    a: RouteNode,
    b: RouteNode,
    postSurfStep: number,
    rng: SeededRandom
  ): RouteNode {
    const dx = b.position.x - a.position.x;
    const dz = b.position.z - a.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    const yaw = Math.atan2(dx, dz);
    const midX = (a.position.x + b.position.x) * 0.5;
    const midZ = (a.position.z + b.position.z) * 0.5;

    // Sub-optimal elevation: 1.8m to 2.4m below the lower of the two platforms
    const lowerY = Math.min(a.position.y, b.position.y);
    const spineY = lowerY - 2.0;

    // Span the gap plus generous overlap so no void hole exists between platform and spine
    const spineLength = Math.max(12.0, dist + 4.0);
    // Narrow catch profile (2.8m - 3.4m) vs wide landing (16m - 26m)
    const spineWidth = 3.0;
    const spineThickness = 0.8;

    // Variant selection
    const isShallowSurf = postSurfStep === 0 && (b.position.y < a.position.y - 1.5);
    const variant = isShallowSurf ? 'SHALLOW_SURF' : (postSurfStep % 2 === 1 ? 'OFFSET' : 'STRAIGHT');

    const lateralShift = variant === 'OFFSET' ? (rng.nextBool() ? 3.5 : -3.5) : 0;
    const perpX = Math.cos(yaw) * lateralShift;
    const perpZ = -Math.sin(yaw) * lateralShift;

    const roll = isShallowSurf ? (rng.nextBool() ? 0.52 : -0.52) : 0;
    const pitch = (b.position.y - a.position.y) / Math.max(1.0, dist) * 0.5;

    const surfNormal = isShallowSurf
      ? { x: Math.sin(roll) * Math.cos(yaw), y: Math.cos(roll), z: Math.sin(roll) * -Math.sin(yaw) }
      : undefined;

    return {
      id,
      time: a.time,
      position: { x: midX + perpX, y: spineY, z: midZ + perpZ },
      dimensions: { x: spineWidth, y: spineThickness, z: spineLength },
      yaw,
      pitch,
      roll,
      type: RouteNodeType.RUNWAY,
      intensity: a.intensity * 0.8,
      sectionIndex: a.sectionIndex,
      arcLength: a.arcLength,
      isSurf: isShallowSurf,
      surfNormal,
      isBoost: false,
      isOptional: true,
      isSignalSpine: true,
      signalSpineVariant: variant
    };
  }

  /**
   * Creates an outside-drift catch wing on the first landing directly following surf exit.
   */
  private static createCatchWingSpine(
    id: number,
    surfRamp: RouteNode,
    landing: RouteNode,
    _rng: SeededRandom
  ): RouteNode {
    const yaw = landing.yaw;
    const fwdX = Math.sin(yaw);
    const fwdZ = Math.cos(yaw);
    const rightX = fwdZ;
    const rightZ = -fwdX;

    // Place on the outside curve / surf bank side
    const bankSign = surfRamp.roll > 0 ? 1 : -1;
    const lateralDist = bankSign * (landing.dimensions.x * 0.5 + 2.2);

    const wingLength = Math.max(16.0, landing.dimensions.z * 0.75);
    const wingWidth = 2.8;
    const wingThickness = 0.8;

    return {
      id,
      time: landing.time,
      position: {
        x: landing.position.x + rightX * lateralDist,
        y: landing.position.y - 1.5,
        z: landing.position.z + rightZ * lateralDist
      },
      dimensions: { x: wingWidth, y: wingThickness, z: wingLength },
      yaw,
      pitch: 0,
      roll: 0,
      type: RouteNodeType.RUNWAY,
      intensity: landing.intensity * 0.7,
      sectionIndex: landing.sectionIndex,
      arcLength: landing.arcLength,
      isSurf: false,
      isBoost: false,
      isOptional: true,
      isSignalSpine: true,
      signalSpineVariant: 'CATWALK'
    };
  }

  /**
   * Staircase / Ascent recovery spine: under-slung ribbon running beneath steps.
   */
  private static createStaircaseSpine(
    id: number,
    a: RouteNode,
    b: RouteNode,
    rng: SeededRandom
  ): RouteNode {
    const dx = b.position.x - a.position.x;
    const dz = b.position.z - a.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const yaw = Math.atan2(dx, dz);

    const midX = (a.position.x + b.position.x) * 0.5;
    const midZ = (a.position.z + b.position.z) * 0.5;
    const lowerY = Math.min(a.position.y, b.position.y);
    const spineY = lowerY - 2.0;

    const spineLength = Math.max(8.0, dist + 3.0);
    const spineWidth = 2.6;
    const spineThickness = 0.7;

    const isCurved = Math.abs(b.yaw - a.yaw) > 0.08;
    const variant = isCurved ? 'CURVED' : (rng.nextBool(0.4) ? 'DIP' : 'STRAIGHT');

    const pitch = (b.position.y - a.position.y) / Math.max(1.0, dist) * 0.65;

    return {
      id,
      time: a.time,
      position: { x: midX, y: spineY, z: midZ },
      dimensions: { x: spineWidth, y: spineThickness, z: spineLength },
      yaw,
      pitch,
      roll: 0,
      type: RouteNodeType.RUNWAY,
      intensity: a.intensity * 0.6,
      sectionIndex: a.sectionIndex,
      arcLength: a.arcLength,
      isSurf: false,
      isBoost: false,
      isOptional: true,
      isSignalSpine: true,
      signalSpineVariant: variant
    };
  }

  /**
   * High-speed transfer spine: secondary catch surface under high-velocity gaps.
   */
  private static createHighSpeedTransferSpine(
    id: number,
    a: RouteNode,
    b: RouteNode,
    rng: SeededRandom
  ): RouteNode {
    const dx = b.position.x - a.position.x;
    const dz = b.position.z - a.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const yaw = Math.atan2(dx, dz);

    const midX = (a.position.x + b.position.x) * 0.5;
    const midZ = (a.position.z + b.position.z) * 0.5;
    const lowerY = Math.min(a.position.y, b.position.y);
    const spineY = lowerY - 2.2;

    const spineLength = Math.max(10.0, dist + 2.5);
    const spineWidth = 2.8;
    const spineThickness = 0.7;

    const useOffset = rng.nextBool(0.5);
    const variant = useOffset ? 'OFFSET' : 'STRAIGHT';

    const lateralShift = useOffset ? (rng.nextBool() ? 3.8 : -3.8) : 0;
    const perpX = Math.cos(yaw) * lateralShift;
    const perpZ = -Math.sin(yaw) * lateralShift;

    return {
      id,
      time: a.time,
      position: { x: midX + perpX, y: spineY, z: midZ + perpZ },
      dimensions: { x: spineWidth, y: spineThickness, z: spineLength },
      yaw,
      pitch: 0,
      roll: 0,
      type: RouteNodeType.RUNWAY,
      intensity: a.intensity * 0.7,
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
