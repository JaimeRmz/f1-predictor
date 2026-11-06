// node docs/home/capture-home.cjs <scratch-dir>
// Home cleanup check in a real browser (vite dev :5173, local backend :8000, replay files in frontend/public/replay-dev/).
// Screenshots (1440 and 390; upcoming = projected race, completed = real replay; scrolled to the top and halfway) go to docs/home/.
// Also prints: race-sim board height vs track column height before and after Play, horizontal scroll, small tap targets, header wrapping.
const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../../frontend/node_modules/puppeteer-core'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: path.join(process.argv[2], 'chrome-home-' + Date.now()), args: ['--no-sandbox', '--disable-gpu'] });
  const errs = [];
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', r => { const u = r.url(); /^(data:|blob:)/.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u) ? r.continue() : r.abort(); });
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|supabase|net::/.test(m.text())) errs.push(m.text()); });
  const clickChip = (re) => page.evaluate(src => { const el = [...document.querySelectorAll('.hm-chip')].find(b => new RegExp(src).test(b.innerText)); el && el.click(); return !!el; }, re.source);
  const boardVsTrack = () => page.evaluate(() => { const st = document.querySelector('.rs .rp-stage'), bd = document.querySelector('.rs .rp-board'); if (!st || !bd) return null; const a = st.getBoundingClientRect(), b = bd.getBoundingClientRect(); return { stage: Math.round(a.height), board: Math.round(b.height), canvas: Math.round(document.querySelector('.rs canvas').getBoundingClientRect().height), title: document.querySelector('.rs .rp-board h2').innerText, side: a.y === b.y || Math.abs(a.y - b.y) < 2 }; });
  const shots = async (name, w, h) => {
    const full = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 });
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); }); await sleep(400);
    await page.screenshot({ path: path.join(__dirname, `${name}-${w}-top.png`) });
    await page.evaluate(y => window.scrollTo(0, y), Math.round((full - h) / 2)); await sleep(500);
    await page.screenshot({ path: path.join(__dirname, `${name}-${w}-mid.png`) });
    await page.evaluate(() => window.scrollTo(0, 0));
  };
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.rs .rp canvas', { timeout: 120000 }); await sleep(2500);
    console.log(`\n== ${w}px upcoming (projected) ==`);
    console.log(' hscroll:', await page.evaluate(() => document.documentElement.scrollWidth - innerWidth));
    console.log(' kicker:', await page.evaluate(() => document.querySelector('.hm-eyebrow').innerText));
    console.log(' sim header:', await page.evaluate(() => document.querySelector('.rs-head').innerText.replace(/\s+/g, ' ')), '| chip/banner above sim:', await page.evaluate(() => !!document.querySelector('.rs .pr-notice, .rs .rs-chip')));
    console.log(' caption:', await page.evaluate(() => document.querySelector('.rs-cap').innerText));
    console.log(' board vs track BEFORE play:', JSON.stringify(await boardVsTrack()));
    await page.evaluate(() => document.querySelector('.rs .rp-play').click()); await sleep(5000);
    await page.evaluate(() => document.querySelector('.rs .rp-play').click()); await sleep(600);
    console.log(' board vs track AFTER play :', JSON.stringify(await boardVsTrack()));
    console.log(' brand:', await page.evaluate(() => { const l = document.querySelector('.sh-logo').getBoundingClientRect(), hd = document.querySelector('.sh-in').getBoundingClientRect(); return { logoH: Math.round(document.querySelector('.sh-logo img').getBoundingClientRect().height), word: document.querySelector('.sh-word').innerText, headerH: Math.round(document.querySelector('.sh').getBoundingClientRect().height), logoRowFits: l.right <= hd.right }; }));
    console.log(' small tap targets (<44px) in the sim / pills:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.rs button, .rs a, .hm-chip, .hm-more')].filter(b => b.getBoundingClientRect().height < 43.5 && b.getBoundingClientRect().height > 0).map(b => (b.innerText || b.className).slice(0, 14) + ':' + Math.round(b.getBoundingClientRect().height)).slice(0, 8))));
    await shots('home-upcoming', w, h);

    await page.evaluate(() => window.scrollTo(0, 0)); await clickChip(/R4\b/); await page.waitForSelector('.rs .rp canvas', { timeout: 60000 }); await sleep(2500);
    console.log(`\n== ${w}px completed (replay, R4 Miami) ==`);
    console.log(' sim header:', await page.evaluate(() => document.querySelector('.rs-head').innerText.replace(/\s+/g, ' ')), '| caption:', await page.evaluate(() => document.querySelector('.rs-cap').innerText));
    console.log(' board vs track BEFORE play:', JSON.stringify(await boardVsTrack()));
    await page.evaluate(() => document.querySelector('.rs .rp-play').click());
    await page.waitForFunction(() => document.querySelector('.rs .rp-board h2')?.innerText.includes('OFFICIAL'), { timeout: 60000 }).catch(() => {});
    await page.evaluate(() => [...document.querySelectorAll('.rs .rp-sp')].find(b => b.innerText === '16x')?.click()); await sleep(6000);
    await page.evaluate(() => document.querySelector('.rs .rp-play').click()); await sleep(600);
    console.log(' board vs track AFTER play :', JSON.stringify(await boardVsTrack()));
    console.log(' tyres:', await page.evaluate(() => document.querySelectorAll('.rs .rp-tyre').length), '| hscroll:', await page.evaluate(() => document.documentElement.scrollWidth - innerWidth));
    await shots('home-completed', w, h);
    await clickChip(/R6\b/); await sleep(2000);
    console.log(' Monaco:', await page.evaluate(() => document.querySelector('.rs-body').innerText.trim()), '| player:', await page.evaluate(() => !!document.querySelector('.rs .rp')));
  }
  // header never wraps, at awkward widths too
  for (const w of [390, 360, 768, 800, 900, 1024, 1280]) {
    await page.setViewport({ width: w, height: 800, isMobile: w < 500, hasTouch: w < 500 });
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' }); await page.waitForSelector('.sh-in'); await sleep(600);
    console.log('header', w, JSON.stringify(await page.evaluate(() => { const hd = document.querySelector('.sh'), items = [...document.querySelectorAll('.sh-in > *')].filter(e => e.getBoundingClientRect().width > 0); const tops = new Set(items.map(e => Math.round(e.getBoundingClientRect().top))); const l = document.querySelector('.sh-logo').getBoundingClientRect(); return { headerH: Math.round(hd.getBoundingClientRect().height), rows: tops.size, wordVisible: getComputedStyle(document.querySelector('.sh-word')).display !== 'none', overflowX: document.documentElement.scrollWidth - innerWidth, logoW: Math.round(l.width) }; })));
  }
  console.log('\npage errors:', errs.length ? errs : 'none');
  await browser.close();
})();
