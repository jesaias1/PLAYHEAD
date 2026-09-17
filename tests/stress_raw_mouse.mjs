/**
 * RAW MOUSE INPUT STRESS HARNESS (real production build, real Chromium)
 *
 * Drives the built dist/ bundle via CDP and dispatches synthetic MouseEvents
 * with EXACT movementX/movementY, to answer:
 *
 *   1. Is the delta applied exactly once per DOM event (linear, no loss/dupe)?
 *   2. Does the final orientation depend only on TOTAL displacement, not on how
 *      many DOM events it was divided into? (polling-rate independence)
 *   3. Is mouse look independent of render frame rate?
 *   4. Does a single anomalous raw delta produce a linear orientation jump
 *      (Class B: raw input spike the camera correctly follows)?
 *   5. Does FOV change actual sensitivity?
 *   6. Does the viewmodel change world orientation?
 *   7. Does pause/resume or pointer-lock loss corrupt input?
 */
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DIST = path.resolve('dist');
const PORT = 4601;
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

const results = [];
let failures = 0;
const record = (name, value, note = '') => {
  results.push({ name, value, note });
  console.log(`  ${name.padEnd(46)} ${String(value).padStart(12)}  ${note}`);
};
const assert = (name, cond, note = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${note ? '  (' + note + ')' : ''}`);
};

async function boot(url) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
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
  await new Promise((r) => setTimeout(r, 2500));

  // Enable the raw mouse path deterministically (pointer lock is unavailable in
  // headless), and install an exact-delta dispatcher.
  await page.evaluate(() => {
    const cc = window.game.cameraController;
    cc.mouseLookEnabled = true;
    cc['isLocked'] = true;

    window.__yaw0 = () => cc.yaw;
    window.__setYaw = (v) => { cc.yaw = v; cc.pitch = 0; cc.updateCameraRotation(); };
    window.__state = () => ({
      yaw: cc.yaw,
      pitch: cc.pitch,
      locked: cc['isLocked'],
      mouseLook: cc.mouseLookEnabled,
      justLocked: cc['justLocked'],
      fov: window.game.environment.camera.fov,
      pos: {
        x: window.game.playerController.position.x,
        y: window.game.playerController.position.y,
        z: window.game.playerController.position.z
      }
    });

    // Dispatch an exact movementX/movementY mousemove. movementX/Y are getters
    // on MouseEvent.prototype, so shadow them with an own data property.
    window.__move = (mx, my) => {
      const ev = new MouseEvent('mousemove', { bubbles: true, cancelable: false });
      Object.defineProperty(ev, 'movementX', { value: mx, writable: false, enumerable: true, configurable: true });
      Object.defineProperty(ev, 'movementY', { value: my, writable: false, enumerable: true, configurable: true });
      document.dispatchEvent(ev);
    };
    window.__moveMany = (n, mx, my) => { for (let i = 0; i < n; i++) window.__move(mx, my); };
  });

  return { page, errs };
}

try {
  const { page, errs } = await boot(`http://127.0.0.1:${PORT}/?debugMovement=1`);

  const factor = await page.evaluate(() => 0.0022 * window.game.cameraController.getSensitivity());
  console.log(`\n[dpi] radians per mouse pixel = ${factor}`);

  // =====================================================================
  console.log('\n=== 1. LINEARITY: is each DOM delta applied exactly once? ===');
  // =====================================================================
  const linearity = await page.evaluate((factor) => {
    const cc = window.game.cameraController;
    const rows = [];
    for (const mx of [1, 5, 13, 80, 250, 900]) {
      // Set the pre-state, then let one frame pass with ZERO input so the
      // detector sees a clean, input-matched frame before the measured one.
      cc.yaw = 0; cc.pitch = 0; cc.updateCameraRotation();
      window.__move(0, 0);
      window.__flush = true;
      const before = cc.yaw;
      window.__move(mx, 0);
      const actual = cc.yaw - before;
      rows.push({ mx, actual, expected: -mx * factor, ratio: actual / (-mx * factor) });
    }
    return rows;
  }, factor);
  for (const r of linearity) {
    console.log(`  dx=${String(r.mx).padStart(4)}  actual=${r.actual.toFixed(6)}  expected=${r.expected.toFixed(6)}  ratio=${r.ratio.toFixed(4)}`);
  }
  const linearOk = linearity.every((r) => Math.abs(r.ratio - 1) < 1e-9);
  assert('every DOM delta applied exactly once (ratio == 1)', linearOk);

  // =====================================================================
  console.log('\n=== 2. POLLING RATE INDEPENDENCE (same total displacement) ===');
  // =====================================================================
  const polling = await page.evaluate((factor) => {
    const cc = window.game.cameraController;
    const TOTAL = 800; // pixels
    const rates = [125, 500, 1000, 2000, 4000, 8000];
    const rows = [];
    for (const hz of rates) {
      // One second of motion at that event rate => TOTAL px spread over hz events.
      const perEvent = TOTAL / hz;
      window.__setYaw(0);
      for (let i = 0; i < hz; i++) window.__move(perEvent, 0);
      rows.push({ hz, yaw: cc.yaw, expected: -TOTAL * factor, error: cc.yaw - (-TOTAL * factor) });
    }
    return rows;
  }, factor);
  console.log('  rate(Hz)        finalYaw      expected      error');
  for (const r of polling) {
    console.log(`  ${String(r.hz).padStart(6)}   ${r.yaw.toFixed(9)}  ${r.expected.toFixed(9)}  ${r.error.toExponential(2)}`);
  }
  const pollOk = polling.every((r) => Math.abs(r.error) < 1e-6);
  assert('orientation depends on total displacement, not event count', pollOk);

  // =====================================================================
  console.log('\n=== 3. FRAME-RATE DECOUPLING ===');
  // =====================================================================
  const frameRate = await page.evaluate(async (factor) => {
    const cc = window.game.cameraController;
    const TOTAL = 600;
    const combos = [
      { render: 144, mouse: 1000 },
      { render: 60, mouse: 1000 },
      { render: 30, mouse: 1000 },
      { render: 60, mouse: 8000 }
    ];
    const rows = [];
    for (const c of combos) {
      // Feed `TOTAL` px, delivering events in frame-sized batches.
      const eventsPerFrame = Math.round(c.mouse / c.render);
      const frames = 30;
      window.__setYaw(0);
      const perEvent = TOTAL / (eventsPerFrame * frames);
      for (let f = 0; f < frames; f++) {
        for (let e = 0; e < eventsPerFrame; e++) window.__move(perEvent, 0);
        await new Promise((r) => requestAnimationFrame(r));
      }
      rows.push({ render: c.render, mouse: c.mouse, yaw: cc.yaw, expected: -TOTAL * factor });
    }
    return rows;
  }, factor);
  console.log('  render/mouse       finalYaw      expected');
  for (const r of frameRate) {
    console.log(`  ${String(r.render).padStart(4)}/${String(r.mouse).padStart(5)}  ${r.yaw.toFixed(9)}  ${r.expected.toFixed(9)}`);
  }
  assert('mouse look independent of render cadence',
    frameRate.every((r) => Math.abs(r.yaw - r.expected) < 1e-6));

  // =====================================================================
  console.log('\n=== 4. RAW SPIKE TEST (Class B) ===');
  // =====================================================================
  const spike = await page.evaluate((factor) => {
    const cc = window.game.cameraController;

    // Establish a "normal" history first so robust stats are meaningful.
    window.__setYaw(0);
    for (let i = 0; i < 120; i++) window.__move(4 + (i % 3), 0);

    // Normal sequence, then one anomalous event, then normal again.
    const beforeNormal = cc.yaw;
    for (const dx of [4, 5, 4, 6, 5]) window.__move(dx, 0);
    const afterNormal = cc.yaw;

    const beforeSpike = cc.yaw;
    window.__move(80, 0); // the injected anomaly
    const afterSpike = cc.yaw;

    const beforeBig = cc.yaw;
    window.__move(5000, 0); // pathological spike
    const afterBig = cc.yaw;

    // Vertical spike
    const pitchBefore = cc.pitch;
    window.__move(0, 3000);
    const pitchAfter = cc.pitch;

    return {
      normalDeltaDeg: (afterNormal - beforeNormal) * 180 / Math.PI,
      spikeDeltaDeg: (afterSpike - beforeSpike) * 180 / Math.PI,
      spikeExpectedDeg: -80 * factor * 180 / Math.PI,
      bigDeltaDeg: (afterBig - beforeBig) * 180 / Math.PI,
      pitchDeltaDeg: (pitchAfter - pitchBefore) * 180 / Math.PI,
      pitchClamped: Math.abs(pitchAfter) >= 1.5499
    };
  }, factor);
  console.log(`  normal 5-event turn delta      : ${spike.normalDeltaDeg.toFixed(3)} deg`);
  console.log(`  single 80px event delta        : ${spike.spikeDeltaDeg.toFixed(3)} deg (expected ${spike.spikeExpectedDeg.toFixed(3)})`);
  console.log(`  single 5000px event delta      : ${spike.bigDeltaDeg.toFixed(3)} deg`);
  console.log(`  single 3000px vertical delta   : ${spike.pitchDeltaDeg.toFixed(3)} deg (clamped=${spike.pitchClamped})`);
  assert('a single raw spike produces a LINEAR (proportional) orientation jump',
    Math.abs(spike.spikeDeltaDeg - spike.spikeExpectedDeg) < 0.01,
    'Class B: raw input spike, camera follows correctly');
  assert('a 5000px single event yields a huge (>300deg) instantaneous turn',
    Math.abs(spike.bigDeltaDeg) > 300,
    'no outlier rejection exists in the input path');

  // Did the VIEW SNAP detector fire for a pure raw spike? It must NOT: the
  // camera correctly follows the input, so expected == actual. This is the
  // structural blind spot that motivated the raw-input detector.
  //
  // Measured through the app's own update loop with NO manual yaw writes, since
  // a manual write is itself an unexplained orientation change.
  const spikeDetectors = await page.evaluate(async () => {
    const g = window.game;
    const cc = g.cameraController;

    // Build normal history, then settle with clean zero-input frames so the
    // detector baseline is free of any earlier manual-orientation artifact.
    for (let i = 0; i < 120; i++) window.__move(4 + (i % 3), 0);
    for (let f = 0; f < 8; f++) {
      window.__move(0, 0);
      await new Promise((r) => requestAnimationFrame(r));
    }
    g['lastViewSnapEvent'] = null;
    g['lastRawSpikeEvent'] = null;

    // Now a single spike inside one frame.
    const yawBefore = cc.yaw;
    window.__move(3000, 0);
    const yawImmediate = cc.yaw;
    for (let f = 0; f < 4; f++) await new Promise((r) => requestAnimationFrame(r));

    return {
      appliedDeg: (yawImmediate - yawBefore) * 180 / Math.PI,
      viewSnap: g['lastViewSnapEvent'] ? g['lastViewSnapEvent'].reason : null,
      rawSpike: g['lastRawSpikeEvent'] ? g['lastRawSpikeEvent'].reason : null
    };
  });
  console.log(`  spike applied  : ${spikeDetectors.appliedDeg.toFixed(1)} deg from ONE DOM event`);
  console.log(`  lastViewSnap   : ${spikeDetectors.viewSnap}`);
  console.log(`  lastRawSpike   : ${spikeDetectors.rawSpike}`);
  // NOTE ON TIMING: a synthetic spike is applied synchronously by __move, i.e.
  // BETWEEN frames, so its orientation change lands outside the detector's
  // measured window. The structural claim — that VIEW SNAP cannot detect a spike
  // the camera correctly followed (expected == actual) — is proven directly and
  // deterministically in tests/ViewOrientationDiagnostics.test.ts
  // ("does NOT report a snap for a normal mouse-driven turn").
  assert('RAW MOUSE SPIKE DID fire for the outlier', spikeDetectors.rawSpike !== null,
    'the raw detector is the only one that can see Class B');

  // =====================================================================
  console.log('\n=== 5. FOV INDEPENDENCE ===');
  // =====================================================================
  const fovTest = await page.evaluate((factor) => {
    const cc = window.game.cameraController;
    const cam = window.game.environment.camera;
    const rows = [];
    for (const fov of [60, 75, 90, 110]) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
      window.__setYaw(0);
      window.__move(400, 0);
      rows.push({ fov, yaw: cc.yaw, expected: -400 * factor });
    }
    cam.fov = 75; cam.updateProjectionMatrix();
    return rows;
  }, factor);
  console.log('  FOV     yaw            expected');
  for (const r of fovTest) console.log(`  ${String(r.fov).padStart(3)}  ${r.yaw.toFixed(9)}  ${r.expected.toFixed(9)}`);
  assert('FOV does not affect mouse sensitivity',
    fovTest.every((r) => Math.abs(r.yaw - r.expected) < 1e-9));

  // =====================================================================
  console.log('\n=== 6. PAUSE / RESUME + LOCK-LOSS INPUT INTEGRITY ===');
  // =====================================================================
  const pauseTest = await page.evaluate(async (factor) => {
    const cc = window.game.cameraController;
    const g = window.game;

    // Lock lost but mouseLookEnabled still true: does a normal-size DOM delta
    // (which is what an unlocked cursor produces) still drive the camera?
    cc['isLocked'] = false;
    cc.mouseLookEnabled = true;
    window.__setYaw(0);
    window.__move(400, 0);
    const unlockedDelta = cc.yaw;

    // Stale accumulated delta surviving a lock acquisition?
    cc['justLocked'] = true;
    const beforeJustLocked = cc.yaw;
    window.__move(500, 0);
    const afterJustLocked = cc.yaw;

    // Pause/resume then immediate fast motion.
    cc['isLocked'] = true;
    cc['justLocked'] = false;
    g['pauseGame']();
    await new Promise((r) => setTimeout(r, 120));
    g['finalizeResume']();
    window.__setYaw(0);
    window.__move(300, 0);

    return {
      unlockedDeltaDeg: unlockedDelta * 180 / Math.PI,
      unlockedExpectedDeg: -400 * factor * 180 / Math.PI,
      justLockedConsumed: Math.abs(afterJustLocked - beforeJustLocked) < 1e-12,
      afterResumeDeltaDeg: cc.yaw * 180 / Math.PI,
      afterResumeExpectedDeg: -300 * factor * 180 / Math.PI
    };
  }, factor);
  console.log(`  delta while UNLOCKED but mouseLook on : ${unlockedDeltaDegNote(pauseTest)}`);
  console.log(`  justLocked discarded the next event    : ${pauseTest.justLockedConsumed}`);
  console.log(`  delta after pause/resume              : ${pauseTest.afterResumeDeltaDeg.toFixed(3)} deg (expected ${pauseTest.afterResumeExpectedDeg.toFixed(3)})`);
  assert('input still applied while pointer-unlocked (mouseLookEnabled)',
    Math.abs(pauseTest.unlockedDeltaDeg - pauseTest.unlockedExpectedDeg) < 0.01);
  assert('pause/resume does not corrupt delta scaling',
    Math.abs(pauseTest.afterResumeDeltaDeg - pauseTest.afterResumeExpectedDeg) < 0.01);

  assert('no page errors', errs.length === 0, errs.join('; '));

  // =====================================================================
  console.log('\n=== 7. POINTER LOCK RAW-INPUT (unadjustedMovement) SUPPORT ===');
  // =====================================================================
  const lockSupport = await page.evaluate(async () => {
    const el = window.game.environment.renderer.domElement;
    if (!el.requestPointerLock) return { supported: 'no requestPointerLock' };
    const out = { hasMethod: true };
    try {
      const r = el.requestPointerLock({ unadjustedMovement: true });
      out.returnedPromise = !!(r && typeof r.then === 'function');
      if (out.returnedPromise) {
        await r.then(() => { out.result = 'resolved'; }).catch((e) => {
          out.result = 'rejected';
          out.errorName = e && e.name;
          out.errorMessage = e && e.message;
        });
      } else {
        out.result = 'non-promise (legacy)';
      }
    } catch (e) {
      out.result = 'threw';
      out.errorName = e && e.name;
      out.errorMessage = e && e.message;
    }
    return out;
  });
  console.log('  ' + JSON.stringify(lockSupport));

  // Current pointer-lock request mode used by the game. Checked functionally
  // (minification renames property keys, so grepping source text is unreliable).
  const rawMode = await page.evaluate(() => {
    const cc = window.game.cameraController;
    return { rawInputActiveField: typeof cc.rawInputActive, value: cc.rawInputActive };
  });
  console.log(`  cameraController.rawInputActive present: ${rawMode.rawInputActiveField} (value=${rawMode.value})`);
  assert('raw-input mode is tracked on the controller', rawMode.rawInputActiveField === 'boolean');
  assert('overlay exposes RAW INPUT state',
    (await page.evaluate(() => {
      const el = document.getElementById('movement-diag-overlay');
      return el ? el.textContent.includes('RAW INPUT') : false;
    })) === true);

  console.log('\n=== SUMMARY TABLE ===');
  for (const r of results) console.log(`${r.name.padEnd(46)} ${r.value}`);
  console.log(`\n${failures === 0 ? 'STRESS HARNESS: all assertions PASS' : `STRESS HARNESS: ${failures} FAILURE(S)`}`);
} finally {
  await browser.close();
  server.close();
}

function unlockedDeltaDegNote(p) {
  return `${p.unlockedDeltaDeg.toFixed(3)} deg (expected ${p.unlockedExpectedDeg.toFixed(3)})`;
}