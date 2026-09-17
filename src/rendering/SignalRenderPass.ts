/**
 * SignalRenderPass for PLAYHEAD SIGNAL RENDER
 * "Cosmic Pixel Brutalism" hybrid postprocessing pass.
 *
 * Combines:
 * - Integer-stable pixel stepping (chunky retro 3D feel without subpixel crawl)
 * - Ordered 4x4 Bayer dithering for atmospheric fog and gradients
 * - Stepped tonal quantization (restrained color ramps preserving readability)
 * - Edge-preserving contrast and subtle vignette
 */

import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export const SignalRenderShader = {
  name: 'SignalRenderShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
    uPixelSize: { value: 2.0 },         // 2.0 in SIGNAL mode, 1.0 in CLEAN
    uDitherStrength: { value: 0.12 },   // Dither intensity on gradients
    uQuantizeLevels: { value: 32.0 },   // Tonal steps per channel (32 = clean stepped ramp)
    uVignetteIntensity: { value: 0.35 },
    uVignetteSmoothness: { value: 0.45 },
    uGrainIntensity: { value: 0.026 },
    uScanlineIntensity: { value: 0.022 },
    uEnabled: { value: 1.0 }
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
    uniform vec2 uResolution;
    uniform float uPixelSize;
    uniform float uDitherStrength;
    uniform float uQuantizeLevels;
    uniform float uVignetteIntensity;
    uniform float uVignetteSmoothness;
    uniform float uGrainIntensity;
    uniform float uScanlineIntensity;
    uniform float uEnabled;

    varying vec2 vUv;

    // 4x4 Ordered Bayer Matrix (normalized 0..1, mean 0.5)
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
      if (uEnabled < 0.5) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }

      // 1. Integer-locked pixel stepping for temporal stability
      vec2 screenCoord = vUv * uResolution;
      vec2 steppedScreenCoord = floor(screenCoord / uPixelSize) * uPixelSize + (uPixelSize * 0.5);
      vec2 steppedUv = steppedScreenCoord / uResolution;

      vec4 color = texture2D(tDiffuse, steppedUv);

      // 2. Ordered Dithering (applied on gradients and midtones, preserving true black/brights)
      float bayer = bayer4x4(floor(screenCoord / uPixelSize)) - 0.5;
      float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));

      // Attenuate dither at absolute black and pure emissive peaks to preserve void & signals
      float ditherWeight = smoothstep(0.02, 0.15, luminance) * smoothstep(0.98, 0.75, luminance);
      vec3 ditheredColor = color.rgb + vec3(bayer * uDitherStrength * ditherWeight);

      // 3. Stepped Tonal Quantization
      if (uQuantizeLevels > 1.0) {
        ditheredColor = floor(ditheredColor * uQuantizeLevels + 0.5) / uQuantizeLevels;
      }

      // 4. Subtle Vignette
      vec2 center = vUv - 0.5;
      float dist = length(center);
      float vignette = 1.0 - smoothstep(uVignetteSmoothness, uVignetteSmoothness + 0.35, dist) * uVignetteIntensity;

      vec3 finalColor = clamp(ditheredColor * vignette, 0.0, 1.0);
      gl_FragColor = vec4(finalColor, color.a);
    }
  `
};

export class SignalRenderPass extends ShaderPass {
  constructor() {
    super(SignalRenderShader);
  }

  public setResolution(width: number, height: number): void {
    this.uniforms.uResolution.value.set(width, height);
  }

  public setPixelSize(size: number): void {
    this.uniforms.uPixelSize.value = Math.max(1.0, size);
  }

  public setDitherStrength(strength: number): void {
    this.uniforms.uDitherStrength.value = Math.max(0.0, Math.min(0.3, strength));
  }

  public setQuantizeLevels(levels: number): void {
    this.uniforms.uQuantizeLevels.value = levels;
  }

  public setVignetteIntensity(intensity: number): void {
    this.uniforms.uVignetteIntensity.value = Math.max(0.0, Math.min(0.8, intensity));
  }

  public setGrainIntensity(intensity: number): void {
    this.uniforms.uGrainIntensity.value = Math.max(0.0, Math.min(0.12, intensity));
  }

  public setScanlineIntensity(intensity: number): void {
    this.uniforms.uScanlineIntensity.value = Math.max(0.0, Math.min(0.08, intensity));
  }
}
