// =============================================================================
// ONLINE RACE UI — synthetic PRESENTATION evidence harness (puppeteer-core)
// =============================================================================
//
//   node tests/integration/online-race-ui.mjs [--port 4179] [--exec <chrome>]
//
// Serves the REAL production bundle (vite preview over ./dist) and drives
// window.game.ui.importScreen.racePanel / raceHud DIRECTLY with SYNTHETIC
// RaceRoom / players / results. This is PRESENTATION evidence ONLY: it is NOT
// multiplayer evidence and no real backend, account or network call is used
// (every supabase/cloud request is aborted).
// =============================================================================

import { preview } from 'vite';
import { launch } from 'puppeteer-core';
import * as fs from 'node:fs';
import * as path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);
const port = Number(args.port ?? 4179);
const url = args.url ?? `http://localhost:${port}`;
const executablePath =
  args.exec ??
  process.env.CHROME_PATH ??
  'C:/Users/lin4s/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const shotDir = args.shots ?? path.join(process.cwd(), 'work', 'online-race-ui-evidence');

const results = [];
const record = (label, ok, evidence = '') => {
  results.push({ label, ok: !!ok, evidence });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${evidence ? '  ' + evidence : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server;
let browser;
try {
  fs.mkdirSync(shotDir, { recursive: true });
  server = await preview({
    configFile: false,
    root: process.cwd(),
    logLevel: 'silent',
    preview: { port, strictPort: true }
  });
  browser = await launch({
    executablePath,
    headless: args.head !== 'false',
    args: ['--no-sandbox', '--disable-background-timer-throttling']
  });

  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  // No account, no cloud: abort every supabase/cloud request outright.
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (/supabase|\.supabase\.|cloud|functions\./i.test(u)) void req.abort();
    else void req.continue();
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => !!(window.game && window.game.ui && window.game.ui.importScreen.racePanel),
    { timeout: 30000 }
  );

  // Open 05 // ONLINE on the RACE subsection using the shipped navigation.
  await page.evaluate(() => {
    window.game.ui.importScreen.show();
    window.game.ui.importScreen.openRaceTab();
  });
  await sleep(250);

  // --- Synthetic fixtures (presentation only) -------------------------------
  await page.evaluate(() => {
    const panel = window.game.ui.importScreen.racePanel;
    window.__uiEvidence = { synthetic: true, note: 'SYNTHETIC PRESENTATION ONLY' };
    window.__uiCatalog = [
      { id: 'signal_drift', title: 'SIGNAL DRIFT', bpm: 105, difficultyLabel: 'FLOW', accentColor: '#00f0ff' },
      { id: 'glass_engine', title: 'GLASS ENGINE', bpm: 128, difficultyLabel: 'PULSE', accentColor: '#ff5d9d' },
      { id: 'null_corridor', title: 'NULL CORRIDOR', bpm: 140, difficultyLabel: 'SURGE', accentColor: '#d0ff4d' },
      { id: 'deep_orbit', title: 'DEEP ORBIT', bpm: 122, difficultyLabel: 'FLOW', accentColor: '#9d8cff' }
    ];
    const mkPlayer = (i, name, o = {}) => ({
      userId: 'u' + i, displayName: name, loadout: null,
      ready: false, inGameReady: false, loaded: false, connected: true,
      finishUs: null, finished: false, dnf: false, colorIndex: i,
      joinedAt: 1000 + i, lastSeenAt: Date.now(), progress: 0, checkpointTotal: 12, ...o
    });
    window.__mkPlayer = mkPlayer;
    window.__mkRoom = (o = {}) => ({
      id: 'room-1', inviteCode: '7KQ4M2', hostUserId: 'u0', trackId: 'signal_drift',
      trackTitle: 'SIGNAL DRIFT', mapVersion: 1, mapFingerprint: 'fp', state: 'LOBBY',
      capacity: 4, raceId: 'race-1', startAtMs: null, finishedAtMs: null,
      expiresAtMs: Date.now() + 3600000, ...o
    });
    panel.setCatalog(window.__uiCatalog);
  });

  const shot = async (name, w, h) => {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await sleep(200);
    await page.screenshot({ path: path.join(shotDir, name + '.png') });
  };

  const overflow = () =>
    page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth
    }));

  record('four racers is the default', await page.$eval('#race-capacity-select', e => e.value === '4'));
  // --- Callback / keyboard checks (isolated, no network) --------------------
  const calls = await page.evaluate(() => {
    const panel = window.game.ui.importScreen.racePanel;
    const seen = [];
    panel.setCallbacks({
      onCreateRoom: (t, c) => seen.push(['create', t, c]),
      onJoinRoom: (code) => seen.push(['join', code]),
      onSetReady: () => {}, onLeaveRoom: () => {}, onRematch: () => {},
      onReturnToLobby: () => {}, onHostPickTrack: () => {}, onOpenProfile: () => {}
    });
    document.querySelector('#race-capacity-select').value = '8';
    document.querySelector('#race-capacity-select').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#race-track-select').value = 'glass_engine';
    document.querySelector('#race-track-select').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#race-create-room').click();
    const j = document.querySelector('#race-join-input');
    j.value = '7kq4m2';
    j.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#race-join-btn').click();
    return { seen, joinValue: j.value };
  });
  record(
    'CREATE RACE reports (track, capacity) from the real controls',
    JSON.stringify(calls.seen[0]) === JSON.stringify(['create', 'glass_engine', 8]),
    JSON.stringify(calls.seen[0])
  );
  record(
    'JOIN RACE upper-cases the code from a single input',
    JSON.stringify(calls.seen[1]) === JSON.stringify(['join', '7KQ4M2']) && calls.joinValue === '7KQ4M2',
    JSON.stringify(calls.seen[1])
  );
  const segSync = await page.evaluate(() => {
    const active = [...document.querySelectorAll('.race-cap-btn')].find((b) =>
      b.classList.contains('race-cap-active')
    );
    return active?.dataset.capacity ?? null;
  });
  record('RACERS segmented control follows the capacity value (8)', segSync === '8', String(segSync));
  const zeroErr = await page.evaluate(() => {
    const j = document.querySelector('#race-join-input');
    j.value = 'abcd';
    j.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#race-join-btn').click();
    return document.querySelector('#race-error').classList.contains('hidden');
  });
  record('4-char code is accepted by the real min-length validation (no error shown)', zeroErr === true, String(zeroErr));
  const shortErr = await page.evaluate(() => {
    const j = document.querySelector('#race-join-input');
    j.value = 'abc';
    j.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#race-join-btn').click();
    return !document.querySelector('#race-error').classList.contains('hidden');
  });
  record('short code is rejected by the real validation', shortErr === true, String(shortErr));

  // --- LANDING --------------------------------------------------------------
  await page.evaluate(() => {
    const panel = window.game.ui.importScreen.racePanel;
    panel.showSelect();
    document.querySelector('#race-capacity-select').value = '4';
    document.querySelector('#race-capacity-select').dispatchEvent(new Event('change'));
    document.querySelector('#race-join-input').value = '';
    document.querySelector('#race-track-select').value = 'signal_drift';
    document.querySelector('#race-track-select').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#race-error').classList.add('hidden');
  });
  for (const w of [1280, 1440, 1920]) {
    await shot(`synthetic-landing-${w}`, w, w === 1280 ? 800 : 900);
  }
  const land = await overflow();
  record('landing has no horizontal overflow', land.scrollW <= land.innerW + 2, JSON.stringify(land));
  const heroOk = await page.evaluate(() => {
    const t = document.querySelector('#race-create-title')?.textContent;
    const b = document.querySelector('#race-create-bpm')?.textContent;
    const d = document.querySelector('#race-create-diff')?.textContent;
    return { t, b, d };
  });
  record(
    'selected-track hero shows the real title / BPM / difficulty',
    heroOk.t === 'SIGNAL DRIFT' && heroOk.b === '105 BPM' && heroOk.d === 'FLOW',
    JSON.stringify(heroOk)
  );

  // CREATE RACE state (4 recommended) + JOIN filled
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluate(() => {
    document.querySelector('#race-capacity-select').value = '4';
    document.querySelector('#race-capacity-select').dispatchEvent(new Event('change', { bubbles: true }));
    const j = document.querySelector('#race-join-input');
    j.value = '7KQ4M2';
    j.dispatchEvent(new Event('input', { bubbles: true }));
    j.focus();
  });
  await sleep(200);
  await page.screenshot({ path: path.join(shotDir, 'synthetic-join-filled-1440.png') });
  const focusOk = await page.evaluate(() => document.activeElement?.id === 'race-join-input');
  record('keyboard focus reaches the room-code input', focusOk === true, String(focusOk));

  // --- LOBBY: 2 players, 4 players, empty slot ------------------------------
  const renderLobby = (players, room) =>
    page.evaluate(
      ({ players, room }) => {
        const panel = window.game.ui.importScreen.racePanel;
        panel.setHost(room.hostUserId === 'u0');
        panel.setMapState('OK');
        panel.renderLobby(room, players, 'http://localhost/?room=' + room.inviteCode, 'u0', new Map());
        panel.showLobby();
      },
      { players, room }
    );
  const fourState = await page.evaluate(() => {
    const mk = window.__mkPlayer;
    const room = window.__mkRoom({ capacity: 4, state: 'LOBBY' });
    const players = [
      mk(0, 'LINAS', { ready: true }),
      mk(1, 'RANKO', { ready: true }),
      mk(2, 'PLAYER3', { ready: false }),
      mk(3, 'PLAYER4', { ready: false })
    ];
    const panel = window.game.ui.importScreen.racePanel;
    panel.setHost(true);
    panel.setMapState('OK');
    panel.renderLobby(room, players, 'http://localhost/?room=' + room.inviteCode, 'u0', new Map());
    panel.showLobby();
    return {
      rows: document.querySelectorAll('#race-lobby-players .online-player-row').length,
      ready: document.querySelectorAll('#race-lobby-players .online-player-state-ready').length,
      notReady: document.querySelectorAll('#race-lobby-players .online-player-state-notready').length
    };
  });
  await shot('synthetic-lobby-4player-1440', 1440, 900);
  record(
    '4-player lobby grid: 4 rows, 2 READY, 2 NOT READY',
    fourState.rows === 4 && fourState.ready === 2 && fourState.notReady === 2,
    JSON.stringify(fourState)
  );
  const lobbyOverflow = await overflow();
  record('4-player lobby has no horizontal overflow', lobbyOverflow.scrollW <= lobbyOverflow.innerW + 2, JSON.stringify(lobbyOverflow));

  await page.evaluate(() => {
    const mk = window.__mkPlayer;
    const room = window.__mkRoom({ capacity: 2, state: 'LOBBY' });
    const players = [mk(0, 'LINAS', { ready: true }), mk(1, 'RANKO', { ready: false, connected: true })];
    window.game.ui.importScreen.racePanel.renderLobby(room, players, 'x', 'u0', new Map());
  });
  await shot('synthetic-lobby-2player-1440', 1440, 900);

  const emptyState = await page.evaluate(() => {
    const mk = window.__mkPlayer;
    const room = window.__mkRoom({ capacity: 4, state: 'LOBBY' });
    const players = [mk(0, 'LINAS', { ready: true })];
    window.game.ui.importScreen.racePanel.renderLobby(room, players, 'x', 'u0', new Map());
    return {
      empty: document.querySelectorAll('#race-lobby-players .online-player-empty').length,
      text: document.querySelector('#race-lobby-players .online-player-empty .online-player-name')?.textContent ?? ''
    };
  });
  await shot('synthetic-lobby-empty-1440', 1440, 900);
  record(
    'empty slots read WAITING FOR SIGNAL',
    emptyState.empty === 3 && emptyState.text === 'WAITING FOR SIGNAL...',
    JSON.stringify(emptyState)
  );

  // Ready / IN_GAME / disconnected states
  const readyStates = await page.evaluate(() => {
    const mk = window.__mkPlayer;
    const room = window.__mkRoom({ capacity: 4, state: 'IN_GAME' });
    const players = [
      mk(0, 'LINAS', { ready: true, loaded: true, inGameReady: true }),
      mk(1, 'RANKO', { ready: true, loaded: true, inGameReady: false }),
      mk(2, 'PLAYER3', { ready: true, loaded: false }),
      mk(3, 'PLAYER4', { ready: true, loaded: true, connected: false })
    ];
    window.game.ui.importScreen.racePanel.renderLobby(room, players, 'x', 'u0', new Map());
    return {
      ready: document.querySelectorAll('.online-player-state-ready').length,
      pending: document.querySelectorAll('.online-player-state-pending').length,
      warn: document.querySelectorAll('.online-player-state-warn').length,
      disconnected: document.querySelectorAll('.online-player-disconnected').length,
      hostBadge: document.querySelectorAll('.online-player-host').length
    };
  });
  await shot('synthetic-lobby-ready-states-1440', 1440, 900);
  record(
    'lobby states render READY / LOADING / DISCONNECTED with a host badge',
    readyStates.ready >= 1 && readyStates.pending >= 1 && readyStates.warn >= 1 &&
      readyStates.disconnected === 1 && readyStates.hostBadge === 1,
    JSON.stringify(readyStates)
  );

  // --- HUD: second in-game READY (ALL SIGNALS ONLINE) + countdown -----------
  await page.evaluate(() => {
    window.game.ui.importScreen.hide();
    const hud = window.game.ui.raceHud;
    hud.show();
    hud.setPhase({
      phase: 'READY',
      title: 'SIGNAL CHECK',
      lines: [
        { label: 'LINAS (YOU) // READY', ready: true },
        { label: 'RANKO // READY', ready: true },
        { label: 'PLAYER3 // READY', ready: true },
        { label: 'PLAYER4 // READY', ready: true }
      ],
      prompt: 'PRESS [SPACE] TO READY'
    });
    hud.setCountdown(null);
  });
  await shot('synthetic-hud-ready-1440', 1440, 900);
  const hudReady = await page.evaluate(() => ({
    title: document.querySelector('#race-phase-title')?.textContent,
    count: document.querySelector('#race-phase-count')?.textContent,
    all: document.querySelector('#race-phase')?.classList.contains('race-phase-all-ready')
  }));
  record(
    'HUD shows ALL SIGNALS ONLINE + 4 / 4 READY only when all lines report ready',
    hudReady.title === 'ALL SIGNALS ONLINE' && hudReady.count === '4 / 4 READY' && hudReady.all === true,
    JSON.stringify(hudReady)
  );

  const hudPartial = await page.evaluate(() => {
    const hud = window.game.ui.raceHud;
    hud.setPhase({
      phase: 'WAITING',
      title: 'SIGNAL CHECK',
      lines: [
        { label: 'LINAS (YOU) // READY', ready: true },
        { label: 'RANKO // WAITING', ready: false }
      ],
      prompt: 'PRESS [SPACE] TO READY'
    });
    return {
      title: document.querySelector('#race-phase-title')?.textContent,
      count: document.querySelector('#race-phase-count')?.textContent
    };
  });
  record(
    'HUD does NOT claim all-online while a racer is not ready (truthful)',
    hudPartial.title === 'SIGNAL CHECK' && hudPartial.count === '1 / 2 READY',
    JSON.stringify(hudPartial)
  );

  await page.evaluate(() => {
    const hud = window.game.ui.raceHud;
    hud.setPhase({
      phase: 'COUNTDOWN',
      title: 'SIGNALS LOCKED',
      lines: [
        { label: 'LINAS (YOU) // READY', ready: true },
        { label: 'RANKO // READY', ready: true }
      ],
      prompt: 'STAND BY'
    });
    hud.setCountdown(3);
  });
  await shot('synthetic-hud-countdown-1440', 1440, 900);
  const cd = await page.evaluate(() => document.querySelector('#race-countdown')?.textContent);
  record('HUD countdown reflects the authoritative seconds (3)', cd === '3', String(cd));

  await page.evaluate(() => {
    const hud = window.game.ui.raceHud;
    hud.setCountdown(null);
    hud.setPhase({phase:'WAITING', title:'SIGNAL CHECK', allLoaded:true,
      lines:[{label:'LINAS // READY',ready:true},{label:'RANKO // READY',ready:true},
        {label:'PLAYER3 // NOT READY',ready:false},{label:'PLAYER4 // READY',ready:true}],
      prompt:'PRESS [SPACE] TO READY'});
  });
  await shot('synthetic-hud-loaded-not-ready-1440',1440,900);
  record('all loaded is distinct from all ready', await page.evaluate(() =>
    document.querySelector('#race-phase-title').textContent==='ALL SIGNALS ONLINE' &&
    document.querySelector('#race-phase-count').textContent==='3 / 4 READY'));
  await page.evaluate(() => window.game.ui.raceHud.setPhase({phase:'WAITING',title:'SIGNAL CHECK',allLoaded:false,
    lines:[{label:'RACER // LOADING',ready:false}],prompt:'WAITING FOR SIGNAL'}));
  record('loading cannot claim all signals online',await page.$eval('#race-phase-title',e=>e.textContent==='SIGNAL CHECK'));

  // --- RESULTS --------------------------------------------------------------
  await page.evaluate(() => {
    window.game.ui.importScreen.show();
    window.game.ui.importScreen.openRaceTab();
    const panel = window.game.ui.importScreen.racePanel;
    panel.setHost(true);
    panel.showResults();
    panel.renderResults(
      [
        { userId: 'u0', displayName: 'LINAS', finishTimeUs: 48842000, dnf: false, place: 1, gapUs: 0 },
        { userId: 'u1', displayName: 'RANKO', finishTimeUs: 49563000, dnf: false, place: 2, gapUs: 721000 },
        { userId: 'u2', displayName: 'PLAYER3', finishTimeUs: 51856000, dnf: false, place: 3, gapUs: 3014000 },
        { userId: 'u3', displayName: 'PLAYER4', finishTimeUs: null, dnf: true, place: null, gapUs: null }
      ],
      'u0',
      new Map()
    );
  });
  await shot('synthetic-results-1440', 1440, 900);
  const res = await page.evaluate(() => ({
    title: document.querySelector('#race-results-title')?.textContent,
    rows: document.querySelectorAll('#race-results .online-result-row').length,
    dnf: document.querySelectorAll('#race-results .online-result-dnf').length,
    times: [...document.querySelectorAll('#race-results .online-result-time')].map((e) => e.textContent)
  }));
  record(
    'results grid: strong title, 4 rows, times + DNF',
    res.title === 'RACE COMPLETE' && res.rows === 4 && res.dnf === 1 &&
      res.times[0] === '00:48.842' && res.times[3] === '--:--.---',
    JSON.stringify(res)
  );
  const resOverflow = await overflow();
  record('results grid has no horizontal overflow', resOverflow.scrollW <= resOverflow.innerW + 2, JSON.stringify(resOverflow));

  // Keyboard reachability of the landing controls via Tab.
  await page.evaluate(() => {
    const panel = window.game.ui.importScreen.racePanel;
    panel.showSelect();
    panel.element.querySelector('#race-track-select').focus();
  });
  const tabReach = [];
  for (let i = 0; i < 12; i++) {
    tabReach.push(await page.evaluate(() => document.activeElement?.id ?? ''));
    await page.keyboard.press('Tab');
  }
  record('native Tab reaches create and join controls',
    ['race-track-select','race-create-room','race-join-input','race-join-btn'].every(id=>tabReach.includes(id)), JSON.stringify(tabReach));

  record('no uncaught page exceptions during presentation states', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  record('harness completed', false, String(err && err.stack ? err.stack : err));
} finally {
  try { await browser?.close(); } catch { /* ignore */ }
  try { if (server?.httpServer) await new Promise(r => server.httpServer.close(r)); } catch { /* ignore */ }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log('Screenshots: ' + shotDir);
if (failed.length) process.exitCode = 1;
