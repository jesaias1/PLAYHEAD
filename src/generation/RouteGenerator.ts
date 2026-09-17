/**
 * Procedural route generator mapping musical analysis features into 3D brutalist course nodes
 */

import * as THREE from 'three';
import { OBB } from 'three/examples/jsm/math/OBB.js';
import { TrackAnalysis } from '../audio/AudioFeatures';
import { CheckpointDefinition, FinishDefinition, GeneratedTrack, RouteNode, RouteNodeType, Vector3Like } from './GenerationTypes';
import { RouteValidator } from './RouteValidator';
import { SeededRandom } from './SeededRandom';
import { SurfPlanner } from './SurfPlanner';
import { SurfPhraseGenerator } from './SurfPhraseGenerator';
import { SurfValidator } from './SurfValidator';

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

        } else if (theme === 'BUILDUP') {
          // Buildup: Route narrows and escalates steeply towards the crest
          const steps = 3;
          for (let st = 0; st < steps; st++) {
            const gap = rng.nextFloat(3.5, 5.0);
            const stepLen = 14.0;
            const stepWidth = 9.5; // Widened for forgiving takeoff
            const exitWidth = stepWidth * 1.65; // Substantially widened flared exit width
            const rise = 0.85;

            currentPos = getOffsetPosition(currentPos, currentYaw, gap + stepLen * 0.5);
            currentPos.y += rise;
            cumulativeDistance += gap + stepLen * 0.5;
            sectionCurrentDistance += gap + stepLen * 0.5;

            const buildNode: RouteNode = {
              id: nodeId++,
              time: section.start + (sectionCurrentDistance / sectionTargetDistance) * section.duration,
              position: { ...currentPos },
              dimensions: { x: stepWidth, y: 2.0, z: stepLen },
              exitWidth,
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

            currentPos = getOffsetPosition(currentPos, currentYaw, stepLen * 0.5);
            cumulativeDistance += stepLen * 0.5;
            sectionCurrentDistance += stepLen * 0.5;
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

        } else if (theme === 'ASCENT') {
          // Escalating stepping platforms - flared for high-speed approach and clean takeoff
          const steps = rng.nextInt(2, 3);
          for (let st = 0; st < steps; st++) {
            const gap = rng.nextFloat(3.5, 5.0);
            const stepLen = rng.nextFloat(14.0, 18.0);
            const stepWidth = rng.nextFloat(10.0, 13.0);
            const exitWidth = stepWidth * 1.65;
            const rise = rng.nextFloat(0.5, 0.85);

            currentPos = getOffsetPosition(currentPos, currentYaw, gap + stepLen * 0.5);
            currentPos.y += rise;
            cumulativeDistance += gap + stepLen * 0.5;
            sectionCurrentDistance += gap + stepLen * 0.5;

            const stepNode: RouteNode = {
              id: nodeId++,
              time: section.start + (sectionCurrentDistance / sectionTargetDistance) * section.duration,
              position: { ...currentPos },
              dimensions: { x: stepWidth, y: 2.0, z: stepLen },
              exitWidth,
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

            currentPos = getOffsetPosition(currentPos, currentYaw, stepLen * 0.5);
            cumulativeDistance += stepLen * 0.5;
            sectionCurrentDistance += stepLen * 0.5;
          }

        } else if (theme === 'DESCENT') {
          // Downward leap
          const gap = rng.nextFloat(4.5, 7.5);
          const platLen = rng.nextFloat(16.0, 24.0);
          const platWidth = rng.nextFloat(9.0, 12.0);
          const drop = rng.nextFloat(1.0, 2.0);

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

        } else {
          // Standard / Precision Flow
          const gap = rng.nextFloat(4.0, 7.0);
          const platLen = rng.nextFloat(16.0, 26.0);
          const platWidth = rng.nextFloat(8.0, 13.0);

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
    const optionalRamps = RouteGenerator.generateOptionalSideSurfs(repairedNodes, rng);

    // 6. Generate Subtle Recovery Catch-Shelves under tricky platform sequences
    const recoveryShelves = RouteGenerator.generateRecoveryShelves(repairedNodes, rng);

    return {
      seed: analysis.seed,
      route: repairedNodes,
      optionalRamps,
      recoveryShelves,
      checkpoints,
      finish,
      totalDistance: cumulativeDistance,
      targetDuration: analysis.duration,
      repairedJumpsCount: repairsCount
    };
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

    for (let i = 3; i < nodes.length - 5; i++) {
      if (i - lastRampIndex < 12) continue;
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
      if (dist < 20.0 || dist > 68.0) continue;

      // Target tricky small-platform sequences, rhythm-hop sequences, or step-up ascents
      const isNarrow = (startPlatform.dimensions.x <= 7.0) || (midPlatform.dimensions.x <= 7.0);
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

        const startHalfW = (startPlatform.dimensions.x || 10.0) * 0.5;
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

        // Check bounding box clearance against all nodes within 50m of the ramp
        // Expand bounding box by 1.5m player clearance
        for (let j = 0; j < nodes.length; j++) {
          const node = nodes[j];
          const dxN = node.position.x - midX;
          const dyN = node.position.y - midY;
          const dzN = node.position.z - midZ;
          if (dxN * dxN + dyN * dyN + dzN * dzN > 50 * 50) continue;

          const nodeCenter = new THREE.Vector3(node.position.x, node.position.y, node.position.z);
          const clearance = 1.5;
          const nodeHalfSize = new THREE.Vector3(
            node.dimensions.x * 0.5 + clearance,
            node.dimensions.y * 0.5 + clearance,
            node.dimensions.z * 0.5 + clearance
          );
          const nodeEuler = new THREE.Euler(node.pitch, node.yaw, node.roll, 'YXZ');
          const nodeRotMatrix = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(nodeEuler));
          const nodeOBB = new OBB(nodeCenter, nodeHalfSize, nodeRotMatrix);

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

      if (!isDifficult || rng.next() >= 0.35) continue;

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

      // Positioning: offset sideways by (rng.next() < 0.5 ? 1 : -1) * (a.dimensions.x * 0.5 + 2.4)
      const side = (rng.next() < 0.5 ? 1 : -1);
      const lateralOffset = side * (a.dimensions.x * 0.5 + 2.4);

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

    return {
      seed: analysis.seed,
      route: nodes,
      recoveryShelves: [],
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
