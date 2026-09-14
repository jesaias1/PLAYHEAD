/**
 * SurfPhraseGenerator for PLAYHEAD
 * Generates complete, playable, and readable 3D surf modules
 * for procedural courses.
 */

import { CheckpointDefinition, RouteNode, RouteNodeType, Vector3Like } from './GenerationTypes';
import { SurfEvent } from './SurfPlanner';
import { SeededRandom } from './SeededRandom';

export interface GeneratedSurfPhrase {
  nodes: RouteNode[];
  checkpoint?: CheckpointDefinition;
  endPos: Vector3Like;
  endYaw: number;
  endArcLength: number;
  nextNodeId: number;
}

export class SurfPhraseGenerator {
  /**
   * Generate a complete surf phrase sequence
   */
  public static generate(
    event: SurfEvent,
    startPos: Vector3Like,
    startYaw: number,
    startArcLength: number,
    startNodeId: number,
    rng: SeededRandom
  ): GeneratedSurfPhrase {
    const nodes: RouteNode[] = [];
    let currentPos: Vector3Like = { ...startPos };
    let currentYaw = startYaw;
    let arcLength = startArcLength;
    let nodeId = startNodeId;
    let checkpointDef: CheckpointDefinition | undefined;

    const bankSign = rng.nextBool() ? 1 : -1;

    // ==========================================
    // 1. Approach Runway (Clear, wide, readable setup)
    // ==========================================
    const approachLen = 22.0;
    const approachWidth = 14.0;
    currentPos = this.offsetPos(currentPos, currentYaw, 4.0 + approachLen * 0.5);
    arcLength += 4.0 + approachLen * 0.5;

    const approachNode: RouteNode = {
      id: nodeId++,
      time: event.startTime,
      position: { ...currentPos },
      dimensions: { x: approachWidth, y: 2.0, z: approachLen },
      yaw: currentYaw,
      pitch: 0,
      roll: 0,
      type: RouteNodeType.SURF_APPROACH,
      intensity: event.intensity,
      sectionIndex: event.sectionIndex,
      arcLength,
      isSurf: false,
      isBoost: false
    };
    nodes.push(approachNode);

    // If signature surf, register a checkpoint at the approach for instant replay
    if (event.isSignature || event.type === 'SURF_DROP') {
      checkpointDef = {
        id: event.id * 100,
        routeNodeId: approachNode.id,
        time: event.startTime,
        position: { ...approachNode.position },
        yaw: currentYaw,
        sectionIndex: event.sectionIndex
      };
    }

    currentPos = this.offsetPos(currentPos, currentYaw, approachLen * 0.5);
    arcLength += approachLen * 0.5;

    // ==========================================
    // 2. Generate Specific Phrase Type Geometry
    // ==========================================
    switch (event.type) {
      case 'SURF_DROP': {
        // Showcase drop surf: long dramatic sweep with generous landing
        const rampLen = event.isSignature ? 65.0 : 45.0;
        const rampWidth = 10.0;
        const bankRoll = bankSign * 1.02; // ~58 degrees
        const pitch = -0.07; // downward slope

        currentPos = this.offsetPos(currentPos, currentYaw, 2.0 + rampLen * 0.5);
        currentPos.y += 0.5;
        arcLength += 2.0 + rampLen * 0.5;

        const surfNormal = this.computeNormal(currentYaw, bankRoll);
        const rampNode: RouteNode = {
          id: nodeId++,
          time: event.startTime + 1.5,
          position: { ...currentPos },
          dimensions: { x: rampWidth, y: 2.0, z: rampLen },
          yaw: currentYaw,
          pitch,
          roll: bankRoll,
          type: RouteNodeType.SURF_RAMP,
          intensity: event.intensity,
          sectionIndex: event.sectionIndex,
          arcLength,
          isSurf: true,
          surfNormal,
          isBoost: false
        };
        nodes.push(rampNode);

        currentPos = this.offsetPos(currentPos, currentYaw, rampLen * 0.5);
        currentPos.y += rampLen * pitch;
        arcLength += rampLen * 0.5;

        // Massive landing plain
        const landingLen = 32.0;
        const landingWidth = 24.0;
        currentPos = this.offsetPos(currentPos, currentYaw, 6.0 + landingLen * 0.5);
        currentPos.y -= 1.0;
        arcLength += 6.0 + landingLen * 0.5;

        nodes.push({
          id: nodeId++,
          time: event.endTime,
          position: { ...currentPos },
          dimensions: { x: landingWidth, y: 2.0, z: landingLen },
          yaw: currentYaw,
          pitch: 0,
          roll: 0,
          type: RouteNodeType.LANDING,
          intensity: event.intensity,
          sectionIndex: event.sectionIndex,
          arcLength,
          isSurf: false,
          isBoost: false
        });

        currentPos = this.offsetPos(currentPos, currentYaw, landingLen * 0.5);
        arcLength += landingLen * 0.5;
        break;
      }

      case 'SURF_TRANSFER': {
        // Two ramps with aerial transfer gap
        const rampLen = 38.0;
        const rampWidth = 9.0;
        const roll1 = bankSign * 1.04;
        const roll2 = -bankSign * 1.04;

        // Ramp 1
        currentPos = this.offsetPos(currentPos, currentYaw, 2.0 + rampLen * 0.5);
        currentPos.x += bankSign * 3.0;
        arcLength += 2.0 + rampLen * 0.5;

        nodes.push({
          id: nodeId++,
          time: event.startTime + 1.0,
          position: { ...currentPos },
          dimensions: { x: rampWidth, y: 2.0, z: rampLen },
          yaw: currentYaw,
          pitch: -0.06,
          roll: roll1,
          type: RouteNodeType.SURF_RAMP,
          intensity: event.intensity,
          sectionIndex: event.sectionIndex,
          arcLength,
          isSurf: true,
          surfNormal: this.computeNormal(currentYaw, roll1),
          isBoost: false
        });

        currentPos = this.offsetPos(currentPos, currentYaw, rampLen * 0.5);
        currentPos.y -= rampLen * 0.06;
        arcLength += rampLen * 0.5;

        // Transfer gap: 10m forward, 6m lateral shift to opposite side
        const transferGap = 10.0;
        currentPos = this.offsetPos(currentPos, currentYaw, transferGap + rampLen * 0.5);
        currentPos.x -= bankSign * 6.0;
        arcLength += transferGap + rampLen * 0.5;

        // Ramp 2
        nodes.push({
          id: nodeId++,
          time: event.startTime + 2.8,
          position: { ...currentPos },
          dimensions: { x: rampWidth, y: 2.0, z: rampLen },
          yaw: currentYaw,
          pitch: -0.06,
          roll: roll2,
          type: RouteNodeType.SURF_RAMP,
          intensity: event.intensity,
          sectionIndex: event.sectionIndex,
          arcLength,
          isSurf: true,
          surfNormal: this.computeNormal(currentYaw, roll2),
          isBoost: false
        });

        currentPos = this.offsetPos(currentPos, currentYaw, rampLen * 0.5);
        currentPos.y -= rampLen * 0.06;
        arcLength += rampLen * 0.5;

        // Catch deck
        const landingLen = 28.0;
        const landingWidth = 22.0;
        currentPos = this.offsetPos(currentPos, currentYaw, 6.0 + landingLen * 0.5);
        currentPos.x += bankSign * 3.0;
        arcLength += 6.0 + landingLen * 0.5;

        nodes.push({
          id: nodeId++,
          time: event.endTime,
          position: { ...currentPos },
          dimensions: { x: landingWidth, y: 2.0, z: landingLen },
          yaw: currentYaw,
          pitch: 0,
          roll: 0,
          type: RouteNodeType.LANDING,
          intensity: event.intensity,
          sectionIndex: event.sectionIndex,
          arcLength,
          isSurf: false,
          isBoost: false
        });

        currentPos = this.offsetPos(currentPos, currentYaw, landingLen * 0.5);
        arcLength += landingLen * 0.5;
        break;
      }

      case 'SURF_RELEASE':
      case 'SURF_CANYON':
      case 'SURF_CHAIN':
      default: {
        // Continuous flow ramp
        const rampLen = 42.0;
        const rampWidth = 10.0;
        const roll = bankSign * 1.0;
        const pitch = -0.06;

        currentPos = this.offsetPos(currentPos, currentYaw, 2.0 + rampLen * 0.5);
        arcLength += 2.0 + rampLen * 0.5;

        nodes.push({
          id: nodeId++,
          time: event.startTime + 1.2,
          position: { ...currentPos },
          dimensions: { x: rampWidth, y: 2.0, z: rampLen },
          yaw: currentYaw,
          pitch,
          roll,
          type: RouteNodeType.SURF_RAMP,
          intensity: event.intensity,
          sectionIndex: event.sectionIndex,
          arcLength,
          isSurf: true,
          surfNormal: this.computeNormal(currentYaw, roll),
          isBoost: false
        });

        currentPos = this.offsetPos(currentPos, currentYaw, rampLen * 0.5);
        currentPos.y += rampLen * pitch;
        arcLength += rampLen * 0.5;

        const landingLen = 26.0;
        const landingWidth = 20.0;
        currentPos = this.offsetPos(currentPos, currentYaw, 6.0 + landingLen * 0.5);
        arcLength += 6.0 + landingLen * 0.5;

        nodes.push({
          id: nodeId++,
          time: event.endTime,
          position: { ...currentPos },
          dimensions: { x: landingWidth, y: 2.0, z: landingLen },
          yaw: currentYaw,
          pitch: 0,
          roll: 0,
          type: RouteNodeType.LANDING,
          intensity: event.intensity,
          sectionIndex: event.sectionIndex,
          arcLength,
          isSurf: false,
          isBoost: false
        });

        currentPos = this.offsetPos(currentPos, currentYaw, landingLen * 0.5);
        arcLength += landingLen * 0.5;
        break;
      }
    }

    return {
      nodes,
      checkpoint: checkpointDef,
      endPos: currentPos,
      endYaw: currentYaw,
      endArcLength: arcLength,
      nextNodeId: nodeId
    };
  }

  private static offsetPos(pos: Vector3Like, yaw: number, dist: number): Vector3Like {
    return {
      x: pos.x - Math.sin(yaw) * dist,
      y: pos.y,
      z: pos.z + Math.cos(yaw) * dist
    };
  }

  private static computeNormal(yaw: number, roll: number): Vector3Like {
    return {
      x: -Math.cos(yaw) * Math.sin(roll),
      y: Math.cos(roll),
      z: Math.sin(yaw) * Math.sin(roll)
    };
  }
}
