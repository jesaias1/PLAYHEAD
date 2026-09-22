import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  SignalGateDefinition,
  SignalGateSequence,
  detectGateCrossing,
  makeGateRuntime
} from '../src/gates/SignalGate';
import { SignalGateSystem } from '../src/gates/SignalGateSystem';
import { PlayerController } from '../src/player/PlayerController';

function gate(overrides: Partial<SignalGateDefinition> = {}): SignalGateDefinition {
  return {
    id: 'G',
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    width: 6,
    height: 5,
    sequenceIndex: 0,
    ...overrides
  };
}

function crossing(
  g: ReturnType<typeof makeGateRuntime>,
  prev: [number, number, number],
  cur: [number, number, number],
  speedUnits = 1600
) {
  return detectGateCrossing(g, {
    prevX: prev[0], prevY: prev[1], prevZ: prev[2],
    curX: cur[0], curY: cur[1], curZ: cur[2],
    speedUnits
  });
}

describe('Signal Gates — swept crossing detection', () => {
  it('triggers a centred forward crossing', () => {
    const g = makeGateRuntime(gate());
    const r = crossing(g, [0, 0, -5], [0, 0, 5]);
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('PASS');
    expect(r!.t).toBeCloseTo(0.5, 2);
    expect(r!.centerError).toBeLessThan(0.05);
    expect(r!.alignment).toBeCloseTo(1, 3);
  });

  it('triggers reliably at extreme speed (tunnelling straight through)', () => {
    const g = makeGateRuntime(gate());
    // 160 m in a single fixed step: far more than the aperture depth.
    const r = crossing(g, [0, 0, -80], [0, 0, 80], 6400);
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('PASS');
    expect(r!.speedUnits).toBe(6400);
  });

  it('does not trigger when crossing outside the aperture', () => {
    const g = makeGateRuntime(gate());
    const r = crossing(g, [9, 0, -5], [9, 0, 5]);
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('MISS');
  });

  it('does not trigger when crossing above or below the aperture', () => {
    const g = makeGateRuntime(gate());
    expect(crossing(g, [0, 6, -5], [0, 6, 5])!.kind).toBe('MISS');
    expect(crossing(g, [0, -6, -5], [0, -6, 5])!.kind).toBe('MISS');
  });

  it('does not trigger a backwards crossing', () => {
    const g = makeGateRuntime(gate());
    expect(crossing(g, [0, 0, 5], [0, 0, -5])).toBeNull();
  });

  it('does not trigger while merely standing near the gate', () => {
    const g = makeGateRuntime(gate());
    expect(crossing(g, [0, 0, -2], [0, 0, -2])).toBeNull();
    expect(crossing(g, [0, 0, 2], [0, 0, 2])).toBeNull();
  });

  it('respects the gate orientation', () => {
    // Gate rotated 90 degrees: intended direction is +X.
    const g = makeGateRuntime(gate({ yaw: Math.PI * 0.5 }));
    expect(crossing(g, [-5, 0, 0], [5, 0, 0])!.kind).toBe('PASS');
    expect(crossing(g, [5, 0, 0], [-5, 0, 0])).toBeNull();
  });

  it('is deterministic for identical input', () => {
    const g = makeGateRuntime(gate());
    const a = crossing(g, [0.4, 0.3, -4], [0.9, 0.1, 6]);
    const b = crossing(g, [0.4, 0.3, -4], [0.9, 0.1, 6]);
    expect(a).toEqual(b);
  });
});

describe('Signal Gates — sequence behaviour', () => {
  const defs: SignalGateDefinition[] = [
    gate({ id: 'A', position: { x: 0, y: 0, z: 0 }, sequenceIndex: 0 }),
    gate({ id: 'B', position: { x: 0, y: 0, z: 100 }, sequenceIndex: 1 }),
    gate({ id: 'C', position: { x: 0, y: 0, z: 200 }, sequenceIndex: 2 })
  ];

  function crossGate(seq: SignalGateSequence, z: number) {
    seq.update({
      prevX: 0, prevY: 0, prevZ: z - 5,
      curX: 0, curY: 0, curZ: z + 5,
      speedUnits: 1600
    });
  }

  it('advances in the correct order and completes', () => {
    const seq = new SignalGateSequence(defs);
    const crossings: number[] = [];
    const complete = vi.fn();
    seq.onCrossing = (i) => crossings.push(i);
    seq.onComplete = complete;

    crossGate(seq, 0);
    expect(seq.passedCount).toBe(1);
    expect(seq.nextIndex).toBe(1);
    expect(seq.complete).toBe(false);

    crossGate(seq, 100);
    crossGate(seq, 200);

    expect(crossings).toEqual([0, 1, 2]);
    expect(seq.complete).toBe(true);
    expect(seq.incomplete).toBe(false);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('marks the chain incomplete when a gate is passed out of order, without punishing', () => {
    const seq = new SignalGateSequence(defs);
    crossGate(seq, 100); // gate B first
    expect(seq.incomplete).toBe(true);
    expect(seq.complete).toBe(false);
    // Still usable: the run continues, nothing throws, later gates still resolve.
    crossGate(seq, 0);
    crossGate(seq, 200);
    expect(seq.complete).toBe(false);
  });

  it('marks the chain incomplete when a gate is missed (outside the aperture)', () => {
    const seq = new SignalGateSequence(defs);
    seq.update({
      prevX: 9, prevY: 0, prevZ: -5,
      curX: 9, curY: 0, curZ: 5,
      speedUnits: 1600
    });
    expect(seq.incomplete).toBe(true);
    expect(seq.passedCount).toBe(0);
    expect(seq.complete).toBe(false);
  });

  it('cannot trigger the same gate twice', () => {
    const seq = new SignalGateSequence(defs);
    const onCrossing = vi.fn();
    seq.onCrossing = onCrossing;
    crossGate(seq, 0);
    crossGate(seq, 0);
    crossGate(seq, 0);
    expect(onCrossing).toHaveBeenCalledTimes(1);
    expect(seq.passedCount).toBe(1);
  });

  it('clears all state on reset', () => {
    const seq = new SignalGateSequence(defs);
    crossGate(seq, 0);
    crossGate(seq, 100);
    crossGate(seq, 200);
    expect(seq.complete).toBe(true);

    seq.reset();
    expect(seq.complete).toBe(false);
    expect(seq.incomplete).toBe(false);
    expect(seq.nextIndex).toBe(0);
    expect(seq.passedCount).toBe(0);
    expect(seq.lastResult).toBeNull();
    for (const g of seq.gates) {
      expect(g.state).toBe('PENDING');
      expect(g.collapse).toBe(0);
    }
  });
});

describe('Signal Gates — protected gameplay', () => {
  interface FakePlayer {
    position: { x: number; y: number; z: number };
    velocity: { x: number; y: number; z: number };
    config: { playerHeight: number; playerRadius: number; speedUnitScale: number };
    getSpeedUnits(): number;
  }

  function makePlayer(): FakePlayer {
    const p: FakePlayer = {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 22 },
      config: { playerHeight: 1.8, playerRadius: 0.5, speedUnitScale: 40 },
      getSpeedUnits() { return Math.hypot(this.velocity.x, this.velocity.z) * this.config.speedUnitScale; }
    };
    return p;
  }

  it('does not alter velocity, position or any physics state', () => {
    const system = new SignalGateSystem('TEST', [gate()], {
      primary: new THREE.Color(0x00f0ff),
      secondary: new THREE.Color(0x3a5570)
    });
    const player = makePlayer();

    const velBefore = { ...player.velocity };
    const posBefore = { ...player.position };

    // Approach then cross.
    player.position.z = -5;
    system.update(1 / 120, player as unknown as PlayerController, {
      energy: 0.5, bass: 0.5, onsetPulse: 0, reactivityMultiplier: 1
    }, false);
    player.position.z = 5;
    system.update(1 / 120, player as unknown as PlayerController, {
      energy: 0.5, bass: 0.5, onsetPulse: 0, reactivityMultiplier: 1
    }, false);

    expect(system.sequence.passedCount).toBe(1);
    expect(player.velocity).toEqual(velBefore);
    expect(player.position).toEqual({ ...posBefore, z: 5 });
    system.dispose();
  });

  it('resets cleanly between runs (no stale progress)', () => {
    const system = new SignalGateSystem('TEST', [gate()], {
      primary: new THREE.Color(0x00f0ff),
      secondary: new THREE.Color(0x3a5570)
    });
    const player = makePlayer();
    player.position.z = -5;
    system.update(1 / 120, player as unknown as PlayerController, {
      energy: 0, bass: 0, onsetPulse: 0, reactivityMultiplier: 1
    }, false);
    player.position.z = 5;
    system.update(1 / 120, player as unknown as PlayerController, {
      energy: 0, bass: 0, onsetPulse: 0, reactivityMultiplier: 1
    }, false);
    expect(system.sequence.passedCount).toBe(1);

    system.reset();
    expect(system.sequence.passedCount).toBe(0);
    expect(system.sequence.nextIndex).toBe(0);
    system.dispose();
  });
});
