
/**
 * FINISH OPENING — the Run Report must open IMMEDIATELY and idempotently in
 * every playable mode.
 *
 * REGRESSION GUARD (source-level): handleFinishSequence used to defer the
 * FINISHED transition by a 520 ms timer. A deferred transition can fire after a
 * fresh run has already started and yank the player back into a stale report.
 * This asserts the deferral is gone and the transition is unconditional of any
 * timer, while the exact sub-tick finish timestamp write (runElapsedTime) stays
 * outside the presentation sequence.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { Game } from '../src/core/Game';
import { GameState, StateMachine } from '../src/core/StateMachine';
import { ResultsScreen } from '../src/ui/ResultsScreen';

it('keeps the friend-race report open while preventing an individual shared-race restart', () => {
  const screen = Object.assign(Object.create(ResultsScreen.prototype), {
    againBtn: { disabled: false, textContent: '' },
    retryPbBtn: { classList: { add: vi.fn() } },
    nextSignalBtn: { classList: { add: vi.fn() } }
  });
  screen.setRaceWaiting(true);
  expect(screen.againBtn.disabled).toBe(true);
  expect(screen.againBtn.textContent).toContain('WAITING');
  screen.setRaceWaiting(false);
  expect(screen.againBtn.disabled).toBe(false);
  expect(screen.againBtn.textContent).toContain('RETRY');
});

it('opens the report before returning and never schedules a stale finish', () => {
  vi.useFakeTimers();
  try {
    const machine = new StateMachine(GameState.PLAYING);
    const report = vi.fn();
    machine.onTransition(state => { if (state === GameState.FINISHED) report(); });
    const host = Object.assign(Object.create(Game.prototype), {
      isFinished: false, stateMachine: machine, runElapsedTime: 12.345,
      playerController: { resetKeys: vi.fn() }, onRaceFinish: vi.fn(),
      movementFeedback: { notifyFinish: vi.fn() }, movementSfx: { reset: vi.fn() },
      audioEngine: { fadeOutAndStop: vi.fn() }
    });
    host.handleFinishSequence();
    expect(report).toHaveBeenCalledTimes(1);
    expect(host.runElapsedTime).toBe(12.345);
    host.handleFinishSequence();
    vi.advanceTimersByTime(5000);
    expect(report).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});

describe('Game.handleFinishSequence — immediate, idempotent report', () => {
  const src = readFileSync('src/core/Game.ts', 'utf8');

  function body(): string {
    const start = src.indexOf('private handleFinishSequence()');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('\n  private ', start + 10);
    return src.slice(start, end > start ? end : start + 2400);
  }

  it('never defers the FINISHED transition with a window timer', () => {
    const b = body();
    expect(b).not.toMatch(/window\.setTimeout/);
    expect(b).not.toMatch(/setTimeout\s*\(/);
  });

  it('transitions to FINISHED synchronously and idempotently', () => {
    const b = body();
    expect(b).toContain('GameState.FINISHED');
    expect(b).toMatch(/stateMachine\.transitionTo\(\s*GameState\.FINISHED\s*\)/);
    // Idempotent guard so a second finish signal cannot re-enter.
    expect(b).toMatch(/if\s*\(\s*!this\.stateMachine\.is\(GameState\.FINISHED\)\s*\)/);
  });

  it('still writes NO authoritative timer in the presentation sequence', () => {
    const b = body();
    expect(b).not.toMatch(/this\.runElapsedTime\s*[-+*/]?=/);
  });

  it('still reports the finish and ducks the music underneath the report', () => {
    const b = body();
    expect(b).toContain('notifyFinish');
    expect(b).toContain('fadeOutAndStop');
    expect(b).toContain('onRaceFinish');
  });
});
