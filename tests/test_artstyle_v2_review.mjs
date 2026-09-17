import puppeteer from 'puppeteer-core';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\lin4s\\.gemini\\antigravity\\brain\\ed6a93af-435f-4ce7-a35a-81381d79f4f6';

async function runArtstyleReview() {
  console.log('[ARTSTYLE REVIEW] Launching browser...');
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

    console.log('[ARTSTYLE REVIEW] Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });

    // 1. Launch FIRST CONTACT from Title Showcase
    await page.waitForSelector('#btn-showcase-enter', { timeout: 10000 });
    await page.click('#btn-showcase-enter');

    // Wait for ENTER TRACK button
    await page.waitForFunction(() => {
      const btn = document.querySelector('#btn-enter-track');
      return btn && !btn.disabled;
    }, { timeout: 20000 });

    await page.click('#btn-enter-track');

    // Wait for PLAYING state
    await page.waitForFunction(() => {
      return window.game && window.game.stateMachine && window.game.stateMachine.is('PLAYING');
    }, { timeout: 15000 });
    console.log('[ARTSTYLE REVIEW] Entered PLAYING state for Track 1.');

    // Settle 1200ms
    await new Promise(r => setTimeout(r, 1200));

    // Capture Flow Section
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'phase02_01_flow.png') });
    console.log('[ARTSTYLE REVIEW] Captured phase02_01_flow.png');

    // Capture Flow with HUD OFF
    await page.evaluate(() => {
      window.game.ui.hud.hide();
    });
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'phase02_02_flow_nohud.png') });
    console.log('[ARTSTYLE REVIEW] Captured phase02_02_flow_nohud.png');

    // Restore HUD
    await page.evaluate(() => {
      window.game.ui.hud.show();
    });

    // Inspect Track Sections
    const trackInfo = await page.evaluate(() => {
      const track = window.game.world.track;
      const analysis = window.game.world.analysis;
      const nodes = track.route.map((n, i) => ({
        index: i,
        time: n.time,
        pos: { x: n.position.x, y: n.position.y, z: n.position.z },
        yaw: n.yaw,
        isSurf: n.isSurf,
        type: n.type
      }));
      const sections = (analysis.sections || []).map(s => ({
        theme: s.theme,
        start: s.start,
        end: s.end
      }));
      const checkpoints = track.checkpoints.map((cp, idx) => ({
        id: cp.id,
        pos: cp.position,
        idx
      }));
      const finish = track.finish;
      const renderer = window.game.environment.renderer;
      const renderInfo = {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures
      };
      return { nodes, sections, checkpoints, finish, renderInfo };
    });

    console.log('[ARTSTYLE REVIEW] Render Info:', trackInfo.renderInfo);
    console.log('[ARTSTYLE REVIEW] Sections:', trackInfo.sections);

    const surfNode = trackInfo.nodes.find(n => n.isSurf);
    const cpNode = trackInfo.checkpoints[0];
    const breathSec = trackInfo.sections.find(s => s.theme === 'BREATH') || trackInfo.sections[1];
    const buildupSec = trackInfo.sections.find(s => s.theme === 'BUILDUP');
    const dropSec = trackInfo.sections.find(s => s.theme === 'DROP') || trackInfo.sections[trackInfo.sections.length - 1];

    // 2. Buildup Section
    if (buildupSec && typeof buildupSec.start === 'number') {
      console.log(`[ARTSTYLE REVIEW] Jumping to Buildup section at ${buildupSec.start}s...`);
      await page.evaluate((time) => {
        window.game.audioEngine.seek(time);
        const node = window.game.world.track.route.find(n => n.time >= time) || window.game.world.track.route[15];
        window.game.playerController.position.set(node.position.x, node.position.y + 2.0, node.position.z);
        window.game.cameraController.yaw = node.yaw;
      }, buildupSec.start);
      await new Promise(r => setTimeout(r, 1200));
      await page.screenshot({ path: path.join(ARTIFACT_DIR, 'phase02_03_buildup.png') });
      console.log('[ARTSTYLE REVIEW] Captured phase02_03_buildup.png');
    }

    // 3. Drop Section (Split monolith & shockwave)
    if (dropSec && typeof dropSec.start === 'number') {
      console.log(`[ARTSTYLE REVIEW] Jumping to Drop section at ${dropSec.start}s...`);
      await page.evaluate((time) => {
        window.game.audioEngine.seek(time + 1.0);
        const node = window.game.world.track.route.find(n => n.time >= time) || window.game.world.track.route[25];
        window.game.playerController.position.set(node.position.x, node.position.y + 2.0, node.position.z);
        window.game.cameraController.yaw = node.yaw;
      }, dropSec.start);
      await new Promise(r => setTimeout(r, 1200));
      await page.screenshot({ path: path.join(ARTIFACT_DIR, 'phase02_04_drop.png') });
      console.log('[ARTSTYLE REVIEW] Captured phase02_04_drop.png');
    }

    // 4. Breath Section (Negative space & Celestial Moon)
    if (breathSec && typeof breathSec.start === 'number') {
      console.log(`[ARTSTYLE REVIEW] Jumping to Breath section at ${breathSec.start}s...`);
      await page.evaluate((time) => {
        window.game.audioEngine.seek(time);
        const node = window.game.world.track.route.find(n => n.time >= time) || window.game.world.track.route[10];
        window.game.playerController.position.set(node.position.x, node.position.y + 2.0, node.position.z);
        window.game.cameraController.yaw = node.yaw;
      }, breathSec.start);
      await new Promise(r => setTimeout(r, 1200));
      await page.screenshot({ path: path.join(ARTIFACT_DIR, 'phase02_05_breath.png') });
      console.log('[ARTSTYLE REVIEW] Captured phase02_05_breath.png');
    }

    // 5. Surf Section (Directional chevrons & Canyon Walls)
    if (surfNode) {
      console.log(`[ARTSTYLE REVIEW] Jumping to Surf node #${surfNode.index}...`);
      await page.evaluate((nodeIdx) => {
        const node = window.game.world.track.route[nodeIdx];
        window.game.playerController.position.set(node.position.x - 2, node.position.y + 1.5, node.position.z);
        window.game.cameraController.yaw = node.yaw;
        window.game.playerController.isSurfing = true;
        window.game.playerController.surfState.isSurfing = true;
        window.game.playerController.surfState.surfSide = 'LEFT';
        window.game.playerController.velocity.set(18.0, -8.0, 22.0);
      }, surfNode.index);
      await new Promise(r => setTimeout(r, 900));
      await page.screenshot({ path: path.join(ARTIFACT_DIR, 'phase02_06_surf.png') });
      console.log('[ARTSTYLE REVIEW] Captured phase02_06_surf.png');
    }

    // 6. Checkpoint Gateway
    if (cpNode) {
      console.log(`[ARTSTYLE REVIEW] Jumping near Checkpoint...`);
      await page.evaluate((cpPos) => {
        window.game.playerController.position.set(cpPos.x, cpPos.y + 1.5, cpPos.z - 16);
      }, cpNode.pos);
      await new Promise(r => setTimeout(r, 900));
      await page.screenshot({ path: path.join(ARTIFACT_DIR, 'phase02_07_checkpoint.png') });
      console.log('[ARTSTYLE REVIEW] Captured phase02_07_checkpoint.png');
    }

    // 7. Finish Monument
    if (trackInfo.finish) {
      console.log(`[ARTSTYLE REVIEW] Jumping near Finish Portal...`);
      await page.evaluate((fPos) => {
        window.game.playerController.position.set(fPos.position.x, fPos.position.y + 1.5, fPos.position.z - 25);
      }, trackInfo.finish);
      await new Promise(r => setTimeout(r, 900));
      await page.screenshot({ path: path.join(ARTIFACT_DIR, 'phase02_08_finish.png') });
      console.log('[ARTSTYLE REVIEW] Captured phase02_08_finish.png');
    }

    // 8. High-Speed Strafe Signal Trail
    console.log(`[ARTSTYLE REVIEW] Testing high-speed strafe trail...`);
    await page.evaluate(() => {
      window.game.playerController.velocity.set(22.0, 0, 22.0);
    });
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyD');
    await new Promise(r => setTimeout(r, 450));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'phase02_09_strafe.png') });
    console.log('[ARTSTYLE REVIEW] Captured phase02_09_strafe.png');
    await page.keyboard.up('KeyD');
    await page.keyboard.up('KeyW');

    // 9. Second Track Test (Testing distinct dream profile and palette e.g. EMBER / BLOOD_MOON / ACID)
    console.log('[ARTSTYLE REVIEW] Testing second track from catalog for distinct dream profile...');
    await page.evaluate(async () => {
      // Return to import / select next track
      window.game.stateMachine.transitionTo(0); // IMPORT
    });
    await new Promise(r => setTimeout(r, 800));

    // Look for track cards in Import screen
    const clickedTrack = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.track-card, [data-track-id]'));
      // Look for a high difficulty or different genre track
      const targetCard = cards.find(c => {
        const txt = c.textContent || '';
        return txt.includes('EMBER') || txt.includes('ACID') || txt.includes('COLLIDER') || txt.includes('PULSE');
      }) || cards[1];

      if (targetCard) {
        (targetCard).click();
        return true;
      }
      return false;
    });

    if (clickedTrack) {
      console.log('[ARTSTYLE REVIEW] Clicked second track, waiting for analysis...');
      await page.waitForFunction(() => {
        const btn = document.querySelector('#btn-enter-track');
        return btn && !btn.disabled;
      }, { timeout: 20000 });

      await page.click('#btn-enter-track');

      await page.waitForFunction(() => {
        return window.game && window.game.stateMachine && window.game.stateMachine.is('PLAYING');
      }, { timeout: 15000 });

      await new Promise(r => setTimeout(r, 1200));
      await page.screenshot({ path: path.join(ARTIFACT_DIR, 'phase02_10_second_song.png') });
      console.log('[ARTSTYLE REVIEW] Captured phase02_10_second_song.png');
    }

    console.log('=== [ARTSTYLE REVIEW COMPLETE] ===');
  } catch (err) {
    console.error('[ARTSTYLE REVIEW FAILED]', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

runArtstyleReview();
