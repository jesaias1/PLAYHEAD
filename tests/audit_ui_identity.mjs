import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE_URL = 'http://127.0.0.1:3000';
const viewports = [
  { width: 1920, height: 1080, name: 'desktop' },
  { width: 1366, height: 768, name: 'laptop' }
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await puppeteer.launch({
  executablePath: EDGE_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required']
});

try {
  for (const viewport of viewports) {
    const page = await browser.newPage();
    const browserErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('pageerror', (error) => browserErrors.push(error.message));

    await page.setViewport({ width: viewport.width, height: viewport.height });
    await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#btn-showcase-enter', { timeout: 10000 });

    const state = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON();
      const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
      return {
        title: document.querySelector('.brand-logo-text')?.getAttribute('alt'),
        tagline: document.querySelector('.brand-tagline')?.textContent?.trim(),
        secondary: document.querySelector('.brand-secondary')?.textContent?.trim(),
        logoRect: rect('.brand-logo-text'),
        enterRect: rect('#btn-showcase-enter'),
        tabsRect: rect('.import-tabs'),
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        hasOverlay: Boolean(document.querySelector('.vite-error-overlay, #webpack-dev-server-client-overlay')),
        tabCount: tabs.length,
        selectedTabs: tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true').length,
        stripButtons: Array.from(document.querySelectorAll('#showcase-strip .strip-item')).every((item) => item.tagName === 'BUTTON'),
        dropZoneAccessible: document.querySelector('#import-drop-zone')?.getAttribute('role') === 'button'
          && document.querySelector('#import-drop-zone')?.getAttribute('tabindex') === '0',
        fingerprintBars: document.querySelectorAll('#showcase-fingerprint > span').length,
        stripDetailVisible: (document.querySelector('#showcase-strip .strip-item-title')?.getBoundingClientRect().height ?? 0) > 0
          && (document.querySelector('#showcase-strip .strip-signal-bars')?.getBoundingClientRect().height ?? 0) > 0
      };
    });
    console.log(`[UI IDENTITY] ${viewport.name} logo=${Math.round(state.logoRect?.width ?? 0)}x${Math.round(state.logoRect?.height ?? 0)} execBottom=${Math.round(state.enterRect?.bottom ?? 0)}`);

    assert(state.title === 'PLAYHEAD', `${viewport.name}: PLAYHEAD logo is missing`);
    assert(state.tagline?.startsWith('DROP A SONG. ENTER IT.'), `${viewport.name}: primary tagline is missing`);
    assert(state.secondary === 'BECOME THE PLAYHEAD.', `${viewport.name}: secondary tagline is missing`);
    assert(state.logoRect && state.logoRect.height >= 45, `${viewport.name}: logo is not visually prominent`);
    assert(state.enterRect && state.enterRect.bottom <= viewport.height, `${viewport.name}: EXEC TRACK is below the fold`);
    assert(state.tabsRect && state.tabsRect.bottom <= viewport.height, `${viewport.name}: module navigation is below the fold`);
    assert(!state.horizontalOverflow, `${viewport.name}: horizontal overflow detected`);
    assert(!state.hasOverlay, `${viewport.name}: Vite error overlay detected`);
    assert(state.tabCount === 4 && state.selectedTabs === 1, `${viewport.name}: tab semantics are invalid`);
    assert(state.stripButtons, `${viewport.name}: catalog entries are not keyboard-native buttons`);
    assert(state.dropZoneAccessible, `${viewport.name}: custom audio drop zone is not keyboard accessible`);
    assert(state.fingerprintBars === 18, `${viewport.name}: selected signal fingerprint is incomplete`);
    assert(state.stripDetailVisible, `${viewport.name}: catalog signal title or fingerprint is clipped`);

    await page.focus('#tab-btn-showcase');
    await page.keyboard.press('ArrowRight');
    const customSelected = await page.evaluate(() => ({
      selected: document.querySelector('#tab-btn-custom')?.getAttribute('aria-selected'),
      hidden: document.querySelector('#panel-custom')?.classList.contains('hidden'),
      activeElement: document.activeElement?.id
    }));
    assert(customSelected.selected === 'true' && customSelected.hidden === false, `${viewport.name}: arrow-key module switch failed`);
    assert(customSelected.activeElement === 'tab-btn-custom', `${viewport.name}: module focus did not follow selection`);

    await page.keyboard.press('Home');
    assert(await page.$eval('#panel-showcase', (panel) => !panel.classList.contains('hidden')), `${viewport.name}: Home key did not restore Signal Pack`);

    const frontScreenshotPath = path.join(os.tmpdir(), `playhead-ui-identity-${viewport.name}.png`);
    await page.screenshot({ path: frontScreenshotPath, fullPage: false });

    await page.evaluate(() => {
      window.game.ui.hideAllScreens();
      window.game.ui.resultsScreen.showResults(
        {
          completionTime: 71.245,
          targetTime: 72,
          syncDelta: -0.755,
          maxSpeed: 1320,
          averageSpeed: 875,
          strafeEfficiency: 84,
          fallsCount: 0,
          restartsCount: 0,
          rank: 'DIAMOND',
          score: 12450
        },
        12345,
        { rivalDelta: -1.2, isNewPB: true },
        'SIGNAL DRIFT',
        { isOvertime: false, overtimeDuration: 0 },
        { dropsAwarded: 0 }
      );
    });
    const resultsState = await page.evaluate(() => ({
      title: document.querySelector('.results-title')?.textContent,
      pbVisible: !document.querySelector('#res-pb-status')?.classList.contains('hidden'),
      rank: document.querySelector('#res-rank')?.textContent,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
    }));
    assert(resultsState.title === 'RUN REPORT', `${viewport.name}: results report title is missing`);
    assert(resultsState.pbVisible && resultsState.rank === 'DIAMOND', `${viewport.name}: PB or Diamond emphasis is missing`);
    assert(!resultsState.horizontalOverflow, `${viewport.name}: results screen overflows horizontally`);
    await new Promise((resolve) => setTimeout(resolve, 720));
    await page.screenshot({ path: path.join(os.tmpdir(), `playhead-ui-results-${viewport.name}.png`), fullPage: false });

    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#btn-showcase-enter', { timeout: 10000 });
    await page.click('#btn-showcase-enter');
    await page.waitForFunction(() => {
      const button = document.querySelector('#btn-enter-track');
      return button && !button.disabled;
    }, { timeout: 20000 });
    const analysisState = await page.evaluate(() => ({
      stage: document.querySelector('#analysis-stage')?.textContent,
      progress: document.querySelector('.analysis-progress-track')?.getAttribute('aria-valuenow'),
      enterBottom: document.querySelector('#btn-enter-track')?.getBoundingClientRect().bottom,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
    }));
    assert(analysisState.stage === '[SYS] SIGNAL LOCKED // WORLD READY', `${viewport.name}: final analysis state is incorrect`);
    assert(analysisState.progress === '100', `${viewport.name}: analysis progress did not complete`);
    assert((analysisState.enterBottom ?? viewport.height + 1) <= viewport.height, `${viewport.name}: ENTER WORLD is below the fold`);
    assert(!analysisState.horizontalOverflow, `${viewport.name}: analysis screen overflows horizontally`);
    await new Promise((resolve) => setTimeout(resolve, 720));
    await page.screenshot({ path: path.join(os.tmpdir(), `playhead-ui-analysis-${viewport.name}.png`), fullPage: false });

    assert(browserErrors.length === 0, `${viewport.name}: browser errors: ${browserErrors.join(' | ')}`);
    console.log(`[UI IDENTITY] ${viewport.width}x${viewport.height} PASS // ${frontScreenshotPath}`);
    await page.close();
  }
} finally {
  await browser.close();
}
