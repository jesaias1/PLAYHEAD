import { preview } from 'vite';
import { launch } from 'puppeteer-core';
import fs from 'node:fs';
const dir = process.env.ARMORY_EVIDENCE_DIR || 'work/glove-preview-evidence';
fs.mkdirSync(dir, { recursive: true });
const server = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 4182, strictPort: true } });
const browser = await launch({
  executablePath: process.env.CHROME_PATH || 'C:/Users/lin4s/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling']
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
// Isolated offline profile: verification cannot create accounts or change cloud rewards.
await page.setRequestInterception(true);
page.on('request', r => r.url().includes('supabase.co') ? r.abort() : r.continue());

const results = [];
function check(label, ok, data) {
  results.push({ label, ok, data });
  console.log(ok ? 'PASS' : 'FAIL', label, JSON.stringify(data));
  if (!ok) process.exitCode = 1;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const state = () => page.evaluate(() => {
  const ui = window.game.ui.importScreen, p = ui.armoryPreview;
  const rig = p.rig;
  return {
    mode: p.getMode(), running: p.running, rig: !!rig,
    knifeVisible: rig?.knifeGroup.visible, armsVisible: rig?.armsScene.visible,
    knifeParentIsPrism: rig?.knifeGroup.parent?.name === 'ArmoryPreviewKnifeParent',
    skin: p.skinSystem.getPreviewSkinId(), glove: rig?.getActiveGloveId(),
    previewOffsets: p.previewPoseRestore.length,
    sameRenderer: p.renderer === window.__glovePreviewRenderer,
    pose: p.previewPoseRestore.map(e => [e.bone.name, e.bone.quaternion.toArray()]),
    canvasCount: ui.armoryDetailElem.querySelectorAll('canvas').length,
    rawMedia: ui.armoryDetailElem.querySelectorAll('img,video').length,
    equippedGlove: p.selection?.equippedGloveId,
    equippedSkin: ui.skinSystem.getEquippedSkinId()
  };
});
async function select(slot, id, mode = 'item') {
  await page.evaluate(({ slot, id, mode }) => {
    const u = window.game.ui.importScreen;
    u.switchArmorySlot(slot); u.selectArmoryItem(id); u.armoryPreview.setMode(mode);
  }, { slot, id, mode });
  await sleep(900);
}
async function shot(name) {
  await page.$eval('.armory-preview', e => e.scrollIntoView({ block: 'center' }));
  await sleep(300);
  await (await page.$('.armory-preview')).screenshot({ path: `${dir}/${name}.png` });
}
try {
  console.log('nav');
  await page.goto(process.env.ARMORY_TEST_URL || 'http://127.0.0.1:4182');
  await page.waitForFunction(() => window.game?.ui?.importScreen, { timeout: 20000 });
  console.log('game ready');
  await sleep(1000);
  await page.evaluate(() => { const u = window.game.ui.importScreen; u.show(); u.switchModule(3); });
  await page.waitForFunction(() => window.game.ui.importScreen.armoryPreview.rig !== null, { timeout: 25000 });
  console.log('rig ready');

  const before = await page.evaluate(() => ({
    glove: localStorage.getItem('playhead.mastery.equippedGlove'),
    skin: localStorage.getItem('playhead.karambit.equippedSkin'),
    equippedGlove: window.game.ui.importScreen.armoryPreview.selection?.equippedGloveId,
    equippedSkin: window.game.ui.importScreen.skinSystem.getEquippedSkinId()
  }));

  // Knife ITEM must be untouched by any glove work: verify against a hero knife.
  await select('karambit', 'ASTRAL');
  const k = await state();
  check('knife ITEM isolates real rig, no glove pose', k.knifeVisible && !k.armsVisible && k.knifeParentIsPrism && k.previewOffsets === 0, k);
  await shot('knife-item-astral');
  await page.evaluate(() => { window.__glovePreviewRenderer = window.game.ui.importScreen.armoryPreview.renderer; });

  const pairs = [['DROP_GLOVE_CYBER', 'cyber'], ['DROP_GLOVE_AUREATE', 'aureate'], ['DROP_GLOVE_CRYSTAL', 'crystal']];
  for (const [id, short] of pairs) {
    for (const mode of ['item', 'loadout']) {
      await select('gloves', id, mode);
      const s = await state();
      if (mode === 'item') {
        check(`${short} ITEM: real arm materials, knife hidden, glove pose applied`, s.armsVisible && !s.knifeVisible && s.rawMedia === 0 && s.glove === id && s.previewOffsets === 4, s);
      } else {
        check(`${short} LOADOUT: knife + arms visible, natural arm framing`, s.armsVisible && s.knifeVisible && s.glove === id && s.previewOffsets === 2, s);
      }
      check(`${short} ${mode.toUpperCase()}: single renderer, no churn`, s.sameRenderer && s.canvasCount === 1, { sameRenderer: s.sameRenderer, canvases: s.canvasCount });
      await shot(`${mode === 'item' ? 'glove-item' : 'loadout'}-${short}`);
    }
  }

  // Re-select to prove the pose resets and never accumulates.
  await select('gloves', 'DROP_GLOVE_CYBER');
  const a = await state();
  await select('gloves', 'DROP_GLOVE_CRYSTAL');
  await select('gloves', 'DROP_GLOVE_CYBER');
  const b = await state();
  check('pose resets without accumulation', a.previewOffsets === 4 && b.previewOffsets === 4 && JSON.stringify(a.pose) === JSON.stringify(b.pose), { a: a.previewOffsets, b: b.previewOffsets });

  await select('karambit', 'ASTRAL');
  const reset = await state();
  check('returning to knife ITEM restores authored pose', reset.previewOffsets === 0 && reset.knifeVisible && !reset.armsVisible, reset);

  const socket = await page.evaluate(() => { const g = window.game.ui.importScreen.armoryPreview.rig.knifeGroup; return { p: g.position.toArray(), r: g.rotation.toArray().slice(0, 3), s: g.scale.toArray() }; });
  check('socket calibration retained', JSON.stringify(socket.p) === '[0.0093,0.1107,0.0033]' && JSON.stringify(socket.r) === '[3.034,0.3737,0.2205]' && socket.s.every(v => v === 1.011), socket);

  const after = await page.evaluate(() => ({
    glove: localStorage.getItem('playhead.mastery.equippedGlove'),
    skin: localStorage.getItem('playhead.karambit.equippedSkin'),
    equippedGlove: window.game.ui.importScreen.armoryPreview.selection?.equippedGloveId,
    equippedSkin: window.game.ui.importScreen.skinSystem.getEquippedSkinId()
  }));
  check('no equip / no persistence churn', JSON.stringify(before) === JSON.stringify(after), { before, after });
  check('no browser exceptions', errors.length === 0, errors);
} catch (e) {
  console.log(e.stack);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(`${dir}/checks.json`, JSON.stringify(results, null, 2));
  console.log('errors:', JSON.stringify(errors));
  await browser.close();
  await new Promise(r => server.httpServer.close(r));
}
