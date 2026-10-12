/**
 * MIDNIGHT MOUNTAINS shaders.
 *
 * Three materials share one uniform set:
 *   sky      one opaque dome: night gradient, stars, moon, mist sea, aurora
 *   terrain  instanced rock / snow / structures with pooled lamp light
 *   glow     instanced additive billboards: lamps, windows, the beacon
 *
 * Terrain fades into the SAME backdrop function the dome draws, so mountain
 * bases dissolve into the mist sea and far peaks meet the far plane without a
 * visible edge, and no transparent mist layers are needed.
 */

import * as THREE from 'three';
import { GLSL_NOISE, GLSL_SIGNAL_DITHER } from '../ThemeShaderChunks';

export const AURORA_BAND_COUNT = 6;

export interface MidnightUniforms {
  [name: string]: THREE.IUniform;
  uTime: THREE.IUniform<number>;
  uZenith: THREE.IUniform<THREE.Color>;
  uHorizon: THREE.IUniform<THREE.Color>;
  uMistColor: THREE.IUniform<THREE.Color>;
  uAbyss: THREE.IUniform<THREE.Color>;
  uMoonDir: THREE.IUniform<THREE.Vector3>;
  uMoonColor: THREE.IUniform<THREE.Color>;
  uAmbient: THREE.IUniform<THREE.Color>;
  uMist: THREE.IUniform<number>;
  uAuroraFwd: THREE.IUniform<THREE.Vector3>;
  uAuroraLevel: THREE.IUniform<number>;
  uAuroraGain: THREE.IUniform<number>;
  uAuroraPhase: THREE.IUniform<number>;
  uAuroraHeight: THREE.IUniform<number>;
  uAuroraHue: THREE.IUniform<number>;
  uAuroraShimmer: THREE.IUniform<number>;
  uAuroraBass: THREE.IUniform<number>;
  uAuroraLow: THREE.IUniform<THREE.Color>;
  uAuroraHigh: THREE.IUniform<THREE.Color>;
  uBands: THREE.IUniform<number[]>;
  uLampColor: THREE.IUniform<THREE.Color>;
  uLampLevel: THREE.IUniform<number>;
  uKick: THREE.IUniform<number>;
  uAccent: THREE.IUniform<number>;
  uAccentSlot: THREE.IUniform<number>;
  uBeacon: THREE.IUniform<number>;
  uHat: THREE.IUniform<number>;
  uHatSlot: THREE.IUniform<number>;
  uSub: THREE.IUniform<number>;
  uSubPhase: THREE.IUniform<number>;
  uHazeDistance: THREE.IUniform<number>;
}

export function createMidnightUniforms(): MidnightUniforms {
  return {
    uTime: { value: 0 },
    uZenith: { value: new THREE.Color(0.0015, 0.004, 0.014) },
    uHorizon: { value: new THREE.Color(0.015, 0.040, 0.098) },
    uMistColor: { value: new THREE.Color(0.012, 0.026, 0.055) },
    uAbyss: { value: new THREE.Color(0.001, 0.003, 0.009) },
    uMoonDir: { value: new THREE.Vector3(0.5, 0.5, 0.7).normalize() },
    uMoonColor: { value: new THREE.Color(0.52, 0.64, 0.92) },
    uAmbient: { value: new THREE.Color(0.020, 0.036, 0.080) },
    uMist: { value: 0.5 },
    uAuroraFwd: { value: new THREE.Vector3(0, 0, 1) },
    uAuroraLevel: { value: 0 },
    uAuroraGain: { value: 0 },
    uAuroraPhase: { value: 0 },
    uAuroraHeight: { value: 0.5 },
    uAuroraHue: { value: 0 },
    uAuroraShimmer: { value: 0 },
    uAuroraBass: { value: 0 },
    uAuroraLow: { value: new THREE.Color(0.10, 0.86, 0.46) },
    uAuroraHigh: { value: new THREE.Color(0.36, 0.22, 0.86) },
    uBands: { value: new Array(AURORA_BAND_COUNT).fill(0) },
    uLampColor: { value: new THREE.Color(1.0, 0.60, 0.26) },
    uLampLevel: { value: 1 },
    uKick: { value: 0 },
    uAccent: { value: 0 },
    uAccentSlot: { value: 0 },
    uBeacon: { value: 0.5 },
    uHat: { value: 0 },
    uHatSlot: { value: 0 },
    uSub: { value: 0 },
    uSubPhase: { value: 0 },
    uHazeDistance: { value: 1150 }
  };
}

const COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uMistColor;
uniform vec3 uAbyss;
uniform vec3 uMoonDir;
uniform float uMist;
uniform float uSub;

${GLSL_NOISE}
${GLSL_SIGNAL_DITHER}
// The night backdrop WITHOUT stars, moon or aurora. Terrain fades into this.
vec3 midnightBackdrop(vec3 dir) {
  float e = dir.y;
  vec3 sky = mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.62, e), 0.42));
  vec2 flat2 = dir.xz + vec2(1e-5);
  float moonSide = max(dot(normalize(flat2), normalize(uMoonDir.xz + vec2(1e-5))), 0.0);
  float nearHorizon = 1.0 - smoothstep(0.0, 0.32, abs(e));
  sky += uHorizon * 0.45 * moonSide * moonSide * nearHorizon;
  // Sub-bass is felt at world scale: the air along the horizon and the whole
  // mist sea swell with it, slowly.
  sky += uHorizon * 0.42 * uSub * nearHorizon;
  vec3 sea = mix(uMistColor * (0.7 + 0.6 * uMist) * (1.0 + 0.7 * uSub), uAbyss, pow(smoothstep(0.0, -0.55, e), 0.55));
  sea += uMistColor * 0.5 * pow(moonSide, 6.0) * nearHorizon * uMist;
  return mix(sea, sky, smoothstep(-0.025, 0.025, e));
}
`;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT = /* glsl */ `
${COMMON}
uniform vec3 uMoonColor;
uniform vec3 uAuroraFwd;
uniform float uAuroraLevel;
uniform float uAuroraGain;
uniform float uAuroraPhase;
uniform float uAuroraHeight;
uniform float uAuroraHue;
uniform float uAuroraShimmer;
uniform float uAuroraBass;
uniform vec3 uAuroraLow;
uniform vec3 uAuroraHigh;
uniform float uBands[${AURORA_BAND_COUNT}];
uniform float uHat;
uniform float uHatSlot;
uniform float uSubPhase;
varying vec3 vDir;

// Crisp stars in three size classes with a barely perceptible slow twinkle.
// The field itself never moves or pulses; a hi-hat only lets a small subset
// glint, and the golden-ratio step picks a different subset for every hit.
vec3 stars(vec3 dir) {
  if (dir.y < 0.01) return vec3(0.0);
  vec3 col = vec3(0.0);
  vec3 g1 = floor(dir * 300.0);
  float h1 = hash31(g1);
  if (h1 > 0.990) {
    float glint = step(0.90, fract(h1 * 517.3 + uHatSlot * 0.6180339)) * uHat;
    col += vec3(0.72, 0.80, 1.0) * (1.0 - smoothstep(0.0, 0.0026, length(dir - (g1 + 0.5) / 300.0))) * (0.34 + 1.1 * glint);
  }
  vec3 g2 = floor(dir * 170.0);
  float h2 = hash31(g2);
  if (h2 > 0.9945) {
    float tw = 0.94 + 0.06 * sin(uTime * 0.7 + h2 * 40.0);
    vec3 tint = mix(vec3(0.80, 0.88, 1.0), vec3(1.0, 0.90, 0.78), step(0.997, h2));
    float glint = step(0.78, fract(h2 * 331.7 + uHatSlot * 0.6180339)) * uHat;
    vec3 d2 = dir - (g2 + 0.5) / 170.0;
    float point = 1.0 - smoothstep(0.0, 0.0030 * (1.0 + 0.5 * glint), length(d2));
    // A glinting star grows a short cross, like the big ones always have.
    float cross = max(
      max(1.0 - abs(d2.x) / 0.0009, 0.0) * max(1.0 - abs(d2.y) / 0.0075, 0.0),
      max(1.0 - abs(d2.y) / 0.0009, 0.0) * max(1.0 - abs(d2.x) / 0.0075, 0.0));
    col += tint * (point * (0.85 * tw + 1.5 * glint) + cross * 0.55 * glint);
  }
  vec3 g3 = floor(dir * 70.0);
  float h3 = hash31(g3);
  if (h3 > 0.9985) {
    vec3 d = dir - (g3 + 0.5) / 70.0;
    float core = 1.0 - smoothstep(0.0, 0.0042, length(d));
    float spike = max(
      max(1.0 - abs(d.x) / 0.0010, 0.0) * max(1.0 - abs(d.y) / 0.012, 0.0),
      max(1.0 - abs(d.y) / 0.0010, 0.0) * max(1.0 - abs(d.x) / 0.012, 0.0));
    col += vec3(0.92, 0.96, 1.0) * (core * 1.5 + spike * 0.35);
  }
  return col * smoothstep(0.01, 0.16, dir.y);
}

float auroraBand(float x) {
  float fx = clamp(x * 0.07 + 0.5, 0.0, 0.999) * float(${AURORA_BAND_COUNT - 1});
  int i = int(floor(fx));
  return mix(uBands[i], uBands[i + 1], fract(fx));
}

// Curtain density at a point of the aurora layer. "a" runs along the route
// heading, "x" across it; w is the sheet thickness for this sample.
float curtain(float a, float x, float w) {
  float sway = uAuroraPhase;
  float m = sin(x * 0.50 + sway * 0.55) * 0.60 + sin(x * 1.25 - sway * 0.33 + 1.7) * 0.24;
  float s1 = a - (1.35 + m);
  float s2 = a - (3.30 + m * 1.4 + 0.5 * sin(x * 0.30 + 2.0 + sway * 0.12));
  float s3 = a - (6.40 - m * 1.3);
  float s4 = a + (2.60 + m);
  // Sheets arrive from the horizon inwards as the journey opens up, so the
  // level changes the COMPOSITION and not only the brightness.
  float l = uAuroraLevel;
  float d = exp(-s3 * s3 / (w * w * 3.2)) * smoothstep(0.0, 0.22, l) * 0.75
          + exp(-s2 * s2 / (w * w * 1.7)) * smoothstep(0.22, 0.58, l) * 0.85
          + exp(-s1 * s1 / (w * w)) * smoothstep(0.55, 0.95, l)
          + exp(-s4 * s4 / (w * w * 1.4)) * smoothstep(0.65, 1.0, l) * 0.45;
  float rays = 0.50 + 0.50 * vnoise1(x * 6.5 + sway * 0.22);
  rays *= 0.72 + (0.28 + 0.5 * uAuroraShimmer) * vnoise1(x * 21.0 - sway * 0.45);
  float extent = 1.0 - smoothstep(4.5, 9.5, abs(x));
  return d * rays * (0.42 + 0.95 * auroraBand(x)) * extent;
}

vec3 aurora(vec3 dir) {
  if (uAuroraGain <= 0.002 || dir.y < 0.02) return vec3(0.0);
  vec2 f = normalize(uAuroraFwd.xz + vec2(1e-5));
  vec2 r = vec2(-f.y, f.x);
  float inv = 1.0 / (dir.y + 0.09);
  float span = 0.50 + 0.40 * uAuroraHeight;
  float stepLen = length(dir.xz) * inv * span / float(AURORA_STEPS);
  float w = 0.085 + 0.62 * stepLen;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < AURORA_STEPS; i++) {
    float t = (float(i) + 0.5) / float(AURORA_STEPS);
    vec2 p = dir.xz * inv * (1.0 + t * span);
    float d = curtain(dot(p, f), dot(p, r), w);
    // Bright, defined lower edge that thins out upwards.
    float profile = exp(-t * 2.3) * (0.30 + 0.70 * smoothstep(0.0, 0.10, t));
    vec3 c = mix(uAuroraLow, uAuroraHigh, smoothstep(0.18, 0.95, t) * (0.50 + 0.50 * uAuroraHue));
    c += vec3(0.85, 0.30, 0.52) * uAuroraBass * exp(-t * 10.0) * 0.55;
    acc += c * d * profile;
  }
  acc *= 2.3 / float(AURORA_STEPS);
  float fade = smoothstep(0.02, 0.15, dir.y);
  return acc * fade * uAuroraGain;
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 col = midnightBackdrop(dir);

  // Slow cloud-sea structure below the horizon, caught by the moon.
  if (dir.y < 0.0) {
    vec2 p = dir.xz / (-dir.y + 0.10);
    float n = vnoise3(vec3(p * 0.55 + vec2(uTime * 0.006, 0.0), 1.7)) * 0.65 + vnoise3(vec3(p * 1.7, 4.2)) * 0.35;
    float band = smoothstep(0.42, 0.78, n + (bayer4(gl_FragCoord.xy * 0.5) - 0.5) * 0.10);
    float reach = smoothstep(0.0, -0.05, dir.y) * (1.0 - smoothstep(-0.10, -0.62, dir.y));
    col += uMistColor * band * reach * (0.22 + 0.30 * uMist) * (1.0 + 1.3 * uSub);
    // Slow rings rolling out across the cloud sea from under the route: the
    // sub-bass made visible as a swell, never as a flash.
    float rings = 0.5 + 0.5 * sin(length(p) * 2.6 - uSubPhase);
    col += uMistColor * rings * rings * reach * uSub * 0.55;
  }

  vec3 au = aurora(dir);
  float lum = max(au.r, max(au.g, au.b));

  // Stars stay put; a bright curtain simply outshines the ones behind it.
  col += stars(dir) * (1.0 - clamp(lum * 1.6, 0.0, 0.8));

  // Moon: gibbous disc with blocky maria and a tight halo.
  float md = length(dir - uMoonDir);
  float radius = 0.030;
  float halo = exp(-md * 16.0) * 0.05 + exp(-md * 70.0) * 0.16;
  col += uMoonColor * halo * (1.0 + 0.7 * uSub);
  if (md < radius) {
    float lit = step(length(dir - uMoonDir - vec3(0.007, 0.004, 0.0)), radius * 0.98);
    float maria = floor(vnoise3(dir * 62.0) * 4.0) / 4.0;
    col = uMoonColor * (0.80 + 0.30 * maria) * mix(0.14, 1.15, lit);
  }

  col += au;
  gl_FragColor = vec4(signalDither(col), 1.0);
}
`;

const TERRAIN_VERTEX = /* glsl */ `
attribute vec4 aParams;
attribute vec4 aLamp;
attribute float aSeed;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec4 vParams;
varying vec4 vLamp;
varying float vSeed;
void main() {
  vLocal = position;
  vParams = aParams;
  vLamp = aLamp;
  vSeed = aSeed;
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const TERRAIN_FRAGMENT = /* glsl */ `
${COMMON}
uniform vec3 uMoonColor;
uniform vec3 uAmbient;
uniform vec3 uAuroraLow;
uniform float uAuroraGain;
uniform vec3 uLampColor;
uniform float uLampLevel;
uniform float uKick;
uniform float uBeacon;
uniform float uHazeDistance;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec4 vParams;
varying vec4 vLamp;
varying float vSeed;

void main() {
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  float kind = vParams.x;
  float texel = max(0.25, vParams.y);
  vec3 cell = floor(vWorld / texel);
  float grain = hash31(cell + vSeed * 17.0);
  float coarse = hash31(floor(vWorld / (texel * 4.0)) + vSeed * 5.0);

  vec3 albedo;
  vec3 emissive = vec3(0.0);
  float snow = 0.0;
  if (kind < 0.5) {
    // Rock: blocky grain, sedimentary strata, a dithered snow line.
    float strata = hash11(floor(vWorld.y / (texel * 2.0)) + vSeed * 91.0);
    albedo = vec3(0.040, 0.048, 0.066) * (0.80 + 0.22 * grain + 0.18 * coarse) * (0.84 + 0.32 * strata);
    // Snow lies above a blocky line and on anything flat; cliffs stay bare.
    float above = vWorld.y - vParams.z;
    float line = above - (46.0 + (coarse - 0.5) * 60.0) + (N.y - 0.34) * 170.0;
    snow = max(step(0.0, line) * step(0.10 + (grain - 0.5) * 0.06, N.y), step(0.72, N.y));
  } else if (kind < 1.5) {
    // Structure: cast concrete with formwork seams.
    float seam = step(fract(vWorld.y / 3.2), 0.10);
    albedo = vec3(0.090, 0.098, 0.118) * (0.80 + 0.28 * grain) * (1.0 - 0.38 * seam);
  } else if (kind < 2.5) {
    // Observatory dome: riveted plate with an open, softly lit slit.
    float plate = step(fract(atan(vLocal.z, vLocal.x) * 3.82), 0.06) + step(fract(vLocal.y * 5.0), 0.07);
    albedo = vec3(0.240, 0.262, 0.310) * (0.86 + 0.20 * grain) * (1.0 - 0.32 * min(plate, 1.0));
    float slit = step(abs(vLocal.x), 0.085) * step(0.0, vLocal.z) * step(0.10, vLocal.y);
    emissive = vec3(0.62, 0.78, 1.0) * slit * (1.3 + 0.7 * uBeacon);
    albedo *= 1.0 - slit;
  } else {
    // Roof: dark timber, snow lying on anything facing up.
    albedo = vec3(0.046, 0.036, 0.034) * (0.8 + 0.4 * grain);
    snow = step(0.30, N.y + (grain - 0.5) * 0.25);
  }
  albedo = mix(albedo, vec3(0.50, 0.58, 0.72) * (0.86 + 0.20 * grain), snow);

  float moon = max(dot(N, uMoonDir), 0.0);
  vec3 light = uMoonColor * moon * 1.15 + uAmbient * (0.40 + 0.60 * max(N.y, 0.0) + 0.25 * snow);
  // The snow slowly takes on the aurora's colour: the sustained layer of the
  // music is visible on the landscape, not only in the sky.
  light += uAuroraLow * uAuroraGain * 0.20 * (0.35 + 0.65 * max(N.y, 0.0));
  vec3 col = albedo * light + emissive;

  vec3 toCam = vWorld - cameraPosition;
  float dist = length(toCam);
  vec3 viewDir = toCam / max(dist, 1e-3);

  // Warm pooled light from this instance's lamp. Bass lifts NEARBY lamps only.
  if (vLamp.w > 0.0) {
    vec3 L = vLamp.xyz - vWorld;
    float d2 = dot(L, L);
    float r2 = vLamp.w * vLamp.w;
    float att = r2 / (r2 + d2);
    float facing = 0.45 + 0.55 * max(dot(N, normalize(L)), 0.0);
    float near = 1.0 - smoothstep(70.0, 280.0, length(vLamp.xyz - cameraPosition));
    col += mix(0.11, 0.24, snow) * uLampColor * att * att * facing * uLampLevel * (1.0 + 0.55 * uKick * near);
  }

  // Distance haze + altitude mist, both resolving to the dome's own backdrop.
  float haze = 1.0 - exp(-dist / uHazeDistance);
  haze = max(haze, smoothstep(1450.0, 1900.0, dist));
  float wisps = (vnoise3(vWorld * 0.012 + vec3(uTime * 0.01, 0.0, 0.0)) - 0.5) * vParams.w * 0.45;
  float low = 1.0 - smoothstep(vParams.z - vParams.w, vParams.z, vWorld.y + wisps);
  low = clamp(low + (bayer4(gl_FragCoord.xy * 0.5) - 0.5) * 0.06 * step(0.001, low), 0.0, 1.0);
  // A faint moonlit lip where rock meets mist is what reveals the depth.
  col += uMistColor * low * (1.0 - low) * 0.9 * (0.35 + 0.65 * uMist) * (1.0 + 2.2 * uSub);
  float fade = max(haze, low * low);
  // Air between here and the rock is DARKER than the sky behind it until the
  // far distance, so every range stands as a silhouette one step paler than
  // the one in front, and the last one meets the sky without an edge.
  vec3 air = midnightBackdrop(viewDir) * mix(0.42, 1.0, smoothstep(700.0, 1850.0, dist));
  col = mix(col, mix(air, midnightBackdrop(viewDir), low * low), clamp(fade, 0.0, 1.0));

  gl_FragColor = vec4(signalDither(col), 1.0);
}
`;

const GLOW_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uLampLevel;
uniform float uKick;
uniform float uAccent;
uniform float uAccentSlot;
uniform float uBeacon;
attribute vec3 aColor;
attribute vec4 aGlow;
varying vec2 vUv;
varying vec3 vColor;
varying float vIntensity;
varying float vCore;
void main() {
  vUv = uv * 2.0 - 1.0;
  vCore = aGlow.w;
  vec4 centre = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float size = length(instanceMatrix[0].xyz);
  float dist = length(centre.xyz - cameraPosition);
  // Keep distant lights at least a couple of pixels wide so far cabins still
  // read as lights; a rejected (zero-scale) instance stays invisible.
  float sized = size > 0.0 ? max(size, dist * 0.0042) : 0.0;

  float kind = aGlow.y;
  float intensity = aGlow.x;
  if (kind < 0.5) {
    // Lamp: steady, with a bass lift that only reaches nearby lamps.
    float near = 1.0 - smoothstep(70.0, 280.0, dist);
    intensity *= uLampLevel * (1.0 + 0.55 * uKick * near);
  } else if (kind < 1.5) {
    // Window: one structure at a time answers a percussion accent.
    float mine = 1.0 - step(0.5, abs(mod(uAccentSlot, 5.0) - aGlow.z));
    intensity *= (0.80 + 0.20 * uLampLevel) * (1.0 + 0.9 * uAccent * mine);
  } else {
    // Beacon: slow breathing, plus the same sparse accent.
    intensity *= 0.55 + 0.45 * uBeacon + 0.6 * uAccent * step(mod(uAccentSlot, 5.0), 0.5);
  }
  vIntensity = intensity * exp(-dist / 1700.0);
  vColor = aColor;

  vec4 view = viewMatrix * centre;
  view.xy += position.xy * sized;
  gl_Position = projectionMatrix * view;
}
`;

const GLOW_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vIntensity;
varying float vCore;
void main() {
  // Authored at 9x9 "texels": a hard square core inside a stepped halo.
  vec2 q = (floor(vUv * 4.5 + 0.5)) / 4.5;
  float d = max(abs(q.x), abs(q.y)) * 0.55 + length(q) * 0.45;
  float core = step(d, 0.15 + vCore);
  float halo = floor(clamp(1.0 - d, 0.0, 1.0) * 5.0) / 5.0;
  halo = halo * halo * 0.22;
  vec3 col = vColor * (core * 2.6 + halo) * vIntensity;
  col += vec3(1.0, 0.92, 0.80) * core * 0.35 * vIntensity;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createSkyMaterial(uniforms: MidnightUniforms, auroraSteps: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'MidnightSky',
    uniforms,
    defines: { AURORA_STEPS: Math.max(4, Math.floor(auroraSteps)) },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false
  });
}

export function createTerrainMaterial(uniforms: MidnightUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'MidnightTerrain',
    uniforms,
    vertexShader: TERRAIN_VERTEX,
    fragmentShader: TERRAIN_FRAGMENT,
    fog: false
  });
}

export function createGlowMaterial(uniforms: MidnightUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'MidnightGlow',
    uniforms,
    vertexShader: GLOW_VERTEX,
    fragmentShader: GLOW_FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false
  });
}
