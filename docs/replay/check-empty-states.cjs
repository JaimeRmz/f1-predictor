// node docs/replay/check-empty-states.cjs <scratch-dir>   Checks the Replay tab when the manifest or a race file is missing (never a blank page).
const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../../frontend/node_modules/puppeteer-core'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: path.join(process.argv[2], 'chrome-empty-' + Date.now()), args: ['--no-sandbox', '--disable-gpu'] });
  for (const mode of ['no-manifest', 'no-race-file', 'bad-manifest']) {
    const page = await browser.newPage(); await page.setViewport({ width: 1100, height: 800 });
    await page.setRequestInterception(true);
    page.on('request', r => {
      const u = r.url();
      if (mode === 'no-manifest' && /replay-dev\/manifest\.json/.test(u)) return r.respond({ status: 404, body: 'nope' });
      if (mode === 'bad-manifest' && /replay-dev\/manifest\.json/.test(u)) return r.respond({ status: 200, contentType: 'application/json', body: '{"oops":1}' });
      if (mode === 'no-race-file' && /replay-dev\/\d+\.json\.gz/.test(u)) return r.respond({ status: 404, body: 'nope' });
      if (/^(data:|blob:)/.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u)) r.continue(); else r.abort();
    });
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.sh-nav .sh-link', { timeout: 60000 });
    await page.evaluate(() => [...document.querySelectorAll('.sh-nav .sh-link')].find(b => b.innerText.trim() === 'RACE').click()); await sleep(800);
    await page.evaluate(() => [...document.querySelectorAll('.sub-tab')].find(b => b.innerText === 'REPLAY').click()); await sleep(2500);
    const out = await page.evaluate(() => ({ title: document.querySelector('.hm-title h1')?.innerText, panels: [...document.querySelectorAll('.hm-panel-h h2')].map(e => e.innerText), text: (document.querySelector('.hm .hm-note')?.innerText || '').slice(0, 110), blank: document.querySelector('main').innerText.trim().length < 20, canvas: !!document.querySelector('.rp canvas') }));
    console.log(mode.padEnd(13), JSON.stringify(out), 'page errors:', errs.length);
    await page.close();
  }
  await browser.close();
})();
