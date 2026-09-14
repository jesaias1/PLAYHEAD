import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\lin4s\\.gemini\\antigravity\\brain\\ed6a93af-435f-4ce7-a35a-81381d79f4f6';

async function runPremiumArtTest() {
  console.log('[PREMIUM ART PASS] Launching Edge browser...');
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

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error(`[BROWSER ERROR] ${msg.text()}`);
    }
  });

  page.on('pageerror', (err) => {
    console.error('[BROWSER PAGE ERROR]', err);
  });

  console.log('[PREMIUM ART PASS] Navigating to http://127.0.0.1:3000...');
  await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle0' });

  // 1. Capture Editorial Import Screen
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: 'screenshot_premium_title.png' });
  console.log('[SAVED] screenshot_premium_title.png');

  // 2. Click DEV: ELECTRONIC DROP
  console.log('[PREMIUM ART PASS] Selecting ELECTRONIC DROP...');
  await page.click('#btn-dev-track');

  await page.waitForFunction(() => {
    const btn = document.querySelector('#btn-enter-track');
    return btn && !btn.disabled;
  }, { timeout: 15000 });

  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: 'screenshot_premium_analysis.png' });
  console.log('[SAVED] screenshot_premium_analysis.png');

  // 3. Enter Track & Start Run
  console.log('[PREMIUM ART PASS] Entering track...');
  await page.click('#btn-enter-track');

  await page.waitForFunction(() => {
    return window.game && window.game.stateMachine.is('PLAYING');
  }, { timeout: 10000 });

  // Let player run forward in intro
  await page.keyboard.down('KeyW');
  await new Promise(r => setTimeout(r, 1200));
  await page.keyboard.up('KeyW');

  await page.screenshot({ path: 'screenshot_premium_intro.png' });
  console.log('[SAVED] screenshot_premium_intro.png');

  // 4. Teleport to BUILDUP section
  console.log('[PREMIUM ART PASS] Teleporting to BUILDUP section...');
  await page.evaluate(() => {
    const game = window.game;
    const track = game.currentTrack;
    const buildupSec = game.currentAnalysis.sections.find(s => s.theme === 'BUILDUP');
    const targetTime = buildupSec ? buildupSec.start + 2.0 : 25.0;
    const targetNode = track.route.find(n => n.time >= targetTime) || track.route[Math.floor(track.route.length * 0.35)];
    game.audioEngine.seek(targetNode.time);
    game.playerController.setPosition({
      x: targetNode.position.x,
      y: targetNode.position.y + 1.5,
      z: targetNode.position.z
    });
  });

  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: 'screenshot_premium_buildup.png' });
  console.log('[SAVED] screenshot_premium_buildup.png');

  // 5. Teleport to DROP section
  console.log('[PREMIUM ART PASS] Teleporting to DROP section...');
  await page.evaluate(() => {
    const game = window.game;
    const track = game.currentTrack;
    const dropSec = game.currentAnalysis.sections.find(s => s.theme === 'DROP');
    const targetTime = dropSec ? dropSec.start + 1.0 : 38.0;
    const targetNode = track.route.find(n => n.time >= targetTime) || track.route[Math.floor(track.route.length * 0.5)];
    game.audioEngine.seek(targetNode.time);
    game.playerController.setPosition({
      x: targetNode.position.x,
      y: targetNode.position.y + 1.5,
      z: targetNode.position.z
    });
  });

  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: 'screenshot_premium_drop.png' });
  console.log('[SAVED] screenshot_premium_drop.png');

  // 6. Teleport to SURF sequence
  console.log('[PREMIUM ART PASS] Teleporting to SURF sequence...');
  await page.evaluate(() => {
    const game = window.game;
    const track = game.currentTrack;
    const surfNode = track.route.find(n => n.isSurf);
    if (surfNode) {
      game.audioEngine.seek(surfNode.time);
      game.playerController.setPosition({
        x: surfNode.position.x,
        y: surfNode.position.y + 1.2,
        z: surfNode.position.z - 2.0
      });
      game.playerController.velocity.set(0, -1.0, 22.0);
    }
  });

  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: 'screenshot_premium_surf.png' });
  console.log('[SAVED] screenshot_premium_surf.png');

  // 7. Test Pause Screen (left-aligned brutalist menu with visible frozen 3D world)
  console.log('[PREMIUM ART PASS] Testing Pause Screen...');
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: 'screenshot_premium_pause.png' });
  console.log('[SAVED] screenshot_premium_pause.png');

  // Resume game
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 400));

  // 8. Test Finish & Results Screen
  console.log('[PREMIUM ART PASS] Teleporting to Finish Portal...');
  await page.evaluate(() => {
    const game = window.game;
    const track = game.currentTrack;
    const finish = track.finish;
    game.playerController.setPosition({
      x: finish.position.x,
      y: finish.position.y + 1.0,
      z: finish.position.z - 1.0
    });
  });

  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: 'screenshot_premium_results.png' });
  console.log('[SAVED] screenshot_premium_results.png');

  // 9. Collect renderer statistics
  const renderStats = await page.evaluate(() => {
    const renderer = window.game.environment.renderer;
    const info = renderer.info;
    const director = window.game.world.songDirector.state;
    return {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      qualityMode: window.game.environment.postProcessing.qualityMode,
      dramaticIntensity: director.dramaticIntensity,
      phase: director.phase,
      starVisibility: director.starVisibility
    };
  });
  console.log('[RENDER STATS]', JSON.stringify(renderStats, null, 2));

  // Copy all screenshots to artifact directory
  const filesToCopy = [
    'screenshot_premium_title.png',
    'screenshot_premium_analysis.png',
    'screenshot_premium_intro.png',
    'screenshot_premium_buildup.png',
    'screenshot_premium_drop.png',
    'screenshot_premium_surf.png',
    'screenshot_premium_pause.png',
    'screenshot_premium_results.png'
  ];

  for (const f of filesToCopy) {
    if (fs.existsSync(f)) {
      fs.copyFileSync(f, path.join(ARTIFACT_DIR, f));
      console.log(`[COPIED TO ARTIFACTS] ${f}`);
    }
  }

  await browser.close();
  console.log('[PREMIUM ART PASS TEST COMPLETE]');
}

runPremiumArtTest().catch((err) => {
  console.error('[PREMIUM ART PASS TEST FAILED]', err);
  process.exit(1);
});
