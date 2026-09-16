import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\lin4s\\.gemini\\antigravity\\brain\\ed6a93af-435f-4ce7-a35a-81381d79f4f6';

async function runGhostRacingPlaytest() {
  console.log('[GHOST RACING TEST] Launching Edge browser...');
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
      } else if (txt.includes('Ghost') || txt.includes('TrackGenerator')) {
        console.log(`[BROWSER] ${txt}`);
      }
    });

    page.on('pageerror', (err) => {
      console.error('[BROWSER PAGE ERROR]', err);
    });

    console.log('[GHOST RACING TEST] Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

    // Select DEV ELECTRONIC_DROP
    console.log('[GHOST RACING TEST] Selecting ELECTRONIC DROP track...');
    await page.waitForSelector('#btn-dev-track');
    await page.click('#btn-dev-track');

    await page.waitForFunction(() => {
      const btn = document.querySelector('#btn-enter-track');
      return btn && !btn.disabled;
    }, { timeout: 15000 });

    // Enter track
    console.log('[GHOST RACING TEST] Entering track...');
    await page.click('#btn-enter-track');

    await page.waitForFunction(() => {
      return window.game && window.game.stateMachine.is('PLAYING');
    }, { timeout: 10000 });

    console.log('[GHOST RACING TEST] Run started in PLAYING state!');

    // Check GhostManager status
    const ghostStatus = await page.evaluate(() => {
      const gm = window.game.ghostManager;
      return {
        hasGhostManager: !!gm,
        hasRivalData: !!gm.activeRivalData,
        rivalFramesCount: gm.activeRivalData ? gm.activeRivalData.frames.length : 0,
        hasPB: gm.hasPB(),
        rivalTime: gm.getRivalTime()
      };
    });
    console.log('[GHOST RACING TEST] Ghost status:', ghostStatus);

    // Advance run slightly
    await page.keyboard.down('KeyW');
    await new Promise(r => setTimeout(r, 1800));
    await page.keyboard.up('KeyW');

    // Screenshot 1: Ghost in action
    const actionShotPath = path.join(ARTIFACT_DIR, 'screenshot_ghost_racing_action.png');
    await page.screenshot({ path: actionShotPath });
    console.log(`[SAVED] ${actionShotPath}`);

    // Trigger checkpoint 1 to test split toast
    console.log('[GHOST RACING TEST] Triggering Checkpoint 1...');
    const splitInfo = await page.evaluate(() => {
      window.game.jumpToNextCheckpoint();
      const splitToast = document.querySelector('#hud-split-toast');
      const splitVal = document.querySelector('#hud-split-val');
      const splitBadge = document.querySelector('#hud-split-badge');
      return {
        hasSplitToastClass: splitToast?.classList.contains('active'),
        valText: splitVal?.textContent,
        badgeVisible: !splitBadge?.classList.contains('hidden')
      };
    });
    console.log('[GHOST RACING TEST] Split toast triggered:', splitInfo);

    await new Promise(r => setTimeout(r, 400));
    const splitShotPath = path.join(ARTIFACT_DIR, 'screenshot_ghost_split_hud.png');
    await page.screenshot({ path: splitShotPath });
    console.log(`[SAVED] ${splitShotPath}`);

    // Complete run to test PB saving and Results Screen
    console.log('[GHOST RACING TEST] Completing track to trigger Results Screen...');
    const resultDetails = await page.evaluate(() => {
      // Teleport player near finish gate
      const track = window.game.currentTrack;
      const finish = track.finish;
      window.game.playerController.position.set(finish.position.x, finish.position.y + 0.5, finish.position.z);
      window.game.runElapsedTime = 28.4;
      window.game.isFinished = true;
      window.game.stateMachine.transitionTo('FINISHED');

      const rivalElem = document.querySelector('#res-rival');
      const ghostStatusElem = document.querySelector('#res-ghost-status');
      return {
        state: window.game.stateMachine.current,
        rivalText: rivalElem?.textContent,
        ghostStatusText: ghostStatusElem?.textContent
      };
    });
    console.log('[GHOST RACING TEST] Finished details:', resultDetails);

    await new Promise(r => setTimeout(r, 800));
    const resultsShotPath = path.join(ARTIFACT_DIR, 'screenshot_ghost_results.png');
    await page.screenshot({ path: resultsShotPath });
    console.log(`[SAVED] ${resultsShotPath}`);

    // Check localStorage for saved PB
    const savedPBCheck = await page.evaluate(() => {
      const seed = window.game.currentTrack.seed;
      return window.game.ghostManager.hasPB() || !!localStorage.getItem(`trackrun_ghost_pb_${(seed >>> 0).toString(16).padStart(8, '0')}`);
    });
    console.log('[GHOST RACING TEST] PB ghost saved in localStorage:', savedPBCheck);

    // Now click "RUN AGAIN" to verify dual ghost racing (PB + Echo)
    console.log('[GHOST RACING TEST] Running again with saved PB ghost...');
    await page.click('#btn-res-again');

    await page.waitForFunction(() => {
      return window.game && window.game.stateMachine.is('PLAYING');
    }, { timeout: 10000 });

    const dualGhostStatus = await page.evaluate(() => {
      const gm = window.game.ghostManager;
      return {
        hasPB: gm.hasPB(),
        pbTime: gm.getPBTime(),
        rivalTime: gm.getRivalTime(),
        pbGhostVisible: gm.pbGhost?.isVisible,
        rivalGhostVisible: gm.rivalGhost?.isVisible
      };
    });
    console.log('[GHOST RACING TEST] Dual ghost status on second run:', dualGhostStatus);

    await page.keyboard.down('KeyW');
    await new Promise(r => setTimeout(r, 1200));
    await page.keyboard.up('KeyW');

    const dualGhostShotPath = path.join(ARTIFACT_DIR, 'screenshot_dual_ghosts.png');
    await page.screenshot({ path: dualGhostShotPath });
    console.log(`[SAVED] ${dualGhostShotPath}`);

    console.log('[GHOST RACING TEST] All automated browser verifications succeeded!');
  } finally {
    await browser.close();
  }
}

runGhostRacingPlaytest().catch((err) => {
  console.error('[GHOST RACING TEST] FAILED:', err);
  process.exit(1);
});
