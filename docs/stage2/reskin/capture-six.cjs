// node docs/stage2/reskin/capture-six.cjs <scratch-dir>   (vite on :5173, backend local on :8000; non-local requests aborted)
// The six representative screenshots kept in the repo: home 1440 / 390, race 1440, championship standings 1440,
// model 1440 and the 390 px menu. (capture-all.cjs regenerates every page and sub-tab.) Output PNGs are then shrunk with
// PIL (palette quantisation) to keep the repo small.
const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../../../frontend/node_modules/puppeteer-core'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: path.join(process.argv[2], 'chrome-six-' + Date.now()), args: ['--no-sandbox', '--disable-gpu'] });
  for (const [tag, w, mobile] of [['1440', 1440, false], ['390', 390, true]]) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1, hasTouch: mobile });
    await page.setRequestInterception(true);
    page.on('request', r => { const u = r.url(); if (/^(data:|blob:)/.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u)) r.continue(); else r.abort(); });
    const shot = async (name, clipTop) => {
      await sleep(900);
      await page.setViewport({ width: w, height: 900, hasTouch: mobile });
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewport({ width: w, height: Math.min(h, 7000), hasTouch: mobile }); await sleep(500);
      await page.screenshot({ path: path.join(__dirname, name) });
      await page.setViewport({ width: w, height: 900, hasTouch: mobile });
    };
    const nav = async (label) => {
      if (mobile) { await page.click('.sh-burger'); await sleep(200); await page.evaluate(l => [...document.querySelectorAll('.sh-menu .sh-item')].find(b => b.innerText === l).click(), label); }
      else await page.evaluate(l => [...document.querySelectorAll('.sh-nav .sh-link')].find(b => b.innerText.trim() === l).click(), label);
      await sleep(900);
    };
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hm-tr:not(.hm-th)', { timeout: 60000 }); await sleep(10500);
    await shot(`all-home-${tag}.png`);
    if (!mobile) {
      await nav('RACE'); await page.waitForSelector('.hm-tr:not(.hm-th)', { timeout: 60000 }); await shot('all-race-1440.png');
      await nav('CHAMPIONSHIP'); await page.waitForSelector('.ch-tr:not(.ch-th)', { timeout: 60000 }); await shot('all-champ-standings-1440.png');
      await nav('MODEL'); await sleep(800); await shot('all-model-1440.png');
    } else {
      await page.evaluate(() => window.scrollTo(0, 0)); await page.click('.sh-burger'); await sleep(400);
      await page.screenshot({ path: path.join(__dirname, 'header-390-menu.png') });
    }
    await page.close();
  }
  await browser.close();
  console.log('done');
})();
