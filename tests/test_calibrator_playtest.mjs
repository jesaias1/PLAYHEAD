/**
 * End-to-end playtest verifying ViewmodelCalibrator (F4) in the live running game.
 */

import puppeteer from 'puppeteer-core';
import path from 'path';

const ARTIFACT_DIR = 'C:\\Users\\lin4s\\.gemini\\antigravity\\brain\\ed6a93af-435f-4ce7-a35a-81381d79f4f6';
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function runCalibratorPlaytest() {
  console.log('[CALIBRATOR TEST] Launching browser...');
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-webgpu',
      '--window-size=1280,720'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[CALIBRAT') || text.includes('[Viewmodel') || text.includes('PLAYHEAD')) {
        console.log(`[BROWSER] ${text}`);
      }
    });

    console.log('[CALIBRATOR TEST] Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1200));

    // 1. Launch FIRST CONTACT from Title Showcase
    console.log('[CALIBRATOR TEST] Launching FIRST CONTACT course...');
    await page.waitForSelector('#btn-showcase-enter', { timeout: 10000 });
    await page.click('#btn-showcase-enter');

    // Wait for analysis to complete and ENTER TRACK button on Analysis Screen to be enabled
    console.log('[CALIBRATOR TEST] Waiting for course generation and analysis screen...');
    await page.waitForFunction(() => {
      const btn = document.querySelector('#btn-enter-track');
      return btn && !btn.disabled;
    }, { timeout: 20000 });

    console.log('[CALIBRATOR TEST] Entering course from Analysis Screen...');
    await page.click('#btn-enter-track');

    // Wait for game to enter PLAYING state
    await page.waitForFunction(() => {
      return window.game && window.game.stateMachine && window.game.stateMachine.is('PLAYING');
    }, { timeout: 12000 });
    console.log('[CALIBRATOR TEST] Successfully entered PLAYING state for FIRST CONTACT!');

    // 1. Press [F4] to activate calibration mode
    console.log('[CALIBRATOR TEST] Pressing [F4] to open calibration mode...');
    await page.keyboard.press('F4');
    await new Promise(r => setTimeout(r, 400));

    const calStatus = await page.evaluate(() => {
      const cal = window.game.viewmodelCalibrator;
      const panel = document.getElementById('viewmodel-calibrator-panel');
      return {
        isActive: cal.isActive,
        panelVisible: panel && panel.style.display !== 'none',
        currentMode: cal.currentMode,
        currentSpace: cal.currentSpace,
        hasGizmo: Boolean(cal.gizmoHelper),
        knifeSocketPos: cal.viewmodelController.knifeSocketPos.toArray(),
        knifeSocketRot: cal.viewmodelController.knifeSocketRot.toArray(),
        knifeSocketScale: cal.viewmodelController.knifeSocketScale.toArray()
      };
    });

    console.log('[CALIBRATOR TEST] Calibrator status after F4:', calStatus);
    if (!calStatus.isActive) throw new Error('viewmodelCalibrator did not activate on F4');
    if (!calStatus.panelVisible) throw new Error('Calibration panel is not visible in DOM');

    // Capture screenshot of calibration mode with gizmo and panel!
    const calScreenshotPath = path.join(ARTIFACT_DIR, 'screenshot_viewmodel_calibration.png');
    await page.screenshot({ path: calScreenshotPath, fullPage: false });
    console.log(`[CALIBRATOR TEST] Captured calibration screenshot: ${calScreenshotPath}`);

    // 2. Test Mode Switching
    console.log('[CALIBRATOR TEST] Testing shortcut keys [1], [2], [3]...');
    await page.keyboard.press('Digit1');
    const mode1 = await page.evaluate(() => window.game.viewmodelCalibrator.currentMode);
    console.log(`[CALIBRATOR TEST] Mode after Digit1: ${mode1}`);
    if (mode1 !== 'translate') throw new Error('Digit1 failed to switch mode to translate');

    await page.keyboard.press('Digit2');
    const mode2 = await page.evaluate(() => window.game.viewmodelCalibrator.currentMode);
    console.log(`[CALIBRATOR TEST] Mode after Digit2: ${mode2}`);
    if (mode2 !== 'rotate') throw new Error('Digit2 failed to switch mode to rotate');

    await page.keyboard.press('Digit3');
    const mode3 = await page.evaluate(() => window.game.viewmodelCalibrator.currentMode);
    console.log(`[CALIBRATOR TEST] Mode after Digit3: ${mode3}`);
    if (mode3 !== 'scale') throw new Error('Digit3 failed to switch mode to scale');

    // 3. Test Numeric Adjustment
    console.log('[CALIBRATOR TEST] Testing numeric input adjustment...');
    await page.evaluate(() => {
      // Simulate user nudging position Z
      window.game.viewmodelCalibrator.nudgeValue('posZ', 5); // +0.005m
    });

    const newPosZ = await page.evaluate(() => window.game.viewmodelController.knifeSocketPos.z);
    console.log(`[CALIBRATOR TEST] Position Z after nudge: ${newPosZ}`);

    // 4. Test SAVE LOCAL
    console.log('[CALIBRATOR TEST] Testing SAVE LOCAL...');
    await page.evaluate(() => {
      window.game.viewmodelCalibrator.saveLocal();
    });

    const savedLocal = await page.evaluate(() => {
      return localStorage.getItem('playhead.viewmodel.karambitCalibration');
    });
    console.log('[CALIBRATOR TEST] Saved localStorage contents:', savedLocal);
    if (!savedLocal) throw new Error('SAVE LOCAL failed to write to localStorage');

    // 5. Test COPY CONFIG
    console.log('[CALIBRATOR TEST] Testing COPY CONFIG...');
    await page.evaluate(() => {
      window.game.viewmodelCalibrator.copyConfig();
    });

    // 6. Press [F4] to exit calibration mode
    console.log('[CALIBRATOR TEST] Pressing [F4] to exit calibration mode...');
    await page.keyboard.press('F4');
    await new Promise(r => setTimeout(r, 400));

    const exitedStatus = await page.evaluate(() => {
      const cal = window.game.viewmodelCalibrator;
      const panel = document.getElementById('viewmodel-calibrator-panel');
      return {
        isActive: cal.isActive,
        panelVisible: panel && panel.style.display !== 'none'
      };
    });

    console.log('[CALIBRATOR TEST] Status after F4 exit:', exitedStatus);
    if (exitedStatus.isActive) throw new Error('viewmodelCalibrator failed to deactivate on F4');
    if (exitedStatus.panelVisible) throw new Error('Calibration panel failed to hide on exit');

    // Capture screenshot showing restored gameplay
    const resumedScreenshotPath = path.join(ARTIFACT_DIR, 'screenshot_viewmodel_resumed.png');
    await page.screenshot({ path: resumedScreenshotPath, fullPage: false });
    console.log(`[CALIBRATOR TEST] Captured resumed gameplay screenshot: ${resumedScreenshotPath}`);

    // 7. Verify persistence across page reload
    console.log('[CALIBRATOR TEST] Reloading page to verify localStorage persistence...');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1200));

    const reloadedTransform = await page.evaluate(() => {
      return window.game.viewmodelController.knifeSocketPos.toArray();
    });
    console.log('[CALIBRATOR TEST] Socket position after reload:', reloadedTransform);
    if (Math.abs(reloadedTransform[2] - newPosZ) > 0.0001) {
      throw new Error(`Persisted transform mismatch: expected Z ${newPosZ}, got ${reloadedTransform[2]}`);
    }
    console.log('[CALIBRATOR TEST] Persisted transform verified successfully across reload!');

    console.log('=== [VIEWMODEL CALIBRATOR PLAYTEST PASSED 100%] ===');
  } catch (err) {
    console.error('[CALIBRATOR PLAYTEST FAILED]', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

runCalibratorPlaytest();
