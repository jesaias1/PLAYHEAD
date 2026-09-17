/**
 * CelestialLandmarks for PLAYHEAD SIGNAL RENDER
 * "Cosmic Pixel Brutalism" 2D/2.5D monumental celestial system.
 *
 * Places enormous authored low-resolution pixel-art celestial objects
 * (Giant Pixel Moon, Solar Eclipse, Eye in the Void, Cosmic Halos, and Murals)
 * hundreds of meters away in 3D negative space with multi-plane subtle parallax.
 */

import * as THREE from 'three';
import { TrackAnalysis } from '../audio/AudioFeatures';
import { GeneratedTrack } from '../generation/GenerationTypes';
import { TrackPalette } from '../audio/TrackPalettes';
import { PixelArtLibrary } from './PixelArtLibrary';

export type CelestialType = 'MOON' | 'ECLIPSE' | 'EYE_VOID' | 'HALO_DISC';

export class CelestialLandmarks {
  public group: THREE.Group;
  private celestialMesh: THREE.Mesh | null = null;
  private haloMesh: THREE.Mesh | null = null;
  private heroStarsMesh: THREE.InstancedMesh | null = null;
  private relicGroup: THREE.Group = new THREE.Group();

  constructor(scene: THREE.Scene, analysis: TrackAnalysis, track: GeneratedTrack, palette: TrackPalette) {
    this.group = new THREE.Group();
    this.build(analysis, track, palette);
    scene.add(this.group);
  }

  private build(_analysis: TrackAnalysis, track: GeneratedTrack, palette: TrackPalette): void {
    const route = track.route;
    if (route.length < 5) return;

    // Determine celestial landmark type from song seed & spectral profile
    const seed = track.seed || 12345;
    let celestialType: CelestialType = 'MOON';
    if (palette.name === 'BLOOD_MOON' || palette.name === 'DEEP_SIGNAL') {
      celestialType = (seed % 2 === 0) ? 'ECLIPSE' : 'EYE_VOID';
    } else if (palette.name === 'EMBER_VOID' || palette.name === 'DUSK') {
      celestialType = (seed % 3 === 0) ? 'ECLIPSE' : 'MOON';
    } else if (palette.name === 'ACID_DREAM') {
      celestialType = (seed % 2 === 0) ? 'EYE_VOID' : 'HALO_DISC';
    } else {
      celestialType = (seed % 2 === 0) ? 'MOON' : 'HALO_DISC';
    }

    // Anchor position: placed 420m away in the horizon opposite the route's mid-point
    const midNode = route[Math.floor(route.length * 0.45)];
    const yaw = midNode.yaw + 0.35;
    const distance = 460.0;
    const elev = 95.0;

    const cx = midNode.position.x + Math.sin(yaw) * distance;
    const cz = midNode.position.z + Math.cos(yaw) * distance;
    const cy = midNode.position.y + elev;

    // 1. Multi-plane Celestial Body
    const celestialGroup = new THREE.Group();
    celestialGroup.position.set(cx, cy, cz);
    celestialGroup.lookAt(midNode.position.x, midNode.position.y + 10.0, midNode.position.z);

    const primaryHex = palette.primaryHex;
    const secondaryHex = palette.secondaryHex;
    const highlightHex = palette.highlight ? `#${palette.highlight.getHexString()}` : '#ffffff';

    let coreTex: THREE.CanvasTexture;
    let coreSize = 130.0;

    switch (celestialType) {
      case 'ECLIPSE':
        coreTex = PixelArtLibrary.getEclipseTexture(primaryHex);
        coreSize = 120.0;
        break;
      case 'EYE_VOID':
        coreTex = PixelArtLibrary.getEyeInTheVoidTexture(primaryHex, secondaryHex);
        coreSize = 110.0;
        break;
      case 'HALO_DISC':
        coreTex = PixelArtLibrary.getHaloTexture(primaryHex);
        coreSize = 140.0;
        break;
      case 'MOON':
      default:
        coreTex = PixelArtLibrary.getMoonTexture(highlightHex, palette.void ? `#${palette.void.getHexString()}` : '#0a0f1d');
        coreSize = 135.0;
        break;
    }

    // Layer 1: Outer cosmic halo plane (depth 480m)
    const haloTex = PixelArtLibrary.getHaloTexture(secondaryHex);
    const haloGeom = new THREE.PlaneGeometry(coreSize * 1.5, coreSize * 1.5);
    const haloMat = new THREE.MeshBasicMaterial({
      map: haloTex,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.haloMesh = new THREE.Mesh(haloGeom, haloMat);
    this.haloMesh.position.z = -15.0; // Slightly further behind
    celestialGroup.add(this.haloMesh);

    // Layer 2: Core pixel celestial body (depth 460m)
    const coreGeom = new THREE.PlaneGeometry(coreSize, coreSize);
    const coreMat = new THREE.MeshBasicMaterial({
      map: coreTex,
      transparent: true,
      opacity: 0.95,
      depthWrite: false
    });
    this.celestialMesh = new THREE.Mesh(coreGeom, coreMat);
    celestialGroup.add(this.celestialMesh);

    this.group.add(celestialGroup);

    // 2. HERO STAR CROSSES: 24 iconic 4-point pixel stars scattered across sky constellations
    const starCount = 28;
    const starGeom = new THREE.PlaneGeometry(12.0, 12.0);
    const starTex = PixelArtLibrary.getStarCrossTexture(highlightHex);
    const starMat = new THREE.MeshBasicMaterial({
      map: starTex,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this.heroStarsMesh = new THREE.InstancedMesh(starGeom, starMat, starCount);
    const dummy = new THREE.Object3D();

    for (let s = 0; s < starCount; s++) {
      const sAngle = (s / starCount) * Math.PI * 2 + (s * 1.7);
      const sDist = 380.0 + (s * 31) % 120.0;
      const sElev = 60.0 + ((s * 47) % 180.0);

      const sx = midNode.position.x + Math.cos(sAngle) * sDist;
      const sz = midNode.position.z + Math.sin(sAngle) * sDist;
      const sy = midNode.position.y + sElev;

      dummy.position.set(sx, sy, sz);
      dummy.scale.setScalar(0.7 + ((s * 13) % 10) * 0.08);
      dummy.lookAt(midNode.position.x, midNode.position.y, midNode.position.z);
      dummy.updateMatrix();
      this.heroStarsMesh.setMatrixAt(s, dummy.matrix);
    }
    this.heroStarsMesh.instanceMatrix.needsUpdate = true;
    this.group.add(this.heroStarsMesh);

    // 3. Symbolic World Relics: Moth and Flower floating emblems near quiet/breath sections
    const breathNode = route.find(n => !n.isSurf && n.time > 15 && n.time < 45) || route[Math.floor(route.length * 0.3)];
    if (breathNode) {
      const isMoth = (seed % 2 === 0);
      const relicTex = isMoth
        ? PixelArtLibrary.getMothTexture(secondaryHex, primaryHex)
        : PixelArtLibrary.getFlowerTexture(secondaryHex, highlightHex);

      const relicGeom = new THREE.PlaneGeometry(16.0, 16.0);
      const relicMat = new THREE.MeshBasicMaterial({
        map: relicTex,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide
      });
      const relicMesh = new THREE.Mesh(relicGeom, relicMat);
      // Place 45m to the side of the breath section, floating in negative space
      const rx = breathNode.position.x + Math.cos(breathNode.yaw) * 48.0;
      const rz = breathNode.position.z - Math.sin(breathNode.yaw) * 48.0;
      const ry = breathNode.position.y + 12.0;
      relicMesh.position.set(rx, ry, rz);
      relicMesh.rotation.y = breathNode.yaw + 0.3;
      this.relicGroup.add(relicMesh);
      this.group.add(this.relicGroup);
    }
  }

  public update(time: number, bass: number, dropImpact: number): void {
    // Subtle rotation of the outer celestial halo
    if (this.haloMesh) {
      this.haloMesh.rotation.z = time * 0.04;
      const baseOp = 0.5 + bass * 0.25 + dropImpact * 0.3;
      (this.haloMesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1.0, baseOp);
    }

    // Subtle floating breathing for symbolic relics
    if (this.relicGroup) {
      this.relicGroup.position.y = Math.sin(time * 1.5) * 0.6;
    }
  }

  public dispose(): void {
    this.group.traverse(obj => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.InstancedMesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
  }
}
