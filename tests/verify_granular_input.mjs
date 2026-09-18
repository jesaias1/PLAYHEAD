/**
 * GRANULAR POINTER INPUT — PRODUCTION VERIFICATION
 *
 * Serves built dist/ and verifies the source-ownership architecture in the real
 * production bundle:
 *   1. source resolves raw > coalesced > legacy, and ?inputSource= overrides work
 *   2. ONE physical displacement -> ONE applied displacement (no double-apply)
 *   3. non-authoritative streams are observation-only
 *   4. coalesced constituents preserve total displacement, parent never added
 *   5. fast flicks (90/180/360) are not clipped
 *   6. polling-rate and frame-rate independence
 *   7. main-thread stalls do not corrupt or duplicate input
 *   8. pause/resume + lock transitions reset source state
 *   9. listener counts stay correct
 */
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DIST = path.resolve('dist');
const PORT = 4603;
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

async function boot(query) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await page.goto(`http://127.0.0.1:${PORT}/${query}`, { waitUntil: 'domcontentloaded' });
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
  await new Promise((r) => setTimeout(r, 2000));

  await page.evaluate(() => {
    const cc = window.game.cameraController;
    cc.mouseLookEnabled = true;
    cc['isLocked'] = true;
    cc['justLocked'] = false;
    window.__cc = cc;
    window.__reset = () => { cc['justLocked'] = false; cc.setSensitivity(1.0); };
    window.__setYaw = (v) => { cc.yaw = v; cc.pitch = 0; cc.updateCameraRotation(); };
    // Real DOM dispatch paths (exercises the actual listeners).
    window.__mouse = (mx, my) => {
      const ev = new MouseEvent('mousemove', { bubbles: true });
      Object.defineProperty(ev, 'movementX', { value: mx, writable: false, configurable: true });
      Object.defineProperty(ev, 'movementY', { value: my, writable: false, configurable: true });
      document.dispatchEvent(ev);
    };
    window.__pointerMove = (mx, my, parts) => {
      const ev = new PointerEvent('pointermove', { bubbles: true });
      Object.defineProperty(ev, 'movementX', { value: mx, writable: false, configurable: true });
      Object.defineProperty(ev, 'movementY', { value: my, writable: false, configurable: true });
      if (parts) {
        Object.defineProperty(ev, 'getCoalescedEvents', {
          value: () => parts.map(([px, py]) => ({ movementX: px, movementY: py, timeStamp: performance.now() })),
          writable: false, configurable: true
        });
      }
      document.dispatchEvent(ev);
    };
    window.__rawUpdate = (mx, my) => {
      const ev = new PointerEvent('pointerrawupdate', { bubbles: true });
      Object.defineProperty(ev, 'movementX', { value: mx, writable: false, configurable: true });
      Object.defineProperty(ev, 'movementY', { value: my, writable: false, configurable: true });
      document.dispatchEvent(ev);
    };
  });

  return { page, errs };
}

try {
  // =====================================================================
  console.log('\n=== 1. SOURCE RESOLUTION + ?inputSource= OVERRIDE ===');
  // =====================================================================
  {
    const { page, errs } = await boot('?debugMovement=1');
    const s = await page.evaluate(() => ({
      source: window.game.cameraController.inputSource,
      rawSupported: window.game.cameraController.pointerRawUpdateSupported,
      coalescedSupported: window.game.cameraController.coalescedSupported,
      handlers: { ...window.game.cameraController.registeredHandlerCounts }
    }));
    console.log('  ' + JSON.stringify(s));
    check('input source auto-resolved to RAW_POINTER', s.source === 'RAW_POINTER');
    check('pointerrawupdate supported', s.rawSupported === true);
    check('coalesced supported', s.coalescedSupported === true);
    check('exactly 1 mousemove handler', s.handlers.mousemove === 1);
    check('exactly 1 pointerrawupdate handler', s.handlers.pointerrawupdate === 1);
    check('exactly 1 pointermove handler', s.handlers.pointermove === 1);
    check('no page errors', errs.length === 0, errs.join('; '));
    await page.close();
  }

  // Override cases
  for (const [q, expected] of [['raw', 'RAW_POINTER'], ['coalesced', 'COALESCED_POINTER'], ['legacy', 'LEGACY_MOUSE']]) {
    const { page } = await boot(`?inputSource=${q}`);
    const got = await page.evaluate(() => window.game.cameraController.inputSource);
    check(`?inputSource=${q} -> ${expected}`, got === expected, `got ${got}`);
    await page.close();
  }

  // =====================================================================
  console.log('\n=== 2. ONE DISPLACEMENT -> ONE APPLICATION ===');
  // =====================================================================
  {
    const { page, errs } = await boot('?debugMovement=1');
    const r = await page.evaluate(() => {
      const cc = window.__cc;
      const factor = 0.0022 * cc.getSensitivity();
      window.__reset();
      window.__setYaw(0);

      // RAW_POINTER authoritative: a raw update applies, a mousemove does not.
      const y0 = cc.yaw;
      window.__rawUpdate(100, 0);
      const afterRaw = cc.yaw - y0;

      const y1 = cc.yaw;
      window.__mouse(100, 0); // legacy stream, must be observation-only
      const afterMouse = cc.yaw - y1;

      const y2 = cc.yaw;
      window.__pointerMove(100, 0, [[50, 0], [50, 0]]); // coalesced stream, ignored
      const afterPointer = cc.yaw - y2;

      return {
        factor,
        afterRaw, afterMouse, afterPointer,
        counters: { ...cc.inputCounters }
      };
    });
    console.log(`  raw update applied  : ${r.afterRaw.toExponential(4)} (expected ${(-100 * r.factor).toExponential(4)})`);
    console.log(`  mousemove applied   : ${r.afterMouse.toExponential(4)} (must be 0)`);
    console.log(`  pointermove applied : ${r.afterPointer.toExponential(4)} (must be 0)`);
    console.log('  counters: ' + JSON.stringify(r.counters));
    check('raw update applied exactly once', Math.abs(r.afterRaw - (-100 * r.factor)) < 1e-12);
    check('mousemove did NOT additionally apply', r.afterMouse === 0);
    check('pointermove did NOT additionally apply', r.afterPointer === 0);
    check('duplicate drops were recorded', r.counters.duplicateDrops >= 2);
    check('no page errors', errs.length === 0, errs.join('; '));
    await page.close();
  }

  // =====================================================================
  console.log('\n=== 3. COALESCED PATH (constituents once, parent never) ===');
  // =====================================================================
  {
    const { page } = await boot('?inputSource=coalesced');
    const r = await page.evaluate(() => {
      const cc = window.__cc;
      const factor = 0.0022 * cc.getSensitivity();
      window.__reset();
      window.__setYaw(0);

      const parts = [[19, 2], [11, 1], [18, 3], [13, 1], [18, 3], [13, 2], [18, 4], [19, 3]];
      const sumX = parts.reduce((a, p) => a + p[0], 0);
      const sumY = parts.reduce((a, p) => a + p[1], 0);

      const y0 = cc.yaw;
      const p0 = cc.pitch;
      window.__pointerMove(sumX, sumY, parts);
      const dYaw = cc.yaw - y0;
      const dPitch = cc.pitch - p0;

      // A raw update must NOT apply while coalesced owns the stream.
      const y1 = cc.yaw;
      window.__rawUpdate(200, 0);
      const afterRaw = cc.yaw - y1;

      return { factor, sumX, sumY, dYaw, dPitch, afterRaw, counters: { ...cc.inputCounters } };
    });
    console.log(`  parent ${r.sumX}/${r.sumY} over 8 constituents`);
    console.log(`  yaw   applied: ${r.dYaw.toExponential(4)} (expected ${(-r.sumX * r.factor).toExponential(4)})`);
    console.log(`  pitch applied: ${r.dPitch.toExponential(4)} (expected ${(-r.sumY * r.factor).toExponential(4)})`);
    console.log(`  raw update while coalesced owns: ${r.afterRaw.toExponential(4)} (must be 0)`);
    console.log('  counters: ' + JSON.stringify(r.counters));
    check('coalesced yaw equals constituent sum exactly', Math.abs(r.dYaw - (-r.sumX * r.factor)) < 1e-12);
    check('coalesced pitch equals constituent sum exactly', Math.abs(r.dPitch - (-r.sumY * r.factor)) < 1e-12);
    check('parent aggregate NOT additionally applied', Math.abs(r.dYaw - (-r.sumX * r.factor)) < 1e-12);
    check('raw stream ignored under coalesced source', r.afterRaw === 0);
    check('applied sample count == constituent count', r.counters.appliedSamples === 8);
    await page.close();
  }

  // =====================================================================
  console.log('\n=== 4. FAST FLICKS NOT CLIPPED ===');
  // =====================================================================
  {
    const { page } = await boot('?inputSource=raw');
    const r = await page.evaluate(() => {
      const cc = window.__cc;
      const factor = 0.0022 * cc.getSensitivity();
      window.__reset();
      const out = {};
      for (const [name, deg] of [['90', 90], ['180', 180], ['360', 360]]) {
        window.__setYaw(0);
        const px = (deg * Math.PI / 180) / factor;
        window.__rawUpdate(px, 0);
        out[name] = cc.yaw;
      }
      // Rapid alternating
      window.__setYaw(0);
      for (let i = 0; i < 100; i++) window.__rawUpdate(i % 2 === 0 ? 200 : -200, 0);
      out.alternating = cc.yaw;
      // Sustained fast spin
      window.__setYaw(0);
      for (let i = 0; i < 200; i++) window.__rawUpdate(150, 0);
      out.sustained = cc.yaw;
      // Vertical
      window.__setYaw(0);
      cc.pitch = 0; cc.updateCameraRotation();
      window.__rawUpdate(0, 300);
      out.vertical = cc.pitch;
      out.factor = factor;
      return out;
    });
    const deg = (rad) => (rad * 180 / Math.PI).toFixed(2);
    console.log(`  90deg  -> ${deg(r['90'])}deg`);
    console.log(`  180deg -> ${deg(r['180'])}deg`);
    console.log(`  360deg -> ${deg(r['360'])}deg`);
    console.log(`  rapid alternating (100 x +/-200px) -> ${r.alternating.toExponential(3)} rad (expect 0)`);
    console.log(`  sustained spin (200 x 150px) -> ${deg(r.sustained)}deg (expect ${deg(-200 * 150 * r.factor)})`);
    console.log(`  vertical 300px -> ${deg(r.vertical)}deg (expect ${deg(-300 * r.factor)})`);
    check('90deg flick exact', Math.abs(r['90'] + Math.PI / 2) < 1e-9);
    check('180deg flick exact', Math.abs(r['180'] + Math.PI) < 1e-9);
    check('360deg spin exact', Math.abs(r['360'] + Math.PI * 2) < 1e-9);
    check('rapid alternating cancels exactly', Math.abs(r.alternating) < 1e-9);
    check('sustained fast spin not clipped', Math.abs(r.sustained - (-200 * 150 * r.factor)) < 1e-9);
    check('vertical movement preserved', Math.abs(r.vertical - (-300 * r.factor)) < 1e-12);
    await page.close();
  }

  // =====================================================================
  console.log('\n=== 5. POLLING RATE x FRAME RATE MATRIX ===');
  // =====================================================================
  {
    const { page } = await boot('?inputSource=raw');
    const r = await page.evaluate(async () => {
      const cc = window.__cc;
      const factor = 0.0022 * cc.getSensitivity();
      const TOTAL = 600;
      const rows = [];
      for (const hz of [125, 500, 1000, 2000, 4000, 8000]) {
        window.__reset();
        window.__setYaw(0);
        const per = TOTAL / hz;
        for (let i = 0; i < hz; i++) window.__rawUpdate(per, 0);
        rows.push({ hz, yaw: cc.yaw, expected: -TOTAL * factor });
      }
      return { rows, factor };
    });
    for (const x of r.rows) {
      console.log(`  ${String(x.hz).padStart(5)} Hz -> ${x.yaw.toExponential(6)} (expected ${x.expected.toExponential(6)})`);
    }
    check('polling-rate independent', r.rows.every((x) => Math.abs(x.yaw - x.expected) < 1e-9));

    // Frame-rate decoupling
    const fr = await page.evaluate(async () => {
      const cc = window.__cc;
      const factor = 0.0022 * cc.getSensitivity();
      const TOTAL = 600;
      const rows = [];
      for (const [render, mouse] of [[144, 1000], [120, 1000], [90, 1000], [60, 1000], [45, 1000], [30, 1000], [60, 8000]]) {
        window.__reset();
        window.__setYaw(0);
        const eventsPerFrame = Math.max(1, Math.round(mouse / render));
        const frames = 20;
        const per = TOTAL / (eventsPerFrame * frames);
        for (let f = 0; f < frames; f++) {
          for (let e = 0; e < eventsPerFrame; e++) window.__rawUpdate(per, 0);
          await new Promise((res) => requestAnimationFrame(res));
        }
        rows.push({ render, mouse, yaw: cc.yaw, expected: -TOTAL * factor });
      }
      return { rows, factor };
    });
    for (const x of fr.rows) {
      console.log(`  render ${String(x.render).padStart(3)} / mouse ${String(x.mouse).padStart(4)} -> ${x.yaw.toExponential(6)} (expected ${x.expected.toExponential(6)})`);
    }
    check('frame-rate independent', fr.rows.every((x) => Math.abs(x.yaw - x.expected) < 1e-9));
    await page.close();
  }

  // =====================================================================
  console.log('\n=== 6. MAIN-THREAD STALL: no corruption or duplication ===');
  // =====================================================================
  {
    const { page } = await boot('?inputSource=raw');
    const r = await page.evaluate(async () => {
      const cc = window.__cc;
      const factor = 0.0022 * cc.getSensitivity();
      const rows = [];
      for (const stall of [16, 30, 50, 100, 200]) {
        window.__reset();
        window.__setYaw(0);
        const appliedBefore = cc.inputCounters.appliedSamples;
        // Motion before the stall.
        for (let i = 0; i < 20; i++) window.__rawUpdate(5, 0);
        const beforeStall = cc.yaw;
        // Hard synchronous stall (blocks the main thread like a long task).
        const t0 = performance.now();
        while (performance.now() - t0 < stall) { /* spin */ }
        // Motion after the stall.
        for (let i = 0; i < 20; i++) window.__rawUpdate(5, 0);
        const total = cc.yaw;
        rows.push({
          stall,
          total,
          expected: -(40 * 5) * factor,
          appliedDelta: cc.inputCounters.appliedSamples - appliedBefore,
          beforeStall
        });
      }
      return { rows, factor };
    });
    for (const x of r.rows) {
      console.log(`  stall ${String(x.stall).padStart(3)}ms -> yaw ${x.total.toExponential(6)} (expected ${x.expected.toExponential(6)}) appliedDelta=${x.appliedDelta}`);
    }
    check('no double application after stalls', r.rows.every((x) => Math.abs(x.total - x.expected) < 1e-9));
    check('exactly 40 samples applied per stall case', r.rows.every((x) => x.appliedDelta === 40));
    await page.close();
  }

  // =====================================================================
  console.log('\n=== 7. PAUSE/RESUME + SESSION RESET ===');
  // =====================================================================
  {
    const { page } = await boot('?inputSource=raw');
    const r = await page.evaluate(async () => {
      const cc = window.__cc;
      const g = window.game;
      const factor = 0.0022 * cc.getSensitivity();

      // Accumulate viewmodel delta, then force a session reset.
      window.__setYaw(0);
      window.__rawUpdate(50, 25);
      const pendingBefore = cc.consumeMouseDelta();

      cc['justLocked'] = true;
      cc.resetInputSessionState();
      const pendingAfter = cc.consumeMouseDelta();

      // Repeated pause/resume must not duplicate handlers or corrupt state.
      for (let i = 0; i < 5; i++) {
        g['pauseGame']();
        await new Promise((res) => setTimeout(res, 40));
        g['finalizeResume']();
        await new Promise((res) => setTimeout(res, 40));
      }
      const handlers = { ...cc.registeredHandlerCounts };

      // Input still scales correctly after the cycles.
      window.__setYaw(0);
      window.__rawUpdate(100, 0);
      return {
        pendingBefore, pendingAfter,
        handlers,
        afterCycles: cc.yaw,
        expected: -100 * factor
      };
    });
    console.log(`  pending delta before reset: ${JSON.stringify(r.pendingBefore)}`);
    console.log(`  pending delta after reset : ${JSON.stringify(r.pendingAfter)}`);
    console.log('  handlers after 5x pause/resume: ' + JSON.stringify(r.handlers));
    console.log(`  delta after cycles: ${r.afterCycles.toExponential(6)} (expected ${r.expected.toExponential(6)})`);
    check('session reset clears accumulated delta', r.pendingAfter.x === 0 && r.pendingAfter.y === 0);
    check('mousemove handler count still 1', r.handlers.mousemove === 1);
    check('pointerrawupdate handler count still 1', r.handlers.pointerrawupdate === 1);
    check('pointermove handler count still 1', r.handlers.pointermove === 1);
    check('input still exact after pause/resume cycles', Math.abs(r.afterCycles - r.expected) < 1e-12);
    await page.close();
  }

  console.log(`\n${failures === 0 ? 'GRANULAR INPUT: all assertions PASS' : `GRANULAR INPUT: ${failures} FAILURE(S)`}`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  await browser.close();
  server.close();
}