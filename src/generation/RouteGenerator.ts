/**
 * Procedural route generator mapping musical analysis features into 3D brutalist course nodes
 */

import { TrackAnalysis } from '../audio/AudioFeatures';
import { CheckpointDefinition, FinishDefinition, GeneratedTrack, RouteNode, RouteNodeType, Vector3Like } from './GenerationTypes';
import { RouteValidator } from './RouteValidator';
import { SeededRandom } from './SeededRandom';

export class RouteGenerator {
  public static generate(analysis: TrackAnalysis): GeneratedTrack {
    const rng = new SeededRandom(analysis.seed);
    const nodes: RouteNode[] = [];
    const checkpoints: CheckpointDefinition[] = [];

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
            const stepWidth = 7.5; // Narrowed for spatial tension
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
              yaw: currentYaw,
              pitch: 0.05,
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
          // Generate a Surf Ramp sequence
          const surfLen = 30.0;
          const surfWidth = 6.0;
          const bankAngle = (rng.nextBool() ? 1 : -1) * 1.05; // ~60 degree slope

          currentPos = getOffsetPosition(currentPos, currentYaw, 4.0 + surfLen * 0.5);
          currentPos.y += 1.0;
          cumulativeDistance += 4.0 + surfLen * 0.5;
          sectionCurrentDistance += 4.0 + surfLen * 0.5;

          // Compute surf surface normal
          const surfNormal = {
            x: -Math.cos(currentYaw) * Math.sin(bankAngle),
            y: Math.cos(bankAngle),
            z: Math.sin(currentYaw) * Math.sin(bankAngle)
          };

          const surfNode: RouteNode = {
            id: nodeId++,
            time: section.start + (sectionCurrentDistance / sectionTargetDistance) * section.duration,
            position: { ...currentPos },
            dimensions: { x: surfWidth, y: 2.0, z: surfLen },
            yaw: currentYaw,
            pitch: -0.08, // slight downward slope for speed
            roll: bankAngle,
            type: RouteNodeType.SURF_RAMP,
            intensity: section.intensity,
            sectionIndex: sIdx,
            arcLength: cumulativeDistance,
            isSurf: true,
            surfNormal,
            isBoost: false
          };
          nodes.push(surfNode);

          currentPos = getOffsetPosition(currentPos, currentYaw, surfLen * 0.5);
          currentPos.y -= 2.4; // follow surf downward angle
          cumulativeDistance += surfLen * 0.5;
          sectionCurrentDistance += surfLen * 0.5;

          // Mandatory landing platform after surf
          const landLen = 22.0;
          const landWidth = 14.0;
          currentPos = getOffsetPosition(currentPos, currentYaw, 6.0 + landLen * 0.5);
          cumulativeDistance += 6.0 + landLen * 0.5;
          sectionCurrentDistance += 6.0 + landLen * 0.5;

          const landNode: RouteNode = {
            id: nodeId++,
            time: section.start + (sectionCurrentDistance / sectionTargetDistance) * section.duration,
            position: { ...currentPos },
            dimensions: { x: landWidth, y: 2.0, z: landLen },
            yaw: currentYaw,
            pitch: 0,
            roll: 0,
            type: RouteNodeType.LANDING,
            intensity: section.intensity,
            sectionIndex: sIdx,
            arcLength: cumulativeDistance,
            isSurf: false,
            isBoost: false
          };
          nodes.push(landNode);

          currentPos = getOffsetPosition(currentPos, currentYaw, landLen * 0.5);
          cumulativeDistance += landLen * 0.5;
          sectionCurrentDistance += landLen * 0.5;

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
          // Escalating stepping platforms
          const steps = rng.nextInt(2, 3);
          for (let st = 0; st < steps; st++) {
            const gap = rng.nextFloat(3.5, 5.5);
            const stepLen = rng.nextFloat(12.0, 16.0);
            const stepWidth = rng.nextFloat(7.0, 10.0);
            const rise = rng.nextFloat(0.5, 0.9);

            currentPos = getOffsetPosition(currentPos, currentYaw, gap + stepLen * 0.5);
            currentPos.y += rise;
            cumulativeDistance += gap + stepLen * 0.5;
            sectionCurrentDistance += gap + stepLen * 0.5;

            const stepNode: RouteNode = {
              id: nodeId++,
              time: section.start + (sectionCurrentDistance / sectionTargetDistance) * section.duration,
              position: { ...currentPos },
              dimensions: { x: stepWidth, y: 2.0, z: stepLen },
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

    const finish: FinishDefinition = {
      routeNodeId: finishNode.id,
      time: analysis.duration,
      position: { ...finishNode.position },
      yaw: currentYaw
    };

    // 4. Validate and repair route to ensure 100% traversability
    const { repairedNodes, repairsCount } = RouteValidator.validateAndRepair(nodes);

    return {
      seed: analysis.seed,
      route: repairedNodes,
      checkpoints,
      finish,
      totalDistance: cumulativeDistance,
      targetDuration: analysis.duration,
      repairedJumpsCount: repairsCount
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
