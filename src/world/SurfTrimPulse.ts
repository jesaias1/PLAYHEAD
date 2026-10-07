/**
 * Bounded SURF presentation only; consumes the existing smoothed music bus.
 *
 * The border `mix`/`opacity` outputs are load-bearing and unchanged. The added
 * `surfaceEmissive` is a restrained breath for the SHARED surf platform
 * material (one instance for every deck) plus the transfer/checkpoint cue: it
 * never exceeds a small fraction of the authored emissive, is scaled by the
 * effect profile and fully collapses under reduced motion, and modifies no
 * geometry, piston, light or bus state.
 */
export function surfTrimPulse(onset: number, bass: number, effects: number, reducedMotion: boolean): { mix: number; opacity: number; surfaceEmissive: number } {
  const gain = Math.max(0, Math.min(1, effects));
  const beat = Math.max(0, Math.min(1, onset));
  const mass = Math.max(0, Math.min(1, bass));
  const mix = gain * (reducedMotion ? mass * 0.08 : beat * 0.26 + mass * 0.12);
  // Restrained surface breath: a tiny onset/bass lift on the shared surf
  // material (authored emissive is ~0.28, so +0.06 max is a soft glow, never a
  // strobe). Reduced motion keeps only a minimal bass mass term.
  const surfaceEmissive = gain * (reducedMotion ? mass * 0.015 : beat * 0.045 + mass * 0.02);
  return { mix, opacity: 0.72 + gain * (reducedMotion ? 0.12 : beat * 0.20 + mass * 0.08), surfaceEmissive };
}
