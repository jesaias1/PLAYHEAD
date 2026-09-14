/**
 * SurfPhraseGenerator for PLAYHEAD
 * Generates complete, playable, and readable 3D surf modules
 * for procedural courses.
 * - Exact musical timing (approach during riser, ramp entry on downbeat)
 * - Multi-tier vertical descent slides that continue the level on a lower plane
 * - Seamless collision alignment and wide catch decks
 */

import * as THREE from 'three';
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
    // 1. Approach Runway (High-contrast lead-in)
    // Timed 1.5s before event.startTime so player arrives on the ramp exactly on the drop!
    // ==========================================
    const approachLen = 24.0;
    const approachWidth = 16.0;
    currentPos = this.offsetPos(currentPos, currentYaw, 4.0 + approachLen * 0.5);
    arcLength += 4.0 + approachLen * 0.5;

    const approachNode: RouteNode = {
      id: nodeId++,
      time: Math.max(0, event.startTime - 1.5),
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

    // Register a checkpoint at the approach for instant retry if player misses the surf line
    if (event.isSignature || event.type === 'SURF_DROP') {
      checkpointDef = {
        id: event.id * 100,
        routeNodeId: approachNode.id,
        time: Math.max(0, event.startTime - 1.5),
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
        // MONUMENTAL VERTICAL DESCENT SLIDE:
        // Plunges 14m - 18.5m down to a lower deck, and the entire level continues below!
        const rampLen = event.isSignature ? 75.0 : 58.0;
        const rampWidth = 12.0;
        const bankRoll = bankSign * 1.02; // ~58.4 degrees bank
        const pitch = -0.24; // ~13.7 degrees downward plunge

        // Align ramp laterally (bankSign > 0 => ramp on left; bankSign < 0 => ramp on right)
        currentPos = this.offsetPos(currentPos, currentYaw, 2.0 + rampLen * 0.5);
        currentPos = this.offsetLateral(currentPos, currentYaw, bankSign * -3.5);
        currentPos.y += 0.5;
        arcLength += 2.0 + rampLen * 0.5;

        const surfNormal = this.computeNormal(pitch, currentYaw, bankRoll);
        const rampNode: RouteNode = {
          id: nodeId++,
          time: event.startTime, // Exact downbeat / drop timestamp!
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

        // Advance to bottom of the ramp
        currentPos = this.offsetPos(currentPos, currentYaw, rampLen * 0.5);
        currentPos.y += rampLen * pitch; // Drops ~18m or ~14m vertically
        currentPos = this.offsetLateral(currentPos, currentYaw, bankSign * 3.5); // Realign to center
        arcLength += rampLen * 0.5;

        // LOWER-DECK CATCH LANDING (Generous 26m wide speedway continuing the level below)
        const landingLen = 36.0;
        const landingWidth = 26.0;
        currentPos = this.offsetPos(currentPos, currentYaw, 4.0 + landingLen * 0.5);
        currentPos.y -= 0.5;
        arcLength += 4.0 + landingLen * 0.5;

        nodes.push({
          id: nodeId++,
          time: event.startTime + Math.round((rampLen / 20.0) * 10) / 10,
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
        // Two opposing surf ramps with aerial gap transfer and vertical step-down
        const rampLen = 42.0;
        const rampWidth = 10.0;
        const pitch = -0.12; // ~7 degree plunge
        const roll1 = bankSign * 1.04;
        const roll2 = -bankSign * 1.04;

        // Ramp 1
        currentPos = this.offsetPos(currentPos, currentYaw, 2.0 + rampLen * 0.5);
        currentPos = this.offsetLateral(currentPos, currentYaw, bankSign * -3.5);
        arcLength += 2.0 + rampLen * 0.5;

        nodes.push({
          id: nodeId++,
          time: event.startTime,
          position: { ...currentPos },
          dimensions: { x: rampWidth, y: 2.0, z: rampLen },
          yaw: currentYaw,
          pitch,
          roll: roll1,
          type: RouteNodeType.SURF_RAMP,
          intensity: event.intensity,
          sectionIndex: event.sectionIndex,
          arcLength,
          isSurf: true,
          surfNormal: this.computeNormal(pitch, currentYaw, roll1),
          isBoost: false
        });

        currentPos = this.offsetPos(currentPos, currentYaw, rampLen * 0.5);
        currentPos.y += rampLen * pitch; // Drops ~5.0m
        arcLength += rampLen * 0.5;

        // Aerial transfer gap (9m forward, 7m lateral shift to opposite side)
        const transferGap = 9.0;
        currentPos = this.offsetPos(currentPos, currentYaw, transferGap + rampLen * 0.5);
        currentPos = this.offsetLateral(currentPos, currentYaw, -bankSign * 7.0);
        currentPos.y -= 1.0;
        arcLength += transferGap + rampLen * 0.5;

        // Ramp 2
        nodes.push({
          id: nodeId++,
          time: event.startTime + 2.5,
          position: { ...currentPos },
          dimensions: { x: rampWidth, y: 2.0, z: rampLen },
          yaw: currentYaw,
          pitch,
          roll: roll2,
          type: RouteNodeType.SURF_RAMP,
          intensity: event.intensity,
          sectionIndex: event.sectionIndex,
          arcLength,
          isSurf: true,
          surfNormal: this.computeNormal(pitch, currentYaw, roll2),
          isBoost: false
        });

        currentPos = this.offsetPos(currentPos, currentYaw, rampLen * 0.5);
        currentPos.y += rampLen * pitch; // Drops another ~5.0m
        currentPos = this.offsetLateral(currentPos, currentYaw, bankSign * 3.5); // Realign to center
        arcLength += rampLen * 0.5;

        // Catch deck at lower elevation (-11.0m total drop)
        const landingLen = 32.0;
        const landingWidth = 24.0;
        currentPos = this.offsetPos(currentPos, currentYaw, 4.0 + landingLen * 0.5);
        currentPos.y -= 0.5;
        arcLength += 4.0 + landingLen * 0.5;

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
        // Continuous flow surf ramp with moderate elevation drop (-8.5m)
        const rampLen = 55.0;
        const rampWidth = 11.0;
        const pitch = -0.14; // ~8 degree plunge
        const roll = bankSign * 0.98; // ~56.1 degrees bank

        currentPos = this.offsetPos(currentPos, currentYaw, 2.0 + rampLen * 0.5);
        currentPos = this.offsetLateral(currentPos, currentYaw, bankSign * -3.5);
        arcLength += 2.0 + rampLen * 0.5;

        nodes.push({
          id: nodeId++,
          time: event.startTime,
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
          surfNormal: this.computeNormal(pitch, currentYaw, roll),
          isBoost: false
        });

        currentPos = this.offsetPos(currentPos, currentYaw, rampLen * 0.5);
        currentPos.y += rampLen * pitch; // Drops ~7.7m
        currentPos = this.offsetLateral(currentPos, currentYaw, bankSign * 3.5); // Realign to center
        arcLength += rampLen * 0.5;

        const landingLen = 30.0;
        const landingWidth = 22.0;
        currentPos = this.offsetPos(currentPos, currentYaw, 4.0 + landingLen * 0.5);
        currentPos.y -= 0.5;
        arcLength += 4.0 + landingLen * 0.5;

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
      x: pos.x + Math.sin(yaw) * dist,
      y: pos.y,
      z: pos.z + Math.cos(yaw) * dist
    };
  }

  private static offsetLateral(pos: Vector3Like, yaw: number, lateralDist: number): Vector3Like {
    return {
      x: pos.x + Math.cos(yaw) * lateralDist,
      y: pos.y,
      z: pos.z - Math.sin(yaw) * lateralDist
    };
  }

  private static computeNormal(pitch: number, yaw: number, roll: number): Vector3Like {
    const euler = new THREE.Euler(pitch, yaw, roll, 'YXZ');
    const normal = new THREE.Vector3(0, 1, 0).applyEuler(euler).normalize();
    return {
      x: normal.x,
      y: normal.y,
      z: normal.z
    };
  }
}

