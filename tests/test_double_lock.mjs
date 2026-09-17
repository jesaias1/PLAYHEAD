import puppeteer from 'puppeteer-core';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testDoubleLock() {
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
      const log = (msg) => console.log(msg);
      document.addEventListener('pointerlockchange', () => {
        log('pointerlockchange: ' + !!document.pointerLockElement);
      });
      document.addEventListener('pointerlockerror', () => {
        log('POINTERLOCKERROR FIRED');
      });
      document.getElementById('btn').addEventListener('click', () => {
        log('Call 1');
        const p1 = document.body.requestPointerLock();
        if (p1 && p1.catch) p1.catch(e => log('p1 error: ' + e.message));

        log('Call 2');
        const p2 = document.body.requestPointerLock();
        if (p2 && p2.catch) p2.catch(e => log('p2 error: ' + e.message));
      });
    </script>
    </body></html>
  `);

  page.on('console', msg => console.log('PAGE:', msg.text()));

  await page.click('#btn');
  await new Promise(r => setTimeout(r, 600));

  const locked = await page.evaluate(() => !!document.pointerLockElement);
  console.log('Result locked:', locked);

  await browser.close();
}

testDoubleLock().catch(console.error);
