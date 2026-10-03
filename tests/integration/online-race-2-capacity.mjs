// =============================================================================
// two-browser friend-race INTEGRATION harness (puppeteer-core)
// =============================================================================
//
// Root runs this AFTER migrations + functions are deployed and the app is served:
//
//   node tests/integration/online-race-2-capacity.mjs --url http://localhost:3000 --exec <edge.exe>
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
try {
  for(let i=0;i<9;i++){const c=await newClient('cap'+i);clients.push(c);const r=await signUp(c.page,randomCredentials('cap'+i));if(!r.ok)throw new Error(r.detail);await openRacePanel(c.page);}
  const host=clients[0];await host.page.evaluate(()=>{document.querySelector('#race-capacity-select').value='8';});
  const room=await createRoomViaUi(host.page);if(!room.ok)throw new Error(room.detail);
  for(const c of clients.slice(1,7)){const r=await joinRoomViaUi(c.page,room.inviteCode);if(!r.ok)throw new Error(r.detail);}
  const raced=await Promise.all(clients.slice(7).map(c=>c.page.evaluate(code=>window.__playheadHarness.raceRoomService.joinByInviteCode(code),room.inviteCode)));
  record('two simultaneous joins compete for last eighth slot',raced.filter(r=>r.ok).length===1,JSON.stringify(raced.map(r=>({ok:r.ok,detail:r.detail}))));
  await waitFor(()=>host.page.evaluate(()=>window.__playheadHarness.raceRoomService.getPlayers().filter(p=>p.connected).length===8),{label:'eight connected'});
  const outsider=clients[7+raced.findIndex(r=>!r.ok)];
  const denied=await outsider.page.evaluate(async room=>{
    const client=window.__playheadHarness.raceRoomService.onlineClient.getClient();
    const direct=await client.from('race_rooms').select('id,invite_code').eq('id',room.id);
    const attempts=[];
    for(const name of ['race_mark_disconnected_v2','race_abandon_session_v2','race_report_dnf_v2','race_heartbeat_v2']){
      const r=await client.rpc(name,{p_room_id:room.id,p_race_id:room.raceId});attempts.push({name,rejected:!!r.error,detail:r.error?.message});
    }
    return {roomReadHidden:direct.data?.length===0,attempts};
  },raced.find(r=>r.ok).room);
  record('outsider cannot browse room or mutate its lifecycle',denied.roomReadHidden&&denied.attempts.every(r=>r.rejected),JSON.stringify(denied));
  await shot(host.page,'race2-eight-capacity');
}catch(e){record('capacity integration',false,e.stack);process.exitCode=1;}
finally{for(const c of clients){try{await standDown(c.page);}catch{}}fs.mkdirSync(shotDir,{recursive:true});fs.writeFileSync(path.join(shotDir,'race2-capacity-checks.json'),JSON.stringify(results,null,2));await browser.close();}
if(results.some(r=>!r.ok))process.exitCode=1;
