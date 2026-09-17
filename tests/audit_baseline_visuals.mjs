import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\lin4s\\.gemini\\antigravity\\brain\\ed6a93af-435f-4ce7-a35a-81381d79f4f6';

async function runVisualAudit() {
  console.log('[VISUAL AUDIT] Launching browser...');
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

    console.log('[VISUAL AUDIT] Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });

    // 1. Title Screen Screenshot
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'baseline_01_title.png') });
    console.log('[VISUAL AUDIT] Captured baseline_01_title.png');

    // 2. Click FIRST CONTACT to enter Analysis Screen
    await page.waitForSelector('#btn-showcase-enter', { timeout: 10000 });
    await page.click('#btn-showcase-enter');

    await new Promise(r => setTimeout(r, 1200));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'baseline_02_analysis.png') });
    console.log('[VISUAL AUDIT] Captured baseline_02_analysis.png');

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
    console.log('[VISUAL AUDIT] Entered PLAYING state.');

    // Settle 1000ms
    await new Promise(r => setTimeout(r, 1000));

    // 3. Flow Section Screenshot
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'baseline_03_flow.png') });
    console.log('[VISUAL AUDIT] Captured baseline_03_flow.png');

    // Look up track sections and nodes
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
      return { nodes, sections, checkpoints };
    });

    console.log('[VISUAL AUDIT] Track sections:', trackInfo.sections);
    const surfNode = trackInfo.nodes.find(n => n.isSurf);
    const cpNode = trackInfo.checkpoints[0];

    const breathSec = trackInfo.sections.find(s => s.theme === 'BREATH') || trackInfo.sections[1];
    const buildupSec = trackInfo.sections.find(s => s.theme === 'BUILDUP');
    const dropSec = trackInfo.sections.find(s => s.theme === 'DROP') || trackInfo.sections[trackInfo.sections.length - 1];

    // 4. Buildup Section
    if (buildupSec && typeof buildupSec.start === 'number') {
      console.log(`[VISUAL AUDIT] Jumping to Buildup section at ${buildupSec.start}s...`);
      await page.evaluate((time) => {
        window.game.audioEngine.seek(time);
        const node = window.game.world.track.route.find(n => n.time >= time) || window.game.world.track.route[15];
        window.game.playerController.position.set(node.position.x, node.position.y + 2.0, node.position.z);
        window.game.cameraController.yaw = node.yaw;
      }, buildupSec.start);
      await new Promise(r => setTimeout(r, 1200));
      await page.screenshot({ path: path.join(ARTIFACT_DIR, 'baseline_04_buildup.png') });
      console.log('[VISUAL AUDIT] Captured baseline_04_buildup.png');
    }

    // 5. Drop Section
    if (dropSec && typeof dropSec.start === 'number') {
      console.log(`[VISUAL AUDIT] Jumping to Drop section at ${dropSec.start}s...`);
      await page.evaluate((time) => {
        window.game.audioEngine.seek(time + 1.0);
        const node = window.game.world.track.route.find(n => n.time >= time) || window.game.world.track.route[25];
        window.game.playerController.position.set(node.position.x, node.position.y + 2.0, node.position.z);
        window.game.cameraController.yaw = node.yaw;
      }, dropSec.start);
      await new Promise(r => setTimeout(r, 1200));
      await page.screenshot({ path: path.join(ARTIFACT_DIR, 'baseline_05_drop.png') });
      console.log('[VISUAL AUDIT] Captured baseline_05_drop.png');
    }

    // 6. Breath Section
    if (breathSec && typeof breathSec.start === 'number') {
      console.log(`[VISUAL AUDIT] Jumping to Breath section at ${breathSec.start}s...`);
      await page.evaluate((time) => {
        window.game.audioEngine.seek(time);
        const node = window.game.world.track.route.find(n => n.time >= time) || window.game.world.track.route[10];
        window.game.playerController.position.set(node.position.x, node.position.y + 2.0, node.position.z);
        window.game.cameraController.yaw = node.yaw;
      }, breathSec.start);
      await new Promise(r => setTimeout(r, 1200));
      await page.screenshot({ path: path.join(ARTIFACT_DIR, 'baseline_06_breath.png') });
      console.log('[VISUAL AUDIT] Captured baseline_06_breath.png');
    }

    // 7. Surf Section
    if (surfNode) {
      console.log(`[VISUAL AUDIT] Jumping to Surf node #${surfNode.index}...`);
      await page.evaluate((nodeIdx) => {
        const node = window.game.world.track.route[nodeIdx];
        window.game.playerController.position.set(node.position.x - 2, node.position.y + 1.5, node.position.z);
        window.game.cameraController.yaw = node.yaw;
        window.game.playerController.isSurfing = true;
        window.game.playerController.surfState.isSurfing = true;
        window.game.playerController.surfState.surfSide = 'LEFT';
        window.game.playerController.velocity.set(16.0, -8.0, 20.0);
      }, surfNode.index);
      await new Promise(r => setTimeout(r, 800));
      await page.screenshot({ path: path.join(ARTIFACT_DIR, 'baseline_07_surf.png') });
      console.log('[VISUAL AUDIT] Captured baseline_07_surf.png');
    }

    // 8. Checkpoint Section
    if (cpNode) {
      console.log(`[VISUAL AUDIT] Jumping near Checkpoint...`);
      await page.evaluate((cpPos) => {
        window.game.playerController.position.set(cpPos.x, cpPos.y + 1.5, cpPos.z - 15);
      }, cpNode.pos);
      await new Promise(r => setTimeout(r, 800));
      await page.screenshot({ path: path.join(ARTIFACT_DIR, 'baseline_08_checkpoint.png') });
      console.log('[VISUAL AUDIT] Captured baseline_08_checkpoint.png');
    }

    // 9. High-speed strafe test screenshot
    console.log(`[VISUAL AUDIT] Testing high-speed strafe...`);
    await page.evaluate(() => {
      window.game.playerController.velocity.set(18.0, 0, 18.0);
    });
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyD');
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'baseline_09_strafe.png') });
    console.log('[VISUAL AUDIT] Captured baseline_09_strafe.png');
    await page.keyboard.up('KeyD');
    await page.keyboard.up('KeyW');

    console.log('=== [VISUAL AUDIT BASELINE COMPLETE] ===');
  } catch (err) {
    console.error('[VISUAL AUDIT FAILED]', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

runVisualAudit();
