/**
 * Fixed timestep simulation clock with accumulator
 */

export class GameClock {
  public readonly fixedDt: number;
  private accumulator = 0;
  private lastTime = 0;
  private maxFrameTime = 0.1; // Cap at 100ms to prevent spiral of death
  private isRunning = false;

  constructor(fixedHz = 120) {
    this.fixedDt = 1 / fixedHz;
  }

  public start(): void {
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.isRunning = true;
  }

  public stop(): void {
    this.isRunning = false;
  }

  /**
   * Advance clock and run updateCallback for each fixed timestep
   */
  public tick(updateCallback: (dt: number) => void): { renderAlpha: number; frameDelta: number } {
    if (!this.isRunning) {
      return { renderAlpha: 0, frameDelta: 0 };
    }

    const now = performance.now();
    let frameDelta = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // Clamp frameDelta to avoid physics blowout on tab defocus
    if (frameDelta > this.maxFrameTime) {
      frameDelta = this.maxFrameTime;
    }

    this.accumulator += frameDelta;

    let subSteps = 0;
    const maxSubSteps = 10;

    while (this.accumulator >= this.fixedDt && subSteps < maxSubSteps) {
      updateCallback(this.fixedDt);
      this.accumulator -= this.fixedDt;
      subSteps++;
    }

    // Discard any excess leftover to prevent lag spirals
    if (subSteps >= maxSubSteps) {
      this.accumulator = 0;
    }

    // Alpha for interpolation between current and previous physics states if desired
    const renderAlpha = this.accumulator / this.fixedDt;

    return { renderAlpha, frameDelta };
  }
}
