import puppeteer from 'puppeteer-core';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\lin4s\\.gemini\\antigravity\\brain\\ed6a93af-435f-4ce7-a35a-81381d79f4f6';

async function testGhostProximity() {
  console.log('[PROXIMITY TEST] Launching browser...');
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--window-size=1920,1080']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

    await page.waitForSelector('#btn-dev-track');
    await page.click('#btn-dev-track');

    await page.waitForFunction(() => {
      const btn = document.querySelector('#btn-enter-track');
      return btn && !btn.disabled;
    }, { timeout: 15000 });

    await page.click('#btn-enter-track');
    await page.waitForFunction(() => window.game && window.game.stateMachine.is('PLAYING'), { timeout: 10000 });

    // Position player 4.0 meters behind the ghost to see full opacity
    const opacities = await page.evaluate(() => {
      const gm = window.game.ghostManager;
      const ghost = gm.rivalGhost;
      const gPos = ghost.getPosition();

      // Set player 4.0m behind ghost
      window.game.playerController.position.set(gPos.x, gPos.y, gPos.z - 4.0);
      ghost.update(window.game.runElapsedTime, window.game.playerController.position, 0.016);
      const opAt4m = ghost.outerMat.opacity;

      // Set player 2.0m behind ghost (midway fade)
      window.game.playerController.position.set(gPos.x, gPos.y, gPos.z - 2.0);
      ghost.update(window.game.runElapsedTime, window.game.playerController.position, 0.016);
      const opAt2m = ghost.outerMat.opacity;

      // Set player 0.5m behind ghost (inside fade zone)
      window.game.playerController.position.set(gPos.x, gPos.y, gPos.z - 0.5);
      ghost.update(window.game.runElapsedTime, window.game.playerController.position, 0.016);
      const opAt05m = ghost.outerMat.opacity;

      return { opAt4m, opAt2m, opAt05m };
    });

    console.log('[PROXIMITY TEST] Opacities at distances:', opacities);
    if (opacities.opAt4m > opacities.opAt2m && opacities.opAt2m > opacities.opAt05m && opacities.opAt05m === 0) {
      console.log('[PROXIMITY TEST] SUCCESS: Proximity fade verified (smoothly drops to 0 at <= 0.7m)!');
    } else {
      throw new Error(`Unexpected opacity curve: ${JSON.stringify(opacities)}`);
    }

    // Capture close-up visual screenshot at 2.2m
    await page.evaluate(() => {
      const gm = window.game.ghostManager;
      const ghost = gm.rivalGhost;
      const gPos = ghost.getPosition();
      window.game.playerController.position.set(gPos.x, gPos.y, gPos.z - 2.6);
      ghost.update(window.game.runElapsedTime, window.game.playerController.position, 0.016);
    });

    const closeupPath = path.join(ARTIFACT_DIR, 'screenshot_ghost_closeup.png');
    await page.screenshot({ path: closeupPath });
    console.log(`[SAVED] ${closeupPath}`);
  } finally {
    await browser.close();
  }
}

testGhostProximity().catch((e) => {
  console.error(e);
  process.exit(1);
});
