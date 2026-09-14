/**
 * Cinematic camera controller for Replay mode
 */

import * as THREE from 'three';
import { lerp } from '../utils/math';

export class ReplayCamera {
  private camera: THREE.PerspectiveCamera;
  private currentCamPos = new THREE.Vector3();
  private currentLookTarget = new THREE.Vector3();
  private initialized = false;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  public reset(): void {
    this.initialized = false;
  }

  public update(
    playerPos: THREE.Vector3,
    yaw: number,
    _pitch: number,
    speed: number,
    dt: number
  ): void {
    // Forward vector in native system is (-sin(yaw), 0, -cos(yaw))
    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);

    const dist = 6.0 + Math.min(speed / 100, 3.0);
    const height = 2.4;

    // Camera trails behind player (-fwd * dist)
    const idealCamX = playerPos.x - fwdX * dist;
    const idealCamY = playerPos.y + height;
    const idealCamZ = playerPos.z - fwdZ * dist;

    // Look target slightly ahead of player (+fwd * 4.0)
    const idealTargetX = playerPos.x + fwdX * 4.0;
    const idealTargetY = playerPos.y + 1.2;
    const idealTargetZ = playerPos.z + fwdZ * 4.0;

    if (!this.initialized) {
      this.currentCamPos.set(idealCamX, idealCamY, idealCamZ);
      this.currentLookTarget.set(idealTargetX, idealTargetY, idealTargetZ);
      this.initialized = true;
    } else {
      // Smooth tracking damping
      const smoothFactor = Math.min(1.0, dt * 6.0);
      this.currentCamPos.x = lerp(this.currentCamPos.x, idealCamX, smoothFactor);
      this.currentCamPos.y = lerp(this.currentCamPos.y, idealCamY, smoothFactor);
      this.currentCamPos.z = lerp(this.currentCamPos.z, idealCamZ, smoothFactor);

      this.currentLookTarget.x = lerp(this.currentLookTarget.x, idealTargetX, smoothFactor);
      this.currentLookTarget.y = lerp(this.currentLookTarget.y, idealTargetY, smoothFactor);
      this.currentLookTarget.z = lerp(this.currentLookTarget.z, idealTargetZ, smoothFactor);
    }

    this.camera.position.copy(this.currentCamPos);
    this.camera.lookAt(this.currentLookTarget);
  }
}
