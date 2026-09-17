import puppeteer from 'puppeteer-core';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:/Users/lin4s/.gemini/antigravity/brain/ed6a93af-435f-4ce7-a35a-81381d79f4f6';

async function runAudit() {
  console.log('[AUDIT] Launching Edge browser...');
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

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    console.log('[AUDIT] Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

    // 1. Title / Import screen
    await page.waitForSelector('#btn-showcase-enter', { timeout: 10000 });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit_title_import.png') });
    console.log('[AUDIT] Saved audit_title_import.png');

    // 2. Custom import tab
    await page.click('#tab-btn-custom');
    await new Promise(r => setTimeout(r, 200));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit_custom_tab.png') });
    console.log('[AUDIT] Saved audit_custom_tab.png');

    // Back to showcase and click Enter
    await page.click('#tab-btn-showcase');
    await new Promise(r => setTimeout(r, 200));
    await page.click('#btn-showcase-enter');

    // 3. Analysis Screen
    await page.waitForFunction(() => {
      const btn = document.querySelector('#btn-enter-track');
      return btn && !btn.disabled;
    }, { timeout: 20000 });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit_analysis.png') });
    console.log('[AUDIT] Saved audit_analysis.png');

    // Click enter track
    await page.click('#btn-enter-track');

    // 4. Countdown / Start
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit_countdown.png') });
    console.log('[AUDIT] Saved audit_countdown.png');

    // 5. Playing
    await page.waitForFunction(() => {
      return window.game && window.game.stateMachine && window.game.stateMachine.is('PLAYING');
    }, { timeout: 15000 });
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit_flow_start.png') });
    console.log('[AUDIT] Saved audit_flow_start.png');

    // 6. Pause screen
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit_pause.png') });
    console.log('[AUDIT] Saved audit_pause.png');

    // Open settings from pause
    await page.click('#btn-pause-settings');
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit_settings.png') });
    console.log('[AUDIT] Saved audit_settings.png');

    // Close settings and resume
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 200));
    await page.click('#btn-pause-resume');
    await new Promise(r => setTimeout(r, 500));

    // 7. Check finish / results
    await page.evaluate(() => {
      const game = window.game;
      // Trigger finish
      game.stateMachine.transitionTo('FINISHED');
    });
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'audit_results.png') });
    console.log('[AUDIT] Saved audit_results.png');

    console.log('[AUDIT] Audit capture complete!');
  } catch (err) {
    console.error('[AUDIT] Error:', err);
  } finally {
    await browser.close();
  }
}

runAudit();
