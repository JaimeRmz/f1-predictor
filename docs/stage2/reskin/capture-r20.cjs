// node docs/stage2/reskin/capture-r20.cjs <scratch-dir>   (vite :5173, local backend :8000, non-local requests aborted)
// Checks the R20 entry list (no Ocon, no Camara) and that the Camara footnote shows only for R20 on Home and Race.
const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../../../frontend/node_modules/puppeteer-core'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: path.join(process.argv[2], 'chrome-r20-' + Date.now()), args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setRequestInterception(true);
  page.on('request', r => { const u = r.url(); if (/^(data:|blob:)/.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u)) r.continue(); else r.abort(); });
  const state = () => page.evaluate(() => ({
    race: document.querySelector('.hm-title h1').innerText.replace(/\s+/g, ' '),
    rows: (document.querySelector('.hm-more')?.innerText.match(/\d+/) || [])[0] || document.querySelectorAll('.hm-tr:not(.hm-th)').length,
    codes: [...document.querySelectorAll('.hm-tr:not(.hm-th) .hm-drv b')].map(b => b.innerText),
    note: document.querySelector('.hm-foot')?.innerText || null,
  }));
  const pick = async (n) => { await page.evaluate(r => [...document.querySelectorAll('.hm-chip')].find(b => b.querySelector('b').innerText === 'R' + r).click(), n); await sleep(2200); };
  const expand = async () => { await page.evaluate(() => { const b = document.querySelector('.hm-more'); if (b && b.getAttribute('aria-expanded') === 'false') b.click(); }); await sleep(300); };
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.hm-tr:not(.hm-th)', { timeout: 60000 }); await sleep(800); await expand();
  const home20 = await state();
  console.log('HOME R20:', home20.race, '| drivers listed:', home20.codes.length, '| Ocon (OCO) present:', home20.codes.includes('OCO'), '| Camara present:', home20.codes.some(c => /C.M/.test(c)), '| note:', home20.note);
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(__dirname, 'r20-home-1440.png'), clip: { x: 0, y: 0, width: 1440, height: 900 } });
  const el = await page.$('.hm-foot'); if (el) { await el.evaluate(e => e.scrollIntoView({ block: 'center' })); await sleep(300); await page.screenshot({ path: path.join(__dirname, 'r20-home-footnote-1440.png') }); }
  for (const r of [19, 21]) { await pick(r); await expand(); const s = await state(); console.log(`HOME R${r}:`, s.race, '| drivers listed:', s.codes.length, '| note:', s.note); }
  await page.evaluate(() => [...document.querySelectorAll('.sh-nav .sh-link')].find(b => b.innerText.trim() === 'RACE').click());
  await page.waitForSelector('.hm-tr:not(.hm-th)', { timeout: 60000 }); await sleep(1200);
  const race20 = await state();
  console.log('RACE R20:', race20.race, '| drivers listed:', race20.codes.length, '| Ocon present:', race20.codes.includes('OCO'), '| note:', race20.note);
  await pick(21); console.log('RACE R21 note:', (await state()).note);
  await browser.close();
})();
