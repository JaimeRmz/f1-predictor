// node docs/advance-r20/capture-advance.cjs <scratch-dir> [baseUrl]
// Checks the "advance to R20" Home in a real browser: Las Vegas upcoming, the Last race card for Brazil (frozen snapshot vs actual top 3, read from
// Supabase with the public key the site itself uses), the race-over panel (the page clock is moved past Las Vegas start + 3 h), Brazil as a
// completed race with no replay file yet, and a manifest entry whose file 404s. The dev server must use a backend that has the R20 data.
const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../../frontend/node_modules/puppeteer-core'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE = process.argv[3] || 'http://localhost:5174/';
const NOW_FAKE = process.env.FAKE_NOW || '2026-11-22T08:00:00Z';
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: path.join(process.argv[2], 'chrome-adv-' + Date.now()), args: ['--no-sandbox', '--disable-gpu'] });
  const out = f => path.join(__dirname, f);
  const run = async ({ fakeNow, fail1172 }, fn) => {
    const page = await browser.newPage();
    const errs = [], reqs = [];
    await page.setRequestInterception(true);
    page.on('request', r => {
      const u = r.url();
      if (fail1172 && /replay-dev\/1172\.json\.gz/.test(u)) { r.respond({ status: 404, body: 'missing' }); return; }
      if (/^(data:|blob:)/.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u) || /ykpkieabxvipkyyynypr\.supabase\.co/.test(u)) { if (/replay-dev/.test(u)) reqs.push(u.replace(/^https?:\/\/[^/]+/, '')); r.continue(); } else r.abort();
    });
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|net::/.test(m.text())) errs.push(m.text()); });
    if (fakeNow) await page.evaluateOnNewDocument((iso) => {
      const R = Date, off = R.parse(iso) - R.now();
      class D extends R { constructor(...a) { if (a.length === 0) super(R.now() + off); else super(...a); } static now() { return R.now() + off; } }
      // eslint-disable-next-line no-global-assign
      Date = D;
    }, fakeNow);
    await fn(page, errs, reqs);
    await page.close();
  };
  const shot = async (page, name, w, h = 900) => {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 }); await sleep(500);
    const full = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewport({ width: w, height: Math.min(full, 4200), deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 }); await sleep(600);
    await page.screenshot({ path: out(`${name}-${w}.png`) });
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 });
  };
  const load = async (page, w) => { await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 }); await page.goto(BASE, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('.hm-top3, .hm-title', { timeout: 120000 }); await sleep(3500); };
  const chip = (page, re) => page.evaluate(src => { const el = [...document.querySelectorAll('.hm-chip')].find(b => new RegExp(src).test(b.innerText)); el && el.click(); return !!el; }, re.source);
  const text = (page, sel) => page.evaluate(s => document.querySelector(s)?.innerText.replace(/\s+/g, ' ').trim() ?? null, sel);

  for (const w of [1440, 390]) {
    // 1. Las Vegas upcoming (default), first-load requests, Last race card (Brazil)
    await run({}, async (page, errs, reqs) => {
      await load(page, w);
      console.log(`\n== ${w}px  Home, default race ==`);
      console.log(' kicker:', await text(page, '.hm-eyebrow'), '| title:', await text(page, '.hm-title h1'));
      console.log(' countdown:', await text(page, '.hm-count'));
      console.log(' sim chip/notice:', await text(page, '.rs-cap'), '| board title:', await text(page, '.rs .rp-board h2'));
      console.log(' selected pill:', await page.evaluate(() => document.querySelector('.hm-chip[aria-pressed="true"]')?.innerText.replace(/\s+/g, ' ')));
      console.log(' replay-dev requests on first load:', reqs.join(', '), '| .json.gz or stints:', reqs.some(u => /\.json\.gz|stints-/.test(u)) ? 'YES (BAD)' : 'none');
      console.log(' sessions:', await page.evaluate(() => [...document.querySelectorAll('.hm-sched li')].map(l => l.innerText.replace(/\s+/g, ' ')).join(' / ') || document.querySelector('.hm-side')?.innerText.slice(-80)));
      console.log(' reliability panel:', await page.evaluate(() => { const p = [...document.querySelectorAll('.hm-panel')].find(x => /How reliable/i.test(x.querySelector('h2')?.innerText || '')); return p ? p.innerText.replace(/\s+/g, ' ') : 'NOT FOUND'; }));
      await shot(page, 'home-las-vegas', w);
      const card = await page.evaluateHandle(() => [...document.querySelectorAll('.hm-panel')].find(p => /model vs result/i.test(p.querySelector('h2')?.innerText || '')));
      console.log(' last race card:', await page.evaluate(el => el ? el.innerText.replace(/\s+/g, ' ') : 'NOT FOUND', card));
      const el = card.asElement(); if (el) { await el.evaluate(e => e.scrollIntoView({ block: 'center' })); await sleep(400); await el.screenshot({ path: out(`last-race-brazil-${w}.png`) }); }
      console.log(' page errors:', errs.length ? errs : 'none');
    });
    // 2. race-over: the clock is past Las Vegas start + 3 h and the round is still listed as upcoming
    await run({ fakeNow: NOW_FAKE }, async (page, errs) => {
      await load(page, w);
      console.log(`\n== ${w}px  race-over fixture (clock ${NOW_FAKE}) ==`);
      console.log(' kicker:', await text(page, '.hm-eyebrow'), '| countdown card:', await text(page, '.hm-count'));
      console.log(' sim body:', await text(page, '.rs-body'), '| Play button:', await page.evaluate(() => !!document.querySelector('.rs .rp-play')), '| canvas:', await page.evaluate(() => !!document.querySelector('.rs canvas')), '| "PREDICTED STARTING GRID" anywhere in the panel:', await page.evaluate(() => /PREDICTED STARTING GRID/i.test(document.querySelector('.rs')?.innerText || '')));
      console.log(' sim header:', await text(page, '.rs-head'), '| caption:', await text(page, '.rs-cap'));
      await shot(page, 'race-over', w);
      console.log(' page errors:', errs.length ? errs : 'none');
    });
  }
  // 2b. the Model page still shows the regenerated backtest figures
  await run({}, async (page, errs) => {
    await load(page, 1440);
    await page.evaluate(() => [...document.querySelectorAll('.sh-nav .sh-link')].find(b => b.innerText.trim() === 'MODEL').click()); await sleep(2500);
    console.log('\n== Model page ==');
    console.log(' hit table:', await page.evaluate(() => [...document.querySelectorAll('.md-groups .hm-rel > div, .md-groups li, .md-groups > div')].map(e => e.innerText.replace(/\s+/g, ' ')).slice(0, 2).join(' || ')));
    console.log(' prose:', await page.evaluate(() => [...document.querySelectorAll('.hm-note')].map(n => n.innerText.replace(/\s+/g, ' ')).find(t => /names the winner/.test(t))));
    console.log(' page errors:', errs.length ? errs : 'none');
  });
  // 3. Brazil as a completed race with no replay file yet; and a listed race whose file 404s
  await run({}, async (page, errs, reqs) => {
    await load(page, 1440);
    await chip(page, /R20\b/); await sleep(3500);
    console.log('\n== Brazil (R20) selected ==');
    console.log(' kicker:', await text(page, '.hm-eyebrow'), '| sim:', await text(page, '.rs-body'), '| player:', await page.evaluate(() => !!document.querySelector('.rs .rp')), '| caption:', await text(page, '.rs-cap'));
    console.log(' replay-dev requests:', reqs.join(', '));
    await shot(page, 'home-brazil-completed', 1440);
    await chip(page, /R4\b/); await page.waitForSelector('.rs .rp canvas', { timeout: 60000 }); await sleep(2000);
    await page.evaluate(() => document.querySelector('.rs .rp-play').click()); await sleep(3500);
    console.log('\n== Miami with its replay file returning 404 (manifest lists it) ==');
    console.log(' sim after Play:', await text(page, '.rs-body'), '| player:', await page.evaluate(() => !!document.querySelector('.rs .rp')));
    console.log(' page errors:', errs.length ? errs : 'none');
  });
  await run({ fail1172: true }, async (page, errs) => {
    await load(page, 1440);
    await chip(page, /R4\b/); await page.waitForSelector('.rs .rp canvas', { timeout: 60000 }); await sleep(2000);
    await page.evaluate(() => document.querySelector('.rs .rp-play').click()); await sleep(3500);
    console.log('\n== Miami, 1172.json.gz forced to 404 ==');
    console.log(' sim after Play:', await text(page, '.rs-body'), '| player:', await page.evaluate(() => !!document.querySelector('.rs .rp')));
    console.log(' JS errors:', errs.length ? errs : 'none');
  });
  await browser.close();
})();
