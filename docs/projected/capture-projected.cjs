// node docs/projected/capture-projected.cjs <scratch-dir>
// Drives the Projected race mode in a real browser (vite dev server :5173, circuit packs in frontend/public/replay-dev/, the LOCAL backend
// :8000 for model scores; every other non-local request is blocked). Checks the default "typical race" seed, the legend, the TIME / LAP
// slider layout and that nothing autoplays, then screenshots Brazil and Las Vegas at lap ~22.
const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../../frontend/node_modules/puppeteer-core'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: path.join(process.argv[2], 'chrome-projected-' + Date.now()), args: ['--no-sandbox', '--disable-gpu'] });
  const errs = [];
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setRequestInterception(true);
  page.on('request', r => { const u = r.url(); if (/^(data:|blob:)/.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u)) r.continue(); else r.abort(); });
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|supabase|net::/.test(m.text())) errs.push(m.text()); });
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.hm-tr:not(.hm-th)', { timeout: 60000 });
  await page.evaluate(() => [...document.querySelectorAll('.sh-nav .sh-link')].find(b => b.innerText.trim() === 'RACE').click()); await sleep(800);
  await page.evaluate(() => [...document.querySelectorAll('.sub-tab')].find(b => b.innerText === 'REPLAY').click());
  await page.waitForSelector('.hm-chip', { timeout: 30000 }); await sleep(600);
  const seekLap = async (lap) => { await page.evaluate(l => { const el = document.querySelector('input[aria-label="Jump to lap"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, String(l)); el.dispatchEvent(new Event('input', { bubbles: true })); }, lap); await sleep(500); };
  for (const [re, name] of [[/R20 · PROJECTED/, 'brazil'], [/R21 · PROJECTED/, 'las-vegas']]) {
    await page.evaluate(src => [...document.querySelectorAll('.hm-chip')].find(b => new RegExp(src).test(b.innerText)).click(), re.source);
    await page.waitForSelector('.pr-notice', { timeout: 120000 }); await page.waitForSelector('.rp canvas', { timeout: 30000 }); await sleep(1200);
    const i = await page.evaluate(() => ({
      seed: document.querySelector('.pr-seed').innerText.replace(/\s+/g, ' '), play: document.querySelector('.rp-play').innerText, legend: document.querySelector('.rp-legend').innerText.replace(/\s+/g, ' '),
      sliders: [...document.querySelectorAll('.rp-range')].map(l => { const s = l.querySelector('span').getBoundingClientRect(), n = l.querySelector('input').getBoundingClientRect(); return { label: l.querySelector('span').innerText, sameRow: Math.abs((s.y + s.height / 2) - (n.y + n.height / 2)) < 12, labelLeftOfSlider: s.x + s.width <= n.x }; }),
      h1: document.querySelector('h1').innerText.replace(/\s+/g, ' '), order: [...document.querySelectorAll('.rp-board li .rp-code')].map(e => e.innerText).join(' '),
    }));
    console.log(name, JSON.stringify(i));
    await seekLap(22); await page.evaluate(() => document.querySelectorAll('.rp-sp')[1].click());
    await page.evaluate(() => document.querySelector('.rp-play').click()); await sleep(2000); await page.evaluate(() => document.querySelector('.rp-play').click());
    await page.setViewport({ width: 1440, height: 900 }); const h = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewport({ width: 1440, height: Math.min(h, 3000) }); await sleep(500);
    await page.screenshot({ path: path.join(__dirname, `projected-${name}-1440.png`) }); await page.setViewport({ width: 1440, height: 900 });
  }
  console.log('page errors:', errs.length ? errs : 'none');
  await browser.close();
})();
