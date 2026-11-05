// node docs/stage2/reskin/capture-champ.cjs <scratch-dir>   (vite on :5173, backend local on :8000; non-local requests aborted)
const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../../../frontend/node_modules/puppeteer-core'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: path.join(process.argv[2], 'chrome-champ-' + Date.now()), args: ['--no-sandbox', '--disable-gpu'] });
  const errs = [];
  for (const [tag, w, mobile] of [['1440', 1440, false], ['390', 390, true]]) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1, hasTouch: mobile, isMobile: false });
    await page.setRequestInterception(true);
    page.on('request', r => { const u = r.url(); if (/^(data:|blob:)/.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u)) r.continue(); else r.abort(); });
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|supabase|net::/.test(m.text())) errs.push(m.text()); });
    const tall = async (name) => {
      await page.setViewport({ width: w, height: 900, hasTouch: mobile }); const h = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewport({ width: w, height: Math.min(h, 7000), hasTouch: mobile }); await sleep(500);
      await page.screenshot({ path: path.join(__dirname, name) }); await page.setViewport({ width: w, height: 900, hasTouch: mobile });
    };
    const nav = async (label) => {
      if (mobile) { await page.click('.sh-burger'); await sleep(200); await page.evaluate(l => [...document.querySelectorAll('.sh-menu .sh-item')].find(b => b.innerText === l).click(), label); }
      else await page.evaluate(l => [...document.querySelectorAll('.sh-nav .sh-link')].find(b => b.innerText.trim() === l).click(), label);
      await sleep(900);
    };
    const overflow = async (n) => console.log(`${n} @${tag}: overflow`, await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'px');

    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hm-tr:not(.hm-th)', { timeout: 60000 }); await sleep(600);
    // tap-to-reveal raw score
    const first = '.hm-tr:not(.hm-th) .hm-fig';
    if (mobile) await page.tap(first); else await page.click(first);
    await sleep(200);
    console.log(`@${tag} tap reveal:`, JSON.stringify(await page.evaluate(() => ({ pop: document.querySelector('.hm-figpop')?.innerText, expanded: document.querySelector('.hm-fig[aria-expanded=true]') != null }))));
    await page.keyboard.press('Escape'); await sleep(150);
    console.log(`@${tag} after Escape popover gone:`, await page.evaluate(() => !document.querySelector('.hm-figpop')));
    if (mobile) await page.tap(first); else await page.click(first);
    await sleep(150); await page.mouse.click(5, 450); await sleep(150);
    console.log(`@${tag} outside tap closes:`, await page.evaluate(() => !document.querySelector('.hm-figpop')));
    if (mobile) { await page.tap(first); } else { await page.hover(first); }
    await sleep(200); await page.screenshot({ path: path.join(__dirname, `score-reveal-${tag}.png`) });

    await nav('CHAMPIONSHIP');
    await page.waitForSelector('.ch-tr:not(.ch-th)', { timeout: 60000 }); await sleep(800);
    await overflow('standings'); await tall(`champ-standings-${tag}.png`);
    console.log(`@${tag} standings rows`, await page.evaluate(() => ({ drivers: document.querySelectorAll('[aria-label="Drivers\' standings"] .ch-tr:not(.ch-th)').length, teams: document.querySelectorAll('[aria-label="Constructors\' standings"] .ch-tr:not(.ch-th)').length, tabs: [...document.querySelectorAll('.sub-tab')].map(b => b.innerText) })));

    await page.evaluate(() => [...document.querySelectorAll('.sub-tab')].find(b => b.innerText === 'DRIVERS').click()); await sleep(1500);
    await page.evaluate(() => [...document.querySelectorAll('.dr-item')].find(b => /antonelli/i.test(b.innerText)).click());
    await page.waitForSelector('.hm-tile', { timeout: 60000 }); await sleep(1200);
    await overflow('drivers'); await tall(`champ-drivers-${tag}.png`);
    console.log(`@${tag} driver detail:`, await page.evaluate(() => ({ name: document.querySelector('.dr-name').innerText, tiles: [...document.querySelectorAll('.hm-tile')].map(t => t.innerText.replace(/\s+/g, ' ')) })));

    await page.evaluate(() => [...document.querySelectorAll('.sub-tab')].find(b => b.innerText === '2026 SEASON').click());
    await page.waitForSelector('.se-tr', { timeout: 60000 });
    await page.waitForFunction(() => !document.body.innerText.includes('LOADING ACCURACY DATA'), { timeout: 120000 }).catch(() => {});
    await sleep(1500);
    await overflow('season'); await tall(`champ-season-${tag}.png`);
    console.log(`@${tag} season:`, await page.evaluate(() => ({ rows: document.querySelectorAll('.se-tr').length, first: document.querySelector('.se-tr').innerText.replace(/\s+/g, ' '), accuracyRows: document.querySelectorAll('.accuracy-grid').length })));
    await page.close();
  }
  console.log('errors:', errs.length, errs.slice(0, 5));
  await browser.close();
})();
