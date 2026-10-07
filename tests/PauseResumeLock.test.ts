import { afterEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../src/core/Game';
import { GameState, StateMachine } from '../src/core/StateMachine';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('resume requires mouse control', () => {
  it.each([false, true])('silent lock result %s never resumes without confirmed lock', locked => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setTimeout });
    let hasLock = false;
    const resume = vi.fn();
    const host = Object.assign(Object.create(Game.prototype), {
      stateMachine: new StateMachine(GameState.PAUSED), awaitingResumeLock: false,
      cameraController: { getIsLocked: () => hasLock, lock: vi.fn() },
      finalizeResume: resume,
    });
    host.resumeGame();
    expect(resume).not.toHaveBeenCalled();
    hasLock = locked;
    vi.advanceTimersByTime(600);
    expect(resume).toHaveBeenCalledTimes(locked ? 1 : 0);
    expect(host.awaitingResumeLock).toBe(false);
    if (!locked) {
      host.resumeGame();
      expect(host.cameraController.lock).toHaveBeenCalledTimes(2);
      expect(resume).not.toHaveBeenCalled();
    }
  });
});
