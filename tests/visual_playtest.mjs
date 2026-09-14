import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function runVisualPlaytest() {
  console.log('[VISUAL PLAYTEST] Launching browser...');
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

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.text().includes('PLAYHEAD')) {
      console.log(`[BROWSER ${msg.type().toUpperCase()}] ${msg.text()}`);
    }
  });

  page.on('pageerror', (err) => {
    console.error('[BROWSER PAGE ERROR]', err);
  });

  console.log('[VISUAL PLAYTEST] Navigating to http://127.0.0.1:3000...');
  await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle0' });

  // 1. Capture Title Screen
  await page.screenshot({ path: 'screenshot_playhead_title.png' });
  console.log('[SAVED] screenshot_playhead_title.png');

  // 2. Load Electronic Drop
  console.log('[VISUAL PLAYTEST] Selecting DEV: ELECTRONIC DROP...');
  await page.click('#btn-dev-track');

  await page.waitForFunction(() => {
    const btn = document.querySelector('#btn-enter-track');
    return btn && !btn.disabled;
  }, { timeout: 15000 });

  console.log('[VISUAL PLAYTEST] Entering track...');
  await page.click('#btn-enter-track');

  await page.waitForFunction(() => {
    return window.game && window.game.stateMachine.is('PLAYING');
  }, { timeout: 8000 });

  // Enable F3 Dev Diagnostics overlay
  await page.keyboard.press('F3');
  await new Promise((r) => setTimeout(r, 400));

  // Run forward in intro section
  await page.keyboard.down('KeyW');
  await new Promise((r) => setTimeout(r, 1200));
  await page.keyboard.up('KeyW');

  await page.screenshot({ path: 'screenshot_vis_intro.png' });
  console.log('[SAVED] screenshot_vis_intro.png');

  // 3. Teleport to Buildup section (~28s)
  console.log('[VISUAL PLAYTEST] Teleporting to BUILDUP section...');
  await page.evaluate(() => {
    const game = window.game;
    const track = game.currentTrack;
    // Find node near 28s
    const targetNode = track.route.find(n => n.time >= 28) || track.route[Math.floor(track.route.length * 0.35)];
    game.audioEngine.seek(targetNode.time);
    game.playerController.setPosition({
      x: targetNode.position.x,
      y: targetNode.position.y + 1.5,
      z: targetNode.position.z
    });
  });

  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: 'screenshot_vis_buildup.png' });
  console.log('[SAVED] screenshot_vis_buildup.png');

  // 4. Teleport to Major Drop (~38s)
  console.log('[VISUAL PLAYTEST] Teleporting to DROP section...');
  await page.evaluate(() => {
    const game = window.game;
    const track = game.currentTrack;
    // Find node near 38s
    const targetNode = track.route.find(n => n.time >= 37.5) || track.route[Math.floor(track.route.length * 0.5)];
    game.audioEngine.seek(targetNode.time);
    game.playerController.setPosition({
      x: targetNode.position.x,
      y: targetNode.position.y + 1.5,
      z: targetNode.position.z
    });
  });

  // Let audio and drop impact envelope trigger
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: 'screenshot_vis_drop.png' });
  console.log('[SAVED] screenshot_vis_drop.png');

  // 5. Test Air Strafe Visuals: Jump and hold D + move mouse
  console.log('[VISUAL PLAYTEST] Testing Air Strafe Visualizer...');
  await page.keyboard.down('KeyW');
  await new Promise((r) => setTimeout(r, 300));
  await page.keyboard.down('Space');
  await page.keyboard.down('KeyD');
  await new Promise((r) => setTimeout(r, 200));
  await page.keyboard.up('Space');
  await new Promise((r) => setTimeout(r, 250));

  await page.screenshot({ path: 'screenshot_vis_strafe.png' });
  console.log('[SAVED] screenshot_vis_strafe.png');
  await page.keyboard.up('KeyW');
  await page.keyboard.up('KeyD');

  // 6. Return to Import Screen to test Breakbeat DnB
  console.log('[VISUAL PLAYTEST] Returning to Import Screen...');
  await page.evaluate(() => {
    window.game.stateMachine.transitionTo('IMPORT');
  });
  await new Promise((r) => setTimeout(r, 500));

  // Load Breakbeat DnB
  console.log('[VISUAL PLAYTEST] Testing DEV: BREAKBEAT DNB...');
  await page.click('#btn-dev-dnb');

  await page.waitForFunction(() => {
    const btn = document.querySelector('#btn-enter-track');
    return btn && !btn.disabled;
  }, { timeout: 15000 });

  await page.click('#btn-enter-track');
  await page.waitForFunction(() => {
    return window.game && window.game.stateMachine.is('PLAYING');
  }, { timeout: 8000 });

  // Move forward slightly
  await page.keyboard.down('KeyW');
  await new Promise((r) => setTimeout(r, 1000));
  await page.keyboard.up('KeyW');

  await page.screenshot({ path: 'screenshot_vis_dnb.png' });
  console.log('[SAVED] screenshot_vis_dnb.png');

  // 7. Return to Import Screen to test Ambient Sparse
  console.log('[VISUAL PLAYTEST] Returning to Import Screen for AMBIENT...');
  await page.evaluate(() => {
    window.game.stateMachine.transitionTo('IMPORT');
  });
  await new Promise((r) => setTimeout(r, 500));

  console.log('[VISUAL PLAYTEST] Testing DEV: AMBIENT SPARSE...');
  await page.click('#btn-dev-ambient');

  await page.waitForFunction(() => {
    const btn = document.querySelector('#btn-enter-track');
    return btn && !btn.disabled;
  }, { timeout: 15000 });

  await page.click('#btn-enter-track');
  await page.waitForFunction(() => {
    return window.game && window.game.stateMachine.is('PLAYING');
  }, { timeout: 8000 });

  await page.keyboard.down('KeyW');
  await new Promise((r) => setTimeout(r, 1000));
  await page.keyboard.up('KeyW');

  await page.screenshot({ path: 'screenshot_vis_ambient.png' });
  console.log('[SAVED] screenshot_vis_ambient.png');

  // 8. Test Movement Lab
  console.log('[VISUAL PLAYTEST] Testing Movement Lab...');
  await page.evaluate(() => {
    window.game.stateMachine.transitionTo('IMPORT');
    window.game.stateMachine.transitionTo('MOVEMENT_LAB');
  });
  await new Promise((r) => setTimeout(r, 800));

  // Teleport player to Area H (z = 910)
  await page.evaluate(() => {
    const game = window.game;
    if (game.movementLab) {
      game.playerController.setPosition({ x: 0, y: 1.5, z: 910 });
      game.playerController.setOrientation(Math.PI);
    }
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: 'screenshot_lab_area_h.png' });
  console.log('[SAVED] screenshot_lab_area_h.png');

  // Test Area F1 (Key 4)
  console.log('[VISUAL PLAYTEST] Testing Area F1: Easy Single Ramp...');
  await page.evaluate(() => {
    const pc = window.game.playerController;
    window.game.movementLab.teleportPlayer(new pc.position.constructor(0, 1.5, 1050), Math.PI);
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: 'screenshot_lab_surf_f1.png' });
  console.log('[SAVED] screenshot_lab_surf_f1.png');

  // Test Area F2 (Key 5)
  console.log('[VISUAL PLAYTEST] Testing Area F2: Long Flow Ramp...');
  await page.evaluate(() => {
    const pc = window.game.playerController;
    window.game.movementLab.teleportPlayer(new pc.position.constructor(0, 5.5, 1190), Math.PI);
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: 'screenshot_lab_surf_f2.png' });
  console.log('[SAVED] screenshot_lab_surf_f2.png');

  // Test Area F3 (Key 6)
  console.log('[VISUAL PLAYTEST] Testing Area F3: Transfer Test...');
  await page.evaluate(() => {
    const pc = window.game.playerController;
    window.game.movementLab.teleportPlayer(new pc.position.constructor(0, 3.5, 1360), Math.PI);
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: 'screenshot_lab_surf_f3.png' });
  console.log('[SAVED] screenshot_lab_surf_f3.png');

  // Test Area F4 (Key 7)
  console.log('[VISUAL PLAYTEST] Testing Area F4: High-Speed Surf Chute...');
  await page.evaluate(() => {
    const pc = window.game.playerController;
    window.game.movementLab.teleportPlayer(new pc.position.constructor(0, 1.5, 1540), Math.PI);
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: 'screenshot_lab_surf_f4.png' });
  console.log('[SAVED] screenshot_lab_surf_f4.png');

  // Test Area F5 (Key 8)
  console.log('[VISUAL PLAYTEST] Testing Area F5: Surf Exit & Launch...');
  await page.evaluate(() => {
    const pc = window.game.playerController;
    window.game.movementLab.teleportPlayer(new pc.position.constructor(0, 1.5, 1730), Math.PI);
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: 'screenshot_lab_surf_f5.png' });
  console.log('[SAVED] screenshot_lab_surf_f5.png');

  // Starry Skybox: Pitch camera upward
  console.log('[VISUAL PLAYTEST] Capturing Starry Skybox looking up...');
  await page.evaluate(() => {
    window.game.cameraController.setOrientation(Math.PI, 0.75);
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: 'screenshot_starry_sky.png' });
  console.log('[SAVED] screenshot_starry_sky.png');
  await page.evaluate(() => {
    window.game.cameraController.setOrientation(Math.PI, 0.0);
  });

  // Test Active Surf Physics & Contact Ribbon in Movement Lab Area F1
  console.log('[VISUAL PLAYTEST] Simulating surf contact on Area F1...');
  await page.evaluate(() => {
    const game = window.game;
    // Position player right onto the banked ramp of Area F1 (x = -4.0, y = 2.2, z = 1085) with forward velocity
    game.playerController.setPosition({ x: -4.2, y: 2.5, z: 1080 });
    game.playerController.velocity.set(0, -1.0, 18.0);
    game.playerController.setOrientation(Math.PI);
  });
  // Advance physics simulation
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: 'screenshot_surf_contact_ribbon.png' });
  console.log('[SAVED] screenshot_surf_contact_ribbon.png');

  // Check procedural track with drop surf
  console.log('[VISUAL PLAYTEST] Returning to Import to verify procedural drop surf...');
  await page.evaluate(() => {
    window.game.stateMachine.transitionTo('IMPORT');
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.click('#btn-dev-track');
  await page.waitForFunction(() => {
    const btn = document.querySelector('#btn-enter-track');
    return btn && !btn.disabled;
  }, { timeout: 15000 });
  await page.click('#btn-enter-track');
  await page.waitForFunction(() => {
    return window.game && window.game.stateMachine.is('PLAYING');
  }, { timeout: 8000 });

  // Locate the first procedural surf node in track
  await page.evaluate(() => {
    const game = window.game;
    const track = game.currentTrack;
    const surfNode = track.route.find((n) => n.isSurf);
    if (surfNode) {
      // Position player just ahead of the surf node
      const idx = track.route.indexOf(surfNode);
      const approachNode = idx > 0 ? track.route[idx - 1] : surfNode;
      game.audioEngine.seek(approachNode.time);
      game.playerController.setPosition({
        x: approachNode.position.x,
        y: approachNode.position.y + 1.5,
        z: approachNode.position.z
      });
      const dx = surfNode.position.x - approachNode.position.x;
      const dz = surfNode.position.z - approachNode.position.z;
      const lookYaw = Math.atan2(-dx, -dz);
      game.playerController.setOrientation(lookYaw);
    }
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: 'screenshot_procedural_drop_surf.png' });
  console.log('[SAVED] screenshot_procedural_drop_surf.png');

  // 9. Capture dev diagnostics telemetry JSON
  const telemetry = await page.evaluate(() => {
    const game = window.game;
    const vs = game.world.visualController.state;
    const pc = game.playerController;
    return {
      palette: vs.palette.name,
      sectionTheme: vs.sectionTheme,
      sectionIndex: vs.sectionIndex,
      reactivityMultiplier: vs.reactivityMultiplier,
      primaryMix: vs.primaryMix,
      secondaryMix: vs.secondaryMix,
      highlightMix: vs.highlightMix,
      energy: vs.energy,
      subBass: vs.subBass,
      bass: vs.bass,
      mid: vs.mid,
      high: vs.high,
      buildup: vs.buildup,
      dropImpact: vs.dropImpact,
      strafeEfficiency: pc.currentStrafeEfficiency,
      strafeRating: pc.currentStrafeRating,
      isSurfing: pc.isSurfing,
      surfSlopeAngle: pc.surfState.surfaceAngleDeg,
      surfTangentialSpeed: pc.surfState.tangentialSpeed
    };
  });
  console.log('[VISUAL PLAYTEST TELEMETRY]', JSON.stringify(telemetry, null, 2));

  // 10. Copy screenshots to artifact directory
  const artifactDir = 'C:\\Users\\lin4s\\.gemini\\antigravity\\brain\\ed6a93af-435f-4ce7-a35a-81381d79f4f6';
  const screenshotFiles = [
    'screenshot_playhead_title.png',
    'screenshot_vis_intro.png',
    'screenshot_vis_buildup.png',
    'screenshot_vis_drop.png',
    'screenshot_vis_strafe.png',
    'screenshot_vis_dnb.png',
    'screenshot_vis_ambient.png',
    'screenshot_lab_area_h.png',
    'screenshot_lab_surf_f1.png',
    'screenshot_lab_surf_f2.png',
    'screenshot_lab_surf_f3.png',
    'screenshot_lab_surf_f4.png',
    'screenshot_lab_surf_f5.png',
    'screenshot_starry_sky.png',
    'screenshot_surf_contact_ribbon.png',
    'screenshot_procedural_drop_surf.png'
  ];

  for (const file of screenshotFiles) {
    if (fs.existsSync(file)) {
      const dest = path.join(artifactDir, file);
      fs.copyFileSync(file, dest);
      console.log(`[COPIED TO ARTIFACTS] ${file}`);
    }
  }

  await browser.close();
  console.log('[VISUAL PLAYTEST COMPLETED SUCCESSFULLY]');
}

runVisualPlaytest().catch((err) => {
  console.error('[VISUAL PLAYTEST FAILED]', err);
  process.exit(1);
});
