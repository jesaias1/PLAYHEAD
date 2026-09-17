import puppeteer from 'puppeteer-core';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:/Users/lin4s/.gemini/antigravity/brain/ed6a93af-435f-4ce7-a35a-81381d79f4f6';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--window-size=1280,720'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

  await page.waitForSelector('#btn-showcase-enter', { timeout: 10000 });
  await page.click('#btn-showcase-enter');

  await page.waitForFunction(() => {
    const btn = document.querySelector('#btn-enter-track');
    return btn && !btn.disabled;
  }, { timeout: 20000 });
  await page.click('#btn-enter-track');

  await page.waitForFunction(() => {
    return window.game && window.game.stateMachine && window.game.stateMachine.is('PLAYING');
  }, { timeout: 15000 });

  await new Promise(r => setTimeout(r, 1500));

  const result = await page.evaluate(() => {
    const game = window.game;
    const cameraController = game.cameraController;
    cameraController.setOrientation(cameraController.yaw, -1.0);

    const playheadSystem = game.world?.playheadSystem;
    const nowLineGroup = playheadSystem?.nowLineGroup;
    
    return {
      hasPlayhead: !!playheadSystem,
      hasNowLineGroup: !!nowLineGroup,
      nowLineVisible: nowLineGroup ? nowLineGroup.visible : null,
      childrenCount: game.environment.scene.children.length
    };
  });

  console.log('Inspection result:', JSON.stringify(result));

  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'with_nowline.png') });

  // Hide nowLineGroup and re-render
  await page.evaluate(() => {
    const game = window.game;
    const playheadSystem = game.world?.playheadSystem;
    if (playheadSystem?.nowLineGroup) {
      playheadSystem.nowLineGroup.visible = false;
    }
    game.environment.renderer.render(game.environment.scene, game.cameraController.camera);
  });

  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'without_nowline.png') });

  await browser.close();
  console.log('Finished testing nowLine');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
