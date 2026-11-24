/*
 * </recode> workbench application shell.
 *
 * This file is intentionally browser-native. It supplies the UI contract used
 * by index.html, model-catalogue.js, radarmatrix.js, live-browser.js, and
 * manus.js without requiring a bundler.
 */
(function (root) {
  'use strict';

  const $ = function (selector, scope) { return (scope || document).querySelector(selector); };
  const $$ = function (selector, scope) { return Array.from((scope || document).querySelectorAll(selector)); };
  const esc = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };
  root.$ = $; root.$$ = $$; root.esc = esc;

  const STORAGE = 'recode-workbench-v1';
  const AI_STORAGE = 'recode-ai-v1';
  const initialFiles = {
    'README.md': '# </recode>\n\nA mobile-first coding workbench.\n\nUse the Manus panel to connect an agent, or configure an AI provider from the AI rail.',
    'src/main.ts': 'export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet("world"));\n',
    'src/radar.ts': 'export const workspace = "radar";\nexport const status = "ready";\n',
    'package.json': '{\n  "name": "recode-project",\n  "private": true,\n  "type": "module",\n  "scripts": {\n    "start": "node src/main.ts"\n  }\n}\n',
    /* The debugger's scripted session runs against this fixture. It is a real
       file in the workspace, so breakpoints, the exec line and the call stack
       all point at lines the user can actually see and edit. */
    'packages/recoderd/src/server.ts': `import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { FsService } from './fs-service';
import { ExtHost } from './ext-host';
import { Marketplace } from './marketplace';
import { FtpServer } from './ftp';

export interface DaemonOptions {
  workspace: string;
  runtime: 'v8' | 'jsc';
  port?: number;
}

/**
 * recoderd — the on-device daemon.
 * Binds an ephemeral loopback port and mints a per-launch bearer token.
 * Nothing here is reachable from outside the device unless the user
 * explicitly opts the FTPS listener into LAN mode.
 */
export class Recoderd {
  private token = randomBytes(32).toString('base64url');
  private port = 0;
  readonly fs: FsService;
  readonly ext: ExtHost;
  readonly market: Marketplace;
  readonly ftp: FtpServer;

  constructor(private opts: DaemonOptions) {
    this.fs = new FsService(opts.workspace);
    this.ext = new ExtHost({ runtime: opts.runtime, fs: this.fs });
    this.market = new Marketplace({ fs: this.fs, registry: 'https://open-vsx.org/api' });
    this.ftp = new FtpServer({ fs: this.fs, scope: 'foreground', lan: false });
  }

  async start(): Promise<{ port: number; token: string }> {
    const http = createServer((req, res) => this.route(req, res));
    const wss = new WebSocketServer({ noServer: true });

    http.on('upgrade', (req, sock, head) => {
      if (!this.authorized(req)) return sock.destroy();
      wss.handleUpgrade(req, sock, head, (ws) => this.ext.attach(ws));
    });

    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    this.port = (http.address() as any).port;
    return { port: this.port, token: this.token };
  }

  private authorized(req: any): boolean {
    const h = req.headers['authorization'] || '';
    return h === 'Bearer ' + this.token;
  }
}`
  };

  const state = {
    files: {}, activeFile: '', openFiles: [], dirty: new Set(),
    view: 'editor', pane: 'files', panel: 'terminal', provider: null,
    aiMessages: [], diff: null, search: '', terminal: [], problems: [
      { severity: 'warning', text: 'No project diagnostics have been collected yet.' }
    ]
  };
  root.files = state.files;
  root.activeFile = state.activeFile;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) || '{}');
      state.files = Object.assign({}, initialFiles, saved.files || {});
      state.activeFile = saved.activeFile && state.files[saved.activeFile]
        ? saved.activeFile : Object.keys(state.files)[0];
      state.openFiles = Array.isArray(saved.openFiles) && saved.openFiles.length
        ? saved.openFiles.filter(function (f) { return state.files[f]; })
        : [state.activeFile];
      if (!state.openFiles.includes(state.activeFile)) state.openFiles.push(state.activeFile);
    } catch (_) {
      state.files = Object.assign({}, initialFiles);
      state.activeFile = Object.keys(state.files)[0];
      state.openFiles = [state.activeFile];
    }
    root.files = state.files; root.activeFile = state.activeFile;
  }
  function persist() {
    try {
      localStorage.setItem(STORAGE, JSON.stringify({
        files: state.files, activeFile: state.activeFile, openFiles: state.openFiles
      }));
    } catch (_) {}
  }

  function toast(message, kind) {
    const host = byId('toasts');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.innerHTML = String(message || '');
    host.appendChild(el);
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 300); }, 3200);
  }
  root.toast = toast;

  function byId(id) { return document.getElementById(id); }
  function openModal(id) {
    const el = byId(id); if (!el) return;
    el.classList.add('on');
    const overlay = byId('overlay'); if (overlay) overlay.classList.add('on');
  }
  function closeModal(id) {
    const el = byId(id); if (el) el.classList.remove('on');
    if (!$$('.modal.on').length) { const overlay = byId('overlay'); if (overlay) overlay.classList.remove('on'); }
  }
  root.openModal = openModal; root.closeModal = closeModal;

  /* View switching. The browser and marketplace surfaces are full-bleed
     overlays inside .work, so they are toggled with the same `.on` class
     their own CSS uses — not a separate `view-on` state. */
  function setView(view) {
    state.view = view;
    $$('.browser, .mkt').forEach(function (el) { el.classList.remove('on'); });
    const browser = byId('browser'); const mkt = byId('mkt');
    if (view === 'browser' && browser) browser.classList.add('on');
    else if (view === 'marketplace' && mkt) { mkt.classList.add('on'); loadMarket(false); }
    $$('.rail button[data-view], [data-bnav]').forEach(function (el) {
      el.classList.toggle('on', (el.dataset.view || el.dataset.bnav) === view);
    });
    if (view !== 'browser' && browser) browser.classList.remove('on');
    if (view !== 'marketplace' && mkt) mkt.classList.remove('on');
  }

  function setPane(pane) {
    state.pane = pane;
    $$('[data-pane]').forEach(function (el) { el.classList.toggle('on', el.dataset.pane === pane); });
    $$('[data-view]').forEach(function (el) { el.classList.toggle('on', el.dataset.view === pane); });
    const title = byId('sb-title'); if (title) title.textContent = pane.charAt(0).toUpperCase() + pane.slice(1);
    if (pane === 'ai') renderAiPane();
    if (pane === 'extensions') renderExtList();
    if (pane === 'marketplace') loadMarket(false);
    if (pane === 'radarmatrix' && root.renderRmPane) root.renderRmPane();
    if (pane === 'manus' && root.renderMnPane) root.renderMnPane();
    if (pane === 'github') renderGithubPane();
    if (pane === 'search') renderSearchPane();
    if (pane === 'settings') renderSettingsPane();
  }

  /* The tree and the code view use the class names app.css styles:
     .row/.fi/.nm for a file row, .ln-row/.ln/.lc for a code line. */
  function renderTree() {
    const tree = byId('tree'); if (!tree) return;
    const names = Object.keys(state.files).sort();
    tree.innerHTML = names.map(function (name) {
      const active = name === state.activeFile ? ' active' : '';
      const dirty = state.dirty.has(name) ? '<span class="dirty">●</span>' : '';
      return '<div class="row file' + active + '" data-file="' + esc(name) + '"><span class="fi ts">' + iconFor(name) + '</span><span class="nm">' + esc(name) + '</span>' + dirty + '</div>';
    }).join('');
    $$('#tree [data-file]').forEach(function (el) { el.addEventListener('click', function () { openFile(el.dataset.file); }); });
  }
  function iconFor(name) {
    if (/\.tsx?$/.test(name)) return 'TS';
    if (/\.json$/.test(name)) return '{}';
    if (/\.md$/.test(name)) return 'M';
    return '·';
  }
  function openFile(name) {
    if (!state.files[name]) return;
    state.activeFile = name; root.activeFile = name;
    if (!state.openFiles.includes(name)) state.openFiles.push(name);
    renderTree(); renderTabs(); renderEditor(); updateStatus(); persist();
  }
  function renderTabs() {
    const tabs = byId('tabs'); if (!tabs) return;
    tabs.innerHTML = state.openFiles.map(function (name) {
      return '<button class="tab' + (name === state.activeFile ? ' on' : '') + '" data-tab="' + esc(name) + '">' + esc(name.split('/').pop()) + (state.dirty.has(name) ? ' •' : '') + '<span class="tab-x" data-close="' + esc(name) + '">×</span></button>';
    }).join('');
    $$('#tabs [data-tab]').forEach(function (el) { el.addEventListener('click', function (e) { if (!e.target.dataset.close) openFile(el.dataset.tab); }); });
    $$('#tabs [data-close]').forEach(function (el) { el.addEventListener('click', function (e) { e.stopPropagation(); closeFile(el.dataset.close); }); });
  }
  function closeFile(name) {
    if (state.dirty.has(name) && !window.confirm('Discard unsaved changes to ' + name + '?')) return;
    state.openFiles = state.openFiles.filter(function (f) { return f !== name; });
    state.dirty.delete(name);
    if (state.activeFile === name) state.activeFile = state.openFiles[0] || Object.keys(state.files)[0];
    root.activeFile = state.activeFile; renderTabs(); renderEditor(); renderTree(); persist();
  }

  /* ---------- debugger ----------
     A scripted session over the recoderd fixture. Each stop carries a real
     call stack, so step-in / step-out / step-over move through depth rather
     than just advancing a counter. The toolbar is rendered at idle (see
     boot()) so the play button the panel's own hint refers to actually
     exists before a session starts. */
  const DBG_FILE = 'packages/recoderd/src/server.ts';

  const TRACE = [
    { line: 37, stack: [
        { fn: 'Recoderd.start', file: DBG_FILE, line: 37, vars: [
          { k: 'this', v: 'Recoderd { token: …, port: 0 }', t: 'obj' },
          { k: 'opts', v: "{ workspace: '/recoder', runtime: 'jsc' }", t: 'obj' } ] } ] },
    { line: 38, stack: [
        { fn: 'Recoderd.start', file: DBG_FILE, line: 38, vars: [
          { k: 'this', v: 'Recoderd { token: …, port: 0 }', t: 'obj' },
          { k: 'http', v: 'Server { listening: false }', t: 'obj' } ] } ] },
    { line: 39, stack: [
        { fn: 'Recoderd.start', file: DBG_FILE, line: 39, vars: [
          { k: 'http', v: 'Server { listening: false }', t: 'obj' },
          { k: 'wss', v: 'WebSocketServer { clients: Set(0) }', t: 'obj' } ] } ] },
    { line: 41, stack: [
        { fn: 'Recoderd.start', file: DBG_FILE, line: 41, vars: [
          { k: 'http', v: 'Server { listening: false }', t: 'obj' },
          { k: 'wss', v: 'WebSocketServer { clients: Set(0) }', t: 'obj' } ] } ] },
    { line: 42, stack: [
        { fn: '(upgrade handler)', file: DBG_FILE, line: 42, vars: [
          { k: 'req', v: "IncomingMessage { url: '/ext', method: 'GET' }", t: 'obj' },
          { k: 'sock', v: "Socket { remoteAddress: '127.0.0.1' }", t: 'obj' } ] },
        { fn: 'Recoderd.start', file: DBG_FILE, line: 41, vars: [
          { k: 'http', v: 'Server { listening: true }', t: 'obj' } ] } ] },
    { line: 43, stack: [
        { fn: 'Recoderd.authorized', file: DBG_FILE, line: 52, vars: [
          { k: 'req', v: "IncomingMessage { url: '/ext' }", t: 'obj' },
          { k: 'h', v: "'Bearer eyJhbGciOi…'", t: 'str' } ] },
        { fn: '(upgrade handler)', file: DBG_FILE, line: 42, vars: [
          { k: 'req', v: "IncomingMessage { url: '/ext' }", t: 'obj' } ] },
        { fn: 'Recoderd.start', file: DBG_FILE, line: 41, vars: [
          { k: 'http', v: 'Server { listening: true }', t: 'obj' } ] } ] },
    { line: 53, stack: [
        { fn: 'Recoderd.authorized', file: DBG_FILE, line: 53, vars: [
          { k: 'h', v: "'Bearer eyJhbGciOi…'", t: 'str' },
          { k: 'this.token', v: "'eyJhbGciOi…'", t: 'str' },
          { k: 'result', v: 'true', t: 'bool' } ] },
        { fn: '(upgrade handler)', file: DBG_FILE, line: 42, vars: [
          { k: 'req', v: "IncomingMessage { url: '/ext' }", t: 'obj' } ] },
        { fn: 'Recoderd.start', file: DBG_FILE, line: 41, vars: [
          { k: 'http', v: 'Server { listening: true }', t: 'obj' } ] } ] },
    { line: 43, stack: [
        { fn: '(upgrade handler)', file: DBG_FILE, line: 43, vars: [
          { k: 'req', v: "IncomingMessage { url: '/ext' }", t: 'obj' },
          { k: 'ws', v: 'WebSocket { readyState: 1 }', t: 'obj' } ] },
        { fn: 'Recoderd.start', file: DBG_FILE, line: 41, vars: [
          { k: 'http', v: 'Server { listening: true }', t: 'obj' } ] } ] },
    { line: 46, stack: [
        { fn: 'Recoderd.start', file: DBG_FILE, line: 46, vars: [
          { k: 'http', v: 'Server { listening: false }', t: 'obj' },
          { k: 'wss', v: 'WebSocketServer { clients: Set(1) }', t: 'obj' } ] } ] },
    { line: 47, stack: [
        { fn: 'Recoderd.start', file: DBG_FILE, line: 47, vars: [
          { k: 'this.port', v: '0', t: 'num' },
          { k: 'http', v: 'Server { listening: true }', t: 'obj' } ] } ] },
    { line: 48, stack: [
        { fn: 'Recoderd.start', file: DBG_FILE, line: 48, vars: [
          { k: 'this.port', v: '51234', t: 'num' },
          { k: 'this.token', v: "'eyJhbGciOi…'", t: 'str' } ] } ] }
  ];

  const dbg = {
    state: 'idle',      // idle | paused | running | done
    idx: -1,
    frame: 0,
    bps: new Map(),     // file -> Set(line)
    timer: null
  };

  dbg.bps.set(DBG_FILE, new Set([42, 46]));

  function bpSet(file) {
    if (!dbg.bps.has(file)) dbg.bps.set(file, new Set());
    return dbg.bps.get(file);
  }

  function toggleBp(file, line) {
    const s = bpSet(file);
    if (s.has(line)) s.delete(line); else s.add(line);
    renderEditor();
    renderDebug();
    const n = Array.from(dbg.bps.values()).reduce(function (a, b) { return a + b.size; }, 0);
    const cnt = byId('dbg-cnt'); if (cnt) cnt.textContent = String(n);
    const b = byId('bnav-dbg');
    if (b) { b.textContent = String(n); b.style.display = n ? '' : 'none'; }
  }

  function curStop() { return dbg.idx >= 0 ? TRACE[dbg.idx] : null; }
  function curFrame() {
    const s = curStop();
    return s ? s.stack[Math.min(dbg.frame, s.stack.length - 1)] : null;
  }

  function setDbgState(txt, cls) {
    const el = byId('dbg-state');
    if (!el) return;
    el.textContent = txt;
    el.className = 'st ' + (cls || '');
  }

  function renderDebug() {
    const host = byId('dbg'); if (!host) return;
    const s = curStop();
    const f = curFrame();
    const bpAll = [];
    dbg.bps.forEach(function (set, file) { set.forEach(function (ln) { bpAll.push({ file: file, ln: ln }); }); });
    bpAll.sort(function (a, b) { return a.file.localeCompare(b.file) || a.ln - b.ln; });

    const bpHtml = bpAll.length
      ? bpAll.map(function (b) {
          return '<div class="bp-item"><span class="d"></span>'
            + '<span class="f">' + esc(b.file.split('/').pop()) + '</span>'
            + '<span class="l">:' + b.ln + '</span>'
            + '<span class="x" data-rmbp="' + esc(b.file) + ':' + b.ln + '">×</span></div>';
        }).join('')
      : '<div class="dbg-empty">No breakpoints. Click the gutter left of a line number to set one.</div>';

    const stackHtml = s
      ? s.stack.map(function (fr, i) {
          return '<div class="frame' + (i === dbg.frame ? ' on' : '') + '" data-frame="' + i + '">'
            + '<span class="fn">' + esc(fr.fn) + '</span>'
            + '<span class="loc">' + esc(fr.file.split('/').pop()) + ':' + fr.line + '</span></div>';
        }).join('')
      : '<div class="dbg-empty">Not paused. Press <b>F5</b> or the play button to start a session against <b>recoderd</b>.</div>';

    const varsHtml = f
      ? f.vars.map(function (v) {
          return '<div class="var"><span class="k3">' + esc(v.k) + '</span>'
            + '<span class="eq">=</span><span class="v3 ' + (v.t || '') + '">' + esc(v.v) + '</span></div>';
        }).join('')
      : '<div class="dbg-empty">No frame selected.</div>';

    host.innerHTML =
      '<div class="dbg-col">'
      + '<div class="dbg-sec">Call stack <span class="n">' + (s ? s.stack.length : 0) + '</span></div>' + stackHtml
      + '<div class="dbg-sec">Breakpoints <span class="n">' + bpAll.length + '</span></div>' + bpHtml
      + '</div>'
      + '<div class="dbg-col">'
      + '<div class="dbg-sec">Variables <span class="n">' + (f ? f.vars.length : 0) + '</span>'
      + (f ? '<span style="margin-left:auto;font-family:var(--mono);font-size:8.5px;color:var(--dim2);letter-spacing:0">' + esc(f.fn) + '</span>' : '')
      + '</div>' + varsHtml
      + '</div>';

    const paused = dbg.state === 'paused';
    ['dbg-continue', 'dbg-stepover', 'dbg-stepin', 'dbg-stepout'].forEach(function (id) {
      const el = byId(id); if (el) el.disabled = !paused;
    });
    const pause = byId('dbg-pause'); if (pause) pause.disabled = dbg.state !== 'running';
    const stop = byId('dbg-stop'); if (stop) stop.disabled = dbg.state === 'idle' || dbg.state === 'done';
    const restart = byId('dbg-restart'); if (restart) restart.disabled = dbg.state === 'idle';
  }

  function showDebugPanel() {
    state.panel = 'debug';
    $$('[data-ptab]').forEach(function (x) { x.classList.toggle('on', x.dataset.ptab === 'debug'); });
    $$('[data-pbody]').forEach(function (x) { x.classList.toggle('on', x.dataset.pbody === 'debug'); });
    const panel = byId('panel'); if (panel) panel.classList.remove('collapsed');
  }

  function gotoStop(i) {
    dbg.idx = Math.max(0, Math.min(TRACE.length - 1, i));
    dbg.frame = 0;
    const s = curStop();
    if (state.activeFile !== DBG_FILE) openFile(DBG_FILE);
    renderEditor();
    renderDebug();
    const row = $('.ln-row[data-ln="' + s.line + '"]');
    if (row) {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const ln = byId('st-ln'); if (ln) ln.textContent = 'Ln ' + s.line + ', Col 1';
    }
  }

  function dbgStart() {
    clearTimeout(dbg.timer);
    dbg.state = 'running';
    dbg.idx = -1;
    dbg.frame = 0;
    const bar = byId('dbg-bar'); if (bar) bar.classList.add('on');
    showDebugPanel();
    setDbgState('starting · jsc', '');
    renderDebug();
    dbg.timer = setTimeout(function () {
      dbg.state = 'paused';
      setDbgState('paused · breakpoint', '');
      gotoStop(0);
      toast('Paused on <b>Recoderd.start</b> · ' + DBG_FILE.split('/').pop() + ':37');
    }, 620);
  }

  function dbgContinue() {
    if (dbg.state !== 'paused') return;
    const from = dbg.idx;
    const bps = bpSet(DBG_FILE);
    let next = -1;
    for (let i = from + 1; i < TRACE.length; i++) {
      if (bps.has(TRACE[i].line)) { next = i; break; }
    }
    if (next === -1) {
      dbg.state = 'done';
      setDbgState('exited · code 0', 'done');
      dbg.idx = -1;
      renderEditor(); renderDebug();
      toast('Debug session ended · <b>exit 0</b>');
      return;
    }
    dbg.state = 'running';
    setDbgState('running', '');
    renderDebug();
    setTimeout(function () {
      dbg.state = 'paused';
      setDbgState('paused · breakpoint', '');
      gotoStop(next);
    }, 420);
  }

  function dbgStep(dir) {
    if (dbg.state !== 'paused') return;
    const s = curStop();
    const depth = s.stack.length;
    let target = -1;
    for (let i = dbg.idx + 1; i < TRACE.length; i++) {
      const d = TRACE[i].stack.length;
      if (dir === 'over' && d <= depth) { target = i; break; }
      if (dir === 'in' && d > depth) { target = i; break; }
      if (dir === 'out' && d < depth) { target = i; break; }
    }
    if (target === -1) target = Math.min(TRACE.length - 1, dbg.idx + 1);
    gotoStop(target);
  }

  function dbgStop() {
    clearTimeout(dbg.timer);
    dbg.state = 'idle';
    dbg.idx = -1;
    setDbgState('not started', 'idle');
    renderEditor(); renderDebug();
    toast('Debug session stopped');
  }

  function wireDebug() {
    const bar = byId('dbg-bar');
    /* DEF-1: the toolbar must exist at idle. The panel's own hint tells the
       user to press the play button, so hiding the bar until a session starts
       made that instruction impossible to follow. */
    if (bar) bar.classList.add('on');

    const on = function (id, fn) { const el = byId(id); if (el) el.addEventListener('click', fn); };
    on('dbg-continue', dbgContinue);
    on('dbg-pause', function () {
      if (dbg.state === 'running') { clearTimeout(dbg.timer); dbg.state = 'paused'; setDbgState('paused', ''); renderDebug(); }
    });
    on('dbg-stepover', function () { dbgStep('over'); });
    on('dbg-stepin', function () { dbgStep('in'); });
    on('dbg-stepout', function () { dbgStep('out'); });
    on('dbg-restart', dbgStart);
    on('dbg-stop', dbgStop);

    const code = byId('code');
    if (code) {
      code.addEventListener('click', function (ev) {
        const g = ev.target.closest('[data-gutter]');
        if (g) { toggleBp(state.activeFile, parseInt(g.dataset.gutter, 10)); return; }
        const rm = ev.target.closest('[data-rmbp]');
        if (rm) {
          const parts = rm.dataset.rmbp.split(':');
          toggleBp(parts.slice(0, -1).join(':'), parseInt(parts[parts.length - 1], 10));
        }
      });
    }

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'F5') { ev.preventDefault(); if (dbg.state === 'paused') dbgContinue(); else dbgStart(); }
      if (ev.key === 'F10') { ev.preventDefault(); dbgStep('over'); }
      if (ev.key === 'F11') { ev.preventDefault(); dbgStep(ev.shiftKey ? 'out' : 'in'); }
    });

    renderDebug();
  }

  function renderEditor() {
    const ta = byId('editor-ta'); const code = byId('code');
    const body = state.files[state.activeFile] || '';
    if (ta && document.activeElement !== ta) ta.value = body;
    if (code) {
      const bps = bpSet(state.activeFile);
      const stop = curStop();
      const execLine = (stop && state.activeFile === DBG_FILE) ? stop.line : -1;
      code.innerHTML = body.split('\n').map(function (line, i) {
        const n = i + 1;
        const cls = 'ln-row' + (bps.has(n) ? ' bp' : '') + (n === execLine ? ' exec' : '');
        return '<div class="' + cls + '" data-ln="' + n + '">'
          + '<span class="gutter" data-gutter="' + n + '"></span>'
          + '<span class="ln">' + n + '</span>'
          + '<span class="lc">' + highlight(line) + '</span></div>';
      }).join('');
    }
    const path = byId('bc-path'); if (path) path.textContent = state.activeFile || 'No file open';
    const dirty = byId('ed-dirty'); if (dirty) dirty.style.display = state.dirty.has(state.activeFile) ? '' : 'none';
    if (ta) ta.scrollTop = ta.scrollTop;
  }
  /* Token classes match app.css: .k keyword, .s string, .c comment.
     Single left-to-right pass. The previous version escaped the line first
     and then ran regexes over the result, which (a) never matched a
     double-quoted string because `"` had already become `&quot;`, and
     (b) matched `class` inside the `<span class="s">` markup it had just
     inserted, emitting broken HTML. Scanning the raw line avoids both. */
  const HL_KEYWORDS = /^(?:const|let|var|function|return|export|import|from|async|await|class|new|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|typeof|instanceof|interface|type|enum|extends|implements|public|private|protected|readonly|static|void|number|string|boolean|any|unknown|never|null|undefined|true|false)\b/;
  function highlight(line) {
    let out = '';
    let i = 0;
    const n = line.length;
    while (i < n) {
      const rest = line.slice(i);
      if (rest.startsWith('//')) { out += '<span class="c">' + esc(rest) + '</span>'; break; }
      const ch = line[i];
      if (ch === '"' || ch === "'" || ch === '`') {
        let j = i + 1;
        while (j < n) {
          if (line[j] === '\\') { j += 2; continue; }
          if (line[j] === ch) { j++; break; }
          j++;
        }
        out += '<span class="s">' + esc(line.slice(i, j)) + '</span>';
        i = j; continue;
      }
      if (/[A-Za-z_$]/.test(ch)) {
        const before = i === 0 ? '' : line[i - 1];
        const m = !/[A-Za-z0-9_$]/.test(before) ? rest.match(HL_KEYWORDS) : null;
        if (m) { out += '<span class="k">' + esc(m[0]) + '</span>'; i += m[0].length; continue; }
        let j = i;
        while (j < n && /[A-Za-z0-9_$]/.test(line[j])) j++;
        out += esc(line.slice(i, j));
        i = j; continue;
      }
      out += esc(ch);
      i++;
    }
    return out || '&nbsp;';
  }
  function markDirty() {
    const ta = byId('editor-ta'); if (!ta || !state.activeFile) return;
    state.files[state.activeFile] = ta.value; state.dirty.add(state.activeFile); root.files = state.files;
    renderEditor(); renderTabs(); renderTree(); updateStatus();
  }
  function saveActive() {
    if (!state.activeFile) return;
    const ta = byId('editor-ta'); if (ta) state.files[state.activeFile] = ta.value;
    state.dirty.delete(state.activeFile); root.files = state.files; persist(); renderEditor(); renderTabs(); renderTree();
    toast('Saved ' + esc(state.activeFile), 'ok');
  }
  function revertActive() { state.dirty.delete(state.activeFile); renderEditor(); renderTabs(); renderTree(); }

  function updateStatus() {
    const ta = byId('editor-ta'); const value = ta ? ta.value : '';
    const lines = value.slice(0, ta ? ta.selectionStart : 0).split('\n');
    const ln = byId('st-ln'); if (ln) ln.textContent = 'Ln ' + lines.length + ', Col ' + (lines[lines.length - 1].length + 1);
    const lang = byId('st-lang'); if (lang) lang.textContent = languageFor(state.activeFile);
    const host = byId('st-host'); if (host) host.textContent = 'JSC 12/12';
  }
  function languageFor(name) {
    if (/\.json$/.test(name)) return 'JSON';
    if (/\.md$/.test(name)) return 'Markdown';
    if (/\.css$/.test(name)) return 'CSS';
    return 'TypeScript';
  }

  function renderGithubPane() {
    const el = byId('gh-pane'); if (!el) return;
    el.innerHTML = '<div class="gh-sec"><div class="gh-card"><div class="gh-lbl">GitHub <span class="gh-badge">browser API</span></div><div class="gh-note">Sign in to clone, inspect, commit, push, or open a pull request. Credentials remain in this browser.</div><div class="gh-row2"><button class="gh-btn pri sm" id="gh-signin">Sign in</button><button class="gh-btn sm" id="gh-clone">Clone</button></div></div></div>';
    const sign = byId('gh-signin'); if (sign) sign.onclick = function () { openModal('m-signin'); };
    const clone = byId('gh-clone'); if (clone) clone.onclick = function () { openModal('m-clone'); };
  }
  function renderSearchPane() {
    const el = byId('search-results'); if (!el) return;
    const q = (byId('search-input') || {}).value || '';
    if (!q) { el.innerHTML = '<div class="hint">Search files in this workspace.</div>'; return; }
    const out = [];
    Object.keys(state.files).forEach(function (name) {
      state.files[name].split('\n').forEach(function (line, i) {
        if (line.toLowerCase().includes(q.toLowerCase())) out.push('<div class="search-hit" data-file="' + esc(name) + '"><b>' + esc(name) + ':' + (i + 1) + '</b> ' + esc(line.trim()) + '</div>');
      });
    });
    el.innerHTML = out.join('') || '<div class="hint">No matches.</div>';
    $$('#search-results [data-file]').forEach(function (n) { n.onclick = function () { openFile(n.dataset.file); }; });
  }
  function renderSettingsPane() {
    const el = byId('settings-list'); if (!el) return;
    el.innerHTML = '<div class="pane-pad"><div class="hint">Workspace settings are stored locally in this browser.</div><button class="btn" id="settings-reset">Reset sample workspace</button></div>';
    const reset = byId('settings-reset'); if (reset) reset.onclick = function () { if (window.confirm('Reset local workspace?')) { state.files = Object.assign({}, initialFiles); state.activeFile = Object.keys(state.files)[0]; state.openFiles = [state.activeFile]; state.dirty.clear(); persist(); renderAll(); } };
  }

  function providerConfig() {
    try { return JSON.parse(localStorage.getItem(AI_STORAGE) || 'null'); } catch (_) { return null; }
  }
  function renderAiPane() {
    const el = byId('ai-pane'); if (!el) return;
    const cfg = providerConfig(); state.provider = cfg;
    el.innerHTML = '<div class="gh-sec"><div class="gh-card"><div class="gh-lbl">AI provider <span class="ai-badge">' + esc(cfg ? cfg.providerName : 'not configured') + '</span></div><div class="gh-note">Connect an OpenAI-compatible provider, local server, or proxy. Keys remain in this browser.</div><div class="gh-row2"><button class="gh-btn pri sm" id="ai-config">Configure</button><button class="gh-btn sm" id="ai-clear">Clear</button></div></div></div>';
    const config = byId('ai-config'); if (config) config.onclick = function () { openProviderModal(); };
    const clear = byId('ai-clear'); if (clear) clear.onclick = function () { localStorage.removeItem(AI_STORAGE); renderAiPane(); updateAiStatus(); };
    updateAiStatus();
  }
  function openProviderModal() {
    const cfg = providerConfig() || {};
    const select = byId('pv-model'); const cat = root.MODEL_CATALOGUE;
    if (select && cat) {
      select.innerHTML = cat.providers.map(function (p) { return '<optgroup label="' + esc(p.name) + '">' + p.models.map(function (m) { return '<option value="' + esc(p.id + '::' + m.id) + '">' + esc(m.name) + '</option>'; }).join('') + '</optgroup>'; }).join('');
      const current = cfg.provider && cfg.model ? cfg.provider + '::' + cfg.model : '';
      if (current) select.value = current;
    }
    const key = byId('pv-key'); if (key) key.value = cfg.key || '';
    const base = byId('pv-base'); if (base) base.value = cfg.base || '';
    updateProviderInfo(); openModal('m-prov');
  }
  function selectedProvider() {
    const select = byId('pv-model'); const v = select && select.value || '';
    const split = v.split('::'); const cat = root.MODEL_CATALOGUE;
    const p = cat && cat.getProvider(split[0]); const m = cat && cat.getModel(split[1]);
    return { provider: p, model: m };
  }
  function updateProviderInfo() {
    const picked = selectedProvider(); const p = picked.provider; const hint = byId('pv-hint'); const base = byId('pv-base');
    if (hint) hint.textContent = p ? p.name + ' · ' + p.kind + ' API' : '';
    if (base && p && !base.value) base.value = p.base;
  }
  function saveProvider() {
    const picked = selectedProvider(); if (!picked.provider || !picked.model) return;
    const cfg = { provider: picked.provider.id, providerName: picked.provider.name, model: picked.model.id, key: (byId('pv-key') || {}).value || '', base: (byId('pv-base') || {}).value || picked.provider.base };
    localStorage.setItem(AI_STORAGE, JSON.stringify(cfg)); closeModal('m-prov'); renderAiPane(); toast('AI provider saved', 'ok');
  }
  async function testProvider() {
    const picked = selectedProvider(); const key = (byId('pv-key') || {}).value || ''; const base = (byId('pv-base') || {}).value || (picked.provider && picked.provider.base) || '';
    const msg = byId('pv-msg'); if (msg) msg.textContent = 'Testing…';
    try { const data = await providerChat('Reply with the single word OK.', { provider: picked.provider, model: picked.model, key: key, base: base }); if (msg) msg.innerHTML = '<span class="gh-ok">Provider responded.</span>'; return data; }
    catch (e) { if (msg) msg.innerHTML = '<span class="gh-err">' + esc(e.message) + '</span>'; }
  }
  async function providerChat(prompt, cfg) {
    const body = { model: cfg.model.id, messages: [{ role: 'user', content: prompt }], stream: false, max_tokens: 1200 };
    const headers = { 'content-type': 'application/json', accept: 'application/json' }; if (cfg.key) headers.authorization = 'Bearer ' + cfg.key;
    const res = await fetch(String(cfg.base).replace(/\/+$/, '') + '/chat/completions', { method: 'POST', headers: headers, body: JSON.stringify(body) });
    const data = await res.json().catch(function () { return {}; }); if (!res.ok) throw new Error((data.error && (data.error.message || data.error)) || 'Provider returned HTTP ' + res.status); return data;
  }
  function updateAiStatus() { const cfg = providerConfig(); const el = byId('st-ai-txt'); if (el) el.textContent = cfg ? 'AI: ' + cfg.model : 'AI: no provider'; }
  async function sendAi(text) {
    const cfg = providerConfig(); if (!cfg) { openProviderModal(); throw new Error('Configure an AI provider first.'); }
    const model = root.MODEL_CATALOGUE.getModel(cfg.model); const data = await providerChat(text, { provider: root.MODEL_CATALOGUE.getProvider(cfg.provider), model: model, key: cfg.key, base: cfg.base });
    const answer = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '(No text returned)';
    state.aiMessages.push({ role: 'user', content: text }, { role: 'assistant', content: answer }); renderAiChat(); return answer;
  }
  function renderAiChat() { const el = byId('ai-msgs'); if (el) el.innerHTML = state.aiMessages.map(function (m) { return '<div class="ai-msg ' + m.role + '"><b>' + esc(m.role) + '</b><div>' + esc(m.content).replace(/\n/g, '<br>') + '</div></div>'; }).join(''); }

  function aiEdit() { const bar = byId('inline-bar'); if (bar) bar.classList.add('on'); const input = byId('ib-input'); if (input) input.focus(); }
  async function runInlineEdit() {
    const input = byId('ib-input'); const msg = byId('ib-msg'); if (!input || !input.value.trim()) return;
    if (msg) msg.textContent = 'Working…';
    try {
      const original = state.files[state.activeFile]; const answer = await sendAi('Rewrite this file according to the instruction. Return only the complete replacement file.\nInstruction: ' + input.value + '\n\nFile:\n' + original);
      state.diff = { file: state.activeFile, original: original, replacement: answer.replace(/^```[a-z]*\n?|```$/g, '').trim() };
      const bar = byId('diff-bar'); if (bar) bar.classList.add('on'); const text = byId('db-txt'); if (text) text.textContent = 'AI proposed changes to ' + state.activeFile; if (msg) msg.textContent = 'Review the proposed change below.';
    } catch (e) { if (msg) msg.textContent = e.message; }
  }
  function acceptDiff() { if (!state.diff) return; state.files[state.diff.file] = state.diff.replacement; state.dirty.add(state.diff.file); state.diff = null; const bar = byId('diff-bar'); if (bar) bar.classList.remove('on'); renderEditor(); renderTabs(); renderTree(); }
  function rejectDiff() { state.diff = null; const bar = byId('diff-bar'); if (bar) bar.classList.remove('on'); }

  function appendTerminal(text, kind) { state.terminal.push({ text: String(text), kind: kind || '' }); const el = byId('term'); if (el) el.innerHTML = state.terminal.map(function (l) { return '<div class="term-line ' + esc(l.kind) + '">' + esc(l.text) + '</div>'; }).join(''); const body = $('.panel-body[data-pbody="terminal"]'); if (body) body.scrollTop = body.scrollHeight; }
  /* ---------- extensions ----------
     The installed-extension list. These three records are seeded so the pane
     is populated before any registry call, exactly as the deployed build did.
     The extension HOST itself is not implemented in this repository (see
     plan.md), so this renders the installed set, not a running host. */
  const installed = new Set(['redhat.vscode-yaml', 'esbenp.prettier-vscode', 'eamodio.gitlens']);
  const installedMeta = new Map();
  [
    { id: 'redhat.vscode-yaml', n: 'YAML', pub: 'Red Hat', v: '1.19.0', d: 'YAML language support with schema validation, completion and hover.', c: '#e04a4a' },
    { id: 'esbenp.prettier-vscode', n: 'Prettier - Code formatter', pub: 'Prettier', v: '11.0.0', d: 'Opinionated code formatter, wired to format-on-save through the workspace FS.', c: '#b9c46a' },
    { id: 'eamodio.gitlens', n: 'GitLens', pub: 'GitKraken', v: '16.3.0', d: 'Commit history, blame and line authorship, read through isomorphic-git.', c: '#c6f24e' }
  ].forEach(function (e) { installedMeta.set(e.id, e); });

  function renderExtList() {
    const host = byId('ext-list'); if (!host) return;
    const filter = byId('ext-filter');
    const q = (filter && filter.value ? filter.value : '').toLowerCase();
    const list = Array.from(installed)
      .map(function (id) { return installedMeta.get(id) || mkt.items.find(function (x) { return x.id === id; }); })
      .filter(Boolean)
      .filter(function (e) { return !q || (e.n + ' ' + e.id).toLowerCase().indexOf(q) !== -1; });

    host.innerHTML = list.map(function (e) {
      const ico = e.icon
        ? '<div class="ico" style="background:#0b0f0e"><img src="' + esc(e.icon) + '" alt="" loading="lazy"></div>'
        : '<div class="ico" style="background:' + e.c + '">' + esc(e.n.slice(0, 2).toUpperCase()) + '</div>';
      return '<div class="ext" data-ext="' + esc(e.id) + '">' + ico
        + '<div class="meta"><div class="n">' + esc(e.n) + '</div>'
        + '<div class="p">' + esc(e.pub) + ' · v' + esc(e.v) + '</div>'
        + '<div class="d">' + esc(e.d) + '</div></div>'
        + '<div class="sw on" data-toggle="' + esc(e.id) + '"></div></div>';
    }).join('') || '<div class="hint" style="padding:10px">No installed extensions match.</div>';

    const badge = byId('bnav-ext');
    if (badge) { badge.textContent = String(installed.size); badge.style.display = installed.size ? '' : 'none'; }
  }

  /* ---------- marketplace ----------
     Queries open-vsx.org directly from the device, as the deployed build did.
     A failed request renders an explicit error with a retry, never an empty
     grid that could be mistaken for "no results". */
  const REGISTRY = 'https://open-vsx.org/api';
  const mkt = { items: [], total: 0, loading: false, error: null, query: '', size: 24, ctrl: null, fetched: false };

  function fmtNum(n) {
    if (n == null) return '—';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }

  function hueFor(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return 'hsl(' + h + ' 42% 46%)';
  }

  function normExt(e) {
    const id = e.namespace + '.' + e.name;
    return {
      id: id,
      n: e.displayName || e.name,
      pub: e.namespaceDisplayName || e.namespace,
      v: e.version,
      dl: fmtNum(e.downloadCount),
      st: e.averageRating ? e.averageRating.toFixed(1) : '—',
      cat: (e.categories && e.categories[0]) || 'other',
      d: e.description || 'No description provided by the publisher.',
      icon: e.files && e.files.icon ? e.files.icon : null,
      c: hueFor(id),
      verified: !!e.verified
    };
  }

  function renderMarket() {
    const grid = byId('mkt-grid'); if (!grid) return;
    const count = byId('mkt-count');

    if (mkt.loading && !mkt.items.length) {
      if (count) count.textContent = 'querying open-vsx.org…';
      grid.innerHTML = '<div class="hint" style="padding:20px 0">Loading the Open VSX catalogue…</div>';
      return;
    }

    if (mkt.error) {
      if (count) count.textContent = 'registry unreachable';
      grid.innerHTML = '<div class="mkt-err"><b>Could not reach the registry.</b><br>'
        + 'The workbench queries <code>open-vsx.org</code> directly from the device. '
        + 'This request failed — check the connection, or the registry may be rate-limiting.<br>'
        + '<code>' + esc(mkt.error) + '</code><br>'
        + '<button class="btn" id="mkt-retry">Retry</button></div>';
      const retry = byId('mkt-retry');
      if (retry) retry.addEventListener('click', function () { loadMarket(true); });
      return;
    }

    if (!mkt.items.length) {
      if (count) count.textContent = 'no results';
      grid.innerHTML = '<div class="hint" style="padding:20px 0">No extensions match that query on Open VSX.</div>';
      return;
    }

    if (count) count.textContent = mkt.items.length + ' of ' + (mkt.total || mkt.items.length).toLocaleString() + ' extensions';

    grid.innerHTML = mkt.items.map(function (e) {
      const isIn = installed.has(e.id);
      const btn = isIn
        ? '<button class="inst done" data-install="' + esc(e.id) + '">installed</button>'
        : '<button class="inst" data-install="' + esc(e.id) + '">install</button>';
      const ico = e.icon
        ? '<div class="ico" style="background:#0b0f0e"><img src="' + esc(e.icon) + '" alt="" loading="lazy"></div>'
        : '<div class="ico" style="background:' + e.c + '">' + esc(e.n.slice(0, 2).toUpperCase()) + '</div>';
      return '<div class="card" data-ext="' + esc(e.id) + '">' + ico
        + '<div class="body"><div class="top"><span class="nm">' + esc(e.n) + '</span>'
        + '<span class="ver">v' + esc(e.v) + '</span></div>'
        + '<div class="pub">' + esc(e.pub) + (e.verified ? ' · <span style="color:var(--lime)">verified</span>' : '') + '</div>'
        + '<div class="desc">' + esc(e.d) + '</div>'
        + '<div class="foot"><span class="st">★ ' + e.st + '</span><span>' + e.dl + ' installs</span><span>' + esc(e.cat) + '</span></div>'
        + '</div>' + btn + '</div>';
    }).join('');
  }

  async function loadMarket(force) {
    if (mkt.fetched && !force) { renderMarket(); return; }
    if (mkt.ctrl) mkt.ctrl.abort();
    mkt.ctrl = new AbortController();
    mkt.loading = true; mkt.error = null;
    renderMarket();
    try {
      const p = new URLSearchParams();
      p.set('size', String(mkt.size));
      p.set('offset', '0');
      if (mkt.query) p.set('query', mkt.query);
      const res = await fetch(REGISTRY + '/-/search?' + p.toString(), { signal: mkt.ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' from open-vsx.org');
      const data = await res.json();
      mkt.items = (data.extensions || []).map(normExt);
      mkt.total = data.totalSize || mkt.items.length;
      mkt.fetched = true;
    } catch (e) {
      if (e.name !== 'AbortError') mkt.error = e.message || String(e);
    } finally {
      mkt.loading = false;
      renderMarket();
    }
  }

  function installExt(id) {
    if (installed.has(id)) return;
    const rec = mkt.items.find(function (x) { return x.id === id; });
    if (rec) installedMeta.set(id, rec);
    installed.add(id);
    renderMarket();
    renderExtList();
    toast('Installed <b>' + esc(id) + '</b>');
  }

  function wireExtensions() {
    const filter = byId('ext-filter');
    if (filter) filter.addEventListener('input', renderExtList);

    const grid = byId('mkt-grid');
    if (grid) {
      grid.addEventListener('click', function (ev) {
        const btn = ev.target.closest('[data-install]');
        if (btn) installExt(btn.dataset.install);
      });
    }

    const list = byId('ext-list');
    if (list) {
      list.addEventListener('click', function (ev) {
        const sw = ev.target.closest('[data-toggle]');
        if (sw) sw.classList.toggle('on');
      });
    }

    renderExtList();
  }

  function renderAll() { renderTree(); renderTabs(); renderEditor(); renderAiPane(); renderGithubPane(); renderSearchPane(); renderSettingsPane(); renderExtList(); renderMarket(); updateAiStatus(); updateStatus(); if (root.renderRmPane) root.renderRmPane(); if (root.renderMnPane) root.renderMnPane(); }

  function isMobileLayout() { return window.matchMedia && window.matchMedia('(max-width: 900px)').matches; }
  function toggleSidebar(force) {
    const sidebar = byId('sidebar'); if (!sidebar) return;
    const open = typeof force === 'boolean' ? force : !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', open);
    const button = byId('btn-layout'); if (button) button.setAttribute('aria-expanded', String(open));
  }
  function togglePanel(force) {
    const panel = byId('panel'); if (!panel) return;
    if (isMobileLayout()) {
      const open = typeof force === 'boolean' ? force : !panel.classList.contains('sheet');
      panel.classList.toggle('sheet', open);
      panel.classList.toggle('collapsed', !open);
    } else {
      const collapsed = typeof force === 'boolean' ? !force : !panel.classList.contains('collapsed');
      panel.classList.toggle('collapsed', collapsed);
    }
  }
  function wireTouchSheet(el, direction, onOpen, onClose) {
    if (!el) return;
    let startX = 0; let startY = 0; let tracking = false;
    el.addEventListener('touchstart', function (e) {
      if (!e.touches || !e.touches[0]) return;
      startX = e.touches[0].clientX; startY = e.touches[0].clientY; tracking = true;
    }, { passive: true });
    el.addEventListener('touchend', function (e) {
      if (!tracking || !e.changedTouches || !e.changedTouches[0]) return;
      tracking = false;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (direction === 'horizontal' && Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.25) {
        if (dx < 0 && onClose) onClose();
        if (dx > 0 && onOpen) onOpen();
      }
      if (direction === 'vertical' && Math.abs(dy) > 42 && Math.abs(dy) > Math.abs(dx) * 1.25) {
        if (dy < 0 && onOpen) onOpen();
        if (dy > 0 && onClose) onClose();
      }
    }, { passive: true });
  }

  function wire() {
    $$('.rail button[data-view], [data-bnav]').forEach(function (el) { el.addEventListener('click', function () { const v = el.dataset.view || el.dataset.bnav; if (['browser', 'marketplace'].includes(v)) setView(v); else { setView('editor'); setPane(v); } }); });
    $$('[data-ptab]').forEach(function (el) { el.addEventListener('click', function () { state.panel = el.dataset.ptab; $$('[data-ptab]').forEach(function (x) { x.classList.toggle('on', x === el); }); $$('[data-pbody]').forEach(function (x) { x.classList.toggle('on', x.dataset.pbody === state.panel); }); }); });
    $$('[data-mclose]').forEach(function (el) { el.addEventListener('click', function () { closeModal(el.dataset.mclose); }); });
    $$('.modal').forEach(function (el) { el.addEventListener('click', function (e) { if (e.target === el) closeModal(el.id); }); });
    const overlay = byId('overlay'); if (overlay) overlay.addEventListener('click', function () { $$('.modal.on').forEach(function (m) { m.classList.remove('on'); }); overlay.classList.remove('on'); });
    const ta = byId('editor-ta'); if (ta) { ta.addEventListener('input', markDirty); ta.addEventListener('keyup', updateStatus); ta.addEventListener('click', updateStatus); }
    const save = byId('ed-save'); if (save) save.onclick = saveActive; const revert = byId('ed-revert'); if (revert) revert.onclick = revertActive; const edit = byId('ed-edit'); if (edit) edit.onclick = function () { if (ta) { ta.removeAttribute('readonly'); ta.focus(); } };
    const aiEditButton = byId('ed-ai'); if (aiEditButton) aiEditButton.onclick = aiEdit; const ibRun = byId('ib-run'); if (ibRun) ibRun.onclick = runInlineEdit; const ibClose = byId('ib-close'); if (ibClose) ibClose.onclick = function () { const b = byId('inline-bar'); if (b) b.classList.remove('on'); }; const accept = byId('db-accept'); if (accept) accept.onclick = acceptDiff; const reject = byId('db-reject'); if (reject) reject.onclick = rejectDiff;
    const send = byId('ai-send'); if (send) send.onclick = async function () { const input = byId('ai-input'); if (!input || !input.value.trim()) return; const text = input.value.trim(); input.value = ''; try { await sendAi(text); } catch (e) { toast(esc(e.message), 'error'); } };
    const aiInput = byId('ai-input'); if (aiInput) aiInput.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (send) send.click(); } });
    const pvModel = byId('pv-model'); if (pvModel) pvModel.addEventListener('change', updateProviderInfo); const pvSave = byId('pv-save'); if (pvSave) pvSave.onclick = saveProvider; const pvTest = byId('pv-test'); if (pvTest) pvTest.onclick = testProvider;
    const search = byId('search-input'); if (search) search.addEventListener('input', renderSearchPane);
    const layout = byId('btn-layout'); if (layout) layout.onclick = function () { toggleSidebar(); };
    const panelToggle = byId('panel-toggle'); if (panelToggle) panelToggle.onclick = function () { togglePanel(); };
    wireTouchSheet(byId('sidebar'), 'horizontal', function () { toggleSidebar(true); }, function () { toggleSidebar(false); });
    wireTouchSheet(byId('panel-grab') || byId('panel'), 'vertical', function () { togglePanel(true); }, function () { togglePanel(false); });
    window.addEventListener('resize', function () { const panel = byId('panel'); if (panel && !isMobileLayout()) panel.classList.remove('sheet'); }, { passive: true });
    document.addEventListener('keydown', function (e) { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveActive(); } if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); aiEdit(); } });
  }

  /* live-browser.js exposes its parts (lbLoad, wireBrowser, lbHealth, ...) but
     no single entry point, so the shell boots it here. Without this the
     browser pane opens with unwired controls and a chip stuck on "checking". */
  function bootLiveBrowser() {
    if (typeof root.lbLoad !== 'function' || typeof root.wireBrowser !== 'function') return;
    root.lbLoad();
    root.wireBrowser();
    if (typeof root.lbHealth === 'function') {
      var configured = typeof root.lbConfigured === 'function' && root.lbConfigured();
      var probe = root.lbHealth(true);
      if (configured && probe && probe.then) {
        probe.then(function () {
          if (root.lbRefreshSessions) root.lbRefreshSessions();
          if (root.lbLoadTraces) root.lbLoadTraces();
        });
      }
    }
    if (root.renderBrTabs) root.renderBrTabs();
    if (root.renderBrLog) root.renderBrLog();
    if (root.renderBrSessions) root.renderBrSessions();
    if (root.renderBrRec) root.renderBrRec();
    if (root.lbSetMode && root.LB) root.lbSetMode(root.LB.mode);
  }

  function boot() { loadState(); wire(); wireDebug(); wireExtensions(); renderAll(); setView('editor'); setPane('files'); appendTerminal('recode workspace ready'); if (root.rmLoad) root.rmLoad(); if (root.rmWire) root.rmWire(); if (root.mnLoad && root.renderMnPane) root.renderMnPane(); if (root.lbBoot) root.lbBoot(); else bootLiveBrowser(); }
  root.setView = setView; root.setPane = setPane; root.renderTree = renderTree; root.openFile = openFile; root.saveActive = saveActive; root.sendAi = sendAi; root.providerChat = providerChat; root.saveRmConfig = root.rmSave || function () {};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
