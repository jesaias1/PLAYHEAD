/**
 * KarambitCosmicShader for PLAYHEAD
 * View-dependent internal galaxy / cosmic depth shader for the Karambit blade.
 *
 * Core illusion:
 * A dimensional galaxy / void / cosmic energy field trapped INSIDE the blade.
 * As the viewmodel rotates, sways, banks, or tilts, the internal celestial volume
 * shifts via dual-layer parallax offsets, creating true 3D volumetric interior perception.
 *
 * Integrates final artist custom cosmic textures:
 * - astral_cosmic.png
 * - void_signal_cosmic.png
 * - redshift_cosmic.png
 * - prism_static_cosmic.png
 * - blackstar_cosmic.png
 *
 * Preserves the full dimensional system:
 * - Blade masking (tactical matte grip vs cosmic blade body)
 * - View-dependent parallax UV offsets
 * - Dual-layer depth movement (Layer 1 deep + Layer 2 foreground)
 * - Procedural FBM noise flow & slow galactic swirl
 * - Selective Fresnel rim glow for razor-sharp silhouette separation
 * - Twinkling stellar sparkles with phase variation
 * - Restrained musical audio reactivity (pulsing inner core luminescence)
 * - Chromatic dispersion ribbons for PRISM STATIC
 * - Blackstar singularity absorption tuning
 * - Canonical SIGNAL CYAN preservation
 */

import * as THREE from 'three';

export interface CosmicShaderUniforms {
  tDiffuse: { value: THREE.Texture | null };
  tNormal: { value: THREE.Texture | null };
  tMetallicRoughness: { value: THREE.Texture | null };
  tCosmicTexture: { value: THREE.Texture | null };
  uHasCosmicTexture: { value: number };
  uCosmicUvScale: { value: number };
  uExposure: { value: number };
  uContrast: { value: number };
  uEmission: { value: number };
  uStarStrength: { value: number };
  uTime: { value: number };
  uAudioImpact: { value: number };
  uAudioBass: { value: number };
  uBaseColor: { value: THREE.Color };
  uNebulaPrimary: { value: THREE.Color };
  uNebulaSecondary: { value: THREE.Color };
  uStarColor: { value: THREE.Color };
  uRimColor: { value: THREE.Color };
  uParallaxDepth: { value: number };
  uLayer2Scale: { value: number };
  uFlowSpeed: { value: number };
  uSparkleRate: { value: number };
  uFresnelPower: { value: number };
  uAudioReactivity: { value: number };
  uIsCanonical: { value: number };
  uIsPrism: { value: number };
  uIsBlackstar: { value: number };
  uIsVideoArtifact: { value: number };
  uLightDirection: { value: THREE.Vector3 };
}

export const KarambitCosmicShaderDef = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tNormal: { value: null as THREE.Texture | null },
    tMetallicRoughness: { value: null as THREE.Texture | null },
    tCosmicTexture: { value: null as THREE.Texture | null },
    uHasCosmicTexture: { value: 0.0 },
    uCosmicUvScale: { value: 1.0 },
    uExposure: { value: 1.0 },
    uContrast: { value: 1.0 },
    uEmission: { value: 1.0 },
    uStarStrength: { value: 1.0 },
    uTime: { value: 0.0 },
    uAudioImpact: { value: 0.0 },
    uAudioBass: { value: 0.0 },
    uBaseColor: { value: new THREE.Color(0x2d3545) },
    uNebulaPrimary: { value: new THREE.Color(0x00f0ff) },
    uNebulaSecondary: { value: new THREE.Color(0x7928ca) },
    uStarColor: { value: new THREE.Color(0xffffff) },
    uRimColor: { value: new THREE.Color(0x00f0ff) },
    uParallaxDepth: { value: 0.22 },
    uLayer2Scale: { value: 2.4 },
    uFlowSpeed: { value: 0.06 },
    uSparkleRate: { value: 2.2 },
    uFresnelPower: { value: 2.6 },
    uAudioReactivity: { value: 0.22 },
    uIsCanonical: { value: 0.0 },
    uIsPrism: { value: 0.0 },
    uIsBlackstar: { value: 0.0 },
    uIsVideoArtifact: { value: 0.0 },
    uLightDirection: { value: new THREE.Vector3(1.5, 2.5, 2.0).normalize() }
  },

  vertexShader: `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewDir;
    varying vec3 vWorldPos;
    varying vec3 vViewNormal;
    varying vec3 vViewPosition;

    void main() {
      vUv = uv;
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPosition.xyz;

      // Normal in world space
      vNormal = normalize(mat3(modelMatrix) * normal);

      // Normal and position in view space (camera-relative)
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vViewNormal = normalize(normalMatrix * normal);
      vViewPosition = -mvPosition.xyz;

      // View direction in world space
      vViewDir = normalize(cameraPosition - worldPosition.xyz);

      gl_Position = projectionMatrix * mvPosition;
    }
  `,

  fragmentShader: `
    precision highp float;

    uniform sampler2D tDiffuse;
    uniform sampler2D tNormal;
    uniform sampler2D tMetallicRoughness;
    uniform sampler2D tCosmicTexture;
    uniform float uHasCosmicTexture;
    uniform float uCosmicUvScale;
    uniform float uExposure;
    uniform float uContrast;
    uniform float uEmission;
    uniform float uStarStrength;
    uniform float uTime;
    uniform float uAudioImpact;
    uniform float uAudioBass;
    uniform vec3 uBaseColor;
    uniform vec3 uNebulaPrimary;
    uniform vec3 uNebulaSecondary;
    uniform vec3 uStarColor;
    uniform vec3 uRimColor;
    uniform float uParallaxDepth;
    uniform float uLayer2Scale;
    uniform float uFlowSpeed;
    uniform float uSparkleRate;
    uniform float uFresnelPower;
    uniform float uAudioReactivity;
    uniform float uIsCanonical;
    uniform float uIsPrism;
    uniform float uIsBlackstar;
    uniform float uIsVideoArtifact;
    uniform vec3 uLightDirection;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewDir;
    varying vec3 vWorldPos;
    varying vec3 vViewNormal;
    varying vec3 vViewPosition;

    // Fast 2D pseudo-random hash
    float hash21(vec2 p) {
      p = fract(p * vec2(234.34, 435.345));
      p += dot(p, p + 34.23);
      return fract(p.x * p.y);
    }

    // Smooth value noise
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash21(i);
      float b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0));
      float d = hash21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    // 4-Octave Fractional Brownian Motion (FBM)
    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      mat2 rot = mat2(cos(0.55), sin(0.55), -sin(0.55), cos(0.55));
      for (int i = 0; i < 4; ++i) {
        v += a * noise(p);
        p = rot * p * 2.05 + vec2(17.43);
        a *= 0.5;
      }
      return v;
    }

    void main() {
      vec3 N = normalize(vNormal);
      vec3 V = normalize(vViewDir);

      // Tangent plane view projection for view-dependent parallax
      vec3 projV = V - N * dot(V, N);
      vec2 parallaxShift = projV.xy;

      // Sample PBR textures if available
      vec4 baseTex = texture2D(tDiffuse, vUv);
      vec4 metalRough = texture2D(tMetallicRoughness, vUv);

      // Metalness (B channel) distinguishes blade from handle grips
      float metalness = metalRough.b > 0.05 ? metalRough.b : 0.95;
      float bladeMask = smoothstep(0.35, 0.65, metalness);

      // Handle shading (tactical matte polymer/dark titanium)
      float diffuseLight = max(0.0, dot(N, uLightDirection));
      float ambientLight = 0.45;
      vec3 handleRgb = baseTex.rgb * uBaseColor * (diffuseLight * 0.75 + ambientLight);

      // Fresnel rim factor (glancing edge brightness)
      float fresnel = pow(1.0 - max(0.0, dot(N, V)), uFresnelPower);

      // Musical audio breathing (subtle, non-jarring)
      float audioPulse = 1.0 + (uAudioImpact * 0.55 + uAudioBass * 0.45) * uAudioReactivity;

      // ----------------------------------------------------------------------
      // 1. CANONICAL DEFAULT SKIN (SIGNAL CYAN)
      // ----------------------------------------------------------------------
      if (uIsCanonical > 0.5) {
        // Charcoal titanium blade with luminous cyan fuller groove and edge
        vec3 bladeSteel = baseTex.rgb * vec3(0.18, 0.22, 0.30);
        float spec = pow(max(0.0, dot(reflect(-uLightDirection, N), V)), 18.0) * 0.6;
        bladeSteel += vec3(spec);

        // Subtle internal cyan coordinate glow
        vec2 cyanParallaxUv = vUv * 4.0 + parallaxShift * 0.08;
        float subtleInternal = fbm(cyanParallaxUv) * 0.25;

        // Canonical glowing cyan fuller and cutting edge
        vec3 cyanEmissive = uRimColor * (fresnel * 1.6 + subtleInternal) * audioPulse;
        vec3 finalBlade = bladeSteel + cyanEmissive;

        vec3 finalColor = mix(handleRgb, finalBlade, bladeMask);
        gl_FragColor = vec4(finalColor, 1.0);
        return;
      }

      // ----------------------------------------------------------------------
      // 2. COSMIC SHADER SKINS (ASTRAL, VOID SIGNAL, REDSHIFT, PRISM, BLACKSTAR)
      // ----------------------------------------------------------------------

      // Slow cosmic flow time
      float flowTime = uTime * uFlowSpeed;

      // Remap blade UVs so 1254x1254 artwork cleanly spans the curved blade face
      vec2 bladeUv = vec2(clamp((vUv.x - 0.34) / 0.64, 0.0, 1.0), clamp(vUv.y / 0.79, 0.0, 1.0));

      // LAYER 1: Primary Texture Artwork (Parallax depth 1)
      vec2 uvLayer1 = bladeUv * uCosmicUvScale + parallaxShift * (uParallaxDepth * 0.75) + vec2(flowTime * 0.06, flowTime * 0.03);

      // LAYER 2: Secondary Internal Nebula / Star Dust (Parallax depth 2)
      vec2 uvLayer2 = bladeUv * (uCosmicUvScale * 1.35) + parallaxShift * (uParallaxDepth * 1.6) + vec2(-flowTime * 0.04, flowTime * 0.07);

      float nebulaFbm1 = 0.0;
      vec3 artColor1 = vec3(0.0);
      vec3 artColor2 = vec3(0.0);

      if (uHasCosmicTexture > 0.5) {
        if (uIsVideoArtifact > 0.5) {
          // ARTIFACT: the live video is the blade interior, never a separate plane.
          // Two nearby view-dependent samples give it restrained dimensional depth
          // while clamping UVs keeps the source framed inside the curved blade.
          vec2 artifactUvDeep = clamp(
            bladeUv + parallaxShift * (uParallaxDepth * 0.42),
            vec2(0.002),
            vec2(0.998)
          );
          vec2 artifactUvNear = clamp(
            bladeUv + parallaxShift * (uParallaxDepth * 0.78),
            vec2(0.002),
            vec2(0.998)
          );
          vec3 videoDeep = texture2D(tCosmicTexture, artifactUvDeep).rgb;
          vec3 videoNear = texture2D(tCosmicTexture, artifactUvNear).rgb;
          float signalLuma = dot(videoNear, vec3(0.2126, 0.7152, 0.0722));
          artColor1 = mix(videoDeep * 0.78, videoNear, 0.46);
          artColor2 = mix(
            uNebulaSecondary * 0.08,
            videoDeep * mix(vec3(1.0), uNebulaPrimary, 0.12),
            0.14 + signalLuma * 0.12
          );
        } else if (uIsPrism > 0.5) {
          // PRISM STATIC: Pearlescent / Icy / Iridescent cosmic material
          // Multi-angle iridescent chromatic wave shifting between icy electric cyan and soft pale rose-pink
          float angleShift = dot(N, V) * 2.8 + (parallaxShift.x + parallaxShift.y) * 2.2;
          float iridWave = sin(angleShift * 3.5 + flowTime * 0.4) * 0.5 + 0.5;
          vec3 icyCyan = vec3(0.24, 0.82, 0.96);     // Electric cyan
          vec3 palePink = vec3(0.97, 0.62, 0.78);    // Soft rose opal
          vec3 pearlLuster = mix(icyCyan, palePink, iridWave);

          // Faint cloudy internal depth
          float cloud1 = fbm(uvLayer1 * 2.5 + vec2(flowTime * 0.04, -flowTime * 0.02));
          float cloud2 = fbm(uvLayer2 * 3.2 + vec2(-flowTime * 0.03, flowTime * 0.05));

          // Clean luminous pearl base (clearly intentional pearl rather than flat white)
          vec3 pearlBase = vec3(0.88, 0.90, 0.94);
          vec3 iridescentPearl = mix(pearlBase, pearlLuster, 0.32 + cloud1 * 0.22);

          vec2 pShift = parallaxShift * 0.025;
          float rTex = texture2D(tCosmicTexture, uvLayer1 + pShift).r;
          float gTex = texture2D(tCosmicTexture, uvLayer1).g;
          float bTex = texture2D(tCosmicTexture, uvLayer1 - pShift).b;
          vec3 texNoise = vec3(rTex, gTex, bTex);

          artColor1 = mix(iridescentPearl, iridescentPearl * (0.82 + texNoise * 0.25), 0.55);
          artColor2 = mix(pearlLuster * 1.05, vec3(0.92, 0.95, 1.0), cloud2 * 0.45);
        } else if (uIsBlackstar > 0.5) {
          // BLACKSTAR: Prestige Singularity Artifact
          // Extremely dark near-black void core absorbing ambient light
          // 3-layer dimensional parallax:
          // Deep layer 1: Extremely faint abyssal violet wisp
          vec2 uvDeep = bladeUv * 0.85 + parallaxShift * 0.04 + vec2(flowTime * 0.012, 0.0);
          float deepWisp = smoothstep(0.45, 0.85, fbm(uvDeep * 2.2));
          vec3 deepNebula = vec3(0.016, 0.007, 0.032) * deepWisp;

          // Mid layer 2: Micro star dust
          vec2 uvMid = bladeUv * 1.75 + parallaxShift * 0.14 + vec2(0.0, flowTime * 0.02);
          float midDust = smoothstep(0.55, 0.92, fbm(uvMid * 4.0));
          vec3 midNebula = vec3(0.006, 0.015, 0.028) * midDust;

          // Base void core
          artColor1 = vec3(0.005, 0.007, 0.012) + deepNebula;
          artColor2 = midNebula;
        } else {
          artColor1 = texture2D(tCosmicTexture, uvLayer1).rgb;
          artColor2 = texture2D(tCosmicTexture, uvLayer2).rgb;
        }

        // Apply contrast & exposure
        artColor1 = pow(artColor1, vec3(uContrast)) * uExposure;
        artColor2 = pow(artColor2, vec3(uContrast)) * (uExposure * 0.7);
      } else {
        if (uIsPrism > 0.5) {
          float r1 = fbm(uvLayer1 + parallaxShift * 0.06);
          float g1 = fbm(uvLayer1);
          float b1 = fbm(uvLayer1 - parallaxShift * 0.06);
          artColor1 = vec3(r1, g1, b1) * uNebulaPrimary;
          artColor2 = vec3(fbm(uvLayer2)) * uNebulaSecondary;
        } else if (uIsBlackstar > 0.5) {
          artColor1 = vec3(0.006, 0.008, 0.014);
          artColor2 = vec3(0.003, 0.004, 0.008);
        } else {
          nebulaFbm1 = fbm(uvLayer1);
          artColor1 = mix(uNebulaPrimary, uNebulaSecondary, smoothstep(0.25, 0.75, nebulaFbm1));
          artColor2 = uNebulaSecondary * fbm(uvLayer2);
        }
      }

      // Trapped cosmic core: primary artwork dominates with subtle internal layer blend
      vec3 cosmicCore;
      if (uHasCosmicTexture > 0.5) {
        if (uIsBlackstar > 0.5) {
          cosmicCore = (artColor1 + artColor2) * uEmission;
        } else if (uIsVideoArtifact > 0.5) {
          cosmicCore = mix(artColor1, artColor2, 0.16) * uEmission;
        } else if (uIsPrism > 0.5) {
          cosmicCore = mix(artColor1, artColor2, 0.26) * uEmission;
        } else {
          cosmicCore = mix(artColor1, artColor2, 0.22);
          cosmicCore = mix(cosmicCore, cosmicCore * uNebulaPrimary * 1.25, 0.15) * uEmission;
        }
      } else {
        cosmicCore = artColor1 + artColor2 * 0.45;
      }
      cosmicCore *= audioPulse;

      // LAYER 3: Stellar Sparkles / Flares
      vec2 starGrid = uvLayer2 * (uIsBlackstar > 0.5 ? 4.0 : (uIsPrism > 0.5 ? 6.5 : 5.5));
      vec2 starCell = floor(starGrid);
      float starHash = hash21(starCell);
      vec2 starFract = fract(starGrid) - 0.5;
      float starDist = length(starFract);

      // Star presence: sparse for Blackstar, subtle & delicate for Prism
      float starThreshold = uIsVideoArtifact > 0.5 ? 0.975 : (uIsBlackstar > 0.5 ? 0.93 : (uIsPrism > 0.5 ? 0.88 : 0.85));
      float isStar = step(starThreshold, starHash);
      float starCore = smoothstep(0.09, 0.01, starDist) * isStar;
      float starTwinkle = sin(uTime * uSparkleRate + starHash * 6.28318) * 0.4 + 0.6;

      vec3 starGlow = vec3(0.0);
      if (uIsBlackstar > 0.5) {
        // Blackstar: Rare bright stellar flare with 4-point cross diffraction spike
        float isFlare = step(0.982, starHash);
        float crossX = max(0.0, 1.0 - abs(starFract.x) * 16.0);
        float crossY = max(0.0, 1.0 - abs(starFract.y) * 16.0);
        float flareSpike = (pow(crossX, 3.5) + pow(crossY, 3.5)) * isFlare * starTwinkle;
        vec3 flareCol = mix(vec3(0.7, 0.85, 1.0), vec3(1.0, 1.0, 1.0), isFlare);
        starGlow = (starCore * uStarColor * 0.6 + flareSpike * flareCol * 1.4) * uStarStrength;
      } else if (uIsVideoArtifact > 0.5) {
        starGlow = uStarColor * (starCore * starTwinkle * 0.18 * uStarStrength);
      } else if (uIsPrism > 0.5) {
        // Prism: subtle embedded shimmering diamond flecks
        starGlow = vec3(0.96, 0.97, 1.0) * (starCore * starTwinkle * 0.55 * uStarStrength);
      } else {
        starGlow = uStarColor * (starCore * starTwinkle * 0.8 * uStarStrength);
      }

      // Outer Fresnel rim
      vec3 rimGlow;
      if (uIsBlackstar > 0.5) {
        // Blackstar: Razor-thin cold spectral blue/violet/cyan event-horizon rim
        float eventHorizonFresnel = pow(fresnel, 3.8);
        vec3 eventHorizonCol = mix(vec3(0.32, 0.08, 0.68), vec3(0.0, 0.92, 1.0), fresnel);
        rimGlow = eventHorizonCol * (eventHorizonFresnel * 2.2);
      } else if (uIsVideoArtifact > 0.5) {
        // Thin signal-glass edge preserves the knife silhouette without washing
        // out the live imagery inside it.
        rimGlow = uRimColor * (pow(fresnel, uFresnelPower) * 1.25) * (0.9 + uAudioImpact * 0.16);
      } else if (uIsPrism > 0.5) {
        // Prism: Crisp luminous icy-pearl rim with subtle spectral sheen
        rimGlow = mix(vec3(0.75, 0.92, 1.0), vec3(1.0, 0.82, 0.92), fresnel) * (pow(fresnel, 2.2) * 1.4);
      } else {
        rimGlow = uRimColor * (fresnel * 1.6);
      }

      // Specular blade gloss for glass/blade enclosure feel
      // Blackstar absorbs ambient light -> specular is dampened to 0.09
      float specStrength = uIsVideoArtifact > 0.5 ? 0.28 : (uIsBlackstar > 0.5 ? 0.09 : (uIsPrism > 0.5 ? 0.40 : 0.45));
      float bladeSpec = pow(max(0.0, dot(reflect(-uLightDirection, N), V)), 24.0) * specStrength;

      // Composite the trapped cosmic blade
      vec3 cosmicBlade = cosmicCore + starGlow + rimGlow + vec3(bladeSpec * 0.35);
      if (uIsVideoArtifact > 0.5) {
        vec3 artifactSteel = baseTex.rgb * uBaseColor * (0.28 + diffuseLight * 0.28);
        cosmicBlade = mix(artifactSteel, cosmicBlade, 0.88);
      }

      // Composite handle vs blade
      vec3 finalColor = mix(handleRgb, cosmicBlade, bladeMask);

      gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), 1.0);
    }
  `
};

export class KarambitCosmicMaterial extends THREE.ShaderMaterial {
  constructor(parameters?: THREE.ShaderMaterialParameters) {
    const uniforms = THREE.UniformsUtils.clone(KarambitCosmicShaderDef.uniforms);
    super({
      name: 'KarambitCosmicMaterial',
      uniforms,
      vertexShader: KarambitCosmicShaderDef.vertexShader,
      fragmentShader: KarambitCosmicShaderDef.fragmentShader,
      ...parameters
    });
  }

  public updateTime(dt: number): void {
    this.uniforms.uTime.value += dt;
  }

  public setAudioImpact(impact: number, bass = 0): void {
    this.uniforms.uAudioImpact.value = impact;
    this.uniforms.uAudioBass.value = bass;
  }

  public setLightDirection(dir: THREE.Vector3): void {
    this.uniforms.uLightDirection.value.copy(dir).normalize();
  }
}
