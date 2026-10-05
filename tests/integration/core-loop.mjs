// Offline product-flow acceptance. Assisted gate crossings exercise the real
// finish/results path; they do not establish movement feel or legal record times.
import { preview } from 'vite';
import { launch } from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const evidence = path.resolve(process.env.CORE_LOOP_EVIDENCE ?? 'work/core-loop-evidence');
fs.mkdirSync(evidence, { recursive: true });
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail ?? '')}`);
  if (!ok) throw new Error(name);
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, browser;
try {
  const url = process.env.CORE_LOOP_URL ?? 'http://127.0.0.1:4197';
  if (!process.env.CORE_LOOP_URL) server = await preview({ preview: { host: '127.0.0.1', port: 4197, strictPort: true } });
  browser = await launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Users/lin4s/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe', headless: true,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 900 });
  await page.setRequestInterception(true);
  page.on('request', request => /supabase|functions\./i.test(request.url()) ? request.abort() : request.continue());
  await page.evaluateOnNewDocument(() => {
    if (!localStorage.getItem('trackrun_settings')) localStorage.setItem('trackrun_settings', JSON.stringify({ ghostMode: 'OFF', graphics: 'LOW', masterVolume: 0 }));
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.game?.ui?.importScreen);
  const ids = await page.evaluate(() => window.game.ui.importScreen.catalog.filter(track => track.id !== 'tutorial_00').map(track => track.id));
  check('canonical pack has fourteen signals', ids.length === 14);
  await page.waitForFunction(() => document.querySelector('#showcase-next-tier').textContent.includes('BRONZE'));
  await page.evaluate(id => window.game.loadPresetTrack(id), ids[0]);
  await page.waitForFunction(() => window.game.stateMachine.getState() === 'READY');
  await page.click('#btn-enter-track');
  await page.waitForFunction(() => window.game.stateMachine.getState() === 'PLAYING');
  const finish = async hold => {
    await sleep(hold);
    await page.evaluate(() => {
      const game = window.game, position = game.currentTrack.finish.position;
      game.playerController.position.set(position.x, position.y, position.z);
    });
    await page.waitForFunction(() => window.game.stateMachine.getState() === 'FINISHED');
    await sleep(850);
  };
  const report = () => page.evaluate(() => ({
    pb: document.querySelector('#res-pb-status').textContent,
    time: document.querySelector('#res-time').textContent,
    diamond: document.querySelector('#res-rank-sub').textContent,
    next: document.querySelector('#res-next-line').textContent,
    nextId: document.querySelector('#btn-res-next').dataset.trackId,
    duel: !document.querySelector('#btn-res-retry-pb').classList.contains('hidden'),
    drop: document.querySelector('#res-signal-drop').textContent,
    awarded: window.game.ui.importScreen.skinSystem.getAwardedDiamondDropKeys().length
  }));
  await finish(3500);
  const first = await report();
  check('first finish reports PB and Diamond without claiming a minted guest drop', first.pb.includes('NEW PERSONAL BEST') && first.diamond.includes('SIGNAL MASTERED') && !first.drop.includes('DROP ACQUIRED'), first);
  check('first finish offers Flow State and a compatible PB duel', first.nextId === ids[1] && first.duel, first.next);
  check('details are secondary', await page.$eval('.results-run-data', element => !element.open));
  await page.screenshot({ path: path.join(evidence, 'first-diamond-results.png') });
  await page.click('#btn-res-again');
  await page.waitForFunction(() => window.game.stateMachine.getState() === 'PLAYING');
  check('normal retry does not arm a recorded duel with ghost setting OFF', await page.evaluate(() => !window.game.ghostRace.isActive() && window.game.pendingGhostRun === null));
  await finish(1200);
  const pb = await report();
  check('faster retry reports real PB gain without farming another Diamond', /NEW PERSONAL BEST.*-\d/.test(pb.pb) && pb.awarded === first.awarded, pb);
  await page.click('#btn-res-retry-pb');
  await page.waitForFunction(() => window.game.stateMachine.getState() === 'PLAYING' && window.game.ghostRace.isActive(), { timeout: 20000 }).catch(async error => {
    console.log('DUEL STATE', await page.evaluate(() => ({ state: window.game.stateMachine.getState(), target: document.querySelector('#res-next-line').textContent, pending: window.game.pendingGhostRun?.label, active: window.game.ghostRace.isActive() })));
    await page.screenshot({ path: path.join(evidence, 'duel-failure.png') });
    throw error;
  });
  check('explicit PB duel loads verified trajectory and starts play', await page.evaluate(() => window.game.ghostRace.getRun().kind === 'PB'));
  await finish(2200);
  check('Diamond replay gives a PB goal', (await report()).next.includes('TO PB'));
  await page.click('#btn-res-next');
  await page.waitForFunction(id => window.game.currentOfficialTrackId === id && window.game.stateMachine.getState() === 'PLAYING', { timeout: 60000 }, ids[1]);
  check('next signal enters play without a menu round trip', true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.game?.ui?.importScreen);
  await page.waitForFunction(() => document.querySelector('#showcase-next-tier').textContent === 'MASTERED');
  check('guest mastery survives reload and appears in pack counts', await page.$eval('.showcase-mastery-strip', element => element.textContent.includes('DIAMOND')));

  // Presentation fixtures are offline and never submit a run or award ownership.
  const fixture = await page.evaluate(id => {
    const game = window.game, screen = game.ui.resultsScreen, skins = game.ui.importScreen.skinSystem;
    skins.mergeCloudDropAward('11111111-1111-1111-1111-111111111111');
    skins.setStructuredDropOpener(async () => null);
    const result = { completionTime: 44, targetTime: 50, rank: 'DIAMOND', maxSpeed: 20, averageSpeed: 10, strafeEfficiency: 90, fallsCount: 0, restartsCount: 0, syncDelta: -6, score: 100 };
    screen.showResults(result, 1, { isNewPB: true }, 'SIGNAL FIXTURE', undefined, { dropsAwarded: 1, registered: true }, { isOfficial: true, trackId: id }, undefined, undefined, undefined, undefined, { priorPbTime: 40, diamondJustMastered: true, pbGhostAvailable: true, pbGhostLabel: 'BEST RECORDED GHOST' });
    const old = document.querySelector('#res-signal-drop-status').textContent;
    const falsePb = !document.querySelector('#res-pb-status').classList.contains('hidden') && document.querySelector('#res-pb-status').textContent.includes('NEW PERSONAL BEST');
    const fallback = document.querySelector('#btn-res-retry-pb').textContent;
    screen.refreshSignalDropPanel(true);
    const acquired = document.querySelector('#res-signal-drop-status').textContent;
    return { old, falsePb, fallback, acquired };
  }, ids[0]);
  check('old unopened drop is not newly awarded; cloud PB and fallback replay stay honest', !fixture.old.includes('ACQUIRED') && !fixture.falsePb && fixture.fallback.includes('BEST RECORDED') && fixture.acquired.includes('ACQUIRED'), fixture);
  const race = await page.evaluate(() => {
    const panel = window.game.ui.importScreen.racePanel;
    const rows = [{ userId: 'me', displayName: 'YOU', finishTimeUs: 44000000, dnf: false, place: 2, gapUs: 697000 }, { userId: 'rival', displayName: 'RANKO', finishTimeUs: 43303000, dnf: false, place: 1, gapUs: 0 }];
    panel.setRunFeedback({ rank: 'GOLD', time: 44, priorPbTime: 45, isNewPb: true, diamondJustMastered: false });
    panel.renderResults(rows, 'me');
    const text = panel.element.textContent;
    panel.setRunFeedback(null);
    panel.renderResults(rows, 'me');
    return { text, reset: !panel.element.querySelector('.race-run-feedback') };
  });
  check('race results present PB/rank/rival gap and reset between attempts (fixture)', race.text.includes('NEW PB // -1.000s') && race.text.includes('+0.697s') && race.reset);
  const leaderboard = await page.evaluate(id => {
    const panel = window.game.ui.importScreen.leaderboardPanel;
    let requested = null;
    panel.callbacks.onRaceRun = runId => { requested = runId; };
    const above = { rankPosition: 1, trackId: id, displayName: 'RANKO', timeUs: 44112000, rank: 'DIAMOND', userId: 'rival', runId: 'opponent', verificationState: 'accepted', createdAt: '', replayVersion: 1, replayPath: 'fixture', replayHash: 'fixture' };
    panel.render({ trackId: id, entries: [above], you: { timeUs: 44809000, position: 2, displayName: 'YOU' }, nextAbove: above, offline: false }, 'SIGNAL');
    const lazy = requested === null;
    const target = panel.element.querySelector('.online-lb-above');
    target.querySelector('button').click();
    return { lazy, requested, text: target.textContent };
  }, ids[0]);
  check('next-above opponent action is lazy and shows the real gap (fixture)', leaderboard.lazy && leaderboard.requested === 'opponent' && leaderboard.text.includes('00:00.697'), leaderboard);
  check('no browser exceptions', errors.length === 0, errors);
} catch (error) { checks.push({ name: 'harness completion', ok: false, detail: error.stack }); console.error(error); process.exitCode = 1; }
finally { fs.writeFileSync(path.join(evidence, 'checks.json'), JSON.stringify(checks, null, 2)); await browser?.close(); await server?.close(); }
