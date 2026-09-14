import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function runPlaytest() {
  console.log('[PLAYTEST] Launching headless browser...');
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

  console.log('[PLAYTEST] Navigating to http://127.0.0.1:3000...');
  await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle0' });

  // 1. Opening / Import Screen
  await page.screenshot({ path: 'screenshot_import.png' });
  console.log('[PLAYTEST] Screenshot saved: screenshot_import.png');

  // 2. Click "DEV TEST TRACK"
  console.log('[PLAYTEST] Clicking DEV TEST TRACK...');
  await page.click('#btn-dev-track');

  // Wait for analysis to complete and ENTER TRACK button to be enabled
  console.log('[PLAYTEST] Waiting for track analysis...');
  await page.waitForFunction(() => {
    const btn = document.querySelector('#btn-enter-track');
    return btn && !btn.disabled;
  }, { timeout: 15000 });

  await page.screenshot({ path: 'screenshot_analysis.png' });
  console.log('[PLAYTEST] Screenshot saved: screenshot_analysis.png');

  // Extract analysis metrics
  const analysisData = await page.evaluate(() => {
    const game = window.game;
    const a = game.currentAnalysis;
    const t = game.currentTrack;
    return {
      duration: a.duration,
      bpm: a.bpm,
      bpmConfidence: a.bpmConfidence,
      onsetsCount: a.onsets.length,
      sectionsCount: a.sections.length,
      globalEnergy: a.globalEnergy,
      seedHex: a.seed.toString(16).toUpperCase(),
      routeNodesCount: t.route.length,
      checkpointsCount: t.checkpoints.length,
      repairsCount: t.repairedJumpsCount,
      totalDistance: t.totalDistance
    };
  });
  console.log('[PLAYTEST ANALYSIS REPORT]', JSON.stringify(analysisData, null, 2));

  // 3. Click "ENTER TRACK"
  console.log('[PLAYTEST] Clicking ENTER TRACK...');
  await page.click('#btn-enter-track');

  // Wait for countdown 3-2-1-RUN to transition to PLAYING
  console.log('[PLAYTEST] Waiting for COUNTDOWN to finish...');
  await page.waitForFunction(() => {
    return window.game && window.game.stateMachine.is('PLAYING');
  }, { timeout: 6000 });

  await page.screenshot({ path: 'screenshot_play_start.png' });
  console.log('[PLAYTEST] Screenshot saved: screenshot_play_start.png');

  // 4. Test Movement: Hold W for 1.5 seconds and evaluate velocity
  console.log('[PLAYTEST] Testing Forward Movement (Hold W)...');
  await page.keyboard.down('KeyW');
  await new Promise((r) => setTimeout(r, 1500));
  await page.keyboard.up('KeyW');

  const moveStats = await page.evaluate(() => {
    const p = window.game.playerController;
    return {
      pos: { x: p.position.x, y: p.position.y, z: p.position.z },
      vel: { x: p.velocity.x, y: p.velocity.y, z: p.velocity.z },
      speedUnits: p.getSpeedUnits(),
      isGrounded: p.isGrounded,
      isSurfing: p.isSurfing
    };
  });
  console.log('[PLAYTEST MOVE STATS (after 1.5s W)]', moveStats);

  // 5. Test Jumping / Bunny hopping: simulate jump while moving forward
  console.log('[PLAYTEST] Testing Jump & Bhop...');
  await page.keyboard.down('KeyW');
  await page.keyboard.down('Space');
  await new Promise((r) => setTimeout(r, 200));
  await page.keyboard.up('Space');
  await new Promise((r) => setTimeout(r, 400));
  // Second hop
  await page.keyboard.down('Space');
  await new Promise((r) => setTimeout(r, 200));
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyW');

  const jumpStats = await page.evaluate(() => {
    const p = window.game.playerController;
    return {
      pos: { x: p.position.x, y: p.position.y, z: p.position.z },
      vel: { x: p.velocity.x, y: p.velocity.y, z: p.velocity.z },
      speedUnits: p.getSpeedUnits(),
      maxRecordedSpeed: p.stats.maxSpeed,
      isGrounded: p.isGrounded
    };
  });
  console.log('[PLAYTEST JUMP & BHOP STATS]', jumpStats);

  // 6. Test Kill Plane & Checkpoint Restore: Teleport player off platform
  console.log('[PLAYTEST] Testing Kill Plane Fall & Restore...');
  await page.evaluate(() => {
    window.game.playerController.position.y = -50; // Below killPlaneY
  });

  await new Promise((r) => setTimeout(r, 500)); // wait for game tick

  const fallStats = await page.evaluate(() => {
    const p = window.game.playerController;
    return {
      pos: { x: p.position.x, y: p.position.y, z: p.position.z },
      vel: { x: p.velocity.x, y: p.velocity.y, z: p.velocity.z },
      fallsCount: p.stats.fallsCount,
      audioTime: window.game.audioEngine.getCurrentTime()
    };
  });
  console.log('[PLAYTEST FALL & RESTORE STATS]', fallStats);

  // 7. Test Pause & Resume
  console.log('[PLAYTEST] Testing Pause (Escape)...');
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 200));

  const isPaused = await page.evaluate(() => window.game.stateMachine.is('PAUSED'));
  console.log('[PLAYTEST IS PAUSED]', isPaused);

  console.log('[PLAYTEST] Resuming game...');
  await page.click('#btn-pause-resume');
  await new Promise((r) => setTimeout(r, 200));

  const isResumed = await page.evaluate(() => window.game.stateMachine.is('PLAYING'));
  console.log('[PLAYTEST IS RESUMED]', isResumed);

  // 8. Test Mid-run screenshot
  await page.screenshot({ path: 'screenshot_midrun.png' });
  console.log('[PLAYTEST] Screenshot saved: screenshot_midrun.png');

  // 9. Teleport near Finish Gate and cross finish line
  console.log('[PLAYTEST] Teleporting near Finish Gate...');
  await page.evaluate(() => {
    const finish = window.game.currentTrack.finish;
    window.game.playerController.position.set(finish.position.x, finish.position.y + 1.5, finish.position.z - 2);
  });

  // Wait for finish trigger
  await page.waitForFunction(() => {
    return window.game && window.game.stateMachine.is('FINISHED');
  }, { timeout: 5000 });

  console.log('[PLAYTEST] Reached Finish Gate!');
  await page.screenshot({ path: 'screenshot_results.png' });
  console.log('[PLAYTEST] Screenshot saved: screenshot_results.png');

  const resultsData = await page.evaluate(() => {
    return {
      time: document.querySelector('#res-time')?.textContent,
      target: document.querySelector('#res-target')?.textContent,
      sync: document.querySelector('#res-sync')?.textContent,
      rank: document.querySelector('#res-rank')?.textContent,
      maxSpeed: document.querySelector('#res-max-speed')?.textContent,
      strafe: document.querySelector('#res-strafe')?.textContent,
      score: document.querySelector('#res-score')?.textContent
    };
  });
  console.log('[PLAYTEST FINAL RESULTS]', resultsData);

  // 10. Test Replay Mode
  console.log('[PLAYTEST] Starting Replay Run...');
  await page.click('#btn-res-replay');
  await new Promise((r) => setTimeout(r, 500));

  const isReplaying = await page.evaluate(() => window.game.stateMachine.is('REPLAY'));
  console.log('[PLAYTEST IS REPLAYING]', isReplaying);

  await page.screenshot({ path: 'screenshot_replay.png' });
  console.log('[PLAYTEST] Screenshot saved: screenshot_replay.png');

  await browser.close();
  console.log('[PLAYTEST COMPLETED SUCCESSFULLY]');
}

runPlaytest().catch((err) => {
  console.error('[PLAYTEST FAILED]', err);
  process.exit(1);
});
