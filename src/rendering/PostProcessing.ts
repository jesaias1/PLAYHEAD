/**
 * PostProcessing pipeline for PLAYHEAD SIGNAL RENDER
 * Integrates selective UnrealBloom with SignalRenderPass, ViewmodelPass, and GrainScanlinePass.
 *
 * Execution sequence:
 * 1. RenderPass (3D World Scene)
 * 2. UnrealBloomPass (Selective Bloom on Emissive Signals)
 * 3. SignalRenderPass (World Pixel Stepping, Bayer Dither, Quantization, Vignette)
 * 4. ViewmodelPass (Composites Hands + Karambit into frame before final grain)
 * 5. OutputPass (Tone Mapping & Color Space Conversion)
 * 6. GrainScanlinePass (Global screen-space film grain & scanlines on top of EVERYTHING)
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { SignalRenderPass } from './SignalRenderPass';
import { GrainScanlinePass } from './GrainScanlinePass';
import { QualityPreset, QualityTier, resolvePreset } from './QualityPresets';

/**
 * Legacy quality mode names, retained for saved settings compatibility.
 * They now resolve through the unified QualityPresets table.
 */
export type QualityMode = 'SIGNAL' | 'CLEAN' | 'HIGH' | 'PERFORMANCE' | 'ULTRA';

const clampBloom = (v: number): number => Math.max(0.15, Math.min(1.2, v));

export interface IViewmodelRenderable {
  render: (renderer: THREE.WebGLRenderer) => void;
}

export class ViewmodelComposerPass extends Pass {
  public viewmodelController: IViewmodelRenderable | null = null;

  constructor() {
    super();
    this.needsSwap = false;
  }

  public setSize(_width: number, _height: number): void {
    // Viewmodel style filter manages its own render target resize on window resize
  }

  public render(
    renderer: THREE.WebGLRenderer,
    _writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget
  ): void {
    if (!this.enabled || !this.viewmodelController) return;

    const currentTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(readBuffer);
    this.viewmodelController.render(renderer);
    renderer.setRenderTarget(currentTarget);
  }
}

export class PostProcessing {
  public composer: EffectComposer;
  public bloomPass: UnrealBloomPass;
  public signalPass: SignalRenderPass;
  public viewmodelPass: ViewmodelComposerPass;
  public grainPass: GrainScanlinePass;
  public qualityMode: QualityMode = 'SIGNAL';

  /** Currently applied concrete preset (single source of truth for cost). */
  public preset: QualityPreset | null = null;

  private renderPass: RenderPass;
  private outputPass: OutputPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const size = renderer.getSize(new THREE.Vector2());
    const renderTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat
    });
    this.composer = new EffectComposer(renderer, renderTarget);

    // 1. Scene render pass (3D world)
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // 2. Selective bloom — high threshold so only emissive signals bloom
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      0.45,   // strength
      0.35,   // radius
      0.82   // threshold
    );
    this.composer.addPass(this.bloomPass);

    // 3. Signal Render Pass (Bayer dither + pixel stepping + quantization + vignette on world)
    this.signalPass = new SignalRenderPass();
    this.signalPass.setResolution(size.x, size.y);
    this.signalPass.setPixelSize(2.0); // 2.0 = chunky retro pixel grid
    this.signalPass.setDitherStrength(0.12);
    this.signalPass.setQuantizeLevels(32.0);
    this.composer.addPass(this.signalPass);

    // 4. Viewmodel Pass (Composites hands + karambit directly into the stylized frame)
    this.viewmodelPass = new ViewmodelComposerPass();
    this.composer.addPass(this.viewmodelPass as any);

    // 5. Output pass (Tone mapping & sRGB conversion)
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    // 6. Global Unified Grain & Scanlines Pass (Executes on top of the entire frame)
    this.grainPass = new GrainScanlinePass();
    this.grainPass.setResolution(size.x, size.y);
    this.grainPass.setGrainIntensity(0.015);    // Restrained, subtle grain
    this.grainPass.setScanlineIntensity(0.014); // Subtle scanlines
    this.composer.addPass(this.grainPass);

    // Default to SIGNAL mode
    this.setQuality('SIGNAL');
  }

  public setViewmodelController(ctrl: IViewmodelRenderable | null): void {
    this.viewmodelPass.viewmodelController = ctrl;
  }

  public setQuality(mode: QualityMode): void {
    this.qualityMode = mode;
    // Legacy quality mode now maps onto the unified preset table, so there is
    // exactly one source of truth for postprocessing cost.
    const tierMap: Record<QualityMode, Exclude<QualityTier, 'AUTO'>> = {
      PERFORMANCE: 'LOW',
      CLEAN: 'MEDIUM',
      HIGH: 'HIGH',
      SIGNAL: 'HIGH',
      ULTRA: 'ULTRA'
    };
    this.applyPreset(resolvePreset(tierMap[mode] ?? 'HIGH'));
  }

  /** Applies a concrete quality preset to the postprocessing chain. */
  public applyPreset(preset: QualityPreset): void {
    this.preset = preset;

    // Bloom is NEVER disabled — audio-reactive gate glow is core identity.
    this.bloomPass.enabled = true;
    this.bloomPass.strength = clampBloom(0.45 * preset.bloomScale);

    this.signalPass.enabled = preset.signalPassEnabled;
    if (preset.signalPassEnabled) {
      this.signalPass.setPixelSize(preset.signalPixelSize);
      this.signalPass.setDitherStrength(preset.signalDither);
      this.signalPass.setQuantizeLevels(preset.signalQuantize);
    }

    const grainOn = preset.grainScale > 0.01;
    this.grainPass.enabled = grainOn;
    if (grainOn) {
      this.grainPass.setGrainIntensity(0.015 * preset.grainScale);
      this.grainPass.setScanlineIntensity(0.014 * preset.grainScale);
    }
  }

  /** Update bloom intensity based on dramatic arc / section */
  public setBloomIntensity(strength: number): void {
    const scale = this.preset ? this.preset.bloomScale : 1.0;
    this.bloomPass.strength = clampBloom(strength * scale);
  }

  public setVignetteIntensity(intensity: number): void {
    this.signalPass.setVignetteIntensity(intensity);
  }

  /** Peripheral speed-streak strength (0 = off). Presentation only. */
  public setSpeedStreak(intensity: number): void {
    this.signalPass.setSpeedStreak(intensity);
  }

  public setGrainIntensity(intensity: number): void {
    this.grainPass.setGrainIntensity(intensity);
  }

  public setScanlineIntensity(intensity: number): void {
    this.grainPass.setScanlineIntensity(intensity);
  }

  public update(dt: number): void {
    this.grainPass.update(dt);
  }

  public resize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.bloomPass.resolution.set(width, height);
    this.signalPass.setResolution(width, height);
    this.grainPass.setResolution(width, height);
  }

  public render(viewmodelController?: IViewmodelRenderable | null): void {
    if (viewmodelController !== undefined) {
      this.viewmodelPass.viewmodelController = viewmodelController;
    }
    this.composer.render();
  }

  public dispose(): void {
    this.composer.dispose();
  }
}
