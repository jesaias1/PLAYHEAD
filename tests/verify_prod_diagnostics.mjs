/**
 * PRODUCTION BUILD DIAGNOSTICS VERIFICATION
 *
 * Serves the built `dist/` (NOT the Vite dev server) and confirms that
 * ?debugMovement=1 activates the runtime diagnostics in the production bundle:
 *   - the on-screen overlay exists and shows BUILD/SPEED/PLAYER/...
 *   - a forced genuine void fall emits [PLAYHEAD RESTORE] with the full fields
 *   - ?debugMovement absent => overlay must NOT be created
 */
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DIST = path.resolve('dist');
const PORT = 4599;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(DIST, urlPath);
  if (!filePath.startsWith(DIST) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

await new Promise((r) => server.listen(PORT, r));
console.log(`[verify] serving dist/ on http://127.0.0.1:${PORT}`);

const browser = await puppeteer.launch({
  executablePath: EDGE_PATH, headless: 'new',
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox',
    '--disable-setuid-sandbox', '--disable-web-security',
    '--window-size=1280,720', '--use-gl=swiftshader', '--enable-unsafe-swiftshader']
});

async function runCase(enableFlag) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const warns = [];
  page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'warn') warns.push(m.text()); });
  page.on('pageerror', (e) => warns.push('pageerror: ' + e.message));

  const url = `http://127.0.0.1:${PORT}/` + (enableFlag ? '?debugMovement=1' : '');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btn-showcase-enter', { timeout: 40000 });
  await page.click('#btn-showcase-enter');
  await page.waitForFunction(() => {
    const b = document.querySelector('#btn-enter-track');
    return b && !b.disabled;
  }, { timeout: 60000 });
  await page.click('#btn-enter-track');
  await page.waitForFunction(
    () => window.game && window.game.stateMachine && window.game.stateMachine.is('PLAYING'),
    { timeout: 60000 }
  );
  await new Promise((r) => setTimeout(r, 3000));

  const overlayBefore = await page.evaluate(() => {
    const el = document.getElementById('movement-diag-overlay');
    return { present: !!el, text: el ? el.textContent : null };
  });

  // Force a genuine void fall: place the player below VOID_DEATH_Y.
  const forced = await page.evaluate(async () => {
    const g = window.game;
    const p = g.playerController;
    const voidY = p.authoritativeKillY;
    p.position.y = (voidY ?? -100) - 5;
    p.velocity.set(0, -50, 0);
    await new Promise((r) => setTimeout(r, 1200));
    return {
      voidY,
      restoreCount: p.restoreDiagnosticLogs.length,
      lastRestoreReason: g.lastRestoreReason,
      hasDiagnostic: !!g.lastRestoreDiagnostic
    };
  });

  await new Promise((r) => setTimeout(r, 600));
  const overlayAfter = await page.evaluate(() => {
    const el = document.getElementById('movement-diag-overlay');
    return { present: !!el, text: el ? el.textContent : null };
  });

  await page.close();
  return { overlayBefore, overlayAfter, forced, warns };
}

let ok = true;
try {
  // --- Case 1: flag ABSENT -> no overlay ---------------------------------
  const off = await runCase(false);
  console.log('\n=== CASE 1: no ?debugMovement (production build) ===');
  console.log('overlay present:', off.overlayBefore.present, '(expected false)');

  // --- Case 2: flag PRESENT -> overlay + restore log ---------------------
  const on = await runCase(true);
  console.log('\n=== CASE 2: ?debugMovement=1 (production build) ===');
  console.log('overlay present :', on.overlayBefore.present, '(expected true)');
  console.log('--- overlay content ---');
  console.log(on.overlayBefore.text);
  console.log('\nforced void fall => voidY =', on.forced.voidY,
    ' restoreLogs =', on.forced.restoreCount,
    ' lastRestoreReason =', on.forced.lastRestoreReason);
  console.log('\n--- overlay AFTER forced fall (LAST EVENT must persist) ---');
  console.log(on.overlayAfter.text);

  const restoreWarns = on.warns.filter((w) => w.includes('[PLAYHEAD RESTORE]'));
  console.log('\n--- console [PLAYHEAD RESTORE] lines ---');
  console.log(restoreWarns.length ? restoreWarns.join('\n') : '(NONE)');

  console.log('\n=== ASSERTIONS ===');
  const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) ok = false; };
  check('flag absent => no overlay', off.overlayBefore.present === false);
  check('flag present => overlay created', on.overlayBefore.present === true);
  check('overlay contains BUILD', (on.overlayBefore.text || '').includes('BUILD'));
  check('overlay contains SPEED/PLAYER/YAW/PITCH/FOV/VOID', ['SPEED', 'PLAYER', 'YAW', 'PITCH', 'FOV', 'VOID_Y']
    .every((k) => (on.overlayBefore.text || '').includes(k)));
  check('forced void fall produced a restore log entry', on.forced.restoreCount > 0);
  check('restore emitted [PLAYHEAD RESTORE] to console', restoreWarns.length > 0);
  check('restore reason is NORMAL_VOID', String(on.forced.lastRestoreReason) === 'NORMAL_VOID');
  check('LAST EVENT persisted after snap', (on.overlayAfter.text || '').includes('REASON') &&
    !(on.overlayAfter.text || '').includes('(no events yet)'));
  check('no page errors', !on.warns.some((w) => w.startsWith('pageerror')));

  console.log('\n' + (ok ? 'PRODUCTION DIAGNOSTICS: PASS' : 'PRODUCTION DIAGNOSTICS: FAIL'));
  process.exitCode = ok ? 0 : 1;
} finally {
  await browser.close();
  server.close();
}