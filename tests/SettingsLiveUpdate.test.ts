import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../src/core/Game';
import { SettingsManager } from '../src/core/Settings';

function createLocalStorageMock(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, String(value)); }
  };
}

describe('live settings propagation', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createLocalStorageMock(),
      configurable: true,
      writable: true
    });
    (SettingsManager as any).instance = undefined;
  });

  it('persists once, reports exact changed keys, and supports unsubscribe', () => {
    const manager = SettingsManager.getInstance();
    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);

    manager.update({ mouseSensitivity: 1.8, fov: 94 });

    expect(listener).toHaveBeenCalledTimes(1);
    const [settings, changedKeys] = listener.mock.calls[0];
    expect(settings.mouseSensitivity).toBe(1.8);
    expect(settings.fov).toBe(94);
    expect([...changedKeys]).toEqual(['mouseSensitivity', 'fov']);
    expect(JSON.parse(localStorage.getItem('trackrun_settings')!)).toMatchObject({
      mouseSensitivity: 1.8,
      fov: 94
    });

    manager.update({ mouseSensitivity: 1.8 });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    manager.update({ mouseSensitivity: 2.1 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('pushes stale runtime settings to their active consumers immediately', () => {
    const cameraController = { setSensitivity: vi.fn() };
    const environment = { setBaseFov: vi.fn(), applyQualityTier: vi.fn() };
    const audioEngine = { setVolume: vi.fn() };
    const ghostManager = { applySettingsVisibility: vi.fn() };
    const game = Object.assign(Object.create(Game.prototype), {
      cameraController,
      environment,
      audioEngine,
      ghostManager
    }) as any;

    const manager = SettingsManager.getInstance();
    manager.subscribe((settings, changedKeys) => game.applyLiveSettings(settings, changedKeys));
    manager.update({
      mouseSensitivity: 2.2,
      fov: 101,
      masterVolume: 0.35,
      graphics: 'LOW',
      ghostMode: 'OFF'
    });

    expect(cameraController.setSensitivity).toHaveBeenCalledWith(2.2);
    expect(environment.setBaseFov).toHaveBeenCalledWith(101);
    expect(audioEngine.setVolume).toHaveBeenCalledWith(0.35);
    expect(environment.applyQualityTier).toHaveBeenCalledWith('LOW', false);
    expect(ghostManager.applySettingsVisibility).toHaveBeenCalledTimes(1);
  });

  it('reloads the authoritative persisted values in a new manager instance', () => {
    const manager = SettingsManager.getInstance();
    manager.update({ mouseSensitivity: 1.7, masterVolume: 0.45, viewmodelFov: 73 });

    (SettingsManager as any).instance = undefined;
    const reloaded = SettingsManager.getInstance();
    expect(reloaded.settings).toMatchObject({
      mouseSensitivity: 1.7,
      masterVolume: 0.45,
      viewmodelFov: 73
    });
  });
});
