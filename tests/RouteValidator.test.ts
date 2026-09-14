import { describe, it, expect } from 'vitest';
import { RouteValidator, DEFAULT_VALIDATION_CONFIG } from '../src/generation/RouteValidator';
import { RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';

describe('RouteValidator', () => {
  it('calculates realistic max jump distance', () => {
    // Jump with 0 elevation delta
    const flatGap = RouteValidator.calculateMaxJumpDistance(0, DEFAULT_VALIDATION_CONFIG);
    // With vY = 8.5, g = 22, tAir = 2 * 8.5 / 22 ~= 0.77s. With vX = 14 and safety 0.8 => ~8.6m
    expect(flatGap).toBeGreaterThan(6.0);
    expect(flatGap).toBeLessThan(12.0);

    // Jump to impossible height
    const impossibleHighGap = RouteValidator.calculateMaxJumpDistance(10.0, DEFAULT_VALIDATION_CONFIG);
    expect(impossibleHighGap).toBe(0);
  });

  it('repairs an impossibly wide gap by pulling the landing closer', () => {
    const nodeA: RouteNode = {
      id: 0,
      time: 0,
      position: { x: 0, y: 0, z: 0 },
      dimensions: { x: 10, y: 2, z: 20 },
      yaw: 0,
      pitch: 0,
      roll: 0,
      type: RouteNodeType.RUNWAY,
      intensity: 0.5,
      sectionIndex: 0,
      arcLength: 0,
      isSurf: false,
      isBoost: false
    };

    // Node B is placed 40 metres ahead (impossible jump of ~30m gap)
    const nodeB: RouteNode = {
      id: 1,
      time: 2,
      position: { x: 0, y: 0, z: 50 },
      dimensions: { x: 10, y: 2, z: 20 },
      yaw: 0,
      pitch: 0,
      roll: 0,
      type: RouteNodeType.RUNWAY,
      intensity: 0.5,
      sectionIndex: 0,
      arcLength: 50,
      isSurf: false,
      isBoost: false
    };

    const { repairedNodes, repairsCount } = RouteValidator.validateAndRepair([nodeA, nodeB]);

    expect(repairsCount).toBeGreaterThan(0);
    // Node B should be pulled much closer
    expect(repairedNodes[1].position.z).toBeLessThan(35);
  });

  it('lowers landing if upward step exceeds max safe step-up', () => {
    const nodeA: RouteNode = {
      id: 0, time: 0, position: { x: 0, y: 0, z: 0 },
      dimensions: { x: 10, y: 2, z: 10 }, yaw: 0, pitch: 0, roll: 0,
      type: RouteNodeType.RUNWAY, intensity: 0.5, sectionIndex: 0,
      arcLength: 0, isSurf: false, isBoost: false
    };

    // Node B is 5 metres higher
    const nodeB: RouteNode = {
      id: 1, time: 1, position: { x: 0, y: 5.0, z: 15 },
      dimensions: { x: 10, y: 2, z: 10 }, yaw: 0, pitch: 0, roll: 0,
      type: RouteNodeType.STEP_UP, intensity: 0.5, sectionIndex: 0,
      arcLength: 15, isSurf: false, isBoost: false
    };

    const { repairedNodes, repairsCount } = RouteValidator.validateAndRepair([nodeA, nodeB]);

    expect(repairsCount).toBeGreaterThan(0);
    expect(repairedNodes[1].position.y).toBeLessThanOrEqual(DEFAULT_VALIDATION_CONFIG.maxStepUp + 0.1);
  });
});
