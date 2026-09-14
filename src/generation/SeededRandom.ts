/**
 * Deterministic pseudo-random number generator (Mulberry32)
 */

export class SeededRandom {
  private state: number;
  public readonly initialSeed: number;

  constructor(seed: number) {
    this.initialSeed = seed >>> 0;
    this.state = this.initialSeed;
  }

  /**
   * Returns a pseudo-random float between 0 (inclusive) and 1 (exclusive)
   */
  public next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Float in range [min, max)
   */
  public nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Integer in range [min, max]
   */
  public nextInt(min: number, max: number): number {
    return Math.floor(min + this.next() * (max - min + 1));
  }

  /**
   * Boolean with optional true probability (default 0.5)
   */
  public nextBool(chance = 0.5): boolean {
    return this.next() < chance;
  }

  /**
   * Pick random element from an array
   */
  public choice<T>(array: T[]): T {
    if (array.length === 0) {
      throw new Error('Cannot pick from empty array');
    }
    return array[this.nextInt(0, array.length - 1)];
  }

  /**
   * Shuffle an array in-place using Fisher-Yates
   */
  public shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      const temp = array[i];
      array[i] = array[j];
      array[j] = temp;
    }
    return array;
  }

  /**
   * Reset PRNG to initial seed
   */
  public reset(): void {
    this.state = this.initialSeed;
  }
}
