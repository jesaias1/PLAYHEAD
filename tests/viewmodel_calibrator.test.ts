import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { ViewmodelController } from '../src/viewmodel/ViewmodelController';
import { ViewmodelCalibrator, DEFAULT_KNIFE_CALIBRATION, CALIBRATION_STORAGE_KEY } from '../src/viewmodel/ViewmodelCalibrator';

describe('Viewmodel Calibration Tool (F4)', () => {
  let vm: ViewmodelController;
  let calibrator: ViewmodelCalibrator;
  let fakeDom: HTMLElement;
  const storageMap = new Map<string, string>();

  beforeEach(() => {
    storageMap.clear();
    const mockStorage = {
      getItem: (k: string) => storageMap.get(k) || null,
      setItem: (k: string, v: string) => storageMap.set(k, String(v)),
      removeItem: (k: string) => storageMap.delete(k),
      clear: () => storageMap.clear()
    };
    (globalThis as any).localStorage = mockStorage;

    vm = new ViewmodelController();
    fakeDom = {
      style: {} as any,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
      ownerDocument: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }
    } as unknown as HTMLElement;

    calibrator = new ViewmodelCalibrator(vm, fakeDom);
  });

  it('initializes in inactive state with default socket transform', () => {
    expect(calibrator.isActive).toBe(false);
    expect(vm.knifeSocketPos.x).toBeCloseTo(DEFAULT_KNIFE_CALIBRATION.position[0], 4);
    expect(vm.knifeSocketPos.y).toBeCloseTo(DEFAULT_KNIFE_CALIBRATION.position[1], 4);
    expect(vm.knifeSocketPos.z).toBeCloseTo(DEFAULT_KNIFE_CALIBRATION.position[2], 4);
    expect(vm.knifeSocketScale.x).toBeCloseTo(DEFAULT_KNIFE_CALIBRATION.scale, 3);
  });

  it('toggles calibration mode on and off via toggle()', () => {
    let activated = false;
    let deactivated = false;

    const cbCalibrator = new ViewmodelCalibrator(
      vm,
      fakeDom,
      () => { activated = true; },
      () => { deactivated = true; }
    );

    // 1. Activate
    cbCalibrator.toggle();
    expect(cbCalibrator.isActive).toBe(true);
    expect(activated).toBe(true);

    // 2. Deactivate
    cbCalibrator.toggle();
    expect(cbCalibrator.isActive).toBe(false);
    expect(deactivated).toBe(true);
  });

  it('switches between translate, rotate, and scale modes', () => {
    calibrator.activate();

    calibrator.setMode('translate');
    expect(calibrator['currentMode']).toBe('translate');

    calibrator.setMode('rotate');
    expect(calibrator['currentMode']).toBe('rotate');

    calibrator.setMode('scale');
    expect(calibrator['currentMode']).toBe('scale');

    calibrator.deactivate();
  });

  it('switches between local and world transform space', () => {
    calibrator.activate();
    expect(calibrator['currentSpace']).toBe('local');

    calibrator.toggleSpace();
    expect(calibrator['currentSpace']).toBe('world');

    calibrator.toggleSpace();
    expect(calibrator['currentSpace']).toBe('local');

    calibrator.deactivate();
  });

  it('freezes viewmodel in pristine knife idle pose without movement drift', () => {
    // Modify sway and compression offsets
    vm['swayPos'].set(0.05, -0.03, 0.02);
    vm['compressionY'] = -0.02;

    // Call updateCalibrationPose
    vm.updateCalibrationPose();

    expect(vm['swayPos'].x).toBe(0);
    expect(vm['swayPos'].y).toBe(0);
    expect(vm['swayPos'].z).toBe(0);
    expect(vm['compressionY']).toBe(0);
    expect(vm['motionGroup'].position.y).toBe(0);
  });

  it('saves calibration to localStorage and loads it across sessions', () => {
    // Adjust transform
    vm.knifeSocketPos.set(-0.025, 0.040, -0.075);
    vm.knifeSocketRot.set(-0.5, 0.3, -0.2);
    vm.knifeSocketScale.set(0.92, 0.92, 0.92);

    calibrator.saveLocal();

    // Verify localStorage item
    const savedRaw = localStorage.getItem(CALIBRATION_STORAGE_KEY);
    expect(savedRaw).toBeDefined();
    const saved = JSON.parse(savedRaw!);
    expect(saved.position[0]).toBeCloseTo(-0.025, 4);
    expect(saved.position[1]).toBeCloseTo(0.040, 4);
    expect(saved.position[2]).toBeCloseTo(-0.075, 4);
    expect(saved.scale).toBeCloseTo(0.92, 2);

    // Create a new ViewmodelController and verify it loads the saved calibration
    const newVm = new ViewmodelController();
    expect(newVm.knifeSocketPos.x).toBeCloseTo(-0.025, 4);
    expect(newVm.knifeSocketPos.y).toBeCloseTo(0.040, 4);
    expect(newVm.knifeSocketPos.z).toBeCloseTo(-0.075, 4);
    expect(newVm.knifeSocketScale.x).toBeCloseTo(0.92, 2);

    newVm.dispose();
  });

  it('resets calibration to hardcoded default and removes localStorage item', () => {
    // Save modified values
    vm.knifeSocketPos.set(0.1, 0.2, 0.3);
    calibrator.saveLocal();
    expect(localStorage.getItem(CALIBRATION_STORAGE_KEY)).not.toBeNull();

    // Reset
    calibrator.resetToDefault();
    expect(localStorage.getItem(CALIBRATION_STORAGE_KEY)).toBeNull();
    expect(vm.knifeSocketPos.x).toBeCloseTo(DEFAULT_KNIFE_CALIBRATION.position[0], 4);
    expect(vm.knifeSocketPos.y).toBeCloseTo(DEFAULT_KNIFE_CALIBRATION.position[1], 4);
    expect(vm.knifeSocketPos.z).toBeCloseTo(DEFAULT_KNIFE_CALIBRATION.position[2], 4);
    expect(vm.knifeSocketScale.x).toBeCloseTo(DEFAULT_KNIFE_CALIBRATION.scale, 3);
  });
});
