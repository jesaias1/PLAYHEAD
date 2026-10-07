/** Bounded SURF presentation only; consumes the existing smoothed music bus. */
export function surfTrimPulse(onset: number, bass: number, effects: number, reducedMotion: boolean): { mix: number; opacity: number } {
  const gain = Math.max(0, Math.min(1, effects));
  const beat = Math.max(0, Math.min(1, onset));
  const mass = Math.max(0, Math.min(1, bass));
  const mix = gain * (reducedMotion ? mass * 0.08 : beat * 0.26 + mass * 0.12);
  return { mix, opacity: 0.72 + gain * (reducedMotion ? 0.12 : beat * 0.20 + mass * 0.08) };
}
