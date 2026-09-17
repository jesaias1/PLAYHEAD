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

export type QualityMode = 'SIGNAL' | 'CLEAN' | 'HIGH' | 'PERFORMANCE';

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
    if (mode === 'PERFORMANCE') {
      this.bloomPass.enabled = false;
      this.signalPass.enabled = false;
      this.grainPass.enabled = false;
    } else if (mode === 'CLEAN' || mode === 'HIGH') {
      this.bloomPass.enabled = true;
      this.signalPass.enabled = true;
      this.grainPass.enabled = true;
      this.signalPass.setPixelSize(1.0);
      this.signalPass.setDitherStrength(0.05);
      this.signalPass.setQuantizeLevels(48.0);
      this.grainPass.setGrainIntensity(0.008);
      this.grainPass.setScanlineIntensity(0.008);
    } else {
      // SIGNAL mode (canonical Cosmic Pixel Brutalism)
      this.bloomPass.enabled = true;
      this.signalPass.enabled = true;
      this.grainPass.enabled = true;
      this.signalPass.setPixelSize(2.0);
      this.signalPass.setDitherStrength(0.12);
      this.signalPass.setQuantizeLevels(32.0);
      this.grainPass.setGrainIntensity(0.015);
      this.grainPass.setScanlineIntensity(0.014);
    }
  }

  /** Update bloom intensity based on dramatic arc / section */
  public setBloomIntensity(strength: number): void {
    this.bloomPass.strength = Math.max(0.15, Math.min(1.2, strength));
  }

  public setVignetteIntensity(intensity: number): void {
    this.signalPass.setVignetteIntensity(intensity);
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
