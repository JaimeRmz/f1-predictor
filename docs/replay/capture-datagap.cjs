// node docs/replay/capture-datagap.cjs <scratch-dir>   Hungary 2026 has two whole-feed outages; jump into one and check the DATA GAP indicators.
const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../../frontend/node_modules/puppeteer-core'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: path.join(process.argv[2], 'chrome-gap-' + Date.now()), args: ['--no-sandbox'] });
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', r => { const u = r.url(); if (/^(data:|blob:)/.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u)) r.continue(); else r.abort(); });
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' }); await page.waitForSelector('.sh-nav .sh-link', { timeout: 60000 });
  await page.evaluate(() => [...document.querySelectorAll('.sh-nav .sh-link')].find(b => b.innerText.trim() === 'RACE').click()); await sleep(700);
  await page.evaluate(() => [...document.querySelectorAll('.sub-tab')].find(b => b.innerText === 'REPLAY').click());
  await page.waitForSelector('.rp canvas', { timeout: 30000 });
  await page.evaluate(() => [...document.querySelectorAll('.hm-chip')].find(b => /2026\s*R\d+\s+Hungarian/.test(b.innerText.replace(/\n/g, ' '))).click());
  await sleep(1800);
  const setTime = async (v) => { await page.evaluate(x => { const el = document.querySelector('input[aria-label="Replay time"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, String(x)); el.dispatchEvent(new Event('input', { bubbles: true })); }, v); await sleep(500); };
  const read = () => page.evaluate(() => ({ badge: document.querySelector('.rp-band.GAP')?.innerText || null, noData: document.querySelectorAll('.rp-board li.nodata').length, marks: document.querySelectorAll('.rp-mark.GAP').length, readout: document.querySelector('.rp-readout').innerText.replace(/\s+/g, ' ') }));
  await setTime(3440); console.log('before the outage (t=3440):', JSON.stringify(await read()));
  await setTime(3465); console.log('inside the outage (t=3465):', JSON.stringify(await read()));
  await page.setViewport({ width: 1440, height: 1250 }); await sleep(500);
  await page.screenshot({ path: path.join(__dirname, 'replay-datagap-1440.png') });
  await setTime(3500); console.log('after the outage (t=3500):', JSON.stringify(await read()));
  console.log('errors:', errs.length);
  await browser.close();
})();
