import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';
const executablePath = process.env.CHROME_BIN || ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert(executablePath, 'Set CHROME_BIN to a Chromium executable');
const server = await createServer({server:{host:'127.0.0.1',port:0}}); await server.listen();
const url = server.resolvedUrls.local[0] + 'tests/ui/desktop.html';
const browser = await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const errors = [], missing = []; let checks = 0;
await mkdir('work/ui-checks',{recursive:true});
try {
 const page = await browser.newPage();
 page.on('pageerror', e=>errors.push(e.message));
 page.on('response', r=>{if(r.status()>=400 && new URL(r.url()).origin===new URL(url).origin) missing.push(r.status()+' '+r.url());});
 const click = selector=>page.$eval(selector, element=>element.click());
 const fixture = name=>page.evaluate(name=>[...document.querySelectorAll('#fixture-controls button')].find(b=>b.textContent===name).click(),name);
 for(const width of [1280,800,375]) {
  await page.setViewport({width,height:width===375?812:720}); await page.goto(url); await page.waitForSelector('[data-fixture-ready]');
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.desktopTheme),'dark'); checks++;
  assert.equal(await page.$('.desktop-theme-toggle'),null); checks++;
  await page.type('#catalog-search','zzzz-no-signal'); assert.match(await page.$eval('#showcase-strip',e=>e.textContent),/No signals/i); checks++;
  await click('#catalog-clear'); await page.waitForFunction(()=>document.querySelectorAll('#showcase-strip .strip-item').length===14); assert.equal(await page.$$eval('#showcase-strip .strip-item',e=>e.length),14); checks++;
  const headerClear = await page.evaluate(()=>document.querySelector('.catalog-header').getBoundingClientRect().bottom<=document.querySelector('#showcase-strip').getBoundingClientRect().top);
  assert(headerClear,'Catalog heading overlaps tracks'); checks++;
  await fixture('Leaderboard');
  const palette = await page.$eval('#lb-track-select',e=>({scheme:getComputedStyle(e).colorScheme,option:getComputedStyle(e.options[0]).backgroundColor}));
  assert.equal(palette.scheme,'dark'); assert.notEqual(palette.option,'rgb(255, 255, 255)'); checks++;
  await click('#lb-next'); assert.match(await page.$eval('#lb-page-info',e=>e.textContent),/Page 2/); checks++;
  await click('#lb-find'); assert.equal(await page.$$eval('.online-lb-row.is-you',e=>e.length),1); checks++;
  await fixture('Offline'); assert.equal(await page.$eval('#lb-next',e=>e.disabled),true); await click('#lb-refresh'); assert.match(await page.$eval('#lb-page-info',e=>e.textContent),/runs/); checks++;
  await fixture('Replay'); await page.select('#replay-speed','2'); assert.equal(await page.$eval('#replay-speed',e=>e.value),'2'); checks++;
  await page.focus('#replay-seek'); await page.keyboard.press('ArrowRight'); assert.match(await page.$eval('#replay-time',e=>e.textContent),/00:00.010/); checks++;
  await fixture('Menu'); await click('#tab-btn-armory');
  if(width===1280) {assert(await page.$eval('#panel-armory',e=>e.scrollHeight<=e.clientHeight+2),'Main Armory requires page scrolling'); checks++;}
  await fixture('Armory'); await page.waitForSelector('.armory-modal-screen .armory-preview-stage canvas');
  const preview = await page.$eval('.armory-modal-screen .armory-preview-stage canvas',e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}));
  assert(preview.width>=150 && preview.height>=100,'Preview too small'); checks++;
  if(width===1280) {
   const fit = await page.$eval('.armory-modal-console',e=>e.scrollHeight<=e.clientHeight+2); assert(fit,'Desktop Armory requires page scrolling'); checks++;
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal page overflow'); checks++;
  await page.screenshot({path:`work/ui-checks/armory-${width}.png`});
 }
 assert.deepEqual(errors,[]); assert.deepEqual([...new Set(missing)],[]);
 console.log(`UI regression: ${checks} assertions passed across desktop, tablet and mobile; no missing assets or runtime errors.`);
} finally {await browser.close();await server.close();}
