// node docs/stage2/reskin/capture-race.cjs <scratch-dir>   (vite on :5173, backend local on :8000; non-local requests aborted)
const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../../../frontend/node_modules/puppeteer-core'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: path.join(process.argv[2], 'chrome-race-' + Date.now()), args: ['--no-sandbox', '--disable-gpu'] });
  const errs = [];
  for (const [tag, w] of [['1440', 1440], ['390', 390]]) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', r => { const u = r.url(); if (/^(data:|blob:)/.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u)) r.continue(); else r.abort(); });
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|supabase|net::/.test(m.text())) errs.push(m.text()); });
    const tall = async (name) => {
      await page.setViewport({ width: w, height: 900 }); const h = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewport({ width: w, height: Math.min(h, 6000) }); await sleep(400);
      await page.screenshot({ path: path.join(__dirname, name) }); await page.setViewport({ width: w, height: 900 });
    };
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hm-tr:not(.hm-th)', { timeout: 60000 }); await sleep(800);
    if (tag === '1440') {
      const c = await page.evaluate(() => { const el = document.querySelector('.hm-top:first-child .hm-pos'); const bg = getComputedStyle(document.querySelector('.hm-top')).backgroundColor; return { fg: getComputedStyle(el).color, bg, hb: getComputedStyle(document.querySelector('.sh')).backgroundColor }; });
      const rgb = s => s.match(/[\d.]+/g).slice(0, 3).map(Number);
      console.log('P1 label colour', c.fg, 'vs card base (13,20,32):', ratio(rgb(c.fg), [13, 20, 32]).toFixed(2), '| header bg', c.hb);
      await tall('home-1440.png');
      const sums = await page.evaluate(() => { const rows = [...document.querySelectorAll('.hm-tr:not(.hm-th)')]; return rows.length; });
      await page.click('.hm-more'); await sleep(300);
      const t = await page.evaluate(() => { const rows = [...document.querySelectorAll('.hm-tr:not(.hm-th)')]; const n = i => rows.reduce((a, r) => a + (parseInt(r.querySelectorAll('.hm-v')[i].innerText) || 0), 0); return { rows: rows.length, win: n(0), pod: n(1) }; });
      console.log('home table (before expand rows', sums, ') totals after expand:', JSON.stringify(t));
    } else { await tall('home-390.png'); }
    // Race page
    await page.evaluate(() => [...document.querySelectorAll('.sh-nav .sh-link, .sh-burger')].find(b => b.offsetParent && /RACE|Menu/.test(b.innerText + b.getAttribute('aria-label'))).click());
    if (tag === '390') await page.evaluate(() => [...document.querySelectorAll('.sh-menu .sh-item')].find(b => b.innerText === 'RACE').click());
    await page.waitForSelector('.hm-tr:not(.hm-th)', { timeout: 60000 }); await sleep(1200);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const scan = await page.evaluate(() => ({ bad: (document.querySelector('main').innerText.match(/probab\w*|confiden\w*|win prob\w*|odds|\bchance\b/gi) || []), rows: document.querySelectorAll('.hm-tr:not(.hm-th)').length, sub: [...document.querySelectorAll('.sub-tab')].map(b => b.innerText), win: [...document.querySelectorAll('.hm-tr:not(.hm-th)')].reduce((a, r) => a + (parseInt(r.querySelectorAll('.hm-v')[0].innerText) || 0), 0), pod: [...document.querySelectorAll('.hm-tr:not(.hm-th)')].reduce((a, r) => a + (parseInt(r.querySelectorAll('.hm-v')[1].innerText) || 0), 0) }));
    console.log(`race @${tag}: overflow ${ov}px`, JSON.stringify(scan));
    await tall(`race-${tag}.png`);
    if (tag === '1440') {
      for (const r of [19, 21, 20]) {
        await page.evaluate(n => [...document.querySelectorAll('.hm-chip')].find(b => b.querySelector('b').innerText === 'R' + n).click(), r); await sleep(2000);
        console.log('R' + r, JSON.stringify(await page.evaluate(() => ({ h1: document.querySelector('.hm-title h1').innerText.replace(/\s+/g, ' '), eyebrow: document.querySelector('.hm-eyebrow').innerText, forecast: document.querySelector('.hm-panel-h h2').innerText, gridPanel: [...document.querySelectorAll('.hm-side .hm-panel-h h2')].map(e => e.innerText), first: document.querySelector('.hm-tr:not(.hm-th) .hm-drv').innerText.trim(), share: !![...document.querySelectorAll('.hm-more')].find(b => /SHARE PREDICTION/.test(b.innerText)) }))));
        if (r === 19) await tall('race-1440-R19.png');
      }
      // share card renders with shares, not probabilities
      const card = await page.evaluate(() => (document.querySelector('[aria-hidden=true][style*="-9999px"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 220));
      console.log('share card text:', card);
    }
    await page.close();
  }
  console.log('errors:', errs.length, errs.slice(0, 5));
  await browser.close();
})();
