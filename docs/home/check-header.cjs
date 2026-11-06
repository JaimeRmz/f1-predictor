// node docs/home/check-header.cjs <scratch-dir>
// For Home and Race at 1440 and 390 wide, at several scroll positions: the header must be fully opaque, nothing but the header may be
// painted at any point of its box (elementsFromPoint, pointer-events:none overlays excluded by the browser), and the header must sit at top 0.
const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../../frontend/node_modules/puppeteer-core'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: path.join(process.argv[2], 'chrome-hdr-' + Date.now()), args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', r => { const u = r.url(); /^(data:|blob:)/.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u) ? r.continue() : r.abort(); });
  let bad = 0;
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 });
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hm-top3, .hm-title', { timeout: 120000 }); await sleep(2500);
    for (const view of ['Home', 'Race']) {
      if (view === 'Race') {
        if (w < 500) { await page.evaluate(() => document.querySelector('.sh-burger').click()); await sleep(300); await page.evaluate(() => [...document.querySelectorAll('.sh-menu .sh-item')].find(b => b.innerText.trim() === 'RACE').click()); }
        else await page.evaluate(() => [...document.querySelectorAll('.sh-nav .sh-link')].find(b => b.innerText.trim() === 'RACE').click());
        await sleep(2500);
      }
      const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
        await page.evaluate(y => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, y); }, Math.round(total * frac)); await sleep(350);
        const r = await page.evaluate(() => {
          const hd = document.querySelector('.sh'), b = hd.getBoundingClientRect(), cs = getComputedStyle(hd);
          const foreign = []; for (let x = 2; x < innerWidth; x += Math.max(6, Math.floor(innerWidth / 60))) for (let y = 1; y < b.height; y += 5) { const el = document.elementsFromPoint(x, y)[0]; if (!hd.contains(el)) foreign.push((el && el.className || el && el.tagName) + '@' + x + ',' + y); }
          return { top: b.top, h: Math.round(b.height), bg: cs.backgroundColor, z: cs.zIndex, pos: cs.position, foreign: foreign.slice(0, 4), nForeign: foreign.length };
        });
        const ok = r.top === 0 && r.bg === 'rgb(10, 10, 12)' && r.nForeign === 0;
        if (!ok) bad++;
        console.log(view, w, 'scroll', Math.round(frac * 100) + '%', JSON.stringify(r), ok ? 'OK' : 'FAIL');
      }
    }
  }
  console.log(bad ? `FAILURES: ${bad}` : 'header solid and on top at every checked scroll position');
  await browser.close();
})();
