/**
 * recoder E2E suite — the 8 cases from suites.json, run against the
 * workbench in this repository.
 *
 * Six cases are locally runnable and run unconditionally. Two are not:
 *   - TQA-WEB-106 (on-device server) needs a booted `recoderd`, which does
 *     not exist in this repository (it lives in the separate
 *     recoder-activation tarball).
 *   - TQA-WEB-105 (AI tools) needs a live provider key.
 * Those two are reported as `gated` and never counted as passes.
 *
 * Exit code is 0 only when every runnable case passes.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = path.resolve('workbench');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
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

// In CI, `playwright install chromium` provides the browser and Playwright
// resolves it itself. CHROME_PATH is only for environments that ship a
// browser elsewhere (e.g. this sandbox).
const EXE = process.env.CHROME_PATH;
const browser = await chromium.launch({
  ...(EXE ? { executablePath: EXE } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

const results = [];

async function withPage(fn) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errs.push(`HTTP ${r.status()} ${r.url()}`);
  });
  try {
    await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(900);
    return await fn(page, errs);
  } finally {
    await page.close();
  }
}

function record(id, name, ok, detail) {
  results.push({ id, name, status: ok ? 'pass' : 'fail', detail });
}

/* TQA-WEB-101 — editor workbench: tree, tabs, code, status bar. */
await withPage(async (page, errs) => {
  const s = await page.evaluate(() => ({
    tree: document.querySelectorAll('#tree [data-file]').length,
    tabs: document.querySelectorAll('#tabs [data-tab]').length,
    lines: document.querySelectorAll('#code .ln-row').length,
    lang: document.getElementById('st-lang')?.textContent?.trim(),
    path: document.getElementById('bc-path')?.textContent?.trim(),
  }));
  const ok = s.tree > 0 && s.tabs > 0 && s.lines > 0 && !!s.path && errs.length === 0;
  record('TQA-WEB-101', 'editor workbench', ok, s);
});

/* TQA-WEB-102 — marketplace install. Queries the live Open VSX registry and
   requires real catalogue cards, not a loading hint or an error panel. */
await withPage(async (page, errs) => {
  await page.click('[data-view="marketplace"]');
  await page.waitForFunction(
    () => document.querySelectorAll('#mkt-grid .card').length > 0
       || !!document.querySelector('#mkt-grid .mkt-err'),
    { timeout: 25000 }
  ).catch(() => {});
  const s = await page.evaluate(() => ({
    open: document.getElementById('mkt')?.classList.contains('on') || false,
    cards: document.querySelectorAll('#mkt-grid .card').length,
    count: document.getElementById('mkt-count')?.textContent?.trim(),
    error: !!document.querySelector('#mkt-grid .mkt-err'),
  }));
  const ok = s.open && s.cards > 0 && !s.error && errs.length === 0;
  record('TQA-WEB-102', 'marketplace install', ok, s);
});

/* TQA-WEB-103 — debugger session: F5 pauses on a breakpoint with a stack. */
await withPage(async (page, errs) => {
  await page.keyboard.press('F5');
  await page.waitForTimeout(1400);
  const s = await page.evaluate(() => ({
    state: document.getElementById('dbg-state')?.textContent?.trim(),
    frames: document.querySelectorAll('#dbg .frame').length,
    vars: document.querySelectorAll('#dbg .var').length,
    exec: document.querySelectorAll('#code .ln-row.exec').length,
  }));
  const ok = /paused/.test(s.state || '') && s.frames > 0 && s.vars > 0 && s.exec > 0 && errs.length === 0;
  record('TQA-WEB-103', 'debugger session', ok, s);
});

/* TQA-WEB-108 — debugger play button. DEF-1: the toolbar must be rendered
   at idle so the button the panel's hint refers to actually exists. */
await withPage(async (page, errs) => {
  const s = await page.evaluate(() => {
    const bar = document.getElementById('dbg-bar');
    const btn = document.getElementById('dbg-continue');
    const cs = bar ? getComputedStyle(bar) : null;
    const r = btn ? btn.getBoundingClientRect() : null;
    return {
      visible: !!(cs && cs.display !== 'none'),
      display: cs ? cs.display : 'MISSING',
      btn: r ? `${Math.round(r.width)}x${Math.round(r.height)}` : 'MISSING',
      rendered: !!(r && r.width > 0 && r.height > 0),
      state: document.getElementById('dbg-state')?.textContent?.trim(),
    };
  });
  const ok = s.visible && s.rendered && s.state === 'not started' && errs.length === 0;
  record('TQA-WEB-108', 'debugger play button', ok, s);
});

/* TQA-WEB-104 — GitHub clone. Read path only: the pane must render and the
   clone entry point must exist. A real clone needs a token, so the write
   path is out of scope here. */
await withPage(async (page, errs) => {
  await page.click('[data-view="github"]');
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => ({
    pane: (document.getElementById('gh-pane')?.innerText || '').trim().length,
    clone: !!document.getElementById('gh-clone'),
    signin: !!document.getElementById('gh-signin'),
  }));
  const ok = s.pane > 0 && s.clone && s.signin && errs.length === 0;
  record('TQA-WEB-104', 'github clone (read path)', ok, s);
});

/* TQA-WEB-107 — extensions pane. Same honesty rule as the marketplace:
   the surface must open; an empty list is reported, not passed off. */
await withPage(async (page, errs) => {
  await page.click('[data-view="extensions"]');
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => ({
    list: document.querySelectorAll('#ext-list > *').length,
    filter: !!document.getElementById('ext-filter'),
  }));
  const ok = s.filter && s.list > 0 && errs.length === 0;
  record('TQA-WEB-107', 'extensions pane', ok,
    { ...s, note: s.list === 0 ? 'extensions surface opens but no host list is rendered in this build' : undefined });
});

/* Gated — cannot run from this repository. */
results.push({
  id: 'TQA-WEB-106', name: 'on-device server', status: 'gated',
  detail: { reason: 'recoderd is not in this repository; it lives in the separate recoder-activation tarball' }
});
results.push({
  id: 'TQA-WEB-105', name: 'AI tools', status: 'gated',
  detail: { reason: 'no AI provider key is available in CI' }
});

await browser.close();
server.close();

const runnable = results.filter((r) => r.status !== 'gated');
const failed = runnable.filter((r) => r.status === 'fail');
const passed = runnable.filter((r) => r.status === 'pass');

console.log('\nrecoder E2E suite\n' + '='.repeat(60));
for (const r of results) {
  const mark = r.status === 'pass' ? 'PASS ' : r.status === 'fail' ? 'FAIL ' : 'GATED';
  console.log(`${mark}  ${r.id}  ${r.name}`);
  if (r.status !== 'pass') console.log(`       ${JSON.stringify(r.detail)}`);
}
console.log('='.repeat(60));
console.log(`${passed.length} passed, ${failed.length} failed, ${results.length - runnable.length} gated`);

const summary = {
  schema: 1, suite: 'p0', generatedAt: new Date().toISOString(),
  baseUrl: 'workbench/ (repository)', complete: true,
  allPass: failed.length === 0, cases: results
};
fs.mkdirSync('qa/out', { recursive: true });
fs.writeFileSync('qa/out/attestation.json', JSON.stringify(summary, null, 2));
console.log('attestation -> qa/out/attestation.json');

process.exit(failed.length === 0 ? 0 : 1);
