// =============================================================================
// two-browser friend-race INTEGRATION harness (puppeteer-core)
// =============================================================================
//
// Root runs this AFTER migrations + functions are deployed and the app is served:
//
//   node tests/integration/online-race-2.mjs --url http://localhost:3000 --exec <edge.exe>
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


const clients = [];
const count = Number(args.players ?? 2);
async function allStates() { return Promise.all(clients.map(c => roomState(c.page))); }
async function allSnaps() { return Promise.all(clients.map(c => harnessSnapshot(c.page))); }
try {
  for (let i=0; i<count; i++) {
    const c = await newClient(String(i)); clients.push(c);
    c.errors=[]; c.page.on('pageerror', e=>c.errors.push(e.message));
    const registered = await signUp(c.page, randomCredentials('r'+i));
    if (!registered.ok) throw new Error('account bootstrap: '+registered.detail);
    await openRacePanel(c.page);
  }
  await clients[0].page.evaluate(n => { document.querySelector('#race-capacity-select').value=String(n); }, count===2?4:count);
  if(args.late==='true')await clients[count-1].page.evaluate(()=>{const original=Date.now;Date.now=()=>original()+5000;const g=window.game,o=g.armRaceGo.bind(g);g.armRaceGo=(at)=>{setTimeout(()=>o(at),6500);};});
  const created = await createRoomViaUi(clients[0].page);
  if (!created.ok) throw new Error('create failed '+created.detail);
  record('real UI creates room, four default for two-client run',true,JSON.stringify(created));
  for (const c of clients.slice(1)) {
    const joined=await joinRoomViaUi(c.page,created.inviteCode.toLowerCase());
    if (!joined.ok) throw new Error('join failed '+joined.detail);
  }
  await waitFor(()=>clients[0].page.evaluate(n=>window.__playheadHarness.raceRoomService.getPlayers().filter(p=>p.connected).length===n,count),{label:'full roster'});
  record('all stable user IDs joined shared room',true,String(count));
  await shot(clients[0].page,'race2-'+count+'-lobby');
  if(args.capacityOnly==='true') {
    record('eight capacity sanity (membership only, no race)',true,String(count));
  } else {
    await clients[count-1].page.evaluate(()=>{
      const g=window.game, original=g.loadPresetTrack.bind(g); let delayed=false;
      g.loadPresetTrack=async(...p)=>{if(!delayed){delayed=true;await new Promise(r=>setTimeout(r,12000));}return original(...p);};
    });
    for (const c of clients) {if(!await pressLobbyReady(c.page))throw new Error('lobby ready missing');}
    const waiting=await waitFor(()=>clients[0].page.evaluate(()=>{
      const s=window.__playheadHarness.raceRoomService, p=s.getPlayers();
      return s.getRoom()?.state==='LOADING'&&p.some(x=>x.loaded)&&p.some(x=>!x.loaded)?{state:s.getRoom().state,startAt:s.getRoom().startAtMs}:null;
    }),{timeout:35000,label:'unequal map loads'});
    record('unequal loads hold GO',waiting.startAt===null,JSON.stringify(waiting));
    await waitFor(async()=> (await allStates()).every(x=>x?.state==='IN_GAME'),{timeout:120000,label:'all loaded IN_GAME'});
    await waitFor(async()=> (await allSnaps()).every(s=>(s.ghosts?.length??(s.ghost?1:0))>=count-1),{timeout:40000,label:'all remote renderers'});
    await shot(clients[0].page,'race2-'+count+'-waiting');
    for(const c of clients.slice(0,-1))await c.page.keyboard.press('Space');
    await sleep(1200);
    const partial=await allStates();
    record('partial in-game ready cannot start',partial.every(s=>s.state==='IN_GAME'&&s.startAtMs===null),JSON.stringify(partial.map(s=>s.state)));
    await clients[count-1].page.keyboard.press('Space');
    const countdown=await waitFor(async()=>{const s=await allStates();return s.every(x=>x?.startAtMs)&&s.every(x=>x.startAtMs===s[0].startAtMs)?s:null;},{timeout:30000,label:'one shared GO'});
    record('one shared start epoch',true,String(countdown[0].startAtMs));
    await waitFor(async()=> (await allSnaps()).every(s=>s.racePhase==='RACING'),{timeout:30000,label:'all clients RACING'});
    const timed=await allSnaps();
    const performanceSamples = await Promise.all(clients.map(c => c.page.evaluate(async () => {
      const samples = []; let previous = performance.now();
      await new Promise(resolve => {
        const deadline = previous + 2000;
        const frame = now => { samples.push(now-previous); previous=now; if(now<deadline)requestAnimationFrame(frame);else resolve(); };
        requestAnimationFrame(frame);
      });
      samples.sort((a,b)=>a-b);
      const g=window.game;
      return {medianFrameMs:samples[Math.floor(samples.length*.5)],p95FrameMs:samples[Math.floor(samples.length*.95)],fps:g.smoothedFps,remoteRacers:g.raceGhosts.getCount(),rendererMemory:g.environment.renderer.info.memory};
    })));
    record('local headless performance observed (measurement, no hardware guarantee)',true,JSON.stringify(performanceSamples));
    record('actual audio aligns to shared elapsed',timed.every(s=>Math.abs(s.songTimeSec-s.elapsedSec)<1.5),JSON.stringify(timed.map(s=>({song:s.songTimeSec,elapsed:s.elapsedSec,ghosts:s.ghosts?.length}))));
    if(args.late==='true')record('late GO seeks shared position despite five-second local clock skew',timed[count-1].songTimeSec>2&&Math.abs(timed[count-1].serverOffsetMs+5000)<500,JSON.stringify({song:timed[count-1].songTimeSec,offset:timed[count-1].serverOffsetMs}));
    await shot(clients[0].page,'race2-'+count+'-racing');
    // Controlled lifecycle finish only; onRaceFinish bypasses ranked PB/leaderboard submission.
    await clients[0].page.evaluate(()=>window.game.onRaceFinish());
    await waitFor(()=>clients[0].page.evaluate(()=>window.__playheadHarness.raceRoomService.getPlayers().find(p=>p.userId===window.__playheadHarness.authService.getUserId())?.finished),{label:'first finish'});
    const ongoing=await allStates();
    record('first finisher does not end other races',ongoing.every(s=>s.state==='RUNNING'),JSON.stringify(ongoing.map(s=>s.state)));
    await shot(clients[0].page,'race2-'+count+'-spectating');
    for(const c of clients.slice(1)){await sleep(500);await c.page.evaluate(()=>window.game.onRaceFinish());}
    await waitFor(async()=> (await allStates()).every(s=>s?.state==='FINISHED'),{label:'all results final'});
    await waitFor(()=>clients[0].page.evaluate(n=>{const p=window.__playheadHarness.raceRoomService.getPlayers();return p.length===n&&p.every(x=>x.finished&&x.finishUs>0);},count),{label:'all finish rows refreshed'});
    const frozen=await clients[0].page.evaluate(()=>window.__playheadHarness.raceRoomService.getPlayers().map(p=>({id:p.userId,time:p.finishUs,finished:p.finished})).sort((a,b)=>a.id.localeCompare(b.id)));
    record('immutable server finishes recorded',frozen.every(p=>p.finished&&p.time>0),JSON.stringify(frozen));
    await clients[0].page.evaluate(()=>window.__playheadHarness.raceRoomService.reportFinish());
    await sleep(500);
    const duplicate=await clients[0].page.evaluate(()=>window.__playheadHarness.raceRoomService.getPlayers().slice().sort((a,b)=>a.userId.localeCompare(b.userId)).map(p=>p.finishUs));
    record('duplicate finish cannot change times',JSON.stringify(duplicate)===JSON.stringify(frozen.map(p=>p.time)));
    await shot(clients[0].page,'race2-'+count+'-results');
    const before=await clients[0].page.evaluate(()=>window.__playheadHarness.raceRoomService.getRoom().raceId);
    const rematch=await clients[0].page.evaluate(()=>window.__playheadHarness.raceRoomService.requestRematch());
    if(!rematch.ok)throw new Error('rematch '+rematch.detail);
    await waitFor(()=>clients[0].page.evaluate(old=>{const s=window.__playheadHarness.raceRoomService;return s.getRoom()?.state==='LOBBY'&&s.getRoom()?.raceId!==old&&s.getPlayers().every(p=>!p.ready&&!p.loaded&&!p.inGameReady&&!p.finished&&p.finishUs===null);},before),{label:'rematch reset'});
    record('rematch new ID and clean readiness/finishes',true);
    const stale = await clients[0].page.evaluate(async old => {
      
      const client=window.__playheadHarness.raceRoomService.onlineClient.getClient();
      const room=window.__playheadHarness.raceRoomService.getRoom();
      const checks=[
        ['race_set_ready_v2',{p_ready:true}],
        ['race_report_loaded_v2',{p_loaded:true}],
        ['race_set_in_game_ready_v2',{p_ready:true}],
        ['race_mark_running_v2',{}],
        ['race_report_finish_v2',{}],
        ['race_report_dnf_v2',{}],
        ['race_report_progress_v2',{p_checkpoint:99}],
        ['race_request_rematch_v2',{}]
      ];
      const out=[];
      for(const [name,extra] of checks){const r=await client.rpc(name,{p_room_id:room.id,p_race_id:old,...extra});out.push({name,rejected:!!r.error,detail:r.error?.message});}
      return out;
    },before);
    record('old race writes rejected after rematch',stale.every(x=>x.rejected),JSON.stringify(stale));
    const direct = await clients[0].page.evaluate(async()=>{
      
      const c=window.__playheadHarness.raceRoomService.onlineClient.getClient(),h=window.__playheadHarness;
      const r=await c.from('race_room_players').update({finish_us:1,finished:true}).eq('room_id',h.raceRoomService.getRoom().id).eq('user_id',h.authService.getUserId()).select();
      return {rejected:!!r.error,detail:r.error?.message};
    });
    record('direct fabricated finish blocked',direct.rejected,JSON.stringify(direct));
  }
  record('no browser exceptions',clients.every(c=>c.errors.length===0),JSON.stringify(clients.map(c=>c.errors)));
} catch(e) { record('integration completed',false,e.stack); process.exitCode=1; }
finally {
  for(const c of clients){try{await standDown(c.page);}catch{}}
  fs.mkdirSync(shotDir,{recursive:true});
  fs.writeFileSync(path.join(shotDir,'race2-'+count+'-checks.json'),JSON.stringify(results,null,2));
  await browser.close();
}
if(results.some(r=>!r.ok))process.exitCode=1;



