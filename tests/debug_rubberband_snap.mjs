/**
 * RUBBERBAND INVESTIGATION HARNESS
 *
 * Drives the REAL game loop (gameLoop -> GameClock -> PlayerController.updateFixed)
 * while watching every frame for an authoritative backward snap.
 *
 * On detecting a snap it dumps the full context block so the offending system
 * identifies itself, and also instruments setPosition so restore paths are
 * caught even if they coincide with the snap.
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'C:\\Users\\lin4s\\Documents\\TRACKRUN\\.perf';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE_PATH,
  headless: 'new',
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox',
    '--disable-setuid-sandbox', '--disable-web-security',
    '--window-size=1280,720', '--use-gl=swiftshader', '--enable-unsafe-swiftshader']
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', (e) => console.log('[PAGEERROR]', e.message));
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('[PLAYER CORRECTION]') || t.includes('[SNAP]') || t.includes('WATCHDOG') || t.includes('RESTORE')) {
      console.log('[page]', t);
    }
  });

  await page.goto('http://localhost:3001', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btn-showcase-enter', { timeout: 40000 });
  await page.click('#btn-showcase-enter');
  await page.waitForFunction(() => {
    const b = document.querySelector('#btn-enter-track');
    return b && !b.disabled;
  }, { timeout: 60000 });
  await page.click('#btn-enter-track');
  await page.waitForFunction(
    () => window.game && window.game.stateMachine && window.game.stateMachine.is('PLAYING'),
    { timeout: 60000 }
  );
  await new Promise((r) => setTimeout(r, 4000));

  const report = await page.evaluate(async (pitchDeg, fov, speedTarget, durationMs) => {
    const game = window.game;
    const player = game.playerController;
    const cam = game.cameraController;

    const snaps = [];
    const restores = [];

    // --- Instrument setPosition (all restore/teleport paths) --------------
    const originalSetPosition = player.setPosition.bind(player);
    player.setPosition = function (pos) {
      restores.push({
        stack: (new Error().stack || '').split('\n').slice(1, 5).map((s) => s.trim()),
        before: { x: player.position.x, y: player.position.y, z: player.position.z },
        target: { x: pos.x, y: pos.y, z: pos.z },
        speed: player.getSpeedUnits(),
        killY: player.authoritativeKillY,
        cpId: game.currentCheckpoint ? game.currentCheckpoint.id : null,
        t: performance.now()
      });
      return originalSetPosition(pos);
    };

    // --- Set camera pitch / FOV -----------------------------------------
    cam.setOrientation(cam.yaw, (pitchDeg * Math.PI) / 180);
    game.environment.setBaseFov(fov);
    game.environment.camera.fov = fov;
    game.environment.camera.updateProjectionMatrix();

    // --- Drive forward at a target speed ---------------------------------
    const keys = player.keysState;
    keys.forward = true;

    const startPos = player.position.clone();
    let prev = player.position.clone();
    let prevVel = player.velocity.clone();
    const t0 = performance.now();
    let frames = 0;
    let maxSpeed = 0;
    let maxBackward = 0;
    let lastFrameDelta = 0;

    while (performance.now() - t0 < durationMs) {
      await new Promise((r) => requestAnimationFrame(r));
      frames++;

      // Maintain forward speed along the current horizontal velocity direction.
      const vh = Math.hypot(player.velocity.x, player.velocity.z);
      if (vh < 0.01) {
        const fwd = cam.getForwardVector();
        player.velocity.x = fwd.x * speedTarget;
        player.velocity.z = fwd.z * speedTarget;
      } else if (vh < speedTarget) {
        const s = Math.min(speedTarget / vh, 1.06);
        player.velocity.x *= s;
        player.velocity.z *= s;
      }
      player.position.y = Math.max(player.position.y, startPos.y);

      const cur = player.position;
      const speed = player.getSpeedUnits();
      maxSpeed = Math.max(maxSpeed, speed);

      // Horizontal displacement this frame vs what velocity predicts.
      const dx = cur.x - prev.x;
      const dz = cur.z - prev.z;
      const dh = Math.hypot(dx, dz);
      const expected = Math.hypot(prevVel.x, prevVel.z) * lastFrameDelta;
      // "Backward" = moved opposite to horizontal velocity direction.
      const vhn = Math.hypot(prevVel.x, prevVel.z);
      let backward = 0;
      if (vhn > 1e-4) {
        const ux = prevVel.x / vhn, uz = prevVel.z / vhn;
        const along = dx * ux + dz * uz; // negative = moved backwards
        if (along < 0) backward = -along;
      }

      if (backward > maxBackward) maxBackward = backward;

      // A snap = meaningful backward travel well beyond what noise allows.
      if (backward > 1.5) {
        const frameDelta = game.clock ? game.clock['fixedDt'] : 0;
        snaps.push({
          frame: frames,
          backward: +backward.toFixed(3),
          dh: +dh.toFixed(3),
          expected: +expected.toFixed(3),
          lastFrameDeltaMs: +(lastFrameDelta * 1000).toFixed(2),
          speed: +speed.toFixed(1),
          pitchDeg: +(cam.pitch * 180 / Math.PI).toFixed(1),
          fov: game.environment.camera.fov,
          before: { x: prev.x, y: prev.y, z: prev.z },
          after: { x: cur.x, y: cur.y, z: cur.z },
          vel: { x: prevVel.x, y: prevVel.y, z: prevVel.z },
          grounded: player.isGrounded,
          surfing: player.isSurfing,
          freefall: player.getFreefallTime(),
          killY: player.authoritativeKillY,
          posY: cur.y,
          fixedDt: frameDelta
        });
      }

      prev = cur.clone();
      prevVel = player.velocity.clone();
      // Estimate the frame delta the loop just observed.
      lastFrameDelta = Math.min(1, Math.max(0.001, 1 / 60));
    }

    keys.forward = false;
    player.setPosition = originalSetPosition;

    return {
      frames,
      maxSpeed: +maxSpeed.toFixed(1),
      maxBackward: +maxBackward.toFixed(3),
      snapCount: snaps.length,
      snaps: snaps.slice(0, 8),
      restoreCount: restores.length,
      restores,
      finalPos: { x: player.position.x, y: player.position.y, z: player.position.z },
      startPos: { x: startPos.x, y: startPos.y, z: startPos.z },
      camPitchDeg: +(cam.pitch * 180 / Math.PI).toFixed(1),
      camFov: game.environment.camera.fov
    };
  }, Number(process.argv[2] ?? -60), Number(process.argv[3] ?? 75), Number(process.argv[4] ?? 25), 12000);

  console.log('\n================ SNAP INVESTIGATION ================');
  console.log(`pitch=${report.camPitchDeg}deg fov=${report.camFov} frames=${report.frames} maxSpeed=${report.maxSpeed}`);
  console.log(`snapCount=${report.snapCount}  maxBackward=${report.maxBackward}  restoreCount=${report.restoreCount}`);
  console.log(`startPos=${JSON.stringify(report.startPos)}`);
  console.log(`finalPos=${JSON.stringify(report.finalPos)}`);

  if (report.restores.length > 0) {
    console.log('\n--- setPosition CALLS (restore/teleport) ---');
    for (const r of report.restores) {
      console.log(`  speed=${r.speed.toFixed(1)} killY=${r.killY} cpId=${r.cpId}`);
      console.log(`    ${JSON.stringify(r.before)} -> ${JSON.stringify(r.target)}`);
      for (const s of r.stack) console.log(`      at ${s}`);
    }
  }

  if (report.snaps.length > 0) {
    console.log('\n--- DETECTED BACKWARD SNAPS ---');
    console.log(JSON.stringify(report.snaps, null, 2));
  }
} finally {
  await browser.close();
}