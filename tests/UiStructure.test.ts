/**
 * UI STRUCTURE — top nav simplification + responsive armory.
 *
 * Structural and responsive-layout guards. These assert the SHAPE of the UI, not
 * its pixels: tab count, sub-navigation, mutually exclusive sections, and the
 * explicit responsive breakpoints that make the Armory usable on a laptop at
 * 100% zoom.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const screens = read('src/styles/screens.css');
const importScreen = read('src/ui/ImportScreen.ts');

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
    expect(importScreen).not.toMatch(/\[\s*0[56]\s*\/\/\s*RACE\s*\]/);
    expect(importScreen).not.toMatch(/\[\s*0[56]\s*\/\/\s*LEADERBOARD\s*\]/);
  });

  it('drives exactly five panels from switchModule', () => {
    const fn = importScreen.slice(
      importScreen.indexOf('private switchModule('),
      importScreen.indexOf('private switchModule(') + 900
    );
    expect(fn).toMatch(/const tabs = \[[^\]]*tabOnlineBtn\s*\]/);
    expect(fn).not.toMatch(/tabRaceBtn|tabLeaderboardBtn/);
    expect(fn).toMatch(/#panel-online/);
  });
});

// ---------------------------------------------------------------------------
// 2. ONLINE sub-navigation
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
    const fn = importScreen.slice(
      importScreen.indexOf('public switchOnlineSection('),
      importScreen.indexOf('public switchOnlineSection(') + 900
    );
    // Toggles visibility; never re-creates or removes a panel.
    expect(fn).toMatch(/classList\.toggle\('hidden'/);
    expect(fn).not.toMatch(/innerHTML|removeChild|appendChild/);
    // It toggles the HOST slots (not the mounted panels), so online state
    // survives switching back and forth.
    expect(fn).toMatch(/raceHostElem\.classList\.toggle\('hidden', !race\)/);
    expect(fn).toMatch(/leaderboardHostElem\.classList\.toggle\('hidden', race\)/);
  });

  it('the leaderboard host ships hidden and the race host ships visible', () => {
    // Guards the regression where the leaderboard could never be revealed.
    expect(importScreen).toMatch(/id="race-panel-host"><\/div>/);
    expect(importScreen).toMatch(/id="leaderboard-panel-host" class="hidden"><\/div>/);
  });

  it('un-hides the mounted panels, since the hosts now own visibility', () => {
    // Both panels ship `hidden` from their own constructors (they used to be
    // top-level tabs). If nobody removes it, the section renders empty.
    expect(importScreen).toMatch(/this\.racePanel\.element\.classList\.remove\('hidden'\)/);
    expect(importScreen).toMatch(/this\.leaderboardPanel\.element\.classList\.remove\('hidden'\)/);
    const race = read('src/ui/RacePanel.ts');
    const lb = read('src/ui/LeaderboardPanel.ts');
    expect(race).toMatch(/race-panel hidden/);
    expect(lb).toMatch(/leaderboard-panel hidden/);
  });

  it('opening RACE or LEADERBOARD lands on the ONLINE tab with the right section', () => {
    const race = importScreen.slice(
      importScreen.indexOf('public openRaceTab('),
      importScreen.indexOf('public openRaceTab(') + 200
    );
    expect(race).toMatch(/switchModule\(4\)/);
    expect(race).toMatch(/switchOnlineSection\('race'\)/);

    const lb = importScreen.slice(
      importScreen.indexOf('public openLeaderboardTab('),
      importScreen.indexOf('public openLeaderboardTab(') + 200
    );
    expect(lb).toMatch(/switchModule\(4\)/);
    expect(lb).toMatch(/switchOnlineSection\('leaderboard'\)/);
  });

  it('still notifies the leaderboard when its section opens', () => {
    const fn = importScreen.slice(
      importScreen.indexOf('public switchOnlineSection('),
      importScreen.indexOf('public switchOnlineSection(') + 900
    );
    expect(fn).toMatch(/onLeaderboardTabOpened/);
  });
});

// ---------------------------------------------------------------------------
// 3. Armory structure
// ---------------------------------------------------------------------------

describe('Armory structure', () => {
  it('has a compact header showing equipped knife and glove', () => {
    expect(importScreen).toMatch(/class="armory-header"/);
    expect(importScreen).toMatch(/id="armory-equipped-knife"/);
    expect(importScreen).toMatch(/id="armory-equipped-glove"/);
    const fn = importScreen.slice(
      importScreen.indexOf('public renderArmoryHeader('),
      importScreen.indexOf('public renderArmoryHeader(') + 1200
    );
    expect(fn).toMatch(/getEquippedSkinId/);
    expect(fn).toMatch(/getEquippedGloveId/);
    // And it distinguishes the glove families honestly.
    expect(fn).toMatch(/isDropGloveId/);
  });

  it('has a KNIVES / DROP GLOVES / MASTERY GLOVES sub-nav', () => {
    const btns = importScreen.match(/data-armory-section="([a-z]+)"/g) ?? [];
    expect(btns).toEqual([
      'data-armory-section="knives"',
      'data-armory-section="drops"',
      'data-armory-section="mastery"'
    ]);
    expect(importScreen).toMatch(/\[ KNIVES \]/);
    expect(importScreen).toMatch(/\[ DROP GLOVES \]/);
    expect(importScreen).toMatch(/\[ MASTERY GLOVES \]/);
  });

  it('shows ONE section at a time, with knives as the default', () => {
    const panels = importScreen.match(/<div class="[^"]*" data-armory-panel="[a-z]+">/g) ?? [];
    expect(panels).toHaveLength(3);
    // Only the first section is un-hidden in the shipped markup.
    const hidden = panels.filter((p) => p.includes('hidden'));
    expect(hidden).toHaveLength(2);
    expect(panels[0]).not.toContain('hidden');
    expect(panels[0]).toContain('knives');
  });

  it('switching sections toggles visibility and never rebuilds the page', () => {
    const fn = importScreen.slice(
      importScreen.indexOf('public switchArmorySection('),
      importScreen.indexOf('public switchArmorySection(') + 900
    );
    expect(fn).toMatch(/classList\.toggle\('hidden'/);
    expect(fn).not.toMatch(/innerHTML|removeChild/);
  });

  it('keeps every cosmetic grid and its render path', () => {
    expect(importScreen).toMatch(/id="armory-skins-grid"/);
    expect(importScreen).toMatch(/id="drop-gloves-grid"/);
    expect(importScreen).toMatch(/id="mastery-gloves-grid"/);
    expect(importScreen).toMatch(/renderDropGloves\(\)/);
    expect(importScreen).toMatch(/renderMasteryGloves\(\)/);
    expect(importScreen).toMatch(/renderMasterySummary\(\)/);
  });

  it('labels the two glove families as separate sources', () => {
    expect(importScreen).toMatch(/SOURCE \/\/ SIGNAL DROP/);
    expect(importScreen).toMatch(/SOURCE \/\/ MASTERY/);
    expect(importScreen).toMatch(/SIGNAL DROPS \/\/ RANDOM REWARDS/);
    expect(importScreen).toMatch(/MASTERY \/\/ EARNED ACHIEVEMENTS/);
  });

  it('the mastery summary sits inside the mastery section, not above everything', () => {
    const masteryPanel = importScreen.slice(
      importScreen.indexOf('data-armory-panel="mastery"'),
      importScreen.indexOf('data-armory-panel="mastery"') + 600
    );
    expect(masteryPanel).toMatch(/id="mastery-summary"/);
    expect(masteryPanel).toMatch(/id="mastery-gloves-grid"/);
  });
});

// ---------------------------------------------------------------------------
// 4. Decoder is compact
// ---------------------------------------------------------------------------

describe('Decoder placement', () => {
  it('is a compact strip with opt-in detail', () => {
    expect(importScreen).toMatch(/class="armory-decoder-strip"/);
    expect(importScreen).toMatch(/id="btn-armory-decoder-toggle"/);
    // Detail panel ships hidden (attribute order is not significant).
    const detailTag = (importScreen.match(/<div class="[^"]*" id="armory-decoder-detail">/) ?? [])[0];
    expect(detailTag).toBeTruthy();
    expect(detailTag).toContain('hidden');
  });

  it('keeps every decoder control and id intact', () => {
    for (const id of ['decoder-status', 'decoder-detail', 'decoder-pending', 'btn-decode-signal']) {
      expect(importScreen, id).toContain(`id="${id}"`);
    }
  });

  it('the toggle only flips a class and an aria attribute', () => {
    const fn = importScreen.slice(
      importScreen.indexOf("#btn-armory-decoder-toggle"),
      importScreen.indexOf("#btn-armory-decoder-toggle") + 500
    );
    expect(fn).toMatch(/classList\.toggle\('hidden'\)/);
    expect(fn).toMatch(/aria-expanded/);
  });

  it('the strip is one row by default', () => {
    expect(screens).toMatch(/\.decoder-strip-main\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(screens).toMatch(/\.decoder-strip-detail\.hidden\s*\{\s*display:\s*none/);
  });
});

// ---------------------------------------------------------------------------
// 5. Responsive layout
// ---------------------------------------------------------------------------

describe('Responsive armory layout', () => {
  it('uses explicit 3 / 2 / 1 column breakpoints', () => {
    expect(screens).toMatch(
      /\.armory-skins-grid\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/
    );
    expect(screens).toMatch(
      /@media \(max-width: 1180px\)\s*\{\s*\.armory-skins-grid\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/
    );
    expect(screens).toMatch(
      /@media \(max-width: 720px\)\s*\{\s*\.armory-skins-grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/
    );
  });

  it('cannot overflow horizontally at any width', () => {
    // minmax(0, 1fr) rather than a fixed pixel minimum: cards shrink instead of
    // forcing a scrollbar.
    const gridRules = screens.match(/\.armory-skins-grid[^}]*\}/g) ?? [];
    expect(gridRules.length).toBeGreaterThan(0);
    for (const rule of gridRules) {
      expect(rule).not.toMatch(/minmax\((?!0,)/);
    }
  });

  it('no longer caps the armory grid with an inner scroll area', () => {
    // The old `max-height + overflow-y: auto` on the grid is what made the page
    // feel cramped; the page now scrolls as one surface.
    const gridRules = screens.match(/\.armory-skins-grid[^}]*\}/g) ?? [];
    for (const rule of gridRules) {
      expect(rule, rule).not.toMatch(/max-height/);
      expect(rule, rule).not.toMatch(/overflow-y/);
    }
  });

  it('the glove grid inside the modal armory is also fluid', () => {
    const modal = read('src/ui/ArmoryModal.ts');
    expect(modal).toMatch(/minmax\(min\(100%,\s*260px\),\s*1fr\)/);
  });

  it('the sub-navs wrap instead of overflowing on narrow screens', () => {
    expect(screens).toMatch(/\.armory-subnav,\s*\n?\.online-subnav\s*\{[^}]*flex-wrap:\s*wrap/);
  });
});

// ---------------------------------------------------------------------------
// 6. Nothing functional was removed
// ---------------------------------------------------------------------------

describe('No functionality lost', () => {
  it('the online panels and their modules are untouched', () => {
    expect(importScreen).toMatch(/racePanel/);
    expect(importScreen).toMatch(/leaderboardPanel/);
    expect(importScreen).toMatch(/appendChild\(this\.racePanel\.element\)/);
    expect(importScreen).toMatch(/appendChild\(this\.leaderboardPanel\.element\)/);
  });

  it('the movement lab, custom audio and signal pack panels all still exist', () => {
    for (const id of ['panel-showcase', 'panel-custom', 'panel-lab', 'panel-armory', 'panel-online']) {
      expect(importScreen, id).toContain(`id="${id}"`);
    }
  });

  it('the armory dev toggles are preserved', () => {
    expect(importScreen).toMatch(/id="btn-armory-dev-toggle"/);
    expect(importScreen).toMatch(/id="btn-mastery-dev-preview"/);
  });

  it('the global footer status indicator is still the only one', () => {
    expect(importScreen).toMatch(/footer\.appendChild\(this\.onlineStatusBar\.element\)/);
    expect((importScreen.match(/onlineStatusBar\.element/g) ?? []).length).toBe(1);
  });

  it('the pause-screen armory modal keeps its sections and close control', () => {
    const modal = read('src/ui/ArmoryModal.ts');
    expect(modal).toMatch(/id="armory-modal-skins-grid"/);
    expect(modal).toMatch(/id="armory-modal-gloves"/);
    expect(modal).toMatch(/id="armory-modal-drop-gloves"/);
    expect(modal).toMatch(/id="btn-armory-modal-close"/);
  });
});
