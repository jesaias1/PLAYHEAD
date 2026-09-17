/**
 * CAMERA DESYNC PROBE — stationary player + rapid rotation
 *
 * Reproduces the reported condition exactly: player completely stationary,
 * camera rotated rapidly in yaw and pitch. Samples, per animation frame:
 *   - PlayerController.position          (authoritative translation)
 *   - camera.position                    (LOCAL)
 *   - camera.getWorldPosition()          (WORLD)
 *   - expected eye world = player + eyeHeight
 *   - camera parent chain
 *   - any translation drift
 *
 * Also snapshots other camera-dependent objects to catch other movers.
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'C:\\Users\\lin4s\\Documents\\TRACKRUN\\.perf';
fs.mkdirSync(OUT, { recursive: true });
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

  const result = await page.evaluate(async () => {
    const game = window.game;
    const player = game.playerController;
    const cc = game.cameraController;
    const cam = game.environment.camera;

    // ---- Static hierarchy dump ------------------------------------------
    const chain = [];
    let node = cam;
    let guard = 0;
    while (node && guard++ < 12) {
      chain.push({
        type: node.type,
        name: node.name || '(unnamed)',
        localPos: [node.position.x, node.position.y, node.position.z],
        worldPos: (() => { const v = new (node.position.constructor)(); node.getWorldPosition(v); return [v.x, v.y, v.z]; })(),
        rotation: [node.rotation.x, node.rotation.y, node.rotation.z],
        quaternion: [node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w],
        scale: [node.scale.x, node.scale.y, node.scale.z],
        parentType: node.parent ? node.parent.type : null,
        parentName: node.parent ? (node.parent.name || '(unnamed)') : null
      });
      node = node.parent;
    }

    // ---- Stationary sampling --------------------------------------------
    // Freeze player translation completely: no keys, no velocity.
    const keys = player.keysState;
    keys.forward = keys.backward = keys.left = keys.right = keys.jump = false;
    player.velocity.set(0, 0, 0);

    const samples = [];
    let maxPlayerDrift = 0;
    let maxCamWorldDrift = 0;
    let maxDesync = 0;
    let worstDesync = null;

    const basePlayer = player.position.clone();
    const worldPos = new (basePlayer.constructor)();

    const sample = (label, yaw, pitch) => {
      player.velocity.set(0, 0, 0); // hold perfectly still
      cam.getWorldPosition(worldPos);
      const expectedX = player.position.x;
      const expectedY = player.position.y + player.config.eyeHeight;
      const expectedZ = player.position.z;
      const desync = Math.hypot(worldPos.x - expectedX, worldPos.y - expectedY, worldPos.z - expectedZ);
      const playerDrift = Math.hypot(
        player.position.x - basePlayer.x,
        player.position.y - basePlayer.y,
        player.position.z - basePlayer.z
      );
      const camWorldDrift = Math.hypot(
        worldPos.x - (basePlayer.x), worldPos.y - (basePlayer.y + player.config.eyeHeight), worldPos.z - basePlayer.z
      );

      maxPlayerDrift = Math.max(maxPlayerDrift, playerDrift);
      maxCamWorldDrift = Math.max(maxCamWorldDrift, camWorldDrift);
      if (desync > maxDesync) { maxDesync = desync; }
      if (!worstDesync || desync > worstDesync.desync) {
        worstDesync = {
          label, yaw, pitch, desync,
          playerPos: [player.position.x, player.position.y, player.position.z],
          camLocal: [cam.position.x, cam.position.y, cam.position.z],
          camWorld: [worldPos.x, worldPos.y, worldPos.z],
          expected: [expectedX, expectedY, expectedZ]
        };
      }

      samples.push({
        label, yaw,
        pitch,
        playerY: +player.position.y.toFixed(6),
        playerX: +player.position.x.toFixed(6),
        playerZ: +player.position.z.toFixed(6),
        camLocalY: +cam.position.y.toFixed(6),
        camWorldX: +worldPos.x.toFixed(6),
        camWorldY: +worldPos.y.toFixed(6),
        camWorldZ: +worldPos.z.toFixed(6),
        camQW: +cam.quaternion.w.toFixed(6),
        desync: +desync.toFixed(6)
      });
    };

    // Baseline
    sample('baseline', cc.yaw, cc.pitch);

    // Rapid yaw sweep (the reported trigger)
    for (let i = 1; i <= 24; i++) {
      const yaw = (i / 24) * Math.PI * 2;
      cc.setOrientation(yaw, 0);
      await new Promise((r) => requestAnimationFrame(r));
      sample('yaw-sweep', +yaw.toFixed(3), 0);
    }

    // Rapid pitch sweep
    cc.setOrientation(0, 0);
    for (let i = 0; i <= 16; i++) {
      const pitch = (-1.4 + (i / 16) * 2.8);
      cc.setOrientation(0, pitch);
      await new Promise((r) => requestAnimationFrame(r));
      sample('pitch-sweep', 0, +pitch.toFixed(3));
    }

    // Rapid alternating yaw (left/right snapping)
    for (let i = 0; i < 24; i++) {
      cc.setOrientation(i % 2 === 0 ? Math.PI : -Math.PI, 0);
      await new Promise((r) => requestAnimationFrame(r));
      sample('yaw-alternate', i % 2 === 0 ? 180 : -180, 0);
    }

    // W + 180 turn (reported trigger)
    cc.setOrientation(0, 0);
    keys.forward = true;
    for (let i = 0; i <= 12; i++) {
      cc.setOrientation((i / 12) * Math.PI, 0);
      await new Promise((r) => requestAnimationFrame(r));
      sample('W+turn', +((i / 12) * Math.PI).toFixed(3), 0);
    }
    keys.forward = false;

    return {
      chain,
      maxPlayerDrift: +maxPlayerDrift.toFixed(6),
      maxCamWorldDrift: +maxCamWorldDrift.toFixed(6),
      maxDesync: +maxDesync.toFixed(6),
      worstDesync,
      sampleCount: samples.length,
      eyeHeight: player.config.eyeHeight,
      samples: samples.slice(0, 6).concat(samples.slice(-4))
    };
  });

  console.log('\n================ CAMERA HIERARCHY (camera up to root) ================');
  for (const n of result.chain) {
    console.log(
      `${n.type.padEnd(12)} name=${n.name.padEnd(18)} parent=${String(n.parentName).padEnd(16)}` +
      `\n   localPos=${JSON.stringify(n.localPos.map((v) => +v.toFixed(4)))}` +
      `\n   worldPos=${JSON.stringify(n.worldPos.map((v) => +v.toFixed(4)))}` +
      `\n   rot=${JSON.stringify(n.rotation.map((v) => +v.toFixed(4)))} scale=${JSON.stringify(n.scale)}`
    );
  }

  console.log('\n============ STATIONARY ROTATION TEST ============');
  console.log('eyeHeight =', result.eyeHeight);
  console.log('samples   =', result.sampleCount);
  console.log('maxPlayerDrift   =', result.maxPlayerDrift);
  console.log('maxCamWorldDrift =', result.maxCamWorldDrift);
  console.log('maxDesync        =', result.maxDesync);
  console.log('\nworst desync:', JSON.stringify(result.worstDesync, null, 2));
  console.log('\nsample rows:');
  for (const s of result.samples) console.log('  ' + JSON.stringify(s));

  await page.screenshot({ path: `${OUT}/camera_desync.png` });
} finally {
  await browser.close();
}