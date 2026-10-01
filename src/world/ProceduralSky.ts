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
uniform float uStarDensity;
uniform float uSignalField;
uniform float uHeroFlare;
uniform vec3 uStarTint;
uniform float uNebula;
uniform float uGalaxyBand;
uniform float uLightField;
uniform float uSkyMotif;
uniform float uAtmosphereMotif;

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
vec3 renderStarfield(vec3 dir, float time, float high, float dropImpact, float starVis, vec3 secColor, vec3 hiColor, float heroFlare) {
  if (dir.y < 0.015 || starVis <= 0.01) return vec3(0.0);
  heroFlare = clamp(heroFlare, 0.0, 1.0);

  // Spatial variation: Clustered sky regions vs open cosmic void pockets
  vec3 clusterGrid = floor(dir * 18.0);
  float clusterDensity = pow(hash31(clusterGrid), 2.2); // Concentrates stars in clusters
  if (clusterDensity < 0.15) clusterDensity = 0.0; // Quiet void pockets (hero stars survive)

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
  float bright = (hBright > 0.992) ? (1.0 - smoothstep(0.0, 0.0024, length(dir - (gridBright + 0.5) / 190.0))) * twinkle * 0.75 : 0.0;

  // 3. Color Stars (subtle palette secondary stars)
  vec3 gridColor = floor(dir * 140.0);
  float hColor = hash31(gridColor);
  float colorStar = (hColor > 0.994) ? (1.0 - smoothstep(0.0, 0.0028, length(dir - (gridColor + 0.5) / 140.0))) * 0.9 : 0.0;

  // 4. Hero Stars (rare cross beacons with music-reactive transient flares)
  vec3 gridHero = floor(dir * 85.0);
  float hHero = hash31(gridHero);
  float hero = 0.0;
  vec3 heroGlowCol = vec3(0.0);
  if (hHero > 0.9972) {
    vec3 dHero = dir - (gridHero + 0.5) / 85.0;
    float dist = length(dHero);

    // Only a curated subset of hero stars ANSWERS strong musical events; the
    // rest stay calm. heroFlare is a gated envelope (strong hits only), so the
    // sky reads as sparse, deliberate flashes rather than constant shimmer.
    float responder = step(0.4, fract(hHero * 173.0));
    float transientEnergy = dropImpact * 1.4 + high * 0.5 + heroFlare * responder * 2.4;
    float heroTwinkle = sin(time * 1.5 + hHero * 6.28) * 0.25 + 0.75;
    float dynamicRadius = 0.0026 + clamp(transientEnergy * 0.0012, 0.0, 0.003);

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

  col *= clusterDensity;
  // Hero stars keep their presence even in sparse cluster pockets.
  col += heroGlowCol * hero * (1.0 - clusterDensity) * 0.8;
  return col * elevationFade * (1.0 + dropImpact * 0.4) * starVis;
}

// Cheap value noise for the galactic band.
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i);
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
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
  float hazeFactor = hazeBand * smoothstep(0.30, 0.0, abs(elevation)) * (0.12 + uLowMid * 0.3 * uReactivity) * uAtmosphereMotif;
  vec3 haze = uHazeColor * hazeFactor;

  // 3b. Sustained signal field.
  // A very slow, very broad luminance lift across the lower sky so the song is
  // still physically present when no reactive structure is in the player's
  // view. Deliberately restrained: the sky must never become a nightclub.
  float fieldBand = smoothstep(0.62, 0.0, abs(elevation));
  vec3 signalField = uHazeColor * fieldBand * uSignalField * 0.11 * uReactivity * uAtmosphereMotif;

  // 4. Clustered Multi-Tier Starfield. The official SKY reaction (bounded) can
  // gently scale the star emissive; 1.0 elsewhere.
  vec3 stars = renderStarfield(dir, uTime, uHigh * uReactivity, uDropImpact * uReactivity, uStarVisibility, uSecondaryColor, uHighlightColor, uHeroFlare * uReactivity);
  stars *= mix(1.0, uSkyMotif, 0.85);

  // 4b. Galactic signal band: one slow diagonal river of faint light, broken
  // by noise so it reads as dust lanes, not a gradient stripe. uGalaxyBand lets
  // an authored GALAXY_BAND track strengthen it into a named motif; the default
  // authored contribution is preserved exactly (uGalaxyBand = 1.0).
  vec3 bandAxis = normalize(vec3(0.34, 0.52, 0.78));
  float bandD = dot(dir, bandAxis);
  float bandCore = exp(-bandD * bandD * 22.0);
  float lanes = vnoise(dir * 7.0 + vec3(0.0, uTime * 0.004, 0.0)) * 0.65 + vnoise(dir * 19.0) * 0.35;
  float band = bandCore * smoothstep(0.28, 0.85, lanes) * smoothstep(0.02, 0.3, elevation);
  vec3 galactic = mix(uSecondaryColor, uHighlightColor, lanes) * band * (0.05 + uStarVisibility * 0.05) * uGalaxyBand;

  // 4b2. NEBULA motif: a broad, multi-lane cloud of coloured dust concentrated
  // in a wide soft region of the sky. Real volumetric (screen) motif, gated by
  // uNebula and the bounded SKY reaction (uSkyMotif). Zero for other profiles.
  float neb = 0.0;
  vec3 nebCol = vec3(0.0);
  if (uNebula > 0.001) {
    vec3 nebAxis = normalize(vec3(-0.6, 0.35, 0.72));
    float nd = dot(dir, nebAxis);
    float core = exp(-nd * nd * 3.2);
    float c1 = vnoise(dir * 3.0 + vec3(uTime * 0.002, 0.0, 0.0));
    float c2 = vnoise(dir * 6.5 - vec3(0.0, uTime * 0.003, 0.0));
    float cloud = smoothstep(0.35, 0.85, c1 * 0.6 + c2 * 0.4) * core * smoothstep(-0.1, 0.5, elevation);
    neb = cloud * uNebula;
    nebCol = mix(uStarTint, uSecondaryColor, 0.45) * (0.6 + c2 * 0.9);
  }

  // 4b3. DISTANT_LIGHT_FIELD motif: a dense but very faint scatter of distant
  // pin-prick lights far below the horizon band. Reads as a huge distant city /
  // light field without any large celestial body. Gated by uLightField and the
  // bounded atmosphere reaction (uAtmosphereMotif).
  float lights = 0.0;
  if (uLightField > 0.001) {
    vec3 g = floor(dir * 260.0);
    float h = hash31(g);
    float pin = step(0.986, h) * (1.0 - smoothstep(0.0, 0.0022, length(dir - (g + 0.5) / 260.0)));
    float horiz = smoothstep(0.28, -0.02, elevation) * (1.0 - smoothstep(0.0, 0.5, abs(elevation + 0.28)));
    lights = pin * horiz * uLightField * uAtmosphereMotif;
  }
  vec3 lightField = mix(uStarTint, vec3(1.0), 0.5) * lights * 0.6;

  // 4c. Bottomless abyss: below the horizon the sky falls away into black,
  // with two faint strata of light from impossibly distant lower levels.
  float below = smoothstep(0.0, -0.55, elevation);
  vec3 abyss = uHorizonColor * (
    exp(-pow((elevation + 0.22) * 11.0, 2.0)) * 0.10 +
    exp(-pow((elevation + 0.46) * 14.0, 2.0)) * 0.05
  ) * (1.0 + bassPressure * 0.6);

  // 5. Compose Final Atmospheric Color
  vec3 finalColor = mix(baseVoid, uVoidColor * 0.12, below) + horizonGlow + haze + signalField + stars + galactic + nebCol * neb + lightField + abyss;

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

export class ProceduralSky {
  public mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private heroFlare = 0;
  private lastTime = 0;
  /** Official world-profile star-density multiplier (1.0 = unchanged). */
  private starDensity = 1.0;
  /** Bounded official-profile reaction gains for the SKY / ATMOSPHERE motifs. */
  private skyMotifGain = 1.0;
  private atmosphereGain = 1.0;
  /** Pristine constructor colours, restored by clearWorldProfile(). */
  private defaultVoid = new THREE.Color();
  private defaultHorizon = new THREE.Color();
  private defaultSecondary = new THREE.Color();
  private defaultHighlight = new THREE.Color();
  private defaultHaze = new THREE.Color();
  private defaultStarTint = new THREE.Color();

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
        uSignalField: { value: 0.0 },
        uHeroFlare: { value: 0.0 },
        uStarDensity: { value: 1.0 },
        uStarTint: { value: new THREE.Color(0xa78bfa) },
        uNebula: { value: 0.0 },
        uGalaxyBand: { value: 1.0 },
        uLightField: { value: 0.0 },
        uSkyMotif: { value: 1.0 },
        uAtmosphereMotif: { value: 1.0 }
      },
      side: THREE.BackSide,
      depthWrite: false
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.renderOrder = -1000;
    scene.add(this.mesh);

    const u0 = this.material.uniforms;
    this.defaultVoid.copy(u0.uVoidColor.value as THREE.Color);
    this.defaultHorizon.copy(u0.uHorizonColor.value as THREE.Color);
    this.defaultSecondary.copy(u0.uSecondaryColor.value as THREE.Color);
    this.defaultHighlight.copy(u0.uHighlightColor.value as THREE.Color);
    this.defaultHaze.copy(u0.uHazeColor.value as THREE.Color);
    this.defaultStarTint.copy(u0.uStarTint.value as THREE.Color);
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

    // Gated strong-event envelope for the hero-star subset: only onsets above
    // the threshold register, attack is instant and decay is ~0.4 s.
    const strong = Math.max(0, (visualState.channels.transient - 0.55) / 0.45) + visualState.channels.dropPrimary * 0.6;
    const dt = Math.min(0.1, Math.max(0, visualState.time - this.lastTime));
    this.lastTime = visualState.time;
    this.heroFlare = Math.max(Math.min(1, strong), this.heroFlare * Math.exp(-dt / 0.4));
    u.uHeroFlare.value = this.heroFlare;

    let baseStarVis = 0.45;
    if (visualState.sectionTheme === 'DROP' || visualState.dropImpact > 0.3) {
      baseStarVis = 1.0;
    } else if (visualState.sectionTheme === 'BUILDUP') {
      baseStarVis = 0.2;
    } else if (visualState.sectionTheme === 'BREATH') {
      baseStarVis = 0.7;
    }

    u.uStarVisibility.value = baseStarVis * starVisibilityMod * this.starDensity;
    u.uSkyMotif.value = this.skyMotifGain;
    u.uAtmosphereMotif.value = this.atmosphereGain;
  }

  /**
   * Apply an official world-profile SKY descriptor. This sets the star-density
   * multiplier and gently tints the star/highlight colours. It is only called
   * for tracks whose profile opts in (usesOverride=true); Signal Drift and the
   * fallback keep the untouched default sky.
   */
  public applyWorldProfile(sky: {
    starDensity: number;
    starTint: string;
    hazeStrength: number;
    celestial?: string;
  }): void {
    this.starDensity = Math.max(0.15, Math.min(1.4, sky.starDensity));
    this.material.uniforms.uStarDensity.value = this.starDensity;
    const tint = new THREE.Color(sky.starTint);
    this.material.uniforms.uHighlightColor.value.lerp(tint, 0.35);
    this.material.uniforms.uSecondaryColor.value.lerp(tint, 0.25);
    // Real authored sky motifs: strengthen the actual shader band/cloud/field
    // instead of aliasing the large celestial body. Presence is set here; the
    // bounded SKY / ATMOSPHERE reaction scales it per frame.
    (this.material.uniforms.uStarTint.value as THREE.Color).copy(tint);
    const celestial = sky.celestial ?? 'NONE';
    this.material.uniforms.uNebula.value = celestial === 'NEBULA' ? 1.0 : 0.0;
    this.material.uniforms.uGalaxyBand.value = celestial === 'GALAXY_BAND' ? 2.6 : 1.0;
    this.material.uniforms.uLightField.value = celestial === 'DISTANT_LIGHT_FIELD' ? 1.0 : 0.0;
  }

  /**
   * Bounded, smoothed official-profile reaction gain for the SKY and
   * ATMOSPHERE motifs. Exactly 1.0 when those subsystems are not selected (and
   * on the inert path), so the authored sky is untouched there.
   */
  public setProfileReactionGains(skyGain: number, atmosphereGain: number): void {
    this.skyMotifGain = Math.max(0.5, Math.min(1.6, skyGain));
    this.atmosphereGain = Math.max(0.5, Math.min(1.6, atmosphereGain));
  }

  /**
   * RESET the official-profile sky state. Called on EVERY load whose resolved
   * profile does not override (Signal Drift, custom/null, tutorial, lab), so a
   * previously loaded profiled track can never leak star density or tint into
   * the reference world. Restores the exact constructor defaults.
   */
  public clearWorldProfile(): void {
    this.starDensity = 1.0;
    this.skyMotifGain = 1.0;
    this.atmosphereGain = 1.0;
    const u = this.material.uniforms;
    u.uStarDensity.value = 1.0;
    u.uNebula.value = 0.0;
    u.uGalaxyBand.value = 1.0;
    u.uLightField.value = 0.0;
    u.uSkyMotif.value = 1.0;
    u.uAtmosphereMotif.value = 1.0;
    (u.uStarTint.value as THREE.Color).copy(this.defaultStarTint);
    (u.uVoidColor.value as THREE.Color).copy(this.defaultVoid);
    (u.uHorizonColor.value as THREE.Color).copy(this.defaultHorizon);
    (u.uSecondaryColor.value as THREE.Color).copy(this.defaultSecondary);
    (u.uHighlightColor.value as THREE.Color).copy(this.defaultHighlight);
    (u.uHazeColor.value as THREE.Color).copy(this.defaultHaze);
  }

  public setCenter(pos: THREE.Vector3): void {
    this.mesh.position.copy(pos);
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
