/**
 * Procedural Sky & Horizon Shader for PLAYHEAD SIGNAL RENDER
 * "Cosmic Pixel Brutalism" skybox with ordered dithered atmospheric bands,
 * clustered spatial starfields, tiered star classes, and sub-bass horizon breathing.
 */

import * as THREE from 'three';
import { MusicVisualState } from './MusicVisualController';
import { TrackPalette } from '../audio/TrackPalettes';

const SKY_VERTEX_SHADER = `
varying vec3 vWorldPosition;
varying vec2 vUv;

void main() {
  vUv = uv;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT_SHADER = `
uniform vec3 uVoidColor;
uniform vec3 uHorizonColor;
uniform vec3 uSecondaryColor;
uniform vec3 uHighlightColor;
uniform vec3 uHazeColor;
uniform float uTime;
uniform float uBass;
uniform float uSubBass;
uniform float uLowMid;
uniform float uHigh;
uniform float uDropImpact;
uniform float uBuildup;
uniform float uSectionIntensity;
uniform float uReactivity;
uniform float uStarVisibility;
uniform float uSignalField;

varying vec3 vWorldPosition;
varying vec2 vUv;

// High-efficiency pseudo-random hash for procedural stars on sphere
float hash31(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

// 4x4 Bayer matrix for dithered atmospheric transitions
float bayer4x4(vec2 p) {
  vec2 coord = floor(mod(p, 4.0));
  int x = int(coord.x);
  int y = int(coord.y);
  int index = y * 4 + x;

  if (index == 0) return 0.0 / 16.0;
  if (index == 1) return 8.0 / 16.0;
  if (index == 2) return 2.0 / 16.0;
  if (index == 3) return 10.0 / 16.0;
  if (index == 4) return 12.0 / 16.0;
  if (index == 5) return 4.0 / 16.0;
  if (index == 6) return 14.0 / 16.0;
  if (index == 7) return 6.0 / 16.0;
  if (index == 8) return 3.0 / 16.0;
  if (index == 9) return 11.0 / 16.0;
  if (index == 10) return 1.0 / 16.0;
  if (index == 11) return 9.0 / 16.0;
  if (index == 12) return 15.0 / 16.0;
  if (index == 13) return 7.0 / 16.0;
  if (index == 14) return 13.0 / 16.0;
  return 5.0 / 16.0;
}

// Multi-tier procedural starfield with spatial clustering and 4 star classes
vec3 renderStarfield(vec3 dir, float time, float high, float dropImpact, float starVis, vec3 secColor, vec3 hiColor) {
  if (dir.y < 0.015 || starVis <= 0.01) return vec3(0.0);

  // Spatial variation: Clustered sky regions vs open cosmic void pockets
  vec3 clusterGrid = floor(dir * 18.0);
  float clusterDensity = pow(hash31(clusterGrid), 2.2); // Concentrates stars in clusters
  if (clusterDensity < 0.15) return vec3(0.0); // Quiet void pockets

  float elevationFade = smoothstep(0.015, 0.22, dir.y);

  // 1. Pixel Dust (tiny dim 1px background carpet)
  vec3 gridDust = floor(dir * 320.0);
  float hDust = hash31(gridDust);
  float dust = (hDust > 0.972) ? (1.0 - smoothstep(0.0, 0.0028, length(dir - (gridDust + 0.5) / 320.0))) * 0.4 : 0.0;

  // 2. Bright Stars (twinkling points)
  vec3 gridBright = floor(dir * 190.0);
  float hBright = hash31(gridBright);
  float twinkle = sin(time * 2.5 + hBright * 6.28) * 0.3 + 0.7;
  twinkle += high * 0.5 * sin(time * 7.0 + hBright * 11.0);
  float bright = (hBright > 0.989) ? (1.0 - smoothstep(0.0, 0.0036, length(dir - (gridBright + 0.5) / 190.0))) * twinkle * 0.9 : 0.0;

  // 3. Color Stars (subtle palette secondary stars)
  vec3 gridColor = floor(dir * 140.0);
  float hColor = hash31(gridColor);
  float colorStar = (hColor > 0.992) ? (1.0 - smoothstep(0.0, 0.0042, length(dir - (gridColor + 0.5) / 140.0))) * 1.1 : 0.0;

  // 4. Hero Stars (rare cross beacons with music-reactive transient flares)
  vec3 gridHero = floor(dir * 85.0);
  float hHero = hash31(gridHero);
  float hero = 0.0;
  vec3 heroGlowCol = vec3(0.0);
  if (hHero > 0.995) {
    vec3 dHero = dir - (gridHero + 0.5) / 85.0;
    float dist = length(dHero);

    // Transient reactivity: flare on high transients & drop impacts
    float transientEnergy = dropImpact * 2.6 + high * 1.4;
    float heroTwinkle = sin(time * 1.5 + hHero * 6.28) * 0.25 + 0.75;
    float dynamicRadius = 0.0048 + clamp(transientEnergy * 0.0035, 0.0, 0.008);

    // Core beacon
    float core = (1.0 - smoothstep(0.0, dynamicRadius, dist)) * (1.6 + transientEnergy * 3.2);

    // Diffraction cross flare spikes (visibly reacts to transients)
    float flareLen = 0.015 + transientEnergy * 0.024;
    float flareWidth = 0.0010;
    float crossSpike = max(
      max(1.0 - abs(dHero.x) / flareWidth, 0.0) * max(1.0 - abs(dHero.y) / flareLen, 0.0),
      max(1.0 - abs(dHero.y) / flareWidth, 0.0) * max(1.0 - abs(dHero.x) / flareLen, 0.0)
    );
    float diagonalSpike = max(
      max(1.0 - abs(dHero.x + dHero.y) * 0.7071 / flareWidth, 0.0) * max(1.0 - abs(dHero.x - dHero.y) * 0.7071 / (flareLen * 0.6), 0.0),
      max(1.0 - abs(dHero.x - dHero.y) * 0.7071 / flareWidth, 0.0) * max(1.0 - abs(dHero.x + dHero.y) * 0.7071 / (flareLen * 0.6), 0.0)
    ) * 0.45;

    float flare = (crossSpike + diagonalSpike) * (0.35 + transientEnergy * 2.8);
    hero = (core + flare) * heroTwinkle;
    heroGlowCol = mix(vec3(1.0), hiColor, 0.35);
  }

  vec3 col = vec3(0.0);
  col += vec3(0.85, 0.92, 1.0) * dust;
  col += hiColor * bright;
  col += secColor * colorStar;
  col += heroGlowCol * hero;

  return col * elevationFade * (1.0 + dropImpact * 0.4) * starVis * clusterDensity;
}

void main() {
  vec3 dir = normalize(vWorldPosition);
  float elevation = dir.y; // -1 to 1

  // 1. Base Monumental Void: Rich deep palette-based void at zenith
  float zenithGradient = smoothstep(-0.25, 0.85, elevation);
  vec3 baseVoid = mix(uVoidColor * 1.15, uVoidColor * 0.25, zenithGradient);

  // 2. Sub-Bass Horizon Glow with Ordered Dither
  float horizonFactor = 1.0 - smoothstep(0.0, 0.18 + uDropImpact * 0.12, abs(elevation));
  // Bass weight is the dominant term: the low end should feel structural and
  // broad rather than a thin flicker at the horizon line.
  float bassPressure = (uSubBass * 1.05 + uBass * 0.55 + uSectionIntensity * 0.22) * uReactivity;

  // Screen-space dither coordinate for atmospheric fog fade
  float dither = (bayer4x4(gl_FragCoord.xy) - 0.5) * 0.08;
  float steppedHorizon = clamp(horizonFactor + dither, 0.0, 1.0);

  vec3 horizonGlow = uHorizonColor * steppedHorizon * (0.35 + bassPressure * 1.3 + uDropImpact * 1.8);

  // 3. Drifting Mid Atmospheric Haze Bands
  float hazeBand = sin(elevation * 24.0 + uTime * 0.15) * 0.5 + 0.5;
  float hazeFactor = hazeBand * smoothstep(0.30, 0.0, abs(elevation)) * (0.12 + uLowMid * 0.3 * uReactivity);
  vec3 haze = uHazeColor * hazeFactor;

  // 3b. Sustained signal field.
  // A very slow, very broad luminance lift across the lower sky so the song is
  // still physically present when no reactive structure is in the player's
  // view. Deliberately restrained: the sky must never become a nightclub.
  float fieldBand = smoothstep(0.62, 0.0, abs(elevation));
  vec3 signalField = uHazeColor * fieldBand * uSignalField * 0.11 * uReactivity;

  // 4. Clustered Multi-Tier Starfield
  vec3 stars = renderStarfield(dir, uTime, uHigh * uReactivity, uDropImpact * uReactivity, uStarVisibility, uSecondaryColor, uHighlightColor);

  // 5. Compose Final Atmospheric Color
  vec3 finalColor = baseVoid + horizonGlow + haze + signalField + stars;

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

export class ProceduralSky {
  public mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.SphereGeometry(900, 32, 24);

    this.material = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      uniforms: {
        uVoidColor: { value: new THREE.Color(0x040814) },
        uHorizonColor: { value: new THREE.Color(0x0c1836) },
        uSecondaryColor: { value: new THREE.Color(0xa78bfa) },
        uHighlightColor: { value: new THREE.Color(0xf8fafc) },
        uHazeColor: { value: new THREE.Color(0x091018) },
        uTime: { value: 0.0 },
        uBass: { value: 0.0 },
        uSubBass: { value: 0.0 },
        uLowMid: { value: 0.0 },
        uHigh: { value: 0.0 },
        uDropImpact: { value: 0.0 },
        uBuildup: { value: 0.0 },
        uSectionIntensity: { value: 0.5 },
        uReactivity: { value: 1.0 },
        uStarVisibility: { value: 0.5 },
        uSignalField: { value: 0.0 }
      },
      side: THREE.BackSide,
      depthWrite: false
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.renderOrder = -1000;
    scene.add(this.mesh);
  }

  public setPalette(palette: TrackPalette): void {
    this.material.uniforms.uVoidColor.value.copy(palette.void);
    this.material.uniforms.uHorizonColor.value.copy(palette.bassTint || palette.secondary);
    this.material.uniforms.uSecondaryColor.value.copy(palette.secondary);
    this.material.uniforms.uHighlightColor.value.copy(palette.highlight || palette.primary);
    this.material.uniforms.uHazeColor.value.copy(palette.fogColor || palette.void);
  }

  public update(visualState: MusicVisualState, playerPos?: THREE.Vector3, starVisibilityMod = 1.0): void {
    if (playerPos) {
      this.mesh.position.copy(playerPos);
    }
    const u = this.material.uniforms;
    u.uTime.value = visualState.time;
    u.uBass.value = visualState.bass;
    u.uSubBass.value = visualState.subBass;
    u.uLowMid.value = visualState.lowMid;
    u.uHigh.value = visualState.high;
    u.uDropImpact.value = visualState.dropImpact;
    u.uBuildup.value = visualState.buildup;
    u.uSectionIntensity.value = visualState.sectionIntensity;
    u.uReactivity.value = visualState.reactivityMultiplier;
    u.uSignalField.value = Math.min(
      1.2,
      visualState.channels.sectionEnergy * 0.55 +
        visualState.channels.bassMass * 0.4 +
        visualState.channels.dropPrimary * 0.5
    );

    let baseStarVis = 0.45;
    if (visualState.sectionTheme === 'DROP' || visualState.dropImpact > 0.3) {
      baseStarVis = 1.0;
    } else if (visualState.sectionTheme === 'BUILDUP') {
      baseStarVis = 0.2;
    } else if (visualState.sectionTheme === 'BREATH') {
      baseStarVis = 0.7;
    }

    u.uStarVisibility.value = baseStarVis * starVisibilityMod;
  }

  public setCenter(pos: THREE.Vector3): void {
    this.mesh.position.copy(pos);
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
