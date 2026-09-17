/**
 * ViewmodelStyleFilter for PLAYHEAD
 * Lightweight viewmodel-specific stylization pass.
 *
 * Integrates the viewmodel into PLAYHEAD's Cosmic Pixel Brutalism / Signal Render artstyle
 * using the SAME aesthetic family as the world, but calibrated with a CLEANER, MORE CONTROLLED strength:
 * - Full native resolution (pixel size 1.0 - zero blur, zero resolution loss, crisp geometry)
 * - Subtle 4x4 Bayer dithering on midtone transitions (strength 0.035 - eliminates plastic sheen)
 * - 48-level stepped color quantization (mild graphic posterization without banding)
 * - 1-pixel stylized signal silhouette edge (crisp graphic separation against dark voids & bright setpieces)
 * - Palette-aware ambient grounding & edge accents
 */

import * as THREE from 'three';
import { QualityMode } from '../rendering/PostProcessing';
import { QualityPreset, QualityTier, resolvePreset } from '../rendering/QualityPresets';

export const ViewmodelOverlayShader = {
  name: 'ViewmodelOverlayShader',
  uniforms: {
    tViewmodel: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
    uDitherStrength: { value: 0.035 },      // Subtle dither on midtones
    uQuantizeLevels: { value: 48.0 },      // 48 levels: clean stepped tonal response
    uSignalEdgeColor: { value: new THREE.Color(0x00f0ff) }, // Palette-driven signal rim
    uSignalEdgeStrength: { value: 0.28 },  // 1-pixel outer contour edge accent
    uAudioPulse: { value: 0.0 },           // Subtle musical brightening (0..~0.5)
    uEnabled: { value: 1.0 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    varying vec2 vUv;
    uniform sampler2D tViewmodel;
    uniform vec2 uResolution;
    uniform float uDitherStrength;
    uniform float uQuantizeLevels;
    uniform vec3 uSignalEdgeColor;
    uniform float uSignalEdgeStrength;
    uniform float uAudioPulse;
    uniform float uEnabled;

    // 4x4 Ordered Bayer Matrix (identical to SignalRenderPass for stylistic family unification)
    float bayer4x4(vec2 pixelPos) {
      int x = int(mod(pixelPos.x, 4.0));
      int y = int(mod(pixelPos.y, 4.0));
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

    void main() {
      vec4 base = texture2D(tViewmodel, vUv);
      if (base.a < 0.005) {
        discard;
      }

      if (uEnabled < 0.5) {
        gl_FragColor = base;
        return;
      }

      vec3 col = base.rgb;

      // 1. Subtle 4x4 Bayer Dithering on midtones
      // Applied at full 1:1 pixel resolution so fingers and knife stay razor-sharp
      float bayer = bayer4x4(gl_FragCoord.xy) - 0.5;
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      // Attenuate at deep black shadows and bright emissive peaks to preserve void & cyan glow
      float ditherWeight = smoothstep(0.04, 0.18, lum) * smoothstep(0.96, 0.72, lum);
      col += vec3(bayer * uDitherStrength * ditherWeight);

      // 2. Stepped Color Quantization (48 levels = clean retro posterization without harsh banding)
      if (uQuantizeLevels > 1.0) {
        col = floor(col * uQuantizeLevels + 0.5) / uQuantizeLevels;
      }

      // 3. Subtle 1-pixel Stylized Signal Silhouette Edge
      // Samples outer transparent boundary to produce a crisp graphic edge
      if (uSignalEdgeStrength > 0.01) {
        vec2 texel = 1.0 / uResolution;
        float aL = texture2D(tViewmodel, vUv + vec2(-texel.x, 0.0)).a;
        float aR = texture2D(tViewmodel, vUv + vec2(texel.x, 0.0)).a;
        float aU = texture2D(tViewmodel, vUv + vec2(0.0, texel.y)).a;
        float aD = texture2D(tViewmodel, vUv + vec2(0.0, -texel.y)).a;
        float minNeighborA = min(min(aL, aR), min(aU, aD));
        float edge = clamp((base.a - minNeighborA) * 1.8, 0.0, 1.0);

        // The rim lives on the silhouette only, so a strong transient briefly
        // brightens the outline — the illusion of the glowing world catching
        // the edge of the player's hands. The interior is never touched.
        float rimStrength = uSignalEdgeStrength * (1.0 + uAudioPulse);
        vec3 rimColor = uSignalEdgeColor * (1.0 + uAudioPulse * 0.28);
        col = mix(col, min(rimColor, vec3(1.0)), edge * rimStrength);
      }

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), base.a);
    }
  `
};

export class ViewmodelStyleFilter {
  private renderTarget: THREE.WebGLRenderTarget | null = null;
  /** Exposed for dev diagnostics / framing verification. */
  public get target(): THREE.WebGLRenderTarget | null {
    return this.renderTarget;
  }
  private overlayScene: THREE.Scene;
  private overlayCamera: THREE.OrthographicCamera;
  private overlayMaterial: THREE.ShaderMaterial;
  private overlayMesh: THREE.Mesh;
  private width = 1920;
  private height = 1080;

  constructor() {
    this.overlayScene = new THREE.Scene();
    this.overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.overlayMaterial = new THREE.ShaderMaterial({
      name: 'ViewmodelOverlayMaterial',
      uniforms: THREE.UniformsUtils.clone(ViewmodelOverlayShader.uniforms),
      vertexShader: ViewmodelOverlayShader.vertexShader,
      fragmentShader: ViewmodelOverlayShader.fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending
    });

    this.overlayMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.overlayMaterial);
    this.overlayScene.add(this.overlayMesh);

    if (typeof window !== 'undefined') {
      this.width = window.innerWidth || 1920;
      this.height = window.innerHeight || 1080;
      this.initRenderTarget(this.width, this.height);
    }
  }

  private initRenderTarget(width: number, height: number, samples = 4): void {
    if (this.renderTarget) {
      this.renderTarget.dispose();
    }
    this.renderTarget = new THREE.WebGLRenderTarget(width, height, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      // MSAA is expensive at high resolution; low tiers drop it to 1 (off).
      samples: Math.max(1, samples),
      depthBuffer: true,
      stencilBuffer: false
    });
    this.overlayMaterial.uniforms.tViewmodel.value = this.renderTarget.texture;
    this.overlayMaterial.uniforms.uResolution.value.set(width, height);
  }

  /**
   * Applies a quality preset. HIGH matches the original reference look exactly.
   */
  public applyPreset(preset: QualityPreset): void {
    this.overlayMaterial.uniforms.uEnabled.value = 1.0;
    this.overlayMaterial.uniforms.uDitherStrength.value = preset.signalDither * 0.3;
    this.overlayMaterial.uniforms.uQuantizeLevels.value = preset.signalQuantize;
    // Lower tiers thin the stylized silhouette rim slightly to save fill.
    this.overlayMaterial.uniforms.uSignalEdgeStrength.value = preset.signalPassEnabled ? 0.28 : 0.18;

    // Re-create the target so the MSAA sample count follows the preset.
    if (this.renderTarget && this.renderTarget.samples !== Math.max(1, preset.viewmodelSamples)) {
      this.initRenderTarget(this.width, this.height, preset.viewmodelSamples);
    }
  }

  public setQuality(mode: QualityMode): void {
    const tierMap: Record<QualityMode, Exclude<QualityTier, 'AUTO'>> = {
      PERFORMANCE: 'LOW',
      CLEAN: 'MEDIUM',
      HIGH: 'HIGH',
      SIGNAL: 'HIGH',
      ULTRA: 'ULTRA'
    };
    this.applyPreset(resolvePreset(tierMap[mode] ?? 'HIGH'));
  }

  /**
   * ADAPTIVE VIEWMODEL ACCENT
   *
   * Derives the stylized rim colour from the CURRENT world/section palette so
   * the hands read as being lit by the glowing world they are moving through:
   * cyan map -> icy cyan, purple map -> violet, red map -> crimson, and so on.
   *
   * `primary` carries the map's identity hue, so it dominates the mix. A small
   * amount of `secondary` keeps the rim from looking like a flat single-colour
   * outline. Nothing here recolours the hand itself — only the silhouette rim.
   */
  public setPalette(palette: { primary?: THREE.Color; secondary?: THREE.Color }): void {
    const primary = palette.primary;
    if (!primary) return;

    const secondary = palette.secondary;
    const rim = primary.clone();
    if (secondary) {
      rim.lerp(secondary, 0.22);
    }
    this.overlayMaterial.uniforms.uSignalEdgeColor.value.copy(rim);
  }

  /**
   * Weak musical accent for the viewmodel rim.
   *
   * `pulse` is expected to be a small, already-shaped value (roughly 0..0.32).
   * This intentionally sits far below the world-gate response: the viewmodel
   * should feel integrated with the same lighting language, never compete
   * with it or strobe on every beat.
   */
  public setAudioPulse(pulse: number): void {
    this.overlayMaterial.uniforms.uAudioPulse.value = Math.max(0, Math.min(0.32, pulse));
  }

  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    if (this.renderTarget) {
      this.renderTarget.setSize(width, height);
      this.overlayMaterial.uniforms.uResolution.value.set(width, height);
    }
  }

  /**
   * Renders the viewmodel scene into the isolated render target,
   * then composites it onto the main canvas with the subtle signal overlay filter.
   */
  public render(
    renderer: THREE.WebGLRenderer,
    viewmodelScene: THREE.Scene,
    viewmodelCamera: THREE.Camera
  ): void {
    if (!this.renderTarget) {
      this.initRenderTarget(renderer.domElement.width || 1920, renderer.domElement.height || 1080);
    }

    if (!this.renderTarget) {
      // Fallback for headless environments without render target support
      renderer.render(viewmodelScene, viewmodelCamera);
      return;
    }

    // 1. Render viewmodel scene into transparent render target
    const currentTarget = renderer.getRenderTarget();
    const origAutoClear = renderer.autoClear;

    renderer.setRenderTarget(this.renderTarget);
    renderer.setClearColor(0x000000, 0.0);
    renderer.clear();
    renderer.render(viewmodelScene, viewmodelCamera);

    // 2. Composite overlay pass back to destination (main canvas)
    renderer.setRenderTarget(currentTarget);
    renderer.autoClear = false;
    renderer.render(this.overlayScene, this.overlayCamera);
    renderer.autoClear = origAutoClear;
  }

  public dispose(): void {
    this.renderTarget?.dispose();
    this.overlayMesh.geometry.dispose();
    this.overlayMaterial.dispose();
  }
}
