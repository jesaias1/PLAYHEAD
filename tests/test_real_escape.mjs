import puppeteer from 'puppeteer-core';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testEscapeFlow() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: ['--window-size=1280,720']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('console', msg => console.log('[PAGE]', msg.text()));

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

  console.log('Game is in PLAYING state.');
  // Simulate clicking canvas to ensure initial lock
  await page.click('#canvas-container canvas');
  await new Promise(r => setTimeout(r, 500));

  const state0 = await page.evaluate(() => ({
    state: window.game.stateMachine.currentState,
    isLocked: window.game.cameraController.getIsLocked(),
    pointerLockElement: !!document.pointerLockElement,
    cursor: document.body.style.cursor,
    canvasCursor: document.querySelector('#canvas-container canvas')?.style.cursor
  }));
  console.log('Initial lock state:', state0);

  // First Escape -> Should Pause
  console.log('Pressing 1st Escape (to pause)...');
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 500));

  const state1 = await page.evaluate(() => ({
    state: window.game.stateMachine.currentState,
    isLocked: window.game.cameraController.getIsLocked(),
    pointerLockElement: !!document.pointerLockElement,
    pauseScreenVisible: window.game.ui.pauseScreen.isVisible(),
    cursor: document.body.style.cursor,
    canvasCursor: document.querySelector('#canvas-container canvas')?.style.cursor
  }));
  console.log('After 1st Escape (pause):', state1);

  // Second Escape -> Should Resume cleanly!
  console.log('Pressing 2nd Escape (to resume)...');
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 500));

  const state2 = await page.evaluate(() => ({
    state: window.game.stateMachine.currentState,
    isLocked: window.game.cameraController.getIsLocked(),
    pointerLockElement: !!document.pointerLockElement,
    pauseScreenVisible: window.game.ui.pauseScreen.isVisible(),
    cursor: document.body.style.cursor,
    canvasCursor: document.querySelector('#canvas-container canvas')?.style.cursor
  }));
  console.log('After 2nd Escape (resume):', state2);

  // Test mouse move to see if camera moves
  const yawBefore = await page.evaluate(() => window.game.cameraController.yaw);
  await page.mouse.move(300, 300);
  await page.mouse.move(400, 300);
  await new Promise(r => setTimeout(r, 200));
  const yawAfter = await page.evaluate(() => window.game.cameraController.yaw);
  console.log('Yaw test after resume:', { yawBefore, yawAfter, moved: yawBefore !== yawAfter });

  await browser.close();
}

testEscapeFlow().catch(console.error);
