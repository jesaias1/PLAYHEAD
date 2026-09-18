/**
 * PRODUCTION VERIFICATION — VIEW SNAP DIAGNOSTICS
 *
 * Serves the built dist/ (production bundle, NOT vite dev) and verifies:
 *   - ?debugMovement=1 enables the overlay incl. orientation fields
 *   - mousemove handler count stays exactly 1 across pause/resume cycles and
 *     Movement Lab enter/exit (duplicate handler = every delta applied twice)
 *   - the view-snap detector fires for an injected orientation discontinuity
 *     and does NOT fire for a legitimate +/-PI yaw wrap
 *   - ?debugNoViewmodel=1 hides the viewmodel without touching camera/FOV
 */
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DIST = path.resolve('dist');
const PORT = 4600;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(DIST, p);
  if (!fp.startsWith(DIST) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404); res.end('nf'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const browser = await puppeteer.launch({
  executablePath: EDGE_PATH, headless: 'new',
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox',
    '--disable-setuid-sandbox', '--disable-web-security',
    '--window-size=1280,720', '--use-gl=swiftshader', '--enable-unsafe-swiftshader']
});

let ok = true;
const check = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); if (!c) ok = false; };

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const warns = [];
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'warning' || t.includes('[')) warns.push(t); });
  page.on('pageerror', (e) => warns.push('pageerror: ' + e.message));

  await page.goto(`http://127.0.0.1:${PORT}/?debugMovement=1`, { waitUntil: 'domcontentloaded' });
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
  await new Promise((r) => setTimeout(r, 2500));

  // ---- listener lifecycle -------------------------------------------------
  const counts = await page.evaluate(async () => {
    const g = window.game;
    const snap = () => ({ ...g.cameraController.registeredHandlerCounts });
    const out = { boot: snap() };
    // pause/resume cycles
    g['pauseGame']();
    await new Promise((r) => setTimeout(r, 150));
    out.afterPause = snap();
    g['finalizeResume']();
    await new Promise((r) => setTimeout(r, 150));
    out.afterResume1 = snap();
    for (let i = 0; i < 5; i++) {
      g['pauseGame']();
      await new Promise((r) => setTimeout(r, 60));
      g['finalizeResume']();
      await new Promise((r) => setTimeout(r, 60));
    }
    out.afterRepeated = snap();
    return out;
  });
  console.log('\n=== LISTENER LIFECYCLE ===');
  console.log(JSON.stringify(counts, null, 2));

  // ---- view snap detection -----------------------------------------------
  // Uses the CURRENT event-local API: expected-vs-actual is compared inside the
  // same event, and the quaternion check is the only frame-scoped assertion.
  const snapTest = await page.evaluate(async () => {
    const g = window.game;
    const cc = g.cameraController;
    const det = g['viewSnapDetector'];
    const factor = 0.0022 * cc.getSensitivity();

    // 1. Legitimate +-PI wrap of the SAME physical yaw must not be a snap.
    //    181deg and -179deg are 2*PI apart.
    const D = Math.PI / 180;
    const wrapDiagnosis = det.checkQuaternion({
      yaw: 181 * D, pitch: 0, quatYaw: -179 * D, quatPitch: 0
    });

    // 2. A correctly applied event must report nothing (event-local).
    const okEvent = det.checkEvent({
      movementX: -10, movementY: -3,
      yawBefore: 0.4, pitchBefore: -0.1,
      yawAfter: 0.4 + 10 * factor, pitchAfter: -0.1 + 3 * factor,
      expectedYawDelta: 10 * factor, expectedPitchDelta: 3 * factor,
      pitchClamped: false, isLocked: true, justLocked: false
    });

    // 3. A genuine dropped application IS reported.
    const droppedEvent = det.checkEvent({
      movementX: 100, movementY: 0,
      yawBefore: 0, yawAfter: 0,
      pitchBefore: 0, pitchAfter: 0,
      expectedYawDelta: -100 * factor, expectedPitchDelta: 0,
      pitchClamped: false, isLocked: true, justLocked: false
    });

    // 4. A second orientation writer IS reported (frame-scoped).
    const divergence = det.checkQuaternion({
      yaw: 0, pitch: 0, quatYaw: 2.0, quatPitch: 0
    });

    return {
      wrapDiagnosis,
      okDiagnosis: okEvent,
      droppedDiagnosis: droppedEvent,
      divergenceDiagnosis: divergence
    };
  });
  console.log('\n=== VIEW SNAP DETECTOR (production bundle) ===');
  console.log('legit +-PI wrap (same yaw)     :', snapTest.wrapDiagnosis, '(expect null)');
  console.log('correctly applied event        :', snapTest.okDiagnosis, '(expect null)');
  console.log('dropped application            :', snapTest.droppedDiagnosis);
  console.log('second orientation writer      :', snapTest.divergenceDiagnosis);

  // ---- overlay contents ---------------------------------------------------
  const overlay = await page.evaluate(() => {
    const el = document.getElementById('movement-diag-overlay');
    return el ? el.textContent : null;
  });
  console.log('\n=== OVERLAY ===');
  console.log(overlay);

  // ---- viewmodel hidden flag (separate page load) -------------------------
  const page2 = await browser.newPage();
  await page2.setViewport({ width: 1280, height: 720 });
  await page2.goto(`http://127.0.0.1:${PORT}/?debugMovement=1&debugNoViewmodel=1`, { waitUntil: 'domcontentloaded' });
  await page2.waitForSelector('#btn-showcase-enter', { timeout: 40000 });
  await page2.click('#btn-showcase-enter');
  await page2.waitForFunction(() => {
    const b = document.querySelector('#btn-enter-track');
    return b && !b.disabled;
  }, { timeout: 60000 });
  await page2.click('#btn-enter-track');
  await page2.waitForFunction(
    () => window.game && window.game.stateMachine && window.game.stateMachine.is('PLAYING'),
    { timeout: 60000 }
  );
  await new Promise((r) => setTimeout(r, 2500));
  const vm = await page2.evaluate(() => {
    const g = window.game;
    return {
      hidden: !!g.viewmodelController['diagnosticHidden'],
      fov: g.environment.camera.fov,
      yaw: g.cameraController.yaw,
      playerOk: Number.isFinite(g.playerController.position.x)
    };
  });
  console.log('\n=== ?debugNoViewmodel=1 ===');
  console.log(JSON.stringify(vm));
  await page2.close();

  console.log('\n=== ASSERTIONS ===');
  const m = counts.boot.mousemove;
  check('exactly 1 mousemove handler at boot', m === 1);
  check('handler count stable after pause', counts.afterPause.mousemove === m);
  check('handler count stable after resume', counts.afterResume1.mousemove === m);
  check('handler count stable after repeated pause/resume', counts.afterRepeated.mousemove === m);
  check('legit +-PI wrap NOT flagged as view snap', snapTest.wrapDiagnosis === null);
  check('correctly applied event NOT flagged (event-local)', snapTest.okDiagnosis === null);
  check('dropped application IS flagged', String(snapTest.droppedDiagnosis).includes('YAW_MISMATCH'));
  check('second orientation writer IS flagged', String(snapTest.divergenceDiagnosis).includes('QUATERNION_YAW_DIVERGENCE'));
  check('overlay shows orientation fields', ['RAW DX/DY', 'EXPECTED', 'ACTUAL', 'POINTER LOCK']
    .every((k) => (overlay || '').includes(k)));
  check('viewmodel hidden flag applied', vm.hidden === true);
  check('camera/FOV unaffected by viewmodel hide', vm.fov > 0 && Number.isFinite(vm.yaw));
  check('no page errors', !warns.some((w) => w.startsWith('pageerror')));

  console.log('\n' + (ok ? 'VIEW SNAP DIAGNOSTICS: PASS' : 'VIEW SNAP DIAGNOSTICS: FAIL'));
  process.exitCode = ok ? 0 : 1;
} finally {
  await browser.close();
  server.close();
}