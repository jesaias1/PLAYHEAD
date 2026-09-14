/**
 * Three.js Scene, Camera, Lighting, and Fog setup for Monumental Audio Brutalism
 */

import * as THREE from 'three';
import { VisualAccent } from '../audio/AudioFeatures';

export class Environment {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public dirLight: THREE.DirectionalLight;
  public hemiLight: THREE.HemisphereLight;

  private defaultFov = 75;
  private currentFov = 75;
  private targetFov = 75;

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
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;

    container.appendChild(this.renderer.domElement);

    // 4. Lighting: stark, high-contrast brutalist key light + cold ambient
    this.hemiLight = new THREE.HemisphereLight(0x45556b, 0x111620, 0.9);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xffffff, 2.2);
    this.dirLight.position.set(50, 120, 60);
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    window.addEventListener('resize', this.onResize);
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
    dt: number
  ): void {
    if (this.scene.fog instanceof THREE.Fog) {
      // Determine target fog far distance based on musical theme
      let targetFar = 320;
      let targetNear = 45;

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

      const lerpSpeed = Math.min(1.0, dt * 2.5);
      this.scene.fog.far += (targetFar - this.scene.fog.far) * lerpSpeed;
      this.scene.fog.near += (targetNear - this.scene.fog.near) * lerpSpeed;
      this.scene.fog.color.lerp(visualState.palette.fogColor, lerpSpeed);
    }

    // Subtle exposure modulation on musical peaks
    const targetExposure = 1.20 + visualState.dropImpact * 0.15 + visualState.energy * 0.05;
    this.renderer.toneMappingExposure += (targetExposure - this.renderer.toneMappingExposure) * Math.min(1.0, dt * 4.0);
  }

  public render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  public dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
