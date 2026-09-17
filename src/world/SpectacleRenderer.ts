/**
 * SpectacleRenderer for PLAYHEAD SIGNAL RENDER
 * "Cosmic Pixel Brutalism" 6 distinct spectacle event families:
 * 1. MONOLITH_SPLIT: Stepped split plane + expanding lateral portal shockwave
 * 2. VOID_REVEAL: Vast horizon cosmic ring opening into deep negative space
 * 3. CATHEDRAL_IGNITION: Rhythmic sequential ignition streamer leaping through arches
 * 4. STARFIELD_BLOOM: High-altitude monumental star halo radiating downward
 * 5. WORLD_POWER_DOWN: Negative space silence veil dampening peripheral illumination
 * 6. SURF_CANYON_RELEASE: High-speed lateral streamer guides framing surf pathways
 */

import * as THREE from 'three';
import { SpectacleEvent } from './SpectaclePlanner';
import { MusicVisualState } from './MusicVisualController';
import { GeneratedTrack } from '../generation/GenerationTypes';
import { PixelArtLibrary } from './PixelArtLibrary';

export class SpectacleRenderer {
  public group: THREE.Group;

  // 1. Stepped Pixel Shockwave (8-sided polygon for MONOLITH_SPLIT & releases)
  private shockwaveMesh: THREE.Mesh;
  private shockwaveMaterial: THREE.MeshBasicMaterial;

  // 2. Cathedral Ignition Streamer
  private pulseBeacon: THREE.Mesh;
  private pulseMaterial: THREE.MeshBasicMaterial;

  // 3. Void Reveal Horizon Ring (monumental 120m-300m stepped disc)
  private voidRingMesh: THREE.Mesh;
  private voidRingMaterial: THREE.MeshBasicMaterial;

  // 4. Starfield Bloom Halo (monumental 4-point cross halo)
  private starBloomMesh: THREE.Mesh;
  private starBloomMaterial: THREE.MeshBasicMaterial;

  // 5. Surf Canyon Flank Guides (twin lateral streamer lines)
  private surfGuideLeft: THREE.Mesh;
  private surfGuideRight: THREE.Mesh;
  private surfGuideMaterial: THREE.MeshBasicMaterial;

  private currentTrack: GeneratedTrack | null = null;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();

    // 1. Shockwave ring (MONOLITH_SPLIT / SIGNATURE)
    const ringGeom = new THREE.RingGeometry(1.2, 3.2, 8);
    ringGeom.rotateX(-Math.PI / 2);
    this.shockwaveMaterial = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.shockwaveMesh = new THREE.Mesh(ringGeom, this.shockwaveMaterial);
    this.shockwaveMesh.visible = false;
    this.group.add(this.shockwaveMesh);

    // 2. Cathedral Ignition Streamer (box streamer)
    const beaconGeom = new THREE.BoxGeometry(1.4, 1.4, 24.0);
    this.pulseMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.pulseBeacon = new THREE.Mesh(beaconGeom, this.pulseMaterial);
    this.pulseBeacon.visible = false;
    this.group.add(this.pulseBeacon);

    // 3. Void Reveal Horizon Ring (massive ring)
    const voidGeom = new THREE.RingGeometry(25.0, 32.0, 12);
    voidGeom.rotateX(-Math.PI / 2);
    this.voidRingMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.voidRingMesh = new THREE.Mesh(voidGeom, this.voidRingMaterial);
    this.voidRingMesh.visible = false;
    this.group.add(this.voidRingMesh);

    // 4. Starfield Bloom Halo (4-point cross sprite on high altitude plane)
    const starTex = PixelArtLibrary.getStarCrossTexture('#ffffff');
    const starGeom = new THREE.PlaneGeometry(64.0, 64.0);
    this.starBloomMaterial = new THREE.MeshBasicMaterial({
      map: starTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.starBloomMesh = new THREE.Mesh(starGeom, this.starBloomMaterial);
    this.starBloomMesh.rotation.x = -Math.PI / 2;
    this.starBloomMesh.visible = false;
    this.group.add(this.starBloomMesh);

    // 5. Surf Canyon Streamer Guides
    const guideGeom = new THREE.BoxGeometry(0.6, 0.6, 32.0);
    this.surfGuideMaterial = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.surfGuideLeft = new THREE.Mesh(guideGeom, this.surfGuideMaterial);
    this.surfGuideRight = new THREE.Mesh(guideGeom, this.surfGuideMaterial);
    this.surfGuideLeft.visible = false;
    this.surfGuideRight.visible = false;
    this.group.add(this.surfGuideLeft);
    this.group.add(this.surfGuideRight);

    scene.add(this.group);
  }

  public init(track: GeneratedTrack): void {
    this.currentTrack = track;
    this.hideAll();
  }

  private hideAll(): void {
    this.shockwaveMesh.visible = false;
    this.pulseBeacon.visible = false;
    this.voidRingMesh.visible = false;
    this.starBloomMesh.visible = false;
    this.surfGuideLeft.visible = false;
    this.surfGuideRight.visible = false;
  }

  public update(
    activeSpectacle: SpectacleEvent | null,
    visualState: MusicVisualState,
    playerPos: THREE.Vector3,
    reduceMotion = false
  ): void {
    if (!activeSpectacle || !activeSpectacle.active) {
      this.hideAll();
      return;
    }

    const progress = activeSpectacle.progress; // 0 to 1
    const pCol = visualState.palette.primary;
    const hCol = visualState.palette.highlight || new THREE.Color(0xffffff);
    const motionScale = reduceMotion ? 0.5 : 1.0;

    let centerPos = playerPos;
    if (this.currentTrack && this.currentTrack.route[activeSpectacle.nodeIndex]) {
      const np = this.currentTrack.route[activeSpectacle.nodeIndex].position;
      centerPos = new THREE.Vector3(np.x, np.y, np.z);
    }

    switch (activeSpectacle.type) {
      case 'MONOLITH_SPLIT': {
        this.hideAll();
        this.shockwaveMesh.visible = true;
        this.shockwaveMaterial.color.copy(activeSpectacle.isSignature ? hCol : pCol);
        this.shockwaveMesh.position.set(centerPos.x, centerPos.y + 0.4, centerPos.z);

        const rawRadius = (1.0 + progress * 80.0) * motionScale;
        const steppedRadius = Math.floor(rawRadius / 4.0) * 4.0 + 1.0;
        this.shockwaveMesh.scale.set(steppedRadius, 1, steppedRadius);

        const rawOpacity = (1.0 - progress) * (activeSpectacle.isSignature ? 0.95 : 0.75);
        this.shockwaveMaterial.opacity = Math.floor(rawOpacity * 8.0) / 8.0;
        break;
      }

      case 'VOID_REVEAL': {
        this.hideAll();
        this.voidRingMesh.visible = true;
        this.voidRingMaterial.color.copy(hCol);
        this.voidRingMesh.position.set(centerPos.x, centerPos.y + 2.0, centerPos.z);

        const rawScale = (1.0 + progress * 4.5) * motionScale;
        const steppedScale = Math.floor(rawScale * 5.0) / 5.0;
        this.voidRingMesh.scale.set(steppedScale, 1, steppedScale);

        const rawOp = Math.sin(progress * Math.PI) * (activeSpectacle.isSignature ? 0.9 : 0.65);
        this.voidRingMaterial.opacity = Math.floor(rawOp * 8.0) / 8.0;
        break;
      }

      case 'CATHEDRAL_IGNITION': {
        this.hideAll();
        this.pulseBeacon.visible = true;
        this.pulseMaterial.color.copy(hCol);

        if (this.currentTrack && this.currentTrack.route.length > 0) {
          const targetNodeIdx = Math.min(
            this.currentTrack.route.length - 1,
            Math.floor(activeSpectacle.nodeIndex + progress * 24.0)
          );
          const targetNode = this.currentTrack.route[targetNodeIdx];
          this.pulseBeacon.position.set(targetNode.position.x, targetNode.position.y + 3.0, targetNode.position.z);
          this.pulseBeacon.rotation.set(targetNode.pitch, targetNode.yaw, targetNode.roll, 'YXZ');
          this.pulseMaterial.opacity = (1.0 - progress) * 0.9;
        }
        break;
      }

      case 'STARFIELD_BLOOM': {
        this.hideAll();
        this.starBloomMesh.visible = true;
        this.starBloomMaterial.color.copy(hCol);
        this.starBloomMesh.position.set(centerPos.x, centerPos.y + 55.0, centerPos.z);

        const scale = (0.6 + progress * 1.8) * motionScale;
        this.starBloomMesh.scale.set(scale, scale, 1);
        const op = Math.sin(progress * Math.PI) * 0.85;
        this.starBloomMaterial.opacity = op;
        break;
      }

      case 'SURF_CANYON_RELEASE': {
        this.hideAll();
        this.surfGuideLeft.visible = true;
        this.surfGuideRight.visible = true;
        this.surfGuideMaterial.color.copy(pCol);

        if (this.currentTrack && this.currentTrack.route[activeSpectacle.nodeIndex]) {
          const node = this.currentTrack.route[activeSpectacle.nodeIndex];
          const forward = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(node.pitch, node.yaw, node.roll, 'YXZ'));
          const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(node.pitch, node.yaw, node.roll, 'YXZ'));

          const lateralDist = 12.0 + progress * 6.0;
          this.surfGuideLeft.position.copy(node.position).addScaledVector(right, -lateralDist).addScaledVector(forward, progress * 18.0);
          this.surfGuideRight.position.copy(node.position).addScaledVector(right, lateralDist).addScaledVector(forward, progress * 18.0);

          this.surfGuideLeft.rotation.set(node.pitch, node.yaw, node.roll, 'YXZ');
          this.surfGuideRight.rotation.set(node.pitch, node.yaw, node.roll, 'YXZ');
          this.surfGuideMaterial.opacity = (1.0 - progress) * 0.85;
        }
        break;
      }

      case 'WORLD_POWER_DOWN': {
        this.hideAll();
        // Subdued dark signal pulse along route
        this.shockwaveMesh.visible = true;
        this.shockwaveMaterial.color.setHex(0x1a2332);
        this.shockwaveMesh.position.set(centerPos.x, centerPos.y + 0.1, centerPos.z);
        const s = (1.0 + progress * 20.0);
        this.shockwaveMesh.scale.set(s, 1, s);
        this.shockwaveMaterial.opacity = (1.0 - progress) * 0.4;
        break;
      }

      default:
        this.hideAll();
        break;
    }
  }

  public dispose(): void {
    this.shockwaveMesh.geometry.dispose();
    this.shockwaveMaterial.dispose();
    this.pulseBeacon.geometry.dispose();
    this.pulseMaterial.dispose();
    this.voidRingMesh.geometry.dispose();
    this.voidRingMaterial.dispose();
    this.starBloomMesh.geometry.dispose();
    this.starBloomMaterial.dispose();
    this.surfGuideLeft.geometry.dispose();
    this.surfGuideRight.geometry.dispose();
    this.surfGuideMaterial.dispose();
    this.group.clear();
  }
}
