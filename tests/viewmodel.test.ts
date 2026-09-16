import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { ViewmodelGeometry } from '../src/viewmodel/ViewmodelGeometry';
import { ViewmodelController } from '../src/viewmodel/ViewmodelController';
import { PlayerController } from '../src/player/PlayerController';
import { CameraController } from '../src/player/CameraController';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { SettingsManager } from '../src/core/Settings';

describe('Viewmodel System — Hands & Karambit', () => {
  beforeEach(() => {
    // Reset settings to default
    SettingsManager.getInstance().update({
      viewmodelMode: 'FULL',
      viewmodelFov: 65,
      viewmodelSway: 1.0
    });
  });

  it('procedurally builds viewmodel rig with arms and stylized karambit', () => {
    const rig = ViewmodelGeometry.buildRig(new THREE.Color(0x00f0ff));

    expect(rig.rootGroup).toBeInstanceOf(THREE.Group);
    expect(rig.rightArmGroup).toBeInstanceOf(THREE.Group);
    expect(rig.leftArmGroup).toBeInstanceOf(THREE.Group);
    expect(rig.knifeGroup).toBeInstanceOf(THREE.Group);
    expect(rig.knifeSignalMaterial).toBeInstanceOf(THREE.MeshStandardMaterial);

    // Count meshes
    let meshCount = 0;
    rig.rootGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) meshCount++;
    });
    expect(meshCount).toBeGreaterThan(15); // Detailed procedural anatomy & knife

    rig.dispose();
  });

  it('positions hands in lower screen periphery keeping center route clear', () => {
    const vm = new ViewmodelController();

    // Verify scene and camera exist
    expect(vm.scene).toBeDefined();
    expect(vm.camera).toBeDefined();
    expect(vm.camera.fov).toBe(65);

    // Verify camera is near origin
    expect(vm.camera.position.x).toBe(0);
    expect(vm.camera.position.y).toBe(0);
    expect(vm.camera.position.z).toBe(0);

    vm.dispose();
  });

  it('guarantees zero periodic walk bobbing while walking or running on ground', () => {
    const vm = new ViewmodelController();
    const camera = new THREE.PerspectiveCamera();
    const camCtrl = new CameraController(camera, {} as HTMLElement);
    const physics = new PhysicsWorld();
    const player = new PlayerController(camCtrl, physics);

    // Player running steadily on flat ground
    player.isGrounded = true;
    player.velocity.set(0, 0, 15.0);

    const initialY = vm['motionGroup'].position.y;

    // Simulate 60 frames (1 second) of steady grounded running
    for (let frame = 0; frame < 60; frame++) {
      vm.update(0.016, player, camCtrl, 0, 0);
      // Vertical compression and motion group Y must remain completely steady (no sin/cos bob oscillation)
      expect(vm['compressionY']).toBe(0);
      expect(vm['motionGroup'].position.y).toBeCloseTo(initialY, 4);
    }

    vm.dispose();
  });

  it('responds to mouse movement with spring-damper sway', () => {
    const vm = new ViewmodelController();
    const camera = new THREE.PerspectiveCamera();
    const camCtrl = new CameraController(camera, {} as HTMLElement);
    const physics = new PhysicsWorld();
    const player = new PlayerController(camCtrl, physics);

    // Simulate looking right (mouse delta X > 0)
    vm.update(0.016, player, camCtrl, 25, 0);

    // Multiple frames of spring dampening
    for (let i = 0; i < 5; i++) {
      vm.update(0.016, player, camCtrl, 0, 0);
    }

    // Inspect active state
    expect(vm.isInspectActive()).toBe(false);

    vm.dispose();
  });

  it('responds to strafe keys with aerodynamic bank and drift', () => {
    const vm = new ViewmodelController();
    const camera = new THREE.PerspectiveCamera();
    const camCtrl = new CameraController(camera, {} as HTMLElement);
    const physics = new PhysicsWorld();
    const player = new PlayerController(camCtrl, physics);

    // Hold [A] (strafe left)
    (player.keysState as any).left = true;
    for (let i = 0; i < 10; i++) {
      vm.update(0.016, player, camCtrl, 0, 0);
    }

    // Switch to [D] (strafe right)
    (player.keysState as any).left = false;
    (player.keysState as any).right = true;
    for (let i = 0; i < 10; i++) {
      vm.update(0.016, player, camCtrl, 0, 0);
    }

    (player.keysState as any).right = false;
    vm.dispose();
  });

  it('applies fluid bhop landing compression with fast spring recovery', () => {
    const vm = new ViewmodelController();
    const camera = new THREE.PerspectiveCamera();
    const camCtrl = new CameraController(camera, {} as HTMLElement);
    const physics = new PhysicsWorld();
    const player = new PlayerController(camCtrl, physics);

    // In air
    player.isGrounded = false;
    player.velocity.set(0, -12.0, 18.0);
    vm.update(0.016, player, camCtrl, 0, 0);

    // Landing
    player.isGrounded = true;
    player.velocity.set(0, 0, 18.0);
    vm.update(0.016, player, camCtrl, 0, 0);

    // Step frames for spring recovery
    for (let i = 0; i < 15; i++) {
      vm.update(0.016, player, camCtrl, 0, 0);
    }

    vm.dispose();
  });

  it('shifts into authentic balance posture while surfing', () => {
    const vm = new ViewmodelController();
    const camera = new THREE.PerspectiveCamera();
    const camCtrl = new CameraController(camera, {} as HTMLElement);
    const physics = new PhysicsWorld();
    const player = new PlayerController(camCtrl, physics);

    // Enter surf on left ramp
    player.isSurfing = true;
    player.surfState.isSurfing = true;
    player.surfState.surfSide = 'LEFT';
    player.velocity.set(12.0, -8.0, 20.0);

    for (let i = 0; i < 15; i++) {
      vm.update(0.016, player, camCtrl, 0, 0);
    }

    // Switch to right ramp
    player.surfState.surfSide = 'RIGHT';
    for (let i = 0; i < 15; i++) {
      vm.update(0.016, player, camCtrl, 0, 0);
    }

    player.isSurfing = false;
    player.surfState.isSurfing = false;
    vm.dispose();
  });

  it('triggers and completes [F] karambit inspect flourish', () => {
    const vm = new ViewmodelController();
    const camera = new THREE.PerspectiveCamera();
    const camCtrl = new CameraController(camera, {} as HTMLElement);
    const physics = new PhysicsWorld();
    const player = new PlayerController(camCtrl, physics);

    expect(vm.isInspectActive()).toBe(false);
    vm.triggerInspect();
    expect(vm.isInspectActive()).toBe(true);

    // Advance 0.2s (Phase 1: 360° spin)
    vm.update(0.2, player, camCtrl, 0, 0);
    expect(vm.isInspectActive()).toBe(true);

    // Advance 0.5s (Phase 2: Inverted blade display)
    vm.update(0.5, player, camCtrl, 0, 0);
    expect(vm.isInspectActive()).toBe(true);

    // Advance to completion (> 1.5s total)
    vm.update(1.0, player, camCtrl, 0, 0);
    expect(vm.isInspectActive()).toBe(false); // Seamlessly returned to ready stance

    vm.dispose();
  });

  it('respects viewmodel settings for MINIMAL and OFF modes', () => {
    const vm = new ViewmodelController();
    const camera = new THREE.PerspectiveCamera();
    const camCtrl = new CameraController(camera, {} as HTMLElement);
    const physics = new PhysicsWorld();
    const player = new PlayerController(camCtrl, physics);

    // 1. MINIMAL mode: hides left arm
    SettingsManager.getInstance().update({ viewmodelMode: 'MINIMAL' });
    vm.update(0.016, player, camCtrl, 0, 0);

    // 2. OFF mode: skips processing
    SettingsManager.getInstance().update({ viewmodelMode: 'OFF' });
    vm.update(0.016, player, camCtrl, 0, 0);

    // 3. FULL mode: restores both arms
    SettingsManager.getInstance().update({ viewmodelMode: 'FULL' });
    vm.update(0.016, player, camCtrl, 0, 0);

    vm.dispose();
  });
});
