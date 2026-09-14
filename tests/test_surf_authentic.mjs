import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\lin4s\\.gemini\\antigravity\\brain\\ed6a93af-435f-4ce7-a35a-81381d79f4f6';

function copyArtifact(filename) {
  if (fs.existsSync(filename)) {
    fs.copyFileSync(filename, path.join(ARTIFACT_DIR, filename));
    console.log(`[ARTIFACT COPIED] ${filename}`);
  }
}

async function runSurfAuthenticTest() {
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

  // Switch to Movement Lab
  await page.evaluate(() => {
    window.game.stateMachine.transitionTo('MOVEMENT_LAB');
  });
  await new Promise((r) => setTimeout(r, 800));

  // Enable F3 overlay
  await page.keyboard.press('F3');
  await new Promise((r) => setTimeout(r, 300));

  // ================================================================
  // 1. TEST LEFT RAMP (Area F1) WITH KEY A (STRAFE INTO RAMP)
  // ================================================================
  console.log('\n--- TEST 1: Area F1 Left Ramp + Hold KeyA ---');
  await page.evaluate(() => {
    const p = window.game.playerController;
    // Enter Area F1 at 14 m/s (350 u/s) along +Z
    p.setPosition({ x: -4.0, y: 2.2, z: 1070 });
    p.velocity.set(0, -0.2, 14.0);
    p.setOrientation(Math.PI); // facing +Z along the ramp
  });

  // Hold KeyA for 600ms
  console.log('[TEST 1] Holding KeyA into left ramp...');
  await page.keyboard.down('KeyA');
  await new Promise((r) => setTimeout(r, 600));

  const leftRampState = await page.evaluate(() => {
    const p = window.game.playerController;
    const surf = p.surfState;
    return {
      pos: { x: p.position.x, y: p.position.y, z: p.position.z },
      vel: { x: p.velocity.x, y: p.velocity.y, z: p.velocity.z },
      speedUnits: Math.round(p.getSpeedUnits()),
      isSurfing: p.isSurfing || surf.isSurfing,
      surfSide: surf.surfSide
    };
  });
  await page.keyboard.up('KeyA');

  console.log(`[TEST 1 RESULT] Pos Y: ${leftRampState.pos.y.toFixed(2)} | Speed: ${leftRampState.speedUnits} u/s | Surfing: ${leftRampState.isSurfing} | Side: ${leftRampState.surfSide}`);
  await page.screenshot({ path: 'screenshot_surf_left_hold_a.png' });
  copyArtifact('screenshot_surf_left_hold_a.png');

  if (leftRampState.pos.y < -1.0) {
    throw new Error(`FAIL: Player fell off bottom of left ramp while holding KeyA! (Pos Y=${leftRampState.pos.y})`);
  }
  if (leftRampState.speedUnits < 400) {
    throw new Error(`FAIL: Speed did not maintain/accelerate on left ramp! (Speed=${leftRampState.speedUnits} u/s)`);
  }
  console.log('>>> SUCCESS: Holding KeyA counteracted gravity, stayed on left ramp, and built speed!');

  // ================================================================
  // 2. TEST LEFT RAMP WITH NO KEYS (SHOULD SLIDE DOWNHILL UNDER GRAVITY)
  // ================================================================
  console.log('\n--- TEST 2: Area F1 Left Ramp + No Keys (Natural Slide Off) ---');
  await page.evaluate(() => {
    const p = window.game.playerController;
    p.setPosition({ x: -4.0, y: 2.2, z: 1070 });
    p.velocity.set(0, -0.2, 14.0);
    p.setOrientation(Math.PI);
  });

  // Wait 700ms with NO keys pressed
  console.log('[TEST 2] Coasting with no keys pressed...');
  await new Promise((r) => setTimeout(r, 700));

  const noKeysState = await page.evaluate(() => {
    const p = window.game.playerController;
    return {
      pos: { x: p.position.x, y: p.position.y, z: p.position.z },
      vel: { x: p.velocity.x, y: p.velocity.y, z: p.velocity.z },
      speedUnits: Math.round(p.getSpeedUnits()),
      isSurfing: p.isSurfing
    };
  });

  console.log(`[TEST 2 RESULT] Pos Y: ${noKeysState.pos.y.toFixed(2)} (slid down under gravity) | Vel Y: ${noKeysState.vel.y.toFixed(2)}`);
  await page.screenshot({ path: 'screenshot_surf_no_keys_slide_down.png' });
  copyArtifact('screenshot_surf_no_keys_slide_down.png');

  if (noKeysState.pos.y > 0.0) {
    throw new Error(`FAIL: Player hovered without keys! Expected downward slide. (Pos Y=${noKeysState.pos.y})`);
  }
  console.log('>>> SUCCESS: Without strafe hold, gravity naturally pulled the player downhill!');

  // ================================================================
  // 3. TEST RIGHT RAMP (Area F2) WITH KEY D (STRAFE INTO RAMP)
  // ================================================================
  console.log('\n--- TEST 3: Area F2 Right Ramp + Hold KeyD ---');
  await page.evaluate(() => {
    const p = window.game.playerController;
    // Area F2 ramp is at x = 4.0, y = 2.5, z = 1255, rolled by -1.02 rad (right ramp)
    // Approach at x = 4.5, y = 4.2, z = 1220
    p.setPosition({ x: 4.5, y: 4.2, z: 1220 });
    p.velocity.set(0, -0.2, 15.0);
    p.setOrientation(Math.PI); // facing +Z along the ramp
  });

  console.log('[TEST 3] Holding KeyD into right ramp...');
  await page.keyboard.down('KeyD');
  await new Promise((r) => setTimeout(r, 600));

  const rightRampState = await page.evaluate(() => {
    const p = window.game.playerController;
    const surf = p.surfState;
    return {
      pos: { x: p.position.x, y: p.position.y, z: p.position.z },
      vel: { x: p.velocity.x, y: p.velocity.y, z: p.velocity.z },
      speedUnits: Math.round(p.getSpeedUnits()),
      isSurfing: p.isSurfing || surf.isSurfing,
      surfSide: surf.surfSide
    };
  });
  await page.keyboard.up('KeyD');

  console.log(`[TEST 3 RESULT] Pos Y: ${rightRampState.pos.y.toFixed(2)} | Speed: ${rightRampState.speedUnits} u/s | Surfing: ${rightRampState.isSurfing} | Side: ${rightRampState.surfSide}`);
  await page.screenshot({ path: 'screenshot_surf_right_hold_d.png' });
  copyArtifact('screenshot_surf_right_hold_d.png');

  if (rightRampState.pos.y < 0.0) {
    throw new Error(`FAIL: Player fell off bottom of right ramp while holding KeyD! (Pos Y=${rightRampState.pos.y})`);
  }
  if (rightRampState.speedUnits < 400) {
    throw new Error(`FAIL: Speed did not maintain/accelerate on right ramp! (Speed=${rightRampState.speedUnits} u/s)`);
  }
  console.log('>>> SUCCESS: Holding KeyD counteracted gravity, stayed on right ramp, and built speed!');

  // ================================================================
  // 4. TEST ANTI-CRAWL (STATIONARY + HOLD W INTO RAMP)
  // ================================================================
  console.log('\n--- TEST 4: Anti-Crawl (Stationary + Hold W Facing Uphill) ---');
  await page.evaluate(() => {
    const p = window.game.playerController;
    p.setPosition({ x: -4.0, y: 2.5, z: 1085 });
    p.velocity.set(0, 0, 0);
    p.setOrientation(Math.PI * 0.5); // facing -X uphill into the ramp
  });

  const crawlStartPos = await page.evaluate(() => {
    const pos = window.game.playerController.position;
    return { x: pos.x, y: pos.y, z: pos.z };
  });

  console.log('[TEST 4] Holding KeyW facing into/up the steep ramp...');
  await page.keyboard.down('KeyW');
  await new Promise((r) => setTimeout(r, 600));
  await page.keyboard.up('KeyW');

  const crawlEndPos = await page.evaluate(() => {
    const p = window.game.playerController;
    return {
      pos: { x: p.position.x, y: p.position.y, z: p.position.z },
      vel: { x: p.velocity.x, y: p.velocity.y, z: p.velocity.z }
    };
  });

  console.log(`[TEST 4 RESULT] Delta Y: ${(crawlEndPos.pos.y - crawlStartPos.y).toFixed(2)}`);
  await page.screenshot({ path: 'screenshot_surf_nocrawl_verified.png' });
  copyArtifact('screenshot_surf_nocrawl_verified.png');

  if (crawlEndPos.pos.y > crawlStartPos.y + 0.1) {
    throw new Error(`FAIL: Player climbed up the ramp with W! (Start Y=${crawlStartPos.y}, End Y=${crawlEndPos.pos.y})`);
  }
  console.log('>>> SUCCESS: Player did NOT crawl up the ramp with W! Gravity pulled player downhill.');

  await browser.close();
  console.log('\n========================================');
  console.log('[ALL AUTHENTIC SURF TESTS PASSED 100%]');
  console.log('========================================');
}

runSurfAuthenticTest().catch((err) => {
  console.error('[TEST FAILED]', err);
  process.exit(1);
});

