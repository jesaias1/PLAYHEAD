/**
 * Easing functions for smooth interpolations
 */

export function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

export function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function easeOutExpo(x: number): number {
  return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
}

export function easeOutQuad(x: number): number {
  return 1 - (1 - x) * (1 - x);
}

export function easeInQuad(x: number): number {
  return x * x;
}
