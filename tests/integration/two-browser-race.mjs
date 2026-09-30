// =============================================================================
// two-browser friend-race INTEGRATION harness (puppeteer-core)
// =============================================================================
//
// Root runs this AFTER migrations + functions are deployed and the app is served:
//
//   node tests/integration/two-browser-race.mjs --url http://localhost:3000 --exec <edge.exe>
//
// Real UI, no fabricated PASS. Credentials are generated at runtime and live
// ONLY in this process: never written to disk, never printed. Screenshots are
// saved as evidence.
// =============================================================================

import { launch } from 'puppeteer-core';
import * as fs from 'node:fs';
import * as path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const url = args.url ?? 'http://localhost:3000';
const executablePath = args.exec ?? process.env.CHROME_PATH;
const headless = args.head !== 'false';
const shotDir = args.shots ?? path.join(process.cwd(), 'work', 'race-evidence');

if (!executablePath) {
  console.error('FAIL: pass --exec <path-to-chrome-or-edge> (or set CHROME_PATH)');
  process.exit(2);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitFor(fn, { timeout = 60000, interval = 250, label = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await fn().catch(() => undefined);
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error('timeout waiting for ' + label);
    await sleep(interval);
  }
}

function randomSuffix() { return Math.random().toString(36).slice(2, 10); }

// Runtime-only credentials: in memory, never logged, never persisted.
function randomCredentials(tag) {
  const bytes = new Uint8Array(12);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  const password = 'ph-' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return { username: ('it_' + tag + '_' + randomSuffix()).slice(0, 20), password, tag };
}

const browser = await launch({
  executablePath,
  headless,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
});

const results = [];
function record(label, ok, evidence) {
  results.push({ label, ok: !!ok, evidence: evidence ?? '' });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + '  ' + (evidence ?? ''));
}

async function shot(page, name) {
  try {
    fs.mkdirSync(shotDir, { recursive: true });
    await page.screenshot({ path: path.join(shotDir, name + '.png') });
  } catch { /* evidence is best-effort */ }
}

async function newClient(tag) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitFor(() => page.evaluate(() => !!window.game && !!window.__playheadHarness?.raceRoomService), {
    label: 'app harness'
  });
  await waitFor(() => page.evaluate(async () => { const {onlineBootstrap} = await import('/src/online/OnlineBootstrap.ts'); return ['SYNCED','MIGRATED','DISABLED','ERROR','SIGNED_OUT'].includes(onlineBootstrap.getStatus().state); }), {label:'initial online bootstrap settled'});
  return { context, page, tag };
}

async function signUp(page, creds) {
  return page.evaluate(async (c) => {
    const h = window.__playheadHarness;
    const res = await h.authService.registerAccount(c.username, c.password);
    return { ok: res.ok, detail: res.ok ? 'ok' : res.detail, userId: h.authService.getUserId(), username: c.username };
  }, creds);
}

async function openRacePanel(page) {
  await page.evaluate(() => {
    window.game.ui.importScreen.show();
    window.game.ui.importScreen.openRaceTab();
  });
  await waitFor(
    () => page.evaluate(() => {
      const view = document.querySelector('#race-select-view');
      return !!view && !view.classList.contains('hidden');
    }),
    { label: 'RACE panel visible' }
  );
}

async function createRoomViaUi(page) {
  return page.evaluate(async () => {
    const h = window.__playheadHarness;
    const select = document.querySelector('#race-track-select');
    if (!select || select.options.length === 0) return { ok: false, detail: 'no tracks in selector' };
    const trackId = select.value;
    const create = document.querySelector('#race-create-room');
    if (!create) return { ok: false, detail: 'no create button' };
    create.click();
    const start = Date.now();
    while (Date.now() - start < 30000) {
      const room = h.raceRoomService.getRoom();
      if (room) return { ok: true, trackId, inviteCode: room.inviteCode, roomId: room.id };
      await new Promise((r) => setTimeout(r, 200));
    }
    return { ok: false, detail: 'room never created' };
  });
}

async function joinRoomViaUi(page, code) {
  return page.evaluate(async (invite) => {
    const h = window.__playheadHarness;
    const input = document.querySelector('#race-join-input');
    if (!input) return { ok: false, detail: 'no join input' };
    input.value = invite;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const join = document.querySelector('#race-join-btn');
    if (join) join.click();
    const start = Date.now();
    while (Date.now() - start < 30000) {
      const room = h.raceRoomService.getRoom();
      if (room) return { ok: true, roomId: room.id };
      await new Promise((r) => setTimeout(r, 200));
    }
    return { ok: false, detail: 'room never joined' };
  }, code);
}

async function pressLobbyReady(page) {
  return page.evaluate(() => {
    const btn = document.querySelector('#race-ready-btn');
    if (!btn || btn.classList.contains('hidden')) return false;
    btn.click();
    return true;
  });
}

async function roomState(page) {
  return page.evaluate(() => {
    const room = window.__playheadHarness.raceRoomService.getRoom();
    if (!room) return null;
    return { state: room.state, startAtMs: room.startAtMs, inviteCode: room.inviteCode, roomId: room.id };
  });
}

async function harnessSnapshot(page) {
  return page.evaluate(() => window.game.getRaceHarnessSnapshot());
}

async function standDown(page) {
  await page.evaluate(async () => {
    try { await window.__playheadHarness.raceRoomService.leaveRoom(); } catch { /* ignore */ }
    try {
      window.game.ui.importScreen.show();
      window.game.ui.importScreen.openRaceTab();
    } catch { /* ignore */ }
  });
}

// Settle fresh live samples before asserting on ghost geometry.
async function pollLiveGhost(page, ms = 1800, interval = 200) {
  const deadline = Date.now() + ms;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(() => ({
      tx: window.__playheadHarness.raceRoomService.getGhostDiagnostics(),
      ghost: window.game.getRaceHarnessSnapshot().ghost
    }));
    await sleep(interval);
  }
  return last;
}

// =============================================================================

const clientA = await newClient('A');
const clientB = await newClient('B');
const credsA = randomCredentials('a');
const credsB = randomCredentials('b');

try {
  // ---- ACCOUNT: create through the API, then prove signout/login round-trips.
  await openRacePanel(clientA.page);
  const upA = await signUp(clientA.page, credsA);
  record('A registered a username account (no email; password never printed)', upA.ok, JSON.stringify({ ok: upA.ok, detail: upA.detail }));
  const upB = await signUp(clientB.page, credsB);
  record('B registered a username account', upB.ok, JSON.stringify({ ok: upB.ok, detail: upB.detail }));
  if (!upA.ok || !upB.ok) throw new Error('cannot continue without two accounts');

  const signoutLogin = await clientA.page.evaluate(async (c) => {
    const h = window.__playheadHarness;
    const before = h.authService.getUserId();
    h.cloudProgression.signOutLocalState();
    await h.authService.logoutAccount();
    const afterSignout = { userId: h.authService.getUserId(), registered: h.authService.isRegisteredAccount() };
    const relog = await h.authService.loginAccount(c.username, c.password);
    return { before, afterSignout, relogOk: relog.ok, afterLogin: h.authService.getUserId() };
  }, { username: credsA.username, password: credsA.password });
  record(
    'signout drops to guest, login restores the same account id',
    signoutLogin.afterSignout.registered === false && signoutLogin.relogOk && signoutLogin.afterLogin === signoutLogin.before,
    JSON.stringify({ sameId: signoutLogin.afterLogin === signoutLogin.before, relogOk: signoutLogin.relogOk })
  );
  await openRacePanel(clientA.page);
  await openRacePanel(clientB.page);

  // ---- ROOM 1: full synchronized race --------------------------------------
  const created = await createRoomViaUi(clientA.page);
  record('A created a room via the real CREATE ROOM control', created.ok, JSON.stringify({ ok: created.ok, roomId: created.roomId }));
  if (!created.ok) throw new Error('cannot continue without a room');

  const joined = await joinRoomViaUi(clientB.page, created.inviteCode);
  record('B joined by invite code via the real UI', joined.ok, JSON.stringify(joined));

  await clientB.page.evaluate(() => {
    const game = window.game;
    const original = game.loadPresetTrack.bind(game);
    let delayed = false;
    game.loadPresetTrack = async (...params) => {
      if (!delayed) { delayed = true; await new Promise((resolve) => setTimeout(resolve, 12000)); }
      return original(...params);
    };
  });
  const readyA = await pressLobbyReady(clientA.page);
  await sleep(400);
  const readyB = await pressLobbyReady(clientB.page);
  record('both pressed the real LOBBY READY button', readyA && readyB, JSON.stringify({ readyA, readyB }));
  const slowLoader = await waitFor(() => clientA.page.evaluate(() => {
    const h = window.__playheadHarness;
    const room = h.raceRoomService.getRoom();
    const players = h.raceRoomService.getPlayers();
    const me = players.find((p) => p.userId === h.authService.getUserId());
    const rival = players.find((p) => p.userId !== h.authService.getUserId());
    return room?.state === 'LOADING' && me?.loaded && rival && !rival.loaded
      ? { phase: room.state, startAtMs: room.startAtMs, localLoaded: me.loaded, rivalLoaded: rival.loaded } : null;
  }), { timeout: 18000, label: 'loaded A waiting for delayed B' });
  record('fast loader waits without a countdown until delayed client actually loads', slowLoader.startAtMs === null, JSON.stringify(slowLoader));

  const loadouts = await waitFor(async () => {
    const list = await clientA.page.evaluate(() =>
      window.__playheadHarness.raceRoomService.getPlayers().map((p) => p.loadout)
    );
    return list.length >= 2 && list.every((l) => l && typeof l.knifeId === 'string') ? list : null;
  }, { timeout: 30000, label: 'loadout metadata on both rows' });
  record('race player rows carry locked knife/glove loadout metadata', true, JSON.stringify(loadouts));

  const phases = [];
  const reached = await waitFor(async () => {
    const sa = await roomState(clientA.page);
    if (sa && phases[phases.length - 1] !== sa.state) phases.push(sa.state);
    return sa && (sa.state === 'IN_GAME' || sa.state === 'COUNTDOWN' || sa.state === 'RUNNING');
  }, { timeout: 90000, label: 'room to reach IN_GAME' });
  record('room advanced past LOBBY without EXEC SONG', reached, phases.join(' -> '));

  const ghosts = await waitFor(async () => {
    const a = await clientA.page.evaluate(() => window.__playheadHarness.raceRoomService.getGhostDiagnostics());
    const b = await clientB.page.evaluate(() => window.__playheadHarness.raceRoomService.getGhostDiagnostics());
    return a.rxCount > 0 && b.rxCount > 0 ? { a, b } : null;
  }, { timeout: 60000, label: 'both clients receiving ghost transforms' });
  record('opponent ghost transforms received on BOTH clients', true, JSON.stringify({ a: ghosts.a.rxCount, b: ghosts.b.rxCount }));

  const snapA0 = await harnessSnapshot(clientA.page);
  record(
    'A race ghost is a REAL attached visible mesh with a sampled position',
    !!snapA0.ghost && snapA0.ghost.attached === true && snapA0.ghost.hasTarget === true &&
      snapA0.ghost.visible === true && snapA0.ghost.childCount > 0,
    JSON.stringify({
      attached: snapA0.ghost?.attached,
      visible: snapA0.ghost?.visible,
      childCount: snapA0.ghost?.childCount,
      rxPosition: snapA0.ghost?.rxPosition,
      staging: snapA0.ghostStagingOffset
    })
  );
  await shot(clientA.page, 'A-1-opponent-visible');

  // ---- SLOW LOADER: delay B's map load BEFORE B presses in-game READY ------
  await clientA.page.keyboard.press('Space');
  await waitFor(() => clientA.page.evaluate(() => {
    const h = window.__playheadHarness;
    return h.raceRoomService.getPlayers().find((p) => p.userId === h.authService.getUserId())?.inGameReady;
  }), { label: 'A second ready confirmed by server' });
  await sleep(1000);

  const aWaiting = await waitFor(async () => {
    const sa = await roomState(clientA.page);
    const snap = await harnessSnapshot(clientA.page);
    if (sa && sa.state === 'IN_GAME' && snap.racePhase !== 'COUNTDOWN' && snap.racePhase !== 'RACING') {
      return { sa, phase: snap.racePhase };
    }
    return null;
  }, { timeout: 10000, interval: 250, label: 'A to hold in IN_GAME while B loads' });
  record('one in-game READY still waits with no countdown', aWaiting.sa.startAtMs === null, JSON.stringify(aWaiting));
  await shot(clientA.page, 'A-2-waiting-for-slow-loader');
  await clientB.page.keyboard.press('Space');

  const countdown = await waitFor(async () => {
    const sa = await roomState(clientA.page);
    const sb = await roomState(clientB.page);
    if (sa && sb && sa.state === 'COUNTDOWN' && sa.startAtMs && sb.startAtMs) return { sa, sb };
    return null;
  }, { timeout: 60000, label: 'COUNTDOWN with a shared start_at_ms' });
  record('COUNTDOWN with ONE shared start_at_ms on both clients', countdown.sa.startAtMs === countdown.sb.startAtMs, String(countdown.sa.startAtMs));

  const running = await waitFor(async () => {
    const sa = await harnessSnapshot(clientA.page);
    const sb = await harnessSnapshot(clientB.page);
    const ra = await roomState(clientA.page);
    const rb = await roomState(clientB.page);
    return sa.racePhase === 'RACING' && sb.racePhase === 'RACING' && ra?.state === 'RUNNING' && rb?.state === 'RUNNING' ? { sa, sb } : null;
  }, { timeout: 30000, label: 'both clients RACING' });
  record(
    'BOTH clients are RACING in the PLAYING state',
    running.sa.state === 'PLAYING' && running.sb.state === 'PLAYING',
    JSON.stringify({ a: { phase: running.sa.racePhase, state: running.sa.state }, b: { phase: running.sb.racePhase, state: running.sb.state } })
  );
  record(
    'audio clock and run timer are approx the shared elapsed clock on BOTH clients',
    Math.abs(running.sa.songTimeSec - running.sa.elapsedSec) < 1.5 &&
      Math.abs(running.sb.songTimeSec - running.sb.elapsedSec) < 1.5,
    JSON.stringify({
      a: { song: running.sa.songTimeSec, elapsed: running.sa.elapsedSec },
      b: { song: running.sb.songTimeSec, elapsed: running.sb.elapsedSec }
    })
  );
  await shot(clientA.page, 'A-3-racing');
  await shot(clientB.page, 'B-3-racing');

  // MOVEMENT SAMPLE: move A locally, prove the live ghost position changes.
  const before = await pollLiveGhost(clientB.page, 1400);
  await clientA.page.keyboard.down('KeyW');
  await sleep(1600);
  await clientA.page.keyboard.up('KeyW');
  const after = await pollLiveGhost(clientB.page, 1400);
  const moved = after?.ghost?.rxPosition && before?.ghost?.rxPosition
    ? Math.hypot(
        after.ghost.rxPosition.x - before.ghost.rxPosition.x,
        after.ghost.rxPosition.y - before.ghost.rxPosition.y,
        after.ghost.rxPosition.z - before.ghost.rxPosition.z
      )
    : 0;
  record('live remote ghost position follows the opponent moving', moved > 0.25, 'deltaM=' + moved.toFixed(3));

  // FINISH: explicit controlled session reports (never a ranked submission).
  const finish = await clientA.page.evaluate(async () => {
    const svc = window.__playheadHarness.raceRoomService;
    await svc.reportAttemptStart();
    await svc.reportFinish(1);
    return { players: svc.getPlayers().map((p) => ({ id: p.userId, finish: p.finishCount, best: p.sessionBestUs })) };
  });
  await clientB.page.evaluate(async () => {
    const svc = window.__playheadHarness.raceRoomService;
    await svc.reportAttemptStart();
    await svc.reportFinish(1);
  });
  const finishedPlayers = await waitFor(() => clientA.page.evaluate(() => {
    const players = window.__playheadHarness.raceRoomService.getPlayers();
    return players.length === 2 && players.every((p) => p.finishCount === 1 && p.sessionBestUs > 1000000)
      ? players.map((p) => ({ finish: p.finishCount, timeUs: p.sessionBestUs })) : null;
  }), { label: 'both authoritative finish reports arrive' });
  record('controlled finishes recorded once using shared race epoch (no ranked submission)', true, JSON.stringify(finishedPlayers));
  const resultRows = await clientA.page.evaluate(() => window.__playheadHarness.raceRoomService.finishSession());
  record('shared result table resolves from both accepted finishes', resultRows.length === 2 && resultRows.every((r) => r.sessionBestUs > 0) && resultRows.some((r) => r.outcome === 'WIN'), JSON.stringify(resultRows));
  await shot(clientA.page, 'A-4-after-finish');

  const execNotice = await clientA.page.evaluate(() => document.body.innerText.includes('EXEC SONG'));
  record('no EXEC SONG step is ever shown', !execNotice, String(execNotice));

  // ---- ROOM 2: disconnect before GO releases the survivor ------------------
  await standDown(clientA.page);
  await standDown(clientB.page);
  await sleep(900);

  const created2 = await createRoomViaUi(clientA.page);
  record('A created a second room for the disconnect test', created2.ok, JSON.stringify(created2));
  if (created2.ok) {
    const joined2 = await joinRoomViaUi(clientB.page, created2.inviteCode);
    record('B joined the second room', joined2.ok, JSON.stringify(joined2));
    await pressLobbyReady(clientA.page);
    await sleep(300);
    await pressLobbyReady(clientB.page);
    await clientB.page.close();
    const released = await waitFor(async () => {
      const sa = await roomState(clientA.page);
      return sa && sa.state === 'LOBBY' ? sa : null;
    }, { timeout: 60000, label: 'survivor room to revert to LOBBY after B vanished' });
    record('disconnect-before-start released the survivor (room reverted to LOBBY)', !!released, JSON.stringify(released));
    await shot(clientA.page, 'A-5-survivor-released');
  }
  // Disposable account fixture: cloud-owned ordinary cosmetics, never a WR/run.
  const seeded = await clientA.page.evaluate(async () => {
    const h = window.__playheadHarness;
    const client = h.cloudProgression.onlineClient.getClient();
    const {error} = await client.rpc('sync_progression', {
      p_equipped_knife: 'ASTRAL', p_equipped_glove: 'DROP_GLOVE_CREME',
      p_awarded_rank_keys: [], p_pending_drop_ranks: [],
      p_reward_owned_skin_ids: ['ASTRAL', 'DROP_GLOVE_CREME'],
      p_custom_claims: [], p_first_migration: false
    });
    if(error) return {ok:false,detail:error.message};
    const {KarambitSkinSystem}=await import('/src/viewmodel/KarambitSkinSystem.ts');
    const {MasteryGloveSystem}=await import('/src/mastery/MasteryGloveSystem.ts');
    KarambitSkinSystem.getInstance().applyCloudProgression({rewardOwnedSkinIds:['ASTRAL','DROP_GLOVE_CREME']});
    KarambitSkinSystem.getInstance().equipSkin('ASTRAL');
    MasteryGloveSystem.getInstance().equipAnyGlove('DROP_GLOVE_CREME');
    while(h.cloudProgression.isSyncing()) await new Promise(r=>setTimeout(r,100));
    const status=await h.cloudProgression.sync();
    return {ok:status==='SYNCED'||status==='MIGRATED',detail:status};
  });
  record('disposable account cloud loadout fixture saved without ranked data', seeded.ok, seeded.detail);
  const fresh = await newClient('fresh-A');
  const restored = await fresh.page.evaluate(async (c) => {
    const h = window.__playheadHarness;
    const res = await h.authService.loginAccount(c.username, c.password);
    while(h.cloudProgression.isSyncing()) await new Promise(r=>setTimeout(r,100));
    const status = await h.cloudProgression.sync();
    return {ok:res.ok, status, snapshot:h.cloudProgression.snapshotLocal()};
  }, credsA);
  record('fresh browser restores cloud knife, drop glove ownership and both equips',
    restored.ok && restored.snapshot.equippedSkinId === 'ASTRAL' && restored.snapshot.equippedGloveId === 'DROP_GLOVE_CREME' && restored.snapshot.rewardOwnedSkinIds.includes('ASTRAL') && restored.snapshot.rewardOwnedSkinIds.includes('DROP_GLOVE_CREME'),
    JSON.stringify({status:restored.status, knife:restored.snapshot.equippedSkinId, glove:restored.snapshot.equippedGloveId, owned:restored.snapshot.rewardOwnedSkinIds}));
  const replay = await fresh.page.evaluate(async () => {
    const h = window.__playheadHarness;
    const client = h.cloudProgression.onlineClient.getClient();
    const {data,error} = await client.from('leaderboard_runs').select('id').eq('verification_state','accepted').not('replay_path','is',null).limit(1);
    if(error) return {ok:false,detail:error.message};
    if(!data?.length) return {unavailable:true};
    const {replayStorageService} = await import('/src/online/ReplayStorageService.ts');
    const {decodePovReplay} = await import('/src/replay/pov/PovReplayFormat.ts');
    const fetched=await replayStorageService.fetchReplayForRun(data[0].id);
    if(!fetched.ok) return {ok:false,detail:fetched.detail};
    const decoded=decodePovReplay(fetched.payload);
    return {ok:decoded.ok,detail:decoded.ok?'accepted replay fetched and decoded':decoded.detail};
  });
  if(replay.unavailable) console.log('LIMITATION: no accepted run with a replay exists to exercise leaderboard retrieval');
  else record('existing accepted leaderboard replay downloads and decodes through deployed endpoint', replay.ok, replay.detail);
  await fresh.page.evaluate(async () => {
    const {KarambitSkinSystem}=await import('/src/viewmodel/KarambitSkinSystem.ts');
    const {MasteryGloveSystem}=await import('/src/mastery/MasteryGloveSystem.ts');
    KarambitSkinSystem.getInstance().equipSkin('SIGNAL_CYAN');
    MasteryGloveSystem.getInstance().equipAnyGlove('STANDARD_ISSUE');
  });
  const savedDefaults = await waitFor(() => fresh.page.evaluate(async () => {
    const h=window.__playheadHarness;
    const {data}=await h.cloudProgression.onlineClient.getClient().from('player_progress').select('equipped_knife,equipped_glove').eq('user_id',h.authService.getUserId()).single();
    return data?.equipped_knife==='SIGNAL_CYAN' && data?.equipped_glove==='STANDARD_ISSUE' ? data : null;
  }), {label:'real equip changes automatically saved'});
  record('real knife/glove equipment changes save automatically', !!savedDefaults, JSON.stringify(savedDefaults));
  await fresh.page.evaluate(async () => {
    const {KarambitSkinSystem}=await import('/src/viewmodel/KarambitSkinSystem.ts');
    const {MasteryGloveSystem}=await import('/src/mastery/MasteryGloveSystem.ts');
    KarambitSkinSystem.getInstance().equipSkin('ASTRAL');
    MasteryGloveSystem.getInstance().equipAnyGlove('DROP_GLOVE_CREME');
  });
  const savedOwned = await waitFor(() => fresh.page.evaluate(async () => {
    const h=window.__playheadHarness;
    const {data}=await h.cloudProgression.onlineClient.getClient().from('player_progress').select('equipped_knife,equipped_glove').eq('user_id',h.authService.getUserId()).single();
    return data?.equipped_knife==='ASTRAL' && data?.equipped_glove==='DROP_GLOVE_CREME' ? data : null;
  }), {label:'owned equip changes automatically saved'});
  record('later sync preserves newly selected owned loadout', !!savedOwned, JSON.stringify(savedOwned));

  await fresh.context.close();

} catch (err) {
  record('harness completed without an unexpected error', false, err instanceof Error ? err.message : String(err));
} finally {
  await browser.close().catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log('');
console.log('EVIDENCE: screenshots in ' + shotDir);
console.log('SUMMARY: ' + (results.length - failed.length) + '/' + results.length + ' checks passed');
process.exit(failed.length === 0 ? 0 : 1);
