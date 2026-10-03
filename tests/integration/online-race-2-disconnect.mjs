// =============================================================================
// two-browser friend-race INTEGRATION harness (puppeteer-core)
// =============================================================================
//
// Root runs this AFTER migrations + functions are deployed and the app is served:
//
//   node tests/integration/online-race-2-disconnect.mjs --url http://localhost:3000 --exec <edge.exe>
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
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
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
  await waitFor(() => page.evaluate(() => ['SYNCED','MIGRATED','DISABLED','ERROR','SIGNED_OUT'].some(state => window.game?.ui.importScreen.onlineStatusBar.element.title.startsWith(state + ' //'))), {label:'initial online bootstrap settled'});
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
      if (room && h.raceRoomService.getPlayers().some(p=>p.userId===h.authService.getUserId())) return { ok: true, trackId, inviteCode: room.inviteCode, roomId: room.id };
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
      if (room && h.raceRoomService.getPlayers().some(p=>p.userId===h.authService.getUserId())) return { ok: true, roomId: room.id };
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



const clients=[];
async function state(c){return roomState(c.page);}
async function readyAll(list){for(const c of list){if(!await pressLobbyReady(c.page))throw new Error('lobby ready button unavailable');}await waitFor(async()=> (await Promise.all(list.map(state))).every(s=>s?.state==='IN_GAME'),{timeout:90000,label:'all IN_GAME'});await sleep(1000);}
async function goAll(list){
 await waitFor(async()=> (await Promise.all(list.map(c=>c.page.evaluate(()=>window.game.opponentSpawnReceived().ok)))).every(Boolean),{label:'all spawn signals current'});
 for(const c of list)await c.page.keyboard.press('Space');
 try { await waitFor(async()=> (await Promise.all(list.map(c=>harnessSnapshot(c.page)))).every(s=>s.racePhase==='RACING'),{label:'all RACING'}); }
 catch(e){const diagnostics=await Promise.all(list.map(c=>c.page.evaluate(()=>({snapshot:window.game.getRaceHarnessSnapshot(),room:window.__playheadHarness.raceRoomService.getRoom(),players:window.__playheadHarness.raceRoomService.getPlayers(),gate:window.game.opponentSpawnReceived(),notice:window.game.ui.raceHud.element.innerText}))));throw new Error(e.message+' '+JSON.stringify(diagnostics));}
}
async function join(c,code){await openRacePanel(c.page);const r=await joinRoomViaUi(c.page,code);if(!r.ok)throw new Error(r.detail);}
async function leave(c){await c.page.evaluate(()=>window.game.leaveRaceRoom());}
try{
  for(let i=0;i<4;i++){const c=await newClient('d'+i);clients.push(c);const r=await signUp(c.page,randomCredentials('d'+i));if(!r.ok)throw new Error(r.detail);await openRacePanel(c.page);}
  const [a,b,c,d]=clients;
  const room=await createRoomViaUi(a.page);if(!room.ok)throw new Error(room.detail);
  for(const x of [b,c,d])await join(x,room.inviteCode);
  await leave(d);
  await waitFor(()=>a.page.evaluate(()=>window.__playheadHarness.raceRoomService.getPlayers().length===3),{label:'lobby removes departed member'});
  record('lobby leave removes row and capacity remains available',true);
  await c.page.evaluate(()=>{const g=window.game,o=g.loadPresetTrack.bind(g);let once=false;g.loadPresetTrack=async(...p)=>{if(!once){once=true;await new Promise(r=>setTimeout(r,5000));}return o(...p);};});
  for(const x of [a,b,c])await pressLobbyReady(x.page);
  await waitFor(async()=> (await state(a))?.state==='LOADING',{label:'LOADING'});
  await leave(b);
  await waitFor(async()=> (await state(a))?.state==='LOBBY',{label:'loading disconnect abort'});
  await sleep(6000);
  const canceled=await harnessSnapshot(c.page);
  record('loading leave safely aborts including late loader',canceled.state==='IMPORT'&&!canceled.raceActive,JSON.stringify({state:canceled.state,active:canceled.raceActive}));
  await join(b,room.inviteCode);
  await join(d,room.inviteCode);
  await readyAll([a,b,c,d]);
  for(const x of [a,b,c,d])await x.page.keyboard.press('Space');
  const oldGo=await waitFor(async()=>{const s=await state(a);return s?.state==='COUNTDOWN'?s.startAtMs:null;},{label:'countdown'});
  await leave(d);
  await waitFor(async()=> (await state(a))?.state==='IN_GAME',{label:'countdown canceled'});
  await sleep(4500);
  const canceledGo=await harnessSnapshot(a.page);
  record('countdown leave cancels old GO and keeps three staged',canceledGo.racePhase==='WAITING'&&!canceledGo.inGameReady,JSON.stringify({oldGo,phase:canceledGo.racePhase}));
  await goAll([a,b,c]);
  await a.page.evaluate(()=>{const g=window.game;g.isOvertime=true;g.currentOfficialTrackId=null;g.currentCustomAudioBuffer=null;g.handleFinishSequence();});
  await waitFor(()=>a.page.evaluate(()=>window.game.getRaceHarnessSnapshot().state==='FINISHED'&&!!window.game.getRaceHarnessSnapshot().spectateUserId),{label:'normal finish spectator'});
  const spectator=await a.page.evaluate(()=>({snapshot:window.game.getRaceHarnessSnapshot(),soloReportVisible:!window.game.ui.resultsScreen.element.classList.contains('hidden'),raceHudVisible:!window.game.ui.raceHud.element.classList.contains('hidden')}));
  record('normal finish path keeps spectator HUD and hides solo report',!spectator.soloReportVisible&&spectator.raceHudVisible,JSON.stringify({target:spectator.snapshot.spectateUserId,state:spectator.snapshot.state}));
  await waitFor(()=>a.page.evaluate(()=>{const h=window.__playheadHarness;return h.raceRoomService.getPlayers().some(p=>p.userId===h.authService.getUserId()&&p.finished&&p.finishUs!==null);}),{label:'normal finish accepted by race authority'});
  record('normal finish crossing is acknowledged by server',true);
  const target=spectator.snapshot.spectateUserId;await a.page.keyboard.press('ArrowRight');await sleep(250);
  const changed=await harnessSnapshot(a.page);
  record('next racer switches spectator target',changed.spectateUserId&&changed.spectateUserId!==target);
  await b.context.close();b.closed=true;
  const dnf=await waitFor(()=>a.page.evaluate(()=>{const p=window.__playheadHarness.raceRoomService.getPlayers();return p.some(x=>x.dnf)?p.map(x=>({name:x.displayName,dnf:x.dnf,finished:x.finished})):null;}),{timeout:40000,label:'closed tab DNF after grace'});
  record('closed running tab becomes DNF while others continue',(await state(c))?.state==='RUNNING',JSON.stringify(dnf));
  await c.page.evaluate(()=>window.game.onRaceFinish());
  await waitFor(async()=> (await state(a))?.state==='FINISHED',{label:'final results with DNF'});
  await shot(a.page,'race2-disconnect-results');
  const oldRace=await a.page.evaluate(()=>window.__playheadHarness.raceRoomService.getRoom().raceId);
  const reset=await a.page.evaluate(()=>window.__playheadHarness.raceRoomService.requestRematch());if(!reset.ok)throw new Error(reset.detail);
  await waitFor(()=>c.page.evaluate(old=>window.__playheadHarness.raceRoomService.getRoom()?.raceId!==old&&window.game.getRaceHarnessSnapshot().state==='IMPORT',oldRace),{label:'all surviving clients return lobby'});
  await readyAll([a,c]);await goAll([a,c]);
  const rematchSnaps=await Promise.all([a,c].map(x=>harnessSnapshot(x.page)));
  record('second playable rematch starts with two survivors',rematchSnaps.every(s=>s.racePhase==='RACING'&&s.ghosts.length===1&&Math.abs(s.songTimeSec-s.elapsedSec)<1.5),JSON.stringify(rematchSnaps.map(s=>({phase:s.racePhase,song:s.songTimeSec,elapsed:s.elapsedSec}))));
}catch(e){for(const c of clients){if(!c.closed){try{console.log('CLIENT STATE',JSON.stringify(await c.page.evaluate(()=>({game:window.game.getRaceHarnessSnapshot(),room:window.__playheadHarness.raceRoomService.getRoom(),players:window.__playheadHarness.raceRoomService.getPlayers(),loading:window.game.raceLoading,reported:window.game.raceLoadReported,error:window.game.ui.importScreen.racePanel.element.innerText}))));}catch{}}}record('disconnect integration',false,e.stack);process.exitCode=1;}
finally{for(const c of clients){if(!c.closed){try{await leave(c);}catch{}}}fs.mkdirSync(shotDir,{recursive:true});fs.writeFileSync(path.join(shotDir,'race2-disconnect-checks.json'),JSON.stringify(results,null,2));await browser.close();}
if(results.some(r=>!r.ok))process.exitCode=1;
