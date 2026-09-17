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

    // 1. Tab 1: Terminal UI & Signal Pack Catalog (14 tracks)
    await page.waitForSelector('#btn-showcase-enter', { timeout: 10000 });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'terminal_tab1_signal_pack.png') });
    console.log('[VALIDATION] Saved terminal_tab1_signal_pack.png');

    // 2. Tab 2: Custom Audio Terminal Injection
    await page.click('#tab-btn-custom');
    await new Promise(r => setTimeout(r, 250));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'terminal_tab2_custom_audio.png') });
    console.log('[VALIDATION] Saved terminal_tab2_custom_audio.png');

    // 3. Return to Tab 1 and select Track 2 (Surf the Void)
    await page.click('#tab-btn-showcase');
    await new Promise(r => setTimeout(r, 250));

    // Click track 2 item
    await page.evaluate(() => {
      const item = document.querySelector('.strip-item[data-track-id="track_2_surf_the_void"]');
      if (item) item.click();
    });
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'terminal_tab1_track_selected.png') });
    console.log('[VALIDATION] Saved terminal_tab1_track_selected.png');

    // 4. Click [▶ EXEC // ENTER TRACK] - test instant load path
    const startTime = Date.now();
    await page.click('#btn-showcase-enter');

    // Wait for READY state
    await page.waitForFunction(() => {
      const btn = document.querySelector('#btn-enter-track');
      return btn && !btn.disabled;
    }, { timeout: 15000 });
    const loadElapsed = Date.now() - startTime;
    console.log(`[VALIDATION] Instant load to READY took ${loadElapsed}ms`);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'terminal_analysis_instant.png') });
    console.log('[VALIDATION] Saved terminal_analysis_instant.png');

    // 5. Enter track to enter gameplay
    await page.click('#btn-enter-track');

    // Wait for PLAYING state
    await page.waitForFunction(() => {
      return window.game && window.game.stateMachine && window.game.stateMachine.is('PLAYING');
    }, { timeout: 15000 });
    await new Promise(r => setTimeout(r, 1000));

    // Capture gameplay showing subtle grain on hands & grounded descending pillars
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'terminal_gameplay_grounded_pillars.png') });
    console.log('[VALIDATION] Saved terminal_gameplay_grounded_pillars.png');

    // 6. Look downward to inspect descending support pillars beneath platforms
    await page.evaluate(() => {
      if (window.game && window.game.cameraController) {
        window.game.cameraController.pitch = -0.55; // look down ~31 degrees
      }
    });
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'terminal_gameplay_look_down_pillars.png') });
    console.log('[VALIDATION] Saved terminal_gameplay_look_down_pillars.png');

    console.log('[VALIDATION] All Terminal validation captures complete!');
  } catch (err) {
    console.error('[VALIDATION] Error:', err);
  } finally {
    await browser.close();
  }
}

runValidation();
