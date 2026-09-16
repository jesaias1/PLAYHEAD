import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\lin4s\\.gemini\\antigravity\\brain\\ed6a93af-435f-4ce7-a35a-81381d79f4f6';

async function runMusicPackShowcasePlaytest() {
  console.log('[MUSIC PACK TEST] Launching Edge browser...');
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
      } else if (txt.includes('MusicPack') || txt.includes('TrackGenerator') || txt.includes('Analysis') || txt.includes('ONBOARDING')) {
        console.log(`[BROWSER] ${txt}`);
      }
    });

    page.on('pageerror', (err) => {
      console.error('[BROWSER PAGE ERROR]', err);
    });

    console.log('[MUSIC PACK TEST] Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });

    // 1. Verify Showcase UI elements
    await page.waitForSelector('#panel-showcase');
    await page.waitForSelector('#showcase-strip');

    const trackIds = ['first-contact', 'hyperdrive-collider', 'neural-drift', 'chrono-cataclysm', 'voidwalker'];
    for (const id of trackIds) {
      const btn = await page.$(`.strip-item[data-track-id="${id}"]`);
      if (!btn) throw new Error(`Missing track selector button for ${id}`);
    }
    console.log('[MUSIC PACK TEST] Verified all 5 track selector buttons exist.');

    // 2. Click between tracks and verify hero card updates
    console.log('[MUSIC PACK TEST] Selecting "HYPERDRIVE COLLIDER"...');
    await page.click(`.strip-item[data-track-id="hyperdrive-collider"]`);
    await page.waitForFunction(() => {
      const title = document.querySelector('#showcase-title');
      return title && title.textContent.includes('HYPERDRIVE COLLIDER');
    });

    const hyperdriveBpm = await page.$eval('#showcase-bpm', el => el.textContent);
    console.log(`[MUSIC PACK TEST] HYPERDRIVE COLLIDER BPM: ${hyperdriveBpm}`);
    if (!hyperdriveBpm.includes('128')) throw new Error('Incorrect BPM for HYPERDRIVE COLLIDER');

    // 3. Test preview audition button
    console.log('[MUSIC PACK TEST] Testing Preview Audition...');
    await page.click('#btn-showcase-preview');
    await page.waitForFunction(() => {
      const txt = document.querySelector('#preview-text');
      return txt && txt.textContent.includes('STOP PREVIEW');
    }, { timeout: 10000 });
    console.log('[MUSIC PACK TEST] Preview audio started successfully!');

    // Allow 1.5 seconds of preview playing, then stop
    await new Promise(r => setTimeout(r, 1500));
    await page.click('#btn-showcase-preview');
    await page.waitForFunction(() => {
      const txt = document.querySelector('#preview-text');
      return txt && txt.textContent.includes('PREVIEW AUDIO');
    });
    console.log('[MUSIC PACK TEST] Preview audio stopped successfully.');

    // 4. Return to FIRST CONTACT
    console.log('[MUSIC PACK TEST] Selecting FIRST CONTACT...');
    await page.click(`.strip-item[data-track-id="first-contact"]`);
    await page.waitForFunction(() => {
      const title = document.querySelector('#showcase-title');
      return title && title.textContent.includes('FIRST CONTACT');
    });

    // Capture Title Screen / Showcase screenshot
    const titleScreenshotPath = path.join(ARTIFACT_DIR, 'screenshot_music_pack_showcase.png');
    await page.screenshot({ path: titleScreenshotPath, fullPage: false });
    console.log(`[MUSIC PACK TEST] Captured showcase screenshot: ${titleScreenshotPath}`);

    // 5. Click ENTER TRACK from Showcase to begin analysis
    console.log('[MUSIC PACK TEST] Launching FIRST CONTACT course...');
    await page.click('#btn-showcase-enter');

    // Wait for analysis to complete and ENTER TRACK button on Analysis Screen to be enabled
    console.log('[MUSIC PACK TEST] Waiting for course generation and analysis screen...');
    await page.waitForFunction(() => {
      const btn = document.querySelector('#btn-enter-track');
      return btn && !btn.disabled;
    }, { timeout: 20000 });

    console.log('[MUSIC PACK TEST] Entering course from Analysis Screen...');
    await page.click('#btn-enter-track');

    // Wait for game to enter PLAYING state
    await page.waitForFunction(() => {
      return window.game && window.game.stateMachine && window.game.stateMachine.is('PLAYING');
    }, { timeout: 10000 });
    console.log('[MUSIC PACK TEST] Successfully entered PLAYING state for FIRST CONTACT!');

    // 6. Wait for onboarding cue to appear in HUD (t >= 1.2s)
    await page.waitForFunction(() => {
      const cue = document.querySelector('#hud-toast');
      return cue && cue.classList.contains('active') && cue.textContent.includes('BHOP FLOW');
    }, { timeout: 15000 });
    console.log('[MUSIC PACK TEST] Onboarding cue verified in HUD!');

    // 7. Simulate movement and air strafing
    await page.keyboard.down('KeyW');
    await page.keyboard.down('Space');
    await new Promise(r => setTimeout(r, 1200));
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyW');

    // Capture in-game HUD screenshot
    const hudScreenshotPath = path.join(ARTIFACT_DIR, 'screenshot_first_contact_hud.png');
    await page.screenshot({ path: hudScreenshotPath, fullPage: false });
    console.log(`[MUSIC PACK TEST] Captured HUD onboarding cue screenshot: ${hudScreenshotPath}`);

    console.log('=== [MUSIC PACK PLAYTEST PASSED SUCCESSFULLY] ===');
  } catch (err) {
    console.error('[MUSIC PACK TEST FAILED]', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

runMusicPackShowcasePlaytest();
