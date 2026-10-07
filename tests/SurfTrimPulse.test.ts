import { expect, it } from 'vitest';
import { surfTrimPulse } from '../src/world/SurfTrimPulse';
import { GameState, StateMachine } from '../src/core/StateMachine';

it('allows a ready song to regenerate its variant and become ready again', () => {
  const machine = new StateMachine(GameState.READY);
  expect(machine.transitionTo(GameState.ANALYSING)).toBe(true);
  expect(machine.transitionTo(GameState.READY)).toBe(true);
});

it('keeps beat response visible and bounded, respects effects and reduced motion', () => {
  const rest = surfTrimPulse(0, 0, 1, false);
  const hit = surfTrimPulse(1, 1, 1, false);
  expect(hit.opacity).toBeGreaterThan(rest.opacity);
  expect(hit.opacity).toBeLessThanOrEqual(1);
  expect(hit.mix).toBeLessThan(0.4);
  expect(surfTrimPulse(1, 1, 0, false)).toEqual(rest);
  expect(surfTrimPulse(1, 0, 1, true)).toEqual(surfTrimPulse(0, 0, 1, true));
});
