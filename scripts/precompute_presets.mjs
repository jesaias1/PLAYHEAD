import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PRESETS_DIR = path.resolve(process.cwd(), 'public/music/presets');

async function main() {
  console.log('[PRECOMPUTE] Starting Signal Pack preset level generation...');
  if (!fs.existsSync(PRESETS_DIR)) {
    fs.mkdirSync(PRESETS_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security'
    ]
  });

  try {
    const page = await browser.newPage();
    console.log('[PRECOMPUTE] Navigating to dev server at http://localhost:3000...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

    await page.waitForFunction(() => typeof window.PresetGenerator !== 'undefined', { timeout: 15000 });
    console.log('[PRECOMPUTE] Engine online. Generating precomputed level packages for all 14 tracks...');

    // Expose console logs from browser
    page.on('console', msg => {
      const text = msg.text();
      if (text.startsWith('[PRESET')) console.log(text);
    });

    const results = await page.evaluate(async () => {
      return await window.PresetGenerator.generateAllPresets((idx, total, title) => {
        console.log(`[PRESET ${idx}/${total}] Compiled "${title}"`);
      });
    });

    const trackIds = Object.keys(results);
    console.log(`[PRECOMPUTE] Received ${trackIds.length} generated presets. Saving to disk...`);

    for (const id of trackIds) {
      const filePath = path.join(PRESETS_DIR, `${id}.json`);
      fs.writeFileSync(filePath, results[id], 'utf8');
      const sizeKb = (Buffer.byteLength(results[id], 'utf8') / 1024).toFixed(1);
      console.log(`[PRECOMPUTE] Saved ${id}.json (${sizeKb} KB)`);
    }

    console.log('[PRECOMPUTE] SUCCESS: All Signal Pack presets compiled and cached for instant loading!');
  } catch (err) {
    console.error('[PRECOMPUTE] Failed:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
