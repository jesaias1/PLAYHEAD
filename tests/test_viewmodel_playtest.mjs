import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\lin4s\\.gemini\\antigravity\\brain\\ed6a93af-435f-4ce7-a35a-81381d79f4f6';

async function runViewmodelPlaytest() {
  console.log('[VIEWMODEL TEST] Launching Edge browser...');
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--window-size=1920,1080'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    page.on('console', (msg) => {
      const txt = msg.text();
      if (msg.type() === 'error') {
        console.error(`[BROWSER ERROR] ${txt}`);
      } else if (txt.includes('Viewmodel') || txt.includes('TrackGenerator')) {
        console.log(`[BROWSER] ${txt}`);
      }
    });

    console.log('[VIEWMODEL TEST] Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });

    // 1. Launch FIRST CONTACT from Title Showcase
    console.log('[VIEWMODEL TEST] Launching FIRST CONTACT course...');
    await page.waitForSelector('#btn-showcase-enter', { timeout: 10000 });
    await page.click('#btn-showcase-enter');

    // Wait for analysis to complete and ENTER TRACK button on Analysis Screen to be enabled
    console.log('[VIEWMODEL TEST] Waiting for course generation and analysis screen...');
    await page.waitForFunction(() => {
      const btn = document.querySelector('#btn-enter-track');
      return btn && !btn.disabled;
    }, { timeout: 20000 });

    console.log('[VIEWMODEL TEST] Entering course from Analysis Screen...');
    await page.click('#btn-enter-track');

    // Wait for game to enter PLAYING state
    await page.waitForFunction(() => {
      return window.game && window.game.stateMachine && window.game.stateMachine.is('PLAYING');
    }, { timeout: 12000 });
    console.log('[VIEWMODEL TEST] Successfully entered PLAYING state for FIRST CONTACT!');

    // Wait 1000ms for scene and viewmodel lighting to settle
    await new Promise(r => setTimeout(r, 1000));

    // Verify viewmodelController exists
    const vmStatus = await page.evaluate(() => {
      const vm = window.game.viewmodelController;
      return {
        hasController: !!vm,
        hasScene: !!(vm && vm.scene),
        cameraFov: vm ? vm.camera.fov : 0
      };
    });
    console.log('[VIEWMODEL TEST] Viewmodel Controller Status:', vmStatus);
    if (!vmStatus.hasController) throw new Error('viewmodelController missing on window.game');

    // 2. Capture Base Posture Screenshot (Ready Stance in lower-right)
    const baseScreenshotPath = path.join(ARTIFACT_DIR, 'screenshot_viewmodel_base.png');
    await page.screenshot({ path: baseScreenshotPath, fullPage: false });
    console.log(`[VIEWMODEL TEST] Captured base posture screenshot: ${baseScreenshotPath}`);

    // 3. Movement & Strafe Banking: Hold [W] and [A]
    console.log('[VIEWMODEL TEST] Testing forward run + left strafe banking...');
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyA');
    await new Promise(r => setTimeout(r, 800));

    // Capture Strafe Banking Screenshot
    const strafeScreenshotPath = path.join(ARTIFACT_DIR, 'screenshot_viewmodel_strafe.png');
    await page.screenshot({ path: strafeScreenshotPath, fullPage: false });
    console.log(`[VIEWMODEL TEST] Captured strafe posture screenshot: ${strafeScreenshotPath}`);

    await page.keyboard.up('KeyA');
    await page.keyboard.up('KeyW');
    await new Promise(r => setTimeout(r, 400));

    // 4. Test Jump Takeoff & Landing
    console.log('[VIEWMODEL TEST] Testing jump takeoff and landing compression...');
    await page.keyboard.down('Space');
    await new Promise(r => setTimeout(r, 150));
    await page.keyboard.up('Space');
    await new Promise(r => setTimeout(r, 700)); // Allow landing compression

    // 5. Test [F] Karambit Inspect Flourish
    console.log('[VIEWMODEL TEST] Triggering [F] Karambit Inspect Flourish...');
    await page.keyboard.press('KeyF');

    // Wait 250ms into the 360° ring spin
    await new Promise(r => setTimeout(r, 280));
    const isInspecting = await page.evaluate(() => window.game.viewmodelController.isInspectActive());
    console.log(`[VIEWMODEL TEST] Inspect active during spin: ${isInspecting}`);
    if (!isInspecting) throw new Error('Inspect flourish failed to activate on KeyF');

    // Capture Inspect Flourish Screenshot
    const inspectScreenshotPath = path.join(ARTIFACT_DIR, 'screenshot_viewmodel_inspect.png');
    await page.screenshot({ path: inspectScreenshotPath, fullPage: false });
    console.log(`[VIEWMODEL TEST] Captured inspect flourish screenshot: ${inspectScreenshotPath}`);

    // Wait for inspect to complete
    await new Promise(r => setTimeout(r, 1400));
    const inspectFinished = await page.evaluate(() => !window.game.viewmodelController.isInspectActive());
    console.log(`[VIEWMODEL TEST] Inspect returned to ready stance: ${inspectFinished}`);

    // 6. Test Surf Balance Posture by navigating to the Lab surf ramp
    console.log('[VIEWMODEL TEST] Testing surf balance posture on Lab surf ramp...');
    // Teleport or step player into surf ramp area
    await page.evaluate(() => {
      // In Movement Lab, surf ramp is nearby
      const player = window.game.playerController;
      player.isSurfing = true;
      player.surfState.isSurfing = true;
      player.surfState.surfSide = 'LEFT';
      player.velocity.set(16.0, -10.0, 22.0);
    });
    await new Promise(r => setTimeout(r, 300));

    // Capture Surf Balance Screenshot
    const surfScreenshotPath = path.join(ARTIFACT_DIR, 'screenshot_viewmodel_surf.png');
    await page.screenshot({ path: surfScreenshotPath, fullPage: false });
    console.log(`[VIEWMODEL TEST] Captured surf balance screenshot: ${surfScreenshotPath}`);

    // Reset surf state
    await page.evaluate(() => {
      const player = window.game.playerController;
      player.isSurfing = false;
      player.surfState.isSurfing = false;
      player.surfState.surfSide = 'NONE';
    });

    // 7. Test Settings: Minimal and Off Modes
    console.log('[VIEWMODEL TEST] Testing Minimal mode (left hand hidden)...');
    await page.evaluate(() => {
      window.game.settingsManager = (window).game.ui.settingsModal['settingsManager'];
      window.game.settingsManager.update({ viewmodelMode: 'MINIMAL' });
    });
    await new Promise(r => setTimeout(r, 200));

    const isLeftHidden = await page.evaluate(() => {
      const vm = window.game.viewmodelController;
      const bone = vm.rigInstance?.handLBone;
      if (bone) return bone.visible === false;
      return !vm['leftArmGroup']?.visible;
    });
    console.log(`[VIEWMODEL TEST] Minimal mode left arm hidden: ${isLeftHidden}`);
    if (!isLeftHidden) throw new Error('Minimal mode failed to hide left arm');

    // Restore to Full mode
    await page.evaluate(() => {
      window.game.settingsManager.update({ viewmodelMode: 'FULL' });
    });
    await new Promise(r => setTimeout(r, 200));

    console.log('=== [VIEWMODEL PLAYTEST PASSED SUCCESSFULLY] ===');
  } catch (err) {
    console.error('[VIEWMODEL PLAYTEST FAILED]', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

runViewmodelPlaytest();
