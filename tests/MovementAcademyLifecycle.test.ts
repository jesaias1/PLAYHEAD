import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MovementAcademy } from '../src/lab/MovementAcademy';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { RouteVoidEnvelope } from '../src/physics/RouteVoidEnvelope';
import { CameraController } from '../src/player/CameraController';
import { PlayerController } from '../src/player/PlayerController';
import { buildAcademyLayout } from '../src/lab/AcademyLayout';
import { PLAYHEAD_MOVEMENT_V1 } from '../src/player/MovementConfig';

describe('Academy temporary world lifecycle', () => {
  it('does not leave an Academy void callback installed when none existed before', () => {
    const physics = new PhysicsWorld();
    const camera = new CameraController(new THREE.PerspectiveCamera(), {} as HTMLElement);
    const player = new PlayerController(camera, physics);
    expect(player.voidChecker).toBeUndefined();
    const academy = new MovementAcademy(new THREE.Scene(), physics, player, camera, {} as HTMLElement);
    expect(player.voidChecker).toBeTypeOf('function');
    academy.dispose();
    expect(player.voidChecker).toBeUndefined();
  });
  it('isolates and restores collision geometry AND the authoritative void envelope', () => {
    const physics = new PhysicsWorld();
    const layout = buildAcademyLayout();
    const priorRoute = layout.nodes.map(n => ({ ...n,
      position: { ...n.position, y: n.position.y - 100, z: n.position.z + 20000 }
    }));
    physics.buildFromRoute(priorRoute);
    const snapshot = physics.snapshotColliders();
    const priorVoid = physics.getVoidDeathY();
    const camera = new CameraController(new THREE.PerspectiveCamera(), {} as HTMLElement);
    const player = new PlayerController(camera, physics);
    player.setPreset('SOURCE');
    player.authoritativeKillY = priorVoid;
    const checker = (p: THREE.Vector3) => physics.isPositionInVoid(p);
    player.voidChecker = checker;
    physics.clear();
    const academy = new MovementAcademy(new THREE.Scene(), physics, player, camera, {} as HTMLElement);
    expect(player.config).toEqual(PLAYHEAD_MOVEMENT_V1);
    expect(physics.colliders).toHaveLength(layout.nodes.length);
    expect(physics.getVoidDeathY()).toBeGreaterThan(priorVoid + 50);
    expect(physics.voidEnvelope).not.toBe(snapshot.voidEnvelope);
    academy.dispose();
    academy.dispose(); // repeated cleanup is safe
    expect(physics.colliders).toHaveLength(0);
    physics.restoreColliders(snapshot);
    expect(physics.colliders).toEqual(snapshot.colliders);
    expect(physics.voidEnvelope).toBeInstanceOf(RouteVoidEnvelope);
    expect(physics.voidEnvelope).toBe(snapshot.voidEnvelope);
    expect(physics.getVoidDeathY()).toBe(priorVoid);
    expect(player.authoritativeKillY).toBe(priorVoid);
    expect(player.voidChecker).toBe(checker);
    expect(player.currentPreset).toBe('SOURCE');
  });
});
