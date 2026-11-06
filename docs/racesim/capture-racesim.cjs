// node docs/racesim/capture-racesim.cjs <scratch-dir>
// Drives the Home "Race sim" band and the GAP / INT toggle in a real browser (vite dev server :5173, replay files + circuit packs in
// frontend/public/replay-dev/, the LOCAL backend :8000; every other non-local request is blocked). Prints the network requests the Home page
// makes on first load (no replay .json.gz and no stints file may appear) and the ones made after Play, then writes the screenshots.
const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../../frontend/node_modules/puppeteer-core'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = __dirname;
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: path.join(process.argv[2], 'chrome-racesim-' + Date.now()), args: ['--no-sandbox', '--disable-gpu'] });
  const errs = [], reqs = [];
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    if (/^(data:|blob:)/.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u)) {
      if (/replay-dev|:8000/.test(u)) reqs.push(u.replace(/^https?:\/\/[^/]+/, ''));
      r.continue();
    } else r.abort();
  });
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|supabase|net::/.test(m.text())) errs.push(m.text()); });
  const since = (i) => reqs.slice(i);
  const shot = async (name, w, h = 900) => {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await sleep(400);
    const full = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewport({ width: w, height: Math.min(full, 3200), deviceScaleFactor: 1 }); await sleep(500);
    await page.screenshot({ path: path.join(OUT, name) });
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  };
  const clickText = (sel, re) => page.evaluate((s, src) => { const el = [...document.querySelectorAll(s)].find(b => new RegExp(src).test(b.innerText)); if (!el) return false; el.click(); return true; }, sel, re.source);
  const seekLap = async (lap) => { await page.evaluate(l => { const el = document.querySelector('input[aria-label="Jump to lap"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, String(l)); el.dispatchEvent(new Event('input', { bubbles: true })); }, lap); await sleep(500); };

  // ── Home, first load (upcoming race selected by default)
  await page.setViewport({ width: 1440, height: 900 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.rs .rp canvas', { timeout: 120000 }); await sleep(2500);
  const first = since(0);
  console.log('HOME FIRST LOAD requests (replay-dev + backend):'); first.forEach(u => console.log('   ', u));
  console.log('  replay .json.gz or stints in first load:', first.some(u => /\.json\.gz|stints-/.test(u)) ? 'YES (BAD)' : 'none');
  console.log('  chips:', await page.evaluate(() => [...document.querySelectorAll('.hm-chip')].map(c => c.innerText.replace(/\s+/g, ' ')).join(' | ')));
  console.log('  band:', JSON.stringify(await page.evaluate(() => ({ chip: document.querySelector('.rs-chip')?.innerText, notice: document.querySelector('.rs .pr-notice p')?.innerText, play: document.querySelector('.rs .rp-play')?.innerText, btnH: [...document.querySelectorAll('.rs .rp-btn, .rs .rp-mode-btn')].map(b => Math.round(b.getBoundingClientRect().height)).join(','), boardRows: document.querySelectorAll('.rs .rp-board li').length }))));
  await shot('home-upcoming-1440.png', 1440);

  // ── Home, mobile
  await shot('home-upcoming-390.png', 390, 844);
  await page.setViewport({ width: 1440, height: 900 });

  // ── Home, a completed race: the start grid first (no replay file), then Play
  console.log('click R4:', await clickText('.hm-chip', /R4\b/));
  await page.waitForSelector('.rs .rs-chip.real', { timeout: 60000 }); await sleep(2500);
  console.log('COMPLETED (R4) before Play: chip=', await page.evaluate(() => document.querySelector('.rs-chip')?.innerText), '| board title=', await page.evaluate(() => document.querySelector('.rs .rp-board h2')?.innerText));
  console.log('  1172.json.gz / stints requested before Play:', since(0).some(u => /1172\.json\.gz|stints-/.test(u)) ? 'YES (BAD)' : 'no');
  console.log('  requests since page load:', since(first.length).filter(u => /replay-dev/.test(u)).join(', '));
  const i = reqs.length;
  await page.evaluate(() => document.querySelector('.rs .rp-play').click());
  await page.waitForFunction(() => document.querySelector('.rs .rp-board h2')?.innerText.startsWith('Order'), { timeout: 60000 });
  await sleep(1000);
  console.log('  after Play, new requests:', since(i).filter(u => /replay-dev/.test(u)).join(', '));
  await page.evaluate(() => [...document.querySelectorAll('.rs .rp-sp')].find(b => b.innerText === '16x').click());
  await sleep(9000); await page.evaluate(() => document.querySelector('.rs .rp-play').click());
  console.log('  band after play:', JSON.stringify(await page.evaluate(() => ({ readout: document.querySelector('.rs .rp-readout')?.innerText.replace(/\s+/g, ' '), tyres: [...document.querySelectorAll('.rs .rp-tyre')].map(e => e.innerText).join(''), rows: document.querySelectorAll('.rs .rp-board li').length, full: document.querySelector('.rs-full')?.innerText, credit: document.querySelector('.rs .rp-credit')?.innerText }))));
  await shot('home-completed-replay-1440.png', 1440);

  // ── Home, Monaco 2026 (no replay file)
  console.log('click R6:', await clickText('.hm-chip', /R6\b/)); await sleep(2500);
  console.log('MONACO: note=', await page.evaluate(() => document.querySelector('.rs .rs-note')?.innerText), '| player present:', await page.evaluate(() => !!document.querySelector('.rs .rp')));
  await shot('home-monaco-1440.png', 1440);

  // ── OPEN FULL VIEW from an upcoming race lands on that race's projected page
  console.log('click R20:', await clickText('.hm-chip', /R20\b/)); await page.waitForSelector('.rs .rp canvas', { timeout: 60000 }); await sleep(1500);
  await page.evaluate(() => document.querySelector('.rs .rs-full')?.click()); await sleep(2500);
  console.log('OPEN FULL VIEW lands on:', await page.evaluate(() => document.querySelector('.hm-eyebrow')?.innerText), '|', await page.evaluate(() => document.querySelector('h1')?.innerText));

  // ── Replay page: real replay with tyres + INT, projected with INT
  await page.evaluate(() => { window.scrollTo(0, 0); });
  console.log('click R4 replay chip:', await clickText('.hm-chip', /2026 R4/)); await page.waitForSelector('.rp canvas', { timeout: 60000 }); await sleep(2500);
  await seekLap(30); await page.evaluate(() => [...document.querySelectorAll('.rp-mode-btn')].find(b => b.innerText === 'INT').click()); await sleep(600);
  console.log('REPLAY Miami lap 30 INT:', JSON.stringify(await page.evaluate(() => ({ pressed: [...document.querySelectorAll('.rp-mode-btn')].map(b => b.innerText + ':' + b.getAttribute('aria-pressed')).join(' '), board: [...document.querySelectorAll('.rp-board li')].slice(0, 6).map(l => l.innerText.replace(/\s+/g, ' ')).join(' / '), tyres: [...document.querySelectorAll('.rp-tyre')].length, credit: document.querySelector('.rp-credit')?.innerText }))));
  await shot('replay-real-tyres-interval-1440.png', 1440);
  console.log('click R21 projected chip:', await clickText('.hm-chip', /R21 · PROJECTED/)); await page.waitForSelector('.pr-notice', { timeout: 120000 }); await sleep(1500);
  await seekLap(22);
  console.log('PROJECTED INT persisted:', await page.evaluate(() => [...document.querySelectorAll('.rp-mode-btn')].map(b => b.innerText + ':' + b.getAttribute('aria-pressed')).join(' ')), '| tyres:', await page.evaluate(() => document.querySelectorAll('.rp-tyre').length));
  await shot('replay-projected-interval-1440.png', 1440);
  console.log('page errors:', errs.length ? errs : 'none');
  await browser.close();
})();
