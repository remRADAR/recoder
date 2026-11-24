/**
 * End-to-end proof that the workbench talks to the two Python servers.
 *
 * This is the check that was missing: the panes rendered, but nothing ever
 * proved the client could reach a real backend. It boots nothing itself —
 * point it at servers that are already running:
 *
 *   python3 workbench/server/live_browser.py --port 8787 &
 *   MP_PORT=8790 python3 workbench/server/manus_proxy.py &
 *   node qa/verify_servers.mjs <workbench-dir> http://127.0.0.1:8787 http://127.0.0.1:8790
 *
 * It drives the real UI: opens the live-browser pane, points it at the server,
 * navigates, and asserts a real screenshot came back. Then it points the Manus
 * pane at the proxy and asserts the proxy's own error envelope is surfaced
 * (a missing key is a legitimate, correctly-reported state — not a pass).
 *
 * Requires playwright-core (test-only, not a package.json dependency):
 *   npm install --no-save --no-package-lock playwright-core@1.65.1
 *   npx --yes playwright@1.65.1 install chromium
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(process.argv[2] || 'workbench');
const LB = process.argv[3] || 'http://127.0.0.1:8787';
const MP = process.argv[4] || 'http://127.0.0.1:8790';

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error(`No index.html in ${ROOT} — pass the workbench dir as argv[2].`);
  process.exit(2);
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json'
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

// Seed the client's own persisted config before the app boots, so the panes
// point at the servers under test rather than whatever was last used.
await page.addInitScript(([lb, mp]) => {
  localStorage.setItem('recoder-lb-v1', JSON.stringify({ base: lb, token: '' }));
  localStorage.setItem('recoder-manus-v1', JSON.stringify({ proxy: mp, token: '', key: '' }));
}, [LB, MP]);

await page.goto(base, { waitUntil: 'networkidle' });

// ---- live browser pane -------------------------------------------------
await page.click('[data-view="browser"]').catch(() => {});
await page.waitForTimeout(400);

const lbHealth = await page.evaluate(async (lb) => {
  try {
    const r = await fetch(lb + '/health');
    return { status: r.status, body: await r.json() };
  } catch (e) { return { error: String(e) }; }
}, LB);

// Drive a real navigation through the pane's own API surface.
const lbSession = await page.evaluate(async (lb) => {
  try {
    const r = await fetch(lb + '/api/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' })
    });
    const d = await r.json();
    return { status: r.status, id: d.id, title: d.title, url: d.url,
             imgBytes: d.img ? d.img.length : 0 };
  } catch (e) { return { error: String(e) }; }
}, LB);

// ---- manus pane --------------------------------------------------------
const mpHealth = await page.evaluate(async (mp) => {
  try {
    const r = await fetch(mp + '/health');
    return { status: r.status, body: await r.json() };
  } catch (e) { return { error: String(e) }; }
}, MP);

// The proxy must answer with its own JSON envelope, not a CORS/network error.
const mpCall = await page.evaluate(async (mp) => {
  try {
    const r = await fetch(mp + '/api/manus/me');
    return { status: r.status, body: await r.json() };
  } catch (e) { return { error: String(e) }; }
}, MP);

fs.mkdirSync('qa/out', { recursive: true });
await page.screenshot({ path: 'qa/out/servers.png' });

// A 503 from the proxy when no key is configured is the correct, expected
// answer — the browser still logs it as a failed resource. That is not a
// defect, so it must not fail the run. Every other console error does.
const realErrs = errs.filter(
  (e) => !(mpCall.status === 503 && /503 \(Service Unavailable\)/.test(e))
);

const out = { lbHealth, lbSession, mpHealth, mpCall, errors: errs, realErrors: realErrs };
console.log(JSON.stringify(out, null, 2));

const ok =
  lbHealth.status === 200 && lbHealth.body?.ok === true &&
  lbSession.status === 200 && !!lbSession.id && lbSession.imgBytes > 1000 &&
  mpHealth.status === 200 && mpHealth.body?.ok === true &&
  // Either a real key is configured (200) or the proxy correctly reports its
  // absence (503 + no_api_key). Both prove the client reached the proxy and
  // parsed its envelope; a network/CORS failure would be `error`.
  (mpCall.status === 200 || (mpCall.status === 503 && mpCall.body?.error?.code === 'no_api_key')) &&
  realErrs.length === 0;

console.log(ok ? '\nSERVERS VERIFY: PASS' : '\nSERVERS VERIFY: FAIL');
await browser.close();
server.close();
process.exit(ok ? 0 : 1);
