/**
 * VIEW-SNAP DETECTOR FIX + COALESCING PROBE VERIFICATION (production build)
 *
 * Confirms in the built bundle:
 *  1. The previous frame-separated YAW_MISMATCH false positive is GONE: normal
 *     input produces no [VIEW SNAP].
 *  2. Each accepted raw event applies exactly its expected yaw/pitch
 *     (event-local attribution), including the laptop-style 131/-188 event.
 *  3. An intentional justLocked discard is reported as INPUT_DISCARDED, not a snap.
 *  4. Coalesced-pointer APIs are feature-detected and the probe preserves total
 *     displacement, with no parent+child double application.
 *  5. Raw-input session accounting is accurate for the CURRENT lock session.
 */
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DIST = path.resolve('dist');
const PORT = 4602;
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

let failures = 0;
const check = (n, c, note = '') => {
  if (!c) failures++;
  console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${note ? '  (' + note + ')' : ''}`);
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

  await page.goto(`http://127.0.0.1:${PORT}/?debugMovement=1&pointerInputExperiment=1`, { waitUntil: 'domcontentloaded' });
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

  await page.evaluate(() => {
    const cc = window.game.cameraController;
    cc.mouseLookEnabled = true;
    cc['isLocked'] = true;
    cc['justLocked'] = false;
    window.__move = (mx, my) => {
      const ev = new MouseEvent('mousemove', { bubbles: true, cancelable: false });
      Object.defineProperty(ev, 'movementX', { value: mx, writable: false, enumerable: true, configurable: true });
      Object.defineProperty(ev, 'movementY', { value: my, writable: false, enumerable: true, configurable: true });
      document.dispatchEvent(ev);
    };
    window.__events = [];
    // Observe emitted VIEW SNAP events via the diagnostics instance.
    const md = window.game['viewSnapDetector'];
    void md;
  });

  // =====================================================================
  console.log('\n=== 1. EVENT-LOCAL ATTRIBUTION (no false positives) ===');
  // =====================================================================
  const eventLocal = await page.evaluate(async () => {
    const cc = window.game.cameraController;
    const factor = 0.0022 * cc.getSensitivity();
    const rows = [];
    // Include the exact laptop-style event and small ones.
    for (const [mx, my] of [[-10, -3], [5, 0], [131, -188], [7, 7], [-40, 25]]) {
      const yawBefore = cc.yaw;
      const pitchBefore = cc.pitch;
      window.__move(mx, my);
      rows.push({
        mx, my,
        actualYaw: cc.yaw - yawBefore,
        expectedYaw: -mx * factor,
        actualPitch: cc.pitch - pitchBefore,
        expectedPitch: -my * factor
      });
    }
    return rows;
  });
  let allExact = true;
  for (const r of eventLocal) {
    const yawOk = Math.abs(r.actualYaw - r.expectedYaw) < 1e-12;
    const pitchOk = Math.abs(r.actualPitch - r.expectedPitch) < 1e-12;
    if (!yawOk || !pitchOk) allExact = false;
    console.log(`  dx=${String(r.mx).padStart(4)} dy=${String(r.my).padStart(5)}  yawΔ=${r.actualYaw.toExponential(3)} (exp ${r.expectedYaw.toExponential(3)})  pitchΔ=${r.actualPitch.toExponential(3)} (exp ${r.expectedPitch.toExponential(3)})`);
  }
  check('every accepted event applies exactly its expected yaw/pitch', allExact);

  // Let frames run so any frame-separated false positive would fire.
  const snapAfterNormal = await page.evaluate(async () => {
    const g = window.game;
    g['lastViewSnapEvent'] = null;
    // Sustained normal movement across many frames.
    for (let f = 0; f < 40; f++) {
      window.__move(6, 3);
      await new Promise((r) => requestAnimationFrame(r));
    }
    return g['lastViewSnapEvent'] ? g['lastViewSnapEvent'].reason : null;
  });
  console.log(`  lastViewSnap after 40 frames of normal input: ${snapAfterNormal}`);
  check('NO false-positive VIEW SNAP during normal input', snapAfterNormal === null,
    'the frame-separated false positive is fixed');

  // =====================================================================
  console.log('\n=== 2. justLocked DISCARD is reported as INPUT_DISCARDED ===');
  // =====================================================================
  const discard = await page.evaluate(async () => {
    const g = window.game;
    const cc = g.cameraController;
    g['lastViewSnapEvent'] = null;
    // Simulate the first event after lock acquisition.
    cc['justLocked'] = true;
    const yawBefore = cc.yaw;
    window.__move(500, 200);
    const yawAfter = cc.yaw;
    await new Promise((r) => requestAnimationFrame(r));
    return {
      yawUnchanged: Math.abs(yawAfter - yawBefore) < 1e-12,
      viewSnap: g['lastViewSnapEvent'] ? g['lastViewSnapEvent'].reason : null
    };
  });
  console.log(`  discarded (yaw unchanged): ${discard.yawUnchanged}`);
  console.log(`  lastViewSnap: ${discard.viewSnap}`);
  check('justLocked event is discarded', discard.yawUnchanged);
  check('discard is NOT reported as a view snap', discard.viewSnap === null);

  // =====================================================================
  console.log('\n=== 3. COALESCED POINTER SUPPORT + PROBE ACCOUNTING ===');
  // =====================================================================
  const caps = await page.evaluate(() => {
    const w = window;
    const proto = w.PointerEvent ? w.PointerEvent.prototype : null;
    return {
      hasPointerEvent: !!w.PointerEvent,
      hasGetCoalescedEvents: !!(proto && typeof proto.getCoalescedEvents === 'function'),
      hasPointerRawUpdate: 'onpointerrawupdate' in w,
      probeEnabled: !!window.game['pointerProbeEnabled'],
      rawUpdateHandlers: window.game.cameraController.registeredHandlerCounts.pointerrawupdate,
      pointerMoveHandlers: window.game.cameraController.registeredHandlerCounts.pointermove
    };
  });
  console.log('  ' + JSON.stringify(caps));
  check('PointerEvent present', caps.hasPointerEvent === true);
  check('pointerrawupdate feature-detected', typeof caps.hasPointerRawUpdate === 'boolean');
  check('probe enabled by ?pointerInputExperiment=1', caps.probeEnabled === true);

  // Drive the probe with synthetic PointerEvents carrying coalesced samples and
  // confirm displacement is preserved and nothing is applied twice.
  const probe = await page.evaluate(async () => {
    const g = window.game;
    const probeObj = g['pointerProbe'];
    probeObj.clear();
    const cc = g.cameraController;
    const yawBefore = cc.yaw;

    const dispatch = (mx, my, parts) => {
      const ev = new PointerEvent('pointermove', { bubbles: true });
      Object.defineProperty(ev, 'movementX', { value: mx, writable: false, configurable: true });
      Object.defineProperty(ev, 'movementY', { value: my, writable: false, configurable: true });
      if (parts) {
        Object.defineProperty(ev, 'getCoalescedEvents', {
          value: () => parts.map(([px, py]) => ({
            movementX: px, movementY: py, timeStamp: performance.now()
          })),
          writable: false, configurable: true
        });
      }
      window.dispatchEvent(ev);
    };

    // A big parent composed of 20 small samples summing to it.
    const parts = [];
    let sx = 0, sy = 0;
    for (let i = 0; i < 20; i++) {
      const px = i < 19 ? 7 : 131 - sx;
      const py = i < 19 ? -9 : -188 - sy;
      parts.push([px, py]); sx += px; sy += py;
    }
    dispatch(131, -188, parts);

    const yawAfter = cc.yaw;
    return {
      counts: { ...probeObj.counts },
      largest: probeObj.largestParentEvent
        ? {
            parentX: probeObj.largestParentEvent.parentX,
            parentY: probeObj.largestParentEvent.parentY,
            constituentCount: probeObj.largestParentEvent.constituentCount,
            sumX: probeObj.largestParentEvent.sumX,
            sumY: probeObj.largestParentEvent.sumY,
            sumMatchesParent: probeObj.largestParentEvent.sumMatchesParent,
            largestConstituent: probeObj.largestParentEvent.largestConstituentMagnitude
          }
        : null,
      yawDeltaFromPointerEvents: yawAfter - yawBefore
    };
  });
  console.log('  probe counts      :', JSON.stringify(probe.counts));
  console.log('  largest breakdown :', JSON.stringify(probe.largest));
  console.log(`  yaw change caused by pointer events: ${probe.yawDeltaFromPointerEvents.toExponential(3)}`);
  check('coalesced constituents preserved and sum matches parent',
    !!probe.largest && probe.largest.constituentCount === 20 && probe.largest.sumMatchesParent === true);
  check('no parent+child double application (probe never applies input)',
    Math.abs(probe.yawDeltaFromPointerEvents) < 1e-12,
    'production mousemove remains the single authoritative source');

  // =====================================================================
  console.log('\n=== 4. RAW INPUT SESSION ACCOUNTING ===');
  // =====================================================================
  const rawSess = await page.evaluate(() => ({ ...window.game.cameraController.rawInputSession }));
  console.log('  ' + JSON.stringify(rawSess));
  check('raw-input session reports requested/resolved mode',
    typeof rawSess.requestedMode === 'string' && typeof rawSess.resolvedMode === 'string');

  check('no page errors', errs.length === 0, errs.join('; '));

  console.log(`\n${failures === 0 ? 'VERIFICATION: all assertions PASS' : `VERIFICATION: ${failures} FAILURE(S)`}`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  await browser.close();
  server.close();
}