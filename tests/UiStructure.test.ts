/**
 * UI STRUCTURE — global nav + ONLINE sub-nav + ARMORY inventory.
 *
 * Structural and layout guards. These assert the SHAPE of the UI: tab count,
 * sub-navigation, the inventory browsing model, sticky navigation, and the
 * absence of nested scroll traps and eager asset loads.
 *
 * They deliberately do NOT claim good UX. Layout probes cannot prove that an
 * inventory is pleasant to browse; only human testing can.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const screens = read('src/styles/screens.css');
const importScreen = read('src/ui/ImportScreen.ts');
const armoryModal = read('src/ui/ArmoryModal.ts');
const armoryInventory = read('src/ui/ArmoryInventory.ts');

/** Slice a method body out of a source file, stopping at the next member. */
function methodBody(src: string, signature: string, maxLength = 4000): string {
  const start = src.indexOf(signature);
  if (start < 0) return '';
  const rest = src.slice(start);
  const tail = rest.slice(signature.length);
  const next = /\n  (?:\/\*\*|private |public |protected |}\n)/.exec(tail);
  return next ? rest.slice(0, signature.length + next.index) : rest.slice(0, maxLength);
}

// ---------------------------------------------------------------------------
// 1. Top navigation
// ---------------------------------------------------------------------------

describe('Top navigation', () => {
  it('has exactly five top-level tabs', () => {
    const tabs = importScreen.match(/id="tab-btn-[a-z]+"/g) ?? [];
    expect(tabs).toHaveLength(5);
    expect(tabs).toEqual([
      'id="tab-btn-showcase"',
      'id="tab-btn-custom"',
      'id="tab-btn-lab"',
      'id="tab-btn-armory"',
      'id="tab-btn-online"'
    ]);
  });

  it('uses the required labels', () => {
    expect(importScreen).toMatch(/\[ 01 \/\/ SIGNAL PACK \]/);
    expect(importScreen).toMatch(/\[ 02 \/\/ CUSTOM AUDIO \]/);
    expect(importScreen).toMatch(/\[ 03 \/\/ MOVEMENT LAB \]/);
    expect(importScreen).toMatch(/\[ 04 \/\/ ARMORY \]/);
    expect(importScreen).toMatch(/\[ 05 \/\/ ONLINE \]/);
  });

  it('no longer has RACE or LEADERBOARD as top-level tabs', () => {
    expect(importScreen).not.toMatch(/id="tab-btn-race"/);
    expect(importScreen).not.toMatch(/id="tab-btn-leaderboard"/);
  });

  it('drives exactly five panels from switchModule', () => {
    const fn = methodBody(importScreen, 'private switchModule(', 900);
    expect(fn).toMatch(/const tabs = \[[^\]]*tabOnlineBtn\s*\]/);
    expect(fn).not.toMatch(/tabRaceBtn|tabLeaderboardBtn/);
    expect(fn).toMatch(/#panel-online/);
  });
});

// ---------------------------------------------------------------------------
// 2. Sticky global navigation
// ---------------------------------------------------------------------------

describe('Sticky global navigation', () => {
  it('is position: sticky at the top of the scroll owner', () => {
    const rule = (screens.match(/\.import-tabs\s*\{[^}]*\}/) ?? [])[0] ?? '';
    expect(rule).toMatch(/position:\s*sticky/);
    expect(rule).toMatch(/top:\s*0/);
    expect(rule).toMatch(/z-index:\s*\d+/);
  });

  it('has an opaque PLAYHEAD background so content cannot show through', () => {
    const rule = (screens.match(/\.import-tabs\s*\{[^}]*\}/) ?? [])[0] ?? '';
    expect(rule).toMatch(/background:/);
    // The tab buttons must not punch through the sticky background.
    const btn = (screens.match(/\.import-tab-btn\s*\{[^}]*\}/) ?? [])[0] ?? '';
    const margin = /margin-bottom:\s*(-?\d+)px/.exec(btn);
    expect(margin).toBeTruthy();
    expect(Number(margin![1])).toBeGreaterThanOrEqual(-1);
  });

  it('the nav lives inside the single scroll owner, not a nested box', () => {
    // `.screen` is the one scroll container in this overlay app.
    const screenRule = (screens.match(/^\.screen\s*\{[^}]*\}/m) ?? [])[0] ?? '';
    expect(screenRule).toMatch(/overflow-y:\s*auto/);
    // And the nav is not wrapped in its own overflow box.
    const tabsIndex = importScreen.indexOf('class="import-tabs');
    const before = importScreen.slice(Math.max(0, tabsIndex - 400), tabsIndex);
    expect(before).not.toMatch(/overflow/i);
  });
});

// ---------------------------------------------------------------------------
// 3. ONLINE sub-navigation
// ---------------------------------------------------------------------------

describe('Online section', () => {
  it('contains an internal RACE / LEADERBOARD segmented control', () => {
    expect(importScreen).toMatch(/class="online-subnav"/);
    expect(importScreen).toMatch(/id="online-subnav-race"[^>]*>\[ RACE \]/);
    expect(importScreen).toMatch(/id="online-subnav-leaderboard"[^>]*>\[ LEADERBOARD \]/);
  });

  it('mounts both live panels inside the ONLINE panel', () => {
    const online = importScreen.slice(
      importScreen.indexOf('id="panel-online"'),
      importScreen.indexOf('id="panel-online"') + 900
    );
    expect(online).toMatch(/id="race-panel-host"/);
    expect(online).toMatch(/id="leaderboard-panel-host"/);
  });

  it('switches sections without destroying either panel', () => {
    const fn = methodBody(importScreen, 'public switchOnlineSection(', 900);
    expect(fn).toMatch(/classList\.toggle\('hidden'/);
    expect(fn).not.toMatch(/innerHTML|removeChild|appendChild/);
    expect(fn).toMatch(/raceHostElem\.classList\.toggle\('hidden', !race\)/);
    expect(fn).toMatch(/leaderboardHostElem\.classList\.toggle\('hidden', race\)/);
  });

  it('the leaderboard host ships hidden and the race host ships visible', () => {
    expect(importScreen).toMatch(/id="race-panel-host"><\/div>/);
    expect(importScreen).toMatch(/id="leaderboard-panel-host" class="hidden"><\/div>/);
  });

  it('un-hides the mounted panels, since the hosts now own visibility', () => {
    expect(importScreen).toMatch(/this\.racePanel\.element\.classList\.remove\('hidden'\)/);
    expect(importScreen).toMatch(/this\.leaderboardPanel\.element\.classList\.remove\('hidden'\)/);
    expect(read('src/ui/RacePanel.ts')).toMatch(/race-panel hidden/);
    expect(read('src/ui/LeaderboardPanel.ts')).toMatch(/leaderboard-panel hidden/);
  });

  it('opening RACE or LEADERBOARD lands on the ONLINE tab with the right section', () => {
    const race = methodBody(importScreen, 'public openRaceTab(', 220);
    expect(race).toMatch(/switchModule\(4\)/);
    expect(race).toMatch(/switchOnlineSection\('race'\)/);
    const lb = methodBody(importScreen, 'public openLeaderboardTab(', 220);
    expect(lb).toMatch(/switchModule\(4\)/);
    expect(lb).toMatch(/switchOnlineSection\('leaderboard'\)/);
  });

  it('still notifies the leaderboard when its section opens', () => {
    expect(methodBody(importScreen, 'public switchOnlineSection(', 900)).toMatch(
      /onLeaderboardTabOpened/
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Armory: compact header + one slot browser
// ---------------------------------------------------------------------------

describe('Armory header', () => {
  it('is compact and states the current loadout', () => {
    expect(importScreen).toMatch(/class="armory-header"/);
    expect(importScreen).toMatch(/id="armory-equipped-knife"/);
    expect(importScreen).toMatch(/id="armory-equipped-glove"/);
    const fn = methodBody(importScreen, 'public renderArmoryHeader(', 1300);
    expect(fn).toMatch(/getEquippedSkinId/);
    expect(fn).toMatch(/getEquippedGloveId/);
    // The glove family is stated so mastery and drop can never blur.
    expect(fn).toMatch(/isDropGloveId/);
    expect(fn).toMatch(/DROP/);
    expect(fn).toMatch(/MASTERY/);
  });

  it('shows signal drops compactly with a DECRYPT trigger', () => {
    expect(importScreen).toMatch(/class="armory-drops"/);
    expect(importScreen).toMatch(/SIGNAL DROPS \/\/ <b id="decoder-pending">/);
    expect(importScreen).toMatch(/id="btn-decode-signal"[^>]*>\[ DECRYPT \]/);
  });

  it('the header never embeds the decoder experience itself', () => {
    const header = importScreen.slice(
      importScreen.indexOf('class="armory-header"'),
      importScreen.indexOf('class="armory-decoder-line"')
    );
    expect(header).not.toMatch(/decoder-quality-grid/);
    expect(header).not.toMatch(/<section/);
  });
});

describe('Armory slot navigation', () => {
  it('browses exactly two equipment slots', () => {
    const slots = importScreen.match(/data-armory-slot="([a-z]+)"/g) ?? [];
    expect(slots).toEqual(['data-armory-slot="karambit"', 'data-armory-slot="gloves"']);
    expect(importScreen).toMatch(/\[ KARAMBIT \]/);
    expect(importScreen).toMatch(/\[ GLOVES \]/);
  });

  it('the glove slot carries a family filter, and only the glove slot', () => {
    const families = importScreen.match(/data-glove-family="([a-z]+)"/g) ?? [];
    expect(families).toEqual([
      'data-glove-family="all"',
      'data-glove-family="drop"',
      'data-glove-family="mastery"'
    ]);
    expect(importScreen).toMatch(/id="armory-glove-filters"/);
    // Hidden for knives: knives have no second acquisition family.
    const fn = methodBody(importScreen, 'private renderArmoryChrome(', 900);
    expect(fn).toMatch(/armoryGloveFilterGroup\.classList\.toggle\('hidden', this\.armorySlot !== 'gloves'\)/);
  });

  it('offers ALL / OWNED / LOCKED and a restrained sort', () => {
    const owned = importScreen.match(/data-owned-filter="([a-z]+)"/g) ?? [];
    expect(owned).toEqual([
      'data-owned-filter="all"',
      'data-owned-filter="owned"',
      'data-owned-filter="locked"'
    ]);
    const sorts = importScreen.match(/data-armory-sort="([a-z]+)"/g) ?? [];
    expect(sorts).toEqual(['data-armory-sort="rarity"', 'data-armory-sort="name"']);
  });

  it('switching a slot re-renders the inventory instead of stacking sections', () => {
    const fn = methodBody(importScreen, 'public switchArmorySlot(', 300);
    expect(fn).toMatch(/this\.armorySlot = slot/);
    expect(fn).toMatch(/renderArmory\(\)/);
    // There is no longer any per-family section markup.
    expect(importScreen).not.toMatch(/data-armory-section/);
    expect(importScreen).not.toMatch(/data-armory-panel/);
  });
});

// ---------------------------------------------------------------------------
// 5. Armory: inventory tiles vs the single detail panel
// ---------------------------------------------------------------------------

describe('Inventory tiles', () => {
  it('render the inventory as one grid with a single detail panel', () => {
    expect(importScreen).toMatch(/id="armory-inventory"[^>]*class="armory-inventory"/);
    expect(importScreen).toMatch(/class="armory-detail" id="armory-detail"/);
    expect(importScreen).not.toMatch(/id="armory-skins-grid"/);
    expect(importScreen).not.toMatch(/id="drop-gloves-grid"/);
    expect(importScreen).not.toMatch(/id="mastery-gloves-grid"/);
  });

  it('a tile carries only name, rarity and an ownership marker', () => {
    const fn = methodBody(importScreen, 'private buildArmoryTile(', 2200);
    expect(fn).toMatch(/armory-tile-name/);
    expect(fn).toMatch(/armory-tile-rarity/);
    expect(fn).toMatch(/armory-tile-mark/);
    // The repeated copy that made the old card wall unusable is gone: no
    // description, no source line, no requirement, no per-tile actions.
    expect(fn).not.toMatch(/item\.description/);
    expect(fn).not.toMatch(/item\.requirement/);
    expect(fn).not.toMatch(/SOURCE/);
    expect(fn).not.toMatch(/\[ EQUIP \]/);
    expect(fn).not.toMatch(/\[ PREVIEW \]/);
    expect(fn).not.toMatch(/armory-action-btn/);
  });

  it('a tile loads no cosmetic asset of any kind', () => {
    const fn = methodBody(importScreen, 'private buildArmoryTile(', 2200);
    expect(fn).not.toMatch(/texturePath/);
    expect(fn).not.toMatch(/createElement\('img'\)/);
    expect(fn).not.toMatch(/new Image/);
    expect(fn).not.toMatch(/Video/);
    expect(fn).not.toMatch(/decode/);
    expect(fn).not.toMatch(/preview/i);
  });

  it('the grid is dense: many tiles per row at laptop and desktop widths', () => {
    const rule = (screens.match(/\.armory-inventory\s*\{[^}]*\}/) ?? [])[0] ?? '';
    expect(rule).toMatch(/display:\s*grid/);
    const min = /minmax\((\d+)px,\s*1fr\)/.exec(rule);
    expect(min).toBeTruthy();
    // 140px tiles put 5-7 per row on a 1240px console.
    expect(Number(min![1])).toBeLessThanOrEqual(150);
    expect(Number(min![1])).toBeGreaterThanOrEqual(110);
  });

  it('no horizontal overflow: tiles shrink rather than force a scrollbar', () => {
    const rule = (screens.match(/\.armory-inventory\s*\{[^}]*\}/) ?? [])[0] ?? '';
    expect(rule).not.toMatch(/minmax\((?!\d)/);
    expect(rule).toMatch(/minmax\(\d+px,\s*1fr\)/);
  });
});

describe('Selected item detail panel', () => {
  it('owns the long copy exactly once', () => {
    const fn = methodBody(importScreen, 'private renderArmoryDetail(', 2400);
    expect(fn).toMatch(/item\.description/);
    expect(fn).toMatch(/SOURCE/);
    expect(fn).toMatch(/REQUIREMENT/);
    expect(fn).toMatch(/PROGRESS/);
    expect(fn).toMatch(/armory-detail-actions/);
  });

  it('shows the mastery requirement and progress for mastery gloves', () => {
    // Requirement + progress come from the ladder, carried on the item.
    expect(armoryInventory).toMatch(/requirement: d\.requirementLabel/);
    expect(armoryInventory).toMatch(/progress: status\.progressLabel/);
    expect(armoryInventory).toMatch(/source: 'MASTERY'/);
  });

  it('shows the drop source for signal drop gloves', () => {
    expect(armoryInventory).toMatch(/source: 'SIGNAL DROP'/);
    expect(armoryInventory).toMatch(/requirement: 'SIGNAL DROP \/\/ RANDOM REWARD'/);
  });

  it('offers EQUIP and never a fake action on a locked knife', () => {
    const fn = methodBody(importScreen, 'private renderArmoryDetailActions(', 2400);
    expect(fn).toMatch(/isEquippable\(item\)/);
    expect(fn).toMatch(/\[ EQUIP \]/);
    expect(fn).toMatch(/item\.family === 'karambit'/);
    expect(fn).toMatch(/LOCKED \/\/ COMPLETE TO UNLOCK/);
    // Locked gloves keep the pre-existing preview affordance.
    expect(fn).toMatch(/\[ PREVIEW \]/);
    expect(fn).toMatch(/setDevPreview/);
  });

  it('is sticky below the global nav on wide screens', () => {
    const rule = (screens.match(/\.armory-detail\s*\{[^}]*\}/) ?? [])[0] ?? '';
    expect(rule).toMatch(/position:\s*sticky/);
    expect(rule).toMatch(/top:\s*\d+px/);
  });

  it('stops being a squeezed side panel on narrow screens', () => {
    expect(screens).toMatch(
      /@media \(max-width: 1080px\)\s*\{[\s\S]*?\.armory-detail\s*\{[^}]*position:\s*static/
    );
    expect(screens).toMatch(
      /@media \(max-width: 1080px\)\s*\{[\s\S]*?\.armory-body\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Decoder integration
// ---------------------------------------------------------------------------

describe('Decoder integration', () => {
  it('is a single compact state line, not permanent vertical real estate', () => {
    expect(importScreen).toMatch(/class="armory-decoder-line"/);
    expect(importScreen).not.toMatch(/armory-decoder-strip/);
    expect(importScreen).not.toMatch(/decoder-quality-grid/);
    const rule = (screens.match(/\.armory-decoder-line\s*\{[^}]*\}/) ?? [])[0] ?? '';
    expect(rule).toMatch(/display:\s*flex/);
  });

  it('keeps every decoder control and id intact', () => {
    for (const id of ['decoder-status', 'decoder-detail', 'decoder-pending', 'btn-decode-signal']) {
      expect(importScreen, id).toContain(`id="${id}"`);
    }
  });

  it('opens the existing decoder from the compact trigger', () => {
    expect(importScreen).toMatch(/this\.decoderButton\.addEventListener\('click'/);
    expect(importScreen).toMatch(/this\.decodeModal\.open\(\(\) => this\.renderArmory\(\)\)/);
    // Decoder award logic is untouched.
    expect(read('src/ui/SignalDecodeModal.ts')).toMatch(/this\.skinSystem\.openSignalDrop\(\)/);
  });

  it('offers VIEW IN ARMORY after a reveal', () => {
    expect(importScreen).toMatch(/id="btn-armory-view-reward"/);
    const fn = methodBody(importScreen, 'public viewDecoderRewardInArmory(', 900);
    expect(fn).toMatch(/this\.armorySlot = item\.slot/);
    expect(fn).toMatch(/this\.armorySelectedId = item\.id/);
  });
});

// ---------------------------------------------------------------------------
// 7. Mastery status placement
// ---------------------------------------------------------------------------

describe('Mastery status', () => {
  it('appears only while browsing mastery gloves', () => {
    const fn = methodBody(importScreen, 'private renderArmoryMasteryStatus(', 900);
    expect(fn).toMatch(/this\.armorySlot === 'gloves' && this\.armoryGloveFamily === 'mastery'/);
    expect(fn).toMatch(/classList\.toggle\('hidden', !show\)/);
  });

  it('is compact, not a full breakdown table', () => {
    const fn = methodBody(importScreen, 'private renderArmoryMasteryStatus(', 900);
    expect(fn).toMatch(/GOLD\+/);
    expect(fn).toMatch(/DIAMOND/);
    // The old five-row summary table is gone.
    expect(importScreen).not.toMatch(/mastery-summary-row/);
  });
});

// ---------------------------------------------------------------------------
// 8. No nested scroll traps
// ---------------------------------------------------------------------------

describe('Scrolling model', () => {
  it('the inventory grid has no inner scroll box', () => {
    const rules = screens.match(/\.armory-inventory[^{]*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule, rule).not.toMatch(/max-height/);
      expect(rule, rule).not.toMatch(/overflow-y/);
    }
  });

  it('the armory page scrolls with the document, not a nested pane', () => {
    expect(screens).not.toMatch(/\.armory-body\s*\{[^}]*overflow-y/);
    expect(screens).not.toMatch(/\.armory-inventory-pane/);
  });

  it('the pause-screen armory keeps one dialog scroll owner', () => {
    const rule = (screens.match(/\.armory-modal-console\s*\{[^}]*\}/) ?? [])[0] ?? '';
    expect(rule).toMatch(/overflow-y:\s*auto/);
  });
});

// ---------------------------------------------------------------------------
// 9. Nothing functional was removed
// ---------------------------------------------------------------------------

describe('No functionality lost', () => {
  it('the online panels and their modules are untouched', () => {
    expect(importScreen).toMatch(/appendChild\(this\.racePanel\.element\)/);
    expect(importScreen).toMatch(/appendChild\(this\.leaderboardPanel\.element\)/);
  });

  it('all five panels still exist', () => {
    for (const id of ['panel-showcase', 'panel-custom', 'panel-lab', 'panel-armory', 'panel-online']) {
      expect(importScreen, id).toContain(`id="${id}"`);
    }
  });

  it('the armory dev toggles are preserved', () => {
    expect(importScreen).toMatch(/id="btn-armory-dev-toggle"/);
    expect(importScreen).toMatch(/id="btn-mastery-dev-preview"/);
    expect(armoryModal).toMatch(/id="btn-armory-modal-dev-toggle"/);
  });

  it('the global footer status indicator is still the only one', () => {
    expect(importScreen).toMatch(/footer\.appendChild\(this\.onlineStatusBar\.element\)/);
    expect((importScreen.match(/onlineStatusBar\.element/g) ?? []).length).toBe(1);
  });

  it('the pause-screen armory keeps its public API and close control', () => {
    for (const member of ['public show(', 'public hide(', 'public isVisible(', 'setOnClose(', 'setDecodeModal(']) {
      expect(armoryModal, member).toContain(member);
    }
    expect(armoryModal).toMatch(/id="btn-armory-modal-close"/);
    expect(armoryModal).toMatch(/id="btn-armory-open-drop"/);
    expect(armoryModal).toMatch(/id="armory-drop-count"/);
  });

  it('the pause-screen armory uses the same inventory model', () => {
    expect(armoryModal).toMatch(/from '\.\/ArmoryInventory'/);
    expect(armoryModal).toMatch(/filterArmoryItems\(/);
    expect(armoryModal).toMatch(/class="armory-tile/);
  });

  it('the wide inventory console is applied only to the Armory tab', () => {
    const fn = methodBody(importScreen, 'private switchModule(', 1200);
    expect(fn).toMatch(/import-container--inventory', activeIndex === 3/);
  });

  it('every cosmetic id still reaches the inventory', () => {
    // The model reads the real catalogs rather than a hand-maintained list.
    expect(armoryInventory).toMatch(/skins: readonly KarambitSkin\[\]/);
    expect(armoryInventory).toMatch(/dropGloves: readonly DropGlove\[\]/);
    expect(armoryInventory).toMatch(/masteryGloves: readonly MasteryGloveStatus\[\]/);
    expect(importScreen).toMatch(/skins: this\.skinSystem\.getSkins\(\)/);
    expect(importScreen).toMatch(/dropGloves: DROP_GLOVES/);
    expect(importScreen).toMatch(/masteryGloves: masteryGloveSystem\.evaluate\(\)\.gloves/);
  });
});
