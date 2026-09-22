import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { PlayerController } from '../src/player/PlayerController';
import { CameraController } from '../src/player/CameraController';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';

class MockWindow {
  private listeners: Record<string, ((e: any) => void)[]> = {};
  addEventListener(event: string, fn: (e: any) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }
  removeEventListener(event: string, fn: (e: any) => void) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== fn);
  }
  dispatchEvent(e: any) {
    this.listeners[e.type]?.forEach(fn => fn(e));
  }
}

describe('R Key Tap vs Hold Logic', () => {
  let mockWindow: MockWindow;
  let originalWindow: any;

  beforeEach(() => {
    mockWindow = new MockWindow();
    originalWindow = (globalThis as any).window;
    (globalThis as any).window = mockWindow;
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    vi.restoreAllMocks();
  });

  it('triggers quick tap restore when released within 0.6s (including 0.4s hold)', () => {
    const camera = new THREE.PerspectiveCamera();
    const cameraController = new CameraController(camera);
    const physicsWorld = new PhysicsWorld();
    const player = new PlayerController(cameraController, physicsWorld);

    const onRestore = vi.fn();
    const onFullRestart = vi.fn();
    const onProgress = vi.fn();

    player.onRestoreCallback = onRestore;
    player.onFullRestartCallback = onFullRestart;
    player.onHoldProgressCallback = onProgress;

    let mockTime = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => mockTime);

    // Simulate keydown on KeyR
    mockWindow.dispatchEvent({ type: 'keydown', code: 'KeyR', repeat: false });

    expect(onProgress).toHaveBeenCalledWith(0.01);
    expect(onRestore).not.toHaveBeenCalled();
    expect(onFullRestart).not.toHaveBeenCalled();

    // Advance 0.3s (300ms) -> 50% hold progress (0.3 / 0.6)
    mockTime = 1300;
    player.updateFixed(0.016);
    expect(onProgress).toHaveBeenCalledWith(0.5);
    expect(onFullRestart).not.toHaveBeenCalled();

    // Release at 0.4s -> triggers checkpoint restore
    mockTime = 1400;
    mockWindow.dispatchEvent({ type: 'keyup', code: 'KeyR' });

    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onFullRestart).not.toHaveBeenCalled();
    expect(onProgress).toHaveBeenLastCalledWith(null);
  });

  it('triggers full level restart when held for >= 0.6s and does not trigger quick tap on release', () => {
    const camera = new THREE.PerspectiveCamera();
    const cameraController = new CameraController(camera);
    const physicsWorld = new PhysicsWorld();
    const player = new PlayerController(cameraController, physicsWorld);

    const onRestore = vi.fn();
    const onFullRestart = vi.fn();
    const onProgress = vi.fn();

    player.onRestoreCallback = onRestore;
    player.onFullRestartCallback = onFullRestart;
    player.onHoldProgressCallback = onProgress;

    let mockTime = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => mockTime);

    // Simulate keydown on KeyR
    mockWindow.dispatchEvent({ type: 'keydown', code: 'KeyR', repeat: false });
    expect(onProgress).toHaveBeenCalledWith(0.01);

    // Advance 0.3s -> 50% hold progress
    mockTime = 1300;
    player.updateFixed(0.016);
    expect(onProgress).toHaveBeenCalledWith(0.5);
    expect(onFullRestart).not.toHaveBeenCalled();

    // Advance to 0.65s -> triggers full restart
    mockTime = 1650;
    player.updateFixed(0.016);
    expect(onFullRestart).toHaveBeenCalledTimes(1);
    expect(onRestore).not.toHaveBeenCalled();

    // Keyup after full restart has fired: must NOT trigger quick-tap restore
    mockWindow.dispatchEvent({ type: 'keyup', code: 'KeyR' });
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('locks out inputs for specified duration and re-enables afterwards', () => {
    const camera = new THREE.PerspectiveCamera();
    const cameraController = new CameraController(camera);
    const physicsWorld = new PhysicsWorld();
    const player = new PlayerController(cameraController, physicsWorld);

    player.lockInput(0.1); // 100ms lockout
    expect(player.keysState.forward).toBe(false);

    // Attempting to press W during lockout is ignored
    mockWindow.dispatchEvent({ type: 'keydown', code: 'KeyW', repeat: false });
    expect(player.keysState.forward).toBe(false);

    // Advance 50ms in fixed ticks (dt = 0.05)
    player.updateFixed(0.05);
    mockWindow.dispatchEvent({ type: 'keydown', code: 'KeyW', repeat: false });
    expect(player.keysState.forward).toBe(false);

    // Advance another 60ms (total > 100ms) -> lockout has expired
    player.updateFixed(0.06);
    mockWindow.dispatchEvent({ type: 'keydown', code: 'KeyW', repeat: false });
    expect(player.keysState.forward).toBe(true);
  });
});
