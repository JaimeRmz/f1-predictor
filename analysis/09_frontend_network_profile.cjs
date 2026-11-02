#!/usr/bin/env node
/*
 * Count and size the requests each page makes to the LOCAL backend on load.
 * Same safety rule as 08: any non-local request is aborted (Supabase included) and counted.
 * Usage: node analysis/09_frontend_network_profile.cjs <outdir> [chrome.exe]
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require(path.join(__dirname, '..', 'frontend', 'node_modules', 'puppeteer-core'));
const OUT = process.argv[2] || '.';
const CHROME = process.argv[3] || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PAGES = [['Home', 2500], ['Predictor', 5000], ['Next Race', 9000], ['What-If', 9000], ['Championship', 4000],
  ['Drivers', 4000], ['Compare', 4000], ['2026 Season', 12000], ['Model', 2500]];

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: path.join(OUT, 'chrome-net-' + Date.now()), args: ['--no-sandbox', '--disable-gpu'] });
  const res = {};
  for (const [label, wait] of PAGES) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setRequestInterception(true);
    const api = [], blocked = {}; let jsBytes = 0, jsCount = 0;
    page.on('request', r => {
      const u = r.url();
      if (/^(data:|blob:)/.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u)) return r.continue();
      const h = u.split('/')[2]; blocked[h] = (blocked[h] || 0) + 1; r.abort();
    });
    page.on('response', async r => {
      const u = r.url();
      if (u.includes(':8000/')) { let len = 0; try { len = (await r.buffer()).length; } catch {} api.push({ path: u.replace(/^https?:\/\/[^/]+/, '').split('?')[0], status: r.status(), bytes: len }); }
    });
    await page.goto((process.env.BASE_URL || 'http://localhost:5173/'), { waitUntil: 'domcontentloaded' }); await sleep(1500);
    api.length = 0; // count only what this PAGE triggers (health pings on "/" are shared infrastructure)
    if (label !== 'Home') await page.evaluate(l => { [...document.querySelectorAll('.nav-tab')].find(b => b.innerText.toLowerCase().includes(l.toLowerCase())).click(); }, label);
    await sleep(wait);
    const byPath = {};
    for (const a of api) { const k = a.path.replace(/\/\d{4}$/, '/{raceId}').replace(/\/[a-z_]+$/, m => m); byPath[k] = byPath[k] || { n: 0, bytes: 0 }; byPath[k].n++; byPath[k].bytes += a.bytes; }
    res[label] = { requests: api.length, bytes: api.reduce((s, a) => s + a.bytes, 0), byPath, blockedNonLocal: blocked };
    await page.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'network_profile.json'), JSON.stringify(res, null, 1));
  for (const [k, v] of Object.entries(res)) console.log(`${k.padEnd(13)} backend requests: ${String(v.requests).padStart(3)}  ${(v.bytes / 1024).toFixed(1).padStart(7)} kB   ${Object.entries(v.byPath).map(([p, x]) => `${p}x${x.n}`).join(' ')}   | blocked: ${JSON.stringify(v.blockedNonLocal)}`);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
