import { afterEach, describe, expect, it, vi } from 'vitest';
const preview = vi.hoisted(() => ({ mount: vi.fn(), update: vi.fn(), show: vi.fn(), hide: vi.fn(), dispose: vi.fn() }));
const constructor = vi.hoisted(() => vi.fn());
vi.mock('../src/ui/ArmoryPreview', () => ({ ArmoryPreview: class { constructor() { constructor(); return preview; } } }));
import { LazyArmoryPreview } from '../src/ui/LazyArmoryPreview';
const selection = (id: string) => ({ slot: 'gloves' as const, itemId: id, equippedKnifeId: 'SIGNAL_CYAN', equippedGloveId: 'GLOVE_BASE' });
afterEach(() => vi.clearAllMocks());
describe('on-demand Armory controller', () => {
  it('does not instantiate a preview for hidden panels', () => {
    const lazy = new LazyArmoryPreview();
    lazy.mount({ textContent: '' } as HTMLElement); lazy.update(selection('A')); lazy.hide();
    expect(constructor).not.toHaveBeenCalled();
  });
  it('applies the latest selection after import and stops hidden rendering', async () => {
    const lazy = new LazyArmoryPreview();
    lazy.mount({ textContent: '' } as HTMLElement); lazy.update(selection('A')); lazy.show(); lazy.update(selection('B'));
    await vi.waitFor(() => expect(preview.update).toHaveBeenCalledWith(selection('B')));
    expect(constructor).toHaveBeenCalledTimes(1);
    lazy.hide(); expect(preview.hide).toHaveBeenCalled(); lazy.dispose();
    expect(preview.dispose).toHaveBeenCalledTimes(1);
  });
  it('does not create a late renderer after disposal during import', async () => {
    const lazy = new LazyArmoryPreview();
    lazy.mount({ textContent: '' } as HTMLElement); lazy.update(selection('A')); lazy.show(); lazy.dispose();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(constructor).not.toHaveBeenCalled();
  });
});
