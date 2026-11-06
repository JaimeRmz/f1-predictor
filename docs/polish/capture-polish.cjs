// node docs/polish/capture-polish.cjs <scratch-dir>
// Screenshots for the polish pass at 390 and 1440: Home (projected, replay), Race, Championship, and a highlighted driver (board row tapped).
// Dev server :5173, local backend :8000, replay files in frontend/public/replay-dev/.
const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../../frontend/node_modules/puppeteer-core'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: path.join(process.argv[2], 'chrome-pol-' + Date.now()), args: ['--no-sandbox', '--disable-gpu'] });
  const errs = [];
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', r => { const u = r.url(); /^(data:|blob:)/.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u) ? r.continue() : r.abort(); });
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|supabase|net::/.test(m.text())) errs.push(m.text()); });
  const out = f => path.join(__dirname, f);
  const full = async (name, w) => {
    await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 }); await sleep(500);
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewport({ width: w, height: Math.min(h, 4200), deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 }); await sleep(600);
    await page.screenshot({ path: out(`${name}-${w}.png`) });
    await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 });
  };
  const nav = async (label, w) => {
    if (w < 500) { await page.evaluate(() => document.querySelector('.sh-burger').click()); await sleep(300); await page.evaluate(l => [...document.querySelectorAll('.sh-menu .sh-item')].find(b => b.innerText.trim() === l).click(), label); }
    else await page.evaluate(l => [...document.querySelectorAll('.sh-nav .sh-link')].find(b => b.innerText.trim() === l).click(), label);
    await sleep(3500);
  };
  const clickChip = re => page.evaluate(src => { const el = [...document.querySelectorAll('.hm-chip')].find(b => new RegExp(src).test(b.innerText)); el && el.click(); }, re.source);
  for (const w of [1440, 390]) {
    const mobile = w < 500;
    await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.rs .rp canvas', { timeout: 120000 }); await sleep(2500);
    // projected: play a few seconds, then tap a board row to highlight a driver
    await page.evaluate(() => [...document.querySelectorAll('.rs .rp-sp')].find(b => b.innerText === '16x').click());
    await page.evaluate(() => document.querySelector('.rs .rp-play').click()); await sleep(7000); await page.evaluate(() => document.querySelector('.rs .rp-play').click()); await sleep(500);
    await full('home-projected', w);
    await page.evaluate(() => document.querySelectorAll('.rs .rp-row-hit')[3].click()); await sleep(600);
    const card = await page.$('.rs-card'); await card.evaluate(e => e.scrollIntoView({ block: 'center' })); await sleep(300);
    await card.screenshot({ path: out(`highlight-${w}.png`) });
    console.log(w, 'highlight: pressed row =', await page.evaluate(() => document.querySelector('.rs .rp-row-hit[aria-pressed="true"]')?.getAttribute('aria-label')));
    await page.evaluate(() => document.querySelectorAll('.rs .rp-row-hit')[3].click()); await sleep(300);
    console.log(w, 'highlight cleared by tapping again:', await page.evaluate(() => !document.querySelector('.rs .rp-row-hit[aria-pressed="true"]')));
    // replay
    await page.evaluate(() => window.scrollTo(0, 0)); await clickChip(/R4\b/); await page.waitForSelector('.rs .rp canvas', { timeout: 60000 }); await sleep(2500);
    await page.evaluate(() => document.querySelector('.rs .rp-play').click());
    await page.waitForFunction(() => document.querySelector('.rs .rp-board h2')?.innerText.includes('OFFICIAL'), { timeout: 60000 }).catch(() => {});
    await page.evaluate(() => [...document.querySelectorAll('.rs .rp-sp')].find(b => b.innerText === '16x')?.click()); await sleep(7000); await page.evaluate(() => document.querySelector('.rs .rp-play').click()); await sleep(500);
    await full('home-replay', w);
    console.log(w, 'forecast rows shown:', await page.evaluate(() => document.querySelectorAll('.hm-main .hm-tr:not(.hm-th)').length), '| show-all button:', await page.evaluate(() => document.querySelector('.hm-more')?.innerText));
    // race + championship
    await nav('RACE', w); await full('race', w);
    await nav('CHAMPIONSHIP', w); await full('championship', w);
  }
  console.log('page errors:', errs.length ? errs : 'none');
  await browser.close();
})();
