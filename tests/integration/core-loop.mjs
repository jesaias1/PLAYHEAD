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
  if (!process.env.CORE_LOOP_URL) server = await preview({ configLoader: 'runner', preview: { host: '127.0.0.1', port: 4197, strictPort: true } });
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
    viewBoard: !document.querySelector('#btn-res-view-leaderboard').classList.contains('hidden'),
    competition: document.querySelector('#res-competition').textContent,
    drop: document.querySelector('#res-signal-drop').textContent,
    awarded: window.game.ui.importScreen.skinSystem.getAwardedDiamondDropKeys().length
  }));
  await finish(3500);
  const first = await report();
  check('first finish reports PB and Diamond without claiming a minted guest drop', first.pb.includes('NEW PERSONAL BEST') && first.diamond.includes('SIGNAL MASTERED') && !first.drop.includes('DROP ACQUIRED'), first);
  check('first finish offers Flow State and a compatible PB duel', first.nextId === ids[1] && first.duel, first.next);
  check('official finish offers a contextual VIEW LEADERBOARD action', first.viewBoard, first.viewBoard);
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
  await page.click('.results-secondary-actions summary');
  await page.click('#btn-res-replay');
  await page.waitForFunction(() => window.game.stateMachine.getState() === 'REPLAY');
  check('secondary WATCH REPLAY still opens the current run', true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.game.stateMachine.getState() === 'FINISHED');
  check('WATCH exit restores the same report without awarding another Diamond', (await report()).awarded === first.awarded);
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
  // Contextual competition on the RESULTS screen. Fixture-invoked, offline, and
  // never a live fetch or upload; it proves the presentation/guard contract only.
  const competition = await page.evaluate(id => {
    const game = window.game, screen = game.ui.resultsScreen;
    window.coreLoopBoardCallback = screen.onViewLeaderboardCallback;
    const result = { completionTime: 44, targetTime: 50, rank: 'DIAMOND', maxSpeed: 20, averageSpeed: 10, strafeEfficiency: 90, fallsCount: 0, restartsCount: 0, syncDelta: -6, score: 100 };
    screen.showResults(result, 1, { isNewPB: true }, 'SIGNAL FIXTURE', undefined, { dropsAwarded: 0, registered: true }, { isOfficial: true, trackId: id }, undefined, undefined, undefined, undefined, { priorPbTime: 40, diamondJustMastered: false, pbGhostAvailable: false });
    const shownByDefault = !document.querySelector('#res-competition').classList.contains('hidden');
    screen.setCompetitionContext({ position: 3, timeUs: 44809000, nextAbove: { rankPosition: 2, displayName: 'RANKO', timeUs: 44118000, gapUs: 691000, runId: 'opponent', raceable: true } });
    const text = document.querySelector('#res-competition').textContent;
    const ghostVisible = !document.querySelector('#btn-res-race-ghost').classList.contains('hidden');
    screen.setCompetitionContext({ position: 3, timeUs: 44809000, nextAbove: { rankPosition: 2, displayName: 'RANKO', timeUs: 44118000, gapUs: 691000, runId: 'opponent', raceable: false } });
    const ghostHiddenNoReplay = document.querySelector('#btn-res-race-ghost').classList.contains('hidden');
    screen.setCompetitionContext(null);
    const hidden = document.querySelector('#res-competition').classList.contains('hidden');
    // A custom-audio / non-official report must never offer VIEW LEADERBOARD.
    screen.showResults(result, 1, { isNewPB: true }, 'CUSTOM', undefined, undefined, undefined, { isCustomAudio: true, eligible: true, statusMessage: 'CUSTOM' });
    const customNoBoard = document.querySelector('#btn-res-view-leaderboard').classList.contains('hidden');
    // RACE GHOST click is the ONLY thing that reaches the game callback (lazy).
    screen.showResults(result, 1, { isNewPB: true }, 'SIGNAL FIXTURE', undefined, { dropsAwarded: 0, registered: true }, { isOfficial: true, trackId: id });
    screen.setCompetitionContext({ position: 2, timeUs: 44809000, nextAbove: { rankPosition: 1, displayName: 'RANKO', timeUs: 44118000, gapUs: 691000, runId: 'opponent', raceable: true } });
    let requested = null;
    screen.setCallbacks({ onReplay() {}, onAgain() {}, onNewTrack() {}, onRaceGhost: async rid => { requested = rid; return { ok: true, detail: "READY" }; } });
    const beforeClick = requested === null;
    document.querySelector('#btn-res-race-ghost').click();
    return { shownByDefault, text, ghostVisible, ghostHiddenNoReplay, hidden, customNoBoard, beforeClick, requested };
  }, ids[0]);
  check('results competition is honest, lazy and replay-gated (fixture)', !competition.shownByDefault && competition.text.includes('#2 RANKO') && competition.text.includes('00:00.691') && competition.ghostVisible && competition.ghostHiddenNoReplay && competition.hidden && competition.customNoBoard && competition.beforeClick && competition.requested === 'opponent', competition);

  const navigation = await page.evaluate(async () => {
    const screen = window.game.ui.resultsScreen;
    let calls = 0, retries = 0, resolve;
    screen.setCallbacks({ onReplay() {}, onAgain() { retries++; }, onNewTrack() {},
      onRaceGhost: () => { calls++; return new Promise(done => { resolve = done; }); } });
    const ghost = document.querySelector('#btn-res-race-ghost');
    ghost.click(); ghost.click();document.querySelector('#btn-res-again').click();
    const locked = screen.navigationBusy && ghost.disabled && document.querySelector('#btn-res-view-leaderboard').disabled;
    resolve({ ok: false, detail: 'GHOST // REPLAY UNAVAILABLE' });
    await new Promise(done => setTimeout(done, 0));
    const recovered = !screen.navigationBusy && !ghost.disabled && !document.querySelector('#btn-res-again').disabled;
    const message = document.querySelector('#res-next-line').textContent;
    screen.setCallbacks({ onReplay() {}, onAgain() {}, onNewTrack() {}, onRaceGhost: async () => { throw Error('network'); } });
    ghost.click();await new Promise(done => setTimeout(done, 0));
    return { calls, retries, locked, recovered, message, rejected: !screen.navigationBusy && document.querySelector('#res-next-line').textContent.includes('RETRY') };
  });
  check('ghost loading locks duplicate and competing navigation, then recovers visibly', navigation.calls === 1 && navigation.retries === 0 && navigation.locked && navigation.recovered && navigation.message.includes('REPLAY UNAVAILABLE') && navigation.rejected, navigation);

  const copy = await page.evaluate(() => {
    const screen = window.game.ui.resultsScreen;
    screen.setCompetitionContext({ position: null, timeUs: 44809000,
      nextAbove: { rankPosition: 1, displayName: 'RANKO & CO', timeUs: 44112000, gapUs: 697000, runId: 'target', raceable: false } });
    return document.querySelector('#res-competition').textContent;
  });
  check('board PB and target times are explicit; unknown position and names stay honest', copy.includes('WORLD PB') && copy.includes('POSITION UNAVAILABLE') && copy.includes('00:44.809') && copy.includes('00:44.112') && copy.includes('RANKO & CO') && !copy.includes('&amp;'), copy);

  for (const [width, height] of [[1280, 720], [1440, 900]]) {
    await page.setViewport({ width, height });
    await page.evaluate(id => {
      const screen = window.game.ui.resultsScreen;
      const result = { completionTime: 106, targetTime: 100, rank: 'GOLD', maxSpeed: 20, averageSpeed: 10, strafeEfficiency: 90, fallsCount: 0, restartsCount: 0, syncDelta: 6, score: 100 };
      screen.showResults(result, 1, {}, 'SIGNAL FIXTURE', undefined, { dropsAwarded: 0, registered: true }, { isOfficial: true, trackId: id }, undefined, undefined, undefined, undefined, { priorPbTime: 107, diamondJustMastered: false, pbGhostAvailable: true });
      screen.setReplayAvailable(true);
      screen.setCompetitionContext({ position: 2, timeUs: 44809000, nextAbove: { rankPosition: 1, displayName: 'RANKO', timeUs: 44112000, gapUs: 697000, runId: 'target', raceable: true } });
    }, ids[0]);
    await sleep(750);
    const primary = await page.evaluate(() => ({ count: [...document.querySelectorAll('#res-actions > button')].filter(b => !b.classList.contains('hidden')).length, collapsed: !document.querySelector('.results-secondary-actions').open, target: document.querySelector('#res-next-line').textContent }));
    check(`rank goal and restrained primary actions at ${width}x${height}`, primary.count === 2 && primary.collapsed && primary.target.includes('2.00s'), primary);
    await page.click('.results-secondary-actions summary');
    for (const id of ['btn-res-view-leaderboard', 'btn-res-replay', 'btn-res-new']) {
      const reachable = await page.$eval(`#${id}`, b => { b.scrollIntoView({ block: 'center' }); b.focus(); const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && document.activeElement === b; });
      check(`${id} is reachable at ${width}x${height}`, reachable);
    }
    await page.screenshot({ path: path.join(evidence, `competition-${width}.png`) });
  }

  await page.evaluate(id => {
    const game = window.game, screen = game.ui.resultsScreen;
    game.currentOfficialTrackId = id;
    screen.setCallbacks({ onReplay() {}, onAgain() {}, onNewTrack() {}, onViewLeaderboard: window.coreLoopBoardCallback });
  }, ids[0]);
  await page.click('#btn-res-view-leaderboard');
  await page.waitForFunction(id => window.game.stateMachine.getState() === 'IMPORT' && !window.game.ui.importScreen.leaderboardPanel.element.classList.contains('hidden') && window.game.ui.importScreen.leaderboardPanel.getSelectedTrack() === id, {}, ids[0]);
  check('VIEW LEADERBOARD opens the actual board for the just-finished canonical signal', true);
  check('no browser exceptions', errors.length === 0, errors);
} catch (error) { checks.push({ name: 'harness completion', ok: false, detail: error.stack }); console.error(error); process.exitCode = 1; }
finally { fs.writeFileSync(path.join(evidence, 'checks.json'), JSON.stringify(checks, null, 2)); await browser?.close(); await server?.close(); }
