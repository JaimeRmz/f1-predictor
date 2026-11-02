#!/usr/bin/env node
/*
 * Measured accessibility / mobile audit of the LOCAL frontend (dev server on :5173,
 * backend on :8000). Drives each page at three viewport widths with headless Chrome.
 *
 * SAFETY: every request that is not localhost, Google Fonts or a data/blob URL is
 * ABORTED, so the app's built-in Supabase client never reaches production. The
 * blocked hosts are counted and reported (they show what the app tries to contact).
 *
 * Checks (all computed from the live DOM, not assumed):
 *   - horizontal overflow of the page and which elements cause it
 *   - rendered text smaller than 11px / 12px
 *   - colour contrast of text against its composited ancestor backgrounds
 *     (APPROXIMATE: gradients and backdrop blur are not modelled; see the doc)
 *   - interactive elements below 24x24 and 44x44 CSS px
 *   - clickable elements that are not keyboard-reachable (cursor:pointer, no tabindex/role)
 *   - interactive elements with no accessible name; images without alt
 *   - heading structure, landmarks, document title, lang
 *
 * Usage: node analysis/08_frontend_a11y_audit.cjs <outdir> [chrome.exe]
 * Requires frontend/node_modules/puppeteer-core (already a devDependency).
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require(path.join(__dirname, '..', 'frontend', 'node_modules', 'puppeteer-core'));

const OUT = process.argv[2] || '.';
const CHROME = process.argv[3] || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:5173/';
const VIEWPORTS = [
  { name: 'mobile-390', width: 390, height: 844, mobile: true },
  { name: 'tablet-768', width: 768, height: 1024, mobile: true },
  { name: 'desktop-1280', width: 1280, height: 900, mobile: false },
];
// nav label -> wait ms for data. My Picks is out of scope for this audit (the product owner is dropping it).
const PAGES = [['Home', 2500], ['Predictor', 5000], ['Next Race', 9000], ['What-If', 9000], ['Championship', 4000],
  ['Drivers', 4000], ['Compare', 4000], ['2026 Season', 9000], ['Model', 2500]];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function pageProbe() {
  const lum = ([r, g, b]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const parse = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const rootBg = (() => { let c = parse(getComputedStyle(document.body).backgroundColor); if (!c || c.a === 0) c = parse(getComputedStyle(document.documentElement).backgroundColor); return (c && c.a > 0) ? { ...c, a: 1 } : { r: 5, g: 5, b: 10, a: 1 }; })();
  const effBg = el => { const chain = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) chain.push(c); } let bg = rootBg; for (let i = chain.length - 1; i >= 0; i--) bg = over(chain[i], bg); return bg; };
  const ratio = (fg, bg) => { const a = lum([fg.r, fg.g, fg.b]), b = lum([bg.r, bg.g, bg.b]); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  const visible = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.05; };
  const desc = el => (el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ' "' + (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 28) + '"');

  const out = {};
  // overflow
  const vw = document.documentElement.clientWidth;
  out.overflow = { scrollWidth: document.documentElement.scrollWidth, clientWidth: vw, hasHorizontalScroll: document.documentElement.scrollWidth > vw + 1 };
  out.overflow.offenders = [...document.querySelectorAll('body *')].filter(e => visible(e) && e.getBoundingClientRect().right > vw + 1)
    .filter(e => !e.closest('.nav-scroll')).slice(0, 5).map(e => desc(e) + ' right=' + Math.round(e.getBoundingClientRect().right));
  // text
  const texts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement; if (!el || !visible(el) || ['SCRIPT', 'STYLE'].includes(el.tagName)) continue;
    const cs = getComputedStyle(el); const fg = parse(cs.color); if (!fg) continue;
    const size = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight) >= 700;
    const bg = effBg(el); const fga = { ...fg, a: fg.a * parseFloat(cs.opacity) }; const fgc = over(fga, bg);
    texts.push({ size, large: size >= 24 || (size >= 18.66 && bold), ratio: ratio(fgc, bg), text: n.nodeValue.trim().slice(0, 30), el: desc(el) });
  }
  out.text = { nodes: texts.length, under11px: texts.filter(t => t.size < 11).length, under12px: texts.filter(t => t.size < 12).length,
    minSize: texts.length ? Math.min(...texts.map(t => t.size)) : null };
  const fail = texts.filter(t => t.ratio < (t.large ? 3 : 4.5));
  out.contrast = { failing: fail.length, of: texts.length, worst: fail.sort((a, b) => a.ratio - b.ratio).slice(0, 5).map(t => `${t.ratio.toFixed(2)}:1 ${t.size}px "${t.text}" in ${t.el}`) };
  // interactive
  const nativeSel = 'button, a[href], input, select, textarea, summary, [role=button], [role=tab], [role=link], [tabindex]:not([tabindex="-1"])';
  const inter = [...document.querySelectorAll(nativeSel)].filter(visible);
  const small24 = inter.filter(e => { const r = e.getBoundingClientRect(); return r.width < 24 || r.height < 24; });
  const small44 = inter.filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; });
  const name = e => (e.getAttribute('aria-label') || e.getAttribute('title') || e.innerText || e.getAttribute('alt') || e.getAttribute('placeholder') || (e.labels && e.labels[0] && e.labels[0].innerText) || '').trim();
  out.interactive = { count: inter.length, below24: small24.length, below44: small44.length, examples44: small44.slice(0, 4).map(e => { const r = e.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)} ${desc(e)}`; }),
    noName: inter.filter(e => !name(e)).length, noNameExamples: inter.filter(e => !name(e)).slice(0, 3).map(desc) };
  const clickNonSemantic = [...document.querySelectorAll('body *')].filter(e => visible(e) && getComputedStyle(e).cursor === 'pointer' &&
    !e.matches(nativeSel) && !e.closest('button, a[href], [role=button], select, label'));
  out.clickableNotKeyboardReachable = { count: clickNonSemantic.length, examples: clickNonSemantic.slice(0, 4).map(desc) };
  out.imagesWithoutAlt = [...document.querySelectorAll('img')].filter(i => !i.hasAttribute('alt')).length;
  // structure
  out.headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map(h => h.tagName + ':' + h.innerText.trim().slice(0, 24));
  out.landmarks = { main: !!document.querySelector('main'), nav: !!document.querySelector('nav'), header: !!document.querySelector('header'), h1Count: document.querySelectorAll('h1').length };
  out.document = { title: document.title, lang: document.documentElement.lang, viewportMeta: (document.querySelector('meta[name=viewport]') || {}).content || null,
    metaDescription: !!document.querySelector('meta[name=description]'), canvasAriaHidden: [...document.querySelectorAll('canvas')].map(c => c.getAttribute('aria-hidden') || c.getAttribute('role') || 'none') };
  return out;
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: path.join(OUT, 'chrome-profile-' + Date.now()), args: ['--no-sandbox', '--disable-gpu'] });
  const results = {}; const blocked = {};
  for (const vp of VIEWPORTS) {
    results[vp.name] = {};
    for (const [label, wait] of PAGES) {
      const page = await browser.newPage();
      await page.setViewport({ width: vp.width, height: vp.height, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 1 });
      const errs = [], failed = [];
      await page.setRequestInterception(true);
      page.on('request', r => {
        const u = r.url();
        if (/^(data:|blob:)/.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u)) return r.continue();
        const host = u.split('/')[2]; blocked[host] = (blocked[host] || 0) + 1; r.abort();
      });
      page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
      page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 140)); });
      page.on('requestfailed', r => { if (/localhost/.test(r.url())) failed.push(r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 60)); });
      await page.goto(BASE, { waitUntil: 'domcontentloaded' }); await sleep(1500);
      if (label !== 'Home') await page.evaluate(l => { [...document.querySelectorAll('.nav-tab')].find(b => b.innerText.toLowerCase().includes(l.toLowerCase())).click(); }, label);
      await sleep(wait);
      const probe = await page.evaluate(pageProbe);
      probe.errors = [...new Set(errs)].slice(0, 4); probe.failedLocalRequests = [...new Set(failed)].slice(0, 4);
      results[vp.name][label] = probe;
      if (vp.name !== 'tablet-768' && ['Home', 'Next Race', 'Championship', '2026 Season'].includes(label))
        await page.screenshot({ path: path.join(OUT, `${vp.name}_${label.replace(/\W+/g, '-')}.png`), fullPage: false });
      await page.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'a11y_audit.json'), JSON.stringify({ results, blockedHosts: blocked }, null, 1));
  console.log('blocked non-local hosts (request counts):', JSON.stringify(blocked));
  for (const vp of Object.keys(results)) {
    console.log('\n=== ' + vp);
    for (const [label, r] of Object.entries(results[vp])) {
      console.log(`${label.padEnd(13)} overflow:${r.overflow.hasHorizontalScroll ? 'YES(' + r.overflow.scrollWidth + '>' + r.overflow.clientWidth + ')' : 'no '} | text<11px:${r.text.under11px}/${r.text.nodes} <12px:${r.text.under12px} min:${r.text.minSize}px | contrast fail:${r.contrast.failing}/${r.contrast.of} | tap<24:${r.interactive.below24} <44:${r.interactive.below44}/${r.interactive.count} | noName:${r.interactive.noName} | clickable-no-kbd:${r.clickableNotKeyboardReachable.count} | h1:${r.landmarks.h1Count} | errs:${r.errors.length}`);
    }
  }
})().catch(e => { console.error('FAILED', e); process.exit(1); });
