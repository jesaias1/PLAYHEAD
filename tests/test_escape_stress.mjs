import puppeteer from 'puppeteer-core';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testEscapeStress() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: ['--window-size=1280,720']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

  // Enter track
  await page.waitForSelector('#btn-showcase-enter');
  await page.click('#btn-showcase-enter');

  await page.waitForFunction(() => {
    const b = document.querySelector('#btn-enter-track');
    return b && !b.disabled;
  }, { timeout: 15000 });
  await page.click('#btn-enter-track');

  await page.waitForFunction(() => {
    return window.game && window.game.stateMachine && window.game.stateMachine.is('PLAYING');
  });

  await page.click('#canvas-container canvas');
  await new Promise(r => setTimeout(r, 400));

  console.log('--- Commencing 10 Rapid Pause/Unpause Cycles with Camera Verification ---');
  for (let cycle = 1; cycle <= 10; cycle++) {
    // 1. Pause
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 300));

    const paused = await page.evaluate(() => ({
      state: window.game.stateMachine.currentState,
      pauseVisible: window.game.ui.pauseScreen.isVisible(),
      cursor: document.body.style.cursor
    }));
    if (paused.state !== 'PAUSED' || !paused.pauseVisible) {
      throw new Error(`Cycle ${cycle} Pause Failed: ${JSON.stringify(paused)}`);
    }

    // 2. Unpause via Escape
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 300));

    const resumed = await page.evaluate(() => ({
      state: window.game.stateMachine.currentState,
      isControlActive: window.game.cameraController.isControlActive(),
      isLocked: window.game.cameraController.getIsLocked(),
      pauseVisible: window.game.ui.pauseScreen.isVisible(),
      cursor: document.body.style.cursor
    }));

    if (resumed.state !== 'PLAYING' || resumed.pauseVisible || !resumed.isControlActive) {
      throw new Error(`Cycle ${cycle} Resume Failed: ${JSON.stringify(resumed)}`);
    }

    // 3. Verify camera yaw changes on mouse move immediately
    const yawBefore = await page.evaluate(() => window.game.cameraController.yaw);
    await page.mouse.move(200 + cycle * 10, 200);
    await page.mouse.move(250 + cycle * 10, 200);
    await new Promise(r => setTimeout(r, 50));
    const yawAfter = await page.evaluate(() => window.game.cameraController.yaw);
    const moved = Math.abs(yawAfter - yawBefore) > 0.001;

    if (!moved) {
      throw new Error(`Cycle ${cycle}: Camera did NOT respond to mouse look after unpause!`);
    }

    console.log(`Cycle ${cycle} passed: PAUSED -> PLAYING (cursor: ${resumed.cursor}, camera responsive: true, locked: ${resumed.isLocked})`);
  }

  console.log('All 10 pause/unpause cycles succeeded cleanly with verified camera response!');
  await browser.close();
}

testEscapeStress().catch(err => {
  console.error(err);
  process.exit(1);
});
