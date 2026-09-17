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
        document.body.requestPointerLock().catch(e => log('click lock catch: ' + e.message));
      });
      window.addEventListener('keydown', (e) => {
        const active = navigator.userActivation ? navigator.userActivation.isActive : 'unknown';
        log('keydown: ' + e.code + ' (isActive: ' + active + ')');
        if (e.code === 'KeyP') {
          // Pause and exit lock
          document.exitPointerLock();
        }
        if (e.code === 'Escape') {
          try {
            const res = document.body.requestPointerLock();
            if (res && res.catch) {
              res.then(() => log('Escape lock success')).catch(err => log('Escape catch: ' + err.name + ': ' + err.message));
            }
          } catch (err) {
            log('Escape sync throw: ' + err.name + ': ' + err.message);
          }
        }
      });
    </script>
    </body></html>
  `);

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  // 1. Click to lock
  await page.click('#btn');
  await new Promise(r => setTimeout(r, 200));

  // 2. Press KeyP to unlock (like pause)
  console.log('--- Unlocking pointer lock ---');
  await page.keyboard.press('KeyP');
  await new Promise(r => setTimeout(r, 200));

  // 3. Now press Escape to re-lock
  console.log('--- Pressing Escape to re-lock ---');
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 500));

  const locked = await page.evaluate(() => !!document.pointerLockElement);
  console.log('Final locked state:', locked);

  await browser.close();
}

main();
