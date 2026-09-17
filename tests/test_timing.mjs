import puppeteer from 'puppeteer-core';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testDelays() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: ['--window-size=800,600']
  });
  const page = await browser.newPage();
  await page.setContent(`
    <!DOCTYPE html>
    <html><body>
    <button id="btn">Click</button>
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
        log('POINTERLOCKERROR FIRED');
      });
      window.testRelock = (delayMs) => {
        return new Promise((resolve) => {
          document.body.requestPointerLock();
          setTimeout(() => {
            document.exitPointerLock();
            setTimeout(() => {
              // Now attempt relock
              const promise = document.body.requestPointerLock();
              if (promise && promise.catch) {
                promise.then(() => {
                  log('Delay ' + delayMs + 'ms: lock PROMISE RESOLVED');
                  resolve(true);
                }).catch((err) => {
                  log('Delay ' + delayMs + 'ms: lock PROMISE REJECTED: ' + err.name + ': ' + err.message);
                  resolve(false);
                });
              } else {
                resolve(true);
              }
            }, delayMs);
          }, 100);
        });
      };
    </script>
    </body></html>
  `);

  page.on('console', msg => console.log('PAGE:', msg.text()));

  for (const d of [0, 50, 200, 500, 1000, 1400]) {
    console.log(`\nTesting delay ${d}ms:`);
    const ok = await page.evaluate((delay) => window.testRelock(delay), d);
    await new Promise(r => setTimeout(r, 600));
  }

  await browser.close();
}

testDelays().catch(console.error);
