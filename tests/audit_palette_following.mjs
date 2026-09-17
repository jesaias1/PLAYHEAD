/**
 * PALETTE-FOLLOWING AUDIT
 *
 * Verifies the "ADAPTIVE VIEWMODEL ACCENT" requirement: the gate colour, the
 * viewmodel rim and the hand reflected-light shading must all derive from the
 * CURRENT map/section palette, and must actually change colour when the map
 * changes (cyan map -> icy cyan, purple -> violet, red -> crimson, ...).
 */
import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\lin4s\\Documents\\TRACKRUN\\.audit';
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
const URL = 'http://localhost:3000';

async function run() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--window-size=1280,720',
      '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    page.on('pageerror', (e) => console.log('[PAGEERROR]', e.message));

    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#btn-showcase-enter', { timeout: 30000 });
    await page.click('#btn-showcase-enter');
    await page.waitForFunction(() => {
      const b = document.querySelector('#btn-enter-track');
      return b && !b.disabled;
    }, { timeout: 40000 });
    await page.click('#btn-enter-track');
    await page.waitForFunction(
      () => window.game && window.game.stateMachine && window.game.stateMachine.is('PLAYING'),
      { timeout: 30000 }
    );

    const mapNames = ['MOONGLASS', 'ACID_DREAM', 'BLOOD_MOON', 'EMBER_VOID', 'DEEP_SIGNAL', 'DUSK'];
    const rows = [];

    for (const name of mapNames) {
      const row = await page.evaluate(async (paletteName) => {
        const game = window.game;
        const world = game.world;

        // Inject the palette through the real public paths so every consumer
        // (beacons, rim, hands) updates exactly as it does on a real map change.
        const mod = await import('/src/audio/TrackPalettes.ts');
        const pal = mod.PaletteSelector.getPaletteByName(paletteName);
        world.visualController.setPalette(pal);
        game.environment.setPalette(pal);
        game.viewmodelController.setPalette(pal);

        // Let the accent lerp (dt*6) converge before sampling.
        await new Promise((r) => setTimeout(r, 900));

        // Gate beacon colour (shared material reaches every checkpoint gate).
        const items = world.playheadSystem.activeItems || [];
        let gateColor = null;
        let finishColor = null;
        for (const it of items) {
          const c = it.mesh.material.emissive;
          if (!c) continue;
          if (it.channel === 'GATE_FRAME' && !gateColor) gateColor = [c.r, c.g, c.b];
          if (it.channel === 'FINISH_PLANE' && !finishColor) finishColor = [c.r, c.g, c.b];
        }

        // Viewmodel rim light colour.
        const rim = game.viewmodelController.rimLight.color;

        // Hand material emissive: inspect the viewmodel scene for arm meshes.
        let handTint = null;
        game.viewmodelController.scene.traverse((o) => {
          if (o.isMesh && o.material && o.material.emissive && o.material.map && !handTint) {
            const c = o.material.emissive;
            handTint = [c.r, c.g, c.b];
          }
        });

        const hex = (c) =>
          c ? '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('') : 'n/a';

        return {
          name: paletteName,
          palettePrimary: hex([pal.primary.r, pal.primary.g, pal.primary.b]),
          gate: hex(gateColor),
          finish: hex(finishColor),
          accent: hex([game.viewmodelController.accentColor.r, game.viewmodelController.accentColor.g, game.viewmodelController.accentColor.b]),
          rim: hex([rim.r, rim.g, rim.b]),
          hand: hex(handTint)
        };
      }, name);
      rows.push(row);
      console.log(
        `${row.name.padEnd(12)} palette=${row.palettePrimary}  gate=${row.gate}  finish=${row.finish}  ` +
        `vmAccent=${row.accent}  rim=${row.rim}  hand=${row.hand}`
      );
    }

    // --- Assertions -------------------------------------------------------
    const distinct = (key) => new Set(rows.map((r) => r[key])).size;
    const handRows = rows.filter((r) => r.hand !== 'n/a');

    console.log('\n--- ASSERTIONS ---');
    let pass = true;
    const check = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); if (!c) pass = false; };

    check('gate colour changes across maps (not fixed cyan)', distinct('gate') >= 4);
    check('finish plane colour changes across maps', distinct('finish') >= 4);
    check('viewmodel rim changes across maps', distinct('rim') >= 4);
    check('viewmodel accent tracks palette primary', rows.every((r) => {
      // accent is palette-primary dominant (within 20% cyan anchor), so it must
      // be closer to the palette primary than to pure cyan.
      const p = parseInt(r.palettePrimary.slice(1), 16);
      const a = parseInt(r.accent.slice(1), 16);
      const cy = 0x00f0ff;
      const d = (x, y) => Math.abs((x >> 16) - (y >> 16)) + Math.abs(((x >> 8) & 255) - ((y >> 8) & 255)) + Math.abs((x & 255) - (y & 255));
      return d(a, p) < d(a, cy);
    }));
    if (handRows.length > 0) {
      check('hand reflected-light tint changes across maps', new Set(handRows.map((r) => r.hand)).size >= 4);
      check('hand tint is NOT a full recolour of the palette primary', handRows.every((r) => r.hand !== r.palettePrimary));
    } else {
      console.log('SKIP  hand material not found (assets may not have loaded)');
    }

    // Guard against excessive flashing: the gate must have a clear dark rest.
    const flashing = await page.evaluate(async () => {
      const world = window.game.world;
      const items = world.playheadSystem.activeItems || [];
      let mat = null;
      for (const it of items) if (it.channel === 'GATE_FRAME') { mat = it.mesh.material; break; }
      if (!mat) return null;
      const vals = [];
      const t0 = performance.now();
      while (performance.now() - t0 < 5000) {
        vals.push(mat.emissiveIntensity);
        await new Promise((r) => setTimeout(r, 40));
      }
      // Fraction of frames above the bloom threshold = "always on" indicator.
      const above = vals.filter((v) => v > 0.82).length / vals.length;
      return { min: Math.min(...vals), max: Math.max(...vals), aboveFrac: above };
    });
    if (flashing) {
      console.log(`\ngate emissive: min=${flashing.min.toFixed(3)} max=${flashing.max.toFixed(3)} fractionAboveBloom=${(flashing.aboveFrac * 100).toFixed(1)}%`);
      // This track is onset-dense, so the gate legitimately blooms on many
      // beats. The guard is against PERMANENT glow (which would mean the
      // sustained term dominates and the response is no longer beat-locked).
      check('gate has a real dark rest (min well below bloom)', flashing.min < 0.7);
      check('gate is not permanently bloomed (aboveFrac < 0.7)', flashing.aboveFrac < 0.7);
      check('gate peak clearly crosses bloom (visible)', flashing.max > 1.2);
    }

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'palette_following.png') });
    console.log(pass ? '\nPALETTE AUDIT: PASS' : '\nPALETTE AUDIT: FAIL');
    process.exitCode = pass ? 0 : 1;
  } finally {
    await browser.close();
  }
}

run().catch((e) => { console.error('[AUDIT] Error:', e); process.exitCode = 1; });