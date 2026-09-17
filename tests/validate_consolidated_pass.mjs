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

    // 1. Compact Main Menu Layout at 1280x720 (100% zoom)
    await page.waitForSelector('#btn-showcase-enter', { timeout: 10000 });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'consolidated_01_compact_menu_1280x720.png') });
    console.log('[AUDIT] Saved consolidated_01_compact_menu_1280x720.png');

    // 2. Compact Main Menu Layout at 1920x1080 (100% zoom)
    await page.setViewport({ width: 1920, height: 1080 });
    await new Promise(r => setTimeout(r, 200));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'consolidated_02_compact_menu_1920x1080.png') });
    console.log('[AUDIT] Saved consolidated_02_compact_menu_1920x1080.png');

    // Return to 1280x720
    await page.setViewport({ width: 1280, height: 720 });
    await new Promise(r => setTimeout(r, 200));

    // 3. Tab 4: Armory tab from Main Menu
    await page.click('#tab-btn-armory');
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'consolidated_03_armory_tab_clean.png') });
    console.log('[AUDIT] Saved consolidated_03_armory_tab_clean.png');

    // 4. Tab 3: Movement Lab tab from Main Menu
    await page.click('#tab-btn-lab');
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'consolidated_04_movement_lab.png') });
    console.log('[AUDIT] Saved consolidated_04_movement_lab.png');

    // 5. Open Movement Lab Song Chooser Modal with KeyM
    await page.keyboard.press('KeyM');
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'consolidated_05_movement_lab_song_modal.png') });
    console.log('[AUDIT] Saved consolidated_05_movement_lab_song_modal.png');

    // Close song chooser modal with Escape
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 300));

    // 6. Pause Menu from Movement Lab
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'consolidated_06_pause_menu.png') });
    console.log('[AUDIT] Saved consolidated_06_pause_menu.png');

    // 7. Click > ARMORY in Pause Menu -> In-game Armory Modal
    await page.click('#btn-pause-armory');
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'consolidated_07_in_game_armory_modal.png') });
    console.log('[AUDIT] Saved consolidated_07_in_game_armory_modal.png');

    // Close Armory Modal back to pause menu
    await page.click('#btn-armory-modal-close');
    await new Promise(r => setTimeout(r, 300));

    // 8. Open Settings Modal from Pause Menu (verifying dropdown contrast & hints toggle)
    await page.click('#btn-pause-settings');
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'consolidated_08_settings_modal_dropdowns.png') });
    console.log('[AUDIT] Saved consolidated_08_settings_modal_dropdowns.png');

    // Close Settings Modal
    await page.click('#btn-set-close');
    await new Promise(r => setTimeout(r, 300));

    // Return to main menu from Pause menu
    await page.click('#btn-pause-new-track');
    await new Promise(r => setTimeout(r, 400));

    // 9. Enter Signal Pack Track 1 to inspect World Architecture in Gameplay
    await page.click('#tab-btn-showcase');
    await new Promise(r => setTimeout(r, 200));
    await page.click('#btn-showcase-enter');

    // Wait for READY state then enter
    await page.waitForSelector('#btn-enter-track:not([disabled])', { timeout: 15000 });
    await page.click('#btn-enter-track');

    // Wait for PLAYING
    await page.waitForFunction(() => {
      return window.game && window.game.stateMachine && window.game.stateMachine.is('PLAYING');
    }, { timeout: 15000 });
    await new Promise(r => setTimeout(r, 1200));

    // Capture Gameplay View
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'consolidated_09_gameplay_deep_void_scale.png') });
    console.log('[AUDIT] Saved consolidated_09_gameplay_deep_void_scale.png');

    // 10. Look down into void to inspect descending gate columns and skyscraper foundations
    await page.evaluate(() => {
      if (window.game && window.game.cameraController) {
        window.game.cameraController.pitch = -0.65; // look down ~37 deg
      }
    });
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'consolidated_10_gameplay_gate_monolith_legs.png') });
    console.log('[AUDIT] Saved consolidated_10_gameplay_gate_monolith_legs.png');

    console.log('[AUDIT] Complete! All 10 screenshots captured successfully.');
  } catch (err) {
    console.error('[AUDIT] Error during execution:', err);
  } finally {
    await browser.close();
  }
}

runAudit();
