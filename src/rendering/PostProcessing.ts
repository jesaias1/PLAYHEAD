/**
 * PostProcessing pipeline for PLAYHEAD
 * Selective bloom + subtle vignette for premium visual quality.
 * Bloom targets only emissive/highlight geometry (threshold ~0.85).
 * Vignette adds subtle edge darkening for compositional focus.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// Lightweight vignette shader
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uIntensity: { value: 0.35 },
    uSmoothness: { value: 0.45 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uIntensity;
    uniform float uSmoothness;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 center = vUv - 0.5;
      float dist = length(center);
      float vignette = 1.0 - smoothstep(uSmoothness, uSmoothness + 0.35, dist) * uIntensity;
      gl_FragColor = vec4(color.rgb * vignette, color.a);
    }
  `
};

export type QualityMode = 'HIGH' | 'PERFORMANCE';

export class PostProcessing {
  public composer: EffectComposer;
  public bloomPass: UnrealBloomPass;
  public vignettePass: ShaderPass;
  public qualityMode: QualityMode = 'HIGH';

  private renderPass: RenderPass;
  private outputPass: OutputPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    // Create composer with HDR render target for bloom
    const size = renderer.getSize(new THREE.Vector2());
    const renderTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat
    });
    this.composer = new EffectComposer(renderer, renderTarget);

    // 1. Scene render pass
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // 2. Selective bloom — high threshold so only emissive geometry blooms
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      0.5,   // strength
      0.4,   // radius
      0.85   // threshold — only bright emissive surfaces bloom
    );
    this.composer.addPass(this.bloomPass);

    // 3. Subtle vignette
    this.vignettePass = new ShaderPass(VignetteShader);
    this.composer.addPass(this.vignettePass);

    // 4. Output pass (tonemapping + color space conversion)
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  }

  public setQuality(mode: QualityMode): void {
    this.qualityMode = mode;
    if (mode === 'PERFORMANCE') {
      this.bloomPass.enabled = false;
      this.vignettePass.enabled = false;
    } else {
      this.bloomPass.enabled = true;
      this.vignettePass.enabled = true;
    }
  }

  /** Update bloom intensity based on dramatic arc / section */
  public setBloomIntensity(strength: number): void {
    this.bloomPass.strength = Math.max(0.15, Math.min(1.2, strength));
  }

  public setVignetteIntensity(intensity: number): void {
    this.vignettePass.uniforms.uIntensity.value = Math.max(0, Math.min(0.7, intensity));
  }

  public resize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  public render(): void {
    this.composer.render();
  }

  public dispose(): void {
    this.composer.dispose();
  }
}
