/**
 * STRICTLY STATIONARY CAMERA TEST
 *
 * Player position is HARD-PINNED every frame (velocity zeroed, position frozen)
 * so any change can only come from a transform/space bug, never from physics.
 * Rotates yaw and pitch rapidly and measures:
 *   - player position drift (must be 0)
 *   - camera world position drift (must be 0)
 *   - per-frame camera world position discontinuity (the "snap")
 *   - desync vs player + eyeHeight
 */
import puppeteer from 'puppeteer-core';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = process.argv[2] || 'http://localhost:3000';

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

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
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
  await new Promise((r) => setTimeout(r, 3500));

  const out = await page.evaluate(async () => {
    const game = window.game;
    const player = game.playerController;
    const cc = game.cameraController;
    const cam = game.environment.camera;

    // Pin the player exactly where it stands.
    const pinned = { x: player.position.x, y: player.position.y, z: player.position.z };
    const eye = player.config.eyeHeight;
    const keys = player.keysState;
    for (const k of Object.keys(keys)) keys[k] = false;

    const V = player.position.constructor;
    const wp = new V();
    const prevWp = new V();
    cam.getWorldPosition(prevWp);

    let maxPlayerDrift = 0;
    let maxCamDrift = 0;
    let maxDesync = 0;
    let maxFrameJump = 0;
    let worst = null;
    let frames = 0;
    const rows = [];

    const step = async (label, yaw, pitch) => {
      cc.setOrientation(yaw, pitch);
      await new Promise((r) => requestAnimationFrame(r));
      frames++;

      // Re-pin: any change here is NOT physics.
      player.velocity.set(0, 0, 0);
      player.position.set(pinned.x, pinned.y, pinned.z);

      cam.getWorldPosition(wp);

      const pDrift = Math.hypot(player.position.x - pinned.x, player.position.y - pinned.y, player.position.z - pinned.z);
      const ex = pinned.x, ey = pinned.y + eye, ez = pinned.z;
      const cDrift = Math.hypot(wp.x - ex, wp.y - ey, wp.z - ez);
      const desync = cDrift;
      const jump = Math.hypot(wp.x - prevWp.x, wp.y - prevWp.y, wp.z - prevWp.z);

      maxPlayerDrift = Math.max(maxPlayerDrift, pDrift);
      maxCamDrift = Math.max(maxCamDrift, cDrift);
      maxDesync = Math.max(maxDesync, desync);
      if (jump > maxFrameJump) {
        maxFrameJump = jump;
        worst = { label, yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3), jump: +jump.toFixed(6),
          camWorld: [wp.x, wp.y, wp.z], expected: [ex, ey, ez] };
      }
      rows.push({
        label, yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3),
        playerDrift: +pDrift.toFixed(6), camDrift: +cDrift.toFixed(6),
        frameJump: +jump.toFixed(6),
        camWorld: [+wp.x.toFixed(4), +wp.y.toFixed(4), +wp.z.toFixed(4)]
      });
      prevWp.copy(wp);
    };

    // Baseline settle
    await step('settle', cc.yaw, cc.pitch);
    await step('settle', cc.yaw, cc.pitch);

    // A: yaw sweep (stationary)
    for (let i = 0; i <= 30; i++) await step('A-yaw', (i / 30) * Math.PI * 2, 0);

    // B: pitch sweep (stationary)
    for (let i = 0; i <= 20; i++) await step('B-pitch', 0, -1.4 + (i / 20) * 2.8);

    // C: rapid alternating yaw
    for (let i = 0; i < 30; i++) await step('C-alt-yaw', i % 2 ? Math.PI : -Math.PI, 0);

    // D: rapid alternating pitch
    for (let i = 0; i < 30; i++) await step('D-alt-pitch', 0.5, i % 2 ? 1.4 : -1.4);

    // E: combined fast spin
    for (let i = 0; i < 30; i++) await step('E-combined', (i / 30) * Math.PI * 2, Math.sin(i * 0.5) * 1.4);

    return {
      pinned, eyeHeight: eye, frames,
      maxPlayerDrift: +maxPlayerDrift.toFixed(6),
      maxCamDrift: +maxCamDrift.toFixed(6),
      maxDesync: +maxDesync.toFixed(6),
      maxFrameJump: +maxFrameJump.toFixed(6),
      worst,
      rows
    };
  });

  console.log('\n=== STRICTLY STATIONARY ROTATION TEST ===');
  console.log('pinned player  =', JSON.stringify(out.pinned), ' eyeHeight =', out.eyeHeight);
  console.log('frames sampled =', out.frames);
  console.log('maxPlayerDrift =', out.maxPlayerDrift, ' (must be 0 — position is re-pinned)');
  console.log('maxCamDrift    =', out.maxCamDrift, ' (camera world vs player+eye)');
  console.log('maxDesync      =', out.maxDesync);
  console.log('maxFrameJump   =', out.maxFrameJump, ' <-- per-frame camera world discontinuity');
  console.log('worst jump     =', JSON.stringify(out.worst));

  console.log('\nper-test summary:');
  const byLabel = {};
  for (const r of out.rows) {
    const b = byLabel[r.label] || (byLabel[r.label] = { n: 0, maxDrift: 0, maxJump: 0 });
    b.n++;
    b.maxDrift = Math.max(b.maxDrift, r.camDrift);
    b.maxJump = Math.max(b.maxJump, r.frameJump);
  }
  for (const [k, v] of Object.entries(byLabel)) {
    console.log(`  ${k.padEnd(14)} samples=${String(v.n).padStart(3)} maxCamDrift=${v.maxDrift.toFixed(6)} maxFrameJump=${v.maxJump.toFixed(6)}`);
  }
} finally {
  await browser.close();
}