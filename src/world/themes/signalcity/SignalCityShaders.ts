/**
 * SIGNAL CITY layer shaders.
 *
 * One instanced "structure" material covers every new piece of the city:
 * residential concrete with warm windows, dark glass, bare concrete,
 * lattice steel and train cars. Lights (beacons, headlights) are additive
 * billboards from the shared glow batch.
 *
 * Reactivity is deliberately selective: most windows never change. Bass lifts
 * a crown line on flagged buildings, percussion lets a few authored window
 * groups answer, and sustained energy slowly raises the landmark lighting.
 */

import * as THREE from 'three';
import { GLSL_NOISE, GLSL_SIGNAL_DITHER } from '../ThemeShaderChunks';

export interface SignalCityUniforms {
  [name: string]: THREE.IUniform;
  uTime: THREE.IUniform<number>;
  uKeyDir: THREE.IUniform<THREE.Vector3>;
  uHaze: THREE.IUniform<THREE.Color>;
  uSignal: THREE.IUniform<THREE.Color>;
  uWarmth: THREE.IUniform<number>;
  uStation: THREE.IUniform<number>;
  uKick: THREE.IUniform<number>;
  uAccent: THREE.IUniform<number>;
  uAccentSlot: THREE.IUniform<number>;
  uHat: THREE.IUniform<number>;
  uHatSlot: THREE.IUniform<number>;
  uBeacon: THREE.IUniform<number>;
}

export function createSignalCityUniforms(): SignalCityUniforms {
  return {
    uTime: { value: 0 },
    uKeyDir: { value: new THREE.Vector3(0.35, 0.83, 0.42).normalize() },
    uHaze: { value: new THREE.Color(0.012, 0.016, 0.03) },
    uSignal: { value: new THREE.Color(0.2, 0.8, 1.0) },
    uWarmth: { value: 0.8 },
    uStation: { value: 0.6 },
    uKick: { value: 0 },
    uAccent: { value: 0 },
    uAccentSlot: { value: 0 },
    uHat: { value: 0 },
    uHatSlot: { value: 0 },
    uBeacon: { value: 0.5 }
  };
}

const VERTEX = /* glsl */ `
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

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uKeyDir;
uniform vec3 uHaze;
uniform vec3 uSignal;
uniform float uWarmth;
uniform float uStation;
uniform float uKick;
uniform float uHat;
uniform float uHatSlot;
${GLSL_NOISE}
${GLSL_SIGNAL_DITHER}
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vScale;
varying vec3 vNormalL;
varying vec4 vParams;
varying float vSeed;

void main() {
  float kind = vParams.x;
  float texel = max(0.25, vParams.y);
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
  vec3 albedo = vec3(0.07);
  vec3 emissive = vec3(0.0);

  if (kind > 1.5 && kind < 2.5) {
    // Lattice steel: braced bays cut out of a plain box.
    float bay = min(face.x, face.y);
    vec2 bf = fract(uv / bay + 0.5);
    vec2 bw = fwidth(uv / bay);
    float chord = clamp(max(0.11, 1.6 * max(bw.x, bw.y)), 0.11, 0.5);
    float keep = max(max(step(bf.x, chord), step(1.0 - chord, bf.x)), max(step(bf.y, chord), step(1.0 - chord, bf.y)));
    keep = max(keep, max(step(abs(bf.x - bf.y), chord * 0.85), step(abs(bf.x + bf.y - 1.0), chord * 0.85)));
    if (keep < 0.5) discard;
    albedo = vec3(0.105, 0.110, 0.125) * (0.8 + 0.3 * grain);
  } else {
    // Cast concrete: board-marked lifts, tie holes, rain streaks from the top.
    float lift = texel * 6.0;
    float seam = step(fract(uv.y / lift), 0.07) * wall;
    float bayTone = hash31(vec3(floor(uv / vec2(lift * 2.0, lift)), vSeed * 9.0));
    float streak = vnoise1(uv.x / texel * 0.4 + vSeed * 31.0) * smoothstep(-0.5, 0.5, vLocal.y) * wall;
    albedo = vec3(0.078, 0.082, 0.094) * (0.82 + 0.26 * bayTone) * (0.88 + 0.16 * grain) * (1.0 - 0.36 * streak) * (1.0 - 0.4 * seam);
    if (kind > 0.5 && kind < 1.5) {
      // Dark glass: mullioned curtain wall over a nearly black body.
      vec2 gf = fract(uv / vec2(texel * 3.0, texel * 4.0));
      float mullion = max(step(gf.x, 0.08), step(gf.y, 0.06)) * wall;
      albedo = mix(vec3(0.012, 0.016, 0.026), vec3(0.060, 0.064, 0.074), mullion);
    }

    // Windows. vParams.z is how lived-in the building is (0 = none).
    float lived = vParams.z;
    if (lived > 0.001 && wall > 0.5) {
      vec2 wsize = kind > 3.5 ? vec2(texel * 2.4, vScale.y) : vec2(texel * 3.2, texel * 3.6);
      vec2 wid = floor(uv / wsize + 0.5);
      vec2 wf = fract(uv / wsize + 0.5);
      // Keep a blank margin at the corners and the parapet.
      float inset = step(abs(uv.x), face.x * 0.5 - texel * 1.4) * step(abs(uv.y), face.y * 0.5 - texel * 1.6);
      float pane = step(0.22, wf.x) * step(wf.x, 0.78) * step(0.30, wf.y) * step(wf.y, 0.72) * inset;
      vec2 ww = fwidth(uv / wsize);
      float fine = 1.0 - smoothstep(0.3, 0.7, max(ww.x, ww.y));
      float h = hash31(vec3(wid, vSeed * 13.0));
      // Whole floors and the odd stair column stay dark, so a facade reads
      // as rooms and corridors rather than as evenly scattered points.
      float floorOn = step(0.30, hash31(vec3(wid.y, vSeed * 7.0, 3.0)));
      float column = step(0.12, hash31(vec3(wid.x, vSeed * 5.0, 9.0)));
      float lit = step(1.0 - lived, h) * floorOn * column;
      // A few rooms are cool screens; the rest are warm lamps of varying age.
      vec3 warm = mix(vec3(1.0, 0.66, 0.34), vec3(1.0, 0.80, 0.56), fract(h * 91.0));
      vec3 cool = vec3(0.62, 0.80, 1.0);
      vec3 glass = mix(cool, warm, step(fract(h * 53.0), uWarmth));
      // Percussion: a handful of authored window groups answer each hit.
      vec2 gid = floor(wid / vec2(3.0, 2.0));
      float group = step(0.93, fract(hash31(vec3(gid, vSeed * 3.0)) + uHatSlot * 0.6180339));
      float level = (0.55 + 0.45 * fract(h * 17.0)) * (1.0 + 1.4 * uHat * group);
      // Far away, a facade is the average of its windows, not a shimmer.
      emissive += glass * mix(lived * 0.13, lit * pane * level, fine) * 0.9;
      albedo *= 1.0 - pane * fine * 0.8;
    }

    // Crown: one signal-coloured line under the parapet of flagged buildings.
    if (vParams.w > 0.5 && wall > 0.5) {
      float fromTop = vScale.y * 0.5 - m.y;
      float line = step(texel * 1.2, fromTop) * step(fromTop, texel * 2.6);
      emissive += uSignal * line * (0.10 + 0.95 * uKick + 0.25 * uStation) * exp(-dist / 900.0);
    }
  }

  // Lighting: a cold key from above, a faint lift from the lit streets below.
  float key = max(dot(N, uKeyDir), 0.0);
  vec3 light = vec3(0.50, 0.58, 0.74) * key + vec3(0.020, 0.026, 0.040) * (0.6 + 0.4 * N.y)
    + vec3(0.050, 0.034, 0.020) * max(-N.y, 0.0);
  vec3 col = albedo * light * 1.6 + emissive;

  // Haze separates the ranks of buildings; it never fully hides one.
  float haze = (1.0 - exp(-dist / 620.0)) * 0.82;
  col = mix(col, uHaze + emissive * 0.55, haze);
  // Depth fade: far below the eye a building sinks into the city's darkness,
  // so its foundations never end at a visible edge.
  float sink = smoothstep(cameraPosition.y - 70.0, cameraPosition.y - 300.0, vWorld.y);
  col = mix(col, uHaze * 0.35, sink);

  gl_FragColor = vec4(signalDither(col), 1.0);
}
`;

export function createSignalCityMaterial(uniforms: SignalCityUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'SignalCityStructure',
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.DoubleSide,
    fog: false
  });
}
