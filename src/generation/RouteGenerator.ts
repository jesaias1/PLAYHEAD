/**
 * Procedural route generator mapping musical analysis features into 3D brutalist course nodes
 */

import * as THREE from 'three';
import { OBB } from 'three/examples/jsm/math/OBB.js';
import { TrackAnalysis } from '../audio/AudioFeatures';
import { AscentVariant, CheckpointDefinition, FinishDefinition, GeneratedTrack, RouteNode, RouteNodeType, Vector3Like } from './GenerationTypes';
import { RouteValidator } from './RouteValidator';
import { SeededRandom } from './SeededRandom';
import { SurfPlanner } from './SurfPlanner';
import { SurfPhraseGenerator } from './SurfPhraseGenerator';
import { SurfValidator } from './SurfValidator';
import { getPlatformLateralEnvelope, getPlatformMaxHalfWidth } from './PlatformShape';
import { deriveAscentLandingEnvelope, getAscentTurnRadians } from './AscentFlowGeometry';
import { RouteChallengeGenerator } from './RouteChallengeGenerator';
import { SignalSpineGenerator } from './SignalSpineGenerator';

export const ROUTE_GENERATION_VERSION = 4;

export class RouteGenerator {
  public static generate(analysis: TrackAnalysis): GeneratedTrack {
    const rng = new SeededRandom(analysis.seed);
    const nodes: RouteNode[] = [];
    const checkpoints: CheckpointDefinition[] = [];

    // Plan structured, musically-aligned surf events
    const surfEvents = SurfPlanner.plan(analysis);
    const executedSurfEventIds = new Set<number>();

    // Reference running velocity (metres/second)
    const refSpeed = 16.0;

    let currentPos: Vector3Like = { x: 0, y: 0, z: 0 };
    let currentYaw = 0; // In radians (0 = along +Z axis)
    let cumulativeDistance = 0;
    let nodeId = 0;

    // Velocity-aware platform sizing: track estimated arrival speed for next platform
    let estimatedSpeed = refSpeed;
    let consecutiveNarrow = 0; // Count consecutive narrow platforms for forced recovery

    // 1. Initial Start Platform (Safe orientation, broad runway)
    const startLength = 32.0;
    const startWidth = 14.0;
    const startThickness = 2.0;

    const startNode: RouteNode = {
      id: nodeId++,
      time: 0,
      position: { ...currentPos },
      dimensions: { x: startWidth, y: startThickness, z: startLength },
      yaw: currentYaw,
      pitch: 0,
      roll: 0,
      type: RouteNodeType.RUNWAY,
      intensity: 0.2,
      sectionIndex: 0,
      arcLength: 0,
      isSurf: false,
      isBoost: false
    };
    nodes.push(startNode);

    // Advance position along heading to the front edge of start platform
    currentPos = getOffsetPosition(currentPos, currentYaw, startLength * 0.5);
    cumulativeDistance += startLength * 0.5;

    // 2. Iterate through detected sections
    for (let sIdx = 0; sIdx < analysis.sections.length; sIdx++) {
      const section = analysis.sections[sIdx];
      const isLastSection = sIdx === analysis.sections.length - 1;

      // Place a Checkpoint at each section start (except the very beginning)
      if (sIdx > 0) {
        const cpLength = 16.0;
        const cpWidth = 12.0;
        currentPos = getOffsetPosition(currentPos, currentYaw, 5.0 + cpLength * 0.5);
        cumulativeDistance += 5.0 + cpLength * 0.5;

        const cpNode: RouteNode = {
          id: nodeId++,
          time: section.start,
          position: { ...currentPos },
          dimensions: { x: cpWidth, y: 2.0, z: cpLength },
          yaw: currentYaw,
          pitch: 0,
          roll: 0,
          type: RouteNodeType.CHECKPOINT,
          intensity: section.intensity,
          sectionIndex: sIdx,
          arcLength: cumulativeDistance,
          isSurf: false,
          isBoost: false
        };
        nodes.push(cpNode);

        checkpoints.push({
          id: checkpoints.length,
          routeNodeId: cpNode.id,
          time: section.start,
          position: { ...cpNode.position },
          yaw: currentYaw,
          sectionIndex: sIdx
        });

        currentPos = getOffsetPosition(currentPos, currentYaw, cpLength * 0.5);
        cumulativeDistance += cpLength * 0.5;
      }

      // Generate movement phrases according to section theme
      const sectionTargetDistance = section.duration * refSpeed;
      let sectionCurrentDistance = 0;

      while (sectionCurrentDistance < sectionTargetDistance && (!isLastSection || sectionCurrentDistance < sectionTargetDistance - 40)) {
        // Curve yaw gently
        const yawDelta = (rng.next() - 0.5) * 0.25;
        currentYaw += yawDelta;

        const phraseRoll = rng.next();
        const theme = section.theme;
        const currentNodeTime = section.start + (sectionTargetDistance > 0 ? (sectionCurrentDistance / sectionTargetDistance) * section.duration : 0);
        const isOnboarding = currentNodeTime < 25.0;

        if (isOnboarding) {
          // Onboarding period (first 25 seconds): Wide, forgiving runways (14m width) with gentle gaps (3.0m - 4.2m)
          const gap = rng.nextFloat(3.0, 4.2);
          const platLen = rng.nextFloat(20.0, 28.0);
          const platWidth = 14.0;

          currentPos = getOffsetPosition(currentPos, currentYaw, gap + platLen * 0.5);
          cumulativeDistance += gap + platLen * 0.5;
          sectionCurrentDistance += gap + platLen * 0.5;

          const onboardingNode: RouteNode = {
            id: nodeId++,
            time: currentNodeTime,
            position: { ...currentPos },
            dimensions: { x: platWidth, y: 2.0, z: platLen },
            yaw: currentYaw,
            pitch: 0,
            roll: 0,
            type: RouteNodeType.RUNWAY,
            intensity: Math.min(section.intensity, 0.4),
            sectionIndex: sIdx,
            arcLength: cumulativeDistance,
            isSurf: false,
            isBoost: false
          };
          nodes.push(onboardingNode);

          currentPos = getOffsetPosition(currentPos, currentYaw, platLen * 0.5);
          cumulativeDistance += platLen * 0.5;
          sectionCurrentDistance += platLen * 0.5;
          estimatedSpeed = refSpeed; // Onboarding keeps baseline speed
          consecutiveNarrow = 0;

        } else if (surfEvents.some(e => e.sectionIndex === sIdx && !executedSurfEventIds.has(e.id))) {
          // Dedicated planned musical surf event
          const plannedSurf = surfEvents.find(e => e.sectionIndex === sIdx && !executedSurfEventIds.has(e.id))!;
          executedSurfEventIds.add(plannedSurf.id);

          const phrase = SurfPhraseGenerator.generate(
            plannedSurf,
            currentPos,
            currentYaw,
            cumulativeDistance,
            nodeId,
            rng
          );

          const valRes = SurfValidator.validate(phrase);
          if (valRes.isValid) {
            for (const n of phrase.nodes) {
              nodes.push(n);
            }
            if (phrase.checkpoint && !checkpoints.some(cp => cp.sectionIndex === sIdx)) {
              checkpoints.push(phrase.checkpoint);
            }
            currentPos = phrase.endPos;
            currentYaw = phrase.endYaw;
            const distAdded = phrase.endArcLength - cumulativeDistance;
            cumulativeDistance = phrase.endArcLength;
            sectionCurrentDistance += distAdded;
            nodeId = phrase.nextNodeId;
            estimatedSpeed = Math.max(estimatedSpeed, plannedSurf.entrySpeedTarget || 22.0);
            consecutiveNarrow = 0;
          } else {
            const fallback = SurfValidator.createFallback(
              currentPos,
              currentYaw,
              cumulativeDistance,
              nodeId,
              sIdx,
              currentNodeTime
            );
            for (const n of fallback.nodes) {
              nodes.push(n);
            }
            currentPos = fallback.endPos;
            currentYaw = fallback.endYaw;
            const distAdded = fallback.endArcLength - cumulativeDistance;
            cumulativeDistance = fallback.endArcLength;
            sectionCurrentDistance += distAdded;
            nodeId = fallback.nextNodeId;
            estimatedSpeed = Math.max(estimatedSpeed, 20.0);
            consecutiveNarrow = 0;
          }

        } else if (theme === 'DROP' && sectionCurrentDistance < 20) {
          // Massive Dramatic Drop Event: Colossal downward leap into high-speed boost runway
          const dropGap = 8.0;
          const dropHeight = 3.5;
          const boostLen = 42.0;
          const boostWidth = 16.0;

          currentPos = getOffsetPosition(currentPos, currentYaw, dropGap + boostLen * 0.5);
          currentPos.y -= dropHeight;
          cumulativeDistance += dropGap + boostLen * 0.5;
          sectionCurrentDistance += dropGap + boostLen * 0.5;

          const dropBoostNode: RouteNode = {
            id: nodeId++,
            time: section.start,
            position: { ...currentPos },
            dimensions: { x: boostWidth, y: 2.5, z: boostLen },
            yaw: currentYaw,
            pitch: 0,
            roll: 0,
            type: RouteNodeType.BOOST,
            intensity: 1.0,
            sectionIndex: sIdx,
            arcLength: cumulativeDistance,
            isSurf: false,
            isBoost: true,
            boostSpeed: 14.0
          };
          nodes.push(dropBoostNode);

          currentPos = getOffsetPosition(currentPos, currentYaw, boostLen * 0.5);
          cumulativeDistance += boostLen * 0.5;
          sectionCurrentDistance += boostLen * 0.5;
          estimatedSpeed = Math.max(estimatedSpeed, 14.0 + Math.sqrt(2 * 9.8 * dropHeight) + 10.0);
          consecutiveNarrow = 0;

        } else if (theme === 'BUILDUP') {
          // Buildup: a readable climbing arc with real outside-corner landing room.
          const steps = 3;
          const phraseId = nodeId;
          const variant: AscentVariant = rng.nextBool(0.52) ? 'FLARED_ASCENT' : 'FLOW_STAIR';
          const curveDirection: -1 | 1 = rng.nextBool() ? 1 : -1;
          for (let st = 0; st < steps; st++) {
            const isCatch = st === steps - 1;
            const rise = rng.nextFloat(0.35, 0.48);
            const envelope = deriveAscentLandingEnvelope(
              estimatedSpeed,
              22 + section.intensity * 4,
              rise,
              isCatch,
              variant,
              curveDirection
            );
            const gap = envelope.minimumApproach + rng.nextFloat(0.3, 1.1);
            const nextYaw = currentYaw + curveDirection * getAscentTurnRadians(variant, st, steps);
            const placement = placeAscentLanding(
              currentPos,
              currentYaw,
              nextYaw,
              gap,
              envelope.depth,
              rise,
              envelope.exitLateralOffset
            );
            currentYaw = nextYaw;
            currentPos = placement.center;
            cumulativeDistance += gap + envelope.depth * 0.5;
            sectionCurrentDistance += gap + envelope.depth * 0.5;

            const buildNode: RouteNode = {
              id: nodeId++,
              time: section.start + (sectionCurrentDistance / sectionTargetDistance) * section.duration,
              position: { ...currentPos },
              dimensions: { x: envelope.width, y: 2.0, z: envelope.depth },
              exitWidth: envelope.exitWidth,
              exitLateralOffset: envelope.exitLateralOffset,
              ascentVariant: variant,
              ascentPhraseId: phraseId,
              ascentStepIndex: st,
              ascentStepCount: steps,
              ascentExpectedSpeed: envelope.expectedSpeed,
              ascentMinimumApproach: envelope.minimumApproach,
              ascentPostLandingRunway: envelope.postLandingRunway,
              yaw: currentYaw,
              pitch: 0,
              roll: 0,
              type: RouteNodeType.STEP_UP,
              intensity: 0.8 + (st / steps) * 0.2,
              sectionIndex: sIdx,
              arcLength: cumulativeDistance,
              isSurf: false,
              isBoost: false
            };
            nodes.push(buildNode);

            currentPos = placement.exit;
            cumulativeDistance += envelope.depth * 0.5;
            sectionCurrentDistance += envelope.depth * 0.5;
            estimatedSpeed = envelope.expectedSpeed * 0.96;
            consecutiveNarrow = 0;
          }

        } else if (theme === 'SURF' && phraseRoll < 0.6) {
          // Generate a validated surf phrase
          const phrase = SurfPhraseGenerator.generate(
            {
              id: nodeId,
              sectionIndex: sIdx,
              startTime: currentNodeTime,
              endTime: currentNodeTime + 8.0,
              duration: 8.0,
              type: 'SURF_RELEASE',
              intensity: section.intensity,
              suitability: 0.7,
              entrySpeedTarget: 18.0,
              isSignature: false
            },
            currentPos,
            currentYaw,
            cumulativeDistance,
            nodeId,
            rng
          );
          for (const n of phrase.nodes) {
            nodes.push(n);
          }
          currentPos = phrase.endPos;
          currentYaw = phrase.endYaw;
          const distAdded = phrase.endArcLength - cumulativeDistance;
          cumulativeDistance = phrase.endArcLength;
          sectionCurrentDistance += distAdded;
          nodeId = phrase.nextNodeId;
          estimatedSpeed = Math.max(estimatedSpeed, 20.0);
          consecutiveNarrow = 0;

        } else if (theme === 'SPEED' || (section.intensity > 0.75 && phraseRoll < 0.45)) {
          // Boost Runway
          const gap = rng.nextFloat(4.0, 7.0);
          const padLen = rng.nextFloat(24.0, 36.0);
          const padWidth = 10.0;

          currentPos = getOffsetPosition(currentPos, currentYaw, gap + padLen * 0.5);
          cumulativeDistance += gap + padLen * 0.5;
          sectionCurrentDistance += gap + padLen * 0.5;

          const boostNode: RouteNode = {
            id: nodeId++,
            time: section.start + (sectionCurrentDistance / sectionTargetDistance) * section.duration,
            position: { ...currentPos },
            dimensions: { x: padWidth, y: 2.0, z: padLen },
            yaw: currentYaw,
            pitch: 0,
            roll: 0,
            type: RouteNodeType.BOOST,
            intensity: section.intensity,
            sectionIndex: sIdx,
            arcLength: cumulativeDistance,
            isSurf: false,
            isBoost: true,
            boostSpeed: 10.0
          };
          nodes.push(boostNode);

          currentPos = getOffsetPosition(currentPos, currentYaw, padLen * 0.5);
          cumulativeDistance += padLen * 0.5;
          sectionCurrentDistance += padLen * 0.5;
          estimatedSpeed = Math.max(estimatedSpeed, 10.0 + 10.0); // boostSpeed + momentum
          consecutiveNarrow = 0;

        } else if (theme === 'ASCENT') {
          // Flow ascents trace a gentle curve so natural air-strafes meet broad,
          // flared landing zones instead of a centred staircase.
          const variants: AscentVariant[] = ['FLOW_STAIR', 'FLARED_ASCENT', 'BREATHER_ASCENT', 'OFFSET_ASCENT'];
          const variant = rng.choice(variants);
          const steps = variant === 'BREATHER_ASCENT' ? 4 : rng.nextInt(3, 4);
          const phraseId = nodeId;
          const curveDirection: -1 | 1 = rng.nextBool() ? 1 : -1;
          for (let st = 0; st < steps; st++) {
            const isCatch = st === steps - 1;
            const rise = rng.nextFloat(0.35, 0.48);
            const highSpeedFloor = 26 + section.intensity * 4 + (variant === 'OFFSET_ASCENT' ? 1.5 : 0);
            const envelope = deriveAscentLandingEnvelope(
              estimatedSpeed,
              highSpeedFloor,
              rise,
              isCatch,
              variant,
              curveDirection
            );
            const gap = envelope.minimumApproach + rng.nextFloat(0.4, 1.3);
            const nextYaw = currentYaw + curveDirection * getAscentTurnRadians(variant, st, steps);
            const placement = placeAscentLanding(
              currentPos,
              currentYaw,
              nextYaw,
              gap,
              envelope.depth,
              rise,
              envelope.exitLateralOffset
            );
            currentYaw = nextYaw;
            currentPos = placement.center;
            cumulativeDistance += gap + envelope.depth * 0.5;
            sectionCurrentDistance += gap + envelope.depth * 0.5;

            const stepNode: RouteNode = {
              id: nodeId++,
              time: section.start + (sectionCurrentDistance / sectionTargetDistance) * section.duration,
              position: { ...currentPos },
              dimensions: { x: envelope.width, y: 2.0, z: envelope.depth },
              exitWidth: envelope.exitWidth,
              exitLateralOffset: envelope.exitLateralOffset,
              ascentVariant: variant,
              ascentPhraseId: phraseId,
              ascentStepIndex: st,
              ascentStepCount: steps,
              ascentExpectedSpeed: envelope.expectedSpeed,
              ascentMinimumApproach: envelope.minimumApproach,
              ascentPostLandingRunway: envelope.postLandingRunway,
              yaw: currentYaw,
              pitch: 0,
              roll: 0,
              type: RouteNodeType.STEP_UP,
              intensity: section.intensity,
              sectionIndex: sIdx,
              arcLength: cumulativeDistance,
              isSurf: false,
              isBoost: false
            };
            nodes.push(stepNode);

            currentPos = placement.exit;
            cumulativeDistance += envelope.depth * 0.5;
            sectionCurrentDistance += envelope.depth * 0.5;
            estimatedSpeed = envelope.expectedSpeed * 0.97;
            consecutiveNarrow = 0;
          }

        } else if (theme === 'DESCENT') {
          // Downward leap
          const gap = rng.nextFloat(4.5, 7.5);
          const drop = rng.nextFloat(1.0, 2.0);

          // Velocity-aware: descent adds gravitational speed, widen/lengthen landing platform
          estimatedSpeed = Math.max(estimatedSpeed, refSpeed) + Math.sqrt(2 * 9.8 * drop);
          const speedFactor = Math.max(1.0, estimatedSpeed / refSpeed);
          const widthBoost = Math.min(1.6, speedFactor);
          const lengthBoost = Math.min(1.4, speedFactor * 0.85);
          // Force recovery if too many consecutive narrow platforms
          const forceRecovery = consecutiveNarrow >= 3;

          const basePlatLen = rng.nextFloat(16.0, 24.0);
          const basePlatWidth = rng.nextFloat(9.0, 12.0);
          const platLen = forceRecovery ? Math.max(22.0, basePlatLen * lengthBoost) : basePlatLen * lengthBoost;
          const platWidth = forceRecovery ? Math.max(12.0, basePlatWidth * widthBoost) : basePlatWidth * widthBoost;

          currentPos = getOffsetPosition(currentPos, currentYaw, gap + platLen * 0.5);
          currentPos.y -= drop;
          cumulativeDistance += gap + platLen * 0.5;
          sectionCurrentDistance += gap + platLen * 0.5;

          const descNode: RouteNode = {
            id: nodeId++,
            time: section.start + (sectionCurrentDistance / sectionTargetDistance) * section.duration,
            position: { ...currentPos },
            dimensions: { x: platWidth, y: 2.0, z: platLen },
            yaw: currentYaw,
            pitch: 0,
            roll: 0,
            type: RouteNodeType.STEP_DOWN,
            intensity: section.intensity,
            sectionIndex: sIdx,
            arcLength: cumulativeDistance,
            isSurf: false,
            isBoost: false
          };
          nodes.push(descNode);

          currentPos = getOffsetPosition(currentPos, currentYaw, platLen * 0.5);
          cumulativeDistance += platLen * 0.5;
          sectionCurrentDistance += platLen * 0.5;
          // Speed regresses partially after landing
          estimatedSpeed = estimatedSpeed * 0.9 + refSpeed * 0.1;
          consecutiveNarrow = (platWidth < 10.0) ? consecutiveNarrow + 1 : 0;

        } else {
          // Standard / Precision Flow
          const gap = rng.nextFloat(4.0, 7.0);

          // Velocity-aware: scale platform dimensions based on estimated arrival speed
          const speedFactor = Math.max(1.0, estimatedSpeed / refSpeed);
          const widthBoost = Math.min(1.6, speedFactor);
          const lengthBoost = Math.min(1.4, speedFactor * 0.85);
          // Force recovery if too many consecutive narrow platforms
          const forceRecovery = consecutiveNarrow >= 3;

          const basePlatLen = rng.nextFloat(16.0, 26.0);
          const basePlatWidth = rng.nextFloat(8.0, 13.0);
          const platLen = forceRecovery ? Math.max(22.0, basePlatLen * lengthBoost) : basePlatLen * lengthBoost;
          const platWidth = forceRecovery ? Math.max(12.0, basePlatWidth * widthBoost) : basePlatWidth * widthBoost;

          currentPos = getOffsetPosition(currentPos, currentYaw, gap + platLen * 0.5);
          cumulativeDistance += gap + platLen * 0.5;
          sectionCurrentDistance += gap + platLen * 0.5;

          const flowNode: RouteNode = {
            id: nodeId++,
            time: section.start + (sectionCurrentDistance / sectionTargetDistance) * section.duration,
            position: { ...currentPos },
            dimensions: { x: platWidth, y: 2.0, z: platLen },
            yaw: currentYaw,
            pitch: 0,
            roll: 0,
            type: RouteNodeType.RUNWAY,
            intensity: section.intensity,
            sectionIndex: sIdx,
            arcLength: cumulativeDistance,
            isSurf: false,
            isBoost: false
          };
          nodes.push(flowNode);

          currentPos = getOffsetPosition(currentPos, currentYaw, platLen * 0.5);
          cumulativeDistance += platLen * 0.5;
          sectionCurrentDistance += platLen * 0.5;
          // Speed regresses toward baseline on each standard platform
          estimatedSpeed = estimatedSpeed * 0.7 + refSpeed * 0.3;
          consecutiveNarrow = (platWidth < 10.0) ? consecutiveNarrow + 1 : 0;
        }
      }
    }

    // 3. Monumental Final Structure (Finish Gate)
    const finishLen = 36.0;
    const finishWidth = 20.0;
    currentPos = getOffsetPosition(currentPos, currentYaw, 6.0 + finishLen * 0.5);
    cumulativeDistance += 6.0 + finishLen * 0.5;

    const finishNode: RouteNode = {
      id: nodeId++,
      time: analysis.duration,
      position: { ...currentPos },
      dimensions: { x: finishWidth, y: 3.0, z: finishLen },
      yaw: currentYaw,
      pitch: 0,
      roll: 0,
      type: RouteNodeType.FINISH,
      intensity: 1.0,
      sectionIndex: analysis.sections.length - 1,
      arcLength: cumulativeDistance,
      isSurf: false,
      isBoost: false
    };
    nodes.push(finishNode);

    // 4. Validate and repair route to ensure 100% traversability with rigid downstream propagation
    const { repairedNodes, repairsCount } = RouteValidator.validateAndRepair(nodes);

    // Sync checkpoint and finish coordinates with repaired nodes
    for (const cp of checkpoints) {
      const node = repairedNodes.find(n => n.id === cp.routeNodeId);
      if (node) {
        cp.position = { ...node.position };
        cp.yaw = node.yaw;
      }
    }
    const updatedFinishNode = repairedNodes.find(n => n.id === finishNode.id) || repairedNodes[repairedNodes.length - 1];
    const finish: FinishDefinition = {
      routeNodeId: updatedFinishNode.id,
      time: analysis.duration,
      position: { ...updatedFinishNode.position },
      yaw: updatedFinishNode.yaw
    };

    // 5. Generate Optional Side-Surf Skill Ramps alongside selected platform sequences
    const optionalRampsRaw = RouteGenerator.generateOptionalSideSurfs(repairedNodes, rng);

    // 6. Generate Subtle Recovery Catch-Shelves under tricky platform sequences
    const recoveryShelves = RouteGenerator.generateRecoveryShelves(repairedNodes, rng);

    // 7. Generate Authoritative Signal Spines (procedural recovery layer for post-surf, staircases, and high-speed gaps)
    //
    // Obstacles are generated BEFORE spines so an obstacle section retains a
    // (skinner) recovery spine instead of being left with none. Obstacles stay
    // authoritative gameplay; the adaptive spine layer resolves around them.
    const obstacles = RouteChallengeGenerator.generate(repairedNodes, analysis, {
      recoveryShelves
    });

    const signalSpines = SignalSpineGenerator.generate(repairedNodes, analysis, rng, {
      obstacles
    });

    // 8. FINAL AUTHORITATIVE RAMP CLIPPING VALIDATION
    //
    // Candidate selection earlier in generation reasons about ramps using
    // conservative proxies and the main route only. This pass instead measures
    // the ramp's REAL rotated oriented bounding box against the final geometry
    // of every piece of gameplay it could intersect, and rejects any ramp that
    // genuinely overlaps. Gameplay is never moved to accommodate a ramp.
    const optionalRamps = RouteGenerator.rejectClippingRamps(
      optionalRampsRaw,
      repairedNodes,
      recoveryShelves,
      signalSpines
    );

    return {
      generationVersion: ROUTE_GENERATION_VERSION,
      seed: analysis.seed,
      route: repairedNodes,
      optionalRamps,
      recoveryShelves,
      signalSpines,
      obstacles,
      checkpoints,
      finish,
      totalDistance: cumulativeDistance,
      targetDuration: analysis.duration,
      repairedJumpsCount: repairsCount
    };
  }

  /**
   * Builds an oriented bounding box from a route node's final transform.
   *
   * Honours exitWidth (flared trapezoid ascent platforms) by using the widest
   * footprint, and applies a small negative inflation so that surfaces which
   * merely touch are not treated as intersecting.
   */
  private static nodeOBB(node: RouteNode, inflate = -0.05): OBB {
    const lateral = getPlatformLateralEnvelope(node);
    const halfSize = new THREE.Vector3(
      lateral.halfWidth + inflate,
      node.dimensions.y * 0.5 + inflate,
      node.dimensions.z * 0.5 + inflate
    );
    const euler = new THREE.Euler(node.pitch, node.yaw, node.roll, 'YXZ');
    const rot = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(euler));
    const center = new THREE.Vector3(lateral.centerX, 0, 0)
      .applyEuler(euler)
      .add(new THREE.Vector3(node.position.x, node.position.y, node.position.z));
    return new OBB(center, halfSize, rot);
  }

  /**
   * Rejects optional surf ramps that genuinely intersect other gameplay
   * geometry in final world space.
   *
   * Checks against the main route, mandatory surf, recovery shelves and the
   * other surviving optional ramps (so two ramps cannot overlap each other).
   */
  public static rejectClippingRamps(
    ramps: RouteNode[],
    route: RouteNode[],
    recoveryShelves: RouteNode[] = [],
    signalSpines: RouteNode[] = []
  ): RouteNode[] {
    if (ramps.length === 0) return ramps;

    const routeBoxes = route.map((n) => RouteGenerator.nodeOBB(n));
    const shelfBoxes = recoveryShelves.map((n) => RouteGenerator.nodeOBB(n));
    const spineBoxes = signalSpines.map((n) => RouteGenerator.nodeOBB(n));
    const accepted: RouteNode[] = [];
    const acceptedBoxes: OBB[] = [];

    for (const ramp of ramps) {
      const rampBox = RouteGenerator.nodeOBB(ramp);

      // 1. Main route (includes mandatory surf and flared ascent platforms).
      let clips = false;
      for (const box of routeBoxes) {
        if (box.intersectsOBB(rampBox)) { clips = true; break; }
      }

      // 2. Recovery shelves.
      if (!clips) {
        for (const box of shelfBoxes) {
          if (box.intersectsOBB(rampBox)) { clips = true; break; }
        }
      }

      // 3. Signal Spines.
      if (!clips) {
        for (const box of spineBoxes) {
          if (box.intersectsOBB(rampBox)) { clips = true; break; }
        }
      }

      // 4. Previously accepted optional ramps (ramp vs ramp).
      if (!clips) {
        for (const box of acceptedBoxes) {
          if (box.intersectsOBB(rampBox)) { clips = true; break; }
        }
      }

      if (clips) continue; // REJECT — a ramp may never intersect gameplay

      accepted.push(ramp);
      acceptedBoxes.push(rampBox);
    }

    const rejected = ramps.length - accepted.length;
    if (rejected > 0) {
      console.log(`[RouteGenerator] Rejected ${rejected} optional surf ramp(s) clipping gameplay geometry.`);
    }

    return accepted;
  }

  /**
   * Generates optional side-surf skill lines flanking selected platform sequences.
   * Provides advanced speedrun alternatives that safely reconnect to the main route.
   */
  public static generateOptionalSideSurfs(nodes: RouteNode[], rng: SeededRandom): RouteNode[] {
    const optionalRamps: RouteNode[] = [];
    if (nodes.length < 12) return optionalRamps;

    const maxRamps = Math.min(5, Math.max(3, Math.floor(nodes.length / 16)));
    let lastRampIndex = -999;

    // ------------------------------------------------------------------
    // SIZE-AWARE CANDIDATE CLASSIFICATION
    //
    // Candidate selection must be measured against the route's OWN platform
    // sizing. A fixed "narrow" width threshold silently stops matching as soon
    // as platform dimensions change, which starves ramp generation. Both the
    // narrowness test and the inter-platform span bound are therefore derived
    // from the actual distribution on this route.
    // ------------------------------------------------------------------
    const widths = nodes
      .map((n) => n.dimensions.x || 10.0)
      .slice()
      .sort((a, b) => a - b);
    const medianWidth = widths.length > 0 ? widths[Math.floor(widths.length / 2)] : 10.0;
    // "Narrow" = meaningfully tighter than a typical platform on this course.
    const narrowWidth = Math.max(8.0, medianWidth * 0.82);

    const spanLengths = [];
    for (let i = 0; i < nodes.length - 2; i++) {
      const a = nodes[i];
      const b = nodes[i + 2];
      spanLengths.push(Math.hypot(b.position.x - a.position.x, b.position.z - a.position.z));
    }
    spanLengths.sort((a, b) => a - b);
    // A ramp spans roughly this distance, so cap it near the route's own
    // characteristic 2-platform span rather than a constant that platform
    // sizing changes can invalidate.
    const typicalSpan = spanLengths.length > 0
      ? spanLengths[Math.floor(spanLengths.length * 0.75)]
      : 60.0;
    const maxSpan = Math.min(96.0, Math.max(68.0, typicalSpan * 1.12));

    for (let i = 3; i < nodes.length - 5; i++) {
      // Spacing keeps ramps well apart (contract requires >= 10 nodes apart).
      // Kept at 11 rather than 12 so a short course still has enough discrete
      // slots to reach the 3-ramp minimum when some candidates are rejected
      // for clipping.
      if (i - lastRampIndex < 11) continue;
      if (optionalRamps.length >= maxRamps) break;

      const startPlatform = nodes[i];
      const midPlatform = nodes[i + 1];
      const endPlatform = nodes[i + 2];

      if (
        startPlatform.isSurf || midPlatform.isSurf || endPlatform.isSurf ||
        startPlatform.type === RouteNodeType.FINISH || endPlatform.type === RouteNodeType.FINISH
      ) {
        continue;
      }

      const dy = endPlatform.position.y - startPlatform.position.y;
      if (dy > 3.0 || dy < -16.0) continue;

      const dx = endPlatform.position.x - startPlatform.position.x;
      const dz = endPlatform.position.z - startPlatform.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 20.0 || dist > maxSpan) continue;

      // Target tricky small-platform sequences, rhythm-hop sequences, or step-up ascents
      const isNarrow = (startPlatform.dimensions.x <= narrowWidth) ||
        (midPlatform.dimensions.x <= narrowWidth);
      const isStepUp = startPlatform.type === RouteNodeType.STEP_UP ||
                       midPlatform.type === RouteNodeType.STEP_UP ||
                       endPlatform.type === RouteNodeType.STEP_UP ||
                       dy > 0.2;
      const isRhythmHop = startPlatform.type === RouteNodeType.GAP ||
                          startPlatform.type === RouteNodeType.OFFSET_GAP ||
                          startPlatform.type === RouteNodeType.NARROW_FLOW ||
                          (startPlatform.dimensions.z <= 28.0 && midPlatform.dimensions.z <= 28.0);

      if (!isNarrow && !isStepUp && !isRhythmHop) continue;

      const dirX = dx / dist;
      const dirZ = dz / dist;
      const rampYaw = Math.atan2(dirX, dirZ);

      // SURF_LAUNCH variant (rare, ~20% of ramps) vs standard SIDE_SURF
      const isLaunchVariant = rng.next() < 0.20;
      const rampPitch = isLaunchVariant ? 0.16 : -0.06;
      const rollAngle = isLaunchVariant ? 0.80 : 0.68;
      const boostSpeed = isLaunchVariant ? 24.0 : undefined;

      const rampLength = Math.min(42.0, Math.max(30.0, dist * 0.95));
      const rampWidth = 8.0;
      const rampThickness = 1.2;
      const rampEffectiveHalfW = (rampWidth * 0.5) * Math.cos(rollAngle);
      const edgeGap = 2.8;

      const preferredSide = (rng.next() > 0.5 ? 1 : -1);
      const sidesToTry = [preferredSide, -preferredSide];

      for (const side of sidesToTry) {
        const perpX = -dirZ * side;
        const perpZ = dirX * side;

        const startHalfW = getPlatformMaxHalfWidth(startPlatform);
        const lateralOffset = startHalfW + rampEffectiveHalfW + edgeGap;

        // Strictly guarantee no overlap
        if (lateralOffset - rampEffectiveHalfW < startHalfW + 1.6) {
          continue;
        }

        // Critical orientation: top face tilts inward toward the main course
        const rampRoll = -side * rollAngle;

        const midX = (startPlatform.position.x + endPlatform.position.x) * 0.5 + perpX * lateralOffset;
        const midY = (startPlatform.position.y + endPlatform.position.y) * 0.5 - 0.2;
        const midZ = (startPlatform.position.z + endPlatform.position.z) * 0.5 + perpZ * lateralOffset;

        // Collision & Clearance Envelope Validation:
        // Validate ramp 3D bounds against all nearby main route nodes
        const rampCenter = new THREE.Vector3(midX, midY, midZ);
        const rampHalfSize = new THREE.Vector3(rampWidth * 0.5, rampThickness * 0.5, rampLength * 0.5);
        const rampFullEuler = new THREE.Euler(rampPitch, rampYaw, rampRoll, 'YXZ');
        const rampRotMatrix = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(rampFullEuler));
        const rampOBB = new OBB(rampCenter, rampHalfSize, rampRotMatrix);

        let hasCollision = false;

        // Exact oriented-box clipping test against every route node.
        //
        // A previous proximity gate only considered nodes within 50m of the
        // ramp's CENTRE, but a ramp is up to 42m long — so route platforms near
        // its ends were never tested and the ramp could cut straight through
        // them. The gate is replaced by a correct broad phase: the ramp's own
        // bounding sphere against each node's bounding sphere, which is cheap
        // and cannot miss a real overlap.
        const rampHalfDiag = Math.hypot(rampWidth * 0.5, rampThickness * 0.5, rampLength * 0.5);

        for (let j = 0; j < nodes.length; j++) {
          const node = nodes[j];

          // Broad phase: skip nodes whose bounding sphere cannot reach ours.
          const nodeHalfDiag = Math.hypot(
            getPlatformMaxHalfWidth(node),
            node.dimensions.y * 0.5,
            node.dimensions.z * 0.5
          );
          const reach = rampHalfDiag + nodeHalfDiag + 2.0;
          const dxN = node.position.x - midX;
          const dyN = node.position.y - midY;
          const dzN = node.position.z - midZ;
          if (dxN * dxN + dyN * dyN + dzN * dzN > reach * reach) continue;

          const nodeEuler = new THREE.Euler(node.pitch, node.yaw, node.roll, 'YXZ');
          const nodeRotMatrix = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(nodeEuler));

          // Honour the flared trapezoid exit width of ascent platforms, and keep
          // the intended 1.5m player clearance margin around route geometry so a
          // ramp never clips or brushes the course.
          const CLEARANCE = 1.5;
          const lateral = getPlatformLateralEnvelope(node);
          const nodeHalfSize = new THREE.Vector3(
            lateral.halfWidth + CLEARANCE,
            node.dimensions.y * 0.5 + CLEARANCE,
            node.dimensions.z * 0.5 + CLEARANCE
          );
          const nodeCenter = new THREE.Vector3(lateral.centerX, 0, 0)
            .applyEuler(nodeEuler)
            .add(new THREE.Vector3(node.position.x, node.position.y, node.position.z));
          const nodeOBB = new OBB(
            nodeCenter,
            nodeHalfSize,
            nodeRotMatrix
          );

          if (rampOBB.intersectsOBB(nodeOBB)) {
            hasCollision = true;
            break;
          }
        }

        // Check clearance against already placed optional ramps
        if (!hasCollision) {
          for (const existingRamp of optionalRamps) {
            const dxR = existingRamp.position.x - midX;
            const dyR = existingRamp.position.y - midY;
            const dzR = existingRamp.position.z - midZ;
            if (dxR * dxR + dyR * dyR + dzR * dzR > 50 * 50) continue;

            const existCenter = new THREE.Vector3(existingRamp.position.x, existingRamp.position.y, existingRamp.position.z);
            const existHalfSize = new THREE.Vector3(
              existingRamp.dimensions.x * 0.5,
              existingRamp.dimensions.y * 0.5,
              existingRamp.dimensions.z * 0.5
            );
            const existEuler = new THREE.Euler(existingRamp.pitch, existingRamp.yaw, existingRamp.roll, 'YXZ');
            const existRotMatrix = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(existEuler));
            const existOBB = new OBB(existCenter, existHalfSize, existRotMatrix);

            if (rampOBB.intersectsOBB(existOBB)) {
              hasCollision = true;
              break;
            }
          }
        }

        if (hasCollision) {
          continue;
        }

        // Compute surfNormal facing inward toward the main course
        const normalLocal = new THREE.Vector3(side * Math.sin(rollAngle), Math.cos(rollAngle), 0);
        const euler = new THREE.Euler(rampPitch, rampYaw, 0, 'YXZ');
        const surfNormal = normalLocal.applyEuler(euler).normalize();

        optionalRamps.push({
          id: 90000 + optionalRamps.length,
          time: startPlatform.time,
          position: { x: midX, y: midY, z: midZ },
          dimensions: { x: rampWidth, y: rampThickness, z: rampLength },
          yaw: rampYaw,
          pitch: rampPitch,
          roll: rampRoll,
          type: RouteNodeType.SURF_RAMP,
          intensity: startPlatform.intensity,
          sectionIndex: startPlatform.sectionIndex,
          arcLength: startPlatform.arcLength,
          isSurf: true,
          isBoost: isLaunchVariant,
          boostSpeed,
          isOptional: true,
          isLaunchVariant,
          surfNormal: { x: surfNormal.x, y: surfNormal.y, z: surfNormal.z }
        });

        lastRampIndex = i;
        break;
      }
    }

    return optionalRamps;
  }

  /**
   * Generates rare, isolated recovery catch-shelves beneath genuinely difficult platform gaps.
   * Shelves are small, compact, laterally offset, and positioned well below landing platforms
   * to ensure missed straight-down falls plunge into the void.
   */
  public static generateRecoveryShelves(nodes: RouteNode[], rng: SeededRandom): RouteNode[] {
    const shelves: RouteNode[] = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i];
      const b = nodes[i + 1];
      if (a.isSurf || b.isSurf || a.type === RouteNodeType.FINISH || b.type === RouteNodeType.FINISH) continue;

      const dx = b.position.x - a.position.x;
      const dz = b.position.z - a.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // Only generate rare, small, isolated recovery catch-shelves around genuinely difficult sections:
      // - Difficult small-platform chains (a.dimensions.x <= 4.5 && b.dimensions.x <= 4.5) OR
      // - High-gap / small-landing combinations (dist > 7.0 && b.dimensions.x <= 5.0) OR
      // - Tricky uphill steps (a.type === RouteNodeType.STEP_UP && dist > 5.5)
      const isDifficult = (
        (a.dimensions.x <= 4.5 && b.dimensions.x <= 4.5) ||
        (dist > 7.0 && b.dimensions.x <= 5.0) ||
        (a.type === RouteNodeType.STEP_UP && dist > 5.5)
      );

      if (!isDifficult || rng.next() >= 0.18) continue;

      // Small, compact shelf dimensions (width = 3.2m, height = 0.8m, length = 4.5m)
      const shelfWidth = 3.2;
      const shelfHeight = 0.8;
      const shelfLength = 4.5;

      // Perpendicular (sideways) direction relative to trajectory
      let perpX: number;
      let perpZ: number;
      if (dist > 0.001) {
        perpX = -dz / dist;
        perpZ = dx / dist;
      } else {
        perpX = Math.cos(a.yaw);
        perpZ = -Math.sin(a.yaw);
      }

      // Positioning: clearly BESIDE the route, not beneath the fall line.
      //
      // A shelf only just past the platform edge still catches a player who
      // simply misses an ordinary gap, which turns recovery geometry into a
      // safety net under the course. Pushing it a further few metres sideways
      // means reaching it requires a deliberate lateral move, so an ordinary
      // miss keeps falling toward the true void as intended.
      const side = (rng.next() < 0.5 ? 1 : -1);
      const maxHalfWidth = Math.max(a.dimensions.x, b.dimensions.x) * 0.5;
      const lateralOffset = side * (maxHalfWidth + 7.5);

      const shelfPos = {
        x: (a.position.x + b.position.x) * 0.5 + perpX * lateralOffset,
        y: b.position.y - 4.5,
        z: (a.position.z + b.position.z) * 0.5 + perpZ * lateralOffset
      };

      shelves.push({
        id: 80000 + shelves.length,
        time: a.time,
        position: shelfPos,
        dimensions: { x: shelfWidth, y: shelfHeight, z: shelfLength },
        yaw: a.yaw,
        pitch: 0,
        roll: 0,
        type: RouteNodeType.RUNWAY,
        intensity: a.intensity * 0.5,
        sectionIndex: a.sectionIndex,
        arcLength: a.arcLength,
        isSurf: false,
        isBoost: false,
        isOptional: true,
        isRecoveryShelf: true
      });
    }
    return shelves;
  }

  /**
   * Guaranteed safe fallback route generator
   * Used as the last-resort defensive layer if procedural generation fails validation.
   * Produces a clean, 100% traversable course matching all song sections and timestamps.
   */
  public static generateSafeFallback(analysis: TrackAnalysis): GeneratedTrack {
    const nodes: RouteNode[] = [];
    const checkpoints: CheckpointDefinition[] = [];
    let currentPos: Vector3Like = { x: 0, y: 0, z: 0 };
    let currentYaw = 0;
    let cumulativeDistance = 0;
    let nodeId = 0;

    const startLen = 32.0;
    const startWidth = 14.0;
    nodes.push({
      id: nodeId++,
      time: 0,
      position: { ...currentPos },
      dimensions: { x: startWidth, y: 2.0, z: startLen },
      yaw: currentYaw,
      pitch: 0,
      roll: 0,
      type: RouteNodeType.RUNWAY,
      intensity: 0.3,
      sectionIndex: 0,
      arcLength: 0,
      isSurf: false,
      isBoost: false
    });

    currentPos = getOffsetPosition(currentPos, currentYaw, startLen * 0.5);
    cumulativeDistance += startLen * 0.5;

    for (let s = 0; s < analysis.sections.length; s++) {
      const sec = analysis.sections[s];

      if (s > 0) {
        const cpLen = 16.0;
        currentPos = getOffsetPosition(currentPos, currentYaw, 4.0 + cpLen * 0.5);
        cumulativeDistance += 4.0 + cpLen * 0.5;

        const cpNode: RouteNode = {
          id: nodeId++,
          time: sec.start,
          position: { ...currentPos },
          dimensions: { x: 12.0, y: 2.0, z: cpLen },
          yaw: currentYaw,
          pitch: 0,
          roll: 0,
          type: RouteNodeType.CHECKPOINT,
          intensity: sec.intensity,
          sectionIndex: s,
          arcLength: cumulativeDistance,
          isSurf: false,
          isBoost: false
        };
        nodes.push(cpNode);
        checkpoints.push({
          id: checkpoints.length,
          routeNodeId: cpNode.id,
          time: sec.start,
          position: { ...cpNode.position },
          yaw: currentYaw,
          sectionIndex: s
        });

        currentPos = getOffsetPosition(currentPos, currentYaw, cpLen * 0.5);
        cumulativeDistance += cpLen * 0.5;
      }

      const count = Math.max(2, Math.floor(sec.duration / 4.0));
      const platLen = 22.0;
      const gap = 3.5;

      for (let p = 0; p < count; p++) {
        currentPos = getOffsetPosition(currentPos, currentYaw, gap + platLen * 0.5);
        cumulativeDistance += gap + platLen * 0.5;

        const pTime = sec.start + (p / count) * sec.duration;
        nodes.push({
          id: nodeId++,
          time: pTime,
          position: { ...currentPos },
          dimensions: { x: 12.0, y: 2.0, z: platLen },
          yaw: currentYaw,
          pitch: 0,
          roll: 0,
          type: RouteNodeType.RUNWAY,
          intensity: sec.intensity,
          sectionIndex: s,
          arcLength: cumulativeDistance,
          isSurf: false,
          isBoost: false
        });

        currentPos = getOffsetPosition(currentPos, currentYaw, platLen * 0.5);
        cumulativeDistance += platLen * 0.5;
      }
    }

    // Finish portal
    const finishLen = 24.0;
    currentPos = getOffsetPosition(currentPos, currentYaw, 5.0 + finishLen * 0.5);
    cumulativeDistance += 5.0 + finishLen * 0.5;

    const finishNode: RouteNode = {
      id: nodeId++,
      time: analysis.duration,
      position: { ...currentPos },
      dimensions: { x: 14.0, y: 2.0, z: finishLen },
      yaw: currentYaw,
      pitch: 0,
      roll: 0,
      type: RouteNodeType.FINISH,
      intensity: 1.0,
      sectionIndex: analysis.sections.length - 1,
      arcLength: cumulativeDistance,
      isSurf: false,
      isBoost: false
    };
    nodes.push(finishNode);

    const finish: FinishDefinition = {
      routeNodeId: finishNode.id,
      time: analysis.duration,
      position: { ...finishNode.position },
      yaw: currentYaw
    };

    const obstacles = RouteChallengeGenerator.generate(nodes, analysis);
    return {
      generationVersion: ROUTE_GENERATION_VERSION,
      seed: analysis.seed,
      route: nodes,
      recoveryShelves: [],
      signalSpines: [],
      obstacles,
      checkpoints,
      finish,
      totalDistance: cumulativeDistance,
      targetDuration: analysis.duration,
      repairedJumpsCount: 0
    };
  }
}

function getOffsetPosition(origin: Vector3Like, yaw: number, distance: number): Vector3Like {
  return {
    x: origin.x + Math.sin(yaw) * distance,
    y: origin.y,
    z: origin.z + Math.cos(yaw) * distance
  };
}

function placeAscentLanding(
  origin: Vector3Like,
  arrivalYaw: number,
  landingYaw: number,
  gap: number,
  depth: number,
  rise: number,
  exitLateralOffset: number
): { center: Vector3Like; exit: Vector3Like } {
  // Travel through the gap on the arc tangent, then align the long landing deck
  // with the velocity direction at contact. This prevents the platform from
  // presenting a perpendicular wall to a committed strafe.
  const approachYaw = arrivalYaw + (landingYaw - arrivalYaw) * 0.55;
  const entry = getOffsetPosition(origin, approachYaw, gap);
  const center = getOffsetPosition(entry, landingYaw, depth * 0.5);
  center.y = origin.y + rise;

  const exit = getOffsetPosition(center, landingYaw, depth * 0.5);
  exit.x += Math.cos(landingYaw) * exitLateralOffset;
  exit.z -= Math.sin(landingYaw) * exitLateralOffset;
  return { center, exit };
}
