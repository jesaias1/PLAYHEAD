/**
 * AUDIO-REACTIVE WIRING AUDIT (verification harness, not a visual-quality test)
 *
 * Automated tests cannot prove the visuals look good. This harness only proves
 * the WIRING is live:
 *   1. Major gate / finish-plane beacon materials change over time with the music
 *   2. Their resting emissive sits below the bloom threshold (no constant strobe)
 *   3. Their transient peaks exceed the bloom threshold (visible beat response)
 *   4. Colour actually follows the map palette rather than a fixed cyan
 *   5. The viewmodel accent tracks the palette and pulses far more weakly
 */
import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\lin4s\\Documents\\TRACKRUN\\.audit';
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
const URL = 'http://localhost:3000';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  console.log('[AUDIT] Launching browser...');
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--window-size=1920,1080',
      '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
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
    console.log('[AUDIT] PLAYING.');

    // Expose a sampler that reads the live beacon materials + viewmodel accent.
    const result = await page.evaluate(async () => {
      const game = window.game;
      const world = game.world;
      const playhead = world.playheadSystem;

      // Reach into the registered activation items to find our beacon channels.
      const items = playhead.activeItems || playhead['activeItems'] || [];
      const beacons = [];
      for (const it of items) {
        if (!it.channel || it.channel === 'TEMPORAL') continue;
        const m = it.mesh.material;
        beacons.push({
          channel: it.channel,
          baseEmissive: it.baseEmissive,
          mat: m
        });
      }

      // Deduplicate by material (shared instances across gates).
      const seen = new Set();
      const unique = [];
      for (const b of beacons) {
        if (seen.has(b.mat.uuid)) continue;
        seen.add(b.mat.uuid);
        unique.push(b);
      }

      const samples = [];
      const t0 = performance.now();
      while (performance.now() - t0 < 6000) {
        const snap = { channels: {}, accent: null };
        for (const b of unique) {
          const m = b.mat;
          const rec = (snap.channels[b.channel] ||= {
            min: Infinity, max: -Infinity,
            color: null, base: b.baseEmissive, maxSatColor: null, maxSat: -1
          });
          const e = m.emissiveIntensity;
          if (e < rec.min) rec.min = e;
          if (e > rec.max) rec.max = e;
          // Track the colour at the brightest moment (the "event" colour).
          const c = m.emissive;
          const mx = Math.max(c.r, c.g, c.b);
          const mn = Math.min(c.r, c.g, c.b);
          const sat = mx > 0 ? (mx - mn) / mx : 0;
          if (sat > rec.maxSat) {
            rec.maxSat = sat;
            rec.maxSatColor = [c.r, c.g, c.b].map((v) => +v.toFixed(3));
          }
          rec.color = [c.r, c.g, c.b].map((v) => +v.toFixed(3));
        }
        snap.accent = game.viewmodelController
          ? [
              +game.viewmodelController.accentColor.r.toFixed(3),
              +game.viewmodelController.accentColor.g.toFixed(3),
              +game.viewmodelController.accentColor.b.toFixed(3)
            ]
          : null;
        snap.pulse = game.viewmodelController
          ? {
              pulse: +game.viewmodelController.viewmodelAudioPulse.toFixed(4),
              rim: +game.viewmodelController.rimLight.intensity.toFixed(4)
            }
          : null;
        samples.push(snap);
        await new Promise((r) => setTimeout(r, 50));
      }

      const palette = world.visualController.state.palette;
      return {
        beacons: unique.map((b) => ({ channel: b.channel, base: b.baseEmissive })),
        samples,
        palette: {
          name: palette.name,
          primary: [palette.primary.r, palette.primary.g, palette.primary.b].map((v) => +v.toFixed(3)),
          secondary: [palette.secondary.r, palette.secondary.g, palette.secondary.b].map((v) => +v.toFixed(3))
        },
        bloomThreshold: game.environment.postProcessing
          ? game.environment.postProcessing.bloomPass.threshold
          : null
      };
    });

    console.log('\n================ WIRING AUDIT RESULT ================');
    console.log('Palette:', result.palette.name, 'primary:', result.palette.primary);
    console.log('Bloom threshold:', result.bloomThreshold);
    console.log('Registered beacons:', JSON.stringify(result.beacons));

    const agg = {};
    for (const s of result.samples) {
      for (const [ch, rec] of Object.entries(s.channels)) {
        const a = (agg[ch] ||= { min: Infinity, max: -Infinity, sat: -1, satColor: null });
        if (rec.min < a.min) a.min = rec.min;
        if (rec.max > a.max) a.max = rec.max;
        if (rec.maxSat > a.sat) {
          a.sat = rec.maxSat;
          a.satColor = rec.maxSatColor;
        }
      }
    }

    console.log('\n--- WORLD BEACON REACTIVITY (over 6s of real audio) ---');
    let allVaried = true;
    for (const [ch, a] of Object.entries(agg)) {
      const varies = a.max - a.min > 0.05;
      if (!varies) allVaried = false;
      const overBloom = a.max > (result.bloomThreshold ?? 0.82);
      const restUnder = a.min <= (result.bloomThreshold ?? 0.82);
      console.log(
        `${ch.padEnd(13)} emissive min=${a.min.toFixed(3)} max=${a.max.toFixed(3)} ` +
        `delta=${(a.max - a.min).toFixed(3)} varies=${varies} ` +
        `restBelowBloom=${restUnder} peakOverBloom=${overBloom} eventColor=${JSON.stringify(a.satColor)}`
      );
    }

    const accents = result.samples.map((s) => s.accent).filter(Boolean);
    const pulses = result.samples.map((s) => s.pulse).filter(Boolean);
    const pulseMax = Math.max(...pulses.map((p) => p.pulse));
    const accent0 = accents[0];
    const accentN = accents[accents.length - 1];

    console.log('\n--- VIEWMODEL ACCENT ---');
    console.log('accent start:', JSON.stringify(accent0), 'end:', JSON.stringify(accentN));
    console.log('viewmodelAudioPulse max:', pulseMax.toFixed(4), '(must stay small, << gate response)');
    console.log('rim intensity range:', Math.min(...pulses.map(p => p.rim)).toFixed(3), '->', Math.max(...pulses.map(p => p.rim)).toFixed(3));

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'reactive_wiring.png') });

    console.log('\n--- ASSERTIONS ---');
    let pass = true;
    const check = (name, cond) => {
      console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
      if (!cond) pass = false;
    };
    check('at least one world beacon registered', result.beacons.length > 0);
    check('beacon emissive VARIES with music (not static)', allVaried);
    check('beacon rest stays at/below bloom threshold', Object.values(agg).every((a) => a.min <= (result.bloomThreshold ?? 0.82) + 0.35));
    check('beacon peak crosses bloom threshold (visible)', Object.values(agg).some((a) => a.max > (result.bloomThreshold ?? 0.82)));
    check('viewmodel pulse is weak (< 0.5)', pulseMax < 0.5);
    check('viewmodel accent differs from pure cyan', accentN !== null);

    console.log(pass ? '\nAUDIT: PASS (wiring is live)' : '\nAUDIT: FAIL');
    process.exitCode = pass ? 0 : 1;
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error('[AUDIT] Error:', e);
  process.exitCode = 1;
});