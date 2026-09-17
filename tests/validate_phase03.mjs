import puppeteer from 'puppeteer-core';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:/Users/lin4s/.gemini/antigravity/brain/ed6a93af-435f-4ce7-a35a-81381d79f4f6';

async function runValidation() {
  console.log('[VALIDATION] Launching Edge browser...');
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
    console.log('[VALIDATION] Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

    // 1. Title / Import screen (Showcase timetable)
    await page.waitForSelector('#btn-showcase-enter', { timeout: 10000 });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'title_import_phase03.png') });
    console.log('[VALIDATION] Saved title_import_phase03.png');

    // 2. Custom import tab
    await page.click('#tab-btn-custom');
    await new Promise(r => setTimeout(r, 200));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'custom_tab_phase03.png') });
    console.log('[VALIDATION] Saved custom_tab_phase03.png');

    // Back to showcase and click Enter
    await page.click('#tab-btn-showcase');
    await new Promise(r => setTimeout(r, 200));
    await page.click('#btn-showcase-enter');

    // 3. Analysis Screen
    await page.waitForFunction(() => {
      const btn = document.querySelector('#btn-enter-track');
      return btn && !btn.disabled;
    }, { timeout: 20000 });
    // Let sweep line animate slightly
    await new Promise(r => setTimeout(r, 600));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'analysis_phase03.png') });
    console.log('[VALIDATION] Saved analysis_phase03.png');

    // Click enter track
    await page.click('#btn-enter-track');

    // 4. Countdown / Start
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'countdown_phase03.png') });
    console.log('[VALIDATION] Saved countdown_phase03.png');

    // 5. Playing HUD
    await page.waitForFunction(() => {
      return window.game && window.game.stateMachine && window.game.stateMachine.is('PLAYING');
    }, { timeout: 15000 });
    // Trigger section title to test section title display
    await page.evaluate(() => {
      if (window.game && window.game.hud) {
        window.game.hud.showSectionTitle('SECTION 01 // DROP HARBOR');
      }
    });
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'hud_play_phase03.png') });
    console.log('[VALIDATION] Saved hud_play_phase03.png');

    // 6. Pause screen
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'pause_phase03.png') });
    console.log('[VALIDATION] Saved pause_phase03.png');

    // Open settings from pause
    await page.click('#btn-pause-settings');
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'settings_phase03.png') });
    console.log('[VALIDATION] Saved settings_phase03.png');

    // Close settings and resume
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 200));
    await page.click('#btn-pause-resume');
    await new Promise(r => setTimeout(r, 500));

    // 7. Results screen (trigger finish)
    await page.evaluate(() => {
      const game = window.game;
      game.stateMachine.transitionTo('FINISHED');
    });
    // Wait for staged animation: title (0ms) -> time (180ms) -> rank (440ms) -> actions (660ms)
    await new Promise(r => setTimeout(r, 900));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'results_phase03.png') });
    console.log('[VALIDATION] Saved results_phase03.png');

    console.log('[VALIDATION] Validation capture complete!');
  } catch (err) {
    console.error('[VALIDATION] Error:', err);
  } finally {
    await browser.close();
  }
}

runValidation();
