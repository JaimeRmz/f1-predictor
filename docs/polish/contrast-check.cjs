// node docs/polish/contrast-check.cjs <scratch-dir>
// WCAG contrast of the muted text on the Home cards, measured from pixels: hide the text, screenshot the card, take the 97th-percentile LIGHTEST background
// pixel (worst case for light text; logos and icons are a few percent of the area so they are excluded), blend the real text colour (70% ink) over it and compute the ratio. Also checks the champion card body text.
const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../../frontend/node_modules/puppeteer-core'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: path.join(process.argv[2], 'chrome-con-' + Date.now()), args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', r => { const u = r.url(); /^(data:|blob:)/.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u) ? r.continue() : r.abort(); });
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.hm-side .hm-panel', { timeout: 120000 }); await sleep(3000);
  const cards = await page.evaluate(() => [...document.querySelectorAll('.hm-panel, .hm-top, .rs-card')].map((el, i) => { el.dataset.cc = i; return { i, name: (el.querySelector('h2')?.innerText || el.className).slice(0, 26) }; }));
  for (const c of cards) {
    const el = await page.$(`[data-cc="${c.i}"]`);
    await el.evaluate(e => { e.scrollIntoView({ block: 'center' }); e.querySelectorAll('*').forEach(n => { n.dataset.oc = n.style.color; n.style.color = 'transparent'; n.style.textShadow = 'none'; }); });
    await sleep(250);
    const b64 = await el.screenshot({ encoding: 'base64' });
    const worst = await page.evaluate(async (data) => { const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode(); const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const g = cv.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, cv.width, cv.height).data; const px = []; for (let k = 0; k < d.length; k += 4 * 5) px.push([d[k] + d[k + 1] + d[k + 2], [d[k], d[k + 1], d[k + 2]]]); px.sort((p, q) => p[0] - q[0]); const best = px[Math.floor(px.length * 0.97)][1]; return best; }, b64);
    await el.evaluate(e => e.querySelectorAll('*').forEach(n => { n.style.color = n.dataset.oc; }));
    const txt = [0, 1, 2].map(i => Math.round(0.70 * 236 + 0.30 * worst[i]));
    console.log(c.name.padEnd(28), '97th pct bg', worst.join(','), '-> muted text 70%:', ratio(txt, worst).toFixed(2) + ':1', ratio(txt, worst) >= 4.5 ? 'AA' : 'BELOW AA', '| ink:', ratio([236, 236, 236], worst).toFixed(1) + ':1');
  }
  await browser.close();
})();
