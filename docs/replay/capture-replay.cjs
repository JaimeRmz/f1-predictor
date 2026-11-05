// node docs/replay/capture-replay.cjs <scratch-dir>
// Drives the Replay tab in a real browser (vite dev server on :5173 with frontend/public/replay-dev/ filled by build_replay.py).
// Blocks every non-local request. Checks: the tab loads, the canvas draws, keyboard + buttons work, frame rate while playing at 64x,
// and takes the screenshots kept in docs/replay/.
const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../../frontend/node_modules/puppeteer-core'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: path.join(process.argv[2], 'chrome-replay-' + Date.now()), args: ['--no-sandbox', '--disable-gpu'] });
  const errs = [];
  const only = process.argv[3] ? process.argv[3].split(',') : null;
  for (const [tag, w, mobile] of [['1440', 1440, false], ['390', 390, true]]) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1, hasTouch: mobile });
    await page.setRequestInterception(true);
    page.on('request', r => { const u = r.url(); if (/^(data:|blob:)/.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u)) r.continue(); else r.abort(); });
    page.on('pageerror', e => errs.push(`${tag}: ${e}`));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|supabase|net::/.test(m.text())) errs.push(`${tag}: ${m.text()}`); });
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hm-tr:not(.hm-th)', { timeout: 60000 });
    const nav = async (label) => {
      if (mobile) { await page.click('.sh-burger'); await sleep(200); await page.evaluate(l => [...document.querySelectorAll('.sh-menu .sh-item')].find(b => b.innerText === l).click(), label); }
      else await page.evaluate(l => [...document.querySelectorAll('.sh-nav .sh-link')].find(b => b.innerText.trim() === l).click(), label);
      await sleep(800);
    };
    await nav('RACE');
    await page.evaluate(() => [...document.querySelectorAll('.sub-tab')].find(b => b.innerText === 'REPLAY').click());
    await page.waitForSelector('.rp canvas', { timeout: 30000 }); await sleep(1500);
    const tall = async (name) => {
      await page.setViewport({ width: w, height: 900, hasTouch: mobile }); const h = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewport({ width: w, height: Math.min(h, 3000), hasTouch: mobile }); await sleep(500);
      await page.screenshot({ path: path.join(__dirname, name) }); await page.setViewport({ width: w, height: 900, hasTouch: mobile });
    };
    const pickRace = async (re) => { await page.evaluate(src => [...document.querySelectorAll('.hm-chip')].find(b => new RegExp(src).test(b.innerText)).click(), re.source); await page.waitForSelector('.rp canvas', { timeout: 30000 }); await sleep(1200); };
    const seekLap = async (lap) => { await page.evaluate(l => { const el = document.querySelector('input[aria-label="Jump to lap"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, String(l)); el.dispatchEvent(new Event('input', { bubbles: true })); }, lap); await sleep(500); };
    const state = () => page.evaluate(() => ({ readout: document.querySelector('.rp-readout').innerText.replace(/\s+/g, ' '), board: [...document.querySelectorAll('.rp-board li')].slice(0, 5).map(li => li.innerText.replace(/\s+/g, ' ')), outs: document.querySelectorAll('.rp-board li.out').length, pits: document.querySelectorAll('.rp-board li.pit').length }));
    const inked = () => page.evaluate(() => { const c = document.querySelector('.rp canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });

    console.log(`@${tag} replay tab loaded; canvas inked pixels:`, await inked(), '| chips:', await page.evaluate(() => document.querySelectorAll('.hm-chip').length));
    // keyboard + buttons
    await page.focus('.rp'); const t0 = (await state()).readout;
    await page.keyboard.press('Space'); await sleep(1500); const playing = await page.evaluate(() => document.querySelector('.rp-play').innerText);
    await page.keyboard.press('Space'); await sleep(300); const paused = await page.evaluate(() => document.querySelector('.rp-play').innerText);
    console.log(`@${tag} space toggles play/pause:`, JSON.stringify([playing, paused]), '| readout moved:', t0 !== (await state()).readout);
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp'); await sleep(200);
    console.log(`@${tag} speed after ArrowUp:`, await page.evaluate(() => document.querySelector('.rp-sp[aria-pressed="true"]').innerText));
    if (!mobile) {
      // frame-rate probe: 64x playback with every car, 3 s
      await page.evaluate(() => document.querySelectorAll('.rp-sp')[3].click());
      await page.evaluate(() => document.querySelector('.rp-play').click()); await sleep(300);
      const fps = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res({ frames: n, fps: +(n / 3).toFixed(1) }); }; requestAnimationFrame(f); }));
      await page.evaluate(() => document.querySelector('.rp-play').click());
      console.log('@1440 frame rate while playing at 64x:', JSON.stringify(fps));
      await page.evaluate(() => document.querySelectorAll('.rp-sp')[1].click());
    }
    // [chip regex, file name, lap to jump to, extra: seek into the red-flag period]
    const races = [[/2025 R\d+\s+Japanese/, 'japanese', 10, false], [/2026 R\d+\s+Italian/, 'italian', 8, true], [/2026 R\d+\s+Miami/, 'miami', 3, false], [/2025 R\d+\s+Belgian/, 'belgian', 2, false]];
    for (const [re, name, lap, red] of races) {
      await pickRace(re);
      await seekLap(lap);
      if (red) {                                   // Italian 2026: red flag from lap 3 to the restart; jump to the middle of it
        await page.evaluate(() => { const el = document.querySelector('input[aria-label="Replay time"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '1200'); el.dispatchEvent(new Event('input', { bubbles: true })); });
        await sleep(500);
      }
      console.log(`@${tag} ${name}:`, JSON.stringify(await state()), 'inked', await inked(), '| band badge:', await page.evaluate(() => document.querySelector('.rp-band')?.innerText || null));
      if ((tag === '1440' && ['japanese', 'italian', 'miami'].includes(name)) || (tag === '390' && ['japanese', 'belgian'].includes(name))) await tall(`replay-${name}-${tag}.png`);
    }
    // an unavailable race file / manifest is handled: request a race that does not exist by blocking the file
    await page.close();
  }
  console.log('errors:', errs.length, errs.slice(0, 6));
  await browser.close();
})();
