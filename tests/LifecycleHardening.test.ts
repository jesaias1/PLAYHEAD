/**
 * LIFECYCLE HARDENING — the invariants the pre-visual pass verified.
 *
 * These are the systems where a future pass (especially a visual/rendering one)
 * could silently break reliability while "just changing presentation". Each test
 * locks a behaviour that was audited by hand during the pre-visual lockdown.
 *
 * What is covered here:
 *   1. GameClock clamps a huge frame delta and caps catch-up substeps, so a
 *      backgrounded tab cannot produce a physics blowout or buffered jumps.
 *   2. The pointer-lock acquisition is a guarded two-step transaction with a
 *      pending throttle, and a click re-acquires when mouse look is enabled.
 *   3. Restore is atomic: re-entrancy guarded, platform-derived, and verified on
 *      the next frame before simulation resumes.
 *   4. Audio pause/resume is offset-exact, so the music cannot drift away from
 *      the run timer across a pause.
 *   5. Rank bands and overtime PB gating stay as documented.
 *
 * Behavioural tests run the REAL modules. Where a module needs a browser
 * (AudioContext, pointer lock) the test asserts the SOURCE contract instead,
 * which is honest: it locks the structure, not a simulated browser.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { GameClock } from '../src/core/Clock';
import { RANK_TIME_MULTIPLIERS, evaluateRunRankDetailed } from '../src/player/PlayerStats';

const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

/** Drives GameClock against a controllable clock, then restores the real one. */
function withFakeClock<T>(run: (advance: (ms: number) => void, count: () => number) => T): T {
  let fake = 1_000_000;
  const spy = vi.spyOn(performance, 'now').mockImplementation(() => fake);
  let steps = 0;
  try {
    return run(
      (ms: number) => {
        fake += ms;
      },
      () => steps
    );
  } finally {
    spy.mockRestore();
  }
}

// ---------------------------------------------------------------------------
// 1. Fixed timestep: tab-out safety
// ---------------------------------------------------------------------------

describe('GameClock — tab background safety', () => {
  it('clamps a huge frame delta to the documented cap', () => {
    withFakeClock((advance) => {
      const clock = new GameClock(120);
      clock.start();
      let steps = 0;
      clock.tick(() => steps++); // establish lastTime
      steps = 0;
      advance(10_000); // 10 seconds hidden
      clock.tick(() => steps++);
      // 10s of real time must NOT become 1200 physics steps.
      expect(steps).toBeLessThanOrEqual(10);
      expect(steps).toBeGreaterThan(0);
    });
  });

  it('caps catch-up substeps at 10 and discards the excess accumulator', () => {
    withFakeClock((advance) => {
      const clock = new GameClock(120);
      clock.start();
      let steps = 0;
      clock.tick(() => steps++);
      steps = 0;
      advance(100); // exactly the clamp ceiling: 12 steps' worth
      clock.tick(() => steps++);
      expect(steps).toBeLessThanOrEqual(10);
    });
  });

  it('does not accumulate a backlog across repeated clamped frames', () => {
    withFakeClock((advance) => {
      const clock = new GameClock(120);
      clock.start();
      let total = 0;
      clock.tick(() => total++);
      total = 0;
      for (let i = 0; i < 20; i++) {
        advance(5_000); // 20 separate 5s hidden gaps
        clock.tick(() => total++);
      }
      // A backlog would grow to hundreds of steps; it must stay bounded.
      expect(total).toBeLessThanOrEqual(20 * 10);
    });
  });

  it('runs no steps while stopped', () => {
    const clock = new GameClock(120);
    let steps = 0;
    clock.tick(() => steps++);
    expect(steps).toBe(0);
  });

  it('uses the frozen 120 Hz fixed step', () => {
    expect(new GameClock(120).fixedDt).toBeCloseTo(1 / 120, 10);
  });
});

// ---------------------------------------------------------------------------
// 2. Pointer lock: guarded two-step transaction
// ---------------------------------------------------------------------------

describe('Pointer lock contract', () => {
  const cam = read('src/player/CameraController.ts');

  it('throttles repeated lock requests while one is pending', () => {
    expect(cam).toMatch(/isLockPending/);
    expect(cam).toMatch(/lastLockAttempt/);
    // A burst of requests must not queue multiple locks.
    expect(cam).toMatch(/this\.isLockPending && Date\.now\(\) - this\.lastLockAttempt < \d+/);
  });

  it('reports failure instead of pretending to be playable', () => {
    expect(cam).toMatch(/pointerlockerror/);
    // A failed lock must surface so the owner keeps the game paused.
    expect(cam).toMatch(/this\.onLockChange\?\.\(false\)/);
  });

  it('re-acquires the lock on a click while mouse look is enabled', () => {
    expect(cam).toMatch(/pointerdown/);
    expect(cam).toMatch(/if \(this\.mouseLookEnabled && !this\.isLocked\) \{\s*this\.lock\(\);/);
  });

  it('clears residual input state on every lock transition', () => {
    expect(cam).toMatch(/pointerlockchange/);
    expect(cam).toMatch(/this\.resetInputSessionState\(\)/);
    expect(cam).toMatch(/this\.justLocked = true/);
  });

  it('the game resumes only after the lock is confirmed', () => {
    const game = read('src/core/Game.ts');
    expect(game).toMatch(/this\.awaitingResumeLock = true/);
    expect(game).toMatch(/this\.cameraController\.onLockChange = \(locked\) => \{/);
    // And a fallback exists so the player can never be trapped on pause.
    expect(game).toMatch(/window\.setTimeout\(\(\) => \{/);
  });

  it('pause is driven by lock loss, so a hidden tab pauses the run', () => {
    const game = read('src/core/Game.ts');
    expect(game).toMatch(/this\.cameraController\.onUnlock = \(\) => \{\s*this\.pauseGame\(\);/);
  });
});

// ---------------------------------------------------------------------------
// 3. Restore: atomic and verified
// ---------------------------------------------------------------------------

describe('Restore atomicity contract', () => {
  const game = read('src/core/Game.ts');

  it('is re-entrancy guarded', () => {
    expect(game).toMatch(/if \(this\.isRestoringCheckpoint\) return;/);
    expect(game).toMatch(/this\.playerController\.isRestoring = true;/);
  });

  it('derives the spawn from real platform bounds, never a fixed offset', () => {
    expect(game).toMatch(/cpNode\.dimensions\.z \* 0\.5/);
    expect(game).toMatch(/calculateLookYaw\(spawnPos, lookTarget\)/);
    // No bare world-space offset teleport.
    expect(game).not.toMatch(/setPosition\(\{ x: 0, y: 0, z: 0 \}\)/);
  });

  it('rewinds the audio to the checkpoint on restore', () => {
    expect(game).toMatch(/this\.audioEngine\.seek\(this\.currentCheckpoint\.time\)/);
    expect(game).toMatch(/this\.audioEngine\.seek\(0\)/);
  });

  it('verifies the restore physically before releasing the restoring state', () => {
    expect(game).toMatch(/pendingRestoreVerification/);
    // Success requires proximity AND being above the kill plane.
    expect(game).toMatch(/dist < 3\.0 && p\.y >= t\.y - 1\.0/);
    expect(game).toMatch(/killY === null \|\| p\.y > killY/);
    // A failed verification re-forces the transform rather than giving up.
    expect(game).toMatch(/attempts\+\+/);
    expect(game).toMatch(/attempts > 3/);
  });

  it('cleans up the restoring flags even if the transaction throws', () => {
    expect(game).toMatch(/catch \(e\) \{[\s\S]{0,200}this\.playerController\.isRestoring = false;/);
  });
});

// ---------------------------------------------------------------------------
// 4. Audio clock: pause is offset-exact
// ---------------------------------------------------------------------------

describe('Audio clock contract', () => {
  const audio = read('src/audio/AudioEngine.ts');

  it('pause captures the exact offset and stops the source', () => {
    expect(audio).toMatch(/public pause\(\): void \{/);
    expect(audio).toMatch(/this\.currentOffset = this\.getCurrentTime\(\);/);
    expect(audio).toMatch(/this\.stopSource\(\);/);
  });

  it('resume replays from the captured offset, so the music cannot drift', () => {
    expect(audio).toMatch(/public resume\(\): void \{/);
    expect(audio).toMatch(/this\.play\(this\.currentOffset\)/);
  });

  it('the run timer is accumulated from fixed steps, not wall time', () => {
    const game = read('src/core/Game.ts');
    expect(game).toMatch(/this\.runElapsedTime \+= dt;/);
    // A wall-clock timer would keep running while paused.
    expect(game).not.toMatch(/this\.runElapsedTime = \(performance\.now\(\)/);
  });

  it('pause freezes the music as well as the run', () => {
    const game = read('src/core/Game.ts');
    const paused = game.slice(
      game.indexOf('case GameState.PAUSED:'),
      game.indexOf('case GameState.PAUSED:') + 300
    );
    expect(paused).toMatch(/this\.audioEngine\.pause\(\)/);
    expect(paused).toMatch(/this\.playerController\.resetKeys\(\)/);
  });
});

// ---------------------------------------------------------------------------
// 5. Rank and overtime
// ---------------------------------------------------------------------------

describe('Rank and overtime invariants', () => {
  it('keeps the documented rank multipliers', () => {
    expect(RANK_TIME_MULTIPLIERS.DIAMOND).toBe(1.04);
    expect(RANK_TIME_MULTIPLIERS.GOLD).toBe(1.18);
    expect(RANK_TIME_MULTIPLIERS.SILVER).toBe(1.4);
    expect(RANK_TIME_MULTIPLIERS.BRONZE).toBe(1.85);
  });

  it('Diamond requires a clean run inside the band', () => {
    const clean = evaluateRunRankDetailed({
      completionTime: 104, targetTime: 100, fallsCount: 0, restartsCount: 0, strafeEfficiency: 50
    });
    expect(clean.rank).toBe('DIAMOND');
    // One mistake drops it out of Diamond.
    const oneMistake = evaluateRunRankDetailed({
      completionTime: 104, targetTime: 100, fallsCount: 1, restartsCount: 0, strafeEfficiency: 50
    });
    expect(oneMistake.rank).not.toBe('DIAMOND');
  });

  it('an unfinished run is UNRANKED', () => {
    const r = evaluateRunRankDetailed({
      completionTime: 10, targetTime: 100, fallsCount: 0, restartsCount: 0,
      strafeEfficiency: 0, finished: false
    });
    expect(r.rank).toBe('UNRANKED');
    expect(r.failureReason).toBe('UNFINISHED');
  });

  it('a non-finite time is UNRANKED, never a crash', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const r = evaluateRunRankDetailed({
        completionTime: bad, targetTime: 100, fallsCount: 0, restartsCount: 0, strafeEfficiency: 0
      });
      expect(r.rank).toBe('UNRANKED');
    }
  });

  it('PB is gated on a non-overtime run', () => {
    const game = read('src/core/Game.ts');
    expect(game).toMatch(/if \(this\.replayRecorder\.hasData\(\) && !isOvertime\)/);
  });

  it('overtime ends the music without restarting or looping it', () => {
    const game = read('src/core/Game.ts');
    const overtime = game.slice(
      game.indexOf('if (!this.isOvertime) {'),
      game.indexOf('if (!this.isOvertime) {') + 300
    );
    expect(overtime).toMatch(/this\.isOvertime = true/);
    // No replay or loop call in the overtime branch.
    expect(overtime).not.toMatch(/audioEngine\.play\(/);
    expect(overtime).not.toMatch(/\.loop\s*=/);
  });
});
