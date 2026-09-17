import puppeteer from 'puppeteer-core';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: ['--window-size=800,600']
  });
  const page = await browser.newPage();
  await page.setContent(`
    <!DOCTYPE html>
    <html><body>
    <button id="btn" style="padding: 20px;">Click Me</button>
    <div id="log"></div>
    <script>
      const log = (msg) => {
        document.getElementById('log').innerHTML += msg + '<br>';
        console.log(msg);
      };
      document.addEventListener('pointerlockchange', () => {
        log('pointerlockchange: ' + !!document.pointerLockElement);
      });
      document.addEventListener('pointerlockerror', (e) => {
        log('pointerlockerror fired!');
      });
      document.getElementById('btn').addEventListener('click', () => {
        document.body.requestPointerLock();
      });
      window.addEventListener('keydown', (e) => {
        const active = navigator.userActivation ? navigator.userActivation.isActive : 'unknown';
        log('keydown: ' + e.code + ' (isActive: ' + active + ')');
        if (e.code === 'Escape') {
          const res = document.body.requestPointerLock();
          if (res && res.catch) {
            res.then(() => log('Escape lock success')).catch(err => log('Escape catch: ' + err.message));
          }
        }
      });
    </script>
    </body></html>
  `);

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  await page.click('#btn');
  await new Promise(r => setTimeout(r, 500));
  console.log('--- 1. After click ---');

  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 500));
  console.log('--- 2. After 1st Escape ---');

  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 500));
  console.log('--- 3. After 2nd Escape ---');

  await browser.close();
}

main();
