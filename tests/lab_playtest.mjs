import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function runLabPlaytest() {
  console.log('[LAB PLAYTEST] Launching browser...');
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

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  const consoleLogs = [];
  page.on('console', (msg) => {
    const text = `[BROWSER ${msg.type().toUpperCase()}] ${msg.text()}`;
    consoleLogs.push(text);
    console.log(text);
  });

  page.on('pageerror', (err) => {
    console.error('[BROWSER PAGE ERROR]', err);
  });

  console.log('[LAB PLAYTEST] Navigating to http://127.0.0.1:3000...');
  await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle0' });

  // 1. Check Import Screen & Screenshot
  await page.screenshot({ path: 'screenshot_import_lab_btn.png' });
  console.log('[LAB PLAYTEST] Screenshot saved: screenshot_import_lab_btn.png');

  // 2. Click MOVEMENT LAB button
  console.log('[LAB PLAYTEST] Clicking MOVEMENT LAB button...');
  await page.click('#btn-movement-lab');

  // Wait for MOVEMENT_LAB state
  await page.waitForFunction(() => {
    return window.game && window.game.stateMachine.is('MOVEMENT_LAB');
  }, { timeout: 5000 });

  // Wait a moment for scene and HUD to render
  await new Promise((r) => setTimeout(r, 600));

  await page.screenshot({ path: 'screenshot_lab_spawn.png' });
  console.log('[LAB PLAYTEST] Screenshot saved: screenshot_lab_spawn.png');

  // 3. Verify HUD elements & initial values
  const labHUDStatus = await page.evaluate(() => {
    const hud = document.querySelector('#movement-lab-hud');
    const preset = document.querySelector('#lab-preset')?.textContent;
    const speed = document.querySelector('#lab-speed')?.textContent;
    const state = document.querySelector('#lab-state')?.textContent;
    const vel = document.querySelector('#lab-vel')?.textContent;
    const look = document.querySelector('#lab-look')?.textContent;
    const traj = document.querySelector('#lab-traj')?.textContent;
    const player = window.game.playerController;
    return {
      hudVisible: hud !== null && getComputedStyle(hud).display !== 'none',
      preset,
      speed,
      state,
      vel,
      look,
      traj,
      playerPos: { x: player.position.x, y: player.position.y, z: player.position.z },
      currentPreset: player.config.presetName
    };
  });
  console.log('[LAB PLAYTEST STATUS]', JSON.stringify(labHUDStatus, null, 2));

  // 4. Test Mouse delta math via CameraController
  const mouseTestResults = await page.evaluate(() => {
    const cam = window.game.cameraController;
    const initialYaw = cam.yaw;
    const initialPitch = cam.pitch;

    // Simulate mouse moving RIGHT (+100 deltaX)
    // Mathematical requirement: mouse right -> yaw decreases -> look rotates right
    cam.applyMouseDelta(100, 0);
    const yawAfterRight = cam.yaw;
    const yawDecreased = yawAfterRight < initialYaw;

    // Reset yaw
    cam.setOrientation(0);
    const fwd0 = cam.getForwardVector(); // should be (0, 0, -1)
    cam.applyMouseDelta(100, 0); // yaw becomes negative
    const fwdAfterRight = cam.getForwardVector();
    // When facing -Z, turning right means moving toward +X. So fwdAfterRight.x should be > 0.
    const fwdTurnsRight = fwdAfterRight.x > 0;

    // Simulate mouse moving UP (-50 deltaY in browser convention)
    // Mathematical requirement: mouse up -> pitch increases -> look up
    const pitchBeforeUp = cam.pitch;
    cam.applyMouseDelta(0, -50);
    const pitchAfterUp = cam.pitch;
    const pitchIncreased = pitchAfterUp > pitchBeforeUp;

    return {
      initialYaw,
      yawAfterRight,
      yawDecreased,
      fwd0: { x: fwd0.x, y: fwd0.y, z: fwd0.z },
      fwdAfterRight: { x: fwdAfterRight.x, y: fwdAfterRight.y, z: fwdAfterRight.z },
      fwdTurnsRight,
      pitchBeforeUp,
      pitchAfterUp,
      pitchIncreased
    };
  });
  console.log('[LAB MOUSE TEST]', JSON.stringify(mouseTestResults, null, 2));

  // 5. Test Preset Switching (keys 1, 2, 3)
  console.log('[LAB PLAYTEST] Testing Preset Switching (1, 2, 3)...');
  await page.keyboard.press('Digit1');
  await new Promise((r) => setTimeout(r, 100));
  const p1 = await page.evaluate(() => window.game.playerController.currentPreset);

  await page.keyboard.press('Digit2');
  await new Promise((r) => setTimeout(r, 100));
  const p2 = await page.evaluate(() => window.game.playerController.currentPreset);

  await page.keyboard.press('Digit3');
  await new Promise((r) => setTimeout(r, 100));
  const p3 = await page.evaluate(() => window.game.playerController.currentPreset);

  console.log(`[LAB PRESETS] 1 -> ${p1}, 2 -> ${p2}, 3 -> ${p3}`);

  // 6. Test Trajectory toggle (KeyT)
  console.log('[LAB PLAYTEST] Testing Trajectory toggle (KeyT)...');
  await page.keyboard.press('KeyT');
  await new Promise((r) => setTimeout(r, 100));
  const trajAfterT = await page.evaluate(() => window.game.movementLab.isTrajectoryEnabled());
  console.log(`[LAB TRAJECTORY TOGGLE] Enabled: ${trajAfterT}`);

  // 7. Test Movement & Reset (KeyR)
  console.log('[LAB PLAYTEST] Testing Movement along Area A runway...');
  await page.keyboard.down('KeyW');
  await page.keyboard.down('Space');
  await new Promise((r) => setTimeout(r, 800));
  await page.keyboard.up('Space');
  await new Promise((r) => setTimeout(r, 800));
  await page.keyboard.up('KeyW');

  const moveStats = await page.evaluate(() => {
    const p = window.game.playerController;
    return {
      pos: { x: p.position.x, y: p.position.y, z: p.position.z },
      vel: { x: p.velocity.x, y: p.velocity.y, z: p.velocity.z },
      speed: p.getSpeedUnits()
    };
  });
  console.log('[LAB MOVE STATS]', JSON.stringify(moveStats, null, 2));

  await page.screenshot({ path: 'screenshot_lab_runway_jump.png' });
  console.log('[LAB PLAYTEST] Screenshot saved: screenshot_lab_runway_jump.png');

  // Press R to Reset
  console.log('[LAB PLAYTEST] Pressing R to reset...');
  await page.keyboard.press('KeyR');
  await new Promise((r) => setTimeout(r, 200));

  const resetStats = await page.evaluate(() => {
    const p = window.game.playerController;
    return {
      pos: { x: p.position.x, y: p.position.y, z: p.position.z },
      vel: { x: p.velocity.x, y: p.velocity.y, z: p.velocity.z },
      speed: p.getSpeedUnits()
    };
  });
  console.log('[LAB RESET STATS]', JSON.stringify(resetStats, null, 2));

  // 8. Teleport player to look at Areas B, C, D, F, G for screenshots
  // Area B (Bhop Straight)
  await page.evaluate(() => {
    const p = window.game.playerController;
    p.setPosition({ x: 0, y: 1.5, z: 75 });
    p.setOrientation(Math.PI);
    p.velocity.set(0, 0, 0);
  });
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: 'screenshot_lab_area_b.png' });

  // Area C (Air Strafe Gap)
  await page.evaluate(() => {
    const p = window.game.playerController;
    p.setPosition({ x: 0, y: 1.5, z: 215 });
    p.setOrientation(Math.PI);
    p.velocity.set(0, 0, 0);
  });
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: 'screenshot_lab_area_c.png' });

  // Area D (Slalom)
  await page.evaluate(() => {
    const p = window.game.playerController;
    p.setPosition({ x: 0, y: 1.5, z: 325 });
    p.setOrientation(Math.PI);
    p.velocity.set(0, 0, 0);
  });
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: 'screenshot_lab_area_d.png' });

  // Area F (Surf Ramp)
  await page.evaluate(() => {
    const p = window.game.playerController;
    p.setPosition({ x: 0, y: 1.5, z: 630 });
    p.setOrientation(Math.PI);
    p.velocity.set(0, 0, 0);
  });
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: 'screenshot_lab_area_f.png' });

  // Area G (Jump Calibration)
  await page.evaluate(() => {
    const p = window.game.playerController;
    p.setPosition({ x: 0, y: 1.5, z: 765 });
    p.setOrientation(Math.PI);
    p.velocity.set(0, 0, 0);
  });
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: 'screenshot_lab_area_g.png' });

  console.log('[LAB PLAYTEST] All screenshots saved!');
  await browser.close();
  console.log('[LAB PLAYTEST] Test completed successfully!');
}

runLabPlaytest().catch((err) => {
  console.error('[LAB PLAYTEST FAILED]', err);
  process.exit(1);
});
