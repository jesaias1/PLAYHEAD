/**
 * ORBITAL STATION shaders.
 *
 * Three materials share one uniform set:
 *   sky        one opaque dome: black space, restrained stars, the planet
 *   structure  instanced station hardware: hull plate, lattice truss, solar
 *              cells, modules with windows, dishes, with pooled floodlight
 *   glow       instanced additive billboards: floodlights, amber navigation
 *              lights, the beacon
 *
 * The planet is drawn in the dome, i.e. at infinity. That is what a planet
 * seen from orbit does: its limb is thousands of kilometres away, so a few
 * kilometres of travel cannot move it. It therefore never tracks, slides or
 * intersects anything, and it costs one ray-sphere solve per sky pixel.
 */

import * as THREE from 'three';
import { GLSL_NOISE, GLSL_SIGNAL_DITHER } from '../ThemeShaderChunks';

export interface OrbitalUniforms {
  [name: string]: THREE.IUniform;
  uTime: THREE.IUniform<number>;
  uPlanetDir: THREE.IUniform<THREE.Vector3>;
  uPlanetCos: THREE.IUniform<number>;
  uPlanetSin: THREE.IUniform<number>;
  uSunSide: THREE.IUniform<THREE.Vector3>;
  uDrift: THREE.IUniform<number>;
  uKeyDir: THREE.IUniform<THREE.Vector3>;
  uKeyColor: THREE.IUniform<THREE.Color>;
  uStation: THREE.IUniform<number>;
  uKick: THREE.IUniform<number>;
  uAccent: THREE.IUniform<number>;
  uAccentSlot: THREE.IUniform<number>;
  uHat: THREE.IUniform<number>;
  uHatSlot: THREE.IUniform<number>;
  uBeacon: THREE.IUniform<number>;
}

export function createOrbitalUniforms(): OrbitalUniforms {
  return {
    uTime: { value: 0 },
    uPlanetDir: { value: new THREE.Vector3(0, -1, 0) },
    uPlanetCos: { value: Math.cos(1.12) },
    uPlanetSin: { value: Math.sin(1.12) },
    uSunSide: { value: new THREE.Vector3(1, 0, 0) },
    uDrift: { value: 0 },
    uKeyDir: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },
    uKeyColor: { value: new THREE.Color(0.86, 0.92, 1.0) },
    uStation: { value: 0.6 },
    uKick: { value: 0 },
    uAccent: { value: 0 },
    uAccentSlot: { value: 0 },
    uHat: { value: 0 },
    uHatSlot: { value: 0 },
    uBeacon: { value: 0.5 }
  };
}

const COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uPlanetDir;
${GLSL_NOISE}
${GLSL_SIGNAL_DITHER}
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
uniform float uPlanetCos;
uniform float uPlanetSin;
uniform vec3 uSunSide;
uniform float uDrift;
varying vec3 vDir;

// Restrained, crisp, perfectly steady stars.
vec3 stars(vec3 dir) {
  vec3 col = vec3(0.0);
  vec3 g1 = floor(dir * 280.0);
  float h1 = hash31(g1);
  if (h1 > 0.9972) {
    col += vec3(0.74, 0.82, 1.0) * (1.0 - smoothstep(0.0, 0.0026, length(dir - (g1 + 0.5) / 280.0))) * 0.30;
  }
  vec3 g2 = floor(dir * 150.0);
  float h2 = hash31(g2);
  if (h2 > 0.9978) {
    vec3 tint = mix(vec3(0.84, 0.90, 1.0), vec3(1.0, 0.90, 0.80), step(0.9985, h2));
    col += tint * (1.0 - smoothstep(0.0, 0.0030, length(dir - (g2 + 0.5) / 150.0))) * 0.8;
  }
  vec3 g3 = floor(dir * 60.0);
  float h3 = hash31(g3);
  if (h3 > 0.9993) {
    vec3 d = dir - (g3 + 0.5) / 60.0;
    float core = 1.0 - smoothstep(0.0, 0.0042, length(d));
    float spike = max(
      max(1.0 - abs(d.x) / 0.0010, 0.0) * max(1.0 - abs(d.y) / 0.011, 0.0),
      max(1.0 - abs(d.y) / 0.0010, 0.0) * max(1.0 - abs(d.x) / 0.011, 0.0));
    col += vec3(0.94, 0.97, 1.0) * (core * 1.4 + spike * 0.3);
  }
  return col;
}

void main() {
  vec3 dir = normalize(vDir);
  float mu = dot(dir, uPlanetDir);
  float rho = acos(uPlanetCos);
  float ang = acos(clamp(mu, -1.0, 1.0));
  // Which way round the limb this pixel is: +1 on the side the sun is behind.
  vec3 radial = normalize(dir - uPlanetDir * mu + vec3(1e-5));
  float dawn = max(dot(radial, uSunSide), 0.0);
  vec3 air = vec3(0.20, 0.46, 1.0);
  vec3 col = vec3(0.0);

  if (mu < uPlanetCos) {
    col = stars(dir);
    // Thin atmosphere standing off the limb, brightest towards the dawn.
    float off = ang - rho;
    col += air * exp(-off * 110.0) * (0.10 + 0.75 * dawn * dawn);
    col += air * exp(-off * 28.0) * 0.020 * (0.3 + dawn);
  } else {
    // Unit sphere seen from distance 1/sin(rho): solve for the surface point.
    float dist = 1.0 / uPlanetSin;
    float b = dist * mu;
    float t = b - sqrt(max(b * b - dist * dist + 1.0, 0.0));
    vec3 n = normalize(dir * t - uPlanetDir * dist);
    // The station is in orbit: the ground creeps past, barely.
    float c = cos(uDrift);
    float s = sin(uDrift);
    vec3 g = vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c);

    // Night side: a faint cloud deck and landmasses you sense more than see.
    float land = smoothstep(0.46, 0.58, vnoise3(g * 5.0 + 3.0) * 0.62 + vnoise3(g * 13.0) * 0.38);
    float cloud = smoothstep(0.52, 0.80, vnoise3(g * 8.0 + 11.0) * 0.6 + vnoise3(g * 21.0) * 0.4);
    col = vec3(0.0020, 0.0042, 0.0100) + vec3(0.0030, 0.0050, 0.0090) * land + vec3(0.006, 0.008, 0.012) * cloud;

    // City lights: sparse pin-pricks gathered into a few clusters on land,
    // dimmed where cloud lies over them.
    float urban = land * smoothstep(0.46, 0.74, vnoise3(g * 44.0 + 7.0)) * smoothstep(0.30, 0.60, vnoise3(g * 15.0 + 21.0));
    vec3 cell = floor(g * 1300.0);
    float h = hash31(cell);
    float pin = step(1.0 - 0.55 * urban, h) * (1.0 - smoothstep(0.0, 0.00058, length(g - (cell + 0.5) / 1300.0)));
    vec3 lights = mix(vec3(1.0, 0.72, 0.40), vec3(1.0, 0.90, 0.72), fract(h * 37.0));
    // Filaments between the clusters, like roads seen from orbit.
    float web = smoothstep(0.46, 0.5, 1.0 - abs(vnoise3(g * 120.0 + 3.0) - 0.5) * 2.0) * urban;
    col += lights * (pin * 0.8 + urban * urban * 0.045 + web * 0.035) * (1.0 - 0.75 * cloud);

    // Limb: the air seen edge-on, and the first line of dawn on the far side.
    float inside = (rho - ang) / rho;
    col += air * exp(-inside * 46.0) * (0.12 + 0.95 * dawn * dawn);
    col += vec3(1.0, 0.86, 0.70) * exp(-inside * 170.0) * pow(dawn, 6.0) * 0.9;
    col += air * exp(-inside * 9.0) * 0.012;
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
varying vec4 vLamp;
varying float vSeed;
void main() {
  vLocal = position;
  vNormalL = normal;
  vParams = aParams;
  vLamp = aLamp;
  vSeed = aSeed;
  vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const STRUCTURE_FRAGMENT = /* glsl */ `
${COMMON}
uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform float uStation;
uniform float uKick;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vScale;
varying vec3 vNormalL;
varying vec4 vParams;
varying vec4 vLamp;
varying float vSeed;

void main() {
  float kind = vParams.x;
  float texel = max(0.25, vParams.y);
  vec3 toCam = vWorld - cameraPosition;
  float dist = length(toCam);
  vec3 viewDir = toCam / max(dist, 1e-3);

  // Far hardware dissolves through an ordered screen instead of popping at
  // the far plane. Space has no haze to hide it in.
  if (dist > 1450.0 && bayer4(gl_FragCoord.xy * 0.5) < smoothstep(1450.0, 1900.0, dist)) discard;

  // Face coordinates in metres. Flat-sided parts map per face; round parts
  // wrap around their axis.
  vec3 an = abs(vNormalL);
  vec3 m = vLocal * vScale;
  vec2 uv;
  vec2 face;
  if (kind > 3.5) {
    float around = atan(vLocal.z, vLocal.x) * max(vScale.x, vScale.z);
    uv = an.y > 0.7 ? m.xz : vec2(around, m.y);
    face = vec2(6.2832 * max(vScale.x, vScale.z), vScale.y);
  } else if (an.y > 0.5) {
    uv = m.xz;
    face = vScale.xz;
  } else if (an.x > 0.5) {
    uv = m.zy;
    face = vScale.zy;
  } else {
    uv = m.xy;
    face = vScale.xy;
  }

  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 cell = floor(vWorld / texel);
  float grain = hash31(cell + vSeed * 17.0);
  vec3 albedo;
  vec3 emissive = vec3(0.0);
  float sheen = 0.0;

  if (kind < 0.5) {
    // Hull plate: riveted panels, each a slightly different batch of paint,
    // streaked where years of venting have run down it.
    float panel = texel * 10.0;
    vec2 pid = floor(uv / panel);
    vec2 pf = fract(uv / panel);
    float seam = max(step(pf.x, 0.045), step(pf.y, 0.045));
    float tone = hash31(vec3(pid, vSeed * 31.0));
    float streak = vnoise1(uv.x / texel * 0.55 + vSeed * 40.0) * vnoise1(uv.y / texel * 0.06 + pid.x);
    albedo = vec3(0.100, 0.108, 0.124) * (0.78 + 0.34 * tone) * (0.86 + 0.18 * grain) * (1.0 - 0.45 * streak);
    albedo *= 1.0 - 0.55 * seam;
    // An occasional service panel carries worn hazard chevrons.
    if (tone > 0.94) {
      float chevron = step(0.5, fract((pf.x + pf.y) * 4.0));
      albedo = mix(albedo, vec3(0.30, 0.19, 0.04) * (0.7 + 0.4 * grain), chevron * step(0.12, pf.y) * step(pf.y, 0.30));
    }
  } else if (kind < 1.5) {
    // Lattice truss: a plain box whose faces are cut into braced bays, so the
    // structure is see-through and reads as a silhouette at any distance.
    float bay = min(face.x, face.y);
    vec2 bf = fract(uv / bay + 0.5);
    // Members thicken with distance so a far truss stays a steady silhouette
    // instead of breaking into sparkle.
    vec2 bw = fwidth(uv / bay);
    float chord = clamp(max(0.105, 1.6 * max(bw.x, bw.y)), 0.105, 0.5);
    float keep = max(max(step(bf.x, chord), step(1.0 - chord, bf.x)), max(step(bf.y, chord), step(1.0 - chord, bf.y)));
    keep = max(keep, max(step(abs(bf.x - bf.y), chord * 0.85), step(abs(bf.x + bf.y - 1.0), chord * 0.85)));
    if (keep < 0.5) discard;
    albedo = vec3(0.150, 0.158, 0.176) * (0.80 + 0.26 * grain);
  } else if (kind < 2.5) {
    // Solar array: dark cells in a silver grid, catching the key light.
    float cellSize = texel * 5.0;
    vec2 cf = fract(uv / cellSize);
    vec2 cw = fwidth(uv / cellSize);
    // Once a cell is smaller than a pixel or two, draw the panel's average.
    float detail = 1.0 - smoothstep(0.25, 0.6, max(cw.x, cw.y));
    float line = max(step(cf.x, 0.06), step(cf.y, 0.06)) * detail;
    float border = max(step(abs(uv.x), face.x * 0.5 - texel), 0.0);
    float cellTone = mix(1.05, 0.8 + 0.5 * hash31(vec3(floor(uv / cellSize), vSeed)), detail);
    albedo = mix(vec3(0.012, 0.024, 0.066) * cellTone, vec3(0.20, 0.22, 0.26), line);
    albedo = mix(vec3(0.16, 0.17, 0.19), albedo, border);
    sheen = (1.0 - line) * 0.35;
  } else if (kind < 3.5) {
    // Dish / bright bare metal with radial ribs.
    float ribs = step(fract(atan(vLocal.z, vLocal.x) * 3.82), 0.07) + step(fract(length(vLocal.xz) * 5.0), 0.06);
    albedo = vec3(0.230, 0.240, 0.262) * (0.86 + 0.20 * grain) * (1.0 - 0.34 * min(ribs, 1.0));
  } else {
    // Pressurised module: banded plating with rows of small lit ports.
    float band = step(fract(uv.y / (texel * 9.0)), 0.07);
    albedo = vec3(0.128, 0.134, 0.150) * (0.80 + 0.26 * grain) * (1.0 - 0.45 * band);
    vec2 wsize = vec2(texel * 3.0, texel * 9.0);
    vec2 wid = floor(uv / wsize);
    vec2 wf = fract(uv / wsize);
    float lit = step(0.80, hash31(vec3(wid, vSeed * 13.0)));
    float port = step(0.25, wf.x) * step(wf.x, 0.75) * step(0.42, wf.y) * step(wf.y, 0.60) * step(an.y, 0.7);
    vec3 warm = mix(vec3(0.80, 0.90, 1.0), vec3(1.0, 0.70, 0.36), step(0.93, hash31(vec3(wid, 5.0))));
    emissive += warm * lit * port * (0.25 + 0.85 * uStation);
    albedo *= 1.0 - port;
  }

  // Energy conduit: a line of light along the member that answers the bass.
  if (vParams.z > 0.5) {
    float across = face.x > face.y ? uv.y / face.y : uv.x / face.x;
    float along = face.x > face.y ? uv.x : uv.y;
    float run = step(abs(across), 0.055) * step(0.25, fract(along / (texel * 6.0)));
    emissive += vec3(0.30, 0.58, 1.0) * run * (0.16 + 1.25 * uKick) * exp(-dist / 900.0);
  }

  // Hard key light, a little planet-shine from below, almost no ambient:
  // the lit side is crisp and the far side falls to black, as it does in orbit.
  float key = max(dot(N, uKeyDir), 0.0);
  vec3 light = uKeyColor * key * 1.25
    + vec3(0.050, 0.105, 0.230) * max(dot(N, uPlanetDir), 0.0) * 0.55
    + vec3(0.010, 0.013, 0.020);
  vec3 col = albedo * light + emissive;
  vec3 halfDir = normalize(uKeyDir - viewDir);
  col += uKeyColor * sheen * pow(max(dot(N, halfDir), 0.0), 18.0) * key;

  // Pooled floodlight from this instance's lamp. Sustained energy raises the
  // whole station's working light slowly.
  if (vLamp.w > 0.0) {
    vec3 L = vLamp.xyz - vWorld;
    float r2 = vLamp.w * vLamp.w;
    float att = r2 / (r2 + dot(L, L));
    float facing = 0.35 + 0.65 * max(dot(N, normalize(L)), 0.0);
    col += (albedo * 3.2 + vec3(0.010)) * vec3(0.80, 0.90, 1.0) * att * att * facing * (0.30 + 0.90 * uStation);
  }

  gl_FragColor = vec4(signalDither(col), 1.0);
}
`;

const GLOW_VERTEX = /* glsl */ `
uniform float uStation;
uniform float uAccent;
uniform float uAccentSlot;
uniform float uHat;
uniform float uHatSlot;
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
  float sized = size > 0.0 ? max(size, dist * 0.0040) : 0.0;

  float kind = aGlow.y;
  float intensity = aGlow.x;
  if (kind < 0.5) {
    // Floodlight: follows the station's slow working-light level.
    intensity *= 0.30 + 0.80 * uStation;
  } else if (kind < 1.5) {
    // Navigation light: a steady low glow; each percussion hit lets a
    // different handful flash and fall away smoothly.
    float mine = step(0.72, fract(aGlow.z * 0.754877 + uHatSlot * 0.6180339));
    float strobe = 1.0 - step(0.5, abs(mod(uAccentSlot, 5.0) - floor(aGlow.z * 5.0)));
    intensity *= 0.55 + 1.20 * uHat * mine + 0.9 * uAccent * strobe;
  } else {
    // Beacon: slow breath plus the sparse accent.
    intensity *= 0.50 + 0.50 * uBeacon + 0.6 * uAccent * step(mod(uAccentSlot, 5.0), 0.5);
  }
  vIntensity = intensity * (1.0 - smoothstep(1500.0, 1900.0, dist));
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
  // A hard square core inside a stepped halo, authored at 9x9 "texels".
  vec2 q = (floor(vUv * 4.5 + 0.5)) / 4.5;
  float d = max(abs(q.x), abs(q.y)) * 0.55 + length(q) * 0.45;
  float core = step(d, 0.15 + vCore);
  float halo = floor(clamp(1.0 - d, 0.0, 1.0) * 5.0) / 5.0;
  halo = halo * halo * 0.20;
  vec3 col = vColor * (core * 2.6 + halo) * vIntensity;
  col += vec3(1.0, 0.96, 0.90) * core * 0.35 * vIntensity;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createOrbitalSkyMaterial(uniforms: OrbitalUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'OrbitalSky',
    uniforms,
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false
  });
}

export function createOrbitalStructureMaterial(uniforms: OrbitalUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'OrbitalStructure',
    uniforms,
    vertexShader: STRUCTURE_VERTEX,
    fragmentShader: STRUCTURE_FRAGMENT,
    side: THREE.DoubleSide,
    fog: false
  });
}

export function createOrbitalGlowMaterial(uniforms: OrbitalUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'OrbitalGlow',
    uniforms,
    vertexShader: GLOW_VERTEX,
    fragmentShader: GLOW_FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false
  });
}
