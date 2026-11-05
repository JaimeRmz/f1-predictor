// node docs/stage2/reskin/capture-all.cjs <scratch-dir>   (vite on :5173, backend local on :8000; non-local requests aborted)
// One screenshot per page / sub-tab at 1440 and 390 px -> docs/stage2/reskin/all-<page>-<width>.png, plus overflow and
// console-error checks.
const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../../../frontend/node_modules/puppeteer-core'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: path.join(process.argv[2], 'chrome-all-' + Date.now()), args: ['--no-sandbox', '--disable-gpu'] });
  const errs = [];
  for (const [tag, w, mobile] of [['1440', 1440, false], ['390', 390, true]]) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1, hasTouch: mobile });
    await page.setRequestInterception(true);
    page.on('request', r => { const u = r.url(); if (/^(data:|blob:)/.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u)) r.continue(); else r.abort(); });
    page.on('pageerror', e => errs.push(`${tag}: ${e}`));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|supabase|net::/.test(m.text())) errs.push(`${tag}: ${m.text()}`); });
    const shot = async (name) => {
      await sleep(900);
      await page.setViewport({ width: w, height: 900, hasTouch: mobile });
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await page.setViewport({ width: w, height: Math.min(h, 7000), hasTouch: mobile }); await sleep(500);
      await page.screenshot({ path: path.join(__dirname, `all-${name}-${tag}.png`) });
      await page.setViewport({ width: w, height: 900, hasTouch: mobile });
      console.log(`${name} @${tag}: ${h}px tall, overflow ${ov}px`);
    };
    const nav = async (label) => {
      if (mobile) { await page.click('.sh-burger'); await sleep(200); await page.evaluate(l => [...document.querySelectorAll('.sh-menu .sh-item')].find(b => b.innerText === l).click(), label); }
      else await page.evaluate(l => [...document.querySelectorAll('.sh-nav .sh-link, .sh-pop .sh-item')].find(b => b.innerText.trim() === l).click(), label);
      await sleep(900);
    };
    const more = async (label) => {
      if (mobile) await nav(label);
      else { await page.click('.sh-more > button'); await sleep(200); await page.evaluate(l => [...document.querySelectorAll('.sh-pop .sh-item')].find(b => b.innerText === l).click(), label); await sleep(900); }
    };
    const sub = async (label) => { await page.evaluate(l => [...document.querySelectorAll('.sub-tab')].find(b => b.innerText === l).click(), label); await sleep(1000); };
    const pickRace = async (re) => {
      await page.evaluate(() => document.querySelector('.hm-panel-b button').click()); await sleep(400);
      await page.evaluate(src => [...document.querySelectorAll('.dropdown-option')].find(o => new RegExp(src, 'i').test(o.innerText)).click(), re.source); await sleep(2500);
    };

    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hm-tr:not(.hm-th)', { timeout: 60000 }); await sleep(10500);
    await shot('home');

    await nav('RACE'); await page.waitForSelector('.hm-tr:not(.hm-th)', { timeout: 60000 }); await shot('race');
    await sub('PREDICTOR'); await sleep(800); await shot('predictor-empty');
    await pickRace(/Rd 20 — Brazilian/); await page.waitForSelector('.pr-tr:not(.pr-th)', { timeout: 60000 }); await shot('predictor-upcoming');
    await page.evaluate(() => [...document.querySelectorAll('.pr-explain')][0].click()); await sleep(900); await shot('predictor-explain');
    await sub('CHARTS').catch(() => {}); await page.evaluate(() => [...document.querySelectorAll('.sub-tab')].find(b => b.innerText === 'CHARTS').click()); await sleep(1500); await shot('predictor-charts');
    await pickRace(/2026 — Mexico City/); await page.waitForSelector('.pr-tr:not(.pr-th)', { timeout: 60000 });
    await page.evaluate(() => [...document.querySelectorAll('.sub-tab')].find(b => b.innerText === 'TABLE').click()); await sleep(800); await shot('predictor-replay');

    await nav('CHAMPIONSHIP'); await page.waitForSelector('.ch-tr:not(.ch-th)', { timeout: 60000 }); await shot('champ-standings');
    await sub('DRIVERS'); await sleep(1200);
    await page.evaluate(() => [...document.querySelectorAll('.dr-item')].find(b => /antonelli/i.test(b.innerText)).click()); await page.waitForSelector('.hm-tile', { timeout: 60000 }); await shot('champ-drivers');
    await sub('2026 SEASON'); await page.waitForSelector('.se-tr', { timeout: 60000 });
    await page.waitForFunction(() => !document.body.innerText.includes('LOADING ACCURACY DATA'), { timeout: 120000 }).catch(() => {}); await sleep(1500); await shot('champ-season');

    await nav('LIVE'); await shot('live');
    await nav('MODEL'); await shot('model');
    await more('WHAT-IF'); await page.waitForSelector('.wf-row', { timeout: 60000 }); await sleep(2500); await shot('whatif');
    await more('COMPARE'); await sleep(1200);
    await page.evaluate(() => { const bs = [...document.querySelectorAll('.cp-pick button')]; bs[0].click(); }); await sleep(300);
    await page.evaluate(() => [...document.querySelectorAll('.dropdown-option')].find(o => /antonelli/i.test(o.innerText)).click()); await sleep(300);
    await page.evaluate(() => { const bs = [...document.querySelectorAll('.cp-pick button')]; bs[bs.length - 1].click(); }); await sleep(300);
    await page.evaluate(() => [...document.querySelectorAll('.dropdown-option')].find(o => /russell/i.test(o.innerText)).click()); await sleep(300);
    await shot('compare-empty');
    await page.evaluate(() => [...document.querySelectorAll('.hm-more')].find(b => /COMPARE/.test(b.innerText)).click()); await page.waitForSelector('.cp-tr', { timeout: 60000 }); await shot('compare');
    await page.close();
  }
  console.log('errors:', errs.length, errs.slice(0, 6));
  await browser.close();
})();
