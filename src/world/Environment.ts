/**
 * Three.js Scene, Camera, Lighting, and Fog setup for Monumental Audio Brutalism
 */

import * as THREE from 'three';
import { VisualAccent } from '../audio/AudioFeatures';
import { PostProcessing, QualityMode } from '../rendering/PostProcessing';
import { SettingsManager } from '../core/Settings';
import {
  AdaptiveQuality,
  QualityPreset,
  QualityTier,
  resolvePreset,
  scaledRenderSize,
  effectivePixelRatio
} from '../rendering/QualityPresets';

export class Environment {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public dirLight: THREE.DirectionalLight;
  public hemiLight: THREE.HemisphereLight;
  public postProcessing: PostProcessing;

  /** Resolved quality tier currently in effect (AUTO resolves to a concrete tier). */
  public qualityTier: QualityTier = 'AUTO';
  public resolvedTier: Exclude<QualityTier, 'AUTO'> = 'HIGH';
  public activePreset: QualityPreset = resolvePreset('HIGH');

  private adaptive: AdaptiveQuality = new AdaptiveQuality('HIGH');

  private defaultFov = 75;
  private currentFov = 75;
  private targetFov = 75;

  private viewmodelControllerRef: { render: (renderer: THREE.WebGLRenderer) => void; applyQuality?: (p: QualityPreset) => void } | null = null;
  /** Decoration LOD callback, supplied by World. */
  public decorationLodDistance = 0;

  constructor(container: HTMLElement) {
    // 1. Scene & Monumental Brutalist Fog (readable at distance)
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07080a);
    this.scene.fog = new THREE.Fog(0x07080a, 35, 450);

    // 2. Camera (75 vertical FOV = ~107.5 horizontal FOV in 16:9)
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(this.defaultFov, aspect, 0.1, 2000);
    this.camera.position.set(0, 2, 0);

    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({
      powerPreference: 'high-performance',
      antialias: true,
      alpha: false,
      stencil: false
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    container.appendChild(this.renderer.domElement);

    // 4. PostProcessing pipeline (selective bloom + subtle vignette)
    this.postProcessing = new PostProcessing(this.renderer, this.scene, this.camera);

    // 5. Quality: resolve the saved tier and apply render scale / DPR cap.
    //    CSS and UI stay native resolution; only the 3D target scales.
    const savedTier = (SettingsManager.getInstance().settings.graphics as QualityTier) || 'AUTO';
    this.applyQualityTier(savedTier, false);

    // 6. Lighting: stark, high-contrast brutalist key light + cold ambient
    this.hemiLight = new THREE.HemisphereLight(0x45556b, 0x111620, 1.05);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xffffff, 2.3);
    this.dirLight.position.set(50, 120, 60);
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    window.addEventListener('resize', this.onResize);
  }

  /**
   * Resolves and applies a quality tier.
   *
   * This is the single entry point for all render-cost scaling. It only ever
   * changes rendering parameters — never gameplay geometry, collision, physics
   * timestep, movement, or route generation.
   */
  public applyQualityTier(tier: QualityTier, persist = true): void {
    this.qualityTier = tier;

    if (tier === 'AUTO') {
      this.adaptive.reset();
      this.adaptive.tier = this.resolvedTier;
      this.resolvedTier = this.adaptive.tier;
    } else {
      this.resolvedTier = tier;
    }

    const preset = resolvePreset(this.resolvedTier);
    this.activePreset = preset;

    // --- 1. Render resolution (cheapest large win) ------------------------
    this.applyRenderScale(preset);

    // --- 2. Postprocessing cost ------------------------------------------
    this.postProcessing.applyPreset(preset);
    this.viewmodelControllerRef?.applyQuality?.(preset);

    // --- 3. Distant decoration detail ------------------------------------
    this.decorationLodDistance = preset.decorationLodDistance;

    // --- 4. Secondary effects --------------------------------------------
    // (handled inside postProcessing.applyPreset via grainScale)

    if (persist) {
      SettingsManager.getInstance().update({ graphics: tier });
    }
  }

  /**
   * Applies render scale + DPR cap.
   *
   * `renderer.setSize` with `updateStyle` keeps the canvas stretched to the CSS
   * size, so the 3D scene renders at a lower internal resolution and is
   * upscaled by the browser — the UI/CSS layer is unaffected.
   */
  private applyRenderScale(preset: QualityPreset): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    // Set DPR to the preset's cap directly (render scale is folded into the
    // explicit drawing-buffer size below), avoiding double-scaling.
    const baseRatio = effectivePixelRatio(window.devicePixelRatio, preset);
    this.renderer.setPixelRatio(baseRatio);
    const target = scaledRenderSize(width, height, window.devicePixelRatio, preset);
    // setSize multiplies by the pixel ratio internally, so convert the desired
    // drawing-buffer size back into CSS units before calling it.
    this.renderer.setSize(
      Math.max(2, Math.floor(target.width / baseRatio)),
      Math.max(2, Math.floor(target.height / baseRatio)),
      true
    );
    this.postProcessing.resize(target.width, target.height);
  }

  /** Current effective render scale, for diagnostics. */
  public getRenderScaleInfo(): { effectiveRatio: number; bufferWidth: number; bufferHeight: number } {
    return {
      effectiveRatio: this.renderer.getPixelRatio() * this.activePreset.renderScale,
      bufferWidth: this.renderer.domElement.width,
      bufferHeight: this.renderer.domElement.height
    };
  }

  /** Averaged FPS tracked by the adaptive controller (diagnostics). */
  public get averageFps(): number {
    return this.adaptive.averageFps;
  }

  public setQuality(mode: QualityMode): void {
    // Legacy entry point, routed through the unified tier system.
    const tierMap: Record<QualityMode, QualityTier> = {
      PERFORMANCE: 'LOW',
      CLEAN: 'MEDIUM',
      HIGH: 'HIGH',
      SIGNAL: 'HIGH',
      ULTRA: 'ULTRA'
    };
    this.applyQualityTier(tierMap[mode] ?? 'HIGH');
  }

  public setBaseFov(fov: number): void {
    this.defaultFov = fov;
    this.targetFov = fov;
  }

  public setDynamicFovSpeed(speed: number, maxSpeed = 30, reduceMotion = false): void {
    if (reduceMotion) {
      this.targetFov = this.defaultFov;
      return;
    }
    // Very subtle FOV expansion during raw testing (+0 to +2.5 degrees max)
    const speedRatio = Math.min(1, Math.max(0, (speed - 14) / maxSpeed));
    this.targetFov = this.defaultFov + speedRatio * 2.5;
  }

  /**
   * Peripheral speed-streak strength (0..1). Presentation only; forced off
   * under reduce-motion.
   */
  public setSpeedStreak(intensity: number, reduceMotion = false): void {
    if (!this.postProcessing) return;
    this.postProcessing.setSpeedStreak(reduceMotion ? 0 : intensity);
  }

  public update(dt: number): void {
    // Keep directional light following the player along the route
    this.dirLight.position.set(
      this.camera.position.x + 50,
      this.camera.position.y + 120,
      this.camera.position.z + 60
    );
    this.dirLight.target.position.set(
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z
    );
    this.dirLight.target.updateMatrixWorld();

    // Smooth camera FOV transition
    if (Math.abs(this.currentFov - this.targetFov) > 0.01) {
      this.currentFov += (this.targetFov - this.currentFov) * Math.min(1, dt * 8);
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }

    if (this.postProcessing) {
      this.postProcessing.update(dt);
    }

    // --- Adaptive quality (AUTO only) -------------------------------------
    // Each frame's delta feeds an averaging window; the controller applies a
    // dead band plus a minimum number of frames between changes, so the tier
    // cannot oscillate. Cheap: one array push/shift per frame.
    if (this.qualityTier === 'AUTO' && dt > 0 && dt < 0.5) {
      const changed = this.adaptive.sample(dt);
      if (changed) {
        this.resolvedTier = changed;
        this.applyQualityTier('AUTO', false);
      }
    }
  }

  public setAccent(accent: VisualAccent): void {
    const col = new THREE.Color(accent.hex);
    this.hemiLight.color.lerp(col, 0.15);
  }

  public setPalette(palette: { primary: THREE.Color; secondary: THREE.Color; background: THREE.Color; fogColor: THREE.Color }): void {
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(palette.background);
    } else {
      this.scene.background = palette.background.clone();
    }
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(palette.fogColor);
    }
    this.hemiLight.color.copy(palette.secondary).lerp(new THREE.Color(0xffffff), 0.2);
    this.hemiLight.groundColor.copy(palette.background);
  }

  public updateAtmosphere(
    visualState: { sectionTheme: string; dropImpact: number; buildup: number; energy: number; palette: { fogColor: THREE.Color } },
    dt: number,
    directorState?: { fogNear: number; fogFar: number; bloomStrength: number; vignetteIntensity: number }
  ): void {
    if (this.scene.fog instanceof THREE.Fog) {
      let targetFar = directorState ? directorState.fogFar : 320;
      let targetNear = directorState ? directorState.fogNear : 45;

      if (!directorState) {
        if (visualState.sectionTheme === 'DROP' || visualState.dropImpact > 0.3) {
          targetFar = 460; // Horizon opens wide at drop
          targetNear = 60;
        } else if (visualState.sectionTheme === 'BUILDUP') {
          targetFar = 220; // Tension compression
          targetNear = 30;
        } else if (visualState.sectionTheme === 'BREATH') {
          targetFar = 390; // Open quiet void
          targetNear = 50;
        }
      }

      const lerpSpeed = Math.min(1.0, dt * 2.5);
      this.scene.fog.far += (targetFar - this.scene.fog.far) * lerpSpeed;
      this.scene.fog.near += (targetNear - this.scene.fog.near) * lerpSpeed;
      this.scene.fog.color.lerp(visualState.palette.fogColor, lerpSpeed);
    }

    if (directorState && this.postProcessing) {
      this.postProcessing.setBloomIntensity(directorState.bloomStrength);
      this.postProcessing.setVignetteIntensity(directorState.vignetteIntensity);
    }

    // Subtle exposure modulation on musical peaks
    const targetExposure = 1.15 + visualState.dropImpact * 0.15 + visualState.energy * 0.05;
    this.renderer.toneMappingExposure += (targetExposure - this.renderer.toneMappingExposure) * Math.min(1.0, dt * 4.0);
  }

  public render(viewmodelController?: { render: (renderer: THREE.WebGLRenderer) => void; applyQuality?: (p: QualityPreset) => void } | null): void {
    if (viewmodelController !== undefined) {
      this.viewmodelControllerRef = viewmodelController;
    }
    this.postProcessing.render(viewmodelController);
  }

  private onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // Re-apply render scale so the drawing buffer tracks the new CSS size.
    this.applyRenderScale(this.activePreset);
  };

  public dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.postProcessing.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
