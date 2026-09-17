import puppeteer from 'puppeteer-core';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testEventOrder() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: false,
    args: ['--window-size=900,700']
  });

  const page = await browser.newPage();
  await page.setContent(`
    <!DOCTYPE html>
    <html><body>
    <button id="btn" style="padding: 20px;">CLICK TO LOCK POINTER</button>
    <div id="log" style="font-family: monospace; white-space: pre;"></div>
    <script>
      let state = 'PLAYING';
      const log = (msg) => {
        const line = performance.now().toFixed(2) + 'ms: ' + msg;
        document.getElementById('log').innerText += line + '\\n';
        console.log(line);
      };

      document.addEventListener('pointerlockchange', () => {
        const locked = !!document.pointerLockElement;
        log('EVENT pointerlockchange: locked=' + locked + ', currentState=' + state);
        if (!locked && state === 'PLAYING') {
          log('--> pointerlockchange PAUSING game');
          state = 'PAUSED';
        }
      });

      document.addEventListener('pointerlockerror', (e) => {
        log('EVENT pointerlockerror!');
      });

      document.getElementById('btn').addEventListener('click', () => {
        log('EVENT btn click -> requestPointerLock()');
        document.body.requestPointerLock();
        state = 'PLAYING';
      });

      window.addEventListener('keydown', (e) => {
        log('EVENT keydown: code=' + e.code + ', currentState=' + state);
        if (e.code === 'Escape') {
          if (state === 'PLAYING') {
            log('--> keydown PAUSING game');
            state = 'PAUSED';
          } else if (state === 'PAUSED') {
            log('--> keydown RESUMING game + requestPointerLock');
            state = 'PLAYING';
            try {
              const p = document.body.requestPointerLock();
              if (p && p.catch) {
                p.then(() => log('--> requestPointerLock resolved successfully'))
                 .catch(err => log('--> requestPointerLock rejected: ' + err.name + ': ' + err.message));
              }
            } catch (err) {
              log('--> requestPointerLock sync error: ' + err.message);
            }
          }
        }
      });
    </script>
    </body></html>
  `);

  page.on('console', msg => console.log('BROWSER:', msg.text()));

  // Click to lock
  await page.click('#btn');
  await new Promise(r => setTimeout(r, 600));

  console.log('\n=== USER PRESSES ESCAPE (IN REAL WINDOW) ===');
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 800));

  console.log('\n=== USER PRESSES ESCAPE AGAIN (TO RESUME) ===');
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 800));

  await browser.close();
}

testEventOrder().catch(console.error);
