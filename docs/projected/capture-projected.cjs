// node docs/projected/capture-projected.cjs <scratch-dir>
// Drives the Projected race mode in a real browser: vite dev server on :5173, circuit packs and replay files in frontend/public/replay-dev/,
// the LOCAL backend on :8000 for the model scores. Blocks every other non-local request. Checks the mode loads, the notice and seed are
// shown, "Run another race" changes the seed and the race, nothing autoplays (also with prefers-reduced-motion), the "not available"
// state works, and takes the screenshots kept in docs/projected/.
const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../../frontend/node_modules/puppeteer-core'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: path.join(process.argv[2], 'chrome-projected-' + Date.now()), args: ['--no-sandbox', '--disable-gpu'] });
  const errs = [];
  for (const [tag, w, mobile] of [['1440', 1440, false], ['390', 390, true]]) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1, hasTouch: mobile });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    let blockPacks = false;
    await page.setRequestInterception(true);
    page.on('request', r => {
      const u = r.url();
      if (blockPacks && /packs\.json|pack-/.test(u)) { r.respond({ status: 404, body: 'not found' }); return; }
      if (/^(data:|blob:)/.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u)) r.continue(); else r.abort();
    });
    page.on('pageerror', e => errs.push(`${tag}: ${e}`));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|supabase|net::/.test(m.text())) errs.push(`${tag}: ${m.text()}`); });
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hm-tr:not(.hm-th)', { timeout: 60000 });
    const nav = async (label) => {
      if (mobile) { await page.click('.sh-burger'); await sleep(200); await page.evaluate(l => [...document.querySelectorAll('.sh-menu .sh-item')].find(b => b.innerText.trim() === l).click(), label); }
      else await page.evaluate(l => [...document.querySelectorAll('.sh-nav .sh-link')].find(b => b.innerText.trim() === l).click(), label);
      await sleep(800);
    };
    const tall = async (name) => {
      await page.setViewport({ width: w, height: 900, hasTouch: mobile }); const h = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewport({ width: w, height: Math.min(h, 3000), hasTouch: mobile }); await sleep(500);
      await page.screenshot({ path: path.join(__dirname, name) }); await page.setViewport({ width: w, height: 900, hasTouch: mobile });
    };
    const seekLap = async (lap) => { await page.evaluate(l => { const el = document.querySelector('input[aria-label="Jump to lap"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, String(l)); el.dispatchEvent(new Event('input', { bubbles: true })); }, lap); await sleep(500); };
    const pickChip = async (re) => { await page.evaluate(src => [...document.querySelectorAll('.hm-chip')].find(b => new RegExp(src).test(b.innerText)).click(), re.source); };
    const info = () => page.evaluate(() => ({
      seed: (document.querySelector('.pr-seed b') || {}).innerText, notice: (document.querySelector('.pr-notice') || {}).innerText,
      play: (document.querySelector('.rp-play') || {}).innerText, readout: (document.querySelector('.rp-readout') || {}).innerText?.replace(/\s+/g, ' '),
      order: [...document.querySelectorAll('.rp-board li .rp-code')].map(e => e.innerText).join(' '), h1: document.querySelector('h1').innerText.replace(/\s+/g, ' '),
      eyebrow: document.querySelector('.hm-eyebrow').innerText, pits: [...document.querySelectorAll('.rp-board li.pit')].length,
    }));
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

    await nav('RACE');
    await page.evaluate(() => [...document.querySelectorAll('.sub-tab')].find(b => b.innerText === 'REPLAY').click());
    await page.waitForSelector('.hm-chip', { timeout: 30000 }); await sleep(800);
    const chips = await page.evaluate(() => [...document.querySelectorAll('.hm-chip')].map(b => b.innerText.replace(/\s+/g, ' ')).slice(-5));
    console.log(`@${tag} last chips:`, JSON.stringify(chips));

    await pickChip(/R20 · PROJECTED/);
    const t0 = Date.now();
    await page.waitForSelector('.pr-notice', { timeout: 120000 }); await page.waitForSelector('.rp canvas', { timeout: 30000 });
    console.log(`@${tag} projected race ready after ${Date.now() - t0} ms (includes the local model call)`);
    await sleep(1200);
    const a = await info();
    console.log(`@${tag} title:`, a.h1, '|', a.eyebrow, '| seed', a.seed, '| button', a.play, '| readout', a.readout, '| overflow px', await overflow());
    console.log(`@${tag} notice:`, JSON.stringify(a.notice));
    console.log(`@${tag} start order (predicted grid):`, a.order);
    if (!/no autoplay/.test('')) { await sleep(2500); const b = await info(); console.log(`@${tag} still paused after 2.5 s with prefers-reduced-motion:`, b.play === '▶ PLAY' && b.readout === a.readout); }
    await tall(`projected-brazil-start-${tag}.png`);

    // play a little, then jump to mid race
    await seekLap(24); await page.evaluate(() => document.querySelectorAll('.rp-sp')[1].click());
    await page.evaluate(() => document.querySelector('.rp-play').click()); await sleep(2500); await page.evaluate(() => document.querySelector('.rp-play').click());
    const m = await info();
    console.log(`@${tag} mid race:`, m.readout, '| order', m.order, '| in pit now', m.pits);
    await tall(`projected-brazil-midrace-${tag}.png`);

    // run another race: new seed, new race, timing of the click -> new seed on screen
    const before = (await info());
    const t1 = Date.now();
    await page.evaluate(() => [...document.querySelectorAll('.pr-again')][0].click());
    await page.waitForFunction(s => document.querySelector('.pr-seed b').innerText !== s, { timeout: 30000 }, before.seed);
    await page.waitForSelector('.rp canvas', { timeout: 30000 });
    const after = await info();
    console.log(`@${tag} run another race: seed ${before.seed} -> ${after.seed} in ${Date.now() - t1} ms; paused: ${after.play === '▶ PLAY'}; starts from the same predicted grid: ${a.order === after.order}`);
    await seekLap(70); await sleep(300);
    const e = await info();
    console.log(`@${tag} seed ${after.seed} near the end:`, e.readout, '| order', e.order);

    // not available: pack files missing
    if (!mobile) {
      blockPacks = true;
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('.hm-tr:not(.hm-th)', { timeout: 60000 });
      await nav('RACE'); await page.evaluate(() => [...document.querySelectorAll('.sub-tab')].find(b => b.innerText === 'REPLAY').click());
      await page.waitForSelector('.hm-chip', { timeout: 30000 }); await sleep(500); await pickChip(/R20 · PROJECTED/); await sleep(1500);
      console.log(`@${tag} without pack files:`, JSON.stringify(await page.evaluate(() => document.querySelector('.hm-panel-b, .hm-note')?.innerText.slice(0, 160))));
      await tall(`projected-unavailable-${tag}.png`);
      blockPacks = false;
    }
    await page.close();
  }
  console.log('page errors:', errs.length ? errs : 'none');
  await browser.close();
})();
