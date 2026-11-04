// node docs/stage2/reskin/capture-header.cjs <scratch-dir>   (vite on :5173, backend local on :8000)
// Header proof: viewport screenshots of Home at top / middle / bottom scroll, plus an overlap probe that checks, at each
// scroll position, that the header (not page content) is the topmost element across its whole width.
const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../../../frontend/node_modules/puppeteer-core'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: path.join(process.argv[2], 'chrome-hdr-' + Date.now()), args: ['--no-sandbox', '--disable-gpu'] });
  const errs = [];
  for (const [tag, w, h] of [['1440', 1440, 900], ['390', 390, 844]]) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', r => { const u = r.url(); if (/^(data:|blob:)/.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u)) r.continue(); else r.abort(); });
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|supabase|net::/.test(m.text())) errs.push(m.text()); });
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hm-tr:not(.hm-th)', { timeout: 60000 }); await sleep(1200);
    const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    for (const [name, frac] of [['top', 0], ['mid', 0.5], ['bottom', 1]]) {
      await page.evaluate(y => window.scrollTo(0, y), Math.round(total * frac)); await sleep(500);
      const probe = await page.evaluate(() => {
        const hd = document.querySelector('.sh').getBoundingClientRect();
        let bad = 0; const n = 24;
        for (let i = 0; i < n; i++) {
          const x = 2 + ((innerWidth - 4) * i) / (n - 1);
          for (const y of [hd.top + 4, hd.bottom / 2, hd.bottom - 3]) { const el = document.elementFromPoint(x, y); if (!el || !el.closest('.sh')) bad++; }
        }
        const bg = getComputedStyle(document.querySelector('.sh')).backgroundColor;
        return { top: hd.top, h: Math.round(hd.height), covered_by_other: bad, bg, scrollY: Math.round(scrollY) };
      });
      console.log(tag, name, JSON.stringify(probe));
      await page.screenshot({ path: path.join(__dirname, `header-${tag}-${name}.png`) });
    }
    await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
    if (tag === '1440') {
      await page.click('.sh-more > button'); await sleep(300);
      await page.screenshot({ path: path.join(__dirname, 'header-1440-more.png'), clip: { x: 700, y: 0, width: 740, height: 200 } });
      await page.keyboard.press('Escape');
      // keyboard: focus a chip, arrow right moves focus; arrows scroll the strip
      await page.focus('.hm-chip[aria-pressed=true]'); await page.keyboard.press('ArrowRight');
      console.log('chip focus after ArrowRight:', await page.evaluate(() => document.activeElement.innerText.replace(/\s+/g, ' ')));
      await page.click('.hm-arrow.l'); await sleep(500);
      console.log('scrollbar hidden:', await page.evaluate(() => getComputedStyle(document.querySelector('.hm-strip')).scrollbarWidth));
      // forecast expand
      const before = await page.evaluate(() => document.querySelectorAll('.hm-tr:not(.hm-th)').length);
      await page.click('.hm-more'); await sleep(300);
      const after = await page.evaluate(() => ({ rows: document.querySelectorAll('.hm-tr:not(.hm-th)').length, exp: document.querySelector('.hm-more').getAttribute('aria-expanded'), lt1: [...document.querySelectorAll('.hm-v')].filter(e => e.innerText === '<1%').length }));
      console.log('forecast rows', before, '->', after.rows, 'aria-expanded', after.exp, '"<1%" cells', after.lt1);
      const shares = await page.evaluate(() => { const num = t => parseFloat(t); const rows = [...document.querySelectorAll('.hm-tr:not(.hm-th)')]; return { win: rows.reduce((a, r) => a + (num(r.querySelectorAll('.hm-v')[0].innerText) || 0), 0), pod: rows.reduce((a, r) => a + (num(r.querySelectorAll('.hm-v')[1].innerText) || 0), 0) }; });
      console.log('displayed share sums (whole-% rounding; <1% counted 0):', JSON.stringify(shares));
      // navigation: Race section, Championship section, More -> What-If
      for (const label of ['RACE', 'CHAMPIONSHIP', 'LIVE', 'MODEL', 'HOME']) {
        await page.evaluate(l => [...document.querySelectorAll('.sh-nav .sh-link')].find(b => b.innerText.trim() === l).click(), label); await sleep(900);
        console.log('nav', label, '->', JSON.stringify(await page.evaluate(() => ({ sub: [...document.querySelectorAll('.sub-tab')].map(b => b.innerText), h: (document.querySelector('main h1, main .hud-title') || {}).innerText }))));
      }
      await page.click('.sh-more > button'); await page.evaluate(() => [...document.querySelectorAll('.sh-pop .sh-item')].find(b => b.innerText === 'WHAT-IF').click()); await sleep(900);
      console.log('more -> what-if page loaded:', await page.evaluate(() => /what-if|drag|predict/i.test(document.body.innerText)));
    } else {
      await page.click('.sh-burger'); await sleep(300);
      await page.screenshot({ path: path.join(__dirname, 'header-390-menu.png') });
    }
    await page.close();
  }
  console.log('errors:', errs.length, errs.slice(0, 5));
  await browser.close();
})();
