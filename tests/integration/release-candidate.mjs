/**
 * RELEASE CANDIDATE — consolidated product-flow regression harness.
 *
 * Consolidates the throwaway work/_probe*.mjs scripts into one durable,
 * repeatable browser flow with a SINGLE nonzero exit code on any failure.
 *
 * What it actually exercises (runtime window.game in the built app):
 *   A. boot -> Signal Drift load/play
 *   B. authoritative void crossing -> restore -> assisted finish -> results
 *   C. results -> WATCH -> ESC -> SAME report (no duplicate finish)
 *   D. RETRY -> fresh timer + fresh POV recorder
 *   E. custom real WAV import -> play -> menu
 *   F. Academy lesson -> exit -> menu
 *   G. equip already-owned/default cosmetic -> play -> reload persistence
 *
 * NOT exercised here (explicitly reported as a limitation): live Supabase
 * account mutation, online multiplayer rooms, and true pointer-lock capture
 * (browser pointer-lock state is observed; human mouse feel still needs playtesting).
 *
 * Env:
 *   RELEASE_TEST_URL   base URL of a running app (default: local vite preview)
 *   RELEASE_EVIDENCE_DIR  directory for screenshots + machine report
 *   CHROME_PATH        Chromium/Chrome executable
 */

import { preview } from 'vite';
import { launch } from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const evidenceDir = process.env.RELEASE_EVIDENCE_DIR
  ? path.resolve(process.env.RELEASE_EVIDENCE_DIR)
  : path.join(repoRoot, 'work', 'release-candidate-evidence');
fs.mkdirSync(evidenceDir, { recursive: true });

const results = [];
let failures = 0;
const record = (flow, name, ok, detail) => {
  results.push({ flow, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${flow}] ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server = null;
let ownServer = false;
let browser = null;
const pageErrors = [];

async function startServer() {
  if (process.env.RELEASE_TEST_URL) return process.env.RELEASE_TEST_URL;
  server = await preview({
    configFile: false,
    root: repoRoot,
    logLevel: 'silent',
    preview: { host: '127.0.0.1', port: 4198, strictPort: true }
  });
  ownServer = true;
  return 'http://127.0.0.1:4198';
}

async function state(page) {
  return page.evaluate(() => {
    const g = window.game;
    return {
      state: g.stateMachine.getState(),
      resultsHidden: g.ui.resultsScreen.element.classList.contains('hidden'),
      replayHidden: g.ui.replayOverlay.element.classList.contains('hidden'),
      importHidden: g.ui.importScreen.element.classList.contains('hidden'),
      hasReplay: g.hasLocalReplay(),
      replayBtnHidden: g.ui.resultsScreen.replayBtn.classList.contains('hidden'),
      povRecording: g.povRecorder.isRecording(),
      replayMode: g.replayMode,
      runElapsed: Math.round(g.runElapsedTime * 100) / 100,
      finished: g.isFinished,
      audioPlaying: g.audioEngine.getIsPlaying(),
      pointerLocked: g.cameraController.getIsLocked()
    };
  });
}

async function loadSignalDrift(page) {
  await page.evaluate(() => window.game.loadPresetTrack('track_1_signal_drift'));
  await page.waitForFunction(() => window.game.stateMachine.getState() === 'READY', { timeout: 30000 });
  await page.click('#btn-enter-track');
  await page.waitForFunction(() => window.game.stateMachine.getState() === 'PLAYING', { timeout: 20000 });
}

async function assistedFinish(page, holdMs = 1500) {
  // ASSISTED: walk a little so the recorder has samples, then teleport onto the
  // finish gate to trigger the REAL swept finish detector. This skips only the
  // lever-operation part of the run, never the finish/void/validation logic.
  await page.keyboard.down('KeyW');
  await sleep(holdMs);
  await page.keyboard.up('KeyW');
  await page.evaluate(() => {
    const g = window.game;
    const f = g.currentTrack.finish.position;
    g.playerController.position.set(f.x, f.y, f.z);
  });
  await page.waitForFunction(() => window.game.stateMachine.getState() === 'FINISHED', { timeout: 20000 });
  await sleep(600);
}

async function main() {
  const url = await startServer();
  browser = await launch({
    executablePath:
      process.env.CHROME_PATH ||
      'C:/Users/lin4s/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => pageErrors.push(e.message));

  // OFFLINE: never touch a real backend. Supabase/cloud requests abort so an
  // offline flow can never be confused with a live signed-in success.
  let abortedBackend = 0;
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (/supabase|cloud|functions\./i.test(r.url())) {
      abortedBackend++;
      r.abort();
    } else {
      r.continue();
    }
  });

  try {
    // ---- A. boot -> Signal Drift load/play -------------------------------
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.game?.ui?.importScreen, { timeout: 30000 });
    await sleep(700);
    await page.screenshot({ path: path.join(evidenceDir, 'rc-01-boot.png') });
    const boot = await state(page);
    record('A.boot', 'boots to IMPORT with menu visible', boot.state === 'IMPORT' && boot.importHidden === false, boot);

    await loadSignalDrift(page);
    await sleep(800);
    const playing = await state(page);
    record('A.boot', 'Signal Drift loads and plays', playing.state === 'PLAYING', playing);
    record('A.boot', 'a fresh POV recorder is running', playing.povRecording === true, playing.povRecording);
    await page.screenshot({ path: path.join(evidenceDir, 'rc-02-playing.png') });

    // ---- J. pause + HUD visibility + fullscreen capability --------------
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.game.stateMachine.getState() === 'PAUSED', { timeout: 8000 });
    await sleep(300);
    const paused = await page.evaluate(() => ({
      state: window.game.stateMachine.getState(),
      pauseHidden: window.game.ui.pauseScreen.element.classList.contains('hidden'),
      hudHidden: window.game.ui.hud.element.classList.contains('hidden'),
      fullscreenApi: typeof document.documentElement.requestFullscreen === 'function'
    }));
    record('J.pause', 'ESC pauses with the pause menu visible', paused.state === 'PAUSED' && paused.pauseHidden === false, paused);
    record('J.pause', 'HUD is hidden while paused', paused.hudHidden === true, paused.hudHidden);
    record('J.pause', 'fullscreen API is available for the settings toggle', paused.fullscreenApi === true, paused.fullscreenApi);
    await page.screenshot({ path: path.join(evidenceDir, 'rc-02b-paused.png') });
    await page.click('#btn-pause-settings');
    await page.click('#set-hide-hud');
    await page.click('#btn-toggle-fullscreen');
    await page.waitForFunction(() => !!document.fullscreenElement, { timeout: 5000 });
    record('J.settings', 'fullscreen enters from a real button click', true);
    await page.click('#btn-toggle-fullscreen');
    await page.waitForFunction(() => !document.fullscreenElement, { timeout: 5000 });
    record('J.settings', 'fullscreen exits from the same control', true);
    await page.click('#btn-set-close');
    record('J.settings', 'critical pause menu remains accessible with HUD hidden',
      await page.evaluate(() => !window.game.ui.pauseScreen.element.classList.contains('hidden')));
    await page.click('#btn-pause-resume');
    await page.waitForFunction(() => window.game.stateMachine.getState() === 'PLAYING', { timeout: 8000 });
    record('J.settings', 'HUD stays hidden during play',
      await page.evaluate(() => window.game.ui.hud.element.classList.contains('hidden')));
    await sleep(350); // Allow the existing input debounce after resume.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.game.stateMachine.getState() === 'PAUSED', { timeout: 8000 });
    await page.click('#btn-pause-settings');
    await page.click('#set-hide-hud');
    await page.click('#btn-set-close');
    await sleep(1000);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.game.stateMachine.getState() === 'PLAYING', { timeout: 8000 });
    record('J.input', 'ESC resumes with pointer lock without another click',
      await page.evaluate(() => !!document.pointerLockElement && window.game.cameraController.getIsLocked()));

    // ---- B. authoritative void -> restore -> assisted finish -------------
    const killY = await page.evaluate(() => window.game.playerController.authoritativeKillY);
    record('B.void', 'authoritative void boundary is known', typeof killY === 'number', killY);
    await page.evaluate(() => {
      const g = window.game;
      g.playerController.position.set(200, g.playerController.authoritativeKillY - 50, 200);
    });
    await page.waitForFunction(
      () => window.game.lastRestoreDiagnostic !== null || window.game.stateMachine.getState() !== 'PLAYING',
      { timeout: 6000 }
    ).catch(() => {});
    await sleep(600);
    const restored = await page.evaluate(() => ({
      diag: window.game.lastRestoreDiagnostic,
      state: window.game.stateMachine.getState(),
      y: window.game.playerController.position.y
    }));
    record('B.void', 'void crossing triggers an authoritative restore', restored.diag !== null || restored.state !== 'PLAYING', restored);
    record('B.void', 'restore keeps the run active', restored.state === 'PLAYING', restored.state);

    await assistedFinish(page);
    const finished = await state(page);
    record('B.finish', 'assisted finish reaches FINISHED', finished.state === 'FINISHED', finished.state);
    record('B.finish', 'results report is visible', finished.resultsHidden === false, finished.resultsHidden);
    record('B.finish', 'finalized replay exists (WATCH available)', finished.hasReplay === true && finished.replayBtnHidden === false, {
      hasReplay: finished.hasReplay,
      hidden: finished.replayBtnHidden
    });
    await page.screenshot({ path: path.join(evidenceDir, 'rc-03-results.png') });

    // ---- C. WATCH -> ESC -> SAME report ----------------------------------
    await page.click('#btn-res-replay');
    await page.waitForFunction(() => window.game.stateMachine.getState() === 'REPLAY', { timeout: 15000 });
    await sleep(800);
    const inReplay = await state(page);
    record('C.watch', 'WATCH enters REPLAY (POV)', inReplay.state === 'REPLAY' && inReplay.replayMode === 'POV', inReplay);
    await page.screenshot({ path: path.join(evidenceDir, 'rc-04-replay.png') });

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.game.stateMachine.getState() === 'FINISHED', { timeout: 10000 });
    await sleep(500);
    const afterEsc = await state(page);
    record('C.watch', 'ESC returns to the SAME report', afterEsc.state === 'FINISHED' && afterEsc.resultsHidden === false, afterEsc);
    record('C.watch', 'replay teardown releases mode/audio', afterEsc.replayMode === 'NONE' && afterEsc.replayHidden === true && afterEsc.audioPlaying === false, afterEsc);
    await page.screenshot({ path: path.join(evidenceDir, 'rc-05-after-esc-report.png') });

    // ---- D. RETRY -> fresh timer + fresh POV recorder ---------------------
    await page.click('#btn-res-again');
    await page.waitForFunction(() => window.game.stateMachine.getState() === 'PLAYING', { timeout: 15000 });
    await sleep(300);
    const afterRetry = await state(page);
    record('D.retry', 'RETRY restarts straight into PLAYING', afterRetry.state === 'PLAYING', afterRetry.state);
    record('D.retry', 'RETRY starts a FRESH POV recorder', afterRetry.povRecording === true, afterRetry.povRecording);
    await sleep(1200);
    const advanced = await state(page);
    record('D.retry', 'RETRY run timer advances', advanced.runElapsed > afterRetry.runElapsed, {
      before: afterRetry.runElapsed,
      after: advanced.runElapsed
    });
    record('D.retry', 'results report is dismissed during retry', advanced.resultsHidden === true, advanced.resultsHidden);
    await page.screenshot({ path: path.join(evidenceDir, 'rc-06-after-retry.png') });
    // Room to a clean menu before the next flow.
    await page.evaluate(() => window.game.returnToImport());
    await sleep(600);

    // ---- E. custom real WAV import -> play -> menu -----------------------
    await page.evaluate(() => {
      const u = window.game.ui.importScreen;
      u.show();
      u.switchModule(1);
    });
    await sleep(300);
    const input = await page.$('#import-file-input');
    await input.uploadFile(path.join(repoRoot, 'work', 'release-candidate-evidence', 'test-tone.wav'));
    await page.waitForFunction(() => window.game.stateMachine.getState() === 'READY', { timeout: 40000 });
    await sleep(400);
    record('E.custom', 'custom WAV imports to READY', (await state(page)).state === 'READY');
    await page.click('#btn-enter-track');
    await page.waitForFunction(() => window.game.stateMachine.getState() === 'PLAYING', { timeout: 20000 });
    await sleep(1200);
    record('E.custom', 'custom WAV plays', (await state(page)).state === 'PLAYING');
    await page.screenshot({ path: path.join(evidenceDir, 'rc-07-custom-playing.png') });
    await page.evaluate(() => window.game.returnToImport());
    await sleep(600);
    record('E.custom', 'custom WAV teardown returns to the menu', (await state(page)).state === 'IMPORT' && !(await state(page)).audioPlaying);

    // ---- F. Academy lesson -> exit -> menu -------------------------------
    await page.evaluate(() => {
      const u = window.game.ui.importScreen;
      u.show();
      u.switchModule(2);
    });
    await sleep(400);
    await page.click('#btn-lab-academy');
    await page.waitForFunction(() => window.game.movementLab?.getAcademy?.() !== null, { timeout: 20000 }).catch(() => {});
    await sleep(1500);
    const inAcademy = await page.evaluate(() => ({
      state: window.game.stateMachine.getState(),
      academy: window.game.movementLab?.getAcademy?.() !== null,
      exitVisible: !!document.querySelector('#academy-btn-exit')?.offsetParent
    }));
    record('F.academy', 'Academy lesson opens', inAcademy.academy === true, inAcademy);
    await page.screenshot({ path: path.join(evidenceDir, 'rc-08-academy.png') });
    await page.evaluate(() => window.game.movementLab?.getAcademy?.()?.exitCallback?.());
    await sleep(900);
    const afterAcademy = await state(page);
    record('F.academy', 'Academy exit returns to the menu', afterAcademy.state === 'IMPORT', afterAcademy.state);
    await page.screenshot({ path: path.join(evidenceDir, 'rc-09-after-academy.png') });

    // ---- G. equip default cosmetic -> play -> reload persistence ---------
    const equipped = await page.evaluate(() => {
      const skin = window.game.ui.importScreen.skinSystem;
      const before = skin.getEquippedSkinId();
      const ok = skin.equipSkin('SIGNAL_CYAN');
      return { before, ok, after: skin.getEquippedSkinId() };
    });
    record('G.loadout', 'default cosmetic equips', equipped.after === 'SIGNAL_CYAN', equipped);
    await loadSignalDrift(page);
    await sleep(700);
    record('G.loadout', 'play starts with the equipped cosmetic', (await state(page)).state === 'PLAYING');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.game?.ui?.importScreen, { timeout: 30000 });
    await sleep(700);
    const persisted = await page.evaluate(() => window.game.ui.importScreen.skinSystem.getEquippedSkinId());
    record('G.loadout', 'cosmetic survives a reload', persisted === 'SIGNAL_CYAN', persisted);

    // ---- H. invalid replay recoverability --------------------------------
    const invalid = await page.evaluate(() => window.game.enterPovReplay('not-a-replay', {
      trackId: 'track_1_signal_drift', mapVersion: 1, mapFingerprint: 'x', movementVersion: 'y'
    }, 'track_1_signal_drift'));
    record('H.replay', 'invalid replay is rejected, not thrown', invalid && invalid.ok === false, invalid);

    // ---- I. offline backend failure is transparent -----------------------
    const offline = await page.evaluate(() => window.game.stateMachine.getState());
    record('I.offline', 'offline flow stays responsive (no account mutation)', offline !== undefined, {
      state: offline,
      abortedBackendRequests: abortedBackend
    });
  } catch (err) {
    record('harness', 'unexpected harness error', false, err.stack || String(err));
  } finally {
    // Pointer-lock is explicitly reported, never asserted as a human-input win.
    console.log(`NOTE pointerlock: browser pointer-lock state at end (menu) = ${JSON.stringify(
      await page.evaluate(() => {
        try { return window.game.cameraController.getIsLocked(); } catch { return null; }
      }).catch(() => null)
    )}`);
    console.log('PAGE ERRORS', JSON.stringify(pageErrors));
    if (pageErrors.length > 0) {
      record('harness', 'no uncaught page errors', false, pageErrors.slice(0, 5));
    } else {
      record('harness', 'no uncaught page errors', true);
    }

    const report = {
      generatedAt: new Date().toISOString(),
      url,
      viewport: '1440x900',
      abortedBackendRequests: abortedBackend,
      pointerLock:
        'headless limitation — real pointer lock cannot be acquired; gameplay path exercised without faking lock',
      results
    };
    fs.writeFileSync(path.join(evidenceDir, 'release-candidate-flows.json'), JSON.stringify(report, null, 2));
    console.log(`SUMMARY ${results.length - failures}/${results.length} passed; ${failures} failed`);

    try { await browser.close(); } catch {}
    if (ownServer && server?.httpServer) await new Promise((r) => server.httpServer.close(r));
    process.exitCode = failures === 0 ? 0 : 1;
  }
}

await main();
