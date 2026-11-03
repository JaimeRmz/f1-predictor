// node docs/stage2/capture.cjs <profileDir>  (dev server on :5173; blocks every non-local request except Google Fonts)
const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../../frontend/node_modules/puppeteer-core'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SCREENS = ['home', 'race', 'champ', 'live', 'model'];
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: path.join(process.argv[2], 'chrome-cap-' + Date.now()), args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const external = new Set();
  await page.setRequestInterception(true);
  page.on('request', r => { const u = r.url(); if (/^(data:|blob:)/.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u)) r.continue(); else { external.add(u); r.abort(); } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  for (const d of ['a', 'b', 'c']) for (const s of SCREENS) for (const [tag, w, h] of [['desktop', 1280, 900], ['390', 390, 844]]) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    const url = `http://localhost:5173/design-${d}.html?screen=${s}&now=2026-11-03T21:00:00Z&frame=40&state=live`;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 }); await sleep(600);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (ov > 0) console.log(`OVERFLOW ${d}/${s}/${tag}: +${ov}px`);
    await page.screenshot({ path: path.join(__dirname, 'img', `${d}-${s}-${tag}.png`), fullPage: true });
  }
  console.log('external requests attempted (all aborted):', [...external].length, [...external].slice(0, 5));
  console.log('console/page errors:', errs.length, errs.slice(0, 5));
  await browser.close();
})();
