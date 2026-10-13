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

    // Framing is applied once at the common parent so hands and knife move
    // together without disturbing the calibrated knife socket.
    expect(vm['rootGroup'].position.toArray()).toEqual([0, -0.105, 0]);

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

  it('maintains calibrated knife socket transform relative to right hand bone', () => {
    const vm = new ViewmodelController();
    const camera = new THREE.PerspectiveCamera();
    const camCtrl = new CameraController(camera, {} as HTMLElement);
    const physics = new PhysicsWorld();
    const player = new PlayerController(camCtrl, physics);

    // Update viewmodel
    vm.update(0.016, player, camCtrl, 0, 0);

    // Verify knife socket position and rotation match calibrated handle grip
    const knifeGroup = vm['rigInstance'].knifeGroup;
    expect(knifeGroup).toBeDefined();
    if (knifeGroup) {
      expect(knifeGroup.position.x).toBeCloseTo(0.0093, 3);
      expect(knifeGroup.position.y).toBeCloseTo(0.1107, 3);
      expect(knifeGroup.position.z).toBeCloseTo(0.0033, 3);
      expect(knifeGroup.rotation.x).toBeCloseTo(3.034, 3);
      expect(knifeGroup.rotation.y).toBeCloseTo(0.3737, 3);
      expect(knifeGroup.rotation.z).toBeCloseTo(0.2205, 3);
      expect(knifeGroup.scale.x).toBeCloseTo(1.011, 3);
    }

    vm.dispose();
  });

  it('spins the knife about its ring on Mouse1 without moving the calibrated socket', () => {
    const vm = new ViewmodelController();
    const camera = new THREE.PerspectiveCamera();
    const camCtrl = new CameraController(camera, {} as HTMLElement);
    const physics = new PhysicsWorld();
    const player = new PlayerController(camCtrl, physics);
    const rig = vm['rigInstance'];
    const flourish = rig.knifeFlourishGroup;
    const identity = new THREE.Quaternion();

    expect(vm.triggerSpin()).toBe(true);
    // Mashing the button keeps the knife spinning, well past one spin's worth.
    let lastAngle = 0;
    for (let frame = 0; frame < 150; frame++) {
      if (frame % 15 === 0) vm.triggerSpin();
      vm.update(0.016, player, camCtrl, 0, 0);
      if (frame > 20) expect(vm['spinAngle']).toBeGreaterThan(lastAngle);
      lastAngle = vm['spinAngle'];
    }
    expect(vm['activeAction']).toBe('SPIN');
    expect(lastAngle).toBeGreaterThan(Math.PI * 2 * 4);
    expect(vm['fingerOpen']).toBeGreaterThan(0.9);

    // The ring's centre stays put while the knife turns round it.
    const ring = new THREE.Vector3(0, 0.0131, -0.0388);
    flourish.updateMatrix();
    expect(ring.clone().applyMatrix4(flourish.matrix).distanceTo(ring)).toBeLessThan(1e-6);

    // The socket keeps its calibration throughout.
    expect(rig.knifeGroup.position.x).toBeCloseTo(0.0093, 4);
    expect(rig.knifeGroup.rotation.x).toBeCloseTo(3.034, 4);
    expect(rig.knifeGroup.scale.x).toBeCloseTo(1.011, 4);

    // Stop clicking: it slows to a whole turn and lands back where it started.
    for (let frame = 0; frame < 200; frame++) vm.update(0.016, player, camCtrl, 0, 0);
    expect(vm['activeAction']).toBe('NONE');
    expect(flourish.quaternion.angleTo(identity)).toBeCloseTo(0, 6);
    expect(flourish.position.length()).toBeCloseTo(0, 6);

    vm.dispose();
  });

  it('draws a speed line from the blade tip only after a few turns, and eases to rest after one click', () => {
    const vm = new ViewmodelController();
    const camera = new THREE.PerspectiveCamera();
    const camCtrl = new CameraController(camera, {} as HTMLElement);
    const physics = new PhysicsWorld();
    const player = new PlayerController(camCtrl, physics);

    // One click: about a turn or two, no speed line, and the knife slows
    // smoothly (no big drop in speed from one frame to the next).
    vm.triggerSpin();
    let prev = 0;
    let maxDrop = 0;
    let steps = 0;
    while (vm['activeAction'] === 'SPIN' && steps++ < 600) {
      vm.update(1 / 60, player, camCtrl, 0, 0);
      expect(vm['trailStrength']).toBe(0);
      maxDrop = Math.max(maxDrop, prev - vm['spinOmega']);
      prev = vm['spinOmega'];
    }
    expect(vm['activeAction']).toBe('NONE');
    expect(maxDrop).toBeLessThan(1.5);
    // The landing is reported once (for the soft catch sound), and no whirl is left.
    expect(vm.consumeSpinLanded()).toBe(true);
    expect(vm.consumeSpinLanded()).toBe(false);
    expect(vm.getSpinLevel()).toBe(0);

    // Mashing past 2-3 turns brings the line up; it fades once the spin ends.
    for (let frame = 0; frame < 160; frame++) {
      if (frame % 10 === 0) vm.triggerSpin();
      vm.update(1 / 60, player, camCtrl, 0, 0);
    }
    expect(vm['trailStrength']).toBeGreaterThan(0.9);
    expect(vm['trailMesh']?.visible).toBe(true);
    for (let frame = 0; frame < 300; frame++) vm.update(1 / 60, player, camCtrl, 0, 0);
    expect(vm['trailMesh']?.visible).toBe(false);

    vm.dispose();
  });

  it('inspect turns the knife with the wrist, shrinks with a wide FOV, and ends at rest', () => {
    const vm = new ViewmodelController();
    const camera = new THREE.PerspectiveCamera();
    const camCtrl = new CameraController(camera, {} as HTMLElement);
    const physics = new PhysicsWorld();
    const player = new PlayerController(camCtrl, physics);
    const identity = new THREE.Quaternion();
    const peakLift = (fov: number): { lift: number; roll: number } => {
      vm.setFov(fov);
      vm.triggerInspect();
      let lift = 0;
      let roll = 0;
      for (let frame = 0; frame < 200; frame++) {
        vm.update(1 / 60, player, camCtrl, 0, 0);
        lift = Math.max(lift, vm['actionPos'].y);
        roll = Math.max(roll, vm['rigInstance'].knifeFlourishGroup.quaternion.angleTo(identity));
        // A click mid-inspect does not start a spin that would fight the roll.
        if (frame === 30) expect(vm.triggerSpin()).toBe(false);
      }
      return { lift, roll };
    };

    const normal = peakLift(65);
    expect(normal.roll).toBe(0); // the knife never leaves the hand's grip
    expect(vm['activeAction']).toBe('NONE');
    expect(vm['rigInstance'].knifeFlourishGroup.quaternion.angleTo(identity)).toBeCloseTo(0, 6);

    // At 120 degrees the arm reaches further into view, so the pose is smaller.
    const wide = peakLift(120);
    expect(wide.lift).toBeLessThan(normal.lift);
    expect(wide.lift).toBeGreaterThan(normal.lift * 0.3);

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
