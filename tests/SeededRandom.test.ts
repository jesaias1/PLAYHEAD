import { describe, it, expect } from 'vitest';
import { SeededRandom } from '../src/generation/SeededRandom';

describe('SeededRandom', () => {
  it('produces deterministic float sequences for the same seed', () => {
    const rngA = new SeededRandom(0xDEADBEEF);
    const rngB = new SeededRandom(0xDEADBEEF);

    const seqA = [rngA.next(), rngA.next(), rngA.next(), rngA.next()];
    const seqB = [rngB.next(), rngB.next(), rngB.next(), rngB.next()];

    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const rngA = new SeededRandom(0x12345678);
    const rngB = new SeededRandom(0x87654321);

    expect(rngA.next()).not.toEqual(rngB.next());
  });

  it('generates numbers within specified ranges', () => {
    const rng = new SeededRandom(42);
    for (let i = 0; i < 100; i++) {
      const f = rng.nextFloat(5.0, 15.0);
      expect(f).toBeGreaterThanOrEqual(5.0);
      expect(f).toBeLessThan(15.0);

      const n = rng.nextInt(1, 6);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(6);
    }
  });
});
