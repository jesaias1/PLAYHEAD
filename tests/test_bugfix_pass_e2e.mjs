import puppeteer from 'puppeteer-core';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:/Users/lin4s/.gemini/antigravity/brain/ed6a93af-435f-4ce7-a35a-81381d79f4f6';

async function runBugfixPassVerification() {
  console.log('[E2E VERIFICATION] Launching Edge browser...');
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
    console.log('[E2E VERIFICATION] Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

    // 1. Enter First Contact Track
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
    console.log('[E2E VERIFICATION] Track running in PLAYING state.');
    await new Promise(r => setTimeout(r, 1200));

    // TEST 1: Horizontal screen seam at various pitch angles
    console.log('[E2E VERIFICATION] Testing screen seam at extreme pitch angles...');
    const pitches = [
      { name: 'pitch_down_80deg', val: -1.4 },
      { name: 'pitch_down_57deg', val: -1.0 },
      { name: 'pitch_horizon', val: 0.0 },
      { name: 'pitch_up_45deg', val: 0.78 }
    ];

    for (const p of pitches) {
      await page.evaluate((pitchVal) => {
        const game = window.game;
        game.cameraController.setOrientation(game.cameraController.yaw, pitchVal);
      }, p.val);
      await new Promise(r => setTimeout(r, 200));
      await page.screenshot({ path: path.join(ARTIFACT_DIR, `verify_seam_${p.name}.png`) });
      console.log(`[E2E VERIFICATION] Captured verify_seam_${p.name}.png`);
    }

    // TEST 2: Single Escape pauses game
    console.log('[E2E VERIFICATION] Testing single Escape pause flow...');
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 300));

    const pauseCheck1 = await page.evaluate(() => {
      const game = window.game;
      return {
        state: game.stateMachine.currentState,
        pauseScreenVisible: game.ui.pauseScreen.isVisible(),
        isLocked: game.cameraController.getIsLocked()
      };
    });
    console.log('[E2E VERIFICATION] After 1st Escape:', JSON.stringify(pauseCheck1));
    if (pauseCheck1.state !== 'PAUSED' || !pauseCheck1.pauseScreenVisible) {
      throw new Error(`Expected PAUSED state and visible pause screen, got: ${JSON.stringify(pauseCheck1)}`);
    }
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify_paused_state.png') });

    // TEST 3: Single Escape while paused resumes game
    console.log('[E2E VERIFICATION] Testing single Escape resume flow...');
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 300));

    const resumeCheck1 = await page.evaluate(() => {
      const game = window.game;
      return {
        state: game.stateMachine.currentState,
        pauseScreenVisible: game.ui.pauseScreen.isVisible()
      };
    });
    console.log('[E2E VERIFICATION] After 2nd Escape (resume):', JSON.stringify(resumeCheck1));
    if (resumeCheck1.state !== 'PLAYING' || resumeCheck1.pauseScreenVisible) {
      throw new Error(`Expected PLAYING state and hidden pause screen, got: ${JSON.stringify(resumeCheck1)}`);
    }

    // TEST 4: Click RESUME button in pause screen
    console.log('[E2E VERIFICATION] Testing RESUME button click...');
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 300));
    await page.click('#btn-pause-resume');
    await new Promise(r => setTimeout(r, 300));

    const resumeCheck2 = await page.evaluate(() => {
      const game = window.game;
      return {
        state: game.stateMachine.currentState,
        pauseScreenVisible: game.ui.pauseScreen.isVisible()
      };
    });
    console.log('[E2E VERIFICATION] After clicking RESUME:', JSON.stringify(resumeCheck2));
    if (resumeCheck2.state !== 'PLAYING' || resumeCheck2.pauseScreenVisible) {
      throw new Error(`Expected PLAYING state after clicking RESUME, got: ${JSON.stringify(resumeCheck2)}`);
    }

    // TEST 5: Surf hint logic on deaths
    console.log('[E2E VERIFICATION] Testing Surf Hint trigger rules...');
    // A) Fall from PLATFORM: surf hint should NOT be visible
    const platFallResult = await page.evaluate(() => {
      const game = window.game;
      game.playerController.lastTouchedSurfaceType = 'PLATFORM';
      game.playerController.position.y = -100; // Trigger kill plane
      game.playerController.updateFixed(1 / 120);
      const surfIndicator = document.getElementById('hud-surf-indicator');
      return {
        indicatorVisible: surfIndicator ? !surfIndicator.classList.contains('hidden') : false
      };
    });
    console.log('[E2E VERIFICATION] Normal platform death surf hint visible:', platFallResult.indicatorVisible);
    if (platFallResult.indicatorVisible) {
      throw new Error('Surf hint should NOT display on normal platform death!');
    }

    // B) Fall from SURF: surf hint SHOULD be visible upon respawn
    const surfFallResult = await page.evaluate(() => {
      const game = window.game;
      game.playerController.lastTouchedSurfaceType = 'SURF';
      game.playerController.position.y = -100; // Trigger kill plane
      game.playerController.updateFixed(1 / 120);
      const surfIndicator = document.getElementById('hud-surf-indicator');
      return {
        indicatorVisible: surfIndicator ? !surfIndicator.classList.contains('hidden') : false,
        indicatorText: surfIndicator?.textContent
      };
    });
    console.log('[E2E VERIFICATION] Surf death prompt visible:', surfFallResult.indicatorVisible);
    if (!surfFallResult.indicatorVisible) {
      throw new Error('Surf hint SHOULD display upon respawn after failing a surf ramp!');
    }
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify_surf_hint_respawn.png') });

    // Wait 3.2s for auto-dismiss
    await new Promise(r => setTimeout(r, 3200));
    const autoDismissResult = await page.evaluate(() => {
      const surfIndicator = document.getElementById('hud-surf-indicator');
      return {
        indicatorVisible: surfIndicator ? !surfIndicator.classList.contains('hidden') : false
      };
    });
    console.log('[E2E VERIFICATION] Surf prompt auto-dismissed after ~3s:', !autoDismissResult.indicatorVisible);
    if (autoDismissResult.indicatorVisible) {
      throw new Error('Surf hint should auto-dismiss after ~3 seconds!');
    }

    console.log('\n========================================');
    console.log('ALL E2E BUGFIX VERIFICATIONS PASSED 100%!');
    console.log('========================================\n');
  } finally {
    await browser.close();
  }
}

runBugfixPassVerification().catch(err => {
  console.error('[E2E VERIFICATION FAILED]:', err);
  process.exit(1);
});
