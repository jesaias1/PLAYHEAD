/**
 * ArmoryPreview resource ownership — the isolated preview instance must never
 * disturb gameplay/replay cosmetic resources, and must bound its own.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { KarambitSkinSystem } from '../src/viewmodel/KarambitSkinSystem';
import { KarambitCosmicMaterial } from '../src/viewmodel/KarambitCosmicShader';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('KarambitSkinSystem preview instance', () => {
  it('does not read or write gameplay persistence', () => {
    const getItem = vi.fn(() => null);
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem, setItem });

    const preview = KarambitSkinSystem.createPreviewInstance();
    preview.setPreviewSkin('ASTRAL');
    preview.equipSkin('ASTRAL');

    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    preview.dispose();
  });

  it('is a distinct instance from the gameplay singleton', () => {
    const preview = KarambitSkinSystem.createPreviewInstance();
    expect(preview).not.toBe(KarambitSkinSystem.getInstance());
    preview.dispose();
  });

  it('resolves unknown preview ids to a safe canonical skin', () => {
    const preview = KarambitSkinSystem.createPreviewInstance();
    preview.setPreviewSkin('NOT_A_REAL_SKIN');
    expect(preview.getPreviewSkinId()).toBe('SIGNAL_CYAN');
    expect(preview.getActiveRenderSkinId()).toBe('SIGNAL_CYAN');
    preview.dispose();
  });

  it('applies the preview skin to a material without touching the equipped skin', () => {
    const preview = KarambitSkinSystem.createPreviewInstance();
    const material = new KarambitCosmicMaterial();
    const before = KarambitSkinSystem.getInstance().getEquippedSkinId();
    preview.setPreviewSkin('ASTRAL');
    preview.applyToMaterial(material);
    expect(preview.getActiveRenderSkinId()).toBe('ASTRAL');
    expect(KarambitSkinSystem.getInstance().getEquippedSkinId()).toBe(before);
    material.dispose();
    preview.dispose();
  });

  it('dispose releases only its own video/static resources', () => {
    const preview = KarambitSkinSystem.createPreviewInstance();
    preview.setPreviewSkin('SIGNAL_CYAN');
    preview.dispose();
    // Gameplay singleton remains functional after a preview dispose.
    expect(KarambitSkinSystem.getInstance().getEquippedSkinId()).toBeTruthy();
  });
});
