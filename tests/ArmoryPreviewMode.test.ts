
/**
 * ARMORY PREVIEW — the combined knife+gloves LOADOUT mode is REMOVED.
 *
 * The mode type is 'item' only, the LOADOUT toolbar button no longer exists,
 * and setMode must never leave the ITEM view regardless of argument. Item knife
 * / glove isolation, resource lifecycle and the gameplay viewmodel are not
 * touched by these assertions.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('ArmoryPreview — no combined loadout mode', () => {
  const src = readFileSync('src/ui/ArmoryPreview.ts', 'utf8');

  it('declares only the item mode', () => {
    expect(src).toMatch(/export type ArmoryPreviewMode = 'item';/);
    expect(src).not.toMatch(/'item'\s*\|\s*'loadout'/);
  });

  it('has no LOADOUT PREVIEW toolbar button', () => {
    expect(src).not.toContain('LOADOUT PREVIEW');
    expect(src).not.toMatch(/loadoutBtn/);
  });

  it('pins setMode to item even for a legacy loadout request', () => {
    const start = src.indexOf('public setMode(');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('\n  }', start);
    const body = src.slice(start, end);
    expect(body).toMatch(/this\.mode\s*=\s*'item'/);
  });
});
