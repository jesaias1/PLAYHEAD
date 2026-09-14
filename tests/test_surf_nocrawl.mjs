import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testSurfNoCrawl() {
  console.log('[TEST] Launching browser...');
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

  console.log('[TEST] Navigating to http://127.0.0.1:3000...');
  await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle0' });

  // Enter Movement Lab
  await page.evaluate(() => {
    window.game.stateMachine.transitionTo('MOVEMENT_LAB');
  });
  await new Promise((r) => setTimeout(r, 800));

  // 1. Teleport to Area F1 ramp
  console.log('[TEST] Placing player onto Area F1 ramp...');
  await page.evaluate(() => {
    const game = window.game;
    // Area F1 ramp is at x = -3.5, y = 0.5, z = 1095, rolled by 57 deg.
    // Place player on the ramp face with zero initial speed
    game.playerController.setPosition({ x: -4.0, y: 2.5, z: 1085 });
    game.playerController.velocity.set(0, 0, 0);
    // Face directly uphill/into the ramp (-X direction)
    game.playerController.setOrientation(Math.PI * 0.5); // facing -X
  });

  // Enable F3 overlay
  await page.keyboard.press('F3');
  await new Promise((r) => setTimeout(r, 300));

  const startPos = await page.evaluate(() => {
    const pos = window.game.playerController.position;
    return { x: pos.x, y: pos.y, z: pos.z };
  });
  console.log(`[TEST] Start Pos: X=${startPos.x.toFixed(2)}, Y=${startPos.y.toFixed(2)}, Z=${startPos.z.toFixed(2)}`);

  // 2. Press and hold KeyW for 600ms (trying to crawl uphill)
  console.log('[TEST] Holding KeyW facing into/up the steep ramp...');
  await page.keyboard.down('KeyW');
  await new Promise((r) => setTimeout(r, 600));
  await page.keyboard.up('KeyW');

  const afterWPos = await page.evaluate(() => {
    const p = window.game.playerController;
    return {
      pos: { x: p.position.x, y: p.position.y, z: p.position.z },
      vel: { x: p.velocity.x, y: p.velocity.y, z: p.velocity.z },
      isGrounded: p.isGrounded,
      isSurfing: p.isSurfing
    };
  });
  console.log(`[TEST] After holding W for 600ms: Pos Y=${afterWPos.pos.y.toFixed(2)} (delta Y = ${(afterWPos.pos.y - startPos.y).toFixed(2)})`);
  console.log(`[TEST] Vel: (${afterWPos.vel.x.toFixed(2)}, ${afterWPos.vel.y.toFixed(2)}, ${afterWPos.vel.z.toFixed(2)}) | Grounded: ${afterWPos.isGrounded} | Surfing: ${afterWPos.isSurfing}`);

  // Capture screenshot of player sliding down / not climbing
  await page.screenshot({ path: 'screenshot_surf_nocrawl.png' });
  console.log('[SAVED] screenshot_surf_nocrawl.png');

  // Verify: Y position did NOT increase! (Player did not crawl up!)
  if (afterWPos.pos.y > startPos.y + 0.1) {
    throw new Error(`FAIL: Player climbed up the ramp! start Y=${startPos.y}, end Y=${afterWPos.pos.y}`);
  } else {
    console.log('SUCCESS: Player did NOT crawl up the ramp! Gravity prevented climbing.');
  }

  // 3. Test authentic surfing: Enter with forward speed along +Z and strafe into ramp
  console.log('[TEST] Testing authentic surf speed accumulation...');
  await page.evaluate(() => {
    const game = window.game;
    // Enter Area F1 at 14 m/s along +Z
    game.playerController.setPosition({ x: -4.0, y: 2.5, z: 1070 });
    game.playerController.velocity.set(0, -0.5, 14.0);
    game.playerController.setOrientation(Math.PI); // facing +Z along the ramp
  });

  // Hold KeyA (strafe into left ramp)
  await page.keyboard.down('KeyA');
  await new Promise((r) => setTimeout(r, 500));
  await page.keyboard.up('KeyA');

  const surfEndState = await page.evaluate(() => {
    const p = window.game.playerController;
    return {
      speed: p.getSpeedUnits(),
      vel: { x: p.velocity.x, y: p.velocity.y, z: p.velocity.z },
      isSurfing: p.isSurfing
    };
  });
  console.log(`[TEST] Surf speed: ${Math.round(surfEndState.speed)} u/s (vel: ${surfEndState.vel.x.toFixed(1)}, ${surfEndState.vel.y.toFixed(1)}, ${surfEndState.vel.z.toFixed(1)})`);

  // Copy screenshot to artifact dir
  const artifactDir = 'C:\\Users\\lin4s\\.gemini\\antigravity\\brain\\ed6a93af-435f-4ce7-a35a-81381d79f4f6';
  if (fs.existsSync('screenshot_surf_nocrawl.png')) {
    fs.copyFileSync('screenshot_surf_nocrawl.png', path.join(artifactDir, 'screenshot_surf_nocrawl.png'));
  }

  await browser.close();
  console.log('[TEST COMPLETED SUCCESSFULLY]');
}

testSurfNoCrawl().catch((err) => {
  console.error('[TEST FAILED]', err);
  process.exit(1);
});
