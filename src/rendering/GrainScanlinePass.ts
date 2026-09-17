/**
 * GrainScanlinePass for PLAYHEAD SIGNAL RENDER
 * Unified screen-space postprocessing pass executed on top of the ENTIRE composite
 * (world + first-person arms + karambit blade).
 *
 * Visually unifies all scene elements through:
 * - Ultra-fine temporal film grain (calibrated to restrained 0.015 intensity)
 * - Soft cathode scanline raster (calibrated to subtle 0.014 intensity)
 */

import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export const GrainScanlineShader = {
  name: 'GrainScanlineShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
    uGrainIntensity: { value: 0.015 },    // Restrained, subtle grain on top of everything
    uScanlineIntensity: { value: 0.014 }, // Subtle raster feel without dark banding
    uTime: { value: 0.0 },
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
    uniform float uGrainIntensity;
    uniform float uScanlineIntensity;
    uniform float uTime;
    uniform float uEnabled;

    varying vec2 vUv;

    void main() {
      vec4 baseColor = texture2D(tDiffuse, vUv);
      if (uEnabled < 0.5) {
        gl_FragColor = baseColor;
        return;
      }

      vec2 screenCoord = vUv * uResolution;

      // High-frequency pseudo-random grain with animated temporal jitter
      float noise = fract(sin(dot(floor(screenCoord) + vec2(fract(uTime * 17.31), fract(uTime * 29.13)), vec2(12.9898, 78.233))) * 43758.5453);
      float grain = (noise - 0.5) * uGrainIntensity;

      // Soft scanline raster
      float scanline = 1.0 - (sin(screenCoord.y * 3.14159265) * 0.5 + 0.5) * uScanlineIntensity;

      vec3 finalRgb = clamp((baseColor.rgb + grain) * scanline, 0.0, 1.0);
      gl_FragColor = vec4(finalRgb, baseColor.a);
    }
  `
};

export class GrainScanlinePass extends ShaderPass {
  constructor() {
    super(GrainScanlineShader);
  }

  public setResolution(width: number, height: number): void {
    this.uniforms.uResolution.value.set(width, height);
  }

  public setGrainIntensity(intensity: number): void {
    this.uniforms.uGrainIntensity.value = Math.max(0.0, Math.min(0.08, intensity));
  }

  public setScanlineIntensity(intensity: number): void {
    this.uniforms.uScanlineIntensity.value = Math.max(0.0, Math.min(0.08, intensity));
  }

  public update(dt: number): void {
    this.uniforms.uTime.value += dt;
  }
}
