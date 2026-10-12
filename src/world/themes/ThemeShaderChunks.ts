/**
 * GLSL shared by environment-theme shaders.
 */

/** Hashes, value noise and the 4x4 ordered matrix. */
export const GLSL_NOISE = /* glsl */ `
float hash31(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float vnoise1(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i), hash11(i + 1.0), f);
}

float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(i), hash31(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}

float bayer4(vec2 p) {
  vec2 c = floor(mod(p, 4.0));
  float i = c.y * 4.0 + c.x;
  // 4x4 ordered matrix, evaluated arithmetically.
  float r = 0.0;
  if (i < 0.5) r = 0.0; else if (i < 1.5) r = 8.0; else if (i < 2.5) r = 2.0; else if (i < 3.5) r = 10.0;
  else if (i < 4.5) r = 12.0; else if (i < 5.5) r = 4.0; else if (i < 6.5) r = 14.0; else if (i < 7.5) r = 6.0;
  else if (i < 8.5) r = 3.0; else if (i < 9.5) r = 11.0; else if (i < 10.5) r = 1.0; else if (i < 11.5) r = 9.0;
  else if (i < 12.5) r = 15.0; else if (i < 13.5) r = 7.0; else if (i < 14.5) r = 13.0; else r = 5.0;
  return r / 16.0;
}
`;

/**
 * The game's signal pass quantises linear colour to a few dozen steps per
 * channel, which would crush a dark gradient into flat, hue-shifted bands.
 * Offsetting by half a step with the same ordered matrix turns those bands
 * into a proper pixel dither and keeps the average colour true.
 * Requires GLSL_NOISE.
 */
export const GLSL_SIGNAL_DITHER = /* glsl */ `
vec3 signalDither(vec3 col) {
  return max(col + (bayer4(gl_FragCoord.xy * 0.5) - 0.5) / 32.0, 0.0);
}
`;
