import puppeteer from 'puppeteer-core';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:/Users/lin4s/.gemini/antigravity/brain/ed6a93af-435f-4ce7-a35a-81381d79f4f6';

async function runViewmodelIntegrationReview() {
  console.log('[VIEWMODEL REVIEW] Launching browser...');
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

    console.log('[VIEWMODEL REVIEW] Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });

    // 1. Launch Track 1
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
    console.log('[VIEWMODEL REVIEW] Entered PLAYING state for Track 1.');

    // Wait for viewmodel assets to load
    await page.waitForFunction(() => {
      return window.game.viewmodelController && window.game.viewmodelController.isLoaded;
    }, { timeout: 10000 });
    console.log('[VIEWMODEL REVIEW] Viewmodel assets loaded.');

    await new Promise(r => setTimeout(r, 1000));

    // Capture Flow Runway
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'viewmodel_integration_01_flow.png') });
    console.log('[VIEWMODEL REVIEW] Captured viewmodel_integration_01_flow.png');

    // Jump to Surf ramp
    await page.evaluate(() => {
      const track = window.game.currentTrack;
      const surfNode = track.route.find(n => n.isSurf);
      if (surfNode) {
        window.game.playerController.setPosition({
          x: surfNode.position.x - 3.5,
          y: surfNode.position.y + 1.2,
          z: surfNode.position.z
        });
        window.game.playerController.velocity.set(0, 0, -22);
      }
    });
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'viewmodel_integration_02_surf.png') });
    console.log('[VIEWMODEL REVIEW] Captured viewmodel_integration_02_surf.png');

    // Jump to Breath section
    await page.evaluate(() => {
      const track = window.game.world ? window.game.world.track : null;
      if (track && track.sections) {
        const breathSec = track.sections.find(s => s.theme === 'BREATH') || track.sections[1];
        if (breathSec) {
          window.game.audioEngine.seek(breathSec.start);
          const node = track.route.find(n => n.time >= breathSec.start) || track.route[15];
          if (node) {
            window.game.playerController.setPosition({
              x: node.position.x,
              y: node.position.y + 1.5,
              z: node.position.z
            });
          }
        }
      }
    });
    await new Promise(r => setTimeout(r, 600));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'viewmodel_integration_03_breath.png') });
    console.log('[VIEWMODEL REVIEW] Captured viewmodel_integration_03_breath.png');

    // Now test Track 2 (to verify palette integration with distinct song palette)
    console.log('[VIEWMODEL REVIEW] Loading Track 2...');
    await page.evaluate(() => {
      window.game.stateMachine.transitionTo(0); // IMPORT state
    });
    await new Promise(r => setTimeout(r, 800));

    // Select second track in track selector
    const clicked = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.track-card, [data-track-id]'));
      if (cards.length > 1) {
        cards[1].click();
        return true;
      }
      return false;
    });

    if (clicked) {
      console.log('[VIEWMODEL REVIEW] Clicked second track, waiting for analysis...');
      await page.waitForFunction(() => {
        const btn = document.querySelector('#btn-enter-track');
        return btn && !btn.disabled;
      }, { timeout: 20000 });
      await page.click('#btn-enter-track');

      await page.waitForFunction(() => {
        return window.game && window.game.stateMachine && window.game.stateMachine.is('PLAYING');
      }, { timeout: 15000 });
      await new Promise(r => setTimeout(r, 1200));

      await page.screenshot({ path: path.join(ARTIFACT_DIR, 'viewmodel_integration_04_track2.png') });
      console.log('[VIEWMODEL REVIEW] Captured viewmodel_integration_04_track2.png');
    }

    console.log('=== [VIEWMODEL INTEGRATION REVIEW COMPLETE] ===');
  } catch (err) {
    console.error('[VIEWMODEL REVIEW ERROR]', err);
  } finally {
    await browser.close();
  }
}

runViewmodelIntegrationReview();
