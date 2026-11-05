// node docs/stage2/reskin/capture.cjs <scratch-dir>
// Needs: `npx vite` on :5173 and the backend run LOCALLY on :8000. Only localhost and Google Fonts are allowed;
// every other request (including Supabase and f1predictor.app) is aborted and counted.
const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../../../frontend/node_modules/puppeteer-core'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = __dirname;
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: path.join(process.argv[2], 'chrome-reskin-' + Date.now()), args: ['--no-sandbox', '--disable-gpu'] });
  const blocked = new Set(); const errs = [];
  const mk = async (w, h, { offline = false } = {}) => {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', r => {
      const u = r.url();
      if (offline && /localhost:8000/.test(u)) { r.abort(); return; }
      if (/^(data:|blob:)/.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u)) r.continue();
      else { blocked.add(new URL(u).host); r.abort(); }
    });
    page.on('pageerror', e => errs.push('pageerror: ' + e));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|supabase|net::/.test(m.text())) errs.push('console: ' + m.text()); });
    return page;
  };
  const wait = async (page) => { await page.waitForSelector('.hm-tr:not(.hm-th), .hm-panel .hm-note', { timeout: 60000 }).catch(() => {}); await sleep(900); };
  // The site's ambient layers are position:fixed at 100vh, so a fullPage capture dims everything below the first screen.
  // Grow the viewport to the document height instead, so the capture matches what a tall window would show.
  const snap = async (page, name) => {
    const vw = page.viewport().width;
    await page.setViewport({ width: vw, height: 900, deviceScaleFactor: 1 });
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewport({ width: vw, height: Math.min(h, 6000), deviceScaleFactor: 1 }); await sleep(400);
    await page.screenshot({ path: path.join(OUT, name) });
    await page.setViewport({ width: vw, height: 900, deviceScaleFactor: 1 });
  };

  for (const [tag, w, h] of [['1440', 1440, 900], ['390', 390, 844]]) {
    const page = await mk(w, h);
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
    await wait(page);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(`overflow @${tag}: ${ov}px`);
    await sleep(10500); // let the 10 s snapshot lookup settle (Supabase is blocked here, so it ends as 'unavailable')
    await snap(page, `home-${tag}.png`);
    if (tag === '1440') {
      const read = () => page.evaluate(() => ({
        h1: document.querySelector('.hm-title h1')?.innerText.replace(/\s+/g, ' '),
        eyebrow: document.querySelector('.hm-eyebrow')?.innerText,
        top: [...document.querySelectorAll('.hm-top-name')].map(e => e.innerText),
        rows: document.querySelectorAll('.hm-tr:not(.hm-th)').length,
        lastRace: document.querySelector('.hm-side .hm-panel:nth-child(3) h2')?.innerText,
        selected: document.querySelector('.hm-chip[aria-pressed=true]')?.innerText.replace(/\s+/g, ' '),
      }));
      for (const round of [19, 15, 1, 21, 20]) {
        await page.evaluate(r => [...document.querySelectorAll('.hm-chip')].find(b => b.querySelector('b').innerText === 'R' + r).click(), round);
        await sleep(1800); await page.waitForSelector('.hm-tr:not(.hm-th)', { timeout: 60000 }).catch(() => {});
        console.log('R' + round, JSON.stringify(await read()));
        if (round === 15 || round === 19) await snap(page, `home-1440-R${round}.png`);
      }
    }
    await page.close();
  }
  // backend unreachable: must show an explained state, never a blank page
  const off = await mk(1440, 900, { offline: true });
  await off.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await sleep(7000);
  console.log('offline states:', JSON.stringify(await off.evaluate(() => ({ text: [...document.querySelectorAll('.hm-grid *')].map(e => e.innerText || '').join(' ').match(/WAKING|OFFLINE|unreachable|could not be loaded|Waking/gi) }))));
  await snap(off, 'home-offline-1440.png');
  console.log('non-local hosts blocked:', [...blocked]);
  console.log('console/page errors:', errs.length, errs.slice(0, 6));
  await browser.close();
})();
