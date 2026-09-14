/**
 * Procedural Sky & Horizon Shader for PLAYHEAD
 * Monumental Audio Brutalism: Infinite architectural signal-space with sub-bass horizon glow,
 * drifting haze bands, and drop atmospheric expansion.
 */

import * as THREE from 'three';
import { MusicVisualState } from './MusicVisualController';

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

varying vec3 vWorldPosition;
varying vec2 vUv;

// High-efficiency pseudo-random hash for procedural stars on sphere
float hash31(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

// Multi-tier procedural starfield (dim distant field + crisp mid stars + hero stars)
float starfield(vec3 dir, float time, float high, float dropImpact, float starVis) {
  if (dir.y < 0.02 || starVis <= 0.01) return 0.0;

  // Elevation fade (fade near horizon into haze)
  float elevationFade = smoothstep(0.02, 0.25, dir.y);

  // 1. Far dim stars (dense, subtle background carpet)
  vec3 gridFar = floor(dir * 280.0);
  float hFar = hash31(gridFar);
  float farStars = (hFar > 0.975) ? (1.0 - smoothstep(0.0, 0.0030, length(dir - (gridFar + 0.5) / 280.0))) * 0.45 : 0.0;

  // 2. Mid stars (crisper, twinkling with highs)
  vec3 gridMid = floor(dir * 180.0);
  float hMid = hash31(gridMid);
  float midTwinkle = sin(time * 2.2 + hMid * 6.28) * 0.3 + 0.7;
  midTwinkle += high * 0.4 * sin(time * 6.0 + hMid * 10.0);
  float midStars = (hMid > 0.988) ? (1.0 - smoothstep(0.0, 0.0035, length(dir - (gridMid + 0.5) / 180.0))) * midTwinkle * 0.8 : 0.0;

  // 3. Hero stars (sparse bright anchor beacons)
  vec3 gridHero = floor(dir * 95.0);
  float hHero = hash31(gridHero);
  float heroTwinkle = sin(time * 1.5 + hHero * 6.28) * 0.2 + 0.8;
  heroTwinkle += high * 0.6 * sin(time * 9.0 + hHero * 14.0);
  float heroStars = (hHero > 0.994) ? (1.0 - smoothstep(0.0, 0.0042, length(dir - (gridHero + 0.5) / 95.0))) * heroTwinkle * 1.6 : 0.0;

  float totalStars = (farStars + midStars + heroStars) * elevationFade * (1.0 + dropImpact * 0.8) * starVis;
  return totalStars;
}

void main() {
  vec3 dir = normalize(vWorldPosition);
  float elevation = dir.y; // -1 to 1

  // 1. Base Monumental Void: Dark basalt void at zenith, deep blue-black near ground
  float zenithGradient = smoothstep(-0.25, 0.85, elevation);
  vec3 baseVoid = mix(uVoidColor * 1.15, uVoidColor * 0.28, zenithGradient);

  // 2. Sub-Bass Horizon Glow: Low concentrated electrical horizon swell
  float horizonFactor = 1.0 - smoothstep(0.0, 0.16 + uDropImpact * 0.12, abs(elevation));
  float bassPressure = (uSubBass * 0.85 + uBass * 0.35 + uSectionIntensity * 0.25) * uReactivity;
  vec3 horizonGlow = uHorizonColor * horizonFactor * (0.32 + bassPressure * 1.25 + uDropImpact * 1.8);

  // 3. Drifting Mid Atmospheric Haze Bands
  float hazeBand1 = sin(elevation * 26.0 + uTime * 0.18) * 0.5 + 0.5;
  float hazeBand2 = cos(elevation * 15.0 - uTime * 0.10) * 0.5 + 0.5;
  float hazeFactor = (hazeBand1 * 0.6 + hazeBand2 * 0.4) * smoothstep(0.32, 0.0, abs(elevation)) * (0.10 + uLowMid * 0.28 * uReactivity);
  vec3 haze = uHazeColor * hazeFactor;

  // 4. Distant High-Frequency Signal Beacons: Sharp vertical column accents
  float azimuth = atan(dir.z, dir.x);
  float beaconCols = pow(sin(azimuth * 12.0) * 0.5 + 0.5, 24.0);
  float beaconFactor = beaconCols * smoothstep(0.0, 0.22, elevation) * smoothstep(0.38, 0.08, elevation) * (uHigh * 0.65 + uDropImpact * 0.9) * uReactivity;
  vec3 beacons = uHighlightColor * beaconFactor;

  // 5. Multi-Tier Starfield modulated by SongDirector
  float stars = starfield(dir, uTime, uHigh * uReactivity, uDropImpact * uReactivity, uStarVisibility);
  vec3 starColor = mix(uHighlightColor, vec3(0.92, 0.95, 1.0), 0.7) * stars * (0.9 + uHigh * 0.5);

  // 6. Coordinated Composition
  vec3 finalColor = baseVoid + horizonGlow + haze + beacons + starColor;

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
        uVoidColor: { value: new THREE.Color(0x04060a) },
        uHorizonColor: { value: new THREE.Color(0x101b2b) },
        uSecondaryColor: { value: new THREE.Color(0x00a8ff) },
        uHighlightColor: { value: new THREE.Color(0xafffff) },
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
        uStarVisibility: { value: 0.5 }
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  public update(visualState: MusicVisualState, cameraPos: THREE.Vector3, starVisibility = 0.5): void {
    // Follow camera position so sky remains at infinite apparent distance
    this.mesh.position.copy(cameraPos);

    // Update uniforms
    const u = this.material.uniforms;
    u.uVoidColor.value.copy(visualState.palette.void);
    u.uHorizonColor.value.copy(visualState.activeHorizonColor);
    u.uSecondaryColor.value.copy(visualState.palette.secondary);
    u.uHighlightColor.value.copy(visualState.palette.highlight);
    u.uHazeColor.value.copy(visualState.activeHazeColor);

    u.uTime.value = visualState.time;
    u.uBass.value = visualState.bass;
    u.uSubBass.value = visualState.subBass;
    u.uLowMid.value = visualState.lowMid;
    u.uHigh.value = visualState.high;
    u.uDropImpact.value = visualState.dropImpact;
    u.uBuildup.value = visualState.buildup;
    u.uSectionIntensity.value = visualState.sectionIntensity;
    u.uReactivity.value = visualState.reactivityMultiplier;
    u.uStarVisibility.value = starVisibility;
  }

  public dispose(): void {
    if (this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
    }
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
