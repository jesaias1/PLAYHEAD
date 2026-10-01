/**
 * MEGASTRUCTURE — the impossible audio architecture the route hangs inside.
 *
 * Two layers, all presentation-only (no collision, no gameplay reads):
 *
 *  1. ABYSS STRATA   Three enormous haze decks at increasing depth below the
 *                    lowest route geometry. The deepest carries a faint grid of
 *                    far-below city light. Looking over the edge reads as a
 *                    bottomless structure, not an empty black void.
 *  2. HERO STRUCTURES A small, COMPOSED set of colossal forms placed far off the
 *                    route: twin spine monoliths, an orbit frame beyond the
 *                    finish, a sky bridge crossing high over the course and a
 *                    dense monolith field on the opposite side. Density on one
 *                    side, negative space on the other.
 *
 * Distance fog would erase anything this far away, so these materials do their
 * own atmospheric perspective: silhouettes fade toward the palette haze with
 * distance and dissolve downward into the abyss.
 *
 * Music: hero signal channels answer drops and strong transients; the abyss
 * breathes very slightly with the bass. Nothing flashes
 * in lockstep.
 */

import * as THREE from 'three';
import { GeneratedTrack } from '../generation/GenerationTypes';
import { TrackPalette } from '../audio/TrackPalettes';
import { MusicVisualState, resolveChannels } from './MusicVisualController';
import { tagWorldRole } from './WorldRoles';
import { OfficialWorldProfile, FALLBACK_WORLD_PROFILE } from './SignalWorldProfile';

const STRUCTURE_VERT = `
varying vec3 vWorld;
varying vec2 vUv;
varying vec3 vNormalW;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

// Dark architectural mass with its own atmospheric perspective, lit edges,
// sparse signal slits and one vertical signal channel per face.
const STRUCTURE_FRAG = `
uniform vec3 uBase;
uniform vec3 uHaze;
uniform vec3 uAccent;
uniform float uPulse;
uniform float uChannel;
uniform float uAbyssY;
uniform float uFadeNear;
uniform float uFadeFar;
varying vec3 vWorld;
varying vec2 vUv;
varying vec3 vNormalW;
void main() {
  float dist = length(vWorld - cameraPosition);
  float atmo = smoothstep(uFadeNear, uFadeFar, dist);

  // Upward-facing faces catch a little sky; side faces stay heavy.
  float up = clamp(vNormalW.y, 0.0, 1.0);
  vec3 col = uBase * (0.75 + up * 0.6);

  // Edge rim from face UVs: the silhouette is drawn by thin lit edges.
  vec2 e = min(vUv, 1.0 - vUv);
  float edge = 1.0 - smoothstep(0.0, 0.012, min(e.x, e.y));
  col += uHaze * edge * 0.9;

  // Sparse horizontal signal slits (every ~22 m) and one vertical channel.
  float slit = step(0.965, fract(vWorld.y / 22.0)) * step(0.35, fract(sin(floor(vWorld.y / 22.0) * 12.9898) * 43758.5453));
  float channel = 1.0 - smoothstep(0.0, 0.006, abs(vUv.x - 0.5));
  float sideFace = 1.0 - up;
  vec3 glow = uAccent * (slit * 0.35 * (0.4 + uPulse) + channel * sideFace * uChannel * (0.5 + uPulse * 1.6));

  // Dissolve downward into the abyss.
  float abyss = smoothstep(uAbyssY - 420.0, uAbyssY + 60.0, vWorld.y);
  col = mix(uHaze * 0.35, col, abyss);
  glow *= mix(0.2, 1.0, abyss);

  // Atmospheric perspective: far mass lifts toward the haze.
  col = mix(col, uHaze * 0.9, atmo * 0.7);
  glow *= 1.0 - atmo * 0.55;

  gl_FragColor = vec4(col + glow, 1.0);
}
`;

const STRATA_VERT = `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const STRATA_FRAG = `
uniform vec3 uHaze;
uniform vec3 uAccent;
uniform float uTime;
uniform float uDensity;
uniform float uGrid;
uniform float uBreath;
varying vec3 vWorld;

float h21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float vn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 p = vWorld.xz;
  float n = vn(p / 420.0 + uTime * 0.004) * 0.55 + vn(p / 150.0 - uTime * 0.007) * 0.3 + vn(p / 55.0) * 0.15;
  float cloud = smoothstep(0.45, 0.9, n);
  cloud *= cloud;

  float d = length(vWorld.xz - cameraPosition.xz);
  float radial = 1.0 - smoothstep(700.0, 1900.0, d);
  // Seen at a grazing angle a deck would read as a floor; dissolve it there so
  // it only exists when looking DOWN into the abyss.
  vec3 toFrag = normalize(vWorld - cameraPosition);
  radial *= smoothstep(0.08, 0.45, abs(toFrag.y));
  // Never a wall of haze in the camera's face.
  radial *= smoothstep(25.0, 140.0, abs(cameraPosition.y - vWorld.y));

  vec3 col = uHaze * cloud * uDensity * (1.0 + uBreath * 0.5);

  // Far-below city light: a sparse lattice glimpsed through the haze gaps.
  if (uGrid > 0.0) {
    vec2 g = abs(fract(p / 48.0) - 0.5);
    float line = 1.0 - smoothstep(0.0, 0.035, min(g.x, g.y));
    float district = step(0.62, vn(p / 260.0 + 7.0));
    vec2 cell = fract(p / 12.0) - 0.5;
    float lights = step(0.93, h21(floor(p / 12.0))) * (1.0 - step(0.08, max(abs(cell.x), abs(cell.y))));
    col += uAccent * (line * 0.18 + lights * 0.55) * district * uGrid * (1.0 - cloud * 0.7);
  }

  gl_FragColor = vec4(col * radial, 1.0);
}
`;

interface StructureMat {
  material: THREE.ShaderMaterial;
  /** 0 = ambient, 1 = drop-driven hero channel. */
  heroWeight: number;
}

export class Megastructure {
  public readonly group = new THREE.Group();
  /** Haze decks: atmosphere, outside world safety like the sky. */
  public readonly atmosphereGroup = new THREE.Group();

  private structureMats: StructureMat[] = [];
  private strataMats: THREE.ShaderMaterial[] = [];
  private strata: THREE.Mesh[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private pulse = 0;
  private lastTime = 0;

  private profile: OfficialWorldProfile = FALLBACK_WORLD_PROFILE;

  constructor(
    scene: THREE.Scene,
    track: GeneratedTrack,
    palette: TrackPalette,
    profile: OfficialWorldProfile = FALLBACK_WORLD_PROFILE
  ) {
    this.profile = profile;
    this.group.name = 'Megastructure';
    this.atmosphereGroup.name = 'MegastructureAtmosphere';
    tagWorldRole(this.group, 'DECORATION', 'Megastructure');
    tagWorldRole(this.atmosphereGroup, 'IGNORE_WORLD_SAFETY', 'Megastructure.Atmosphere');

    const route = track.route;
    if (route.length >= 4) this.build(track, palette);

    scene.add(this.group);
    scene.add(this.atmosphereGroup);
  }

  private build(track: GeneratedTrack, palette: TrackPalette): void {
    const route = track.route;
    let minY = Infinity;
    let maxY = -Infinity;
    const center = new THREE.Vector3();
    for (const n of route) {
      minY = Math.min(minY, n.position.y);
      maxY = Math.max(maxY, n.position.y);
      center.x += n.position.x;
      center.z += n.position.z;
    }
    center.x /= route.length;
    center.z /= route.length;
    center.y = (minY + maxY) * 0.5;

    const start = route[0].position;
    const end = route[route.length - 1].position;
    const dir = new THREE.Vector3(end.x - start.x, 0, end.z - start.z);
    if (dir.lengthSq() < 1) dir.set(0, 0, 1);
    dir.normalize();
    const right = new THREE.Vector3(dir.z, 0, -dir.x);
    const yawAlong = Math.atan2(dir.x, dir.z);
    let span = Math.max(400, new THREE.Vector3(end.x - start.x, 0, end.z - start.z).length());
    // Official profile: openness spreads the hero compositions out; verticality
    // stretches the documented vertical scale. Identity for Drift/fallback.
    if (this.profile.usesOverride) {
      span *= 0.85 + this.profile.space.openness * 0.35;
    }
    const vertScale = this.profile.usesOverride ? 0.85 + this.profile.space.verticality * 0.4 : 1.0;

    // Cool slate atmosphere with only a trace of the track palette, so distant
    // mass reads as air-lit stone rather than tinted plastic.
    const haze = new THREE.Color(0.05, 0.065, 0.1).lerp(palette.fogColor.clone().multiplyScalar(2.0), 0.25);
    const base = palette.void.clone().multiplyScalar(0.9);
    const accent = palette.primary.clone();

    const abyssY = minY - 40;

    // ---------------------------------------------------------------------
    // 1. ABYSS STRATA
    // ---------------------------------------------------------------------
    const strataDefs = [
      { depth: 90, density: 0.32, grid: 0.0 },
      { depth: 220, density: 0.45, grid: 0.0 },
      { depth: 420, density: 0.3, grid: 1.0 }
    ];
    const strataGeom = new THREE.PlaneGeometry(4200, 4200, 1, 1);
    strataGeom.rotateX(-Math.PI / 2);
    this.geometries.push(strataGeom);
    for (const def of strataDefs) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: STRATA_VERT,
        fragmentShader: STRATA_FRAG,
        uniforms: {
          uHaze: { value: haze.clone().multiplyScalar(1.4) },
          uAccent: { value: accent.clone() },
          uTime: { value: 0 },
          uDensity: { value: def.density },
          uGrid: { value: def.grid },
          uBreath: { value: 0 }
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false
      });
      const mesh = new THREE.Mesh(strataGeom, mat);
      mesh.position.set(center.x, minY - def.depth, center.z);
      mesh.renderOrder = -10;
      mesh.frustumCulled = false;
      mesh.name = `AbyssStratum_${def.depth}`;
      this.atmosphereGroup.add(mesh);
      this.strata.push(mesh);
      this.strataMats.push(mat);
    }

    // ---------------------------------------------------------------------
    // 2. HERO STRUCTURES (composed, not scattered)
    // ---------------------------------------------------------------------
    const makeMat = (heroWeight: number, channel: number, fadeFar = 1500): THREE.ShaderMaterial => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: STRUCTURE_VERT,
        fragmentShader: STRUCTURE_FRAG,
        uniforms: {
          uBase: { value: base.clone() },
          uHaze: { value: haze.clone() },
          uAccent: { value: accent.clone() },
          uPulse: { value: 0 },
          uChannel: { value: channel },
          uAbyssY: { value: abyssY },
          uFadeNear: { value: 250 },
          uFadeFar: { value: fadeFar }
        },
        fog: false
      });
      this.structureMats.push({ material: mat, heroWeight });
      return mat;
    };
    const heroMat = makeMat(1.0, 1.0);
    const massMat = makeMat(0.35, 0.0);
    const farMat = makeMat(0.2, 0.6, 1900);

    const box = (w: number, h: number, d: number): THREE.BoxGeometry => {
      h *= vertScale;
      const g = new THREE.BoxGeometry(w, h, d);
      this.geometries.push(g);
      return g;
    };
    const place = (
      geom: THREE.BufferGeometry,
      mat: THREE.Material,
      pos: THREE.Vector3,
      yaw: number,
      name: string
    ): THREE.Mesh => {
      const m = new THREE.Mesh(geom, mat);
      m.position.copy(pos);
      m.rotation.set(0, yaw, 0);
      m.name = name;
      m.frustumCulled = false;
      m.updateMatrix();
      m.matrixAutoUpdate = false;
      this.group.add(m);
      return m;
    };

    const at = (along: number, lateral: number, y: number): THREE.Vector3 =>
      new THREE.Vector3(
        start.x + dir.x * along + right.x * lateral,
        y,
        start.z + dir.z * along + right.z * lateral
      );

    // 2a. TWIN SPINE MONOLITHS — the landmark on the LEFT, a third of the way in.
    {
      const topY = maxY + 260;
      const bottomY = abyssY - 700;
      const h = topY - bottomY;
      const g = box(150, h, 70);
      place(g, heroMat, at(span * 0.34, -560, bottomY + h * 0.5), yawAlong + 0.18, 'Mega_SpineA');
      const g2 = box(90, h * 0.82, 60);
      place(g2, massMat, at(span * 0.34 + 190, -640, bottomY + h * 0.41), yawAlong + 0.05, 'Mega_SpineB');
    }

    // 2b. ORBIT FRAME — a colossal square ring standing beyond the finish.
    {
      const frameCenter = at(span + 620, 0, maxY + 90);
      const outer = 420;
      const t = 36;
      const frame = new THREE.Group();
      frame.name = 'Mega_OrbitFrame';
      // Broken top span: one long piece, a gap, and a fallen-away fragment
      // hanging slightly lower and askew.
      const top = new THREE.Group();
      const topA = new THREE.Mesh(box(outer * 0.58, t, t), heroMat);
      topA.position.set(-outer * 0.21, outer * 0.5 - t * 0.5, 0);
      const topB = new THREE.Mesh(box(outer * 0.22, t, t), heroMat);
      topB.position.set(outer * 0.39, outer * 0.5 - t * 0.5 - 14, 0);
      topB.rotation.z = -0.09;
      top.add(topA, topB);
      const bottom = new THREE.Mesh(box(outer, t, t), heroMat);
      bottom.position.set(0, -outer * 0.5 + t * 0.5, 0);
      const left = new THREE.Mesh(box(t, outer, t), heroMat);
      left.position.set(-outer * 0.5 + t * 0.5, 0, 0);
      const rightBar = new THREE.Mesh(box(t, outer, t), heroMat);
      rightBar.position.set(outer * 0.5 - t * 0.5, 0, 0);
      // Inner floating plate: a dark "screen" that the channel lights frame.
      const core = new THREE.Mesh(box(outer * 0.18, outer * 0.62, 6), massMat);
      frame.add(top, bottom, left, rightBar, core);
      // A support leg plunging from the frame into the abyss.
      const legH = frameCenter.y - outer * 0.5 - (abyssY - 600);
      const leg = new THREE.Mesh(box(60, legH, 60), massMat);
      leg.position.set(0, -outer * 0.5 - legH * 0.5, 0);
      frame.add(leg);
      frame.position.copy(frameCenter);
      frame.rotation.set(0, yawAlong, 0.06);
      frame.traverse((o) => (o.frustumCulled = false));
      this.group.add(frame);
    }

    // 2c. SKY BRIDGE — a single span crossing high over the route at 60%.
    {
      const y = maxY + 170;
      const len = 1500;
      const bridge = box(len, 16, 30);
      const mid = at(span * 0.6, 0, y);
      place(bridge, heroMat, mid, yawAlong + Math.PI / 2 + 0.12, 'Mega_SkyBridge');
      for (const side of [-1, 1]) {
        const towerH = y - (abyssY - 650) + 60;
        const lateral = side * (len * 0.5 - 40);
        const p = at(span * 0.6 - Math.sin(0.12) * lateral, lateral, y + 60 - towerH * 0.5);
        place(box(70, towerH, 70), massMat, p, yawAlong + 0.12, `Mega_BridgeTower_${side}`);
      }
    }

    // 2d. MONOLITH FIELD — density on the RIGHT, late in the song.
    {
      const count = 7;
      for (let i = 0; i < count; i++) {
        const along = span * (0.55 + i * 0.09) + ((i * 97) % 70);
        const lateral = 520 + ((i * 131) % 260);
        const topY = maxY + 40 + ((i * 53) % 220);
        const bottomY = abyssY - 500 - ((i * 71) % 300);
        const h = topY - bottomY;
        const w = 50 + ((i * 29) % 70);
        const d = 30 + ((i * 17) % 40);
        const mat = i % 3 === 0 ? farMat : massMat;
        place(box(w, h, d), mat, at(along, lateral, bottomY + h * 0.5), yawAlong + (i % 2 ? 0.3 : -0.2), `Mega_Field_${i}`);
      }
    }
  }

  public update(visualState: MusicVisualState, cameraPos: THREE.Vector3, reduceMotion = false): void {
    const ch = resolveChannels(visualState);
    const react = visualState.reactivityMultiplier;
    const dt = Math.min(0.1, Math.max(0, visualState.time - this.lastTime));
    this.lastTime = visualState.time;

    // Hero pulse: drops dominate, strong transients register, everything else
    // stays calm. Fast attack, ~0.6 s release.
    const strong = Math.max(0, (ch.transient - 0.6) / 0.4) * 0.5;
    const target = Math.min(1.2, (ch.dropPrimary * 1.1 + strong + ch.sectionEnergy * 0.15) * react);
    this.pulse = Math.max(target, this.pulse * Math.exp(-dt / 0.6));

    for (const s of this.structureMats) {
      s.material.uniforms.uPulse.value = this.pulse * s.heroWeight;
    }

    const t = reduceMotion ? visualState.time * 0.3 : visualState.time;
    for (let i = 0; i < this.strata.length; i++) {
      const u = this.strataMats[i].uniforms;
      u.uTime.value = t;
      u.uBreath.value = Math.min(1, ch.bassMass * 0.8 * react);
      // Decks follow the camera horizontally so they read as infinite; their
      // noise is world-anchored so nothing swims.
      this.strata[i].position.x = cameraPos.x;
      this.strata[i].position.z = cameraPos.z;
    }
  }

  public dispose(): void {
    this.group.parent?.remove(this.group);
    this.atmosphereGroup.parent?.remove(this.atmosphereGroup);
    for (const g of this.geometries) g.dispose();
    for (const s of this.structureMats) s.material.dispose();
    for (const m of this.strataMats) m.dispose();
    this.geometries = [];
    this.structureMats = [];
    this.strataMats = [];
    this.strata = [];
  }
}
