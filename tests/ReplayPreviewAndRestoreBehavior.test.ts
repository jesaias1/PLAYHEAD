import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { PlayerController } from '../src/player/PlayerController';
import { CameraController } from '../src/player/CameraController';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { KarambitSkinSystem } from '../src/viewmodel/KarambitSkinSystem';
import { MasteryGloveSystem } from '../src/mastery/MasteryGloveSystem';

function createLocalStorageMock(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (k: string) => values.get(k) ?? null,
    key: (i: number) => [...values.keys()][i] ?? null,
    removeItem: (k: string) => { values.delete(k); },
    setItem: (k: string, v: string) => { values.set(k, String(v)); }
  };
}

function makePlayer() {
  const camera = new THREE.PerspectiveCamera();
  const cameraController = new CameraController(camera);
  const physics = new PhysicsWorld();
  return new PlayerController(cameraController, physics);
}

describe('Restore vs initial competitive speed', () => {
  it('a fresh player (initial competitive start) has ZERO velocity', () => {
    const player = makePlayer();
    expect(player.getSpeedUnits()).toBe(0);
    expect(player.velocity.length()).toBe(0);
  });

  it('a first-checkpoint restore resumes at ~500 displayed speed units', () => {
    const player = makePlayer();
    player.applyRestoreVelocity(0.5, PlayerController.CHECKPOINT_RESTORE_SPEED_UNITS);
    expect(PlayerController.CHECKPOINT_RESTORE_SPEED_UNITS).toBe(500);
    expect(player.getSpeedUnits()).toBeCloseTo(500, 3);
  });
});

describe('Replay preview never mutates the viewer loadout', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: createLocalStorageMock(), configurable: true, writable: true });
    (KarambitSkinSystem as any).instance = null;
  });
  afterEach(() => {
    (KarambitSkinSystem as any).instance = null;
    MasteryGloveSystem.getInstance().resetForTests();
  });

  it('previews an UNOWNED knife+glove without equipping or owning them', () => {
    const skins = KarambitSkinSystem.getInstance();
    const equippedBefore = skins.getEquippedSkinId();
    expect(skins.isSkinRewardOwned('BLACKSTAR')).toBe(false);
    skins.setReplaySkinPreview('BLACKSTAR');
    // The RENDER path changes, the EQUIP/ownership path does not.
    expect(skins.getRenderSkinId()).toBe('BLACKSTAR');
    expect(skins.getEquippedSkinId()).toBe(equippedBefore);
    expect(skins.isSkinRewardOwned('BLACKSTAR')).toBe(false);
    skins.setReplaySkinPreview(null);
    expect(skins.getRenderSkinId()).toBe(equippedBefore);
  });

  it('an unknown recorded cosmetic falls back to a safe default', () => {
    const skins = KarambitSkinSystem.getInstance();
    skins.setReplaySkinPreview('TOTALLY_MADE_UP');
    // Never throws, never equips a bogus id.
    expect(skins.getEquippedSkinId()).toBe('SIGNAL_CYAN');
    skins.setReplaySkinPreview(null);
  });

  it('glove dev preview does not grant mastery eligibility', () => {
    const mastery = MasteryGloveSystem.getInstance();
    mastery.setDevPreview('SIGNAL_MASTER');
    expect(mastery.getDevPreviewGloveId()).toBe('SIGNAL_MASTER');
    // The ACHIEVEMENT is still not satisfied: viewing is not earning.
    expect(mastery.isSatisfied('SIGNAL_MASTER')).toBe(false);
    mastery.setDevPreview(null);
  });
});
