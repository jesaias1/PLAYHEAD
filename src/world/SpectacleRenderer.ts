/**
 * SpectacleRenderer for PLAYHEAD
 * Executes real-time visual spectacle effects (shockwaves, ignition waves, power-down)
 * coordinated by SongDirector and SpectaclePlanner.
 */

import * as THREE from 'three';
import { SpectacleEvent } from './SpectaclePlanner';
import { MusicVisualState } from './MusicVisualController';
import { GeneratedTrack } from '../generation/GenerationTypes';

export class SpectacleRenderer {
  public group: THREE.Group;

  // Shockwave geometry & material
  private shockwaveMesh: THREE.Mesh;
  private shockwaveMaterial: THREE.MeshBasicMaterial;

  // Forward ignition pulse mesh
  private pulseBeacon: THREE.Mesh;
  private pulseMaterial: THREE.MeshBasicMaterial;

  private currentTrack: GeneratedTrack | null = null;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();

    // 1. Expanding Shockwave Ring (horizontal plane)
    const ringGeom = new THREE.RingGeometry(0.8, 2.5, 48);
    ringGeom.rotateX(-Math.PI / 2);
    this.shockwaveMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.shockwaveMesh = new THREE.Mesh(ringGeom, this.shockwaveMaterial);
    this.shockwaveMesh.visible = false;
    this.group.add(this.shockwaveMesh);

    // 2. High-speed Forward Ignition Pulse (streamer along route)
    const beaconGeom = new THREE.CylinderGeometry(0.4, 0.4, 18, 16);
    beaconGeom.rotateZ(Math.PI / 2);
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

    scene.add(this.group);
  }

  public init(track: GeneratedTrack): void {
    this.currentTrack = track;
    this.shockwaveMesh.visible = false;
    this.pulseBeacon.visible = false;
  }

  public update(activeSpectacle: SpectacleEvent | null, visualState: MusicVisualState, playerPos: THREE.Vector3): void {
    if (!activeSpectacle || !activeSpectacle.active) {
      this.shockwaveMesh.visible = false;
      this.pulseBeacon.visible = false;
      return;
    }

    const progress = activeSpectacle.progress; // 0 to 1
    const pCol = visualState.palette.primary;
    const hCol = visualState.palette.highlight;

    switch (activeSpectacle.type) {
      case 'SHOCKWAVE': {
        // Expand horizontal shockwave ring outwards from event node or player
        this.shockwaveMesh.visible = true;
        this.shockwaveMaterial.color.copy(activeSpectacle.isSignature ? hCol : pCol);

        let centerPos = playerPos;
        if (this.currentTrack && this.currentTrack.route[activeSpectacle.nodeIndex]) {
          const np = this.currentTrack.route[activeSpectacle.nodeIndex].position;
          centerPos = new THREE.Vector3(np.x, np.y, np.z);
        }

        this.shockwaveMesh.position.set(centerPos.x, centerPos.y + 0.5, centerPos.z);
        const radiusScale = 1.0 + progress * 65.0; // Expands to ~160m diameter
        this.shockwaveMesh.scale.set(radiusScale, 1, radiusScale);
        this.shockwaveMaterial.opacity = (1.0 - progress) * (activeSpectacle.isSignature ? 0.9 : 0.65);
        break;
      }

      case 'CATHEDRAL_IGNITION': {
        // Run a high-speed illumination pulse down the track ahead of player
        this.pulseBeacon.visible = true;
        this.pulseMaterial.color.copy(hCol);

        if (this.currentTrack && this.currentTrack.route.length > 0) {
          const route = this.currentTrack.route;
          const startIdx = Math.max(0, activeSpectacle.nodeIndex - 2);
          const targetIdx = Math.min(route.length - 1, startIdx + Math.floor(progress * 25));
          const node = route[targetIdx];

          this.pulseBeacon.position.set(node.position.x, node.position.y + 1.2, node.position.z);
          this.pulseBeacon.rotation.y = node.yaw;
          this.pulseMaterial.opacity = Math.sin(progress * Math.PI) * 0.85;
          const scale = 1.0 + Math.sin(progress * Math.PI) * 2.5;
          this.pulseBeacon.scale.set(scale, scale, scale);
        }
        break;
      }

      case 'STARFIELD_BLOOM':
      case 'VOID_REVEAL':
      case 'WORLD_POWER_DOWN':
      case 'MONOLITH_SPLIT':
      default:
        // Handled via SongDirector atmospheric & camera/fog parameters
        this.shockwaveMesh.visible = false;
        this.pulseBeacon.visible = false;
        break;
    }
  }

  public dispose(): void {
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
    this.shockwaveMesh.geometry.dispose();
    this.shockwaveMaterial.dispose();
    this.pulseBeacon.geometry.dispose();
    this.pulseMaterial.dispose();
    this.group.clear();
  }
}
