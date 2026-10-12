/**
 * MIDNIGHT HARBOUR shaders.
 *
 *   sky        one opaque dome: dark sky, a few stars, sodium haze over the port
 *   structure  instanced steel and concrete: hulls, container stacks, lattice
 *              cranes, warehouses, quays, the lighthouse
 *   water      one opaque plane: black water, slow swell, and broken streaks
 *              of light under the nearest lamps
 *
 * Water is scenery only. Its "reflections" are a stylised glitter path under a
 * handful of nearby lights, not a mirror: it costs a short loop per water
 * pixel and can never show (or hide) a platform.
 */

import * as THREE from 'three';
import { GLSL_NOISE, GLSL_SIGNAL_DITHER } from '../ThemeShaderChunks';

export const WATER_LIGHT_COUNT = 8;

export interface HarbourUniforms {
  [name: string]: THREE.IUniform;
  uTime: THREE.IUniform<number>;
  uKeyDir: THREE.IUniform<THREE.Vector3>;
  uHaze: THREE.IUniform<THREE.Color>;
  uPortDir: THREE.IUniform<THREE.Vector3>;
  uWaterY: THREE.IUniform<number>;
  uStation: THREE.IUniform<number>;
  uKick: THREE.IUniform<number>;
  uAccent: THREE.IUniform<number>;
  uAccentSlot: THREE.IUniform<number>;
  uHat: THREE.IUniform<number>;
  uHatSlot: THREE.IUniform<number>;
  uBeacon: THREE.IUniform<number>;
  uLightPos: THREE.IUniform<THREE.Vector3[]>;
  uLightColor: THREE.IUniform<THREE.Color[]>;
}

export function createHarbourUniforms(): HarbourUniforms {
  return {
    uTime: { value: 0 },
    uKeyDir: { value: new THREE.Vector3(0.3, 0.85, 0.4).normalize() },
    uHaze: { value: new THREE.Color(0.010, 0.014, 0.022) },
    uPortDir: { value: new THREE.Vector3(1, 0, 0) },
    uWaterY: { value: -80 },
    uStation: { value: 0.6 },
    uKick: { value: 0 },
    uAccent: { value: 0 },
    uAccentSlot: { value: 0 },
    uHat: { value: 0 },
    uHatSlot: { value: 0 },
    uBeacon: { value: 0.5 },
    uLightPos: { value: Array.from({ length: WATER_LIGHT_COUNT }, () => new THREE.Vector3(0, -1e5, 0)) },
    uLightColor: { value: Array.from({ length: WATER_LIGHT_COUNT }, () => new THREE.Color(0, 0, 0)) }
  };
}

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uHaze;
uniform vec3 uPortDir;
uniform float uStation;
${GLSL_NOISE}
${GLSL_SIGNAL_DITHER}
varying vec3 vDir;
void main() {
  vec3 dir = normalize(vDir);
  float e = dir.y;
  vec3 col = mix(uHaze * 3.4, vec3(0.0015, 0.0025, 0.006), pow(smoothstep(0.0, 0.5, e), 0.45));
  // The port lights up the haze above it: a low sodium dome on one side.
  float toPort = max(dot(normalize(dir.xz + vec2(1e-5)), normalize(uPortDir.xz + vec2(1e-5))), 0.0);
  float low = 1.0 - smoothstep(0.0, 0.26, abs(e));
  col += vec3(0.085, 0.048, 0.017) * (0.25 + 0.75 * toPort * toPort) * low * (0.55 + 0.45 * uStation);
  if (e > 0.02) {
    vec3 g = floor(dir * 170.0);
    float h = hash31(g);
    if (h > 0.9972) col += vec3(0.80, 0.86, 1.0) * (1.0 - smoothstep(0.0, 0.0030, length(dir - (g + 0.5) / 170.0))) * 0.6 * smoothstep(0.02, 0.3, e);
  } else {
    col = mix(col, vec3(0.002, 0.004, 0.008), smoothstep(0.0, -0.08, e));
  }
  gl_FragColor = vec4(signalDither(col), 1.0);
}
`;

const STRUCTURE_VERTEX = /* glsl */ `
attribute vec4 aParams;
attribute vec4 aLamp;
attribute float aSeed;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vScale;
varying vec3 vNormalL;
varying vec4 vParams;
varying float vSeed;
void main() {
  vLocal = position;
  vNormalL = normal;
  vParams = aParams;
  vSeed = aSeed;
  vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const STRUCTURE_FRAGMENT = /* glsl */ `
uniform vec3 uKeyDir;
uniform vec3 uHaze;
uniform float uWaterY;
uniform float uStation;
uniform float uKick;
${GLSL_NOISE}
${GLSL_SIGNAL_DITHER}
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vScale;
varying vec3 vNormalL;
varying vec4 vParams;
varying float vSeed;

vec3 containerPaint(float h) {
  if (h < 0.24) return vec3(0.150, 0.040, 0.026);  // oxide red
  if (h < 0.44) return vec3(0.030, 0.062, 0.110);  // faded blue
  if (h < 0.60) return vec3(0.034, 0.084, 0.060);  // green
  if (h < 0.80) return vec3(0.090, 0.092, 0.098);  // grey
  return vec3(0.150, 0.098, 0.030);                // ochre
}

void main() {
  float kind = vParams.x;
  float texel = max(0.2, vParams.y);
  vec3 toCam = vWorld - cameraPosition;
  float dist = length(toCam);
  if (dist > 1500.0 && bayer4(gl_FragCoord.xy * 0.5) < smoothstep(1500.0, 1900.0, dist)) discard;

  vec3 an = abs(vNormalL);
  vec3 m = vLocal * vScale;
  vec2 uv;
  vec2 face;
  if (an.y > 0.5) { uv = m.xz; face = vScale.xz; }
  else if (an.x > 0.5) { uv = m.zy; face = vScale.zy; }
  else { uv = m.xy; face = vScale.xy; }
  float wall = 1.0 - step(0.5, an.y);

  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  float grain = hash31(floor(vWorld / texel) + vSeed * 17.0);
  vec3 albedo;
  vec3 emissive = vec3(0.0);

  if (kind < 0.5) {
    // Quay concrete: lifts, fender marks, weed-dark near the water.
    float seam = step(fract(uv.y / (texel * 6.0)), 0.07) * wall;
    float tide = 1.0 - smoothstep(uWaterY, uWaterY + 14.0, vWorld.y);
    albedo = vec3(0.074, 0.078, 0.086) * (0.84 + 0.22 * grain) * (1.0 - 0.4 * seam) * (1.0 - 0.55 * tide);
  } else if (kind < 1.5) {
    // Hull: black topsides over red anti-fouling, plate seams, rust runs
    // weeping from the scuppers, a row of warm portholes under the rail.
    float plate = max(step(fract(uv.x / (texel * 9.0)), 0.03), step(fract(uv.y / (texel * 5.0)), 0.035)) * wall;
    float boot = 1.0 - smoothstep(uWaterY + 7.0, uWaterY + 8.0, vWorld.y);
    float rust = vnoise1(uv.x / texel * 0.5 + vSeed * 23.0) * smoothstep(0.5, -0.2, vLocal.y) * wall;
    albedo = mix(vec3(0.034, 0.040, 0.052), vec3(0.110, 0.030, 0.022), boot) * (0.84 + 0.24 * grain);
    albedo = mix(albedo, vec3(0.120, 0.052, 0.024), rust * 0.55) * (1.0 - 0.4 * plate);
    float fromTop = vScale.y * 0.5 - m.y;
    vec2 pf = fract(vec2(uv.x / (texel * 4.0), 0.0));
    float port = step(texel * 2.4, fromTop) * step(fromTop, texel * 3.4) * step(0.34, pf.x) * step(pf.x, 0.66) * wall;
    float lit = step(1.0 - vParams.z, hash31(vec3(floor(uv.x / (texel * 4.0)), vSeed * 5.0, 1.0)));
    emissive += vec3(1.0, 0.72, 0.40) * port * lit * 0.9;
  } else if (kind < 2.5) {
    // Lattice: crane legs and booms.
    float bay = min(face.x, face.y);
    vec2 bf = fract(uv / bay + 0.5);
    vec2 bw = fwidth(uv / bay);
    float chord = clamp(max(0.11, 1.6 * max(bw.x, bw.y)), 0.11, 0.5);
    float keep = max(max(step(bf.x, chord), step(1.0 - chord, bf.x)), max(step(bf.y, chord), step(1.0 - chord, bf.y)));
    keep = max(keep, max(step(abs(bf.x - bf.y), chord * 0.85), step(abs(bf.x + bf.y - 1.0), chord * 0.85)));
    if (keep < 0.5) discard;
    albedo = vec3(0.150, 0.092, 0.030) * (0.8 + 0.3 * grain); // crane yellow, gone dull
  } else if (kind < 3.5) {
    // Container stack: one box drawn as many containers, each its own colour,
    // corrugated, with door bars on the short ends.
    vec2 unit = an.y > 0.5 ? vec2(2.44, 12.2) : (face.x > face.y * 2.5 || an.x > 0.5 ? vec2(12.2, 2.6) : vec2(2.44, 2.6));
    vec2 cid = floor(uv / unit + 0.5);
    vec2 cf = fract(uv / unit + 0.5);
    vec2 cw = fwidth(uv / unit);
    float fine = 1.0 - smoothstep(0.25, 0.6, max(cw.x, cw.y));
    float edge = max(max(step(cf.x, 0.02), step(0.98, cf.x)), max(step(cf.y, 0.05), step(0.95, cf.y)));
    float rib = 0.82 + 0.18 * step(0.5, fract(uv.x / 0.42)) * wall;
    albedo = containerPaint(hash31(vec3(cid, vSeed * 29.0))) * mix(1.0, rib, fine) * (0.84 + 0.22 * grain);
    albedo *= 1.0 - 0.5 * edge * fine;
  } else if (kind < 4.5) {
    // Warehouse: pale ribbed cladding, roller doors, a few lit office windows.
    float rib = 0.86 + 0.14 * step(0.5, fract(uv.x / (texel * 1.2))) * wall;
    float bayW = texel * 14.0;
    vec2 df = fract(vec2(uv.x / bayW, 0.0));
    float door = step(0.25, df.x) * step(df.x, 0.75) * step(m.y, -vScale.y * 0.5 + min(9.0, vScale.y * 0.5)) * wall;
    albedo = vec3(0.090, 0.094, 0.100) * rib * (0.84 + 0.22 * grain);
    albedo = mix(albedo, vec3(0.040, 0.044, 0.050), door * 0.8);
    vec2 wsize = vec2(texel * 3.0, texel * 3.2);
    vec2 wid = floor(uv / wsize + 0.5);
    vec2 wf = fract(uv / wsize + 0.5);
    float band = step(vScale.y * 0.5 - texel * 5.0, m.y) * step(m.y, vScale.y * 0.5 - texel * 1.6);
    float pane = step(0.2, wf.x) * step(wf.x, 0.8) * step(0.25, wf.y) * step(wf.y, 0.75) * band * wall;
    float lit = step(1.0 - vParams.z, hash31(vec3(wid.x, vSeed * 13.0, 2.0)));
    // Sustained energy: the working lights of the sheds come up slowly.
    emissive += vec3(1.0, 0.74, 0.44) * pane * lit * (0.30 + 0.85 * uStation);
    albedo *= 1.0 - pane * 0.8;
  } else {
    // Lighthouse / funnel: broad painted bands, weathered.
    float bandN = step(0.5, fract(vLocal.y * 2.5 + 0.25));
    albedo = mix(vec3(0.210, 0.205, 0.195), vec3(0.150, 0.030, 0.024), bandN) * (0.82 + 0.26 * grain);
  }

  // Dock-light strip under the coping of flagged pieces: this is what the bass
  // moves. Sodium amber, smooth decay, a steady low level otherwise.
  if (vParams.w > 0.5 && wall > 0.5) {
    float fromTop = vScale.y * 0.5 - m.y;
    float strip = step(texel * 1.0, fromTop) * step(fromTop, texel * 2.2) * step(0.2, fract(uv.x / (texel * 8.0)));
    emissive += vec3(1.0, 0.56, 0.16) * strip * (0.20 + 1.05 * uKick) * exp(-dist / 800.0);
  }

  float key = max(dot(N, uKeyDir), 0.0);
  vec3 light = vec3(0.42, 0.48, 0.60) * key + vec3(0.020, 0.024, 0.034) * (0.6 + 0.4 * N.y)
    + vec3(0.050, 0.030, 0.012) * (0.4 + 0.6 * uStation) * max(-N.y * 0.5 + 0.5, 0.0) * 0.5;
  vec3 col = albedo * light * 3.2 + emissive;
  float haze = (1.0 - exp(-dist / 700.0)) * 0.86;
  col = mix(col, uHaze + emissive * 0.5, haze);
  gl_FragColor = vec4(signalDither(col), 1.0);
}
`;

const WATER_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const WATER_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uHaze;
uniform vec3 uPortDir;
uniform float uStation;
uniform vec3 uLightPos[${WATER_LIGHT_COUNT}];
uniform vec3 uLightColor[${WATER_LIGHT_COUNT}];
${GLSL_NOISE}
${GLSL_SIGNAL_DITHER}
varying vec3 vWorld;
void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 view = toCam / max(dist, 1e-3);
  // Slow swell at two scales. World-anchored, so it never slides with the camera.
  float swell = vnoise3(vec3(vWorld.xz * 0.018 + vec2(uTime * 0.05, 0.0), uTime * 0.07)) * 0.6
              + vnoise3(vec3(vWorld.xz * 0.075 - vec2(0.0, uTime * 0.09), uTime * 0.11)) * 0.4;
  float graze = pow(1.0 - clamp(view.y, 0.0, 1.0), 4.0);
  vec3 col = vec3(0.0030, 0.0062, 0.0115) * (0.6 + 0.8 * swell);
  // The sky's low haze lying on the far water, warmer towards the port.
  float toPort = max(dot(normalize(-view.xz + vec2(1e-5)), normalize(uPortDir.xz + vec2(1e-5))), 0.0);
  col += (uHaze * 1.6 + vec3(0.040, 0.022, 0.008) * toPort * toPort * (0.5 + 0.5 * uStation)) * graze;

  // Glitter paths: a broken streak from under each nearby light towards the eye.
  for (int i = 0; i < ${WATER_LIGHT_COUNT}; i++) {
    vec3 lp = uLightPos[i];
    float height = lp.y - vWorld.y;
    if (height <= 0.0) continue;
    vec2 foot = lp.xz;
    vec2 toEye = cameraPosition.xz - foot;
    float reach = length(toEye);
    vec2 axis = toEye / max(reach, 1e-3);
    vec2 rel = vWorld.xz - foot;
    float along = dot(rel, axis);
    if (along < -4.0 || along > reach) continue;
    float perp = abs(dot(rel, vec2(-axis.y, axis.x)));
    float width = 2.2 + along * 0.05 + height * 0.02 + (swell - 0.5) * (2.0 + along * 0.04);
    float streak = exp(-(perp * perp) / max(width * width, 0.5));
    float dashes = smoothstep(0.38, 0.62, vnoise3(vec3(along * 0.22 - uTime * 0.5, float(i) * 7.0, perp * 0.3)));
    float fall = exp(-along / (70.0 + height * 3.0)) * smoothstep(-4.0, 6.0, along);
    // Bounded: a reflection may suggest a light, never outshine it.
    col += min(uLightColor[i] * streak * (0.25 + 0.75 * dashes) * fall * 0.5, vec3(0.16));
  }

  // Far water goes to the haze, so the plane has no visible edge.
  col = mix(col, uHaze * 1.8, smoothstep(700.0, 1900.0, dist));
  gl_FragColor = vec4(signalDither(col), 1.0);
}
`;

export function createHarbourSkyMaterial(uniforms: HarbourUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'HarbourSky',
    uniforms,
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false
  });
}

export function createHarbourStructureMaterial(uniforms: HarbourUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'HarbourStructure',
    uniforms,
    vertexShader: STRUCTURE_VERTEX,
    fragmentShader: STRUCTURE_FRAGMENT,
    side: THREE.DoubleSide,
    fog: false
  });
}

export function createHarbourWaterMaterial(uniforms: HarbourUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'HarbourWater',
    uniforms,
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    fog: false
  });
}
