/**
 * Verify a BUILT workbench tree — not the repo workbench/ source dir. Serves
 * the directory and checks the debugger actually renders at idle, which is
 * the DEF-1 / TQA-WEB-108 condition.
 *
 * Usage:
 *   node qa/verify_v11.mjs <built-dir>
 *   node qa/verify_v11.mjs ../webpages/recoder-editor_v11
 *
 * <built-dir> defaults to $WORKBENCH_BUILD_DIR, then to ./workbench (the
 * source tree, which is also servable). Pass the published tree explicitly
 * when you want to prove what the CDN is serving.
 *
 * Requires playwright-core (test-only, not a package.json dependency):
 *   npm install --no-save --no-package-lock playwright-core@1.65.1
 *   npx --yes playwright@1.65.1 install chromium
 *
 * Selector notes (learned the hard way):
 *   - debugger panel content is written into #dbg (there is no #dbg-panel)
 *   - the marketplace grid only populates after [data-view="marketplace"]
 *     is clicked; it is not rendered on load
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(
  process.argv[2] || process.env.WORKBENCH_BUILD_DIR || 'workbench'
);
if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error(`No index.html in ${ROOT} — pass the built workbench dir as argv[2].`);
  process.exit(2);
}
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json'
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('response', (r) => {
  if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errs.push(`HTTP ${r.status()} ${r.url()}`);
});

await page.goto(base, { waitUntil: 'networkidle' });

// DEF-1: the toolbar must be visible at idle, with a real play button.
const idle = await page.evaluate(() => {
  const bar = document.querySelector('#dbg-bar');
  const btn = document.querySelector('#dbg-continue');
  const r = btn ? btn.getBoundingClientRect() : null;
  return {
    barExists: !!bar,
    display: bar ? getComputedStyle(bar).display : null,
    hasOn: bar ? bar.classList.contains('on') : false,
    btnW: r ? Math.round(r.width) : 0,
    btnH: r ? Math.round(r.height) : 0,
    btnDisabled: btn ? btn.disabled : null,
    panelChars: (document.querySelector('#dbg') || {}).textContent?.trim().length || 0
  };
});

// F5 must start a session and populate the panel.
await page.keyboard.press('F5');
await page.waitForTimeout(1500);
const afterF5 = await page.evaluate(() => {
  const bar = document.querySelector('#dbg-bar');
  const host = document.querySelector('#dbg');
  return {
    hasOn: bar ? bar.classList.contains('on') : false,
    display: bar ? getComputedStyle(bar).display : null,
    state: (document.querySelector('#dbg-state') || {}).textContent || null,
    panelChars: host ? host.textContent.trim().length : 0,
    frames: document.querySelectorAll('#dbg .frame').length,
    vars: document.querySelectorAll('#dbg .var').length,
    bps: document.querySelectorAll('#dbg .bp-item').length
  };
});

// The marketplace pane: must be opened, then must show real cards.
await page.click('[data-view="marketplace"]');
await page.waitForFunction(
  () => document.querySelectorAll('#mkt-grid .card').length > 0
     || !!document.querySelector('#mkt-grid .mkt-err'),
  { timeout: 20000 }
).catch(() => {});
const market = await page.evaluate(() => ({
  cards: document.querySelectorAll('#mkt-grid .card').length,
  count: (document.getElementById('mkt-count') || {}).textContent?.trim() || null,
  error: !!document.querySelector('#mkt-grid .mkt-err')
}));

// The extensions pane.
await page.click('[data-view="extensions"]');
await page.waitForTimeout(600);
const ext = await page.evaluate(() => ({
  rows: document.querySelectorAll('#ext-list > *').length
}));

const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);

fs.mkdirSync('qa/out', { recursive: true });
await page.screenshot({ path: 'qa/out/v11_debugger.png', fullPage: false });

console.log(JSON.stringify({ idle, afterF5, market, ext, overflow, errors: errs }, null, 2));

const ok =
  idle.barExists && idle.display === 'flex' && idle.btnW > 0 && idle.btnH > 0 &&
  afterF5.hasOn && afterF5.panelChars > 0 && afterF5.frames > 0 && afterF5.vars > 0 &&
  market.cards > 0 && !market.error &&
  ext.rows > 0 &&
  overflow <= 0 && errs.length === 0;

console.log(ok ? '\nV11 VERIFY: PASS' : '\nV11 VERIFY: FAIL');
await browser.close();
server.close();
process.exit(ok ? 0 : 1);
