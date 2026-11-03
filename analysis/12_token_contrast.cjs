/*
 * (analysis/12) Used by the fix/honesty-copy change. See the header comment below.
 * Run with the dev server on :5173 and the backend on :8000:  node analysis/12_token_contrast.cjs <outdir> <label>
 */
/*
 * Measure contrast of the ink-with-alpha text tokens against the ACTUAL rendered pixels behind them.
 * For each leaf text element whose computed colour is rgba(236,236,236,a), hide its text, screenshot its
 * box, read the pixels, and compute the ratio of the (alpha-composited) text colour against the
 * brightest background pixel (worst case) and the mean background. Captures glass blur and gradients.
 * All non-local requests are aborted (Supabase included).
 * usage: node token_contrast.cjs <outdir> <label>
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require(path.join(__dirname, '..', 'frontend', 'node_modules', 'puppeteer-core'));
const OUT = process.argv[2], LABEL = process.argv[3] || 'run';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PAGES = [['Home', 2500], ['Predictor', 5000], ['Next Race', 9000], ['What-If', 9000], ['Championship', 4000],
  ['Drivers', 4000], ['Compare', 4000], ['2026 Season', 9000], ['Model', 2500]];
const PER_ALPHA_PER_PAGE = 35;

const lum = ([r, g, b]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: path.join(OUT, 'chrome-tc-' + Date.now()), args: ['--no-sandbox', '--disable-gpu'] });
  const rows = [];
  for (const [label, wait] of PAGES) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', r => { const u = r.url(); if (/^(data:|blob:)/.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u)) r.continue(); else r.abort(); });
    try { await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 90000 }); } catch (e) { console.log('goto failed for', label, String(e).slice(0, 80)); await page.close(); continue; }
    await sleep(1500);
    if (label !== 'Home') await page.evaluate(l => { [...document.querySelectorAll('.nav-tab')].find(b => b.innerText.toLowerCase().includes(l.toLowerCase())).click(); }, label);
    await sleep(wait);
    // tag candidate leaf text elements by their ink-alpha token
    const cands = await page.evaluate((per) => {
      const out = {}; let id = 0;
      for (const el of document.querySelectorAll('body *')) {
        if (el.children.length) continue;
        const t = (el.textContent || '').trim(); if (!t) continue;
        const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4 || cs.visibility === 'hidden' || cs.display === 'none') continue;
        const m = cs.color.match(/^rgba\(236, 236, 236, ([0-9.]+)\)$/); if (!m) continue;
        const key = m[1]; out[key] = out[key] || [];
        if (out[key].length < per) { el.setAttribute('data-tc', String(id)); out[key].push({ id: id++, text: t.slice(0, 24), op: parseFloat(cs.opacity) }); }
      }
      return out;
    }, PER_ALPHA_PER_PAGE);
    for (const [alpha, list] of Object.entries(cands)) {
      for (const c of list) {
        const info = await page.evaluate(async (id) => {
          const el = document.querySelector(`[data-tc="${id}"]`); el.scrollIntoView({ block: 'center' });
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          const b = el.getBoundingClientRect(); const prev = el.style.color; el.style.color = 'transparent';
          await new Promise(r => requestAnimationFrame(r));
          return { x: b.x, y: b.y, w: b.width, h: b.height, prev };
        }, c.id);
        let px = null;
        try {
          const clip = { x: Math.max(0, info.x), y: Math.max(0, info.y), width: Math.max(2, Math.min(info.w, 400)), height: Math.max(2, Math.min(info.h, 60)) };
          const b64 = await page.screenshot({ clip, encoding: 'base64' });
          px = await page.evaluate(async (b64) => {
            const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
            const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
            const d = cx.getImageData(0, 0, cv.width, cv.height).data; let mr = 0, mg = 0, mb = 0, n = 0; const ls = [];
            for (let i = 0; i < d.length; i += 4) { mr += d[i]; mg += d[i + 1]; mb += d[i + 2]; n++; ls.push([0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2], i]); }
            ls.sort((x, y) => x[0] - y[0]); const k = ls[Math.min(ls.length - 1, Math.floor(0.9 * ls.length))][1]; const best = [d[k], d[k + 1], d[k + 2]];
            return { mean: [mr / n, mg / n, mb / n], bright: best };
          }, b64);
        } catch (e) { /* element off-screen etc. */ }
        await page.evaluate((id, prev) => { const el = document.querySelector(`[data-tc="${id}"]`); el.style.color = prev; }, c.id, info.prev);
        if (!px) continue;
        const a = parseFloat(alpha) * c.op;
        const over = bg => [236 * a + bg[0] * (1 - a), 236 * a + bg[1] * (1 - a), 236 * a + bg[2] * (1 - a)];
        rows.push({ page: label, alpha, extraOpacity: c.op, text: c.text, worst: ratio(over(px.bright), px.bright), mean: ratio(over(px.mean), px.mean), bg: px.bright.map(Math.round) });
      }
    }
    await page.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, `token_contrast_${LABEL}.json`), JSON.stringify(rows, null, 1));
  const byAlpha = {};
  for (const r of rows) (byAlpha[r.alpha] = byAlpha[r.alpha] || []).push(r);
  for (const [a, rs] of Object.entries(byAlpha).sort()) {
    const w = rs.map(r => r.worst).sort((x, y) => x - y), m = rs.map(r => r.mean).sort((x, y) => x - y);
    const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
    const fx = rs.filter(r => r.extraOpacity < 0.99).length;
    console.log(`alpha ${a}: n=${rs.length} | p90-pixel ratio min ${w[0].toFixed(2)} p10 ${q(w, 0.1).toFixed(2)} median ${q(w, 0.5).toFixed(2)} | mean-bg ratio min ${m[0].toFixed(2)} median ${q(m, 0.5).toFixed(2)} | below 4.5 (p90 px): ${w.filter(x => x < 4.5).length}/${rs.length} | with extra opacity<1: ${fx}`);
  }
  // per-page table
  const pages = [...new Set(rows.map(r => r.page))];
  for (const p of pages) { const rs = rows.filter(r => r.page === p); console.log(`  ${p.padEnd(13)} n=${String(rs.length).padStart(3)} min worst ${Math.min(...rs.map(r => r.worst)).toFixed(2)}  below4.5: ${rs.filter(r => r.worst < 4.5).length}`); }
})().catch(e => { console.error('FAILED', e); process.exit(1); });
