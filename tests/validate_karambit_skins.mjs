import puppeteer from 'puppeteer-core';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:/Users/lin4s/.gemini/antigravity/brain/ed6a93af-435f-4ce7-a35a-81381d79f4f6';

async function validateKarambitSkins() {
  console.log('[SKINS VALIDATION] Launching Edge browser...');
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
    page.on('console', msg => console.log('[BROWSER CONSOLE]', msg.type(), msg.text()));
    page.on('pageerror', err => console.error('[BROWSER ERROR]', err));
    await page.setViewport({ width: 1280, height: 720 });
    console.log('[SKINS VALIDATION] Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });

    // 1. Open Karambit Armory Tab (Tab 04)
    await page.waitForSelector('#tab-btn-armory', { timeout: 15000 });
    await page.evaluate(() => {
      const btn = document.getElementById('tab-btn-armory');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 600));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'karambit_armory_tab.png') });
    console.log('[SKINS VALIDATION] Captured karambit_armory_tab.png');

    // 2. Toggle DEV PREVIEW on to unlock all 6 skins for live testing
    await page.evaluate(() => {
      const btn = document.getElementById('btn-armory-dev-toggle');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 600));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'karambit_armory_dev_unlocked.png') });
    console.log('[SKINS VALIDATION] Captured karambit_armory_dev_unlocked.png');

    // 3. Start a game run on Track 1 (Flow State)
    await page.evaluate(() => {
      const btn = document.getElementById('tab-btn-showcase');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 300));
    await page.evaluate(() => {
      const btn = document.getElementById('btn-showcase-enter');
      if (btn) btn.click();
    });

    await page.waitForFunction(() => {
      const btn = document.querySelector('#btn-enter-track');
      return btn && !btn.disabled;
    }, { timeout: 15000 });

    await page.evaluate(() => {
      const btn = document.querySelector('#btn-enter-track');
      if (btn) btn.click();
    });

    // Wait for countdown -> playing
    await page.waitForFunction(() => {
      const cd = document.querySelector('.countdown-overlay');
      return !cd || cd.classList.contains('hidden') || cd.textContent.trim() === '';
    }, { timeout: 15000 });

    // Wait until real artist rig is loaded
    await page.waitForFunction(() => {
      const game = window.game;
      return game && game.viewmodelController && game.viewmodelController.isRigLoaded;
    }, { timeout: 15000 });

    // Transition countdown to playing
    await page.evaluate(() => {
      const game = window.game;
      if (game.stateMachine.is('COUNTDOWN')) {
        game.stateMachine.transitionTo('PLAYING');
      }
    });
    await new Promise(r => setTimeout(r, 600));

    // Array of all 6 skins to test in-game
    const skins = [
      { id: 'SIGNAL_CYAN', file: 'skin_00_signal_cyan.png', label: '00 // SIGNAL CYAN' },
      { id: 'ASTRAL', file: 'skin_01_astral.png', label: '01 // ASTRAL' },
      { id: 'VOID_SIGNAL', file: 'skin_02_void_signal.png', label: '02 // VOID SIGNAL' },
      { id: 'REDSHIFT', file: 'skin_03_redshift.png', label: '03 // REDSHIFT' },
      { id: 'PRISM_STATIC', file: 'skin_04_prism_static.png', label: '04 // PRISM STATIC' },
      { id: 'BLACKSTAR', file: 'skin_05_blackstar.png', label: '05 // BLACKSTAR' }
    ];

    for (const skin of skins) {
      // Equip skin via window state or API
      const res = await page.evaluate((skinId) => {
        const game = window.game;
        if (game && game.viewmodelController) {
          game.viewmodelController.applySkin(skinId);
          const mat = game.viewmodelController.rigInstance?.cosmicMaterial;
          return {
            id: skinId,
            uHasCosmicTexture: mat?.uniforms?.uHasCosmicTexture?.value,
            tCosmicTexture: !!mat?.uniforms?.tCosmicTexture?.value,
            textureSrc: mat?.uniforms?.tCosmicTexture?.value?.image?.src || null,
          };
        }
        return null;
      }, skin.id);

      console.log(`[SKINS VALIDATION] Applied ${skin.id}:`, res);
      await new Promise(r => setTimeout(r, 500));
      await page.screenshot({ path: path.join(ARTIFACT_DIR, skin.file) });
      console.log(`[SKINS VALIDATION] Captured ${skin.file} (${skin.label})`);
    }

    // 4. Capture Parallax View Shifting: tilt camera to demonstrate internal depth parallax
    await page.evaluate(() => {
      const game = window.game;
      if (game && game.viewmodelController) {
        // Equip ASTRAL for parallax view
        game.viewmodelController.applySkin('astral');
        // Tilt camera slightly downward and right to show view-dependent parallax shift
        game.cameraController.pitch = -0.35;
        game.cameraController.yaw = 0.25;
      }
    });
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'skin_parallax_depth_tilt.png') });
    console.log('[SKINS VALIDATION] Captured skin_parallax_depth_tilt.png');

    // 5. Check Signal Drift (Track 13) Optional Side Surf Ramps
    console.log('[SURF VALIDATION] Loading Track 13 (Signal Drift)...');
    await page.evaluate(async () => {
      const game = window.game;
      game.returnToImport();
      await game.loadPresetTrack('track_13_signal_drift');
    });
    await new Promise(r => setTimeout(r, 1000));

    await page.evaluate(() => {
      const game = window.game;
      if (game.stateMachine.is('READY')) {
        game.stateMachine.transitionTo('COUNTDOWN');
      }
      if (game.stateMachine.is('COUNTDOWN')) {
        game.stateMachine.transitionTo('PLAYING');
      }
    });
    await new Promise(r => setTimeout(r, 800));

    const surfStats = await page.evaluate(() => {
      const game = window.game;
      if (game.stateMachine.is('COUNTDOWN')) {
        game.stateMachine.transitionTo('PLAYING');
      }
      const track = game.currentTrack;
      const ramps = track?.optionalRamps || [];
      return {
        trackTitle: track?.metadata?.title,
        optionalSurfRampsCount: ramps.length,
        ramps: ramps.map(r => ({ id: r.id, pos: r.position, yaw: r.yaw, roll: r.roll }))
      };
    });
    console.log('[SURF VALIDATION] Signal Drift Ramps:', surfStats);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'critical_signal_drift_gameplay.png') });

    // 6. Test Pointer Lock & Escape Cycle
    console.log('[ESCAPE / POINTER LOCK VALIDATION] Testing Escape cycle...');
    await page.keyboard.press('Escape'); // Open pause menu
    await new Promise(r => setTimeout(r, 200));

    const pauseCheck = await page.evaluate(() => {
      const game = window.game;
      return {
        state: game.stateMachine.getState(),
        pauseVisible: game.ui.pauseScreen.isVisible(),
        cursor: document.body.style.cursor,
      };
    });
    console.log('[ESCAPE VALIDATION] Pause check:', pauseCheck);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'critical_pause_screen.png') });

    // Press Escape again -> should resume, hide cursor, refocus
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 200));

    const resumeCheck = await page.evaluate(() => {
      const game = window.game;
      return {
        state: game.stateMachine.getState(),
        pauseVisible: game.ui.pauseScreen.isVisible(),
        cursor: document.body.style.cursor,
        domElementCursor: game.environment.renderer.domElement.style.cursor,
        canvasTabIndex: game.environment.renderer.domElement.tabIndex,
        isLocked: game.cameraController.getIsLocked(),
      };
    });
    console.log('[ESCAPE VALIDATION] Resume check:', resumeCheck);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'critical_resumed_screen.png') });

    console.log('[SKINS VALIDATION] ALL SCREENSHOTS SUCCESSFULLY CAPTURED!');
  } catch (err) {
    console.error('[SKINS VALIDATION] Error during validation:', err);
  } finally {
    await browser.close();
  }
}

validateKarambitSkins();
