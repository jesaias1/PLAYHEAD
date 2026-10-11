import type { ArmoryItem } from './ArmoryInventory';
export interface LoadoutPreset { name: string; knifeId: string; gloveId: string }
const KEY = 'playhead.loadouts.v1';
export function readLoadouts(): LoadoutPreset[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(data)) return [];
    return data.filter((p): p is LoadoutPreset => !!p && typeof p === 'object' &&
      typeof p.name === 'string' && p.name.trim().length > 0 && p.name.length <= 32 &&
      typeof p.knifeId === 'string' && p.knifeId.length <= 120 && typeof p.gloveId === 'string' && p.gloveId.length <= 120).slice(0, 10);
  } catch { return []; }
}
export function writeLoadouts(presets: LoadoutPreset[]): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(presets.slice(0, 10))); return true; } catch { return false; }
}
export function validateLoadout(preset: LoadoutPreset, items: ArmoryItem[]): boolean {
  return items.some(i => i.id === preset.knifeId && i.slot === 'karambit' && i.owned) &&
    items.some(i => i.id === preset.gloveId && i.slot === 'gloves' && i.owned);
}
export interface LoadoutActions {
  items(): ArmoryItem[]; current(): Omit<LoadoutPreset, 'name'>;
  equip(knifeId: string, gloveId: string): boolean; refresh(): void;
}
/** Compact shared local preset editor; never grants ownership. */
export function mountLoadouts(host: HTMLElement, actions: LoadoutActions): void {
  const root = document.createElement('div'); root.className = 'loadout-presets';
  root.innerHTML = `<label>LOADOUT <select aria-label="Saved loadout"></select></label><input aria-label="Loadout name" maxlength="32" placeholder="Name…" /><button type="button" data-action="save">SAVE</button><button type="button" data-action="apply">APPLY</button><button type="button" data-action="delete">DELETE</button><span class="loadout-status" role="status"></span>`;
  const select = root.querySelector('select')!, name = root.querySelector('input')!, status = root.querySelector<HTMLElement>('[role="status"]')!;
  const render = (chosen = '') => {
    select.replaceChildren(new Option('Choose preset…', ''));
    readLoadouts().forEach(p => select.add(new Option(p.name, p.name)));
    select.value = chosen;
    for (const action of ['apply', 'delete']) root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.disabled = !select.value;
  };
  select.addEventListener('focus', () => render(select.value));
  select.addEventListener('change', () => { name.value = select.value; status.textContent = ''; render(select.value); });
  root.querySelector('[data-action="save"]')!.addEventListener('click', () => {
    const label = name.value.trim(); if (!label) { status.textContent = 'Enter a name.'; name.focus(); return; }
    const preset = { name: label, ...actions.current() };
    if (!validateLoadout(preset, actions.items())) { status.textContent = 'Equip owned items first.'; return; }
    const presets = readLoadouts(), index = presets.findIndex(p => p.name === label);
    if (index < 0 && presets.length >= 10) { status.textContent = '10 presets maximum. Update or delete one.'; return; }
    if (index >= 0) presets[index] = preset; else presets.push(preset);
    const saved = writeLoadouts(presets); render(saved ? label : ''); status.textContent = saved ? 'Saved on this device.' : 'Storage unavailable. Preset not saved.';
  });
  root.querySelector('[data-action="apply"]')!.addEventListener('click', () => {
    const preset = readLoadouts().find(p => p.name === select.value);
    if (!preset || !validateLoadout(preset, actions.items())) { status.textContent = 'Unavailable: this account must own both items.'; return; }
    status.textContent = actions.equip(preset.knifeId, preset.gloveId) ? 'Loadout equipped.' : 'Could not equip. Current loadout kept.';
    actions.refresh();
  });
  root.querySelector('[data-action="delete"]')!.addEventListener('click', () => {
    const saved = writeLoadouts(readLoadouts().filter(p => p.name !== select.value));
    render(); name.value = ''; status.textContent = saved ? 'Preset removed.' : 'Storage unavailable.';
  });
  root.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') e.stopPropagation(); });
  render(); host.appendChild(root);
}
